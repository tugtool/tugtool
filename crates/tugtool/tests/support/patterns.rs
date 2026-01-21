//! Pattern assertion infrastructure for integration tests.
//!
//! Provides targeted verification of refactoring outcomes without requiring
//! a full test suite to pass. Pattern assertions check that specific expected
//! changes were made to files after a refactoring operation.
//!
//! # Example
//!
//! ```ignore
//! use crate::support::patterns::{PatternAssertion, AssertionKind, check_patterns};
//!
//! let assertions = vec![
//!     PatternAssertion::contains("core/date.py", "class CalendarDate:", "Class was renamed"),
//!     PatternAssertion::not_contains("core/date.py", "class Date:", "Old name removed"),
//! ];
//!
//! check_patterns(workspace_path, &assertions).expect("Pattern assertions failed");
//! ```

// Allow dead code - this module provides infrastructure that will be used
// by integration tests after Task 9 is complete
#![allow(dead_code)]

use std::fs;
use std::path::Path;

// ============================================================================
// Types
// ============================================================================

/// A single pattern assertion to verify against a file.
#[derive(Debug, Clone)]
pub struct PatternAssertion {
    /// Relative path to the file to check.
    pub file: String,
    /// The type of assertion to perform.
    pub assertion: AssertionKind,
    /// The pattern to check (literal string or regex).
    pub pattern: String,
    /// Human-readable description for error messages.
    pub description: String,
}

/// The kind of pattern assertion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssertionKind {
    /// File contains the literal pattern.
    Contains,
    /// File does NOT contain the literal pattern.
    NotContains,
    /// File content matches the regex pattern.
    Matches,
    /// File content does NOT match the regex pattern.
    NotMatches,
}

/// Result of checking a single pattern assertion.
#[derive(Debug)]
pub struct AssertionResult {
    pub assertion: PatternAssertion,
    pub passed: bool,
    pub actual_content: Option<String>,
    pub error: Option<String>,
}

/// Error returned when pattern assertions fail.
#[derive(Debug)]
pub struct PatternAssertionError {
    pub failures: Vec<AssertionResult>,
}

impl std::fmt::Display for PatternAssertionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Pattern assertion failures:")?;
        for result in &self.failures {
            writeln!(f)?;
            writeln!(f, "  File: {}", result.assertion.file)?;
            writeln!(f, "  Description: {}", result.assertion.description)?;
            writeln!(
                f,
                "  Assertion: {:?} {:?}",
                result.assertion.assertion, result.assertion.pattern
            )?;
            if let Some(ref error) = result.error {
                writeln!(f, "  Error: {}", error)?;
            }
            if let Some(ref content) = result.actual_content {
                // Show a snippet of the actual content for debugging
                let preview: String = content.chars().take(500).collect();
                let truncated = if content.len() > 500 { "..." } else { "" };
                writeln!(f, "  Actual content preview:\n{}{}", preview, truncated)?;
            }
        }
        Ok(())
    }
}

impl std::error::Error for PatternAssertionError {}

// ============================================================================
// PatternAssertion Constructors
// ============================================================================

impl PatternAssertion {
    /// Create a new pattern assertion.
    pub fn new(
        file: impl Into<String>,
        assertion: AssertionKind,
        pattern: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            file: file.into(),
            assertion,
            pattern: pattern.into(),
            description: description.into(),
        }
    }

    /// Assert that a file contains a literal pattern.
    pub fn contains(
        file: impl Into<String>,
        pattern: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self::new(file, AssertionKind::Contains, pattern, description)
    }

    /// Assert that a file does NOT contain a literal pattern.
    pub fn not_contains(
        file: impl Into<String>,
        pattern: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self::new(file, AssertionKind::NotContains, pattern, description)
    }

    /// Assert that a file matches a regex pattern.
    pub fn matches(
        file: impl Into<String>,
        pattern: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self::new(file, AssertionKind::Matches, pattern, description)
    }

    /// Assert that a file does NOT match a regex pattern.
    pub fn not_matches(
        file: impl Into<String>,
        pattern: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self::new(file, AssertionKind::NotMatches, pattern, description)
    }
}

// ============================================================================
// Assertion Checking
// ============================================================================

/// Check a single pattern assertion against a file.
fn check_single_assertion(workspace_root: &Path, assertion: &PatternAssertion) -> AssertionResult {
    let file_path = workspace_root.join(&assertion.file);

    // Read the file
    let content = match fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) => {
            return AssertionResult {
                assertion: assertion.clone(),
                passed: false,
                actual_content: None,
                error: Some(format!("Failed to read file: {}", e)),
            };
        }
    };

    let passed = match assertion.assertion {
        AssertionKind::Contains => content.contains(&assertion.pattern),
        AssertionKind::NotContains => !content.contains(&assertion.pattern),
        AssertionKind::Matches => match regex::Regex::new(&assertion.pattern) {
            Ok(re) => re.is_match(&content),
            Err(e) => {
                return AssertionResult {
                    assertion: assertion.clone(),
                    passed: false,
                    actual_content: Some(content),
                    error: Some(format!("Invalid regex pattern: {}", e)),
                };
            }
        },
        AssertionKind::NotMatches => match regex::Regex::new(&assertion.pattern) {
            Ok(re) => !re.is_match(&content),
            Err(e) => {
                return AssertionResult {
                    assertion: assertion.clone(),
                    passed: false,
                    actual_content: Some(content),
                    error: Some(format!("Invalid regex pattern: {}", e)),
                };
            }
        },
    };

    AssertionResult {
        assertion: assertion.clone(),
        passed,
        actual_content: if passed { None } else { Some(content) },
        error: None,
    }
}

/// Check all pattern assertions against a workspace.
///
/// Returns `Ok(())` if all assertions pass, or `Err(PatternAssertionError)` with
/// details about which assertions failed.
///
/// # Arguments
///
/// * `workspace_root` - The root directory of the workspace
/// * `assertions` - The list of pattern assertions to check
///
/// # Example
///
/// ```ignore
/// let assertions = vec![
///     PatternAssertion::contains("date.py", "class CalendarDate:", "renamed"),
///     PatternAssertion::not_contains("date.py", "class Date:", "old name gone"),
/// ];
/// check_patterns(workspace_path, &assertions)?;
/// ```
pub fn check_patterns(
    workspace_root: &Path,
    assertions: &[PatternAssertion],
) -> Result<(), PatternAssertionError> {
    let mut failures = Vec::new();

    for assertion in assertions {
        let result = check_single_assertion(workspace_root, assertion);
        if !result.passed {
            failures.push(result);
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(PatternAssertionError { failures })
    }
}

/// Convenience function to check patterns and panic with a detailed message on failure.
///
/// This is useful in tests where you want immediate failure with good diagnostics.
pub fn assert_patterns(workspace_root: &Path, assertions: &[PatternAssertion]) {
    if let Err(e) = check_patterns(workspace_root, assertions) {
        panic!("{}", e);
    }
}

// ============================================================================
// Macro for ergonomic syntax
// ============================================================================

/// Macro for ergonomic pattern assertions in tests.
///
/// # Syntax
///
/// ```ignore
/// // Contains assertion
/// assert_pattern!(workspace, "path/to/file.py" contains "expected text");
///
/// // Not contains assertion
/// assert_pattern!(workspace, "path/to/file.py" not contains "unexpected text");
///
/// // Regex matches assertion
/// assert_pattern!(workspace, "path/to/file.py" matches r"class \w+:");
///
/// // Regex not matches assertion
/// assert_pattern!(workspace, "path/to/file.py" not matches r"class Date:");
/// ```
#[macro_export]
macro_rules! assert_pattern {
    // Contains
    ($workspace:expr, $file:expr, contains, $pattern:expr) => {{
        let assertion = $crate::support::patterns::PatternAssertion::contains(
            $file,
            $pattern,
            concat!("File should contain: ", $pattern),
        );
        $crate::support::patterns::assert_patterns($workspace, &[assertion]);
    }};

    // Not contains
    ($workspace:expr, $file:expr, not_contains, $pattern:expr) => {{
        let assertion = $crate::support::patterns::PatternAssertion::not_contains(
            $file,
            $pattern,
            concat!("File should NOT contain: ", $pattern),
        );
        $crate::support::patterns::assert_patterns($workspace, &[assertion]);
    }};

    // Matches (regex)
    ($workspace:expr, $file:expr, matches, $pattern:expr) => {{
        let assertion = $crate::support::patterns::PatternAssertion::matches(
            $file,
            $pattern,
            concat!("File should match regex: ", $pattern),
        );
        $crate::support::patterns::assert_patterns($workspace, &[assertion]);
    }};

    // Not matches (regex)
    ($workspace:expr, $file:expr, not_matches, $pattern:expr) => {{
        let assertion = $crate::support::patterns::PatternAssertion::not_matches(
            $file,
            $pattern,
            concat!("File should NOT match regex: ", $pattern),
        );
        $crate::support::patterns::assert_patterns($workspace, &[assertion]);
    }};
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_workspace() -> TempDir {
        let dir = TempDir::new().unwrap();

        // Create a test Python file
        let file_path = dir.path().join("test.py");
        let mut file = fs::File::create(&file_path).unwrap();
        writeln!(file, "class CalendarDate:").unwrap();
        writeln!(file, "    def __init__(self):").unwrap();
        writeln!(file, "        pass").unwrap();

        dir
    }

    #[test]
    fn contains_assertion_passes_when_present() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::contains(
            "test.py",
            "class CalendarDate:",
            "Class should exist",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_ok());
    }

    #[test]
    fn contains_assertion_fails_when_absent() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::contains(
            "test.py",
            "class OldName:",
            "Old name should exist",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_err());
    }

    #[test]
    fn not_contains_assertion_passes_when_absent() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::not_contains(
            "test.py",
            "class OldName:",
            "Old name should not exist",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_ok());
    }

    #[test]
    fn not_contains_assertion_fails_when_present() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::not_contains(
            "test.py",
            "class CalendarDate:",
            "New name should not exist",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_err());
    }

    #[test]
    fn matches_assertion_passes_with_regex() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::matches(
            "test.py",
            r"class \w+Date:",
            "Should match class pattern",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_ok());
    }

    #[test]
    fn matches_assertion_fails_when_no_match() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::matches(
            "test.py",
            r"class \d+:",
            "Should match numeric class",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_err());
    }

    #[test]
    fn not_matches_assertion_passes_when_no_match() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::not_matches(
            "test.py",
            r"^class Date:$",
            "Should not match old exact name",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_ok());
    }

    #[test]
    fn multiple_assertions_all_pass() {
        let workspace = create_test_workspace();
        let assertions = vec![
            PatternAssertion::contains("test.py", "CalendarDate", "New name exists"),
            PatternAssertion::not_contains("test.py", "OldDate", "Old name gone"),
            PatternAssertion::matches("test.py", r"def __init__", "Has init"),
        ];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_ok());
    }

    #[test]
    fn multiple_assertions_with_one_failure() {
        let workspace = create_test_workspace();
        let assertions = vec![
            PatternAssertion::contains("test.py", "CalendarDate", "New name exists"),
            PatternAssertion::contains("test.py", "MissingClass", "This will fail"),
        ];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.failures.len(), 1);
    }

    #[test]
    fn missing_file_fails_gracefully() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::contains(
            "nonexistent.py",
            "anything",
            "File should exist",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.failures[0].error.is_some());
    }

    #[test]
    fn invalid_regex_fails_gracefully() {
        let workspace = create_test_workspace();
        let assertions = vec![PatternAssertion::matches(
            "test.py",
            r"[invalid",
            "Invalid regex",
        )];

        let result = check_patterns(workspace.path(), &assertions);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.failures[0]
            .error
            .as_ref()
            .unwrap()
            .contains("Invalid regex"));
    }
}
