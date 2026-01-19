// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Python version abstraction for version-aware parsing and analysis.
//!
//! This module provides [`PythonVersion`] and [`ParseOptions`] types that enable
//! version-aware parsing. Note that actual version validation (rejecting syntax
//! not available in a target version) is deferred to future work; currently
//! [`PythonVersion::Permissive`] and specific versions behave identically during
//! parsing, but the version information is threaded through for future use.

/// Target Python language version for parsing and analysis.
///
/// Python syntax evolves across versions (e.g., match statements in 3.10,
/// walrus operator scoping changes in 3.9). This enum allows specifying a
/// target version for version-aware analysis.
///
/// # Note on Version Validation
///
/// Currently, version validation is **deferred**: all syntax that the grammar
/// can handle will be accepted regardless of the specified version. The version
/// is threaded through the API to enable future version-specific validation
/// and analysis without API changes.
///
/// # Example
///
/// ```
/// use tugtool_cst::{PythonVersion, ParseOptions, parse_module_with_options};
///
/// // Parse with permissive mode (accepts all syntax)
/// let options = ParseOptions::default();
/// let module = parse_module_with_options("x := 1", options);
///
/// // Parse targeting a specific version
/// let options = ParseOptions::new(PythonVersion::V3_10);
/// let module = parse_module_with_options("match x:\n    case 1: pass", options);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PythonVersion {
    /// Accept all syntax the grammar handles; no version validation.
    ///
    /// This is the default mode. It accepts any valid Python syntax that the
    /// parser supports, regardless of which Python version introduced that syntax.
    Permissive,

    /// A specific target language version (e.g., 3.10).
    ///
    /// Currently behaves identically to [`Permissive`](Self::Permissive) during
    /// parsing, but the version information is preserved for future version-aware
    /// analysis and validation.
    V {
        /// Major version number (always 3 for supported versions).
        major: u8,
        /// Minor version number (8-12 for currently defined constants).
        minor: u8,
    },
}

impl PythonVersion {
    /// Python 3.8 - baseline version with walrus operator.
    pub const V3_8: Self = Self::V { major: 3, minor: 8 };

    /// Python 3.9 - relaxed decorator syntax, walrus in comprehension iterable.
    pub const V3_9: Self = Self::V { major: 3, minor: 9 };

    /// Python 3.10 - match statements (structural pattern matching).
    pub const V3_10: Self = Self::V {
        major: 3,
        minor: 10,
    };

    /// Python 3.11 - exception groups, fine-grained error locations.
    pub const V3_11: Self = Self::V {
        major: 3,
        minor: 11,
    };

    /// Python 3.12 - f-string improvements, type parameter syntax.
    pub const V3_12: Self = Self::V {
        major: 3,
        minor: 12,
    };

    /// Returns whether match statements are available in this version.
    ///
    /// Match statements (structural pattern matching) were introduced in Python 3.10.
    ///
    /// # Note
    ///
    /// This method is for version-aware analysis. The parser currently accepts
    /// match statements regardless of the specified version.
    #[must_use]
    pub fn has_match_statements(self) -> bool {
        match self {
            Self::Permissive => true,
            Self::V { major: 3, minor } => minor >= 10,
            Self::V { .. } => false,
        }
    }

    /// Returns whether walrus operator (`:=`) can appear in comprehension iterables.
    ///
    /// In Python 3.8, walrus operators in the iterable position of comprehensions
    /// were forbidden to avoid confusion. This restriction was relaxed in Python 3.9.
    ///
    /// # Note
    ///
    /// This method is for version-aware analysis. The parser currently accepts
    /// walrus operators in all positions regardless of the specified version.
    #[must_use]
    pub fn has_walrus_in_comprehension_iterable(self) -> bool {
        match self {
            Self::Permissive => true,
            Self::V { major: 3, minor } => minor >= 9,
            Self::V { .. } => false,
        }
    }

    /// Returns whether relaxed decorator syntax is supported.
    ///
    /// Python 3.9 relaxed the grammar for decorators to allow any expression,
    /// not just dotted names and calls.
    #[must_use]
    pub fn has_relaxed_decorator_syntax(self) -> bool {
        match self {
            Self::Permissive => true,
            Self::V { major: 3, minor } => minor >= 9,
            Self::V { .. } => false,
        }
    }

    /// Returns whether exception groups (`except*`) are supported.
    ///
    /// Exception groups were introduced in Python 3.11.
    #[must_use]
    pub fn has_exception_groups(self) -> bool {
        match self {
            Self::Permissive => true,
            Self::V { major: 3, minor } => minor >= 11,
            Self::V { .. } => false,
        }
    }

    /// Returns whether type parameter syntax (`def f[T]()`) is supported.
    ///
    /// Type parameter syntax was introduced in Python 3.12.
    #[must_use]
    pub fn has_type_parameter_syntax(self) -> bool {
        match self {
            Self::Permissive => true,
            Self::V { major: 3, minor } => minor >= 12,
            Self::V { .. } => false,
        }
    }

    /// Returns whether this is the permissive mode.
    #[must_use]
    pub fn is_permissive(self) -> bool {
        matches!(self, Self::Permissive)
    }

    /// Returns the major and minor version numbers, if this is a specific version.
    ///
    /// Returns `None` for [`Permissive`](Self::Permissive).
    #[must_use]
    pub fn version_tuple(self) -> Option<(u8, u8)> {
        match self {
            Self::Permissive => None,
            Self::V { major, minor } => Some((major, minor)),
        }
    }
}

impl Default for PythonVersion {
    /// Returns [`PythonVersion::Permissive`] as the default.
    fn default() -> Self {
        Self::Permissive
    }
}

impl std::fmt::Display for PythonVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Permissive => write!(f, "permissive"),
            Self::V { major, minor } => write!(f, "{}.{}", major, minor),
        }
    }
}

/// Configuration options for parsing Python source code.
///
/// Use [`ParseOptions::default()`] for permissive parsing that accepts all
/// syntax, or use [`ParseOptions::new()`] to specify a target Python version.
///
/// # Example
///
/// ```
/// use tugtool_cst::{ParseOptions, PythonVersion};
///
/// // Default: permissive mode
/// let options = ParseOptions::default();
/// assert_eq!(options.version, PythonVersion::Permissive);
///
/// // Target Python 3.10
/// let options = ParseOptions::new(PythonVersion::V3_10);
/// assert_eq!(options.version, PythonVersion::V3_10);
///
/// // With encoding hint
/// let options = ParseOptions::new(PythonVersion::V3_9)
///     .with_encoding("utf-8");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParseOptions {
    /// Target Python version for parsing.
    ///
    /// Currently, this does not affect parsing behavior (all syntax accepted),
    /// but it is preserved for future version-aware validation.
    pub version: PythonVersion,

    /// Optional encoding hint for the source.
    ///
    /// If not specified, UTF-8 is assumed. This corresponds to the encoding
    /// declaration in Python source files (e.g., `# -*- coding: utf-8 -*-`).
    pub encoding: Option<String>,
}

impl ParseOptions {
    /// Creates parse options targeting a specific Python version.
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_cst::{ParseOptions, PythonVersion};
    ///
    /// let options = ParseOptions::new(PythonVersion::V3_10);
    /// ```
    #[must_use]
    pub fn new(version: PythonVersion) -> Self {
        Self {
            version,
            encoding: None,
        }
    }

    /// Sets the encoding hint for parsing.
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_cst::{ParseOptions, PythonVersion};
    ///
    /// let options = ParseOptions::new(PythonVersion::V3_10)
    ///     .with_encoding("utf-8");
    /// ```
    #[must_use]
    pub fn with_encoding(mut self, encoding: impl Into<String>) -> Self {
        self.encoding = Some(encoding.into());
        self
    }

    /// Returns the encoding as a string slice, if set.
    #[must_use]
    pub fn encoding_str(&self) -> Option<&str> {
        self.encoding.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_constants_exist() {
        // Verify all version constants exist and are stable
        assert_eq!(PythonVersion::V3_8.version_tuple(), Some((3, 8)));
        assert_eq!(PythonVersion::V3_9.version_tuple(), Some((3, 9)));
        assert_eq!(PythonVersion::V3_10.version_tuple(), Some((3, 10)));
        assert_eq!(PythonVersion::V3_11.version_tuple(), Some((3, 11)));
        assert_eq!(PythonVersion::V3_12.version_tuple(), Some((3, 12)));
    }

    #[test]
    fn test_permissive_no_validation() {
        // Permissive mode should return true for all feature queries
        let v = PythonVersion::Permissive;
        assert!(v.is_permissive());
        assert!(v.has_match_statements());
        assert!(v.has_walrus_in_comprehension_iterable());
        assert!(v.has_relaxed_decorator_syntax());
        assert!(v.has_exception_groups());
        assert!(v.has_type_parameter_syntax());
        assert_eq!(v.version_tuple(), None);
    }

    #[test]
    fn test_version_feature_queries() {
        // Python 3.8: walrus in comprehension iterable not allowed
        assert!(!PythonVersion::V3_8.has_walrus_in_comprehension_iterable());
        assert!(!PythonVersion::V3_8.has_match_statements());

        // Python 3.9: walrus in comprehension iterable allowed
        assert!(PythonVersion::V3_9.has_walrus_in_comprehension_iterable());
        assert!(!PythonVersion::V3_9.has_match_statements());

        // Python 3.10: match statements
        assert!(PythonVersion::V3_10.has_match_statements());
        assert!(!PythonVersion::V3_10.has_exception_groups());

        // Python 3.11: exception groups
        assert!(PythonVersion::V3_11.has_exception_groups());
        assert!(!PythonVersion::V3_11.has_type_parameter_syntax());

        // Python 3.12: type parameter syntax
        assert!(PythonVersion::V3_12.has_type_parameter_syntax());
    }

    #[test]
    fn test_version_display() {
        assert_eq!(PythonVersion::Permissive.to_string(), "permissive");
        assert_eq!(PythonVersion::V3_8.to_string(), "3.8");
        assert_eq!(PythonVersion::V3_10.to_string(), "3.10");
    }

    #[test]
    fn test_version_default() {
        assert_eq!(PythonVersion::default(), PythonVersion::Permissive);
    }

    #[test]
    fn test_parse_options_default() {
        let options = ParseOptions::default();
        assert_eq!(options.version, PythonVersion::Permissive);
        assert_eq!(options.encoding, None);
    }

    #[test]
    fn test_parse_options_with_version() {
        let options = ParseOptions::new(PythonVersion::V3_10);
        assert_eq!(options.version, PythonVersion::V3_10);
        assert_eq!(options.encoding, None);
    }

    #[test]
    fn test_parse_options_with_encoding() {
        let options = ParseOptions::new(PythonVersion::V3_9).with_encoding("utf-8");
        assert_eq!(options.version, PythonVersion::V3_9);
        assert_eq!(options.encoding_str(), Some("utf-8"));
    }
}
