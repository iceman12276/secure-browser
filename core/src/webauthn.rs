// Public API awaiting M4.4 napi wiring — dead_code is expected until then.
#![allow(dead_code)]

use url::Url;
use uuid::Uuid;
use webauthn_rs::prelude::*;

use crate::error::{VaultError, VaultResult};

/// Build the Relying Party. rp_id must be an effective domain of rp_origin.
/// For the Electron dev build the chrome view is served over http://localhost.
pub fn build_rp() -> VaultResult<Webauthn> {
    let rp_id = "localhost";
    let rp_origin =
        Url::parse("http://localhost").map_err(|e| VaultError::Crypto(format!("rp origin: {e}")))?;
    WebauthnBuilder::new(rp_id, &rp_origin)
        .and_then(|b| b.rp_name("Secure Browser").build())
        .map_err(|e| VaultError::Crypto(format!("webauthn build: {e}")))
}

/// Start registration. Returns (challenge JSON for the browser, state JSON to persist).
pub fn start_registration() -> VaultResult<(String, String)> {
    let webauthn = build_rp()?;
    let user_id = Uuid::new_v4();
    let (ccr, state) = webauthn
        .start_passkey_registration(user_id, "vault", "Vault Owner", None)
        .map_err(|e| VaultError::Crypto(format!("start reg: {e}")))?;
    Ok((to_json(&ccr)?, to_json(&state)?))
}

/// Finish registration. `response_json` is the browser credential; `state_json`
/// is what start_registration returned. Returns the Passkey JSON to store.
pub fn finish_registration(response_json: &str, state_json: &str) -> VaultResult<String> {
    let webauthn = build_rp()?;
    let reg: RegisterPublicKeyCredential = from_json(response_json)?;
    let state: PasskeyRegistration = from_json(state_json)?;
    let passkey = webauthn
        .finish_passkey_registration(&reg, &state)
        .map_err(|e| VaultError::Crypto(format!("finish reg: {e}")))?;
    to_json(&passkey)
}

/// Start authentication against the stored passkeys (JSON list).
/// Errors if no passkeys are registered — authenticating with no credentials is not meaningful.
pub fn start_authentication(passkeys_json: &[String]) -> VaultResult<(String, String)> {
    if passkeys_json.is_empty() {
        return Err(VaultError::Crypto(
            "no passkeys registered; cannot start authentication".into(),
        ));
    }
    let webauthn = build_rp()?;
    let passkeys: Vec<Passkey> = passkeys_json
        .iter()
        .map(|s| from_json::<Passkey>(s))
        .collect::<VaultResult<Vec<_>>>()?;
    let (rcr, state) = webauthn
        .start_passkey_authentication(&passkeys)
        .map_err(|e| VaultError::Crypto(format!("start auth: {e}")))?;
    Ok((to_json(&rcr)?, to_json(&state)?))
}

/// Finish authentication. Returns true on a valid assertion.
pub fn finish_authentication(response_json: &str, state_json: &str) -> VaultResult<bool> {
    let webauthn = build_rp()?;
    let cred: PublicKeyCredential = from_json(response_json)?;
    let state: PasskeyAuthentication = from_json(state_json)?;
    webauthn
        .finish_passkey_authentication(&cred, &state)
        .map(|_| true)
        .map_err(|e| VaultError::Crypto(format!("finish auth: {e}")))
}

fn to_json<T: serde::Serialize>(v: &T) -> VaultResult<String> {
    serde_json::to_string(v).map_err(VaultError::from)
}
fn from_json<T: serde::de::DeserializeOwned>(s: &str) -> VaultResult<T> {
    serde_json::from_str(s).map_err(VaultError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rp_builds() {
        assert!(build_rp().is_ok());
    }

    #[test]
    fn start_registration_produces_challenge_and_serializable_state() {
        let (challenge, state) = start_registration().unwrap();
        // Challenge is the navigator.credentials.create() options.
        assert!(challenge.contains("challenge"));
        assert!(challenge.contains("\"rp\""));
        // State must round-trip through JSON (persisted between start/finish).
        let parsed: PasskeyRegistration = serde_json::from_str(&state).unwrap();
        let reserialized = serde_json::to_string(&parsed).unwrap();
        assert!(!reserialized.is_empty());
    }

    #[test]
    fn start_authentication_with_no_passkeys_errors() {
        // No registered passkeys → webauthn-rs rejects starting auth.
        assert!(start_authentication(&[]).is_err());
    }
}
