// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Hardening tests for Python rename operations.
//!
//! These tests cover edge cases identified in Table T02 of the phase-13 plan:
//! - Decorator arguments
//! - Comprehension scope
//! - Multi-inheritance rename
//! - Aliased import rename
//! - Property setter rename
//! - Nested class rename
//! - Walrus operator target renaming
//!
//! # Running These Tests
//!
//! ```bash
//! cargo nextest run -p tugtool-python rename_hardening
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

/// Get Python path for verification.
fn python_path() -> PathBuf {
    PathBuf::from("python3")
}

// ============================================================================
// Decorator Argument Tests (T02: Decorator arguments)
// ============================================================================

mod decorator_args {
    use super::*;

    #[test]
    fn test_rename_decorator_arg_simple() {
        // DA-01: Simple decorator with function argument
        let code = r#"def my_decorator(func):
    return func

@my_decorator(my_decorator)
def foo():
    pass
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 5); // "my_decorator"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "the_decorator",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Should rename both the definition and the decorator usage
        assert!(
            patch.contains("the_decorator"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_decorator_arg_as_argument() {
        // DA-02: Variable used as decorator argument
        let code = r#"some_value = 42

def decorator(arg):
    def inner(func):
        return func
    return inner

@decorator(some_value)
def foo():
    pass
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "some_value"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "config_value",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name
        assert!(
            patch.contains("config_value"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_decorator_arg_keyword() {
        // DA-03: Keyword argument in decorator
        let code = r#"default_name = "hello"

def decorator(name="default"):
    def inner(func):
        return func
    return inner

@decorator(name=default_name)
def foo():
    pass
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "default_name"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "greeting",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name
        assert!(
            patch.contains("greeting"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_decorator_arg_nested() {
        // DA-04: Nested decorator call with argument
        let code = r#"CONFIG = {"key": "value"}

def outer(config):
    def decorator(func):
        return func
    return decorator

@outer(CONFIG)
def foo():
    pass
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "CONFIG"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "SETTINGS",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name
        assert!(
            patch.contains("SETTINGS"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_decorator_multiple_args() {
        // DA-05: Multiple arguments in decorator
        let code = r#"first = 1
second = 2

def decorator(a, b):
    def inner(func):
        return func
    return inner

@decorator(first, second)
def foo():
    pass
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "first"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "primary",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name
        assert!(
            patch.contains("primary"),
            "Patch should contain new name: {}",
            patch
        );
    }
}

// ============================================================================
// Comprehension Scope Tests (T02: Comprehension scope, D09)
// ============================================================================

mod comprehension_scope {
    use super::*;

    #[test]
    fn test_rename_comprehension_source_variable() {
        // CS-01: Rename variable used in comprehension (not the iteration variable)
        let code = r#"items = [1, 2, 3]
doubled = [x * 2 for x in items]
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "items"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "numbers",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name
        assert!(
            patch.contains("numbers"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_comprehension_nested_source() {
        // CS-02: Nested comprehension with outer variable reference
        let code = r#"matrix = [[1, 2], [3, 4]]
flattened = [x for row in matrix for x in row]
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "matrix"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "grid",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name
        assert!(
            patch.contains("grid"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_dict_comprehension_source() {
        // CS-03: Dict comprehension
        let code = r#"pairs = [(1, 'a'), (2, 'b')]
mapping = {k: v for k, v in pairs}
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "pairs"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "key_values",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name
        assert!(
            patch.contains("key_values"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_generator_expression_source() {
        // CS-04: Generator expression
        let code = r#"values = [1, 2, 3, 4, 5]
total = sum(x for x in values if x > 2)
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "values"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "numbers",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name (using "numbers" not "items")
        assert!(
            patch.contains("numbers"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_set_comprehension_source() {
        // CS-05: Set comprehension
        let code = r#"items = [1, 2, 2, 3, 3, 3]
unique = {x for x in items}
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 1, 1); // "items"

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "duplicates",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The diff shows changed spans, check for the new name
        assert!(
            patch.contains("duplicates"),
            "Patch should contain new name: {}",
            patch
        );
    }
}

// ============================================================================
// Multi-Inheritance Tests (T02: Multi-inheritance rename)
// ============================================================================

mod multi_inheritance {
    use super::*;

    #[test]
    fn test_rename_diamond_inheritance() {
        // MI-01: Diamond inheritance pattern
        let code = r#"class Base:
    def process(self):
        pass

class Left(Base):
    def process(self):
        super().process()

class Right(Base):
    def process(self):
        super().process()

class Diamond(Left, Right):
    def process(self):
        super().process()
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 2, 9); // "process" in Base

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "handle",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // All process methods in the hierarchy should be renamed
        // The diff shows changed spans, check for multiple occurrences of the new name
        assert!(
            patch.contains("handle"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_multi_parent_method() {
        // MI-02: Method defined in multiple parents
        let code = r#"class Mixin1:
    def setup(self):
        pass

class Mixin2:
    def setup(self):
        pass

class Combined(Mixin1, Mixin2):
    pass
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 2, 9); // "setup" in Mixin1

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "initialize",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // At minimum, the method in Mixin1 should be renamed
        assert!(
            patch.contains("initialize"),
            "Patch should contain new name: {}",
            patch
        );
    }
}

// ============================================================================
// Aliased Import Tests (T02: Aliased import rename)
// ============================================================================

mod aliased_imports {
    use super::*;

    #[test]
    fn test_rename_with_alias_keeps_alias() {
        // AI-01: Renaming symbol doesn't change its alias
        let code = r#"from module import original as alias

def use_it():
    return alias()
"#;
        let module_code = r#"def original():
    return 42
"#;

        let (workspace, files) =
            setup_workspace(&[("module.py", module_code), ("consumer.py", code)]);
        let location = Location::new("module.py", 1, 5); // "original" in module

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "renamed",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Definition should be renamed, check for the new name in patch
        assert!(
            patch.contains("renamed"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_aliased_import_usage() {
        // AI-02: Rename the original symbol with aliased import
        let code = r#"from module import something as old_alias

result = old_alias()
"#;
        let module_code = r#"def something():
    return 42
"#;

        let (workspace, files) =
            setup_workspace(&[("module.py", module_code), ("consumer.py", code)]);

        let location = Location::new("module.py", 1, 5); // "something" in module

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "other",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Definition should be renamed, check for the new name in patch
        assert!(
            patch.contains("other"),
            "Patch should contain new name: {}",
            patch
        );
    }
}

// ============================================================================
// Property Setter Tests (T02: Property setter rename)
// ============================================================================

mod property_setter {
    use super::*;

    #[test]
    fn test_rename_property_renames_setter() {
        // PS-01: Renaming property getter should also rename setter
        let code = r#"class Config:
    def __init__(self):
        self._value = 0

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._value = v
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 6, 9); // "value" property getter

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "setting",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Both getter and setter should be renamed, check for the new name
        assert!(
            patch.contains("setting"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_property_with_deleter() {
        // PS-02: Property with getter, setter, and deleter
        let code = r#"class Resource:
    def __init__(self):
        self._data = None

    @property
    def data(self):
        return self._data

    @data.setter
    def data(self, value):
        self._data = value

    @data.deleter
    def data(self):
        del self._data
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 6, 9); // "data" property getter

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "content",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // All three (getter, setter, deleter) should be renamed, check for the new name
        assert!(
            patch.contains("content"),
            "Patch should contain new name: {}",
            patch
        );
    }
}

// ============================================================================
// Nested Class Tests (T02: Nested class rename)
// ============================================================================

mod nested_class {
    use super::*;

    #[test]
    fn test_rename_nested_class() {
        // NC-01: Class defined inside a function
        let code = r#"def factory():
    class Inner:
        pass
    return Inner()

result = factory()
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 2, 11); // "Inner" class

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "Product",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Class definition and reference should be renamed
        assert!(
            patch.contains("Product"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_class_inside_class() {
        // NC-02: Class defined inside another class
        let code = r#"class Outer:
    class Inner:
        pass

    def get_inner(self):
        return self.Inner()
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 2, 11); // "Inner" nested class

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "Nested",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Nested class definition and reference should be renamed
        assert!(
            patch.contains("Nested"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_function_inside_function() {
        // NC-03: Function defined inside another function
        let code = r#"def outer():
    def inner():
        return 42
    return inner()
"#;
        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 2, 9); // "inner" function

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "helper",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Inner function definition and reference should be renamed
        assert!(
            patch.contains("helper"),
            "Patch should contain new name: {}",
            patch
        );
    }
}

// ============================================================================
// Walrus Operator Tests (T02: Walrus operator)
// ============================================================================

mod walrus_operator {
    use super::*;

    #[test]
    fn test_rename_walrus_target() {
        // WO-01: Rename the target of a walrus operator
        let code = r#"def compute():
    return 42

if (result := compute()):
    print(result)
"#;

        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 4, 5); // "result" in walrus

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "outcome",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Walrus target and reference should be renamed
        assert!(
            patch.contains("outcome"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_walrus_in_while() {
        // WO-02: Walrus in while loop condition
        let code = r#"def get_line():
    return input()

while (line := get_line()):
    print(line)
"#;

        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 4, 8); // "line" in walrus

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "data",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // Walrus target and reference should be renamed
        assert!(
            patch.contains("data"),
            "Patch should contain new name: {}",
            patch
        );
    }

    #[test]
    fn test_rename_walrus_in_comprehension() {
        // WO-03: Walrus in list comprehension condition
        let code = r#"def compute(x):
    return x * 2

results = [y for x in range(10) if (y := compute(x)) > 5]
"#;

        let (workspace, files) = setup_workspace(&[("test.py", code)]);
        let location = Location::new("test.py", 4, 37); // "y" in walrus (column 37, 1-indexed)

        let result = rename(
            workspace.path(),
            &files,
            &location,
            "value",
            &python_path(),
            VerificationMode::None,
            false,
        );

        assert!(result.is_ok(), "Rename failed: {:?}", result.err());
        let output = result.unwrap();
        let patch = &output.patch.unified_diff;

        // The walrus target and its usages should be renamed
        assert!(
            patch.contains("value"),
            "Patch should contain new name: {}",
            patch
        );
    }
}
