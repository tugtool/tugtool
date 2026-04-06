//! Feed registry and orchestration for tugcast
//!
//! This module contains the implementations of different feed types
//! (terminal, filesystem, git, etc.) and manages their lifecycle.

pub mod agent_bridge;
pub mod code;
pub mod defaults;
pub mod file_watcher;
pub mod filesystem;
pub mod fuzzy_scorer;
pub mod git;
pub mod stats;
pub mod terminal;
