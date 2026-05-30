//! Native FIDO2/CTAP2 *client* — drives a USB security key over HID directly,
//! bypassing the browser's `navigator.credentials` (which Electron does not
//! surface a UI for on Linux/macOS — electron/electron#24573).
//!
//! Uses Mozilla's `authenticator` crate (the engine Firefox ships) to run the
//! CTAP2 makeCredential / getAssertion ceremony, then assembles the exact
//! WebAuthn response JSON that our existing webauthn-rs Relying Party consumes
//! (`finish_registration` / `finish_authentication` in `webauthn.rs`). Nothing
//! in the RP changes — this module only produces the same JSON a browser would.
//!
//! v1 scope: non-resident credential, attestation "none", user-presence (touch)
//! only — `UserVerificationRequirement::Discouraged` so the key does not demand
//! a client PIN. If a key insists on a PIN we abort with an error (interactive
//! PIN entry is a planned enhancement). The ceremony BLOCKS on the user's touch,
//! so callers must run it off the main thread (the napi layer uses spawn_blocking).

use std::sync::mpsc::{channel, RecvError};
use std::sync::{Mutex, OnceLock};
use std::thread;

use authenticator::{
    authenticatorservice::{AuthenticatorService, RegisterArgs, SignArgs},
    crypto::COSEAlgorithm,
    ctap2::server::{
        AuthenticationExtensionsClientInputs, PublicKeyCredentialDescriptor,
        PublicKeyCredentialParameters, PublicKeyCredentialUserEntity, RelyingParty,
        ResidentKeyRequirement, Transport, UserVerificationRequirement,
    },
    statecallback::StateCallback,
    StatusUpdate,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::{VaultError, VaultResult};

/// Must match the RP in `webauthn.rs` (rp_id "localhost", origin "http://localhost").
const ORIGIN: &str = "http://localhost";
const RP_ID: &str = "localhost";
/// Generous human-interaction timeout (touch the key).
const TIMEOUT_MS: u64 = 60_000;

// --- Minimal views of the RP's challenge JSON (only the fields we consume). ---
// webauthn-rs serializes challenge / user.id / credential ids as base64url strings.

#[derive(Deserialize)]
struct CreationChallenge {
    #[serde(rename = "publicKey")]
    public_key: CreationOptions,
}
#[derive(Deserialize)]
struct CreationOptions {
    challenge: String,
    user: UserEntity,
    #[serde(rename = "pubKeyCredParams")]
    pub_key_cred_params: Vec<CredParam>,
    #[serde(default, rename = "excludeCredentials")]
    exclude_credentials: Vec<CredDescriptor>,
}
#[derive(Deserialize)]
struct UserEntity {
    id: String,
    name: String,
    #[serde(rename = "displayName")]
    display_name: String,
}
#[derive(Deserialize)]
struct CredParam {
    alg: i64,
}
#[derive(Deserialize)]
struct CredDescriptor {
    id: String,
}

#[derive(Deserialize)]
struct RequestChallenge {
    #[serde(rename = "publicKey")]
    public_key: RequestOptions,
}
#[derive(Deserialize)]
struct RequestOptions {
    challenge: String,
    #[serde(default, rename = "allowCredentials")]
    allow_credentials: Vec<CredDescriptor>,
}

fn json_err(ctx: &str, e: impl std::fmt::Display) -> VaultError {
    VaultError::Crypto(format!("{ctx}: {e}"))
}

fn b64decode(ctx: &str, s: &str) -> VaultResult<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(s.trim_end_matches('='))
        .map_err(|e| json_err(ctx, e))
}

/// Translate an authenticator-crate ceremony error into a user-facing message.
/// The raw error (e.g. `HIDError(Command(StatusCode(NoCredentials, None)))`) is
/// too technical for a banner, so map the common CTAP outcomes. `action` is the
/// verb shown to the user ("register" / "unlock").
fn ceremony_error(action: &str, e: impl std::fmt::Debug) -> VaultError {
    let raw = format!("{e:?}");
    let msg = if raw.contains("NoCredentials") {
        "This security key isn't registered for this vault.".to_string()
    } else if raw.contains("CredentialExcluded") {
        "This security key is already registered.".to_string()
    } else if raw.contains("Pin") || raw.contains("Uv") {
        // PinRequired / PinInvalid / PinBlocked / PinAuthBlocked / UvBlocked …
        "This security key needs a PIN or biometric, which isn't supported yet.".to_string()
    } else if raw.contains("Timeout") {
        format!("Timed out — touch the security key when it blinks, then {action} again.")
    } else if raw.contains("NoConfiguredTransports") {
        "No security key was found — plug it in and try again.".to_string()
    } else {
        // Covers a declined biometric (wrong/unenrolled finger), a cancelled or
        // unplugged key, or a transport hiccup — without the misleading
        // "plugged in" framing when the key was actually present but said no.
        format!("Security key {action} failed — declined or no response. Make sure it's plugged in (and use an enrolled finger on a biometric key), then try again.")
    };
    VaultError::Crypto(msg)
}

/// Build the clientDataJSON the RP will re-parse. `challenge_b64` is passed
/// through verbatim (do NOT decode/re-encode). `origin` MUST be the RP origin.
fn client_data(typ: &str, challenge_b64: &str) -> Vec<u8> {
    format!(
        r#"{{"type":"{typ}","challenge":"{challenge_b64}","origin":"{ORIGIN}","crossOrigin":false}}"#
    )
    .into_bytes()
}

fn cose_alg(alg: i64) -> Option<COSEAlgorithm> {
    match alg {
        -7 => Some(COSEAlgorithm::ES256),
        -257 => Some(COSEAlgorithm::RS256),
        _ => None,
    }
}

/// One shared authenticator service, created once and reused across ceremonies.
/// Recreating it per call re-enumerates the USB HID devices AND races the prior
/// ceremony's not-yet-released device handle — the main source of unlock latency.
/// Keeping it warm makes repeated unlocks fast. The Mutex serializes ceremonies
/// (only one register/sign runs at a time, which is the only valid usage anyway).
fn service() -> VaultResult<&'static Mutex<AuthenticatorService>> {
    static SERVICE: OnceLock<Mutex<AuthenticatorService>> = OnceLock::new();
    if let Some(s) = SERVICE.get() {
        return Ok(s);
    }
    let mut mgr = AuthenticatorService::new()
        .map_err(|e| VaultError::Crypto(format!("authenticator init: {e:?}")))?;
    mgr.add_u2f_usb_hid_platform_transports();
    // add_u2f_usb_hid_platform_transports is best-effort and silent on failure.
    // Probe via cancel() (Err only when no transport is configured, else an idle
    // no-op) so we don't permanently cache a transport-less service if HID/udev
    // isn't ready yet — the next call then retries a fresh service.
    if mgr.cancel().is_err() {
        return Err(VaultError::Crypto(
            "no security-key transport available — check the key is plugged in and udev/hidraw permissions".into(),
        ));
    }
    // First writer wins; if we lost an init race our mgr is dropped here.
    let _ = SERVICE.set(Mutex::new(mgr));
    Ok(SERVICE.get().expect("service initialized"))
}

/// Drain CTAP2 status updates on a side thread. v1: we only need touch
/// (handled by the OS/key blink + our static UI). On any PIN/UV demand we let
/// the sender drop, which aborts the ceremony with an error rather than hang.
fn spawn_status_drain(rx: std::sync::mpsc::Receiver<StatusUpdate>) -> thread::JoinHandle<()> {
    thread::spawn(move || loop {
        match rx.recv() {
            Ok(StatusUpdate::PinUvError(_)) => { /* drop sender -> ceremony aborts */ }
            Ok(_) => {}
            Err(RecvError) => break,
        }
    })
}

/// Run CTAP2 makeCredential against a USB key and return a
/// `RegisterPublicKeyCredential` JSON ready for `finish_registration`.
pub fn native_make_credential(ccr_json: &str) -> VaultResult<String> {
    let ccr: CreationChallenge =
        serde_json::from_str(ccr_json).map_err(|e| json_err("parse challenge", e))?;
    let opts = ccr.public_key;

    let client_data_json = client_data("webauthn.create", &opts.challenge);
    let client_data_hash: [u8; 32] = Sha256::digest(&client_data_json).into();

    let user_id = b64decode("user id", &opts.user.id)?;
    let pub_cred_params: Vec<PublicKeyCredentialParameters> = opts
        .pub_key_cred_params
        .iter()
        .filter_map(|p| cose_alg(p.alg))
        .map(|alg| PublicKeyCredentialParameters { alg })
        .collect();
    if pub_cred_params.is_empty() {
        return Err(VaultError::Crypto("no supported pubKeyCredParams".into()));
    }
    let exclude_list: Vec<PublicKeyCredentialDescriptor> = opts
        .exclude_credentials
        .iter()
        .filter_map(|c| b64decode("exclude id", &c.id).ok())
        .map(|id| PublicKeyCredentialDescriptor {
            id,
            transports: vec![Transport::USB],
        })
        .collect();

    let args = RegisterArgs {
        client_data_hash,
        relying_party: RelyingParty {
            id: RP_ID.into(),
            name: None,
        },
        origin: ORIGIN.into(),
        user: PublicKeyCredentialUserEntity {
            id: user_id,
            name: Some(opts.user.name),
            display_name: Some(opts.user.display_name),
        },
        pub_cred_params,
        exclude_list,
        user_verification_req: UserVerificationRequirement::Discouraged,
        resident_key_req: ResidentKeyRequirement::Discouraged,
        extensions: AuthenticationExtensionsClientInputs::default(),
        pin: None,
        use_ctap1_fallback: false,
    };

    let mgr_mutex = service()?;
    // Recover a poisoned lock (a prior ceremony's call stack unwound): the cached
    // service holds no invariant broken by an unwind, so reuse it via into_inner()
    // rather than bricking unlock for the rest of the session.
    let mut mgr = mgr_mutex.lock().unwrap_or_else(|e| e.into_inner());
    let (status_tx, status_rx) = channel::<StatusUpdate>();
    let drain = spawn_status_drain(status_rx);

    let (reg_tx, reg_rx) = channel();
    let callback = StateCallback::new(Box::new(move |rv| {
        let _ = reg_tx.send(rv);
    }));
    mgr.register(TIMEOUT_MS, args, status_tx, callback)
        .map_err(|e| ceremony_error("register", e))?;
    let result = reg_rx
        .recv()
        .map_err(|e| VaultError::Crypto(format!("register recv: {e}")))?;
    // Stop the ceremony now that we have the result, so the state machine does
    // not run until TIMEOUT_MS (which would block drain.join() for ~60s).
    let _ = mgr.cancel();
    let _ = drain.join();
    let reg = result.map_err(|e| ceremony_error("register", e))?;

    let att_obj =
        serde_cbor::to_vec(&reg.att_obj).map_err(|e| json_err("attestationObject cbor", e))?;
    let cred_id = reg
        .att_obj
        .auth_data
        .credential_data
        .as_ref()
        .ok_or_else(|| VaultError::Crypto("attestation missing credential data".into()))?
        .credential_id
        .clone();
    let id_b64 = URL_SAFE_NO_PAD.encode(&cred_id);

    let json = serde_json::json!({
        "id": id_b64,
        "rawId": id_b64,
        "type": "public-key",
        "response": {
            "attestationObject": URL_SAFE_NO_PAD.encode(&att_obj),
            "clientDataJSON": URL_SAFE_NO_PAD.encode(&client_data_json),
        }
    });
    Ok(json.to_string())
}

/// Run CTAP2 getAssertion against a USB key and return a `PublicKeyCredential`
/// JSON ready for `finish_authentication`.
pub fn native_get_assertion(rcr_json: &str) -> VaultResult<String> {
    let rcr: RequestChallenge =
        serde_json::from_str(rcr_json).map_err(|e| json_err("parse challenge", e))?;
    let opts = rcr.public_key;

    let client_data_json = client_data("webauthn.get", &opts.challenge);
    let client_data_hash: [u8; 32] = Sha256::digest(&client_data_json).into();

    let allow_list: Vec<PublicKeyCredentialDescriptor> = opts
        .allow_credentials
        .iter()
        .filter_map(|c| b64decode("allow id", &c.id).ok())
        .map(|id| PublicKeyCredentialDescriptor {
            id,
            transports: vec![Transport::USB],
        })
        .collect();
    if allow_list.is_empty() {
        return Err(VaultError::Crypto("no credentials to authenticate".into()));
    }

    let args = SignArgs {
        client_data_hash,
        origin: ORIGIN.into(),
        relying_party_id: RP_ID.into(),
        allow_list,
        user_verification_req: UserVerificationRequirement::Discouraged,
        user_presence_req: true,
        extensions: AuthenticationExtensionsClientInputs::default(),
        pin: None,
        use_ctap1_fallback: false,
    };

    let mgr_mutex = service()?;
    // Recover a poisoned lock (a prior ceremony's call stack unwound): the cached
    // service holds no invariant broken by an unwind, so reuse it via into_inner()
    // rather than bricking unlock for the rest of the session.
    let mut mgr = mgr_mutex.lock().unwrap_or_else(|e| e.into_inner());
    let (status_tx, status_rx) = channel::<StatusUpdate>();
    let drain = spawn_status_drain(status_rx);

    let (sign_tx, sign_rx) = channel();
    let callback = StateCallback::new(Box::new(move |rv| {
        let _ = sign_tx.send(rv);
    }));
    mgr.sign(TIMEOUT_MS, args, status_tx, callback)
        .map_err(|e| ceremony_error("unlock", e))?;
    let result = sign_rx
        .recv()
        .map_err(|e| VaultError::Crypto(format!("sign recv: {e}")))?;
    // Stop the ceremony now that we have the result, so the state machine does not
    // run until TIMEOUT_MS — which would hold the status channel open and block
    // drain.join() for the full timeout (~60s after a ~2s touch).
    let _ = mgr.cancel();
    let _ = drain.join();
    let gar = result.map_err(|e| ceremony_error("unlock", e))?;
    let assertion = gar.assertion;

    // CTAP2.0 keys MAY omit the credential descriptor when the allow_list has a
    // single entry; fall back to it so id/rawId aren't empty (CTAP2.1 keys like
    // the YubiKey 5 always populate it).
    let cred_id = assertion
        .credentials
        .as_ref()
        .map(|d| d.id.clone())
        .or_else(|| {
            (opts.allow_credentials.len() == 1)
                .then(|| b64decode("allow id", &opts.allow_credentials[0].id).ok())
                .flatten()
        })
        .unwrap_or_default();
    let id_b64 = URL_SAFE_NO_PAD.encode(&cred_id);

    let mut response = serde_json::json!({
        "authenticatorData": URL_SAFE_NO_PAD.encode(assertion.auth_data.to_vec()),
        "clientDataJSON": URL_SAFE_NO_PAD.encode(&client_data_json),
        "signature": URL_SAFE_NO_PAD.encode(&assertion.signature),
    });
    if let Some(user) = assertion.user.as_ref() {
        response["userHandle"] = serde_json::Value::String(URL_SAFE_NO_PAD.encode(&user.id));
    }

    let json = serde_json::json!({
        "id": id_b64,
        "rawId": id_b64,
        "type": "public-key",
        "response": response,
    });
    Ok(json.to_string())
}
