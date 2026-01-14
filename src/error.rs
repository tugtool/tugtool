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
//! - **Unified type**: `TugError` is the single error type for CLI/MCP output
//! - **Bridging**: `impl From<X> for TugError` bridges domain errors
//! - **Code mapping**: `OutputErrorCode` provides stable integer codes for JSON

use std::fmt;

use thiserror::Error;

use crate::output::SymbolInfo;
use crate::python::rename::RenameError;
use crate::python::verification::VerificationStatus;
use crate::python::worker::WorkerError;
use crate::session::SessionError;

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

/// Unified error type for CLI and MCP output.
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

    /// Worker process error.
    #[error("worker error: {message}")]
    WorkerError { message: String },

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
            TugError::WorkerError { .. } => OutputErrorCode::InternalError,
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
// Bridge: RenameError -> TugError
// ============================================================================

impl From<RenameError> for TugError {
    fn from(err: RenameError) -> Self {
        match err {
            RenameError::SymbolNotFound { file, line, col } => {
                TugError::SymbolNotFound { file, line, col }
            }
            RenameError::AmbiguousSymbol { candidates } => {
                // Convert string candidates to SymbolInfo placeholders
                // In practice, the caller should use the richer error variant directly
                let symbols = candidates
                    .into_iter()
                    .map(|name| SymbolInfo {
                        id: String::new(),
                        name,
                        kind: "unknown".to_string(),
                        location: crate::output::Location::new("", 0, 0),
                        container: None,
                    })
                    .collect();
                TugError::AmbiguousSymbol { candidates: symbols }
            }
            RenameError::InvalidName(validation_err) => {
                // Extract name and reason from ValidationError
                // The ValidationError has the format "invalid name 'X': reason"
                let msg = validation_err.to_string();
                // Parse the name out of the message if possible
                let (name, reason) = if let Some(start) = msg.find('\'') {
                    if let Some(end) = msg[start + 1..].find('\'') {
                        let extracted_name = msg[start + 1..start + 1 + end].to_string();
                        let reason_start = msg.find(": ").map(|i| i + 2).unwrap_or(0);
                        let extracted_reason = msg[reason_start..].to_string();
                        (extracted_name, extracted_reason)
                    } else {
                        (msg.clone(), msg.clone())
                    }
                } else {
                    (msg.clone(), msg.clone())
                };
                TugError::InvalidIdentifier { name, reason }
            }
            RenameError::VerificationFailed { status, output } => {
                let mode = match status {
                    VerificationStatus::Failed => "verification",
                    VerificationStatus::Passed => "verification",
                    VerificationStatus::Skipped => "skipped",
                };
                TugError::VerificationFailed {
                    mode: mode.to_string(),
                    output,
                    exit_code: if status == VerificationStatus::Failed {
                        1
                    } else {
                        0
                    },
                }
            }
            RenameError::Worker(worker_err) => TugError::from(worker_err),
            RenameError::Io(io_err) => TugError::InternalError {
                message: format!("IO error: {}", io_err),
            },
            RenameError::File(file_err) => TugError::FileNotFound {
                path: file_err.to_string(),
            },
            RenameError::Lookup(lookup_err) => {
                // LookupError variants map to TugError variants
                use crate::python::lookup::LookupError;
                match lookup_err {
                    LookupError::SymbolNotFound { file, line, col } => {
                        TugError::SymbolNotFound { file, line, col }
                    }
                    LookupError::AmbiguousSymbol { candidates } => {
                        let symbols = candidates
                            .into_iter()
                            .map(|name| SymbolInfo {
                                id: String::new(),
                                name,
                                kind: "unknown".to_string(),
                                location: crate::output::Location::new("", 0, 0),
                                container: None,
                            })
                            .collect();
                        TugError::AmbiguousSymbol { candidates: symbols }
                    }
                    LookupError::File(file_err) => TugError::FileNotFound {
                        path: file_err.to_string(),
                    },
                }
            }
            RenameError::AnalyzerError { message } => TugError::InternalError { message },
        }
    }
}

// ============================================================================
// Bridge: WorkerError -> TugError
// ============================================================================

impl From<WorkerError> for TugError {
    fn from(err: WorkerError) -> Self {
        TugError::WorkerError {
            message: err.to_string(),
        }
    }
}

// ============================================================================
// Bridge: SessionError -> TugError
// ============================================================================

impl From<SessionError> for TugError {
    fn from(err: SessionError) -> Self {
        match err {
            SessionError::SessionNotWritable { path } => TugError::SessionError {
                message: format!("session directory not writable: {}", path.display()),
            },
            SessionError::WorkspaceNotFound { expected } => TugError::FileNotFound {
                path: expected.to_string_lossy().into_owned(),
            },
            SessionError::ConcurrentModification { expected, actual } => {
                TugError::ApplyError {
                    message: format!(
                        "session was modified concurrently (expected {}, found {})",
                        expected, actual
                    ),
                    file: None,
                }
            }
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
            assert_eq!(OutputErrorCode::from(&err), OutputErrorCode::ResolutionError);
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
            assert_eq!(OutputErrorCode::from(&err), OutputErrorCode::ResolutionError);
        }

        #[test]
        fn file_not_found_maps_to_resolution_error() {
            let err = TugError::file_not_found("missing.py");
            assert_eq!(OutputErrorCode::from(&err), OutputErrorCode::ResolutionError);
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

    mod rename_error_conversion {
        use super::*;

        #[test]
        fn symbol_not_found_converts() {
            let rename_err = RenameError::SymbolNotFound {
                file: "src/main.py".to_string(),
                line: 10,
                col: 5,
            };
            let err = TugError::from(rename_err);
            match err {
                TugError::SymbolNotFound { file, line, col } => {
                    assert_eq!(file, "src/main.py");
                    assert_eq!(line, 10);
                    assert_eq!(col, 5);
                }
                _ => panic!("expected SymbolNotFound"),
            }
        }

        #[test]
        fn file_not_found_converts() {
            use crate::python::files::FileError;
            let rename_err = RenameError::File(FileError::NotFound {
                path: "missing.py".to_string(),
            });
            let err = TugError::from(rename_err);
            match err {
                TugError::FileNotFound { path } => {
                    assert!(path.contains("missing.py"));
                }
                _ => panic!("expected FileNotFound"),
            }
        }

        #[test]
        fn invalid_name_converts() {
            use crate::python::validation::ValidationError;
            let validation_err = ValidationError::InvalidName {
                name: "123".to_string(),
                reason: "cannot start with digit".to_string(),
            };
            let rename_err = RenameError::InvalidName(validation_err);
            let err = TugError::from(rename_err);
            match err {
                TugError::InvalidIdentifier { name: _, reason: _ } => {
                    // ValidationError message format may differ
                }
                _ => panic!("expected InvalidIdentifier"),
            }
        }

        #[test]
        fn verification_failed_converts() {
            let rename_err = RenameError::VerificationFailed {
                status: VerificationStatus::Failed,
                output: "tests failed".to_string(),
            };
            let err = TugError::from(rename_err);
            match err {
                TugError::VerificationFailed {
                    mode,
                    output,
                    exit_code,
                } => {
                    assert_eq!(mode, "verification");
                    assert_eq!(output, "tests failed");
                    assert_eq!(exit_code, 1);
                }
                _ => panic!("expected VerificationFailed"),
            }
        }

        #[test]
        fn ambiguous_symbol_converts() {
            let rename_err = RenameError::AmbiguousSymbol {
                candidates: vec!["foo".to_string(), "bar".to_string()],
            };
            let err = TugError::from(rename_err);
            match err {
                TugError::AmbiguousSymbol { candidates } => {
                    assert_eq!(candidates.len(), 2);
                    assert_eq!(candidates[0].name, "foo");
                    assert_eq!(candidates[1].name, "bar");
                }
                _ => panic!("expected AmbiguousSymbol"),
            }
        }
    }

    mod session_error_conversion {
        use super::*;
        use std::path::PathBuf;

        #[test]
        fn workspace_not_found_converts() {
            let session_err = SessionError::WorkspaceNotFound {
                expected: PathBuf::from("/home/user/project"),
            };
            let err = TugError::from(session_err);
            match err {
                TugError::FileNotFound { path } => {
                    assert!(path.contains("project"));
                }
                _ => panic!("expected FileNotFound"),
            }
        }

        #[test]
        fn session_corrupt_converts() {
            let session_err = SessionError::SessionCorrupt {
                path: PathBuf::from("/tmp/session"),
                reason: "invalid JSON".to_string(),
            };
            let err = TugError::from(session_err);
            match err {
                TugError::SessionError { message } => {
                    assert!(message.contains("corrupt"));
                    assert!(message.contains("invalid JSON"));
                }
                _ => panic!("expected SessionError"),
            }
        }

        #[test]
        fn concurrent_modification_converts_to_apply_error() {
            let session_err = SessionError::ConcurrentModification {
                expected: "abc123".to_string(),
                actual: "def456".to_string(),
            };
            let err = TugError::from(session_err);
            match err {
                TugError::ApplyError { message, file } => {
                    assert!(message.contains("modified concurrently"));
                    assert!(file.is_none());
                }
                _ => panic!("expected ApplyError"),
            }
        }

        #[test]
        fn io_error_converts_to_internal() {
            let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
            let session_err = SessionError::Io(io_err);
            let err = TugError::from(session_err);
            match err {
                TugError::InternalError { message } => {
                    assert!(message.contains("IO error"));
                }
                _ => panic!("expected InternalError"),
            }
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
