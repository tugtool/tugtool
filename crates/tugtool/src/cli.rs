//! CLI front door for agent integration.
//!
//! Provides the command-line interface helpers for tug operations:
//! - `apply python rename` - Execute rename with verification
//! - `emit python rename` - Emit unified diff (or JSON envelope with `--json`)
//! - `analyze python rename` - Analyze rename impact (JSON metadata)
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
use tugtool_core::filter::FileFilterSpec;
#[cfg(feature = "python")]
use tugtool_core::output::Location;
#[cfg(feature = "python")]
use tugtool_core::session::Session;
#[cfg(feature = "python")]
use tugtool_python::files::collect_python_files_filtered;
#[cfg(feature = "python")]
use tugtool_python::ops::rename::{analyze, rename};
#[cfg(feature = "python")]
use tugtool_python::verification::VerificationMode;

// ============================================================================
// Python Language Support (Feature-Gated)
// ============================================================================

/// Analyze a rename operation (preview without applying).
///
/// # Arguments
///
/// * `session` - Open session (provides workspace root, session directory)
/// * `_python_path` - Unused (kept for API compatibility)
/// * `at` - Location string in "file:line:col" format
/// * `to` - New name for the symbol
/// * `filter` - Optional file filter specification
///
/// # Returns
///
/// JSON string containing the analysis result.
///
/// # Feature Requirements
///
/// Requires the `python` feature flag.
#[cfg(feature = "python")]
pub fn analyze_rename(
    session: &Session,
    _python_path: Option<PathBuf>,
    at: &str,
    to: &str,
    filter: Option<&FileFilterSpec>,
) -> Result<String, TugError> {
    // Parse location
    let location = Location::parse(at).ok_or_else(|| {
        TugError::invalid_args(format!(
            "invalid location format '{}', expected path:line:col",
            at
        ))
    })?;

    // Collect Python files in workspace (with optional filter)
    let files = collect_python_files_filtered(session.workspace_root(), filter)
        .map_err(|e| TugError::internal(format!("Failed to collect Python files: {}", e)))?;

    // Run native analysis - RenameError converts to TugError via From impl
    let analysis = analyze(session.workspace_root(), &files, &location, to)?;

    // Serialize to JSON
    let json = serde_json::to_string_pretty(&analysis)
        .map_err(|e| TugError::internal(format!("JSON serialization error: {}", e)))?;
    Ok(json)
}

/// Execute a rename operation.
///
/// # Arguments
///
/// * `session` - Open session (provides workspace root, session directory)
/// * `python_path` - Optional explicit Python path for verification
/// * `at` - Location string in "file:line:col" format
/// * `to` - New name for the symbol
/// * `verify_mode` - Verification mode after rename
/// * `apply` - Whether to apply changes to files
/// * `filter` - Optional file filter specification
///
/// # Returns
///
/// JSON string containing the rename result.
///
/// # Feature Requirements
///
/// Requires the `python` feature flag.
#[cfg(feature = "python")]
pub fn do_rename(
    session: &Session,
    python_path: Option<PathBuf>,
    at: &str,
    to: &str,
    verify_mode: VerificationMode,
    apply: bool,
    filter: Option<&FileFilterSpec>,
) -> Result<String, TugError> {
    // Parse location
    let location = Location::parse(at).ok_or_else(|| {
        TugError::invalid_args(format!(
            "invalid location format '{}', expected path:line:col",
            at
        ))
    })?;

    // Resolve Python interpreter for verification
    let python = resolve_python_path(python_path)?;

    // Collect Python files in workspace (with optional filter)
    let files = collect_python_files_filtered(session.workspace_root(), filter)
        .map_err(|e| TugError::internal(format!("Failed to collect Python files: {}", e)))?;

    // Execute native rename - RenameError converts to TugError via From impl
    let result = rename(
        session.workspace_root(),
        &files,
        &location,
        to,
        &python,
        verify_mode,
        apply,
    )?;

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
/// Otherwise, try common Python executable names in PATH.
#[cfg(feature = "python")]
fn resolve_python_path(explicit_path: Option<PathBuf>) -> Result<PathBuf, TugError> {
    if let Some(path) = explicit_path {
        return Ok(path);
    }

    // Try common Python executable names
    for name in &["python3", "python"] {
        if let Ok(path) = std::process::Command::new("which")
            .arg(name)
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        {
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    Err(TugError::internal(
        "Could not find Python interpreter. Please provide --python-path.".to_string(),
    ))
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
            let explicit = PathBuf::from("/usr/bin/python3.11");
            let result = resolve_python_path(Some(explicit.clone())).unwrap();

            assert_eq!(result, explicit);
        }

        #[test]
        fn explicit_path_overrides_auto_resolution() {
            // Even if a different Python could be resolved, the explicit path wins
            let explicit = PathBuf::from("/custom/python");
            let result = resolve_python_path(Some(explicit.clone())).unwrap();

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
            let result = analyze_rename(
                &session,
                Some(PathBuf::from("/usr/bin/python3")),
                "bad:input", // Missing column
                "bar",
                None, // No filter
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

            let result = do_rename(
                &session,
                Some(PathBuf::from("/usr/bin/python3")),
                "test.py:1", // Missing column
                "bar",
                VerificationMode::None,
                false,
                None, // No filter
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
        }

        #[test]
        fn analyze_rename_accepts_session() {
            // This test verifies the function signature accepts &Session
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            // Just verify the function can be called with Session
            // Result depends on Python availability - we only care about signature
            let _result = analyze_rename(&session, None, "test.py:1:5", "bar", None);
        }

        #[test]
        fn do_rename_accepts_session() {
            // This test verifies the function signature accepts &Session
            let workspace = create_test_workspace();
            let session = Session::open(workspace.path(), SessionOptions::default()).unwrap();

            // Just verify the function can be called with Session
            // Result depends on Python availability - we only care about signature
            let _result = do_rename(
                &session,
                None,
                "test.py:1:5",
                "bar",
                VerificationMode::None,
                false,
                None, // No filter
            );
        }
    }
}
