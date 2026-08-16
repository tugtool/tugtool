//! Shared workspace walk for the refs feed.
//!
//! One gitignore-aware, secret-filtered traversal that both the filename
//! match op and the content search op run over. The `WalkBuilder` setup
//! mirrors `file_watcher::walk_with_cap` — nested `.gitignore` support,
//! hidden files included, no global/exclude files, no git repo required —
//! and adds the two things a user-invoked search needs and a watcher does
//! not: an opt-in descent into gitignored paths, and directory entries as
//! candidates in their own right.
//!
//! `SecretFilter` is applied unconditionally. No option here bypasses it:
//! a path matching the secret denylist is never returned, so it can never
//! reach a result row.

use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use tracing::warn;

use crate::feeds::secret_filter::SecretFilter;
use crate::path_resolver::PathResolver;

/// Maximum number of entries a single walk yields. Matches the file
/// watcher's cap — a workspace larger than this is already beyond what
/// the deck's other file surfaces enumerate.
pub const WALK_CAP: usize = 50_000;

/// What a walk is allowed to visit.
#[derive(Debug, Clone, Copy, Default)]
pub struct WalkOptions {
    /// Descend into paths `.gitignore` excludes (`node_modules`, `target`,
    /// …). `SecretFilter` still applies.
    pub include_gitignored: bool,
    /// Yield directory entries alongside files.
    pub include_dirs: bool,
}

/// One entry a walk yielded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalkEntry {
    /// Workspace-relative path with forward slashes — the form the wire
    /// and the ledger carry.
    pub relative: String,
    /// Absolute path on disk, for reading the file's bytes.
    pub absolute: PathBuf,
    pub is_dir: bool,
}

/// Walk `root`, returning at most `WALK_CAP` entries.
///
/// Entries arrive in the walker's own order, which is stable for a given
/// tree but not sorted. Callers that need determinism sort what they
/// emit; the refs ops number rows in emission order instead.
pub fn walk_workspace(root: &Path, opts: WalkOptions) -> Vec<WalkEntry> {
    walk_workspace_with_cap(root, opts, WALK_CAP)
}

/// Implementation behind `walk_workspace`, with an explicit cap so the
/// truncation path is testable without creating 50,000 files.
pub fn walk_workspace_with_cap(root: &Path, opts: WalkOptions, cap: usize) -> Vec<WalkEntry> {
    let resolver = PathResolver::new(root.to_path_buf());
    let secret_filter = SecretFilter::new(resolver.watch_path());

    let walker = WalkBuilder::new(resolver.watch_path())
        .hidden(false)
        .git_ignore(!opts.include_gitignored)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .build();

    let mut entries: Vec<WalkEntry> = Vec::new();

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                warn!(error = %err, "refs walk: error walking directory");
                continue;
            }
        };

        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        let path = entry.path();

        let Some(relative) = resolver.to_relative(path) else {
            continue;
        };

        // The walk root itself relativizes to "" — not an entry.
        if relative.is_empty() {
            continue;
        }

        // `.git` is machinery, never a search candidate. Explicit because
        // `include_gitignored` turns the gitignore layer off entirely.
        if relative == ".git" || relative.starts_with(".git/") {
            continue;
        }

        // The secret denylist matches directories via a trailing slash.
        let probe = if is_dir {
            format!("{relative}/")
        } else {
            relative.clone()
        };
        if secret_filter.is_secret(&probe) {
            continue;
        }

        if is_dir && !opts.include_dirs {
            continue;
        }

        if entries.len() >= cap {
            break;
        }

        entries.push(WalkEntry {
            relative,
            absolute: path.to_path_buf(),
            is_dir,
        });
    }

    entries
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn relatives(entries: &[WalkEntry]) -> Vec<&str> {
        let mut names: Vec<&str> = entries.iter().map(|e| e.relative.as_str()).collect();
        names.sort_unstable();
        names
    }

    #[test]
    fn walks_files_and_skips_directories_by_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir.path().join("README.md"), "hi").unwrap();

        let entries = walk_workspace(dir.path(), WalkOptions::default());
        assert_eq!(relatives(&entries), vec!["README.md", "src/main.rs"]);
    }

    #[test]
    fn include_dirs_yields_directory_entries() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/main.rs"), "fn main() {}").unwrap();

        let entries = walk_workspace(
            dir.path(),
            WalkOptions {
                include_dirs: true,
                ..WalkOptions::default()
            },
        );
        assert_eq!(relatives(&entries), vec!["src", "src/main.rs"]);
        assert!(entries.iter().any(|e| e.relative == "src" && e.is_dir));
    }

    #[test]
    fn gitignored_paths_are_skipped_until_opted_in() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
        std::fs::create_dir(dir.path().join("ignored")).unwrap();
        std::fs::write(dir.path().join("ignored/blob.txt"), "x").unwrap();
        std::fs::write(dir.path().join("kept.txt"), "x").unwrap();

        let default = walk_workspace(dir.path(), WalkOptions::default());
        assert!(!relatives(&default).contains(&"ignored/blob.txt"));

        let all = walk_workspace(
            dir.path(),
            WalkOptions {
                include_gitignored: true,
                ..WalkOptions::default()
            },
        );
        assert!(relatives(&all).contains(&"ignored/blob.txt"));
    }

    #[test]
    fn secret_paths_are_never_yielded_even_with_all_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".env"), "TOKEN=hunter2").unwrap();
        std::fs::write(dir.path().join("server.pem"), "-----BEGIN").unwrap();
        std::fs::write(dir.path().join("app.ts"), "export {}").unwrap();

        let entries = walk_workspace(
            dir.path(),
            WalkOptions {
                include_gitignored: true,
                include_dirs: true,
            },
        );
        assert_eq!(relatives(&entries), vec!["app.ts"]);
    }

    #[test]
    fn git_directory_is_skipped_even_with_gitignore_off() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        std::fs::write(dir.path().join("app.ts"), "export {}").unwrap();

        let entries = walk_workspace(
            dir.path(),
            WalkOptions {
                include_gitignored: true,
                include_dirs: true,
            },
        );
        assert_eq!(relatives(&entries), vec!["app.ts"]);
    }

    #[test]
    fn cap_bounds_the_entry_count() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..10 {
            std::fs::write(dir.path().join(format!("f{i}.txt")), "x").unwrap();
        }

        let entries = walk_workspace_with_cap(dir.path(), WalkOptions::default(), 4);
        assert_eq!(entries.len(), 4);
    }
}
