//! Python language support for tugtool.
//!
//! This crate provides Python-specific refactoring operations using LibCST.
//! It includes:
//! - Python environment resolution
//! - LibCST worker process management
//! - Semantic analysis for Python code
//! - Refactoring operations (rename, etc.)

pub mod analyzer;
pub mod bootstrap;
pub mod dynamic;
pub mod env;
pub mod files;
pub mod lookup;
pub mod ops;
pub mod test_helpers;
pub mod type_tracker;
pub mod validation;
pub mod verification;
pub mod worker;

// Legacy re-export for backward compatibility during migration
// Note: This will be populated when actual code is moved in Step 3.2
pub mod rename {
    // Re-exports will be added when ops/rename.rs has content
}
