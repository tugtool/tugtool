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

impl Error {
    /// Map this error to a CLI exit code per Table T01.
    ///
    /// | Code | Meaning |
    /// |------|---------|
    /// | 1    | Internal/other error (non-busy SQLite errors) |
    /// | 3    | CAS conflict |
    /// | 4    | Invalid usage (InvalidDomain, InvalidKey, ValueTooLarge, Serde) |
    /// | 5    | Busy/timeout (SQLite busy) |
    pub fn exit_code(&self) -> u8 {
        match self {
            Error::Conflict => 3,
            Error::InvalidDomain(_)
            | Error::InvalidKey(_)
            | Error::ValueTooLarge { .. }
            | Error::Serde(_) => 4,
            Error::Sqlite(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::DatabaseBusy =>
            {
                5
            }
            Error::Sqlite(_) => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── T05a: Error::exit_code returns correct codes for each error variant ───

    #[test]
    fn test_exit_code_conflict_returns_3() {
        assert_eq!(Error::Conflict.exit_code(), 3);
    }

    #[test]
    fn test_exit_code_invalid_domain_returns_4() {
        assert_eq!(Error::InvalidDomain("".into()).exit_code(), 4);
    }

    #[test]
    fn test_exit_code_invalid_key_returns_4() {
        assert_eq!(Error::InvalidKey("".into()).exit_code(), 4);
    }

    #[test]
    fn test_exit_code_value_too_large_returns_4() {
        assert_eq!(Error::ValueTooLarge { size: 1024 }.exit_code(), 4);
    }

    #[test]
    fn test_exit_code_serde_returns_4() {
        let serde_err: serde_json::Error =
            serde_json::from_str::<serde_json::Value>("bad json").unwrap_err();
        assert_eq!(Error::Serde(serde_err).exit_code(), 4);
    }

    #[test]
    fn test_exit_code_sqlite_non_busy_returns_1() {
        let sqlite_err = rusqlite::Error::QueryReturnedNoRows;
        assert_eq!(Error::Sqlite(sqlite_err).exit_code(), 1);
    }
}
