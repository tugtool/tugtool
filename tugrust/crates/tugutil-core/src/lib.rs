//! `tugutil-core` — core library for tugutil.
//!
//! Provides the foundational logic the `tugutil` binary builds on: config,
//! plan resolution, git/worktree helpers, the dash flow, and per-project
//! runtime-state paths.

/// Core error types for tug operations
pub mod error;

/// Configuration handling
pub mod config;

/// Timestamp utilities
pub mod session;

/// Worktree management for plan implementations
pub mod worktree;

/// Plan resolution logic
pub mod resolve;

/// Per-project runtime-state directory resolution
pub mod paths;

/// Dash helpers (git-derived)
pub mod dash;

// Re-exports — exactly the surface consumed by the `tugutil` binary.
pub use config::{Config, find_project_root, find_tugplans, tugplan_name_from_path};
pub use dash::{DashRoundMeta, append_dash_log, detect_default_branch, validate_dash_name};
pub use error::TugError;
pub use paths::project_state_dir;
pub use resolve::{ResolveResult, ResolveStage, resolve_plan};
pub use worktree::{find_repo_root, sanitize_branch_name};
