use totp_rs::{Algorithm, Secret, TOTP};

use crate::error::{VaultError, VaultResult};

pub struct TotpEnrollment {
    pub secret_base32: String,
    pub otpauth_url: String,
    pub qr_png_base64: String,
}

/// Build a TOTP from a base32 secret using RFC 6238 defaults (SHA1, 6 digits,
/// 30s step, skew 1) plus issuer/account metadata.
pub fn build_totp(secret_base32: &str) -> VaultResult<TOTP> {
    let secret = Secret::Encoded(secret_base32.to_string())
        .to_bytes()
        .map_err(|e| VaultError::Crypto(format!("totp secret: {e:?}")))?;
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some("Secure Browser".to_string()),
        "vault".to_string(),
    )
    .map_err(|e| VaultError::Crypto(format!("totp build: {e}")))
}

/// Generate a fresh enrollment (secret + otpauth URL + QR PNG base64).
pub fn generate_enrollment() -> VaultResult<TotpEnrollment> {
    let secret = Secret::generate_secret();
    let secret_base32 = secret.to_encoded().to_string();
    let totp = build_totp(&secret_base32)?;
    let qr = totp
        .get_qr_base64()
        .map_err(|e| VaultError::Crypto(format!("totp qr: {e}")))?;
    Ok(TotpEnrollment {
        secret_base32,
        otpauth_url: totp.get_url(),
        qr_png_base64: qr,
    })
}

/// Verify a code against the secret at the current time.
pub fn verify(secret_base32: &str, code: &str) -> VaultResult<bool> {
    let totp = build_totp(secret_base32)?;
    totp.check_current(code)
        .map_err(|e| VaultError::Crypto(format!("totp check: {e}")))
}

/// Verify against a specific unix timestamp (used for RFC vector tests).
pub fn verify_at(secret_base32: &str, code: &str, unix_secs: u64) -> VaultResult<bool> {
    let totp = build_totp(secret_base32)?;
    Ok(totp.check(code, unix_secs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use totp_rs::Secret;

    // RFC 6238 Appendix B uses the ASCII seed "12345678901234567890" (SHA1).
    fn rfc_secret_base32() -> String {
        Secret::Raw(b"12345678901234567890".to_vec())
            .to_encoded()
            .to_string()
    }

    #[test]
    fn rfc6238_vector_t59_sha1() {
        // At T=59s the RFC 8-digit SHA1 code is 94287082; the low 6 digits are 287082.
        let secret = rfc_secret_base32();
        assert!(verify_at(&secret, "287082", 59).unwrap());
    }

    #[test]
    fn rfc6238_vector_t1111111109_sha1() {
        // RFC 8-digit code 07081804 at T=1111111109 → low 6 digits 081804.
        let secret = rfc_secret_base32();
        assert!(verify_at(&secret, "081804", 1_111_111_109).unwrap());
    }

    #[test]
    fn wrong_code_rejected() {
        let secret = rfc_secret_base32();
        assert!(!verify_at(&secret, "000000", 59).unwrap());
    }

    #[test]
    fn enrollment_round_trips() {
        let e = generate_enrollment().unwrap();
        let totp = build_totp(&e.secret_base32).unwrap();
        let code = totp.generate_current().unwrap();
        assert!(verify(&e.secret_base32, &code).unwrap());
        assert!(e.otpauth_url.starts_with("otpauth://totp/"));
        assert!(!e.qr_png_base64.is_empty());
    }
}
