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

use tugtool_core::patch::Span;
use tugtool_python_cst::{parse_module_with_positions, prettify_error, StubSymbols};

// Re-export stub symbol types from tugtool-python-cst for convenience
pub use tugtool_python_cst::{
    StubAttribute, StubClass, StubDecorator, StubFunction, StubParam, StubTypeAlias, StubVariable,
    TypeNameSpan,
};

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
    /// # Discovery Order
    ///
    /// Stubs are searched in the following order (first match wins):
    ///
    /// 1. **Inline stub**: `module.pyi` in the same directory as `module.py`
    /// 2. **Stubs folder**: `{workspace_root}/stubs/{module_path}.pyi`
    /// 3. **Typeshed-style**: `{workspace_root}/stubs/{pkg}-stubs/{submodule}.pyi`
    /// 4. **Extra directories**: Each path in `extra_stub_dirs`
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

        // Get the module path for stubs folder and typeshed-style lookups
        let module_path = self.module_path_from_source(source_path)?;

        // 2. Check stubs/ folder at workspace root
        let stubs_folder_path = self.options.workspace_root.join("stubs").join(&module_path);
        if stubs_folder_path.exists() {
            return Some(StubInfo {
                stub_path: stubs_folder_path,
                source_path: source_path.to_path_buf(),
                location: StubLocation::StubsFolder,
            });
        }

        // 3. Check typeshed-style package-stubs (if enabled)
        if self.options.check_typeshed_style {
            if let Some(stub) = self.find_typeshed_style_stub(source_path, &module_path) {
                return Some(stub);
            }
        }

        // 4. Check extra stub directories
        for extra_dir in &self.options.extra_stub_dirs {
            let extra_stub = extra_dir.join(&module_path);
            if extra_stub.exists() {
                return Some(StubInfo {
                    stub_path: extra_stub,
                    source_path: source_path.to_path_buf(),
                    // Extra dirs are treated as stubs folder locations
                    location: StubLocation::StubsFolder,
                });
            }
        }

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

    /// Compute the module path from a source file path.
    ///
    /// Converts a source path to a relative module path suitable for
    /// stub lookups. The path is relative to the workspace root and
    /// has `.pyi` extension.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // /project/src/pkg/module.py -> pkg/module.pyi (if src is workspace root)
    /// // /project/pkg/module.py -> pkg/module.pyi (if project is workspace root)
    /// ```
    ///
    /// Returns `None` if the path is not under the workspace root.
    fn module_path_from_source(&self, source_path: &Path) -> Option<PathBuf> {
        // Convert /project/src/pkg/module.py -> pkg/module.pyi
        // This requires knowing the Python source roots

        // For now, use relative path from workspace root
        let relative = source_path
            .strip_prefix(&self.options.workspace_root)
            .ok()?;
        Some(relative.with_extension("pyi"))
    }

    /// Find a typeshed-style stub for the given source path.
    ///
    /// Typeshed-style stubs use the `pkg-stubs` convention, where
    /// `pkg/module.py` maps to `stubs/pkg-stubs/module.pyi`.
    ///
    /// # Example
    ///
    /// For `pkg/sub/module.py`:
    /// - Check `{workspace_root}/stubs/pkg-stubs/sub/module.pyi`
    ///
    /// Returns `None` if the module path is empty or no typeshed-style stub exists.
    fn find_typeshed_style_stub(&self, source_path: &Path, module_path: &Path) -> Option<StubInfo> {
        // For pkg/module.py, check stubs/pkg-stubs/module.pyi
        let components: Vec<_> = module_path.components().collect();
        if components.is_empty() {
            return None;
        }

        // Get top-level package name
        let top_level = components[0].as_os_str().to_string_lossy();
        let stubs_pkg = format!("{}-stubs", top_level);

        let mut typeshed_path = self.options.workspace_root.join("stubs").join(&stubs_pkg);
        for component in &components[1..] {
            typeshed_path = typeshed_path.join(component);
        }

        if typeshed_path.exists() {
            Some(StubInfo {
                stub_path: typeshed_path,
                source_path: source_path.to_path_buf(),
                location: StubLocation::TypeshedStyle,
            })
        } else {
            None
        }
    }

    /// Find stub file and return error with all searched locations if not found.
    ///
    /// Unlike `find_stub_for`, this method returns an error instead of `None`
    /// when no stub is found. The error includes all locations that were searched,
    /// which is useful for diagnostic messages.
    ///
    /// # Example
    ///
    /// ```ignore
    /// use tugtool_python::stubs::{StubDiscovery, StubError};
    /// use std::path::Path;
    ///
    /// let discovery = StubDiscovery::for_workspace("/project");
    /// match discovery.find_stub_or_err(Path::new("/project/src/utils.py")) {
    ///     Ok(info) => println!("Found stub at: {:?}", info.stub_path),
    ///     Err(StubError::NotFound { searched_locations, .. }) => {
    ///         println!("Checked {} locations", searched_locations.len());
    ///     }
    ///     Err(e) => println!("Error: {}", e),
    /// }
    /// ```
    pub fn find_stub_or_err(&self, source_path: &Path) -> StubResult<StubInfo> {
        if let Some(info) = self.find_stub_for(source_path) {
            return Ok(info);
        }

        Err(StubError::NotFound {
            source_path: source_path.to_path_buf(),
            searched_locations: self.search_locations(source_path),
        })
    }

    /// Get all locations that would be searched for a stub.
    ///
    /// Returns a list of all paths that would be checked when searching
    /// for a stub file, in order of priority. This is useful for debugging
    /// and error messages.
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_python::stubs::StubDiscovery;
    /// use std::path::Path;
    ///
    /// let discovery = StubDiscovery::for_workspace("/project");
    /// let locations = discovery.search_locations(Path::new("/project/pkg/module.py"));
    ///
    /// // First location is always the inline stub
    /// assert!(locations[0].to_str().unwrap().ends_with("module.pyi"));
    /// ```
    pub fn search_locations(&self, source_path: &Path) -> Vec<PathBuf> {
        let mut locations = Vec::new();

        // 1. Inline stub (always checked first)
        locations.push(self.inline_stub_path(source_path));

        // 2. Stubs folder at workspace root
        if let Some(module_path) = self.module_path_from_source(source_path) {
            let stubs_folder_path = self.options.workspace_root.join("stubs").join(&module_path);
            locations.push(stubs_folder_path);

            // 3. Typeshed-style pkg-stubs (if enabled)
            if self.options.check_typeshed_style {
                let components: Vec<_> = module_path.components().collect();
                if !components.is_empty() {
                    let top_level = components[0].as_os_str().to_string_lossy();
                    let stubs_pkg = format!("{}-stubs", top_level);

                    let mut typeshed_path =
                        self.options.workspace_root.join("stubs").join(&stubs_pkg);
                    for component in &components[1..] {
                        typeshed_path = typeshed_path.join(component);
                    }
                    locations.push(typeshed_path);
                }
            }

            // 4. Extra stub directories
            for extra_dir in &self.options.extra_stub_dirs {
                locations.push(extra_dir.join(&module_path));
            }
        }

        locations
    }
}

// ============================================================================
// Stub Parsing
// ============================================================================

/// A parsed stub file with extracted symbols.
///
/// Contains all the functions, classes, type aliases, and variables
/// extracted from a .pyi file, with span information for each symbol.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::stubs::ParsedStub;
/// use std::path::PathBuf;
///
/// let source = "def foo() -> int: ...";
/// let stub = ParsedStub::parse_str(source, PathBuf::from("module.pyi"))?;
///
/// assert!(stub.has_symbol("foo"));
/// let func = stub.find_function("foo").unwrap();
/// println!("Function {} at {:?}", func.name, func.name_span);
/// ```
#[derive(Debug, Clone)]
pub struct ParsedStub {
    /// Path to the stub file.
    pub path: PathBuf,
    /// Collected symbols (functions, classes, type aliases, variables).
    pub symbols: StubSymbols,
    /// The original source code.
    pub source: String,
}

// ============================================================================
// String Annotation Parser
// ============================================================================

/// A reference found in a string annotation.
///
/// Represents a type name or identifier found within a string annotation
/// (forward reference). Each reference includes position information to
/// enable precise renaming.
///
/// # Example
///
/// For the annotation `"List[Handler]"`, two refs would be extracted:
/// - `AnnotationRef { name: "List", offset_in_string: 0, length: 4 }`
/// - `AnnotationRef { name: "Handler", offset_in_string: 5, length: 7 }`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationRef {
    /// The name referenced (e.g., "Handler", "List").
    pub name: String,
    /// Position within the annotation string content (not including outer quotes).
    pub offset_in_string: usize,
    /// Length of the name in bytes.
    pub length: usize,
}

/// Information about a parsed string annotation.
///
/// Contains the extracted content, quote style, and all type references
/// found within the annotation.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::stubs::StringAnnotationParser;
///
/// let parsed = StringAnnotationParser::parse("\"List[Handler]\"")?;
/// assert_eq!(parsed.content, "List[Handler]");
/// assert_eq!(parsed.quote_char, '"');
/// assert_eq!(parsed.refs.len(), 2);
/// ```
#[derive(Debug, Clone)]
pub struct ParsedAnnotation {
    /// The annotation content (without outer quotes).
    pub content: String,
    /// The quote character used (' or ").
    pub quote_char: char,
    /// All type references found in the annotation.
    pub refs: Vec<AnnotationRef>,
}

/// Internal token type for annotation parsing.
#[derive(Debug, Clone)]
#[allow(dead_code)] // Punct value is used structurally for parsing
enum AnnotationToken {
    /// An identifier (type name, module name).
    Name { value: String, offset: usize },
    /// A punctuation character ([, ], |, ., ,, (, )).
    Punct(char),
}

/// Parses and transforms type expressions in string annotations.
///
/// String annotations are used for forward references and lazy imports:
///
/// ```python
/// def process(handler: "Handler") -> "Result":
///     items: "List[Item]" = []
/// ```
///
/// This parser extracts type names from string content for renaming
/// and can transform annotations to replace names.
///
/// # Supported Patterns
///
/// - Simple names: `"ClassName"` → refs `["ClassName"]`
/// - Qualified names: `"module.Class"` → refs `["module", "Class"]`
/// - Generic types: `"List[Item]"` → refs `["List", "Item"]`
/// - Union types: `"A | B"` → refs `["A", "B"]`
/// - Optional: `"Optional[T]"` → refs `["Optional", "T"]`
/// - Callable: `"Callable[[A], B]"` → refs `["Callable", "A", "B"]`
/// - Nested generics: `"Dict[str, List[int]]"` → refs `["Dict", "str", "List", "int"]`
///
/// # Example
///
/// ```ignore
/// use tugtool_python::stubs::StringAnnotationParser;
///
/// // Parse an annotation
/// let parsed = StringAnnotationParser::parse("\"List[Handler]\"")?;
/// assert_eq!(parsed.refs.len(), 2);
///
/// // Rename a type within an annotation
/// let result = StringAnnotationParser::rename(
///     "\"Handler\"",
///     "Handler",
///     "RequestHandler"
/// )?;
/// assert_eq!(result, "\"RequestHandler\"");
///
/// // Check if a name appears in an annotation
/// let found = StringAnnotationParser::contains_name("\"List[Handler]\"", "Handler")?;
/// assert!(found);
/// ```
pub struct StringAnnotationParser;

impl StringAnnotationParser {
    /// Parse a string annotation and extract type references.
    ///
    /// # Arguments
    ///
    /// * `annotation` - The annotation including quotes (e.g., `"Handler"` or `'Type'`)
    ///
    /// # Returns
    ///
    /// Parsed annotation info, or error if invalid syntax.
    ///
    /// # Errors
    ///
    /// Returns `StubError::InvalidAnnotation` if:
    /// - The string is too short (less than 2 characters)
    /// - The string doesn't start/end with matching quotes
    /// - The content contains invalid characters
    ///
    /// # Example
    ///
    /// ```ignore
    /// let parsed = StringAnnotationParser::parse("\"List[Item]\"")?;
    /// assert_eq!(parsed.content, "List[Item]");
    /// assert_eq!(parsed.refs.len(), 2);
    /// ```
    pub fn parse(annotation: &str) -> StubResult<ParsedAnnotation> {
        // 1. Extract quote character and content
        let (quote_char, content) = Self::extract_content(annotation)?;

        // 2. Tokenize the content
        let tokens = Self::tokenize(content)?;

        // 3. Extract name references
        let refs = Self::extract_refs(&tokens);

        Ok(ParsedAnnotation {
            content: content.to_string(),
            quote_char,
            refs,
        })
    }

    /// Transform a string annotation by renaming a symbol.
    ///
    /// Replaces all occurrences of `old_name` with `new_name` in the annotation,
    /// preserving the original quote style.
    ///
    /// # Arguments
    ///
    /// * `annotation` - Original annotation (including quotes)
    /// * `old_name` - Name to replace
    /// * `new_name` - Replacement name
    ///
    /// # Returns
    ///
    /// The transformed annotation string, preserving quote style.
    ///
    /// # Example
    ///
    /// ```ignore
    /// // Simple rename
    /// let result = StringAnnotationParser::rename(
    ///     "\"Handler\"",
    ///     "Handler",
    ///     "RequestHandler"
    /// )?;
    /// assert_eq!(result, "\"RequestHandler\"");
    ///
    /// // Preserves single quotes
    /// let result = StringAnnotationParser::rename(
    ///     "'List[Handler]'",
    ///     "Handler",
    ///     "RequestHandler"
    /// )?;
    /// assert_eq!(result, "'List[RequestHandler]'");
    ///
    /// // Multiple references
    /// let result = StringAnnotationParser::rename(
    ///     "\"Dict[Handler, Handler]\"",
    ///     "Handler",
    ///     "RequestHandler"
    /// )?;
    /// assert_eq!(result, "\"Dict[RequestHandler, RequestHandler]\"");
    /// ```
    pub fn rename(annotation: &str, old_name: &str, new_name: &str) -> StubResult<String> {
        let parsed = Self::parse(annotation)?;

        // Find all occurrences of old_name and replace
        let mut result = parsed.content.clone();

        // Replace in reverse order to preserve offsets
        let mut replacements: Vec<_> = parsed.refs.iter().filter(|r| r.name == old_name).collect();
        replacements.sort_by(|a, b| b.offset_in_string.cmp(&a.offset_in_string));

        for r in replacements {
            result.replace_range(r.offset_in_string..r.offset_in_string + r.length, new_name);
        }

        Ok(format!(
            "{}{}{}",
            parsed.quote_char, result, parsed.quote_char
        ))
    }

    /// Check if an annotation contains a reference to a given name.
    ///
    /// # Arguments
    ///
    /// * `annotation` - The annotation including quotes
    /// * `name` - The name to search for
    ///
    /// # Returns
    ///
    /// `true` if the annotation contains a reference to the name.
    ///
    /// # Example
    ///
    /// ```ignore
    /// assert!(StringAnnotationParser::contains_name("\"List[Handler]\"", "Handler")?);
    /// assert!(StringAnnotationParser::contains_name("\"List[Handler]\"", "List")?);
    /// assert!(!StringAnnotationParser::contains_name("\"List[Handler]\"", "Dict")?);
    /// ```
    pub fn contains_name(annotation: &str, name: &str) -> StubResult<bool> {
        let parsed = Self::parse(annotation)?;
        Ok(parsed.refs.iter().any(|r| r.name == name))
    }

    /// Extract the quote character and inner content from an annotation string.
    fn extract_content(annotation: &str) -> StubResult<(char, &str)> {
        let bytes = annotation.as_bytes();
        if bytes.len() < 2 {
            return Err(StubError::InvalidAnnotation {
                annotation: annotation.to_string(),
                message: "Annotation too short".to_string(),
            });
        }

        let quote = bytes[0] as char;
        if quote != '"' && quote != '\'' {
            return Err(StubError::InvalidAnnotation {
                annotation: annotation.to_string(),
                message: format!("Invalid quote character: {}", quote),
            });
        }

        let last = bytes[bytes.len() - 1] as char;
        if last != quote {
            return Err(StubError::InvalidAnnotation {
                annotation: annotation.to_string(),
                message: "Mismatched quotes".to_string(),
            });
        }

        Ok((quote, &annotation[1..annotation.len() - 1]))
    }

    /// Tokenize annotation content into names and punctuation.
    fn tokenize(content: &str) -> StubResult<Vec<AnnotationToken>> {
        let mut tokens = Vec::new();
        let mut chars = content.char_indices().peekable();

        while let Some((i, ch)) = chars.next() {
            match ch {
                // Identifier start
                'a'..='z' | 'A'..='Z' | '_' => {
                    let start = i;
                    while let Some(&(_, c)) = chars.peek() {
                        if c.is_alphanumeric() || c == '_' {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    let end = chars.peek().map(|(idx, _)| *idx).unwrap_or(content.len());
                    tokens.push(AnnotationToken::Name {
                        value: content[start..end].to_string(),
                        offset: start,
                    });
                }
                // Operators and delimiters
                '[' | ']' | ',' | '|' | '.' | '(' | ')' => {
                    tokens.push(AnnotationToken::Punct(ch));
                }
                // Whitespace - skip
                ' ' | '\t' | '\n' | '\r' => continue,
                // Unknown character
                _ => {
                    return Err(StubError::InvalidAnnotation {
                        annotation: content.to_string(),
                        message: format!("Unexpected character: {}", ch),
                    });
                }
            }
        }

        Ok(tokens)
    }

    /// Extract name references from tokens.
    fn extract_refs(tokens: &[AnnotationToken]) -> Vec<AnnotationRef> {
        tokens
            .iter()
            .filter_map(|t| {
                if let AnnotationToken::Name { value, offset } = t {
                    Some(AnnotationRef {
                        name: value.clone(),
                        offset_in_string: *offset,
                        length: value.len(),
                    })
                } else {
                    None
                }
            })
            .collect()
    }
}

impl ParsedStub {
    /// Parse a stub file from disk.
    ///
    /// Reads the file and parses its contents.
    ///
    /// # Errors
    ///
    /// Returns `StubError::IoError` if the file cannot be read.
    /// Returns `StubError::ParseError` if the file has invalid Python syntax.
    pub fn parse(stub_path: impl Into<PathBuf>) -> StubResult<Self> {
        let path = stub_path.into();
        let source = std::fs::read_to_string(&path).map_err(|e| StubError::IoError {
            stub_path: path.clone(),
            message: e.to_string(),
        })?;
        Self::parse_str(&source, path)
    }

    /// Parse a stub from a string.
    ///
    /// # Errors
    ///
    /// Returns `StubError::ParseError` if the source has invalid Python syntax.
    pub fn parse_str(source: &str, stub_path: impl Into<PathBuf>) -> StubResult<Self> {
        let path = stub_path.into();

        // Parse the stub source using the CST parser
        let parsed =
            parse_module_with_positions(source, None).map_err(|e| StubError::ParseError {
                stub_path: path.clone(),
                message: prettify_error(e, source),
            })?;

        // Collect symbols using the StubSymbols collector
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        Ok(ParsedStub {
            path,
            symbols,
            source: source.to_string(),
        })
    }

    /// Find a function by name.
    ///
    /// Returns the first function with the given name, or `None` if not found.
    pub fn find_function(&self, name: &str) -> Option<&StubFunction> {
        self.symbols.find_function(name)
    }

    /// Find a class by name.
    ///
    /// Returns the first class with the given name, or `None` if not found.
    pub fn find_class(&self, name: &str) -> Option<&StubClass> {
        self.symbols.find_class(name)
    }

    /// Find a method within a class.
    ///
    /// Returns the method with the given name in the specified class,
    /// or `None` if the class or method is not found.
    pub fn find_method(&self, class_name: &str, method_name: &str) -> Option<&StubFunction> {
        self.symbols.find_method(class_name, method_name)
    }

    /// Find a type alias by name.
    ///
    /// Returns the first type alias with the given name, or `None` if not found.
    pub fn find_type_alias(&self, name: &str) -> Option<&StubTypeAlias> {
        self.symbols.type_aliases.iter().find(|t| t.name == name)
    }

    /// Find a variable by name.
    ///
    /// Returns the first variable with the given name, or `None` if not found.
    pub fn find_variable(&self, name: &str) -> Option<&StubVariable> {
        self.symbols.variables.iter().find(|v| v.name == name)
    }

    /// Check if a symbol exists in the stub.
    ///
    /// Checks functions, classes, type aliases, and variables.
    pub fn has_symbol(&self, name: &str) -> bool {
        self.symbols.has_symbol(name)
    }

    /// Get all symbol names in the stub.
    ///
    /// Returns a list of all top-level symbol names (functions, classes,
    /// type aliases, and variables).
    pub fn symbol_names(&self) -> Vec<&str> {
        let mut names = Vec::new();
        names.extend(self.symbols.functions.iter().map(|f| f.name.as_str()));
        names.extend(self.symbols.classes.iter().map(|c| c.name.as_str()));
        names.extend(self.symbols.type_aliases.iter().map(|t| t.name.as_str()));
        names.extend(self.symbols.variables.iter().map(|v| v.name.as_str()));
        names
    }
}

// ============================================================================
// Stub Editing Types
// ============================================================================

/// A single edit operation in a stub file.
///
/// Represents an atomic change to be made in a stub file. Multiple edits
/// are collected in a [`StubEdits`] struct and applied together.
///
/// # Variants
///
/// - [`Rename`](StubEdit::Rename): Replace a symbol name at a specific span
/// - [`Delete`](StubEdit::Delete): Remove a symbol definition
/// - [`Insert`](StubEdit::Insert): Add new content at a position
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StubEdit {
    /// Rename a symbol at the given span.
    ///
    /// The span identifies the location of the symbol name in the stub file.
    /// The entire span is replaced with `new_name`.
    Rename {
        /// The span of the symbol name to replace.
        span: Span,
        /// The new name for the symbol.
        new_name: String,
    },

    /// Delete content at the given span.
    ///
    /// Used when moving a symbol out of a stub file.
    Delete {
        /// The span of content to remove.
        span: Span,
    },

    /// Insert new content at a position.
    ///
    /// Used when moving a symbol into a stub file.
    Insert {
        /// The byte position where content should be inserted.
        position: usize,
        /// The text to insert.
        text: String,
    },
}

/// A collection of edits for a single stub file.
///
/// Contains the path to the stub file and all edits to be applied to it.
/// Edits should be applied in reverse position order to avoid invalidating
/// spans as content is modified.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::stubs::{StubEdits, StubEdit};
/// use tugtool_core::patch::Span;
/// use std::path::PathBuf;
///
/// let edits = StubEdits {
///     stub_path: PathBuf::from("/project/src/utils.pyi"),
///     edits: vec![
///         StubEdit::Rename {
///             span: Span::new(50, 60),
///             new_name: "new_function".to_string(),
///         },
///     ],
/// };
/// ```
#[derive(Debug, Clone)]
pub struct StubEdits {
    /// Path to the stub file.
    pub stub_path: PathBuf,
    /// List of edits to apply.
    pub edits: Vec<StubEdit>,
}

/// Edits for moving a symbol between stub files.
///
/// When a symbol is moved from one module to another, both the source and
/// target stub files may need to be updated. This struct contains the edits
/// for both files.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::stubs::MoveStubEdits;
///
/// // Move a function from utils.pyi to helpers.pyi
/// let move_edits = updater.move_edits(
///     Path::new("/project/utils.py"),
///     Path::new("/project/helpers.py"),
///     "my_function"
/// )?;
///
/// if let Some(source) = &move_edits.source_edits {
///     // Delete from source stub
///     for edit in &source.edits {
///         // Apply deletion edit
///     }
/// }
///
/// if let Some(target) = &move_edits.target_edits {
///     // Insert into target stub
///     for edit in &target.edits {
///         // Apply insertion edit
///     }
/// }
/// ```
#[derive(Debug, Clone)]
pub struct MoveStubEdits {
    /// Edits to apply to the source stub (deletions).
    ///
    /// `None` if no source stub exists.
    pub source_edits: Option<StubEdits>,

    /// Edits to apply to the target stub (insertions).
    ///
    /// `None` if no target stub exists.
    pub target_edits: Option<StubEdits>,
}

// ============================================================================
// Stub Updater
// ============================================================================

/// Generates edits for stub files when source code is refactored.
///
/// The `StubUpdater` coordinates between source file changes and stub file
/// updates. When a symbol is renamed or moved in source code, the corresponding
/// stub file must also be updated to maintain consistency.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::stubs::{StubDiscovery, StubUpdater};
/// use std::path::Path;
///
/// let discovery = StubDiscovery::for_workspace("/project");
/// let updater = StubUpdater::new(discovery);
///
/// // Rename Handler -> RequestHandler
/// if let Some(edits) = updater.rename_edits(
///     Path::new("/project/src/handlers.py"),
///     "Handler",
///     "RequestHandler"
/// )? {
///     // Apply edits to stub file
///     for edit in &edits.edits {
///         // Process each StubEdit...
///     }
/// }
/// ```
pub struct StubUpdater {
    /// The discovery instance for finding stub files.
    discovery: StubDiscovery,
}

impl StubUpdater {
    /// Create a new StubUpdater with the given discovery instance.
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_python::stubs::{StubDiscovery, StubUpdater};
    ///
    /// let discovery = StubDiscovery::for_workspace("/project");
    /// let updater = StubUpdater::new(discovery);
    /// ```
    pub fn new(discovery: StubDiscovery) -> Self {
        Self { discovery }
    }

    /// Get the underlying discovery instance.
    pub fn discovery(&self) -> &StubDiscovery {
        &self.discovery
    }

    /// Generate stub edits for a rename operation.
    ///
    /// Given a symbol rename in source, returns the corresponding edits
    /// needed in the stub file (if one exists).
    ///
    /// # Arguments
    ///
    /// * `source_path` - Path to the source file being modified
    /// * `old_name` - The old symbol name
    /// * `new_name` - The new symbol name
    ///
    /// # Returns
    ///
    /// * `Ok(Some(edits))` - Stub exists and needs these edits
    /// * `Ok(None)` - No stub file exists (no edits needed)
    /// * `Err` - Stub exists but has parse errors
    ///
    /// # Edits Generated
    ///
    /// For a rename, edits are generated for:
    /// - The symbol definition (function name, class name, etc.)
    /// - References in return type annotations
    /// - References in parameter type annotations
    /// - References in attribute type annotations
    /// - References in string annotations (forward references)
    ///
    /// # Example
    ///
    /// ```ignore
    /// use tugtool_python::stubs::{StubDiscovery, StubUpdater};
    /// use std::path::Path;
    ///
    /// let updater = StubUpdater::new(StubDiscovery::for_workspace("/project"));
    ///
    /// // Rename Handler -> RequestHandler
    /// let edits = updater.rename_edits(
    ///     Path::new("/project/src/handlers.py"),
    ///     "Handler",
    ///     "RequestHandler"
    /// )?;
    ///
    /// match edits {
    ///     Some(stub_edits) => println!("Found {} edits", stub_edits.edits.len()),
    ///     None => println!("No stub file exists"),
    /// }
    /// ```
    pub fn rename_edits(
        &self,
        source_path: &Path,
        old_name: &str,
        new_name: &str,
    ) -> StubResult<Option<StubEdits>> {
        // 1. Find stub for source path
        let stub_info = match self.discovery.find_stub_for(source_path) {
            Some(info) => info,
            None => return Ok(None), // No stub exists, no edits needed
        };

        // 2. Parse stub file
        let stub = ParsedStub::parse(&stub_info.stub_path)?;

        // 3. Collect edits
        let mut edits = Vec::new();

        // 4. Find symbol by name and generate rename edit for its name span
        self.collect_symbol_rename_edits(&stub, old_name, new_name, &mut edits);

        // 5. Find references in type annotations
        self.collect_annotation_rename_edits(&stub, old_name, new_name, &mut edits);

        // If no edits found, symbol may not exist in stub (warn case)
        if edits.is_empty() {
            return Ok(None);
        }

        Ok(Some(StubEdits {
            stub_path: stub_info.stub_path,
            edits,
        }))
    }

    /// Collect rename edits for symbol definitions.
    fn collect_symbol_rename_edits(
        &self,
        stub: &ParsedStub,
        old_name: &str,
        new_name: &str,
        edits: &mut Vec<StubEdit>,
    ) {
        // Check functions
        if let Some(func) = stub.find_function(old_name) {
            if let Some(span) = func.name_span {
                edits.push(StubEdit::Rename {
                    span,
                    new_name: new_name.to_string(),
                });
            }
        }

        // Check classes
        if let Some(class) = stub.find_class(old_name) {
            if let Some(span) = class.name_span {
                edits.push(StubEdit::Rename {
                    span,
                    new_name: new_name.to_string(),
                });
            }
        }

        // Check type aliases
        if let Some(alias) = stub.find_type_alias(old_name) {
            if let Some(span) = alias.name_span {
                edits.push(StubEdit::Rename {
                    span,
                    new_name: new_name.to_string(),
                });
            }
        }

        // Check variables
        if let Some(var) = stub.find_variable(old_name) {
            if let Some(span) = var.name_span {
                edits.push(StubEdit::Rename {
                    span,
                    new_name: new_name.to_string(),
                });
            }
        }
    }

    /// Collect rename edits for type annotation references.
    ///
    /// This method handles type references in:
    /// - Module-level function signatures (return types and parameters)
    /// - Class method signatures (return types and parameters)
    /// - Class attributes
    /// - Module-level variables
    ///
    /// Uses CST-based exact name matching (via TypeNameSpan) to avoid
    /// false positives from string pattern matching.
    fn collect_annotation_rename_edits(
        &self,
        stub: &ParsedStub,
        old_name: &str,
        new_name: &str,
        edits: &mut Vec<StubEdit>,
    ) {
        // Check module-level functions
        for func in &stub.symbols.functions {
            self.collect_function_annotation_edits(func, old_name, new_name, edits);
        }

        // Check all classes for methods and attribute annotations
        for class in &stub.symbols.classes {
            // Check methods
            for method in &class.methods {
                self.collect_function_annotation_edits(method, old_name, new_name, edits);
            }

            // Check class attributes (using type_spans for exact matching)
            for attr in &class.attributes {
                Self::collect_type_span_edits(&attr.type_spans, old_name, new_name, edits);
            }
        }

        // Check module-level variables (using type_spans for exact matching)
        for var in &stub.symbols.variables {
            Self::collect_type_span_edits(&var.type_spans, old_name, new_name, edits);
        }
    }

    /// Collect annotation edits for a function (return type and parameters).
    ///
    /// Uses CST-based type_spans for exact name matching.
    fn collect_function_annotation_edits(
        &self,
        func: &StubFunction,
        old_name: &str,
        new_name: &str,
        edits: &mut Vec<StubEdit>,
    ) {
        // Check return type annotation (using return_type_spans for exact matching)
        Self::collect_type_span_edits(&func.return_type_spans, old_name, new_name, edits);

        // Check parameter annotations (using type_spans for exact matching)
        for param in &func.params {
            Self::collect_type_span_edits(&param.type_spans, old_name, new_name, edits);
        }
    }

    /// Collect annotation edits for type spans using exact name matching.
    ///
    /// This replaces the old string-based pattern matching with precise
    /// CST-derived spans. Each TypeNameSpan represents a single type name
    /// at an exact location, so we can match exactly without false positives.
    ///
    /// # Arguments
    ///
    /// * `type_spans` - Vector of TypeNameSpan from the CST
    /// * `old_name` - The name to match exactly
    /// * `new_name` - The replacement name
    /// * `edits` - Vector to accumulate edit operations
    fn collect_type_span_edits(
        type_spans: &[TypeNameSpan],
        old_name: &str,
        new_name: &str,
        edits: &mut Vec<StubEdit>,
    ) {
        for type_span in type_spans {
            // Exact name match - no string contains() or replace()
            if type_span.name == old_name {
                edits.push(StubEdit::Rename {
                    span: type_span.span,
                    new_name: new_name.to_string(),
                });
            }
        }
    }

    /// Generate stub edits for moving a symbol to another module.
    ///
    /// Returns edits to remove from source stub and add to target stub.
    ///
    /// # Arguments
    ///
    /// * `source_path` - Path to the source file (where symbol is being moved from)
    /// * `target_path` - Path to the target file (where symbol is being moved to)
    /// * `symbol_name` - Name of the symbol being moved
    ///
    /// # Returns
    ///
    /// [`MoveStubEdits`] containing:
    /// - `source_edits`: Deletion edits for the source stub (if it exists)
    /// - `target_edits`: Insertion edits for the target stub (if it exists)
    ///
    /// Both fields may be `None` if the corresponding stub doesn't exist.
    ///
    /// # Example
    ///
    /// ```ignore
    /// use tugtool_python::stubs::{StubDiscovery, StubUpdater};
    /// use std::path::Path;
    ///
    /// let updater = StubUpdater::new(StubDiscovery::for_workspace("/project"));
    ///
    /// let move_edits = updater.move_edits(
    ///     Path::new("/project/utils.py"),
    ///     Path::new("/project/helpers.py"),
    ///     "my_function"
    /// )?;
    ///
    /// if move_edits.source_edits.is_some() {
    ///     println!("Need to delete from source stub");
    /// }
    /// if move_edits.target_edits.is_some() {
    ///     println!("Need to insert into target stub");
    /// }
    /// ```
    pub fn move_edits(
        &self,
        source_path: &Path,
        target_path: &Path,
        symbol_name: &str,
    ) -> StubResult<MoveStubEdits> {
        let mut result = MoveStubEdits {
            source_edits: None,
            target_edits: None,
        };

        // 1. Handle source stub (deletion)
        if let Some(source_stub_info) = self.discovery.find_stub_for(source_path) {
            let source_stub = ParsedStub::parse(&source_stub_info.stub_path)?;

            // Find the symbol and get its definition span
            if let Some((def_span, def_text)) =
                self.find_symbol_definition(&source_stub, symbol_name)
            {
                result.source_edits = Some(StubEdits {
                    stub_path: source_stub_info.stub_path,
                    edits: vec![StubEdit::Delete { span: def_span }],
                });

                // 2. Handle target stub (insertion)
                if let Some(target_stub_info) = self.discovery.find_stub_for(target_path) {
                    let target_stub = ParsedStub::parse(&target_stub_info.stub_path)?;

                    // Find insertion position (end of file for simplicity)
                    let insert_position = target_stub.source.len();

                    result.target_edits = Some(StubEdits {
                        stub_path: target_stub_info.stub_path,
                        edits: vec![StubEdit::Insert {
                            position: insert_position,
                            text: format!("\n{}", def_text),
                        }],
                    });
                }
            }
        }

        Ok(result)
    }

    /// Find a symbol's definition span and text in a stub.
    fn find_symbol_definition(&self, stub: &ParsedStub, name: &str) -> Option<(Span, String)> {
        // Check functions
        if let Some(func) = stub.find_function(name) {
            if let Some(def_span) = func.def_span {
                let text = stub.source[def_span.start..def_span.end].to_string();
                return Some((def_span, text));
            }
        }

        // Check classes
        if let Some(class) = stub.find_class(name) {
            if let Some(def_span) = class.def_span {
                let text = stub.source[def_span.start..def_span.end].to_string();
                return Some((def_span, text));
            }
        }

        // Check type aliases - use def_span which covers the full definition
        if let Some(alias) = stub.find_type_alias(name) {
            if let Some(def_span) = alias.def_span {
                let text = stub.source[def_span.start..def_span.end].to_string();
                return Some((def_span, text));
            }
        }

        // Check variables
        if let Some(var) = stub.find_variable(name) {
            if let Some(name_span) = var.name_span {
                // For variables, include the annotation if present
                // Use the last type_span's end position if type_spans exist
                let end = var
                    .type_spans
                    .last()
                    .map(|s| s.span.end)
                    .unwrap_or(name_span.end);
                let span = Span::new(name_span.start, end);
                let text = stub.source[span.start..span.end].to_string();
                return Some((span, text));
            }
        }

        None
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

        assert_eq!(info.stub_path, PathBuf::from("/project/src/utils.pyi"));
        assert_eq!(info.source_path, PathBuf::from("/project/src/utils.py"));
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

        // ====================================================================
        // Step 0.3.6.3: Stubs Folder and Typeshed-Style Discovery Tests
        // ====================================================================

        #[test]
        fn test_find_stub_stubs_folder() {
            // Example 2 from the plan: stubs folder detection
            let temp_dir = create_temp_project();

            // Create source directory structure (no inline stub)
            let src_dir = temp_dir.path().join("src").join("mypackage");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("handlers.py");
            File::create(&source_path).expect("Failed to create source file");

            // Create stubs folder with stub
            let stubs_dir = temp_dir.path().join("stubs").join("src").join("mypackage");
            fs::create_dir_all(&stubs_dir).expect("Failed to create stubs dir");
            let stub_path = stubs_dir.join("handlers.pyi");
            File::create(&stub_path).expect("Failed to create stub file");

            // Test discovery
            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some(), "Should find stub in stubs folder");
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
            assert_eq!(info.source_path, source_path);
            assert_eq!(info.location, StubLocation::StubsFolder);
        }

        #[test]
        fn test_find_stub_typeshed_style() {
            // Test pkg-stubs pattern detection
            let temp_dir = create_temp_project();

            // Create source directory structure (no inline stub)
            let src_dir = temp_dir.path().join("mypackage").join("submod");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("handlers.py");
            File::create(&source_path).expect("Failed to create source file");

            // Create typeshed-style stub: stubs/mypackage-stubs/submod/handlers.pyi
            let typeshed_dir = temp_dir
                .path()
                .join("stubs")
                .join("mypackage-stubs")
                .join("submod");
            fs::create_dir_all(&typeshed_dir).expect("Failed to create typeshed dir");
            let stub_path = typeshed_dir.join("handlers.pyi");
            File::create(&stub_path).expect("Failed to create stub file");

            // Test discovery
            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some(), "Should find typeshed-style stub");
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
            assert_eq!(info.source_path, source_path);
            assert_eq!(info.location, StubLocation::TypeshedStyle);
        }

        #[test]
        fn test_find_stub_extra_dirs() {
            // Test custom stub directories
            let temp_dir = create_temp_project();

            // Create source directory structure (no inline stub)
            let src_dir = temp_dir.path().join("pkg");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("module.py");
            File::create(&source_path).expect("Failed to create source file");

            // Create extra stubs directory with stub
            let extra_dir = temp_dir.path().join("custom_stubs");
            let extra_pkg_dir = extra_dir.join("pkg");
            fs::create_dir_all(&extra_pkg_dir).expect("Failed to create extra dir");
            let stub_path = extra_pkg_dir.join("module.pyi");
            File::create(&stub_path).expect("Failed to create stub file");

            // Test discovery with extra_stub_dirs
            let discovery = StubDiscovery::new(StubDiscoveryOptions {
                workspace_root: temp_dir.path().to_path_buf(),
                extra_stub_dirs: vec![extra_dir.clone()],
                check_typeshed_style: true,
            });
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some(), "Should find stub in extra dir");
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
            assert_eq!(info.source_path, source_path);
            // Extra dirs are classified as StubsFolder
            assert_eq!(info.location, StubLocation::StubsFolder);
        }

        #[test]
        fn test_find_stub_priority_inline_first() {
            // Inline stub should take precedence over stubs folder
            let temp_dir = create_temp_project();

            // Create source with inline stub
            let src_dir = temp_dir.path().join("pkg");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("module.py");
            let inline_stub = src_dir.join("module.pyi");
            File::create(&source_path).expect("Failed to create source file");
            File::create(&inline_stub).expect("Failed to create inline stub");

            // Also create stubs folder stub
            let stubs_dir = temp_dir.path().join("stubs").join("pkg");
            fs::create_dir_all(&stubs_dir).expect("Failed to create stubs dir");
            let stubs_folder_stub = stubs_dir.join("module.pyi");
            File::create(&stubs_folder_stub).expect("Failed to create stubs folder stub");

            // Test discovery - should find inline first
            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some());
            let info = result.unwrap();
            assert_eq!(info.stub_path, inline_stub, "Should prefer inline stub");
            assert_eq!(info.location, StubLocation::Inline);
        }

        #[test]
        fn test_find_stub_priority_stubs_folder_second() {
            // Stubs folder should take precedence over typeshed-style
            let temp_dir = create_temp_project();

            // Create source (no inline stub)
            let src_dir = temp_dir.path().join("pkg");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("module.py");
            File::create(&source_path).expect("Failed to create source file");

            // Create stubs folder stub
            let stubs_dir = temp_dir.path().join("stubs").join("pkg");
            fs::create_dir_all(&stubs_dir).expect("Failed to create stubs dir");
            let stubs_folder_stub = stubs_dir.join("module.pyi");
            File::create(&stubs_folder_stub).expect("Failed to create stubs folder stub");

            // Also create typeshed-style stub
            let typeshed_dir = temp_dir.path().join("stubs").join("pkg-stubs");
            fs::create_dir_all(&typeshed_dir).expect("Failed to create typeshed dir");
            let typeshed_stub = typeshed_dir.join("module.pyi");
            File::create(&typeshed_stub).expect("Failed to create typeshed stub");

            // Test discovery - should find stubs folder first
            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some());
            let info = result.unwrap();
            assert_eq!(
                info.stub_path, stubs_folder_stub,
                "Should prefer stubs folder over typeshed-style"
            );
            assert_eq!(info.location, StubLocation::StubsFolder);
        }

        #[test]
        fn test_find_stub_init_py_in_stubs_folder() {
            // Test __init__.py to __init__.pyi mapping in stubs folder
            let temp_dir = create_temp_project();

            // Create source package (no inline stub)
            let src_dir = temp_dir.path().join("mypackage");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("__init__.py");
            File::create(&source_path).expect("Failed to create __init__.py");

            // Create stubs folder with __init__.pyi
            let stubs_dir = temp_dir.path().join("stubs").join("mypackage");
            fs::create_dir_all(&stubs_dir).expect("Failed to create stubs dir");
            let stub_path = stubs_dir.join("__init__.pyi");
            File::create(&stub_path).expect("Failed to create __init__.pyi stub");

            // Test discovery
            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some());
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
            assert_eq!(info.location, StubLocation::StubsFolder);
        }

        #[test]
        fn test_find_stub_nested_package_in_stubs_folder() {
            // Test deeply nested package paths in stubs folder
            let temp_dir = create_temp_project();

            // Create deeply nested source (no inline stub)
            let src_dir = temp_dir.path().join("pkg").join("sub").join("deep");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("module.py");
            File::create(&source_path).expect("Failed to create source file");

            // Create matching path in stubs folder
            let stubs_dir = temp_dir
                .path()
                .join("stubs")
                .join("pkg")
                .join("sub")
                .join("deep");
            fs::create_dir_all(&stubs_dir).expect("Failed to create stubs dir");
            let stub_path = stubs_dir.join("module.pyi");
            File::create(&stub_path).expect("Failed to create stub file");

            // Test discovery
            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_for(&source_path);

            assert!(result.is_some());
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
            assert_eq!(info.location, StubLocation::StubsFolder);
        }

        #[test]
        fn test_find_stub_or_err_not_found() {
            // Test find_stub_or_err returns error with searched locations
            let temp_dir = create_temp_project();

            // Create source file only (no stubs anywhere)
            let src_dir = temp_dir.path().join("pkg");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("module.py");
            File::create(&source_path).expect("Failed to create source file");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_or_err(&source_path);

            assert!(result.is_err(), "Should return error when no stub found");

            match result.unwrap_err() {
                StubError::NotFound {
                    source_path: sp,
                    searched_locations,
                } => {
                    assert_eq!(sp, source_path);
                    // Should have searched at least: inline, stubs folder, typeshed-style
                    assert!(
                        searched_locations.len() >= 3,
                        "Expected at least 3 searched locations, got {}",
                        searched_locations.len()
                    );
                    // First should be inline
                    assert!(
                        searched_locations[0]
                            .to_str()
                            .unwrap()
                            .ends_with("module.pyi"),
                        "First location should be inline stub"
                    );
                }
                e => panic!("Expected NotFound error, got: {:?}", e),
            }
        }

        #[test]
        fn test_find_stub_or_err_success() {
            // Test find_stub_or_err returns Ok when stub found
            let temp_dir = create_temp_project();

            // Create source and inline stub
            let source_path = temp_dir.path().join("module.py");
            let stub_path = temp_dir.path().join("module.pyi");
            File::create(&source_path).expect("Failed to create source file");
            File::create(&stub_path).expect("Failed to create stub file");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let result = discovery.find_stub_or_err(&source_path);

            assert!(result.is_ok(), "Should return Ok when stub found");
            let info = result.unwrap();
            assert_eq!(info.stub_path, stub_path);
        }

        #[test]
        fn test_search_locations_complete() {
            // Test search_locations returns all expected paths
            let temp_dir = create_temp_project();

            // Create source file
            let src_dir = temp_dir.path().join("pkg");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("module.py");
            File::create(&source_path).expect("Failed to create source file");

            // Create discovery with extra stub dirs
            let extra_dir = temp_dir.path().join("extra_stubs");
            fs::create_dir_all(&extra_dir).expect("Failed to create extra dir");

            let discovery = StubDiscovery::new(StubDiscoveryOptions {
                workspace_root: temp_dir.path().to_path_buf(),
                extra_stub_dirs: vec![extra_dir.clone()],
                check_typeshed_style: true,
            });

            let locations = discovery.search_locations(&source_path);

            // Should have 4 locations: inline, stubs folder, typeshed-style, extra dir
            assert_eq!(
                locations.len(),
                4,
                "Expected 4 search locations, got: {:?}",
                locations
            );

            // 1. Inline stub
            assert!(
                locations[0].ends_with("pkg/module.pyi"),
                "First should be inline: {:?}",
                locations[0]
            );

            // 2. Stubs folder
            assert!(
                locations[1]
                    .to_str()
                    .unwrap()
                    .contains("stubs/pkg/module.pyi"),
                "Second should be stubs folder: {:?}",
                locations[1]
            );

            // 3. Typeshed-style
            assert!(
                locations[2]
                    .to_str()
                    .unwrap()
                    .contains("stubs/pkg-stubs/module.pyi"),
                "Third should be typeshed-style: {:?}",
                locations[2]
            );

            // 4. Extra dir
            assert!(
                locations[3]
                    .to_str()
                    .unwrap()
                    .contains("extra_stubs/pkg/module.pyi"),
                "Fourth should be extra dir: {:?}",
                locations[3]
            );
        }

        #[test]
        fn test_search_locations_no_typeshed_when_disabled() {
            // Test search_locations excludes typeshed when disabled
            let temp_dir = create_temp_project();

            let src_dir = temp_dir.path().join("pkg");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("module.py");
            File::create(&source_path).expect("Failed to create source file");

            let discovery = StubDiscovery::new(StubDiscoveryOptions {
                workspace_root: temp_dir.path().to_path_buf(),
                extra_stub_dirs: vec![],
                check_typeshed_style: false, // Disabled
            });

            let locations = discovery.search_locations(&source_path);

            // Should have 2 locations: inline, stubs folder (no typeshed)
            assert_eq!(
                locations.len(),
                2,
                "Expected 2 search locations when typeshed disabled, got: {:?}",
                locations
            );

            // Verify no typeshed-style path
            for loc in &locations {
                assert!(
                    !loc.to_str().unwrap().contains("-stubs"),
                    "Should not contain typeshed-style path: {:?}",
                    loc
                );
            }
        }

        #[test]
        fn test_typeshed_style_disabled() {
            // Test that typeshed-style discovery can be disabled
            let temp_dir = create_temp_project();

            // Create source (no inline stub)
            let src_dir = temp_dir.path().join("pkg");
            fs::create_dir_all(&src_dir).expect("Failed to create src dir");
            let source_path = src_dir.join("module.py");
            File::create(&source_path).expect("Failed to create source file");

            // Create ONLY typeshed-style stub
            let typeshed_dir = temp_dir.path().join("stubs").join("pkg-stubs");
            fs::create_dir_all(&typeshed_dir).expect("Failed to create typeshed dir");
            let stub_path = typeshed_dir.join("module.pyi");
            File::create(&stub_path).expect("Failed to create stub file");

            // Test with typeshed disabled
            let discovery = StubDiscovery::new(StubDiscoveryOptions {
                workspace_root: temp_dir.path().to_path_buf(),
                extra_stub_dirs: vec![],
                check_typeshed_style: false, // Disabled!
            });
            let result = discovery.find_stub_for(&source_path);

            assert!(
                result.is_none(),
                "Should not find typeshed-style stub when disabled"
            );
        }

        // ========================================================================
        // ParsedStub Tests
        // ========================================================================

        #[test]
        fn test_stub_parse_function() {
            let source = "def foo(x: int) -> str: ...";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert_eq!(stub.symbols.functions.len(), 1);
            let func = &stub.symbols.functions[0];
            assert_eq!(func.name, "foo");
            assert!(!func.is_async);
            assert!(func.name_span.is_some());
        }

        #[test]
        fn test_stub_parse_async_function() {
            let source = "async def fetch(url: str) -> bytes: ...";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert_eq!(stub.symbols.functions.len(), 1);
            let func = &stub.symbols.functions[0];
            assert_eq!(func.name, "fetch");
            assert!(func.is_async);
        }

        #[test]
        fn test_stub_parse_function_with_decorators() {
            let source = "@staticmethod\n@deprecated\ndef helper() -> None: ...";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert_eq!(stub.symbols.functions.len(), 1);
            let func = &stub.symbols.functions[0];
            assert_eq!(func.decorators.len(), 2);
            assert_eq!(func.decorators[0].name, "staticmethod");
            assert_eq!(func.decorators[1].name, "deprecated");
        }

        #[test]
        fn test_stub_parse_class() {
            // Example 3 from plan
            let source = r#"
from typing import Optional

class Handler:
    def process(self, data: bytes) -> Optional[str]: ...
    def reset(self) -> None: ...

def create_handler(config: dict) -> Handler: ...
"#;
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            // Should have one class
            assert_eq!(stub.symbols.classes.len(), 1);
            let handler = &stub.symbols.classes[0];
            assert_eq!(handler.name, "Handler");

            // Class should have 2 methods
            assert_eq!(handler.methods.len(), 2);
            assert_eq!(handler.methods[0].name, "process");
            assert_eq!(handler.methods[1].name, "reset");

            // Module should have 1 function
            assert_eq!(stub.symbols.functions.len(), 1);
            assert_eq!(stub.symbols.functions[0].name, "create_handler");
        }

        #[test]
        fn test_stub_parse_methods() {
            let source = r#"
class Service:
    def start(self) -> None: ...
    def stop(self) -> None: ...
    async def run(self) -> int: ...
"#;
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            let service = stub.find_class("Service").expect("Service not found");
            assert_eq!(service.methods.len(), 3);
            assert_eq!(service.methods[0].name, "start");
            assert_eq!(service.methods[1].name, "stop");
            assert_eq!(service.methods[2].name, "run");
            assert!(service.methods[2].is_async);
        }

        #[test]
        fn test_stub_parse_class_attributes() {
            let source = r#"
class Config:
    debug: bool
    timeout: int
    name: str
"#;
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            let config = stub.find_class("Config").expect("Config not found");
            assert_eq!(config.attributes.len(), 3);
            assert_eq!(config.attributes[0].name, "debug");
            assert_eq!(config.attributes[1].name, "timeout");
            assert_eq!(config.attributes[2].name, "name");
        }

        #[test]
        fn test_stub_parse_type_alias() {
            let source = "type Handler = Callable[[bytes], str]";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert_eq!(stub.symbols.type_aliases.len(), 1);
            assert_eq!(stub.symbols.type_aliases[0].name, "Handler");
        }

        #[test]
        fn test_stub_parse_variable() {
            let source = "VERSION: str\nDEBUG: bool";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert_eq!(stub.symbols.variables.len(), 2);
            assert_eq!(stub.symbols.variables[0].name, "VERSION");
            assert_eq!(stub.symbols.variables[1].name, "DEBUG");
        }

        #[test]
        fn test_stub_find_function() {
            let source = "def foo(): ...\ndef bar(): ...\ndef baz(): ...";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert!(stub.find_function("foo").is_some());
            assert!(stub.find_function("bar").is_some());
            assert!(stub.find_function("baz").is_some());
            assert!(stub.find_function("qux").is_none());
        }

        #[test]
        fn test_stub_find_class() {
            let source = "class Alpha: ...\nclass Beta: ...";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert!(stub.find_class("Alpha").is_some());
            assert!(stub.find_class("Beta").is_some());
            assert!(stub.find_class("Gamma").is_none());
        }

        #[test]
        fn test_stub_find_method() {
            let source = r#"
class Handler:
    def process(self): ...
    def reset(self): ...
"#;
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert!(stub.find_method("Handler", "process").is_some());
            assert!(stub.find_method("Handler", "reset").is_some());
            assert!(stub.find_method("Handler", "unknown").is_none());
            assert!(stub.find_method("Unknown", "process").is_none());
        }

        #[test]
        fn test_stub_has_symbol_true() {
            let source = "def func(): ...\nclass Klass: ...\nVAR: int";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert!(stub.has_symbol("func"));
            assert!(stub.has_symbol("Klass"));
            assert!(stub.has_symbol("VAR"));
        }

        #[test]
        fn test_stub_has_symbol_false() {
            let source = "def foo(): ...";
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            assert!(!stub.has_symbol("nonexistent"));
            assert!(!stub.has_symbol("bar"));
        }

        #[test]
        fn test_stub_parse_io_error() {
            // Try to parse a file that doesn't exist
            let result = ParsedStub::parse("/nonexistent/path/to/stub.pyi");
            assert!(result.is_err());

            match result.unwrap_err() {
                StubError::IoError { stub_path, message } => {
                    assert!(stub_path.to_str().unwrap().contains("stub.pyi"));
                    assert!(!message.is_empty());
                }
                e => panic!("Expected IoError, got: {:?}", e),
            }
        }

        #[test]
        fn test_stub_parse_failure_returns_error() {
            // Invalid Python syntax
            let source = "def broken(: ...";
            let result = ParsedStub::parse_str(source, PathBuf::from("module.pyi"));
            assert!(result.is_err());

            match result.unwrap_err() {
                StubError::ParseError { stub_path, message } => {
                    assert_eq!(stub_path, PathBuf::from("module.pyi"));
                    assert!(!message.is_empty());
                }
                e => panic!("Expected ParseError, got: {:?}", e),
            }
        }

        #[test]
        fn test_parsed_stub_symbol_names() {
            let source = r#"
def func(): ...
class Klass: ...
type Alias = int
VAR: str
"#;
            let stub =
                ParsedStub::parse_str(source, PathBuf::from("module.pyi")).expect("parse failed");

            let names = stub.symbol_names();
            assert!(names.contains(&"func"));
            assert!(names.contains(&"Klass"));
            assert!(names.contains(&"Alias"));
            assert!(names.contains(&"VAR"));
        }

        // ========================================================================
        // StringAnnotationParser Tests
        // ========================================================================

        #[test]
        fn test_string_annotation_simple_name() {
            // Parse "ClassName"
            let parsed = StringAnnotationParser::parse("\"ClassName\"").expect("parse failed");

            assert_eq!(parsed.content, "ClassName");
            assert_eq!(parsed.quote_char, '"');
            assert_eq!(parsed.refs.len(), 1);
            assert_eq!(parsed.refs[0].name, "ClassName");
            assert_eq!(parsed.refs[0].offset_in_string, 0);
            assert_eq!(parsed.refs[0].length, 9);
        }

        #[test]
        fn test_string_annotation_qualified_name() {
            // Parse "module.Class"
            let parsed = StringAnnotationParser::parse("\"module.Class\"").expect("parse failed");

            assert_eq!(parsed.content, "module.Class");
            assert_eq!(parsed.refs.len(), 2);
            assert_eq!(parsed.refs[0].name, "module");
            assert_eq!(parsed.refs[0].offset_in_string, 0);
            assert_eq!(parsed.refs[1].name, "Class");
            assert_eq!(parsed.refs[1].offset_in_string, 7);
        }

        #[test]
        fn test_string_annotation_generic() {
            // Parse "List[Item]"
            let parsed = StringAnnotationParser::parse("\"List[Item]\"").expect("parse failed");

            assert_eq!(parsed.content, "List[Item]");
            assert_eq!(parsed.refs.len(), 2);
            assert_eq!(parsed.refs[0].name, "List");
            assert_eq!(parsed.refs[1].name, "Item");
        }

        #[test]
        fn test_string_annotation_union() {
            // Parse "A | B"
            let parsed = StringAnnotationParser::parse("\"A | B\"").expect("parse failed");

            assert_eq!(parsed.content, "A | B");
            assert_eq!(parsed.refs.len(), 2);
            assert_eq!(parsed.refs[0].name, "A");
            assert_eq!(parsed.refs[1].name, "B");
        }

        #[test]
        fn test_string_annotation_optional() {
            // Parse "Optional[T]"
            let parsed = StringAnnotationParser::parse("\"Optional[T]\"").expect("parse failed");

            assert_eq!(parsed.refs.len(), 2);
            assert_eq!(parsed.refs[0].name, "Optional");
            assert_eq!(parsed.refs[1].name, "T");
        }

        #[test]
        fn test_string_annotation_callable() {
            // Parse "Callable[[A], B]"
            let parsed =
                StringAnnotationParser::parse("\"Callable[[A], B]\"").expect("parse failed");

            assert_eq!(parsed.refs.len(), 3);
            assert_eq!(parsed.refs[0].name, "Callable");
            assert_eq!(parsed.refs[1].name, "A");
            assert_eq!(parsed.refs[2].name, "B");
        }

        #[test]
        fn test_string_annotation_preserves_single_quotes() {
            // Verify single quotes are preserved on output
            let result =
                StringAnnotationParser::rename("'Type'", "Type", "NewType").expect("rename failed");

            assert_eq!(result, "'NewType'");
        }

        #[test]
        fn test_string_annotation_preserves_double_quotes() {
            // Verify double quotes are preserved on output
            let result = StringAnnotationParser::rename("\"Type\"", "Type", "NewType")
                .expect("rename failed");

            assert_eq!(result, "\"NewType\"");
        }

        #[test]
        fn test_string_annotation_nested_generics() {
            // Parse "Dict[str, List[int]]"
            let parsed =
                StringAnnotationParser::parse("\"Dict[str, List[int]]\"").expect("parse failed");

            assert_eq!(parsed.refs.len(), 4);
            assert_eq!(parsed.refs[0].name, "Dict");
            assert_eq!(parsed.refs[1].name, "str");
            assert_eq!(parsed.refs[2].name, "List");
            assert_eq!(parsed.refs[3].name, "int");
        }

        #[test]
        fn test_string_annotation_rename_simple() {
            // Replace single name (Example 5 from plan)
            let result = StringAnnotationParser::rename("\"Handler\"", "Handler", "RequestHandler")
                .expect("rename failed");

            assert_eq!(result, "\"RequestHandler\"");
        }

        #[test]
        fn test_string_annotation_rename_qualified() {
            // Replace in qualified name (Example 5)
            let result =
                StringAnnotationParser::rename("\"pkg.Handler\"", "Handler", "RequestHandler")
                    .expect("rename failed");

            assert_eq!(result, "\"pkg.RequestHandler\"");
        }

        #[test]
        fn test_string_annotation_rename_generic() {
            // Replace in generic type (Example 5)
            let result =
                StringAnnotationParser::rename("'List[Handler]'", "Handler", "RequestHandler")
                    .expect("rename failed");

            assert_eq!(result, "'List[RequestHandler]'");
        }

        #[test]
        fn test_string_annotation_rename_multiple() {
            // Multiple refs to same name (Example 5)
            let result = StringAnnotationParser::rename(
                "\"Dict[Handler, Handler]\"",
                "Handler",
                "RequestHandler",
            )
            .expect("rename failed");

            assert_eq!(result, "\"Dict[RequestHandler, RequestHandler]\"");
        }

        #[test]
        fn test_string_annotation_rename_union() {
            // Replace in union type (Example 5)
            let result =
                StringAnnotationParser::rename("\"Handler | None\"", "Handler", "RequestHandler")
                    .expect("rename failed");

            assert_eq!(result, "\"RequestHandler | None\"");
        }

        #[test]
        fn test_string_annotation_contains_name_true() {
            // Name found
            assert!(
                StringAnnotationParser::contains_name("\"List[Handler]\"", "Handler")
                    .expect("parse failed")
            );
            assert!(
                StringAnnotationParser::contains_name("\"List[Handler]\"", "List")
                    .expect("parse failed")
            );
        }

        #[test]
        fn test_string_annotation_contains_name_false() {
            // Name not found
            assert!(
                !StringAnnotationParser::contains_name("\"List[Handler]\"", "Dict")
                    .expect("parse failed")
            );
            assert!(
                !StringAnnotationParser::contains_name("\"Handler\"", "RequestHandler")
                    .expect("parse failed")
            );
        }

        #[test]
        fn test_string_annotation_invalid_quotes() {
            // Error for mismatched quotes
            let result = StringAnnotationParser::parse("\"Handler'");
            assert!(result.is_err());

            match result.unwrap_err() {
                StubError::InvalidAnnotation {
                    annotation,
                    message,
                } => {
                    assert_eq!(annotation, "\"Handler'");
                    assert!(message.contains("Mismatched quotes"));
                }
                e => panic!("Expected InvalidAnnotation, got: {:?}", e),
            }
        }

        #[test]
        fn test_string_annotation_invalid_char() {
            // Error for unexpected character
            let result = StringAnnotationParser::parse("\"Handler@Method\"");
            assert!(result.is_err());

            match result.unwrap_err() {
                StubError::InvalidAnnotation { message, .. } => {
                    assert!(message.contains("Unexpected character"));
                }
                e => panic!("Expected InvalidAnnotation, got: {:?}", e),
            }
        }
    }

    // ========================================================================
    // StubUpdater Tests
    // ========================================================================

    mod stub_updater_tests {
        use super::*;
        use std::fs::{self, File};
        use std::io::Write;
        use tempfile::TempDir;

        fn create_temp_project() -> TempDir {
            tempfile::tempdir().expect("Failed to create temp dir")
        }

        fn write_file(path: &Path, content: &str) {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("Failed to create parent dirs");
            }
            let mut file = File::create(path).expect("Failed to create file");
            writeln!(file, "{}", content).expect("Failed to write file");
        }

        #[test]
        fn test_stub_updater_rename_function() {
            // Example 4 from the plan: Rename function in stub
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("handlers.py");
            let stub_path = temp_dir.path().join("handlers.pyi");

            write_file(&source_path, "def process(data: bytes) -> str: pass");
            write_file(&stub_path, "def process(data: bytes) -> str: ...");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "process", "handle")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits when stub exists");
            let edits = edits.unwrap();
            assert_eq!(edits.stub_path, stub_path);
            assert!(!edits.edits.is_empty(), "Should have at least one edit");

            // Check that the rename edit targets "process"
            let rename_count = edits
                .edits
                .iter()
                .filter(|e| matches!(e, StubEdit::Rename { new_name, .. } if new_name == "handle"))
                .count();
            assert!(rename_count > 0, "Should have rename edit for 'handle'");
        }

        #[test]
        fn test_stub_updater_rename_class() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("models.py");
            let stub_path = temp_dir.path().join("models.pyi");

            write_file(&source_path, "class Handler: pass");
            write_file(
                &stub_path,
                "class Handler:\n    def process(self) -> None: ...",
            );

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits when stub exists");
            let edits = edits.unwrap();

            // Check that the rename edit targets class name
            let has_class_rename = edits.edits.iter().any(
                |e| matches!(e, StubEdit::Rename { new_name, .. } if new_name == "RequestHandler"),
            );
            assert!(has_class_rename, "Should rename class to RequestHandler");
        }

        #[test]
        fn test_stub_updater_rename_method() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("service.py");
            let stub_path = temp_dir.path().join("service.pyi");

            write_file(&source_path, "class Service:\n    def fetch(self): pass");
            write_file(
                &stub_path,
                "class Service:\n    def fetch(self) -> str: ...",
            );

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            // Note: method rename at module level won't find "fetch" since it's
            // inside a class. A full method rename would need class context.
            // This test verifies the basic search doesn't find it at module level.
            let edits = updater
                .rename_edits(&source_path, "fetch", "retrieve")
                .expect("rename_edits should succeed");

            // At module level, "fetch" won't be found (it's a method)
            assert!(
                edits.is_none(),
                "Method rename at module level should not find method"
            );
        }

        #[test]
        fn test_stub_updater_rename_with_return_type() {
            // Test that return type annotations are updated
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("factory.py");
            let stub_path = temp_dir.path().join("factory.pyi");

            write_file(
                &source_path,
                "class Handler: pass\ndef create() -> Handler: pass",
            );
            write_file(
                &stub_path,
                "class Handler: ...\ndef create() -> Handler: ...",
            );

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits for class rename");
            let edits = edits.unwrap();
            assert!(!edits.edits.is_empty(), "Should have rename edits");
        }

        #[test]
        fn test_stub_updater_rename_with_param_type() {
            // Test that parameter type annotations are updated
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("processor.py");
            let stub_path = temp_dir.path().join("processor.pyi");

            write_file(
                &source_path,
                "class Config: pass\ndef process(cfg: Config): pass",
            );
            write_file(
                &stub_path,
                "class Config: ...\ndef process(cfg: Config) -> None: ...",
            );

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "Config", "Settings")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits for class rename");
        }

        #[test]
        fn test_stub_updater_rename_string_annotation() {
            // Test that string annotations are updated
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("lazy.py");
            let stub_path = temp_dir.path().join("lazy.pyi");

            write_file(&source_path, "class Handler: pass\nx: 'Handler'");
            write_file(&stub_path, "class Handler: ...\nx: \"Handler\"");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "Handler", "NewHandler")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits");
            let edits = edits.unwrap();

            // Should have edit for class name
            let has_class_edit = edits.edits.iter().any(
                |e| matches!(e, StubEdit::Rename { new_name, .. } if new_name == "NewHandler"),
            );
            assert!(has_class_edit, "Should have class rename edit");
        }

        #[test]
        fn test_stub_updater_no_stub_returns_none() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("nostub.py");

            // Create source file but no stub
            write_file(&source_path, "def process(): pass");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "process", "handle")
                .expect("rename_edits should succeed");

            assert!(edits.is_none(), "Should return None when no stub exists");
        }

        #[test]
        fn test_stub_updater_symbol_not_in_stub() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("partial.py");
            let stub_path = temp_dir.path().join("partial.pyi");

            // Source has function, but stub doesn't include it
            write_file(
                &source_path,
                "def private_func(): pass\ndef public_func(): pass",
            );
            write_file(&stub_path, "def public_func() -> None: ...");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "private_func", "new_name")
                .expect("rename_edits should succeed");

            // Should return None since the symbol isn't in the stub
            assert!(
                edits.is_none(),
                "Should return None when symbol not in stub"
            );
        }

        #[test]
        fn test_stub_updater_move_between_modules() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("utils.py");
            let source_stub = temp_dir.path().join("utils.pyi");
            let target_path = temp_dir.path().join("helpers.py");
            let target_stub = temp_dir.path().join("helpers.pyi");

            write_file(&source_path, "def helper(): pass");
            write_file(&source_stub, "def helper() -> None: ...");
            write_file(&target_path, "# target module");
            write_file(&target_stub, "# target stub");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let move_edits = updater
                .move_edits(&source_path, &target_path, "helper")
                .expect("move_edits should succeed");

            // Should have source edits (delete)
            assert!(
                move_edits.source_edits.is_some(),
                "Should have source edits"
            );
            let source_edits = move_edits.source_edits.unwrap();
            assert!(
                source_edits
                    .edits
                    .iter()
                    .any(|e| matches!(e, StubEdit::Delete { .. })),
                "Should have delete edit in source"
            );

            // Should have target edits (insert)
            assert!(
                move_edits.target_edits.is_some(),
                "Should have target edits"
            );
            let target_edits = move_edits.target_edits.unwrap();
            assert!(
                target_edits
                    .edits
                    .iter()
                    .any(|e| matches!(e, StubEdit::Insert { .. })),
                "Should have insert edit in target"
            );
        }

        #[test]
        fn test_stub_updater_move_no_source_stub() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("source_nostub.py");
            let target_path = temp_dir.path().join("target.py");
            let target_stub = temp_dir.path().join("target.pyi");

            // Source has no stub
            write_file(&source_path, "def helper(): pass");
            write_file(&target_path, "# target");
            write_file(&target_stub, "# target stub");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let move_edits = updater
                .move_edits(&source_path, &target_path, "helper")
                .expect("move_edits should succeed");

            // Should have no source edits (no stub to delete from)
            assert!(
                move_edits.source_edits.is_none(),
                "Should have no source edits when no source stub"
            );

            // Should also have no target edits (nothing to move)
            assert!(
                move_edits.target_edits.is_none(),
                "Should have no target edits when source has no stub"
            );
        }

        #[test]
        fn test_stub_updater_move_no_target_stub() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("source.py");
            let source_stub = temp_dir.path().join("source.pyi");
            let target_path = temp_dir.path().join("target_nostub.py");

            // Target has no stub
            write_file(&source_path, "def helper(): pass");
            write_file(&source_stub, "def helper() -> None: ...");
            write_file(&target_path, "# target");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let move_edits = updater
                .move_edits(&source_path, &target_path, "helper")
                .expect("move_edits should succeed");

            // Should have source edits (delete from source stub)
            assert!(
                move_edits.source_edits.is_some(),
                "Should have source edits"
            );

            // Should have no target edits (no stub to insert into)
            assert!(
                move_edits.target_edits.is_none(),
                "Should have no target edits when no target stub"
            );
        }

        #[test]
        fn test_stub_update_rename_full_workflow() {
            // Integration test: end-to-end rename with stub update
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("api.py");
            let stub_path = temp_dir.path().join("api.pyi");

            // Create a more complete stub file
            write_file(&source_path, "class Handler:\n    pass\n\ndef create_handler() -> Handler:\n    return Handler()");
            write_file(&stub_path, "class Handler:\n    def process(self) -> None: ...\n\ndef create_handler() -> Handler: ...");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            // Rename Handler -> RequestHandler
            let edits = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits");
            let edits = edits.unwrap();

            // Verify we got the class name edit
            let rename_edits: Vec<_> = edits
                .edits
                .iter()
                .filter(|e| matches!(e, StubEdit::Rename { .. }))
                .collect();

            assert!(!rename_edits.is_empty(), "Should have rename edits");

            // Verify the edit targets the correct span
            if let Some(StubEdit::Rename { span, new_name }) = rename_edits.first() {
                assert_eq!(new_name, "RequestHandler");
                assert!(span.start < span.end, "Span should be valid");
            }
        }

        // ========================================================================
        // Tests for annotation span tracking (Step 0.3.6.6.5)
        // ========================================================================

        #[test]
        fn test_stub_updater_renames_return_type() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("api.py");
            let stub_path = temp_dir.path().join("api.pyi");

            write_file(&source_path, "def create() -> Handler: pass");
            write_file(&stub_path, "def create() -> Handler: ...");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits for return type");
            let edits = edits.unwrap();

            // Should have an edit for the return type annotation
            assert!(!edits.edits.is_empty(), "Should have edits");
            let edit = &edits.edits[0];
            if let StubEdit::Rename { new_name, .. } = edit {
                assert!(
                    new_name.contains("RequestHandler"),
                    "Should rename to RequestHandler"
                );
            } else {
                panic!("Expected a Rename edit");
            }
        }

        #[test]
        fn test_stub_updater_renames_param_type() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("api.py");
            let stub_path = temp_dir.path().join("api.pyi");

            write_file(&source_path, "def process(h: Handler) -> None: pass");
            write_file(&stub_path, "def process(h: Handler) -> None: ...");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits for param type");
            let edits = edits.unwrap();

            // Should have an edit for the parameter type annotation
            assert!(!edits.edits.is_empty(), "Should have edits");
            let edit = &edits.edits[0];
            if let StubEdit::Rename { new_name, .. } = edit {
                assert!(
                    new_name.contains("RequestHandler"),
                    "Should rename to RequestHandler"
                );
            } else {
                panic!("Expected a Rename edit");
            }
        }

        #[test]
        fn test_stub_updater_renames_multiple_function_annotations() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("api.py");
            let stub_path = temp_dir.path().join("api.pyi");

            write_file(&source_path, "def process(h: Handler) -> Handler: pass");
            write_file(&stub_path, "def process(h: Handler) -> Handler: ...");

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .expect("rename_edits should succeed");

            assert!(edits.is_some(), "Should return edits");
            let edits = edits.unwrap();

            // Should have 2 edits: one for param, one for return type
            assert_eq!(
                edits.edits.len(),
                2,
                "Should have 2 edits (param and return type)"
            );

            for edit in &edits.edits {
                if let StubEdit::Rename { new_name, .. } = edit {
                    assert!(
                        new_name.contains("RequestHandler"),
                        "All edits should rename to RequestHandler"
                    );
                }
            }
        }

        #[test]
        fn test_stub_updater_renames_method_annotations() {
            let temp_dir = create_temp_project();
            let source_path = temp_dir.path().join("api.py");
            let stub_path = temp_dir.path().join("api.pyi");

            write_file(
                &source_path,
                "class Service:\n    def process(self, h: Handler) -> Handler: pass",
            );
            write_file(
                &stub_path,
                "class Service:\n    def process(self, h: Handler) -> Handler: ...",
            );

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let edits = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .expect("rename_edits should succeed");

            assert!(
                edits.is_some(),
                "Should return edits for method annotations"
            );
            let edits = edits.unwrap();

            // Should have 2 edits for the method: one for param, one for return type
            assert_eq!(
                edits.edits.len(),
                2,
                "Should have 2 edits for method annotations"
            );

            for edit in &edits.edits {
                if let StubEdit::Rename { new_name, .. } = edit {
                    assert!(
                        new_name.contains("RequestHandler"),
                        "All edits should rename to RequestHandler"
                    );
                }
            }
        }

        // ========================================================================
        // Regression tests for CST-based exact name matching (Step 0.3.6.6.6)
        // These tests verify that renaming uses exact matching, not substring matching
        // ========================================================================

        /// Renaming `Handler` should NOT affect `MyHandler`
        #[test]
        fn test_rename_does_not_match_substring() {
            let temp_dir = TempDir::new().unwrap();

            // Create source file
            let source_path = temp_dir.path().join("src/service.py");
            std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
            std::fs::write(&source_path, "class Service: pass").unwrap();

            // Create stub with MyHandler (not Handler)
            let stub_path = temp_dir.path().join("src/service.pyi");
            let stub_content = r#"class Service:
    def process(self, h: MyHandler) -> MyHandler: ...
"#;
            std::fs::write(&stub_path, stub_content).unwrap();

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            // Rename "Handler" to "RequestHandler" - should find nothing
            let result = updater.rename_edits(&source_path, "Handler", "RequestHandler");
            assert!(result.is_ok());

            // Should be None because "Handler" doesn't appear as an exact type name
            assert!(
                result.unwrap().is_none(),
                "Renaming 'Handler' should NOT match 'MyHandler'"
            );
        }

        /// Renaming `Handler` in `List[Handler]` should produce edit for inner `Handler` only
        #[test]
        fn test_rename_in_generic() {
            let temp_dir = TempDir::new().unwrap();

            let source_path = temp_dir.path().join("src/service.py");
            std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
            std::fs::write(&source_path, "class Handler: pass").unwrap();

            let stub_path = temp_dir.path().join("src/service.pyi");
            let stub_content = "def process() -> List[Handler]: ...\n";
            std::fs::write(&stub_path, stub_content).unwrap();

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let result = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .unwrap()
                .unwrap();

            // Should have exactly 1 edit (for the inner Handler, not List)
            let rename_edits: Vec<_> = result
                .edits
                .iter()
                .filter(|e| matches!(e, StubEdit::Rename { .. }))
                .collect();

            assert_eq!(rename_edits.len(), 1, "Should have exactly 1 rename edit");

            if let StubEdit::Rename { span, new_name } = &rename_edits[0] {
                assert_eq!(new_name, "RequestHandler");
                // Verify the span points to "Handler" not "List"
                assert_eq!(&stub_content[span.start..span.end], "Handler");
            } else {
                panic!("Expected Rename edit");
            }
        }

        /// Renaming `Handler` in `Dict[str, Handler]` only renames `Handler`
        #[test]
        fn test_rename_in_nested_generic() {
            let temp_dir = TempDir::new().unwrap();

            let source_path = temp_dir.path().join("src/service.py");
            std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
            std::fs::write(&source_path, "class Handler: pass").unwrap();

            let stub_path = temp_dir.path().join("src/service.pyi");
            let stub_content = "def get() -> Dict[str, Handler]: ...\n";
            std::fs::write(&stub_path, stub_content).unwrap();

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let result = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .unwrap()
                .unwrap();

            let rename_edits: Vec<_> = result
                .edits
                .iter()
                .filter(|e| matches!(e, StubEdit::Rename { .. }))
                .collect();

            assert_eq!(rename_edits.len(), 1, "Should have exactly 1 rename edit");

            if let StubEdit::Rename { span, new_name } = &rename_edits[0] {
                assert_eq!(new_name, "RequestHandler");
                assert_eq!(&stub_content[span.start..span.end], "Handler");
            }
        }

        /// Renaming `Handler` in `Handler | None` only renames `Handler`
        #[test]
        fn test_rename_in_union() {
            let temp_dir = TempDir::new().unwrap();

            let source_path = temp_dir.path().join("src/service.py");
            std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
            std::fs::write(&source_path, "class Handler: pass").unwrap();

            let stub_path = temp_dir.path().join("src/service.pyi");
            let stub_content = "def get() -> Handler | None: ...\n";
            std::fs::write(&stub_path, stub_content).unwrap();

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let result = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .unwrap()
                .unwrap();

            let rename_edits: Vec<_> = result
                .edits
                .iter()
                .filter(|e| matches!(e, StubEdit::Rename { .. }))
                .collect();

            assert_eq!(rename_edits.len(), 1, "Should have exactly 1 rename edit");

            if let StubEdit::Rename { span, new_name } = &rename_edits[0] {
                assert_eq!(new_name, "RequestHandler");
                assert_eq!(&stub_content[span.start..span.end], "Handler");
            }
        }

        /// `def f(a: Handler, b: Handler) -> Handler` produces 3 edits
        #[test]
        fn test_rename_multiple_occurrences() {
            let temp_dir = TempDir::new().unwrap();

            let source_path = temp_dir.path().join("src/service.py");
            std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
            std::fs::write(&source_path, "class Handler: pass").unwrap();

            let stub_path = temp_dir.path().join("src/service.pyi");
            let stub_content = "def process(a: Handler, b: Handler) -> Handler: ...\n";
            std::fs::write(&stub_path, stub_content).unwrap();

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let result = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .unwrap()
                .unwrap();

            let rename_edits: Vec<_> = result
                .edits
                .iter()
                .filter(|e| matches!(e, StubEdit::Rename { .. }))
                .collect();

            assert_eq!(
                rename_edits.len(),
                3,
                "Should have 3 rename edits (2 params + 1 return)"
            );

            for edit in &rename_edits {
                if let StubEdit::Rename { span, new_name } = edit {
                    assert_eq!(new_name, "RequestHandler");
                    assert_eq!(&stub_content[span.start..span.end], "Handler");
                }
            }
        }

        /// Renaming in Callable[[Handler], Response] works correctly
        #[test]
        fn test_rename_in_callable() {
            let temp_dir = TempDir::new().unwrap();

            let source_path = temp_dir.path().join("src/service.py");
            std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
            std::fs::write(&source_path, "class Handler: pass").unwrap();

            let stub_path = temp_dir.path().join("src/service.pyi");
            let stub_content = "def get_callback() -> Callable[[Handler], Response]: ...\n";
            std::fs::write(&stub_path, stub_content).unwrap();

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            let result = updater
                .rename_edits(&source_path, "Handler", "RequestHandler")
                .unwrap()
                .unwrap();

            let rename_edits: Vec<_> = result
                .edits
                .iter()
                .filter(|e| matches!(e, StubEdit::Rename { .. }))
                .collect();

            assert_eq!(
                rename_edits.len(),
                1,
                "Should have 1 rename edit for Handler in Callable"
            );

            if let StubEdit::Rename { span, new_name } = &rename_edits[0] {
                assert_eq!(new_name, "RequestHandler");
                assert_eq!(&stub_content[span.start..span.end], "Handler");
            }
        }

        /// `def f(x: MyHandler) -> None` does NOT rename when renaming `Handler`
        #[test]
        fn test_no_false_positive_rename() {
            let temp_dir = TempDir::new().unwrap();

            let source_path = temp_dir.path().join("src/service.py");
            std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
            std::fs::write(&source_path, "class Service: pass").unwrap();

            let stub_path = temp_dir.path().join("src/service.pyi");
            // Only MyHandler, HandlerFactory, BaseHandler - no exact "Handler"
            let stub_content = r#"def process(x: MyHandler) -> HandlerFactory:
    ...
class Service:
    handler: BaseHandler
"#;
            std::fs::write(&stub_path, stub_content).unwrap();

            let discovery = StubDiscovery::for_workspace(temp_dir.path());
            let updater = StubUpdater::new(discovery);

            // Rename "Handler" to "RequestHandler" - should find nothing
            let result = updater.rename_edits(&source_path, "Handler", "RequestHandler");
            assert!(result.is_ok());

            // Should be None because "Handler" doesn't appear as an exact type name
            // (MyHandler, HandlerFactory, BaseHandler are different names)
            assert!(
                result.unwrap().is_none(),
                "Renaming 'Handler' should NOT match 'MyHandler', 'HandlerFactory', or 'BaseHandler'"
            );
        }
    }
}
