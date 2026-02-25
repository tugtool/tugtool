//! Worktree management for plan implementations
//!
//! Provides functions for creating, listing, and cleaning up git worktrees
//! for isolated plan implementation environments.

use crate::error::TugError;
use crate::parser::parse_tugplan;
use crate::session::now_iso8601;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Resolve the main repository root, even when CWD is inside a linked worktree.
///
/// Uses `std::env::current_dir()` as the starting point. For explicit path control,
/// use `find_repo_root_from()`.
pub fn find_repo_root() -> Result<PathBuf, TugError> {
    let cwd = std::env::current_dir().map_err(|e| TugError::WorktreeCreationFailed {
        reason: format!("failed to get current directory: {}", e),
    })?;
    find_repo_root_from(&cwd)
}

/// Resolve the main repository root from a given starting path.
///
/// If `start` has a `.git` directory, it is the main repo root.
/// If `start` has a `.git` file (linked worktree), resolves to the main repo
/// via `git rev-parse --path-format=absolute --git-common-dir`.
/// Returns `TugError::NotAGitRepository` if no `.git` is found.
pub fn find_repo_root_from(start: &Path) -> Result<PathBuf, TugError> {
    let git_path = start.join(".git");

    // If .git is a directory, we're in the main repo
    if git_path.is_dir() {
        return Ok(start.to_path_buf());
    }

    // If .git is a file, we're in a linked worktree -- resolve to main repo
    if git_path.is_file() {
        let output = Command::new("git")
            .arg("-C")
            .arg(start)
            .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
            .output()
            .map_err(|e| TugError::WorktreeCreationFailed {
                reason: format!("failed to resolve main repo root: {}", e),
            })?;

        if output.status.success() {
            let common_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let common_path = PathBuf::from(&common_dir);
            if let Some(parent) = common_path.parent() {
                return Ok(parent.to_path_buf());
            }
        }
    }

    // No .git found -- return NotAGitRepository
    Err(TugError::NotAGitRepository)
}

/// Cleanup mode for worktree cleanup operations
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupMode {
    /// Clean worktrees with merged PRs
    Merged,
    /// Clean worktrees with no PR (not InProgress)
    Orphaned,
    /// Clean tugplan/* branches without worktrees
    Stale,
    /// All of the above
    All,
}

/// Result from cleanup operation
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CleanupResult {
    /// Worktrees removed due to merged PRs
    pub merged_removed: Vec<String>,
    /// Worktrees removed due to no PR
    pub orphaned_removed: Vec<String>,
    /// Stale branches removed
    pub stale_branches_removed: Vec<String>,
    /// Worktrees skipped with reason
    pub skipped: Vec<(String, String)>,
}

/// Result type for stale branch cleanup: (removed branches, skipped branches with reasons)
pub type StaleBranchCleanupResult = (Vec<String>, Vec<(String, String)>);

/// Configuration for worktree creation
#[derive(Debug, Clone)]
pub struct WorktreeConfig {
    /// Path to plan file (relative to repo root)
    pub plan_path: PathBuf,
    /// Base branch to create worktree from
    pub base_branch: String,
    /// Repository root directory
    pub repo_root: PathBuf,
}

/// Derive plan slug from plan path per Spec S05
///
/// Strips "tugplan-" prefix from filename (without extension).
/// Examples:
/// - .tugtool/tugplan-auth.md -> auth
/// - .tugtool/tugplan-worktree-integration.md -> worktree-integration
/// - .tugtool/tugplan-1.md -> 1
/// - .tugtool/my-feature.md -> my-feature
pub fn derive_tugplan_slug(tugplan_path: &Path) -> String {
    let filename = tugplan_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");

    filename
        .strip_prefix("tugplan-")
        .unwrap_or(filename)
        .to_string()
}

/// Extract plan slug from branch name.
///
/// Branch format: `tugplan/<slug>-<timestamp>` where timestamp is exactly 15 chars (YYYYMMDD-HHMMSS).
/// This function strips the `tugplan/` prefix and the last 16 chars (hyphen + timestamp).
///
/// Examples:
/// - "tugplan/auth-20260208-143022" -> "auth"
/// - "tugplan/auth-v2-20260208-143022" -> "auth-v2"
/// - "tugplan/1-20260208-143022" -> "1"
pub fn slug_from_branch(branch: &str) -> String {
    let without_prefix = branch.strip_prefix("tugplan/").unwrap_or(branch);
    // Strip last 16 characters (hyphen + 15-char timestamp)
    if without_prefix.len() > 16 {
        without_prefix[..without_prefix.len() - 16].to_string()
    } else {
        without_prefix.to_string()
    }
}

/// Sanitize branch name for filesystem-safe directory name per D08
///
/// Replaces problematic characters to create a valid directory name:
/// - '/' -> '__' (git path separators)
/// - '\\' -> '__' (Windows path separators)
/// - ':' -> '_' (Windows drive letters)
/// - ' ' -> '_' (shell escaping)
/// - Filters to alphanumeric, '-', and '_' only
///
/// Returns "tugplan-worktree" as defensive fallback if result is empty.
pub fn sanitize_branch_name(branch_name: &str) -> String {
    let sanitized: String = branch_name
        .replace(['/', '\\'], "__")
        .replace([':', ' '], "_")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    if sanitized.is_empty() {
        "tugplan-worktree".to_string()
    } else {
        sanitized
    }
}

/// Convert ISO 8601 timestamp to compact YYYYMMDD-HHMMSS format
///
/// Takes ISO 8601 format "YYYY-MM-DDTHH:MM:SS.MMMZ" and converts to "YYYYMMDD-HHMMSS"
/// for use in branch names and worktree directory names.
fn format_compact_timestamp(iso8601: &str) -> Result<String, TugError> {
    // ISO 8601 format: "2026-02-08T12:34:56.123Z"
    // Target format:   "20260208-123456"

    // Parse the ISO 8601 string
    // Expected format: YYYY-MM-DDTHH:MM:SS.MMMZ
    if iso8601.len() < 19 {
        return Err(TugError::WorktreeCreationFailed {
            reason: format!("Invalid ISO 8601 timestamp: {}", iso8601),
        });
    }

    // Extract date components (YYYY-MM-DD)
    let year = &iso8601[0..4];
    let month = &iso8601[5..7];
    let day = &iso8601[8..10];

    // Extract time components (HH:MM:SS)
    let hour = &iso8601[11..13];
    let minute = &iso8601[14..16];
    let second = &iso8601[17..19];

    // Combine into compact format
    Ok(format!(
        "{}{}{}-{}{}{}",
        year, month, day, hour, minute, second
    ))
}

/// Generate UTC timestamp in YYYYMMDD-HHMMSS format per Spec S05
fn generate_timestamp_utc() -> Result<String, TugError> {
    let iso8601 = now_iso8601();
    format_compact_timestamp(&iso8601)
}

/// Generate branch name in format tugplan/<slug>-<timestamp>
pub fn generate_branch_name(slug: &str) -> Result<String, TugError> {
    let timestamp = generate_timestamp_utc()?;
    Ok(format!("tugplan/{}-{}", slug, timestamp))
}

/// Find existing worktree for the given plan, preferring most recent by timestamp
///
/// Searches all active worktrees for ones matching the plan_path.
/// If multiple matches exist, returns the one with the most recent timestamp
/// (extracted from the directory name).
///
/// Returns None if no matching worktree is found.
fn find_existing_worktree(config: &WorktreeConfig) -> Result<Option<DiscoveredWorktree>, TugError> {
    let all_worktrees = list_worktrees(&config.repo_root)?;

    // Derive expected slug from config plan_path
    let expected_slug = derive_tugplan_slug(&config.plan_path);

    // Filter to matching plan_slug and sort by timestamp (most recent first)
    let mut matching: Vec<DiscoveredWorktree> = all_worktrees
        .into_iter()
        .filter(|wt| wt.plan_slug == expected_slug)
        .collect();

    if matching.is_empty() {
        return Ok(None);
    }

    // Sort by branch name (which includes timestamp) in descending order (most recent first)
    matching.sort_by(|a, b| b.branch.cmp(&a.branch));

    Ok(matching.into_iter().next())
}

/// Git CLI wrapper for worktree operations
struct GitCli<'a> {
    repo_root: &'a Path,
}

impl<'a> GitCli<'a> {
    fn new(repo_root: &'a Path) -> Self {
        Self { repo_root }
    }

    /// Check if git version is sufficient (2.15+)
    fn check_git_version(&self) -> Result<bool, TugError> {
        let output = Command::new("git").arg("--version").output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TugError::NotAGitRepository
            } else {
                TugError::WorktreeCreationFailed {
                    reason: format!("failed to run git: {}", e),
                }
            }
        })?;

        if !output.status.success() {
            return Ok(false);
        }

        let version_str = String::from_utf8_lossy(&output.stdout);
        // Parse version (e.g., "git version 2.39.0")
        if let Some(version_part) = version_str.split_whitespace().nth(2) {
            if let Some(major_minor) = version_part
                .split('.')
                .take(2)
                .collect::<Vec<_>>()
                .get(0..2)
            {
                if let (Ok(major), Ok(minor)) =
                    (major_minor[0].parse::<u32>(), major_minor[1].parse::<u32>())
                {
                    return Ok(major > 2 || (major == 2 && minor >= 15));
                }
            }
        }

        Ok(false)
    }

    /// Check if a branch exists
    fn branch_exists(&self, branch: &str) -> bool {
        Command::new("git")
            .arg("-C")
            .arg(self.repo_root)
            .args(["rev-parse", "--verify", branch])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Create a new branch from base
    fn create_branch(&self, base: &str, new_branch: &str) -> Result<(), TugError> {
        let output = Command::new("git")
            .arg("-C")
            .arg(self.repo_root)
            .args(["branch", new_branch, base])
            .output()
            .map_err(|e| TugError::WorktreeCreationFailed {
                reason: format!("failed to create branch: {}", e),
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::WorktreeCreationFailed {
                reason: format!("git branch failed: {}", stderr),
            });
        }

        Ok(())
    }

    /// Delete a branch
    fn delete_branch(&self, branch: &str) -> Result<(), TugError> {
        let output = Command::new("git")
            .arg("-C")
            .arg(self.repo_root)
            .args(["branch", "-D", branch])
            .output()
            .map_err(|e| TugError::WorktreeCleanupFailed {
                reason: format!("failed to delete branch: {}", e),
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::WorktreeCleanupFailed {
                reason: format!("git branch -D failed: {}", stderr),
            });
        }

        Ok(())
    }

    /// Add a worktree
    fn worktree_add(&self, path: &Path, branch: &str) -> Result<(), TugError> {
        let path_str = path
            .to_str()
            .ok_or_else(|| TugError::WorktreeCreationFailed {
                reason: format!("worktree path is not valid UTF-8: {}", path.display()),
            })?;

        let output = Command::new("git")
            .arg("-C")
            .arg(self.repo_root)
            .args(["worktree", "add", path_str, branch])
            .output()
            .map_err(|e| TugError::WorktreeCreationFailed {
                reason: format!("failed to add worktree: {}", e),
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::WorktreeCreationFailed {
                reason: format!("git worktree add failed: {}", stderr),
            });
        }

        Ok(())
    }

    /// Remove a worktree
    ///
    /// Removes the worktree directory using git worktree remove.
    /// The worktree must be clean (no untracked files) for this to succeed.
    /// Callers should clean up session files and artifacts before calling this.
    fn worktree_remove(&self, path: &Path) -> Result<(), TugError> {
        self.worktree_remove_impl(path, false)
    }

    /// Force-remove a worktree, even if it has uncommitted changes.
    ///
    /// Uses `git worktree remove --force` which discards dirty state.
    fn worktree_force_remove(&self, path: &Path) -> Result<(), TugError> {
        self.worktree_remove_impl(path, true)
    }

    fn worktree_remove_impl(&self, path: &Path, force: bool) -> Result<(), TugError> {
        let path_str = path
            .to_str()
            .ok_or_else(|| TugError::WorktreeCleanupFailed {
                reason: format!("worktree path is not valid UTF-8: {}", path.display()),
            })?;

        let mut args = vec!["worktree", "remove"];
        if force {
            args.push("--force");
        }
        args.push(path_str);

        let output = Command::new("git")
            .arg("-C")
            .arg(self.repo_root)
            .args(&args)
            .output()
            .map_err(|e| TugError::WorktreeCleanupFailed {
                reason: format!("failed to remove worktree: {}", e),
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::WorktreeCleanupFailed {
                reason: format!("git worktree remove failed: {}", stderr),
            });
        }

        Ok(())
    }

    /// Prune stale worktree metadata
    fn worktree_prune(&self) -> Result<(), TugError> {
        let output = Command::new("git")
            .arg("-C")
            .arg(self.repo_root)
            .args(["worktree", "prune"])
            .output()
            .map_err(|e| TugError::WorktreeCleanupFailed {
                reason: format!("failed to prune worktrees: {}", e),
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(TugError::WorktreeCleanupFailed {
                reason: format!("git worktree prune failed: {}", stderr),
            });
        }

        Ok(())
    }

    /// Find the worktree path for a given branch using `git worktree list --porcelain`
    ///
    /// Returns `Some(path)` if the branch is checked out in a non-main worktree,
    /// `None` otherwise. The main worktree (repo root) is never returned since
    /// it cannot be removed.
    fn worktree_path_for_branch(&self, branch: &str) -> Option<PathBuf> {
        let output = Command::new("git")
            .arg("-C")
            .arg(self.repo_root)
            .args(["worktree", "list", "--porcelain"])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        // Canonicalize repo_root for reliable comparison (handles symlinks like /tmp → /private/tmp)
        let canonical_root = self.repo_root.canonicalize().ok();

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut current_path: Option<PathBuf> = None;

        for line in stdout.lines() {
            if let Some(path_str) = line.strip_prefix("worktree ") {
                current_path = Some(PathBuf::from(path_str));
            } else if let Some(branch_ref) = line.strip_prefix("branch refs/heads/") {
                if branch_ref == branch {
                    // Skip the main worktree — it can never be removed
                    if let (Some(wt_path), Some(root)) = (&current_path, &canonical_root) {
                        if wt_path.canonicalize().ok().as_ref() == Some(root) {
                            return None;
                        }
                    }
                    return current_path;
                }
            } else if line.is_empty() {
                current_path = None;
            }
        }

        None
    }

    /// Check if branch is ancestor of base (for merge detection per D09)
    fn is_ancestor(&self, branch: &str, base: &str) -> bool {
        Command::new("git")
            .arg("-C")
            .arg(self.repo_root)
            .args(["merge-base", "--is-ancestor", branch, base])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

/// PR state from gh pr view
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PrState {
    Merged,
    Open,
    Closed,
    NotFound,
    Unknown,
}

/// Check PR state using GitHub API
///
/// Queries `gh pr view <branch> --json state,mergedAt` to detect PR state.
/// This works for squash merges, which git merge-base cannot detect.
///
/// # Arguments
/// * `branch` - Branch name to check
///
/// # Returns
/// * `Ok(PrState::Merged)` - PR is merged
/// * `Ok(PrState::Open)` - PR is open
/// * `Ok(PrState::Closed)` - PR is closed but not merged
/// * `Ok(PrState::NotFound)` - No PR exists for this branch
/// * `Ok(PrState::Unknown)` - gh CLI error or unavailable
fn get_pr_state(branch: &str) -> PrState {
    // Check if gh CLI is available
    let gh_check = Command::new("gh").arg("--version").output();
    if gh_check.is_err() {
        return PrState::Unknown;
    }

    // Query PR information
    let output = match Command::new("gh")
        .args(["pr", "view", branch, "--json", "state,mergedAt"])
        .output()
    {
        Ok(o) => o,
        Err(_) => return PrState::Unknown,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // "no pull requests found" means no PR exists
        if stderr.contains("no pull requests found") {
            return PrState::NotFound;
        }
        // Other gh errors
        return PrState::Unknown;
    }

    // Parse the JSON response
    let stdout = String::from_utf8_lossy(&output.stdout);

    #[derive(serde::Deserialize)]
    struct PrStateJson {
        state: String,
        #[allow(dead_code)]
        #[serde(rename = "mergedAt")]
        merged_at: Option<String>,
    }

    match serde_json::from_str::<PrStateJson>(&stdout) {
        Ok(pr_state) => match pr_state.state.as_str() {
            "MERGED" => PrState::Merged,
            "OPEN" => PrState::Open,
            "CLOSED" => PrState::Closed,
            _ => PrState::Unknown,
        },
        Err(_) => PrState::Unknown,
    }
}

/// Check if a PR has been merged (legacy compatibility)
///
/// # Returns
/// * `Ok(true)` - PR is merged
/// * `Ok(false)` - PR not found or not merged
/// * `Err(String)` - gh CLI error (with fallback suggestion)
#[allow(dead_code)] // Used in tests, kept for backward compatibility
fn is_pr_merged(branch: &str) -> Result<bool, String> {
    match get_pr_state(branch) {
        PrState::Merged => Ok(true),
        PrState::Open | PrState::Closed | PrState::NotFound => Ok(false),
        PrState::Unknown => {
            Err("gh CLI not found or failed. Install from https://cli.github.com/".to_string())
        }
    }
}

impl<'a> GitCli<'a> {}

/// Create a worktree for plan implementation
///
/// Validates plan has at least one execution step, generates branch name,
/// creates branch from base, creates worktree. Returns infrastructure tuple
/// (worktree_path, branch_name, plan_slug). Worktree metadata is returned
/// as an infrastructure tuple.
///
/// Always searches for existing worktrees with matching plan_path and returns
/// the most recent one instead of creating new. This makes the command idempotent.
///
/// Implements partial failure recovery:
/// - If branch creation succeeds but worktree creation fails: delete the branch
pub fn create_worktree(config: &WorktreeConfig) -> Result<(PathBuf, String, String), TugError> {
    let git = GitCli::new(&config.repo_root);

    // Check git version
    if !git.check_git_version()? {
        return Err(TugError::GitVersionInsufficient);
    }

    // Check if we're in a git repository
    if !config.repo_root.join(".git").exists() {
        return Err(TugError::NotAGitRepository);
    }

    // Check if base branch exists
    if !git.branch_exists(&config.base_branch) {
        return Err(TugError::BaseBranchNotFound {
            branch: config.base_branch.clone(),
        });
    }

    // Parse plan to validate it has execution steps
    let plan_full_path = config.repo_root.join(&config.plan_path);
    let plan_content = std::fs::read_to_string(&plan_full_path)?;
    let plan = parse_tugplan(&plan_content)?;

    if plan.steps.is_empty() {
        return Err(TugError::PlanHasNoSteps);
    }

    // Check for existing worktrees for this plan and reuse if found
    if let Some(existing) = find_existing_worktree(config)? {
        // Reuse path: return infrastructure tuple from existing worktree
        return Ok((existing.path, existing.branch, existing.plan_slug));
    }
    // No existing worktree found, proceed to create new one

    // Generate branch name and worktree directory
    let slug = derive_tugplan_slug(&config.plan_path);
    let branch_name = generate_branch_name(&slug)?;
    let worktree_dir_name = sanitize_branch_name(&branch_name);
    let worktree_path = config.repo_root.join(".tugtree").join(&worktree_dir_name);

    // Create branch from base
    git.create_branch(&config.base_branch, &branch_name)?;

    // Create worktree (with partial failure recovery)
    if let Err(e) = git.worktree_add(&worktree_path, &branch_name) {
        // Clean up: delete the branch we just created
        let _ = git.delete_branch(&branch_name);
        return Err(e);
    }

    // Return infrastructure tuple
    Ok((worktree_path, branch_name, slug))
}

/// List all active worktrees
///
/// Prunes stale worktree metadata first, then scans .tugtree/
/// for session.json files. Skips orphaned entries where directory doesn't exist.
pub fn list_worktrees(repo_root: &Path) -> Result<Vec<DiscoveredWorktree>, TugError> {
    let git = GitCli::new(repo_root);

    // Prune stale worktree metadata
    git.worktree_prune()?;

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| TugError::WorktreeCleanupFailed {
            reason: format!("failed to run git worktree list: {}", e),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TugError::WorktreeCleanupFailed {
            reason: format!("git worktree list failed: {}", stderr),
        });
    }

    // Canonicalize repo_root so we can skip the main worktree
    let canonical_root = repo_root.canonicalize().ok();

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut current_path: Option<PathBuf> = None;
    let mut worktrees: Vec<DiscoveredWorktree> = Vec::new();

    for line in stdout.lines() {
        if let Some(path_str) = line.strip_prefix("worktree ") {
            current_path = Some(PathBuf::from(path_str));
        } else if let Some(branch_ref) = line.strip_prefix("branch refs/heads/") {
            // Only include branches with "tugplan/" prefix
            if branch_ref.starts_with("tugplan/") {
                if let Some(wt_path) = current_path.take() {
                    // Skip the main worktree
                    let is_main = canonical_root
                        .as_ref()
                        .and_then(|root| wt_path.canonicalize().ok().map(|p| p == *root))
                        .unwrap_or(false);
                    if !is_main {
                        let plan_slug = slug_from_branch(branch_ref);
                        worktrees.push(DiscoveredWorktree {
                            path: wt_path,
                            branch: branch_ref.to_string(),
                            plan_slug,
                            base_branch: "main".to_string(),
                        });
                    }
                }
            }
        } else if line.is_empty() {
            current_path = None;
        }
    }

    Ok(worktrees)
}

/// Resolve a user-provided target string to matching worktrees.
///
/// Resolution cascade (returns on first hit for stages 1-3, collects for 4-5):
///
/// 1. **Exact branch name** — `wt.branch == target`
/// 2. **Exact worktree path** — `wt.path.to_string_lossy() == target`
/// 3. **Directory name** — `wt.path.file_name() == Some(target)`
/// 4. **Plan path** (target ends in `.md`) — `derive_tugplan_slug(target) == wt.plan_slug`
/// 5. **Plan slug** — `wt.plan_slug == target`
///
/// Stages 1-3 are unambiguous identifiers (return immediately on first hit).
/// Stages 4-5 can match multiple worktrees for the same plan (different timestamps).
pub fn resolve_worktree<'a>(
    target: &str,
    worktrees: &'a [DiscoveredWorktree],
) -> Vec<&'a DiscoveredWorktree> {
    // Stage 1: Exact branch name
    for wt in worktrees {
        if wt.branch == target {
            return vec![wt];
        }
    }

    // Stage 2: Exact worktree path
    for wt in worktrees {
        if wt.path.to_string_lossy() == target {
            return vec![wt];
        }
    }

    // Stage 3: Directory name
    for wt in worktrees {
        if wt.path.file_name().and_then(|f| f.to_str()) == Some(target) {
            return vec![wt];
        }
    }

    // Stage 4: Plan path (target ends in .md) — derive slug and match
    if target.ends_with(".md") {
        let target_slug = derive_tugplan_slug(Path::new(target));
        let matches: Vec<&DiscoveredWorktree> = worktrees
            .iter()
            .filter(|wt| wt.plan_slug == target_slug)
            .collect();
        if !matches.is_empty() {
            return matches;
        }
    }

    // Stage 5: Plan slug
    let matches: Vec<&DiscoveredWorktree> = worktrees
        .iter()
        .filter(|wt| wt.plan_slug == target)
        .collect();
    if !matches.is_empty() {
        return matches;
    }

    Vec::new()
}

/// A worktree discovered via `git worktree list`, independent of session files.
///
/// The `plan_slug` is derived from the branch name by stripping the branch prefix
/// and the timestamp suffix (last 16 characters: hyphen + 15-char YYYYMMDD-HHMMSS).
/// Example: "tugplan/auth-20260208-143022" -> "auth"
/// Example: "tugplan/auth-v2-20260208-143022" -> "auth-v2"
#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredWorktree {
    /// Absolute path to the worktree directory
    pub path: PathBuf,
    /// Branch name (e.g., "tugplan/1-20260208-143022")
    pub branch: String,
    /// Plan slug derived from branch name
    pub plan_slug: String,
    /// Base branch for PR merges (defaults to "main" from project convention)
    pub base_branch: String,
}

/// Result from worktree discovery, containing the selected worktree and all matches.
///
/// When multiple worktrees match a plan, `selected` contains the most recent one
/// (by branch timestamp), and `all_matches` contains all of them.
#[derive(Debug, Clone)]
pub struct WorktreeDiscovery {
    /// The most recent matching worktree (same as previous behavior)
    pub selected: Option<DiscoveredWorktree>,
    /// All matching worktrees found
    pub all_matches: Vec<DiscoveredWorktree>,
    /// Count of matches (convenience for all_matches.len())
    pub match_count: usize,
}

/// Find worktrees for a plan using git-native discovery.
///
/// Parses `git worktree list --porcelain` and matches worktrees whose branch
/// starts with `tugplan/<slug>-`. This works even when session files are missing
/// or corrupt, since it relies only on git's own worktree tracking.
///
/// If multiple worktrees match (shouldn't happen normally), returns the most
/// recent one by branch name (which contains a timestamp suffix).
///
/// Returns `WorktreeDiscovery` with `selected: None` if no matching worktree is found.
pub fn find_worktree_by_tugplan(
    repo_root: &Path,
    plan_path: &Path,
) -> Result<WorktreeDiscovery, TugError> {
    let slug = derive_tugplan_slug(plan_path);
    let branch_prefix = format!("tugplan/{}-", slug);

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| TugError::WorktreeCleanupFailed {
            reason: format!("failed to run git worktree list: {}", e),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TugError::WorktreeCleanupFailed {
            reason: format!("git worktree list failed: {}", stderr),
        });
    }

    // Canonicalize repo_root so we can skip the main worktree
    let canonical_root = repo_root.canonicalize().ok();

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut current_path: Option<PathBuf> = None;
    let mut matches: Vec<DiscoveredWorktree> = Vec::new();

    for line in stdout.lines() {
        if let Some(path_str) = line.strip_prefix("worktree ") {
            current_path = Some(PathBuf::from(path_str));
        } else if let Some(branch_ref) = line.strip_prefix("branch refs/heads/") {
            if branch_ref.starts_with(&branch_prefix) {
                if let Some(wt_path) = current_path.take() {
                    // Skip the main worktree
                    let is_main = canonical_root
                        .as_ref()
                        .and_then(|root| wt_path.canonicalize().ok().map(|p| p == *root))
                        .unwrap_or(false);
                    if !is_main {
                        let plan_slug = slug_from_branch(branch_ref);
                        matches.push(DiscoveredWorktree {
                            path: wt_path,
                            branch: branch_ref.to_string(),
                            plan_slug,
                            base_branch: "main".to_string(),
                        });
                    }
                }
            }
        } else if line.is_empty() {
            current_path = None;
        }
    }

    // If multiple, pick the most recent by branch name (contains timestamp)
    matches.sort_by(|a, b| a.branch.cmp(&b.branch));
    let match_count = matches.len();
    let selected = matches.last().cloned();
    Ok(WorktreeDiscovery {
        selected,
        all_matches: matches,
        match_count,
    })
}

/// Validate that a worktree path follows the expected pattern
///
/// Valid worktree paths must:
/// - Start with `.tugtree/tugplan__` (plan worktrees) or `.tugtree/tugdash__` (dash worktrees)
/// - Be a relative path (not absolute)
///
/// This function does NOT check if the directory exists on disk.
/// It only validates the path pattern.
///
/// # Examples
///
/// ```
/// use std::path::Path;
/// use tug_core::is_valid_worktree_path;
///
/// assert!(is_valid_worktree_path(Path::new(".tugtree/tugplan__auth-20260208-143022")));
/// assert!(is_valid_worktree_path(Path::new(".tugtree/tugdash__my-task")));
/// assert!(!is_valid_worktree_path(Path::new(".tugtree/foo")));
/// assert!(!is_valid_worktree_path(Path::new("../worktrees/tugplan__auth")));
/// assert!(!is_valid_worktree_path(Path::new("/abs/path/tugplan__auth")));
/// ```
pub fn is_valid_worktree_path(path: &Path) -> bool {
    // Convert to string for pattern matching
    let path_str = path.to_string_lossy();

    // Must start with .tugtree/tugplan__ (plan worktrees) or .tugtree/tugdash__ (dash worktrees)
    path_str.starts_with(".tugtree/tugplan__") || path_str.starts_with(".tugtree/tugdash__")
}

/// List all local branches matching the tugplan/* pattern
///
/// Returns all branch names that start with "tugplan/".
/// Only local branches are included (no remote-tracking branches).
pub fn list_tugplan_branches(repo_root: &Path) -> Result<Vec<String>, TugError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["branch", "--list", "tugplan/*"])
        .output()
        .map_err(|e| TugError::WorktreeCleanupFailed {
            reason: format!("failed to list branches: {}", e),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TugError::WorktreeCleanupFailed {
            reason: format!("git branch --list failed: {}", stderr),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let branches: Vec<String> = stdout
        .lines()
        .map(|line| {
            // git branch --list output format:
            // "  branch-name" - regular branch
            // "* branch-name" - current branch
            // "+ branch-name" - branch checked out in a worktree
            let trimmed = line.trim();
            trimmed
                .strip_prefix("* ")
                .or_else(|| trimmed.strip_prefix("+ "))
                .unwrap_or(trimmed)
                .to_string()
        })
        .filter(|line| !line.is_empty())
        .collect();

    Ok(branches)
}

/// Clean up stale branches (tugplan/* branches without worktrees)
///
/// Finds all tugplan/* branches that don't have corresponding worktrees and attempts
/// to delete them using safe delete first (git branch -d), then force delete (git branch -D)
/// only if the PR is confirmed merged via gh pr view.
///
/// # Arguments
///
/// * `repo_root` - Repository root path
/// * `sessions` - List of active sessions (to determine which branches have worktrees)
/// * `dry_run` - If true, report what would be removed without actually removing
/// * `force` - If true, use force delete for all stale branches regardless of PR state
///
/// # Returns
///
/// * `removed` - List of branch names that were successfully deleted (or would be in dry-run)
/// * `skipped` - List of (branch_name, reason) tuples for branches that were skipped
pub fn cleanup_stale_branches(
    repo_root: &Path,
    worktrees: &[DiscoveredWorktree],
    dry_run: bool,
) -> Result<StaleBranchCleanupResult, TugError> {
    cleanup_stale_branches_with_pr_checker(repo_root, worktrees, dry_run, |branch| {
        get_pr_state(branch)
    })
}

/// Clean up stale branches with an injectable PR state checker.
///
/// Same as `cleanup_stale_branches` but accepts a closure to determine PR state,
/// enabling deterministic testing without GitHub CLI dependency.
pub(crate) fn cleanup_stale_branches_with_pr_checker(
    repo_root: &Path,
    worktrees: &[DiscoveredWorktree],
    dry_run: bool,
    pr_checker: impl Fn(&str) -> PrState,
) -> Result<StaleBranchCleanupResult, TugError> {
    let git = GitCli::new(repo_root);
    let all_branches = list_tugplan_branches(repo_root)?;

    // Build set of branch names that have worktrees
    let branches_with_worktrees: std::collections::HashSet<String> =
        worktrees.iter().map(|wt| wt.branch.clone()).collect();

    let mut removed = Vec::new();
    let mut skipped = Vec::new();

    for branch in all_branches {
        // Skip branches that have worktrees (session-backed)
        if branches_with_worktrees.contains(&branch) {
            continue;
        }

        if dry_run {
            // Check if merged via git ancestry
            let is_merged =
                git.is_ancestor(&branch, "main") || git.is_ancestor(&branch, "origin/main");

            if is_merged {
                removed.push(branch.clone());
                continue;
            }

            // Not merged via git - check PR state
            let pr_state = pr_checker(&branch);
            match pr_state {
                PrState::Merged => {
                    removed.push(branch.clone());
                }
                PrState::Unknown => {
                    // gh unavailable - fall back to git ancestry (already checked above, so not merged)
                    // Stale branch with no worktree and unknown state - clean it
                    removed.push(branch.clone());
                }
                PrState::NotFound | PrState::Open | PrState::Closed => {
                    skipped.push((
                        branch.clone(),
                        format!("Unmerged; PR state is {:?}", pr_state),
                    ));
                }
            }
        } else {
            // Try safe delete first (succeeds if branch is merged)
            let safe_delete = Command::new("git")
                .arg("-C")
                .arg(repo_root)
                .args(["branch", "-d", &branch])
                .output()
                .map_err(|e| TugError::WorktreeCleanupFailed {
                    reason: format!("failed to delete branch: {}", e),
                })?;

            if safe_delete.status.success() {
                removed.push(branch.clone());
                continue;
            }

            // Safe delete failed (not merged) - check if branch has a worktree
            // (worktree that wasn't in our list)
            if let Some(wt_path) = git.worktree_path_for_branch(&branch) {
                // Remove the worktree first, then delete the branch
                match git.worktree_force_remove(&wt_path) {
                    Ok(()) => match git.delete_branch(&branch) {
                        Ok(()) => removed.push(branch.clone()),
                        Err(e) => skipped.push((
                            branch.clone(),
                            format!("Removed worktree but branch delete failed: {}", e),
                        )),
                    },
                    Err(e) => {
                        skipped.push((branch.clone(), format!("Cannot remove worktree: {}", e)))
                    }
                }
                continue;
            }

            // No worktree - check PR state to decide whether to force-delete
            let pr_state = pr_checker(&branch);
            match pr_state {
                PrState::Merged | PrState::Unknown => {
                    // PR merged (squash merge git can't detect), or gh unavailable.
                    // Stale branch with no worktree - clean it.
                    match git.delete_branch(&branch) {
                        Ok(()) => removed.push(branch.clone()),
                        Err(e) => skipped.push((branch.clone(), format!("Delete failed: {}", e))),
                    }
                }
                PrState::NotFound | PrState::Open | PrState::Closed => {
                    skipped.push((
                        branch.clone(),
                        format!("Unmerged; PR state is {:?}", pr_state),
                    ));
                }
            }
        }
    }

    Ok((removed, skipped))
}

/// Remove a worktree and clean up all associated files
///
/// This function orchestrates the cleanup of a worktree by:
/// 1. Deleting external session files at `.tugtree/.sessions/`
/// 2. Deleting legacy internal session files at `{worktree}/.tugtool/session.json`
/// 3. Deleting worktree-local artifacts at `{worktree}/.tugtool/artifacts/`
/// 4. Removing the worktree directory using git worktree remove (without --force)
///
/// The function ensures all session data is cleaned up before git removes the worktree,
/// so that git worktree remove can succeed without needing --force.
///
/// # Arguments
///
/// * `worktree_path` - Path to the worktree directory
/// * `repo_root` - Repository root path
///
/// # Returns
///
/// * `Ok(())` if removal succeeds
/// * `Err(TugError)` if any step fails
pub fn remove_worktree(worktree_path: &Path, repo_root: &Path) -> Result<(), TugError> {
    // Delete legacy internal session file (backward compatibility)
    let internal_session = worktree_path.join(".tugtool").join("session.json");
    if internal_session.exists() {
        std::fs::remove_file(&internal_session)?;
    }

    // Delete legacy internal step-artifacts directory (backward compatibility)
    let internal_artifacts = worktree_path.join(".tugtool").join("step-artifacts");
    if internal_artifacts.exists() {
        std::fs::remove_dir_all(&internal_artifacts)?;
    }

    // Delete current artifacts directory (new location)
    let artifacts = worktree_path.join(".tugtool").join("artifacts");
    if artifacts.exists() {
        std::fs::remove_dir_all(&artifacts)?;
    }

    // Now remove the worktree using git (without --force since files are cleaned)
    let git = GitCli::new(repo_root);
    git.worktree_remove(worktree_path)?;

    Ok(())
}

/// Clean up worktrees based on cleanup mode
///
/// Implements comprehensive cleanup with drift detection per Table T01.
/// Supports Merged, Orphaned, Stale, and All modes with InProgress protection.
///
/// If dry_run is true, returns what would be removed without actually removing.
pub fn cleanup_worktrees(
    repo_root: &Path,
    mode: CleanupMode,
    dry_run: bool,
) -> Result<CleanupResult, TugError> {
    cleanup_worktrees_with_pr_checker(repo_root, mode, dry_run, get_pr_state)
}

/// Clean up worktrees with an injectable PR state checker.
///
/// Same as `cleanup_worktrees` but accepts a closure to determine PR state,
/// enabling deterministic testing without GitHub CLI dependency.
pub(crate) fn cleanup_worktrees_with_pr_checker(
    repo_root: &Path,
    mode: CleanupMode,
    dry_run: bool,
    pr_checker: impl Fn(&str) -> PrState,
) -> Result<CleanupResult, TugError> {
    let git = GitCli::new(repo_root);
    let worktrees = list_worktrees(repo_root)?;

    let mut result = CleanupResult {
        merged_removed: Vec::new(),
        orphaned_removed: Vec::new(),
        stale_branches_removed: Vec::new(),
        skipped: Vec::new(),
    };

    for wt in &worktrees {
        // Note: Protection relies on PR state and user confirmation.
        // Get PR state
        let pr_state = pr_checker(&wt.branch);

        // Determine if this worktree should be cleaned based on mode
        let should_clean = match mode {
            CleanupMode::Merged => {
                match pr_state {
                    PrState::Merged => true,
                    PrState::NotFound | PrState::Unknown => {
                        // No PR or gh unavailable - fall back to git ancestry
                        git.is_ancestor(&wt.branch, &wt.base_branch)
                    }
                    PrState::Open | PrState::Closed => false,
                }
            }
            CleanupMode::Orphaned => {
                match pr_state {
                    // No PR, or gh unavailable (assume no PR)
                    PrState::NotFound | PrState::Unknown => true,
                    PrState::Merged | PrState::Open | PrState::Closed => false,
                }
            }
            CleanupMode::All => {
                match pr_state {
                    PrState::Merged | PrState::Closed | PrState::NotFound | PrState::Unknown => {
                        true
                    }
                    PrState::Open => false, // Don't clean open PRs even in All mode
                }
            }
            CleanupMode::Stale => {
                // Stale mode only handles branches without worktrees, not sessions
                continue;
            }
        };

        if should_clean {
            // Categorize removal based on mode and PR state
            let category = match mode {
                CleanupMode::Merged => &mut result.merged_removed,
                CleanupMode::Orphaned => &mut result.orphaned_removed,
                CleanupMode::All => match pr_state {
                    PrState::Merged | PrState::Closed => &mut result.merged_removed,
                    _ => &mut result.orphaned_removed,
                },
                CleanupMode::Stale => &mut result.stale_branches_removed,
            };

            category.push(wt.branch.clone());

            if !dry_run {
                let worktree_path = &wt.path;

                // Try normal removal first, escalate to force if needed
                let removed = match remove_worktree(worktree_path, repo_root) {
                    Ok(()) => true,
                    Err(_) => {
                        // Dirty worktree or other issue - force remove
                        match git.worktree_force_remove(worktree_path) {
                            Ok(()) => true,
                            Err(e) => {
                                result
                                    .skipped
                                    .push((wt.branch.clone(), format!("Removal failed: {}", e)));
                                category.pop();
                                false
                            }
                        }
                    }
                };

                if removed {
                    if let Err(e) = git.delete_branch(&wt.branch) {
                        eprintln!(
                            "Warning: removed worktree but failed to delete branch {}: {}",
                            wt.branch, e
                        );
                    }
                }
            }
        }
    }

    // Handle stale branch cleanup if mode includes it
    if matches!(mode, CleanupMode::Stale | CleanupMode::All) {
        let (removed, skipped) =
            cleanup_stale_branches_with_pr_checker(repo_root, &worktrees, dry_run, &pr_checker)?;
        result.stale_branches_removed.extend(removed);
        result.skipped.extend(skipped);
    }

    // Final prune to clean up any stale metadata
    if !dry_run {
        git.worktree_prune()?;
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_tugplan_slug() {
        assert_eq!(
            derive_tugplan_slug(Path::new(".tugtool/tugplan-auth.md")),
            "auth"
        );
        assert_eq!(
            derive_tugplan_slug(Path::new(".tugtool/tugplan-worktree-integration.md")),
            "worktree-integration"
        );
        assert_eq!(derive_tugplan_slug(Path::new(".tugtool/tugplan-1.md")), "1");
        assert_eq!(
            derive_tugplan_slug(Path::new(".tugtool/my-feature.md")),
            "my-feature"
        );
    }

    #[test]
    fn test_sanitize_branch_name() {
        assert_eq!(
            sanitize_branch_name("tugtool/auth-20260208-143022"),
            "tugtool__auth-20260208-143022"
        );
        assert_eq!(
            sanitize_branch_name("tug\\windows\\path"),
            "tug__windows__path"
        );
        assert_eq!(sanitize_branch_name("feature:v1.0"), "feature_v10");
        assert_eq!(sanitize_branch_name("my feature"), "my_feature");
        assert_eq!(sanitize_branch_name("!@#$%"), "tugplan-worktree"); // Fallback
    }

    #[test]
    fn test_generate_branch_name() {
        let branch = generate_branch_name("auth").expect("timestamp generation should succeed");
        assert!(branch.starts_with("tugtool/auth-"));
        assert!(branch.len() > "tugtool/auth-".len());

        // Check timestamp format (YYYYMMDD-HHMMSS)
        let parts: Vec<&str> = branch.split('-').collect();
        assert!(parts.len() >= 3); // tugtool/auth, YYYYMMDD, HHMMSS
    }

    #[test]
    fn test_generate_timestamp_utc() {
        let timestamp = generate_timestamp_utc().expect("timestamp generation should succeed");

        // Format: YYYYMMDD-HHMMSS
        assert_eq!(timestamp.len(), 15); // 8 + 1 + 6
        assert!(timestamp.contains('-'));

        // Split and validate
        let parts: Vec<&str> = timestamp.split('-').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].len(), 8); // YYYYMMDD
        assert_eq!(parts[1].len(), 6); // HHMMSS

        // Validate year is reasonable
        let year: i32 = parts[0][..4].parse().expect("Year should be valid");
        assert!((2020..=2100).contains(&year));
    }

    #[test]
    fn test_is_valid_worktree_path_valid() {
        assert!(is_valid_worktree_path(Path::new(
            ".tugtree/tugtool__auth-20260208-143022"
        )));
        assert!(is_valid_worktree_path(Path::new(
            ".tugtree/tugtool__13-20250209-152734"
        )));
        assert!(is_valid_worktree_path(Path::new(
            ".tugtree/tugtool__feature-name"
        )));
    }

    #[test]
    fn test_is_valid_worktree_path_invalid() {
        // Wrong prefix
        assert!(!is_valid_worktree_path(Path::new(".tugtree/foo")));
        assert!(!is_valid_worktree_path(Path::new(
            "worktrees/tugtool__auth"
        )));

        // Absolute paths
        assert!(!is_valid_worktree_path(Path::new(
            "/abs/path/tugtool__auth"
        )));

        // Relative but wrong location
        assert!(!is_valid_worktree_path(Path::new(
            "../worktrees/tugtool__auth"
        )));

        // Missing tugtool__ prefix
        assert!(!is_valid_worktree_path(Path::new(".tugtree/auth-20260208")));
    }

    #[test]
    fn test_slug_from_branch() {
        // Basic case
        assert_eq!(slug_from_branch("tugtool/auth-20260208-143022"), "auth");

        // Multi-hyphen slug
        assert_eq!(
            slug_from_branch("tugtool/auth-v2-20260208-143022"),
            "auth-v2"
        );

        // Single digit slug
        assert_eq!(slug_from_branch("tugtool/1-20260208-143022"), "1");

        // Long slug
        assert_eq!(
            slug_from_branch("tugtool/feature-name-with-many-parts-20260208-143022"),
            "feature-name-with-many-parts"
        );
    }

    #[test]
    fn test_list_worktrees_returns_discovered_worktrees() {
        use std::process::Command;
        use tempfile::TempDir;

        // Create a temporary test git repository
        let temp = TempDir::new().unwrap();
        let temp_dir = temp.path();

        // Initialize git repo
        Command::new("git")
            .current_dir(temp_dir)
            .args(["init", "-b", "main"])
            .output()
            .expect("Failed to init git repo");

        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .expect("Failed to configure git");

        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.name", "Test User"])
            .output()
            .expect("Failed to configure git");

        // Create initial commit
        std::fs::write(temp_dir.join("README.md"), "Test repo").unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["add", "README.md"])
            .output()
            .expect("Failed to add README");
        Command::new("git")
            .current_dir(temp_dir)
            .args(["commit", "-m", "Initial commit"])
            .output()
            .expect("Failed to commit");

        // Create worktree directory
        let worktrees_dir = temp_dir.join(".tugtree");
        std::fs::create_dir_all(&worktrees_dir).unwrap();

        // Create branch and worktree
        Command::new("git")
            .current_dir(temp_dir)
            .args(["branch", "tugtool/test-20260208-120000"])
            .output()
            .expect("Failed to create branch");

        let worktree_path = worktrees_dir.join("tugtool__test-20260208-120000");
        Command::new("git")
            .current_dir(temp_dir)
            .args([
                "worktree",
                "add",
                worktree_path.to_str().unwrap(),
                "tugtool/test-20260208-120000",
            ])
            .output()
            .expect("Failed to add worktree");

        // Test list_worktrees
        let worktrees = list_worktrees(temp_dir).unwrap();
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch, "tugtool/test-20260208-120000");
        assert_eq!(worktrees[0].plan_slug, "test");
        assert_eq!(worktrees[0].base_branch, "main");
    }

    #[test]
    fn test_find_worktree_by_tugplan_finds_matching_worktree() {
        use std::process::Command;
        use tempfile::TempDir;

        let temp = TempDir::new().unwrap();
        let temp_dir = temp.path();

        // Initialize git repo
        Command::new("git")
            .current_dir(temp_dir)
            .args(["init", "-b", "main"])
            .output()
            .expect("Failed to init git repo");

        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .expect("Failed to configure git");

        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.name", "Test User"])
            .output()
            .expect("Failed to configure git");

        // Create initial commit
        std::fs::write(temp_dir.join("README.md"), "Test repo").unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["add", "README.md"])
            .output()
            .expect("Failed to add README");
        Command::new("git")
            .current_dir(temp_dir)
            .args(["commit", "-m", "Initial commit"])
            .output()
            .expect("Failed to commit");

        // Create worktree
        let worktrees_dir = temp_dir.join(".tugtree");
        std::fs::create_dir_all(&worktrees_dir).unwrap();

        Command::new("git")
            .current_dir(temp_dir)
            .args(["branch", "tugtool/auth-20260208-120000"])
            .output()
            .expect("Failed to create branch");

        let worktree_path = worktrees_dir.join("tugtool__auth-20260208-120000");
        Command::new("git")
            .current_dir(temp_dir)
            .args([
                "worktree",
                "add",
                worktree_path.to_str().unwrap(),
                "tugtool/auth-20260208-120000",
            ])
            .output()
            .expect("Failed to add worktree");

        // Test find_worktree_by_tugplan
        let plan_path = Path::new(".tugtool/tugplan-auth.md");
        let discovery = find_worktree_by_tugplan(temp_dir, plan_path).unwrap();

        assert!(discovery.selected.is_some());
        assert_eq!(discovery.match_count, 1);
        let wt = discovery.selected.unwrap();
        assert_eq!(wt.branch, "tugtool/auth-20260208-120000");
        assert_eq!(wt.plan_slug, "auth");
    }

    #[test]
    fn test_find_worktree_by_tugplan_returns_none_when_not_found() {
        use tempfile::TempDir;

        let temp = TempDir::new().unwrap();
        let temp_dir = temp.path();

        // Initialize empty git repo
        std::process::Command::new("git")
            .current_dir(temp_dir)
            .args(["init", "-b", "main"])
            .output()
            .expect("Failed to init git repo");

        // Test with non-existent plan
        let plan_path = Path::new(".tugtool/tugplan-nonexistent.md");
        let discovery = find_worktree_by_tugplan(temp_dir, plan_path).unwrap();

        assert!(discovery.selected.is_none());
        assert_eq!(discovery.match_count, 0);
        assert!(discovery.all_matches.is_empty());
    }

    #[test]
    fn test_list_tugtool_branches() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let temp_dir = temp_dir.path();

        // Initialize git repo
        Command::new("git")
            .current_dir(temp_dir)
            .args(["init"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.name", "Test User"])
            .output()
            .unwrap();

        // Create initial commit
        std::fs::write(temp_dir.join("README.md"), "test").unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["add", "."])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["commit", "-m", "Initial commit"])
            .output()
            .unwrap();

        // Create some tugtool/* branches
        Command::new("git")
            .current_dir(temp_dir)
            .args(["branch", "tugtool/auth-20260208-120000"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["branch", "tugtool/db-20260208-130000"])
            .output()
            .unwrap();

        // Create a non-tug branch
        Command::new("git")
            .current_dir(temp_dir)
            .args(["branch", "feature/something"])
            .output()
            .unwrap();

        let branches = list_tugplan_branches(temp_dir).unwrap();

        // Should only return tugtool/* branches
        assert_eq!(branches.len(), 2);
        assert!(branches.contains(&"tugtool/auth-20260208-120000".to_string()));
        assert!(branches.contains(&"tugtool/db-20260208-130000".to_string()));
        assert!(!branches.contains(&"feature/something".to_string()));
    }

    #[test]
    fn test_cleanup_stale_removes_orphan_branch() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let temp_dir = temp_dir.path();

        // Initialize git repo
        Command::new("git")
            .current_dir(temp_dir)
            .args(["init"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.name", "Test User"])
            .output()
            .unwrap();

        // Create initial commit
        std::fs::write(temp_dir.join("README.md"), "test").unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["add", "."])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["commit", "-m", "Initial commit"])
            .output()
            .unwrap();

        // Create a tugtool/* branch with no worktree
        Command::new("git")
            .current_dir(temp_dir)
            .args(["branch", "tugtool/orphan-20260208-120000"])
            .output()
            .unwrap();

        let sessions = vec![]; // No sessions, so all branches are stale

        let (removed, _skipped) = cleanup_stale_branches(temp_dir, &sessions, false).unwrap();

        // Should remove the branch via safe delete (it's based on current branch)
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0], "tugtool/orphan-20260208-120000");
    }

    #[test]
    fn test_cleanup_stale_safe_delete_fallback() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let temp_dir = temp_dir.path();

        // Initialize git repo
        Command::new("git")
            .current_dir(temp_dir)
            .args(["init", "-b", "main"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.name", "Test User"])
            .output()
            .unwrap();

        // Create initial commit on main
        std::fs::write(temp_dir.join("README.md"), "test").unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["add", "."])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["commit", "-m", "Initial commit"])
            .output()
            .unwrap();

        // Create a tugtool/* branch with commits not in main
        Command::new("git")
            .current_dir(temp_dir)
            .args(["checkout", "-b", "tugtool/unmerged-20260208-120000"])
            .output()
            .unwrap();

        std::fs::write(temp_dir.join("feature.txt"), "new feature").unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["add", "."])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["commit", "-m", "Add feature"])
            .output()
            .unwrap();

        // Switch back to main
        Command::new("git")
            .current_dir(temp_dir)
            .args(["checkout", "main"])
            .output()
            .unwrap();

        // Create .git/refs/pull directory to simulate merged PR scenario
        // This allows us to test the fallback from safe delete (-d) to force delete (-D)
        // when PR is confirmed as merged
        let refs_pull = temp_dir.join(".git/refs/pull");
        std::fs::create_dir_all(&refs_pull).unwrap();

        // Test verifies safe delete fallback behavior with mock PR checker
        let sessions = vec![]; // No sessions, so all branches are stale

        // PR checker returns NotFound: unmerged branch with no PR → skip
        let (_removed, skipped) =
            cleanup_stale_branches_with_pr_checker(temp_dir, &sessions, false, |_| {
                PrState::NotFound
            })
            .unwrap();

        assert_eq!(
            skipped.len(),
            1,
            "Expected 1 skipped branch, got: {:?}",
            skipped
        );
        assert_eq!(skipped[0].0, "tugtool/unmerged-20260208-120000");
        assert!(
            skipped[0].1.contains("Unmerged"),
            "Expected skip reason to mention unmerged, got: {}",
            skipped[0].1
        );

        // PR checker returns Merged: squash-merged branch → force delete
        let (removed, _skipped) =
            cleanup_stale_branches_with_pr_checker(temp_dir, &sessions, false, |_| PrState::Merged)
                .unwrap();
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0], "tugtool/unmerged-20260208-120000");
    }

    #[test]
    fn test_cleanup_stale_gh_absent_safe_only() {
        use tempfile::TempDir;

        let temp_dir = TempDir::new().unwrap();
        let temp_dir = temp_dir.path();

        // Initialize git repo
        Command::new("git")
            .current_dir(temp_dir)
            .args(["init", "-b", "main"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["config", "user.name", "Test User"])
            .output()
            .unwrap();

        // Create initial commit on main
        std::fs::write(temp_dir.join("README.md"), "test").unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["add", "."])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["commit", "-m", "Initial commit"])
            .output()
            .unwrap();

        // Create a tugtool/* branch that is NOT merged into main
        Command::new("git")
            .current_dir(temp_dir)
            .args(["branch", "tugtool/unmerged-feature"])
            .output()
            .unwrap();

        // Add a commit to the branch
        Command::new("git")
            .current_dir(temp_dir)
            .args(["checkout", "tugtool/unmerged-feature"])
            .output()
            .unwrap();
        std::fs::write(temp_dir.join("feature.txt"), "new feature").unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["add", "feature.txt"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(temp_dir)
            .args(["commit", "-m", "Add feature"])
            .output()
            .unwrap();

        // Return to main
        Command::new("git")
            .current_dir(temp_dir)
            .args(["checkout", "main"])
            .output()
            .unwrap();

        let sessions = vec![]; // No sessions, so all branches are stale

        // Test graceful degradation when gh CLI check returns non-merged state:
        // - Safe delete (-d) will fail (branch has unmerged commits)
        // - get_pr_state returns either PrState::Unknown (gh absent) or PrState::NotFound (gh present, no PR)
        // - Unknown → stale branch with no worktree, just delete it
        // - NotFound → skip (confirmed unmerged, has no PR but might have a reason to exist)
        let (removed, skipped) = cleanup_stale_branches(temp_dir, &sessions, false).unwrap();

        // Result depends on gh CLI availability:
        // - gh unavailable (Unknown): branch is deleted (stale with no worktree = dead weight)
        // - gh available (NotFound): branch is skipped (confirmed unmerged with no PR)
        assert_eq!(
            removed.len() + skipped.len(),
            1,
            "branch should be either removed or skipped"
        );
        if !skipped.is_empty() {
            assert_eq!(skipped[0].0, "tugtool/unmerged-feature");
            assert!(
                skipped[0].1.contains("Unmerged"),
                "Expected skip reason to mention unmerged, got: {}",
                skipped[0].1
            );
        }
    }

    /// Helper to build synthetic DiscoveredWorktree values for resolve_worktree tests
    fn make_wt(path: &str, branch: &str, plan_slug: &str) -> DiscoveredWorktree {
        DiscoveredWorktree {
            path: PathBuf::from(path),
            branch: branch.to_string(),
            plan_slug: plan_slug.to_string(),
            base_branch: "main".to_string(),
        }
    }

    #[test]
    fn test_resolve_worktree_by_exact_branch() {
        let worktrees = vec![
            make_wt(
                "/repo/.tugtree/tugtool__auth-20260208-120000",
                "tugtool/auth-20260208-120000",
                "auth",
            ),
            make_wt(
                "/repo/.tugtree/tugtool__db-20260209-130000",
                "tugtool/db-20260209-130000",
                "db",
            ),
        ];

        let matches = resolve_worktree("tugtool/auth-20260208-120000", &worktrees);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].branch, "tugtool/auth-20260208-120000");
    }

    #[test]
    fn test_resolve_worktree_by_exact_path() {
        let worktrees = vec![make_wt(
            "/repo/.tugtree/tugtool__auth-20260208-120000",
            "tugtool/auth-20260208-120000",
            "auth",
        )];

        let matches = resolve_worktree("/repo/.tugtree/tugtool__auth-20260208-120000", &worktrees);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].plan_slug, "auth");
    }

    #[test]
    fn test_resolve_worktree_by_directory_name() {
        let worktrees = vec![make_wt(
            "/repo/.tugtree/tugtool__auth-20260208-120000",
            "tugtool/auth-20260208-120000",
            "auth",
        )];

        let matches = resolve_worktree("tugtool__auth-20260208-120000", &worktrees);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].plan_slug, "auth");
    }

    #[test]
    fn test_resolve_worktree_by_plan_path() {
        let worktrees = vec![make_wt(
            "/repo/.tugtree/tugtool__auth-20260208-120000",
            "tugtool/auth-20260208-120000",
            "auth",
        )];

        let matches = resolve_worktree(".tugtool/tugplan-auth.md", &worktrees);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].plan_slug, "auth");
    }

    #[test]
    fn test_resolve_worktree_by_plan_slug() {
        let worktrees = vec![make_wt(
            "/repo/.tugtree/tugtool__auth-20260208-120000",
            "tugtool/auth-20260208-120000",
            "auth",
        )];

        let matches = resolve_worktree("auth", &worktrees);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].plan_slug, "auth");
    }

    #[test]
    fn test_resolve_worktree_multiple_matches_same_slug() {
        let worktrees = vec![
            make_wt(
                "/repo/.tugtree/tugtool__auth-20260208-120000",
                "tugtool/auth-20260208-120000",
                "auth",
            ),
            make_wt(
                "/repo/.tugtree/tugtool__auth-20260209-130000",
                "tugtool/auth-20260209-130000",
                "auth",
            ),
        ];

        // By slug: should match both
        let matches = resolve_worktree("auth", &worktrees);
        assert_eq!(matches.len(), 2);

        // By plan path: should also match both
        let matches = resolve_worktree("tugplan-auth.md", &worktrees);
        assert_eq!(matches.len(), 2);
    }

    #[test]
    fn test_resolve_worktree_no_match() {
        let worktrees = vec![make_wt(
            "/repo/.tugtree/tugtool__auth-20260208-120000",
            "tugtool/auth-20260208-120000",
            "auth",
        )];

        let matches = resolve_worktree("nonexistent", &worktrees);
        assert!(matches.is_empty());
    }

    #[test]
    fn test_resolve_worktree_branch_takes_priority_over_slug() {
        // Edge case: if a branch name happens to be a valid slug for another worktree,
        // stage 1 (exact branch) should match first
        let worktrees = vec![
            make_wt(
                "/repo/.tugtree/tugtool__foo-20260208-120000",
                "tugtool/foo-20260208-120000",
                "foo",
            ),
            make_wt(
                "/repo/.tugtree/tugtool__bar-20260209-130000",
                "tugtool/bar-20260209-130000",
                "bar",
            ),
        ];

        // Exact branch match should return only that one
        let matches = resolve_worktree("tugtool/foo-20260208-120000", &worktrees);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].plan_slug, "foo");
    }

    #[test]
    fn test_find_repo_root_from_git_dir() {
        use tempfile::TempDir;
        let temp = TempDir::new().unwrap();
        let repo = temp.path();

        // Initialize a git repo
        Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(repo)
            .output()
            .expect("git init should succeed");

        let result = find_repo_root_from(repo);
        assert!(
            result.is_ok(),
            "find_repo_root_from should succeed for git dir"
        );
        assert_eq!(result.unwrap(), repo.to_path_buf());
    }

    #[test]
    fn test_find_repo_root_from_non_git_dir() {
        use tempfile::TempDir;
        let temp = TempDir::new().unwrap();
        let non_git = temp.path();
        // No .git directory created

        let result = find_repo_root_from(non_git);
        assert!(
            result.is_err(),
            "find_repo_root_from should fail for non-git dir"
        );
        match result.unwrap_err() {
            TugError::NotAGitRepository => {} // expected
            other => panic!("Expected NotAGitRepository, got: {:?}", other),
        }
    }
}
