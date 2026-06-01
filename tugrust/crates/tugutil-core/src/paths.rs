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
    base_data_dir()
        .join("Tug")
        .join("projects")
        .join(project_slug(repo_root))
}

/// The application-data base directory.
///
/// An explicit `TUG_DATA_DIR` env override wins when set and non-empty (used to
/// pin the location for hermetic tests and host control). Otherwise a portable
/// fallback chain ensures the function always yields a real path:
/// `dirs::data_dir()` → `$HOME/.local/share` → the system temp dir.
fn base_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("TUG_DATA_DIR").filter(|v| !v.is_empty()) {
        return PathBuf::from(dir);
    }
    dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local").join("share")))
        .unwrap_or_else(std::env::temp_dir)
}

/// Flatten an absolute path into a single directory-name slug by replacing each
/// path separator with `-` (Claude Code's `.claude/projects/` scheme). A
/// leading separator becomes a leading `-`, e.g. `/Users/a/src/tug` →
/// `-Users-a-src-tug`.
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
