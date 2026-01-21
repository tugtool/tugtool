// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! AnnotationCollector visitor for Python type annotation extraction.
//!
//! This module provides an [`AnnotationCollector`] visitor that traverses a CST and
//! collects all type annotations with their details.
//!
//! # What is Collected?
//!
//! - **Function parameters**: `def foo(x: int)`
//! - **Return types**: `def foo() -> int`
//! - **Variable annotations**: `x: int = 5`
//! - **Class attributes**: `class Foo: x: int`
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, AnnotationCollector, AnnotationInfo};
//!
//! let source = "def foo(x: int) -> str:\n    pass";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let annotations = AnnotationCollector::collect_with_positions(&parsed.module, &parsed.positions);
//! for ann in &annotations {
//!     println!("{}: {} ({:?})", ann.name, ann.type_str, ann.source_kind);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{
    AnnAssign, Annotation, AssignTargetExpression, BaseSlice, BinaryOp, ClassDef, Expression,
    FunctionDef, Module, Param, Span, Subscript, SubscriptElement,
};

/// The source of an annotation (where it appears in the code).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnnotationSourceKind {
    /// Function or lambda parameter annotation.
    Parameter,
    /// Function return type annotation.
    Return,
    /// Variable annotation (standalone or in assignment).
    Variable,
    /// Class attribute annotation.
    Attribute,
}

impl AnnotationSourceKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            AnnotationSourceKind::Parameter => "parameter",
            AnnotationSourceKind::Return => "return",
            AnnotationSourceKind::Variable => "variable",
            AnnotationSourceKind::Attribute => "attribute",
        }
    }
}

impl std::fmt::Display for AnnotationSourceKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// How the annotation was parsed (the type expression form).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnnotationKind {
    /// Simple name: `int`, `str`, `MyClass`.
    Simple,
    /// Subscripted type: `List[int]`, `Dict[str, int]`.
    Subscript,
    /// Union type (PEP 604): `int | str`.
    Union,
    /// String annotation (forward reference): `"MyClass"`.
    String,
    /// Attribute access: `module.Type`.
    Attribute,
    /// Other complex expression.
    Other,
}

impl AnnotationKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            AnnotationKind::Simple => "simple",
            AnnotationKind::Subscript => "subscript",
            AnnotationKind::Union => "union",
            AnnotationKind::String => "string",
            AnnotationKind::Attribute => "attribute",
            AnnotationKind::Other => "other",
        }
    }
}

impl std::fmt::Display for AnnotationKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about a single type annotation in the Python source.
#[derive(Debug, Clone)]
pub struct AnnotationInfo {
    /// The annotated name (parameter name, variable name, or "__return__" for return types).
    pub name: String,
    /// The type as a string (e.g., "int", "List[str]", "MyClass").
    pub type_str: String,
    /// How the annotation was parsed.
    pub annotation_kind: AnnotationKind,
    /// Source of the annotation.
    pub source_kind: AnnotationSourceKind,
    /// Scope path where the annotation occurs.
    pub scope_path: Vec<String>,
    /// Source span for the name.
    pub span: Option<Span>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Column number (1-indexed).
    pub col: Option<u32>,
}

impl AnnotationInfo {
    /// Create a new AnnotationInfo.
    fn new(
        name: String,
        type_str: String,
        annotation_kind: AnnotationKind,
        source_kind: AnnotationSourceKind,
        scope_path: Vec<String>,
    ) -> Self {
        Self {
            name,
            type_str,
            annotation_kind,
            source_kind,
            scope_path,
            span: None,
            line: None,
            col: None,
        }
    }

    /// Set the span for this annotation.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }
}

/// A visitor that collects annotation information from a Python CST.
///
/// AnnotationCollector traverses the CST and identifies all type annotations:
/// - Function parameters with type annotations
/// - Function return type annotations
/// - Variable annotations (AnnAssign)
/// - Class attribute annotations
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let annotations = AnnotationCollector::collect_with_positions(&parsed.module, &parsed.positions);
/// ```
pub struct AnnotationCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected annotations.
    annotations: Vec<AnnotationInfo>,
    /// Current scope path for tracking where annotations appear.
    scope_path: Vec<String>,
    /// Whether we're currently inside a class body (for attribute vs variable distinction).
    in_class_body: bool,
}

impl<'pos> AnnotationCollector<'pos> {
    /// Create a new AnnotationCollector without position tracking.
    ///
    /// Annotations will be collected but spans will be None.
    pub fn new() -> Self {
        Self {
            positions: None,
            annotations: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            in_class_body: false,
        }
    }

    /// Create a new AnnotationCollector with position tracking.
    ///
    /// Annotations will include spans from the PositionTable.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            annotations: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            in_class_body: false,
        }
    }

    /// Collect annotations from a parsed module with position information.
    ///
    /// This is the preferred method for collecting annotations with accurate spans.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    pub fn collect_with_positions(
        module: &Module<'_>,
        positions: &'pos PositionTable,
    ) -> Vec<AnnotationInfo> {
        let mut collector = AnnotationCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.annotations
    }

    /// Collect annotations from a parsed module.
    ///
    /// This is a legacy compatibility method. For new code, prefer
    /// [`collect_with_positions`] which provides accurate token-derived spans.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module (ignored; re-parses for positions)
    /// * `source` - The original source code
    ///
    /// [`collect_with_positions`]: Self::collect_with_positions
    pub fn collect(_module: &Module<'_>, source: &str) -> Vec<AnnotationInfo> {
        // Re-parse with position tracking to get accurate spans
        match crate::parse_module_with_positions(source, None) {
            Ok(parsed) => {
                let mut collector = AnnotationCollector::with_positions(&parsed.positions);
                walk_module(&mut collector, &parsed.module);
                collector.annotations
            }
            Err(_) => {
                // Fallback: collect without spans if re-parsing fails
                Vec::new()
            }
        }
    }

    /// Get the collected annotations, consuming the collector.
    pub fn into_annotations(self) -> Vec<AnnotationInfo> {
        self.annotations
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Extract the type string from an annotation expression.
    fn annotation_to_string(expr: &Expression<'_>) -> String {
        match expr {
            Expression::Name(name) => name.value.to_string(),
            Expression::Attribute(attr) => {
                let base = Self::annotation_to_string(&attr.value);
                format!("{}.{}", base, attr.attr.value)
            }
            Expression::Subscript(sub) => {
                let base = Self::annotation_to_string(&sub.value);
                let slice = Self::subscript_slice_to_string(sub);
                format!("{}[{}]", base, slice)
            }
            Expression::BinaryOperation(bin_op) => {
                let left = Self::annotation_to_string(&bin_op.left);
                let right = Self::annotation_to_string(&bin_op.right);
                // Check if this is a union (|)
                if matches!(&bin_op.operator, BinaryOp::BitOr { .. }) {
                    format!("{} | {}", left, right)
                } else {
                    format!("{} op {}", left, right)
                }
            }
            Expression::SimpleString(s) => {
                // Remove quotes for the type string but keep it as forward reference
                let value = s.value;
                if value.starts_with('"') || value.starts_with('\'') {
                    value[1..value.len() - 1].to_string()
                } else {
                    value.to_string()
                }
            }
            Expression::ConcatenatedString(_) => "<string>".to_string(),
            Expression::Tuple(tuple) => {
                let parts: Vec<String> = tuple
                    .elements
                    .iter()
                    .filter_map(|elem| {
                        match elem {
                            crate::nodes::Element::Simple { value, .. } => {
                                Some(Self::annotation_to_string(value))
                            }
                            _ => None,
                        }
                    })
                    .collect();
                parts.join(", ")
            }
            Expression::Ellipsis(_) => "...".to_string(),
            _ => "<complex>".to_string(),
        }
    }

    /// Extract the slice part of a subscript for type annotations.
    fn subscript_slice_to_string(sub: &Subscript<'_>) -> String {
        match &sub.slice[..] {
            [] => "".to_string(),
            [single] => Self::subscript_element_to_string(single),
            elements => {
                let parts: Vec<String> = elements
                    .iter()
                    .map(Self::subscript_element_to_string)
                    .collect();
                parts.join(", ")
            }
        }
    }

    /// Convert a single subscript element to string.
    fn subscript_element_to_string(elem: &SubscriptElement<'_>) -> String {
        match &elem.slice {
            BaseSlice::Index(idx) => Self::annotation_to_string(&idx.value),
            BaseSlice::Slice(_) => "...".to_string(),
        }
    }

    /// Determine the annotation kind from an expression.
    fn classify_annotation(expr: &Expression<'_>) -> AnnotationKind {
        match expr {
            Expression::Name(_) => AnnotationKind::Simple,
            Expression::Attribute(_) => AnnotationKind::Attribute,
            Expression::Subscript(_) => AnnotationKind::Subscript,
            Expression::BinaryOperation(bin_op) => {
                if matches!(&bin_op.operator, BinaryOp::BitOr { .. }) {
                    AnnotationKind::Union
                } else {
                    AnnotationKind::Other
                }
            }
            Expression::SimpleString(_) | Expression::ConcatenatedString(_) => {
                AnnotationKind::String
            }
            _ => AnnotationKind::Other,
        }
    }

    /// Process an annotation and add it to the collection.
    fn add_annotation(
        &mut self,
        name: &str,
        annotation: &Annotation<'_>,
        source_kind: AnnotationSourceKind,
        node_id: Option<NodeId>,
    ) {
        let type_str = Self::annotation_to_string(&annotation.annotation);
        let annotation_kind = Self::classify_annotation(&annotation.annotation);
        // Look up span from the PositionTable using the node_id
        let span = self.lookup_span(node_id);

        let info = AnnotationInfo::new(
            name.to_string(),
            type_str,
            annotation_kind,
            source_kind,
            self.scope_path.clone(),
        )
        .with_span(span);

        self.annotations.push(info);
    }
}

impl<'a, 'pos> Visitor<'a> for AnnotationCollector<'pos> {
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        // Enter function scope
        self.scope_path.push(node.name.value.to_string());
        let was_in_class = self.in_class_body;
        self.in_class_body = false;

        // Process return type annotation
        if let Some(returns) = &node.returns {
            let type_str = Self::annotation_to_string(&returns.annotation);
            let annotation_kind = Self::classify_annotation(&returns.annotation);

            // Return type annotations don't have a tracked Name node.
            // The span would be for "->" which is not tracked in PositionTable.
            // We leave span as None for return type annotations.
            let span = None;

            let info = AnnotationInfo::new(
                "__return__".to_string(),
                type_str,
                annotation_kind,
                AnnotationSourceKind::Return,
                self.scope_path.clone(),
            )
            .with_span(span);

            self.annotations.push(info);
        }

        // Restore class body flag after processing
        self.in_class_body = was_in_class;

        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        // Enter class scope
        self.scope_path.push(node.name.value.to_string());
        self.in_class_body = true;
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
        self.in_class_body = false;
    }

    fn visit_param(&mut self, node: &Param<'a>) -> VisitResult {
        // Process parameter annotation
        if let Some(annotation) = &node.annotation {
            // Use the parameter name's node_id for span lookup
            self.add_annotation(
                node.name.value,
                annotation,
                AnnotationSourceKind::Parameter,
                node.name.node_id,
            );
        }
        VisitResult::Continue
    }

    fn visit_ann_assign(&mut self, node: &AnnAssign<'a>) -> VisitResult {
        // Get the target name and its node_id
        let (name, node_id) = match &node.target {
            AssignTargetExpression::Name(name) => (name.value.to_string(), name.node_id),
            _ => return VisitResult::Continue, // Skip complex targets
        };

        // Determine if this is a class attribute or variable
        let source_kind = if self.in_class_body {
            AnnotationSourceKind::Attribute
        } else {
            AnnotationSourceKind::Variable
        };

        self.add_annotation(&name, &node.annotation, source_kind, node_id);
        VisitResult::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module;

    #[test]
    fn test_annotation_parameter_simple() {
        let source = "def foo(x: int):\n    pass";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "x");
        assert_eq!(annotations[0].type_str, "int");
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Parameter);
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Simple);
    }

    #[test]
    fn test_annotation_parameter_multiple() {
        let source = "def foo(x: int, y: str, z: bool):\n    pass";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 3);
        assert_eq!(annotations[0].name, "x");
        assert_eq!(annotations[0].type_str, "int");
        assert_eq!(annotations[1].name, "y");
        assert_eq!(annotations[1].type_str, "str");
        assert_eq!(annotations[2].name, "z");
        assert_eq!(annotations[2].type_str, "bool");
    }

    #[test]
    fn test_annotation_return_type() {
        let source = "def foo() -> int:\n    pass";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "__return__");
        assert_eq!(annotations[0].type_str, "int");
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Return);
    }

    #[test]
    fn test_annotation_subscript() {
        let source = "def foo(x: List[int]):\n    pass";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "List[int]");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Subscript);
    }

    #[test]
    fn test_annotation_dict() {
        let source = "def foo(x: Dict[str, int]):\n    pass";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "Dict[str, int]");
    }

    #[test]
    fn test_annotation_union() {
        let source = "def foo(x: int | str):\n    pass";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "int | str");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Union);
    }

    #[test]
    fn test_annotation_variable() {
        let source = "x: int = 5";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "x");
        assert_eq!(annotations[0].type_str, "int");
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Variable);
    }

    #[test]
    fn test_annotation_class_attribute() {
        let source = "class Foo:\n    x: int";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "x");
        assert_eq!(annotations[0].type_str, "int");
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Attribute);
    }

    #[test]
    fn test_annotation_combined() {
        let source = r#"def foo(x: int, y: str) -> bool:
    z: float = 1.0
    pass
"#;
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        // x, y, __return__, z
        assert_eq!(annotations.len(), 4);

        let names: Vec<_> = annotations.iter().map(|a| a.name.as_str()).collect();
        assert!(names.contains(&"x"));
        assert!(names.contains(&"y"));
        assert!(names.contains(&"__return__"));
        assert!(names.contains(&"z"));
    }

    #[test]
    fn test_annotation_attribute_type() {
        let source = "def foo(x: typing.List):\n    pass";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "typing.List");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Attribute);
    }

    #[test]
    fn test_annotation_string_forward_ref() {
        let source = "def foo(x: \"MyClass\"):\n    pass";
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "MyClass");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::String);
    }

    #[test]
    fn test_annotation_scope_path() {
        let source = r#"class MyClass:
    def method(self, x: int):
        pass
"#;
        let module = parse_module(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&module, source);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "x");
        // Scope path: <module> -> MyClass -> method
        assert_eq!(
            annotations[0].scope_path,
            vec!["<module>", "MyClass", "method"]
        );
    }
}
