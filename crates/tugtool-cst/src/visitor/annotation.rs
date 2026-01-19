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
//! use tugtool_cst::{parse_module, AnnotationCollector, AnnotationInfo};
//!
//! let source = "def foo(x: int) -> str:\n    pass";
//! let module = parse_module(source, None)?;
//!
//! let annotations = AnnotationCollector::collect(&module, source);
//! for ann in &annotations {
//!     println!("{}: {} ({:?})", ann.name, ann.type_str, ann.source_kind);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
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
/// let annotations = AnnotationCollector::collect(&module, source);
/// ```
pub struct AnnotationCollector<'src> {
    /// The original source text (for span calculation).
    source: &'src str,
    /// Collected annotations.
    annotations: Vec<AnnotationInfo>,
    /// Current scope path for tracking where annotations appear.
    scope_path: Vec<String>,
    /// Whether we're currently inside a class body (for attribute vs variable distinction).
    in_class_body: bool,
    /// Current search cursor position in the source.
    cursor: usize,
}

impl<'src> AnnotationCollector<'src> {
    /// Create a new AnnotationCollector.
    pub fn new(source: &'src str) -> Self {
        Self {
            source,
            annotations: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            in_class_body: false,
            cursor: 0,
        }
    }

    /// Collect annotations from a parsed module.
    ///
    /// Returns the list of annotations in the order they were encountered.
    pub fn collect(module: &Module<'_>, source: &'src str) -> Vec<AnnotationInfo> {
        let mut collector = AnnotationCollector::new(source);
        walk_module(&mut collector, module);
        collector.annotations
    }

    /// Get the collected annotations, consuming the collector.
    pub fn into_annotations(self) -> Vec<AnnotationInfo> {
        self.annotations
    }

    /// Find a string in the source starting from the cursor, and advance cursor past it.
    fn find_and_advance(&mut self, needle: &str) -> Option<Span> {
        if needle.is_empty() {
            return None;
        }

        let search_area = &self.source[self.cursor..];
        if let Some(offset) = search_area.find(needle) {
            let start = (self.cursor + offset) as u64;
            let end = start + needle.len() as u64;
            self.cursor = self.cursor + offset + needle.len();
            Some(Span::new(start, end))
        } else {
            None
        }
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
    ) {
        let type_str = Self::annotation_to_string(&annotation.annotation);
        let annotation_kind = Self::classify_annotation(&annotation.annotation);
        let span = self.find_and_advance(name);

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

impl<'a, 'src> Visitor<'a> for AnnotationCollector<'src> {
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        // Enter function scope
        self.scope_path.push(node.name.value.to_string());
        let was_in_class = self.in_class_body;
        self.in_class_body = false;

        // Process return type annotation
        if let Some(returns) = &node.returns {
            let type_str = Self::annotation_to_string(&returns.annotation);
            let annotation_kind = Self::classify_annotation(&returns.annotation);

            // For return type, we need to find -> in the source
            let span = self.find_and_advance("->");

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
            self.add_annotation(node.name.value, annotation, AnnotationSourceKind::Parameter);
        }
        VisitResult::Continue
    }

    fn visit_ann_assign(&mut self, node: &AnnAssign<'a>) -> VisitResult {
        // Get the target name
        let name = match &node.target {
            AssignTargetExpression::Name(name) => name.value.to_string(),
            _ => return VisitResult::Continue, // Skip complex targets
        };

        // Determine if this is a class attribute or variable
        let source_kind = if self.in_class_body {
            AnnotationSourceKind::Attribute
        } else {
            AnnotationSourceKind::Variable
        };

        self.add_annotation(&name, &node.annotation, source_kind);
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
