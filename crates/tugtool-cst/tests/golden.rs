// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Golden file tests for tugtool-cst visitor analysis.
//!
//! These tests verify that visitor outputs match expected golden files.
//! Golden files serve as regression tests for analysis behavior.
//!
//! # Running Tests
//!
//! ```bash
//! cargo nextest run -p tugtool-cst golden
//! ```
//!
//! # Updating Golden Files
//!
//! When making intentional changes to analysis behavior:
//! ```bash
//! TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool-cst golden
//! git diff tests/golden/  # Review changes
//! ```
//!
//! # Test Organization
//!
//! - Python fixtures: `tests/golden/python/`
//! - Golden JSON files: `tests/golden/output/`
//!
//! Each Python fixture has corresponding golden files for:
//! - `{name}_scopes.json` - ScopeCollector output
//! - `{name}_bindings.json` - BindingCollector output
//! - `{name}_references.json` - ReferenceCollector output
//! - `{name}_imports.json` - ImportCollector output (if applicable)
//! - `{name}_annotations.json` - AnnotationCollector output (if applicable)
//! - `{name}_inheritance.json` - InheritanceCollector output (if applicable)
//! - `{name}_method_calls.json` - MethodCallCollector output (if applicable)
//! - `{name}_dynamic.json` - DynamicPatternDetector output (if applicable)

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use tugtool_cst::{
    parse_module,
    visitor::{
        AnnotationCollector, BindingCollector, DynamicPatternDetector, ImportCollector,
        InheritanceCollector, MethodCallCollector, ReferenceCollector, ScopeCollector,
        TypeInferenceCollector,
    },
};

// =============================================================================
// Serializable Output Types
// =============================================================================

/// Serializable scope info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenScope {
    id: String,
    kind: String,
    name: Option<String>,
    parent: Option<String>,
    span: Option<(u64, u64)>,
    globals: Vec<String>,
    nonlocals: Vec<String>,
}

/// Serializable binding info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenBinding {
    name: String,
    kind: String,
    scope_path: Vec<String>,
    span: Option<(u64, u64)>,
}

/// Serializable reference info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenReference {
    kind: String,
    span: Option<(u64, u64)>,
}

/// Serializable import info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenImport {
    kind: String,
    module: String,
    alias: Option<String>,
    names: Option<Vec<GoldenImportedName>>,
    is_star: bool,
    relative_level: usize,
    span: Option<(u64, u64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenImportedName {
    name: String,
    alias: Option<String>,
}

/// Serializable annotation info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenAnnotation {
    name: String,
    type_str: String,
    annotation_kind: String,
    source_kind: String,
    scope_path: Vec<String>,
    span: Option<(u64, u64)>,
}

/// Serializable inheritance info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenInheritance {
    name: String,
    bases: Vec<String>,
    scope_path: Vec<String>,
    span: Option<(u64, u64)>,
}

/// Serializable method call info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenMethodCall {
    receiver: String,
    method: String,
    scope_path: Vec<String>,
    method_span: Option<(u64, u64)>,
}

/// Serializable type inference info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenTypeInference {
    target: String,
    type_source: String,
    inferred_type: Option<String>,
    rhs_name: Option<String>,
    callee_name: Option<String>,
    scope_path: Vec<String>,
    span: Option<(u64, u64)>,
}

/// Serializable dynamic pattern info for golden file comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct GoldenDynamicPattern {
    kind: String,
    description: String,
    attribute_name: Option<String>,
    scope_path: Vec<String>,
    span: Option<(u64, u64)>,
}

// =============================================================================
// Test Infrastructure
// =============================================================================

/// Directory containing Python test fixtures.
fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("golden")
        .join("python")
}

/// Directory containing golden output files.
fn output_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("golden")
        .join("output")
}

/// Check if golden update mode is enabled.
fn update_mode() -> bool {
    std::env::var("TUG_UPDATE_GOLDEN").is_ok()
}

/// Load a Python fixture and return its source code.
fn load_fixture(name: &str) -> String {
    let path = fixtures_dir().join(format!("{}.py", name));
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("Failed to read fixture {}: {}", name, e))
}

/// Compare actual output with golden file, or update golden file in update mode.
fn assert_golden<T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug>(
    fixture_name: &str,
    analysis_type: &str,
    actual: &T,
) {
    let golden_path = output_dir().join(format!("{}_{}.json", fixture_name, analysis_type));

    if update_mode() {
        // Update mode: write actual output to golden file
        fs::create_dir_all(output_dir()).expect("Failed to create output directory");
        let json = serde_json::to_string_pretty(actual).expect("Failed to serialize");
        fs::write(&golden_path, json + "\n").expect("Failed to write golden file");
        eprintln!("Updated golden file: {:?}", golden_path);
    } else {
        // Compare mode: load golden and compare
        let golden_content = fs::read_to_string(&golden_path)
            .unwrap_or_else(|e| panic!("Failed to read golden file {:?}: {}", golden_path, e));
        let expected: T = serde_json::from_str(&golden_content)
            .unwrap_or_else(|e| panic!("Failed to parse golden file {:?}: {}", golden_path, e));

        assert_eq!(
            actual, &expected,
            "Golden test failed for {}_{}",
            fixture_name, analysis_type
        );
    }
}

// =============================================================================
// Analysis Helpers
// =============================================================================

fn analyze_scopes(source: &str) -> Vec<GoldenScope> {
    let module = parse_module(source, None).expect("Failed to parse");
    let scopes = ScopeCollector::collect(&module, source);

    scopes
        .into_iter()
        .map(|s| GoldenScope {
            id: s.id,
            kind: s.kind.as_str().to_string(),
            name: s.name,
            parent: s.parent,
            span: s.span.map(|sp| (sp.start, sp.end)),
            globals: s.globals,
            nonlocals: s.nonlocals,
        })
        .collect()
}

fn analyze_bindings(source: &str) -> Vec<GoldenBinding> {
    let module = parse_module(source, None).expect("Failed to parse");
    let bindings = BindingCollector::collect(&module, source);

    bindings
        .into_iter()
        .map(|b| GoldenBinding {
            name: b.name,
            kind: b.kind.as_str().to_string(),
            scope_path: b.scope_path,
            span: b.span.map(|sp| (sp.start, sp.end)),
        })
        .collect()
}

fn analyze_references(source: &str) -> BTreeMap<String, Vec<GoldenReference>> {
    let module = parse_module(source, None).expect("Failed to parse");
    let collector = ReferenceCollector::collect(&module, source);

    collector
        .all_references()
        .iter()
        .map(|(name, refs)| {
            let golden_refs: Vec<_> = refs
                .iter()
                .map(|r| GoldenReference {
                    kind: r.kind.as_str().to_string(),
                    span: r.span.map(|sp| (sp.start, sp.end)),
                })
                .collect();
            (name.clone(), golden_refs)
        })
        .collect()
}

fn analyze_imports(source: &str) -> Vec<GoldenImport> {
    let module = parse_module(source, None).expect("Failed to parse");
    let imports = ImportCollector::collect(&module, source);

    imports
        .into_iter()
        .map(|i| GoldenImport {
            kind: i.kind.as_str().to_string(),
            module: i.module,
            alias: i.alias,
            names: i.names.map(|names| {
                names
                    .into_iter()
                    .map(|n| GoldenImportedName {
                        name: n.name,
                        alias: n.alias,
                    })
                    .collect()
            }),
            is_star: i.is_star,
            relative_level: i.relative_level,
            span: i.span.map(|sp| (sp.start, sp.end)),
        })
        .collect()
}

fn analyze_annotations(source: &str) -> Vec<GoldenAnnotation> {
    let module = parse_module(source, None).expect("Failed to parse");
    let annotations = AnnotationCollector::collect(&module, source);

    annotations
        .into_iter()
        .map(|a| GoldenAnnotation {
            name: a.name,
            type_str: a.type_str,
            annotation_kind: a.annotation_kind.as_str().to_string(),
            source_kind: a.source_kind.as_str().to_string(),
            scope_path: a.scope_path,
            span: a.span.map(|sp| (sp.start, sp.end)),
        })
        .collect()
}

fn analyze_inheritance(source: &str) -> Vec<GoldenInheritance> {
    let module = parse_module(source, None).expect("Failed to parse");
    let classes = InheritanceCollector::collect(&module, source);

    classes
        .into_iter()
        .map(|c| GoldenInheritance {
            name: c.name,
            bases: c.bases,
            scope_path: c.scope_path,
            span: c.span.map(|sp| (sp.start, sp.end)),
        })
        .collect()
}

fn analyze_method_calls(source: &str) -> Vec<GoldenMethodCall> {
    let module = parse_module(source, None).expect("Failed to parse");
    let calls = MethodCallCollector::collect(&module, source);

    calls
        .into_iter()
        .map(|c| GoldenMethodCall {
            receiver: c.receiver,
            method: c.method,
            scope_path: c.scope_path,
            method_span: c.method_span.map(|sp| (sp.start, sp.end)),
        })
        .collect()
}

fn analyze_type_inference(source: &str) -> Vec<GoldenTypeInference> {
    let module = parse_module(source, None).expect("Failed to parse");
    let inferences = TypeInferenceCollector::collect(&module, source);

    inferences
        .into_iter()
        .map(|t| GoldenTypeInference {
            target: t.target,
            type_source: t.type_source.as_str().to_string(),
            inferred_type: t.inferred_type,
            rhs_name: t.rhs_name,
            callee_name: t.callee_name,
            scope_path: t.scope_path,
            span: t.span.map(|sp| (sp.start, sp.end)),
        })
        .collect()
}

fn analyze_dynamic_patterns(source: &str) -> Vec<GoldenDynamicPattern> {
    let module = parse_module(source, None).expect("Failed to parse");
    let patterns = DynamicPatternDetector::collect(&module, source);

    patterns
        .into_iter()
        .map(|p| GoldenDynamicPattern {
            kind: p.kind.as_str().to_string(),
            description: p.description,
            attribute_name: p.attribute_name,
            scope_path: p.scope_path,
            span: p.span.map(|sp| (sp.start, sp.end)),
        })
        .collect()
}

// =============================================================================
// Golden Tests: Simple Function
// =============================================================================

#[test]
fn golden_simple_function_scopes() {
    let source = load_fixture("simple_function");
    let scopes = analyze_scopes(&source);
    assert_golden("simple_function", "scopes", &scopes);
}

#[test]
fn golden_simple_function_bindings() {
    let source = load_fixture("simple_function");
    let bindings = analyze_bindings(&source);
    assert_golden("simple_function", "bindings", &bindings);
}

#[test]
fn golden_simple_function_references() {
    let source = load_fixture("simple_function");
    let references = analyze_references(&source);
    assert_golden("simple_function", "references", &references);
}

// =============================================================================
// Golden Tests: Class with Inheritance
// =============================================================================

#[test]
fn golden_class_with_inheritance_scopes() {
    let source = load_fixture("class_with_inheritance");
    let scopes = analyze_scopes(&source);
    assert_golden("class_with_inheritance", "scopes", &scopes);
}

#[test]
fn golden_class_with_inheritance_bindings() {
    let source = load_fixture("class_with_inheritance");
    let bindings = analyze_bindings(&source);
    assert_golden("class_with_inheritance", "bindings", &bindings);
}

#[test]
fn golden_class_with_inheritance_references() {
    let source = load_fixture("class_with_inheritance");
    let references = analyze_references(&source);
    assert_golden("class_with_inheritance", "references", &references);
}

#[test]
fn golden_class_with_inheritance_inheritance() {
    let source = load_fixture("class_with_inheritance");
    let inheritance = analyze_inheritance(&source);
    assert_golden("class_with_inheritance", "inheritance", &inheritance);
}

#[test]
fn golden_class_with_inheritance_method_calls() {
    let source = load_fixture("class_with_inheritance");
    let calls = analyze_method_calls(&source);
    assert_golden("class_with_inheritance", "method_calls", &calls);
}

// =============================================================================
// Golden Tests: Nested Scopes
// =============================================================================

#[test]
fn golden_nested_scopes_scopes() {
    let source = load_fixture("nested_scopes");
    let scopes = analyze_scopes(&source);
    assert_golden("nested_scopes", "scopes", &scopes);
}

#[test]
fn golden_nested_scopes_bindings() {
    let source = load_fixture("nested_scopes");
    let bindings = analyze_bindings(&source);
    assert_golden("nested_scopes", "bindings", &bindings);
}

#[test]
fn golden_nested_scopes_references() {
    let source = load_fixture("nested_scopes");
    let references = analyze_references(&source);
    assert_golden("nested_scopes", "references", &references);
}

// =============================================================================
// Golden Tests: Comprehensions
// =============================================================================

#[test]
fn golden_comprehensions_scopes() {
    let source = load_fixture("comprehensions");
    let scopes = analyze_scopes(&source);
    assert_golden("comprehensions", "scopes", &scopes);
}

#[test]
fn golden_comprehensions_bindings() {
    let source = load_fixture("comprehensions");
    let bindings = analyze_bindings(&source);
    assert_golden("comprehensions", "bindings", &bindings);
}

#[test]
fn golden_comprehensions_references() {
    let source = load_fixture("comprehensions");
    let references = analyze_references(&source);
    assert_golden("comprehensions", "references", &references);
}

// =============================================================================
// Golden Tests: Type Annotations
// =============================================================================

#[test]
fn golden_type_annotations_scopes() {
    let source = load_fixture("type_annotations");
    let scopes = analyze_scopes(&source);
    assert_golden("type_annotations", "scopes", &scopes);
}

#[test]
fn golden_type_annotations_bindings() {
    let source = load_fixture("type_annotations");
    let bindings = analyze_bindings(&source);
    assert_golden("type_annotations", "bindings", &bindings);
}

#[test]
fn golden_type_annotations_references() {
    let source = load_fixture("type_annotations");
    let references = analyze_references(&source);
    assert_golden("type_annotations", "references", &references);
}

#[test]
fn golden_type_annotations_annotations() {
    let source = load_fixture("type_annotations");
    let annotations = analyze_annotations(&source);
    assert_golden("type_annotations", "annotations", &annotations);
}

// =============================================================================
// Golden Tests: Imports
// =============================================================================

#[test]
fn golden_imports_scopes() {
    let source = load_fixture("imports");
    let scopes = analyze_scopes(&source);
    assert_golden("imports", "scopes", &scopes);
}

#[test]
fn golden_imports_bindings() {
    let source = load_fixture("imports");
    let bindings = analyze_bindings(&source);
    assert_golden("imports", "bindings", &bindings);
}

#[test]
fn golden_imports_references() {
    let source = load_fixture("imports");
    let references = analyze_references(&source);
    assert_golden("imports", "references", &references);
}

#[test]
fn golden_imports_imports() {
    let source = load_fixture("imports");
    let imports = analyze_imports(&source);
    assert_golden("imports", "imports", &imports);
}

// =============================================================================
// Golden Tests: Method Calls
// =============================================================================

#[test]
fn golden_method_calls_scopes() {
    let source = load_fixture("method_calls");
    let scopes = analyze_scopes(&source);
    assert_golden("method_calls", "scopes", &scopes);
}

#[test]
fn golden_method_calls_bindings() {
    let source = load_fixture("method_calls");
    let bindings = analyze_bindings(&source);
    assert_golden("method_calls", "bindings", &bindings);
}

#[test]
fn golden_method_calls_references() {
    let source = load_fixture("method_calls");
    let references = analyze_references(&source);
    assert_golden("method_calls", "references", &references);
}

#[test]
fn golden_method_calls_method_calls() {
    let source = load_fixture("method_calls");
    let calls = analyze_method_calls(&source);
    assert_golden("method_calls", "method_calls", &calls);
}

// =============================================================================
// Golden Tests: Dynamic Patterns
// =============================================================================

#[test]
fn golden_dynamic_patterns_scopes() {
    let source = load_fixture("dynamic_patterns");
    let scopes = analyze_scopes(&source);
    assert_golden("dynamic_patterns", "scopes", &scopes);
}

#[test]
fn golden_dynamic_patterns_bindings() {
    let source = load_fixture("dynamic_patterns");
    let bindings = analyze_bindings(&source);
    assert_golden("dynamic_patterns", "bindings", &bindings);
}

#[test]
fn golden_dynamic_patterns_references() {
    let source = load_fixture("dynamic_patterns");
    let references = analyze_references(&source);
    assert_golden("dynamic_patterns", "references", &references);
}

#[test]
fn golden_dynamic_patterns_dynamic() {
    let source = load_fixture("dynamic_patterns");
    let patterns = analyze_dynamic_patterns(&source);
    assert_golden("dynamic_patterns", "dynamic", &patterns);
}

// =============================================================================
// Golden Tests: Global/Nonlocal
// =============================================================================

#[test]
fn golden_global_nonlocal_scopes() {
    let source = load_fixture("global_nonlocal");
    let scopes = analyze_scopes(&source);
    assert_golden("global_nonlocal", "scopes", &scopes);
}

#[test]
fn golden_global_nonlocal_bindings() {
    let source = load_fixture("global_nonlocal");
    let bindings = analyze_bindings(&source);
    assert_golden("global_nonlocal", "bindings", &bindings);
}

#[test]
fn golden_global_nonlocal_references() {
    let source = load_fixture("global_nonlocal");
    let references = analyze_references(&source);
    assert_golden("global_nonlocal", "references", &references);
}

// =============================================================================
// Golden Tests: Lambdas
// =============================================================================

#[test]
fn golden_lambdas_scopes() {
    let source = load_fixture("lambdas");
    let scopes = analyze_scopes(&source);
    assert_golden("lambdas", "scopes", &scopes);
}

#[test]
fn golden_lambdas_bindings() {
    let source = load_fixture("lambdas");
    let bindings = analyze_bindings(&source);
    assert_golden("lambdas", "bindings", &bindings);
}

#[test]
fn golden_lambdas_references() {
    let source = load_fixture("lambdas");
    let references = analyze_references(&source);
    assert_golden("lambdas", "references", &references);
}

#[test]
fn golden_lambdas_type_inference() {
    let source = load_fixture("lambdas");
    let inferences = analyze_type_inference(&source);
    assert_golden("lambdas", "type_inference", &inferences);
}
