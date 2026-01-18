//! CLI front door for agent integration.
//!
//! Provides the command-line interface for tug operations:
//! - `analyze-impact rename-symbol` - Analyze rename impact
//! - `run rename-symbol` - Execute rename with verification
//!
//! ## Session Integration
//!
//! All CLI functions accept a `&Session` parameter. The session handles:
//! - Directory structure creation (`.tug/python/`, `.tug/workers/`, etc.)
//! - Workspace root validation
//! - Configuration persistence
//!
//! The caller (typically `main.rs`) is responsible for opening the session
//! via `Session::open()` before invoking these functions.
//!
//! ## Error Handling
//!
//! All functions return `Result<T, TugError>`. The `TugError` type
//! provides stable error codes for JSON output and proper error categorization.
//!
//! ## Feature Flags
//!
//! Language-specific operations require the corresponding feature flag:
//! - `python` - Python rename operations (default)
//! - `rust` - Rust operations (placeholder, not yet implemented)

#[cfg(feature = "python")]
use std::path::PathBuf;

use tugtool_core::error::TugError;
#[cfg(feature = "python")]
use tugtool_core::output::Location;
#[cfg(feature = "python")]
use tugtool_core::session::Session;
#[cfg(feature = "python")]
use tugtool_python::env::{resolve_python, ResolutionOptions};
#[cfg(feature = "python")]
use tugtool_python::rename::PythonRenameOp;
#[cfg(feature = "python")]
use tugtool_python::verification::VerificationMode;

// ============================================================================
// Python Language Support (Feature-Gated)
// ============================================================================

/// Run analyze-impact for rename-symbol.
///
/// # Arguments
///
/// * `session` - Open session (provides workspace root, session directory)
/// * `python_path` - Optional explicit Python path (overrides resolution)
/// * `at` - Location string in "file:line:col" format
/// * `to` - New name for the symbol
///
/// # Returns
///
/// JSON string containing the analysis result.
///
/// # Feature Requirements
///
/// Requires the `python` feature flag.
#[cfg(feature = "python")]
pub fn run_analyze_impact(
    session: &Session,
    python_path: Option<PathBuf>,
    at: &str,
    to: &str,
) -> Result<String, TugError> {
    // Parse location
    let location = Location::parse(at).ok_or_else(|| {
        TugError::invalid_args(format!(
            "invalid location format '{}', expected path:line:col",
            at
        ))
    })?;

    // Resolve Python interpreter (use explicit path if provided, otherwise auto-resolve)
    let python = resolve_python_path(session, python_path)?;

    // Create rename operation using session
    let op = PythonRenameOp::with_session(session, python);

    // Run analysis - RenameError converts to TugError via From impl
    let analysis = op.analyze_impact(&location, to)?;

    // Serialize to JSON
    let json = serde_json::to_string_pretty(&analysis)
        .map_err(|e| TugError::internal(format!("JSON serialization error: {}", e)))?;
    Ok(json)
}

/// Run rename-symbol operation.
///
/// # Arguments
///
/// * `session` - Open session (provides workspace root, session directory)
/// * `python_path` - Optional explicit Python path (overrides resolution)
/// * `at` - Location string in "file:line:col" format
/// * `to` - New name for the symbol
/// * `verify_mode` - Verification mode after rename
/// * `apply` - Whether to apply changes to files
///
/// # Returns
///
/// JSON string containing the rename result.
///
/// # Feature Requirements
///
/// Requires the `python` feature flag.
#[cfg(feature = "python")]
pub fn run_rename(
    session: &Session,
    python_path: Option<PathBuf>,
    at: &str,
    to: &str,
    verify_mode: VerificationMode,
    apply: bool,
) -> Result<String, TugError> {
    // Parse location
    let location = Location::parse(at).ok_or_else(|| {
        TugError::invalid_args(format!(
            "invalid location format '{}', expected path:line:col",
            at
        ))
    })?;

    // Resolve Python interpreter (use explicit path if provided, otherwise auto-resolve)
    let python = resolve_python_path(session, python_path)?;

    // Create rename operation using session
    let op = PythonRenameOp::with_session(session, python);

    // Run rename - RenameError converts to TugError via From impl
    let result = op.run(&location, to, verify_mode, apply)?;

    // Serialize to JSON
    let json = serde_json::to_string_pretty(&result)
        .map_err(|e| TugError::internal(format!("JSON serialization error: {}", e)))?;
    Ok(json)
}

// ============================================================================
// Helper Functions (Feature-Gated)
// ============================================================================

/// Resolve Python interpreter path.
///
/// If an explicit path is provided, use it directly.
/// Otherwise, auto-resolve using the session's python directory.
#[cfg(feature = "python")]
fn resolve_python_path(
    session: &Session,
    explicit_path: Option<PathBuf>,
) -> Result<PathBuf, TugError> {
    if let Some(path) = explicit_path {
        return Ok(path);
    }

    // Auto-resolve Python with libcst requirement
    let options = ResolutionOptions::default().require_libcst();
    let python_env = resolve_python(session.session_dir(), &options)
        .map_err(|e| TugError::internal(format!("Python environment error: {}", e)))?;

    Ok(python_env.interpreter().to_path_buf())
}

// ============================================================================
// Feature-Not-Available Stubs
// ============================================================================

/// Returns an error indicating Python support is not compiled in.
///
/// This function is only available when the `python` feature is disabled,
/// providing a graceful error message to users.
#[cfg(not(feature = "python"))]
pub fn python_not_available() -> TugError {
    TugError::invalid_args(
        "Python support not compiled in.\n\n\
         To enable: cargo install tugtool --features python"
            .to_string(),
    )
}

// ============================================================================
// Tests (Feature-Gated)
// ============================================================================

#[cfg(all(test, feature = "python"))]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tugtool_core::session::SessionOptions;

    fn create_test_workspace() -> TempDir {
        let temp = TempDir::new().unwrap();
        std::fs::write(temp.path().join("test.py"), "def foo(): pass\n").unwrap();
        temp
    }

    mod resolve_python_path_tests {
        use super::*;

        #[test]
        fn explicit_path_is_used_directly() {
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            let explicit = PathBuf::from("/usr/bin/python3.11");
            let result = resolve_python_path(&session, Some(explicit.clone())).unwrap();

            assert_eq!(result, explicit);
        }

        #[test]
        fn explicit_path_overrides_auto_resolution() {
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            // Even if a different Python could be resolved, the explicit path wins
            let explicit = PathBuf::from("/custom/python");
            let result = resolve_python_path(&session, Some(explicit.clone())).unwrap();

            assert_eq!(result, explicit);
        }
    }

    mod error_handling {
        use super::*;
        use tugtool_core::error::OutputErrorCode;

        #[test]
        fn invalid_location_returns_invalid_arguments_error() {
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            // Use an explicit python path to avoid resolution errors
            let result = run_analyze_impact(
                &session,
                Some(PathBuf::from("/usr/bin/python3")),
                "bad:input", // Missing column
                "bar",
            );

            assert!(result.is_err());
            let err = result.unwrap_err();
            assert_eq!(err.error_code(), OutputErrorCode::InvalidArguments);
            assert!(err.to_string().contains("invalid location format"));
        }

        #[test]
        fn missing_column_in_location_returns_error() {
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            let result = run_rename(
                &session,
                Some(PathBuf::from("/usr/bin/python3")),
                "test.py:1", // Missing column
                "bar",
                VerificationMode::None,
                false,
            );

            assert!(result.is_err());
            let err = result.unwrap_err();
            assert_eq!(err.error_code(), OutputErrorCode::InvalidArguments);
        }
    }

    mod session_integration {
        use super::*;

        #[test]
        fn session_creates_required_directories() {
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            // Session::open() should have created these directories
            assert!(session.session_dir().exists());
            assert!(session.python_dir().exists());
            assert!(session.workers_dir().exists());
        }

        #[test]
        fn run_analyze_impact_accepts_session() {
            // This test verifies the function signature accepts &Session
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            // Just verify the function can be called with Session
            // Result depends on Python availability - we only care about signature
            let _result = run_analyze_impact(&session, None, "test.py:1:5", "bar");
        }

        #[test]
        fn run_rename_accepts_session() {
            // This test verifies the function signature accepts &Session
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            // Just verify the function can be called with Session
            // Result depends on Python availability - we only care about signature
            let _result = run_rename(
                &session,
                None,
                "test.py:1:5",
                "bar",
                VerificationMode::None,
                false,
            );
        }
    }
}
