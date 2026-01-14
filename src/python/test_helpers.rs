//! Test helpers for Python-dependent tests.
//!
//! These helpers ensure tests fail loudly in CI when libcst is unavailable,
//! but skip gracefully in local development environments.

use std::path::PathBuf;

use crate::python::env::{resolve_python, ResolutionOptions};

/// Check if we're in a CI environment.
pub fn is_ci() -> bool {
    std::env::var("CI").is_ok() || std::env::var("GITHUB_ACTIONS").is_ok()
}

/// Find Python with libcst or handle appropriately.
///
/// This function is the primary entry point for tests that require Python with libcst.
///
/// # Behavior
///
/// - **In CI:** Panics with an actionable error if libcst is not available.
/// - **Locally:** Returns `None`, allowing the test to skip gracefully.
///
/// # Returns
///
/// `Some(PathBuf)` - Path to Python interpreter with libcst available.
/// `None` - libcst not available, test should skip (only in local dev).
///
/// # Panics
///
/// Panics in CI environments if libcst is not available.
///
/// # Example
///
/// ```ignore
/// #[test]
/// fn my_python_test() {
///     let Some(python) = require_python_with_libcst() else {
///         return; // Skip test locally if libcst unavailable
///     };
///     // Use python for test...
/// }
/// ```
pub fn require_python_with_libcst() -> Option<PathBuf> {
    // Try to resolve Python with libcst
    let temp_session = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(e) => {
            if is_ci() {
                panic!(
                    "CI environment: failed to create temp directory for Python resolution: {}",
                    e
                );
            }
            eprintln!(
                "Skipping test: failed to create temp directory for Python resolution: {}",
                e
            );
            return None;
        }
    };

    // Create the python subdirectory that resolve_python expects
    if let Err(e) = std::fs::create_dir_all(temp_session.path().join("python")) {
        if is_ci() {
            panic!("CI environment: failed to create python config dir: {}", e);
        }
        eprintln!("Skipping test: failed to create python config dir: {}", e);
        return None;
    }

    let options = ResolutionOptions::default().require_libcst();

    match resolve_python(temp_session.path(), &options) {
        Ok(env) if env.config.libcst_available => Some(env.config.interpreter_path),
        Ok(_) => {
            // Python found but libcst not available
            handle_libcst_unavailable()
        }
        Err(e) => {
            // Resolution failed entirely
            if is_ci() {
                panic!(
                    "CI environment requires Python with libcst but resolution failed.\n\n\
                     Error: {}\n\n\
                     Add to your CI workflow:\n  \
                       pip install libcst\n  \
                       export TUG_PYTHON=${{pythonLocation}}/bin/python\n\n\
                     Or bootstrap tug's managed venv:\n  \
                       cargo run -p tug -- toolchain python setup",
                    e
                );
            }
            eprintln!(
                "Skipping test: Python resolution failed: {}\n\
                 Run `tug toolchain python setup` to fix.",
                e
            );
            None
        }
    }
}

/// Handle the case where libcst is not available.
fn handle_libcst_unavailable() -> Option<PathBuf> {
    if is_ci() {
        panic!(
            "CI environment requires libcst but none found.\n\n\
             Add to your CI workflow:\n  \
               pip install libcst\n  \
               export TUG_PYTHON=${{pythonLocation}}/bin/python\n\n\
             Or bootstrap tug's managed venv:\n  \
               cargo run -p tug -- toolchain python setup"
        );
    }
    eprintln!(
        "Skipping test: libcst not available.\n\
         Run `tug toolchain python setup` to fix."
    );
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_ci_respects_ci_env() {
        // This test verifies the is_ci() function logic
        // We can't easily test the actual env vars without side effects,
        // but we can verify the function exists and returns a bool
        let _ = is_ci();
    }

    #[test]
    fn test_require_python_with_libcst_returns_option() {
        // This test verifies the function signature works
        // Actual behavior depends on environment
        let result = require_python_with_libcst();

        if let Some(python_path) = result {
            // If we got a path, it should exist
            assert!(
                python_path.exists(),
                "Returned Python path should exist: {:?}",
                python_path
            );
        }
        // If None, that's fine too (skip gracefully)
    }
}
