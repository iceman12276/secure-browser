#![deny(clippy::all)]

mod crypto;
mod error;
mod kdf;
mod storage;
mod totp;
mod vault;
mod webauthn;

use std::sync::Mutex;

use napi_derive::napi;

use crate::vault::VaultState;

#[napi]
pub fn core_version() -> String {
    format!("secure-browser-core {}", env!("CARGO_PKG_VERSION"))
}

/// Credential metadata exposed to JS — NEVER includes the secret.
#[napi(object)]
pub struct CredentialMeta {
    pub id: String,
    pub origin: String,
    pub username: String,
    pub label: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[napi(object)]
pub struct TotpEnrollmentDto {
    pub secret_base32: String,
    pub otpauth_url: String,
    pub qr_png_base64: String,
}

#[napi(object)]
pub struct MfaStatus {
    pub enrolled: bool,
    pub awaiting_second_factor: bool,
}

/// Challenge + opaque state pair for a WebAuthn ceremony.
#[napi(object)]
pub struct WebauthnChallenge {
    pub challenge_json: String,
    pub state_json: String,
}

impl From<crate::vault::CredentialMeta> for CredentialMeta {
    fn from(m: crate::vault::CredentialMeta) -> Self {
        CredentialMeta {
            id: m.id,
            origin: m.origin,
            username: m.username,
            label: m.label,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

#[napi]
pub struct Vault {
    state: Mutex<VaultState>,
}

#[napi]
impl Vault {
    /// Construct a vault bound to a per-user data directory.
    #[napi(constructor)]
    pub fn new(dir: String) -> Self {
        Vault {
            state: Mutex::new(VaultState::new(dir)),
        }
    }

    #[napi]
    pub fn is_initialized(&self) -> bool {
        self.state.lock().unwrap().is_initialized()
    }

    #[napi]
    pub fn is_unlocked(&self) -> bool {
        self.state.lock().unwrap().is_unlocked()
    }

    #[napi]
    pub fn init_vault(&self, master_pw: String) -> napi::Result<()> {
        self.state
            .lock()
            .unwrap()
            .init(&master_pw)
            .map_err(Into::into)
    }

    #[napi]
    pub fn unlock(&self, master_pw: String) -> napi::Result<()> {
        self.state
            .lock()
            .unwrap()
            .unlock(&master_pw)
            .map_err(Into::into)
    }

    #[napi]
    pub fn lock(&self) {
        self.state.lock().unwrap().lock();
    }

    #[napi]
    pub fn add_credential(
        &self,
        origin: String,
        username: String,
        secret: String,
        label: String,
    ) -> napi::Result<String> {
        self.state
            .lock()
            .unwrap()
            .add_credential(&origin, &username, &secret, &label)
            .map_err(Into::into)
    }

    #[napi]
    pub fn get_credentials(&self, origin: String) -> napi::Result<Vec<CredentialMeta>> {
        let metas = self.state.lock().unwrap().get_credentials(&origin)?;
        Ok(metas.into_iter().map(Into::into).collect())
    }

    #[napi]
    pub fn list(&self) -> napi::Result<Vec<CredentialMeta>> {
        let metas = self.state.lock().unwrap().list()?;
        Ok(metas.into_iter().map(Into::into).collect())
    }

    #[napi]
    pub fn get_secret(&self, id: String) -> napi::Result<String> {
        self.state
            .lock()
            .unwrap()
            .get_secret(&id)
            .map_err(Into::into)
    }

    #[napi]
    pub fn delete(&self, id: String) -> napi::Result<()> {
        self.state.lock().unwrap().delete(&id).map_err(Into::into)
    }

    #[napi]
    pub fn mfa_status(&self) -> MfaStatus {
        let s = self.state.lock().unwrap();
        MfaStatus {
            enrolled: s.mfa_enrolled(),
            awaiting_second_factor: s.awaiting_second_factor(),
        }
    }

    #[napi]
    pub fn enroll_totp(&self) -> napi::Result<TotpEnrollmentDto> {
        let e = self.state.lock().unwrap().enroll_totp()?;
        Ok(TotpEnrollmentDto {
            secret_base32: e.secret_base32,
            otpauth_url: e.otpauth_url,
            qr_png_base64: e.qr_png_base64,
        })
    }

    #[napi]
    pub fn confirm_totp(&self, code: String) -> napi::Result<bool> {
        Ok(self.state.lock().unwrap().confirm_totp(&code)?)
    }

    #[napi]
    pub fn verify_totp(&self, code: String) -> napi::Result<bool> {
        Ok(self.state.lock().unwrap().verify_totp(&code)?)
    }

    #[napi]
    pub fn start_webauthn_registration(&self) -> napi::Result<WebauthnChallenge> {
        let (challenge_json, state_json) = self
            .state
            .lock()
            .unwrap()
            .start_webauthn_registration()?;
        Ok(WebauthnChallenge {
            challenge_json,
            state_json,
        })
    }

    #[napi]
    pub fn finish_webauthn_registration(
        &self,
        response: String,
        state: String,
    ) -> napi::Result<()> {
        self.state
            .lock()
            .unwrap()
            .finish_webauthn_registration(&response, &state)?;
        Ok(())
    }

    #[napi]
    pub fn start_webauthn_authentication(&self) -> napi::Result<WebauthnChallenge> {
        let (challenge_json, state_json) = self
            .state
            .lock()
            .unwrap()
            .start_webauthn_authentication()?;
        Ok(WebauthnChallenge {
            challenge_json,
            state_json,
        })
    }

    #[napi]
    pub fn finish_webauthn_authentication(
        &self,
        response: String,
        state: String,
    ) -> napi::Result<bool> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .finish_webauthn_authentication(&response, &state)?)
    }
}
