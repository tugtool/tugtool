//! `tugutil-core` — core library for tugutil: parsing, validation, and types
//!
//! This crate provides the foundational types and logic for tugplan management,
//! worktree operations, and plan validation.

/// Core error types for tug operations
pub mod error;

/// Configuration handling
pub mod config;

/// Core data types (Plan, Step, Checkpoint, etc.)
pub mod types;

/// Plan file parsing
pub mod parser;

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
pub use parser::parse_tugplan;
pub use paths::project_state_dir;
pub use resolve::{ResolveResult, ResolveStage, resolve_plan};
pub use types::{ParseDiagnostic, TugPlan};
pub use worktree::{find_repo_root, sanitize_branch_name};

#[cfg(test)]
mod dependency_smoke_tests {
    #[test]
    fn rusqlite_smoke_test() {
        // Verify rusqlite dependency is wired by opening an in-memory DB
        let conn = rusqlite::Connection::open_in_memory()
            .expect("rusqlite should open in-memory connection");
        conn.execute_batch("SELECT 1")
            .expect("rusqlite should execute basic query");
    }

    #[test]
    fn sha2_smoke_test() {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(b"hello world");
        let result = hasher.finalize();
        let hex = format!("{:x}", result);
        // Known SHA-256 of "hello world"
        assert_eq!(
            hex,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }
}
