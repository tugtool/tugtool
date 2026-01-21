// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! CST Bridge: Native Rust analysis using tugtool-python-cst.
//!
//! This module provides the bridge between the native Rust CST parser (tugtool-python-cst)
//! and the tugtool analysis infrastructure.
//!
//! # Architecture
//!
//! The bridge provides two main functions:
//! - [`parse_and_analyze`]: Parse Python source and collect analysis data (scopes, bindings, references)
//! - [`rewrite_batch`]: Apply batch rename operations to source code
//!
//! These functions produce output compatible with the shared types, allowing
//! seamless integration with the rest of the analyzer infrastructure.

use thiserror::Error;
use tugtool_python_cst::{
    parse_module_with_positions, prettify_error,
    // P0 visitors
    BindingCollector, BindingInfo as CstBindingInfo, BindingKind as CstBindingKind,
    ReferenceCollector, ReferenceInfo as CstReferenceInfo, ReferenceKind as CstReferenceKind,
    RenameError, RenameRequest, RenameTransformer, ScopeCollector,
    ScopeInfo as CstScopeInfo, ScopeKind as CstScopeKind,
    // P1 visitors
    AnnotationCollector, AnnotationInfo as CstAnnotationInfo,
    ImportCollector, ImportInfo as CstImportInfo,
    InheritanceCollector, ClassInheritanceInfo as CstClassInheritanceInfo,
    MethodCallCollector, MethodCallInfo as CstMethodCallInfo,
    TypeInferenceCollector, AssignmentInfo as CstAssignmentInfo,
    // P2 visitors
    DynamicPatternDetector, DynamicPatternInfo as CstDynamicPatternInfo,
};
use tugtool_core::patch::Span;

use crate::types::{BindingInfo, ReferenceInfo, ScopeInfo, ScopeSpanInfo, SpanInfo};

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during native CST operations.
#[derive(Debug, Error)]
pub enum CstBridgeError {
    /// Parse error from tugtool-python-cst.
    #[error("parse error: {message}")]
    ParseError { message: String },

    /// Rename error from tugtool-python-cst.
    #[error("rename error: {0}")]
    RenameError(String),
}

impl From<RenameError> for CstBridgeError {
    fn from(err: RenameError) -> Self {
        CstBridgeError::RenameError(err.to_string())
    }
}

/// Result type for CST bridge operations.
pub type CstBridgeResult<T> = Result<T, CstBridgeError>;

// ============================================================================
// Analysis Result
// ============================================================================

/// Result of native CST analysis.
///
/// Contains all the analysis data collected from parsing and traversing
/// the CST with the native Rust visitors.
#[derive(Debug)]
pub struct NativeAnalysisResult {
    // P0 analysis (core functionality)
    /// Scopes in the file.
    pub scopes: Vec<ScopeInfo>,
    /// Bindings (name definitions) in the file.
    pub bindings: Vec<BindingInfo>,
    /// References organized by name.
    pub references: Vec<(String, Vec<ReferenceInfo>)>,

    // P1 analysis (extended analysis)
    /// Import statements in the file.
    pub imports: Vec<CstImportInfo>,
    /// Type annotations in the file.
    pub annotations: Vec<CstAnnotationInfo>,
    /// Assignment patterns for type inference.
    pub assignments: Vec<CstAssignmentInfo>,
    /// Class inheritance information.
    pub class_inheritance: Vec<CstClassInheritanceInfo>,
    /// Method call patterns (obj.method()).
    pub method_calls: Vec<CstMethodCallInfo>,

    // P2 analysis (dynamic pattern detection)
    /// Dynamic patterns that may affect rename safety.
    pub dynamic_patterns: Vec<CstDynamicPatternInfo>,
}

// ============================================================================
// Type Conversions
// ============================================================================

/// Convert a tugtool_core Span to SpanInfo.
fn span_to_span_info(span: &Span) -> SpanInfo {
    SpanInfo {
        start: span.start as usize,
        end: span.end as usize,
    }
}

/// Convert native ScopeKind to string representation.
fn scope_kind_to_string(kind: CstScopeKind) -> String {
    kind.as_str().to_string()
}

/// Convert native BindingKind to string representation.
fn binding_kind_to_string(kind: CstBindingKind) -> String {
    kind.as_str().to_string()
}

/// Convert native ReferenceKind to string representation.
fn reference_kind_to_string(kind: CstReferenceKind) -> String {
    kind.as_str().to_string()
}

impl From<CstScopeInfo> for ScopeInfo {
    fn from(cst_scope: CstScopeInfo) -> Self {
        // Convert byte span to line/col span if available
        let span = cst_scope.span.as_ref().map(|_s| {
            // For now, we don't have line/col info from the native collector
            // The scope span in the native collector is byte-based.
            // We'll need to compute this from source.
            // For initial implementation, we'll leave this as a placeholder.
            ScopeSpanInfo {
                start_line: 0,
                start_col: 0,
                end_line: None,
                end_col: None,
            }
        });

        ScopeInfo {
            id: cst_scope.id,
            kind: scope_kind_to_string(cst_scope.kind),
            name: cst_scope.name,
            parent: cst_scope.parent,
            span,
            globals: cst_scope.globals,
            nonlocals: cst_scope.nonlocals,
        }
    }
}

impl From<CstBindingInfo> for BindingInfo {
    fn from(cst_binding: CstBindingInfo) -> Self {
        BindingInfo {
            name: cst_binding.name,
            kind: binding_kind_to_string(cst_binding.kind),
            scope_path: cst_binding.scope_path,
            span: cst_binding.span.as_ref().map(span_to_span_info),
            line: None, // Line info not yet computed in native collector
            col: None,
        }
    }
}

impl From<CstReferenceInfo> for ReferenceInfo {
    fn from(cst_ref: CstReferenceInfo) -> Self {
        ReferenceInfo {
            kind: reference_kind_to_string(cst_ref.kind),
            span: cst_ref.span.as_ref().map(span_to_span_info),
            line: None, // Line info not yet computed in native collector
            col: None,
        }
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Parse Python source and collect analysis data using native Rust visitors.
///
/// This function performs a complete analysis pass:
/// 1. Parse the source code into a CST
/// 2. Collect scopes using ScopeCollector
/// 3. Collect bindings using BindingCollector
/// 4. Collect references using ReferenceCollector
///
/// # Arguments
///
/// * `source` - The Python source code to analyze
///
/// # Returns
///
/// A [`NativeAnalysisResult`] containing scopes, bindings, and references,
/// or an error if parsing fails.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::cst_bridge::parse_and_analyze;
///
/// let source = "def foo():\n    x = 1\n    return x";
/// let result = parse_and_analyze(source)?;
///
/// assert!(!result.scopes.is_empty());
/// assert!(!result.bindings.is_empty());
/// ```
pub fn parse_and_analyze(source: &str) -> CstBridgeResult<NativeAnalysisResult> {
    // Parse the source into a CST with position information
    // This provides accurate token-derived spans for all tracked nodes
    let parsed = parse_module_with_positions(source, None).map_err(|e| CstBridgeError::ParseError {
        message: prettify_error(e, "source"),
    })?;

    // P0: Collect scopes (using position-aware parsing)
    let cst_scopes = ScopeCollector::collect_with_positions(&parsed.module, &parsed.positions, source);
    let scopes: Vec<ScopeInfo> = cst_scopes.into_iter().map(|s| s.into()).collect();

    // P0: Collect bindings (using position-aware parsing)
    let cst_bindings = BindingCollector::collect_with_positions(&parsed.module, &parsed.positions);
    let bindings: Vec<BindingInfo> = cst_bindings.into_iter().map(|b| b.into()).collect();

    // P0: Collect references (using position-aware parsing)
    let cst_refs = ReferenceCollector::collect_with_positions(&parsed.module, &parsed.positions);
    let references: Vec<(String, Vec<ReferenceInfo>)> = cst_refs
        .into_iter()
        .map(|(name, refs)| {
            let converted_refs: Vec<ReferenceInfo> =
                refs.into_iter().map(|r| r.into()).collect();
            (name, converted_refs)
        })
        .collect();

    // P1: Collect imports
    let imports = ImportCollector::collect(&parsed.module, source);

    // P1: Collect type annotations
    let annotations = AnnotationCollector::collect(&parsed.module, source);

    // P1: Collect assignment patterns for type inference
    let assignments = TypeInferenceCollector::collect(&parsed.module, source);

    // P1: Collect class inheritance information
    let class_inheritance = InheritanceCollector::collect(&parsed.module, source);

    // P1: Collect method call patterns
    let method_calls = MethodCallCollector::collect(&parsed.module, source);

    // P2: Collect dynamic patterns
    let dynamic_patterns = DynamicPatternDetector::collect(&parsed.module, source);

    Ok(NativeAnalysisResult {
        // P0
        scopes,
        bindings,
        references,
        // P1
        imports,
        annotations,
        assignments,
        class_inheritance,
        method_calls,
        // P2
        dynamic_patterns,
    })
}

/// Apply batch rename operations to source code using native Rust transformer.
///
/// This function takes a list of rename requests (spans + new names) and
/// applies them to the source code, returning the modified source.
///
/// # Arguments
///
/// * `source` - The original Python source code
/// * `rewrites` - List of (span, new_name) tuples specifying renames
///
/// # Returns
///
/// The transformed source code with all renames applied, or an error if
/// validation fails (overlapping spans, out of bounds, etc.).
///
/// # Example
///
/// ```ignore
/// use tugtool_python::cst_bridge::rewrite_batch;
/// use tugtool_core::patch::Span;
///
/// let source = "def foo():\n    return foo";
/// let rewrites = vec![
///     (Span::new(4, 7), "bar".to_string()),
///     (Span::new(22, 25), "bar".to_string()),
/// ];
///
/// let result = rewrite_batch(source, &rewrites)?;
/// assert_eq!(result, "def bar():\n    return bar");
/// ```
pub fn rewrite_batch(source: &str, rewrites: &[(Span, String)]) -> CstBridgeResult<String> {
    if rewrites.is_empty() {
        // No changes needed - return source unchanged
        return Ok(source.to_string());
    }

    // Convert to RenameRequest format
    let requests: Vec<RenameRequest> = rewrites
        .iter()
        .map(|(span, new_name)| RenameRequest::new(*span, new_name.clone()))
        .collect();

    // Apply the renames
    let transformer = RenameTransformer::new(source, requests);
    let result = transformer.apply()?;

    Ok(result)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_and_analyze_simple_function() {
        let source = "def foo():\n    x = 1\n    return x";
        let result = parse_and_analyze(source).expect("parse should succeed");

        // Check scopes
        assert!(result.scopes.len() >= 2, "should have module and function scopes");
        let module_scope = result.scopes.iter().find(|s| s.kind == "module");
        assert!(module_scope.is_some(), "should have module scope");

        let fn_scope = result.scopes.iter().find(|s| s.kind == "function");
        assert!(fn_scope.is_some(), "should have function scope");
        assert_eq!(fn_scope.unwrap().name.as_deref(), Some("foo"));

        // Check bindings
        let foo_binding = result.bindings.iter().find(|b| b.name == "foo");
        assert!(foo_binding.is_some(), "should have foo binding");
        assert_eq!(foo_binding.unwrap().kind, "function");

        let x_binding = result.bindings.iter().find(|b| b.name == "x");
        assert!(x_binding.is_some(), "should have x binding");
        assert_eq!(x_binding.unwrap().kind, "variable");

        // Check references
        let foo_refs = result.references.iter().find(|(name, _)| name == "foo");
        assert!(foo_refs.is_some(), "should have references to foo");

        let x_refs = result.references.iter().find(|(name, _)| name == "x");
        assert!(x_refs.is_some(), "should have references to x");
    }

    #[test]
    fn test_parse_and_analyze_class() {
        let source = "class MyClass:\n    def method(self):\n        pass";
        let result = parse_and_analyze(source).expect("parse should succeed");

        // Check scopes
        let class_scope = result.scopes.iter().find(|s| s.kind == "class");
        assert!(class_scope.is_some(), "should have class scope");
        assert_eq!(class_scope.unwrap().name.as_deref(), Some("MyClass"));

        // Check bindings
        let class_binding = result.bindings.iter().find(|b| b.name == "MyClass");
        assert!(class_binding.is_some(), "should have MyClass binding");
        assert_eq!(class_binding.unwrap().kind, "class");

        let method_binding = result.bindings.iter().find(|b| b.name == "method");
        assert!(method_binding.is_some(), "should have method binding");
        assert_eq!(method_binding.unwrap().kind, "function");
    }

    #[test]
    fn test_parse_and_analyze_imports() {
        let source = "import os\nfrom sys import path";
        let result = parse_and_analyze(source).expect("parse should succeed");

        // Check bindings
        let os_binding = result.bindings.iter().find(|b| b.name == "os");
        assert!(os_binding.is_some(), "should have os binding");
        assert_eq!(os_binding.unwrap().kind, "import");

        let path_binding = result.bindings.iter().find(|b| b.name == "path");
        assert!(path_binding.is_some(), "should have path binding");
    }

    #[test]
    fn test_parse_error() {
        let source = "def foo(\n"; // Invalid syntax
        let result = parse_and_analyze(source);
        assert!(result.is_err(), "should return parse error");
    }

    #[test]
    fn test_rewrite_batch_single_rename() {
        let source = "def foo():\n    return foo";
        let rewrites = vec![
            (Span::new(4, 7), "bar".to_string()),
            (Span::new(22, 25), "bar".to_string()),
        ];

        let result = rewrite_batch(source, &rewrites).expect("rewrite should succeed");
        assert_eq!(result, "def bar():\n    return bar");
    }

    #[test]
    fn test_rewrite_batch_empty() {
        let source = "def foo(): pass";
        let rewrites: Vec<(Span, String)> = vec![];

        let result = rewrite_batch(source, &rewrites).expect("rewrite should succeed");
        assert_eq!(result, source, "empty rewrites should return unchanged source");
    }

    #[test]
    fn test_rewrite_batch_multiple_renames() {
        let source = "x = 1\ny = x";
        let rewrites = vec![
            (Span::new(0, 1), "a".to_string()), // x -> a
            (Span::new(10, 11), "a".to_string()), // x -> a
        ];

        let result = rewrite_batch(source, &rewrites).expect("rewrite should succeed");
        assert_eq!(result, "a = 1\ny = a");
    }

    #[test]
    fn test_rewrite_batch_out_of_bounds() {
        let source = "x = 1";
        let rewrites = vec![(Span::new(100, 105), "a".to_string())];

        let result = rewrite_batch(source, &rewrites);
        assert!(result.is_err(), "should return error for out of bounds span");
    }

    #[test]
    fn test_scope_kind_conversion() {
        assert_eq!(scope_kind_to_string(CstScopeKind::Module), "module");
        assert_eq!(scope_kind_to_string(CstScopeKind::Class), "class");
        assert_eq!(scope_kind_to_string(CstScopeKind::Function), "function");
        assert_eq!(scope_kind_to_string(CstScopeKind::Lambda), "lambda");
        assert_eq!(scope_kind_to_string(CstScopeKind::Comprehension), "comprehension");
    }

    #[test]
    fn test_binding_kind_conversion() {
        assert_eq!(binding_kind_to_string(CstBindingKind::Function), "function");
        assert_eq!(binding_kind_to_string(CstBindingKind::Class), "class");
        assert_eq!(binding_kind_to_string(CstBindingKind::Parameter), "parameter");
        assert_eq!(binding_kind_to_string(CstBindingKind::Variable), "variable");
        assert_eq!(binding_kind_to_string(CstBindingKind::Import), "import");
        assert_eq!(binding_kind_to_string(CstBindingKind::ImportAlias), "import_alias");
    }

    #[test]
    fn test_reference_kind_conversion() {
        assert_eq!(reference_kind_to_string(CstReferenceKind::Definition), "definition");
        assert_eq!(reference_kind_to_string(CstReferenceKind::Reference), "reference");
        assert_eq!(reference_kind_to_string(CstReferenceKind::Call), "call");
        assert_eq!(reference_kind_to_string(CstReferenceKind::Attribute), "attribute");
        assert_eq!(reference_kind_to_string(CstReferenceKind::Import), "import");
    }

    // ========================================================================
    // P1 Collector Tests
    // ========================================================================

    #[test]
    fn test_p1_imports_collected() {
        let source = "import os\nfrom sys import path\nfrom . import local";
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert!(!result.imports.is_empty(), "should have imports");
        assert!(result.imports.len() >= 2, "should have at least 2 imports");
    }

    #[test]
    fn test_p1_annotations_collected() {
        let source = "def foo(x: int) -> str:\n    y: float = 1.0\n    return str(y)";
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert!(!result.annotations.is_empty(), "should have annotations");
        // Parameter annotation (x: int), return annotation (-> str), variable annotation (y: float)
        assert!(result.annotations.len() >= 3, "should have at least 3 annotations");
    }

    #[test]
    fn test_p1_assignments_collected() {
        let source = "x = MyClass()\ny = x\nz = func()";
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert!(!result.assignments.is_empty(), "should have assignments");
        assert_eq!(result.assignments.len(), 3, "should have 3 assignments");
    }

    #[test]
    fn test_p1_class_inheritance_collected() {
        let source = "class Parent:\n    pass\n\nclass Child(Parent):\n    pass";
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert!(!result.class_inheritance.is_empty(), "should have class inheritance info");
        assert_eq!(result.class_inheritance.len(), 2, "should have 2 classes");

        let child = result.class_inheritance.iter().find(|c| c.name == "Child");
        assert!(child.is_some(), "should have Child class");
        assert_eq!(child.unwrap().bases, vec!["Parent"]);
    }

    #[test]
    fn test_p1_method_calls_collected() {
        let source = "handler = Handler()\nhandler.process()\nhandler.save()";
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert!(!result.method_calls.is_empty(), "should have method calls");
        assert_eq!(result.method_calls.len(), 2, "should have 2 method calls");
        assert_eq!(result.method_calls[0].receiver, "handler");
        assert_eq!(result.method_calls[0].method, "process");
        assert_eq!(result.method_calls[1].method, "save");
    }

    #[test]
    fn test_p1_comprehensive_analysis() {
        // A more comprehensive test that exercises all P1 collectors
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
"#;
        let result = parse_and_analyze(source).expect("parse should succeed");

        // P0 assertions
        assert!(!result.scopes.is_empty());
        assert!(!result.bindings.is_empty());
        assert!(!result.references.is_empty());

        // P1 assertions
        assert!(!result.imports.is_empty(), "should have imports (from typing)");
        assert!(!result.annotations.is_empty(), "should have annotations");
        assert!(!result.assignments.is_empty(), "should have assignments");
        assert!(!result.class_inheritance.is_empty(), "should have class inheritance");
        assert!(!result.method_calls.is_empty(), "should have method calls");

        // Verify inheritance relationship
        let json_handler = result.class_inheritance.iter()
            .find(|c| c.name == "JsonHandler");
        assert!(json_handler.is_some());
        assert!(json_handler.unwrap().bases.contains(&"BaseHandler".to_string()));
    }

    // ========================================================================
    // P2 Collector Tests
    // ========================================================================

    #[test]
    fn test_p2_dynamic_patterns_collected() {
        let source = r#"
x = getattr(obj, 'foo')
setattr(obj, 'bar', value)
result = eval('1 + 2')
"#;
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert!(!result.dynamic_patterns.is_empty(), "should have dynamic patterns");
        assert_eq!(result.dynamic_patterns.len(), 3, "should have 3 dynamic patterns");
    }

    #[test]
    fn test_p2_magic_methods_detected() {
        let source = r#"
class Proxy:
    def __getattr__(self, name):
        return getattr(self._target, name)

    def __setattr__(self, name, value):
        setattr(self._target, name, value)
"#;
        let result = parse_and_analyze(source).expect("parse should succeed");

        // Should detect: __getattr__, getattr, __setattr__, setattr
        assert_eq!(result.dynamic_patterns.len(), 4, "should have 4 dynamic patterns");
    }

    #[test]
    fn test_p2_namespace_manipulation() {
        let source = r#"
x = globals()['name']
y = locals()['name']
"#;
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert_eq!(result.dynamic_patterns.len(), 2, "should have 2 dynamic patterns");
    }

    #[test]
    fn test_p2_comprehensive_analysis() {
        // A more comprehensive test that exercises all P2 patterns
        let source = r#"from typing import List

class DynamicClass:
    def __getattr__(self, name):
        return None

def dynamic_operations():
    x = getattr(obj, 'foo')
    setattr(obj, 'bar', value)
    result = eval('code')
    exec('more code')
    g = globals()['name']
"#;
        let result = parse_and_analyze(source).expect("parse should succeed");

        // P0/P1 assertions still hold
        assert!(!result.scopes.is_empty());
        assert!(!result.bindings.is_empty());
        assert!(!result.imports.is_empty());

        // P2 assertions
        assert!(!result.dynamic_patterns.is_empty(), "should have dynamic patterns");
        // __getattr__, getattr, setattr, eval, exec, globals[]
        assert!(result.dynamic_patterns.len() >= 6, "should have at least 6 dynamic patterns");
    }
}
