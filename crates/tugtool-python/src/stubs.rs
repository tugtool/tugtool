//! Type stub (.pyi) discovery and update infrastructure.
//!
//! This module provides functionality for discovering, parsing, and updating
//! Python type stub files. Stub files contain type annotations without
//! implementation details, used by type checkers and IDEs.
//!
//! # Stub Discovery
//!
//! Stubs are searched in the following order:
//!
//! 1. **Inline stub**: `module.pyi` in the same directory as `module.py`
//! 2. **Stubs folder**: `{workspace_root}/stubs/module.pyi`
//! 3. **Typeshed-style**: `{workspace_root}/stubs/package-stubs/module.pyi`
//! 4. **Extra directories**: Custom directories specified in options
//!
//! # Error Handling
//!
//! All stub operations return [`StubResult<T>`], which uses [`StubError`] for
//! error cases. The error type provides detailed information about what went
//! wrong and where.
//!
//! # Example
//!
//! ```ignore
//! use tugtool_python::stubs::{StubDiscovery, StubDiscoveryOptions, StubResult};
//!
//! let discovery = StubDiscovery::for_workspace("/project");
//! match discovery.find_stub_for(&PathBuf::from("/project/src/utils.py")) {
//!     Some(stub_info) => println!("Found stub at: {:?}", stub_info.stub_path),
//!     None => println!("No stub file found"),
//! }
//! ```

use std::fmt;
use std::path::PathBuf;

/// Error type for stub operations.
///
/// This enum covers all error cases that can occur during stub discovery,
/// parsing, and updates. Each variant provides contextual information to
/// help diagnose issues.
///
/// # Error Variants
///
/// - [`ParseError`](StubError::ParseError): Stub file exists but has invalid Python syntax
/// - [`NotFound`](StubError::NotFound): No stub file found at expected locations
/// - [`IoError`](StubError::IoError): File system error reading or writing stub
/// - [`InvalidAnnotation`](StubError::InvalidAnnotation): String annotation has invalid type syntax
///
/// # Example
///
/// ```
/// use tugtool_python::stubs::StubError;
/// use std::path::PathBuf;
///
/// // Create a parse error
/// let error = StubError::ParseError {
///     stub_path: PathBuf::from("module.pyi"),
///     message: "unexpected token at line 5".to_string(),
/// };
/// println!("{}", error);
/// // Output: Failed to parse stub file module.pyi: unexpected token at line 5
/// ```
#[derive(Debug, Clone)]
pub enum StubError {
    /// Stub file exists but failed to parse.
    ///
    /// This indicates the stub file has invalid Python syntax. The operation
    /// cannot proceed because the stub content cannot be analyzed.
    ///
    /// # Fields
    ///
    /// - `stub_path`: Path to the stub file that failed to parse
    /// - `message`: Description of the parse error
    ParseError {
        /// Path to the stub file that failed to parse
        stub_path: PathBuf,
        /// Description of the parse error
        message: String,
    },

    /// Stub file not found at expected location.
    ///
    /// This indicates no stub file was found after checking all configured
    /// search locations. The `searched_locations` field shows where we looked.
    ///
    /// # Fields
    ///
    /// - `source_path`: The source file we were looking for a stub for
    /// - `searched_locations`: All paths that were checked
    NotFound {
        /// The source file we were looking for a stub for
        source_path: PathBuf,
        /// All paths that were checked for a stub file
        searched_locations: Vec<PathBuf>,
    },

    /// IO error reading or writing stub file.
    ///
    /// This covers file system errors other than "file not found", such as
    /// permission denied, disk full, etc.
    ///
    /// # Fields
    ///
    /// - `stub_path`: Path to the file where the error occurred
    /// - `message`: Description of the IO error
    IoError {
        /// Path to the file where the error occurred
        stub_path: PathBuf,
        /// Description of the IO error
        message: String,
    },

    /// String annotation has invalid syntax.
    ///
    /// This occurs when parsing type expressions inside string annotations
    /// (forward references). The annotation content is syntactically invalid
    /// as a Python type expression.
    ///
    /// # Fields
    ///
    /// - `annotation`: The original annotation string (including quotes)
    /// - `message`: Description of what's wrong with the syntax
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_python::stubs::StubError;
    ///
    /// let error = StubError::InvalidAnnotation {
    ///     annotation: "\"List[\"".to_string(),
    ///     message: "unclosed bracket".to_string(),
    /// };
    /// println!("{}", error);
    /// // Output: Invalid type annotation "List[": unclosed bracket
    /// ```
    InvalidAnnotation {
        /// The original annotation string (including quotes)
        annotation: String,
        /// Description of what's wrong with the syntax
        message: String,
    },
}

impl fmt::Display for StubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StubError::ParseError { stub_path, message } => {
                write!(
                    f,
                    "Failed to parse stub file {}: {}",
                    stub_path.display(),
                    message
                )
            }
            StubError::NotFound {
                source_path,
                searched_locations,
            } => {
                write!(
                    f,
                    "No stub file found for {}. Searched locations: {}",
                    source_path.display(),
                    searched_locations
                        .iter()
                        .map(|p| p.display().to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
            StubError::IoError { stub_path, message } => {
                write!(
                    f,
                    "IO error accessing stub file {}: {}",
                    stub_path.display(),
                    message
                )
            }
            StubError::InvalidAnnotation {
                annotation,
                message,
            } => {
                write!(f, "Invalid type annotation {}: {}", annotation, message)
            }
        }
    }
}

impl std::error::Error for StubError {}

/// Result type alias for stub operations.
///
/// All fallible stub operations return this type, which wraps `Result<T, StubError>`.
///
/// # Example
///
/// ```
/// use tugtool_python::stubs::{StubResult, StubError};
/// use std::path::PathBuf;
///
/// fn example() -> StubResult<String> {
///     Err(StubError::NotFound {
///         source_path: PathBuf::from("module.py"),
///         searched_locations: vec![PathBuf::from("module.pyi")],
///     })
/// }
/// ```
pub type StubResult<T> = Result<T, StubError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stub_error_display_parse_error() {
        let error = StubError::ParseError {
            stub_path: PathBuf::from("/project/src/module.pyi"),
            message: "unexpected token at line 10".to_string(),
        };

        let display = format!("{}", error);
        assert!(
            display.contains("Failed to parse stub file"),
            "Display should mention parse failure"
        );
        assert!(
            display.contains("module.pyi"),
            "Display should contain stub path"
        );
        assert!(
            display.contains("unexpected token at line 10"),
            "Display should contain error message"
        );
    }

    #[test]
    fn test_stub_error_display_not_found() {
        let error = StubError::NotFound {
            source_path: PathBuf::from("/project/src/utils.py"),
            searched_locations: vec![
                PathBuf::from("/project/src/utils.pyi"),
                PathBuf::from("/project/stubs/utils.pyi"),
            ],
        };

        let display = format!("{}", error);
        assert!(
            display.contains("No stub file found"),
            "Display should mention not found"
        );
        assert!(
            display.contains("utils.py"),
            "Display should contain source path"
        );
        assert!(
            display.contains("utils.pyi"),
            "Display should list searched locations"
        );
        assert!(
            display.contains("stubs"),
            "Display should show stubs folder location"
        );
    }

    #[test]
    fn test_stub_error_display_io_error() {
        let error = StubError::IoError {
            stub_path: PathBuf::from("/project/src/module.pyi"),
            message: "permission denied".to_string(),
        };

        let display = format!("{}", error);
        assert!(
            display.contains("IO error"),
            "Display should mention IO error"
        );
        assert!(
            display.contains("module.pyi"),
            "Display should contain stub path"
        );
        assert!(
            display.contains("permission denied"),
            "Display should contain error message"
        );
    }

    #[test]
    fn test_stub_error_display_invalid_annotation() {
        let error = StubError::InvalidAnnotation {
            annotation: "\"List[\"".to_string(),
            message: "unclosed bracket".to_string(),
        };

        let display = format!("{}", error);
        assert!(
            display.contains("Invalid type annotation"),
            "Display should mention invalid annotation"
        );
        assert!(
            display.contains("List["),
            "Display should contain annotation"
        );
        assert!(
            display.contains("unclosed bracket"),
            "Display should contain error message"
        );
    }

    #[test]
    fn test_stub_result_ok() {
        let result: StubResult<i32> = Ok(42);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn test_stub_result_err() {
        let result: StubResult<i32> = Err(StubError::NotFound {
            source_path: PathBuf::from("test.py"),
            searched_locations: vec![],
        });
        assert!(result.is_err());
    }

    #[test]
    fn test_stub_error_is_error_trait() {
        // Verify that StubError implements std::error::Error
        let error: Box<dyn std::error::Error> = Box::new(StubError::ParseError {
            stub_path: PathBuf::from("test.pyi"),
            message: "test".to_string(),
        });
        assert!(error.to_string().contains("Failed to parse"));
    }

    #[test]
    fn test_stub_error_debug() {
        let error = StubError::ParseError {
            stub_path: PathBuf::from("test.pyi"),
            message: "syntax error".to_string(),
        };

        // Verify Debug is implemented (compiles and produces output)
        let debug_str = format!("{:?}", error);
        assert!(
            debug_str.contains("ParseError"),
            "Debug should contain variant name"
        );
    }

    #[test]
    fn test_stub_error_clone() {
        let error = StubError::IoError {
            stub_path: PathBuf::from("test.pyi"),
            message: "disk full".to_string(),
        };

        // Verify Clone is implemented
        let cloned = error.clone();
        assert_eq!(format!("{}", error), format!("{}", cloned));
    }
}
