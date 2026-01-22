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

// ============================================================================
// State Detection Types and Functions
// ============================================================================

/// State of a fixture on the filesystem.
///
/// Used by `tug fixture status` to report the current state of each fixture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FixtureState {
    /// Directory exists and SHA matches lock file.
    Fetched,
    /// Directory does not exist.
    Missing,
    /// Directory exists but SHA differs from lock file.
    ShaMismatch,
    /// Directory exists but is not a git repository.
    NotAGitRepo,
    /// Could not determine state (e.g., git command failed).
    Error,
}

impl std::fmt::Display for FixtureState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FixtureState::Fetched => write!(f, "fetched"),
            FixtureState::Missing => write!(f, "missing"),
            FixtureState::ShaMismatch => write!(f, "sha-mismatch"),
            FixtureState::NotAGitRepo => write!(f, "not-a-git-repo"),
            FixtureState::Error => write!(f, "error"),
        }
    }
}

/// Information about a fixture's state.
///
/// Contains the state enum plus optional additional info depending on state.
#[derive(Debug, Clone)]
pub struct FixtureStateInfo {
    /// The fixture's current state.
    pub state: FixtureState,
    /// Actual SHA if fixture exists and is a git repo.
    pub actual_sha: Option<String>,
    /// Error message if state is Error.
    pub error: Option<String>,
}

impl FixtureStateInfo {
    /// Create a new state info for a fetched fixture.
    pub fn fetched(sha: String) -> Self {
        Self {
            state: FixtureState::Fetched,
            actual_sha: Some(sha),
            error: None,
        }
    }

    /// Create a new state info for a missing fixture.
    pub fn missing() -> Self {
        Self {
            state: FixtureState::Missing,
            actual_sha: None,
            error: None,
        }
    }

    /// Create a new state info for a SHA mismatch.
    pub fn sha_mismatch(actual_sha: String) -> Self {
        Self {
            state: FixtureState::ShaMismatch,
            actual_sha: Some(actual_sha),
            error: None,
        }
    }

    /// Create a new state info for a non-git directory.
    pub fn not_a_git_repo() -> Self {
        Self {
            state: FixtureState::NotAGitRepo,
            actual_sha: None,
            error: None,
        }
    }

    /// Create a new state info for an error.
    pub fn error(message: String) -> Self {
        Self {
            state: FixtureState::Error,
            actual_sha: None,
            error: Some(message),
        }
    }
}

/// Get the state of a fixture on the filesystem.
///
/// This function checks:
/// 1. Does the fixture directory exist?
/// 2. Is it a git repository (has .git)?
/// 3. Does the HEAD SHA match the lock file?
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
/// - `info`: Fixture information from the lock file
///
/// # Returns
/// `FixtureStateInfo` with the state and optional additional info.
///
/// This function does not require network access - it only inspects
/// the local filesystem and runs `git rev-parse` locally.
pub fn get_fixture_state(workspace_root: &Path, info: &FixtureInfo) -> FixtureStateInfo {
    let target_path = fixture_path(workspace_root, &info.name);

    // Check if directory exists
    if !target_path.exists() {
        return FixtureStateInfo::missing();
    }

    // Check if it's a git repo
    let git_dir = target_path.join(".git");
    if !git_dir.exists() {
        return FixtureStateInfo::not_a_git_repo();
    }

    // Get the actual SHA
    match get_repo_sha(&target_path) {
        Ok(sha) => {
            if sha == info.sha {
                FixtureStateInfo::fetched(sha)
            } else {
                FixtureStateInfo::sha_mismatch(sha)
            }
        }
        Err(e) => FixtureStateInfo::error(e),
    }
}

/// Get states for all fixtures defined by lock files.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
///
/// # Returns
/// - `Ok(Vec<(FixtureInfo, FixtureStateInfo)>)`: Info and state for each fixture
/// - `Err(FixtureError)`: Error if lock files can't be read
///
/// This function does not require network access.
pub fn get_all_fixture_states(
    workspace_root: &Path,
) -> Result<Vec<(FixtureInfo, FixtureStateInfo)>, FixtureError> {
    let lock_files =
        discover_lock_files(workspace_root).map_err(|e| FixtureError::without_name(e))?;

    let mut results = Vec::with_capacity(lock_files.len());

    for lock_path in lock_files {
        let info = read_lock_file(&lock_path).map_err(|e| FixtureError::without_name(e))?;
        let state = get_fixture_state(workspace_root, &info);
        results.push((info, state));
    }

    Ok(results)
}

/// Get the state of a single fixture by name.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
/// - `name`: Fixture name (must have a corresponding lock file)
///
/// # Returns
/// - `Ok((FixtureInfo, FixtureStateInfo))`: Info and state for the fixture
/// - `Err(FixtureError)`: Error if lock file doesn't exist or can't be read
pub fn get_fixture_state_by_name(
    workspace_root: &Path,
    name: &str,
) -> Result<(FixtureInfo, FixtureStateInfo), FixtureError> {
    let info =
        read_lock_file_by_name(workspace_root, name).map_err(|e| FixtureError::with_name(name, e))?;
    let state = get_fixture_state(workspace_root, &info);
    Ok((info, state))
}

// ============================================================================
// Update Operation Types and Functions
// ============================================================================

/// Result of a fixture update operation.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateResult {
    /// Fixture name.
    pub name: String,
    /// Previous git ref.
    pub previous_ref: String,
    /// Previous commit SHA.
    pub previous_sha: String,
    /// New git ref.
    pub new_ref: String,
    /// New commit SHA.
    pub new_sha: String,
    /// Path to the lock file.
    pub lock_file: PathBuf,
    /// Optional warning (e.g., when ref is a branch).
    pub warning: Option<String>,
}

/// Information about a resolved git ref.
#[derive(Debug, Clone)]
pub struct ResolvedRef {
    /// The commit SHA.
    pub sha: String,
    /// Whether this ref is a branch (true) or tag (false).
    pub is_branch: bool,
}

/// Resolve a git ref to its SHA using `git ls-remote`.
///
/// This function queries a remote repository to resolve a ref (tag, branch, or SHA)
/// to its full commit SHA, and determines whether the ref is a branch.
///
/// # Arguments
/// - `repository`: Git repository URL
/// - `git_ref`: Git ref to resolve (tag name, branch name, or SHA)
///
/// # Returns
/// - `Ok(ResolvedRef)`: The resolved SHA and whether it's a branch
/// - `Err(FixtureError)`: Error if the ref cannot be resolved
///
/// # How it works
/// Uses `git ls-remote <repository> <ref>` to query the remote. The output format is:
/// ```text
/// <sha>\trefs/heads/<branch>  # for branches
/// <sha>\trefs/tags/<tag>      # for tags
/// ```
///
/// If the ref matches `refs/heads/*`, it's a branch. If it matches `refs/tags/*`, it's a tag.
/// Direct SHA lookups or other refs are treated as non-branches.
pub fn resolve_ref_to_sha(repository: &str, git_ref: &str) -> Result<ResolvedRef, FixtureError> {
    // Verify git is available
    verify_git_available().map_err(|e| FixtureError::without_name(e))?;

    // Query the remote for the ref
    let output = Command::new("git")
        .args(["ls-remote", repository, git_ref])
        .output()
        .map_err(|e| FixtureError::without_name(format!("Failed to run git ls-remote: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(FixtureError::without_name(format!(
            "git ls-remote failed: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stdout = stdout.trim();

    if stdout.is_empty() {
        return Err(FixtureError::without_name(format!(
            "Ref '{}' not found in repository '{}'",
            git_ref, repository
        )));
    }

    // Parse the ls-remote output
    // Format: "<sha>\t<ref>" (one or more lines)
    // We need to find the best match for the requested ref
    let mut best_match: Option<(String, bool)> = None;

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() != 2 {
            continue;
        }

        let sha = parts[0].trim();
        let ref_path = parts[1].trim();

        // Determine if this is a branch or tag
        let is_branch = ref_path.starts_with("refs/heads/");
        let is_tag = ref_path.starts_with("refs/tags/");

        // Check if this ref matches what we're looking for
        let ref_name = if is_branch {
            ref_path.strip_prefix("refs/heads/").unwrap_or(ref_path)
        } else if is_tag {
            ref_path.strip_prefix("refs/tags/").unwrap_or(ref_path)
        } else {
            ref_path
        };

        // Exact match on the ref name
        if ref_name == git_ref || ref_path == git_ref {
            // Prefer tags over branches if both exist
            if best_match.is_none() || (is_tag && best_match.as_ref().map(|(_, b)| *b).unwrap_or(false)) {
                best_match = Some((sha.to_string(), is_branch));
            }
        }
    }

    match best_match {
        Some((sha, is_branch)) => Ok(ResolvedRef { sha, is_branch }),
        None => {
            // If no match found, the ref might be listed but with a different format
            // Try to use the first line's SHA as a fallback
            let first_line = stdout.lines().next().unwrap_or("");
            let parts: Vec<&str> = first_line.split('\t').collect();
            if parts.len() == 2 {
                let sha = parts[0].trim().to_string();
                let ref_path = parts[1].trim();
                let is_branch = ref_path.starts_with("refs/heads/");
                Ok(ResolvedRef { sha, is_branch })
            } else {
                Err(FixtureError::without_name(format!(
                    "Could not parse ref '{}' from repository '{}'",
                    git_ref, repository
                )))
            }
        }
    }
}

/// Check if a ref is a branch (vs a tag).
///
/// This is a convenience function that calls `resolve_ref_to_sha` and returns
/// just the `is_branch` flag.
///
/// # Arguments
/// - `repository`: Git repository URL
/// - `git_ref`: Git ref to check
///
/// # Returns
/// - `Ok(true)`: The ref is a branch
/// - `Ok(false)`: The ref is a tag or other non-branch ref
/// - `Err(FixtureError)`: Error if the ref cannot be resolved
pub fn is_branch_ref(repository: &str, git_ref: &str) -> Result<bool, FixtureError> {
    let resolved = resolve_ref_to_sha(repository, git_ref)?;
    Ok(resolved.is_branch)
}

/// Write a lock file with the given fixture info.
///
/// # Arguments
/// - `lock_path`: Path to the lock file
/// - `info`: Fixture information to write
///
/// # Returns
/// - `Ok(())`: Lock file written successfully
/// - `Err(String)`: Error if write fails
fn write_lock_file(lock_path: &Path, info: &FixtureInfo) -> Result<(), String> {
    let content = format!(
        r#"# {} fixture pin for tugtool integration tests
#
# To update:
#   tug fixture update {} --ref <new-ref>

[fixture]
name = "{}"
repository = "{}"
ref = "{}"
sha = "{}"
"#,
        info.name, info.name, info.name, info.repository, info.git_ref, info.sha
    );

    std::fs::write(lock_path, content)
        .map_err(|e| format!("Failed to write lock file {}: {}", lock_path.display(), e))
}

/// Update a fixture lock file to a new ref.
///
/// This function resolves the new ref to a SHA, updates the lock file,
/// and returns the result with an optional warning if the ref is a branch.
///
/// # Arguments
/// - `workspace_root`: Path to the workspace root
/// - `name`: Fixture name (must have existing lock file)
/// - `new_ref`: New git ref (tag or branch)
///
/// # Returns
/// - `Ok(UpdateResult)`: Result of the update operation
/// - `Err(FixtureError)`: Error if update fails
///
/// # Note
/// This function does NOT automatically fetch the new version.
/// Run `fetch_fixture_by_name` after updating to get the new content.
pub fn update_fixture_lock(
    workspace_root: &Path,
    name: &str,
    new_ref: &str,
) -> Result<UpdateResult, FixtureError> {
    // 1. Read existing lock file
    let lock_path = workspace_root
        .join("fixtures")
        .join(format!("{}.lock", name));

    let existing_info = read_lock_file(&lock_path)
        .map_err(|e| FixtureError::with_name(name, e))?;

    // 2. Resolve new ref to SHA
    let resolved = resolve_ref_to_sha(&existing_info.repository, new_ref)
        .map_err(|e| FixtureError::with_name(name, e.message))?;

    // 3. Check if branch (for warning)
    let warning = if resolved.is_branch {
        Some(format!(
            "Ref '{}' is a branch, not a tag. SHA may change.",
            new_ref
        ))
    } else {
        None
    };

    // 4. Write updated lock file
    let updated_info = FixtureInfo {
        name: existing_info.name.clone(),
        repository: existing_info.repository.clone(),
        git_ref: new_ref.to_string(),
        sha: resolved.sha.clone(),
    };

    write_lock_file(&lock_path, &updated_info)
        .map_err(|e| FixtureError::with_name(name, e))?;

    // 5. Return result
    Ok(UpdateResult {
        name: existing_info.name,
        previous_ref: existing_info.git_ref,
        previous_sha: existing_info.sha,
        new_ref: new_ref.to_string(),
        new_sha: resolved.sha,
        lock_file: lock_path,
        warning,
    })
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

    // ========================================================================
    // Update Operation Tests
    // ========================================================================

    /// Helper to create a local git repo with a tag and a branch for testing
    fn create_test_repo_with_tag_and_branch(dir: &Path) -> (PathBuf, String, String) {
        let repo_dir = dir.join("source-repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        std::fs::write(repo_dir.join("file.txt"), "v1 content").unwrap();

        // Initialize git repo
        let init_output = Command::new("git")
            .args(["init"])
            .current_dir(&repo_dir)
            .output()
            .unwrap();
        if !init_output.status.success() {
            panic!("Failed to init git repo");
        }

        // Configure git user
        let _ = Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&repo_dir)
            .output();

        // Add and commit v1
        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "v1"])
            .current_dir(&repo_dir)
            .output();

        // Create tag v1.0.0
        let _ = Command::new("git")
            .args(["tag", "v1.0.0"])
            .current_dir(&repo_dir)
            .output();

        let v1_sha = get_repo_sha(&repo_dir).unwrap();

        // Create second commit for v2
        std::fs::write(repo_dir.join("file.txt"), "v2 content").unwrap();
        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&repo_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "v2"])
            .current_dir(&repo_dir)
            .output();

        // Create tag v2.0.0
        let _ = Command::new("git")
            .args(["tag", "v2.0.0"])
            .current_dir(&repo_dir)
            .output();

        let v2_sha = get_repo_sha(&repo_dir).unwrap();

        // Create a branch
        let _ = Command::new("git")
            .args(["branch", "develop"])
            .current_dir(&repo_dir)
            .output();

        (repo_dir, v1_sha, v2_sha)
    }

    #[test]
    fn test_resolve_ref_to_sha_resolves_tag() {
        let dir = TempDir::new().unwrap();
        let (repo_dir, v1_sha, _v2_sha) = create_test_repo_with_tag_and_branch(dir.path());

        let repo_url = format!("file://{}", repo_dir.display());

        // Resolve tag v1.0.0
        let result = resolve_ref_to_sha(&repo_url, "v1.0.0");
        assert!(result.is_ok(), "should resolve tag: {:?}", result);

        let resolved = result.unwrap();
        assert_eq!(resolved.sha, v1_sha);
        assert!(!resolved.is_branch, "v1.0.0 should be detected as a tag, not a branch");
    }

    #[test]
    fn test_resolve_ref_to_sha_detects_branch() {
        let dir = TempDir::new().unwrap();
        let (repo_dir, _v1_sha, v2_sha) = create_test_repo_with_tag_and_branch(dir.path());

        let repo_url = format!("file://{}", repo_dir.display());

        // Resolve branch 'develop'
        let result = resolve_ref_to_sha(&repo_url, "develop");
        assert!(result.is_ok(), "should resolve branch: {:?}", result);

        let resolved = result.unwrap();
        assert_eq!(resolved.sha, v2_sha); // develop points to latest commit
        assert!(resolved.is_branch, "develop should be detected as a branch");
    }

    #[test]
    fn test_resolve_ref_to_sha_fails_on_invalid_ref() {
        let dir = TempDir::new().unwrap();
        let (repo_dir, _v1_sha, _v2_sha) = create_test_repo_with_tag_and_branch(dir.path());

        let repo_url = format!("file://{}", repo_dir.display());

        // Try to resolve non-existent ref
        let result = resolve_ref_to_sha(&repo_url, "nonexistent-ref");
        assert!(result.is_err(), "should fail on invalid ref");

        let err = result.unwrap_err();
        assert!(
            err.message.contains("not found"),
            "error should mention ref not found: {}",
            err.message
        );
    }

    #[test]
    fn test_is_branch_ref() {
        let dir = TempDir::new().unwrap();
        let (repo_dir, _v1_sha, _v2_sha) = create_test_repo_with_tag_and_branch(dir.path());

        let repo_url = format!("file://{}", repo_dir.display());

        // Tag should not be a branch
        assert!(!is_branch_ref(&repo_url, "v1.0.0").unwrap());

        // Branch should be a branch
        assert!(is_branch_ref(&repo_url, "develop").unwrap());
    }

    #[test]
    fn test_update_fixture_lock_updates_lock_file() {
        let dir = TempDir::new().unwrap();
        let (repo_dir, v1_sha, v2_sha) = create_test_repo_with_tag_and_branch(dir.path());

        // Create workspace with lock file at v1.0.0
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
            v1_sha
        );
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        // Update to v2.0.0
        let result = update_fixture_lock(&workspace_dir, "test-fixture", "v2.0.0");
        assert!(result.is_ok(), "update should succeed: {:?}", result);

        let update_result = result.unwrap();
        assert_eq!(update_result.name, "test-fixture");
        assert_eq!(update_result.previous_ref, "v1.0.0");
        assert_eq!(update_result.previous_sha, v1_sha);
        assert_eq!(update_result.new_ref, "v2.0.0");
        assert_eq!(update_result.new_sha, v2_sha);
        assert!(update_result.warning.is_none(), "tag should not produce warning");

        // Verify lock file was updated
        let updated_info = read_lock_file_by_name(&workspace_dir, "test-fixture").unwrap();
        assert_eq!(updated_info.git_ref, "v2.0.0");
        assert_eq!(updated_info.sha, v2_sha);
    }

    #[test]
    fn test_update_fixture_lock_with_branch_produces_warning() {
        let dir = TempDir::new().unwrap();
        let (repo_dir, v1_sha, v2_sha) = create_test_repo_with_tag_and_branch(dir.path());

        // Create workspace with lock file
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
            v1_sha
        );
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        // Update to branch 'develop'
        let result = update_fixture_lock(&workspace_dir, "test-fixture", "develop");
        assert!(result.is_ok(), "update should succeed: {:?}", result);

        let update_result = result.unwrap();
        assert_eq!(update_result.new_ref, "develop");
        assert_eq!(update_result.new_sha, v2_sha);
        assert!(update_result.warning.is_some(), "branch should produce warning");

        let warning = update_result.warning.unwrap();
        assert!(warning.contains("branch"), "warning should mention branch");
        assert!(warning.contains("develop"), "warning should mention the ref name");
    }

    #[test]
    fn test_update_fixture_lock_fails_on_nonexistent_fixture() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // No lock file exists for 'nonexistent'
        let result = update_fixture_lock(dir.path(), "nonexistent", "v1.0.0");
        assert!(result.is_err(), "should fail for nonexistent fixture");

        let err = result.unwrap_err();
        assert_eq!(err.name.as_deref(), Some("nonexistent"));
    }

    #[test]
    fn test_update_fixture_lock_fails_on_invalid_ref() {
        let dir = TempDir::new().unwrap();
        let (repo_dir, v1_sha, _v2_sha) = create_test_repo_with_tag_and_branch(dir.path());

        // Create workspace with lock file
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
            v1_sha
        );
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        // Try to update to nonexistent ref
        let result = update_fixture_lock(&workspace_dir, "test-fixture", "nonexistent-tag");
        assert!(result.is_err(), "should fail for invalid ref");

        let err = result.unwrap_err();
        assert!(err.message.contains("not found"), "error should mention ref not found");
    }

    #[test]
    fn test_write_lock_file_format() {
        let dir = TempDir::new().unwrap();
        let lock_path = dir.path().join("test.lock");

        let info = FixtureInfo {
            name: "myfix".to_string(),
            repository: "https://github.com/example/test".to_string(),
            git_ref: "v1.0.0".to_string(),
            sha: "abc123def456".to_string(),
        };

        write_lock_file(&lock_path, &info).unwrap();

        // Verify the file can be read back
        let read_info = read_lock_file(&lock_path).unwrap();
        assert_eq!(read_info.name, "myfix");
        assert_eq!(read_info.repository, "https://github.com/example/test");
        assert_eq!(read_info.git_ref, "v1.0.0");
        assert_eq!(read_info.sha, "abc123def456");

        // Verify the file contains expected content
        let content = std::fs::read_to_string(&lock_path).unwrap();
        assert!(content.contains("# myfix fixture pin"));
        assert!(content.contains("tug fixture update myfix"));
    }

    // ========================================================================
    // State Detection Tests
    // ========================================================================

    #[test]
    fn test_fixture_state_serializes_to_kebab_case() {
        // Test serialization to kebab-case
        assert_eq!(
            serde_json::to_string(&FixtureState::Fetched).unwrap(),
            "\"fetched\""
        );
        assert_eq!(
            serde_json::to_string(&FixtureState::Missing).unwrap(),
            "\"missing\""
        );
        assert_eq!(
            serde_json::to_string(&FixtureState::ShaMismatch).unwrap(),
            "\"sha-mismatch\""
        );
        assert_eq!(
            serde_json::to_string(&FixtureState::NotAGitRepo).unwrap(),
            "\"not-a-git-repo\""
        );
        assert_eq!(
            serde_json::to_string(&FixtureState::Error).unwrap(),
            "\"error\""
        );

        // Test deserialization
        let state: FixtureState = serde_json::from_str("\"sha-mismatch\"").unwrap();
        assert_eq!(state, FixtureState::ShaMismatch);
    }

    #[test]
    fn test_fixture_state_display() {
        assert_eq!(FixtureState::Fetched.to_string(), "fetched");
        assert_eq!(FixtureState::Missing.to_string(), "missing");
        assert_eq!(FixtureState::ShaMismatch.to_string(), "sha-mismatch");
        assert_eq!(FixtureState::NotAGitRepo.to_string(), "not-a-git-repo");
        assert_eq!(FixtureState::Error.to_string(), "error");
    }

    #[test]
    fn test_get_fixture_state_returns_missing_when_directory_absent() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // Create a lock file but don't fetch the fixture
        let lock_content = r#"
[fixture]
name = "test-fixture"
repository = "https://github.com/example/test"
ref = "v1.0.0"
sha = "abc123def456"
"#;
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        let info = read_lock_file_by_name(dir.path(), "test-fixture").unwrap();
        let state_info = get_fixture_state(dir.path(), &info);

        assert_eq!(state_info.state, FixtureState::Missing);
        assert!(state_info.actual_sha.is_none());
        assert!(state_info.error.is_none());
    }

    #[test]
    fn test_get_fixture_state_returns_not_a_git_repo_when_no_git() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // Create a lock file
        let lock_content = r#"
[fixture]
name = "test-fixture"
repository = "https://github.com/example/test"
ref = "v1.0.0"
sha = "abc123def456"
"#;
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        // Create fixture directory WITHOUT .git
        let fixture_dir = dir.path().join(".tug").join("fixtures").join("test-fixture");
        std::fs::create_dir_all(&fixture_dir).unwrap();
        std::fs::write(fixture_dir.join("file.txt"), "content").unwrap();

        let info = read_lock_file_by_name(dir.path(), "test-fixture").unwrap();
        let state_info = get_fixture_state(dir.path(), &info);

        assert_eq!(state_info.state, FixtureState::NotAGitRepo);
        assert!(state_info.actual_sha.is_none());
        assert!(state_info.error.is_none());
    }

    #[test]
    fn test_get_fixture_state_returns_fetched_when_sha_matches() {
        let dir = TempDir::new().unwrap();

        // Create a git repo to use as fixture
        let fixture_dir = dir.path().join(".tug").join("fixtures").join("test-fixture");
        std::fs::create_dir_all(&fixture_dir).unwrap();
        std::fs::write(fixture_dir.join("file.txt"), "content").unwrap();

        // Initialize git repo
        let _ = Command::new("git")
            .args(["init"])
            .current_dir(&fixture_dir)
            .output()
            .unwrap();

        let _ = Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&fixture_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&fixture_dir)
            .output();

        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&fixture_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&fixture_dir)
            .output();

        let actual_sha = get_repo_sha(&fixture_dir).unwrap();

        // Create lock file with matching SHA
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = format!(
            r#"
[fixture]
name = "test-fixture"
repository = "https://github.com/example/test"
ref = "v1.0.0"
sha = "{}"
"#,
            actual_sha
        );
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        let info = read_lock_file_by_name(dir.path(), "test-fixture").unwrap();
        let state_info = get_fixture_state(dir.path(), &info);

        assert_eq!(state_info.state, FixtureState::Fetched);
        assert_eq!(state_info.actual_sha, Some(actual_sha));
        assert!(state_info.error.is_none());
    }

    #[test]
    fn test_get_fixture_state_returns_sha_mismatch_when_sha_differs() {
        let dir = TempDir::new().unwrap();

        // Create a git repo to use as fixture
        let fixture_dir = dir.path().join(".tug").join("fixtures").join("test-fixture");
        std::fs::create_dir_all(&fixture_dir).unwrap();
        std::fs::write(fixture_dir.join("file.txt"), "content").unwrap();

        // Initialize git repo
        let _ = Command::new("git")
            .args(["init"])
            .current_dir(&fixture_dir)
            .output()
            .unwrap();

        let _ = Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&fixture_dir)
            .output();
        let _ = Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&fixture_dir)
            .output();

        let _ = Command::new("git")
            .args(["add", "."])
            .current_dir(&fixture_dir)
            .output();
        let _ = Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&fixture_dir)
            .output();

        let actual_sha = get_repo_sha(&fixture_dir).unwrap();

        // Create lock file with DIFFERENT SHA
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = r#"
[fixture]
name = "test-fixture"
repository = "https://github.com/example/test"
ref = "v1.0.0"
sha = "0000000000000000000000000000000000000000"
"#;
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        let info = read_lock_file_by_name(dir.path(), "test-fixture").unwrap();
        let state_info = get_fixture_state(dir.path(), &info);

        assert_eq!(state_info.state, FixtureState::ShaMismatch);
        assert_eq!(state_info.actual_sha, Some(actual_sha));
        assert!(state_info.error.is_none());
    }

    #[test]
    fn test_get_all_fixture_states() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // Create two lock files
        let lock1 = r#"
[fixture]
name = "alpha"
repository = "https://github.com/example/alpha"
ref = "v1.0.0"
sha = "abc123"
"#;
        let lock2 = r#"
[fixture]
name = "beta"
repository = "https://github.com/example/beta"
ref = "v2.0.0"
sha = "def456"
"#;
        std::fs::write(fixtures_dir.join("alpha.lock"), lock1).unwrap();
        std::fs::write(fixtures_dir.join("beta.lock"), lock2).unwrap();

        // Don't create any fixture directories - both should be Missing

        let results = get_all_fixture_states(dir.path()).unwrap();
        assert_eq!(results.len(), 2);

        // Results should be sorted alphabetically
        assert_eq!(results[0].0.name, "alpha");
        assert_eq!(results[0].1.state, FixtureState::Missing);
        assert_eq!(results[1].0.name, "beta");
        assert_eq!(results[1].1.state, FixtureState::Missing);
    }

    #[test]
    fn test_get_fixture_state_by_name() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = r#"
[fixture]
name = "test-fixture"
repository = "https://github.com/example/test"
ref = "v1.0.0"
sha = "abc123"
"#;
        std::fs::write(fixtures_dir.join("test-fixture.lock"), lock_content).unwrap();

        let (info, state_info) = get_fixture_state_by_name(dir.path(), "test-fixture").unwrap();

        assert_eq!(info.name, "test-fixture");
        assert_eq!(state_info.state, FixtureState::Missing);
    }

    #[test]
    fn test_get_fixture_state_by_name_fails_on_nonexistent() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let result = get_fixture_state_by_name(dir.path(), "nonexistent");
        assert!(result.is_err());

        let err = result.unwrap_err();
        assert_eq!(err.name.as_deref(), Some("nonexistent"));
    }
}
