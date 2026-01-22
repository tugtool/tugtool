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

// ============================================================================
// Fetch Operation Types and Functions
// ============================================================================

/// Action taken during a fixture fetch operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FetchAction {
    /// Fixture was freshly cloned (did not exist before).
    Fetched,
    /// Fixture already existed with correct SHA.
    UpToDate,
    /// Fixture existed but had wrong SHA, was re-fetched.
    Updated,
}

impl std::fmt::Display for FetchAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchAction::Fetched => write!(f, "fetched"),
            FetchAction::UpToDate => write!(f, "up-to-date"),
            FetchAction::Updated => write!(f, "updated"),
        }
    }
}

/// Result of a fixture fetch operation.
#[derive(Debug, Clone, Serialize)]
pub struct FetchResult {
    /// Fixture name.
    pub name: String,
    /// Action taken.
    pub action: FetchAction,
    /// Path where the fixture is stored.
    pub path: PathBuf,
    /// Git repository URL.
    pub repository: String,
    /// Git ref (tag or branch).
    pub git_ref: String,
    /// Commit SHA.
    pub sha: String,
}

/// Error during fixture operations.
#[derive(Debug, Clone)]
pub struct FixtureError {
    /// Fixture name (if known).
    pub name: Option<String>,
    /// Error message.
    pub message: String,
}

impl std::fmt::Display for FixtureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(name) = &self.name {
            write!(f, "fixture '{}': {}", name, self.message)
        } else {
            write!(f, "{}", self.message)
        }
    }
}

impl std::error::Error for FixtureError {}

impl FixtureError {
    /// Create a new fixture error.
    pub fn new(name: impl Into<Option<String>>, message: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            message: message.into(),
        }
    }

    /// Create a fixture error with a name.
    pub fn with_name(name: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            name: Some(name.into()),
            message: message.into(),
        }
    }

    /// Create a fixture error without a name.
    pub fn without_name(message: impl Into<String>) -> Self {
        Self {
            name: None,
            message: message.into(),
        }
    }
}

/// Clone a git repository to a target directory.
///
/// Uses `git clone --depth 1 --branch <ref>` for efficient shallow clones.
fn clone_repository(
    repository: &str,
    git_ref: &str,
    target_dir: &Path,
) -> Result<(), FixtureError> {
    let output = Command::new("git")
        .args([
            "clone",
            "--depth",
            "1",
            "--branch",
            git_ref,
            repository,
            &target_dir.to_string_lossy(),
        ])
        .output()
        .map_err(|e| FixtureError::without_name(format!("Failed to run git clone: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(FixtureError::without_name(format!(
            "git clone failed: {}",
            stderr.trim()
        )));
    }

    Ok(())
}

/// Fetch a single fixture.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
/// - `info`: Fixture information from the lock file
/// - `force`: If true, re-fetch even if the fixture exists and SHA matches
///
/// # Returns
/// - `Ok(FetchResult)`: Result of the fetch operation
/// - `Err(FixtureError)`: Error if fetch fails
///
/// # Behavior
/// 1. If the fixture directory exists:
///    - If `force` is true, delete it and re-fetch
///    - Otherwise, verify the SHA matches the lock file
///    - If SHA matches, return `UpToDate`
///    - If SHA mismatches, delete and re-fetch (returns `Updated`)
/// 2. If the fixture directory does not exist (or was deleted):
///    - Clone to a temp directory
///    - Verify the cloned SHA matches the lock file
///    - Move to the final location
///    - Return `Fetched`
pub fn fetch_fixture(
    workspace_root: &Path,
    info: &FixtureInfo,
    force: bool,
) -> Result<FetchResult, FixtureError> {
    // 1. Verify git is available
    verify_git_available().map_err(|e| FixtureError::with_name(&info.name, e))?;

    let target_path = fixture_path(workspace_root, &info.name);
    let mut action = FetchAction::Fetched;

    // 2. Check if fixture already exists
    if target_path.exists() {
        if force {
            // Force re-fetch: delete existing
            std::fs::remove_dir_all(&target_path).map_err(|e| {
                FixtureError::with_name(
                    &info.name,
                    format!("Failed to remove existing fixture: {}", e),
                )
            })?;
            action = FetchAction::Updated;
        } else {
            // Check SHA
            match get_repo_sha(&target_path) {
                Ok(current_sha) if current_sha == info.sha => {
                    // Up to date
                    return Ok(FetchResult {
                        name: info.name.clone(),
                        action: FetchAction::UpToDate,
                        path: target_path,
                        repository: info.repository.clone(),
                        git_ref: info.git_ref.clone(),
                        sha: info.sha.clone(),
                    });
                }
                Ok(_) => {
                    // SHA mismatch - delete and re-fetch
                    std::fs::remove_dir_all(&target_path).map_err(|e| {
                        FixtureError::with_name(
                            &info.name,
                            format!("Failed to remove outdated fixture: {}", e),
                        )
                    })?;
                    action = FetchAction::Updated;
                }
                Err(_) => {
                    // Can't get SHA (not a git repo?) - delete and re-fetch
                    std::fs::remove_dir_all(&target_path).map_err(|e| {
                        FixtureError::with_name(
                            &info.name,
                            format!("Failed to remove invalid fixture: {}", e),
                        )
                    })?;
                    action = FetchAction::Updated;
                }
            }
        }
    }

    // 3. Ensure parent directories exist
    let fixtures_dir = workspace_root.join(".tug").join("fixtures");
    std::fs::create_dir_all(&fixtures_dir).map_err(|e| {
        FixtureError::with_name(
            &info.name,
            format!("Failed to create fixtures directory: {}", e),
        )
    })?;

    // 4. Clone to temp directory (atomic fetch)
    // Use a temp directory within .tug/ to ensure same filesystem for atomic move
    let temp_dir = fixtures_dir.join(format!(".tmp-{}-{}", info.name, std::process::id()));

    // Clean up any existing temp dir from a previous failed attempt
    if temp_dir.exists() {
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    // Clone to temp
    if let Err(e) = clone_repository(&info.repository, &info.git_ref, &temp_dir) {
        // Clean up temp on failure
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(FixtureError::with_name(&info.name, e.message));
    }

    // 5. Verify cloned SHA matches
    let cloned_sha = match get_repo_sha(&temp_dir) {
        Ok(sha) => sha,
        Err(e) => {
            // Clean up temp on failure
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(FixtureError::with_name(
                &info.name,
                format!("Failed to verify cloned SHA: {}", e),
            ));
        }
    };

    if cloned_sha != info.sha {
        // Clean up temp on failure
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(FixtureError::with_name(
            &info.name,
            format!(
                "SHA mismatch: expected {}, got {}. The ref '{}' may have been force-pushed.",
                info.sha, cloned_sha, info.git_ref
            ),
        ));
    }

    // 6. Move to final location
    std::fs::rename(&temp_dir, &target_path).map_err(|e| {
        // Clean up temp on failure
        let _ = std::fs::remove_dir_all(&temp_dir);
        FixtureError::with_name(
            &info.name,
            format!("Failed to move fixture to final location: {}", e),
        )
    })?;

    Ok(FetchResult {
        name: info.name.clone(),
        action,
        path: target_path,
        repository: info.repository.clone(),
        git_ref: info.git_ref.clone(),
        sha: info.sha.clone(),
    })
}

/// Fetch all fixtures defined by lock files in the workspace.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
/// - `force`: If true, re-fetch all fixtures even if they exist and SHA matches
///
/// # Returns
/// - `Ok(Vec<FetchResult>)`: Results for each fixture (in alphabetical order)
/// - `Err(FixtureError)`: Error if any fixture fails to fetch
pub fn fetch_all_fixtures(
    workspace_root: &Path,
    force: bool,
) -> Result<Vec<FetchResult>, FixtureError> {
    let lock_files = discover_lock_files(workspace_root)
        .map_err(|e| FixtureError::without_name(e))?;

    let mut results = Vec::with_capacity(lock_files.len());

    for lock_path in lock_files {
        let info = read_lock_file(&lock_path)
            .map_err(|e| FixtureError::without_name(e))?;

        let result = fetch_fixture(workspace_root, &info, force)?;
        results.push(result);
    }

    Ok(results)
}

/// Fetch a single fixture by name.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
/// - `name`: Fixture name (must have a corresponding lock file)
/// - `force`: If true, re-fetch even if the fixture exists and SHA matches
///
/// # Returns
/// - `Ok(FetchResult)`: Result of the fetch operation
/// - `Err(FixtureError)`: Error if fetch fails
pub fn fetch_fixture_by_name(
    workspace_root: &Path,
    name: &str,
    force: bool,
) -> Result<FetchResult, FixtureError> {
    let info = read_lock_file_by_name(workspace_root, name)
        .map_err(|e| FixtureError::with_name(name, e))?;

    fetch_fixture(workspace_root, &info, force)
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

    // ========================================================================
    // Fetch Operation Tests
    // ========================================================================

    #[test]
    fn test_fetch_action_display() {
        assert_eq!(FetchAction::Fetched.to_string(), "fetched");
        assert_eq!(FetchAction::UpToDate.to_string(), "up-to-date");
        assert_eq!(FetchAction::Updated.to_string(), "updated");
    }

    #[test]
    fn test_fetch_action_serde() {
        // Test serialization to kebab-case
        let json = serde_json::to_string(&FetchAction::UpToDate).unwrap();
        assert_eq!(json, "\"up-to-date\"");

        // Test deserialization
        let action: FetchAction = serde_json::from_str("\"fetched\"").unwrap();
        assert_eq!(action, FetchAction::Fetched);
    }

    #[test]
    fn test_fixture_error_display() {
        let err = FixtureError::with_name("test", "something went wrong");
        assert_eq!(err.to_string(), "fixture 'test': something went wrong");

        let err = FixtureError::without_name("generic error");
        assert_eq!(err.to_string(), "generic error");
    }

    #[test]
    fn test_fetch_fixture_creates_directory_structure() {
        // This test verifies that fetch creates .tug/fixtures/ if missing
        // We can't easily test actual cloning without network, but we can test
        // error handling when the repository doesn't exist
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = r#"
[fixture]
name = "nonexistent"
repository = "file:///nonexistent/repo"
ref = "v1.0.0"
sha = "abc123"
"#;
        std::fs::write(fixtures_dir.join("nonexistent.lock"), lock_content).unwrap();

        let info = read_lock_file_by_name(dir.path(), "nonexistent").unwrap();
        let result = fetch_fixture(dir.path(), &info, false);

        // Should fail because the repository doesn't exist
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.name.as_deref() == Some("nonexistent"));
        assert!(err.message.contains("git clone failed"));
    }

    #[test]
    fn test_fetch_fixture_sha_verification_detects_mismatch() {
        // Create a local git repo to test SHA verification
        let dir = TempDir::new().unwrap();

        // Create a minimal git repo
        let repo_dir = dir.path().join("test-repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::write(repo_dir.join("file.txt"), "test content").unwrap();

        // Initialize git repo
        let init_output = Command::new("git")
            .args(["init"])
            .current_dir(&repo_dir)
            .output()
            .unwrap();
        if !init_output.status.success() {
            panic!("Failed to init git repo");
        }

        // Configure git user for commit
        let _ = Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo_dir)
            .output();

        // Add and commit
        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&repo_dir)
            .output();

        // Create a tag
        let _ = Command::new("git")
            .args(["tag", "v1.0.0"])
            .current_dir(&repo_dir)
            .output();

        // Get the actual SHA
        let actual_sha = get_repo_sha(&repo_dir).unwrap();

        // Create a lock file with WRONG SHA
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = format!(
            r#"
[fixture]
name = "test-fixture"
repository = "file://{}"
ref = "v1.0.0"
sha = "0000000000000000000000000000000000000000"
"#,
            repo_dir.display()
        );
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        let info = read_lock_file_by_name(dir.path(), "test-fixture").unwrap();
        let result = fetch_fixture(dir.path(), &info, false);

        // Should fail due to SHA mismatch
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.message.contains("SHA mismatch"));
        assert!(err.message.contains(&actual_sha[..10])); // Part of actual SHA should be in message
    }

    #[test]
    fn test_fetch_fixture_clones_new_fixture() {
        // Create a local git repo to test actual cloning
        let dir = TempDir::new().unwrap();

        // Create a minimal git repo
        let repo_dir = dir.path().join("source-repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::write(repo_dir.join("file.txt"), "test content").unwrap();

        // Initialize git repo
        let init_output = Command::new("git")
            .args(["init"])
            .current_dir(&repo_dir)
            .output()
            .unwrap();
        if !init_output.status.success() {
            panic!("Failed to init git repo");
        }

        // Configure git user for commit
        let _ = Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo_dir)
            .output();

        // Add and commit
        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&repo_dir)
            .output();

        // Create a tag
        let _ = Command::new("git")
            .args(["tag", "v1.0.0"])
            .current_dir(&repo_dir)
            .output();

        // Get the actual SHA
        let actual_sha = get_repo_sha(&repo_dir).unwrap();

        // Create workspace structure
        let workspace_dir = dir.path().join("workspace");
        let fixtures_dir = workspace_dir.join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = format!(
            r#"
[fixture]
name = "test-fixture"
repository = "file://{}"
ref = "v1.0.0"
sha = "{}"
"#,
            repo_dir.display(),
            actual_sha
        );
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        // Fetch the fixture
        let info = read_lock_file_by_name(&workspace_dir, "test-fixture").unwrap();
        let result = fetch_fixture(&workspace_dir, &info, false);

        assert!(result.is_ok(), "fetch should succeed: {:?}", result);
        let fetch_result = result.unwrap();
        assert_eq!(fetch_result.action, FetchAction::Fetched);
        assert_eq!(fetch_result.name, "test-fixture");
        assert_eq!(fetch_result.sha, actual_sha);

        // Verify the fixture was created
        let fixture_dir = fixture_path(&workspace_dir, "test-fixture");
        assert!(fixture_dir.exists());
        assert!(fixture_dir.join("file.txt").exists());
    }

    #[test]
    fn test_fetch_fixture_skips_up_to_date() {
        // Create a local git repo
        let dir = TempDir::new().unwrap();

        let repo_dir = dir.path().join("source-repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::write(repo_dir.join("file.txt"), "test content").unwrap();

        let init_output = Command::new("git")
            .args(["init"])
            .current_dir(&repo_dir)
            .output()
            .unwrap();
        if !init_output.status.success() {
            panic!("Failed to init git repo");
        }

        let _ = Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo_dir)
            .output();

        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&repo_dir)
            .output();

        let _ = Command::new("git")
            .args(["tag", "v1.0.0"])
            .current_dir(&repo_dir)
            .output();

        let actual_sha = get_repo_sha(&repo_dir).unwrap();

        // Create workspace
        let workspace_dir = dir.path().join("workspace");
        let fixtures_dir = workspace_dir.join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = format!(
            r#"
[fixture]
name = "test-fixture"
repository = "file://{}"
ref = "v1.0.0"
sha = "{}"
"#,
            repo_dir.display(),
            actual_sha
        );
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        // First fetch
        let info = read_lock_file_by_name(&workspace_dir, "test-fixture").unwrap();
        let result1 = fetch_fixture(&workspace_dir, &info, false).unwrap();
        assert_eq!(result1.action, FetchAction::Fetched);

        // Second fetch should be up-to-date
        let result2 = fetch_fixture(&workspace_dir, &info, false).unwrap();
        assert_eq!(result2.action, FetchAction::UpToDate);
    }

    #[test]
    fn test_fetch_fixture_force_refetches() {
        // Create a local git repo
        let dir = TempDir::new().unwrap();

        let repo_dir = dir.path().join("source-repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::write(repo_dir.join("file.txt"), "test content").unwrap();

        let init_output = Command::new("git")
            .args(["init"])
            .current_dir(&repo_dir)
            .output()
            .unwrap();
        if !init_output.status.success() {
            panic!("Failed to init git repo");
        }

        let _ = Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo_dir)
            .output();

        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&repo_dir)
            .output();

        let _ = Command::new("git")
            .args(["tag", "v1.0.0"])
            .current_dir(&repo_dir)
            .output();

        let actual_sha = get_repo_sha(&repo_dir).unwrap();

        // Create workspace
        let workspace_dir = dir.path().join("workspace");
        let fixtures_dir = workspace_dir.join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = format!(
            r#"
[fixture]
name = "test-fixture"
repository = "file://{}"
ref = "v1.0.0"
sha = "{}"
"#,
            repo_dir.display(),
            actual_sha
        );
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        // First fetch
        let info = read_lock_file_by_name(&workspace_dir, "test-fixture").unwrap();
        let result1 = fetch_fixture(&workspace_dir, &info, false).unwrap();
        assert_eq!(result1.action, FetchAction::Fetched);

        // Force fetch should re-fetch
        let result2 = fetch_fixture(&workspace_dir, &info, true).unwrap();
        assert_eq!(result2.action, FetchAction::Updated);
    }

    #[test]
    fn test_fetch_all_fixtures() {
        // Create a local git repo
        let dir = TempDir::new().unwrap();

        let repo_dir = dir.path().join("source-repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::write(repo_dir.join("file.txt"), "test content").unwrap();

        let init_output = Command::new("git")
            .args(["init"])
            .current_dir(&repo_dir)
            .output()
            .unwrap();
        if !init_output.status.success() {
            panic!("Failed to init git repo");
        }

        let _ = Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo_dir)
            .output();

        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&repo_dir)
            .output();

        let _ = Command::new("git")
            .args(["tag", "v1.0.0"])
            .current_dir(&repo_dir)
            .output();

        let actual_sha = get_repo_sha(&repo_dir).unwrap();

        // Create workspace with multiple lock files
        let workspace_dir = dir.path().join("workspace");
        let fixtures_dir = workspace_dir.join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // Create two lock files pointing to the same repo
        for name in ["alpha", "beta"] {
            let lock_content = format!(
                r#"
[fixture]
name = "{}"
repository = "file://{}"
ref = "v1.0.0"
sha = "{}"
"#,
                name,
                repo_dir.display(),
                actual_sha
            );
            std::fs::write(fixtures_dir.join(format!("{}.lock", name)), lock_content).unwrap();
        }

        // Fetch all
        let results = fetch_all_fixtures(&workspace_dir, false).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].name, "alpha");
        assert_eq!(results[1].name, "beta");
        assert_eq!(results[0].action, FetchAction::Fetched);
        assert_eq!(results[1].action, FetchAction::Fetched);

        // Verify fixtures exist
        assert!(fixture_path(&workspace_dir, "alpha").exists());
        assert!(fixture_path(&workspace_dir, "beta").exists());
    }

    #[test]
    fn test_fetch_cleans_up_temp_on_failure() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // Create a lock file with an invalid repository
        let lock_content = r#"
[fixture]
name = "failing"
repository = "file:///nonexistent/repo"
ref = "v1.0.0"
sha = "abc123"
"#;
        std::fs::write(fixtures_dir.join("failing.lock"), lock_content).unwrap();

        let info = read_lock_file_by_name(dir.path(), "failing").unwrap();
        let _ = fetch_fixture(dir.path(), &info, false);

        // Verify no temp directories are left behind
        let tug_dir = dir.path().join(".tug").join("fixtures");
        if tug_dir.exists() {
            let entries: Vec<_> = std::fs::read_dir(&tug_dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
                .collect();
            assert!(entries.is_empty(), "temp directories should be cleaned up");
        }
    }
}
