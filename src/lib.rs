//! Tug: AI-native code transformation engine
//!
//! A refactoring kernel for LLM coding agents that provides verified,
//! deterministic, minimal-diff refactors across Python and Rust codebases.

// Core infrastructure - re-exported from tugtool-core
pub use tugtool_core::diff;
pub use tugtool_core::facts;
pub use tugtool_core::patch;
pub use tugtool_core::text;
pub use tugtool_core::util;

// Core infrastructure - still in root (will migrate in future steps)
pub mod error;
pub mod output;
pub mod sandbox;
pub mod session;
pub mod testcmd;
pub mod workspace;

// Front doors for agents
pub mod cli;
#[cfg(feature = "mcp")]
pub mod mcp;

// Language adapters
pub mod python;
pub mod rust;
