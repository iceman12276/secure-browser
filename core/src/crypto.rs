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
        kem_ct: AsRef::<[u8]>::as_ref(&kem_ct).to_vec(),
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
