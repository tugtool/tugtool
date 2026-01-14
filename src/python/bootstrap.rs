//! Python environment bootstrapping.
//!
//! Creates and manages tug's own virtual environment with libcst.
//!
//! ## Overview
//!
//! This module provides automatic venv creation when no suitable Python
//! environment is found. The managed venv is stored at `.tug/venv`
//! (per-workspace) or `~/.tug/venv` (global fallback).
//!
//! ## Usage
//!
//! ```rust,ignore
//! use tugtool::python::bootstrap::{ensure_managed_venv, VenvLocation};
//!
//! // Create or validate managed venv in workspace
//! let result = ensure_managed_venv(VenvLocation::Workspace(session_dir), false)?;
//! println!("Python at: {}", result.python_path.display());
//! ```
//!
//! ## Bootstrap Strategy
//!
//! 1. **Find base Python**: Try `uv python find` first, then PATH
//! 2. **Create venv**: Prefer `uv venv`, fall back to `python -m venv`
//! 3. **Install libcst**: Prefer `uv pip install`, fall back to `pip install`
//! 4. **Validate**: Verify libcst is importable

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;

use super::env::{check_libcst, get_python_version, PYTHON_NAMES, VENV_BIN_DIR};

// ============================================================================
// Types
// ============================================================================

/// Location for managed virtual environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VenvLocation {
    /// Per-workspace: `<session_dir>/venv` (default).
    Workspace(PathBuf),
    /// Global: `~/.tug/venv` (fallback for read-only workspaces).
    Global,
}

impl VenvLocation {
    /// Get the absolute path to the venv directory.
    pub fn venv_dir(&self) -> PathBuf {
        match self {
            VenvLocation::Workspace(session_dir) => session_dir.join("venv"),
            VenvLocation::Global => global_venv_dir(),
        }
    }

    /// Get the absolute path to the Python interpreter in this venv.
    pub fn python_path(&self) -> PathBuf {
        let venv = self.venv_dir();
        #[cfg(windows)]
        {
            venv.join(VENV_BIN_DIR).join("python.exe")
        }
        #[cfg(not(windows))]
        {
            venv.join(VENV_BIN_DIR).join("python")
        }
    }

    /// Get the absolute path to pip in this venv.
    pub fn pip_path(&self) -> PathBuf {
        let venv = self.venv_dir();
        #[cfg(windows)]
        {
            venv.join(VENV_BIN_DIR).join("pip.exe")
        }
        #[cfg(not(windows))]
        {
            venv.join(VENV_BIN_DIR).join("pip")
        }
    }
}

/// Get the global venv directory (~/.tug/venv).
fn global_venv_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".tug")
        .join("venv")
}

/// Result of bootstrapping a managed venv.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapResult {
    /// Path to the Python interpreter in the managed venv.
    pub python_path: PathBuf,
    /// Path to the venv directory.
    pub venv_path: PathBuf,
    /// Python version in the venv.
    pub python_version: String,
    /// Installed libcst version.
    pub libcst_version: String,
    /// Whether the venv was created fresh (vs already existing).
    pub created_fresh: bool,
    /// Base Python used to create the venv.
    pub base_python_path: PathBuf,
}

/// Errors that can occur during bootstrap.
#[derive(Debug, Error)]
pub enum BootstrapError {
    /// No suitable Python 3.9+ found.
    #[error("no suitable Python 3.9+ found\n\n\
             Remediation:\n  \
             - Install Python 3.9+ via your package manager\n  \
             - Or: curl -LsSf https://astral.sh/uv/install.sh | sh && uv python install 3.11")]
    NoPythonFound,

    /// Python found but version too old.
    #[error("Python at {path} is version {version}, but 3.9+ is required\n\n\
             Remediation:\n  \
             - Install Python 3.9+ via your package manager\n  \
             - Or set $TUG_PYTHON to a newer Python")]
    PythonTooOld { path: PathBuf, version: String },

    /// Failed to create virtual environment.
    #[error("failed to create virtual environment at {path}: {reason}\n\n\
             Remediation:\n  \
             - Check write permissions for {path}\n  \
             - Try: tug python setup --global (uses ~/.tug/venv)\n  \
             - Or: set $TUG_PYTHON to an existing Python with libcst")]
    VenvCreationFailed { path: PathBuf, reason: String },

    /// Failed to install libcst.
    #[error("failed to install libcst: {reason}\n\n\
             Remediation:\n  \
             - Check network connectivity\n  \
             - Try: pip install libcst (then set $TUG_PYTHON)\n  \
             - Or: tug python setup --recreate")]
    LibcstInstallFailed { reason: String },

    /// Venv exists but is corrupted or invalid.
    #[error("managed venv at {path} is invalid: {reason}\n\n\
             Remediation:\n  \
             - Run: tug python setup --recreate\n  \
             - Or: rm -rf {path} && tug python setup")]
    VenvInvalid { path: PathBuf, reason: String },

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// ============================================================================
// Base Python Discovery
// ============================================================================

/// Find a base Python suitable for creating venvs.
///
/// Resolution order:
/// 1. `uv python find 3.11` (if uv is installed)
/// 2. `python3` from PATH
/// 3. `python` from PATH
///
/// The returned Python must be version 3.9+.
pub fn find_base_python() -> Result<PathBuf, BootstrapError> {
    // Try uv first (it manages Python installations)
    if let Some(path) = try_uv_python_find() {
        // Validate version
        match get_python_version(&path) {
            Ok(version) if version.meets_minimum() => return Ok(path),
            Ok(version) => {
                // uv returned old Python, try other sources
                tracing::debug!(
                    "uv returned Python {} at {}, too old",
                    version,
                    path.display()
                );
            }
            Err(e) => {
                tracing::debug!("uv Python at {} failed validation: {}", path.display(), e);
            }
        }
    }

    // Fall back to PATH search
    for name in PYTHON_NAMES {
        if let Ok(path) = which::which(name) {
            match get_python_version(&path) {
                Ok(version) if version.meets_minimum() => return Ok(path),
                Ok(version) => {
                    tracing::debug!(
                        "{} is version {}, too old (need 3.9+)",
                        path.display(),
                        version
                    );
                }
                Err(e) => {
                    tracing::debug!("Failed to get version for {}: {}", path.display(), e);
                }
            }
        }
    }

    Err(BootstrapError::NoPythonFound)
}

/// Try to find Python using uv.
fn try_uv_python_find() -> Option<PathBuf> {
    // Check if uv is available
    let uv_path = which::which("uv").ok()?;

    // Try to find Python 3.11 (good balance of features and compatibility)
    let output = Command::new(&uv_path)
        .args(["python", "find", "3.11"])
        .output()
        .ok()?;

    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() {
            let path = PathBuf::from(&path_str);
            if path.exists() {
                return Some(path);
            }
        }
    }

    // If 3.11 not found, try any Python 3.9+
    let output = Command::new(&uv_path)
        .args(["python", "find", ">=3.9"])
        .output()
        .ok()?;

    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() {
            let path = PathBuf::from(&path_str);
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

// ============================================================================
// Venv Management
// ============================================================================

/// Create or validate a managed virtual environment.
///
/// # Arguments
/// - `location`: Where to create/find the venv
/// - `recreate`: If true, delete and recreate existing venv
///
/// # Returns
/// - `Ok(BootstrapResult)` with venv details
/// - `Err(BootstrapError)` if creation fails
pub fn ensure_managed_venv(
    location: VenvLocation,
    recreate: bool,
) -> Result<BootstrapResult, BootstrapError> {
    let venv_dir = location.venv_dir();
    let python_path = location.python_path();

    // If recreate requested, remove existing venv
    if recreate && venv_dir.exists() {
        tracing::info!("Removing existing venv at {}", venv_dir.display());
        std::fs::remove_dir_all(&venv_dir)?;
    }

    // Check if venv already exists and is valid
    if venv_dir.exists() {
        match validate_managed_venv(&venv_dir) {
            Ok(true) => {
                // Venv is valid, return existing info
                return get_existing_venv_info(&location);
            }
            Ok(false) => {
                // Venv exists but invalid, remove it
                tracing::warn!("Invalid venv at {}, removing", venv_dir.display());
                std::fs::remove_dir_all(&venv_dir)?;
            }
            Err(e) => {
                tracing::warn!("Error validating venv: {}, removing", e);
                std::fs::remove_dir_all(&venv_dir)?;
            }
        }
    }

    // Find base Python for venv creation
    let base_python = find_base_python()?;
    tracing::info!(
        "Using base Python at {} for venv creation",
        base_python.display()
    );

    // Create the venv
    create_venv(&base_python, &venv_dir)?;

    // Install libcst
    install_libcst(&location)?;

    // Validate libcst is importable
    let (libcst_available, libcst_version) =
        check_libcst(&python_path).map_err(|e| BootstrapError::VenvInvalid {
            path: venv_dir.clone(),
            reason: format!("failed to check libcst: {}", e),
        })?;

    if !libcst_available {
        return Err(BootstrapError::LibcstInstallFailed {
            reason: "libcst import failed after installation".to_string(),
        });
    }

    let libcst_version = libcst_version.unwrap_or_else(|| "unknown".to_string());

    // Get Python version
    let python_version = get_python_version(&python_path)
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    Ok(BootstrapResult {
        python_path,
        venv_path: venv_dir,
        python_version,
        libcst_version,
        created_fresh: true,
        base_python_path: base_python,
    })
}

/// Create a virtual environment.
///
/// Prefers `uv venv` for speed, falls back to `python -m venv`.
fn create_venv(base_python: &Path, venv_dir: &Path) -> Result<(), BootstrapError> {
    // Ensure parent directory exists
    if let Some(parent) = venv_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Try uv first (much faster)
    if let Ok(uv_path) = which::which("uv") {
        tracing::debug!("Creating venv with uv at {}", venv_dir.display());

        let output = Command::new(&uv_path)
            .args(["venv", "--python"])
            .arg(base_python)
            .arg(venv_dir)
            .output()?;

        if output.status.success() {
            tracing::info!("Created venv with uv at {}", venv_dir.display());
            return Ok(());
        }

        // uv failed, log and fall through to python -m venv
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::debug!("uv venv failed: {}", stderr);
    }

    // Fall back to python -m venv
    tracing::debug!(
        "Creating venv with python -m venv at {}",
        venv_dir.display()
    );

    let output = Command::new(base_python)
        .args(["-m", "venv"])
        .arg(venv_dir)
        .output()?;

    if output.status.success() {
        tracing::info!("Created venv with python -m venv at {}", venv_dir.display());
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(BootstrapError::VenvCreationFailed {
            path: venv_dir.to_path_buf(),
            reason: stderr.to_string(),
        })
    }
}

/// Install libcst into the managed venv.
///
/// Prefers `uv pip install` for speed, falls back to `pip install`.
fn install_libcst(location: &VenvLocation) -> Result<(), BootstrapError> {
    let venv_dir = location.venv_dir();
    let pip_path = location.pip_path();

    // Try uv first (much faster)
    if let Ok(uv_path) = which::which("uv") {
        tracing::debug!("Installing libcst with uv pip");

        let output = Command::new(&uv_path)
            .args(["pip", "install", "--python"])
            .arg(location.python_path())
            .arg("libcst")
            .output()?;

        if output.status.success() {
            tracing::info!("Installed libcst with uv pip");
            return Ok(());
        }

        // uv failed, log and fall through to pip
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::debug!("uv pip install failed: {}", stderr);
    }

    // Fall back to pip
    if !pip_path.exists() {
        return Err(BootstrapError::VenvInvalid {
            path: venv_dir,
            reason: "pip not found in venv".to_string(),
        });
    }

    tracing::debug!("Installing libcst with pip");

    let output = Command::new(&pip_path)
        .args(["install", "libcst"])
        .output()?;

    if output.status.success() {
        tracing::info!("Installed libcst with pip");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(BootstrapError::LibcstInstallFailed {
            reason: stderr.to_string(),
        })
    }
}

/// Validate that an existing managed venv is usable.
///
/// Checks:
/// - Python interpreter exists and is executable
/// - Python version is 3.9+
/// - libcst is importable
///
/// Returns `Ok(true)` if valid, `Ok(false)` if invalid but not an error,
/// `Err` if validation itself failed.
pub fn validate_managed_venv(venv_dir: &Path) -> Result<bool, BootstrapError> {
    // Check Python interpreter exists
    #[cfg(windows)]
    let python_path = venv_dir.join(VENV_BIN_DIR).join("python.exe");
    #[cfg(not(windows))]
    let python_path = venv_dir.join(VENV_BIN_DIR).join("python");

    if !python_path.exists() {
        return Ok(false);
    }

    // Check Python version
    let version = match get_python_version(&python_path) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };

    if !version.meets_minimum() {
        return Ok(false);
    }

    // Check libcst is importable
    let (libcst_available, _) = check_libcst(&python_path).map_err(|e| BootstrapError::Io(
        std::io::Error::other(e.to_string()),
    ))?;

    Ok(libcst_available)
}

/// Get info about an existing valid venv.
fn get_existing_venv_info(location: &VenvLocation) -> Result<BootstrapResult, BootstrapError> {
    let venv_dir = location.venv_dir();
    let python_path = location.python_path();

    // Get Python version
    let python_version = get_python_version(&python_path)
        .map(|v| v.to_string())
        .map_err(|e| BootstrapError::VenvInvalid {
            path: venv_dir.clone(),
            reason: format!("failed to get Python version: {}", e),
        })?;

    // Get libcst version
    let (_, libcst_version) =
        check_libcst(&python_path).map_err(|e| BootstrapError::VenvInvalid {
            path: venv_dir.clone(),
            reason: format!("failed to check libcst: {}", e),
        })?;

    let libcst_version = libcst_version.unwrap_or_else(|| "unknown".to_string());

    // Try to determine base Python (may not be available for existing venvs)
    let base_python_path = detect_base_python(&venv_dir).unwrap_or_else(|| PathBuf::from("unknown"));

    Ok(BootstrapResult {
        python_path,
        venv_path: venv_dir,
        python_version,
        libcst_version,
        created_fresh: false,
        base_python_path,
    })
}

/// Try to detect the base Python used to create a venv.
///
/// This reads the pyvenv.cfg file if present.
fn detect_base_python(venv_dir: &Path) -> Option<PathBuf> {
    let cfg_path = venv_dir.join("pyvenv.cfg");
    if !cfg_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&cfg_path).ok()?;

    // Look for "home = /path/to/python/bin" line
    for line in content.lines() {
        if let Some(home) = line.strip_prefix("home = ") {
            let home = home.trim();
            // The "home" is the directory containing python, not python itself
            #[cfg(windows)]
            let python = PathBuf::from(home).join("python.exe");
            #[cfg(not(windows))]
            let python = PathBuf::from(home).join("python");

            if python.exists() {
                return Some(python);
            }

            // Sometimes it's python3
            #[cfg(not(windows))]
            {
                let python3 = PathBuf::from(home).join("python3");
                if python3.exists() {
                    return Some(python3);
                }
            }
        }
    }

    None
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_venv_location_workspace_paths() {
        let session_dir = PathBuf::from("/workspace/.tug");
        let location = VenvLocation::Workspace(session_dir);

        assert_eq!(
            location.venv_dir(),
            PathBuf::from("/workspace/.tug/venv")
        );

        #[cfg(windows)]
        assert_eq!(
            location.python_path(),
            PathBuf::from("/workspace/.tug/venv/Scripts/python.exe")
        );
        #[cfg(not(windows))]
        assert_eq!(
            location.python_path(),
            PathBuf::from("/workspace/.tug/venv/bin/python")
        );

        #[cfg(windows)]
        assert_eq!(
            location.pip_path(),
            PathBuf::from("/workspace/.tug/venv/Scripts/pip.exe")
        );
        #[cfg(not(windows))]
        assert_eq!(
            location.pip_path(),
            PathBuf::from("/workspace/.tug/venv/bin/pip")
        );
    }

    #[test]
    fn test_venv_location_global_paths() {
        let location = VenvLocation::Global;

        // Global venv should be in ~/.tug/venv
        let expected_parent = dirs::home_dir().unwrap().join(".tug");
        assert_eq!(location.venv_dir(), expected_parent.join("venv"));
    }

    #[test]
    fn test_bootstrap_error_messages() {
        // Test that error messages include remediation steps
        let err = BootstrapError::NoPythonFound;
        let msg = err.to_string();
        assert!(msg.contains("Remediation"));
        assert!(msg.contains("Python 3.9+"));

        let err = BootstrapError::VenvCreationFailed {
            path: PathBuf::from("/test/venv"),
            reason: "permission denied".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("Remediation"));
        assert!(msg.contains("permissions"));
        assert!(msg.contains("/test/venv"));

        let err = BootstrapError::LibcstInstallFailed {
            reason: "network error".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("Remediation"));
        assert!(msg.contains("network"));
    }

    #[test]
    fn test_validate_nonexistent_venv() {
        let temp = TempDir::new().unwrap();
        let venv_dir = temp.path().join("nonexistent");

        // Non-existent venv should return Ok(false)
        let result = validate_managed_venv(&venv_dir);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_validate_empty_venv() {
        let temp = TempDir::new().unwrap();
        let venv_dir = temp.path().join("venv");
        std::fs::create_dir_all(&venv_dir).unwrap();

        // Empty venv directory should return Ok(false)
        let result = validate_managed_venv(&venv_dir);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_detect_base_python_no_config() {
        let temp = TempDir::new().unwrap();
        let venv_dir = temp.path().join("venv");
        std::fs::create_dir_all(&venv_dir).unwrap();

        // No pyvenv.cfg should return None
        let result = detect_base_python(&venv_dir);
        assert!(result.is_none());
    }

    #[test]
    fn test_detect_base_python_with_config() {
        let temp = TempDir::new().unwrap();
        let venv_dir = temp.path().join("venv");
        std::fs::create_dir_all(&venv_dir).unwrap();

        // Write a pyvenv.cfg with a non-existent home
        let cfg_content = "home = /nonexistent/python/bin\nversion = 3.11.4";
        std::fs::write(venv_dir.join("pyvenv.cfg"), cfg_content).unwrap();

        // Should return None since the path doesn't exist
        let result = detect_base_python(&venv_dir);
        assert!(result.is_none());
    }

    // Integration tests (require Python to be installed)

    #[test]
    fn test_find_base_python_integration() {
        // This test may fail if Python is not installed, which is acceptable
        match find_base_python() {
            Ok(path) => {
                assert!(path.exists(), "Found Python should exist");
                // Verify it's actually Python 3.9+
                let version = get_python_version(&path).unwrap();
                assert!(version.meets_minimum(), "Python should be 3.9+");
            }
            Err(BootstrapError::NoPythonFound) => {
                // This is acceptable if no Python 3.9+ is installed
            }
            Err(e) => panic!("Unexpected error: {}", e),
        }
    }

    #[test]
    fn test_ensure_managed_venv_creates_venv() {
        // This test requires Python to be installed and creates a real venv
        find_base_python().expect("Python 3.9+ is required to run tests");

        let temp = TempDir::new().unwrap();
        let session_dir = temp.path().to_path_buf();
        let location = VenvLocation::Workspace(session_dir);

        match ensure_managed_venv(location.clone(), false) {
            Ok(result) => {
                assert!(result.python_path.exists(), "Python should exist");
                assert!(result.venv_path.exists(), "Venv should exist");
                assert!(result.created_fresh, "Should be freshly created");
                assert!(!result.libcst_version.is_empty(), "Should have libcst version");

                // Calling again should return existing venv
                let result2 = ensure_managed_venv(location.clone(), false).unwrap();
                assert!(!result2.created_fresh, "Should not be freshly created");
            }
            Err(BootstrapError::LibcstInstallFailed { reason }) => {
                // Network issues are acceptable in test environments
                eprintln!("Skipping test: libcst install failed: {}", reason);
            }
            Err(e) => panic!("Unexpected error: {}", e),
        }
    }

    #[test]
    fn test_ensure_managed_venv_recreate() {
        find_base_python().expect("Python 3.9+ is required to run tests");

        let temp = TempDir::new().unwrap();
        let session_dir = temp.path().to_path_buf();
        let location = VenvLocation::Workspace(session_dir);

        // First creation
        match ensure_managed_venv(location.clone(), false) {
            Ok(result1) => {
                assert!(result1.created_fresh);

                // Recreate should create fresh again
                match ensure_managed_venv(location, true) {
                    Ok(result2) => {
                        assert!(result2.created_fresh, "Recreate should create fresh");
                    }
                    Err(BootstrapError::LibcstInstallFailed { .. }) => {
                        // Network issues acceptable
                    }
                    Err(e) => panic!("Unexpected error on recreate: {}", e),
                }
            }
            Err(BootstrapError::LibcstInstallFailed { reason }) => {
                eprintln!("Skipping test: libcst install failed: {}", reason);
            }
            Err(e) => panic!("Unexpected error: {}", e),
        }
    }
}
