//! CLI end-to-end tests for fixture commands.
//!
//! These tests spawn the actual `tug` binary and validate stdout/exit codes.
//!
//! Exit code expectations:
//! - 0: Success
//! - 2: Invalid arguments (unknown fixture, missing lock file)
//! - 3: Resolution error (ref not found)
//! - 10: Internal error (git failure, network error)
//!
//! See Phase 7 Addendum B for full specification.

use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;

/// Run tug with given arguments and return (stdout, stderr, exit_code).
fn run_tug(args: &[&str]) -> (String, String, i32) {
    let output = Command::new(env!("CARGO_BIN_EXE_tug"))
        .args(args)
        .current_dir(workspace_root())
        .output()
        .expect("failed to execute tug");

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    (stdout, stderr, exit_code)
}

/// Get the workspace root directory.
fn workspace_root() -> PathBuf {
    // Find workspace root from CARGO_MANIFEST_DIR
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .expect("parent of tugtool crate")
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

// ============================================================================
// Fixture Fetch E2E Tests
// ============================================================================

/// Test that `tug fixture fetch nonexistent` returns exit code 2.
#[test]
fn fetch_nonexistent_returns_exit_2() {
    let (stdout, _stderr, exit_code) = run_tug(&["fixture", "fetch", "nonexistent-fixture-xyz"]);

    assert_eq!(
        exit_code, 2,
        "expected exit code 2 for unknown fixture, got {}",
        exit_code
    );

    // Verify JSON output
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be valid JSON");
    assert_eq!(json["status"], "error", "expected error status in JSON");
}

/// Test that `tug fixture fetch` (all fixtures, valid) returns exit code 0.
///
/// Note: This test requires temporale fixture to be fetchable. It may do a network
/// fetch if the fixture is not already present. In CI, the fixture is pre-fetched.
#[test]
fn fetch_valid_returns_exit_0_and_valid_json() {
    // Use list first to verify we have fixtures to fetch
    let (stdout, _stderr, exit_code) = run_tug(&["fixture", "list"]);
    assert_eq!(exit_code, 0, "list should succeed first");

    let list_json: Value = serde_json::from_str(&stdout).expect("list should produce valid JSON");
    if list_json["fixtures"].as_array().map_or(true, |a| a.is_empty()) {
        // No fixtures to fetch, skip this test
        return;
    }

    // Now fetch all fixtures
    let (stdout, _stderr, exit_code) = run_tug(&["fixture", "fetch"]);

    assert_eq!(
        exit_code, 0,
        "expected exit code 0 for successful fetch, got {}",
        exit_code
    );

    // Verify JSON output
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be valid JSON");
    assert_eq!(json["status"], "ok", "expected ok status in JSON");
    assert!(
        json["fixtures"].is_array(),
        "expected fixtures array in response"
    );
}

// ============================================================================
// Fixture Update E2E Tests
// ============================================================================

/// Test that `tug fixture update temporale --ref nonexistent-tag-xyz` returns exit code 3.
///
/// This tests the case where the fixture exists but the ref cannot be resolved.
#[test]
fn update_bad_ref_returns_exit_3() {
    let (stdout, _stderr, exit_code) =
        run_tug(&["fixture", "update", "temporale", "--ref", "nonexistent-tag-xyz-12345"]);

    assert_eq!(
        exit_code, 3,
        "expected exit code 3 for unresolvable ref, got {}",
        exit_code
    );

    // Verify JSON output
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be valid JSON");
    assert_eq!(json["status"], "error", "expected error status in JSON");
}

/// Test that `tug fixture update nonexistent --ref v1.0.0` returns exit code 2.
///
/// This tests the case where the fixture name doesn't exist.
#[test]
fn update_nonexistent_fixture_returns_exit_2() {
    let (stdout, _stderr, exit_code) =
        run_tug(&["fixture", "update", "nonexistent-fixture-xyz", "--ref", "v1.0.0"]);

    assert_eq!(
        exit_code, 2,
        "expected exit code 2 for unknown fixture, got {}",
        exit_code
    );

    // Verify JSON output
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be valid JSON");
    assert_eq!(json["status"], "error", "expected error status in JSON");
}

// ============================================================================
// Fixture List E2E Tests
// ============================================================================

/// Test that `tug fixture list` returns exit code 0 and valid JSON.
#[test]
fn list_returns_exit_0_and_valid_json() {
    let (stdout, _stderr, exit_code) = run_tug(&["fixture", "list"]);

    assert_eq!(
        exit_code, 0,
        "expected exit code 0 for list, got {}",
        exit_code
    );

    // Verify JSON output
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be valid JSON");
    assert_eq!(json["status"], "ok", "expected ok status in JSON");
    assert!(
        json["fixtures"].is_array(),
        "expected fixtures array in response"
    );

    // Verify schema_version is present
    assert!(
        json["schema_version"].is_string(),
        "expected schema_version in response"
    );
}

// ============================================================================
// Fixture Status E2E Tests
// ============================================================================

/// Test that `tug fixture status` returns exit code 0 and valid JSON.
#[test]
fn status_returns_exit_0_and_valid_json() {
    let (stdout, _stderr, exit_code) = run_tug(&["fixture", "status"]);

    assert_eq!(
        exit_code, 0,
        "expected exit code 0 for status, got {}",
        exit_code
    );

    // Verify JSON output
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be valid JSON");
    assert_eq!(json["status"], "ok", "expected ok status in JSON");
    assert!(
        json["fixtures"].is_array(),
        "expected fixtures array in response"
    );

    // Verify schema_version is present
    assert!(
        json["schema_version"].is_string(),
        "expected schema_version in response"
    );

    // Each fixture should have required fields
    if let Some(fixtures) = json["fixtures"].as_array() {
        for fixture in fixtures {
            assert!(fixture["name"].is_string(), "fixture should have name");
            assert!(fixture["state"].is_string(), "fixture should have state");
            assert!(fixture["path"].is_string(), "fixture should have path");
        }
    }
}

/// Test that `tug fixture status nonexistent` returns exit code 2.
#[test]
fn status_nonexistent_returns_exit_2() {
    let (stdout, _stderr, exit_code) = run_tug(&["fixture", "status", "nonexistent-fixture-xyz"]);

    assert_eq!(
        exit_code, 2,
        "expected exit code 2 for unknown fixture, got {}",
        exit_code
    );

    // Verify JSON output
    let json: Value = serde_json::from_str(&stdout).expect("stdout should be valid JSON");
    assert_eq!(json["status"], "error", "expected error status in JSON");
}
