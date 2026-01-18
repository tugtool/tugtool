//! Core infrastructure for tugtool.
//!
//! This crate provides language-agnostic infrastructure:
//! - Patch IR for representing code transformations
//! - Facts store for symbol and reference tracking
//! - Session management
//! - Workspace snapshots
//! - Sandboxed file operations
//! - Text utilities and diff generation

pub mod diff;
pub mod facts;
pub mod patch;
pub mod text;
pub mod util;
