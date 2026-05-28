use std::path::{Path, PathBuf};

use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{decrypt_secret, encrypt_secret};
use crate::error::{VaultError, VaultResult};
use crate::kdf::{derive_key, KdfParams};
use crate::storage;

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
}

impl VaultState {
    pub fn new(dir: impl AsRef<Path>) -> Self {
        VaultState { dir: dir.as_ref().to_path_buf(), conn: None, _key: None }
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
        self.conn.is_some()
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
        storage::audit(&conn, "vault.unlock", "")?;
        self.conn = Some(conn);
        self._key = Some(key);
        Ok(())
    }

    /// Drop the connection and zeroize the key.
    pub fn lock(&mut self) {
        self.conn = None; // closes the SQLCipher connection
        self._key = None; // Zeroizing wipes the key on drop
    }

    fn conn(&self) -> VaultResult<&Connection> {
        self.conn.as_ref().ok_or(VaultError::Locked)
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
    STANDARD.decode(s).map_err(|e| VaultError::Crypto(format!("b64: {e}")))
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
            id = v.add_credential("https://x.com", "alice", "topsecret", "X").unwrap();
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
    fn wrong_password_fails_cleanly() {
        let dir = temp_dir();
        {
            let mut v = VaultState::new(&dir);
            v.init("right-pw").unwrap();
            v.lock();
        }
        let mut v = VaultState::new(&dir);
        assert!(matches!(v.unlock("wrong-pw"), Err(VaultError::WrongPassword)));
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
}
