//! Dash CLI commands
//!
//! Lightweight, worktree-isolated work units driven entirely on git: a dash
//! *is* a branch (`tugdash/<name>`) plus a worktree
//! (`.tugtree/tugdash__<name>`). Its base branch and description live in git
//! config (`branch.tugdash/<name>.{tugbase,description}`); its activity is
//! recorded in the per-project append-only dash-log. There is no database.

use clap::Subcommand;
use serde::Serialize;
use std::io::{self, IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use tugutil_core::{
    Config, DashRoundMeta, append_dash_log, detect_default_branch, find_repo_root,
    sanitize_branch_name, validate_dash_name,
};

use crate::output::JsonResponse;

/// Dash subcommands
#[derive(Subcommand, Debug)]
pub enum DashCommands {
    /// Create a new dash
    ///
    /// Creates a git worktree and branch for lightweight work.
    #[command(
        long_about = "Create a new dash.\n\nCreates:\n  - Branch tugdash/<name> from the detected base branch\n  - Worktree at .tugtree/tugdash__<name>/\n\nStores the base branch and description in git config.\nRuns the project's [tugtool.dash] post_create hook to hydrate the worktree.\nIdempotent: returns the existing worktree+branch as-is on a second call."
    )]
    Create {
        /// Dash name (alphanumeric + hyphens, 2+ chars)
        name: String,

        /// Description of the work
        #[arg(long)]
        description: Option<String>,
    },

    /// Commit changes in a dash worktree
    ///
    /// Commits git changes if present and appends a dash-log line.
    #[command(
        long_about = "Commit changes in a dash worktree.\n\nStages and commits the worktree if it is dirty, then appends one line to the\nper-project dash-log. Reads round metadata (instruction/summary) from stdin as JSON."
    )]
    Commit {
        /// Dash name
        name: String,

        /// Git commit message
        #[arg(long)]
        message: String,
    },

    /// Join a dash (squash-merge to base branch)
    ///
    /// Merges the dash's work back to the base branch and cleans up.
    #[command(
        long_about = "Join a dash (squash-merge to base branch).\n\nSequence:\n  1. Preflight: check the base worktree is clean\n  2. Verify: current branch matches the dash's base (from git config)\n  3. Auto-commit: outstanding changes in the dash worktree\n  4. Squash-merge: tugdash/<name> into the base branch\n  5. Cleanup: remove the worktree and branch; append a joined line to the dash-log"
    )]
    Join {
        /// Dash name
        name: String,

        /// Custom commit message (default: uses dash description)
        #[arg(long)]
        message: Option<String>,
    },

    /// Release a dash (discard without merging)
    ///
    /// Removes the dash's worktree and branch without merging.
    #[command(
        long_about = "Release a dash (discard without merging).\n\nRemoves:\n  - Worktree directory\n  - Branch tugdash/<name>\n\nAppends a released line to the dash-log. Warns on partial cleanup failure."
    )]
    Release {
        /// Dash name
        name: String,
    },

    /// List all dashes
    ///
    /// Shows every active dash, derived from git.
    #[command(
        long_about = "List all dashes.\n\nDerived from git: every tugdash/* branch is an active dash. Displays the\ndash name, commit count ahead of its base, and worktree path."
    )]
    List,

    /// Show detailed dash information
    ///
    /// Displays dash metadata and commits.
    #[command(
        long_about = "Show detailed dash information.\n\nDisplays the dash metadata (name, description, branch, worktree, base) plus the\ncommits ahead of its base and any uncommitted changes in the worktree."
    )]
    Show {
        /// Dash name
        name: String,
    },
}

#[derive(Serialize)]
struct CreateResponse {
    name: String,
    description: Option<String>,
    branch: String,
    worktree: String,
    base_branch: String,
    status: String,
    created: bool,
}

#[derive(Serialize)]
struct ListResponse {
    dashes: Vec<DashListItem>,
}

#[derive(Serialize)]
struct DashListItem {
    name: String,
    description: Option<String>,
    status: String,
    round_count: i64,
    worktree: Option<String>,
    base_branch: String,
}

#[derive(Serialize)]
struct ShowResponse {
    name: String,
    description: Option<String>,
    branch: String,
    worktree: String,
    base_branch: String,
    status: String,
    rounds: Vec<RoundItem>,
    uncommitted_changes: Option<bool>,
}

#[derive(Serialize)]
struct RoundItem {
    commit_hash: String,
    summary: String,
    started_at: String,
}

#[derive(Serialize)]
struct CommitResponse {
    committed: bool,
    commit_hash: Option<String>,
}

#[derive(Serialize)]
struct JoinResponse {
    name: String,
    base_branch: String,
    commit_hash: String,
    warnings: Vec<String>,
}

#[derive(Serialize)]
struct ReleaseResponse {
    name: String,
    warnings: Vec<String>,
}

// --- git helpers -----------------------------------------------------------

/// Run a git command in `dir`, returning its raw output.
fn git_output(dir: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git {}: {}", args.join(" "), e))
}

/// Run a git command in `dir`, returning trimmed stdout on success.
fn git_stdout(dir: &Path, args: &[&str]) -> Result<String, String> {
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
fn config_get(repo: &Path, key: &str) -> Option<String> {
    let out = git_output(repo, &["config", "--get", key]).ok()?;
    if !out.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn branch_name(name: &str) -> String {
    format!("tugdash/{}", name)
}

fn worktree_path(repo: &Path, name: &str) -> PathBuf {
    repo.join(".tugtree")
        .join(format!("tugdash__{}", sanitize_branch_name(name)))
}

fn branch_exists(repo: &Path, branch: &str) -> bool {
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
        super::instance::reap_instance_tmux(&format!("{profile}-{slug}"));
    }
}

/// Resolve a dash's base branch: git config first ([P03]), else detection.
fn dash_base(repo: &Path, name: &str) -> Result<String, String> {
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

/// Run dash create subcommand
pub fn run_dash_create(
    name: String,
    description: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    validate_dash_name(&name).map_err(|e| e.to_string())?;

    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    let base_branch = detect_default_branch(&repo_root).map_err(|e| e.to_string())?;
    let branch = branch_name(&name);
    let worktree = worktree_path(&repo_root, &name);

    let have_branch = branch_exists(&repo_root, &branch);
    let have_worktree = worktree.exists();

    // Idempotent: a fully-present dash returns as-is, with no re-hydration.
    if have_branch && have_worktree {
        let description = description
            .or_else(|| config_get(&repo_root, &format!("branch.{}.description", branch)));
        let base = dash_base(&repo_root, &name).unwrap_or(base_branch);
        return emit_create(
            CreateResponse {
                name,
                description,
                branch,
                worktree: worktree.to_string_lossy().into_owned(),
                base_branch: base,
                status: "active".to_string(),
                created: false,
            },
            json,
            quiet,
        );
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

    emit_create(
        CreateResponse {
            name,
            description,
            branch,
            worktree: worktree.to_string_lossy().into_owned(),
            base_branch,
            status: "active".to_string(),
            created: true,
        },
        json,
        quiet,
    )
}

fn emit_create(data: CreateResponse, json: bool, quiet: bool) -> Result<i32, String> {
    if json {
        let response = JsonResponse::ok("dash create", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        if data.created {
            println!("Created dash '{}'", data.name);
        } else {
            println!("Dash '{}' already exists (active)", data.name);
        }
        println!("  Worktree: {}", data.worktree);
        println!("  Branch: {}", data.branch);
        println!("  Base: {}", data.base_branch);
    }
    Ok(0)
}

/// Run dash list subcommand
pub fn run_dash_list(json: bool, quiet: bool) -> Result<i32, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;

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

    if json {
        let response = JsonResponse::ok("dash list", ListResponse { dashes: items });
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        if items.is_empty() {
            println!("No dashes found");
        } else {
            for item in &items {
                println!("{} (active, {} rounds)", item.name, item.round_count);
                if let Some(worktree) = &item.worktree {
                    println!("  Worktree: {}", worktree);
                } else {
                    println!("  Worktree: (missing)");
                }
                println!("  Base: {}", item.base_branch);
            }
        }
    }

    Ok(0)
}

/// Run dash show subcommand
pub fn run_dash_show(name: String, json: bool, quiet: bool) -> Result<i32, String> {
    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    let branch = branch_name(&name);

    if !branch_exists(&repo_root, &branch) {
        return Err(format!("Dash not found: {}", name));
    }

    let base = dash_base(&repo_root, &name)?;
    let description = config_get(&repo_root, &format!("branch.{}.description", branch));
    let worktree = worktree_path(&repo_root, &name);

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

    if json {
        let data = ShowResponse {
            name: name.clone(),
            description,
            branch,
            worktree: worktree.to_string_lossy().into_owned(),
            base_branch: base,
            status: "active".to_string(),
            rounds,
            uncommitted_changes,
        };
        let response = JsonResponse::ok("dash show", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Dash: {}", name);
        if let Some(desc) = &description {
            println!("Description: {}", desc);
        }
        println!("Status: active");
        println!("Branch: {}", branch);
        println!("Worktree: {}", worktree.to_string_lossy());
        println!("Base: {}", base);
        if let Some(has_changes) = uncommitted_changes {
            println!(
                "Uncommitted changes: {}",
                if has_changes { "yes" } else { "no" }
            );
        }
        println!("\nRounds ({}):", rounds.len());
        for round in &rounds {
            println!("  {} {}", round.commit_hash, round.started_at);
            if !round.summary.is_empty() {
                println!("    {}", round.summary);
            }
        }
    }

    Ok(0)
}

/// Run dash commit subcommand
pub fn run_dash_commit(
    name: String,
    message: String,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    // Read round metadata from stdin if available.
    let round_meta: Option<DashRoundMeta> = if !io::stdin().is_terminal() {
        let mut stdin_content = String::new();
        io::stdin()
            .read_to_string(&mut stdin_content)
            .map_err(|e| format!("failed to read stdin: {}", e))?;

        if stdin_content.trim().is_empty() {
            None
        } else {
            match serde_json::from_str::<DashRoundMeta>(&stdin_content) {
                Ok(meta) => Some(meta),
                Err(e) => return Err(format!("failed to parse round metadata JSON: {}", e)),
            }
        }
    } else {
        None
    };

    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    let branch = branch_name(&name);
    let worktree = worktree_path(&repo_root, &name);

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
            message.clone()
        } else {
            format!("{}\n\n{}", message, summary)
        };

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
    append_dash_log(&repo_root, &name, marker, instruction).map_err(|e| e.to_string())?;

    if json {
        let data = CommitResponse {
            committed: has_changes,
            commit_hash: commit_hash.clone(),
        };
        let response = JsonResponse::ok("dash commit", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        if has_changes {
            println!("Committed changes to dash '{}'", name);
            if let Some(hash) = &commit_hash {
                println!("  Commit: {}", hash);
            }
        } else {
            println!("No changes to commit for dash '{}'", name);
        }
    }

    Ok(0)
}

/// Run dash join subcommand
pub fn run_dash_join(
    name: String,
    message: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    let mut warnings = Vec::new();

    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    let branch = branch_name(&name);
    let worktree = worktree_path(&repo_root, &name);

    if !branch_exists(&repo_root, &branch) {
        return Err(format!("Dash not found: {}", name));
    }

    let base_branch = dash_base(&repo_root, &name)?;
    let description = config_get(&repo_root, &format!("branch.{}.description", branch));

    // Preflight: base worktree must be clean (tracked files only).
    let base_status = git_stdout(
        &repo_root,
        &["status", "--porcelain", "--untracked-files=no"],
    )?;
    if !base_status.is_empty() {
        return Err(
            "Cannot join: repo root worktree has uncommitted changes. Commit or stash them first."
                .to_string(),
        );
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

    // Auto-commit any outstanding changes in the dash worktree.
    if worktree.exists() {
        let dash_status = git_stdout(&worktree, &["status", "--porcelain"])?;
        if !dash_status.is_empty() {
            let _ = git_output(&worktree, &["add", "-A"]);
            let _ = git_output(
                &worktree,
                &["commit", "-m", "join: commit outstanding changes"],
            );
        }
    }

    // Squash-merge from the base worktree.
    let merge = git_output(&repo_root, &["merge", "--squash", &branch])?;
    if !merge.status.success() {
        let stderr = String::from_utf8_lossy(&merge.stderr);
        if stderr.to_lowercase().contains("conflict") {
            return Err(format!(
                "Merge conflict occurred. Resolve manually with:\n  git merge --abort\nThen fix conflicts or use: tugutil dash release {}",
                name
            ));
        }
        return Err(format!("git merge --squash failed: {}", stderr.trim()));
    }

    // Commit on the base branch with the tugdash prefix.
    let commit_message = message
        .clone()
        .or(description)
        .unwrap_or_else(|| "Dash work".to_string());
    let final_commit_msg = format!("tugdash({}): {}", name, commit_message);
    let commit = git_output(&repo_root, &["commit", "-m", &final_commit_msg])?;
    if !commit.status.success() {
        return Err(format!(
            "git commit failed: {}",
            String::from_utf8_lossy(&commit.stderr).trim()
        ));
    }
    let commit_hash = git_stdout(&repo_root, &["rev-parse", "HEAD"])?;

    // Remove the worktree (warn on failure).
    if worktree.exists() {
        let out = git_output(
            &repo_root,
            &["worktree", "remove", &worktree.to_string_lossy()],
        );
        match out {
            Ok(o) if !o.status.success() => warnings.push(format!(
                "Failed to remove worktree: {}",
                String::from_utf8_lossy(&o.stderr).trim()
            )),
            Err(e) => warnings.push(format!("Failed to remove worktree: {}", e)),
            _ => {}
        }
    }

    // Reap the removed worktree's tmux server/session so it doesn't leak.
    reap_dash_tmux(&branch);

    // Delete the branch (warn on failure).
    match git_output(&repo_root, &["branch", "-D", &branch]) {
        Ok(o) if !o.status.success() => warnings.push(format!(
            "Failed to delete branch: {}",
            String::from_utf8_lossy(&o.stderr).trim()
        )),
        Err(e) => warnings.push(format!("Failed to delete branch: {}", e)),
        _ => {}
    }

    // Record the terminal action in the dash-log ([P04], R01).
    let short = git_stdout(&repo_root, &["rev-parse", "--short", &commit_hash])
        .unwrap_or_else(|_| commit_hash.clone());
    append_dash_log(&repo_root, &name, &short, "joined").map_err(|e| e.to_string())?;

    if json {
        let data = JoinResponse {
            name: name.clone(),
            base_branch: base_branch.clone(),
            commit_hash: commit_hash.clone(),
            warnings: warnings.clone(),
        };
        let response = JsonResponse::ok("dash join", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Joined dash '{}' to branch '{}'", name, base_branch);
        println!("  Commit: {}", commit_hash);
        for warning in &warnings {
            println!("  Warning: {}", warning);
        }
    }

    Ok(0)
}

/// Run dash release subcommand
pub fn run_dash_release(name: String, json: bool, quiet: bool) -> Result<i32, String> {
    let mut warnings = Vec::new();

    let repo_root = find_repo_root().map_err(|e| e.to_string())?;
    let branch = branch_name(&name);
    let worktree = worktree_path(&repo_root, &name);

    if !branch_exists(&repo_root, &branch) && !worktree.exists() {
        return Err(format!("Dash not found: {}", name));
    }

    // Remove the worktree with --force (warn on failure).
    if worktree.exists() {
        let out = git_output(
            &repo_root,
            &["worktree", "remove", "--force", &worktree.to_string_lossy()],
        );
        match out {
            Ok(o) if !o.status.success() => warnings.push(format!(
                "Failed to remove worktree: {}",
                String::from_utf8_lossy(&o.stderr).trim()
            )),
            Err(e) => warnings.push(format!("Failed to remove worktree: {}", e)),
            _ => {}
        }
    }

    // Reap the removed worktree's tmux server/session so it doesn't leak.
    reap_dash_tmux(&branch);

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
    append_dash_log(&repo_root, &name, "released", "").map_err(|e| e.to_string())?;

    if json {
        let data = ReleaseResponse {
            name: name.clone(),
            warnings: warnings.clone(),
        };
        let response = JsonResponse::ok("dash release", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Released dash '{}'", name);
        for warning in &warnings {
            println!("  Warning: {}", warning);
        }
    }

    Ok(0)
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
        assert_eq!(branch_slug("tugdash/Focus_Gallery"), "tugdash-focus-gallery");
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

    #[serial]
    #[test]
    fn test_dash_create_basic() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        let result = run_dash_create(
            "test-dash".to_string(),
            Some("desc".to_string()),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

        assert!(repo.join(".tugtree/tugdash__test-dash").exists());
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

        run_dash_create(
            "test-dash".to_string(),
            Some("first".to_string()),
            false,
            true,
        )
        .unwrap();
        // Second create returns the existing dash without error.
        let result = run_dash_create(
            "test-dash".to_string(),
            Some("second".to_string()),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);
        assert!(repo.join(".tugtree/tugdash__test-dash").exists());
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

        run_dash_create("hooky".to_string(), None, false, true).unwrap();
        let marker = repo.join(".tugtree/tugdash__hooky/hook-marker.txt");
        assert!(marker.exists(), "post_create should run on creation");
        assert_eq!(fs::read_to_string(&marker).unwrap().lines().count(), 1);

        // Idempotent resume must NOT re-run the hook.
        run_dash_create("hooky".to_string(), None, false, true).unwrap();
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

        let result = run_dash_create("doomed".to_string(), None, false, true);
        assert!(result.is_err(), "failing hook should fail create");

        // Rollback: neither worktree nor branch survive.
        assert!(!repo.join(".tugtree/tugdash__doomed").exists());
        assert!(!branch_present(repo, "tugdash/doomed"));

        // A retry (with a passing hook) then succeeds cleanly.
        write_config(repo, &[]);
        let retry = run_dash_create("doomed".to_string(), None, false, true);
        assert_eq!(retry.unwrap(), 0);
        assert!(repo.join(".tugtree/tugdash__doomed").exists());
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

        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        let worktree = repo.join(".tugtree/tugdash__test-dash");
        fs::write(worktree.join("test.txt"), "content\n").unwrap();

        let result = run_dash_commit(
            "test-dash".to_string(),
            "Add test file".to_string(),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

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

        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        let result = run_dash_commit(
            "test-dash".to_string(),
            "No changes".to_string(),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

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

        run_dash_create("test-dash".to_string(), None, false, true).unwrap();
        let worktree = repo.join(".tugtree/tugdash__test-dash");
        fs::write(worktree.join("f.txt"), "x\n").unwrap();

        // A subprocess feeds the long multibyte summary via stdin metadata.
        use std::io::Write;
        use std::process::{Command as StdCommand, Stdio};
        let tugutil_bin = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("tugutil");
        let long_multibyte = "é".repeat(50); // 100 bytes, 50 chars — straddles byte 72
        let meta = format!(
            "{{\"instruction\":\"i\",\"summary\":\"{}\"}}",
            long_multibyte
        );
        let mut child = StdCommand::new(&tugutil_bin)
            .args(["dash", "commit", "test-dash", "--message", "feat: thing"])
            .current_dir(repo)
            .env("TUG_DATA_DIR", temp.path().join("state"))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(meta.as_bytes())
            .unwrap();
        assert!(child.wait().unwrap().success(), "commit must not panic");

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
    fn test_dash_commit_with_stdin_metadata() {
        use std::io::Write;
        use std::process::{Command as StdCommand, Stdio};

        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        let home = temp.path().join("state");
        init_git_repo(repo);
        std::env::set_current_dir(repo).unwrap();
        redirect_state_dir(&home);

        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        let worktree = repo.join(".tugtree/tugdash__test-dash");
        fs::write(worktree.join("test.txt"), "test\n").unwrap();

        let tugutil_bin = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("tugutil");

        let mut child = StdCommand::new(&tugutil_bin)
            .arg("dash")
            .arg("commit")
            .arg("test-dash")
            .arg("--message")
            .arg("Test commit")
            .current_dir(repo)
            .env("TUG_DATA_DIR", &home)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        {
            let stdin = child.stdin.as_mut().unwrap();
            let metadata = r#"{"instruction":"add test file","summary":"Added test file"}"#;
            stdin.write_all(metadata.as_bytes()).unwrap();
        }
        assert!(child.wait().unwrap().success());

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

        run_dash_create("dash1".to_string(), None, false, true).unwrap();
        run_dash_create("dash2".to_string(), None, false, true).unwrap();

        assert_eq!(run_dash_list(false, true).unwrap(), 0);
        assert_eq!(run_dash_show("dash1".to_string(), false, true).unwrap(), 0);
        assert!(run_dash_show("nonexistent".to_string(), false, true).is_err());
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

        run_dash_create(
            "test-dash".to_string(),
            Some("Test dash".to_string()),
            false,
            true,
        )
        .unwrap();
        let worktree = repo.join(".tugtree/tugdash__test-dash");
        fs::write(worktree.join("feature.txt"), "new feature\n").unwrap();
        run_dash_commit(
            "test-dash".to_string(),
            "Add feature".to_string(),
            false,
            true,
        )
        .unwrap();

        let result = run_dash_join(
            "test-dash".to_string(),
            Some("Add new feature".to_string()),
            false,
            true,
        );
        assert_eq!(result.unwrap(), 0);

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

    #[serial]
    #[test]
    fn test_dash_join_dirty_repo_root_fails() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();

        fs::write(repo.join("dirty.txt"), "initial\n").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["add", "dirty.txt"])
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["commit", "-m", "Add dirty.txt"])
            .output()
            .unwrap();
        fs::write(repo.join("dirty.txt"), "modified\n").unwrap();

        let result = run_dash_join("test-dash".to_string(), None, false, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("uncommitted changes"));
        assert!(branch_present(repo, "tugdash/test-dash"));
    }

    #[serial]
    #[test]
    fn test_dash_join_wrong_branch_fails() {
        let temp = TempDir::new().unwrap();
        let repo = temp.path();
        init_git_repo(repo);
        redirect_state_dir(&temp.path().join("state"));
        std::env::set_current_dir(repo).unwrap();

        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["checkout", "-b", "feature"])
            .output()
            .unwrap();

        let result = run_dash_join("test-dash".to_string(), None, false, true);
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

        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();
        let worktree = repo.join(".tugtree/tugdash__test-dash");
        fs::write(worktree.join("test.txt"), "test\n").unwrap();

        let result = run_dash_release("test-dash".to_string(), false, true);
        assert_eq!(result.unwrap(), 0);

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

        let result = run_dash_release("nonexistent".to_string(), false, true);
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

        run_dash_create(
            "test-dash".to_string(),
            Some("Test".to_string()),
            false,
            true,
        )
        .unwrap();
        let worktree = repo.join(".tugtree/tugdash__test-dash");
        fs::write(worktree.join("test.txt"), "test\n").unwrap();
        run_dash_commit("test-dash".to_string(), "Add test".to_string(), false, true).unwrap();
        run_dash_join("test-dash".to_string(), None, false, true).unwrap();

        // Joining again fails: the branch no longer exists.
        let result = run_dash_join("test-dash".to_string(), None, false, true);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }
}
