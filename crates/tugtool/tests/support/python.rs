//! Python execution helpers for integration tests.
//!
//! Provides utilities to:
//! - Check if Python 3.10+ is available
//! - Check if pytest is available
//! - Run pytest on a directory and capture results
//!
//! Honors the TUG_PYTHON environment variable if set.

use std::env;
use std::path::Path;
use std::process::Command;

/// Result of a pytest execution.
#[derive(Debug)]
#[allow(dead_code)]
pub struct PytestResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Check if a Python command is version 3.10+.
///
/// Note: `python --version` may write to stdout OR stderr depending on version.
fn is_python_310_plus(cmd: &str) -> bool {
    if let Ok(output) = Command::new(cmd).arg("--version").output() {
        if output.status.success() {
            // Check both stdout and stderr - Python 2.x writes to stderr,
            // Python 3.4+ writes to stdout, but some builds vary
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let version = if stdout.starts_with("Python") {
                stdout
            } else {
                stderr
            };

            // Parse "Python 3.X.Y" - we need X >= 10
            if let Some(rest) = version.strip_prefix("Python 3.") {
                if let Some(minor_str) = rest.split('.').next() {
                    if let Ok(minor) = minor_str.parse::<u32>() {
                        return minor >= 10;
                    }
                }
            }
        }
    }
    false
}

/// Find a suitable Python 3.10+ command.
///
/// Checks in order:
/// 1. TUG_PYTHON environment variable (if set and valid)
/// 2. "python3" in PATH
/// 3. "python" in PATH
///
/// Returns the command string to use, or None if no suitable Python found.
pub fn find_python() -> Option<String> {
    // First, check TUG_PYTHON env var (already used by CI)
    if let Ok(tug_python) = env::var("TUG_PYTHON") {
        if is_python_310_plus(&tug_python) {
            return Some(tug_python);
        }
    }

    // Fall back to PATH discovery
    for cmd in &["python3", "python"] {
        if is_python_310_plus(cmd) {
            return Some(cmd.to_string());
        }
    }
    None
}

/// Check if pytest is available via the given Python command.
pub fn pytest_available(python_cmd: &str) -> bool {
    Command::new(python_cmd)
        .args(["-m", "pytest", "--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if both Python 3.10+ and pytest are available.
///
/// Returns the Python command to use, or None if prerequisites are missing.
pub fn pytest_ready() -> Option<String> {
    let python = find_python()?;
    if pytest_available(&python) {
        Some(python)
    } else {
        None
    }
}

/// Run pytest on the specified directory.
///
/// # Arguments
/// - `python_cmd`: The Python command to use (e.g., "python3")
/// - `dir`: The directory containing tests (pytest will look for `tests/` or `test_*.py`)
/// - `extra_args`: Additional arguments to pass to pytest
///
/// # Returns
/// `PytestResult` with success status and captured output.
pub fn run_pytest(python_cmd: &str, dir: &Path, extra_args: &[&str]) -> PytestResult {
    let mut cmd = Command::new(python_cmd);
    cmd.current_dir(dir);
    cmd.args(["-m", "pytest"]);
    cmd.args(extra_args);

    match cmd.output() {
        Ok(output) => PytestResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
        },
        Err(e) => PytestResult {
            success: false,
            stdout: String::new(),
            stderr: format!("Failed to execute pytest: {}", e),
            exit_code: None,
        },
    }
}

/// Macro to skip a test if pytest is not available.
///
/// Usage:
/// ```ignore
/// #[test]
/// fn test_requires_pytest() {
///     let python = skip_if_no_pytest!();
///     // ... rest of test using `python`
/// }
/// ```
#[macro_export]
macro_rules! skip_if_no_pytest {
    () => {
        match $crate::support::python::pytest_ready() {
            Some(python) => python,
            None => {
                eprintln!(
                    "SKIPPED: pytest not available (need Python 3.10+ with pytest installed)"
                );
                return;
            }
        }
    };
}
