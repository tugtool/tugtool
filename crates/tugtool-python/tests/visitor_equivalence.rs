// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Visitor Equivalence Tests
//!
//! These tests compare the native Rust CST visitors against the Python LibCST
//! worker output to verify behavioral equivalence during the migration.
//!
//! # Running These Tests
//!
//! These tests require Python with libcst installed. They are gated behind
//! the `python-worker` feature and are NOT part of the default CI path.
//!
//! To run equivalence tests:
//! ```bash
//! cargo nextest run -p tugtool-python --features python-worker equivalence
//! ```
//!
//! # Purpose
//!
//! These tests verify that the native Rust implementation produces equivalent
//! results to the Python LibCST implementation. "Equivalent" means:
//! - Same symbols are identified (bindings, references)
//! - Same scopes are detected
//! - Same analysis patterns are found
//!
//! Note: Exact byte-for-byte JSON identity is NOT required. The tests check
//! for behavioral equivalence (same logical results).
//!
//! # Test Coverage
//!
//! - P0: ScopeCollector, BindingCollector, ReferenceCollector, RenameTransformer
//! - P1: ImportCollector, AnnotationCollector, TypeInferenceCollector,
//!       InheritanceCollector, MethodCallCollector
//! - P2: DynamicPatternDetector

// Only compile these tests when python-worker feature is enabled
#![cfg(feature = "python-worker")]

use std::collections::HashSet;
use tempfile::TempDir;
use tugtool_python::test_helpers::require_python_with_libcst;
use tugtool_python::worker::{spawn_worker, WorkerHandle, RewriteRequest, SpanInfo};

#[cfg(feature = "native-cst")]
use tugtool_python::cst_bridge::{parse_and_analyze, rewrite_batch};

#[cfg(feature = "native-cst")]
use tugtool_core::patch::Span;

/// Create a test session directory for the Python worker.
fn create_test_session() -> TempDir {
    let temp = TempDir::new().expect("Failed to create temp dir");
    std::fs::create_dir_all(temp.path().join("python")).unwrap();
    std::fs::create_dir_all(temp.path().join("workers")).unwrap();
    temp
}

/// Spawn a Python worker for testing.
fn spawn_test_worker() -> (WorkerHandle, TempDir) {
    let python_path = require_python_with_libcst();
    let temp = create_test_session();
    let handle = spawn_worker(&python_path, temp.path())
        .expect("Failed to spawn Python worker");
    (handle, temp)
}

// ============================================================================
// Scope Equivalence Tests
// ============================================================================

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_scope_simple_function() {
    let source = "def foo():\n    x = 1\n    return x\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_scopes = worker.get_scopes(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Compare: should have same scope kinds
    let python_kinds: HashSet<_> = python_scopes.iter().map(|s| s.kind.as_str()).collect();
    let native_kinds: HashSet<_> = native_result.scopes.iter().map(|s| s.kind.as_str()).collect();

    assert!(python_kinds.contains("module"), "Python should have module scope");
    assert!(python_kinds.contains("function"), "Python should have function scope");
    assert!(native_kinds.contains("module"), "Native should have module scope");
    assert!(native_kinds.contains("function"), "Native should have function scope");

    // Check function scope name
    let python_fn_scope = python_scopes.iter().find(|s| s.kind == "function");
    let native_fn_scope = native_result.scopes.iter().find(|s| s.kind == "function");

    assert_eq!(
        python_fn_scope.and_then(|s| s.name.as_ref()),
        native_fn_scope.and_then(|s| s.name.as_ref()),
        "Function scope names should match"
    );
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_scope_nested_class() {
    let source = r#"class Outer:
    class Inner:
        def method(self):
            pass
"#;

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_scopes = worker.get_scopes(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should have: module, Outer class, Inner class, method function
    let python_kinds: Vec<_> = python_scopes.iter().map(|s| &s.kind).collect();
    let native_kinds: Vec<_> = native_result.scopes.iter().map(|s| &s.kind).collect();

    assert!(python_kinds.iter().filter(|k| k.as_str() == "class").count() >= 2,
            "Python should have at least 2 class scopes");
    assert!(native_kinds.iter().filter(|k| k.as_str() == "class").count() >= 2,
            "Native should have at least 2 class scopes");
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_scope_comprehension() {
    let source = "result = [x for x in range(10)]\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_scopes = worker.get_scopes(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should have comprehension scope (Python 3 behavior)
    let python_has_comp = python_scopes.iter().any(|s| s.kind == "comprehension");
    let native_has_comp = native_result.scopes.iter().any(|s| s.kind == "comprehension");

    assert_eq!(python_has_comp, native_has_comp,
               "Both should agree on comprehension scope presence");
}

// ============================================================================
// Binding Equivalence Tests
// ============================================================================

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_binding_simple() {
    let source = "def foo():\n    x = 1\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_bindings = worker.get_bindings(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find "foo" and "x"
    let python_names: HashSet<_> = python_bindings.iter().map(|b| b.name.as_str()).collect();
    let native_names: HashSet<_> = native_result.bindings.iter().map(|b| b.name.as_str()).collect();

    assert!(python_names.contains("foo"), "Python should find 'foo' binding");
    assert!(python_names.contains("x"), "Python should find 'x' binding");
    assert!(native_names.contains("foo"), "Native should find 'foo' binding");
    assert!(native_names.contains("x"), "Native should find 'x' binding");
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_binding_class() {
    let source = r#"class MyClass:
    def method(self, param):
        local_var = 1
"#;

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_bindings = worker.get_bindings(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    let python_names: HashSet<_> = python_bindings.iter().map(|b| b.name.as_str()).collect();
    let native_names: HashSet<_> = native_result.bindings.iter().map(|b| b.name.as_str()).collect();

    // Both should find: MyClass, method, self, param, local_var
    for name in &["MyClass", "method", "self", "param", "local_var"] {
        assert!(python_names.contains(*name), "Python should find '{}' binding", name);
        assert!(native_names.contains(*name), "Native should find '{}' binding", name);
    }
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_binding_import() {
    let source = "import os\nfrom sys import path, argv\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_bindings = worker.get_bindings(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    let python_names: HashSet<_> = python_bindings.iter().map(|b| b.name.as_str()).collect();
    let native_names: HashSet<_> = native_result.bindings.iter().map(|b| b.name.as_str()).collect();

    // Both should find: os, path, argv
    for name in &["os", "path", "argv"] {
        assert!(python_names.contains(*name), "Python should find '{}' binding", name);
        assert!(native_names.contains(*name), "Native should find '{}' binding", name);
    }
}

// ============================================================================
// Reference Equivalence Tests
// ============================================================================

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_reference_simple() {
    let source = "def foo():\n    pass\n\nfoo()\nfoo()\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_refs = worker.get_references(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find references to "foo"
    let python_foo_refs = python_refs.get("foo");
    let native_foo_refs = native_result.references.iter()
        .find(|(name, _)| name == "foo")
        .map(|(_, refs)| refs);

    assert!(python_foo_refs.is_some(), "Python should find 'foo' references");
    assert!(native_foo_refs.is_some(), "Native should find 'foo' references");

    // Both should find at least 3 references (definition + 2 calls)
    assert!(python_foo_refs.unwrap().len() >= 3,
            "Python should have at least 3 references to 'foo'");
    assert!(native_foo_refs.unwrap().len() >= 3,
            "Native should have at least 3 references to 'foo'");
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_reference_attribute() {
    let source = "obj.method()\nobj.property = 1\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_refs = worker.get_references(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find references to "obj"
    let python_obj_refs = python_refs.get("obj");
    let native_obj_refs = native_result.references.iter()
        .find(|(name, _)| name == "obj")
        .map(|(_, refs)| refs);

    assert!(python_obj_refs.is_some(), "Python should find 'obj' references");
    assert!(native_obj_refs.is_some(), "Native should find 'obj' references");
}

// ============================================================================
// P1 Collector Equivalence Tests
// ============================================================================

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_p1_imports() {
    let source = "import os\nfrom sys import path\nfrom . import local\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_imports = worker.get_imports(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find 3 imports
    assert_eq!(python_imports.len(), native_result.imports.len(),
               "Import count should match (Python: {}, Native: {})",
               python_imports.len(), native_result.imports.len());
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_p1_annotations() {
    let source = "def foo(x: int, y: str) -> bool:\n    z: float = 1.0\n    return True\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_annotations = worker.get_annotations(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find at least 4 annotations (x, y, return, z)
    assert!(python_annotations.len() >= 4,
            "Python should find at least 4 annotations, found {}",
            python_annotations.len());
    assert!(native_result.annotations.len() >= 4,
            "Native should find at least 4 annotations, found {}",
            native_result.annotations.len());
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_p1_assignments() {
    let source = "x = MyClass()\ny = x\nz = func()\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_assignments = worker.get_assignments(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find 3 assignments
    assert_eq!(python_assignments.len(), native_result.assignments.len(),
               "Assignment count should match");

    // Check that targets match
    let python_targets: HashSet<_> = python_assignments.iter().map(|a| a.target.as_str()).collect();
    let native_targets: HashSet<_> = native_result.assignments.iter().map(|a| a.target.as_str()).collect();

    for target in &["x", "y", "z"] {
        assert!(python_targets.contains(*target), "Python should find '{}' assignment", target);
        assert!(native_targets.contains(*target), "Native should find '{}' assignment", target);
    }
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_p1_class_inheritance() {
    let source = r#"class Base:
    pass

class Child(Base):
    pass

class Multi(Base, Mixin):
    pass
"#;

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_classes = worker.get_class_inheritance(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find 3 classes
    assert_eq!(python_classes.len(), native_result.class_inheritance.len(),
               "Class count should match");

    // Check that class names match
    let python_names: HashSet<_> = python_classes.iter().map(|c| c.name.as_str()).collect();
    let native_names: HashSet<_> = native_result.class_inheritance.iter().map(|c| c.name.as_str()).collect();

    for name in &["Base", "Child", "Multi"] {
        assert!(python_names.contains(*name), "Python should find '{}' class", name);
        assert!(native_names.contains(*name), "Native should find '{}' class", name);
    }

    // Check Child's bases
    let python_child = python_classes.iter().find(|c| c.name == "Child").unwrap();
    let native_child = native_result.class_inheritance.iter().find(|c| c.name == "Child").unwrap();

    assert!(python_child.bases.contains(&"Base".to_string()),
            "Python Child should have Base as parent");
    assert!(native_child.bases.contains(&"Base".to_string()),
            "Native Child should have Base as parent");
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_p1_method_calls() {
    let source = "handler.process()\nhandler.save(data)\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_calls = worker.get_method_calls(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find 2 method calls
    assert_eq!(python_calls.len(), native_result.method_calls.len(),
               "Method call count should match");

    // Check that method names match
    let python_methods: HashSet<_> = python_calls.iter().map(|c| c.method.as_str()).collect();
    let native_methods: HashSet<_> = native_result.method_calls.iter().map(|c| c.method.as_str()).collect();

    for method in &["process", "save"] {
        assert!(python_methods.contains(*method), "Python should find '{}' method call", method);
        assert!(native_methods.contains(*method), "Native should find '{}' method call", method);
    }
}

// ============================================================================
// P2 Dynamic Pattern Equivalence Tests
// ============================================================================

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_p2_dynamic_getattr() {
    let source = r#"x = getattr(obj, "method")
setattr(obj, "value", 42)
"#;

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_patterns = worker.get_dynamic_patterns(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find getattr and setattr
    let python_kinds: HashSet<_> = python_patterns.iter().map(|p| p.kind.as_str()).collect();
    let native_kinds: HashSet<_> = native_result.dynamic_patterns.iter()
        .map(|p| format!("{:?}", p.kind).to_lowercase())
        .collect();

    assert!(python_kinds.contains("getattr"), "Python should find getattr pattern");
    assert!(python_kinds.contains("setattr"), "Python should find setattr pattern");
    assert!(native_kinds.iter().any(|k| k.contains("getattr")), "Native should find getattr pattern");
    assert!(native_kinds.iter().any(|k| k.contains("setattr")), "Native should find setattr pattern");
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_p2_dynamic_eval_exec() {
    let source = r#"result = eval("1 + 2")
exec("print('hello')")
"#;

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_patterns = worker.get_dynamic_patterns(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find eval and exec
    let python_kinds: HashSet<_> = python_patterns.iter().map(|p| p.kind.as_str()).collect();
    let native_kinds: HashSet<_> = native_result.dynamic_patterns.iter()
        .map(|p| format!("{:?}", p.kind).to_lowercase())
        .collect();

    assert!(python_kinds.contains("eval"), "Python should find eval pattern");
    assert!(python_kinds.contains("exec"), "Python should find exec pattern");
    assert!(native_kinds.iter().any(|k| k.contains("eval")), "Native should find eval pattern");
    assert!(native_kinds.iter().any(|k| k.contains("exec")), "Native should find exec pattern");
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_p2_dynamic_magic_methods() {
    let source = r#"class Proxy:
    def __getattr__(self, name):
        return None

    def __setattr__(self, name, value):
        pass
"#;

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_patterns = worker.get_dynamic_patterns(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Both should find __getattr__ and __setattr__
    let python_kinds: HashSet<_> = python_patterns.iter().map(|p| p.kind.as_str()).collect();
    let native_kinds: HashSet<_> = native_result.dynamic_patterns.iter()
        .map(|p| format!("{:?}", p.kind).to_lowercase())
        .collect();

    assert!(python_kinds.contains("__getattr__"), "Python should find __getattr__ pattern");
    assert!(python_kinds.contains("__setattr__"), "Python should find __setattr__ pattern");
    assert!(native_kinds.iter().any(|k| k.contains("getattr")), "Native should find getattr method pattern");
    assert!(native_kinds.iter().any(|k| k.contains("setattr")), "Native should find setattr method pattern");
}

// ============================================================================
// Rename Transformer Equivalence Tests
// ============================================================================

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_rename_single() {
    let source = "def foo():\n    pass\n";

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_result = worker.rewrite_batch(&parse_resp.cst_id, &[
        RewriteRequest {
            span: SpanInfo { start: 4, end: 7 },
            new_name: "bar".to_string(),
        }
    ]).unwrap();

    // Get native Rust results
    let native_result = rewrite_batch(source, &[
        (Span::new(4, 7), "bar".to_string())
    ]).expect("Native rewrite failed");

    // Both should produce identical output
    assert_eq!(python_result, native_result,
               "Rename results should be identical\nPython: {}\nNative: {}",
               python_result, native_result);
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_rename_multiple() {
    let source = "def foo():\n    return foo\n";

    // Both occurrences of "foo" at offsets 4-7 and 22-25
    let rewrites = vec![
        (4_usize, 7_usize),
        (22_usize, 25_usize),
    ];

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_result = worker.rewrite_batch(&parse_resp.cst_id, &rewrites.iter().map(|(start, end)| {
        RewriteRequest {
            span: SpanInfo { start: *start, end: *end },
            new_name: "bar".to_string(),
        }
    }).collect::<Vec<_>>()).unwrap();

    // Get native Rust results
    let native_result = rewrite_batch(source, &rewrites.iter().map(|(start, end)| {
        (Span::new(*start as u64, *end as u64), "bar".to_string())
    }).collect::<Vec<_>>()).expect("Native rewrite failed");

    // Both should produce identical output
    assert_eq!(python_result, native_result,
               "Multi-rename results should be identical");
}

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_rename_longer_name() {
    // Test renaming to a longer name (different than original length)
    let source = "def f():\n    return f\n";

    // "f" at positions 4-5 (def f) and 20-21 (return f)
    let rewrites = vec![
        (4_usize, 5_usize),
        (20_usize, 21_usize),
    ];

    // Get Python worker results
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_result = worker.rewrite_batch(&parse_resp.cst_id, &rewrites.iter().map(|(start, end)| {
        RewriteRequest {
            span: SpanInfo { start: *start, end: *end },
            new_name: "longer_name".to_string(),
        }
    }).collect::<Vec<_>>()).unwrap();

    // Get native Rust results
    let native_result = rewrite_batch(source, &rewrites.iter().map(|(start, end)| {
        (Span::new(*start as u64, *end as u64), "longer_name".to_string())
    }).collect::<Vec<_>>()).expect("Native rewrite failed");

    // Both should produce identical output
    assert_eq!(python_result, native_result,
               "Rename to longer name results should be identical");
}

// ============================================================================
// Comprehensive Equivalence Test
// ============================================================================

#[test]
#[cfg(feature = "native-cst")]
fn equivalence_comprehensive_analysis() {
    let source = r#"from typing import List

class BaseHandler:
    def process(self, data: List[str]) -> bool:
        return True

class JsonHandler(BaseHandler):
    def process(self, data: List[str]) -> bool:
        result: bool = super().process(data)
        return result

def use_handler():
    handler = JsonHandler()
    handler.process(["data"])
    x = getattr(handler, "process")
"#;

    // Get Python worker results (combined analysis)
    let (mut worker, _temp) = spawn_test_worker();
    let parse_resp = worker.parse("test.py", source).unwrap();
    let python_analysis = worker.get_analysis(&parse_resp.cst_id).unwrap();

    // Get native Rust results
    let native_result = parse_and_analyze(source).expect("Native parse failed");

    // Compare binding names
    let python_binding_names: HashSet<_> = python_analysis.bindings.iter()
        .map(|b| b.name.as_str()).collect();
    let native_binding_names: HashSet<_> = native_result.bindings.iter()
        .map(|b| b.name.as_str()).collect();

    for name in &["BaseHandler", "JsonHandler", "process", "use_handler", "handler"] {
        assert!(python_binding_names.contains(*name),
                "Python should find '{}' binding", name);
        assert!(native_binding_names.contains(*name),
                "Native should find '{}' binding", name);
    }

    // Compare scope counts (may not be exact due to implementation differences)
    assert!(!python_analysis.scopes.is_empty(), "Python should have scopes");
    assert!(!native_result.scopes.is_empty(), "Native should have scopes");

    // Compare reference presence
    assert!(!python_analysis.references.is_empty(), "Python should have references");
    assert!(!native_result.references.is_empty(), "Native should have references");

    // Compare imports
    assert!(!python_analysis.imports.is_empty(), "Python should have imports");
    assert!(!native_result.imports.is_empty(), "Native should have imports");

    // Compare class inheritance
    assert!(!python_analysis.class_inheritance.is_empty(), "Python should have class inheritance");
    assert!(!native_result.class_inheritance.is_empty(), "Native should have class inheritance");

    // Compare method calls
    assert!(!python_analysis.method_calls.is_empty(), "Python should have method calls");
    assert!(!native_result.method_calls.is_empty(), "Native should have method calls");

    // Compare dynamic patterns
    assert!(!python_analysis.dynamic_patterns.is_empty(), "Python should have dynamic patterns");
    assert!(!native_result.dynamic_patterns.is_empty(), "Native should have dynamic patterns");
}
