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
