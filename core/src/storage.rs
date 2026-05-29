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
         );
         CREATE TABLE IF NOT EXISTS mfa_totp (
             id         INTEGER PRIMARY KEY CHECK (id = 1),
             kem_ct     BLOB NOT NULL,
             kem_dk     BLOB NOT NULL,
             aes_nonce  BLOB NOT NULL,
             aes_ct     BLOB NOT NULL,
             confirmed  INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS webauthn_credentials (
             id         TEXT PRIMARY KEY,
             passkey    TEXT NOT NULL,
             created_at INTEGER NOT NULL
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
        params![
            id,
            origin,
            username,
            label,
            rec.kem_ct,
            rec.kem_dk,
            rec.aes_nonce,
            rec.aes_ct,
            ts
        ],
    )?;
    audit(conn, "credential.add", origin)?;
    Ok(())
}

pub fn list_credentials(
    conn: &Connection,
    origin: Option<&str>,
) -> VaultResult<Vec<CredentialRow>> {
    let map_row = |r: &rusqlite::Row<'_>| {
        Ok(CredentialRow {
            id: r.get(0)?,
            origin: r.get(1)?,
            username: r.get(2)?,
            label: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    };
    let rows = match origin {
        Some(o) => {
            let mut stmt = conn.prepare(
                "SELECT id, origin, username, label, created_at, updated_at
                 FROM credentials WHERE origin = ?1 ORDER BY updated_at DESC",
            )?;
            let v = stmt
                .query_map(params![o], map_row)?
                .collect::<Result<Vec<_>, _>>()?;
            v
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, origin, username, label, created_at, updated_at
                 FROM credentials ORDER BY updated_at DESC",
            )?;
            let v = stmt
                .query_map([], map_row)?
                .collect::<Result<Vec<_>, _>>()?;
            v
        }
    };
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

/// Store (replace) the encrypted, unconfirmed TOTP secret.
pub fn put_totp(conn: &Connection, rec: &EncryptedRecord) -> VaultResult<()> {
    conn.execute(
        "INSERT INTO mfa_totp (id, kem_ct, kem_dk, aes_nonce, aes_ct, confirmed)
         VALUES (1, ?1, ?2, ?3, ?4, 0)
         ON CONFLICT(id) DO UPDATE SET
            kem_ct=?1, kem_dk=?2, aes_nonce=?3, aes_ct=?4, confirmed=0",
        params![rec.kem_ct, rec.kem_dk, rec.aes_nonce, rec.aes_ct],
    )?;
    audit(conn, "mfa.totp.enroll", "")?;
    Ok(())
}

pub fn confirm_totp(conn: &Connection) -> VaultResult<()> {
    conn.execute("UPDATE mfa_totp SET confirmed = 1 WHERE id = 1", [])?;
    audit(conn, "mfa.totp.confirm", "")?;
    Ok(())
}

pub fn totp_record(conn: &Connection) -> VaultResult<Option<(EncryptedRecord, bool)>> {
    let row = conn.query_row(
        "SELECT kem_ct, kem_dk, aes_nonce, aes_ct, confirmed FROM mfa_totp WHERE id = 1",
        [],
        |r| {
            Ok((
                EncryptedRecord {
                    kem_ct: r.get(0)?,
                    kem_dk: r.get(1)?,
                    aes_nonce: r.get(2)?,
                    aes_ct: r.get(3)?,
                },
                r.get::<_, i64>(4)? != 0,
            ))
        },
    );
    match row {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(VaultError::Storage(e)),
    }
}

pub fn totp_confirmed(conn: &Connection) -> VaultResult<bool> {
    Ok(matches!(totp_record(conn)?, Some((_, true))))
}

pub fn put_passkey(conn: &Connection, id: &str, passkey_json: &str) -> VaultResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO webauthn_credentials (id, passkey, created_at) VALUES (?1, ?2, ?3)",
        params![id, passkey_json, now()],
    )?;
    audit(conn, "mfa.webauthn.register", id)?;
    Ok(())
}

pub fn list_passkeys(conn: &Connection) -> VaultResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT passkey FROM webauthn_credentials")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn has_passkeys(conn: &Connection) -> VaultResult<bool> {
    let n: i64 = conn.query_row("SELECT count(*) FROM webauthn_credentials", [], |r| {
        r.get(0)
    })?;
    Ok(n > 0)
}

fn now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
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
        use std::sync::atomic::{AtomicU64, Ordering};
        static CTR: AtomicU64 = AtomicU64::new(0);
        format!("{}-{}", now() as u64, CTR.fetch_add(1, Ordering::Relaxed))
    }

    #[test]
    fn insert_list_load_delete_round_trip() {
        let path = temp_db();
        let key = [7u8; 32];
        let conn = open_encrypted(&path, &key).unwrap();
        init_schema(&conn).unwrap();

        let rec = encrypt_secret(b"s3cret").unwrap();
        insert_credential(
            &conn,
            "id1",
            "https://github.com",
            "octocat",
            "GitHub",
            &rec,
        )
        .unwrap();

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
