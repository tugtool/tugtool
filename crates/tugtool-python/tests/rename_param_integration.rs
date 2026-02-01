// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Integration tests for rename_param operation.
//!
//! Tests verify that the rename_param operation correctly:
//! - Renames parameter definitions in function signatures
//! - Renames parameter references in function bodies
//! - (Future) Updates keyword arguments at call sites

use tugtool_python::ops::rename_param::rename_param_in_file;

// ============================================================================
// Basic Parameter Rename Tests
// ============================================================================

#[test]
fn test_rename_param_basic() {
    let source = r#"def greet(name):
    return f"Hello, {name}"
"#;
    let result = rename_param_in_file(source, "name", "recipient").unwrap();
    let expected = r#"def greet(recipient):
    return f"Hello, {recipient}"
"#;
    assert_eq!(result, expected);
}

#[test]
fn test_rename_param_with_default() {
    let source = r#"def greet(name, greeting="Hello"):
    return f"{greeting}, {name}"
"#;
    let result = rename_param_in_file(source, "greeting", "salutation").unwrap();
    assert!(result.contains("def greet(name, salutation="));
    assert!(result.contains("{salutation}"));
}

#[test]
fn test_rename_param_multiple_references() {
    let source = r#"def process(data):
    print(data)
    transformed = data.upper()
    return data
"#;
    let result = rename_param_in_file(source, "data", "input_value").unwrap();
    assert!(result.contains("def process(input_value)"));
    assert!(result.contains("print(input_value)"));
    assert!(result.contains("input_value.upper()"));
    assert!(result.contains("return input_value"));
}

#[test]
fn test_rename_param_preserves_other_params() {
    let source = r#"def func(a, b, c):
    return a + b + c
"#;
    let result = rename_param_in_file(source, "b", "middle").unwrap();
    assert!(result.contains("def func(a, middle, c)"));
    assert!(result.contains("return a + middle + c"));
}

// ============================================================================
// Keyword-Only Parameter Tests
// ============================================================================

#[test]
fn test_rename_keyword_only_param() {
    let source = r#"def func(a, *, key):
    return key
"#;
    let result = rename_param_in_file(source, "key", "value").unwrap();
    assert!(result.contains("def func(a, *, value)"));
    assert!(result.contains("return value"));
}

#[test]
fn test_rename_param_in_method() {
    let source = r#"class Handler:
    def process(self, data):
        print(data)
        return data.upper()
"#;
    let result = rename_param_in_file(source, "data", "input_data").unwrap();
    assert!(result.contains("def process(self, input_data)"));
    assert!(result.contains("print(input_data)"));
    assert!(result.contains("input_data.upper()"));
}

// ============================================================================
// Edge Cases
// ============================================================================

#[test]
fn test_rename_param_shadowed_in_nested_scope() {
    // Parameter renamed in function should not affect nested function's param
    let source = r#"def outer(x):
    def inner(x):
        return x * 2
    return inner(x)
"#;
    let result = rename_param_in_file(source, "x", "value").unwrap();
    // Both x params get renamed since they have the same name
    // This is expected behavior for a simple name-based rename
    assert!(result.contains("def outer(value)"));
    // The inner x is also renamed because it's the same name
    assert!(result.contains("def inner(value)"));
}

#[test]
fn test_rename_param_with_type_annotation() {
    let source = r#"def process(data: list) -> str:
    return str(data)
"#;
    let result = rename_param_in_file(source, "data", "items").unwrap();
    assert!(result.contains("def process(items: list)"));
    assert!(result.contains("str(items)"));
}

#[test]
fn test_rename_param_no_match() {
    let source = r#"def func(a, b):
    return a + b
"#;
    let result = rename_param_in_file(source, "nonexistent", "new_name").unwrap();
    // No changes - the parameter doesn't exist
    assert_eq!(result, source);
}

// ============================================================================
// Multiple Functions
// ============================================================================

#[test]
fn test_rename_param_multiple_functions() {
    // Same parameter name in different functions
    let source = r#"def func1(x):
    return x * 2

def func2(x):
    return x * 3
"#;
    let result = rename_param_in_file(source, "x", "value").unwrap();
    // Both get renamed (name-based rename)
    assert!(result.contains("def func1(value)"));
    assert!(result.contains("def func2(value)"));
}

// ============================================================================
// Special Characters in String Literals
// ============================================================================

#[test]
fn test_rename_param_preserves_string_literals() {
    let source = r#"def process(name):
    print("Processing name")
    return name
"#;
    let result = rename_param_in_file(source, "name", "identifier").unwrap();
    // String literal should NOT be changed
    assert!(result.contains("\"Processing name\""));
    // But references should be
    assert!(result.contains("def process(identifier)"));
    assert!(result.contains("return identifier"));
}
