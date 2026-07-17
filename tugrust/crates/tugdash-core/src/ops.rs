//! Dash orchestration — the `tugdash` library API.
//!
//! Lightweight, worktree-isolated work units driven entirely on git: a dash
//! *is* a branch (`tugdash/<name>`) plus a worktree
//! (`.tug/worktrees/<name>`; legacy dashes at `.tugtree/tugdash__<name>` migrate
//! on first touch). Its base branch and description live in git
//! config (`branch.tugdash/<name>.{tugbase,description}`); its activity is
//! recorded in the per-project append-only dash-log. There is no database.
//!
//! Each verb (`create` / `commit` / `join` / `release` / `list` / `show`)
//! returns a typed outcome and never prints — the `tugdash` CLI (and the
//! Changeset card, via tugcast) own presentation. Repo resolution is
//! cwd-relative (`find_repo_root`), matching `git`'s own behaviour.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tugutil_core::paths::project_state_dir;
use tugutil_core::{Config, find_repo_root, sanitize_branch_name};

use crate::dash::{DashRoundMeta, append_dash_log, detect_default_branch, validate_dash_name};

/// Outcome of [`create`].
#[derive(Debug, Clone, Serialize)]
pub struct CreateOutcome {
    pub name: String,
    pub description: Option<String>,
    pub branch: String,
    pub worktree: String,
    pub base_branch: String,
    pub status: String,
    pub created: bool,
}

/// One entry in the [`list`] outcome.
#[derive(Debug, Clone, Serialize)]
pub struct DashListItem {
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub round_count: i64,
    pub worktree: Option<String>,
    pub base_branch: String,
}

/// Outcome of [`show`].
#[derive(Debug, Clone, Serialize)]
pub struct ShowOutcome {
    pub name: String,
    pub description: Option<String>,
    pub branch: String,
    pub worktree: String,
    pub base_branch: String,
    pub status: String,
    pub rounds: Vec<RoundItem>,
    pub uncommitted_changes: Option<bool>,
}

/// One round (commit ahead of base) in the [`show`] outcome.
#[derive(Debug, Clone, Serialize)]
pub struct RoundItem {
    pub commit_hash: String,
    pub summary: String,
    pub started_at: String,
}

/// Outcome of [`commit`].
#[derive(Debug, Clone, Serialize)]
pub struct CommitOutcome {
    pub committed: bool,
    pub commit_hash: Option<String>,
}

/// How [`join`] integrates a dash into its base branch ([P14]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum JoinStrategy {
    /// One squash commit on the base (default — preserves today's behaviour).
    #[default]
    Squash,
    /// A `--no-ff` merge commit, preserving the dash's individual rounds.
    Merge,
    /// Replay the dash's commits onto the base (fast-forward when possible,
    /// else cherry-pick the range) for a linear history.
    Rebase,
}

impl JoinStrategy {
    fn as_str(self) -> &'static str {
        match self {
            JoinStrategy::Squash => "squash",
            JoinStrategy::Merge => "merge",
            JoinStrategy::Rebase => "rebase",
        }
    }
}

/// Options for [`join`] ([P14]).
#[derive(Debug, Clone, Default)]
pub struct JoinOptions {
    /// Integration strategy (default squash).
    pub strategy: JoinStrategy,
    /// Custom commit message; overrides the maintained draft / description.
    pub message: Option<String>,
    /// Report conflicts in-memory via `git merge-tree`, touching nothing.
    pub preview: bool,
    /// Resume an interrupted join's teardown from the journal.
    pub continue_join: bool,
    /// Land a pre-built candidate commit from the resolution ladder ([P31])
    /// instead of integrating per `strategy`: fast-forward the base onto it
    /// (staleness-guarded), then run the normal journaled teardown.
    pub candidate: Option<String>,
}

/// Outcome of [`join`].
#[derive(Debug, Clone, Serialize)]
pub struct JoinOutcome {
    pub name: String,
    pub base_branch: String,
    /// The strategy used (or previewed).
    pub strategy: String,
    /// The squash/merge/replay commit on the base — `None` for a preview or a
    /// conflict-aborted join.
    pub commit_hash: Option<String>,
    /// Conflicted paths — non-empty for a conflicting preview, or a real join
    /// that hit conflicts and cleanly aborted.
    pub conflicts: Vec<String>,
    /// Whether this was a `--preview` (nothing was mutated).
    pub previewed: bool,
    pub warnings: Vec<String>,
}

/// Outcome of [`release`].
#[derive(Debug, Clone, Serialize)]
pub struct ReleaseOutcome {
    pub name: String,
    pub warnings: Vec<String>,
}

// --- git helpers -----------------------------------------------------------

/// Run a git command in `dir`, returning its raw output.
pub(crate) fn git_output(dir: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git {}: {}", args.join(" "), e))
}

/// Run a git command in `dir`, returning trimmed stdout on success.
pub(crate) fn git_stdout(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = git_output(dir, args)?;
    if !out.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Read a single git config value, if present and non-empty.
pub(crate) fn config_get(repo: &Path, key: &str) -> Option<String> {
    let out = git_output(repo, &["config", "--get", key]).ok()?;
    if !out.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

pub(crate) fn branch_name(name: &str) -> String {
    format!("tugdash/{}", name)
}

/// The current worktree home: `<repo>/.tug/worktrees/<sanitized-name>` ([P13]).
fn new_worktree_path(repo: &Path, name: &str) -> PathBuf {
    repo.join(".tug")
        .join("worktrees")
        .join(sanitize_branch_name(name))
}

/// The pre-migration worktree home: `<repo>/.tugtree/tugdash__<sanitized-name>`.
/// Still operated against for a dash that hasn't (or can't) migrate yet.
fn old_worktree_path(repo: &Path, name: &str) -> PathBuf {
    repo.join(".tugtree")
        .join(format!("tugdash__{}", sanitize_branch_name(name)))
}

/// The effective worktree path for a dash: the new `.tug/worktrees/` home when
/// it exists (created there, or migrated), else the legacy `.tugtree/` path when
/// that still holds it, else the new home (the creation target). So every verb
/// operates on wherever the worktree actually is, migrated or not.
pub(crate) fn worktree_path(repo: &Path, name: &str) -> PathBuf {
    let new = new_worktree_path(repo, name);
    if new.exists() {
        return new;
    }
    let old = old_worktree_path(repo, name);
    if old.exists() {
        return old;
    }
    new
}

/// Migrate legacy `.tugtree/` worktrees to `.tug/worktrees/` ([P13], Risk table).
///
/// Runs at the top of every verb. For each `tugdash/*` branch whose worktree
/// still sits under `.tugtree/` (and isn't already at the new home),
/// `git worktree move`s it when it is SAFE — the worktree is clean and no live
/// instance's app is holding it (a `git worktree move` while an app runs from
/// the dir would strand the app's cwd). Otherwise it warns once and leaves the
/// worktree where it is; the effective `worktree_path` keeps operating on the
/// old location. Best-effort: any git failure is a warning, never fatal.
fn migrate_worktrees(repo: &Path, warnings: &mut Vec<String>) {
    let Ok(branches) = git_stdout(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/tugdash/",
        ],
    ) else {
        return;
    };

    for branch in branches.lines().filter(|l| !l.trim().is_empty()) {
        let name = branch.trim_start_matches("tugdash/");
        let old = old_worktree_path(repo, name);
        let new = new_worktree_path(repo, name);
        if !old.exists() || new.exists() {
            continue;
        }

        // Gate 1: only a clean worktree migrates — uncommitted work stays put.
        let dirty = git_stdout(&old, &["status", "--porcelain"])
            .map(|s| !s.is_empty())
            .unwrap_or(true);
        if dirty {
            warnings.push(format!(
                "dash '{}': worktree has uncommitted changes; left at .tugtree (not migrated to .tug/worktrees)",
                name
            ));
            continue;
        }

        // Gate 2: no live instance app holding the dir (reap-slug identity math).
        if dash_instance_live(branch) {
            warnings.push(format!(
                "dash '{}': a live instance holds the worktree; left at .tugtree (not migrated)",
                name
            ));
            continue;
        }

        if let Some(parent) = new.parent() {
            if std::fs::create_dir_all(parent).is_err() {
                continue;
            }
        }
        let moved = git_output(
            repo,
            &[
                "worktree",
                "move",
                &old.to_string_lossy(),
                &new.to_string_lossy(),
            ],
        );
        match moved {
            Ok(o) if !o.status.success() => warnings.push(format!(
                "dash '{}': git worktree move failed; left at .tugtree: {}",
                name,
                String::from_utf8_lossy(&o.stderr).trim()
            )),
            Err(e) => warnings.push(format!(
                "dash '{}': git worktree move failed; left at .tugtree: {}",
                name, e
            )),
            _ => {}
        }
    }
}

/// Whether either the debug or release instance app for `branch` is live (a
/// `cc-<profile>-<slug>` tmux session), so migration doesn't move a worktree out
/// from under a running app. Mirrors `reap_dash_tmux`'s identity math, but
/// non-destructive.
fn dash_instance_live(branch: &str) -> bool {
    let slug = branch_slug(branch);
    ["debug", "release"]
        .iter()
        .any(|profile| tugcore::instance::instance_tmux_live(&format!("{profile}-{slug}")))
}

pub(crate) fn branch_exists(repo: &Path, branch: &str) -> bool {
    git_stdout(repo, &["branch", "--list", branch])
        .map(|s| !s.is_empty())
        .unwrap_or(false)
}

/// Canonical bundle-id branch slug — mirrors `scripts/branch-slug.sh`
/// (lowercase; every run of non-`[a-z0-9]` collapses to a single `-`;
/// trim leading/trailing `-`). This is the slug `assign-bundle-id.sh`
/// folds into the per-worktree instance ID, so it lets us reconstruct
/// the tmux identity a removed dash's app used. NOTE: distinct from
/// `sanitize_branch_name` (which names the worktree *directory* and maps
/// `/` → `__`).
fn branch_slug(branch: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in branch.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Tear down the tmux server/session a removed dash worktree's app left
/// behind. A dash worktree builds the cwd-derived `<profile>-<branch-slug>`
/// identity; its tugcast created a `cc-<id>` session on that instance's
/// private `tug-<token>` server (or, for pre-isolation builds, the shared
/// default server). The dash's profile isn't recorded, so reap both
/// debug and release identities via the shared instance reaper.
fn reap_dash_tmux(branch: &str) {
    let slug = branch_slug(branch);
    for profile in ["debug", "release"] {
        tugcore::instance::reap_instance_tmux(&format!("{profile}-{slug}"));
    }
}

/// Tear down a dash's worktree robustly, always leaving the directory gone.
///
/// A dash's live app/vite dev server keeps files open inside the worktree.
/// On a mounted filesystem, removing a file that a process still holds open
/// leaves a silly-rename placeholder, so the parent `rmdir` fails with
/// "Directory not empty" — and `git worktree remove` strands a half-removed
/// worktree on disk (the exact failure `dash join` used to hit). To avoid it:
///   1. reap the dash's tmux server/app *first*, so nothing holds files open;
///   2. `--force` so gitignored build artifacts never block git's removal;
///   3. fall back to a direct filesystem wipe when git bails, retrying a few
///      times because reaped processes release their handles asynchronously;
///   4. `git worktree prune` to clear git's now-stale administrative entry.
///
/// A warning is pushed only if the directory truly survives all of that.
fn remove_dash_worktree(repo: &Path, branch: &str, worktree: &Path, warnings: &mut Vec<String>) {
    const ATTEMPTS: u32 = 5;

    reap_dash_tmux(branch);

    if !worktree.exists() {
        return;
    }

    for attempt in 0..ATTEMPTS {
        let _ = git_output(
            repo,
            &["worktree", "remove", "--force", &worktree.to_string_lossy()],
        );
        if worktree.exists() {
            let _ = std::fs::remove_dir_all(worktree);
        }
        if !worktree.exists() {
            break;
        }
        if attempt + 1 < ATTEMPTS {
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    }

    let _ = git_output(repo, &["worktree", "prune"]);

    if worktree.exists() {
        warnings.push(format!("Failed to remove worktree: {}", worktree.display()));
    }
}

/// Resolve a dash's base branch: git config first ([P03]), else detection.
pub(crate) fn dash_base(repo: &Path, name: &str) -> Result<String, String> {
    if let Some(base) = config_get(repo, &format!("branch.tugdash/{}.tugbase", name)) {
        return Ok(base);
    }
    detect_default_branch(repo).map_err(|e| e.to_string())
}

/// Run the project's `[tugtool.dash].post_create` hooks from the worktree root.
///
/// Each command runs via `sh -c`. The first non-zero exit aborts and returns
/// the failing command's stderr, so the caller can roll the worktree back.
fn run_post_create(repo: &Path, worktree: &Path) -> Result<(), String> {
    let config = Config::load_from_project(repo).map_err(|e| e.to_string())?;
    for cmd in &config.tugtool.dash.post_create {
        let out = Command::new("sh")
            .arg("-c")
            .arg(cmd)
            .current_dir(worktree)
            .output()
            .map_err(|e| format!("failed to run post_create hook '{}': {}", cmd, e))?;
        if !out.status.success() {
            return Err(format!(
                "post_create hook failed: '{}'\n{}",
                cmd,
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }
    Ok(())
}

// --- commands --------------------------------------------------------------

/// Create a dash: branch `tugdash/<name>` + worktree, base recorded in git
/// config, `[tugtool.dash].post_create` hook run. Idempotent — a fully-present
/// dash returns as-is (`created: false`) with no re-hydration.
pub fn create(name: &str, description: Option<String>) -> Result<CreateOutcome, String> {
    validate_dash_name(name).map_err(|e| e.to_string())?;

    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    migrate_worktrees(&repo_root, &mut Vec::new());
    let base_branch = detect_default_branch(&repo_root).map_err(|e| e.to_string())?;
    let branch = branch_name(name);
    let worktree = worktree_path(&repo_root, name);

    let have_branch = branch_exists(&repo_root, &branch);
    let have_worktree = worktree.exists();

    // Idempotent: a fully-present dash returns as-is, with no re-hydration.
    if have_branch && have_worktree {
        let description = description
            .or_else(|| config_get(&repo_root, &format!("branch.{}.description", branch)));
        let base = dash_base(&repo_root, name).unwrap_or(base_branch);
        return Ok(CreateOutcome {
            name: name.to_string(),
            description,
            branch,
            worktree: worktree.to_string_lossy().into_owned(),
            base_branch: base,
            status: "active".to_string(),
            created: false,
        });
    }

    // Clean up any partial leftovers from a half-built or stale incarnation.
    if have_worktree {
        let _ = git_output(
            &repo_root,
            &["worktree", "remove", "--force", &worktree.to_string_lossy()],
        );
    }
    if branch_exists(&repo_root, &branch) {
        let out = git_output(&repo_root, &["branch", "-D", &branch])?;
        if !out.status.success() {
            return Err(format!(
                "failed to delete stale branch {}: {}",
                branch,
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }

    // Create the worktree + branch in one step.
    let out = git_output(
        &repo_root,
        &[
            "worktree",
            "add",
            &worktree.to_string_lossy(),
            "-b",
            &branch,
            &base_branch,
        ],
    )?;
    if !out.status.success() {
        return Err(format!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    // Enable rerere so recorded conflict resolutions replay on join ([P31]).
    crate::resolve::ensure_rerere_config(&repo_root);

    // Record the base branch and description in git config.
    let _ = git_output(
        &repo_root,
        &[
            "config",
            &format!("branch.{}.tugbase", branch),
            &base_branch,
        ],
    );
    if let Some(desc) = description.as_deref() {
        let _ = git_output(
            &repo_root,
            &["config", &format!("branch.{}.description", branch), desc],
        );
    }

    // Hydrate the worktree; on failure, roll it (and the branch) back so a
    // retry re-creates cleanly and the idempotent path never strands it.
    if let Err(hook_err) = run_post_create(&repo_root, &worktree) {
        let _ = git_output(
            &repo_root,
            &["worktree", "remove", "--force", &worktree.to_string_lossy()],
        );
        let _ = git_output(&repo_root, &["branch", "-D", &branch]);
        return Err(hook_err);
    }

    Ok(CreateOutcome {
        name: name.to_string(),
        description,
        branch,
        worktree: worktree.to_string_lossy().into_owned(),
        base_branch,
        status: "active".to_string(),
        created: true,
    })
}

/// List every active dash (each `tugdash/*` branch), with round count + worktree.
pub fn list() -> Result<Vec<DashListItem>, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    migrate_worktrees(&repo_root, &mut Vec::new());

    // Every tugdash/* branch is an active dash ([P02]).
    let branches = git_stdout(
        &repo_root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/tugdash/",
        ],
    )?;

    let mut items = Vec::new();
    for branch in branches.lines().filter(|l| !l.trim().is_empty()) {
        let name = branch.trim_start_matches("tugdash/").to_string();
        let base = dash_base(&repo_root, &name)?;
        let round_count = git_stdout(
            &repo_root,
            &["rev-list", "--count", &format!("{}..{}", base, branch)],
        )
        .ok()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
        let worktree = worktree_path(&repo_root, &name);
        let description = config_get(&repo_root, &format!("branch.{}.description", branch));

        items.push(DashListItem {
            name,
            description,
            status: "active".to_string(),
            round_count,
            worktree: worktree
                .exists()
                .then(|| worktree.to_string_lossy().into_owned()),
            base_branch: base,
        });
    }

    Ok(items)
}

/// Show one dash's metadata + rounds (commits ahead of base) + worktree dirt.
pub fn show(name: &str) -> Result<ShowOutcome, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    migrate_worktrees(&repo_root, &mut Vec::new());
    let branch = branch_name(name);

    if !branch_exists(&repo_root, &branch) {
        return Err(format!("Dash not found: {}", name));
    }

    let base = dash_base(&repo_root, name)?;
    let description = config_get(&repo_root, &format!("branch.{}.description", branch));
    let worktree = worktree_path(&repo_root, name);

    // Commits ahead of base are this dash's rounds ([P02]).
    let log = git_stdout(
        &repo_root,
        &[
            "log",
            "--format=%h%x1f%s%x1f%cI",
            &format!("{}..{}", base, branch),
        ],
    )?;
    let rounds: Vec<RoundItem> = log
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let mut parts = line.split('\u{1f}');
            RoundItem {
                commit_hash: parts.next().unwrap_or("").to_string(),
                summary: parts.next().unwrap_or("").to_string(),
                started_at: parts.next().unwrap_or("").to_string(),
            }
        })
        .collect();

    // Uncommitted changes in the worktree, if it is present.
    let uncommitted_changes = if worktree.exists() {
        git_stdout(&worktree, &["status", "--porcelain"])
            .ok()
            .map(|s| !s.is_empty())
    } else {
        None
    };

    Ok(ShowOutcome {
        name: name.to_string(),
        description,
        branch,
        worktree: worktree.to_string_lossy().into_owned(),
        base_branch: base,
        status: "active".to_string(),
        rounds,
        uncommitted_changes,
    })
}

/// Commit the dash worktree (if dirty) and append a dash-log line. `round_meta`
/// carries the verbatim instruction (git's one gap) + a richer summary; the CLI
/// reads it from stdin.
pub fn commit(
    name: &str,
    message: &str,
    round_meta: Option<DashRoundMeta>,
) -> Result<CommitOutcome, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    migrate_worktrees(&repo_root, &mut Vec::new());
    let branch = branch_name(name);
    let worktree = worktree_path(&repo_root, name);

    if !branch_exists(&repo_root, &branch) || !worktree.exists() {
        return Err(format!("Dash not found or not active: {}", name));
    }

    // Stage all changes.
    let stage = git_output(&worktree, &["add", "-A"])?;
    if !stage.status.success() {
        return Err(format!(
            "git add failed: {}",
            String::from_utf8_lossy(&stage.stderr).trim()
        ));
    }

    // Anything staged?
    let diff = git_output(&worktree, &["diff", "--cached", "--quiet"])?;
    let has_changes = !diff.status.success(); // exits 1 when there are changes

    let commit_hash = if has_changes {
        // `--message` is the conventional-commit subject; a longer `summary`
        // (if any) enriches the body. Byte-safe: no slicing on a char boundary.
        let summary = round_meta
            .as_ref()
            .and_then(|m| m.summary.as_deref())
            .unwrap_or("");
        let commit_message = if summary.is_empty() || summary == message {
            message.to_string()
        } else {
            format!("{}\n\n{}", message, summary)
        };
        // Machine-parseable trailers ([P08], Spec S02): `Tug-Session:` when the
        // committing session resolves + `Tug-Dash: <branch> onto <base>`.
        let commit_message = with_dash_trailers(&repo_root, name, &branch, &commit_message);

        let commit = git_output(&worktree, &["commit", "-m", &commit_message])?;
        if !commit.status.success() {
            return Err(format!(
                "git commit failed: {}",
                String::from_utf8_lossy(&commit.stderr).trim()
            ));
        }
        Some(git_stdout(&worktree, &["rev-parse", "--short", "HEAD"])?)
    } else {
        None
    };

    // Append a dash-log line ([P04]): the verbatim instruction is git's one gap.
    let instruction = round_meta
        .as_ref()
        .and_then(|m| m.instruction.as_deref())
        .unwrap_or("");
    let marker = commit_hash.as_deref().unwrap_or("-");
    append_dash_log(&repo_root, name, marker, instruction).map_err(|e| e.to_string())?;

    Ok(CommitOutcome {
        committed: has_changes,
        commit_hash,
    })
}

/// Teardown phase of a join, recorded in the join journal so a crash between
/// steps can resume via `--continue` ([P14]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum JoinPhase {
    /// The integrate commit landed on base; worktree + branch still present.
    Integrated,
    /// Worktree removed; branch still present.
    WorktreeRemoved,
    /// Branch deleted; only the dash-log line + journal-clear remain.
    BranchDeleted,
}

/// The resumable join journal ([P14]) — a small JSON file beside the dash-log.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct JoinJournal {
    name: String,
    base_branch: String,
    strategy: String,
    commit_hash: String,
    phase: JoinPhase,
}

fn join_journal_path(repo: &Path, name: &str) -> PathBuf {
    project_state_dir(repo).join(format!("join-journal-{}.json", sanitize_branch_name(name)))
}

fn write_join_journal(repo: &Path, journal: &JoinJournal) -> Result<(), String> {
    let dir = project_state_dir(repo);
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to write join journal: {}", e))?;
    let path = dir.join(format!(
        "join-journal-{}.json",
        sanitize_branch_name(&journal.name)
    ));
    let body =
        serde_json::to_string_pretty(journal).map_err(|e| format!("join journal encode: {}", e))?;
    std::fs::write(&path, body).map_err(|e| format!("failed to write join journal: {}", e))
}

fn read_join_journal(repo: &Path, name: &str) -> Option<JoinJournal> {
    let txt = std::fs::read_to_string(join_journal_path(repo, name)).ok()?;
    serde_json::from_str(&txt).ok()
}

fn clear_join_journal(repo: &Path, name: &str) {
    let _ = std::fs::remove_file(join_journal_path(repo, name));
}

/// Whether `git` here supports `git merge-tree --write-tree` (git ≥ 2.38).
pub(crate) fn git_supports_merge_tree(repo: &Path) -> bool {
    let out = git_stdout(repo, &["--version"]).unwrap_or_default();
    let ver = out.split_whitespace().nth(2).unwrap_or("");
    let mut parts = ver.split('.');
    let major: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    major > 2 || (major == 2 && minor >= 38)
}

/// The tracked paths with uncommitted changes in `dir` (staged or unstaged vs
/// HEAD) as plain path lines — the intersection-preflight input. `git diff
/// --name-only HEAD` avoids porcelain's status-prefix parsing and never lists
/// untracked files (which can't overlap the base's tracked dirt anyway).
fn dirty_tracked_paths(dir: &Path) -> Vec<String> {
    git_stdout(dir, &["diff", "--name-only", "HEAD"])
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// The conflicted (unmerged) paths after a failed merge/cherry-pick.
fn conflicted_paths(repo: &Path) -> Vec<String> {
    git_stdout(repo, &["diff", "--name-only", "--diff-filter=U"])
        .map(|s| s.lines().map(|l| l.trim().to_string()).collect())
        .unwrap_or_default()
}

/// In-memory conflict preview via `git merge-tree --write-tree` (git ≥ 2.38):
/// returns the conflicted paths without touching any worktree, index, or ref.
fn merge_tree_conflicts(repo: &Path, base: &str, branch: &str) -> Result<Vec<String>, String> {
    let out = git_output(
        repo,
        &["merge-tree", "--write-tree", "--name-only", base, branch],
    )?;
    if out.status.success() {
        return Ok(vec![]); // clean merge
    }
    // Exit 1 ⇒ conflicts. Output: the toplevel tree OID on line 1, then the
    // conflicted file names, a blank line, then informational messages.
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut lines = stdout.lines();
    let _tree_oid = lines.next();
    let mut conflicts = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            break;
        }
        conflicts.push(line.trim().to_string());
    }
    Ok(conflicts)
}

/// The dash's maintained draft ([P23], Spec S09) — the default join message
/// when the caller supplies none. Read-only from `sessions.db`; any absence
/// (no db, no table, no row) falls through to `None`.
/// Resolve the `sessions.db` path — the running instance's, else the
/// platform default. Read-only callers only.
fn sessions_db_file() -> Option<std::path::PathBuf> {
    tugcore::instance::sessions_db_path().or_else(|| {
        let base = dirs::data_dir()?;
        #[cfg(target_os = "macos")]
        let dir = base.join("Tug");
        #[cfg(not(target_os = "macos"))]
        let dir = base.join("tugcast");
        Some(dir.join("sessions.db"))
    })
}

/// The `Tug-Session:` trailer value for the committing session ([P09], Spec
/// S02), or `None` when it can't be resolved — no `TUG_SESSION_ID` env, no
/// `sessions.db`, or no row for that id. `tugdash commit` runs inside a Claude
/// session where tugcast exports `TUG_SESSION_ID`; the display name is read
/// read-only from `sessions.db` (the `dash_draft_message` pattern). Any
/// absence omits the trailer silently — a commit never fails on trailer
/// resolution.
pub(crate) fn session_trailer() -> Option<String> {
    let session_id = std::env::var("TUG_SESSION_ID")
        .ok()
        .filter(|s| !s.is_empty())?;
    let db = sessions_db_file()?;
    let conn =
        rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    // No row → `query_row` errors → `.ok()?` omits the trailer. A row with a
    // NULL/blank name falls back to the id's first 8 chars (the chooser's
    // fallback), so a real session always attributes.
    let name: Option<String> = conn
        .query_row(
            "SELECT name FROM sessions WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()?;
    let display = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| session_id.chars().take(8).collect());
    Some(format!("{display} ({session_id})"))
}

/// Append the `Tug-Session:` (when resolvable) + `Tug-Dash: <branch> onto
/// <base>` trailers to a dash round-commit or join/squash message ([P08], Spec
/// S02). `base` comes from the dash's recorded base branch — the same source
/// `show()` / join use. Idempotent via `append_trailers`, so a draft that
/// already carries a trailer is never duplicated.
fn with_dash_trailers(repo: &Path, name: &str, branch: &str, message: &str) -> String {
    let dash_value = match dash_base(repo, name) {
        Ok(base) if !base.is_empty() => format!("{branch} onto {base}"),
        _ => branch.to_string(),
    };
    let session = session_trailer();
    let mut trailers: Vec<(&str, &str)> = Vec::new();
    if let Some(sv) = session.as_deref() {
        trailers.push(("Tug-Session", sv));
    }
    trailers.push(("Tug-Dash", dash_value.as_str()));
    tugmark_core::append_trailers(message, &trailers)
}

pub(crate) fn dash_draft_message(repo: &Path, branch: &str) -> Option<String> {
    let db = sessions_db_file()?;
    let conn =
        rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    let project = std::fs::canonicalize(repo)
        .unwrap_or_else(|_| repo.to_path_buf())
        .to_string_lossy()
        .into_owned();
    conn.query_row(
        "SELECT message FROM changeset_drafts \
         WHERE owner_kind = 'dash' AND owner_id = ?1 AND project_dir = ?2",
        rusqlite::params![branch, project],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .filter(|m| !m.trim().is_empty())
}

/// The scoped integrate/join commit message: explicit override → maintained
/// dash draft ([P23]) → the dash description → a bare fallback, always wrapped
/// as `tugdash(<name>): …`. Shared by the strategy integrate and the resolution
/// ladder's candidate commit so both speak the same voice.
pub(crate) fn integrate_message(
    repo: &Path,
    name: &str,
    branch: &str,
    override_msg: Option<String>,
) -> String {
    let description = config_get(repo, &format!("branch.{}.description", branch));
    let body = override_msg
        .or_else(|| dash_draft_message(repo, branch))
        .or(description)
        .unwrap_or_else(|| "Dash work".to_string());
    // Subject stays `tugdash(<name>): …`; the trailers ride the body ([P08]).
    with_dash_trailers(repo, name, branch, &format!("tugdash({}): {}", name, body))
}

/// Auto-commit any outstanding changes in the dash worktree — FATAL on error
/// ([P14]). A no-op when the worktree is absent or clean. Shared by `join_in`
/// (before integrating) and the resolution ladder (before computing a candidate
/// against the branch tip) so the tip always reflects the dash's real state.
pub(crate) fn commit_worktree_dirt(worktree: &Path) -> Result<(), String> {
    if !worktree.exists() {
        return Ok(());
    }
    let dash_status = git_stdout(worktree, &["status", "--porcelain"])?;
    if dash_status.is_empty() {
        return Ok(());
    }
    let add = git_output(worktree, &["add", "-A"])?;
    if !add.status.success() {
        return Err(format!(
            "join: git add in the dash worktree failed: {}",
            String::from_utf8_lossy(&add.stderr).trim()
        ));
    }
    let c = git_output(
        worktree,
        &["commit", "-m", "join: commit outstanding changes"],
    )?;
    if !c.status.success() {
        return Err(format!(
            "join: auto-commit in the dash worktree failed: {}",
            String::from_utf8_lossy(&c.stderr).trim()
        ));
    }
    Ok(())
}

/// Join a dash into its base branch ([P14]): `--strategy squash|merge|rebase`,
/// a `--preview` (in-memory `git merge-tree`, nothing touched), an
/// intersection-aware preflight (base dirt blocks only when it overlaps the
/// dash's changed set), a clean abort on conflict with the structured conflict
/// list, and a journaled teardown resumable via `--continue`. The default
/// squash/merge message is the maintained dash draft, else the description.
pub fn join(name: &str, opts: JoinOptions) -> Result<JoinOutcome, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    join_in(&repo_root, name, opts)
}

/// Like [`join`], but against an explicit repo root instead of discovering it
/// from the process cwd — for callers such as tugcast that serve many projects
/// and must never depend on `current_dir`.
pub fn join_in(repo_root: &Path, name: &str, opts: JoinOptions) -> Result<JoinOutcome, String> {
    let repo_root = repo_root.to_path_buf();
    let mut warnings = Vec::new();
    migrate_worktrees(&repo_root, &mut warnings);
    // Pre-feature dashes get rerere enabled here so a recorded resolution
    // replays on this and future joins ([P31]).
    crate::resolve::ensure_rerere_config(&repo_root);
    let branch = branch_name(name);
    let worktree = worktree_path(&repo_root, name);

    if !branch_exists(&repo_root, &branch) {
        return Err(format!("Dash not found: {}", name));
    }
    let base_branch = dash_base(&repo_root, name)?;

    // --continue: resume an interrupted teardown from the journal.
    if opts.continue_join {
        let journal = read_join_journal(&repo_root, name)
            .ok_or_else(|| format!("No interrupted join to continue for dash '{}'.", name))?;
        return finish_join_teardown(&repo_root, name, &branch, &worktree, journal, warnings);
    }

    // A stale journal means a prior join half-finished — require --continue.
    if read_join_journal(&repo_root, name).is_some() {
        return Err(format!(
            "A previous join of dash '{}' is incomplete. Resume it with: tugdash join {} --continue",
            name, name
        ));
    }

    // --preview: report conflicts in memory; nothing is mutated.
    if opts.preview {
        if !git_supports_merge_tree(&repo_root) {
            return Err(
                "tugdash join --preview requires git >= 2.38 (git merge-tree --write-tree)."
                    .to_string(),
            );
        }
        let conflicts = merge_tree_conflicts(&repo_root, &base_branch, &branch)?;
        return Ok(JoinOutcome {
            name: name.to_string(),
            base_branch,
            strategy: opts.strategy.as_str().to_string(),
            commit_hash: None,
            conflicts,
            previewed: true,
            warnings,
        });
    }

    // Must run from the base worktree, not inside the dash worktree.
    let current_dir =
        std::env::current_dir().map_err(|e| format!("failed to get current directory: {}", e))?;
    if current_dir.starts_with(&worktree) {
        return Err(
            "Cannot join from inside the dash worktree. Run from repo root instead.".to_string(),
        );
    }

    // Current branch must be the dash's base.
    let current_branch = git_stdout(&repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if current_branch != base_branch {
        return Err(format!(
            "Cannot join: repo root worktree is on branch '{}' but dash targets '{}'. Check out '{}' first.",
            current_branch, base_branch, base_branch
        ));
    }

    // Intersection preflight ([P14]): base dirt blocks only when it touches a
    // file this dash also changed (`base...branch` diff ∪ worktree dirt).
    // Disjoint base dirt is fine — the squash-merge only writes the dash's files.
    let base_dirt = dirty_tracked_paths(&repo_root);
    if !base_dirt.is_empty() {
        let mut dash_changed: Vec<String> = git_stdout(
            &repo_root,
            &[
                "diff",
                "--name-only",
                &format!("{}...{}", base_branch, branch),
            ],
        )
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
        if worktree.exists() {
            dash_changed.extend(dirty_tracked_paths(&worktree));
        }
        let intersect: Vec<String> = base_dirt
            .iter()
            .filter(|p| dash_changed.contains(p))
            .cloned()
            .collect();
        if !intersect.is_empty() {
            return Err(format!(
                "Cannot join: the base worktree has uncommitted changes to files this dash also changed ({}). Commit or stash them first.",
                intersect.join(", ")
            ));
        }
    }

    // Auto-commit outstanding dash-worktree changes — FATAL on error now ([P14]).
    commit_worktree_dirt(&worktree)?;

    // Nothing to integrate (no commits past base) — release, don't join.
    let ahead = git_stdout(
        &repo_root,
        &[
            "rev-list",
            "--count",
            &format!("{}..{}", base_branch, branch),
        ],
    )
    .ok()
    .and_then(|s| s.parse::<i64>().ok())
    .unwrap_or(0);
    if ahead == 0 {
        return Err(format!(
            "Nothing to join: dash '{}' has no commits past '{}'. Use 'tugdash release {}' to discard it.",
            name, base_branch, name
        ));
    }

    // Land a pre-built candidate from the resolution ladder ([P31]) instead of
    // integrating per strategy: fast-forward the base onto it (git's `--ff-only`
    // IS the staleness guard — a base that advanced past the candidate's base
    // refuses to fast-forward), then run the same journaled teardown.
    if let Some(candidate) = opts.candidate.clone() {
        let ff = git_output(&repo_root, &["merge", "--ff-only", &candidate])?;
        if !ff.status.success() {
            return Err(format!(
                "stale candidate: base '{}' advanced since the conflicts were resolved; re-resolve and try again ({})",
                base_branch,
                String::from_utf8_lossy(&ff.stderr).trim()
            ));
        }
        let commit_hash = git_stdout(&repo_root, &["rev-parse", "HEAD"])?;
        let journal = JoinJournal {
            name: name.to_string(),
            base_branch: base_branch.clone(),
            strategy: opts.strategy.as_str().to_string(),
            commit_hash,
            phase: JoinPhase::Integrated,
        };
        write_join_journal(&repo_root, &journal)?;
        return finish_join_teardown(&repo_root, name, &branch, &worktree, journal, warnings);
    }

    let final_msg = integrate_message(&repo_root, name, &branch, opts.message.clone());

    // Integrate per strategy. A conflict cleanly aborts (pre-join state
    // restored) and returns the structured conflict list — never a dead end.
    let conflict_outcome = |conflicts: Vec<String>, warnings: Vec<String>| JoinOutcome {
        name: name.to_string(),
        base_branch: base_branch.clone(),
        strategy: opts.strategy.as_str().to_string(),
        commit_hash: None,
        conflicts,
        previewed: false,
        warnings,
    };

    let commit_hash = match opts.strategy {
        JoinStrategy::Squash => {
            let merge = git_output(&repo_root, &["merge", "--squash", &branch])?;
            if !merge.status.success() {
                let conflicts = conflicted_paths(&repo_root);
                // A squash conflict leaves the index/worktree dirty but sets no
                // MERGE_HEAD, so `reset --hard` (not `merge --abort`) restores.
                let _ = git_output(&repo_root, &["reset", "--hard"]);
                return Ok(conflict_outcome(conflicts, warnings));
            }
            let commit = git_output(&repo_root, &["commit", "-m", &final_msg])?;
            if !commit.status.success() {
                let _ = git_output(&repo_root, &["reset", "--hard"]);
                return Err(format!(
                    "git commit failed: {}",
                    String::from_utf8_lossy(&commit.stderr).trim()
                ));
            }
            git_stdout(&repo_root, &["rev-parse", "HEAD"])?
        }
        JoinStrategy::Merge => {
            let merge = git_output(&repo_root, &["merge", "--no-ff", "-m", &final_msg, &branch])?;
            if !merge.status.success() {
                let conflicts = conflicted_paths(&repo_root);
                let _ = git_output(&repo_root, &["merge", "--abort"]);
                return Ok(conflict_outcome(conflicts, warnings));
            }
            git_stdout(&repo_root, &["rev-parse", "HEAD"])?
        }
        JoinStrategy::Rebase => {
            // Fast-forward when base is unchanged (linear); else replay the
            // dash's commits onto the current base with cherry-pick.
            let ff = git_output(&repo_root, &["merge", "--ff-only", &branch])?;
            if ff.status.success() {
                git_stdout(&repo_root, &["rev-parse", "HEAD"])?
            } else {
                let pick = git_output(
                    &repo_root,
                    &["cherry-pick", &format!("{}..{}", base_branch, branch)],
                )?;
                if !pick.status.success() {
                    let conflicts = conflicted_paths(&repo_root);
                    let _ = git_output(&repo_root, &["cherry-pick", "--abort"]);
                    return Ok(conflict_outcome(conflicts, warnings));
                }
                git_stdout(&repo_root, &["rev-parse", "HEAD"])?
            }
        }
    };

    // Journal the successful integrate, then run the resumable teardown.
    let journal = JoinJournal {
        name: name.to_string(),
        base_branch: base_branch.clone(),
        strategy: opts.strategy.as_str().to_string(),
        commit_hash: commit_hash.clone(),
        phase: JoinPhase::Integrated,
    };
    write_join_journal(&repo_root, &journal)?;

    finish_join_teardown(&repo_root, name, &branch, &worktree, journal, warnings)
}

/// The resumable teardown half of a join ([P14]): remove the worktree, delete
/// the branch, append the dash-log line, clear the journal — advancing the
/// journal phase after each step so `--continue` resumes exactly where a crash
/// left off. Idempotent per phase.
fn finish_join_teardown(
    repo_root: &Path,
    name: &str,
    branch: &str,
    worktree: &Path,
    mut journal: JoinJournal,
    mut warnings: Vec<String>,
) -> Result<JoinOutcome, String> {
    if journal.phase == JoinPhase::Integrated {
        remove_dash_worktree(repo_root, branch, worktree, &mut warnings);
        journal.phase = JoinPhase::WorktreeRemoved;
        write_join_journal(repo_root, &journal)?;
    }

    if journal.phase == JoinPhase::WorktreeRemoved {
        if branch_exists(repo_root, branch) {
            match git_output(repo_root, &["branch", "-D", branch]) {
                Ok(o) if !o.status.success() => warnings.push(format!(
                    "Failed to delete branch: {}",
                    String::from_utf8_lossy(&o.stderr).trim()
                )),
                Err(e) => warnings.push(format!("Failed to delete branch: {}", e)),
                _ => {}
            }
        }
        journal.phase = JoinPhase::BranchDeleted;
        write_join_journal(repo_root, &journal)?;
    }

    // Record the terminal action in the dash-log ([P04], R01), then clear the
    // journal so the join is no longer "incomplete".
    let short = git_stdout(repo_root, &["rev-parse", "--short", &journal.commit_hash])
        .unwrap_or_else(|_| journal.commit_hash.clone());
    append_dash_log(repo_root, name, &short, "joined").map_err(|e| e.to_string())?;
    clear_join_journal(repo_root, name);

    Ok(JoinOutcome {
        name: name.to_string(),
        base_branch: journal.base_branch,
        strategy: journal.strategy,
        commit_hash: Some(journal.commit_hash),
        conflicts: vec![],
        previewed: false,
        warnings,
    })
}

/// Release a dash: tear down its worktree + branch without merging.
pub fn release(name: &str) -> Result<ReleaseOutcome, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    release_in(&repo_root, name)
}

/// Like [`release`], but against an explicit repo root instead of the process
/// cwd — for callers such as tugcast.
pub fn release_in(repo_root: &Path, name: &str) -> Result<ReleaseOutcome, String> {
    let repo_root = repo_root.to_path_buf();
    let mut warnings = Vec::new();
    migrate_worktrees(&repo_root, &mut warnings);
    let branch = branch_name(name);
    let worktree = worktree_path(&repo_root, name);

    if !branch_exists(&repo_root, &branch) && !worktree.exists() {
        return Err(format!("Dash not found: {}", name));
    }

    // Reap the dash's tmux/app and remove its worktree robustly (see
    // `remove_dash_worktree` for the "Directory not empty" race this avoids).
    remove_dash_worktree(&repo_root, &branch, &worktree, &mut warnings);

    // Delete the branch (warn on failure).
    if branch_exists(&repo_root, &branch) {
        match git_output(&repo_root, &["branch", "-D", &branch]) {
            Ok(o) if !o.status.success() => warnings.push(format!(
                "Failed to delete branch: {}",
                String::from_utf8_lossy(&o.stderr).trim()
            )),
            Err(e) => warnings.push(format!("Failed to delete branch: {}", e)),
            _ => {}
        }
    }

    // Record the terminal action in the dash-log ([P04]).
    append_dash_log(&repo_root, name, "released", "").map_err(|e| e.to_string())?;

    Ok(ReleaseOutcome {
        name: name.to_string(),
        warnings,
    })
}

#[cfg(test)]
#[allow(clippy::disallowed_methods)] // set_current_dir is needed for tests with isolated temp dirs
mod tests {
    use super::*;
    use serial_test::serial;
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use tempfile::TempDir;

    #[test]
    fn branch_slug_matches_canonical_bundle_id_slug() {
        // Mirrors scripts/branch-slug.sh: lowercase, non-alnum runs → '-',
        // trimmed. These reconstruct the per-worktree instance ID that
        // `assign-bundle-id.sh` stamps, so `reap_dash_tmux` targets the
        // exact tmux identity a removed dash's app used.
        assert_eq!(branch_slug("tugdash/kbd-model"), "tugdash-kbd-model");
        assert_eq!(
            branch_slug("tugdash/Focus_Gallery"),
            "tugdash-focus-gallery"
        );
        assert_eq!(branch_slug("tugdash/a--b"), "tugdash-a-b");
        assert_eq!(branch_slug("tugdash/trailing-"), "tugdash-trailing");
        // The reconstructed debug session name matches what tugcast creates
        // (`cc-<instance-id>`), e.g. the leaked `cc-debug-tugdash-kbd-model`.
        let id = format!("debug-{}", branch_slug("tugdash/kbd-model"));
        assert_eq!(id, "debug-tugdash-kbd-model");
    }

    /// Redirect `project_state_dir`'s base off the real data dir for the
    /// duration of a (serial) test, so the dash-log lands under `home`.
    fn redirect_state_dir(home: &Path) {
        // SAFETY: dash tests are #[serial]; no other thread reads the
        // environment concurrently while this runs.
        unsafe {
            std::env::set_var("TUG_DATA_DIR", home);
        }
    }

    /// Path the dash-log is written to for `repo`, given the redirected base.
    ///
    /// Canonicalizes `repo` to match `find_repo_root()`, which resolves the cwd
    /// (e.g. `/var/...` → `/private/var/...` on macOS) — the slug must agree.
    fn dash_log_path(home: &Path, repo: &Path) -> std::path::PathBuf {
        // SAFETY: serial test; see redirect_state_dir.
        unsafe {
            std::env::set_var("TUG_DATA_DIR", home);
        }
        let root = fs::canonicalize(repo).unwrap();
        tugutil_core::project_state_dir(&root).join("dash-log.md")
    }

    fn init_git_repo(path: &Path) {
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["init", "-b", "main"])
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["config", "user.name", "Test User"])
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .unwrap();

        fs::write(path.join(".gitignore"), ".tugtree/\n").unwrap();
        fs::create_dir_all(path.join(".tugtool")).unwrap();
        fs::write(path.join(".tugtool/.keep"), "").unwrap();

        fs::write(path.join("README.md"), "# Test\n").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["add", "-A"])
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(["commit", "-m", "Initial commit"])
            .output()
            .unwrap();
    }

    /// Write a `.tugtool/config.toml` with the given post_create commands.
    fn write_config(path: &Path, post_create: &[&str]) {
        let cmds = post_create
            .iter()
            .map(|c| format!("\"{}\"", c))
            .collect::<Vec<_>>()
            .join(", ");
        fs::write(
            path.join(".tugtool/config.toml"),
            format!("[tugtool.dash]\npost_create = [{}]\n", cmds),
        )
        .unwrap();
    }

    fn current_branch(repo: &Path) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn branch_present(repo: &Path, branch: &str) -> bool {
        let out = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["branch", "--list", branch])
            .output()
            .unwrap();
        !String::from_utf8_lossy(&out.stdout).trim().is_empty()
    }

    fn run_git(repo: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?} failed");
    }

    #[serial]
    #[test]
    fn test_dash_create_basic() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        let result = create("test-dash", Some("desc".to_string()));
        assert!(result.is_ok());

        assert!(repo.join(".tug/worktrees/test-dash").exists());
        assert!(branch_present(repo, "tugdash/test-dash"));

        // Base branch is recorded in git config.
        let base = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["config", "--get", "branch.tugdash/test-dash.tugbase"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&base.stdout).trim(), "main");
    }

    #[serial]
    #[test]
    fn test_dash_create_idempotent() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", Some("first".to_string())).unwrap();
        // Second create returns the existing dash without error.
        let result = create("test-dash", Some("second".to_string()));
        assert!(!result.unwrap().created);
        assert!(repo.join(".tug/worktrees/test-dash").exists());
    }

    #[serial]
    #[test]
    fn test_dash_create_runs_post_create_once() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        // Append a line to a marker file each time the hook runs.
        write_config(repo, &["echo ran >> hook-marker.txt"]);
        std::env::set_current_dir(repo).unwrap();

        create("hooky", None).unwrap();
        let marker = repo.join(".tug/worktrees/hooky/hook-marker.txt");
        assert!(marker.exists(), "post_create should run on creation");
        assert_eq!(fs::read_to_string(&marker).unwrap().lines().count(), 1);

        // Idempotent resume must NOT re-run the hook.
        create("hooky", None).unwrap();
        assert_eq!(
            fs::read_to_string(&marker).unwrap().lines().count(),
            1,
            "post_create must not run on idempotent resume"
        );
    }

    #[serial]
    #[test]
    fn test_dash_create_failing_hook_rolls_back() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        write_config(repo, &["exit 1"]);
        std::env::set_current_dir(repo).unwrap();

        let result = create("doomed", None);
        assert!(result.is_err(), "failing hook should fail create");

        // Rollback: neither worktree nor branch survive.
        assert!(!repo.join(".tug/worktrees/doomed").exists());
        assert!(!branch_present(repo, "tugdash/doomed"));

        // A retry (with a passing hook) then succeeds cleanly.
        write_config(repo, &[]);
        let retry = create("doomed", None);
        assert!(retry.is_ok());
        assert!(repo.join(".tug/worktrees/doomed").exists());
    }

    #[serial]
    #[test]
    fn test_dash_commit_with_changes_writes_log() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", Some("Test".to_string())).unwrap();

        let worktree = repo.join(".tug/worktrees/test-dash");
        fs::write(worktree.join("test.txt"), "content\n").unwrap();

        let result = commit("test-dash", "Add test file", None);
        assert!(result.unwrap().committed);

        // A new commit landed on the dash branch.
        let count = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["rev-list", "--count", "main..tugdash/test-dash"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&count.stdout).trim(), "1");

        // The dash-log got a line naming the dash.
        let log = fs::read_to_string(dash_log_path(&home, repo)).unwrap();
        assert!(
            log.contains("test-dash"),
            "dash-log should record the commit: {log}"
        );
    }

    #[serial]
    #[test]
    fn test_dash_commit_no_changes() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", Some("Test".to_string())).unwrap();

        let result = commit("test-dash", "No changes", None);
        assert!(!result.unwrap().committed);

        // No commit ahead of base.
        let count = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["rev-list", "--count", "main..tugdash/test-dash"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&count.stdout).trim(), "0");
    }

    #[serial]
    #[test]
    fn test_dash_commit_multibyte_summary_does_not_panic() {
        // A multibyte summary longer than 72 bytes must not panic on a byte
        // slice, and `--message` must remain the commit subject.
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", None).unwrap();
        let worktree = repo.join(".tug/worktrees/test-dash");
        fs::write(worktree.join("f.txt"), "x\n").unwrap();

        // A long multibyte summary that straddles byte 72 (100 bytes, 50 chars).
        let meta = DashRoundMeta {
            instruction: Some("i".to_string()),
            summary: Some("é".repeat(50)),
        };
        commit("test-dash", "feat: thing", Some(meta)).unwrap();

        // The subject is the --message; the summary rode into the body.
        let subject = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["log", "-1", "--format=%s", "tugdash/test-dash"])
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&subject.stdout).trim(),
            "feat: thing"
        );
    }

    #[serial]
    #[test]
    fn test_dash_commit_round_meta_writes_instruction() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        std::env::set_current_dir(repo).unwrap();
        redirect_state_dir(&home);

        create("test-dash", Some("Test".to_string())).unwrap();

        let worktree = repo.join(".tug/worktrees/test-dash");
        fs::write(worktree.join("test.txt"), "test\n").unwrap();

        // The verbatim instruction is git's one gap — it must reach the dash-log.
        let meta = DashRoundMeta {
            instruction: Some("add test file".to_string()),
            summary: Some("Added test file".to_string()),
        };
        commit("test-dash", "Test commit", Some(meta)).unwrap();

        let log = fs::read_to_string(dash_log_path(&home, repo)).unwrap();
        assert!(
            log.contains("add test file"),
            "log should carry the instruction: {log}"
        );
    }

    #[serial]
    #[test]
    fn test_dash_list_and_show() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        create("dash1", None).unwrap();
        create("dash2", None).unwrap();

        assert_eq!(list().unwrap().len(), 2);
        assert!(show("dash1").is_ok());
        assert!(show("nonexistent").is_err());
    }

    #[serial]
    #[test]
    fn test_dash_join_full_lifecycle() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", Some("Test dash".to_string())).unwrap();
        let worktree = repo.join(".tug/worktrees/test-dash");
        fs::write(worktree.join("feature.txt"), "new feature\n").unwrap();
        commit("test-dash", "Add feature", None).unwrap();

        let result = join(
            "test-dash",
            JoinOptions {
                message: Some("Add new feature".to_string()),
                ..Default::default()
            },
        );
        assert!(result.is_ok());

        // Squash commit on base, worktree + branch gone.
        let log = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["log", "--oneline", "-1"])
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&log.stdout).contains("tugdash(test-dash):"));
        assert!(!worktree.exists());
        assert!(!branch_present(repo, "tugdash/test-dash"));

        // dash-log records the terminal action.
        let dlog = fs::read_to_string(dash_log_path(&home, repo)).unwrap();
        assert!(
            dlog.contains("joined"),
            "dash-log should record join: {dlog}"
        );
    }

    /// Round commits and the join/squash commit carry the `Tug-Dash:` trailer
    /// ([P08], Spec S02). With no `TUG_SESSION_ID` in the environment the
    /// `Tug-Session:` trailer is omitted (no error).
    #[serial]
    #[test]
    fn test_dash_commits_carry_dash_trailer() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();

        create("trailer-dash", Some("Test".to_string())).unwrap();
        let worktree = repo.join(".tug/worktrees/trailer-dash");
        fs::write(worktree.join("f.txt"), "x\n").unwrap();
        commit("trailer-dash", "Add f", None).unwrap();

        let round = Command::new("git")
            .arg("-C")
            .arg(&worktree)
            .args(["log", "-1", "--format=%B"])
            .output()
            .unwrap();
        let round = String::from_utf8_lossy(&round.stdout);
        assert!(
            round.contains("Tug-Dash: tugdash/trailer-dash onto "),
            "round commit carries Tug-Dash: {round}"
        );
        // Only assert absence when the environment genuinely lacks the id, so
        // the test never flakes on a runner that happens to export it.
        if std::env::var("TUG_SESSION_ID").is_err() {
            assert!(
                !round.contains("Tug-Session:"),
                "no session env → no Tug-Session: {round}"
            );
        }

        join(
            "trailer-dash",
            JoinOptions {
                message: Some("Land it".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        let squash = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["log", "-1", "--format=%B"])
            .output()
            .unwrap();
        let squash = String::from_utf8_lossy(&squash.stdout);
        assert!(
            squash.contains("tugdash(trailer-dash):"),
            "squash subject stays tugdash(<name>): {squash}"
        );
        assert!(
            squash.contains("Tug-Dash: tugdash/trailer-dash onto "),
            "squash commit carries Tug-Dash: {squash}"
        );
    }

    /// The resolution ladder builds a candidate off to the side; `join_in` with
    /// `candidate` fast-forwards the base onto it and tears the dash down
    /// ([P31]). Uses the replay scenario: base advanced to the dash's first
    /// round, so the squash conflicts but replay is clean.
    #[serial]
    #[test]
    fn test_dash_join_lands_resolved_candidate() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();
        // Baseline file the dash and main both evolve.
        fs::write(repo.join("f.txt"), "A\n").unwrap();
        run_git(repo, &["add", "-A"]);
        run_git(repo, &["commit", "-m", "seed f"]);

        create("cand", None).unwrap();
        let worktree = repo.join(".tug/worktrees/cand");
        fs::write(worktree.join("f.txt"), "B\n").unwrap();
        commit("cand", "r1", None).unwrap();
        fs::write(worktree.join("f.txt"), "C\n").unwrap();
        commit("cand", "r2", None).unwrap();

        // Main independently advances to the dash's first-round state.
        fs::write(repo.join("f.txt"), "B\n").unwrap();
        run_git(repo, &["commit", "-am", "main advances to B"]);

        let outcome = crate::resolve::resolve_conflicts(repo, "cand", None).unwrap();
        assert_eq!(outcome.shape, crate::resolve::JoinShape::Replay);
        let candidate = outcome.candidate_commit.clone().expect("candidate");

        let landed = join(
            "cand",
            JoinOptions {
                candidate: Some(candidate),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(landed.commit_hash.is_some());
        assert_eq!(fs::read_to_string(repo.join("f.txt")).unwrap(), "C\n");
        assert!(!worktree.exists(), "worktree torn down");
        assert!(!branch_present(repo, "tugdash/cand"), "branch deleted");
        let dlog = fs::read_to_string(dash_log_path(&home, repo)).unwrap();
        assert!(dlog.contains("joined"));
    }

    /// A candidate built against a base head that has since moved must refuse to
    /// land — git's own `--ff-only` is the staleness guard ([P31]).
    #[serial]
    #[test]
    fn test_dash_join_stale_candidate_refused() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();
        fs::write(repo.join("f.txt"), "A\n").unwrap();
        run_git(repo, &["add", "-A"]);
        run_git(repo, &["commit", "-m", "seed f"]);

        create("cand", None).unwrap();
        let worktree = repo.join(".tug/worktrees/cand");
        fs::write(worktree.join("f.txt"), "B\n").unwrap();
        commit("cand", "r1", None).unwrap();
        fs::write(worktree.join("f.txt"), "C\n").unwrap();
        commit("cand", "r2", None).unwrap();
        fs::write(repo.join("f.txt"), "B\n").unwrap();
        run_git(repo, &["commit", "-am", "main to B"]);

        let candidate = crate::resolve::resolve_conflicts(repo, "cand", None)
            .unwrap()
            .candidate_commit
            .expect("candidate");

        // Base moves after the candidate was built.
        fs::write(repo.join("other.txt"), "z\n").unwrap();
        run_git(repo, &["add", "-A"]);
        run_git(repo, &["commit", "-m", "base advances again"]);

        let err = join(
            "cand",
            JoinOptions {
                candidate: Some(candidate),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(err.contains("stale candidate"), "got: {err}");
        // Nothing torn down — the dash survives for a re-resolve.
        assert!(worktree.exists(), "worktree intact after refusal");
        assert!(branch_present(repo, "tugdash/cand"));
    }

    /// Regression: when git's own `worktree remove` refuses (in production, a
    /// mounted-filesystem "Directory not empty" caused by the dash's app still
    /// holding files open; here, a `git worktree lock` that single-`--force`
    /// won't override), `remove_dash_worktree` must still leave the directory
    /// gone via its filesystem-wipe fallback — no stranded worktree, no
    /// warning. This drives the real fallback code path on real files.
    #[serial]
    #[test]
    fn test_remove_dash_worktree_fallback_when_git_refuses() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", None).unwrap();
        let branch = branch_name("test-dash");
        let worktree = worktree_path(repo, "test-dash");
        assert!(worktree.exists());

        // Lock the worktree so `git worktree remove --force` (single -f)
        // refuses, standing in for the mount-level rmdir failure production
        // hits. Only the filesystem fallback can clear it.
        git_output(repo, &["worktree", "lock", &worktree.to_string_lossy()]).unwrap();
        assert!(
            !git_output(
                repo,
                &["worktree", "remove", "--force", &worktree.to_string_lossy()]
            )
            .unwrap()
            .status
            .success(),
            "precondition: git must refuse to remove the locked worktree"
        );
        assert!(worktree.exists(), "precondition: worktree still present");

        let mut warnings = Vec::new();
        remove_dash_worktree(repo, &branch, &worktree, &mut warnings);

        assert!(!worktree.exists(), "fallback must remove the directory");
        assert!(
            warnings.is_empty(),
            "no warning when the directory is gone: {warnings:?}"
        );
    }

    /// Intersection preflight ([P14]): base dirt blocks a join only when it
    /// touches a file the dash also changed; disjoint base dirt joins fine.
    #[serial]
    #[test]
    fn test_dash_join_intersecting_base_dirt_fails_but_disjoint_joins() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        // Two tracked files on base.
        for f in ["shared.txt", "other.txt"] {
            fs::write(repo.join(f), "base\n").unwrap();
        }
        git_output(repo, &["add", "."]).unwrap();
        git_output(repo, &["commit", "-m", "seed"]).unwrap();

        // A dash that changes shared.txt.
        create("isect", None).unwrap();
        let worktree = repo.join(".tug/worktrees/isect");
        fs::write(worktree.join("shared.txt"), "base\ndash change\n").unwrap();
        commit("isect", "touch shared", None).unwrap();

        // Base dirt on the SAME file the dash changed → refuses, naming it.
        fs::write(repo.join("shared.txt"), "base\nlocal edit\n").unwrap();
        let blocked = join("isect", JoinOptions::default());
        assert!(blocked.is_err());
        let err = blocked.unwrap_err();
        assert!(err.contains("also changed"), "{err}");
        assert!(err.contains("shared.txt"), "{err}");
        assert!(branch_present(repo, "tugdash/isect"));

        // Move the base dirt to a DISJOINT file → the join now succeeds.
        git_output(repo, &["checkout", "--", "shared.txt"]).unwrap();
        fs::write(repo.join("other.txt"), "base\nlocal edit\n").unwrap();
        let ok = join("isect", JoinOptions::default()).unwrap();
        assert!(ok.commit_hash.is_some());
        assert!(!branch_present(repo, "tugdash/isect"));
    }

    #[serial]
    #[test]
    fn test_dash_join_wrong_branch_fails() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", Some("Test".to_string())).unwrap();
        Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["checkout", "-b", "feature"])
            .output()
            .unwrap();

        let result = join("test-dash", JoinOptions::default());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("on branch 'feature'"));
        assert!(err.contains("Check out 'main' first"));
        assert_eq!(current_branch(repo), "feature");
    }

    #[serial]
    #[test]
    fn test_dash_release_full_lifecycle() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", Some("Test".to_string())).unwrap();
        let worktree = repo.join(".tug/worktrees/test-dash");
        fs::write(worktree.join("test.txt"), "test\n").unwrap();

        let result = release("test-dash");
        assert!(result.is_ok());

        assert!(!worktree.exists());
        assert!(!branch_present(repo, "tugdash/test-dash"));

        let dlog = fs::read_to_string(dash_log_path(&home, repo)).unwrap();
        assert!(
            dlog.contains("released"),
            "dash-log should record release: {dlog}"
        );
    }

    #[serial]
    #[test]
    fn test_dash_release_nonexistent_fails() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        let result = release("nonexistent");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[serial]
    #[test]
    fn test_dash_join_already_gone_fails() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        create("test-dash", Some("Test".to_string())).unwrap();
        let worktree = repo.join(".tug/worktrees/test-dash");
        fs::write(worktree.join("test.txt"), "test\n").unwrap();
        commit("test-dash", "Add test", None).unwrap();
        join("test-dash", JoinOptions::default()).unwrap();

        // Joining again fails: the branch no longer exists.
        let result = join("test-dash", JoinOptions::default());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    /// A clean legacy `.tugtree/` worktree migrates to `.tug/worktrees/` on the
    /// next tugdash command; a dirty one stays put and still operates from its
    /// old path ([P13], migration risk mitigation).
    #[serial]
    #[test]
    fn test_legacy_worktree_migrates_but_dirty_stays() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        // Stand up two legacy-layout dashes by hand, as pre-migration builds did.
        for name in ["clean", "dirty"] {
            let old = repo.join(format!(".tugtree/tugdash__{name}"));
            let branch = format!("tugdash/{name}");
            assert!(
                git_output(
                    repo,
                    &[
                        "worktree",
                        "add",
                        &old.to_string_lossy(),
                        "-b",
                        &branch,
                        "main"
                    ]
                )
                .unwrap()
                .status
                .success()
            );
            git_output(
                repo,
                &["config", &format!("branch.{branch}.tugbase"), "main"],
            )
            .unwrap();
        }
        fs::write(repo.join(".tugtree/tugdash__dirty/scratch.txt"), "wip\n").unwrap();

        // A single list() runs the migration pass.
        list().unwrap();

        // Clean legacy dash moved to the new home; dirty one stayed at .tugtree.
        assert!(
            repo.join(".tug/worktrees/clean").exists(),
            "clean dash migrated"
        );
        assert!(
            !repo.join(".tugtree/tugdash__clean").exists(),
            "old clean path gone"
        );
        assert!(
            repo.join(".tugtree/tugdash__dirty").exists(),
            "dirty dash stays at .tugtree"
        );
        assert!(
            !repo.join(".tug/worktrees/dirty").exists(),
            "dirty dash did not migrate"
        );

        // The dirty dash still operates from its old path — commit works on it.
        let out = commit("dirty", "wip: scratch", None).unwrap();
        assert!(out.committed, "commit operates on the un-migrated worktree");
    }

    /// Helper: a fresh repo with a dash carrying one commit that adds `f.txt`.
    fn repo_with_committed_dash(name: &str) -> (TempDir, std::path::PathBuf) {
        let temp = TempDir::new().unwrap();
        let repo = fs::canonicalize(temp.path()).unwrap();
        init_git_repo(&repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(&repo).unwrap();
        create(name, None).unwrap();
        let worktree = repo.join(format!(".tug/worktrees/{name}"));
        fs::write(worktree.join("f.txt"), "dash\n").unwrap();
        commit(name, &format!("{name}-only"), None).unwrap();
        (temp, repo)
    }

    #[serial]
    #[test]
    fn test_join_merge_strategy_makes_a_merge_commit() {
        let (_temp, repo) = repo_with_committed_dash("mrg");
        let out = join(
            "mrg",
            JoinOptions {
                strategy: JoinStrategy::Merge,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(out.commit_hash.is_some());
        assert_eq!(out.strategy, "merge");
        // A `--no-ff` merge commit has two parents.
        let parents = git_stdout(&repo, &["rev-list", "--parents", "-1", "HEAD"]).unwrap();
        assert_eq!(
            parents.split_whitespace().count(),
            3,
            "merge commit has two parents: {parents}"
        );
    }

    #[serial]
    #[test]
    fn test_join_rebase_strategy_is_linear() {
        let (_temp, repo) = repo_with_committed_dash("rb");
        join(
            "rb",
            JoinOptions {
                strategy: JoinStrategy::Rebase,
                ..Default::default()
            },
        )
        .unwrap();
        // Base fast-forwarded to the dash commit — linear, message preserved.
        let subject = git_stdout(&repo, &["log", "-1", "--format=%s"]).unwrap();
        assert_eq!(subject, "rb-only");
        let parents = git_stdout(&repo, &["rev-list", "--parents", "-1", "HEAD"]).unwrap();
        assert_eq!(
            parents.split_whitespace().count(),
            2,
            "single parent = linear history: {parents}"
        );
    }

    #[serial]
    #[test]
    fn test_join_preview_reports_conflicts_without_touching_tree() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        // A tracked file both sides will edit on the same line.
        fs::write(repo.join("conflict.txt"), "line1\n").unwrap();
        git_output(repo, &["add", "."]).unwrap();
        git_output(repo, &["commit", "-m", "seed"]).unwrap();

        create("pv", None).unwrap();
        let worktree = repo.join(".tug/worktrees/pv");
        fs::write(worktree.join("conflict.txt"), "dash line\n").unwrap();
        commit("pv", "dash edit", None).unwrap();

        // Base advances with a conflicting edit to the same line.
        fs::write(repo.join("conflict.txt"), "base line\n").unwrap();
        git_output(repo, &["commit", "-am", "base edit"]).unwrap();
        let base_head = git_stdout(repo, &["rev-parse", "HEAD"]).unwrap();

        let preview = join(
            "pv",
            JoinOptions {
                preview: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(preview.previewed);
        assert!(preview.commit_hash.is_none());
        assert!(
            preview.conflicts.iter().any(|p| p == "conflict.txt"),
            "preview names the conflict: {:?}",
            preview.conflicts
        );
        // Nothing touched: branch + worktree present, base HEAD unchanged.
        assert!(branch_present(repo, "tugdash/pv"));
        assert!(worktree.exists());
        assert_eq!(git_stdout(repo, &["rev-parse", "HEAD"]).unwrap(), base_head);
    }

    #[serial]
    #[test]
    fn test_join_continue_resumes_teardown() {
        // Simulate a crash right after the integrate commit: a journal at phase
        // `Integrated` with the worktree + branch still present. `--continue`
        // must finish the teardown (remove worktree, delete branch, dash-log).
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();

        create("resume", None).unwrap();
        let worktree = repo.join(".tug/worktrees/resume");
        fs::write(worktree.join("f.txt"), "x\n").unwrap();
        commit("resume", "add f", None).unwrap();

        // Do the integrate by hand, then journal it as if we crashed next.
        git_output(repo, &["merge", "--squash", "tugdash/resume"]).unwrap();
        git_output(repo, &["commit", "-m", "tugdash(resume): add f"]).unwrap();
        let head = git_stdout(repo, &["rev-parse", "HEAD"]).unwrap();
        // `join` resolves the repo via `find_repo_root` (canonical), so the
        // journal must be written to the canonical state dir to be found.
        let canon = fs::canonicalize(repo).unwrap();
        write_join_journal(
            &canon,
            &JoinJournal {
                name: "resume".to_string(),
                base_branch: "main".to_string(),
                strategy: "squash".to_string(),
                commit_hash: head.clone(),
                phase: JoinPhase::Integrated,
            },
        )
        .unwrap();
        assert!(worktree.exists());
        assert!(branch_present(repo, "tugdash/resume"));

        // A plain join now refuses (journal present); --continue resumes.
        assert!(join("resume", JoinOptions::default()).is_err());
        let out = join(
            "resume",
            JoinOptions {
                continue_join: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(out.commit_hash.as_deref(), Some(head.as_str()));
        assert!(!worktree.exists(), "worktree removed on continue");
        assert!(
            !branch_present(repo, "tugdash/resume"),
            "branch deleted on continue"
        );
        assert!(
            read_join_journal(&canon, "resume").is_none(),
            "journal cleared on completion"
        );
        let dlog = fs::read_to_string(dash_log_path(&home, repo)).unwrap();
        assert!(dlog.contains("joined"), "dash-log records the join: {dlog}");
    }
}
