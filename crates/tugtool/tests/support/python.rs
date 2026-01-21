//! Python execution helpers for integration tests.
//!
//! Provides utilities to:
//! - Find or create a Python 3.11 virtual environment
//! - Check if pytest is available
//! - Run pytest on a directory and capture results
//!
//! **Environment discovery order:**
//! 1. `TUG_PYTHON` environment variable (if set and valid)
//! 2. Existing venv at `.tug-test-venv/` (if valid with pytest)
//! 3. Create venv with `uv` (if `uv` is available)
//! 4. Return None with helpful error message

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// Cached Python environment.
/// Computed once per test run and reused. Panics if unavailable.
static PYTHON_ENV: OnceLock<PythonEnv> = OnceLock::new();

/// A validated Python environment with pytest available.
#[derive(Debug, Clone)]
pub struct PythonEnv {
    /// Path to the Python executable
    pub python_path: PathBuf,
    /// Path to the venv directory (None if using TUG_PYTHON directly)
    pub venv_path: Option<PathBuf>,
}

impl PythonEnv {
    /// Get the Python command as a string for Command::new()
    pub fn python_cmd(&self) -> &Path {
        &self.python_path
    }
}

/// Result of a pytest execution.
#[derive(Debug)]
#[allow(dead_code)]
pub struct PytestResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Get the workspace root (where Cargo.toml lives).
fn workspace_root() -> Option<PathBuf> {
    // Start from CARGO_MANIFEST_DIR if available, otherwise current dir
    let start = env::var("CARGO_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::current_dir().unwrap_or_default());

    // Walk up to find workspace root (has Cargo.toml with [workspace])
    let mut current = start.as_path();
    loop {
        let cargo_toml = current.join("Cargo.toml");
        if cargo_toml.exists() {
            // Check if this is the workspace root
            if let Ok(contents) = std::fs::read_to_string(&cargo_toml) {
                if contents.contains("[workspace]") {
                    return Some(current.to_path_buf());
                }
            }
        }
        current = current.parent()?;
    }
}

/// Path to the project-local test venv.
fn test_venv_path() -> Option<PathBuf> {
    workspace_root().map(|root| root.join(".tug-test-venv"))
}

/// Get the Python executable path within a venv.
fn venv_python(venv_path: &Path) -> PathBuf {
    if cfg!(windows) {
        venv_path.join("Scripts").join("python.exe")
    } else {
        venv_path.join("bin").join("python")
    }
}

/// Check if a Python executable is valid (exists and is Python 3.10+).
fn is_valid_python(python_path: &Path) -> bool {
    if !python_path.exists() {
        return false;
    }

    Command::new(python_path)
        .args(["--version"])
        .output()
        .map(|output| {
            if !output.status.success() {
                return false;
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let version = if stdout.starts_with("Python") {
                stdout
            } else {
                stderr
            };

            // Parse "Python 3.X.Y" - we need X >= 10
            version
                .strip_prefix("Python 3.")
                .and_then(|rest| rest.split('.').next())
                .and_then(|minor_str| minor_str.parse::<u32>().ok())
                .map(|minor| minor >= 10)
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// Check if pytest is available via the given Python executable.
fn has_pytest(python_path: &Path) -> bool {
    Command::new(python_path)
        .args(["-m", "pytest", "--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Check if uv is available in PATH.
fn has_uv() -> bool {
    Command::new("uv")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Create a venv using uv and install pytest.
fn create_venv_with_uv(venv_path: &Path) -> Result<(), String> {
    eprintln!(
        "Creating test venv at {} with uv...",
        venv_path.display()
    );

    // Create venv with Python 3.11
    let status = Command::new("uv")
        .args(["venv", "--python", "3.11"])
        .arg(venv_path)
        .status()
        .map_err(|e| format!("Failed to run uv venv: {}", e))?;

    if !status.success() {
        return Err("uv venv failed".to_string());
    }

    // Install pytest into the venv
    let status = Command::new("uv")
        .args(["pip", "install", "--python"])
        .arg(venv_python(venv_path))
        .arg("pytest")
        .status()
        .map_err(|e| format!("Failed to run uv pip install: {}", e))?;

    if !status.success() {
        return Err("uv pip install pytest failed".to_string());
    }

    eprintln!("Test venv created successfully.");
    Ok(())
}

/// Find or create a Python environment suitable for running pytest.
///
/// This function is memoized - it only runs once per process.
/// Panics if the environment cannot be created (install uv to fix).
fn find_or_create_python_env() -> PythonEnv {
    // 1. Check TUG_PYTHON environment variable
    if let Ok(tug_python) = env::var("TUG_PYTHON") {
        let python_path = PathBuf::from(&tug_python);
        if is_valid_python(&python_path) && has_pytest(&python_path) {
            return PythonEnv {
                python_path,
                venv_path: None,
            };
        } else if is_valid_python(&python_path) {
            eprintln!(
                "WARNING: TUG_PYTHON={} is valid Python but pytest is not installed",
                tug_python
            );
        } else {
            eprintln!(
                "WARNING: TUG_PYTHON={} is not a valid Python 3.10+ executable",
                tug_python
            );
        }
    }

    // 2. Check existing .tug-test-venv
    if let Some(venv_path) = test_venv_path() {
        let python_path = venv_python(&venv_path);
        if is_valid_python(&python_path) && has_pytest(&python_path) {
            return PythonEnv {
                python_path,
                venv_path: Some(venv_path),
            };
        }
    }

    // 3. Try to create venv with uv
    if has_uv() {
        if let Some(venv_path) = test_venv_path() {
            // Remove corrupted venv if it exists but is invalid
            if venv_path.exists() {
                eprintln!(
                    "Existing venv at {} is invalid, recreating...",
                    venv_path.display()
                );
                let _ = std::fs::remove_dir_all(&venv_path);
            }

            if create_venv_with_uv(&venv_path).is_ok() {
                let python_path = venv_python(&venv_path);
                if is_valid_python(&python_path) && has_pytest(&python_path) {
                    return PythonEnv {
                        python_path,
                        venv_path: Some(venv_path),
                    };
                }
            }
        }
    }

    // 4. No Python available - FAIL LOUDLY
    panic!(
        "\n\
        ============================================================\n\
        FATAL: Python test environment not available.\n\
        \n\
        Install uv to enable automatic venv creation:\n\
           curl -LsSf https://astral.sh/uv/install.sh | sh\n\
        \n\
        Then re-run the tests. The venv will be created automatically.\n\
        ============================================================\n"
    );
}

/// Get the Python environment, creating it if necessary.
///
/// This function caches its result - the environment is only discovered/created
/// once per process, then reused for all tests.
///
/// Panics if the environment cannot be created (install uv to fix).
pub fn get_python_env() -> &'static PythonEnv {
    PYTHON_ENV.get_or_init(find_or_create_python_env)
}

/// Run pytest on the specified directory.
///
/// # Arguments
/// - `python_env`: The Python environment to use
/// - `dir`: The directory containing tests
/// - `extra_args`: Additional arguments to pass to pytest
///
/// # Returns
/// `PytestResult` with success status and captured output.
pub fn run_pytest(python_env: &PythonEnv, dir: &Path, extra_args: &[&str]) -> PytestResult {
    run_pytest_with_cmd(python_env.python_cmd(), dir, extra_args)
}

/// Run pytest using a Python command path directly.
fn run_pytest_with_cmd(python_cmd: &Path, dir: &Path, extra_args: &[&str]) -> PytestResult {
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

