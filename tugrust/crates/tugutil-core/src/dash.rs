//! Dash helpers — git-derived lightweight worktree work units.
//!
//! A dash *is* a git branch (`tugdash/<name>`) plus a worktree
//! (`.tugtree/tugdash__<name>`); its lifecycle and status derive from git, not
//! a database. This module holds the small shared helpers the `tugutil dash`
//! commands build on: name validation, default-branch detection, and the
//! append-only visibility log.

use crate::error::TugError;
use crate::paths::project_state_dir;
use crate::session::now_iso8601;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::process::Command;

/// Round metadata passed via stdin to `tugutil dash commit`.
///
/// Git already records the commit; the one datum it lacks is the verbatim
/// instruction, which lands in the dash-log. `summary` is retained for a richer
/// commit body. (The former `files_created` / `files_modified` fields were
/// dropped — git's own diff is the record.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashRoundMeta {
    pub instruction: Option<String>,
    pub summary: Option<String>,
}

/// Validate a dash name.
///
/// Names must:
/// - Match pattern: `^[a-z][a-z0-9-]*[a-z0-9]$`
/// - Be at least 2 characters
/// - Not be a reserved word: "release", "join", "status"
pub fn validate_dash_name(name: &str) -> Result<(), TugError> {
    // Reserved words check
    if name == "release" || name == "join" || name == "status" {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: format!("'{}' is a reserved word", name),
        });
    }

    // Minimum length
    if name.len() < 2 {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must be at least 2 characters".to_string(),
        });
    }

    // Pattern validation
    let chars: Vec<char> = name.chars().collect();

    // Must start with lowercase letter
    if !chars[0].is_ascii_lowercase() {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must start with a lowercase letter".to_string(),
        });
    }

    // Must end with lowercase letter or digit
    if !chars[chars.len() - 1].is_ascii_lowercase() && !chars[chars.len() - 1].is_ascii_digit() {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must end with a lowercase letter or digit".to_string(),
        });
    }

    // All characters must be lowercase letter, digit, or hyphen
    for ch in chars.iter() {
        if !ch.is_ascii_lowercase() && !ch.is_ascii_digit() && *ch != '-' {
            return Err(TugError::DashNameInvalid {
                name: name.to_string(),
                reason: "name must contain only lowercase letters, digits, and hyphens".to_string(),
            });
        }
    }

    Ok(())
}

/// Detect the default branch using a four-step fallback chain.
///
/// 1. Try `git symbolic-ref refs/remotes/origin/HEAD` (extract branch name)
/// 2. If that fails: check if `main` exists locally
/// 3. If that fails: check if `master` exists locally
/// 4. If all fail: error with message listing available local branches
pub fn detect_default_branch(repo_root: &Path) -> Result<String, TugError> {
    // Step 1: Try origin/HEAD
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("symbolic-ref")
        .arg("refs/remotes/origin/HEAD")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            let symref = String::from_utf8_lossy(&output.stdout);
            // Format is "refs/remotes/origin/<branch>"
            if let Some(branch) = symref.trim().strip_prefix("refs/remotes/origin/") {
                return Ok(branch.to_string());
            }
        }
    }

    // Step 2: Check if main exists
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--verify")
        .arg("main")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            return Ok("main".to_string());
        }
    }

    // Step 3: Check if master exists
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--verify")
        .arg("master")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            return Ok("master".to_string());
        }
    }

    // Step 4: Error with available branches
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("branch")
        .arg("--format=%(refname:short)")
        .output()
        .map_err(|e| TugError::WorktreeCreationFailed {
            reason: format!("failed to list branches: {}", e),
        })?;

    let branches = String::from_utf8_lossy(&output.stdout);
    let branch_list: Vec<&str> = branches.lines().collect();

    Err(TugError::BaseBranchNotFound {
        branch: format!(
            "Could not detect default branch. Available local branches: {}",
            branch_list.join(", ")
        ),
    })
}

/// Append one record to the per-project dash-log under [`project_state_dir`].
///
/// The log is a flat, append-only, greppable markdown file — the whole
/// visibility surface for dash activity. Each line is four space-separated
/// fields: `<iso8601>  <dash>  <marker>  <note>`, where `<marker>` is the short
/// commit hash for a commit round (or `released` for a discarded dash) and
/// `<note>` is the verbatim instruction (or the terminal action). The directory
/// is created on first write.
pub fn append_dash_log(
    repo_root: &Path,
    dash: &str,
    marker: &str,
    note: &str,
) -> Result<(), TugError> {
    let dir = project_state_dir(repo_root);
    fs::create_dir_all(&dir).map_err(TugError::Io)?;
    let path = dir.join("dash-log.md");

    let note = note.replace('\n', " ");
    let line = format!("{}  {}  {}  {}\n", now_iso8601(), dash, marker, note.trim());

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(TugError::Io)?;
    file.write_all(line.as_bytes()).map_err(TugError::Io)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_dash_name_valid() {
        assert!(validate_dash_name("ab").is_ok());
        assert!(validate_dash_name("login-page").is_ok());
        assert!(validate_dash_name("fix-bug").is_ok());
        assert!(validate_dash_name("test-123").is_ok());
        assert!(validate_dash_name("a1").is_ok());
    }

    #[test]
    fn test_validate_dash_name_invalid() {
        // Too short
        assert!(validate_dash_name("a").is_err());

        // Reserved words
        assert!(validate_dash_name("release").is_err());
        assert!(validate_dash_name("join").is_err());
        assert!(validate_dash_name("status").is_err());

        // Uppercase
        assert!(validate_dash_name("Login-Page").is_err());

        // Special chars
        assert!(validate_dash_name("login_page").is_err());
        assert!(validate_dash_name("login.page").is_err());

        // Leading hyphen
        assert!(validate_dash_name("-login").is_err());

        // Trailing hyphen
        assert!(validate_dash_name("login-").is_err());

        // Starts with digit
        assert!(validate_dash_name("1login").is_err());
    }
}
