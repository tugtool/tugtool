//! Fixture management for tugtool.
//!
//! Provides utilities to fetch, update, and manage test fixtures.
//! Fixtures are external git repositories pinned to specific SHAs
//! via lock files in the `fixtures/` directory.
//!
//! # Overview
//!
//! Fixtures follow a simple pattern:
//! - Lock files at `fixtures/<name>.lock` pin exact versions (ref + SHA)
//! - Fetched fixtures live at `.tug/fixtures/<name>/`
//! - Environment variables (`TUG_<NAME>_PATH`) provide development overrides
//!
//! # Example Lock File
//!
//! ```toml
//! [fixture]
//! name = "temporale"
//! repository = "https://github.com/tugtool/temporale"
//! ref = "v0.1.0"
//! sha = "9f21df0322b7aa39ca7f599b128f66c07ecec42f"
//! ```

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Information parsed from a fixture lock file.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FixtureInfo {
    /// Fixture name (e.g., "temporale").
    pub name: String,
    /// Git repository URL.
    pub repository: String,
    /// Git ref (tag or branch name).
    #[serde(rename = "ref")]
    pub git_ref: String,
    /// Full commit SHA for verification.
    pub sha: String,
}

/// Internal structure for parsing lock files.
#[derive(Debug, Clone, Deserialize)]
struct LockFile {
    fixture: FixtureInfo,
}

/// Discover all lock files in the fixtures directory.
///
/// Returns a list of lock file paths sorted alphabetically by name.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root (containing `fixtures/` directory)
///
/// # Returns
/// - `Ok(Vec<PathBuf>)`: List of lock file paths
/// - `Err(String)`: Error if fixtures directory doesn't exist or can't be read
pub fn discover_lock_files(workspace_root: &Path) -> Result<Vec<PathBuf>, String> {
    let fixtures_dir = workspace_root.join("fixtures");

    if !fixtures_dir.exists() {
        return Err(format!(
            "Fixtures directory not found: {}",
            fixtures_dir.display()
        ));
    }

    let entries = std::fs::read_dir(&fixtures_dir)
        .map_err(|e| format!("Failed to read fixtures directory: {}", e))?;

    let mut lock_files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .map(|ext| ext == "lock")
                .unwrap_or(false)
        })
        .collect();

    // Sort for deterministic ordering
    lock_files.sort();

    Ok(lock_files)
}

/// Read and parse a fixture lock file from an explicit path.
///
/// # Arguments
/// - `lock_path`: Path to the lock file
///
/// # Returns
/// - `Ok(FixtureInfo)`: Parsed fixture information
/// - `Err(String)`: Error if file doesn't exist or contains invalid TOML
pub fn read_lock_file(lock_path: &Path) -> Result<FixtureInfo, String> {
    let content = std::fs::read_to_string(lock_path)
        .map_err(|e| format!("Failed to read {}: {}", lock_path.display(), e))?;

    // Use a real TOML parser. Ad-hoc parsing breaks on valid TOML,
    // especially inline comments (e.g. `ref = "v0.1.0"  # tag`).
    let lock: LockFile = toml::from_str(&content)
        .map_err(|e| format!("Invalid TOML in {}: {}", lock_path.display(), e))?;

    Ok(lock.fixture)
}

/// Read and parse a fixture lock file by name from a workspace root.
///
/// Convenience wrapper that constructs the lock file path.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
/// - `name`: Fixture name (e.g., "temporale")
///
/// # Returns
/// - `Ok(FixtureInfo)`: Parsed fixture information
/// - `Err(String)`: Error if file doesn't exist or contains invalid TOML
pub fn read_lock_file_by_name(workspace_root: &Path, name: &str) -> Result<FixtureInfo, String> {
    let lock_path = workspace_root
        .join("fixtures")
        .join(format!("{}.lock", name));
    read_lock_file(&lock_path)
}

/// Verify that git is available in PATH.
///
/// # Returns
/// - `Ok(PathBuf)`: Path to the git executable
/// - `Err(String)`: Error if git is not found or not executable
pub fn verify_git_available() -> Result<PathBuf, String> {
    // Use `which` on Unix or `where` on Windows to find git
    let output = if cfg!(windows) {
        Command::new("where").arg("git").output()
    } else {
        Command::new("which").arg("git").output()
    };

    match output {
        Ok(output) if output.status.success() => {
            let path_str = String::from_utf8_lossy(&output.stdout);
            let path = path_str.lines().next().unwrap_or("").trim();
            if path.is_empty() {
                Err("git not found in PATH".to_string())
            } else {
                Ok(PathBuf::from(path))
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("git not found in PATH: {}", stderr.trim()))
        }
        Err(e) => Err(format!("Failed to check for git: {}", e)),
    }
}

/// Get the path where a fixture should be stored.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
/// - `name`: Fixture name (e.g., "temporale")
///
/// # Returns
/// The path `.tug/fixtures/<name>/` under the workspace root.
pub fn fixture_path(workspace_root: &Path, name: &str) -> PathBuf {
    workspace_root.join(".tug").join("fixtures").join(name)
}

/// Get the SHA of HEAD in a git repository.
///
/// # Arguments
/// - `repo_path`: Path to the git repository
///
/// # Returns
/// - `Ok(String)`: The full SHA of HEAD
/// - `Err(String)`: Error if git command fails
pub fn get_repo_sha(repo_path: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run git rev-parse: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git rev-parse failed: {}", stderr.trim()));
    }

    let sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if sha.is_empty() {
        return Err("git rev-parse returned empty SHA".to_string());
    }

    Ok(sha)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_discover_lock_files_finds_files() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // Create some lock files
        std::fs::write(fixtures_dir.join("alpha.lock"), "[fixture]\nname = \"alpha\"\nrepository = \"url\"\nref = \"v1\"\nsha = \"abc\"").unwrap();
        std::fs::write(fixtures_dir.join("beta.lock"), "[fixture]\nname = \"beta\"\nrepository = \"url\"\nref = \"v1\"\nsha = \"def\"").unwrap();
        // Create a non-lock file that should be ignored
        std::fs::write(fixtures_dir.join("readme.txt"), "not a lock file").unwrap();

        let lock_files = discover_lock_files(dir.path()).unwrap();
        assert_eq!(lock_files.len(), 2);
        assert!(lock_files[0].ends_with("alpha.lock"));
        assert!(lock_files[1].ends_with("beta.lock"));
    }

    #[test]
    fn test_discover_lock_files_empty_dir() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_files = discover_lock_files(dir.path()).unwrap();
        assert!(lock_files.is_empty());
    }

    #[test]
    fn test_discover_lock_files_no_fixtures_dir() {
        let dir = TempDir::new().unwrap();
        let result = discover_lock_files(dir.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_read_lock_file_valid() {
        let dir = TempDir::new().unwrap();
        let lock_content = r#"
[fixture]
name = "test-fixture"
repository = "https://github.com/example/test"
ref = "v1.0.0"
sha = "abc123def456"
"#;
        let lock_path = dir.path().join("test.lock");
        std::fs::write(&lock_path, lock_content).unwrap();

        let info = read_lock_file(&lock_path).unwrap();
        assert_eq!(info.name, "test-fixture");
        assert_eq!(info.repository, "https://github.com/example/test");
        assert_eq!(info.git_ref, "v1.0.0");
        assert_eq!(info.sha, "abc123def456");
    }

    #[test]
    fn test_read_lock_file_with_comments() {
        let dir = TempDir::new().unwrap();
        let lock_content = r#"
# This is a header comment
[fixture]
name = "commented"  # inline comment
repository = "https://github.com/example/test"
ref = "v1.0.0"  # tag name
sha = "abc123def456"

[fixture.metadata]
description = "Optional metadata"
"#;
        let lock_path = dir.path().join("commented.lock");
        std::fs::write(&lock_path, lock_content).unwrap();

        let info = read_lock_file(&lock_path).unwrap();
        assert_eq!(info.git_ref, "v1.0.0"); // NOT "v1.0.0  # tag name"
    }

    #[test]
    fn test_read_lock_file_missing_field() {
        let dir = TempDir::new().unwrap();
        let lock_content = r#"
[fixture]
name = "incomplete"
repository = "https://github.com/example/test"
# Missing ref and sha
"#;
        let lock_path = dir.path().join("incomplete.lock");
        std::fs::write(&lock_path, lock_content).unwrap();

        let result = read_lock_file(&lock_path);
        assert!(result.is_err());
    }

    #[test]
    fn test_read_lock_file_malformed_toml() {
        let dir = TempDir::new().unwrap();
        let lock_content = "this is not valid TOML {{{";
        let lock_path = dir.path().join("malformed.lock");
        std::fs::write(&lock_path, lock_content).unwrap();

        let result = read_lock_file(&lock_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid TOML"));
    }

    #[test]
    fn test_read_lock_file_by_name() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = r#"
[fixture]
name = "myfix"
repository = "https://github.com/example/test"
ref = "v2.0.0"
sha = "deadbeef"
"#;
        std::fs::write(fixtures_dir.join("myfix.lock"), lock_content).unwrap();

        let info = read_lock_file_by_name(dir.path(), "myfix").unwrap();
        assert_eq!(info.name, "myfix");
        assert_eq!(info.git_ref, "v2.0.0");
    }

    #[test]
    fn test_verify_git_available() {
        // This test assumes git is installed on development machines
        let result = verify_git_available();
        assert!(result.is_ok(), "git should be available: {:?}", result);
        let path = result.unwrap();
        assert!(path.to_string_lossy().contains("git"));
    }

    #[test]
    fn test_fixture_path() {
        let workspace = PathBuf::from("/workspace");
        let path = fixture_path(&workspace, "temporale");
        assert_eq!(path, PathBuf::from("/workspace/.tug/fixtures/temporale"));
    }
}
