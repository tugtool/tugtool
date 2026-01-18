//! Tugtool - AI-native code transformation engine.
//!
//! This crate provides the CLI binary and MCP server for tugtool.
//!
//! ## Modules
//!
//! - `cli` - CLI command implementations
//! - `mcp` - Model Context Protocol server (feature-gated)
//! - `testcmd` - Test command resolution

pub mod cli;
pub mod testcmd;

#[cfg(feature = "mcp")]
pub mod mcp;

// Re-export core types for convenience
pub use tugtool_core::error::{OutputErrorCode, TugError};
pub use tugtool_core::output::{ErrorInfo, ErrorResponse, Location, SnapshotResponse, VerifyResponse, SCHEMA_VERSION};
pub use tugtool_core::session::{Session, SessionOptions};
pub use tugtool_core::workspace::{Language, SnapshotConfig, WorkspaceSnapshot};

// Re-export Python types when feature is enabled
#[cfg(feature = "python")]
pub use tugtool_python;
