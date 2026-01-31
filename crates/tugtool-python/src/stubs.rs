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
use std::path::{Path, PathBuf};

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

// ============================================================================
// Stub Discovery Types
// ============================================================================

/// Where the stub file was found.
///
/// This enum indicates the location type of a discovered stub file,
/// which can help determine its priority or origin.
///
/// # Variants
///
/// - [`Inline`](StubLocation::Inline): Stub in same directory as source
/// - [`StubsFolder`](StubLocation::StubsFolder): Stub in `stubs/` directory
/// - [`TypeshedStyle`](StubLocation::TypeshedStyle): Stub in `pkg-stubs/` directory
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StubLocation {
    /// Stub is `module.pyi` in same directory as `module.py`.
    ///
    /// This is the highest priority location, as it's the most specific
    /// to the source file.
    Inline,

    /// Stub is in `stubs/` directory at workspace root.
    ///
    /// The path within `stubs/` mirrors the module path structure.
    /// For example, `pkg/module.py` would have stub at `stubs/pkg/module.pyi`.
    StubsFolder,

    /// Stub is in typeshed-style `stubs/package-stubs/` directory.
    ///
    /// This follows the convention used by typeshed and other stub packages.
    /// For example, `pkg/module.py` would have stub at `stubs/pkg-stubs/module.pyi`.
    TypeshedStyle,
}

/// Information about a discovered stub file.
///
/// This struct contains the paths and location type for a stub file
/// that was found during discovery.
///
/// # Example
///
/// ```
/// use tugtool_python::stubs::{StubInfo, StubLocation};
/// use std::path::PathBuf;
///
/// let info = StubInfo {
///     stub_path: PathBuf::from("/project/src/utils.pyi"),
///     source_path: PathBuf::from("/project/src/utils.py"),
///     location: StubLocation::Inline,
/// };
/// ```
#[derive(Debug, Clone)]
pub struct StubInfo {
    /// Path to the stub file.
    pub stub_path: PathBuf,

    /// Path to the corresponding source file.
    pub source_path: PathBuf,

    /// Where the stub was found (inline, stubs folder, or typeshed-style).
    pub location: StubLocation,
}

/// Options for stub discovery.
///
/// Configure how [`StubDiscovery`] searches for stub files.
///
/// # Example
///
/// ```
/// use tugtool_python::stubs::StubDiscoveryOptions;
/// use std::path::PathBuf;
///
/// let options = StubDiscoveryOptions {
///     workspace_root: PathBuf::from("/project"),
///     extra_stub_dirs: vec![PathBuf::from("/custom/stubs")],
///     check_typeshed_style: true,
/// };
/// ```
#[derive(Debug, Clone)]
pub struct StubDiscoveryOptions {
    /// Workspace root for finding `stubs/` folder.
    ///
    /// This is the base directory from which relative stub paths are resolved.
    pub workspace_root: PathBuf,

    /// Additional directories to search for stubs.
    ///
    /// These are checked after inline and stubs folder locations.
    pub extra_stub_dirs: Vec<PathBuf>,

    /// Whether to check typeshed-style `package-stubs` directories.
    ///
    /// Default: `true`
    pub check_typeshed_style: bool,
}

impl Default for StubDiscoveryOptions {
    fn default() -> Self {
        Self {
            workspace_root: PathBuf::from("."),
            extra_stub_dirs: Vec::new(),
            check_typeshed_style: true,
        }
    }
}

/// Discovers type stub files (.pyi) for Python modules.
///
/// # Discovery Order
///
/// For a source file `pkg/module.py`, stubs are searched in this order:
///
/// 1. **Inline stub**: `pkg/module.pyi` (same directory)
/// 2. **Stubs folder**: `{workspace_root}/stubs/pkg/module.pyi`
/// 3. **Typeshed-style**: `{workspace_root}/stubs/pkg-stubs/module.pyi`
/// 4. **Extra dirs**: Each directory in `extra_stub_dirs`
///
/// The first existing file is returned.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::stubs::{StubDiscovery, StubDiscoveryOptions};
/// use std::path::PathBuf;
///
/// let discovery = StubDiscovery::new(StubDiscoveryOptions {
///     workspace_root: PathBuf::from("/project"),
///     ..Default::default()
/// });
///
/// // Find stub for /project/src/mypackage/utils.py
/// if let Some(stub) = discovery.find_stub_for(Path::new("/project/src/mypackage/utils.py")) {
///     println!("Found stub at: {:?}", stub.stub_path);
/// }
/// ```
#[derive(Debug, Clone)]
pub struct StubDiscovery {
    options: StubDiscoveryOptions,
}

impl StubDiscovery {
    /// Create a new StubDiscovery with the given options.
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_python::stubs::{StubDiscovery, StubDiscoveryOptions};
    /// use std::path::PathBuf;
    ///
    /// let discovery = StubDiscovery::new(StubDiscoveryOptions {
    ///     workspace_root: PathBuf::from("/project"),
    ///     ..Default::default()
    /// });
    /// ```
    pub fn new(options: StubDiscoveryOptions) -> Self {
        Self { options }
    }

    /// Create a StubDiscovery with default options and given workspace root.
    ///
    /// This is a convenience constructor for the common case where you only
    /// need to specify the workspace root.
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_python::stubs::StubDiscovery;
    ///
    /// let discovery = StubDiscovery::for_workspace("/project");
    /// ```
    pub fn for_workspace(workspace_root: impl Into<PathBuf>) -> Self {
        Self::new(StubDiscoveryOptions {
            workspace_root: workspace_root.into(),
            ..Default::default()
        })
    }

    /// Get the options used by this discovery instance.
    pub fn options(&self) -> &StubDiscoveryOptions {
        &self.options
    }

    /// Get the inline stub path for a source file.
    ///
    /// This converts `.py` extension to `.pyi` in the same directory.
    /// For example, `module.py` becomes `module.pyi`.
    fn inline_stub_path(&self, source_path: &Path) -> PathBuf {
        source_path.with_extension("pyi")
    }

    /// Find the stub file for a given Python source file.
    ///
    /// Returns `Some(StubInfo)` if a stub exists, `None` if no stub found.
    ///
    /// # Discovery Order (MVP - inline only)
    ///
    /// Currently only checks for inline stubs (`module.pyi` in same directory).
    /// Future steps will add stubs folder and typeshed-style discovery.
    ///
    /// # Example
    ///
    /// ```ignore
    /// use tugtool_python::stubs::StubDiscovery;
    /// use std::path::Path;
    ///
    /// let discovery = StubDiscovery::for_workspace("/project");
    /// if let Some(info) = discovery.find_stub_for(Path::new("/project/src/utils.py")) {
    ///     println!("Found stub at: {:?}", info.stub_path);
    /// }
    /// ```
    pub fn find_stub_for(&self, source_path: &Path) -> Option<StubInfo> {
        // 1. Check for inline stub (same directory)
        let inline_stub = self.inline_stub_path(source_path);
        if inline_stub.exists() {
            return Some(StubInfo {
                stub_path: inline_stub,
                source_path: source_path.to_path_buf(),
                location: StubLocation::Inline,
            });
        }

        // Future steps will add:
        // 2. Check stubs/ folder at workspace root
        // 3. Check typeshed-style package-stubs
        // 4. Check extra_stub_dirs

        None
    }

    /// Check if a stub exists for the given source file.
    ///
    /// This is a convenience method that returns a boolean instead of
    /// the full [`StubInfo`].
    ///
    /// # Example
    ///
    /// ```ignore
    /// use tugtool_python::stubs::StubDiscovery;
    /// use std::path::Path;
    ///
    /// let discovery = StubDiscovery::for_workspace("/project");
    /// if discovery.has_stub(Path::new("/project/src/utils.py")) {
    ///     println!("Stub exists!");
    /// }
    /// ```
    pub fn has_stub(&self, source_path: &Path) -> bool {
        self.find_stub_for(source_path).is_some()
    }

    /// Get the expected stub path (whether it exists or not).
    ///
    /// Returns the inline stub path (`module.pyi` in same directory).
    /// This is useful for creating new stub files or error messages.
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_python::stubs::StubDiscovery;
    /// use std::path::Path;
    ///
    /// let discovery = StubDiscovery::for_workspace("/project");
    /// let expected = discovery.expected_stub_path(Path::new("/project/src/utils.py"));
    /// assert_eq!(expected.to_str().unwrap(), "/project/src/utils.pyi");
    /// ```
    pub fn expected_stub_path(&self, source_path: &Path) -> PathBuf {
        self.inline_stub_path(source_path)
    }
}

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

    // ========================================================================
    // StubLocation Tests
    // ========================================================================

    #[test]
    fn test_stub_location_variants() {
        // Verify all enum variants exist and are distinct
        let inline = StubLocation::Inline;
        let stubs_folder = StubLocation::StubsFolder;
        let typeshed_style = StubLocation::TypeshedStyle;

        assert_eq!(inline, StubLocation::Inline);
        assert_eq!(stubs_folder, StubLocation::StubsFolder);
        assert_eq!(typeshed_style, StubLocation::TypeshedStyle);

        // Verify they are different from each other
        assert_ne!(inline, stubs_folder);
        assert_ne!(inline, typeshed_style);
        assert_ne!(stubs_folder, typeshed_style);
    }

    #[test]
    fn test_stub_location_debug() {
        let location = StubLocation::Inline;
        let debug_str = format!("{:?}", location);
        assert!(debug_str.contains("Inline"));
    }

    #[test]
    fn test_stub_location_clone() {
        let original = StubLocation::StubsFolder;
        let cloned = original;
        assert_eq!(original, cloned);
    }

    #[test]
    fn test_stub_location_copy() {
        let location = StubLocation::TypeshedStyle;
        let copied: StubLocation = location; // Copy happens here
        assert_eq!(location, copied);
    }

    // ========================================================================
    // StubInfo Tests
    // ========================================================================

    #[test]
    fn test_stub_info_construction() {
        let info = StubInfo {
            stub_path: PathBuf::from("/project/src/utils.pyi"),
            source_path: PathBuf::from("/project/src/utils.py"),
            location: StubLocation::Inline,
        };

        assert_eq!(
            info.stub_path,
            PathBuf::from("/project/src/utils.pyi")
        );
        assert_eq!(
            info.source_path,
            PathBuf::from("/project/src/utils.py")
        );
        assert_eq!(info.location, StubLocation::Inline);
    }

    #[test]
    fn test_stub_info_debug() {
        let info = StubInfo {
            stub_path: PathBuf::from("test.pyi"),
            source_path: PathBuf::from("test.py"),
            location: StubLocation::Inline,
        };

        let debug_str = format!("{:?}", info);
        assert!(debug_str.contains("StubInfo"));
        assert!(debug_str.contains("test.pyi"));
    }

    #[test]
    fn test_stub_info_clone() {
        let info = StubInfo {
            stub_path: PathBuf::from("/project/module.pyi"),
            source_path: PathBuf::from("/project/module.py"),
            location: StubLocation::StubsFolder,
        };

        let cloned = info.clone();
        assert_eq!(cloned.stub_path, info.stub_path);
        assert_eq!(cloned.source_path, info.source_path);
        assert_eq!(cloned.location, info.location);
    }

    // ========================================================================
    // StubDiscoveryOptions Tests
    // ========================================================================

    #[test]
    fn test_stub_discovery_options_default() {
        let options = StubDiscoveryOptions::default();

        assert_eq!(options.workspace_root, PathBuf::from("."));
        assert!(options.extra_stub_dirs.is_empty());
        assert!(options.check_typeshed_style);
    }

    #[test]
    fn test_stub_discovery_options_custom() {
        let options = StubDiscoveryOptions {
            workspace_root: PathBuf::from("/my/project"),
            extra_stub_dirs: vec![
                PathBuf::from("/extra/stubs1"),
                PathBuf::from("/extra/stubs2"),
            ],
            check_typeshed_style: false,
        };

        assert_eq!(options.workspace_root, PathBuf::from("/my/project"));
        assert_eq!(options.extra_stub_dirs.len(), 2);
        assert!(!options.check_typeshed_style);
    }

    #[test]
    fn test_stub_discovery_options_debug() {
        let options = StubDiscoveryOptions::default();
        let debug_str = format!("{:?}", options);
        assert!(debug_str.contains("StubDiscoveryOptions"));
    }

    #[test]
    fn test_stub_discovery_options_clone() {
        let options = StubDiscoveryOptions {
            workspace_root: PathBuf::from("/project"),
            extra_stub_dirs: vec![PathBuf::from("/stubs")],
            check_typeshed_style: true,
        };

        let cloned = options.clone();
        assert_eq!(cloned.workspace_root, options.workspace_root);
        assert_eq!(cloned.extra_stub_dirs, options.extra_stub_dirs);
        assert_eq!(cloned.check_typeshed_style, options.check_typeshed_style);
    }

    // ========================================================================
    // StubDiscovery Tests
    // ========================================================================

    #[test]
    fn test_stub_discovery_new() {
        let options = StubDiscoveryOptions {
            workspace_root: PathBuf::from("/project"),
            ..Default::default()
        };

        let discovery = StubDiscovery::new(options.clone());
        assert_eq!(discovery.options().workspace_root, options.workspace_root);
    }

    #[test]
    fn test_stub_discovery_for_workspace() {
        let discovery = StubDiscovery::for_workspace("/my/project");
        assert_eq!(
            discovery.options().workspace_root,
            PathBuf::from("/my/project")
        );
        assert!(discovery.options().extra_stub_dirs.is_empty());
        assert!(discovery.options().check_typeshed_style);
    }

    #[test]
    fn test_stub_discovery_for_workspace_string() {
        let workspace = String::from("/another/project");
        let discovery = StubDiscovery::for_workspace(workspace);
        assert_eq!(
            discovery.options().workspace_root,
            PathBuf::from("/another/project")
        );
    }

    #[test]
    fn test_stub_discovery_for_workspace_pathbuf() {
        let workspace = PathBuf::from("/pathbuf/project");
        let discovery = StubDiscovery::for_workspace(workspace);
        assert_eq!(
            discovery.options().workspace_root,
            PathBuf::from("/pathbuf/project")
        );
    }

    #[test]
    fn test_stub_discovery_debug() {
        let discovery = StubDiscovery::for_workspace("/project");
        let debug_str = format!("{:?}", discovery);
        assert!(debug_str.contains("StubDiscovery"));
    }

    #[test]
    fn test_stub_discovery_clone() {
        let discovery = StubDiscovery::for_workspace("/project");
        let cloned = discovery.clone();
        assert_eq!(
            cloned.options().workspace_root,
            discovery.options().workspace_root
        );
    }

    #[test]
    fn test_expected_stub_path() {
        let discovery = StubDiscovery::for_workspace("/project");

        // Basic .py to .pyi conversion
        let expected = discovery.expected_stub_path(Path::new("/project/src/utils.py"));
        assert_eq!(expected, PathBuf::from("/project/src/utils.pyi"));

        // Nested path
        let expected = discovery.expected_stub_path(Path::new("/project/pkg/sub/module.py"));
        assert_eq!(expected, PathBuf::from("/project/pkg/sub/module.pyi"));

        // __init__.py
        let expected = discovery.expected_stub_path(Path::new("/project/pkg/__init__.py"));
        assert_eq!(expected, PathBuf::from("/project/pkg/__init__.pyi"));
    }

    #[test]
    fn test_no_stub_exists() {
        // Use a path that definitely doesn't have a stub
        let discovery = StubDiscovery::for_workspace("/nonexistent/project");
        let result = discovery.find_stub_for(Path::new("/nonexistent/project/src/utils.py"));
        assert!(result.is_none());
    }

    #[test]
    fn test_has_stub_false() {
        let discovery = StubDiscovery::for_workspace("/nonexistent/project");
        assert!(!discovery.has_stub(Path::new("/nonexistent/project/src/utils.py")));
    }

    // Tests that require actual filesystem interaction
    mod filesystem_tests {
        use super::*;
        use std::fs::{self, File};
        use std::io::Write;
        use tempfile::TempDir;

        fn create_temp_project() -> TempDir {
            tempfile::tempdir().expect("Failed to create temp dir")
        }

        #[test]
        fn test_find_stub_same_directory() {
            // Example 1 from the plan
            let temp_dir = create_temp_project();
            let src_dir = temp_dir.path().join("src").join("mypackage");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");

            // Create source file
            let source_path = src_dir.join("handlers.py");
            let mut source_file = File::create(&source_path).expect("Failed to create source file");
            writeln!(source_file, "def handler(): pass").expect("Failed to write source");

            // Create inline stub file
            let stub_path = src_dir.join("handlers.pyi");
            let mut stub_file = File::create(&stub_path).expect("Failed to create stub file");
            writeln!(stub_file, "def handler() -> None: ...").expect("Failed to write stub");

            // Test discovery
            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some(), "Should find inline stub");
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
            assert_eq!(info.source_path, source_path);
            assert_eq!(info.location, StubLocation::Inline);
        }

        #[test]
        fn test_has_stub_true() {
            let temp_dir = create_temp_project();

            // Create source and stub files
            let source_path = temp_dir.path().join("module.py");
            let stub_path = temp_dir.path().join("module.pyi");

            File::create(&source_path).expect("Failed to create source file");
            File::create(&stub_path).expect("Failed to create stub file");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            assert!(discovery.has_stub(&source_path));
        }

        #[test]
        fn test_find_stub_no_stub_file() {
            let temp_dir = create_temp_project();

            // Create only source file, no stub
            let source_path = temp_dir.path().join("module.py");
            File::create(&source_path).expect("Failed to create source file");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_none(), "Should not find stub when none exists");
        }

        #[test]
        fn test_find_stub_nested_package() {
            let temp_dir = create_temp_project();
            let nested_dir = temp_dir.path().join("pkg").join("sub").join("deep");
            fs::create_dir_all(&nested_dir).expect("Failed to create nested dir");

            // Create source and stub in nested location
            let source_path = nested_dir.join("module.py");
            let stub_path = nested_dir.join("module.pyi");

            File::create(&source_path).expect("Failed to create source file");
            File::create(&stub_path).expect("Failed to create stub file");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some());
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
            assert_eq!(info.location, StubLocation::Inline);
        }

        #[test]
        fn test_find_stub_init_py() {
            let temp_dir = create_temp_project();
            let pkg_dir = temp_dir.path().join("mypackage");
            fs::create_dir_all(&pkg_dir).expect("Failed to create package dir");

            // Create __init__.py and __init__.pyi
            let source_path = pkg_dir.join("__init__.py");
            let stub_path = pkg_dir.join("__init__.pyi");

            File::create(&source_path).expect("Failed to create __init__.py");
            File::create(&stub_path).expect("Failed to create __init__.pyi");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some());
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
            assert_eq!(info.location, StubLocation::Inline);
        }
    }
}
