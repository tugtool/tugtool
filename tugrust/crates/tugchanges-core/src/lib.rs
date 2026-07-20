//! `tugchanges-core` — the print-free library that owns "git changes & commits".
//!
//! A synchronous library over `std::process::Command` git, mirroring
//! `tugdash-core`'s shape: the `tugutil` CLI is a thin `--json` shell over it,
//! and tugcast links it directly in-process (via `spawn_blocking`) to retire
//! its duplicate commit/parse code. All real logic lives here; the binary only
//! parses args, calls the library, and formats output.

pub mod changes;
pub mod commit;
pub mod git;
mod ledger;
pub mod preflight;
pub mod trailer;

pub use changes::{Change, ChangesError, ChangesOptions, ChangesReport, ForeignChange, changes};
pub use commit::{Aggregate, CommitError, CommitOptions, CommitReceipt, LeftBehind, commit};
pub use preflight::{
    DiffOptions, DiffReport, LogEntry, LogOptions, LogReport, PreflightOptions, PreflightReport,
    diff, log, preflight,
};
pub use git::{
    DiffFile, DiffFileStatus, FileStat, NumstatEntry, StatusEntry, StatusReport, file_stats,
    git_output, git_stdout, normalize_xy, parse_name_status, parse_numstat,
    parse_status_porcelain_v2, parse_unified_diff, repo_root_for,
};
pub use trailer::append_trailers;
