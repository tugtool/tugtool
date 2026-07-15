//! Git status parsing + `/diff` sourcing.
//!
//! The GIT status feed (0x20) was retired when the Changeset card replaced
//! the git card ([P16]); this module keeps the shared `git status`
//! porcelain-v2 parser (now driven by `feeds/changeset.rs`) and the
//! single-shot `git diff HEAD` sourcing for the `/diff` sheet (GIT_DIFF,
//! 0x21).

use std::path::Path;

use tokio::process::Command;
use tracing::{debug, warn};

use tugcast_core::types::{
    FileStatus, GitDiffFile, GitDiffFileStatus, GitDiffSnapshot, GitLogCommit, GitLogSnapshot,
    GitStatus,
};

/// Parse git status --porcelain=v2 --branch output into GitStatus
pub(crate) fn parse_porcelain_v2(output: &str) -> GitStatus {
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
pub(crate) async fn fetch_head_message(repo_dir: &Path) -> String {
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
pub(crate) async fn fetch_git_status(repo_dir: &Path) -> Option<String> {
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
pub(crate) async fn is_within_git_worktree(dir: &Path) -> bool {
    let mut cursor = Some(dir);
    while let Some(current) = cursor {
        if tokio::fs::metadata(current.join(".git")).await.is_ok() {
            return true;
        }
        cursor = current.parent();
    }
    false
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
///
/// A non-empty `paths` narrows the diff with a `-- <paths…>` pathspec
/// (repo-relative), so the changeset card can scope the sheet to one file or
/// one changeset. An empty slice keeps the whole-tree behavior.
pub async fn build_git_diff_snapshot(
    repo_dir: &Path,
    request_id: String,
    workspace_key: &str,
    paths: &[String],
) -> GitDiffSnapshot {
    // Distinguish "not a git repo" from "clean repo" so the client can say so
    // rather than misreport a clean tree. Cheap, subprocess-free.
    if !is_within_git_worktree(repo_dir).await {
        return GitDiffSnapshot {
            request_id,
            workspace_key: workspace_key.to_string(),
            base: GIT_DIFF_BASE.to_string(),
            no_repo: true,
            file_count: 0,
            total_added: 0,
            total_removed: 0,
            files: Vec::new(),
        };
    }
    let files = match fetch_git_diff(repo_dir, paths).await {
        Some(output) => parse_git_diff(&output),
        None => Vec::new(),
    };
    let total_added = files.iter().map(|f| f.added).sum();
    let total_removed = files.iter().map(|f| f.removed).sum();
    GitDiffSnapshot {
        request_id,
        workspace_key: workspace_key.to_string(),
        base: GIT_DIFF_BASE.to_string(),
        no_repo: false,
        file_count: files.len() as u32,
        total_added,
        total_removed,
        files,
    }
}

// ---------------------------------------------------------------------------
// Recent-commits (`git log`) sourcing for the Git History Lens section.
// ---------------------------------------------------------------------------

/// The unit-separator byte git emits for `%x1f` — used to delimit the log
/// record fields. It cannot appear in an author name or a single-line subject
/// (`%s` strips newlines), so a naive per-line split is unambiguous.
const LOG_FIELD_SEP: char = '\u{1f}';

/// Assemble a single-shot [`GitLogSnapshot`] of the `limit` most-recent commits
/// in `repo_dir`.
///
/// Gated on [`is_within_git_worktree`] — a non-git dir short-circuits to
/// `no_repo: true` before any git fork. The branch comes from
/// `git branch --show-current` (empty/`None` → `"(detached)"`, which also
/// covers an unborn HEAD spelled empty). The commit body is one `%x1f`-delimited
/// record per line; a malformed line (fewer than four fields) is skipped with a
/// `warn!`. A failed `git log` — most commonly an unborn HEAD in a fresh
/// `git init` — yields empty `commits` with `no_repo: false`, mirroring how
/// [`build_git_diff_snapshot`] treats a `HEAD`-less repo as empty, not an error.
pub async fn build_git_log_snapshot(
    repo_dir: &Path,
    request_id: String,
    workspace_key: &str,
    limit: u32,
) -> GitLogSnapshot {
    if !is_within_git_worktree(repo_dir).await {
        return GitLogSnapshot {
            request_id,
            workspace_key: workspace_key.to_string(),
            branch: String::new(),
            no_repo: true,
            commits: Vec::new(),
        };
    }
    let branch = run_git_line(repo_dir, &["branch", "--show-current"])
        .await
        .unwrap_or_else(|| "(detached)".to_string());
    let limit_arg = format!("-n{limit}");
    let commits = match run_git_capture(
        repo_dir,
        &[
            "-c",
            "core.quotepath=false",
            "log",
            &limit_arg,
            "--format=%H%x1f%an%x1f%ad%x1f%s",
            "--date=short",
        ],
    )
    .await
    {
        Some(output) => parse_git_log(&output),
        None => Vec::new(),
    };
    GitLogSnapshot {
        request_id,
        workspace_key: workspace_key.to_string(),
        branch,
        no_repo: false,
        commits,
    }
}

/// Parse `%H%x1f%an%x1f%ad%x1f%s` records — one commit per line — into
/// [`GitLogCommit`]s. Lines with fewer than four fields are skipped with a
/// `warn!`.
fn parse_git_log(output: &str) -> Vec<GitLogCommit> {
    let mut commits = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.splitn(4, LOG_FIELD_SEP).collect();
        if fields.len() < 4 {
            warn!(line, "skipping malformed git log record");
            continue;
        }
        commits.push(GitLogCommit {
            sha: fields[0].to_string(),
            author: fields[1].to_string(),
            date: fields[2].to_string(),
            subject: fields[3].to_string(),
        });
    }
    commits
}

/// Assemble a single-shot [`GitDiffSnapshot`] for a **dash range** diff — the
/// "everything this dash has done past its base" view: committed rounds plus
/// uncommitted worktree dirt ([P19], #diff-descriptor-resolution).
///
/// `repo_dir` is the checkout root (the workspace); `worktree_rel` is the
/// dash worktree path relative to it (e.g. `.tug/worktrees/demo`). The diff
/// itself is resolved by [`fetch_dash_diff`]: working tree vs. merge-base when
/// the worktree exists (rounds + dirt), else committed rounds only. The
/// snapshot's `base` field carries the human-readable range `<base>...<branch>`
/// so the document header reads correctly.
pub async fn build_dash_diff_snapshot(
    repo_dir: &Path,
    request_id: String,
    workspace_key: &str,
    worktree_rel: &str,
    base: &str,
    branch: &str,
) -> GitDiffSnapshot {
    let range = format!("{base}...{branch}");
    if !is_within_git_worktree(repo_dir).await {
        return GitDiffSnapshot {
            request_id,
            workspace_key: workspace_key.to_string(),
            base: range,
            no_repo: true,
            file_count: 0,
            total_added: 0,
            total_removed: 0,
            files: Vec::new(),
        };
    }
    let files = match fetch_dash_diff(repo_dir, worktree_rel, base, branch).await {
        Some(output) => parse_git_diff(&output),
        None => Vec::new(),
    };
    let total_added = files.iter().map(|f| f.added).sum();
    let total_removed = files.iter().map(|f| f.removed).sum();
    GitDiffSnapshot {
        request_id,
        workspace_key: workspace_key.to_string(),
        base: range,
        no_repo: false,
        file_count: files.len() as u32,
        total_added,
        total_removed,
        files,
    }
}

/// Fetch a dash's "rounds + worktree dirt" diff ([P19]).
///
/// When the dash worktree exists, resolve `merge-base(<base>, <branch>)` in it
/// and diff the working tree against that base — this captures both committed
/// rounds and uncommitted dirt in one pass, while keeping upstream drift on
/// `base` out (the same committed-part semantics as `<base>...<branch>`).
/// Three-dot syntax can't include a dirty working tree, hence the two-step
/// merge-base resolution. When the worktree is absent (a dash branch without a
/// checkout), fall back to `git diff <base>...<branch>` in the repo root —
/// committed rounds only, which is then the whole truth. Returns `None` (and
/// logs) on a non-zero exit or spawn failure.
pub(crate) async fn fetch_dash_diff(
    repo_dir: &Path,
    worktree_rel: &str,
    base: &str,
    branch: &str,
) -> Option<String> {
    let worktree_abs = repo_dir.join(worktree_rel);
    if worktree_abs.is_dir() {
        let merge_base = run_git_line(&worktree_abs, &["merge-base", base, branch]).await?;
        run_git_diff_against(&worktree_abs, &merge_base).await
    } else {
        run_git_diff_against(repo_dir, &format!("{base}...{branch}")).await
    }
}

/// Run `git diff --no-color -M <target>` in `dir`, returning stdout on success.
async fn run_git_diff_against(dir: &Path, target: &str) -> Option<String> {
    let output = Command::new("git")
        .args([
            "-C",
            &dir.to_string_lossy(),
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-color",
            "-M",
            target,
        ])
        .output()
        .await;
    match output {
        Ok(o) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).into_owned()),
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            warn!(stderr = %stderr.trim_end(), target, "git diff (dash range) failed");
            None
        }
        Err(e) => {
            warn!(error = %e, "failed to execute git diff (dash range)");
            None
        }
    }
}

/// Run a git command expected to print a single line (e.g. `merge-base`,
/// `rev-parse HEAD`), returning the trimmed stdout on success, `None` otherwise.
pub(crate) async fn run_git_line(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    let output = cmd.output().await.ok()?;
    if output.status.success() {
        let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if line.is_empty() { None } else { Some(line) }
    } else {
        None
    }
}

/// Run a git command that may print many lines (e.g. `log`), returning the
/// full stdout on success, `None` (with a `warn!`) otherwise. The multi-line
/// counterpart to [`run_git_line`]; serves the `git log` body.
async fn run_git_capture(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    let output = cmd.output().await;
    match output {
        Ok(o) if o.status.success() => Some(String::from_utf8_lossy(&o.stdout).into_owned()),
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            warn!(stderr = %stderr.trim_end(), ?args, "git command failed");
            None
        }
        Err(e) => {
            warn!(error = %e, ?args, "failed to execute git command");
            None
        }
    }
}

/// Fetch the combined `git diff HEAD` output for the working tree, optionally
/// narrowed to a `-- <paths…>` pathspec. Returns `None` (and logs) on a
/// non-zero exit or spawn failure. Crate-visible: the scribe composes its
/// prompt from the same scoped diff text.
pub(crate) async fn fetch_git_diff(repo_dir: &Path, paths: &[String]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.args([
        "-C",
        &repo_dir.to_string_lossy(),
        "-c",
        "core.quotepath=false",
        "diff",
        "--no-color",
        "-M",
        GIT_DIFF_BASE,
    ]);
    if !paths.is_empty() {
        cmd.arg("--");
        cmd.args(paths);
    }
    let output = cmd.output().await;

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
    s.strip_prefix("a/")
        .or_else(|| s.strip_prefix("b/"))
        .unwrap_or(s)
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
        assert!(
            f.unified
                .starts_with("diff --git a/src/main.rs b/src/main.rs")
        );
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

        let snapshot = build_git_diff_snapshot(&repo, "req-42".to_string(), "ws-key", &[]).await;

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
    async fn test_build_git_diff_snapshot_scoped_paths_narrow_the_diff() {
        let temp = init_diff_fixture_repo().await;
        let repo = temp.path().to_path_buf();

        // Two dirty tracked files; the pathspec selects exactly one.
        fs::write(repo.join("keep.txt"), "v2\n").unwrap();
        fs::write(repo.join("ren_src.txt"), "also changed\n").unwrap();

        let scoped = build_git_diff_snapshot(
            &repo,
            "req-scoped".to_string(),
            "ws",
            &["keep.txt".to_string()],
        )
        .await;
        assert_eq!(scoped.file_count, 1, "pathspec narrows to the one file");
        assert_eq!(scoped.files[0].path, "keep.txt");

        // Totals reflect only the scoped file.
        let whole = build_git_diff_snapshot(&repo, "req-whole".to_string(), "ws", &[]).await;
        assert_eq!(whole.file_count, 2, "empty pathspec keeps the whole tree");
        assert!(scoped.total_added <= whole.total_added);
    }

    #[tokio::test]
    async fn test_build_git_diff_snapshot_clean_tree_is_empty() {
        let temp = init_diff_fixture_repo().await;
        let snapshot =
            build_git_diff_snapshot(temp.path(), "req-clean".to_string(), "ws", &[]).await;
        assert!(!snapshot.no_repo, "a real repo is not flagged no_repo");
        assert_eq!(snapshot.file_count, 0);
        assert!(snapshot.files.is_empty());
        assert_eq!(snapshot.total_added, 0);
        assert_eq!(snapshot.total_removed, 0);
    }

    #[tokio::test]
    async fn test_build_git_diff_snapshot_non_repo_flags_no_repo() {
        // A plain dir (never `git init`ed) is flagged no_repo, not "clean".
        let temp = TempDir::new().unwrap();
        let snapshot =
            build_git_diff_snapshot(temp.path(), "req-norepo".to_string(), "ws", &[]).await;
        assert!(snapshot.no_repo, "a non-git dir must set no_repo");
        assert_eq!(snapshot.file_count, 0);
        assert!(snapshot.files.is_empty());
    }

    /// A repo on `main` with a base commit, a `tugdash/demo` branch that adds
    /// `round.txt` in a checked-out worktree under `.tug/worktrees/`, tracked worktree
    /// dirt on `keep.txt`, and a later main-only commit that must stay out of
    /// the dash range (merge-base semantics).
    async fn init_dash_fixture_repo() -> (TempDir, String) {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().to_path_buf();
        git_in(&repo, &["init", "-b", "main"]).await;
        git_in(&repo, &["config", "user.name", "test"]).await;
        git_in(&repo, &["config", "user.email", "test@test.com"]).await;
        fs::write(repo.join("keep.txt"), "base\n").unwrap();
        git_in(&repo, &["add", "-A"]).await;
        git_in(&repo, &["commit", "-m", "base"]).await;

        // The dash branch + its worktree under `.tug/worktrees/`.
        git_in(&repo, &["branch", "tugdash/demo"]).await;
        git_in(&repo, &["config", "branch.tugdash/demo.tugbase", "main"]).await;
        let worktree_rel = ".tug/worktrees/demo";
        git_in(&repo, &["worktree", "add", worktree_rel, "tugdash/demo"]).await;
        let worktree_abs = repo.join(worktree_rel);

        // One committed round in the worktree: add round.txt.
        fs::write(worktree_abs.join("round.txt"), "round\n").unwrap();
        git_in(&worktree_abs, &["add", "-A"]).await;
        git_in(&worktree_abs, &["commit", "-m", "round 1"]).await;

        // Tracked worktree dirt: modify keep.txt (uncommitted).
        fs::write(worktree_abs.join("keep.txt"), "base\ndirt\n").unwrap();

        // A later commit on main only — must NOT appear in the dash range.
        fs::write(repo.join("mainonly.txt"), "upstream\n").unwrap();
        git_in(&repo, &["add", "-A"]).await;
        git_in(&repo, &["commit", "-m", "main drift"]).await;

        (temp, worktree_rel.to_string())
    }

    #[tokio::test]
    async fn test_build_dash_diff_snapshot_rounds_plus_dirt() {
        let (temp, worktree_rel) = init_dash_fixture_repo().await;
        let snapshot = build_dash_diff_snapshot(
            temp.path(),
            "req-dash".to_string(),
            "ws-key",
            &worktree_rel,
            "main",
            "tugdash/demo",
        )
        .await;

        assert!(!snapshot.no_repo);
        assert_eq!(snapshot.request_id, "req-dash");
        assert_eq!(
            snapshot.base, "main...tugdash/demo",
            "header carries the range"
        );
        let paths: Vec<&str> = snapshot.files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"round.txt"), "committed round: {paths:?}");
        assert!(paths.contains(&"keep.txt"), "worktree dirt: {paths:?}");
        assert!(
            !paths.contains(&"mainonly.txt"),
            "upstream drift on base stays out (merge-base): {paths:?}"
        );
    }

    #[tokio::test]
    async fn test_build_dash_diff_snapshot_no_worktree_falls_back_to_committed_rounds() {
        let (temp, _worktree_rel) = init_dash_fixture_repo().await;
        // A worktree path that does not exist forces the committed-only fallback.
        let snapshot = build_dash_diff_snapshot(
            temp.path(),
            "req-dash-2".to_string(),
            "ws-key",
            ".tugtree/does-not-exist",
            "main",
            "tugdash/demo",
        )
        .await;

        let paths: Vec<&str> = snapshot.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            ["round.txt"],
            "committed round only, no dirt: {paths:?}"
        );
    }

    // -- git log sourcing (Git History Lens section) --

    /// A committed repo on `main` with three commits whose subjects are, oldest
    /// to newest, `first`/`second`/`third`.
    async fn init_log_fixture_repo() -> TempDir {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().to_path_buf();
        git_in(&repo, &["init", "-b", "main"]).await;
        git_in(&repo, &["config", "user.name", "Test Author"]).await;
        git_in(&repo, &["config", "user.email", "test@test.com"]).await;
        for subject in ["first", "second", "third"] {
            fs::write(repo.join(format!("{subject}.txt")), "x\n").unwrap();
            git_in(&repo, &["add", "-A"]).await;
            git_in(&repo, &["commit", "-m", subject]).await;
        }
        temp
    }

    #[tokio::test]
    async fn test_build_git_log_snapshot_recent_commits_most_recent_first() {
        let temp = init_log_fixture_repo().await;
        let snapshot =
            build_git_log_snapshot(temp.path(), "gl-1".to_string(), "ws-key", 20).await;

        assert!(!snapshot.no_repo);
        assert_eq!(snapshot.request_id, "gl-1");
        assert_eq!(snapshot.workspace_key, "ws-key");
        assert_eq!(snapshot.branch, "main");
        let subjects: Vec<&str> = snapshot.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["third", "second", "first"], "most-recent-first");

        let head = &snapshot.commits[0];
        assert_eq!(head.sha.len(), 40, "full 40-char sha on the wire");
        assert!(head.sha.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(head.author, "Test Author");
        // `--date=short` → fixed-width YYYY-MM-DD.
        assert_eq!(head.date.len(), 10);
        assert_eq!(head.date.as_bytes()[4], b'-');
        assert_eq!(head.date.as_bytes()[7], b'-');
    }

    #[tokio::test]
    async fn test_build_git_log_snapshot_honors_limit() {
        let temp = init_log_fixture_repo().await;
        let snapshot = build_git_log_snapshot(temp.path(), "gl-2".to_string(), "ws", 2).await;
        let subjects: Vec<&str> = snapshot.commits.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["third", "second"], "the newest two only");
    }

    #[tokio::test]
    async fn test_build_git_log_snapshot_empty_repo_is_not_no_repo() {
        // Fresh `git init` (unborn HEAD): a real repo with no commits.
        let temp = TempDir::new().unwrap();
        git_in(temp.path(), &["init", "-b", "trunk"]).await;
        let snapshot =
            build_git_log_snapshot(temp.path(), "gl-3".to_string(), "ws", 20).await;
        assert!(!snapshot.no_repo, "an initialized repo is not flagged no_repo");
        assert!(snapshot.commits.is_empty(), "no commits yet");
        assert_eq!(snapshot.branch, "trunk", "unborn branch name still resolves");
    }

    #[tokio::test]
    async fn test_build_git_log_snapshot_non_repo_flags_no_repo() {
        let temp = TempDir::new().unwrap();
        let snapshot =
            build_git_log_snapshot(temp.path(), "gl-4".to_string(), "ws", 20).await;
        assert!(snapshot.no_repo);
        assert!(snapshot.commits.is_empty());
        assert_eq!(snapshot.branch, "");
    }

    #[tokio::test]
    async fn test_build_git_log_snapshot_detached_head() {
        let temp = init_log_fixture_repo().await;
        let repo = temp.path();
        let head = run_git_line(repo, &["rev-parse", "HEAD"]).await.unwrap();
        git_in(repo, &["checkout", &head]).await;
        let snapshot = build_git_log_snapshot(repo, "gl-5".to_string(), "ws", 20).await;
        assert_eq!(snapshot.branch, "(detached)");
        assert_eq!(snapshot.commits.len(), 3, "commits still resolve when detached");
    }

    #[tokio::test]
    async fn test_build_git_log_snapshot_unicode_author_and_empty_subject() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path().to_path_buf();
        git_in(&repo, &["init", "-b", "main"]).await;
        git_in(&repo, &["config", "user.email", "u@x.com"]).await;
        // A unicode author name and an empty subject must parse without a
        // column shift (the `%x1f` separator keeps fields aligned).
        fs::write(repo.join("a.txt"), "x\n").unwrap();
        git_in(&repo, &["add", "-A"]).await;
        git_in(
            &repo,
            &[
                "-c",
                "user.name=Ünïcode Nàme",
                "commit",
                "--allow-empty-message",
                "-m",
                "",
            ],
        )
        .await;

        let snapshot = build_git_log_snapshot(&repo, "gl-6".to_string(), "ws", 20).await;
        assert_eq!(snapshot.commits.len(), 1);
        assert_eq!(snapshot.commits[0].author, "Ünïcode Nàme");
        assert_eq!(snapshot.commits[0].subject, "", "empty subject stays empty");
        assert_eq!(snapshot.commits[0].sha.len(), 40);
    }
}
