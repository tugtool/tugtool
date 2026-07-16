//! The `commit` operation — stage → commit → structured receipt ([P04]/[P05]).
//!
//! With no `--paths`, `commit` commits exactly the session's **non-ambiguous**
//! changed files (the `changes` set); `--paths` overrides with an explicit list;
//! `--all` includes ambiguous files too. Staging is by construction:
//! `git add -- <files>` then `git commit -m <message> -- <files>` — never
//! `git add .` — so anything else already in the index stays out of the commit,
//! and the receipt can't disagree with what was staged. The result is a
//! structured [`CommitReceipt`] (Spec S03), not scraped text, with a raw
//! `numstat` field retained as the transition bridge ([Q01]).

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::changes::{ChangesOptions, resolve_changes};
use crate::git::{self, FileStat, repo_root_for};

/// Options for [`commit`]. `message` is required. Without `paths`, the file set
/// is the session's non-ambiguous changes; `all` includes ambiguous files;
/// `paths` overrides with an explicit list.
#[derive(Debug, Clone, Default)]
pub struct CommitOptions {
    pub session: Option<String>,
    pub project: Option<PathBuf>,
    pub message: String,
    pub paths: Option<Vec<String>>,
    pub all: bool,
}

/// Roll-up totals across the committed files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Aggregate {
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

/// The structured commit receipt (Spec S03). `numstat` is the raw
/// `git show --numstat --format= HEAD` text, kept as the compatibility bridge
/// until the deck consumes `files` directly ([Q01]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitReceipt {
    pub sha: String,
    pub branch: String,
    pub message: String,
    pub files: Vec<FileStat>,
    pub aggregate: Aggregate,
    pub numstat: String,
}

/// Run the `commit` operation (Spec S03). Refuses an empty file set and a blank
/// message; errors carry git's stderr so the caller can surface the real reason.
pub fn commit(opts: CommitOptions) -> Result<CommitReceipt, String> {
    if opts.message.trim().is_empty() {
        return Err("empty commit message".to_string());
    }

    let (repo_root, files) = derive_file_set(&opts)?;
    if files.is_empty() {
        return Err("no files selected".to_string());
    }

    stage_and_commit(&repo_root, &files, &opts.message)?;
    build_receipt(&repo_root, &opts.message)
}

/// Resolve the repo root and the repo-relative file set to commit. `--paths`
/// wins; otherwise the session's changed files, keeping ambiguous ones only
/// with `--all`.
fn derive_file_set(opts: &CommitOptions) -> Result<(PathBuf, Vec<String>), String> {
    if let Some(paths) = &opts.paths {
        let project_dir = match &opts.project {
            Some(p) => p.clone(),
            None => std::env::current_dir().map_err(|e| format!("cannot resolve cwd: {e}"))?,
        };
        return Ok((repo_root_for(&project_dir), paths.clone()));
    }

    let resolved = resolve_changes(&ChangesOptions {
        session: opts.session.clone(),
        project: opts.project.clone(),
        all: false,
        diff: false,
    })
    .map_err(|e| e.to_string())?;

    let files: Vec<String> = resolved
        .files
        .iter()
        .filter(|f| opts.all || !f.ambiguous)
        .map(|f| f.path.clone())
        .collect();
    Ok((resolved.repo_root, files))
}

/// Stage exactly `files` and commit exactly them: `git add -- <files>` then
/// `git commit -m <message> -- <files>`. The `-- <files>` pathspec on both keeps
/// anything else already in the index out of the commit.
fn stage_and_commit(repo_root: &Path, files: &[String], message: &str) -> Result<(), String> {
    let mut add_args: Vec<&str> = vec!["add", "--"];
    add_args.extend(files.iter().map(String::as_str));
    run_git_step(repo_root, &add_args, "git add failed")?;

    let mut commit_args: Vec<&str> = vec!["commit", "-m", message, "--"];
    commit_args.extend(files.iter().map(String::as_str));
    run_git_step(repo_root, &commit_args, "git commit failed")?;
    Ok(())
}

/// Run one git step, mapping a non-zero exit to its stderr detail (or `fallback`
/// when stderr is empty).
fn run_git_step(repo_root: &Path, args: &[&str], fallback: &str) -> Result<(), String> {
    let output = git::git_output(repo_root, args)?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if detail.is_empty() {
        fallback.to_string()
    } else {
        detail
    })
}

/// Assemble the [`CommitReceipt`] for the just-made HEAD commit: sha, branch,
/// the raw `--numstat` text plus its parsed `files` (statuses joined from
/// `--name-status`), and aggregate totals.
fn build_receipt(repo_root: &Path, message: &str) -> Result<CommitReceipt, String> {
    let sha = git::git_stdout(repo_root, &["rev-parse", "HEAD"])?
        .trim()
        .to_string();
    let branch = git::git_stdout(repo_root, &["branch", "--show-current"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let numstat = git::git_stdout(repo_root, &["show", "--numstat", "--format=", "HEAD"])?;
    let name_status = git::git_stdout(repo_root, &["show", "--name-status", "--format=", "HEAD"])?;

    let files = git::file_stats(&numstat, &name_status);
    let insertions: u32 = files.iter().map(|f| f.added.unwrap_or(0)).sum();
    let deletions: u32 = files.iter().map(|f| f.deleted.unwrap_or(0)).sum();
    let aggregate = Aggregate {
        files_changed: files.len() as u32,
        insertions,
        deletions,
    };

    Ok(CommitReceipt {
        sha,
        branch,
        message: message.to_string(),
        files,
        aggregate,
        numstat,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(root: &Path, args: &[&str]) {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(root)
                .output()
                .expect("git")
                .status
                .success(),
            "git {args:?}"
        );
    }

    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        git(root, &["init", "-q", "-b", "main"]);
        git(root, &["config", "user.email", "t@t.test"]);
        git(root, &["config", "user.name", "t"]);
        std::fs::write(root.join("base.txt"), "base\n").unwrap();
        git(root, &["add", "base.txt"]);
        git(root, &["commit", "-q", "-m", "init"]);
        dir
    }

    #[test]
    fn commits_only_listed_files_and_receipt_matches_numstat() {
        let repo = init_repo();
        let root = repo.path();
        // Two edited files plus a third dirty file that must stay out.
        std::fs::write(root.join("a.txt"), "a1\na2\n").unwrap();
        std::fs::write(root.join("b.txt"), "b1\n").unwrap();
        std::fs::write(root.join("c.txt"), "c-untouched\n").unwrap();

        let opts = CommitOptions {
            project: Some(root.to_path_buf()),
            message: "commit a and b".to_string(),
            paths: Some(vec!["a.txt".to_string(), "b.txt".to_string()]),
            ..Default::default()
        };
        let receipt = commit(opts).expect("commit succeeds");

        assert_eq!(receipt.sha.len(), 40);
        assert_eq!(receipt.branch, "main");
        assert_eq!(receipt.message, "commit a and b");

        // Receipt files match `git show --numstat` — a.txt (created, 2 added)
        // and b.txt (created, 1 added).
        let by_path = |p: &str| receipt.files.iter().find(|f| f.path == p).unwrap();
        assert_eq!(receipt.files.len(), 2);
        assert_eq!(by_path("a.txt").status, "created");
        assert_eq!(by_path("a.txt").added, Some(2));
        assert_eq!(by_path("b.txt").added, Some(1));
        assert_eq!(receipt.aggregate.files_changed, 2);
        assert_eq!(receipt.aggregate.insertions, 3);

        // The numstat text lists exactly the two committed files.
        let numstat_paths: Vec<&str> = receipt
            .numstat
            .lines()
            .filter_map(|l| l.split('\t').nth(2))
            .collect();
        assert_eq!(numstat_paths, ["a.txt", "b.txt"]);

        // c.txt stayed untracked (out of the commit).
        let status = git::git_stdout(root, &["status", "--porcelain"]).unwrap();
        assert!(status.contains("?? c.txt"), "c.txt untouched: {status}");
    }

    #[test]
    fn empty_message_and_empty_file_set_each_error() {
        let repo = init_repo();
        let root = repo.path();

        // Blank message.
        let err = commit(CommitOptions {
            project: Some(root.to_path_buf()),
            message: "   ".to_string(),
            paths: Some(vec!["base.txt".to_string()]),
            ..Default::default()
        })
        .unwrap_err();
        assert!(err.contains("empty commit message"), "{err}");

        // Empty explicit file set.
        let err = commit(CommitOptions {
            project: Some(root.to_path_buf()),
            message: "x".to_string(),
            paths: Some(vec![]),
            ..Default::default()
        })
        .unwrap_err();
        assert!(err.contains("no files selected"), "{err}");
    }

    #[test]
    fn modified_and_deleted_statuses_land_in_receipt() {
        let repo = init_repo();
        let root = repo.path();
        std::fs::write(root.join("base.txt"), "base\nmore\n").unwrap();
        std::fs::write(root.join("gone.txt"), "temp\n").unwrap();
        git(root, &["add", "gone.txt"]);
        git(root, &["commit", "-q", "-m", "add gone"]);
        std::fs::remove_file(root.join("gone.txt")).unwrap();

        let receipt = commit(CommitOptions {
            project: Some(root.to_path_buf()),
            message: "modify base, delete gone".to_string(),
            paths: Some(vec!["base.txt".to_string(), "gone.txt".to_string()]),
            ..Default::default()
        })
        .expect("commit");

        let by_path = |p: &str| receipt.files.iter().find(|f| f.path == p).unwrap();
        assert_eq!(by_path("base.txt").status, "modified");
        assert_eq!(by_path("gone.txt").status, "deleted");
        assert_eq!(by_path("gone.txt").added, Some(0));
        assert_eq!(by_path("gone.txt").deleted, Some(1));
    }

    #[test]
    fn error_carries_git_stderr() {
        let repo = init_repo();
        let root = repo.path();
        let err = commit(CommitOptions {
            project: Some(root.to_path_buf()),
            message: "msg".to_string(),
            paths: Some(vec!["no-such-file.txt".to_string()]),
            ..Default::default()
        })
        .unwrap_err();
        assert!(err.contains("no-such-file.txt"), "stderr detail: {err}");
    }
}
