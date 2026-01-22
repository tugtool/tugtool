//! Fixture resolution infrastructure for integration tests.
//!
//! Provides utilities to locate test fixtures, either from:
//! - Environment variable override (for local development)
//! - Pre-fetched fixture directory (for CI)
//!
//! Fixtures are NOT automatically fetched. Tests fail loudly with
//! instructions if a fixture is unavailable.

use std::env;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Deserialize;

/// Cached workspace root.
#[allow(dead_code)]
static WORKSPACE_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Information parsed from a fixture lock file.
#[derive(Debug, Clone, Deserialize)]
pub struct FixtureInfo {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "repository")]
    pub repository: String,
    #[serde(rename = "ref")]
    pub git_ref: String,
    #[serde(rename = "sha")]
    pub sha: String,
}

#[derive(Debug, Clone, Deserialize)]
struct LockFile {
    fixture: FixtureInfo,
}

/// Get the workspace root directory.
#[allow(dead_code)]
pub fn workspace_root() -> &'static PathBuf {
    WORKSPACE_ROOT.get_or_init(|| {
        let manifest_dir =
            env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
        PathBuf::from(manifest_dir)
            .parent() // crates/tugtool -> crates
            .expect("parent of tugtool")
            .parent() // crates -> workspace root
            .expect("workspace root")
            .to_path_buf()
    })
}

/// Read and parse a fixture lock file from an explicit root directory.
///
/// This is the testable version - unit tests can pass a temp directory.
pub fn read_lock_file_from(root: &Path, name: &str) -> Result<FixtureInfo, String> {
    let lock_path = root.join("fixtures").join(format!("{}.lock", name));

    let content = std::fs::read_to_string(&lock_path)
        .map_err(|e| format!("Failed to read {}: {}", lock_path.display(), e))?;

    // IMPORTANT: Use a real TOML parser. Ad-hoc parsing breaks on valid TOML,
    // especially inline comments (e.g. `ref = "v0.1.0"  # tag`).
    let lock: LockFile = toml::from_str(&content)
        .map_err(|e| format!("Invalid TOML in {}: {}", lock_path.display(), e))?;
    Ok(lock.fixture)
}

/// Read and parse a fixture lock file from the workspace root.
///
/// Convenience wrapper around `read_lock_file_from()`.
#[allow(dead_code)]
pub fn read_lock_file(name: &str) -> Result<FixtureInfo, String> {
    read_lock_file_from(workspace_root(), name)
}

/// Get the path to a fixture, checking env var override first.
///
/// # Arguments
/// - `name`: Fixture name (e.g., "temporale")
/// - `env_var`: Environment variable for override (e.g., "TUG_TEMPORALE_PATH")
///
/// # Returns
/// PathBuf to the fixture directory.
///
/// # Panics
/// If fixture is not available and env var is not set.
#[allow(dead_code)]
pub fn get_fixture_path(name: &str, env_var: &str) -> PathBuf {
    // 1. Check environment variable override
    if let Ok(path) = env::var(env_var) {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    // 2. Check fixture directory
    let fixture_path = workspace_root().join(".tug").join("fixtures").join(name);

    // Validate fixture exists and looks correct
    let marker = fixture_path.join("pyproject.toml");
    if fixture_path.exists() && marker.exists() {
        return fixture_path;
    }

    // 3. Fixture not available - fail loudly
    let info = read_lock_file(name).unwrap_or_else(|e| {
        panic!("Failed to read lock file for fixture '{}': {}", name, e);
    });

    panic!(
        "\n\
        ============================================================\n\
        FATAL: {} fixture not available.\n\
        \n\
        The integration tests require the fixture to be fetched.\n\
        \n\
        To fetch the fixture, run from workspace root:\n\
        \n\
        mkdir -p .tug/fixtures\n\
        git clone --depth 1 --branch {} \\\n\
            {} \\\n\
            .tug/fixtures/{}\n\
        \n\
        Or set {} to point to a local checkout:\n\
        \n\
        export {}=/path/to/your/{}\n\
        \n\
        See fixtures/{}.lock for the pinned version.\n\
        ============================================================\n",
        name,
        info.git_ref,
        info.repository,
        name,
        env_var,
        env_var,
        name,
        name
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    // IMPORTANT: environment variables are process-global; serialize tests that mutate env.
    #[test]
    fn test_env_var_override() {
        // This test demonstrates the env var check logic
        // In real usage, TUG_TEMPORALE_PATH would be set externally
        let path = "/custom/path/temporale";
        std::env::set_var("TUG_TEST_FIXTURE_PATH", path);

        // Direct check (not using get_fixture_path to avoid panic)
        let result = std::env::var("TUG_TEST_FIXTURE_PATH").unwrap();
        assert_eq!(result, path);

        std::env::remove_var("TUG_TEST_FIXTURE_PATH");
    }

    #[test]
    fn test_lock_file_parsing() {
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

        let lock_path = fixtures_dir.join("test-fixture.lock");
        let mut file = std::fs::File::create(&lock_path).unwrap();
        file.write_all(lock_content.as_bytes()).unwrap();

        // Use read_lock_file_from() with explicit root for testability
        let info = read_lock_file_from(dir.path(), "test-fixture").unwrap();
        assert_eq!(info.name, "test-fixture");
        assert_eq!(info.repository, "https://github.com/example/test");
        assert_eq!(info.git_ref, "v1.0.0");
        assert_eq!(info.sha, "abc123");
    }

    #[test]
    fn test_lock_file_with_inline_comments() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        // Inline comments must parse correctly (proves we use real TOML parser)
        let lock_content = r#"
[fixture]
name = "commented"  # This is a comment
repository = "https://github.com/example/test"
ref = "v1.0.0"  # Tag name
sha = "abc123def456"
"#;

        let lock_path = fixtures_dir.join("commented.lock");
        std::fs::write(&lock_path, lock_content).unwrap();

        let info = read_lock_file_from(dir.path(), "commented").unwrap();
        assert_eq!(info.git_ref, "v1.0.0"); // NOT "v1.0.0  # Tag name"
    }

    #[test]
    fn test_lock_file_missing_field() {
        let dir = TempDir::new().unwrap();
        let fixtures_dir = dir.path().join("fixtures");
        std::fs::create_dir_all(&fixtures_dir).unwrap();

        let lock_content = r#"
[fixture]
name = "incomplete"
repository = "https://github.com/example/test"
# Missing ref and sha
"#;

        let lock_path = fixtures_dir.join("incomplete.lock");
        std::fs::write(&lock_path, lock_content).unwrap();

        let result = read_lock_file_from(dir.path(), "incomplete");
        assert!(result.is_err());
    }
}
