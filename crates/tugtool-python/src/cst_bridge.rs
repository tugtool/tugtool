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
use tugtool_core::patch::Span;
use tugtool_python_cst::{
    parse_module_with_positions,
    prettify_error,
    // P1 visitors
    AnnotationCollector,
    AnnotationInfo as CstAnnotationInfo,
    AssignmentInfo as CstAssignmentInfo,
    AttributeAccessCollector,
    AttributeAccessInfo as CstAttributeAccessInfo,
    // P0 visitors
    BatchEditError,
    BatchEditOptions,
    BatchSpanEditor,
    BindingCollector,
    BindingInfo as CstBindingInfo,
    BindingKind as CstBindingKind,
    CallSiteCollector,
    CallSiteInfo as CstCallSiteInfo,
    ClassInheritanceInfo as CstClassInheritanceInfo,
    // P2 visitors
    DynamicPatternDetector,
    DynamicPatternInfo as CstDynamicPatternInfo,
    EditPrimitive,
    // Export collector for __all__ handling
    ExportCollector,
    ExportInfo as CstExportInfo,
    ImportCollector,
    ImportInfo as CstImportInfo,
    InheritanceCollector,
    // isinstance type narrowing
    IsInstanceCheck as CstIsInstanceCheck,
    IsInstanceCollector,
    CstReferenceRecord,
    ReferenceCollector,
    ReferenceKind as CstReferenceKind,
    // Legacy rename types (kept for rewrite_batch compatibility)
    RenameError,
    RenameRequest,
    RenameTransformer,
    ScopeCollector,
    ScopeInfo as CstScopeInfo,
    ScopeKind as CstScopeKind,
    SignatureCollector,
    SignatureInfo as CstSignatureInfo,
    TypeInferenceCollector,
};

use crate::types::{BindingInfo, ParsedReferenceInfo, ScopeInfo, ScopeSpanInfo, SpanInfo};

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

    /// Batch edit error from BatchSpanEditor.
    #[error("batch edit error: {0}")]
    BatchEditError(String),
}

impl From<RenameError> for CstBridgeError {
    fn from(err: RenameError) -> Self {
        CstBridgeError::RenameError(err.to_string())
    }
}

impl From<BatchEditError> for CstBridgeError {
    fn from(err: BatchEditError) -> Self {
        CstBridgeError::BatchEditError(err.to_string())
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
    pub references: Vec<(String, Vec<ParsedReferenceInfo>)>,
    /// String literals in __all__ exports.
    pub exports: Vec<CstExportInfo>,

    // P1 analysis (extended analysis)
    /// Import statements in the file.
    pub imports: Vec<CstImportInfo>,
    /// Type annotations in the file.
    pub annotations: Vec<CstAnnotationInfo>,
    /// Assignment patterns for type inference.
    pub assignments: Vec<CstAssignmentInfo>,
    /// Class inheritance information.
    pub class_inheritance: Vec<CstClassInheritanceInfo>,
    /// Function/method signatures with parameters, modifiers, and type params.
    pub signatures: Vec<CstSignatureInfo>,
    /// Attribute access patterns (obj.attr with Read/Write/Call context).
    pub attribute_accesses: Vec<CstAttributeAccessInfo>,
    /// Call sites with argument information.
    pub call_sites: Vec<CstCallSiteInfo>,

    // P2 analysis (dynamic pattern detection)
    /// Dynamic patterns that may affect rename safety.
    pub dynamic_patterns: Vec<CstDynamicPatternInfo>,

    // isinstance checks for type narrowing
    /// isinstance checks detected in conditional expressions.
    pub isinstance_checks: Vec<CstIsInstanceCheck>,
}

// ============================================================================
// Type Conversions
// ============================================================================

/// Convert a tugtool_core Span to SpanInfo.
fn span_to_span_info(span: &Span) -> SpanInfo {
    SpanInfo {
        start: span.start,
        end: span.end,
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

        // Preserve byte span for CoreScopeInfo construction in analyzer
        let byte_span = cst_scope.span.as_ref().map(|s| SpanInfo {
            start: s.start,
            end: s.end,
        });

        ScopeInfo {
            id: cst_scope.id,
            kind: scope_kind_to_string(cst_scope.kind),
            name: cst_scope.name,
            parent: cst_scope.parent,
            span,
            byte_span,
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

impl From<CstReferenceRecord> for ParsedReferenceInfo {
    fn from(cst_ref: CstReferenceRecord) -> Self {
        ParsedReferenceInfo {
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
    let parsed =
        parse_module_with_positions(source, None).map_err(|e| CstBridgeError::ParseError {
            message: prettify_error(e, "source"),
        })?;

    // P0: Collect scopes
    let cst_scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);
    let scopes: Vec<ScopeInfo> = cst_scopes.into_iter().map(|s| s.into()).collect();

    // P0: Collect bindings
    let cst_bindings = BindingCollector::collect(&parsed.module, &parsed.positions);
    let bindings: Vec<BindingInfo> = cst_bindings.into_iter().map(|b| b.into()).collect();

    // P0: Collect references
    let cst_refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);
    let references: Vec<(String, Vec<ParsedReferenceInfo>)> = cst_refs
        .into_iter()
        .map(|(name, refs)| {
            let converted_refs: Vec<ParsedReferenceInfo> = refs.into_iter().map(|r| r.into()).collect();
            (name, converted_refs)
        })
        .collect();

    // P0: Collect __all__ exports
    let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

    // P1: Collect imports
    let imports = ImportCollector::collect(&parsed.module);

    // P1: Collect type annotations
    let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

    // P1: Collect assignment patterns for type inference
    let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

    // P1: Collect class inheritance information
    let class_inheritance = InheritanceCollector::collect(&parsed.module, &parsed.positions);

    // P1: Collect function/method signatures
    let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

    // P1: Collect attribute access patterns (obj.attr with Read/Write/Call context)
    let attribute_accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

    // P1: Collect call sites with argument information
    let call_sites = CallSiteCollector::collect(&parsed.module, &parsed.positions);

    // P2: Collect dynamic patterns
    let dynamic_patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

    // Collect isinstance checks for type narrowing
    let isinstance_checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

    Ok(NativeAnalysisResult {
        // P0
        scopes,
        bindings,
        references,
        exports,
        // P1
        imports,
        annotations,
        assignments,
        class_inheritance,
        signatures,
        attribute_accesses,
        call_sites,
        // P2
        dynamic_patterns,
        // Type narrowing
        isinstance_checks,
    })
}

/// Apply batch rename operations to source code using RenameTransformer.
///
/// This function takes a list of rename requests (spans + new names) and
/// applies them to the source code, returning the modified source.
///
/// Note: New code should prefer `apply_batch_edits` which uses the more
/// general `BatchSpanEditor` infrastructure.
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

/// Apply batch edit operations to source code using BatchSpanEditor.
///
/// This function provides a high-level API for applying edit primitives to source
/// code. It wraps `BatchSpanEditor` with sensible defaults for rename operations:
/// - `allow_empty: true` - returns source unchanged if no edits
/// - `allow_adjacent: true` - allows adjacent edits (common in renames)
/// - `auto_indent: false` - Replace edits don't need indentation handling
///
/// # Arguments
///
/// * `source` - The original Python source code
/// * `edits` - List of `EditPrimitive` operations to apply
///
/// # Returns
///
/// The transformed source code with all edits applied, or an error if
/// validation fails (overlapping spans, out of bounds, etc.).
///
/// # Example
///
/// ```ignore
/// use tugtool_python::cst_bridge::apply_batch_edits;
/// use tugtool_python_cst::visitor::EditPrimitive;
/// use tugtool_core::patch::Span;
///
/// let source = "def foo():\n    return foo";
/// let edits = vec![
///     EditPrimitive::Replace {
///         span: Span::new(4, 7),
///         new_text: "bar".to_string(),
///     },
///     EditPrimitive::Replace {
///         span: Span::new(22, 25),
///         new_text: "bar".to_string(),
///     },
/// ];
///
/// let result = apply_batch_edits(source, edits)?;
/// assert_eq!(result, "def bar():\n    return bar");
/// ```
pub fn apply_batch_edits(
    source: &str,
    edits: Vec<EditPrimitive>,
) -> CstBridgeResult<String> {
    if edits.is_empty() {
        // No changes needed - return source unchanged
        return Ok(source.to_string());
    }

    // Configure BatchSpanEditor with options suitable for rename operations
    let options = BatchEditOptions {
        allow_empty: true,      // Empty edits return source unchanged
        allow_adjacent: true,   // Adjacent edits are common in renames
        auto_indent: false,     // Replace edits don't need indentation
    };

    let mut editor = BatchSpanEditor::with_options(source, options);
    editor.add_all(edits);

    let result = editor.apply()?;
    Ok(result)
}

/// Convert a list of (span, new_text) tuples to EditPrimitive::Replace operations.
///
/// This is a convenience function for migrating from the old `rewrite_batch` API
/// to the new `apply_batch_edits` API.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::cst_bridge::{rewrites_to_edit_primitives, apply_batch_edits};
/// use tugtool_core::patch::Span;
///
/// let rewrites = vec![
///     (Span::new(4, 7), "bar".to_string()),
/// ];
/// let edits = rewrites_to_edit_primitives(&rewrites);
/// let result = apply_batch_edits(source, edits)?;
/// ```
pub fn rewrites_to_edit_primitives(rewrites: &[(Span, String)]) -> Vec<EditPrimitive> {
    rewrites
        .iter()
        .map(|(span, new_text)| EditPrimitive::Replace {
            span: *span,
            new_text: new_text.clone(),
        })
        .collect()
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
        assert!(
            result.scopes.len() >= 2,
            "should have module and function scopes"
        );
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
        assert_eq!(
            result, source,
            "empty rewrites should return unchanged source"
        );
    }

    #[test]
    fn test_rewrite_batch_multiple_renames() {
        let source = "x = 1\ny = x";
        let rewrites = vec![
            (Span::new(0, 1), "a".to_string()),   // x -> a
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
        assert!(
            result.is_err(),
            "should return error for out of bounds span"
        );
    }

    #[test]
    fn test_scope_kind_conversion() {
        assert_eq!(scope_kind_to_string(CstScopeKind::Module), "module");
        assert_eq!(scope_kind_to_string(CstScopeKind::Class), "class");
        assert_eq!(scope_kind_to_string(CstScopeKind::Function), "function");
        assert_eq!(scope_kind_to_string(CstScopeKind::Lambda), "lambda");
        assert_eq!(
            scope_kind_to_string(CstScopeKind::Comprehension),
            "comprehension"
        );
    }

    #[test]
    fn test_binding_kind_conversion() {
        assert_eq!(binding_kind_to_string(CstBindingKind::Function), "function");
        assert_eq!(binding_kind_to_string(CstBindingKind::Class), "class");
        assert_eq!(
            binding_kind_to_string(CstBindingKind::Parameter),
            "parameter"
        );
        assert_eq!(binding_kind_to_string(CstBindingKind::Variable), "variable");
        assert_eq!(binding_kind_to_string(CstBindingKind::Import), "import");
        assert_eq!(
            binding_kind_to_string(CstBindingKind::ImportAlias),
            "import_alias"
        );
    }

    #[test]
    fn test_reference_kind_conversion() {
        assert_eq!(
            reference_kind_to_string(CstReferenceKind::Definition),
            "definition"
        );
        assert_eq!(
            reference_kind_to_string(CstReferenceKind::Reference),
            "reference"
        );
        assert_eq!(reference_kind_to_string(CstReferenceKind::Call), "call");
        assert_eq!(
            reference_kind_to_string(CstReferenceKind::Attribute),
            "attribute"
        );
        assert_eq!(reference_kind_to_string(CstReferenceKind::Import), "import");
    }

    // ========================================================================
    // P0 Export Collector Tests
    // ========================================================================

    #[test]
    fn test_p0_exports_collected() {
        let source = r#"__all__ = ["foo", "bar"]

def foo():
    pass

def bar():
    pass
"#;
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert!(!result.exports.is_empty(), "should have exports");
        assert_eq!(result.exports.len(), 2, "should have 2 exports");
        assert_eq!(result.exports[0].name, "foo");
        assert_eq!(result.exports[1].name, "bar");

        // Verify spans are present
        for export in &result.exports {
            assert!(export.span.is_some(), "export should have span");
            assert!(
                export.content_span.is_some(),
                "export should have content_span"
            );
        }
    }

    #[test]
    fn test_p0_exports_augmented() {
        let source = r#"__all__ = ["foo"]
__all__ += ["bar"]
"#;
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert_eq!(result.exports.len(), 2, "should have 2 exports");
        assert_eq!(result.exports[0].name, "foo");
        assert_eq!(result.exports[1].name, "bar");
    }

    #[test]
    fn test_p0_exports_empty_when_no_all() {
        let source = "def foo(): pass";
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert!(result.exports.is_empty(), "should have no exports");
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
        assert!(
            result.annotations.len() >= 3,
            "should have at least 3 annotations"
        );
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

        assert!(
            !result.class_inheritance.is_empty(),
            "should have class inheritance info"
        );
        assert_eq!(result.class_inheritance.len(), 2, "should have 2 classes");

        let child = result.class_inheritance.iter().find(|c| c.name == "Child");
        assert!(child.is_some(), "should have Child class");
        assert_eq!(child.unwrap().bases, vec!["Parent"]);
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
        assert!(
            !result.imports.is_empty(),
            "should have imports (from typing)"
        );
        assert!(!result.annotations.is_empty(), "should have annotations");
        assert!(!result.assignments.is_empty(), "should have assignments");
        assert!(
            !result.class_inheritance.is_empty(),
            "should have class inheritance"
        );

        // Verify inheritance relationship
        let json_handler = result
            .class_inheritance
            .iter()
            .find(|c| c.name == "JsonHandler");
        assert!(json_handler.is_some());
        assert!(json_handler
            .unwrap()
            .bases
            .contains(&"BaseHandler".to_string()));
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

        assert!(
            !result.dynamic_patterns.is_empty(),
            "should have dynamic patterns"
        );
        assert_eq!(
            result.dynamic_patterns.len(),
            3,
            "should have 3 dynamic patterns"
        );
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
        assert_eq!(
            result.dynamic_patterns.len(),
            4,
            "should have 4 dynamic patterns"
        );
    }

    #[test]
    fn test_p2_namespace_manipulation() {
        let source = r#"
x = globals()['name']
y = locals()['name']
"#;
        let result = parse_and_analyze(source).expect("parse should succeed");

        assert_eq!(
            result.dynamic_patterns.len(),
            2,
            "should have 2 dynamic patterns"
        );
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
        assert!(
            !result.dynamic_patterns.is_empty(),
            "should have dynamic patterns"
        );
        // __getattr__, getattr, setattr, eval, exec, globals[]
        assert!(
            result.dynamic_patterns.len() >= 6,
            "should have at least 6 dynamic patterns"
        );
    }

    // ========================================================================
    // Stub (.pyi) Syntax Tests - Phase 11D Step 7
    // ========================================================================

    #[test]
    fn test_stub_parses_ellipsis_body() {
        // Stub syntax: function with ellipsis body
        let source = "def process(data: str) -> int: ...";
        let result = parse_and_analyze(source).expect("stub with ellipsis body should parse");

        // Should have a function binding
        let func = result.bindings.iter().find(|b| b.name == "process");
        assert!(func.is_some(), "should have process function");
        assert_eq!(func.unwrap().kind, "function");

        // Should have return type in signature
        let sig = result.signatures.iter().find(|s| s.name == "process");
        assert!(sig.is_some(), "should have process signature");
        assert_eq!(sig.unwrap().returns.as_deref(), Some("int"));
    }

    #[test]
    fn test_stub_parses_pass_body() {
        // Stub syntax: function with pass body (alternative to ellipsis)
        let source = "def process(data: str) -> int:\n    pass";
        let result = parse_and_analyze(source).expect("stub with pass body should parse");

        let func = result.bindings.iter().find(|b| b.name == "process");
        assert!(func.is_some(), "should have process function");
    }

    #[test]
    fn test_stub_parses_class_with_signatures() {
        // Stub syntax: class with method signatures only
        let source = r#"class Service:
    def process(self, data: str) -> str: ...
    def validate(self, item: Any) -> bool: ...
"#;
        let result = parse_and_analyze(source).expect("stub class should parse");

        // Should have class binding
        let class = result.bindings.iter().find(|b| b.name == "Service");
        assert!(class.is_some(), "should have Service class");
        assert_eq!(class.unwrap().kind, "class");

        // Should have method bindings
        let process = result.bindings.iter().find(|b| b.name == "process");
        assert!(process.is_some(), "should have process method");

        let validate = result.bindings.iter().find(|b| b.name == "validate");
        assert!(validate.is_some(), "should have validate method");

        // Should capture return types in signatures
        let process_sig = result.signatures.iter().find(|s| s.name == "process");
        assert!(process_sig.is_some(), "should have process signature");
        assert_eq!(process_sig.unwrap().returns.as_deref(), Some("str"));
    }

    #[test]
    fn test_stub_parses_class_attribute_annotation() {
        // Stub syntax: class with attribute annotations
        let source = r#"class Config:
    timeout: int
    host: str
"#;
        let result = parse_and_analyze(source).expect("stub with attributes should parse");

        // Should have class
        let class = result.bindings.iter().find(|b| b.name == "Config");
        assert!(class.is_some(), "should have Config class");

        // Should have attribute annotations
        let timeout = result
            .annotations
            .iter()
            .find(|a| a.name == "timeout" && a.type_str == "int");
        assert!(timeout.is_some(), "should have timeout: int annotation");

        let host = result
            .annotations
            .iter()
            .find(|a| a.name == "host" && a.type_str == "str");
        assert!(host.is_some(), "should have host: str annotation");
    }

    #[test]
    fn test_stub_parses_optional_union_types() {
        // Stub syntax: complex type annotations (simple named types per D06)
        let source = r#"def process(data: Optional[str]) -> Union[str, int]: ..."#;
        let result = parse_and_analyze(source).expect("stub with complex types should parse");

        // Parameter annotation
        let param = result.annotations.iter().find(|a| a.name == "data");
        assert!(param.is_some(), "should have data parameter annotation");
        assert_eq!(param.unwrap().type_str, "Optional[str]");

        // Return type in signature
        let sig = result.signatures.iter().find(|s| s.name == "process");
        assert!(sig.is_some(), "should have process signature");
        assert_eq!(sig.unwrap().returns.as_deref(), Some("Union[str, int]"));
    }

    #[test]
    fn test_stub_parses_callable_annotation() {
        // Stub syntax: Callable annotation
        // Note: Complex Callable parameters are simplified to <complex> by the parser,
        // but the Callable structure is preserved
        let source = r#"callback: Callable[[str, int], bool]"#;
        let result = parse_and_analyze(source).expect("stub with Callable should parse");

        let callback = result.annotations.iter().find(|a| a.name == "callback");
        assert!(callback.is_some(), "should have callback annotation");
        // The type_str contains the Callable type (parameters are simplified)
        assert!(
            callback.unwrap().type_str.starts_with("Callable["),
            "should have Callable type annotation"
        );
    }

    #[test]
    fn test_stub_parses_signatures_with_types() {
        // Verify signatures are collected for stub methods
        let source = r#"class Handler:
    def process(self, data: str) -> bool: ...
"#;
        let result = parse_and_analyze(source).expect("stub should parse");

        // Should have signature info
        let sig = result
            .signatures
            .iter()
            .find(|s| s.name == "process" && s.scope_path.contains(&"Handler".to_string()));
        assert!(sig.is_some(), "should have process signature");
        assert_eq!(sig.unwrap().returns.as_deref(), Some("bool"));
    }
}
