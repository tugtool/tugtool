//! Test helpers for Python-dependent tests.
//!
//! These helpers ensure tests FAIL LOUDLY when libcst is unavailable.
//! No silent skipping. If you can't run the test, you need to fix your environment.

use std::path::PathBuf;

use crate::env::{check_libcst, resolve_python, ResolutionOptions, VENV_BIN_DIR};

/// Get Python with libcst, or panic with instructions.
///
/// This function is the ONLY entry point for tests that require Python with libcst.
///
/// Resolution order:
/// 1. Project's managed venv at `CARGO_MANIFEST_DIR/.tug/venv` (set up by `tug toolchain python setup`)
/// 2. Standard resolution via `resolve_python` (checks `$TUG_PYTHON`, `$VIRTUAL_ENV`, etc.)
///
/// # Panics
///
/// ALWAYS panics if libcst is not available. No silent skipping.
///
/// # Example
///
/// ```ignore
/// #[test]
/// fn my_python_test() {
///     let python = require_python_with_libcst();
///     // Use python for test...
/// }
/// ```
pub fn require_python_with_libcst() -> PathBuf {
    // First, check the project's managed venv (created by `tug toolchain python setup`)
    // CARGO_MANIFEST_DIR points to crates/tugtool-python/, so we go up two levels to workspace root
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    let project_venv_python = workspace_root
        .join(".tug")
        .join("venv")
        .join(VENV_BIN_DIR)
        .join("python");

    if project_venv_python.exists() {
        if let Ok((true, _)) = check_libcst(&project_venv_python) {
            return project_venv_python;
        }
    }

    // Fall back to standard resolution
    let temp_session = tempfile::tempdir().unwrap_or_else(|e| {
        panic!(
            "Failed to create temp directory for Python resolution: {}\n\n\
             This is required for running tests.",
            e
        )
    });

    // Create the python subdirectory that resolve_python expects
    std::fs::create_dir_all(temp_session.path().join("python"))
        .unwrap_or_else(|e| panic!("Failed to create python config dir: {}", e));

    let options = ResolutionOptions::default().require_libcst();

    match resolve_python(temp_session.path(), &options) {
        Ok(env) if env.config.libcst_available => env.config.interpreter_path,
        Ok(_) => {
            panic!(
                "Python found but libcst is NOT installed.\n\n\
                 To fix, run ONE of:\n\
                 \n\
                   1. tug toolchain python setup\n\
                 \n\
                   2. pip install libcst\n\
                 \n\
                 Tests CANNOT be skipped. Fix your environment."
            );
        }
        Err(e) => {
            panic!(
                "Python with libcst is REQUIRED but resolution failed.\n\n\
                 Error: {}\n\n\
                 To fix, run ONE of:\n\
                 \n\
                   1. tug toolchain python setup\n\
                 \n\
                   2. pip install libcst\n\
                 \n\
                 Tests CANNOT be skipped. Fix your environment.",
                e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_require_python_with_libcst_returns_valid_path() {
        let python_path = require_python_with_libcst();
        assert!(
            python_path.exists(),
            "Returned Python path should exist: {:?}",
            python_path
        );
    }
}
