//! `tugdash-core` — the dash engine, extracted from the `tugutil` grab bag.
//!
//! A dash *is* a git branch (`tugdash/<name>`) plus a worktree; its lifecycle
//! and status derive from git, not a database. This crate holds the shared
//! helpers ([`dash`]) and the verb orchestration ([`ops`]) — a typed library
//! API that never prints. The `tugdash` CLI and the Changeset card (via
//! tugcast) are its two front ends.

/// Dash helpers — name validation, default-branch detection, the append-only
/// visibility log, and the stdin round-metadata shape.
pub mod dash;

/// Dash verb orchestration — `create` / `commit` / `join` / `release` /
/// `list` / `show`, each returning a typed outcome.
pub mod ops;

/// The join conflict resolution ladder ([P31]): replay probe, rerere, per-file
/// re-merge / structured-merge driver / AI seam, and the candidate builder.
pub mod resolve;

pub use dash::{DashRoundMeta, append_dash_log, detect_default_branch, validate_dash_name};
pub use ops::{
    CommitOutcome, CreateOutcome, DashListItem, JoinOptions, JoinOutcome, JoinStrategy,
    ReleaseOutcome, RoundItem, ShowOutcome, commit, create, join, join_in, list, release,
    release_in, show,
};
pub use resolve::{
    FileMergeRequest, FileMerger, FileResolution, JoinShape, ResolveOutcome, ResolvedBy,
    resolve_conflicts, resolve_conflicts_cwd,
};
