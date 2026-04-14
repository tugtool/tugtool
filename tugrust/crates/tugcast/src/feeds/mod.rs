//! Feed registry and orchestration for tugcast
//!
//! This module contains the implementations of different feed types
//! (terminal, filesystem, git, etc.) and manages their lifecycle.

pub mod agent_bridge;
pub mod agent_supervisor;
pub mod code;
pub mod defaults;
pub mod file_watcher;
pub mod filesystem;
pub mod filetree;
pub mod fuzzy_scorer;
pub mod git;
pub mod path_resolver;
pub mod session_metadata;
pub mod stats;
pub mod terminal;
pub mod workspace_registry;
