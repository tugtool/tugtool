//! Python adapter: LibCST-based analyzer and rewriter.
//!
//! This module provides Python language support for tug:
//!
//! - `analyzer`: Python symbol/reference analysis with scope chain resolution
//! - `type_tracker`: Level 1-2 type inference from assignments and annotations
//! - `dynamic`: Dynamic pattern detection (getattr, eval, etc.) with warnings
//! - `files`: Python file collection utilities
//! - `lookup`: Symbol lookup utilities for finding symbols at locations
//! - `validation`: Python identifier validation
//! - `verification`: Python verification pipeline (compileall, pytest, mypy)
//! - `ops`: Python refactoring operations (rename, etc.)
//! - `cst_bridge`: Native Rust CST analysis
//! - `types`: Shared data types for Python analysis

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
