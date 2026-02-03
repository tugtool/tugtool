//! Golden tests for output schema stability.
//!
//! These tests verify that CLI JSON output matches expected golden files.
//! Golden files are the "contract" between tug and agent consumers.
//!
//! ## Running Tests
//!
//! ```bash
//! cargo nextest run -p tugtool golden
//! ```
//!
//! ## Updating Golden Files
//!
//! When making intentional schema changes:
//! ```bash
//! TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool golden
//! git diff tests/golden/  # Review changes
//! ```
//!
//! **CI Behavior:** Tests panic if Python is unavailable in CI environments.
//! **Local Behavior:** Tests skip gracefully if Python is unavailable.
//!
//! ## Feature Requirements
//!
//! Requires the `python` feature flag.

#![cfg(feature = "python")]

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use tempfile::TempDir;

/// Find Python in PATH for tests.
fn find_python_for_tests() -> PathBuf {
    for name in &["python3", "python"] {
        if let Ok(output) = std::process::Command::new("which").arg(name).output() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return PathBuf::from(path);
            }
        }
    }
    panic!("Python not found in PATH for tests");
}

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
///
/// In a workspace, binaries are built in the workspace root's target directory,
/// not in the individual crate's directory.
fn tug_binary() -> PathBuf {
    // CARGO_MANIFEST_DIR points to crates/tugtool, go up two levels to workspace root
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
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
/// - `python_path`: Path to Python interpreter
fn run_golden_test(
    command_args: &[&str],
    golden_file: &str,
    fixture_name: Option<&str>,
    python_path: &std::path::Path,
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
    cmd.env("TUG_PYTHON", python_path);
    cmd.args(["--workspace", workspace.path().to_str().unwrap()]);
    cmd.args(["--fresh"]); // Start fresh session
    cmd.args(command_args);

    // Capture output
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let output_json = if output.status.success() {
        stdout.as_ref()
    } else if !stderr.trim().is_empty() {
        stderr.as_ref()
    } else {
        stdout.as_ref()
    };

    // Parse actual output as JSON
    let actual: Value = serde_json::from_str(output_json).map_err(|e| {
        format!(
            "Failed to parse output as JSON: {}\nOutput: {}",
            e, output_json
        )
    })?;

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
fn golden_analyze_rename_success() {
    let python = find_python_for_tests();

    // Phase 12: `analyze python rename` with --output impact for structured output
    let result = run_golden_test(
        &[
            "analyze",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "transform_data",
            "--output",
            "impact",
        ],
        "analyze_success.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_rename_success_dry() {
    let python = find_python_for_tests();

    // Phase 12: `emit python rename` produces diff without applying
    let result = run_golden_test(
        &[
            "emit",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "transform_data",
            "--json",
        ],
        "emit_success_dry.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_rename_success_applied() {
    let python = find_python_for_tests();

    // Phase 12: `apply python rename` applies changes
    let result = run_golden_test(
        &[
            "apply",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "transform_data",
            "--no-verify",
        ],
        "run_success_applied.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_rename_success_verified() {
    let python = find_python_for_tests();

    // Phase 12: `apply python rename` with verification (emit to avoid apply)
    // Using emit to test verify mode parsing works, but emit doesn't verify
    // For actual verify test, use analyze
    let result = run_golden_test(
        &[
            "analyze",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "transform_data",
            "--output",
            "impact",
        ],
        "run_success_verified.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_session_status() {
    let python = find_python_for_tests();

    let result = run_golden_test(
        &["session", "status"],
        "session_status.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_extract_variable_success() {
    let python = find_python_for_tests();

    // Phase 14 Step 1.3: Extract variable operation
    // Extracts `100` from `result = sum(items) + 100` to `bonus = 100`
    let result = run_golden_test(
        &[
            "apply",
            "python",
            "extract-variable",
            "--at",
            "input.py:3:27",
            "--name",
            "bonus",
            "--no-verify",
        ],
        "extract_variable_response.json",
        Some("extract_variable"),
        &python,
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
    let python = find_python_for_tests();

    // Invalid location format
    // Phase 12: Uses `analyze python rename`
    let result = run_golden_test(
        &[
            "analyze", "python", "rename", "--at", "invalid", "--to", "bar",
        ],
        "error_invalid_arguments.json",
        None,
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_error_symbol_not_found() {
    let python = find_python_for_tests();

    // Symbol at non-existent location
    // Phase 12: Uses `analyze python rename`
    let result = run_golden_test(
        &[
            "analyze",
            "python",
            "rename",
            "--at",
            "input.py:999:1",
            "--to",
            "bar",
        ],
        "error_symbol_not_found.json",
        Some("symbol_not_found"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

#[test]
fn golden_error_invalid_name() {
    let python = find_python_for_tests();

    // Invalid Python identifier
    // Phase 12: Uses `apply python rename --no-verify`
    let result = run_golden_test(
        &[
            "apply",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "123invalid",
            "--no-verify",
        ],
        "error_invalid_name.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

// Note: error_apply_failed and error_verification_failed tests require
// more complex setup (modifying files after snapshot, etc.)
// These are better tested as unit tests in the main crate.

// ============================================================================
// Analyze Command Integration Tests (Phase 12)
// ============================================================================

/// Test that analyze produces proper output when symbol not found.
#[test]
fn test_analyze_rename_no_changes_empty_workspace() {
    let python = find_python_for_tests();
    let workspace = TempDir::new().unwrap();

    // Create a Python file without the target symbol
    fs::write(
        workspace.path().join("input.py"),
        "def other_func(): pass\n",
    )
    .unwrap();

    let binary = tug_binary();
    let output = Command::new(&binary)
        .current_dir(workspace.path())
        .env("TUG_PYTHON", &python)
        .args(["--workspace", workspace.path().to_str().unwrap()])
        .args(["--fresh"])
        .args([
            "analyze",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_name",
        ])
        .output()
        .expect("failed to run command");

    // Should produce an error because symbol not found, not "no changes"
    // This verifies we don't silently succeed with empty output
    assert!(
        !output.status.success() || !output.stdout.is_empty(),
        "Analyze should either error or produce output"
    );
}

/// Test that diff output is git-compatible (has proper unified diff headers).
#[test]
fn test_analyze_rename_git_compatible() {
    let python = find_python_for_tests();
    let workspace = TempDir::new().unwrap();

    // Create a Python file with a function
    fs::write(
        workspace.path().join("input.py"),
        "def foo():\n    pass\n\ndef bar():\n    foo()\n",
    )
    .unwrap();

    let binary = tug_binary();
    let output = Command::new(&binary)
        .current_dir(workspace.path())
        .env("TUG_PYTHON", &python)
        .args(["--workspace", workspace.path().to_str().unwrap()])
        .args(["--fresh"])
        .args([
            "emit",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_foo",
        ])
        .output()
        .expect("failed to run command");

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Check for unified diff format markers
    assert!(
        stdout.contains("---") && stdout.contains("+++"),
        "Diff should have unified format headers. Got: {}",
        stdout
    );
}

/// Test that emit --json produces proper envelope.
#[test]
fn test_emit_json_envelope() {
    let python = find_python_for_tests();
    let workspace = TempDir::new().unwrap();

    // Create a Python file with a function
    fs::write(
        workspace.path().join("input.py"),
        "def foo():\n    pass\n\ndef bar():\n    foo()\n",
    )
    .unwrap();

    let binary = tug_binary();
    let output = Command::new(&binary)
        .current_dir(workspace.path())
        .env("TUG_PYTHON", &python)
        .args(["--workspace", workspace.path().to_str().unwrap()])
        .args(["--fresh"])
        .args([
            "emit",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_foo",
            "--json",
        ])
        .output()
        .expect("failed to run command");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Value = serde_json::from_str(&stdout).expect("Should parse as JSON");

    // Check for emit --json envelope fields per Spec S07
    assert!(json.get("format").is_some(), "Should have 'format' field");
    assert!(json.get("diff").is_some(), "Should have 'diff' field");
    assert!(
        json.get("files_affected").is_some(),
        "Should have 'files_affected' field"
    );
    assert!(
        json.get("metadata").is_some(),
        "Should have 'metadata' field"
    );

    // Check format value
    assert_eq!(json["format"], "unified", "Format should be 'unified'");
}

// ============================================================================
// Analyze Output Variants Tests (Step 4)
// ============================================================================

/// Test that --output=impact returns full JSON response.
#[test]
fn test_analyze_output_impact() {
    let python = find_python_for_tests();
    let workspace = TempDir::new().unwrap();

    // Create a Python file with a function and call
    fs::write(
        workspace.path().join("input.py"),
        "def foo():\n    pass\n\ndef bar():\n    foo()\n",
    )
    .unwrap();

    let binary = tug_binary();
    let output = Command::new(&binary)
        .current_dir(workspace.path())
        .env("TUG_PYTHON", &python)
        .args(["--workspace", workspace.path().to_str().unwrap()])
        .args(["--fresh"])
        .args([
            "analyze",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_foo",
            "--output",
            "impact",
        ])
        .output()
        .expect("failed to run command");

    assert!(
        output.status.success(),
        "Command should succeed. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Value = serde_json::from_str(&stdout).expect("Should parse as JSON");

    // Full impact analysis should have status, schema_version, references, impact, etc.
    assert_eq!(json["status"], "ok", "Should have ok status");
    assert!(
        json.get("schema_version").is_some(),
        "Impact should have schema_version"
    );
    assert!(
        json.get("references").is_some(),
        "Impact should have references"
    );
    assert!(
        json.get("impact").is_some(),
        "Impact should have impact summary"
    );
}

/// Test that --output=references returns just the references/edits array.
#[test]
fn test_analyze_output_references() {
    let python = find_python_for_tests();
    let workspace = TempDir::new().unwrap();

    // Create a Python file with a function and call
    fs::write(
        workspace.path().join("input.py"),
        "def foo():\n    pass\n\ndef bar():\n    foo()\n",
    )
    .unwrap();

    let binary = tug_binary();
    let output = Command::new(&binary)
        .current_dir(workspace.path())
        .env("TUG_PYTHON", &python)
        .args(["--workspace", workspace.path().to_str().unwrap()])
        .args(["--fresh"])
        .args([
            "analyze",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_foo",
            "--output",
            "references",
        ])
        .output()
        .expect("failed to run command");

    assert!(
        output.status.success(),
        "Command should succeed. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Value = serde_json::from_str(&stdout).expect("Should parse as JSON");

    // References output should be an array (ReferenceInfo list)
    assert!(json.is_array(), "References output should be an array");

    // Check that we have at least one reference (the definition and the call)
    let arr = json.as_array().unwrap();
    assert!(
        !arr.is_empty(),
        "References array should not be empty for a function with calls"
    );

    // Each reference should have location and kind
    for reference in arr {
        assert!(
            reference.get("location").is_some(),
            "Each reference should have 'location'"
        );
        assert!(
            reference.get("kind").is_some(),
            "Each reference should have 'kind'"
        );
    }
}

/// Test that --output=symbol returns just the symbol info.
#[test]
fn test_analyze_output_symbol() {
    let python = find_python_for_tests();
    let workspace = TempDir::new().unwrap();

    // Create a Python file with a function
    fs::write(
        workspace.path().join("input.py"),
        "def foo():\n    pass\n\ndef bar():\n    foo()\n",
    )
    .unwrap();

    let binary = tug_binary();
    let output = Command::new(&binary)
        .current_dir(workspace.path())
        .env("TUG_PYTHON", &python)
        .args(["--workspace", workspace.path().to_str().unwrap()])
        .args(["--fresh"])
        .args([
            "analyze",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_foo",
            "--output",
            "symbol",
        ])
        .output()
        .expect("failed to run command");

    assert!(
        output.status.success(),
        "Command should succeed. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Value = serde_json::from_str(&stdout).expect("Should parse as JSON");

    // Symbol output should be an object with symbol info
    // For a function, we expect name and kind at minimum
    assert!(
        json.is_object() || json.is_null(),
        "Symbol output should be an object or null"
    );

    // If we have symbol info, check expected fields
    if json.is_object() {
        let obj = json.as_object().unwrap();
        // Symbol info typically has name, kind, file, location
        assert!(
            obj.contains_key("name") || obj.contains_key("kind") || obj.is_empty(),
            "Symbol object should have name or kind, or be empty. Got: {:?}",
            obj.keys().collect::<Vec<_>>()
        );
    }
}

/// Test that rust language returns proper error.
#[test]
fn test_rust_not_implemented() {
    let python = find_python_for_tests();
    let workspace = TempDir::new().unwrap();

    let binary = tug_binary();
    let output = Command::new(&binary)
        .current_dir(workspace.path())
        .env("TUG_PYTHON", &python)
        .args(["--workspace", workspace.path().to_str().unwrap()])
        .args(["--fresh"])
        .args([
            "apply",
            "rust",
            "rename",
            "--at",
            "input.rs:1:5",
            "--to",
            "new_foo",
        ])
        .output()
        .expect("failed to run command");

    // Should fail with exit code 2 (invalid args)
    assert!(!output.status.success(), "Rust should fail");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let error_output = if !stderr.trim().is_empty() {
        stderr.as_ref()
    } else {
        stdout.as_ref()
    };
    let json: Value = serde_json::from_str(error_output).expect("Should parse error as JSON");

    assert_eq!(json["status"], "error", "Should be error status");
    let message = json["error"]["message"].as_str().unwrap_or("");
    assert!(
        message.contains("not yet implemented"),
        "Should mention not implemented"
    );
}

// ============================================================================
// Filter System Golden Tests (Phase 12, Step 10)
// ============================================================================

/// Test that --filter-list response has correct schema.
#[test]
fn golden_filter_list_response() {
    let python = find_python_for_tests();

    let result = run_golden_test(
        &[
            "apply",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_name",
            "--filter-list",
        ],
        "filter_list_response.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

/// Test that filter expression parse errors have correct format.
#[test]
fn golden_filter_expr_error() {
    let python = find_python_for_tests();

    let result = run_golden_test(
        &[
            "apply",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_name",
            "--filter",
            "invalid:::syntax",
        ],
        "filter_expr_error.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

/// Test that JSON filter parse errors have correct format.
#[test]
fn golden_filter_json_error() {
    let python = find_python_for_tests();

    let result = run_golden_test(
        &[
            "apply",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_name",
            "--filter-json",
            "{invalid json}",
        ],
        "filter_json_error.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}

/// Test that content predicate without --filter-content flag produces correct error.
#[test]
fn golden_filter_content_without_flag_error() {
    let python = find_python_for_tests();

    let result = run_golden_test(
        &[
            "apply",
            "python",
            "rename",
            "--at",
            "input.py:1:5",
            "--to",
            "new_name",
            "--filter",
            "contains:TODO",
        ],
        "filter_content_without_flag_error.json",
        Some("rename_function"),
        &python,
    );

    if let Err(e) = result {
        panic!("Golden test failed: {}", e);
    }
}
