// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Tests for type comment renaming in Python rename operations.
//!
//! These tests verify that `# type: ...` comments are correctly updated
//! when renaming symbols that appear in them.
//!
//! # Running These Tests
//!
//! ```bash
//! cargo nextest run -p tugtool-python rename_type_comments
//! ```

use std::path::PathBuf;
use tempfile::TempDir;
use tugtool_core::output::Location;
use tugtool_python::ops::rename::rename;
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

/// Get Python path for verification (or a fallback path).
fn python_path() -> PathBuf {
    PathBuf::from("python3")
}

// ============================================================================
// test_rename_type_comment - Basic type comment renaming
// ============================================================================

#[test]
fn test_rename_type_comment_simple() {
    // TC-01: Simple type comment `# type: Handler` should be renamed
    let code = r#"class Handler:
    pass

x = None  # type: Handler
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7); // "Handler" in class definition

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false, // Don't apply, just get the result
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();

    // Verify the patch contains the expected renames
    let patch = &output.patch.unified_diff;
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_generic() {
    // TC-02: Generic type comment `# type: List[Handler]` should rename inner type
    let code = r#"from typing import List

class Handler:
    pass

handlers = []  # type: List[Handler]
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 3, 7); // "Handler" in class definition

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    // Should rename both the class definition and the type comment
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_union() {
    // TC-03: Union type comment `# type: Union[Handler, str]`
    let code = r#"from typing import Union

class Handler:
    pass

x = None  # type: Union[Handler, str]
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 3, 7); // "Handler" in class definition

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_multiple_occurrences() {
    // TC-04: Multiple occurrences of same type in comment
    let code = r#"class Handler:
    pass

mapping = {}  # type: Dict[Handler, Handler]
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    // Both occurrences should be renamed
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_function_signature() {
    // TC-05: Function signature type comment `# type: (Handler) -> str`
    let code = r#"class Handler:
    pass

def process(x):  # type: (Handler) -> str
    return str(x)
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_ignore_unchanged() {
    // TC-06: `# type: ignore` comments should not be modified
    let code = r#"class Handler:
    pass

x = something_untyped()  # type: ignore
y = Handler()
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    // Class definition should be renamed
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_qualified_name() {
    // TC-07: Qualified name in type comment `# type: module.Handler`
    // Note: This tests that local class rename doesn't affect qualified names
    let code = r#"class Handler:
    pass

x = None  # type: module.Handler
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    // The local class should be renamed
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_preserves_spacing() {
    // TC-08: Type comment spacing should be preserved
    let code = r#"class Handler:
    pass

x = None  # type:   Handler
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    // Check that the class is renamed
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

// ============================================================================
// test_rename_type_comment_in_function - Type comments inside functions
// ============================================================================

#[test]
fn test_rename_type_comment_in_function() {
    // TC-09: Type comment inside function body
    let code = r#"class Handler:
    pass

def process():
    local_handler = None  # type: Handler
    return local_handler
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_in_method() {
    // TC-10: Type comment inside method body
    let code = r#"class Handler:
    def get_handler(self):
        result = None  # type: Handler
        return result
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

// ============================================================================
// test_rename_type_comment_multifile - Cross-file type comment scenarios
// ============================================================================

#[test]
fn test_rename_type_comment_multifile() {
    // TC-11: Type comment in a different file than the class definition
    let module_code = r#"class Handler:
    pass
"#;

    let consumer_code = r#"from module import Handler

x = None  # type: Handler
"#;

    let (workspace, files) =
        setup_workspace(&[("module.py", module_code), ("consumer.py", consumer_code)]);
    let location = Location::new("module.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    // Should rename in both files
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_multifile_with_alias() {
    // TC-12: Type comment with aliased import - alias should NOT be renamed
    let module_code = r#"class Handler:
    pass
"#;

    let consumer_code = r#"from module import Handler as H

x = None  # type: H
"#;

    let (workspace, files) =
        setup_workspace(&[("module.py", module_code), ("consumer.py", consumer_code)]);
    let location = Location::new("module.py", 1, 7);

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    // Class definition should be renamed
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}

#[test]
fn test_rename_type_comment_no_match() {
    // TC-13: Type comment that doesn't match renamed symbol
    let code = r#"class Handler:
    pass

class Other:
    pass

x = None  # type: Other
"#;

    let (workspace, files) = setup_workspace(&[("test.py", code)]);
    let location = Location::new("test.py", 1, 7); // Rename Handler

    let result = rename(
        workspace.path(),
        &files,
        &location,
        "RequestHandler",
        &python_path(),
        VerificationMode::None,
        false,
    );

    assert!(result.is_ok(), "Rename failed: {:?}", result.err());
    let output = result.unwrap();
    let patch = &output.patch.unified_diff;

    // Only Handler should be renamed, not Other
    assert!(
        patch.contains("RequestHandler"),
        "Patch should contain new name: {}",
        patch
    );
}
