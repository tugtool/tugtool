//! Python language support for tugtool using native Rust CST analysis.
//!
//! This crate provides Python semantic analysis and refactoring operations
//! using a pure Rust parser adapted from LibCST. No Python installation is required.
//!
//! # Architecture
//!
//! The crate uses [`tugtool_python_cst`] for parsing Python source code into a Concrete
//! Syntax Tree (CST). Analysis is performed via visitor collectors that extract
//! semantic information (scopes, bindings, references, etc.).
//!
//! # Modules
//!
//! - [`analyzer`]: Multi-file semantic analysis with scope chain resolution
//! - [`cst_bridge`]: Bridge layer between native CST and tugtool types
//! - [`type_tracker`]: Level 1-2 type inference from assignments and annotations
//! - [`dynamic`]: Dynamic pattern detection (getattr, eval, etc.) with warnings
//! - [`files`]: Python file collection utilities
//! - [`lookup`]: Symbol lookup utilities for finding symbols at locations
//! - [`validation`]: Python identifier validation
//! - [`verification`]: Python verification pipeline (compileall, pytest, mypy)
//! - [`ops`]: Python refactoring operations (rename, etc.)
//! - [`types`]: Shared data types for Python analysis
//!
//! # Example
//!
//! ```ignore
//! use tugtool_python::analyzer::analyze_files;
//! use tugtool_core::facts::FactsStore;
//!
//! let files = vec![
//!     ("main.py".to_string(), "def hello(): pass".to_string()),
//! ];
//! let mut store = FactsStore::new();
//! let bundle = analyze_files(&files, &mut store).expect("analysis failed");
//! ```

pub mod analyzer;
pub mod cst_bridge;
pub mod dynamic;
mod error_bridges;
pub mod files;
pub mod lookup;
pub mod ops;
pub mod type_tracker;
pub mod types;
pub mod validation;
pub mod verification;

// Legacy re-export for backward compatibility during migration
// TODO: Remove this after updating all callers
pub mod rename {
    pub use super::ops::rename::*;
}
