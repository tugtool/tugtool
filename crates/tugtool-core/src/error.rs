//! Error types and error code constants for tug.
//!
//! This module provides a unified error type (`TugError`) that bridges
//! domain-specific errors from different subsystems (rename, session, etc.)
//! into a common format suitable for JSON output.
//!
//! ## Error Code Mapping
//!
//! Exit codes follow Table T26 from the 26.0.7 spec:
//! - `2`: Invalid arguments (bad input from caller)
//! - `3`: Resolution errors (symbol not found, ambiguous, file not found)
//! - `4`: Apply errors (failed to apply changes)
//! - `5`: Verification failed (syntax/type/test errors after changes)
//! - `10`: Internal errors (bugs, unexpected state)
//!
//! ## Design
//!
//! The error hierarchy follows these principles:
//! - **Unified type**: `TugError` is the single error type for CLI output
//! - **Bridging**: `impl From<X> for TugError` bridges domain errors
//! - **Code mapping**: `OutputErrorCode` provides stable integer codes for JSON

use std::fmt;

use thiserror::Error;

// Re-export common types from the types module
pub use crate::types::{Location, SymbolInfo};

// ============================================================================
// Output Error Codes (Table T26)
// ============================================================================

/// Error codes for JSON output per Table T26.
///
/// These codes map to CLI exit codes and appear in JSON error responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum OutputErrorCode {
    /// Invalid arguments from caller (bad input, malformed request).
    InvalidArguments = 2,
    /// Resolution errors (symbol not found, ambiguous, file not found).
    ResolutionError = 3,
    /// Apply errors (failed to write changes, snapshot mismatch).
    ApplyError = 4,
    /// Verification failed (syntax/type/test errors after changes).
    VerificationFailed = 5,
    /// Internal errors (bugs, unexpected state).
    InternalError = 10,
}

impl OutputErrorCode {
    /// Get the numeric code value.
    pub fn code(&self) -> u8 {
        *self as u8
    }
}

impl fmt::Display for OutputErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code())
    }
}

// ============================================================================
// Unified Error Type
// ============================================================================

/// Unified error type for CLI output.
///
/// This is the canonical error type that all subsystem errors are converted to
/// before being rendered as JSON output. Each variant includes enough context
/// to produce a helpful error message and optional `details` field.
#[derive(Debug, Error)]
pub enum TugError {
    /// Invalid arguments from caller.
    #[error("invalid arguments: {message}")]
    InvalidArguments {
        message: String,
        details: Option<serde_json::Value>,
    },

    /// Symbol not found at the specified location.
    #[error("no symbol found at {file}:{line}:{col}")]
    SymbolNotFound { file: String, line: u32, col: u32 },

    /// Multiple symbols match at the location.
    #[error("ambiguous symbol at location")]
    AmbiguousSymbol { candidates: Vec<SymbolInfo> },

    /// Invalid identifier (syntax error in new name).
    #[error("invalid identifier '{name}': {reason}")]
    InvalidIdentifier { name: String, reason: String },

    /// File not found.
    #[error("file not found: {path}")]
    FileNotFound { path: String },

    /// Failed to apply changes.
    #[error("apply error: {message}")]
    ApplyError {
        message: String,
        file: Option<String>,
    },

    /// Verification failed after applying changes.
    #[error("verification failed ({mode}): exit code {exit_code}")]
    VerificationFailed {
        mode: String,
        output: String,
        exit_code: i32,
    },

    /// Internal error (bug or unexpected state).
    #[error("internal error: {message}")]
    InternalError { message: String },

    /// Session error.
    #[error("session error: {message}")]
    SessionError { message: String },
}

// ============================================================================
// Error Code Mapping
// ============================================================================

impl From<&TugError> for OutputErrorCode {
    fn from(err: &TugError) -> Self {
        match err {
            TugError::InvalidArguments { .. } => OutputErrorCode::InvalidArguments,
            TugError::SymbolNotFound { .. } => OutputErrorCode::ResolutionError,
            TugError::AmbiguousSymbol { .. } => OutputErrorCode::ResolutionError,
            TugError::InvalidIdentifier { .. } => OutputErrorCode::InvalidArguments,
            TugError::FileNotFound { .. } => OutputErrorCode::ResolutionError,
            TugError::ApplyError { .. } => OutputErrorCode::ApplyError,
            TugError::VerificationFailed { .. } => OutputErrorCode::VerificationFailed,
            TugError::InternalError { .. } => OutputErrorCode::InternalError,
            TugError::SessionError { .. } => OutputErrorCode::InternalError,
        }
    }
}

impl From<TugError> for OutputErrorCode {
    fn from(err: TugError) -> Self {
        OutputErrorCode::from(&err)
    }
}

// ============================================================================
// Bridge: SessionError -> TugError
// ============================================================================

impl From<crate::session::SessionError> for TugError {
    fn from(err: crate::session::SessionError) -> Self {
        use crate::session::SessionError;
        match err {
            SessionError::SessionNotWritable { path } => TugError::SessionError {
                message: format!("session directory not writable: {}", path.display()),
            },
            SessionError::WorkspaceNotFound { expected } => TugError::FileNotFound {
                path: expected.to_string_lossy().into_owned(),
            },
            SessionError::ConcurrentModification { expected, actual } => TugError::ApplyError {
                message: format!(
                    "session was modified concurrently (expected {}, found {})",
                    expected, actual
                ),
                file: None,
            },
            SessionError::SessionCorrupt { path, reason } => TugError::SessionError {
                message: format!("session corrupt at {}: {}", path.display(), reason),
            },
            SessionError::CacheCorrupt { path } => TugError::SessionError {
                message: format!("cache corrupt: {}", path.display()),
            },
            SessionError::Io(io_err) => TugError::InternalError {
                message: format!("IO error: {}", io_err),
            },
            SessionError::Json(json_err) => TugError::InternalError {
                message: format!("JSON error: {}", json_err),
            },
            SessionError::WorkspaceRootMismatch {
                session_root,
                current_root,
            } => TugError::SessionError {
                message: format!(
                    "workspace root mismatch: session bound to {}, now at {}",
                    session_root.display(),
                    current_root.display()
                ),
            },
        }
    }
}

// ============================================================================
// Convenience Constructors
// ============================================================================

impl TugError {
    /// Create an invalid arguments error with optional details.
    pub fn invalid_args(message: impl Into<String>) -> Self {
        TugError::InvalidArguments {
            message: message.into(),
            details: None,
        }
    }

    /// Create an invalid arguments error with JSON details.
    pub fn invalid_args_with_details(
        message: impl Into<String>,
        details: serde_json::Value,
    ) -> Self {
        TugError::InvalidArguments {
            message: message.into(),
            details: Some(details),
        }
    }

    /// Create a symbol not found error.
    pub fn symbol_not_found(file: impl Into<String>, line: u32, col: u32) -> Self {
        TugError::SymbolNotFound {
            file: file.into(),
            line,
            col,
        }
    }

    /// Create a file not found error.
    pub fn file_not_found(path: impl Into<String>) -> Self {
        TugError::FileNotFound { path: path.into() }
    }

    /// Create an internal error.
    pub fn internal(message: impl Into<String>) -> Self {
        TugError::InternalError {
            message: message.into(),
        }
    }

    /// Get the error code for this error.
    pub fn error_code(&self) -> OutputErrorCode {
        OutputErrorCode::from(self)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod error_code_mapping {
        use super::*;

        #[test]
        fn symbol_not_found_maps_to_resolution_error() {
            let err = TugError::symbol_not_found("test.py", 42, 8);
            assert_eq!(
                OutputErrorCode::from(&err),
                OutputErrorCode::ResolutionError
            );
            assert_eq!(err.error_code().code(), 3);
        }

        #[test]
        fn invalid_arguments_maps_to_invalid_arguments() {
            let err = TugError::invalid_args("missing required field");
            assert_eq!(
                OutputErrorCode::from(&err),
                OutputErrorCode::InvalidArguments
            );
            assert_eq!(err.error_code().code(), 2);
        }

        #[test]
        fn verification_failed_maps_to_verification_failed() {
            let err = TugError::VerificationFailed {
                mode: "syntax".to_string(),
                output: "SyntaxError: invalid syntax".to_string(),
                exit_code: 1,
            };
            assert_eq!(
                OutputErrorCode::from(&err),
                OutputErrorCode::VerificationFailed
            );
            assert_eq!(err.error_code().code(), 5);
        }

        #[test]
        fn internal_error_maps_to_internal_error() {
            let err = TugError::internal("unexpected state");
            assert_eq!(OutputErrorCode::from(&err), OutputErrorCode::InternalError);
            assert_eq!(err.error_code().code(), 10);
        }

        #[test]
        fn ambiguous_symbol_maps_to_resolution_error() {
            let err = TugError::AmbiguousSymbol { candidates: vec![] };
            assert_eq!(
                OutputErrorCode::from(&err),
                OutputErrorCode::ResolutionError
            );
        }

        #[test]
        fn file_not_found_maps_to_resolution_error() {
            let err = TugError::file_not_found("missing.py");
            assert_eq!(
                OutputErrorCode::from(&err),
                OutputErrorCode::ResolutionError
            );
        }

        #[test]
        fn apply_error_maps_to_apply_error() {
            let err = TugError::ApplyError {
                message: "snapshot mismatch".to_string(),
                file: Some("test.py".to_string()),
            };
            assert_eq!(OutputErrorCode::from(&err), OutputErrorCode::ApplyError);
            assert_eq!(err.error_code().code(), 4);
        }

        #[test]
        fn invalid_identifier_maps_to_invalid_arguments() {
            let err = TugError::InvalidIdentifier {
                name: "123abc".to_string(),
                reason: "cannot start with digit".to_string(),
            };
            assert_eq!(
                OutputErrorCode::from(&err),
                OutputErrorCode::InvalidArguments
            );
        }
    }

    mod error_display {
        use super::*;

        #[test]
        fn symbol_not_found_display() {
            let err = TugError::symbol_not_found("test.py", 42, 8);
            assert_eq!(err.to_string(), "no symbol found at test.py:42:8");
        }

        #[test]
        fn invalid_arguments_display() {
            let err = TugError::invalid_args("missing field");
            assert_eq!(err.to_string(), "invalid arguments: missing field");
        }

        #[test]
        fn verification_failed_display() {
            let err = TugError::VerificationFailed {
                mode: "syntax".to_string(),
                output: "error".to_string(),
                exit_code: 1,
            };
            assert_eq!(err.to_string(), "verification failed (syntax): exit code 1");
        }
    }

    mod output_error_code {
        use super::*;

        #[test]
        fn code_values_match_spec() {
            assert_eq!(OutputErrorCode::InvalidArguments.code(), 2);
            assert_eq!(OutputErrorCode::ResolutionError.code(), 3);
            assert_eq!(OutputErrorCode::ApplyError.code(), 4);
            assert_eq!(OutputErrorCode::VerificationFailed.code(), 5);
            assert_eq!(OutputErrorCode::InternalError.code(), 10);
        }

        #[test]
        fn display_shows_code() {
            assert_eq!(format!("{}", OutputErrorCode::InvalidArguments), "2");
            assert_eq!(format!("{}", OutputErrorCode::ResolutionError), "3");
            assert_eq!(format!("{}", OutputErrorCode::InternalError), "10");
        }
    }
}
