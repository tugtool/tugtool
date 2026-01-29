//! Tug: AI-native code transformation engine
//!
//! A refactoring kernel for LLM coding agents that provides verified,
//! deterministic, minimal-diff refactors across Python and Rust codebases.
//!
//! ## Crate Structure
//!
//! This is the main tugtool crate that composes:
//! - `tugtool-core` - Shared infrastructure (patch IR, facts, error types, etc.)
//! - `tugtool-python` - Python language support (optional, feature-gated)
//! - `tugtool-rust` - Rust language support (optional, feature-gated, placeholder)
//!
//! ## Modules
//!
//! - `cli` - CLI command implementations
//! - `testcmd` - Test command resolution
//!
//! ## Feature Flags
//!
//! - `python` - Enable Python language support (default)
//! - `rust` - Enable Rust language support (placeholder)
//! - `full` - Enable all features

// ============================================================================
// Core Infrastructure - Re-exported from tugtool-core
// ============================================================================

pub use tugtool_core::diff;
pub use tugtool_core::error;
pub use tugtool_core::facts;
pub use tugtool_core::output;
pub use tugtool_core::patch;
pub use tugtool_core::sandbox;
pub use tugtool_core::session;
pub use tugtool_core::text;
pub use tugtool_core::types;
pub use tugtool_core::util;
pub use tugtool_core::workspace;

// ============================================================================
// CLI and Server Modules
// ============================================================================

pub mod cli;
pub mod filter;
pub mod fixture;
pub mod testcmd;

// ============================================================================
// Language Adapters (Feature-Gated)
// ============================================================================

#[cfg(feature = "python")]
pub use tugtool_python as python;

#[cfg(feature = "rust")]
pub use tugtool_rust as rust;
