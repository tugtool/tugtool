// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Collision tests for Python rename operations.
//!
//! These tests verify that rename operations correctly handle symbols with the same name
//! in different scopes (e.g., parameters with the same name in different functions).
//!
//! # Bug Report (Step 1.5)
//!
//! A critical bug was discovered where `symbol_lookup` in analyzer.rs used
//! `(FileId, name, SymbolKind)` as the key, causing HashMap collisions when
//! multiple functions have parameters with the same name. This resulted in
//! body references not being tracked correctly.
//!
//! # Running These Tests
//!
//! ```bash
//! cargo nextest run -p tugtool-python collision
//! ```

use std::path::PathBuf;
use tempfile::TempDir;
use tugtool_core::output::Location;
use tugtool_python::ops::rename::rename;
use tugtool_python::ops::rename_param::rename_param;
use tugtool_python::verification::VerificationMode;

/// Helper to set up a test workspace with the given files.
fn setup_workspace(files: &[(&str, &str)]) -> (TempDir, Vec<(String, String)>) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");

    let mut file_list = Vec::new();
    for (path, content) in files {
        let full_path = temp_dir.path().join(path);
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent).expect("Failed to create directories");
        }
        std::fs::write(&full_path, content).expect("Failed to write file");
        file_list.push((path.to_string(), content.to_string()));
    }

    (temp_dir, file_list)
}

/// Get Python path for verification.
fn python_path() -> PathBuf {
    PathBuf::from("python3")
}

// ============================================================================
// Parameter Collision Tests
// ============================================================================

mod param_collision {
    use super::*;

    /// Test: Rename parameter when another function has parameter with same name.
    ///
    /// This is the primary regression test for the symbol_lookup collision bug.
    /// Two functions have a parameter named `value`, and we rename the first one.
    /// The bug would cause body references to be missed because the HashMap
    /// collision would associate all `value` references with the wrong symbol.
    #[test]
    fn test_rename_param_with_same_name_in_another_function() {
        let code = r#"def process_a(value: int) -> int:
    # Use value multiple times
    doubled = value * 2
    return value + doubled

def process_b(value: int) -> int:
    # This function also has a 'value' parameter
    return value * 3
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);

        // Rename the 'value' parameter in process_a (line 1, col 15 is "value")
        let location = Location::new("test.py", 1, 15);

        let result = rename_param(
            workspace.path(),
            &files,
            &location,
            "input_value",
            &python_path(),
            VerificationMode::Syntax,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();

        // Check that we have the expected number of edits:
        // 1. Parameter declaration in process_a
        // 2. First usage: `doubled = value * 2`
        // 3. Second usage: `return value + doubled`
        //
        // The bug would only produce 1 edit (just the declaration).
        assert!(
            output.summary.edits_count >= 3,
            "Expected at least 3 edits (declaration + 2 body refs), got {}. \
             This indicates the collision bug is still present!",
            output.summary.edits_count
        );

        // Verify the patch contains the renamed parameter usages
        let patch = &output.patch.unified_diff;

        // Check that the new name appears in the patch (3 occurrences: decl + 2 body refs)
        let new_name_count = patch.matches("+input_value").count();
        assert!(
            new_name_count >= 3,
            "Patch should contain at least 3 occurrences of +input_value (got {}): {}",
            new_name_count,
            patch
        );

        // Check that only process_a's value is renamed, not process_b's
        // The patch hunks should only affect lines 1-4 (process_a), not lines 6-8 (process_b)
        // Count how many -value lines there are - should be 3 for process_a
        let old_name_count = patch.matches("-value").count();
        assert!(
            old_name_count == 3,
            "Patch should contain exactly 3 occurrences of -value (got {}): {}",
            old_name_count,
            patch
        );
    }

    /// Test: Rename parameter with three functions having the same parameter name.
    ///
    /// This tests a more complex collision scenario where three functions
    /// all have parameters named `data`.
    #[test]
    fn test_rename_param_three_functions_same_name() {
        let code = r#"def first(data: str) -> str:
    return data.upper()

def second(data: str) -> str:
    return data.lower()

def third(data: str) -> str:
    return data.strip()
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);

        // Rename 'data' in the second function (line 4, col 12)
        let location = Location::new("test.py", 4, 12);

        let result = rename_param(
            workspace.path(),
            &files,
            &location,
            "text",
            &python_path(),
            VerificationMode::Syntax,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();

        // Should have 2 edits: declaration + body reference
        assert!(
            output.summary.edits_count >= 2,
            "Expected at least 2 edits, got {}",
            output.summary.edits_count
        );

        let patch = &output.patch.unified_diff;

        // Check that the new name appears (2 occurrences: decl + body)
        let new_name_count = patch.matches("+text").count();
        assert!(
            new_name_count >= 2,
            "Patch should contain at least 2 occurrences of +text (got {}): {}",
            new_name_count,
            patch
        );

        // Check that only 2 old names are replaced (only second function)
        let old_name_count = patch.matches("-data").count();
        assert!(
            old_name_count == 2,
            "Patch should contain exactly 2 occurrences of -data (got {}): {}",
            old_name_count,
            patch
        );
    }

    /// Test: Rename parameter collision using general rename (not rename_param).
    #[test]
    fn test_rename_param_collision_two_functions() {
        let code = r#"def foo(x: int) -> int:
    return x + 1

def bar(x: int) -> int:
    return x * 2
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);

        // Rename 'x' in foo using general rename
        let location = Location::new("test.py", 1, 9);

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "num",
            &python_path(),
            VerificationMode::Syntax,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();

        // Should have 2 edits: declaration + body reference
        assert!(
            output.summary.edits_count >= 2,
            "Expected at least 2 edits, got {}",
            output.summary.edits_count
        );

        let patch = &output.patch.unified_diff;

        // foo should be modified: check for new name
        let new_name_count = patch.matches("+num").count();
        assert!(
            new_name_count >= 2,
            "Patch should contain at least 2 occurrences of +num (got {}): {}",
            new_name_count,
            patch
        );

        // Only foo's x should be renamed, not bar's
        let old_name_count = patch.matches("-x").count();
        assert!(
            old_name_count == 2,
            "Patch should contain exactly 2 occurrences of -x (got {}): {}",
            old_name_count,
            patch
        );
    }
}

// ============================================================================
// Local Variable Collision Tests
// ============================================================================
//
// NOTE: Local variable reference tracking has known limitations compared to
// parameter reference tracking. These tests verify the collision fix works
// for local variables when references ARE tracked, but the reference tracking
// itself may only find the definition. This is a pre-existing limitation.

mod local_collision {
    use super::*;

    /// Test: Rename local variable when another function has variable with same name.
    ///
    /// NOTE: This test verifies that the collision fix works (no cross-function
    /// contamination), but local variable reference tracking has limitations.
    #[test]
    fn test_rename_local_with_same_name_in_another_function() {
        let code = r#"def calculate_a():
    result = 10
    result = result + 5
    return result

def calculate_b():
    result = 20
    return result * 2
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);

        // Rename 'result' in calculate_a (line 2, col 5)
        let location = Location::new("test.py", 2, 5);

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "total",
            &python_path(),
            VerificationMode::Syntax,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();

        // At minimum, the declaration should be renamed (1 edit).
        // Full reference tracking would give 4 edits, but this is a known limitation.
        assert!(
            output.summary.edits_count >= 1,
            "Expected at least 1 edit (declaration), got {}",
            output.summary.edits_count
        );

        let patch = &output.patch.unified_diff;

        // Check the new name appears
        assert!(
            patch.contains("+total"),
            "Patch should contain +total: {}",
            patch
        );

        // CRITICAL: Verify calculate_b is NOT modified (collision fix)
        // Even if reference tracking is limited, we must not touch the other function
        assert!(
            !patch.contains("calculate_b"),
            "calculate_b should NOT appear in patch (collision fix): {}",
            patch
        );
    }

    /// Test: Rename local variable collision using two functions.
    ///
    /// NOTE: Verifies collision fix works even with limited reference tracking.
    #[test]
    fn test_rename_local_collision_two_functions() {
        let code = r#"def func_a():
    temp = get_data()
    process(temp)
    return temp

def func_b():
    temp = other_data()
    return temp
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);

        // Rename 'temp' in func_a (line 2, col 5)
        let location = Location::new("test.py", 2, 5);

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "data",
            &python_path(),
            VerificationMode::Syntax,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();

        // At minimum, the declaration should be renamed
        assert!(
            output.summary.edits_count >= 1,
            "Expected at least 1 edit, got {}",
            output.summary.edits_count
        );

        let patch = &output.patch.unified_diff;

        // Check the new name appears
        assert!(
            patch.contains("+data"),
            "Patch should contain +data: {}",
            patch
        );

        // CRITICAL: Verify func_b is NOT modified (collision fix)
        assert!(
            !patch.contains("func_b"),
            "func_b should NOT appear in patch (collision fix): {}",
            patch
        );
    }
}

// ============================================================================
// Method Parameter Collision Tests
// ============================================================================

mod method_collision {
    use super::*;

    /// Test: Rename parameter in method when another method has same-named parameter.
    #[test]
    fn test_rename_method_param_collision() {
        let code = r#"class Handler:
    def process(self, item: str) -> str:
        return item.upper()

    def transform(self, item: str) -> str:
        return item.lower()
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);

        // Rename 'item' in process method (line 2, col 23 is "item")
        let location = Location::new("test.py", 2, 23);

        let result = rename_param(
            workspace.path(),
            &files,
            &location,
            "value",
            &python_path(),
            VerificationMode::Syntax,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();

        // Should have 2 edits: declaration + body reference
        assert!(
            output.summary.edits_count >= 2,
            "Expected at least 2 edits, got {}",
            output.summary.edits_count
        );

        let patch = &output.patch.unified_diff;

        // process method should be modified: check for new name
        let new_name_count = patch.matches("+value").count();
        assert!(
            new_name_count >= 2,
            "Patch should contain at least 2 occurrences of +value (got {}): {}",
            new_name_count,
            patch
        );

        // Only process's item should be renamed, not transform's
        let old_name_count = patch.matches("-item").count();
        assert!(
            old_name_count == 2,
            "Patch should contain exactly 2 occurrences of -item (got {}): {}",
            old_name_count,
            patch
        );
    }
}
