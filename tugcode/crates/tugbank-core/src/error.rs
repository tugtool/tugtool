//! Error types for tugbank-core.

/// Errors returned by tugbank-core operations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The domain name is invalid (e.g., empty string).
    #[error("invalid domain name: {0}")]
    InvalidDomain(String),

    /// The key is invalid (e.g., empty string).
    #[error("invalid key: {0}")]
    InvalidKey(String),

    /// A CAS (compare-and-swap) generation conflict was detected.
    #[error("generation conflict")]
    Conflict,

    /// A `Value::Bytes` payload exceeds the 10 MB size limit.
    #[error("value too large: {size} bytes exceeds 10 MB limit")]
    ValueTooLarge { size: usize },

    /// An underlying SQLite error.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// A JSON serialization/deserialization error.
    #[error("json error: {0}")]
    Serde(#[from] serde_json::Error),
}
