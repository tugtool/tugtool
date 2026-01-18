//! Tug: AI-native code transformation engine
//!
//! A refactoring kernel for LLM coding agents that provides verified,
//! deterministic, minimal-diff refactors across Python and Rust codebases.

// Core infrastructure - re-exported from tugtool-core
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

// Core infrastructure - still in root (will migrate in future steps)
pub mod testcmd;

// Front doors for agents
pub mod cli;
#[cfg(feature = "mcp")]
pub mod mcp;

// Language adapters
pub use tugtool_python as python;
pub mod rust;

// Note: Error bridges (From<RenameError> for TugError, etc.) are now
// in tugtool-python to satisfy Rust's orphan rules.
