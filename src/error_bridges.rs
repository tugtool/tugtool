//! Error bridge implementations for language-specific errors.
//!
//! This module provides `impl From<X> for TugError` conversions from
//! language-specific error types to the unified `TugError` type.
//!
//! These bridges live in the root crate rather than `tugtool-core` because
//! they depend on language-specific types (Python, session, etc.) that
//! are not part of core.

use tugtool_core::error::{Location, SymbolInfo, TugError};

use crate::python::rename::RenameError;
use crate::python::verification::VerificationStatus;
use crate::python::worker::WorkerError;
use crate::session::SessionError;

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
                        location: Location::new("", 0, 0),
                        container: None,
                    })
                    .collect();
                TugError::AmbiguousSymbol {
                    candidates: symbols,
                }
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
                                location: Location::new("", 0, 0),
                                container: None,
                            })
                            .collect();
                        TugError::AmbiguousSymbol {
                            candidates: symbols,
                        }
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
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tugtool_core::error::OutputErrorCode;

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

    #[test]
    fn error_codes_still_work_with_bridges() {
        let rename_err = RenameError::SymbolNotFound {
            file: "test.py".to_string(),
            line: 1,
            col: 1,
        };
        let err = TugError::from(rename_err);
        assert_eq!(OutputErrorCode::from(&err), OutputErrorCode::ResolutionError);
    }
}
