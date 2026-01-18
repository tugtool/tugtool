//! Python code verification pipeline.
//!
//! Provides syntax checking, test running, and type checking for Python code.
//! This module contains Python-specific verification types and functions.

use std::io;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use thiserror::Error;

// ============================================================================
// Types
// ============================================================================

/// Verification mode for Python operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum VerificationMode {
    /// No verification.
    None,
    /// Syntax check only (compileall).
    #[default]
    Syntax,
    /// Syntax + run tests.
    Tests,
    /// Syntax + tests + type checking.
    TypeCheck,
}

/// Status of verification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    /// All checks passed.
    Passed,
    /// One or more checks failed.
    Failed,
    /// Verification was skipped.
    Skipped,
}

/// Result of a single verification check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationCheck {
    /// Check name (e.g., "compileall", "pytest").
    pub name: String,
    /// Check status.
    pub status: VerificationStatus,
    /// Duration in milliseconds.
    pub duration_ms: u64,
    /// Output (stdout + stderr).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

/// Result of verification pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    /// Overall status.
    pub status: VerificationStatus,
    /// Verification mode used.
    pub mode: VerificationMode,
    /// Individual checks.
    pub checks: Vec<VerificationCheck>,
}

impl VerificationResult {
    /// Create a passed result.
    pub fn passed(mode: VerificationMode, checks: Vec<VerificationCheck>) -> Self {
        VerificationResult {
            status: VerificationStatus::Passed,
            mode,
            checks,
        }
    }

    /// Create a failed result.
    pub fn failed(mode: VerificationMode, checks: Vec<VerificationCheck>) -> Self {
        VerificationResult {
            status: VerificationStatus::Failed,
            mode,
            checks,
        }
    }

    /// Create a skipped result.
    pub fn skipped() -> Self {
        VerificationResult {
            status: VerificationStatus::Skipped,
            mode: VerificationMode::None,
            checks: vec![],
        }
    }
}

// ============================================================================
// Error Types
// ============================================================================

/// Error from verification.
#[derive(Debug, Error)]
pub enum VerificationError {
    /// Verification failed.
    #[error("verification failed ({status:?}): {output}")]
    Failed {
        status: VerificationStatus,
        output: String,
    },

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
}

/// Result type for verification operations.
pub type VerificationResultType<T> = Result<T, VerificationError>;

// ============================================================================
// Verification Functions
// ============================================================================

/// Run Python verification pipeline on a directory.
///
/// # Arguments
///
/// * `python_path` - Path to the Python interpreter
/// * `target_dir` - Directory to verify (typically sandbox workspace)
/// * `mode` - Verification mode
///
/// # Example
///
/// ```ignore
/// let result = run_verification(&python_path, sandbox.path(), VerificationMode::Syntax)?;
/// if result.status == VerificationStatus::Passed {
///     // Safe to apply changes
/// }
/// ```
pub fn run_verification(
    python_path: &Path,
    target_dir: &Path,
    mode: VerificationMode,
) -> VerificationResultType<VerificationResult> {
    if mode == VerificationMode::None {
        return Ok(VerificationResult::skipped());
    }

    let mut checks = Vec::new();

    // Always run compileall for syntax checking
    let compileall_check = run_compileall(python_path, target_dir)?;
    let syntax_passed = compileall_check.status == VerificationStatus::Passed;
    checks.push(compileall_check);

    // For Tests mode, run pytest (if syntax passed)
    if mode == VerificationMode::Tests && syntax_passed {
        if let Some(pytest_check) = run_pytest(python_path, target_dir)? {
            checks.push(pytest_check);
        }
    }

    // For TypeCheck mode, run mypy (if syntax passed)
    if mode == VerificationMode::TypeCheck && syntax_passed {
        // Run pytest first
        if let Some(pytest_check) = run_pytest(python_path, target_dir)? {
            checks.push(pytest_check);
        }
        // Then run mypy
        if let Some(mypy_check) = run_mypy(python_path, target_dir)? {
            checks.push(mypy_check);
        }
    }

    // Check overall status
    let overall_status = if checks
        .iter()
        .all(|c| c.status == VerificationStatus::Passed)
    {
        VerificationStatus::Passed
    } else {
        VerificationStatus::Failed
    };

    Ok(VerificationResult {
        status: overall_status,
        mode,
        checks,
    })
}

/// Run compileall syntax check.
pub fn run_compileall(
    python_path: &Path,
    target_dir: &Path,
) -> VerificationResultType<VerificationCheck> {
    let start = Instant::now();
    let output = Command::new(python_path)
        .args(["-m", "compileall", "-q", "."])
        .current_dir(target_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let status = if output.status.success() {
        VerificationStatus::Passed
    } else {
        VerificationStatus::Failed
    };

    let combined_output = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    Ok(VerificationCheck {
        name: "compileall".to_string(),
        status,
        duration_ms,
        output: if combined_output.is_empty() {
            None
        } else {
            Some(combined_output)
        },
    })
}

/// Run pytest (for VerificationMode::Tests).
///
/// Returns None if pytest is not available.
pub fn run_pytest(
    python_path: &Path,
    target_dir: &Path,
) -> VerificationResultType<Option<VerificationCheck>> {
    // Check if pytest is available
    let check = Command::new(python_path)
        .args(["-m", "pytest", "--version"])
        .current_dir(target_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if check.map(|s| !s.success()).unwrap_or(true) {
        // pytest not available, skip
        return Ok(None);
    }

    let start = Instant::now();
    let output = Command::new(python_path)
        .args(["-m", "pytest", "-q", "--tb=short"])
        .current_dir(target_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let status = if output.status.success() {
        VerificationStatus::Passed
    } else {
        VerificationStatus::Failed
    };

    let combined_output = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    Ok(Some(VerificationCheck {
        name: "pytest".to_string(),
        status,
        duration_ms,
        output: if combined_output.is_empty() {
            None
        } else {
            Some(combined_output)
        },
    }))
}

/// Run mypy (for VerificationMode::TypeCheck).
///
/// Returns None if mypy is not available.
pub fn run_mypy(
    python_path: &Path,
    target_dir: &Path,
) -> VerificationResultType<Option<VerificationCheck>> {
    // Check if mypy is available
    let check = Command::new(python_path)
        .args(["-m", "mypy", "--version"])
        .current_dir(target_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if check.map(|s| !s.success()).unwrap_or(true) {
        // mypy not available, skip
        return Ok(None);
    }

    let start = Instant::now();
    let output = Command::new(python_path)
        .args(["-m", "mypy", "."])
        .current_dir(target_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let status = if output.status.success() {
        VerificationStatus::Passed
    } else {
        VerificationStatus::Failed
    };

    let combined_output = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    Ok(Some(VerificationCheck {
        name: "mypy".to_string(),
        status,
        duration_ms,
        output: if combined_output.is_empty() {
            None
        } else {
            Some(combined_output)
        },
    }))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_result_passed() {
        let result = VerificationResult::passed(
            VerificationMode::Syntax,
            vec![VerificationCheck {
                name: "compileall".to_string(),
                status: VerificationStatus::Passed,
                duration_ms: 100,
                output: None,
            }],
        );
        assert_eq!(result.status, VerificationStatus::Passed);
        assert_eq!(result.mode, VerificationMode::Syntax);
    }

    #[test]
    fn verification_result_failed() {
        let result = VerificationResult::failed(
            VerificationMode::Syntax,
            vec![VerificationCheck {
                name: "compileall".to_string(),
                status: VerificationStatus::Failed,
                duration_ms: 50,
                output: Some("SyntaxError".to_string()),
            }],
        );
        assert_eq!(result.status, VerificationStatus::Failed);
    }

    #[test]
    fn verification_result_skipped() {
        let result = VerificationResult::skipped();
        assert_eq!(result.status, VerificationStatus::Skipped);
        assert_eq!(result.mode, VerificationMode::None);
    }

    #[test]
    fn verification_mode_default() {
        let mode = VerificationMode::default();
        assert_eq!(mode, VerificationMode::Syntax);
    }
}
