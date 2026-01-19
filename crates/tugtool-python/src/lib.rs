//! Python adapter: LibCST-based analyzer and rewriter.
//!
//! This module provides Python language support for tug:
//!
//! - `bootstrap`: Managed venv creation and libcst installation
//! - `env`: Python environment resolution and validation
//! - `test_helpers`: Helpers for tests that require Python with libcst
//! - `worker`: LibCST worker subprocess management
//! - `analyzer`: Python symbol/reference analysis with scope chain resolution
//! - `type_tracker`: Level 1-2 type inference from assignments and annotations
//! - `dynamic`: Dynamic pattern detection (getattr, eval, etc.) with warnings
//! - `files`: Python file collection utilities
//! - `lookup`: Symbol lookup utilities for finding symbols at locations
//! - `validation`: Python identifier validation
//! - `verification`: Python verification pipeline (compileall, pytest, mypy)
//! - `ops`: Python refactoring operations (rename, etc.)
//! - `cst_bridge`: Native Rust CST analysis (when `native-cst` feature enabled)

pub mod analyzer;
pub mod bootstrap;
#[cfg(feature = "native-cst")]
pub mod cst_bridge;
pub mod dynamic;
pub mod env;
mod error_bridges;
pub mod files;
pub mod lookup;
pub mod ops;
pub mod test_helpers;
pub mod type_tracker;
pub mod validation;
pub mod verification;
pub mod worker;

// Legacy re-export for backward compatibility during migration
// TODO: Remove this after updating all callers
pub mod rename {
    pub use super::ops::rename::*;
}

pub use bootstrap::{ensure_managed_venv, BootstrapError, BootstrapResult, VenvLocation};
pub use test_helpers::require_python_with_libcst;
