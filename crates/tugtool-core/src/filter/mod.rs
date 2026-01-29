//! File filter specification for restricting operation scope.
//!
//! This module implements file filtering for refactoring operations. It supports:
//! - Glob-based patterns with gitignore-style syntax
//! - Inclusion and exclusion patterns
//! - Default exclusions for common directories
//!
//! ## Usage
//!
//! ```
//! use tugtool_core::filter::FileFilterSpec;
//! use std::path::Path;
//!
//! // Parse CLI patterns
//! let spec = FileFilterSpec::parse(&["src/**/*.py".to_string()]).unwrap().unwrap();
//!
//! // Test if a path matches
//! assert!(spec.matches(Path::new("src/main.py")));
//! assert!(!spec.matches(Path::new("tests/test_main.py")));
//! ```

mod glob;

// Re-export public API from glob module
pub use glob::{FileFilterSpec, FilterError, DEFAULT_EXCLUSIONS};
