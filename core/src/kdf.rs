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
