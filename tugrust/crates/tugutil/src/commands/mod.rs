//! CLI command implementations

pub mod color;
pub mod dash;
pub mod init;
pub mod instance;
pub mod list;
pub mod resolve;
pub mod state_dir;
pub mod tell;
pub mod validate;
pub mod version;

pub use color::run_color;
pub use dash::{
    DashCommands, run_dash_commit, run_dash_create, run_dash_join, run_dash_list, run_dash_release,
    run_dash_show,
};
pub use init::run_init;
pub use instance::{InstanceCommands, run_instance};
pub use list::run_list;
pub use resolve::run_resolve;
pub use state_dir::run_state_dir;
pub use tell::run_tell;
pub use validate::run_validate;
pub use version::run_version;
