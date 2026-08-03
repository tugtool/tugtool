//! Per-project runtime-state directory resolution.
//!
//! Per-user runtime state (the dash-log, the code-sign sentinel, future
//! side-command outputs) lives outside the source tree, in an OS-conventional
//! application-data directory, broken down per project. The single source of
//! that path is [`project_state_dir`].

use std::path::{Path, PathBuf};

/// Resolve the per-project runtime-state directory for `repo_root`.
///
/// Returns `<data_dir>/Tug/projects/<slug>/`, where `<data_dir>` is the
/// OS-conventional application-data directory (`~/Library/Application Support`
/// on macOS, `$XDG_DATA_HOME` / `~/.local/share` on Linux, `%APPDATA%` on
/// Windows) and `<slug>` is the project's absolute path with each separator
/// replaced by `-`. This mirrors Claude Code's `.claude/projects/` naming, so
/// the same checkout shows matching folder names under both roots.
///
/// `repo_root` should be the *main* repository root — every linked worktree of
/// a project shares one state dir. This is per-user runtime state; it is never
/// committed.
pub fn project_state_dir(repo_root: &Path) -> PathBuf {
    tugcore::instance::base_data_dir()
        .join("projects")
        .join(project_slug(repo_root))
}

/// Flatten an absolute path into a single directory-name slug by replacing each
/// path separator with `-`. A leading separator becomes a leading `-`, e.g.
/// `/Users/a/src/tug` → `-Users-a-src-tug`.
///
/// This is Tug's OWN state-dir naming, not Claude Code's
/// `~/.claude/projects/` scheme — claude additionally collapses dots,
/// underscores, and every other non-`[A-Za-z0-9-]` character to `-`
/// (see `encode_claude_project_name` in tugcast). Do not copy this
/// function for anything that must resolve claude's on-disk layout;
/// and do not "fix" it to match — existing per-project state dirs are
/// keyed by this exact form.
fn project_slug(repo_root: &Path) -> String {
    repo_root.to_string_lossy().replace(['/', '\\'], "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_mirrors_claude_projects_scheme() {
        assert_eq!(
            project_slug(Path::new("/Users/kocienda/Mounts/u/src/tugtool")),
            "-Users-kocienda-Mounts-u-src-tugtool"
        );
    }

    #[test]
    fn state_dir_is_under_tug_projects() {
        let dir = project_state_dir(Path::new("/tmp/example-repo"));
        assert!(dir.ends_with("Tug/projects/-tmp-example-repo"));
    }
}
