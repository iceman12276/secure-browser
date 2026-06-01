use std::path::{Path, PathBuf};

use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{decrypt_secret, encrypt_secret};
use crate::error::{VaultError, VaultResult};
use crate::kdf::{derive_key, KdfParams};
use crate::storage;
use crate::storage::{
    confirm_totp, has_passkeys, list_passkeys, put_passkey, put_totp, totp_confirmed, totp_record,
};
use crate::totp;
use crate::webauthn;

#[derive(Serialize, Deserialize)]
struct VaultMeta {
    version: u32,
    salt_b64: String,
    kdf: KdfParams,
}

pub struct CredentialMeta {
    pub id: String,
    pub origin: String,
    pub username: String,
    pub label: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Locked or unlocked. The connection + derived key exist only when unlocked.
pub struct VaultState {
    dir: PathBuf,
    conn: Option<Connection>,
    // Kept only to prove zeroize-on-lock; not read after unlock.
    _key: Option<Zeroizing<[u8; 32]>>,
    awaiting_second_factor: bool,
    // The base32 TOTP secret, decrypted into memory only while awaiting/using MFA.
    totp_secret: Option<Zeroizing<String>>,
}

impl VaultState {
    pub fn new(dir: impl AsRef<Path>) -> Self {
        VaultState {
            dir: dir.as_ref().to_path_buf(),
            conn: None,
            _key: None,
            awaiting_second_factor: false,
            totp_secret: None,
        }
    }

    fn meta_path(&self) -> PathBuf {
        self.dir.join("vault.meta.json")
    }
    fn db_path(&self) -> PathBuf {
        self.dir.join("vault.db")
    }

    pub fn is_initialized(&self) -> bool {
        self.meta_path().exists()
    }

    pub fn is_unlocked(&self) -> bool {
        self.conn.is_some() && !self.awaiting_second_factor
    }

    pub fn awaiting_second_factor(&self) -> bool {
        self.awaiting_second_factor
    }

    /// True if any second factor is enrolled (TOTP confirmed or a passkey).
    pub fn mfa_enrolled(&self) -> bool {
        match self.conn.as_ref() {
            Some(c) => totp_confirmed(c).unwrap_or(false) || has_passkeys(c).unwrap_or(false),
            None => false,
        }
    }

    /// True if a confirmed TOTP secret is enrolled. Reads the open connection
    /// directly so it is also valid while awaiting the second factor.
    pub fn totp_enrolled(&self) -> bool {
        match self.conn.as_ref() {
            Some(c) => totp_confirmed(c).unwrap_or(false),
            None => false,
        }
    }

    /// True if at least one passkey / security key is registered. Reads the open
    /// connection directly so it is also valid while awaiting the second factor.
    pub fn has_passkey(&self) -> bool {
        match self.conn.as_ref() {
            Some(c) => has_passkeys(c).unwrap_or(false),
            None => false,
        }
    }

    /// Guard for credential ops: requires DB open AND second factor satisfied.
    fn conn(&self) -> VaultResult<&Connection> {
        if self.awaiting_second_factor {
            return Err(VaultError::Locked);
        }
        self.conn.as_ref().ok_or(VaultError::Locked)
    }

    /// DB access that is allowed while awaiting the second factor
    /// (needed to read the TOTP secret / passkeys during verification).
    fn conn_preauth(&self) -> VaultResult<&Connection> {
        self.conn.as_ref().ok_or(VaultError::Locked)
    }

    /// First-time setup: generate salt, write meta, create + key the DB.
    pub fn init(&mut self, master_pw: &str) -> VaultResult<()> {
        if self.is_initialized() {
            return Err(VaultError::AlreadyInitialized);
        }
        std::fs::create_dir_all(&self.dir)?;
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let kdf = KdfParams::default();
        let meta = VaultMeta {
            version: 1,
            salt_b64: b64(&salt),
            kdf,
        };
        std::fs::write(self.meta_path(), serde_json::to_vec_pretty(&meta)?)?;

        let key = derive_key(master_pw.as_bytes(), &salt, kdf)?;
        let conn = storage::open_encrypted(&self.db_path().to_string_lossy(), &key)?;
        storage::init_schema(&conn)?;
        storage::audit(&conn, "vault.init", "")?;
        self.conn = Some(conn);
        self._key = Some(key);
        Ok(())
    }

    pub fn unlock(&mut self, master_pw: &str) -> VaultResult<()> {
        if !self.is_initialized() {
            return Err(VaultError::NotInitialized);
        }
        let meta: VaultMeta = serde_json::from_slice(&std::fs::read(self.meta_path())?)?;
        let salt = b64_decode(&meta.salt_b64)?;
        let key = derive_key(master_pw.as_bytes(), &salt, meta.kdf)?;
        let conn = storage::open_encrypted(&self.db_path().to_string_lossy(), &key)?;
        storage::audit(&conn, "vault.unlock.phase1", "")?;

        // Decide whether a second factor is required.
        let totp_present = totp_confirmed(&conn)?;
        let passkeys_present = has_passkeys(&conn)?;
        self.awaiting_second_factor = totp_present || passkeys_present;

        // If TOTP is enrolled, decrypt its secret into memory for verify().
        if totp_present {
            if let Some((rec, _)) = totp_record(&conn)? {
                let pt = decrypt_secret(&rec)?;
                let s = String::from_utf8(pt.to_vec())
                    .map_err(|e| VaultError::Crypto(format!("totp utf8: {e}")))?;
                self.totp_secret = Some(Zeroizing::new(s));
            }
        }

        self.conn = Some(conn);
        self._key = Some(key);
        Ok(())
    }

    /// Drop the connection and zeroize the key.
    pub fn lock(&mut self) {
        self.conn = None; // closes the SQLCipher connection
        self._key = None; // Zeroizing wipes the key on drop
        self.awaiting_second_factor = false;
        self.totp_secret = None;
    }

    pub fn add_credential(
        &self,
        origin: &str,
        username: &str,
        secret: &str,
        label: &str,
    ) -> VaultResult<String> {
        let conn = self.conn()?;
        let id = new_id();
        let rec = encrypt_secret(secret.as_bytes())?;
        storage::insert_credential(conn, &id, origin, username, label, &rec)?;
        Ok(id)
    }

    pub fn get_credentials(&self, origin: &str) -> VaultResult<Vec<CredentialMeta>> {
        let conn = self.conn()?;
        Ok(storage::list_credentials(conn, Some(origin))?
            .into_iter()
            .map(to_meta)
            .collect())
    }

    pub fn list(&self) -> VaultResult<Vec<CredentialMeta>> {
        let conn = self.conn()?;
        Ok(storage::list_credentials(conn, None)?
            .into_iter()
            .map(to_meta)
            .collect())
    }

    pub fn get_secret(&self, id: &str) -> VaultResult<String> {
        let conn = self.conn()?;
        let rec = storage::load_record(conn, id)?;
        let pt = decrypt_secret(&rec)?;
        storage::audit(conn, "credential.reveal", id)?;
        String::from_utf8(pt.to_vec()).map_err(|e| VaultError::Crypto(format!("utf8: {e}")))
    }

    pub fn delete(&self, id: &str) -> VaultResult<()> {
        let conn = self.conn()?;
        storage::delete_credential(conn, id)
    }

    /// Re-encrypt and replace the secret of an existing credential in place.
    pub fn update_credential(&self, id: &str, secret: &str) -> VaultResult<()> {
        let conn = self.conn()?;
        let rec = encrypt_secret(secret.as_bytes())?;
        storage::update_credential_secret(conn, id, &rec)
    }

    // ---- TOTP ----

    /// Enroll: generate a secret, encrypt + store it (unconfirmed). Returns
    /// the secret/otpauth/QR for the user to scan. Requires full unlock.
    pub fn enroll_totp(&self) -> VaultResult<totp::TotpEnrollment> {
        let conn = self.conn()?;
        let enrollment = totp::generate_enrollment()?;
        let rec = encrypt_secret(enrollment.secret_base32.as_bytes())?;
        put_totp(conn, &rec)?;
        Ok(enrollment)
    }

    /// Confirm enrollment by verifying a code, then mark confirmed.
    pub fn confirm_totp(&self, code: &str) -> VaultResult<bool> {
        let conn = self.conn()?;
        let (rec, _) = totp_record(conn)?.ok_or(VaultError::NotFound("totp".into()))?;
        let pt: Zeroizing<Vec<u8>> = decrypt_secret(&rec)?;
        let secret = Zeroizing::new(
            String::from_utf8(pt.to_vec())
                .map_err(|e| VaultError::Crypto(format!("totp utf8: {e}")))?,
        );
        if !totp::verify(&secret, code)? {
            return Ok(false);
        }
        confirm_totp(conn)?;
        Ok(true)
    }

    /// Second-factor verification during unlock.
    pub fn verify_totp(&mut self, code: &str) -> VaultResult<bool> {
        if !self.awaiting_second_factor {
            return Ok(true);
        }
        let secret = self.totp_secret.as_ref().ok_or(VaultError::Locked)?;
        if totp::verify(secret, code)? {
            self.awaiting_second_factor = false;
            self.totp_secret = None;
            storage::audit(self.conn_preauth()?, "vault.unlock.totp", "")?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    // ---- WebAuthn ----

    pub fn start_webauthn_registration(&self) -> VaultResult<(String, String)> {
        let _ = self.conn()?; // requires full unlock to register a new factor
        webauthn::start_registration()
    }

    pub fn finish_webauthn_registration(&self, response: &str, state: &str) -> VaultResult<()> {
        let conn = self.conn()?;
        let passkey_json = webauthn::finish_registration(response, state)?;
        let id = new_id();
        put_passkey(conn, &id, &passkey_json)?;
        Ok(())
    }

    pub fn start_webauthn_authentication(&self) -> VaultResult<(String, String)> {
        let conn = self.conn_preauth()?;
        let passkeys = list_passkeys(conn)?;
        webauthn::start_authentication(&passkeys)
    }

    pub fn finish_webauthn_authentication(
        &mut self,
        response: &str,
        state: &str,
    ) -> VaultResult<bool> {
        if !self.awaiting_second_factor {
            return Ok(true);
        }
        let ok = webauthn::finish_authentication(response, state)?;
        if ok {
            self.awaiting_second_factor = false;
            storage::audit(self.conn_preauth()?, "vault.unlock.webauthn", "")?;
        }
        Ok(ok)
    }
}

fn to_meta(r: storage::CredentialRow) -> CredentialMeta {
    CredentialMeta {
        id: r.id,
        origin: r.origin,
        username: r.username,
        label: r.label,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

fn new_id() -> String {
    let mut b = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn b64(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD.encode(bytes)
}
fn b64_decode(s: &str) -> VaultResult<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD
        .decode(s)
        .map_err(|e| VaultError::Crypto(format!("b64: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("sb-vault-{}", new_id()));
        d
    }

    #[test]
    fn init_add_lock_reopen_unlock_read_back() {
        let dir = temp_dir();
        let id;
        {
            let mut v = VaultState::new(&dir);
            v.init("master-pw").unwrap();
            id = v
                .add_credential("https://x.com", "alice", "topsecret", "X")
                .unwrap();
            assert_eq!(v.get_secret(&id).unwrap(), "topsecret");
            v.lock();
            assert!(!v.is_unlocked());
            // Locked → operations error, not panic.
            assert!(matches!(v.list(), Err(VaultError::Locked)));
        }
        // Reopen a fresh VaultState pointing at the same dir.
        {
            let mut v = VaultState::new(&dir);
            assert!(v.is_initialized());
            v.unlock("master-pw").unwrap();
            let secret = v.get_secret(&id).unwrap();
            assert_eq!(secret, "topsecret"); // KEM key persisted across reopen
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_credential_replaces_secret_in_place() {
        let dir = temp_dir();
        let mut v = VaultState::new(&dir);
        v.init("master-pw").unwrap();
        let id = v
            .add_credential("https://x.com", "alice", "old-secret", "X")
            .unwrap();
        assert_eq!(v.get_secret(&id).unwrap(), "old-secret");

        v.update_credential(&id, "new-secret").unwrap();
        assert_eq!(v.get_secret(&id).unwrap(), "new-secret");
        // Updated in place — no duplicate row.
        assert_eq!(v.list().unwrap().len(), 1);

        // Updating an unknown id errors cleanly (no silent no-op).
        assert!(matches!(
            v.update_credential("does-not-exist", "x"),
            Err(VaultError::NotFound(_))
        ));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn wrong_password_fails_cleanly() {
        let dir = temp_dir();
        {
            let mut v = VaultState::new(&dir);
            v.init("right-pw").unwrap();
            v.lock();
        }
        let mut v = VaultState::new(&dir);
        assert!(matches!(
            v.unlock("wrong-pw"),
            Err(VaultError::WrongPassword)
        ));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn double_init_is_rejected() {
        let dir = temp_dir();
        let mut v = VaultState::new(&dir);
        v.init("pw").unwrap();
        let mut v2 = VaultState::new(&dir);
        assert!(matches!(v2.init("pw"), Err(VaultError::AlreadyInitialized)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn totp_gates_unlock_after_enrollment() {
        use crate::totp::build_totp;
        let dir = temp_dir();
        let secret_b32;
        {
            let mut v = VaultState::new(&dir);
            v.init("pw").unwrap();
            // No MFA yet → fully unlocked.
            assert!(v.is_unlocked());
            let e = v.enroll_totp().unwrap();
            secret_b32 = e.secret_base32.clone();
            let code = build_totp(&secret_b32).unwrap().generate_current().unwrap();
            assert!(v.confirm_totp(&code).unwrap());
            v.lock();
        }
        {
            let mut v = VaultState::new(&dir);
            v.unlock("pw").unwrap();
            // DB opened, but second factor required.
            assert!(v.awaiting_second_factor());
            assert!(!v.is_unlocked());
            assert!(matches!(v.list(), Err(VaultError::Locked)));

            // Wrong code stays locked.
            assert!(!v.verify_totp("000000").unwrap());
            assert!(!v.is_unlocked());

            // Correct code completes unlock.
            let code = build_totp(&secret_b32).unwrap().generate_current().unwrap();
            assert!(v.verify_totp(&code).unwrap());
            assert!(v.is_unlocked());
            v.list().unwrap();
        }
        std::fs::remove_dir_all(&dir).ok();
    }
}
