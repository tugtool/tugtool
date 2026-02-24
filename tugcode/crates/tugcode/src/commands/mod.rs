//! CLI command implementations

pub mod commit;
pub mod doctor;
pub mod init;
pub mod list;
pub mod log;
pub mod merge;
pub mod open_pr;
pub mod resolve;
pub mod state;
pub mod status;
pub mod tell;
pub mod validate;
pub mod version;
pub mod worktree;

pub use commit::run_commit;
pub use doctor::run_doctor;
pub use init::run_init;
pub use list::run_list;
pub use log::{LogCommands, run_log_prepend, run_log_rotate};
pub use merge::run_merge;
pub use open_pr::run_open_pr;
pub use resolve::run_resolve;
pub use state::{
    StateCommands, run_state_artifact, run_state_claim, run_state_complete, run_state_heartbeat,
    run_state_init, run_state_ready, run_state_reconcile, run_state_release, run_state_reset,
    run_state_show, run_state_start, run_state_update,
};
pub use status::run_status;
pub use tell::run_tell;
pub use validate::run_validate;
pub use version::run_version;
pub use worktree::{
    WorktreeCommands, run_worktree_cleanup, run_worktree_create, run_worktree_list,
    run_worktree_remove,
};
