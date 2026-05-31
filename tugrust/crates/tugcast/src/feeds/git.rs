//! Git feed implementation
//!
//! Polls git repository status and broadcasts GitStatus snapshots when changes are detected.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::process::Command;
use tokio::sync::watch;
use tokio::time;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

use tugcast_core::types::{
    FileStatus, GitDiffFile, GitDiffFileStatus, GitDiffSnapshot, GitStatus,
};
use tugcast_core::{FeedId, Frame, SnapshotFeed};

use super::code::splice_workspace_key;

/// Polling interval for git status
const POLL_INTERVAL_SECS: u64 = 2;

/// Git feed that polls repository status at fixed intervals
pub struct GitFeed {
    repo_dir: PathBuf,
    workspace_key: Arc<str>,
}

impl GitFeed {
    /// Create a new git feed watching the given repository directory.
    ///
    /// `workspace_key` is spliced as the first field of every emitted GIT frame.
    pub fn new(repo_dir: PathBuf, workspace_key: Arc<str>) -> Self {
        Self {
            repo_dir,
            workspace_key,
        }
    }
}

/// Parse git status --porcelain=v2 --branch output into GitStatus
fn parse_porcelain_v2(output: &str) -> GitStatus {
    let mut branch = String::new();
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;
    let mut head_sha = String::new();
    let mut staged: Vec<FileStatus> = Vec::new();
    let mut unstaged: Vec<FileStatus> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    for line in output.lines() {
        if line.starts_with("# branch.oid ") {
            head_sha = line.trim_start_matches("# branch.oid ").to_string();
            if head_sha == "(initial)" {
                head_sha = String::new();
            }
        } else if line.starts_with("# branch.head ") {
            branch = line.trim_start_matches("# branch.head ").to_string();
        } else if line.starts_with("# branch.ab ") {
            let rest = line.trim_start_matches("# branch.ab ");
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() >= 2 {
                ahead = parts[0].trim_start_matches('+').parse().unwrap_or(0);
                behind = parts[1].trim_start_matches('-').parse().unwrap_or(0);
            }
        } else if line.starts_with("1 ") {
            // Ordinary changed entry: 1 XY sub mH mI mW hH hI path
            let parts: Vec<&str> = line.splitn(9, ' ').collect();
            if parts.len() >= 9 {
                let xy = parts[1];
                let path = parts[8];

                if xy.len() >= 2 {
                    let x = xy.chars().next().unwrap();
                    let y = xy.chars().nth(1).unwrap();

                    if x != '.' {
                        staged.push(FileStatus {
                            path: path.to_string(),
                            status: x.to_string(),
                        });
                    }
                    if y != '.' {
                        unstaged.push(FileStatus {
                            path: path.to_string(),
                            status: y.to_string(),
                        });
                    }
                }
            }
        } else if line.starts_with("2 ") {
            // Renamed/copied entry: 2 XY sub mH mI mW hH hI Xscore path\torigPath
            let parts: Vec<&str> = line.splitn(10, ' ').collect();
            if parts.len() >= 10 {
                let xy = parts[1];
                let path_field = parts[9];

                // Split on tab to get new path and original path
                let tab_parts: Vec<&str> = path_field.split('\t').collect();
                let new_path = if !tab_parts.is_empty() {
                    tab_parts[0]
                } else {
                    path_field
                };

                if xy.len() >= 2 {
                    let x = xy.chars().next().unwrap();
                    let y = xy.chars().nth(1).unwrap();

                    if x != '.' {
                        staged.push(FileStatus {
                            path: new_path.to_string(),
                            status: "R".to_string(),
                        });
                    }
                    if y != '.' {
                        unstaged.push(FileStatus {
                            path: new_path.to_string(),
                            status: y.to_string(),
                        });
                    }
                }
            }
        } else if line.starts_with("? ") {
            let path = line.trim_start_matches("? ");
            untracked.push(path.to_string());
        } else if line.starts_with("u ") {
            // Unmerged entry - skip with debug log
            debug!("skipping unmerged entry: {}", line);
        }
        // Skip other # lines (e.g., # branch.upstream, # stash)
    }

    GitStatus {
        branch,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        head_sha,
        head_message: String::new(), // Filled separately via git log
    }
}

/// Fetch the HEAD commit message
async fn fetch_head_message(repo_dir: &Path) -> String {
    let output = Command::new("git")
        .args([
            "-C",
            &repo_dir.to_string_lossy(),
            "log",
            "-1",
            "--format=%s",
        ])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => String::new(),
    }
}

/// Fetch git status output
async fn fetch_git_status(repo_dir: &Path) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-C",
            &repo_dir.to_string_lossy(),
            "status",
            "--porcelain=v2",
            "--branch",
        ])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).to_string()),
        Ok(o) => {
            // `git`'s stderr ends with a `\n`; the tracing fmt layer
            // appends its own newline per event, so logging the raw
            // string would produce a `\n\n` and a blank line in the
            // log file. Trim before logging.
            let stderr = String::from_utf8_lossy(&o.stderr);
            let stderr = stderr.trim_end();
            warn!(stderr = %stderr, "git status command failed");
            None
        }
        Err(e) => {
            warn!(error = %e, "failed to execute git status");
            None
        }
    }
}

/// Cheap, subprocess-free check for whether `dir` lies within a git working
/// tree: walk up from `dir` looking for a `.git` entry (a directory for a
/// normal repo, a file for a worktree/submodule), stopping at the filesystem
/// root.
///
/// Used to gate the `git status` poll. A non-git project dir (e.g.
/// `/tmp/scratch`) otherwise forks a `git` every cycle that fails with exit
/// 128 and logs a warning — forever. With this gate it costs only a handful
/// of `stat`s per cycle, and the feed self-activates the moment a `.git`
/// appears (a `git init` after the card is already live). The ancestor walk
/// matters because a project dir can be a *subdirectory* of a repo, where
/// `.git` lives above it.
async fn is_within_git_worktree(dir: &Path) -> bool {
    let mut cursor = Some(dir);
    while let Some(current) = cursor {
        if tokio::fs::metadata(current.join(".git")).await.is_ok() {
            return true;
        }
        cursor = current.parent();
    }
    false
}

#[async_trait]
impl SnapshotFeed for GitFeed {
    fn feed_id(&self) -> FeedId {
        FeedId::GIT
    }

    fn name(&self) -> &str {
        "git"
    }

    async fn run(&self, tx: watch::Sender<Frame>, cancel: CancellationToken) {
        info!(dir = ?self.repo_dir, "git feed started");

        let mut interval = time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
        let mut previous: Option<GitStatus> = None;

        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    info!("git feed shutting down");
                    break;
                }
                _ = interval.tick() => {
                    // Skip the `git status` subprocess entirely when this dir
                    // isn't in a git working tree yet — cheap `stat`s only, no
                    // fork, no warn-spam. The feed self-activates on a later
                    // tick once a `.git` appears (`git init` mid-session).
                    if !is_within_git_worktree(&self.repo_dir).await {
                        continue;
                    }

                    // Fetch git status
                    let status_output = match fetch_git_status(&self.repo_dir).await {
                        Some(output) => output,
                        None => continue, // Skip this cycle on error
                    };

                    // Parse status
                    let mut status = parse_porcelain_v2(&status_output);

                    // Fetch head message
                    status.head_message = fetch_head_message(&self.repo_dir).await;

                    // Compare with previous -- only send if changed
                    if previous.as_ref() != Some(&status) {
                        let json = serde_json::to_vec(&status).unwrap_or_default();
                        let json = splice_workspace_key(&json, &self.workspace_key);
                        let frame = Frame::new(FeedId::GIT, json);
                        let _ = tx.send(frame);
                        debug!(branch = %status.branch, "git status updated");
                        previous = Some(status);
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Single-shot `git diff HEAD` sourcing for the `/diff` sheet ([#step-10a])
// ---------------------------------------------------------------------------

/// The ref the working tree is diffed against for `/diff`. Claude Code's
/// `/diff` shows "Uncommitted changes (git diff HEAD)"; we match it.
const GIT_DIFF_BASE: &str = "HEAD";

/// Run `git diff HEAD` in `repo_dir` and assemble a single-shot
/// [`GitDiffSnapshot`] for a `/diff` request.
///
/// The diff is computed in the project dir tugcast already keys git by (the
/// dir behind the Z4B GIT-status chip). Rename detection is on (`-M`),
/// colorization off, and `core.quotepath=false` so non-ASCII paths arrive
/// literal. The `total_*` summary is derived from the parsed files so the
/// header totals always equal the sum the client renders.
///
/// On a git error — most commonly a repository with no commits, where `HEAD`
/// does not resolve — the snapshot is empty (`file_count = 0`); the sheet
/// shows its "no changes" state rather than surfacing a raw git failure.
pub async fn build_git_diff_snapshot(
    repo_dir: &Path,
    request_id: String,
    workspace_key: &str,
) -> GitDiffSnapshot {
    let files = match fetch_git_diff(repo_dir).await {
        Some(output) => parse_git_diff(&output),
        None => Vec::new(),
    };
    let total_added = files.iter().map(|f| f.added).sum();
    let total_removed = files.iter().map(|f| f.removed).sum();
    GitDiffSnapshot {
        request_id,
        workspace_key: workspace_key.to_string(),
        base: GIT_DIFF_BASE.to_string(),
        file_count: files.len() as u32,
        total_added,
        total_removed,
        files,
    }
}

/// Fetch the combined `git diff HEAD` output for the working tree. Returns
/// `None` (and logs) on a non-zero exit or spawn failure.
async fn fetch_git_diff(repo_dir: &Path) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-C",
            &repo_dir.to_string_lossy(),
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-color",
            "-M",
            GIT_DIFF_BASE,
        ])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).into_owned()),
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            warn!(stderr = %stderr.trim_end(), "git diff command failed");
            None
        }
        Err(e) => {
            warn!(error = %e, "failed to execute git diff");
            None
        }
    }
}

/// Split combined `git diff` output into one [`GitDiffFile`] per file.
///
/// Files are delimited by `diff --git ` header lines (git emits exactly one
/// per file pair, including pure renames and binary files). Each file's
/// `unified` text is its chunk verbatim; status, paths, and `+`/`-` counts
/// are derived per [`parse_diff_chunk`].
pub fn parse_git_diff(output: &str) -> Vec<GitDiffFile> {
    let mut files = Vec::new();
    let mut chunk: Option<Vec<&str>> = None;
    for line in output.lines() {
        if line.starts_with("diff --git ") {
            if let Some(lines) = chunk.take() {
                files.push(parse_diff_chunk(&lines));
            }
            chunk = Some(vec![line]);
        } else if let Some(lines) = chunk.as_mut() {
            lines.push(line);
        }
        // Lines before the first `diff --git` (none for plain `git diff`) are
        // ignored — there is no chunk to attach them to.
    }
    if let Some(lines) = chunk.take() {
        files.push(parse_diff_chunk(&lines));
    }
    files
}

/// Strip git's `a/` or `b/` path prefix (after a `--- `/`+++ ` marker).
fn strip_ab_prefix(s: &str) -> &str {
    s.strip_prefix("a/").or_else(|| s.strip_prefix("b/")).unwrap_or(s)
}

/// Parse the new-side path out of a `diff --git a/<old> b/<new>` header,
/// the only path source for a binary file (no `---`/`+++` lines). Best-effort
/// for paths without spaces — the overwhelming common case; renames and text
/// files take the more precise `rename to` / `+++ b/` paths instead.
fn path_from_diff_header(header: &str) -> Option<String> {
    let rest = header.strip_prefix("diff --git ")?;
    let idx = rest.rfind(" b/")?;
    Some(rest[idx + 3..].to_string())
}

/// Derive one file's [`GitDiffFile`] from its chunk lines (the first line is
/// the `diff --git` header). Status comes from git's metadata markers; paths
/// from the `rename to`/`+++ b/`/`--- a/` lines (falling back to the header);
/// `added`/`removed` from the `+`/`-` hunk-body lines.
fn parse_diff_chunk(lines: &[&str]) -> GitDiffFile {
    let header = lines.first().copied().unwrap_or("");
    let mut status = GitDiffFileStatus::Modified;
    let mut rename_from: Option<String> = None;
    let mut rename_to: Option<String> = None;
    let mut plus_path: Option<String> = None;
    let mut minus_path: Option<String> = None;
    let mut binary = false;
    let mut added = 0u32;
    let mut removed = 0u32;
    let mut in_hunk = false;

    for &line in lines.iter().skip(1) {
        if line.starts_with("new file mode") {
            status = GitDiffFileStatus::Added;
        } else if line.starts_with("deleted file mode") {
            status = GitDiffFileStatus::Deleted;
        } else if let Some(p) = line.strip_prefix("rename from ") {
            status = GitDiffFileStatus::Renamed;
            rename_from = Some(p.to_string());
        } else if let Some(p) = line.strip_prefix("rename to ") {
            status = GitDiffFileStatus::Renamed;
            rename_to = Some(p.to_string());
        } else if line.starts_with("Binary files ") {
            binary = true;
        } else if let Some(p) = line.strip_prefix("--- ") {
            if p != "/dev/null" {
                minus_path = Some(strip_ab_prefix(p).to_string());
            }
        } else if let Some(p) = line.strip_prefix("+++ ") {
            if p != "/dev/null" {
                plus_path = Some(strip_ab_prefix(p).to_string());
            }
        } else if line.starts_with("@@") {
            in_hunk = true;
        } else if in_hunk && line.starts_with('+') {
            added += 1;
        } else if in_hunk && line.starts_with('-') {
            removed += 1;
        }
    }

    let (path, old_path) = if status == GitDiffFileStatus::Renamed {
        (
            rename_to.or_else(|| plus_path.clone()).unwrap_or_default(),
            rename_from.or_else(|| minus_path.clone()),
        )
    } else {
        (
            plus_path
                .or(minus_path)
                .or_else(|| path_from_diff_header(header))
                .unwrap_or_default(),
            None,
        )
    };

    let unified = if lines.is_empty() {
        String::new()
    } else {
        // Reconstruct the chunk verbatim with a trailing newline; the client
        // parser tolerates the `diff --git`/`index` preamble and a trailing
        // blank line.
        format!("{}\n", lines.join("\n"))
    };

    GitDiffFile {
        path,
        old_path,
        status,
        added,
        removed,
        binary,
        unified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_parse_typical_output() {
        let output = "\
# branch.oid abc123def456
# branch.head main
# branch.upstream origin/main
# branch.ab +2 -1
1 M. N... 100644 100644 100644 hash1 hash2 src/main.rs
1 .M N... 100644 100644 100644 hash3 hash4 README.md
? temp.txt
";

        let status = parse_porcelain_v2(output);
        assert_eq!(status.branch, "main");
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        assert_eq!(status.head_sha, "abc123def456");
        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].path, "src/main.rs");
        assert_eq!(status.staged[0].status, "M");
        assert_eq!(status.unstaged.len(), 1);
        assert_eq!(status.unstaged[0].path, "README.md");
        assert_eq!(status.unstaged[0].status, "M");
        assert_eq!(status.untracked.len(), 1);
        assert_eq!(status.untracked[0], "temp.txt");
    }

    #[test]
    fn test_parse_detached_head() {
        let output = "\
# branch.oid abc123
# branch.head (detached)
";

        let status = parse_porcelain_v2(output);
        assert_eq!(status.branch, "(detached)");
        assert_eq!(status.head_sha, "abc123");
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
        assert_eq!(status.staged.len(), 0);
        assert_eq!(status.unstaged.len(), 0);
        assert_eq!(status.untracked.len(), 0);
    }

    #[test]
    fn test_parse_clean_repo() {
        let output = "\
# branch.oid abc123
# branch.head main
";

        let status = parse_porcelain_v2(output);
        assert_eq!(status.branch, "main");
        assert_eq!(status.head_sha, "abc123");
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
        assert_eq!(status.staged.len(), 0);
        assert_eq!(status.unstaged.len(), 0);
        assert_eq!(status.untracked.len(), 0);
    }

    #[test]
    fn test_parse_renamed_files() {
        let output = "\
# branch.oid abc123
# branch.head main
2 R. N... 100644 100644 100644 hash1 hash2 R100 new_name.rs\told_name.rs
";

        let status = parse_porcelain_v2(output);
        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].status, "R");
        assert_eq!(status.staged[0].path, "new_name.rs");
    }

    #[test]
    fn test_parse_ahead_behind() {
        let output = "\
# branch.oid abc123
# branch.head feature
# branch.ab +5 -3
";

        let status = parse_porcelain_v2(output);
        assert_eq!(status.ahead, 5);
        assert_eq!(status.behind, 3);
    }

    #[test]
    fn test_parse_no_upstream() {
        let output = "\
# branch.oid abc123
# branch.head feature
";

        let status = parse_porcelain_v2(output);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[test]
    fn test_parse_staged_and_unstaged_same_file() {
        let output = "\
# branch.oid abc123
# branch.head main
1 MM N... 100644 100644 100644 hash1 hash2 src/lib.rs
";

        let status = parse_porcelain_v2(output);
        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].path, "src/lib.rs");
        assert_eq!(status.staged[0].status, "M");
        assert_eq!(status.unstaged.len(), 1);
        assert_eq!(status.unstaged[0].path, "src/lib.rs");
        assert_eq!(status.unstaged[0].status, "M");
    }

    #[test]
    fn test_diff_comparison_skips_unchanged() {
        let status1 = GitStatus {
            branch: "main".to_string(),
            ahead: 0,
            behind: 0,
            staged: vec![],
            unstaged: vec![],
            untracked: vec![],
            head_sha: "abc123".to_string(),
            head_message: "Initial commit".to_string(),
        };

        let status2 = GitStatus {
            branch: "main".to_string(),
            ahead: 0,
            behind: 0,
            staged: vec![],
            unstaged: vec![],
            untracked: vec![],
            head_sha: "abc123".to_string(),
            head_message: "Initial commit".to_string(),
        };

        assert_eq!(status1, status2);

        let mut status3 = status1.clone();
        status3.ahead = 1;
        assert_ne!(status1, status3);
    }

    #[test]
    fn test_feed_id_and_name() {
        let feed = GitFeed::new(
            PathBuf::from("/unused-in-this-test"),
            Arc::from("test-workspace"),
        );
        assert_eq!(feed.feed_id(), FeedId::GIT);
        assert_eq!(feed.name(), "git");
    }

    #[tokio::test]
    async fn test_git_feed_integration() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();

        // Initialize git repo
        Command::new("git")
            .args(["-C", &repo_path.to_string_lossy(), "init"])
            .output()
            .await
            .unwrap();

        // Configure git user
        Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "config",
                "user.name",
                "test",
            ])
            .output()
            .await
            .unwrap();

        Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "config",
                "user.email",
                "test@test.com",
            ])
            .output()
            .await
            .unwrap();

        // Create initial commit
        Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "commit",
                "--allow-empty",
                "-m",
                "init",
            ])
            .output()
            .await
            .unwrap();

        // Derive the fixture workspace_key from the real TempDir repo path —
        // mirrors how WorkspaceRegistry builds the key in production.
        let fixture_key: Arc<str> = Arc::from(repo_path.to_string_lossy().as_ref());

        // Create git feed
        let feed = GitFeed::new(repo_path.clone(), fixture_key.clone());

        // Create watch channel
        let (tx, mut rx) = watch::channel(Frame::new(FeedId::GIT, vec![]));

        // Create cancellation token
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();

        // Spawn feed in background
        let feed_task = tokio::spawn(async move {
            feed.run(tx, cancel_clone).await;
        });

        // Wait for first poll
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Check first snapshot
        rx.changed().await.unwrap();
        let frame = rx.borrow_and_update().clone();
        assert_eq!(frame.feed_id, FeedId::GIT);

        let status: GitStatus = serde_json::from_slice(&frame.payload).unwrap();
        assert!(!status.branch.is_empty());
        assert!(!status.head_sha.is_empty());

        // Create a file and stage it
        let test_file = repo_path.join("test.txt");
        fs::write(&test_file, "hello").unwrap();

        Command::new("git")
            .args(["-C", &repo_path.to_string_lossy(), "add", "test.txt"])
            .output()
            .await
            .unwrap();

        // Wait for next poll cycle
        tokio::time::sleep(Duration::from_secs(3)).await;

        // Check updated snapshot
        rx.changed().await.unwrap();
        let frame = rx.borrow_and_update().clone();
        let status: GitStatus = serde_json::from_slice(&frame.payload).unwrap();

        // Verify the file is in staged list
        assert!(!status.staged.is_empty());
        assert_eq!(status.staged[0].path, "test.txt");

        // Cancel and cleanup
        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(2), feed_task).await;
    }

    /// W1: GitFeed splices `workspace_key` as the first field of every
    /// emitted frame.
    #[tokio::test]
    async fn test_workspace_key_spliced_into_git_frame() {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path().to_path_buf();

        // Initialize git repo with a commit so `git status` returns a valid snapshot.
        Command::new("git")
            .args(["-C", &repo_path.to_string_lossy(), "init"])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "config",
                "user.name",
                "test",
            ])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "config",
                "user.email",
                "test@test.com",
            ])
            .output()
            .await
            .unwrap();
        Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "commit",
                "--allow-empty",
                "-m",
                "init",
            ])
            .output()
            .await
            .unwrap();

        // Derive fixture key from the real repo_path.
        let fixture_key: Arc<str> = Arc::from(repo_path.to_string_lossy().as_ref());

        let feed = GitFeed::new(repo_path.clone(), fixture_key.clone());
        let (tx, mut rx) = watch::channel(Frame::new(FeedId::GIT, vec![]));
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();
        let feed_task = tokio::spawn(async move {
            feed.run(tx, cancel_clone).await;
        });

        rx.changed().await.unwrap();
        let frame = rx.borrow_and_update().clone();

        // Field ordering check is done on the raw bytes because
        // `serde_json::Value` normalizes object key order (BTreeMap).
        let expected_prefix = format!(r#"{{"workspace_key":"{}","#, fixture_key);
        assert!(
            frame.payload.starts_with(expected_prefix.as_bytes()),
            "workspace_key must be the first field of GIT frames; got: {}",
            String::from_utf8_lossy(&frame.payload)
        );
        let parsed: serde_json::Value = serde_json::from_slice(&frame.payload).unwrap();
        assert_eq!(parsed["workspace_key"], fixture_key.as_ref());

        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(2), feed_task).await;
    }

    // -- is_within_git_worktree gate (skip git poll for non-repos) --

    #[tokio::test]
    async fn test_is_within_git_worktree_false_for_plain_dir() {
        let temp = TempDir::new().unwrap();
        assert!(!is_within_git_worktree(temp.path()).await);
    }

    #[tokio::test]
    async fn test_is_within_git_worktree_true_for_repo_and_subdir() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        git_in(repo, &["init"]).await;
        assert!(is_within_git_worktree(repo).await, "repo root");

        let sub = repo.join("a").join("b");
        fs::create_dir_all(&sub).unwrap();
        assert!(
            is_within_git_worktree(&sub).await,
            "a subdir of a repo must walk up to the ancestor .git",
        );
    }

    #[tokio::test]
    async fn test_git_feed_skips_until_repo_initialized() {
        let temp = TempDir::new().unwrap();
        let dir = temp.path().to_path_buf();
        let key: Arc<str> = Arc::from(dir.to_string_lossy().as_ref());
        let feed = GitFeed::new(dir.clone(), key);
        let (tx, mut rx) = watch::channel(Frame::new(FeedId::GIT, vec![]));
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();
        let task = tokio::spawn(async move {
            feed.run(tx, cancel_clone).await;
        });

        // No repo yet: the feed must emit nothing — the watch stays at its
        // initial empty frame (the poll is gated out, no `git` is forked).
        tokio::time::sleep(Duration::from_millis(1500)).await;
        assert!(
            rx.borrow_and_update().payload.is_empty(),
            "no git status must be emitted for a non-repo dir",
        );

        // Initialize a repo mid-run; the feed must self-activate on a later tick.
        git_in(&dir, &["init"]).await;
        git_in(&dir, &["config", "user.name", "test"]).await;
        git_in(&dir, &["config", "user.email", "test@test.com"]).await;
        git_in(&dir, &["commit", "--allow-empty", "-m", "init"]).await;

        let mut emitted = false;
        for _ in 0..30 {
            if !rx.borrow().payload.is_empty() {
                emitted = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        assert!(emitted, "feed must emit once the repo is initialized");
        let status: GitStatus = serde_json::from_slice(&rx.borrow().payload).unwrap();
        assert!(!status.head_sha.is_empty());

        cancel.cancel();
        let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
    }

    // -- git diff sourcing ([#step-10a]) --

    const MODIFIED: &str = "\
diff --git a/src/main.rs b/src/main.rs
index 1234567..89abcde 100644
--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 fn main() {
-    println!(\"old\");
+    println!(\"new\");
+    println!(\"added\");
 }
";

    const ADDED: &str = "\
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3b18e51
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+line one
+line two
";

    const DELETED: &str = "\
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 3b18e51..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-bye one
-bye two
";

    const RENAMED_PURE: &str = "\
diff --git a/old_name.txt b/new_name.txt
similarity index 100%
rename from old_name.txt
rename to new_name.txt
";

    const RENAMED_EDITED: &str = "\
diff --git a/a.txt b/b.txt
similarity index 80%
rename from a.txt
rename to b.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/b.txt
@@ -1,2 +1,2 @@
 keep
-old line
+new line
";

    const BINARY: &str = "\
diff --git a/img.png b/img.png
index 1111111..2222222 100644
Binary files a/img.png and b/img.png differ
";

    #[test]
    fn test_parse_diff_modified() {
        let files = parse_git_diff(MODIFIED);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.path, "src/main.rs");
        assert_eq!(f.old_path, None);
        assert_eq!(f.status, GitDiffFileStatus::Modified);
        assert_eq!(f.added, 2);
        assert_eq!(f.removed, 1);
        assert!(!f.binary);
        // The unified chunk is preserved verbatim (preamble through hunks).
        assert!(f.unified.starts_with("diff --git a/src/main.rs b/src/main.rs"));
        assert!(f.unified.contains("@@ -1,3 +1,4 @@"));
    }

    #[test]
    fn test_parse_diff_added() {
        let files = parse_git_diff(ADDED);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.path, "new.txt");
        assert_eq!(f.status, GitDiffFileStatus::Added);
        assert_eq!(f.added, 2);
        assert_eq!(f.removed, 0);
    }

    #[test]
    fn test_parse_diff_deleted() {
        let files = parse_git_diff(DELETED);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        // Path comes from the `--- a/…` side; `+++ /dev/null` is skipped.
        assert_eq!(f.path, "gone.txt");
        assert_eq!(f.status, GitDiffFileStatus::Deleted);
        assert_eq!(f.added, 0);
        assert_eq!(f.removed, 2);
    }

    #[test]
    fn test_parse_diff_renamed_pure() {
        let files = parse_git_diff(RENAMED_PURE);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.path, "new_name.txt");
        assert_eq!(f.old_path.as_deref(), Some("old_name.txt"));
        assert_eq!(f.status, GitDiffFileStatus::Renamed);
        assert_eq!(f.added, 0);
        assert_eq!(f.removed, 0);
    }

    #[test]
    fn test_parse_diff_renamed_with_edits() {
        let files = parse_git_diff(RENAMED_EDITED);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.path, "b.txt");
        assert_eq!(f.old_path.as_deref(), Some("a.txt"));
        assert_eq!(f.status, GitDiffFileStatus::Renamed);
        assert_eq!(f.added, 1);
        assert_eq!(f.removed, 1);
    }

    #[test]
    fn test_parse_diff_binary() {
        let files = parse_git_diff(BINARY);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        // No `---`/`+++` lines — path falls back to the `diff --git` header.
        assert_eq!(f.path, "img.png");
        assert_eq!(f.status, GitDiffFileStatus::Modified);
        assert!(f.binary);
        assert_eq!(f.added, 0);
        assert_eq!(f.removed, 0);
    }

    #[test]
    fn test_parse_diff_multifile_order_preserved() {
        let combined = format!("{MODIFIED}{ADDED}{DELETED}");
        let files = parse_git_diff(&combined);
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["src/main.rs", "new.txt", "gone.txt"]);
        assert_eq!(files[0].status, GitDiffFileStatus::Modified);
        assert_eq!(files[1].status, GitDiffFileStatus::Added);
        assert_eq!(files[2].status, GitDiffFileStatus::Deleted);
    }

    #[test]
    fn test_parse_diff_empty() {
        assert!(parse_git_diff("").is_empty());
    }

    /// Run a git subcommand in `repo`, asserting success.
    async fn git_in(repo: &Path, args: &[&str]) {
        let mut full = vec!["-C", repo.to_str().unwrap()];
        full.extend_from_slice(args);
        let out = Command::new("git").args(&full).output().await.unwrap();
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Initialize a committed git repo with three tracked files.
    async fn init_diff_fixture_repo() -> TempDir {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().to_path_buf();
        git_in(&repo, &["init"]).await;
        git_in(&repo, &["config", "user.name", "test"]).await;
        git_in(&repo, &["config", "user.email", "test@test.com"]).await;
        fs::write(repo.join("keep.txt"), "v1\n").unwrap();
        fs::write(repo.join("del.txt"), "delete me\n").unwrap();
        fs::write(repo.join("ren_src.txt"), "rename me\n").unwrap();
        git_in(&repo, &["add", "-A"]).await;
        git_in(&repo, &["commit", "-m", "init"]).await;
        temp
    }

    #[tokio::test]
    async fn test_build_git_diff_snapshot_covers_all_statuses() {
        let temp = init_diff_fixture_repo().await;
        let repo = temp.path().to_path_buf();

        // Modify, delete, rename, and add — one of each status.
        fs::write(repo.join("keep.txt"), "v2\n").unwrap();
        git_in(&repo, &["rm", "del.txt"]).await;
        git_in(&repo, &["mv", "ren_src.txt", "ren_dst.txt"]).await;
        fs::write(repo.join("new.txt"), "fresh line\n").unwrap();
        git_in(&repo, &["add", "-A"]).await;

        let snapshot =
            build_git_diff_snapshot(&repo, "req-42".to_string(), "ws-key").await;

        assert_eq!(snapshot.request_id, "req-42");
        assert_eq!(snapshot.workspace_key, "ws-key");
        assert_eq!(snapshot.base, "HEAD");
        assert_eq!(snapshot.file_count, 4, "modify + delete + rename + add");
        assert_eq!(snapshot.file_count as usize, snapshot.files.len());

        let by_path = |p: &str| snapshot.files.iter().find(|f| f.path == p).unwrap();
        assert_eq!(by_path("keep.txt").status, GitDiffFileStatus::Modified);
        assert_eq!(by_path("new.txt").status, GitDiffFileStatus::Added);
        assert_eq!(by_path("del.txt").status, GitDiffFileStatus::Deleted);
        let renamed = by_path("ren_dst.txt");
        assert_eq!(renamed.status, GitDiffFileStatus::Renamed);
        assert_eq!(renamed.old_path.as_deref(), Some("ren_src.txt"));

        // Summary totals equal the sum across files (header == body).
        let summed_added: u32 = snapshot.files.iter().map(|f| f.added).sum();
        let summed_removed: u32 = snapshot.files.iter().map(|f| f.removed).sum();
        assert_eq!(snapshot.total_added, summed_added);
        assert_eq!(snapshot.total_removed, summed_removed);
    }

    #[tokio::test]
    async fn test_build_git_diff_snapshot_clean_tree_is_empty() {
        let temp = init_diff_fixture_repo().await;
        let snapshot =
            build_git_diff_snapshot(temp.path(), "req-clean".to_string(), "ws").await;
        assert_eq!(snapshot.file_count, 0);
        assert!(snapshot.files.is_empty());
        assert_eq!(snapshot.total_added, 0);
        assert_eq!(snapshot.total_removed, 0);
    }
}
