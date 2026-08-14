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

use crate::dash::{
    DashDeclaration, DashRoundMeta, MarkStage, StepPhase, append_dash_log, append_mark_declaration,
    append_step_declaration, detect_default_branch, read_declarations, validate_dash_name,
};

/// Outcome of [`create`].
#[derive(Debug, Clone, Serialize)]
pub struct CreateOutcome {
    pub name: String,
    /// The dash's owner key ([P01]) — `tugdash/<name>#<tugid>`.
    pub id: Option<String>,
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
    /// The dash's owner key ([P01]); the legacy branch ref for an id-less dash.
    pub id: Option<String>,
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
    /// The dash's owner key ([P01]); the legacy branch ref for an id-less dash.
    pub id: Option<String>,
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

// --- dash identity ---------------------------------------------------------

/// A dash's creation id lives in its branch config, beside `tugbase`.
fn tugid_config_key(name: &str) -> String {
    format!("branch.tugdash/{}.tugid", name)
}

/// Mint a fresh `tugid`: unix-millis plus a 6-hex-char nonce ([P01]). Millis
/// sort chronologically; the nonce keeps two mints in the same millisecond
/// apart without any coordination.
fn mint_tugid() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut nonce = [0u8; 3];
    rand::fill(&mut nonce);
    format!("{millis}-{:02x}{:02x}{:02x}", nonce[0], nonce[1], nonce[2])
}

/// A dash's **owner key** — the identity every ledger row keys by: draft rows'
/// `owner_id`, the sessions table's `dash_id`, and the snapshot entry's
/// `owner_id` ([P01]).
///
/// `tugdash/<name>#<tugid>` when the dash has a creation id, else the bare
/// branch ref `tugdash/<name>` — the legacy identity, byte-identical to the
/// keys every pre-id build wrote.
///
/// **Read this before any teardown.** `git branch -D` deletes the branch's
/// whole config section, `tugid` included, so a key resolved after a
/// `join_in`/`release_in` returns can only ever be the legacy form — and every
/// id-keyed row it should have swept becomes unnameable ([P05], Risk R02).
pub fn dash_owner_key(repo: &Path, name: &str) -> String {
    let branch = branch_name(name);
    match config_get(repo, &tugid_config_key(name)) {
        Some(id) => format!("{branch}#{id}"),
        None => branch,
    }
}

/// The owner key for a dash, minting its `tugid` when it has none ([P01]).
///
/// Only **write-path** verbs call this — `create`, `commit`, and the
/// `/api/dash` bind handler ([P02]). Read paths use [`dash_owner_key`], which
/// never mints: a read that wrote config would make every feed recompute a
/// side-effecting multi-process race, and two racing mints would fork a dash's
/// identity (Risk R01).
pub fn ensure_dash_id(repo: &Path, name: &str) -> Result<String, String> {
    let branch = branch_name(name);
    if let Some(id) = config_get(repo, &tugid_config_key(name)) {
        return Ok(format!("{branch}#{id}"));
    }
    let id = mint_tugid();
    let out = git_output(repo, &["config", &tugid_config_key(name), &id])?;
    if !out.status.success() {
        return Err(format!(
            "failed to record dash id for {}: {}",
            name,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(format!("{branch}#{id}"))
}

/// The legacy (pre-id) form of an owner key: everything before the `#`. A `#`
/// cannot appear in a branch ref, so the split is unambiguous, and a key that
/// is already legacy passes through unchanged.
pub fn legacy_owner_key(owner_key: &str) -> &str {
    match owner_key.split_once('#') {
        Some((branch, _)) => branch,
        None => owner_key,
    }
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
        // A revisit is a write-path touch, so an id-less dash from an older
        // build gains its id here ([P02]).
        let id = ensure_dash_id(&repo_root, name).ok();
        return Ok(CreateOutcome {
            name: name.to_string(),
            id,
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

    // Mint the creation id ([P01]) beside the rest of the branch metadata, so
    // it is torn down with the branch and needs no garbage collection.
    let id = ensure_dash_id(&repo_root, name).ok();

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
        id,
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
            id: Some(dash_owner_key(&repo_root, &name)),
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
        id: Some(dash_owner_key(&repo_root, name)),
        description,
        branch,
        worktree: worktree.to_string_lossy().into_owned(),
        base_branch: base,
        status: "active".to_string(),
        rounds,
        uncommitted_changes,
    })
}

/// One file in a dash's `base...branch` diff, as `git diff --name-status`
/// reports it. The caller maps this into its own file row.
#[derive(Debug, Clone, Serialize)]
pub struct DashDetailFile {
    /// Path relative to the repository root. A rename reports its destination.
    pub path: String,
    /// The name-status letter (`A`, `M`, `D`, `R`, …).
    pub status: String,
}

/// Everything a display needs about one dash, composed from git in one place.
///
/// This is the shared composition [`dash_detail_entries_in`] returns — the
/// single implementation the CLI and the Changes card's snapshot both read, so
/// the two can no longer drift on what a dash's base, worktree, or round count
/// is.
#[derive(Debug, Clone, Serialize)]
pub struct DashDetail {
    pub name: String,
    /// The owner key ([P01]) — the identity every ledger row keys by.
    pub owner_key: String,
    /// The git ref (`tugdash/<name>`). Anything that needs a *ref* reads this
    /// and never `owner_key` ([P09]).
    pub branch: String,
    pub base: String,
    pub rounds: u32,
    /// Worktree path relative to the repo root.
    pub worktree_rel: String,
    pub worktree_dirty: bool,
    pub files: Vec<DashDetailFile>,
    /// Round commit subjects, newest first; empty when the dash has no rounds.
    pub round_subjects: Vec<String>,
    /// Derived stage ([P03]); `landing` requires the join journal, so callers
    /// that can also see a draft recompute with [`derive_stage`].
    pub stage: String,
    /// How far a stepped run has got, from the latest step declaration.
    pub step_current: Option<u32>,
    pub step_total: Option<u32>,
    /// The plan this dash is driving, relative to its *worktree* — the copy a
    /// run edits and whose ledger the step verbs rewrite. `None` when no run
    /// has recorded one.
    pub plan_path: Option<String>,
}

/// Parse `git diff --name-status` output. Rename and copy lines
/// (`R<score>\told\tnew`) report the destination path.
fn parse_name_status(output: &str) -> Vec<DashDetailFile> {
    let mut files = Vec::new();
    for line in output.lines() {
        let mut fields = line.split('\t');
        let Some(status) = fields.next() else {
            continue;
        };
        let Some(letter) = status.chars().next() else {
            continue;
        };
        let path = if letter == 'R' || letter == 'C' {
            fields.nth(1)
        } else {
            fields.next()
        };
        if let Some(path) = path.filter(|p| !p.is_empty()) {
            files.push(DashDetailFile {
                path: path.to_owned(),
                status: status.to_owned(),
            });
        }
    }
    files
}

/// Every active dash in `repo_root`, with the per-dash detail a display needs.
///
/// The `_in` variant of [`list`] with detail: explicit repo root (the feed
/// composing a snapshot has one and is not cwd-relative), the full
/// `base...branch` file list, round subjects, and worktree dirt.
///
/// A **pure read path** — it resolves each dash's owner key with
/// [`dash_owner_key`] and never mints ([P02]). tugcast's `compose_snapshot`
/// calls this on every recompute, and a read that wrote git config would be a
/// side-effecting read and a multi-process race.
pub fn dash_detail_entries_in(repo_root: &Path) -> Vec<DashDetail> {
    let Ok(branches) = git_stdout(
        repo_root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/tugdash/",
        ],
    ) else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    for branch in branches.lines().filter(|l| !l.trim().is_empty()) {
        let name = branch.trim_start_matches("tugdash/");
        // `dash_base`'s detection fallback, deliberately, rather than the bare
        // `"main"` default the feed's duplicate used: a repo whose default
        // branch is not `main` was silently mis-based there.
        let Ok(base) = dash_base(repo_root, name) else {
            continue;
        };

        let rounds = git_stdout(
            repo_root,
            &["rev-list", "--count", &format!("{base}..{branch}")],
        )
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

        let worktree_abs = worktree_path(repo_root, name);
        let worktree_rel = worktree_abs
            .strip_prefix(repo_root)
            .unwrap_or(&worktree_abs)
            .to_string_lossy()
            .into_owned();
        let worktree_dirty = worktree_abs.exists()
            && git_stdout(&worktree_abs, &["status", "--porcelain"])
                .map(|s| !s.is_empty())
                .unwrap_or(false);

        let files = git_stdout(
            repo_root,
            &["diff", "--name-status", &format!("{base}...{branch}")],
        )
        .map(|out| parse_name_status(&out))
        .unwrap_or_default();

        // Round subjects, newest first — what the release discard preflight
        // lists ([P14]). Empty when the dash has no rounds.
        let round_subjects = if rounds > 0 {
            git_stdout(
                repo_root,
                &["log", "--format=%s", &format!("{base}..{branch}")],
            )
            .map(|out| {
                out.lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
        } else {
            Vec::new()
        };

        // One dash-log read per dash per recompute — the log is small,
        // append-only, and parsed line by line. No plan markdown is read here
        // ([P01]): the declarations are the record this path derives from.
        let declarations = read_declarations(repo_root, name);

        entries.push(DashDetail {
            owner_key: dash_owner_key(repo_root, name),
            name: name.to_owned(),
            branch: branch.to_owned(),
            stage: derive_stage(
                rounds as i64,
                worktree_dirty,
                false,
                read_join_journal(repo_root, name).is_some(),
                declarations.latest,
            )
            .to_owned(),
            step_current: declarations.step.map(|(current, _)| current),
            step_total: declarations.step.map(|(_, total)| total),
            plan_path: dash_plan_path(repo_root, name),
            base,
            rounds,
            worktree_rel,
            worktree_dirty,
            files,
            round_subjects,
        });
    }
    entries
}

/// One dash's lifecycle readout (Spec S05) — the machine-readable answer to
/// "where is this dash?".
#[derive(Debug, Clone, Serialize)]
pub struct DashStatus {
    pub name: String,
    /// The owner key ([P01]).
    pub id: String,
    pub branch: String,
    pub base_branch: String,
    /// Derived lifecycle stage ([P06]) — see [`derive_stage`].
    pub stage: String,
    pub rounds: i64,
    pub worktree: String,
    pub worktree_dirty: bool,
    /// Whether a maintained join draft is on file.
    pub draft: bool,
    /// The join journal's phase when an interrupted landing left one.
    pub join_journal_phase: Option<String>,
    /// Live sessions mated to this dash ([P08]); empty when unresolvable, when
    /// the binding column has not migrated in yet, or when every bound card
    /// has closed — an empty list is how *parked* reads.
    pub bound_sessions: Vec<String>,
    /// How far a stepped run has got, from the latest step declaration.
    pub step_current: Option<i64>,
    pub step_total: Option<i64>,
    /// The plan this dash is driving, relative to its worktree ([P08]).
    pub plan_path: Option<String>,
}

/// The stage a dash is in, from what git derives and what the dash declared.
///
/// Precedence is `landing > declared > draft-ready > working > created`
/// ([P03]): a landing in flight outranks everything; otherwise the latest
/// declaration wins, because the last thing a run said about itself is the
/// truest current answer; only an undeclared dash falls through to the derived
/// chain, where an authored draft outranks mere activity and any round or
/// worktree dirt outranks a freshly created dash.
///
/// Declarations outrank `draft-ready` deliberately: a planned run writes its
/// join draft when it stops for the user's vet, *before* the audit, so a draft
/// that outranked declarations would make `audited` undisplayable.
///
/// The stage stays a plain word — `step_current`/`step_total` travel in their
/// own fields and displays compose the `implementing (3/9)` parenthetical.
pub fn derive_stage(
    rounds: i64,
    worktree_dirty: bool,
    has_draft: bool,
    landing: bool,
    declared: Option<DashDeclaration>,
) -> &'static str {
    if landing {
        "landing"
    } else if let Some(declaration) = declared {
        match declaration {
            DashDeclaration::Step { .. } => "implementing",
            DashDeclaration::Built => "built",
            DashDeclaration::Audited => "audited",
        }
    } else if has_draft {
        "draft-ready"
    } else if rounds > 0 || worktree_dirty {
        "working"
    } else {
        "created"
    }
}

/// Live sessions bound to `owner_key`, read read-only from the per-instance
/// `sessions.db` ([P08], [Q02] — this instance's view only).
///
/// **Live sessions only**, under the same predicate the tugcast-side query
/// uses: bound-ness is defined over live sessions, so a row that outlived its
/// card is never reported and a dash whose cards have all closed reads as
/// parked. Best-effort throughout — no db, no table, no `dash_id` column (an
/// unmigrated ledger) all read as an empty list.
fn bound_sessions_for(owner_key: &str) -> Vec<String> {
    let Some(db) = sessions_db_file() else {
        return Vec::new();
    };
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT session_id FROM sessions \
         WHERE dash_id = ?1 AND state = 'live' ORDER BY last_used_at DESC",
    ) else {
        return Vec::new();
    };
    stmt.query_map(rusqlite::params![owner_key], |row| row.get::<_, String>(0))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

/// One dash's lifecycle readout against `repo_root` (Spec S05).
///
/// A pure read path: it resolves the owner key without minting ([P02]).
pub fn status_in(repo_root: &Path, name: &str) -> Result<DashStatus, String> {
    let branch = branch_name(name);
    if !branch_exists(repo_root, &branch) {
        return Err(format!("Dash not found: {}", name));
    }

    let base_branch = dash_base(repo_root, name)?;
    let id = dash_owner_key(repo_root, name);
    let rounds = git_stdout(
        repo_root,
        &[
            "rev-list",
            "--count",
            &format!("{}..{}", base_branch, branch),
        ],
    )
    .ok()
    .and_then(|s| s.parse::<i64>().ok())
    .unwrap_or(0);

    let worktree = worktree_path(repo_root, name);
    let worktree_dirty = worktree.exists()
        && git_stdout(&worktree, &["status", "--porcelain"])
            .map(|s| !s.is_empty())
            .unwrap_or(false);

    let draft = dash_draft_message(repo_root, &branch).is_some();
    let join_journal_phase =
        read_join_journal(repo_root, name).map(|journal| format!("{:?}", journal.phase));
    let bound_sessions = bound_sessions_for(&id);
    let declarations = read_declarations(repo_root, name);

    Ok(DashStatus {
        stage: derive_stage(
            rounds,
            worktree_dirty,
            draft,
            join_journal_phase.is_some(),
            declarations.latest,
        )
        .to_string(),
        name: name.to_string(),
        id,
        branch,
        base_branch,
        rounds,
        worktree: worktree.to_string_lossy().into_owned(),
        worktree_dirty,
        draft,
        join_journal_phase,
        bound_sessions,
        step_current: declarations.step.map(|(current, _)| current as i64),
        step_total: declarations.step.map(|(_, total)| total as i64),
        plan_path: dash_plan_path(repo_root, name),
    })
}

/// [`status_in`] against the cwd's repo — the CLI's entry point.
pub fn status(name: &str) -> Result<DashStatus, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    migrate_worktrees(&repo_root, &mut Vec::new());
    status_in(&repo_root, name)
}

// --- steps ([P04], [P08]) --------------------------------------------------

/// A dash's plan association lives in its branch config, beside `tugid` ([P08])
/// — so `git branch -D` at teardown takes it with the rest of the section.
fn plan_config_key(name: &str) -> String {
    format!("branch.tugdash/{}.tugplan", name)
}

/// The worktree-relative path of the plan a dash is driving, when one was
/// recorded by a `dash step start --plan`.
pub fn dash_plan_path(repo: &Path, name: &str) -> Option<String> {
    config_get(repo, &plan_config_key(name))
}

/// Record the plan a dash is driving ([P08]).
pub fn set_dash_plan_path(repo: &Path, name: &str, rel: &str) -> Result<(), String> {
    let out = git_output(repo, &["config", &plan_config_key(name), rel])?;
    if !out.status.success() {
        return Err(format!(
            "failed to record plan path for {}: {}",
            name,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// What one `dash step` verb did (Spec S02).
#[derive(Debug, Clone, Serialize)]
pub struct StepOutcome {
    pub dash: String,
    /// The plan whose ledger moved, relative to the dash worktree.
    pub plan_path: String,
    pub step: u32,
    /// Ledger rows in the plan — the `N` of `i/N`.
    pub total: u32,
    /// The status the row now carries.
    pub status: String,
    /// The commit recorded in the row, on `done`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
}

/// Resolve which plan a step verb drives, as a path relative to the dash's
/// worktree ([P08]).
///
/// A `--plan` argument may be absolute or worktree-relative; either way the
/// resolved file must lie inside the worktree, because the plan a run edits is
/// the worktree copy. Nothing here consults the cwd: the skills' shell cwd is
/// not reliable, so the worktree is the only base.
fn resolve_plan_rel(worktree: &Path, plan: &str) -> Result<String, String> {
    let candidate = if Path::new(plan).is_absolute() {
        PathBuf::from(plan)
    } else {
        worktree.join(plan)
    };
    let resolved = std::fs::canonicalize(&candidate)
        .map_err(|_| format!("plan not found at {}", candidate.display()))?;
    let base = std::fs::canonicalize(worktree)
        .map_err(|e| format!("cannot resolve worktree {}: {e}", worktree.display()))?;
    let rel = resolved.strip_prefix(&base).map_err(|_| {
        format!(
            "plan {} is outside the dash worktree {}",
            resolved.display(),
            base.display()
        )
    })?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// Write `contents` over `path` without ever leaving a half-written plan on
/// disk: a sibling temp file, then a rename.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    let stem = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "plan".to_string());
    let tmp = dir.join(format!(".{stem}.tugtmp"));
    std::fs::write(&tmp, contents).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("cannot replace {}: {e}", path.display())
    })
}

/// Drive one ledger row and the dash-log in a single gesture ([P04]).
///
/// The edit is computed, verified, and only then written, so every refusal
/// leaves the plan byte-for-byte as it was. The log line is appended after the
/// write succeeds, which is what makes the log trustworthy for derivation
/// ([P01]) — a declaration exists only where the ledger moved.
fn step_in(
    repo_root: &Path,
    name: &str,
    step: u32,
    phase: StepPhase,
    plan: Option<&str>,
    commit: Option<&str>,
) -> Result<StepOutcome, String> {
    let branch = branch_name(name);
    let worktree = worktree_path(repo_root, name);
    if !branch_exists(repo_root, &branch) || !worktree.exists() {
        return Err(format!("Dash not found or not active: {}", name));
    }

    let rel = match plan {
        Some(path) => {
            let rel = resolve_plan_rel(&worktree, path)?;
            set_dash_plan_path(repo_root, name, &rel)?;
            rel
        }
        None => dash_plan_path(repo_root, name).ok_or_else(|| {
            format!(
                "dash '{name}' has no plan recorded; pass --plan <path> on the first step start"
            )
        })?,
    };

    let abs = worktree.join(&rel);
    let source = std::fs::read_to_string(&abs)
        .map_err(|e| format!("cannot read plan at {}: {e}", abs.display()))?;
    let doc =
        tugutil_core::plan::parse(&source).map_err(|_| format!("{rel} is not a plan document"))?;

    let anchor = format!("step-{step}");
    let total = doc.ledger_rows.len() as u32;
    let title = doc
        .ledger_rows
        .iter()
        .find(|r| r.anchor == anchor)
        .map(|r| r.title.clone())
        .ok_or_else(|| format!("{rel}: no ledger row for #{anchor}"))?;

    let status = match phase {
        StepPhase::Start => "in progress",
        StepPhase::Done => "done",
    };
    let sha = match phase {
        StepPhase::Start => None,
        StepPhase::Done => Some(match commit {
            Some(sha) => sha.trim().to_string(),
            None => git_stdout(repo_root, &["rev-parse", "--short", &branch])?,
        }),
    };

    let edited = tugutil_core::plan::set_ledger_status(&source, &anchor, status, sha.as_deref())
        .map_err(|e| format!("{rel}: {e}"))?;
    write_atomic(&abs, &edited)?;

    let note_tail = match &sha {
        Some(sha) => sha.clone(),
        None => format!("Step {step}: {title}"),
    };
    append_step_declaration(repo_root, name, phase, step, total, &note_tail)
        .map_err(|e| e.to_string())?;

    Ok(StepOutcome {
        dash: name.to_string(),
        plan_path: rel,
        step,
        total,
        status: status.to_string(),
        commit: sha,
    })
}

/// Begin a step: the ledger row goes `in progress` and the log records it.
///
/// Idempotent on a row already `in progress` ([P04]), so an interrupted run
/// re-enters the step it was on without a hand-edit.
pub fn step_start(name: &str, step: u32, plan: Option<&str>) -> Result<StepOutcome, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    migrate_worktrees(&repo_root, &mut Vec::new());
    step_in(&repo_root, name, step, StepPhase::Start, plan, None)
}

/// Finish a step: the ledger row goes `done` and records the round's commit.
pub fn step_done(name: &str, step: u32, commit: Option<&str>) -> Result<StepOutcome, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    migrate_worktrees(&repo_root, &mut Vec::new());
    step_in(&repo_root, name, step, StepPhase::Done, None, commit)
}

/// What a `dash mark` declared ([P09]).
#[derive(Debug, Clone, Serialize)]
pub struct MarkOutcome {
    pub dash: String,
    /// The stage now declared — also the log marker that recorded it.
    pub stage: String,
}

/// Declare a lifecycle stage git cannot see ([P09]).
///
/// The vocabulary is closed to `built` and `audited`, and the whole action is
/// one dash-log line: nothing else on disk changes, so a mark is safe from a
/// skill that is otherwise forbidden to write.
pub fn mark(name: &str, stage: MarkStage, note: Option<&str>) -> Result<MarkOutcome, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    if !branch_exists(&repo_root, &branch_name(name)) {
        return Err(format!("Dash not found: {}", name));
    }
    append_mark_declaration(&repo_root, name, stage, note.unwrap_or_default())
        .map_err(|e| e.to_string())?;
    Ok(MarkOutcome {
        dash: name.to_string(),
        stage: stage.marker().to_string(),
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

    // A round is a write-path touch, so a dash created by an older build
    // backfills its creation id here ([P02]).
    let _ = ensure_dash_id(&repo_root, name);

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
    tugcore::instance::resolve_sessions_db_path()
}

/// The committing session's identity for the commit trailers: the human
/// citation and the machine id ([P10], Spec S03).
///
/// `None` when it can't be resolved — no `TUG_SESSION_ID` env, no
/// `sessions.db`, or no row for that id. `tugutil dash commit` runs inside a
/// Claude session where tugcast exports `TUG_SESSION_ID`; the callsign is read
/// read-only from `sessions.db` (the `dash_draft_message` pattern). Any
/// absence omits both trailers silently — a commit never fails on trailer
/// resolution.
///
/// The citation grammar lives in `tugchanges_core::session_citation`, shared
/// with the deck-commit lane so the two can never drift.
pub(crate) fn session_citation() -> Option<(String, String)> {
    let session_id = std::env::var("TUG_SESSION_ID")
        .ok()
        .filter(|s| !s.is_empty())?;
    let db = sessions_db_file()?;
    let conn =
        rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    // No row → `query_row` errors → `.ok()?` omits the trailers.
    let tag: Option<String> = conn
        .query_row(
            "SELECT tag FROM sessions WHERE session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()?;
    let citation = tugchanges_core::session_citation(tag.as_deref(), &session_id);
    Some((citation, session_id))
}

/// Append the session trailers (when resolvable) + `Tug-Dash: <branch> onto
/// <base>` to a dash round-commit or join/squash message ([P08]/[P10], Spec
/// S02/S03). `base` comes from the dash's recorded base branch — the same
/// source `show()` / join use. Idempotent via `append_trailers`, so a draft
/// that already carries a trailer is never duplicated.
///
/// The session travels as a **pair**: `Tug-Session` is the human citation and
/// `Tug-Session-Id` the full uuid a reader joins against the ledger. Neither
/// is displayed as body ink — tugcast parses both into typed fields and strips
/// the lines.
fn with_dash_trailers(repo: &Path, name: &str, branch: &str, message: &str) -> String {
    let dash_value = match dash_base(repo, name) {
        Ok(base) if !base.is_empty() => format!("{branch} onto {base}"),
        _ => branch.to_string(),
    };
    let session = session_citation();
    let mut trailers: Vec<(&str, &str)> = Vec::new();
    if let Some((citation, id)) = session.as_ref() {
        trailers.push(("Tug-Session", citation.as_str()));
        trailers.push(("Tug-Session-Id", id.as_str()));
    }
    trailers.push(("Tug-Dash", dash_value.as_str()));
    tugchanges_core::append_trailers(message, &trailers)
}

/// The maintained join draft for a dash, read read-only from the
/// machine-global changes ledger (`tugcore::instance::changes_db_path()`,
/// `TUG_CHANGES_DB` overridable) — drafts are machine-global like the
/// working tree they describe. Spec S05 spelling contract: writers store
/// `project_dir` canonical, so query the canonical spelling and fall back
/// to the raw one when it differs.
///
/// The owner key migrates on a second axis ([P03]): rows land under
/// `tugdash/<name>#<tugid>` once a dash has a creation id, and older rows sit
/// under the bare branch ref. So the probe order is id key then legacy key,
/// each across both spellings — four probes worst case, first hit wins. A read
/// path, so it resolves the key without minting ([P02]).
pub(crate) fn dash_draft_message(repo: &Path, branch: &str) -> Option<String> {
    let db = tugcore::instance::changes_db_path();
    let conn =
        rusqlite::Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    let raw = repo.to_string_lossy().into_owned();
    let canonical = std::fs::canonicalize(repo)
        .unwrap_or_else(|_| repo.to_path_buf())
        .to_string_lossy()
        .into_owned();
    let read = |owner_id: &str, project: &str| -> Option<String> {
        conn.query_row(
            "SELECT message FROM changeset_drafts \
             WHERE owner_kind = 'dash' AND owner_id = ?1 AND project_dir = ?2",
            rusqlite::params![owner_id, project],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .filter(|m| !m.trim().is_empty())
    };
    let name = branch.trim_start_matches("tugdash/");
    let owner_key = dash_owner_key(repo, name);
    let mut keys = vec![owner_key.as_str()];
    if owner_key != branch {
        keys.push(branch);
    }
    keys.into_iter().find_map(|key| {
        read(key, &canonical).or_else(|| (canonical != raw).then(|| read(key, &raw)).flatten())
    })
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
        // Names the release verb generically ([P14]) — no raw terminal
        // instruction; each surface fronts its own release affordance.
        return Err(format!(
            "Nothing to join: dash '{}' has no commits past '{}'. Release it to discard.",
            name, base_branch
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

    /// A skeleton-valid plan with two ledger rows, for the step verbs to drive.
    const TWO_STEP_PLAN: &str = r#"## A Two Step Plan {#two-step-plan}

### Plan Metadata {#plan-metadata}

| Field | Value |
|---|---|
| Owner | Someone |

### Phase Overview {#phase-overview}

Some context.

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | The first step | pending | — |
| #step-2 | The second step | pending | — |

#### Step 1: The first step {#step-1}

**Commit:** `thing(scope): first`

**References:** [P01] the decision, (#phase-overview)

**Tasks:**
- [ ] Do the first thing.

**Tests:**
- [ ] Unit: the first thing works.

**Checkpoint:**
- [ ] `cargo nextest run`

#### Step 2: The second step {#step-2}

**Commit:** `thing(scope): second`

**References:** [P01] the decision, (#phase-overview)

**Tasks:**
- [ ] Do the second thing.

**Tests:**
- [ ] Unit: the second thing works.

**Checkpoint:**
- [ ] `cargo nextest run`

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** the thing.
"#;

    /// Stand up a repo with a dash whose worktree holds [`TWO_STEP_PLAN`].
    /// Returns the temp dir and the canonical repo root the verbs resolve to.
    fn stepped_dash(name: &str) -> (TempDir, std::path::PathBuf) {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&repo.join("state"));
        std::env::set_current_dir(repo).unwrap();
        create(name, None).unwrap();

        let worktree = worktree_path(repo, name);
        fs::create_dir_all(worktree.join("roadmap")).unwrap();
        fs::write(worktree.join("roadmap/plan.md"), TWO_STEP_PLAN).unwrap();

        let root = fs::canonicalize(repo).unwrap();
        (temp, root)
    }

    /// The ledger row for `anchor`, as the plan on disk now reads.
    fn ledger_row(root: &Path, name: &str, anchor: &str) -> tugutil_core::plan::LedgerRow {
        let source = fs::read_to_string(worktree_path(root, name).join("roadmap/plan.md")).unwrap();
        tugutil_core::plan::parse(&source)
            .unwrap()
            .ledger_rows
            .into_iter()
            .find(|r| r.anchor == anchor)
            .unwrap_or_else(|| panic!("no row for #{anchor}"))
    }

    #[serial]
    #[test]
    fn step_verbs_drive_the_ledger_and_the_dash_log_together() {
        let (_temp, root) = stepped_dash("step-dash");

        let started = step_start("step-dash", 1, Some("roadmap/plan.md")).unwrap();
        assert_eq!(started.plan_path, "roadmap/plan.md");
        assert_eq!((started.step, started.total), (1, 2));
        assert_eq!(started.status, "in progress");
        assert_eq!(
            ledger_row(&root, "step-dash", "step-1").status,
            "in progress"
        );
        assert_eq!(
            crate::dash::read_declarations(&root, "step-dash").latest,
            Some(crate::dash::DashDeclaration::Step {
                current: 1,
                total: 2
            })
        );

        let done = step_done("step-dash", 1, Some("abc1234")).unwrap();
        assert_eq!(done.commit.as_deref(), Some("abc1234"));
        let row = ledger_row(&root, "step-dash", "step-1");
        assert_eq!(row.status, "done");
        assert_eq!(row.commit.as_deref(), Some("abc1234"));

        // The recorded plan survives to a call that names no --plan.
        assert_eq!(
            dash_plan_path(&root, "step-dash").as_deref(),
            Some("roadmap/plan.md")
        );
        let next = step_start("step-dash", 2, None).unwrap();
        assert_eq!(next.plan_path, "roadmap/plan.md");
        assert_eq!(
            ledger_row(&root, "step-dash", "step-2").status,
            "in progress"
        );
    }

    #[serial]
    #[test]
    fn step_done_records_the_branch_tip_when_no_commit_is_named() {
        let (_temp, root) = stepped_dash("tip-dash");
        step_start("tip-dash", 1, Some("roadmap/plan.md")).unwrap();
        let tip = git_stdout(&root, &["rev-parse", "--short", "tugdash/tip-dash"]).unwrap();

        let done = step_done("tip-dash", 1, None).unwrap();
        assert_eq!(done.commit.as_deref(), Some(tip.as_str()));
        assert_eq!(
            ledger_row(&root, "tip-dash", "step-1").commit.as_deref(),
            Some(tip.as_str())
        );
    }

    #[serial]
    #[test]
    fn step_verbs_refuse_and_leave_the_plan_untouched() {
        let (_temp, root) = stepped_dash("refuse-dash");
        let plan = worktree_path(&root, "refuse-dash").join("roadmap/plan.md");
        let before = fs::read_to_string(&plan).unwrap();

        // No plan recorded and none named.
        let err = step_start("refuse-dash", 1, None).unwrap_err();
        assert!(err.contains("--plan"), "{err}");

        // A plan outside the dash worktree is not this dash's plan.
        fs::write(root.join("elsewhere.md"), TWO_STEP_PLAN).unwrap();
        let err = step_start("refuse-dash", 1, Some("../../../elsewhere.md")).unwrap_err();
        assert!(err.contains("outside the dash worktree"), "{err}");

        // A path that resolves to nothing.
        let err = step_start("refuse-dash", 1, Some("roadmap/missing.md")).unwrap_err();
        assert!(err.contains("plan not found"), "{err}");

        // An anchor the ledger does not carry.
        let err = step_start("refuse-dash", 9, Some("roadmap/plan.md")).unwrap_err();
        assert!(err.contains("no ledger row for #step-9"), "{err}");

        // A finished row refuses to be started again, naming its status.
        step_start("refuse-dash", 1, Some("roadmap/plan.md")).unwrap();
        step_done("refuse-dash", 1, Some("abc1234")).unwrap();
        let err = step_start("refuse-dash", 1, None).unwrap_err();
        assert!(err.contains("is 'done'"), "{err}");

        // Only the two successful calls moved the document.
        let after = fs::read_to_string(&plan).unwrap();
        assert_eq!(
            after.lines().filter(|l| l.starts_with("| #step-")).count(),
            2
        );
        assert_eq!(
            before.lines().count(),
            after.lines().count(),
            "no refusal added or dropped a line"
        );
    }

    /// A stepped dash reports its declared stage, its progress, and the plan it
    /// is driving; a mark moves the stage; a later step moves it back ([P03]).
    #[serial]
    #[test]
    fn status_reports_declared_stage_step_and_plan() {
        let (_temp, root) = stepped_dash("status-dash");

        // The seeded plan is uncommitted worktree dirt, so the undeclared dash
        // derives `working` exactly as it did before declarations existed.
        let fresh = status_in(&root, "status-dash").unwrap();
        assert_eq!(fresh.stage, "working");
        assert!(fresh.step_current.is_none() && fresh.plan_path.is_none());

        step_start("status-dash", 1, Some("roadmap/plan.md")).unwrap();
        let stepping = status_in(&root, "status-dash").unwrap();
        assert_eq!(stepping.stage, "implementing");
        assert_eq!(
            (stepping.step_current, stepping.step_total),
            (Some(1), Some(2))
        );
        assert_eq!(stepping.plan_path.as_deref(), Some("roadmap/plan.md"));

        mark("status-dash", MarkStage::Built, None).unwrap();
        let built = status_in(&root, "status-dash").unwrap();
        assert_eq!(built.stage, "built");
        // The step fields outlive the mark, so a display can still say how far.
        assert_eq!(built.step_current, Some(1));

        mark("status-dash", MarkStage::Audited, Some("good shape")).unwrap();
        assert_eq!(status_in(&root, "status-dash").unwrap().stage, "audited");

        // A follow-up step range demotes the dash back to implementing.
        step_start("status-dash", 2, None).unwrap();
        let again = status_in(&root, "status-dash").unwrap();
        assert_eq!(again.stage, "implementing");
        assert_eq!(again.step_current, Some(2));
    }

    /// The feed's shared composition carries the same declared stage and step
    /// progress `status` reports — which is what lights up the Lens Dashes
    /// section and the Changes dash lane with no frontend change ([P01]).
    #[serial]
    #[test]
    fn detail_entries_carry_declared_stage_and_step() {
        let (_temp, root) = stepped_dash("feed-dash");

        // A plain dash derives what it always did.
        let plain = dash_detail_entries_in(&root);
        let entry = plain.iter().find(|d| d.name == "feed-dash").unwrap();
        assert_eq!(entry.stage, "working");
        assert!(entry.step_current.is_none() && entry.step_total.is_none());

        step_start("feed-dash", 1, Some("roadmap/plan.md")).unwrap();
        let stepped = dash_detail_entries_in(&root);
        let entry = stepped.iter().find(|d| d.name == "feed-dash").unwrap();
        assert_eq!(entry.stage, "implementing");
        assert_eq!((entry.step_current, entry.step_total), (Some(1), Some(2)));

        mark("feed-dash", MarkStage::Built, None).unwrap();
        let built = dash_detail_entries_in(&root);
        let entry = built.iter().find(|d| d.name == "feed-dash").unwrap();
        assert_eq!(entry.stage, "built");
        assert_eq!(entry.step_current, Some(1));
    }

    /// The recorded plan path rides the same composition, so a card bound to a
    /// dash can resolve the plan it is implementing without a shell round-trip.
    #[serial]
    #[test]
    fn detail_entries_carry_the_recorded_plan_path() {
        let (_temp, root) = stepped_dash("plan-path-dash");

        let before = dash_detail_entries_in(&root);
        let entry = before.iter().find(|d| d.name == "plan-path-dash").unwrap();
        assert!(
            entry.plan_path.is_none(),
            "a dash no run has stepped records no plan: {:?}",
            entry.plan_path
        );

        step_start("plan-path-dash", 1, Some("roadmap/plan.md")).unwrap();
        let after = dash_detail_entries_in(&root);
        let entry = after.iter().find(|d| d.name == "plan-path-dash").unwrap();
        assert_eq!(entry.plan_path.as_deref(), Some("roadmap/plan.md"));
        // Worktree-relative, which is what makes the composition
        // `projectDir` / `worktree` / `plan_path` land on the copy a run edits.
        assert!(!entry.plan_path.as_deref().unwrap().starts_with('/'));
    }

    #[serial]
    #[test]
    fn mark_refuses_an_unknown_dash() {
        let (_temp, _root) = stepped_dash("known-dash");
        let err = mark("no-such-dash", MarkStage::Built, None).unwrap_err();
        assert!(err.contains("Dash not found"), "{err}");
    }

    #[serial]
    #[test]
    fn step_start_re_enters_an_interrupted_step() {
        let (_temp, root) = stepped_dash("resume-dash");
        step_start("resume-dash", 1, Some("roadmap/plan.md")).unwrap();
        let interrupted =
            fs::read_to_string(worktree_path(&root, "resume-dash").join("roadmap/plan.md"))
                .unwrap();

        step_start("resume-dash", 1, None).expect("a resumed run re-enters its own step");
        let after = fs::read_to_string(worktree_path(&root, "resume-dash").join("roadmap/plan.md"))
            .unwrap();
        assert_eq!(after, interrupted, "re-entry moves no byte of the plan");
    }

    #[test]
    fn legacy_owner_key_strips_the_id_and_passes_legacy_keys_through() {
        assert_eq!(
            legacy_owner_key("tugdash/x#1723500000000-a1b2c3"),
            "tugdash/x"
        );
        assert_eq!(legacy_owner_key("tugdash/x"), "tugdash/x");
        // A name with a dash in it is not a split point — only `#` is.
        assert_eq!(
            legacy_owner_key("tugdash/fix-join#1-abc"),
            "tugdash/fix-join"
        );
    }

    #[test]
    fn minted_ids_are_millis_dash_six_hex_and_do_not_repeat() {
        let a = mint_tugid();
        let b = mint_tugid();
        assert_ne!(a, b, "the nonce keeps same-millisecond mints apart");
        let (millis, nonce) = a.split_once('-').expect("millis-nonce shape");
        assert!(millis.parse::<u128>().unwrap() > 0);
        assert_eq!(nonce.len(), 6);
        assert!(
            nonce
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
    }

    /// `create` mints once and every later touch reports the same identity;
    /// a dash with no `tugid` reads under its legacy branch-ref key until a
    /// write verb backfills it ([P01], [P02], Risk R01).
    #[serial]
    #[test]
    fn test_dash_id_minted_once_and_backfilled_on_write() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        let first = create("id-dash", None).unwrap();
        let id = first.id.clone().expect("create mints an id");
        assert!(id.starts_with("tugdash/id-dash#"), "owner key shape: {id}");

        // The idempotent revisit reports the same identity, not a fresh mint.
        let second = create("id-dash", None).unwrap();
        assert!(!second.created);
        assert_eq!(second.id.as_deref(), Some(id.as_str()));

        // Every read verb agrees.
        assert_eq!(dash_owner_key(repo, "id-dash"), id);
        assert_eq!(show("id-dash").unwrap().id.as_deref(), Some(id.as_str()));
        let listed = list().unwrap();
        let entry = listed.iter().find(|d| d.name == "id-dash").unwrap();
        assert_eq!(entry.id.as_deref(), Some(id.as_str()));

        // An id-less dash (an older build's) reads under the legacy key, and a
        // read verb must not mint one ([P02]).
        run_git(repo, &["config", "--unset", "branch.tugdash/id-dash.tugid"]);
        assert_eq!(dash_owner_key(repo, "id-dash"), "tugdash/id-dash");
        let _ = show("id-dash").unwrap();
        assert_eq!(dash_owner_key(repo, "id-dash"), "tugdash/id-dash");

        // A round is a write path: it backfills.
        fs::write(repo.join(".tug/worktrees/id-dash/f.txt"), "x\n").unwrap();
        commit("id-dash", "Add f", None).unwrap();
        let backfilled = dash_owner_key(repo, "id-dash");
        assert!(backfilled.starts_with("tugdash/id-dash#"));
        assert_ne!(
            backfilled, id,
            "the backfill is a fresh mint, not the old id"
        );
    }

    /// The stage precedence table ([P03]): landing outranks a declaration, a
    /// declaration outranks a draft, a draft outranks activity, activity
    /// outranks a fresh dash.
    #[test]
    fn stage_derivation_follows_its_precedence() {
        // An undeclared dash derives exactly what it always did.
        assert_eq!(derive_stage(0, false, false, false, None), "created");
        assert_eq!(derive_stage(1, false, false, false, None), "working");
        assert_eq!(derive_stage(0, true, false, false, None), "working");
        assert_eq!(derive_stage(2, true, true, false, None), "draft-ready");
        // A draft with no work yet is still draft-ready — the draft is the
        // stronger signal.
        assert_eq!(derive_stage(0, false, true, false, None), "draft-ready");
        // A landing in flight outranks everything below it.
        assert_eq!(derive_stage(3, true, true, true, None), "landing");
        assert_eq!(derive_stage(0, false, false, true, None), "landing");

        let stepping = Some(DashDeclaration::Step {
            current: 3,
            total: 9,
        });
        // Declarations outrank a draft — a planned run writes its draft before
        // the audit, so a draft that won would hide `built` and `audited`.
        assert_eq!(derive_stage(2, true, true, false, stepping), "implementing");
        assert_eq!(
            derive_stage(2, true, true, false, Some(DashDeclaration::Built)),
            "built"
        );
        assert_eq!(
            derive_stage(2, true, true, false, Some(DashDeclaration::Audited)),
            "audited"
        );
        // …and a landing still outranks a declaration.
        assert_eq!(derive_stage(2, true, true, true, stepping), "landing");
    }

    /// `status` walks a dash's whole lifecycle: fresh → a round → an authored
    /// draft → an interrupted landing (Spec S05, [P06]).
    #[serial]
    #[test]
    fn test_dash_status_reports_each_stage() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();

        let changes_db = temp.path().join("changes.db");
        {
            let conn = rusqlite::Connection::open(&changes_db).unwrap();
            conn.execute_batch(
                "CREATE TABLE changeset_drafts (
                    owner_kind   TEXT NOT NULL,
                    owner_id     TEXT NOT NULL,
                    project_dir  TEXT NOT NULL,
                    fingerprint  TEXT NOT NULL,
                    message      TEXT NOT NULL,
                    updated_at   INTEGER NOT NULL,
                    edited       INTEGER NOT NULL DEFAULT 0,
                    selection    TEXT,
                    PRIMARY KEY (owner_kind, owner_id, project_dir)
                );",
            )
            .unwrap();
        }
        // SAFETY: serial test; see redirect_state_dir.
        unsafe {
            std::env::set_var("TUG_CHANGES_DB", &changes_db);
        }

        let created = create("status-dash", Some("Test".to_string())).unwrap();
        let owner_key = created.id.clone().unwrap();

        let fresh = status("status-dash").unwrap();
        assert_eq!(fresh.stage, "created");
        assert_eq!(fresh.id, owner_key);
        assert_eq!(fresh.branch, "tugdash/status-dash");
        assert_eq!(fresh.base_branch, "main");
        assert_eq!(fresh.rounds, 0);
        assert!(!fresh.draft);
        assert!(fresh.join_journal_phase.is_none());
        // Phase 3's slots stay empty here ([P06]).
        assert!(fresh.step_current.is_none() && fresh.step_total.is_none());

        // Uncommitted work is already `working`.
        let worktree = repo.join(".tug/worktrees/status-dash");
        fs::write(worktree.join("f.txt"), "x\n").unwrap();
        let dirty = status("status-dash").unwrap();
        assert_eq!(dirty.stage, "working");
        assert!(dirty.worktree_dirty);

        commit("status-dash", "Add f", None).unwrap();
        let after_round = status("status-dash").unwrap();
        assert_eq!(after_round.stage, "working");
        assert_eq!(after_round.rounds, 1);
        assert!(!after_round.worktree_dirty);

        // An authored draft, under the id-qualified key writers use.
        {
            let conn = rusqlite::Connection::open(&changes_db).unwrap();
            let project = fs::canonicalize(repo)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            conn.execute(
                "INSERT INTO changeset_drafts
                    (owner_kind, owner_id, project_dir, fingerprint, message, updated_at, edited)
                 VALUES ('dash', ?1, ?2, 'fp', 'Land the work', 1, 1)",
                rusqlite::params![owner_key, project],
            )
            .unwrap();
        }
        let drafted = status("status-dash").unwrap();
        assert_eq!(drafted.stage, "draft-ready");
        assert!(drafted.draft);

        // An interrupted landing leaves a journal, and outranks the draft.
        // Written against the canonical repo path, which is what
        // `find_repo_root` (and so `status`) resolves — the state-dir slug
        // must agree.
        let canonical_repo = fs::canonicalize(repo).unwrap();
        write_join_journal(
            &canonical_repo,
            &JoinJournal {
                name: "status-dash".to_string(),
                base_branch: "main".to_string(),
                strategy: "squash".to_string(),
                commit_hash: "abc1234".to_string(),
                phase: JoinPhase::WorktreeRemoved,
            },
        )
        .unwrap();
        let landing = status("status-dash").unwrap();
        assert_eq!(landing.stage, "landing");
        assert_eq!(
            landing.join_journal_phase.as_deref(),
            Some("WorktreeRemoved")
        );

        // No sessions.db with a binding, so the dash reads as parked ([P08]).
        assert!(landing.bound_sessions.is_empty());

        assert!(status("no-such-dash").is_err());

        // SAFETY: serial test; see redirect_state_dir.
        unsafe {
            std::env::remove_var("TUG_CHANGES_DB");
        }
    }

    /// `bound_sessions` counts **live** sessions only, so a dash whose only
    /// bound card has closed reads as parked ([P08]) — the CLI-side face of
    /// the [L27] pin.
    #[serial]
    #[test]
    fn test_dash_status_bound_sessions_are_live_only() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        let sessions_db = temp.path().join("sessions.db");
        {
            let conn = rusqlite::Connection::open(&sessions_db).unwrap();
            conn.execute_batch(
                "CREATE TABLE sessions (
                    session_id   TEXT PRIMARY KEY,
                    state        TEXT NOT NULL,
                    last_used_at INTEGER NOT NULL,
                    dash_id      TEXT
                );",
            )
            .unwrap();
        }
        // SAFETY: serial test; see redirect_state_dir.
        unsafe {
            std::env::set_var("TUG_SESSIONS_DB", &sessions_db);
        }

        let owner_key = create("parked-dash", None).unwrap().id.unwrap();
        {
            let conn = rusqlite::Connection::open(&sessions_db).unwrap();
            conn.execute(
                "INSERT INTO sessions (session_id, state, last_used_at, dash_id)
                 VALUES ('sess-live', 'live', 2, ?1), ('sess-closed', 'closed', 1, ?1)",
                rusqlite::params![owner_key],
            )
            .unwrap();
        }

        assert_eq!(
            status("parked-dash").unwrap().bound_sessions,
            vec!["sess-live".to_string()],
            "a closed session's row is never reported as a mating"
        );

        // With the last live session closed, the dash is parked.
        {
            let conn = rusqlite::Connection::open(&sessions_db).unwrap();
            conn.execute("UPDATE sessions SET state = 'closed'", [])
                .unwrap();
        }
        assert!(status("parked-dash").unwrap().bound_sessions.is_empty());

        // SAFETY: serial test; see redirect_state_dir.
        unsafe {
            std::env::remove_var("TUG_SESSIONS_DB");
        }
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

    /// A join with no explicit message uses the dash's maintained draft from
    /// the machine-global changes ledger (`TUG_CHANGES_DB`) as its squash
    /// message — pins `dash_draft_message` reading
    /// `changes.changeset_drafts`, not the legacy per-instance `sessions.db`.
    #[serial]
    #[test]
    fn test_dash_join_uses_changes_ledger_draft_message() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();

        // Seed the machine-global draft row under the canonical repo
        // spelling (Spec S05 write contract).
        let changes_db = temp.path().join("changes.db");
        {
            let conn = rusqlite::Connection::open(&changes_db).unwrap();
            conn.execute_batch(
                "CREATE TABLE changeset_drafts (
                    owner_kind   TEXT NOT NULL,
                    owner_id     TEXT NOT NULL,
                    project_dir  TEXT NOT NULL,
                    fingerprint  TEXT NOT NULL,
                    message      TEXT NOT NULL,
                    updated_at   INTEGER NOT NULL,
                    edited       INTEGER NOT NULL DEFAULT 0,
                    selection    TEXT,
                    PRIMARY KEY (owner_kind, owner_id, project_dir)
                );",
            )
            .unwrap();
            let project = fs::canonicalize(repo)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            conn.execute(
                "INSERT INTO changeset_drafts
                    (owner_kind, owner_id, project_dir, fingerprint, message, updated_at, edited)
                 VALUES ('dash', 'tugdash/draft-dash', ?1, 'fp', 'Land the drafted work', 1, 1)",
                rusqlite::params![project],
            )
            .unwrap();
        }
        // SAFETY: serial test; see redirect_state_dir.
        unsafe {
            std::env::set_var("TUG_CHANGES_DB", &changes_db);
        }

        create("draft-dash", Some("Test".to_string())).unwrap();
        let worktree = repo.join(".tug/worktrees/draft-dash");
        fs::write(worktree.join("f.txt"), "x\n").unwrap();
        commit("draft-dash", "Add f", None).unwrap();

        // Preview first (`/join`'s beat 1): in-memory, clean, mutates nothing.
        let preview = join(
            "draft-dash",
            JoinOptions {
                preview: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(preview.previewed);
        assert!(preview.conflicts.is_empty(), "clean preview");
        assert!(preview.commit_hash.is_none(), "a preview lands nothing");
        assert!(
            worktree.exists() && branch_present(repo, "tugdash/draft-dash"),
            "a preview tears nothing down"
        );

        // Execute: the squash message comes from the ledger draft.
        join("draft-dash", JoinOptions::default()).unwrap();

        // SAFETY: serial test; clear before the next test resolves the path.
        unsafe {
            std::env::remove_var("TUG_CHANGES_DB");
        }

        let log = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["log", "-1", "--format=%B"])
            .output()
            .unwrap();
        let body = String::from_utf8_lossy(&log.stdout);
        assert!(
            body.contains("tugdash(draft-dash): Land the drafted work"),
            "squash message comes from the changes-ledger draft: {body}"
        );
        assert!(
            body.contains("Tug-Dash: tugdash/draft-dash onto "),
            "the squash carries the Tug-Dash trailer: {body}"
        );
    }

    /// Round commits and the join/squash commit carry the `Tug-Dash:` trailer
    /// ([P08], Spec S02). With no `TUG_SESSION_ID` in the environment the
    /// `Tug-Session:` trailer is omitted (no error).
    /// A join reaches the dash's draft under the id-qualified owner key — the
    /// key writers use once a dash has a creation id ([P01], [P03], Spec S02).
    /// Same fixture as the legacy-key case above; only the key differs.
    #[serial]
    #[test]
    fn test_dash_join_uses_id_keyed_draft_message() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        redirect_state_dir(&home);
        std::env::set_current_dir(repo).unwrap();

        let changes_db = temp.path().join("changes.db");
        {
            let conn = rusqlite::Connection::open(&changes_db).unwrap();
            conn.execute_batch(
                "CREATE TABLE changeset_drafts (
                    owner_kind   TEXT NOT NULL,
                    owner_id     TEXT NOT NULL,
                    project_dir  TEXT NOT NULL,
                    fingerprint  TEXT NOT NULL,
                    message      TEXT NOT NULL,
                    updated_at   INTEGER NOT NULL,
                    edited       INTEGER NOT NULL DEFAULT 0,
                    selection    TEXT,
                    PRIMARY KEY (owner_kind, owner_id, project_dir)
                );",
            )
            .unwrap();
        }
        // SAFETY: serial test; see redirect_state_dir.
        unsafe {
            std::env::set_var("TUG_CHANGES_DB", &changes_db);
        }

        let created = create("id-draft-dash", Some("Test".to_string())).unwrap();
        let owner_key = created.id.expect("created dash has an owner key");
        assert!(owner_key.contains('#'), "id-qualified: {owner_key}");

        // Seed the draft under the owner key the writers now use.
        {
            let conn = rusqlite::Connection::open(&changes_db).unwrap();
            let project = fs::canonicalize(repo)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            conn.execute(
                "INSERT INTO changeset_drafts
                    (owner_kind, owner_id, project_dir, fingerprint, message, updated_at, edited)
                 VALUES ('dash', ?1, ?2, 'fp', 'Land the id-keyed work', 1, 1)",
                rusqlite::params![owner_key, project],
            )
            .unwrap();
        }

        let worktree = repo.join(".tug/worktrees/id-draft-dash");
        fs::write(worktree.join("f.txt"), "x\n").unwrap();
        commit("id-draft-dash", "Add f", None).unwrap();

        join("id-draft-dash", JoinOptions::default()).unwrap();

        let log = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["log", "--format=%B", "-1"])
            .output()
            .unwrap();
        let body = String::from_utf8_lossy(&log.stdout);
        assert!(
            body.contains("Land the id-keyed work"),
            "the id-keyed draft is the squash message: {body}"
        );

        // SAFETY: serial test; see redirect_state_dir.
        unsafe {
            std::env::remove_var("TUG_CHANGES_DB");
        }
    }

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
        // the test never flakes on a runner that happens to export it. Both
        // keys travel together — neither lands without the other.
        if std::env::var("TUG_SESSION_ID").is_err() {
            assert!(
                !round.contains("Tug-Session:"),
                "no session env → no Tug-Session: {round}"
            );
            assert!(
                !round.contains("Tug-Session-Id:"),
                "no session env → no Tug-Session-Id: {round}"
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
