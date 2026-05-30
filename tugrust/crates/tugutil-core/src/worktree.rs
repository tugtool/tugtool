//! Git repository-root resolution and branch-name sanitization.
//!
//! The plan-worktree lifecycle (create/list/cleanup/discover) was retired
//! along with the `tugutil worktree` / `merge` CLI commands. What remains are
//! the small git helpers the surviving `dash` flow still uses.

use crate::error::TugError;
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
pub(crate) fn find_repo_root_from(start: &Path) -> Result<PathBuf, TugError> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_branch_name() {
        assert_eq!(
            sanitize_branch_name("tugplan/auth-20260208-143022"),
            "tugplan__auth-20260208-143022"
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
