//! File filter specification for restricting operation scope.
//!
//! This module implements gitignore-style file filtering for refactoring operations.
//! Patterns are parsed from CLI arguments and can include both inclusions and exclusions.
//!
//! ## Syntax
//!
//! - Patterns without `!` prefix are inclusions
//! - Patterns with `!` prefix are exclusions
//! - Standard glob syntax: `*`, `**`, `?`, `[abc]`
//!
//! ## Semantics
//!
//! 1. If no filter specified: all language-appropriate files are included
//! 2. If only exclusions specified: start from all files, then apply exclusions
//! 3. If inclusions specified: start with matching files, then apply exclusions
//! 4. Default exclusions (`.git`, `__pycache__`, etc.) always apply

use std::path::Path;

use globset::{Glob, GlobSet, GlobSetBuilder};
use thiserror::Error;

/// Default directory exclusions that always apply.
pub const DEFAULT_EXCLUSIONS: &[&str] = &[
    "**/.git/**",
    "**/__pycache__/**",
    "**/venv/**",
    "**/.venv/**",
    "**/node_modules/**",
    "**/target/**",
];

/// Error type for file filter operations.
#[derive(Debug, Error)]
pub enum FilterError {
    /// Invalid glob pattern syntax.
    #[error("invalid glob pattern '{pattern}': {message}")]
    InvalidPattern { pattern: String, message: String },
}

/// Parsed file filter specification.
///
/// Contains inclusion and exclusion patterns parsed from CLI arguments.
/// Use `matches()` to test whether a path should be included in the operation scope.
#[derive(Debug)]
pub struct FileFilterSpec {
    /// Glob set for inclusion patterns. If empty, all files are included.
    inclusions: Option<GlobSet>,
    /// Glob set for exclusion patterns (user-specified).
    exclusions: GlobSet,
    /// Glob set for default exclusions (always applied).
    default_exclusions: GlobSet,
}

impl FileFilterSpec {
    /// Parse filter patterns from CLI arguments.
    ///
    /// Arguments are the patterns provided after `--` on the command line.
    /// Returns `None` if no patterns are provided (indicating all files should be included).
    ///
    /// # Arguments
    ///
    /// * `args` - Slice of pattern strings from CLI
    ///
    /// # Returns
    ///
    /// * `Ok(None)` - No patterns provided, use all files
    /// * `Ok(Some(spec))` - Parsed filter specification
    /// * `Err(FilterError)` - Invalid pattern syntax
    ///
    /// # Examples
    ///
    /// ```
    /// use tugtool::filter::FileFilterSpec;
    ///
    /// // No filter
    /// let spec = FileFilterSpec::parse(&[]).unwrap();
    /// assert!(spec.is_none());
    ///
    /// // Inclusion pattern
    /// let spec = FileFilterSpec::parse(&["src/**/*.py".to_string()]).unwrap();
    /// assert!(spec.is_some());
    ///
    /// // Exclusion pattern (starts with !)
    /// let spec = FileFilterSpec::parse(&["!tests/**".to_string()]).unwrap();
    /// assert!(spec.is_some());
    /// ```
    pub fn parse(args: &[String]) -> Result<Option<Self>, FilterError> {
        if args.is_empty() {
            return Ok(None);
        }

        let mut inclusion_patterns = Vec::new();
        let mut exclusion_patterns = Vec::new();

        for arg in args {
            if let Some(pattern) = arg.strip_prefix('!') {
                // Exclusion pattern
                exclusion_patterns.push(pattern.to_string());
            } else {
                // Inclusion pattern
                inclusion_patterns.push(arg.clone());
            }
        }

        // Build inclusion glob set (only if there are inclusion patterns)
        let inclusions = if inclusion_patterns.is_empty() {
            None
        } else {
            Some(build_glob_set(&inclusion_patterns)?)
        };

        // Build exclusion glob set
        let exclusions = build_glob_set(&exclusion_patterns)?;

        // Build default exclusions glob set
        let default_exclusions =
            build_glob_set(&DEFAULT_EXCLUSIONS.iter().map(|s| s.to_string()).collect::<Vec<_>>())?;

        Ok(Some(FileFilterSpec {
            inclusions,
            exclusions,
            default_exclusions,
        }))
    }

    /// Check if a path matches the filter specification.
    ///
    /// A path matches if:
    /// 1. It is not in the default exclusions
    /// 2. It is not in the user exclusions
    /// 3. If inclusions are specified, it matches at least one inclusion pattern
    ///
    /// # Arguments
    ///
    /// * `path` - Path to test (relative to workspace root)
    ///
    /// # Returns
    ///
    /// `true` if the path should be included in the operation scope
    pub fn matches(&self, path: &Path) -> bool {
        // Check default exclusions first
        if self.default_exclusions.is_match(path) {
            return false;
        }

        // Check user exclusions
        if self.exclusions.is_match(path) {
            return false;
        }

        // Check inclusions (if any)
        match &self.inclusions {
            Some(inclusions) => inclusions.is_match(path),
            None => true, // No inclusions = include all (that passed exclusions)
        }
    }

    /// Check if this filter has any inclusion patterns.
    pub fn has_inclusions(&self) -> bool {
        self.inclusions.is_some()
    }

    /// Check if this filter has any user exclusion patterns.
    pub fn has_exclusions(&self) -> bool {
        !self.exclusions.is_empty()
    }
}

/// Build a GlobSet from a list of pattern strings.
fn build_glob_set(patterns: &[String]) -> Result<GlobSet, FilterError> {
    let mut builder = GlobSetBuilder::new();

    for pattern in patterns {
        let glob = Glob::new(pattern).map_err(|e| FilterError::InvalidPattern {
            pattern: pattern.clone(),
            message: e.to_string(),
        })?;
        builder.add(glob);
    }

    builder.build().map_err(|e| FilterError::InvalidPattern {
        pattern: "<combined>".to_string(),
        message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // Parse Tests
    // =========================================================================

    #[test]
    fn test_filter_parse_empty_returns_none() {
        let result = FileFilterSpec::parse(&[]).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_filter_parse_inclusion() {
        let result = FileFilterSpec::parse(&["src/**/*.py".to_string()]).unwrap();
        assert!(result.is_some());

        let spec = result.unwrap();
        assert!(spec.has_inclusions());
        assert!(!spec.has_exclusions());
    }

    #[test]
    fn test_filter_parse_exclusion() {
        let result = FileFilterSpec::parse(&["!tests/**".to_string()]).unwrap();
        assert!(result.is_some());

        let spec = result.unwrap();
        assert!(!spec.has_inclusions());
        assert!(spec.has_exclusions());
    }

    #[test]
    fn test_filter_parse_mixed() {
        let result = FileFilterSpec::parse(&[
            "src/**/*.py".to_string(),
            "!tests/**".to_string(),
            "lib/**/*.py".to_string(),
            "!**/conftest.py".to_string(),
        ])
        .unwrap();
        assert!(result.is_some());

        let spec = result.unwrap();
        assert!(spec.has_inclusions());
        assert!(spec.has_exclusions());
    }

    #[test]
    fn test_filter_parse_invalid_pattern() {
        // Invalid glob syntax (unclosed bracket)
        let result = FileFilterSpec::parse(&["[invalid".to_string()]);
        assert!(result.is_err());

        let err = result.unwrap_err();
        assert!(matches!(err, FilterError::InvalidPattern { .. }));
    }

    // =========================================================================
    // Match Tests
    // =========================================================================

    #[test]
    fn test_filter_matches_inclusion() {
        let spec = FileFilterSpec::parse(&["src/**/*.py".to_string()])
            .unwrap()
            .unwrap();

        // Should match
        assert!(spec.matches(Path::new("src/main.py")));
        assert!(spec.matches(Path::new("src/lib/utils.py")));
        assert!(spec.matches(Path::new("src/deep/nested/module.py")));

        // Should not match
        assert!(!spec.matches(Path::new("tests/test_main.py")));
        assert!(!spec.matches(Path::new("lib/helper.py")));
        assert!(!spec.matches(Path::new("src/main.rs"))); // Wrong extension
    }

    #[test]
    fn test_filter_matches_exclusion() {
        let spec = FileFilterSpec::parse(&["!tests/**".to_string()])
            .unwrap()
            .unwrap();

        // Should match (not excluded)
        assert!(spec.matches(Path::new("src/main.py")));
        assert!(spec.matches(Path::new("lib/utils.py")));

        // Should not match (excluded)
        assert!(!spec.matches(Path::new("tests/test_main.py")));
        assert!(!spec.matches(Path::new("tests/unit/test_utils.py")));
    }

    #[test]
    fn test_filter_matches_combined() {
        let spec = FileFilterSpec::parse(&[
            "src/**/*.py".to_string(),
            "!**/test_*.py".to_string(),
        ])
        .unwrap()
        .unwrap();

        // Should match (in src, not test file)
        assert!(spec.matches(Path::new("src/main.py")));
        assert!(spec.matches(Path::new("src/lib/utils.py")));

        // Should not match (not in src)
        assert!(!spec.matches(Path::new("lib/utils.py")));

        // Should not match (test file, even in src)
        assert!(!spec.matches(Path::new("src/test_main.py")));
        assert!(!spec.matches(Path::new("src/lib/test_utils.py")));
    }

    #[test]
    fn test_filter_default_exclusions() {
        // Even with no user patterns, default exclusions apply
        // We need at least one pattern to get a FileFilterSpec
        let spec = FileFilterSpec::parse(&["**/*.py".to_string()])
            .unwrap()
            .unwrap();

        // Should not match (default exclusions)
        assert!(!spec.matches(Path::new(".git/config")));
        assert!(!spec.matches(Path::new("__pycache__/module.cpython-311.pyc")));
        assert!(!spec.matches(Path::new("venv/lib/python3.11/site.py")));
        assert!(!spec.matches(Path::new(".venv/bin/python")));
        assert!(!spec.matches(Path::new("node_modules/package/index.js")));
        assert!(!spec.matches(Path::new("target/debug/binary")));

        // Should match (not in default exclusions)
        assert!(spec.matches(Path::new("src/main.py")));
    }

    #[test]
    fn test_filter_exclusion_only_includes_all_else() {
        // Only exclusion, no inclusion = include all files except excluded
        let spec = FileFilterSpec::parse(&["!tests/**".to_string()])
            .unwrap()
            .unwrap();

        // Should match (any file not in tests)
        assert!(spec.matches(Path::new("src/main.py")));
        assert!(spec.matches(Path::new("lib/utils.py")));
        assert!(spec.matches(Path::new("deep/nested/file.txt")));

        // Should not match (in tests)
        assert!(!spec.matches(Path::new("tests/test_main.py")));
    }

    #[test]
    fn test_filter_multiple_inclusions() {
        let spec = FileFilterSpec::parse(&[
            "src/**/*.py".to_string(),
            "lib/**/*.py".to_string(),
        ])
        .unwrap()
        .unwrap();

        // Should match (in either src or lib)
        assert!(spec.matches(Path::new("src/main.py")));
        assert!(spec.matches(Path::new("lib/utils.py")));

        // Should not match (not in src or lib)
        assert!(!spec.matches(Path::new("tests/test_main.py")));
        assert!(!spec.matches(Path::new("other/file.py")));
    }

    #[test]
    fn test_filter_multiple_exclusions() {
        let spec = FileFilterSpec::parse(&[
            "!tests/**".to_string(),
            "!**/conftest.py".to_string(),
        ])
        .unwrap()
        .unwrap();

        // Should match
        assert!(spec.matches(Path::new("src/main.py")));

        // Should not match (excluded by either pattern)
        assert!(!spec.matches(Path::new("tests/test_main.py")));
        assert!(!spec.matches(Path::new("conftest.py")));
        assert!(!spec.matches(Path::new("src/conftest.py")));
    }
}
