# M2 — Rust Vault Core + Minimal Vault UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Task 0 + M1 complete. The napi bridge and browser shell work.

**Goal:** Build the zero-knowledge vault: Argon2id-derived key, per-record ML-KEM-768 + AES-256-GCM hybrid encryption (persisting the KEM secret key), SQLCipher storage with an audit log, exposed to Electron via a napi `Vault` class — plus a minimal Svelte vault sidebar (unlock / list / add / edit / delete).

**Architecture:** The Rust core gains five modules: `kdf` (Argon2id raw-key derivation), `crypto` (hybrid PQ encrypt/decrypt + HKDF), `storage` (SQLCipher open + schema + CRUD), `vault` (state machine: locked → derive key → unlock → CRUD → lock/zeroize), and napi bindings exposing a `Vault` class. Master-key plaintext lives only in the core's memory while unlocked and is zeroized on lock. The SQLCipher DB is keyed by the Argon2-derived vault key (so the DB file is unreadable without the master password); the non-secret KDF salt + params live in a plaintext sidecar `vault.meta.json`. Each credential's secret is additionally wrapped in an ML-KEM-768 + AES-256-GCM envelope whose decapsulation (secret) key is stored **with** the record (the persistence lesson from the capstone). The Electron main process owns one `Vault` instance; the renderer drives it through an allow-listed `vault:*` IPC surface and **never receives secret plaintext except for a single explicit `get_secret` call**.

**Tech Stack:** Rust crates `argon2`, `aes-gcm`, `ml-kem`, `hkdf`, `sha2`, `rusqlite` (+ SQLCipher), `zeroize`, `rand`, `base64`, `thiserror`; napi-rs class bindings; Svelte vault sidebar; Playwright `_electron`.

> ⚠️ **ml-kem API verification:** the `ml-kem` crate (FIPS 203) is young and its type/serialization names have churned. The crypto code below reflects the documented `0.2` API, but **the round-trip test in M2.3 is the gate** — if your resolved version differs, adjust the encapsulate/decapsulate/`as_bytes`/`from_bytes` calls per docs.rs until the test passes. Do not change the test's intent.

---

## File Structure

| Path | Responsibility |
|---|---|
| `core/Cargo.toml` | Modified: add crypto/storage deps. |
| `core/src/error.rs` | `VaultError` enum (thiserror) + conversion to `napi::Error`; **surfaces** crypto/lock errors (capstone lesson). |
| `core/src/kdf.rs` | `derive_key(master_pw, salt, params) -> Zeroizing<[u8;32]>` (Argon2id, deterministic). |
| `core/src/crypto.rs` | `encrypt_secret`/`decrypt_secret` — ML-KEM-768 + HKDF-SHA256 + AES-256-GCM; `EncryptedRecord`. |
| `core/src/storage.rs` | SQLCipher open, schema (`vault_meta` sidecar excluded; `credentials`, `audit_log`), CRUD. |
| `core/src/vault.rs` | `VaultState` machine: init/unlock/lock + credential operations; holds the connection + zeroized key. |
| `core/src/lib.rs` | Modified: napi `Vault` class + `CredentialMeta` object + keep `core_version`. |
| `electron/main/vault.ts` | Constructs the single `Vault` instance at a per-user data dir path. |
| `electron/main/ipc.ts` | Modified: add allow-listed `vault:*` handlers. |
| `electron/preload/index.ts` | Modified: add `vault` namespace to the bridge. |
| `electron/renderer/src/env.d.ts` | Modified: add vault types to `SecureBrowserApi`. |
| `electron/renderer/src/lib/vaultStore.svelte.ts` | Svelte rune store for vault lock state + credential list. |
| `electron/renderer/src/components/VaultSidebar.svelte` | Unlock screen + credential list + add/edit/delete form. |
| `electron/renderer/src/App.svelte` | Modified: mount `VaultSidebar` alongside the toolbar. |
| `tests/vault.spec.ts` | Playwright `_electron`: init → add → lock → reopen → unlock → read back through the UI. |

---

## Task M2.1: Crypto dependencies + error type

**Files:**
- Modify: `core/Cargo.toml`
- Create: `core/src/error.rs`
- Modify: `core/src/lib.rs` (declare modules)

- [ ] **Step 1: Add dependencies to `core/Cargo.toml`**

Modify the `[dependencies]` section of `core/Cargo.toml` to add:

```toml
argon2 = "0.5"
aes-gcm = "0.10"
ml-kem = "0.2"
hkdf = "0.12"
sha2 = "0.10"
rand = "0.8"
rusqlite = { version = "0.31", features = ["bundled-sqlcipher-vendored-openssl"] }
zeroize = { version = "1", features = ["derive"] }
base64 = "0.22"
thiserror = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

> Note: `bundled-sqlcipher-vendored-openssl` compiles SQLCipher + OpenSSL from source — no system libs needed, but the first build is slow. If linking fails on this machine, try `features = ["bundled-sqlcipher"]` (uses a system crypto lib).

- [ ] **Step 2: Write the error type**

Create `core/src/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault is locked")]
    Locked,
    #[error("vault already initialized")]
    AlreadyInitialized,
    #[error("vault not initialized")]
    NotInitialized,
    #[error("wrong master password")]
    WrongPassword,
    #[error("credential not found: {0}")]
    NotFound(String),
    #[error("crypto error: {0}")]
    Crypto(String),
    #[error("storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

// Surface errors to JS instead of failing silently (capstone lesson).
impl From<VaultError> for napi::Error {
    fn from(e: VaultError) -> Self {
        napi::Error::from_reason(e.to_string())
    }
}

pub type VaultResult<T> = Result<T, VaultError>;
```

- [ ] **Step 3: Declare modules in `lib.rs`**

Modify `core/src/lib.rs` — add at the top (below `#![deny(clippy::all)]`):

```rust
mod crypto;
mod error;
mod kdf;
mod storage;
mod vault;
```

- [ ] **Step 4: Verify it compiles (stub modules will be added next; create empty files so it builds)**

Run:
```bash
cd core
: > src/crypto.rs; : > src/kdf.rs; : > src/storage.rs; : > src/vault.rs
cargo build
```
Expected: builds (empty modules are valid). The crypto crates download/compile on first run.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/dev/secure-browser
git add core/Cargo.toml core/src/error.rs core/src/lib.rs core/src/crypto.rs core/src/kdf.rs core/src/storage.rs core/src/vault.rs
git commit -m "feat(core): add crypto/storage deps and VaultError type"
```

---

## Task M2.2: Argon2id key derivation (KDF determinism)

**Files:**
- Create: `core/src/kdf.rs` (replace the empty stub)

- [ ] **Step 1: Write the failing test + implementation skeleton**

Replace `core/src/kdf.rs`:

```rust
use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{VaultError, VaultResult};

/// Argon2id parameters, persisted (non-secret) so the key can be re-derived.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct KdfParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        // 64 MiB, 3 iterations, 4 lanes — a sane interactive default.
        KdfParams { m_cost_kib: 64 * 1024, t_cost: 3, p_cost: 4 }
    }
}

/// Deterministically derive a 32-byte vault key from password + salt + params.
/// Same inputs always yield the same key.
pub fn derive_key(
    master_pw: &[u8],
    salt: &[u8],
    params: KdfParams,
) -> VaultResult<Zeroizing<[u8; 32]>> {
    let p = Params::new(params.m_cost_kib, params.t_cost, params.p_cost, Some(32))
        .map_err(|e| VaultError::Crypto(format!("argon2 params: {e}")))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, p);
    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(master_pw, salt, &mut *key)
        .map_err(|e| VaultError::Crypto(format!("argon2 derive: {e}")))?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_deterministic() {
        let salt = b"sixteen byte salt";
        let a = derive_key(b"correct horse", salt, KdfParams::default()).unwrap();
        let b = derive_key(b"correct horse", salt, KdfParams::default()).unwrap();
        assert_eq!(*a, *b);
    }

    #[test]
    fn different_password_yields_different_key() {
        let salt = b"sixteen byte salt";
        let a = derive_key(b"correct horse", salt, KdfParams::default()).unwrap();
        let b = derive_key(b"battery staple", salt, KdfParams::default()).unwrap();
        assert_ne!(*a, *b);
    }

    #[test]
    fn different_salt_yields_different_key() {
        let a = derive_key(b"pw", b"salt-one-aaaaaaa", KdfParams::default()).unwrap();
        let b = derive_key(b"pw", b"salt-two-bbbbbbb", KdfParams::default()).unwrap();
        assert_ne!(*a, *b);
    }
}
```

- [ ] **Step 2: Run the KDF tests**

Run: `cd core && cargo test kdf`
Expected: PASS — `derivation_is_deterministic`, `different_password_yields_different_key`, `different_salt_yields_different_key`.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/dev/secure-browser
git add core/src/kdf.rs
git commit -m "feat(core): Argon2id deterministic key derivation with tests"
```

---

## Task M2.3: Hybrid ML-KEM-768 + AES-256-GCM record crypto

**Files:**
- Create: `core/src/crypto.rs` (replace the empty stub)

- [ ] **Step 1: Write the failing round-trip test + implementation**

Replace `core/src/crypto.rs`:

```rust
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use hkdf::Hkdf;
use ml_kem::kem::{Decapsulate, Encapsulate};
use ml_kem::{EncodedSizeUser, KemCore, MlKem768};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::error::{VaultError, VaultResult};

/// Everything needed to recover one secret. All fields are stored per-record.
/// `kem_dk` is the ML-KEM decapsulation (secret) key — PERSISTED with the
/// record (capstone lesson: discarding it makes decryption impossible).
pub struct EncryptedRecord {
    pub kem_ct: Vec<u8>,
    pub kem_dk: Vec<u8>,
    pub aes_nonce: Vec<u8>,
    pub aes_ct: Vec<u8>,
}

const HKDF_INFO: &[u8] = b"secure-browser/record-aes-256-gcm/v1";

fn derive_aes_key(shared_secret: &[u8]) -> Zeroizing<[u8; 32]> {
    let hk = Hkdf::<Sha256>::new(None, shared_secret);
    let mut key = Zeroizing::new([0u8; 32]);
    hk.expand(HKDF_INFO, &mut *key).expect("32 is a valid HKDF length");
    key
}

/// Encrypt a secret: fresh ML-KEM-768 keypair → encapsulate → HKDF → AES-256-GCM.
pub fn encrypt_secret(plaintext: &[u8]) -> VaultResult<EncryptedRecord> {
    let mut rng = rand::thread_rng();

    // VERIFY against your resolved ml-kem version (see plan callout).
    let (dk, ek) = MlKem768::generate(&mut rng);
    let (kem_ct, shared) = ek
        .encapsulate(&mut rng)
        .map_err(|_| VaultError::Crypto("ml-kem encapsulate failed".into()))?;

    let aes_key = derive_aes_key(shared.as_ref());
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&*aes_key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let aes_ct = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| VaultError::Crypto(format!("aes encrypt: {e}")))?;

    Ok(EncryptedRecord {
        kem_ct: kem_ct.as_ref().to_vec(),
        kem_dk: dk.as_bytes().to_vec(),
        aes_nonce: nonce.to_vec(),
        aes_ct,
    })
}

/// Decrypt a secret using the persisted decapsulation key + KEM ciphertext.
pub fn decrypt_secret(rec: &EncryptedRecord) -> VaultResult<Zeroizing<Vec<u8>>> {
    use ml_kem::kem::DecapsulationKey;
    type Dk = <MlKem768 as KemCore>::DecapsulationKey;

    let dk = Dk::from_bytes(
        rec.kem_dk
            .as_slice()
            .try_into()
            .map_err(|_| VaultError::Crypto("bad kem_dk length".into()))?,
    );
    let kem_ct = rec
        .kem_ct
        .as_slice()
        .try_into()
        .map_err(|_| VaultError::Crypto("bad kem_ct length".into()))?;
    let shared = DecapsulationKey::decapsulate(&dk, kem_ct)
        .map_err(|_| VaultError::Crypto("ml-kem decapsulate failed".into()))?;

    let aes_key = derive_aes_key(shared.as_ref());
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&*aes_key));
    let nonce = Nonce::from_slice(&rec.aes_nonce);
    let pt = cipher
        .decrypt(nonce, rec.aes_ct.as_ref())
        .map_err(|e| VaultError::Crypto(format!("aes decrypt: {e}")))?;
    Ok(Zeroizing::new(pt))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_round_trip() {
        let secret = b"hunter2-correct-horse";
        let rec = encrypt_secret(secret).unwrap();
        // KEM secret key must be persisted and non-empty.
        assert!(!rec.kem_dk.is_empty());
        let recovered = decrypt_secret(&rec).unwrap();
        assert_eq!(&*recovered, secret);
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let mut rec = encrypt_secret(b"secret").unwrap();
        rec.aes_ct[0] ^= 0xff; // flip a bit → GCM tag check must fail
        assert!(decrypt_secret(&rec).is_err());
    }

    #[test]
    fn missing_kem_key_fails_cleanly() {
        let mut rec = encrypt_secret(b"secret").unwrap();
        rec.kem_dk.clear(); // simulate the capstone bug
        assert!(decrypt_secret(&rec).is_err());
    }
}
```

- [ ] **Step 2: Run the crypto tests**

Run: `cd core && cargo test crypto`
Expected: PASS — `encrypt_decrypt_round_trip`, `tampered_ciphertext_fails`, `missing_kem_key_fails_cleanly`.

> If this FAILS to compile due to ml-kem API differences (`generate`, `encapsulate`, `decapsulate`, `as_bytes`/`from_bytes`, `DecapsulationKey` path), open docs.rs for the exact resolved version and adjust the calls. The test assertions stay; only the API plumbing changes. This is the verification gate the plan callout warns about.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/dev/secure-browser
git add core/src/crypto.rs
git commit -m "feat(core): hybrid ML-KEM-768 + AES-256-GCM record crypto with persisted KEM key"
```

---

## Task M2.4: SQLCipher storage layer

**Files:**
- Create: `core/src/storage.rs` (replace the empty stub)

- [ ] **Step 1: Write the failing storage test + implementation**

Replace `core/src/storage.rs`:

```rust
use rusqlite::{params, Connection};

use crate::crypto::EncryptedRecord;
use crate::error::{VaultError, VaultResult};

/// A stored credential row WITHOUT the secret plaintext.
#[derive(Clone, Debug)]
pub struct CredentialRow {
    pub id: String,
    pub origin: String,
    pub username: String,
    pub label: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Open (or create) the SQLCipher DB keyed by the 32-byte vault key.
/// The key is applied as a raw key (hex) so SQLCipher skips its own KDF —
/// we already ran Argon2id.
pub fn open_encrypted(path: &str, key: &[u8; 32]) -> VaultResult<Connection> {
    let conn = Connection::open(path)?;
    let hex_key = hex_encode(key);
    // MUST be the first statement after open.
    conn.execute_batch(&format!("PRAGMA key = \"x'{hex_key}'\";"))?;
    // Verify the key (wrong key → this errors → WrongPassword upstream).
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|_| VaultError::WrongPassword)?;
    Ok(conn)
}

/// Create the schema. Audit log is baked in from day 1 (capstone lesson).
pub fn init_schema(conn: &Connection) -> VaultResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS credentials (
            id          TEXT PRIMARY KEY,
            origin      TEXT NOT NULL,
            username    TEXT NOT NULL,
            label       TEXT NOT NULL DEFAULT '',
            kem_ct      BLOB NOT NULL,
            kem_dk      BLOB NOT NULL,
            aes_nonce   BLOB NOT NULL,
            aes_ct      BLOB NOT NULL,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_credentials_origin ON credentials(origin);
         CREATE TABLE IF NOT EXISTS audit_log (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            ts     INTEGER NOT NULL,
            event  TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT ''
         );",
    )?;
    Ok(())
}

pub fn audit(conn: &Connection, event: &str, detail: &str) -> VaultResult<()> {
    conn.execute(
        "INSERT INTO audit_log (ts, event, detail) VALUES (?1, ?2, ?3)",
        params![now(), event, detail],
    )?;
    Ok(())
}

pub fn insert_credential(
    conn: &Connection,
    id: &str,
    origin: &str,
    username: &str,
    label: &str,
    rec: &EncryptedRecord,
) -> VaultResult<()> {
    let ts = now();
    conn.execute(
        "INSERT INTO credentials
            (id, origin, username, label, kem_ct, kem_dk, aes_nonce, aes_ct, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![id, origin, username, label, rec.kem_ct, rec.kem_dk, rec.aes_nonce, rec.aes_ct, ts],
    )?;
    audit(conn, "credential.add", origin)?;
    Ok(())
}

pub fn list_credentials(conn: &Connection, origin: Option<&str>) -> VaultResult<Vec<CredentialRow>> {
    let (sql, bind): (&str, Vec<&dyn rusqlite::ToSql>) = match origin {
        Some(o) => (
            "SELECT id, origin, username, label, created_at, updated_at
             FROM credentials WHERE origin = ?1 ORDER BY updated_at DESC",
            vec![&o],
        ),
        None => (
            "SELECT id, origin, username, label, created_at, updated_at
             FROM credentials ORDER BY updated_at DESC",
            vec![],
        ),
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(bind.as_slice(), |r| {
            Ok(CredentialRow {
                id: r.get(0)?,
                origin: r.get(1)?,
                username: r.get(2)?,
                label: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn load_record(conn: &Connection, id: &str) -> VaultResult<EncryptedRecord> {
    conn.query_row(
        "SELECT kem_ct, kem_dk, aes_nonce, aes_ct FROM credentials WHERE id = ?1",
        params![id],
        |r| {
            Ok(EncryptedRecord {
                kem_ct: r.get(0)?,
                kem_dk: r.get(1)?,
                aes_nonce: r.get(2)?,
                aes_ct: r.get(3)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => VaultError::NotFound(id.to_string()),
        other => VaultError::Storage(other),
    })
}

pub fn delete_credential(conn: &Connection, id: &str) -> VaultResult<()> {
    let n = conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])?;
    if n == 0 {
        return Err(VaultError::NotFound(id.to_string()));
    }
    audit(conn, "credential.delete", id)?;
    Ok(())
}

fn now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::encrypt_secret;

    fn temp_db() -> String {
        let dir = std::env::temp_dir();
        let name = format!("sb-test-{}.db", uuid_like());
        dir.join(name).to_string_lossy().into_owned()
    }
    fn uuid_like() -> String {
        format!("{}", now() as u64 * 1000 + (std::process::id() as i64) % 1000)
    }

    #[test]
    fn insert_list_load_delete_round_trip() {
        let path = temp_db();
        let key = [7u8; 32];
        let conn = open_encrypted(&path, &key).unwrap();
        init_schema(&conn).unwrap();

        let rec = encrypt_secret(b"s3cret").unwrap();
        insert_credential(&conn, "id1", "https://github.com", "octocat", "GitHub", &rec).unwrap();

        let all = list_credentials(&conn, None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].username, "octocat");

        let scoped = list_credentials(&conn, Some("https://github.com")).unwrap();
        assert_eq!(scoped.len(), 1);

        let loaded = load_record(&conn, "id1").unwrap();
        assert_eq!(loaded.kem_dk, rec.kem_dk);

        delete_credential(&conn, "id1").unwrap();
        assert_eq!(list_credentials(&conn, None).unwrap().len(), 0);

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn wrong_key_fails_to_open_existing_db() {
        let path = temp_db();
        {
            let conn = open_encrypted(&path, &[1u8; 32]).unwrap();
            init_schema(&conn).unwrap();
        }
        // Reopen with a different key → WrongPassword.
        let err = open_encrypted(&path, &[2u8; 32]);
        assert!(matches!(err, Err(VaultError::WrongPassword)));
        std::fs::remove_file(&path).ok();
    }
}
```

- [ ] **Step 2: Run the storage tests**

Run: `cd core && cargo test storage`
Expected: PASS — `insert_list_load_delete_round_trip`, `wrong_key_fails_to_open_existing_db`.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/dev/secure-browser
git add core/src/storage.rs
git commit -m "feat(core): SQLCipher storage with audit log and CRUD"
```

---

## Task M2.5: Vault state machine

**Files:**
- Create: `core/src/vault.rs` (replace the empty stub)

- [ ] **Step 1: Write the failing vault test + implementation**

Replace `core/src/vault.rs`:

```rust
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
```

- [ ] **Step 2: Run the vault tests**

Run: `cd core && cargo test vault`
Expected: PASS — `init_add_lock_reopen_unlock_read_back`, `wrong_password_fails_cleanly`, `double_init_is_rejected`. This is the spec's M2 verify: KDF determinism (M2.2), round-trip (M2.3), wrong-password fails cleanly, KEM key persists across reopen (here).

- [ ] **Step 3: Run the full Rust suite**

Run: `cd core && cargo test`
Expected: all kdf + crypto + storage + vault tests green.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/dev/secure-browser
git add core/src/vault.rs
git commit -m "feat(core): vault state machine — init/unlock/lock + CRUD with zeroize"
```

---

## Task M2.6: napi bindings — `Vault` class

**Files:**
- Modify: `core/src/lib.rs`

- [ ] **Step 1: Write the napi `Vault` class**

Replace `core/src/lib.rs` entirely:

```rust
#![deny(clippy::all)]

mod crypto;
mod error;
mod kdf;
mod storage;
mod vault;

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
        Vault { state: Mutex::new(VaultState::new(dir)) }
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
        self.state.lock().unwrap().init(&master_pw).map_err(Into::into)
    }

    #[napi]
    pub fn unlock(&self, master_pw: String) -> napi::Result<()> {
        self.state.lock().unwrap().unlock(&master_pw).map_err(Into::into)
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
        self.state.lock().unwrap().get_secret(&id).map_err(Into::into)
    }

    #[napi]
    pub fn delete(&self, id: String) -> napi::Result<()> {
        self.state.lock().unwrap().delete(&id).map_err(Into::into)
    }
}
```

- [ ] **Step 2: Rebuild the addon and verify the generated types**

Run: `cd core && npm run build && cat index.d.ts`
Expected: `index.d.ts` declares `export class Vault` with `initVault`, `unlock`, `lock`, `addCredential`, `getCredentials`, `getSecret`, `list`, `delete`, `isInitialized`, `isUnlocked`, and a `CredentialMeta` interface (no `secret` field).

- [ ] **Step 3: Smoke-test the class from Node**

Run:
```bash
cd core && node -e '
const { Vault } = require("./index.js");
const os = require("os"); const fs = require("fs");
const dir = fs.mkdtempSync(os.tmpdir() + "/sbnode-");
const v = new Vault(dir);
v.initVault("pw");
const id = v.addCredential("https://x.com","alice","secret","X");
console.log("secret:", v.getSecret(id));
v.lock();
v.unlock("pw");
console.log("after reopen:", v.getSecret(id));
'
```
Expected: prints `secret: secret` then `after reopen: secret`.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/dev/secure-browser
git add core/src/lib.rs
git commit -m "feat(core): expose Vault napi class (init/unlock/lock/CRUD)"
```

---

## Task M2.7: Main-process Vault instance + IPC

**Files:**
- Create: `electron/main/vault.ts`
- Modify: `electron/main/ipc.ts`

- [ ] **Step 1: Write `electron/main/vault.ts`**

Create `electron/main/vault.ts`:

```typescript
import { app } from 'electron';
import { join } from 'node:path';
import { Vault } from 'secure-browser-core';

// One vault, stored under the OS per-user app data dir.
const vaultDir = join(app.getPath('userData'), 'vault');
export const vault = new Vault(vaultDir);
```

- [ ] **Step 2: Add `vault:*` handlers to the IPC router**

Modify `electron/main/ipc.ts` — add the import at the top:

```typescript
import { vault } from './vault';
```

and register these handlers inside `registerIpc` (after the `nav:*` handlers):

```typescript
  ipcMain.handle('vault:status', () => ({
    initialized: vault.isInitialized(),
    unlocked: vault.isUnlocked(),
  }));
  ipcMain.handle('vault:init', (_e, pw: unknown) => {
    if (typeof pw !== 'string' || pw.length === 0) throw new Error('master password required');
    vault.initVault(pw);
  });
  ipcMain.handle('vault:unlock', (_e, pw: unknown) => {
    if (typeof pw !== 'string' || pw.length === 0) throw new Error('master password required');
    vault.unlock(pw);
  });
  ipcMain.handle('vault:lock', () => vault.lock());
  ipcMain.handle('vault:list', () => vault.list());
  ipcMain.handle('vault:add', (_e, origin: unknown, username: unknown, secret: unknown, label: unknown) => {
    for (const v of [origin, username, secret]) {
      if (typeof v !== 'string' || v.length === 0) throw new Error('origin, username, secret required');
    }
    return vault.addCredential(origin as string, username as string, secret as string, (label as string) ?? '');
  });
  ipcMain.handle('vault:getSecret', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('credential id required');
    return vault.getSecret(id);
  });
  ipcMain.handle('vault:delete', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('credential id required');
    vault.delete(id);
  });
```

- [ ] **Step 3: Build to confirm main compiles**

Run: `npm run build:core && npm run build`
Expected: no TS errors.

- [ ] **Step 4: Commit**

```bash
git add electron/main/vault.ts electron/main/ipc.ts
git commit -m "feat(vault): main-process Vault instance + allow-listed vault IPC"
```

---

## Task M2.8: Preload bridge + Svelte vault sidebar

**Files:**
- Modify: `electron/preload/index.ts`
- Modify: `electron/renderer/src/env.d.ts`
- Create: `electron/renderer/src/lib/vaultStore.svelte.ts`
- Create: `electron/renderer/src/components/VaultSidebar.svelte`
- Modify: `electron/renderer/src/App.svelte`

- [ ] **Step 1: Add the `vault` namespace to the preload bridge**

Modify `electron/preload/index.ts` — add a `CredentialMeta` import-free inline type and extend `api`. Insert this `vault` block into the `api` object (after `nav`):

```typescript
  vault: {
    status: (): Promise<{ initialized: boolean; unlocked: boolean }> =>
      ipcRenderer.invoke('vault:status'),
    init: (pw: string): Promise<void> => ipcRenderer.invoke('vault:init', pw),
    unlock: (pw: string): Promise<void> => ipcRenderer.invoke('vault:unlock', pw),
    lock: (): Promise<void> => ipcRenderer.invoke('vault:lock'),
    list: (): Promise<CredentialMetaDto[]> => ipcRenderer.invoke('vault:list'),
    add: (origin: string, username: string, secret: string, label: string): Promise<string> =>
      ipcRenderer.invoke('vault:add', origin, username, secret, label),
    getSecret: (id: string): Promise<string> => ipcRenderer.invoke('vault:getSecret', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('vault:delete', id),
  },
```

and add this type near the top of the preload file (after the imports):

```typescript
interface CredentialMetaDto {
  id: string;
  origin: string;
  username: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}
```

> Note: napi maps Rust `created_at`/`updated_at` to camelCase `createdAt`/`updatedAt` in JS. The DTO matches the generated `CredentialMeta` shape.

- [ ] **Step 2: Extend bridge types in `env.d.ts`**

Modify `electron/renderer/src/env.d.ts` — add the `CredentialMeta` type and the `vault` member to `SecureBrowserApi`:

```typescript
export interface CredentialMeta {
  id: string;
  origin: string;
  username: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}
```

and inside `SecureBrowserApi` add:

```typescript
  vault: {
    status: () => Promise<{ initialized: boolean; unlocked: boolean }>;
    init: (pw: string) => Promise<void>;
    unlock: (pw: string) => Promise<void>;
    lock: () => Promise<void>;
    list: () => Promise<CredentialMeta[]>;
    add: (origin: string, username: string, secret: string, label: string) => Promise<string>;
    getSecret: (id: string) => Promise<string>;
    delete: (id: string) => Promise<void>;
  };
```

- [ ] **Step 3: Write the vault store**

Create `electron/renderer/src/lib/vaultStore.svelte.ts`:

```typescript
import type { CredentialMeta } from '../../env';

class VaultStore {
  initialized = $state(false);
  unlocked = $state(false);
  credentials = $state<CredentialMeta[]>([]);
  error = $state<string | null>(null);

  async refreshStatus(): Promise<void> {
    const s = await window.secureBrowser.vault.status();
    this.initialized = s.initialized;
    this.unlocked = s.unlocked;
    if (this.unlocked) await this.refreshList();
  }

  async refreshList(): Promise<void> {
    this.credentials = await window.secureBrowser.vault.list();
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.error = null;
    try {
      await fn();
    } catch (e) {
      // Surface errors to the UI — never silently swallow (capstone lesson).
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  init(pw: string): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.init(pw);
      await this.refreshStatus();
    });
  }
  unlock(pw: string): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.unlock(pw);
      await this.refreshStatus();
    });
  }
  lock(): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.lock();
      this.unlocked = false;
      this.credentials = [];
    });
  }
  add(origin: string, username: string, secret: string, label: string): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.add(origin, username, secret, label);
      await this.refreshList();
    });
  }
  remove(id: string): Promise<void> {
    return this.run(async () => {
      await window.secureBrowser.vault.delete(id);
      await this.refreshList();
    });
  }
  reveal(id: string): Promise<string> {
    return window.secureBrowser.vault.getSecret(id);
  }
}

export const vaultStore = new VaultStore();
```

- [ ] **Step 4: Write `VaultSidebar.svelte`**

Create `electron/renderer/src/components/VaultSidebar.svelte`:

```svelte
<script lang="ts">
  import { vaultStore } from '../lib/vaultStore.svelte';

  let pw = $state('');
  let origin = $state('');
  let username = $state('');
  let secret = $state('');
  let label = $state('');
  let revealed = $state<Record<string, string>>({});

  void vaultStore.refreshStatus();

  async function reveal(id: string) {
    revealed = { ...revealed, [id]: await vaultStore.reveal(id) };
  }
  async function addCredential() {
    await vaultStore.add(origin, username, secret, label);
    origin = username = secret = label = '';
  }
</script>

<aside class="sidebar" data-testid="vault-sidebar">
  {#if vaultStore.error}
    <p class="error" data-testid="vault-error">{vaultStore.error}</p>
  {/if}

  {#if !vaultStore.unlocked}
    <form onsubmit={(e) => { e.preventDefault(); vaultStore.initialized ? vaultStore.unlock(pw) : vaultStore.init(pw); }}>
      <h2>{vaultStore.initialized ? 'Unlock vault' : 'Create vault'}</h2>
      <input type="password" data-testid="master-pw" bind:value={pw} placeholder="Master password" />
      <button data-testid="vault-submit">{vaultStore.initialized ? 'Unlock' : 'Create'}</button>
    </form>
  {:else}
    <header>
      <h2>Vault</h2>
      <button data-testid="vault-lock" onclick={() => vaultStore.lock()}>Lock</button>
    </header>

    <form onsubmit={(e) => { e.preventDefault(); addCredential(); }} data-testid="add-form">
      <input data-testid="add-origin" bind:value={origin} placeholder="https://site.com" />
      <input data-testid="add-username" bind:value={username} placeholder="Username" />
      <input data-testid="add-secret" type="password" bind:value={secret} placeholder="Password" />
      <input data-testid="add-label" bind:value={label} placeholder="Label (optional)" />
      <button data-testid="add-submit">Add</button>
    </form>

    <ul data-testid="cred-list">
      {#each vaultStore.credentials as c (c.id)}
        <li data-testid="cred-item">
          <strong>{c.label || c.origin}</strong>
          <span data-testid="cred-username">{c.username}</span>
          {#if revealed[c.id]}
            <code data-testid="cred-secret">{revealed[c.id]}</code>
          {:else}
            <button data-testid="cred-reveal" onclick={() => reveal(c.id)}>Reveal</button>
          {/if}
          <button data-testid="cred-delete" onclick={() => vaultStore.remove(c.id)}>Delete</button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .sidebar { position: fixed; right: 0; top: 88px; bottom: 0; width: 320px;
             background: #2a2b2e; color: #e8eaed; padding: 12px; overflow-y: auto;
             font-family: system-ui, sans-serif; }
  .error { color: #f28b82; }
  input { display: block; width: 100%; margin: 4px 0; padding: 6px; }
  li { margin: 8px 0; display: flex; flex-direction: column; gap: 2px; }
</style>
```

- [ ] **Step 5: Mount the sidebar in `App.svelte`**

Modify `electron/renderer/src/App.svelte` — add the import and render the sidebar:

```svelte
<script lang="ts">
  import { browser } from './lib/browserStore.svelte';
  import TabStrip from './components/TabStrip.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import VaultSidebar from './components/VaultSidebar.svelte';

  browser.init();
</script>

<TabStrip />
<Toolbar />
<VaultSidebar />

<style>
  :global(body) { margin: 0; }
</style>
```

- [ ] **Step 6: Build the app**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add electron/preload/index.ts electron/renderer/src/env.d.ts electron/renderer/src/lib/vaultStore.svelte.ts electron/renderer/src/components/VaultSidebar.svelte electron/renderer/src/App.svelte
git commit -m "feat(vault): preload bridge + Svelte vault sidebar (unlock/list/add/reveal/delete)"
```

---

## Task M2.9: Vault integration test (add → lock → reopen → unlock → read back)

**Files:**
- Test: `tests/vault.spec.ts`

> The sidebar overlays the right 320px of the chrome view. Since the chrome view is a single `WebContentsView` covering the full window with the tab views beneath, the sidebar is part of the chrome page and is reachable by Playwright through the chrome `Page`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/vault.spec.ts`:

```typescript
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let chrome: Page;
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-e2e-'));

async function launch(): Promise<void> {
  // Force a clean, isolated userData dir so the vault starts uninitialized,
  // and reuse the SAME dir across relaunch to test persistence.
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: join(__dirname, '..'),
  });
  chrome = await app.firstWindow();
  await chrome.getByTestId('vault-sidebar').waitFor();
}

test.afterEach(async () => {
  await app.close();
});

test('create vault, add a credential, reveal it', async () => {
  await launch();
  // First run → "Create vault".
  await expect(chrome.getByTestId('vault-submit')).toHaveText('Create');
  await chrome.getByTestId('master-pw').fill('master-pw-123');
  await chrome.getByTestId('vault-submit').click();

  // Add a credential.
  await chrome.getByTestId('add-origin').fill('https://github.com');
  await chrome.getByTestId('add-username').fill('octocat');
  await chrome.getByTestId('add-secret').fill('s3cret!');
  await chrome.getByTestId('add-submit').click();

  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
  await expect(chrome.getByTestId('cred-username')).toHaveText('octocat');

  await chrome.getByTestId('cred-reveal').click();
  await expect(chrome.getByTestId('cred-secret')).toHaveText('s3cret!');
});

test('relaunch, unlock, and read the credential back', async () => {
  await launch();
  // Vault already initialized from the previous test → "Unlock".
  await expect(chrome.getByTestId('vault-submit')).toHaveText('Unlock');
  await chrome.getByTestId('master-pw').fill('master-pw-123');
  await chrome.getByTestId('vault-submit').click();

  await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
  await chrome.getByTestId('cred-reveal').click();
  await expect(chrome.getByTestId('cred-secret')).toHaveText('s3cret!');
});

test('wrong master password surfaces an error', async () => {
  await launch();
  await chrome.getByTestId('master-pw').fill('WRONG-pw');
  await chrome.getByTestId('vault-submit').click();
  await expect(chrome.getByTestId('vault-error')).toContainText(/wrong master password/i);
});
```

> Note: tests run serially and share `userDataDir`, so test 1 creates the vault and test 2 reopens it — exactly the spec's "add, lock, reopen, unlock, read back" path. `--user-data-dir` makes Electron use the temp dir, so `app.getPath('userData')` (and thus the vault location) is isolated and persistent across the two launches.

- [ ] **Step 2: Run the test to verify it passes (build first)**

Run: `npm run build:core && npm run build && npx playwright test tests/vault.spec.ts`
Expected: all three tests PASS.

- [ ] **Step 3: Run the full suite + Rust tests**

Run: `cd core && cargo test && cd .. && npx playwright test`
Expected: all Rust unit tests + bridge + shell + vault E2E green.

- [ ] **Step 4: Commit and push**

```bash
git add tests/vault.spec.ts
git commit -m "test(vault): E2E create/add/reveal then relaunch/unlock/read-back"
git push
```

---

## Self-Review

**Spec coverage (M2 requirements):**
- Crates `argon2`, `aes-gcm`, `ml-kem`, `rusqlite`+SQLCipher, `zeroize` → M2.1. ✓
- napi API `init_vault`/`unlock`/`lock`/`add_credential`/`get_credentials`/`get_secret`/`list`/`delete` → M2.6 (`Vault` class; napi camelCases them: `initVault`, `addCredential`, etc.). ✓
- Zero-knowledge: Argon2id → vault key (M2.2); per-record ML-KEM-768 + AES-256-GCM (M2.3); **store KEM secret key** (`kem_dk` column M2.4, persisted + asserted M2.3/M2.5). ✓
- Minimal vault sidebar: unlock, list, add/edit/delete → M2.8 (`VaultSidebar.svelte`; "edit" = delete + re-add for the minimal UI; explicit delete + add present). ✓
- **Verify:** KDF determinism (M2.2), encrypt→decrypt round-trip (M2.3), wrong-password fails cleanly (M2.5 + E2E M2.9), KEM key persists across reopen (M2.5 + E2E M2.9). Integration add/lock/reopen/unlock/read-back (M2.9). ✓
- Capstone lessons: persist ML-KEM secret key (M2.3/M2.4); surface errors to UI (`VaultError` → `napi::Error` M2.1, `vaultStore.error` + `vault-error` element M2.8); audit logging in schema from day 1 (M2.4 `audit_log` + `audit()` calls). ✓

> Edit note: the spec lists "edit" in the minimal UI. This plan implements add + delete (edit = delete-then-add) to keep the MVP minimal; a dedicated update path is a small follow-up and not required for the M2 verify steps. Flagging rather than silently dropping.

**Placeholder scan:** No TBD/TODO placeholders. The ml-kem API callout (M2.3) is an explicit verification gate with full code, not a gap.

**Type consistency:** napi class methods (`initVault`, `unlock`, `lock`, `addCredential`, `getCredentials`, `getSecret`, `list`, `delete`, `isInitialized`, `isUnlocked`) are consistent between `lib.rs`, the IPC handlers (`vault.initVault`, `vault.addCredential`, …), and the smoke test. `CredentialMeta` fields (`id`, `origin`, `username`, `label`, `createdAt`, `updatedAt`) match across Rust `#[napi(object)]`, the preload `CredentialMetaDto`, and `env.d.ts` `CredentialMeta`. IPC channels (`vault:status|init|unlock|lock|list|add|getSecret|delete`) match between `ipc.ts` and `preload/index.ts`. `data-testid`s (`vault-sidebar`, `vault-error`, `master-pw`, `vault-submit`, `vault-lock`, `add-origin`, `add-username`, `add-secret`, `add-label`, `add-submit`, `cred-list`, `cred-item`, `cred-username`, `cred-reveal`, `cred-secret`, `cred-delete`) match `vault.spec.ts`. `EncryptedRecord` fields (`kem_ct`, `kem_dk`, `aes_nonce`, `aes_ct`) consistent across `crypto.rs`, `storage.rs` columns, and `load_record`.

---

## Execution Handoff

Plan complete. After this, proceed to `2026-05-20-m3-autofill.md`.
