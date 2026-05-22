#![deny(clippy::all)]

mod crypto;
mod error;
mod kdf;
mod storage;
mod vault;

use napi_derive::napi;

/// Smoke-test function proving the JS<->Rust bridge works.
/// Returns a stable identifier string the Electron main process can assert on.
#[napi]
pub fn core_version() -> String {
    format!("secure-browser-core {}", env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_version_reports_crate_version() {
        let v = core_version();
        assert!(v.starts_with("secure-browser-core "));
        assert!(v.contains(env!("CARGO_PKG_VERSION")));
    }
}
