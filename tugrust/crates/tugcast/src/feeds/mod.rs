//! Feed registry and orchestration for tugcast
//!
//! This module contains the implementations of different feed types
//! (terminal, filesystem, git, etc.) and manages their lifecycle.

pub mod activity;
pub mod agent_bridge;
pub mod agent_supervisor;
pub mod claude_auth;
pub mod code;
pub mod defaults;
pub mod file_watcher;
pub mod filesystem;
pub mod filetree;
pub mod fuzzy_scorer;
pub mod git;
pub mod payload_inspector;
pub mod pulse;
pub mod secret_filter;
pub mod session_metadata;
pub mod session_scoped;
pub mod shell;
pub mod stats;
pub mod terminal;
pub mod workspace_registry;
