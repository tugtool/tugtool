//! Shared data types for Python analysis.
//!
//! This module contains the core data types used throughout tugtool-python
//! for representing analysis results: spans, bindings, references, scopes,
//! imports, type inference, and dynamic patterns.
//!
//! These types are serializable for JSON compatibility and are the canonical
//! representation used by both the analyzer and the CST bridge.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tugtool_core::facts::TypeNode;

// ============================================================================
// Span Information
// ============================================================================

/// Span information representing a byte range in source code.
///
/// Uses `usize` for consistency with `tugtool_core::patch::Span`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpanInfo {
    pub start: usize,
    pub end: usize,
}

/// Scope span information with line/column coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeSpanInfo {
    pub start_line: u32,
    pub start_col: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_col: Option<u32>,
}

// ============================================================================
// Binding Information
// ============================================================================

/// Binding information returned by analysis.
///
/// Represents a name definition (function, class, variable, parameter, import).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BindingInfo {
    pub name: String,
    pub kind: String,
    pub scope_path: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

// ============================================================================
// Reference Information
// ============================================================================

/// Reference information returned by analysis.
///
/// Represents a name usage (read, call, attribute access).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceInfo {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

// ============================================================================
// Scope Information
// ============================================================================

/// Scope information returned by analysis.
///
/// Represents a lexical scope in Python (module, class, function, lambda, comprehension).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopeInfo {
    pub id: String,
    pub kind: String, // "module", "class", "function", "lambda", "comprehension"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<ScopeSpanInfo>,
    /// Byte-offset span for the scope (start, end).
    /// Used internally for CoreScopeInfo construction.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_span: Option<SpanInfo>,
    /// Names declared as `global` in this scope.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub globals: Vec<String>,
    /// Names declared as `nonlocal` in this scope.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nonlocals: Vec<String>,
}

// ============================================================================
// Import Information
// ============================================================================

/// Import information returned by analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportInfo {
    pub kind: String, // "import" or "from"
    pub module: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub names: Option<Vec<ImportedName>>,
    #[serde(default)]
    pub is_star: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// Imported name in a from import.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedName {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
}

// ============================================================================
// Assignment Information (Type Inference Level 1 + Level 3)
// ============================================================================

/// Assignment information with type inference.
///
/// Returned by analysis to track type information from assignments:
/// - `type_source: "constructor"` - RHS is a constructor call (e.g., `x = MyClass()`)
/// - `type_source: "variable"` - RHS is a variable reference (e.g., `y = x`)
/// - `type_source: "function_call"` - RHS is a function call for return type propagation
/// - `type_source: "unknown"` - Type could not be determined
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignmentInfo {
    /// Target variable name.
    pub target: String,
    /// Scope path where assignment occurs (e.g., `["<module>", "MyClass", "method"]`).
    pub scope_path: Vec<String>,
    /// How the type was determined: "constructor", "variable", "function_call", or "unknown".
    pub type_source: String,
    /// Inferred type name (if type_source is "constructor").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inferred_type: Option<String>,
    /// RHS variable name (if type_source is "variable").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rhs_name: Option<String>,
    /// Callee name (if type_source is "function_call" for return type propagation).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callee_name: Option<String>,
    /// Byte span of the target.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
    /// True if this assignment targets `self.attr` or `cls.attr` (instance/class attribute).
    /// Default: false for backward compatibility.
    #[serde(default)]
    pub is_self_attribute: bool,
    /// Attribute name when is_self_attribute is true (e.g., "handler" for `self.handler = ...`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribute_name: Option<String>,
}

// ============================================================================
// Method Call Information
// ============================================================================

/// Method call information for type-based resolution.
///
/// Represents `obj.method()` patterns for type-aware method rename.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MethodCallInfo {
    /// The receiver variable name (e.g., "handler" in "handler.process()").
    pub receiver: String,
    /// The method name being called (e.g., "process").
    pub method: String,
    /// Scope path where the call occurs.
    pub scope_path: Vec<String>,
    /// Byte span of the method name (for renaming).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method_span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

// ============================================================================
// Class Inheritance Information
// ============================================================================

/// Class inheritance information for building the inheritance hierarchy.
///
/// Used to track class definitions and their base classes for method
/// override tracking during rename operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassInheritanceInfo {
    /// The class name.
    pub name: String,
    /// List of base class names (direct parents only).
    #[serde(default)]
    pub bases: Vec<String>,
    /// Scope path where the class is defined.
    #[serde(default)]
    pub scope_path: Vec<String>,
    /// Byte span of the class name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

// ============================================================================
// Annotation Information (Type Inference Level 2)
// ============================================================================

/// Type annotation information for Level 2 type inference.
///
/// Tracks type annotations from:
/// - Function parameters: `def foo(x: int)`
/// - Return types: `def foo() -> int`
/// - Variable annotations: `x: int = 5`
/// - Class attributes: `class Foo: x: int`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationInfo {
    /// The annotated name (parameter, variable, or "__return__" for return types).
    pub name: String,
    /// The type as a string (e.g., "int", "List[str]", "MyClass").
    pub type_str: String,
    /// How the annotation was parsed: "simple", "subscript", "union", "string", "attribute", "implicit".
    pub annotation_kind: String,
    /// Source of the annotation: "parameter", "return", "variable", "attribute".
    pub source_kind: String,
    /// Scope path where the annotation occurs.
    pub scope_path: Vec<String>,
    /// Byte span of the name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
    /// Structured type representation built from CST at collection time.
    ///
    /// Contains the `TypeNode` representation of the type annotation,
    /// preserving structural information (generics, unions, optionals, etc.)
    /// for use in FactsStore and type-aware operations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub type_node: Option<TypeNode>,
}

// ============================================================================
// Attribute Type Information (Phase 11C)
// ============================================================================

/// Type information for a class attribute, including both string representation
/// and optional structured TypeNode for callable return extraction.
///
/// Used by TypeTracker to track instance attribute types from class-level
/// annotations and `__init__` assignments.
#[derive(Debug, Clone)]
pub struct AttributeTypeInfo {
    /// The type as a string (e.g., "Handler", "List[str]").
    pub type_str: String,
    /// Structured type representation, if available from CST collection.
    /// Used for extracting callable return types.
    pub type_node: Option<TypeNode>,
}

// ============================================================================
// Property Type Information (Phase 11D)
// ============================================================================

/// Type information for a property decorated method.
///
/// Properties are syntactically accessed like attributes (`self.name` not `self.name()`)
/// but are defined as methods with `@property` decorator. This struct tracks the
/// return type of the property getter for type resolution.
///
/// Used by TypeTracker to track property return types from methods decorated
/// with `@property`.
#[derive(Debug, Clone)]
pub struct PropertyTypeInfo {
    /// Return type of the property getter as a string (e.g., "str", "int").
    pub type_str: String,
    /// Structured type representation, if available from CST collection.
    pub type_node: Option<TypeNode>,
}

// ============================================================================
// Dynamic Pattern Information
// ============================================================================

/// Dynamic pattern information for pattern detection.
///
/// Tracks patterns that cannot be statically analyzed:
/// - `getattr(obj, "name")` - dynamic attribute access
/// - `setattr(obj, "name", value)` - dynamic attribute set
/// - `globals()["name"]` - dynamic global access
/// - `locals()["name"]` - dynamic local access
/// - `eval("code")` - dynamic code execution
/// - `exec("code")` - dynamic code execution
/// - `__getattr__` / `__setattr__` method definitions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicPatternInfo {
    /// The kind of dynamic pattern: "getattr", "setattr", "globals", "locals", "eval", "exec",
    /// "__getattr__", or "__setattr__".
    pub kind: String,
    /// Scope path where the pattern occurs.
    pub scope_path: Vec<String>,
    /// The literal name if detectable (e.g., "method_name" in `getattr(obj, "method_name")`).
    /// None if the name is a variable or expression.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub literal_name: Option<String>,
    /// A string representation of the pattern for display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_text: Option<String>,
    /// Byte span of the pattern.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanInfo>,
    /// Line number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// Column number (1-indexed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

// ============================================================================
// Combined Analysis Result
// ============================================================================

/// Combined analysis result from a complete file analysis.
///
/// Contains all analysis data in a single structure to reduce overhead.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnalysisResult {
    /// Symbol bindings (definitions).
    #[serde(default)]
    pub bindings: Vec<BindingInfo>,
    /// Name references grouped by name.
    #[serde(default)]
    pub references: HashMap<String, Vec<ReferenceInfo>>,
    /// Import statements.
    #[serde(default)]
    pub imports: Vec<ImportInfo>,
    /// Scope structure.
    #[serde(default)]
    pub scopes: Vec<ScopeInfo>,
    /// Assignment type information (Level 1).
    #[serde(default)]
    pub assignments: Vec<AssignmentInfo>,
    /// Method call patterns.
    #[serde(default)]
    pub method_calls: Vec<MethodCallInfo>,
    /// Type annotations (Level 2).
    #[serde(default)]
    pub annotations: Vec<AnnotationInfo>,
    /// Dynamic patterns (getattr, eval, etc.).
    #[serde(default)]
    pub dynamic_patterns: Vec<DynamicPatternInfo>,
    /// Class inheritance information.
    #[serde(default)]
    pub class_inheritance: Vec<ClassInheritanceInfo>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_span_info_serialization() {
        let span = SpanInfo { start: 0, end: 10 };
        let json = serde_json::to_string(&span).unwrap();
        assert!(json.contains("\"start\":0"));
        assert!(json.contains("\"end\":10"));

        let deserialized: SpanInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.start, 0);
        assert_eq!(deserialized.end, 10);
    }

    #[test]
    fn test_binding_info_serialization() {
        let binding = BindingInfo {
            name: "foo".to_string(),
            kind: "function".to_string(),
            scope_path: vec!["<module>".to_string()],
            span: Some(SpanInfo { start: 4, end: 7 }),
            line: Some(1),
            col: Some(5),
        };

        let json = serde_json::to_string(&binding).unwrap();
        let deserialized: BindingInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "foo");
        assert_eq!(deserialized.kind, "function");
    }

    #[test]
    fn test_reference_info_serialization() {
        let reference = ReferenceInfo {
            kind: "call".to_string(),
            span: Some(SpanInfo { start: 10, end: 13 }),
            line: Some(2),
            col: Some(1),
        };

        let json = serde_json::to_string(&reference).unwrap();
        let deserialized: ReferenceInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.kind, "call");
    }

    #[test]
    fn test_scope_info_serialization() {
        let scope = ScopeInfo {
            id: "module".to_string(),
            kind: "module".to_string(),
            name: None,
            parent: None,
            span: None,
            byte_span: None,
            globals: vec!["x".to_string()],
            nonlocals: vec![],
        };

        let json = serde_json::to_string(&scope).unwrap();
        let deserialized: ScopeInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "module");
        assert_eq!(deserialized.globals, vec!["x"]);
    }

    #[test]
    fn test_analysis_result_serialization() {
        let result = AnalysisResult {
            bindings: vec![BindingInfo {
                name: "foo".to_string(),
                kind: "function".to_string(),
                scope_path: vec!["<module>".to_string()],
                span: None,
                line: None,
                col: None,
            }],
            references: HashMap::from([(
                "foo".to_string(),
                vec![ReferenceInfo {
                    kind: "definition".to_string(),
                    span: None,
                    line: None,
                    col: None,
                }],
            )]),
            imports: vec![],
            scopes: vec![],
            assignments: vec![],
            method_calls: vec![],
            annotations: vec![],
            dynamic_patterns: vec![],
            class_inheritance: vec![],
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: AnalysisResult = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.bindings.len(), 1);
        assert_eq!(deserialized.references.len(), 1);
    }

    #[test]
    fn test_import_info_serialization() {
        let import = ImportInfo {
            kind: "from".to_string(),
            module: "os.path".to_string(),
            alias: None,
            names: Some(vec![ImportedName {
                name: "join".to_string(),
                alias: Some("path_join".to_string()),
            }]),
            is_star: false,
            span: None,
            line: Some(1),
        };

        let json = serde_json::to_string(&import).unwrap();
        let deserialized: ImportInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.module, "os.path");
        assert!(deserialized.names.is_some());
    }

    #[test]
    fn test_assignment_info_serialization() {
        let assignment = AssignmentInfo {
            target: "x".to_string(),
            scope_path: vec!["<module>".to_string()],
            type_source: "constructor".to_string(),
            inferred_type: Some("MyClass".to_string()),
            rhs_name: None,
            callee_name: None,
            span: None,
            line: Some(1),
            col: Some(1),
            is_self_attribute: false,
            attribute_name: None,
        };

        let json = serde_json::to_string(&assignment).unwrap();
        let deserialized: AssignmentInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.target, "x");
        assert_eq!(deserialized.inferred_type, Some("MyClass".to_string()));
    }

    #[test]
    fn test_method_call_info_serialization() {
        let call = MethodCallInfo {
            receiver: "handler".to_string(),
            method: "process".to_string(),
            scope_path: vec!["<module>".to_string(), "use_handler".to_string()],
            method_span: Some(SpanInfo { start: 50, end: 57 }),
            line: Some(5),
            col: Some(10),
        };

        let json = serde_json::to_string(&call).unwrap();
        let deserialized: MethodCallInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.receiver, "handler");
        assert_eq!(deserialized.method, "process");
    }

    #[test]
    fn test_class_inheritance_info_serialization() {
        let class = ClassInheritanceInfo {
            name: "JsonHandler".to_string(),
            bases: vec!["BaseHandler".to_string()],
            scope_path: vec!["<module>".to_string()],
            span: Some(SpanInfo { start: 10, end: 21 }),
            line: Some(3),
            col: Some(7),
        };

        let json = serde_json::to_string(&class).unwrap();
        let deserialized: ClassInheritanceInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "JsonHandler");
        assert_eq!(deserialized.bases, vec!["BaseHandler"]);
    }

    #[test]
    fn test_annotation_info_serialization() {
        let annotation = AnnotationInfo {
            name: "x".to_string(),
            type_str: "int".to_string(),
            annotation_kind: "simple".to_string(),
            source_kind: "parameter".to_string(),
            scope_path: vec!["<module>".to_string(), "foo".to_string()],
            span: None,
            line: Some(1),
            col: Some(10),
            type_node: None,
        };

        let json = serde_json::to_string(&annotation).unwrap();
        let deserialized: AnnotationInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "x");
        assert_eq!(deserialized.type_str, "int");
    }

    #[test]
    fn test_dynamic_pattern_info_serialization() {
        let pattern = DynamicPatternInfo {
            kind: "getattr".to_string(),
            scope_path: vec!["<module>".to_string()],
            literal_name: Some("foo".to_string()),
            pattern_text: Some("getattr(obj, 'foo')".to_string()),
            span: Some(SpanInfo { start: 0, end: 19 }),
            line: Some(1),
            col: Some(1),
        };

        let json = serde_json::to_string(&pattern).unwrap();
        let deserialized: DynamicPatternInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.kind, "getattr");
        assert_eq!(deserialized.literal_name, Some("foo".to_string()));
    }
}
