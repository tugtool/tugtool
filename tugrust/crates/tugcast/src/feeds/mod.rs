//! Feed registry and orchestration for tugcast
//!
//! This module contains the implementations of different feed types
//! (terminal, filesystem, git, etc.) and manages their lifecycle.

pub mod activity;
pub mod agent_bridge;
pub mod agent_supervisor;
pub mod attribution;
pub mod changeset;
pub mod changeset_all;
pub mod claude_auth;
pub mod claude_usage;
pub mod code;
pub mod defaults;
pub mod draft_engine;
pub mod facts_library;
pub mod file_watcher;
pub mod filesystem;
pub mod filetree;
pub mod fuzzy_scorer;
pub mod gazette_agent;
pub mod gazette_replay;
pub mod git;
pub mod git_watch;
pub mod join_resolve;
pub mod jots;
pub mod operator;
pub mod operator_ask;
pub mod payload_inspector;
pub mod pulse;
pub mod reporter;
pub mod reporter_wake;
pub mod secret_filter;
pub mod session_metadata;
pub mod session_overview;
pub mod session_scoped;
pub mod shell;
pub mod shell_words;
pub mod stats;
pub mod terminal;
pub mod workspace_registry;
