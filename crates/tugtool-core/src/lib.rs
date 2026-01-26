//! Core infrastructure for tugtool.
//!
//! This crate provides language-agnostic infrastructure:
//! - Patch IR for representing code transformations
//! - Facts store for symbol and reference tracking
//! - Error types and error codes
//! - JSON output types for CLI responses
//! - Session management
//! - Workspace snapshots
//! - Sandboxed file operations
//! - Text utilities and diff generation
//! - Language adapter trait for pluggable language support

pub mod adapter;
pub mod diff;
pub mod error;
pub mod facts;
pub mod output;
pub mod patch;
pub mod sandbox;
pub mod session;
pub mod text;
pub mod types;
pub mod util;
pub mod workspace;
