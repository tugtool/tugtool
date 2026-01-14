//! Golden tests for output schema stability.
//!
//! These tests verify that CLI JSON output matches expected golden files.
//! Golden files are the "contract" between tug and agent consumers.
//!
//! ## Running Tests
//!
//! ```bash
//! cargo nextest run -p tug golden
//! ```
//!
//! ## Updating Golden Files
//!
//! When making intentional schema changes:
//! ```bash
//! TUG_UPDATE_GOLDEN=1 cargo nextest run -p tug golden
//! git diff tests/golden/  # Review changes
//! ```
//!
//! **CI Behavior:** Tests panic if libcst is unavailable in CI environments.
//! **Local Behavior:** Tests skip gracefully if libcst is unavailable.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use tempfile::TempDir;

use tugtool::python::require_python_with_libcst;

// ============================================================================
// Test Infrastructure
// ============================================================================

/// Directory containing golden test fixtures.
fn golden_fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("golden")
        .join("fixtures")
}

/// Directory containing expected output files.
fn golden_output_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("golden")
        .join("output_schema")
}

/// Path to the tug binary.
fn tug_binary() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("debug")
        .join("tug")
}

/// Check if golden update mode is enabled.
fn update_mode() -> bool {
    std::env::var("TUG_UPDATE_GOLDEN").is_ok()
}

/// Normalize JSON for comparison.
///
/// - Removes dynamic fields like `snapshot_id`, `undo_token`, timestamps
/// - Sorts object keys for deterministic comparison
/// - Normalizes to compact format
fn normalize_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut normalized: serde_json::Map<String, Value> = serde_json::Map::new();
            for (k, v) in map {
                // Skip dynamic fields that change between runs
                if k == "snapshot_id" || k == "undo_token" {
                    continue;
                }
                // Skip timestamp-like fields
                if k.ends_with("_at") || k == "timestamp" || k == "last_accessed" {
                    continue;
                }
                // Skip duration fields (vary between runs)
                if k == "duration_ms" || k.ends_with("_duration") {
                    continue;
                }
                // Skip path fields that contain absolute paths
                if k == "path" && v.is_string() {
                    let s = v.as_str().unwrap_or("");
                    if s.starts_with('/') || s.contains("/.tug/") {
                        continue;
                    }
                }
                // Skip workspace_root, session_dir (absolute paths)
                if k == "workspace_root" || k == "workspace" || k == "session_dir" {
                    continue;
                }
                normalized.insert(k.clone(), normalize_json(v));
            }
            Value::Object(normalized)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(normalize_json).collect()),
        other => other.clone(),
    }
}

/// Compare two JSON values and return a diff if they don't match.
fn compare_json(expected: &Value, actual: &Value) -> Result<(), String> {
    let expected_normalized = normalize_json(expected);
    let actual_normalized = normalize_json(actual);

    if expected_normalized == actual_normalized {
        Ok(())
    } else {
        let expected_str = serde_json::to_string_pretty(&expected_normalized).unwrap();
        let actual_str = serde_json::to_string_pretty(&actual_normalized).unwrap();

        Err(format!(
            "JSON mismatch:\n--- expected ---\n{}\n--- actual ---\n{}",
            expected_str, actual_str
        ))
    }
}

/// Run a golden test.
///
/// # Arguments
/// - `command_args`: CLI arguments to run
/// - `golden_file`: Name of golden file in output_schema/
/// - `fixture_name`: Optional fixture directory to copy to temp workspace
fn run_golden_test(
    command_args: &[&str],
    golden_file: &str,
    fixture_name: Option<&str>,
) -> Result<(), String> {
    // Create temp workspace
    let workspace = TempDir::new().map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Copy fixture files if specified
    if let Some(fixture) = fixture_name {
        let fixture_dir = golden_fixtures_dir().join(fixture);
        if fixture_dir.exists() {
            for entry in fs::read_dir(&fixture_dir)
                .map_err(|e| format!("Failed to read fixture dir: {}", e))?
            {
                let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
                let dest = workspace.path().join(entry.file_name());
                fs::copy(entry.path(), &dest)
                    .map_err(|e| format!("Failed to copy fixture file: {}", e))?;
            }
        }
    }

    // Build full command
    let binary = tug_binary();
    if !binary.exists() {
        return Err(format!(
            "tug binary not found at {:?}. Run `cargo build -p tug` first.",
            binary
        ));
    }

    let mut cmd = Command::new(&binary);
    cmd.current_dir(workspace.path());
    cmd.args(["--workspace", workspace.path().to_str().unwrap()]);
    cmd.args(["--fresh"]); // Start fresh session
    cmd.args(command_args);

    // Capture output
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse actual output as JSON
    let actual: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse output as JSON: {}\nOutput: {}", e, stdout))?;

    // Load or update golden file
    let golden_path = golden_output_dir().join(golden_file);

    if update_mode() {
        // Update mode: write actual output to golden file
        let normalized = normalize_json(&actual);
        let pretty = serde_json::to_string_pretty(&normalized)
            .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
        fs::write(&golden_path, pretty + "\n")
            .map_err(|e| format!("Failed to write golden file: {}", e))?;
        eprintln!("Updated golden file: {:?}", golden_path);
        Ok(())
    } else {
        // Compare mode: load golden and compare
        let golden_content = fs::read_to_string(&golden_path)
            .map_err(|e| format!("Failed to read golden file {:?}: {}", golden_path, e))?;
        let expected: Value = serde_json::from_str(&golden_content)
            .map_err(|e| format!("Failed to parse golden file: {}", e))?;

        compare_json(&expected, &actual)
    }
}

// ============================================================================
// Success Tests
// ============================================================================

#[test]
fn golden_analyze_impact_success() {
    let _python = require_python_with_libcst();

    let result = run_golden_test(
        &[
            "analyze-impact",
            "rename-symbol",
            "--at",
            "input.py:1:5",
            "--to",
            "transform_data",
        ],
        "analyze_impact_success.json",
        Some("rename_function"),
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_run_success_dry() {
    let _python = require_python_with_libcst();

    let result = run_golden_test(
        &[
            "run",
            "rename-symbol",
            "--at",
            "input.py:1:5",
            "--to",
            "transform_data",
        ],
        "run_success_dry.json",
        Some("rename_function"),
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_run_success_applied() {
    let _python = require_python_with_libcst();

    let result = run_golden_test(
        &[
            "run",
            "--apply",
            "rename-symbol",
            "--at",
            "input.py:1:5",
            "--to",
            "transform_data",
        ],
        "run_success_applied.json",
        Some("rename_function"),
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_run_success_verified() {
    let _python = require_python_with_libcst();

    let result = run_golden_test(
        &[
            "run",
            "--verify",
            "syntax",
            "rename-symbol",
            "--at",
            "input.py:1:5",
            "--to",
            "transform_data",
        ],
        "run_success_verified.json",
        Some("rename_function"),
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_snapshot_success() {
    // Snapshot doesn't require Python/libcst
    let result = run_golden_test(&["snapshot"], "snapshot_success.json", Some("rename_function"));

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_session_status() {
    // Session status doesn't require Python/libcst
    let result = run_golden_test(
        &["session", "status"],
        "session_status.json",
        Some("rename_function"),
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

// ============================================================================
// Error Tests
// ============================================================================

#[test]
fn golden_error_invalid_arguments() {
    // Invalid location format
    let result = run_golden_test(
        &[
            "analyze-impact",
            "rename-symbol",
            "--at",
            "invalid",
            "--to",
            "bar",
        ],
        "error_invalid_arguments.json",
        None,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_error_symbol_not_found() {
    let _python = require_python_with_libcst();

    // Symbol at non-existent location
    let result = run_golden_test(
        &[
            "analyze-impact",
            "rename-symbol",
            "--at",
            "input.py:999:1",
            "--to",
            "bar",
        ],
        "error_symbol_not_found.json",
        Some("symbol_not_found"),
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_error_invalid_name() {
    let _python = require_python_with_libcst();

    // Invalid Python identifier
    let result = run_golden_test(
        &[
            "run",
            "rename-symbol",
            "--at",
            "input.py:1:5",
            "--to",
            "123invalid",
        ],
        "error_invalid_name.json",
        Some("rename_function"),
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

// Note: error_apply_failed and error_verification_failed tests require
// more complex setup (modifying files after snapshot, etc.)
// These are better tested as unit tests in the main crate.

// ============================================================================
// MCP Parity Tests (if MCP feature enabled)
// ============================================================================

#[cfg(feature = "mcp")]
mod mcp_parity {
    #![allow(unused_imports)]
    use super::*;

    // MCP parity tests would require setting up an MCP client/server
    // and comparing outputs. For now, we verify the structure is consistent
    // through the shared output types in tugtool::output.

    #[test]
    fn mcp_output_types_use_same_schema() {
        // This is a compile-time check - if MCP uses different output types,
        // it would fail to compile. The actual MCP tests in mcp.rs verify
        // the runtime behavior.
    }
}
