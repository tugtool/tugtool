//! Git feed implementation
//!
//! Polls git repository status and broadcasts GitStatus snapshots when changes are detected.

use std::path::{Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;
use tokio::process::Command;
use tokio::sync::watch;
use tokio::time;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

use tugcast_core::types::{FileStatus, GitStatus};
use tugcast_core::{FeedId, Frame, SnapshotFeed};

/// Polling interval for git status
const POLL_INTERVAL_SECS: u64 = 2;

/// Git feed that polls repository status at fixed intervals
pub struct GitFeed {
    repo_dir: PathBuf,
}

impl GitFeed {
    /// Create a new git feed watching the given repository directory
    pub fn new(repo_dir: PathBuf) -> Self {
        Self { repo_dir }
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
            let stderr = String::from_utf8_lossy(&o.stderr);
            warn!(stderr = %stderr, "git status command failed");
            None
        }
        Err(e) => {
            warn!(error = %e, "failed to execute git status");
            None
        }
    }
}

#[async_trait]
impl SnapshotFeed for GitFeed {
    fn feed_id(&self) -> FeedId {
        FeedId::Git
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
                        let frame = Frame::new(FeedId::Git, json);
                        let _ = tx.send(frame);
                        debug!(branch = %status.branch, "git status updated");
                        previous = Some(status);
                    }
                }
            }
        }
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
        let feed = GitFeed::new(PathBuf::from("/tmp/repo"));
        assert_eq!(feed.feed_id(), FeedId::Git);
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

        // Create git feed
        let feed = GitFeed::new(repo_path.clone());

        // Create watch channel
        let (tx, mut rx) = watch::channel(Frame::new(FeedId::Git, vec![]));

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
        assert_eq!(frame.feed_id, FeedId::Git);

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
}
