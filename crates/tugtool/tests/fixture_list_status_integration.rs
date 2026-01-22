//! Integration tests for fixture list and status commands.
//!
//! These tests verify that `tug fixture list` and `tug fixture status` work correctly:
//!
//! - List returns all fixtures from lock files
//! - Status correctly identifies fetched, missing, sha-mismatch states
//! - Status works with specific fixture names
//! - Error handling for unknown fixture names
//!
//! See Phase 7 Addendum for full specification.

use std::env;
use std::path::PathBuf;
use std::sync::OnceLock;
use tempfile::TempDir;
use tugtool::fixture::{
    discover_lock_files, fixture_path, get_all_fixture_states, get_fixture_state,
    get_fixture_state_by_name, read_lock_file, read_lock_file_by_name, FixtureState,
};

/// Cached workspace root.
static WORKSPACE_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Get the workspace root directory.
fn workspace_root() -> &'static PathBuf {
    WORKSPACE_ROOT.get_or_init(|| {
        let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
        PathBuf::from(manifest_dir)
            .parent() // crates/tugtool -> crates
            .expect("parent of tugtool")
            .parent() // crates -> workspace root
            .expect("workspace root")
            .to_path_buf()
    })
}

// ============================================================================
// Fixture List Tests
// ============================================================================

/// Test that list discovers the temporale fixture from lock files.
#[test]
fn fixture_list_returns_temporale_fixture_info() {
    let workspace = workspace_root();

    // Discover lock files
    let lock_files = discover_lock_files(&workspace).expect("should discover lock files");

    // We should have at least the temporale fixture
    assert!(
        !lock_files.is_empty(),
        "Expected at least one lock file, found none"
    );

    // Find the temporale lock file
    let temporale_lock = lock_files
        .iter()
        .find(|p| p.file_name().map(|n| n == "temporale.lock").unwrap_or(false));

    assert!(
        temporale_lock.is_some(),
        "Expected temporale.lock in fixtures directory"
    );

    // Parse the lock file
    let info = read_lock_file(temporale_lock.unwrap()).expect("should parse temporale.lock");

    assert_eq!(info.name, "temporale");
    assert!(info.repository.contains("github.com"));
    assert!(!info.git_ref.is_empty());
    assert_eq!(info.sha.len(), 40, "SHA should be 40 characters");
}

/// Test that list works with read_lock_file_by_name convenience function.
#[test]
fn fixture_list_by_name_returns_temporale_info() {
    let workspace = workspace_root();

    let info = read_lock_file_by_name(&workspace, "temporale").expect("should read temporale lock");

    assert_eq!(info.name, "temporale");
    assert!(info.repository.contains("tugtool/temporale"));
    assert!(info.git_ref.starts_with("v")); // Should be a version tag
    assert_eq!(info.sha.len(), 40);
}

/// Test that list returns sorted results by fixture name.
#[test]
fn fixture_list_returns_sorted_results() {
    // Create a temp workspace with multiple lock files
    let dir = TempDir::new().unwrap();
    let fixtures_dir = dir.path().join("fixtures");
    std::fs::create_dir_all(&fixtures_dir).unwrap();

    // Create lock files in non-alphabetical order
    let lock_content = |name: &str| {
        format!(
            r#"[fixture]
name = "{}"
repository = "https://github.com/example/{}"
ref = "v1.0.0"
sha = "0000000000000000000000000000000000000000"
"#,
            name, name
        )
    };

    std::fs::write(fixtures_dir.join("zeta.lock"), lock_content("zeta")).unwrap();
    std::fs::write(fixtures_dir.join("alpha.lock"), lock_content("alpha")).unwrap();
    std::fs::write(fixtures_dir.join("beta.lock"), lock_content("beta")).unwrap();

    let lock_files = discover_lock_files(dir.path()).expect("should discover lock files");

    // Should be sorted alphabetically
    assert_eq!(lock_files.len(), 3);
    assert!(lock_files[0].ends_with("alpha.lock"));
    assert!(lock_files[1].ends_with("beta.lock"));
    assert!(lock_files[2].ends_with("zeta.lock"));
}

// ============================================================================
// Fixture Status Tests
// ============================================================================

/// Test that status shows "fetched" for an existing, SHA-matched fixture.
#[test]
fn fixture_status_shows_fetched_for_existing_fixture() {
    let workspace = workspace_root();

    // Read the temporale lock file
    let info =
        read_lock_file_by_name(&workspace, "temporale").expect("should read temporale lock");

    // Get the fixture state
    let state_info = get_fixture_state(&workspace, &info);

    // If temporale is fetched, it should be in "fetched" state
    // This test assumes the fixture has been fetched (which is required for other tests)
    if fixture_path(&workspace, "temporale").exists() {
        assert_eq!(
            state_info.state,
            FixtureState::Fetched,
            "Expected Fetched state for existing fixture"
        );
        assert!(
            state_info.actual_sha.is_some(),
            "Expected actual_sha for fetched fixture"
        );
        assert_eq!(
            state_info.actual_sha.as_deref(),
            Some(info.sha.as_str()),
            "Actual SHA should match expected SHA"
        );
        assert!(state_info.error.is_none(), "Should have no error");
    } else {
        // Fixture not fetched - this is also valid (status should show "missing")
        assert_eq!(
            state_info.state,
            FixtureState::Missing,
            "Expected Missing state for non-existent fixture"
        );
    }
}

/// Test that status shows "missing" when fixture directory doesn't exist.
#[test]
fn fixture_status_shows_missing_when_directory_absent() {
    // Create a temp workspace with a lock file but no fixture directory
    let dir = TempDir::new().unwrap();
    let fixtures_dir = dir.path().join("fixtures");
    std::fs::create_dir_all(&fixtures_dir).unwrap();

    let lock_content = r#"[fixture]
name = "missing-fixture"
repository = "https://github.com/example/missing"
ref = "v1.0.0"
sha = "0000000000000000000000000000000000000000"
"#;
    std::fs::write(fixtures_dir.join("missing-fixture.lock"), lock_content).unwrap();

    let info =
        read_lock_file_by_name(dir.path(), "missing-fixture").expect("should read lock file");
    let state_info = get_fixture_state(dir.path(), &info);

    assert_eq!(
        state_info.state,
        FixtureState::Missing,
        "Expected Missing state"
    );
    assert!(
        state_info.actual_sha.is_none(),
        "Should have no actual_sha for missing fixture"
    );
    assert!(state_info.error.is_none(), "Should have no error");
}

/// Test that status shows "not-a-git-repo" when directory exists but is not a git repo.
#[test]
fn fixture_status_shows_not_a_git_repo_when_no_git_dir() {
    // Create a temp workspace with a fixture directory but no .git
    let dir = TempDir::new().unwrap();
    let fixtures_dir = dir.path().join("fixtures");
    std::fs::create_dir_all(&fixtures_dir).unwrap();

    let lock_content = r#"[fixture]
name = "not-git"
repository = "https://github.com/example/not-git"
ref = "v1.0.0"
sha = "0000000000000000000000000000000000000000"
"#;
    std::fs::write(fixtures_dir.join("not-git.lock"), lock_content).unwrap();

    // Create the fixture directory without .git
    let fixture_dir = dir.path().join(".tug").join("fixtures").join("not-git");
    std::fs::create_dir_all(&fixture_dir).unwrap();
    std::fs::write(fixture_dir.join("some-file.txt"), "content").unwrap();

    let info = read_lock_file_by_name(dir.path(), "not-git").expect("should read lock file");
    let state_info = get_fixture_state(dir.path(), &info);

    assert_eq!(
        state_info.state,
        FixtureState::NotAGitRepo,
        "Expected NotAGitRepo state"
    );
    assert!(
        state_info.actual_sha.is_none(),
        "Should have no actual_sha for non-git directory"
    );
    assert!(state_info.error.is_none(), "Should have no error");
}

/// Test that status shows "sha-mismatch" when SHA differs from lock file.
#[test]
fn fixture_status_shows_sha_mismatch_when_sha_differs() {
    use std::process::Command;

    // Create a temp workspace with a git repo at wrong SHA
    let dir = TempDir::new().unwrap();
    let fixtures_dir = dir.path().join("fixtures");
    std::fs::create_dir_all(&fixtures_dir).unwrap();

    // Create a git repo in the fixture directory
    let fixture_dir = dir.path().join(".tug").join("fixtures").join("mismatched");
    std::fs::create_dir_all(&fixture_dir).unwrap();
    std::fs::write(fixture_dir.join("file.txt"), "content").unwrap();

    // Initialize git repo
    let _ = Command::new("git")
        .args(["init"])
        .current_dir(&fixture_dir)
        .output()
        .expect("git init");

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

    // Get the actual SHA
    let actual_sha = tugtool::fixture::get_repo_sha(&fixture_dir).expect("get sha");

    // Create lock file with DIFFERENT SHA
    let lock_content = r#"[fixture]
name = "mismatched"
repository = "https://github.com/example/mismatched"
ref = "v1.0.0"
sha = "1111111111111111111111111111111111111111"
"#;
    std::fs::write(fixtures_dir.join("mismatched.lock"), lock_content).unwrap();

    let info = read_lock_file_by_name(dir.path(), "mismatched").expect("should read lock file");
    let state_info = get_fixture_state(dir.path(), &info);

    assert_eq!(
        state_info.state,
        FixtureState::ShaMismatch,
        "Expected ShaMismatch state"
    );
    assert_eq!(
        state_info.actual_sha.as_deref(),
        Some(actual_sha.as_str()),
        "Should have actual SHA"
    );
    assert!(state_info.error.is_none(), "Should have no error");
}

/// Test that status with specific fixture name filters to that fixture.
#[test]
fn fixture_status_with_name_filters_to_single_fixture() {
    let workspace = workspace_root();

    // Get state for specific fixture
    let (info, state_info) =
        get_fixture_state_by_name(&workspace, "temporale").expect("should get temporale state");

    assert_eq!(info.name, "temporale");
    // State should be either Fetched or Missing depending on whether fixture is available
    assert!(
        state_info.state == FixtureState::Fetched || state_info.state == FixtureState::Missing,
        "Expected Fetched or Missing state for temporale"
    );
}

/// Test that status returns error for unknown fixture name.
#[test]
fn fixture_status_with_unknown_name_returns_error() {
    let workspace = workspace_root();

    let result = get_fixture_state_by_name(&workspace, "nonexistent-fixture-xyz");

    assert!(result.is_err(), "Expected error for unknown fixture");
    let err = result.unwrap_err();
    assert!(
        err.message.contains("Failed to read")
            || err.message.contains("not found")
            || err.message.contains("No such file"),
        "Error should indicate lock file not found: {}",
        err.message
    );
}

/// Test that get_all_fixture_states returns states for all fixtures.
#[test]
fn fixture_status_get_all_returns_all_fixtures() {
    let workspace = workspace_root();

    let results = get_all_fixture_states(&workspace).expect("should get all fixture states");

    // Should have at least one fixture (temporale)
    assert!(
        !results.is_empty(),
        "Expected at least one fixture state result"
    );

    // Find temporale in results
    let temporale = results.iter().find(|(info, _)| info.name == "temporale");
    assert!(
        temporale.is_some(),
        "Expected temporale in fixture state results"
    );

    // Each result should have valid info and state
    for (info, state_info) in &results {
        assert!(!info.name.is_empty(), "Fixture name should not be empty");
        assert!(!info.repository.is_empty(), "Repository should not be empty");
        assert!(!info.git_ref.is_empty(), "Git ref should not be empty");
        assert_eq!(info.sha.len(), 40, "SHA should be 40 characters");

        // State should be one of the valid states
        assert!(
            matches!(
                state_info.state,
                FixtureState::Fetched
                    | FixtureState::Missing
                    | FixtureState::ShaMismatch
                    | FixtureState::NotAGitRepo
                    | FixtureState::Error
            ),
            "State should be a valid FixtureState variant"
        );
    }
}

// ============================================================================
// FixtureState Serialization Tests
// ============================================================================

/// Test that FixtureState serializes to kebab-case strings.
#[test]
fn fixture_state_serializes_to_kebab_case() {
    let json = serde_json::to_string(&FixtureState::Fetched).unwrap();
    assert_eq!(json, "\"fetched\"");

    let json = serde_json::to_string(&FixtureState::Missing).unwrap();
    assert_eq!(json, "\"missing\"");

    let json = serde_json::to_string(&FixtureState::ShaMismatch).unwrap();
    assert_eq!(json, "\"sha-mismatch\"");

    let json = serde_json::to_string(&FixtureState::NotAGitRepo).unwrap();
    assert_eq!(json, "\"not-a-git-repo\"");

    let json = serde_json::to_string(&FixtureState::Error).unwrap();
    assert_eq!(json, "\"error\"");
}

/// Test that FixtureState deserializes from kebab-case strings.
#[test]
fn fixture_state_deserializes_from_kebab_case() {
    let state: FixtureState = serde_json::from_str("\"fetched\"").unwrap();
    assert_eq!(state, FixtureState::Fetched);

    let state: FixtureState = serde_json::from_str("\"sha-mismatch\"").unwrap();
    assert_eq!(state, FixtureState::ShaMismatch);

    let state: FixtureState = serde_json::from_str("\"not-a-git-repo\"").unwrap();
    assert_eq!(state, FixtureState::NotAGitRepo);
}
