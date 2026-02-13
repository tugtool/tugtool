//! CLI command implementations

pub mod beads;
pub mod doctor;
pub mod init;
pub mod list;
pub mod log;
pub mod merge;
pub mod status;
pub mod step_commit;
pub mod step_publish;
pub mod validate;
pub mod version;
pub mod worktree;

pub use beads::{
    BeadsCommands, run_append_design, run_append_notes, run_beads_status, run_close, run_inspect,
    run_link, run_pull, run_sync, run_update_notes,
};
pub use doctor::run_doctor;
pub use init::run_init;
pub use list::run_list;
pub use log::{LogCommands, run_log_prepend, run_log_rotate};
pub use merge::run_merge;
pub use status::run_status;
pub use step_commit::run_step_commit;
pub use step_publish::run_step_publish;
pub use validate::run_validate;
pub use version::run_version;
pub use worktree::{
    WorktreeCommands, run_worktree_cleanup, run_worktree_create, run_worktree_list,
    run_worktree_remove,
};
