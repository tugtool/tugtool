//! The `commit` operation — stage → commit → structured receipt ([P04]/[P05]).
//!
//! `commit` can no longer silently narrow the working tree ([P03]). With no
//! explicit disposition, a dirty tree carrying **unattributed** files (dirty,
//! no ledger rows anywhere — [P01]) is a refusal: [`commit`] returns
//! [`CommitError::UnattributedPresent`] and commits nothing. The disposition
//! flags on [`CommitOptions`] resolve it (Table T01): `include_unattributed`
//! folds them in, `leave_unattributed` proceeds without them (the receipt's
//! `left_behind` then names them), `tree` commits the whole dirty tree except
//! foreign-claimed paths, and `paths` overrides everything with an explicit set
//! (the Session card's commit button takes this path, so it never hits the
//! refusal). `all` adds shared files (paths other sessions also hold live
//! rows for) to the non-`--tree` sets.
//!
//! Staging is by construction: `git add -- <files>` then
//! `git commit -m <message> -- <files>` — never `git add .` — so anything else
//! already in the index stays out of the commit, and the receipt can't disagree
//! with what was staged. The result is a structured [`CommitReceipt`] (Spec S03),
//! not scraped text, with a raw `numstat` field retained as the transition
//! bridge ([Q01]) and a `left_behind` bucket list (Spec S04).

use std::fmt;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::changes::{ChangesOptions, resolve_changes};
use crate::git::{self, FileStat, repo_root_for};

/// Options for [`commit`]. `message` is required. Disposition precedence
/// ([P04], Table T01): `paths` > `tree` > (`include_unattributed` /
/// `leave_unattributed` / `all`). Without `paths` or `tree`, the base set is the
/// session's non-shared attributed changes; `all` adds shared ones;
/// `include_unattributed` adds unattributed ones; `leave_unattributed`
/// acknowledges unattributed files and proceeds without them.
#[derive(Debug, Clone, Default)]
pub struct CommitOptions {
    pub session: Option<String>,
    pub project: Option<PathBuf>,
    pub message: String,
    pub paths: Option<Vec<String>>,
    pub all: bool,
    pub include_unattributed: bool,
    pub leave_unattributed: bool,
    pub tree: bool,
}

/// The typed outcome of a failed [`commit`] (Spec S03). `UnattributedPresent` is
/// the [P03] refusal the CLI maps to **exit 3** — distinct from a real error
/// (exit 1) and session resolution (exit 2) — so a caller can branch on it
/// without sniffing strings. `Other` is every real error (git/sqlite/io/blank
/// message).
#[derive(Debug, Clone)]
pub enum CommitError {
    /// Unattributed dirty files were present with no explicit disposition —
    /// nothing was committed. Carries the offending repo-relative paths.
    UnattributedPresent { paths: Vec<String> },
    /// A real error (git/sqlite/io/blank message) — exit 1.
    Other(String),
}

impl CommitError {
    /// Whether this is the [P03] refusal (exit 3) rather than a real error.
    pub fn is_refusal(&self) -> bool {
        matches!(self, CommitError::UnattributedPresent { .. })
    }
}

impl fmt::Display for CommitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CommitError::UnattributedPresent { paths } => write!(
                f,
                "{} unattributed dirty file(s) present with no disposition: {}",
                paths.len(),
                paths.join(", ")
            ),
            CommitError::Other(msg) => write!(f, "{msg}"),
        }
    }
}

impl From<String> for CommitError {
    fn from(msg: String) -> Self {
        CommitError::Other(msg)
    }
}

/// Roll-up totals across the committed files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Aggregate {
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

/// Still-dirty files per bucket after the commit lands (Spec S04). Empty vectors
/// when the tree is clean. A partial commit is visible here immediately.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct LeftBehind {
    pub unattributed: Vec<String>,
    pub foreign: Vec<String>,
    pub shared: Vec<String>,
}

/// The structured commit receipt (Spec S03). `numstat` is the raw
/// `git show --numstat --format= HEAD` text, kept as the compatibility bridge
/// until the deck consumes `files` directly ([Q01]). `left_behind` names the
/// still-dirty files per bucket after the commit (Spec S04).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitReceipt {
    pub sha: String,
    pub branch: String,
    pub message: String,
    pub files: Vec<FileStat>,
    pub aggregate: Aggregate,
    pub numstat: String,
    pub left_behind: LeftBehind,
}

/// Run the `commit` operation (Spec S03). Refuses unattributed files with no
/// disposition ([P03] — [`CommitError::UnattributedPresent`], nothing
/// committed), an empty file set, and a blank message; other errors carry git's
/// stderr so the caller can surface the real reason.
pub fn commit(opts: CommitOptions) -> Result<CommitReceipt, CommitError> {
    if opts.message.trim().is_empty() {
        return Err(CommitError::Other("empty commit message".to_string()));
    }

    let (repo_root, files) = derive_file_set(&opts)?;
    if files.is_empty() {
        return Err(CommitError::Other("no files selected".to_string()));
    }

    stage_and_commit(&repo_root, &files, &opts.message).map_err(CommitError::Other)?;
    let mut receipt = build_receipt(&repo_root, &opts.message).map_err(CommitError::Other)?;
    receipt.left_behind = compute_left_behind(&opts);
    Ok(receipt)
}

/// Resolve the repo root and the repo-relative file set to commit, per the
/// disposition matrix (Table T01). `paths` wins outright (bypasses bucketing).
/// `tree` commits everything dirty but foreign. Otherwise the base is the
/// session's non-shared attributed files (`all` adds shared);
/// `include_unattributed` folds unattributed in, and if unattributed files are
/// present with neither `include_unattributed` nor `leave_unattributed`, refuse
/// ([P03]) — even when the attributed set is empty.
fn derive_file_set(opts: &CommitOptions) -> Result<(PathBuf, Vec<String>), CommitError> {
    if let Some(paths) = &opts.paths {
        let project_dir = match &opts.project {
            Some(p) => p.clone(),
            None => std::env::current_dir()
                .map_err(|e| CommitError::Other(format!("cannot resolve cwd: {e}")))?,
        };
        return Ok((repo_root_for(&project_dir), paths.clone()));
    }

    let resolved = resolve_changes(&ChangesOptions {
        session: opts.session.clone(),
        project: opts.project.clone(),
        all: false,
        diff: false,
    })
    .map_err(|e| CommitError::Other(e.to_string()))?;

    let attributed: Vec<(String, bool)> = resolved
        .files
        .iter()
        .map(|f| (f.path.clone(), f.shared))
        .collect();
    let unattributed: Vec<String> = resolved
        .unattributed
        .iter()
        .map(|c| c.path.clone())
        .collect();

    let files = select_from_buckets(&attributed, &unattributed, opts)?;
    Ok((resolved.repo_root, files))
}

/// Apply the disposition matrix (Table T01) to already-classified buckets —
/// pure flag precedence, no git or ledger. `attributed` pairs each path with its
/// `shared` bit; `foreign` is never passed (never committed except via
/// explicit `--paths`, handled upstream). `--tree` takes the whole dirty set
/// (attributed ∪ unattributed ∪ shared); otherwise the base is non-shared
/// attributed (`all` adds shared), `include_unattributed` folds unattributed
/// in, and unattributed present with neither `include_unattributed` nor
/// `leave_unattributed` is the [P03] refusal — even when the base set is empty.
fn select_from_buckets(
    attributed: &[(String, bool)],
    unattributed: &[String],
    opts: &CommitOptions,
) -> Result<Vec<String>, CommitError> {
    if opts.tree {
        let mut files: Vec<String> = attributed.iter().map(|(p, _)| p.clone()).collect();
        files.extend(unattributed.iter().cloned());
        return Ok(files);
    }

    let mut files: Vec<String> = attributed
        .iter()
        .filter(|(_, shared)| opts.all || !shared)
        .map(|(p, _)| p.clone())
        .collect();

    if opts.include_unattributed {
        files.extend(unattributed.iter().cloned());
    } else if !unattributed.is_empty() && !opts.leave_unattributed {
        return Err(CommitError::UnattributedPresent {
            paths: unattributed.to_vec(),
        });
    }

    Ok(files)
}

/// Re-run the [P02] bucketing after the commit and list every still-dirty path
/// per bucket (Spec S04). Best-effort: if the session can't be resolved (a
/// `--paths` commit with no session, as the Session card issues), the buckets
/// are all empty rather than an error.
fn compute_left_behind(opts: &CommitOptions) -> LeftBehind {
    match resolve_changes(&ChangesOptions {
        session: opts.session.clone(),
        project: opts.project.clone(),
        all: false,
        diff: false,
    }) {
        Ok(resolved) => LeftBehind {
            unattributed: resolved
                .unattributed
                .iter()
                .map(|c| c.path.clone())
                .collect(),
            foreign: resolved.foreign.iter().map(|f| f.path.clone()).collect(),
            shared: resolved
                .files
                .iter()
                .filter(|f| f.shared)
                .map(|f| f.path.clone())
                .collect(),
        },
        Err(_) => LeftBehind::default(),
    }
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
        // Filled by `commit` after the bucketing re-run (Spec S04).
        left_behind: LeftBehind::default(),
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
        assert!(err.to_string().contains("empty commit message"), "{err}");

        // Empty explicit file set.
        let err = commit(CommitOptions {
            project: Some(root.to_path_buf()),
            message: "x".to_string(),
            paths: Some(vec![]),
            ..Default::default()
        })
        .unwrap_err();
        assert!(err.to_string().contains("no files selected"), "{err}");
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
        assert!(
            err.to_string().contains("no-such-file.txt"),
            "stderr detail: {err}"
        );
    }

    // --- Table T01 disposition matrix (pure `select_from_buckets`) ------------
    // These cover every flag row without a git/ledger round-trip; the CLI
    // integration suite (`changes_cli.rs`) proves the exit codes end-to-end.

    fn attributed(paths: &[(&str, bool)]) -> Vec<(String, bool)> {
        paths.iter().map(|(p, a)| (p.to_string(), *a)).collect()
    }

    fn opts_with(f: impl FnOnce(&mut CommitOptions)) -> CommitOptions {
        let mut o = CommitOptions {
            message: "m".to_string(),
            ..Default::default()
        };
        f(&mut o);
        o
    }

    #[test]
    fn default_refuses_when_unattributed_present_even_with_empty_base() {
        let att = attributed(&[]);
        let un = vec!["u1.rs".to_string(), "u2.rs".to_string()];
        let err = select_from_buckets(&att, &un, &opts_with(|_| {})).unwrap_err();
        match err {
            CommitError::UnattributedPresent { paths } => {
                assert_eq!(paths, vec!["u1.rs".to_string(), "u2.rs".to_string()]);
            }
            other => panic!("expected refusal, got {other}"),
        }
    }

    #[test]
    fn default_commits_attributed_non_shared_when_no_unattributed() {
        let att = attributed(&[("a.rs", false), ("shared.rs", true)]);
        let files = select_from_buckets(&att, &[], &opts_with(|_| {})).unwrap();
        assert_eq!(files, vec!["a.rs".to_string()]);
    }

    #[test]
    fn all_adds_shared_to_the_base() {
        let att = attributed(&[("a.rs", false), ("shared.rs", true)]);
        let files = select_from_buckets(&att, &[], &opts_with(|o| o.all = true)).unwrap();
        assert_eq!(files, vec!["a.rs".to_string(), "shared.rs".to_string()]);
    }

    #[test]
    fn include_unattributed_folds_them_in() {
        let att = attributed(&[("a.rs", false)]);
        let un = vec!["u.rs".to_string()];
        let files =
            select_from_buckets(&att, &un, &opts_with(|o| o.include_unattributed = true)).unwrap();
        assert_eq!(files, vec!["a.rs".to_string(), "u.rs".to_string()]);
    }

    #[test]
    fn leave_unattributed_proceeds_without_them() {
        let att = attributed(&[("a.rs", false)]);
        let un = vec!["u.rs".to_string()];
        let files =
            select_from_buckets(&att, &un, &opts_with(|o| o.leave_unattributed = true)).unwrap();
        // Attributed only — the held-back file surfaces later in `left_behind`.
        assert_eq!(files, vec!["a.rs".to_string()]);
    }

    #[test]
    fn tree_takes_the_whole_dirty_set_including_shared() {
        let att = attributed(&[("a.rs", false), ("shared.rs", true)]);
        let un = vec!["u.rs".to_string()];
        let files = select_from_buckets(&att, &un, &opts_with(|o| o.tree = true)).unwrap();
        assert_eq!(
            files,
            vec![
                "a.rs".to_string(),
                "shared.rs".to_string(),
                "u.rs".to_string()
            ]
        );
    }

    #[test]
    fn tree_and_paths_dispositions_land_a_real_commit() {
        // End-to-end through git (no ledger): `--paths` commits exactly its set,
        // and the receipt now carries an (empty, no-session) `left_behind`.
        let repo = init_repo();
        let root = repo.path();
        std::fs::write(root.join("x.txt"), "x\n").unwrap();
        let receipt = commit(CommitOptions {
            project: Some(root.to_path_buf()),
            message: "add x".to_string(),
            paths: Some(vec!["x.txt".to_string()]),
            ..Default::default()
        })
        .expect("commit");
        assert_eq!(receipt.files.len(), 1);
        assert_eq!(receipt.left_behind, LeftBehind::default());
    }
}
