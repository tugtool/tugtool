//! Beads integration commands
//!
//! Provides subcommands for syncing plans to beads, linking steps to beads,
//! showing beads execution status, pulling bead completion back to checkboxes,
//! and closing beads to mark work complete.
//!
//! Requires: beads CLI (`bd`) installed, worktree context (`.beads/` initialized via `tugcode worktree create`).

pub mod close;
pub mod inspect;
pub mod link;
pub mod pull;
pub mod status;
pub mod sync;
pub mod update;

use clap::Subcommand;

pub use close::run_close;
pub use inspect::run_inspect;
pub use link::run_link;
pub use pull::run_pull;
pub use status::run_beads_status;
pub use sync::run_sync;
pub use update::{run_append_design, run_append_notes, run_update_notes};

/// Beads subcommands
#[derive(Subcommand, Debug)]
pub enum BeadsCommands {
    /// Sync plan steps to beads (creates/updates beads)
    ///
    /// Creates a root bead for the plan and child beads for each step.
    #[command(
        long_about = "Sync plan steps to beads.\n\nCreates:\n  - Root bead (epic) for the plan\n  - Child beads for each execution step\n  - Dependency edges matching **Depends on:** lines\n\nUses title-based matching for idempotent resolution.\nBead IDs are returned in JSON output, not written to plan files.\n\nRe-running sync is idempotent—existing beads are reused."
    )]
    Sync {
        /// Plan file to sync
        file: String,

        /// Show what would be created/updated without making changes
        #[arg(long)]
        dry_run: bool,

        /// Enrich all beads with rich content fields (description, design, acceptance_criteria)
        #[arg(long)]
        enrich: bool,

        /// Remove beads deps not present in the plan
        #[arg(long)]
        prune_deps: bool,

        /// Substep handling mode: none (default) or children
        #[arg(long, default_value = "none")]
        substeps: String,
    },

    /// Link an existing bead to a step
    ///
    /// Manually links a pre-existing bead to a step in the plan.
    #[command(
        long_about = "Link an existing bead to a step.\n\nValidates that both the step anchor exists in the plan\nand the bead ID exists in beads, then associates them.\n\nNote: With title-based matching (introduced in beads improvements),\nthis command is primarily for validation and backward compatibility.\nMost users should use `tugcode beads sync` instead."
    )]
    Link {
        /// Plan file to modify
        file: String,

        /// Step anchor to link (e.g., step-0, step-2-1)
        step_anchor: String,

        /// Bead ID to link
        bead_id: String,
    },

    /// Show beads execution status aligned with plan steps
    ///
    /// Displays completion status for each step based on linked beads.
    #[command(
        long_about = "Show execution status for each step based on linked beads.\n\nStatus values:\n  - complete: bead is closed (work done)\n  - ready: bead is open, all dependencies complete\n  - blocked: waiting on dependencies to complete\n  - pending: no matching bead found\n\nUse with --pull to also update plan checkboxes."
    )]
    Status {
        /// Plan file (shows all plans if not specified)
        file: Option<String>,

        /// Also update checkboxes from bead completion (same as pull)
        #[arg(long)]
        pull: bool,
    },

    /// Update plan checkboxes from bead completion status
    ///
    /// Marks checkboxes as complete when their associated bead is closed.
    #[command(
        long_about = "Pull bead completion status to plan checkboxes.\n\nFor each step with a matching bead:\n  - If bead is closed, marks checkpoint items as complete\n  - By default only updates **Checkpoint:** items\n  - Configure pull_checkbox_mode in config.toml for all items\n\nUse --no-overwrite to preserve manually checked items."
    )]
    Pull {
        /// Plan file (pulls all plans if not specified)
        file: Option<String>,

        /// Don't overwrite manually checked items
        #[arg(long)]
        no_overwrite: bool,
    },

    /// Close a bead to mark work complete
    ///
    /// Closes the specified bead, optionally with a reason.
    #[command(
        long_about = "Close a bead to mark work complete.\n\nThis is typically called by the committer skill after a successful commit\nto finalize step completion.\n\nThe bead ID must exist and be open. Once closed, the bead status\nwill be reflected in `tug beads status` as complete.\n\nAuto-rotation: After closing a bead, the implementation log is checked\nfor size thresholds (500 lines or 100KB). If exceeded, the log is\nautomatically rotated to .tugtool/archive/ and a fresh log is created."
    )]
    Close {
        /// Bead ID to close
        bead_id: String,

        /// Reason for closing (e.g., "Step completed per plan")
        #[arg(long)]
        reason: Option<String>,

        /// Working directory for bd command (optional, for worktree context)
        #[arg(long)]
        working_dir: Option<String>,
    },

    /// Inspect a bead showing all fields
    ///
    /// Displays all fields of a bead including design, notes, close_reason, and metadata.
    #[command(
        long_about = "Inspect a bead showing all fields.\n\nDisplays:\n  - Basic fields: id, title, description, status, priority, type\n  - Rich fields: design, acceptance_criteria, notes\n  - Metadata: close_reason, metadata JSON\n\nUse --json for machine-readable output."
    )]
    Inspect {
        /// Bead ID to inspect
        bead_id: String,

        /// Working directory for bd command (optional, for worktree context)
        #[arg(long)]
        working_dir: Option<String>,
    },

    /// Update the notes field of a bead (replaces existing content)
    ///
    /// Replaces the entire notes field with new content.
    #[command(
        long_about = "Update the notes field of a bead.\n\nReplaces the entire notes field with new content.\nFor large content (>64KB), uses temporary file to avoid ARG_MAX issues.\n\nTo append instead of replace, use `tug beads append-notes`."
    )]
    UpdateNotes {
        /// Bead ID to update
        bead_id: String,

        /// New notes content (use --content-file to read from file instead)
        #[arg(conflicts_with = "content_file")]
        content: Option<String>,

        /// Path to file containing content to write
        #[arg(long, conflicts_with = "content")]
        content_file: Option<String>,

        /// Working directory for bd command (optional, for worktree context)
        #[arg(long)]
        working_dir: Option<String>,
    },

    /// Append content to the notes field of a bead
    ///
    /// Appends content to existing notes using "---" separator.
    #[command(
        long_about = "Append content to the notes field of a bead.\n\nAppends new content to existing notes with a \"---\" separator.\nIf notes field is empty, no separator is added.\n\nFor large content (>64KB), uses temporary file to avoid ARG_MAX issues."
    )]
    AppendNotes {
        /// Bead ID to update
        bead_id: String,

        /// Content to append (use --content-file to read from file instead)
        #[arg(conflicts_with = "content_file")]
        content: Option<String>,

        /// Path to file containing content to append
        #[arg(long, conflicts_with = "content")]
        content_file: Option<String>,

        /// Working directory for bd command (optional, for worktree context)
        #[arg(long)]
        working_dir: Option<String>,
    },

    /// Append content to the design field of a bead
    ///
    /// Appends content to existing design using "---" separator.
    #[command(
        long_about = "Append content to the design field of a bead.\n\nAppends new content to existing design with a \"---\" separator.\nIf design field is empty, no separator is added.\n\nFor large content (>64KB), uses temporary file to avoid ARG_MAX issues."
    )]
    AppendDesign {
        /// Bead ID to update
        bead_id: String,

        /// Content to append (use --content-file to read from file instead)
        #[arg(conflicts_with = "content_file")]
        content: Option<String>,

        /// Path to file containing content to append
        #[arg(long, conflicts_with = "content")]
        content_file: Option<String>,

        /// Working directory for bd command (optional, for worktree context)
        #[arg(long)]
        working_dir: Option<String>,
    },
}
