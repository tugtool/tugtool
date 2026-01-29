//! File filter specification for restricting operation scope.
//!
//! This module implements file filtering for refactoring operations. It supports:
//! - Glob-based patterns with gitignore-style syntax
//! - Inclusion and exclusion patterns
//! - Default exclusions for common directories
//! - Predicate-based filtering (path, extension, size, git state, content)
//! - Expression-based filtering with boolean operators
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

mod expr;
mod glob;
mod predicate;

// Re-export public API from glob module
pub use glob::{FileFilterSpec, FilterError, DEFAULT_EXCLUSIONS};

// Re-export public API from predicate module
pub use predicate::{
    parse_size, FilterPredicate, GitFileStatus, GitState, PredicateError, PredicateKey,
    PredicateOp,
};

// Re-export public API from expression module
pub use expr::{parse_filter_expr, ExprError, FilterExpr};
