//! step-publish command implementation
//!
//! Pushes branch to remote and creates PR.

use crate::output::{JsonResponse, StepPublishData};
use std::fs;
use std::path::Path;
use std::process::Command;

/// Run the step-publish command
#[allow(clippy::too_many_arguments)]
pub fn run_step_publish(
    worktree: String,
    branch: String,
    base: String,
    title: String,
    _plan: String,
    repo: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    let worktree_path = Path::new(&worktree);

    // Validate inputs
    if !worktree_path.exists() {
        return error_response("Worktree directory does not exist", json, quiet);
    }

    // Step 1: Check gh auth status
    let output = Command::new("gh")
        .arg("auth")
        .arg("status")
        .output()
        .map_err(|e| format!("Failed to run gh auth status: {}", e))?;

    if !output.status.success() {
        return error_response(
            "GitHub CLI not authenticated. Run 'gh auth login'",
            json,
            quiet,
        );
    }

    // Step 2: Derive repo from git remote if not provided
    let repo_name = if let Some(r) = repo {
        r
    } else {
        derive_repo_from_remote(worktree_path)?
    };

    // Step 3: Generate PR body from git log
    let pr_body = generate_pr_body(worktree_path, &base)?;

    // Write PR body to temp file to avoid shell escaping issues
    let temp_body_path = worktree_path.join(".tug").join("pr-body.md");
    fs::write(&temp_body_path, &pr_body)
        .map_err(|e| format!("Failed to write PR body temp file: {}", e))?;

    // Step 4: Push branch
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("push")
        .arg("-u")
        .arg("origin")
        .arg(&branch)
        .output()
        .map_err(|e| format!("Failed to run git push: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return error_response(&format!("git push failed: {}", stderr), json, quiet);
    }

    let pushed = true;

    // Step 5: Create PR
    let output = Command::new("gh")
        .arg("pr")
        .arg("create")
        .arg("--repo")
        .arg(&repo_name)
        .arg("--base")
        .arg(&base)
        .arg("--head")
        .arg(&branch)
        .arg("--title")
        .arg(&title)
        .arg("--body-file")
        .arg(&temp_body_path)
        .current_dir(worktree_path)
        .output()
        .map_err(|e| format!("Failed to run gh pr create: {}", e))?;

    // Clean up temp file
    let _ = fs::remove_file(&temp_body_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Partial success: pushed but PR failed
        let data = StepPublishData {
            success: false,
            pushed,
            pr_created: false,
            repo: Some(repo_name),
            pr_url: None,
            pr_number: None,
        };

        if json {
            let response = JsonResponse::ok("step-publish", data);
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
        } else if !quiet {
            eprintln!(
                "Branch pushed successfully, but PR creation failed: {}",
                stderr
            );
        }

        return Ok(0); // Exit 0 for partial success
    }

    let pr_created = true;

    // Parse PR URL and number from gh output
    let stdout = String::from_utf8_lossy(&output.stdout);
    let (pr_url, pr_number) = parse_pr_info(&stdout);

    // Step 6: Return response
    let data = StepPublishData {
        success: true,
        pushed,
        pr_created,
        repo: Some(repo_name),
        pr_url,
        pr_number,
    };

    if json {
        let response = JsonResponse::ok("step-publish", data);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        println!("Implementation published successfully");
        if let Some(url) = &data.pr_url {
            println!("  PR: {}", url);
        }
        if let Some(num) = data.pr_number {
            println!("  PR number: {}", num);
        }
    }

    Ok(0)
}

/// Helper to derive repo from git remote URL
fn derive_repo_from_remote(worktree_path: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("remote")
        .arg("get-url")
        .arg("origin")
        .output()
        .map_err(|e| format!("Failed to get git remote URL: {}", e))?;

    if !output.status.success() {
        return Err("No git remote 'origin' configured".to_string());
    }

    let remote_url = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Parse different URL formats:
    // SSH: git@github.com:owner/repo.git
    // HTTPS: https://github.com/owner/repo.git
    // HTTPS without .git: https://github.com/owner/repo

    // Try SSH format first
    if let Some(ssh_match) = remote_url.strip_prefix("git@github.com:") {
        let repo = ssh_match.strip_suffix(".git").unwrap_or(ssh_match);
        return Ok(repo.to_string());
    }

    // Try HTTPS format
    if let Some(https_match) = remote_url.strip_prefix("https://github.com/") {
        let repo = https_match.strip_suffix(".git").unwrap_or(https_match);
        return Ok(repo.to_string());
    }

    Err(format!(
        "Cannot parse GitHub repo from remote URL: {}",
        remote_url
    ))
}

/// Helper to generate PR body markdown from git log
fn generate_pr_body(worktree_path: &Path, base: &str) -> Result<String, String> {
    // Run git log to get commits from base..HEAD
    let output = Command::new("git")
        .arg("-C")
        .arg(worktree_path)
        .arg("log")
        .arg("--oneline")
        .arg(format!("{}..HEAD", base))
        .output()
        .map_err(|e| format!("Failed to run git log: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git log failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<&str> = stdout.lines().collect();

    let mut body = String::new();

    body.push_str("## Summary\n\n");
    if commits.is_empty() {
        body.push_str("- No commits found\n");
    } else {
        for commit in commits.iter().rev() {
            // Commits are in reverse chronological order (newest first)
            // We want oldest first, so reverse
            // Format: "abcd123 commit message"
            // Extract just the message (everything after first space)
            if let Some((_hash, message)) = commit.split_once(' ') {
                body.push_str(&format!("- {}\n", message));
            } else {
                // Fallback: use the whole line
                body.push_str(&format!("- {}\n", commit));
            }
        }
    }
    body.push('\n');

    body.push_str("## Test plan\n\n");
    body.push_str("- [ ] Build passes\n");
    body.push_str("- [ ] All tests pass\n");
    body.push_str("- [ ] Manual testing completed\n");
    body.push('\n');

    body.push_str("🤖 Generated with [Claude Code](https://claude.com/claude-code)\n");

    Ok(body)
}

/// Helper to parse PR URL and number from gh pr create output
fn parse_pr_info(stdout: &str) -> (Option<String>, Option<i64>) {
    // gh pr create output typically contains a line like:
    // https://github.com/owner/repo/pull/123

    for line in stdout.lines() {
        if line.contains("/pull/") {
            let url = line.trim().to_string();
            // Extract PR number from URL
            if let Some(number_str) = url.rsplit('/').next() {
                if let Ok(number) = number_str.parse::<i64>() {
                    return (Some(url), Some(number));
                }
            }
            return (Some(url), None);
        }
    }

    (None, None)
}

/// Helper to construct error response
fn error_response(message: &str, json: bool, quiet: bool) -> Result<i32, String> {
    let data = StepPublishData {
        success: false,
        pushed: false,
        pr_created: false,
        repo: None,
        pr_url: None,
        pr_number: None,
    };

    if json {
        let response = JsonResponse::error("step-publish", data, vec![]);
        println!("{}", serde_json::to_string_pretty(&response).unwrap());
    } else if !quiet {
        eprintln!("Error: {}", message);
    }

    Err(message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_repo_from_ssh_url() {
        // Simulate SSH URL parsing
        let ssh_url = "git@github.com:owner/repo.git";
        let repo = ssh_url
            .strip_prefix("git@github.com:")
            .map(|s| s.strip_suffix(".git").unwrap_or(s))
            .unwrap();
        assert_eq!(repo, "owner/repo");
    }

    #[test]
    fn test_derive_repo_from_https_url() {
        // Simulate HTTPS URL parsing
        let https_url = "https://github.com/owner/repo.git";
        let repo = https_url
            .strip_prefix("https://github.com/")
            .map(|s| s.strip_suffix(".git").unwrap_or(s))
            .unwrap();
        assert_eq!(repo, "owner/repo");
    }

    #[test]
    fn test_derive_repo_from_https_url_without_git() {
        // Simulate HTTPS URL without .git suffix
        let https_url = "https://github.com/owner/repo";
        let repo = https_url
            .strip_prefix("https://github.com/")
            .map(|s| s.strip_suffix(".git").unwrap_or(s))
            .unwrap();
        assert_eq!(repo, "owner/repo");
    }

    #[test]
    fn test_generate_pr_body() {
        use std::fs;
        use tempfile::TempDir;

        // Create temp directory and init git repo
        let temp = TempDir::new().unwrap();
        let repo_path = temp.path();

        // Init repo
        Command::new("git")
            .arg("init")
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Configure git
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Create initial commit on main
        fs::write(repo_path.join("file.txt"), "initial").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Create main branch reference
        Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Create feature commits
        fs::write(repo_path.join("file.txt"), "step 0").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "feat: add user model"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        fs::write(repo_path.join("file.txt"), "step 1").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "feat: add authentication handlers"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Generate PR body from git log
        let body = generate_pr_body(repo_path, "main~2").unwrap();

        assert!(body.contains("## Summary"));
        assert!(body.contains("- feat: add user model"));
        assert!(body.contains("- feat: add authentication handlers"));
        assert!(body.contains("## Test plan"));
        assert!(body.contains("Build passes"));
        assert!(body.contains("Claude Code"));
    }

    #[test]
    fn test_parse_pr_info_with_url() {
        let output = "https://github.com/owner/repo/pull/123\n";
        let (url, number) = parse_pr_info(output);
        assert_eq!(
            url,
            Some("https://github.com/owner/repo/pull/123".to_string())
        );
        assert_eq!(number, Some(123));
    }

    #[test]
    fn test_parse_pr_info_with_multiline_output() {
        let output = "Creating pull request...\nhttps://github.com/owner/repo/pull/456\nDone!\n";
        let (url, number) = parse_pr_info(output);
        assert_eq!(
            url,
            Some("https://github.com/owner/repo/pull/456".to_string())
        );
        assert_eq!(number, Some(456));
    }

    #[test]
    fn test_parse_pr_info_no_url() {
        let output = "Some other output\nNo PR URL here\n";
        let (url, number) = parse_pr_info(output);
        assert_eq!(url, None);
        assert_eq!(number, None);
    }
}
