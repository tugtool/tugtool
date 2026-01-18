//! Rust language support for tugtool.
//!
//! This crate provides Rust-specific refactoring operations using rust-analyzer.
//!
//! **Status:** Placeholder - implementation planned for future phases.

#[allow(unused_imports)]
use tugtool_core as _core;

/// Placeholder for Rust analyzer adapter.
pub struct RustAdapter;

impl RustAdapter {
    /// Create a new Rust adapter (placeholder).
    pub fn new() -> Self {
        RustAdapter
    }
}

impl Default for RustAdapter {
    fn default() -> Self {
        Self::new()
    }
}
