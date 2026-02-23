//! tug-core: Core library for parsing, validation, and types
//!
//! This crate provides the foundational types and logic for the tug system.

/// Core error types for tug operations
pub mod error;

/// Configuration handling
pub mod config;

/// Core data types (Plan, Step, Checkpoint, etc.)
pub mod types;

/// Plan file parsing
pub mod parser;

/// Validation logic and rules
pub mod validator;

/// Beads integration utilities
pub mod beads;

/// Interaction adapter for mode-agnostic user interaction
pub mod interaction;

/// Timestamp utilities
pub mod session;

/// Worktree management for plan implementations
pub mod worktree;

/// Plan resolution logic
pub mod resolve;

/// Embedded SQLite state management
pub mod state;

// Re-exports for convenience
pub use beads::{
    BeadStatus, BeadsCli, CloseReasonParsed, Issue, IssueDetails, is_valid_bead_id,
    parse_close_reason,
};
pub use config::{
    BeadsConfig, Config, NamingConfig, RESERVED_FILES, TugConfig, find_project_root,
    find_project_root_from, find_tugplans, is_reserved_file, tugplan_name_from_path,
};
pub use error::TugError;
pub use interaction::{InteractionAdapter, InteractionError, InteractionResult, ProgressHandle};
pub use parser::parse_tugplan;
pub use resolve::{ResolveResult, ResolveStage, resolve_plan};
pub use session::now_iso8601;
pub use state::{ClaimResult, InitResult, StateDb, compute_plan_hash};
pub use types::{
    Anchor, BeadsHints, Checkpoint, CheckpointKind, Decision, ParseDiagnostic, Question, Step,
    Substep, TugPlan, TugPlanMetadata, TugPlanStatus,
};
pub use validator::{
    Severity, ValidationConfig, ValidationIssue, ValidationLevel, ValidationResult,
    validate_tugplan, validate_tugplan_with_config,
};
pub use worktree::{
    CleanupMode, CleanupResult, DiscoveredWorktree, WorktreeConfig, WorktreeDiscovery,
    cleanup_stale_branches, cleanup_worktrees, create_worktree, derive_tugplan_slug,
    find_repo_root, find_repo_root_from, find_worktree_by_tugplan, generate_branch_name,
    is_valid_worktree_path, list_tugtool_branches, list_worktrees, remove_worktree,
    resolve_worktree, sanitize_branch_name,
};

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
