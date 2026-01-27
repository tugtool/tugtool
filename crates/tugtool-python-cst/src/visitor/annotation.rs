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
//! let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);
//! for ann in &annotations {
//!     println!("{}: {} ({:?})", ann.name, ann.type_str, ann.source_kind);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{
    AnnAssign, Annotation, AssignTargetExpression, BaseSlice, BinaryOp, ClassDef, Element,
    Expression, FunctionDef, List, Module, Param, Span, Subscript, SubscriptElement,
};
use tugtool_core::facts::TypeNode;

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
    /// Implicit type inferred from context (e.g., `self`/`cls` in methods).
    Implicit,
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
            AnnotationKind::Implicit => "implicit",
            AnnotationKind::Other => "other",
        }
    }
}

impl std::fmt::Display for AnnotationKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

// ============================================================================
// TypeNode Building from CST Expressions
// ============================================================================

/// Build a `TypeNode` from a Python type annotation CST expression.
///
/// This function converts Python type annotation expressions into structured
/// `TypeNode` representations while the CST is still available. It is called
/// at collection time to preserve structured type information before the CST
/// is discarded.
///
/// # V1 Scope
///
/// The following CST node types are handled:
/// - `Name` - simple types (`int`, `str`, `MyClass`)
/// - `Attribute` - qualified types (`typing.List`, `module.Type`)
/// - `Subscript` - generic types (`List[int]`, `Dict[str, int]`)
/// - `BinaryOperation` with `|` - PEP 604 unions (`str | int`)
///
/// The following special patterns in subscripts are recognized:
/// - `Optional[T]` -> `TypeNode::Optional`
/// - `Union[A, B, ...]` -> `TypeNode::Union`
/// - `Callable[[...], R]` -> `TypeNode::Callable`
/// - `Tuple[A, B, C]` -> `TypeNode::Tuple`
///
/// # Out of Scope (returns None)
///
/// - `typing.Annotated[T, ...]` - metadata annotations
/// - `typing.Literal[...]` - literal types
/// - `typing.TypeVar` bounds and constraints
/// - Forward references as strings (`"MyClass"`)
/// - Complex expressions (lambdas, conditionals in annotations)
///
/// # Arguments
///
/// * `annotation_expr` - The CST expression representing the type annotation
///
/// # Returns
///
/// `Some(TypeNode)` if the annotation can be converted, `None` otherwise.
pub fn build_typenode_from_cst_annotation(annotation_expr: &Expression<'_>) -> Option<TypeNode> {
    match annotation_expr {
        // Name: simple types like `int`, `str`, `MyClass`
        Expression::Name(name) => Some(TypeNode::named(name.value)),

        // Attribute: qualified types like `typing.List`, `module.Type`
        Expression::Attribute(_attr) => {
            let qualified_name = build_qualified_name(annotation_expr);
            Some(TypeNode::named(qualified_name))
        }

        // Subscript: generic types like `List[int]`, `Dict[str, int]`
        Expression::Subscript(sub) => build_typenode_from_subscript(sub),

        // BinaryOperation: PEP 604 union syntax `str | int`
        Expression::BinaryOperation(bin_op) => {
            // Only handle BitOr (|) for union types
            if matches!(&bin_op.operator, BinaryOp::BitOr { .. }) {
                let mut members = Vec::new();
                collect_union_members(&bin_op.left, &mut members);
                collect_union_members(&bin_op.right, &mut members);

                if members.is_empty() {
                    None
                } else {
                    Some(TypeNode::Union { members })
                }
            } else {
                None
            }
        }

        // Tuple: for cases like bare tuple annotation `(int, str)`
        // This is rare in annotations but can appear
        Expression::Tuple(tuple) => {
            let elements: Vec<TypeNode> = tuple
                .elements
                .iter()
                .filter_map(|elem| match elem {
                    Element::Simple { value, .. } => build_typenode_from_cst_annotation(value),
                    _ => None,
                })
                .collect();

            if elements.is_empty() {
                None
            } else {
                Some(TypeNode::Tuple { elements })
            }
        }

        // Out of scope: string annotations (forward references), complex expressions
        _ => None,
    }
}

/// Build a qualified name from an attribute access chain.
///
/// For `typing.List` this returns `"typing.List"`.
/// For `a.b.c.Type` this returns `"a.b.c.Type"`.
fn build_qualified_name(expr: &Expression<'_>) -> String {
    match expr {
        Expression::Name(name) => name.value.to_string(),
        Expression::Attribute(attr) => {
            let base = build_qualified_name(&attr.value);
            format!("{}.{}", base, attr.attr.value)
        }
        _ => "<unknown>".to_string(),
    }
}

/// Collect union members from a binary expression tree.
///
/// This handles chained unions like `int | str | bool` by recursively
/// walking the BinaryOperation tree and collecting all leaf types.
fn collect_union_members(expr: &Expression<'_>, members: &mut Vec<TypeNode>) {
    match expr {
        Expression::BinaryOperation(bin_op)
            if matches!(&bin_op.operator, BinaryOp::BitOr { .. }) =>
        {
            // Recursively collect from both sides
            collect_union_members(&bin_op.left, members);
            collect_union_members(&bin_op.right, members);
        }
        _ => {
            // Leaf node - try to convert to TypeNode
            if let Some(node) = build_typenode_from_cst_annotation(expr) {
                members.push(node);
            }
        }
    }
}

/// Build a TypeNode from a subscript expression.
///
/// This handles generic types and special patterns:
/// - `Optional[T]` -> `TypeNode::Optional { inner: T }`
/// - `Union[A, B]` -> `TypeNode::Union { members: [A, B] }`
/// - `Callable[[A, B], R]` -> `TypeNode::Callable { params: [A, B], returns: R }`
/// - `Tuple[A, B, C]` -> `TypeNode::Tuple { elements: [A, B, C] }`
/// - Other generics -> `TypeNode::Named { name, args }`
fn build_typenode_from_subscript(sub: &Subscript<'_>) -> Option<TypeNode> {
    // Get the base type name
    let base_name = match sub.value.as_ref() {
        Expression::Name(name) => name.value,
        Expression::Attribute(_attr) => {
            // Check for special qualified names like `typing.Optional`
            let qualified = build_qualified_name(sub.value.as_ref());
            return build_typenode_from_qualified_subscript(&qualified, &sub.slice);
        }
        _ => return None,
    };

    // Handle special patterns
    match base_name {
        "Optional" => build_optional_typenode(&sub.slice),
        "Union" => build_union_typenode(&sub.slice),
        "Callable" => build_callable_typenode(&sub.slice),
        "Tuple" => build_tuple_typenode(&sub.slice),
        // Check for out-of-scope types that should return None
        "Annotated" | "Literal" | "TypeVar" => None,
        // Generic type with type arguments
        _ => {
            let args = extract_type_args(&sub.slice);
            Some(TypeNode::Named {
                name: base_name.to_string(),
                args,
            })
        }
    }
}

/// Build a TypeNode from a qualified subscript like `typing.Optional[T]`.
fn build_typenode_from_qualified_subscript(
    qualified_name: &str,
    slice: &[SubscriptElement<'_>],
) -> Option<TypeNode> {
    // Check for typing module special forms
    match qualified_name {
        "typing.Optional" => build_optional_typenode(slice),
        "typing.Union" => build_union_typenode(slice),
        "typing.Callable" => build_callable_typenode(slice),
        "typing.Tuple" => build_tuple_typenode(slice),
        "typing.Annotated" | "typing.Literal" | "typing.TypeVar" => None,
        // Other qualified generics
        _ => {
            let args = extract_type_args(slice);
            Some(TypeNode::Named {
                name: qualified_name.to_string(),
                args,
            })
        }
    }
}

/// Build an Optional TypeNode from subscript slice.
fn build_optional_typenode(slice: &[SubscriptElement<'_>]) -> Option<TypeNode> {
    // Optional[T] has exactly one type argument
    if slice.len() != 1 {
        return None;
    }

    let inner = extract_single_type_arg(&slice[0])?;
    Some(TypeNode::Optional {
        inner: Box::new(inner),
    })
}

/// Build a Union TypeNode from subscript slice.
fn build_union_typenode(slice: &[SubscriptElement<'_>]) -> Option<TypeNode> {
    let members = extract_type_args(slice);
    if members.is_empty() {
        None
    } else {
        Some(TypeNode::Union { members })
    }
}

/// Build a Callable TypeNode from subscript slice.
///
/// Callable[[Param1, Param2], ReturnType]
fn build_callable_typenode(slice: &[SubscriptElement<'_>]) -> Option<TypeNode> {
    // Callable[[...], R] has two elements: params list and return type
    if slice.len() != 2 {
        return None;
    }

    // First element is the parameter types (as a list)
    let params = match &slice[0].slice {
        BaseSlice::Index(idx) => match &idx.value {
            // Parameters are in a list: [[int, str], R]
            Expression::List(list) => extract_list_type_args(list),
            // Single parameter without list: [int, R] - less common
            _ => {
                if let Some(node) = build_typenode_from_cst_annotation(&idx.value) {
                    vec![node]
                } else {
                    Vec::new()
                }
            }
        },
        _ => return None,
    };

    // Second element is the return type
    let returns = extract_single_type_arg(&slice[1])?;

    Some(TypeNode::Callable {
        params,
        returns: Box::new(returns),
    })
}

/// Build a Tuple TypeNode from subscript slice.
fn build_tuple_typenode(slice: &[SubscriptElement<'_>]) -> Option<TypeNode> {
    let elements = extract_type_args(slice);
    // Tuple can have zero elements (empty tuple type)
    Some(TypeNode::Tuple { elements })
}

/// Extract type arguments from a subscript slice.
fn extract_type_args(slice: &[SubscriptElement<'_>]) -> Vec<TypeNode> {
    slice.iter().filter_map(extract_single_type_arg).collect()
}

/// Extract a single type argument from a SubscriptElement.
fn extract_single_type_arg(elem: &SubscriptElement<'_>) -> Option<TypeNode> {
    match &elem.slice {
        BaseSlice::Index(idx) => build_typenode_from_cst_annotation(&idx.value),
        BaseSlice::Slice(_) => None, // Slices are not type annotations
    }
}

/// Extract type arguments from a List expression (used for Callable params).
fn extract_list_type_args(list: &List<'_>) -> Vec<TypeNode> {
    list.elements
        .iter()
        .filter_map(|elem| match elem {
            Element::Simple { value, .. } => build_typenode_from_cst_annotation(value),
            _ => None,
        })
        .collect()
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
    /// Structured type representation built from CST at collection time.
    ///
    /// This field preserves the structured representation of the type annotation
    /// before the CST is discarded. It enables downstream consumers (TypeTracker,
    /// FactsStore) to have access to structured type information.
    ///
    /// Returns `Some(TypeNode)` for supported annotation patterns:
    /// - Simple names: `int`, `str`, `MyClass`
    /// - Qualified names: `typing.List`, `module.Type`
    /// - Generic types: `List[int]`, `Dict[str, int]`
    /// - PEP 604 unions: `str | int`
    /// - Special forms: `Optional[T]`, `Union[A, B]`, `Callable[[...], R]`, `Tuple[...]`
    ///
    /// Returns `None` for unsupported patterns:
    /// - Forward references as strings: `"MyClass"`
    /// - `typing.Annotated`, `typing.Literal`, `typing.TypeVar`
    /// - Complex expressions
    pub type_node: Option<TypeNode>,
}

impl AnnotationInfo {
    /// Create a new AnnotationInfo.
    fn new(
        name: String,
        type_str: String,
        annotation_kind: AnnotationKind,
        source_kind: AnnotationSourceKind,
        scope_path: Vec<String>,
        type_node: Option<TypeNode>,
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
            type_node,
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
/// let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);
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
    /// The enclosing class name when inside a method (for implicit self/cls typing).
    /// Set when entering a class, cleared when leaving.
    enclosing_class: Option<String>,
}

impl<'pos> Default for AnnotationCollector<'pos> {
    fn default() -> Self {
        Self::new()
    }
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
            enclosing_class: None,
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
            enclosing_class: None,
        }
    }

    /// Collect annotations from a parsed module with position information.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    pub fn collect(module: &Module<'_>, positions: &'pos PositionTable) -> Vec<AnnotationInfo> {
        let mut collector = AnnotationCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.annotations
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
                    .filter_map(|elem| match elem {
                        crate::nodes::Element::Simple { value, .. } => {
                            Some(Self::annotation_to_string(value))
                        }
                        _ => None,
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
        // Build TypeNode from CST while it's still available
        let type_node = build_typenode_from_cst_annotation(&annotation.annotation);
        // Look up span from the PositionTable using the node_id
        let span = self.lookup_span(node_id);

        let info = AnnotationInfo::new(
            name.to_string(),
            type_str,
            annotation_kind,
            source_kind,
            self.scope_path.clone(),
            type_node,
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
            // Build TypeNode from CST while it's still available
            let type_node = build_typenode_from_cst_annotation(&returns.annotation);

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
                type_node,
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
        self.enclosing_class = Some(node.name.value.to_string());
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
        self.in_class_body = false;
        self.enclosing_class = None;
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
        } else if let Some(class_name) = &self.enclosing_class {
            // Emit implicit annotation for self/cls parameters in methods
            let param_name = node.name.value;
            if param_name == "self" || param_name == "cls" {
                let span = self.lookup_span(node.name.node_id);
                let info = AnnotationInfo::new(
                    param_name.to_string(),
                    class_name.clone(),
                    AnnotationKind::Implicit,
                    AnnotationSourceKind::Parameter,
                    self.scope_path.clone(),
                    Some(TypeNode::named(class_name)),
                )
                .with_span(span);
                self.annotations.push(info);
            }
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
    use crate::parse_module_with_positions;

    #[test]
    fn test_annotation_parameter_simple() {
        let source = "def foo(x: int):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "x");
        assert_eq!(annotations[0].type_str, "int");
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Parameter);
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Simple);
    }

    #[test]
    fn test_annotation_parameter_multiple() {
        let source = "def foo(x: int, y: str, z: bool):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "__return__");
        assert_eq!(annotations[0].type_str, "int");
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Return);
    }

    #[test]
    fn test_annotation_subscript() {
        let source = "def foo(x: List[int]):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "List[int]");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Subscript);
    }

    #[test]
    fn test_annotation_dict() {
        let source = "def foo(x: Dict[str, int]):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "Dict[str, int]");
    }

    #[test]
    fn test_annotation_union() {
        let source = "def foo(x: int | str):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "int | str");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Union);
    }

    #[test]
    fn test_annotation_variable() {
        let source = "x: int = 5";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "x");
        assert_eq!(annotations[0].type_str, "int");
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Variable);
    }

    #[test]
    fn test_annotation_class_attribute() {
        let source = "class Foo:\n    x: int";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].type_str, "typing.List");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Attribute);
    }

    #[test]
    fn test_annotation_string_forward_ref() {
        let source = "def foo(x: \"MyClass\"):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        // Now includes implicit self annotation plus explicit x
        assert_eq!(annotations.len(), 2);
        assert_eq!(annotations[1].name, "x");
        // Scope path: <module> -> MyClass -> method
        assert_eq!(
            annotations[1].scope_path,
            vec!["<module>", "MyClass", "method"]
        );
    }

    #[test]
    fn test_annotation_implicit_self() {
        let source = r#"class MyClass:
    def method(self, x: int):
        pass
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        // Should have two annotations: implicit self, and explicit x
        assert_eq!(annotations.len(), 2);

        // First annotation should be implicit self
        assert_eq!(annotations[0].name, "self");
        assert_eq!(annotations[0].type_str, "MyClass");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::Implicit);
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Parameter);
        assert_eq!(
            annotations[0].scope_path,
            vec!["<module>", "MyClass", "method"]
        );

        // Second annotation should be explicit x
        assert_eq!(annotations[1].name, "x");
        assert_eq!(annotations[1].type_str, "int");
        assert_eq!(annotations[1].annotation_kind, AnnotationKind::Simple);
    }

    #[test]
    fn test_annotation_implicit_cls() {
        let source = r#"class MyClass:
    @classmethod
    def create(cls) -> "MyClass":
        return cls()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        // Should have two annotations: return type (processed first), then implicit cls
        assert_eq!(annotations.len(), 2);

        // First annotation is return type (visit_function_def processes it first)
        assert_eq!(annotations[0].name, "__return__");
        assert_eq!(annotations[0].type_str, "MyClass");
        assert_eq!(annotations[0].source_kind, AnnotationSourceKind::Return);

        // Second annotation should be implicit cls
        assert_eq!(annotations[1].name, "cls");
        assert_eq!(annotations[1].type_str, "MyClass");
        assert_eq!(annotations[1].annotation_kind, AnnotationKind::Implicit);
    }

    #[test]
    fn test_annotation_explicit_self_overrides() {
        // When self has an explicit annotation, no implicit annotation is emitted
        let source = r#"class MyClass:
    def method(self: "MyClass"):
        pass
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        // Should have only one annotation: the explicit self annotation
        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "self");
        assert_eq!(annotations[0].type_str, "MyClass");
        assert_eq!(annotations[0].annotation_kind, AnnotationKind::String); // Forward reference
    }

    // ========================================================================
    // TypeNode building tests
    // ========================================================================

    #[test]
    fn test_typenode_simple_int() {
        let source = "def foo(x: int):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        let type_node = annotations[0]
            .type_node
            .as_ref()
            .expect("should have type_node");
        match type_node {
            TypeNode::Named { name, args } => {
                assert_eq!(name, "int");
                assert!(args.is_empty());
            }
            _ => panic!("Expected TypeNode::Named, got {:?}", type_node),
        }
    }

    #[test]
    fn test_typenode_generic_list() {
        let source = "def foo(x: List[str]):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        let type_node = annotations[0]
            .type_node
            .as_ref()
            .expect("should have type_node");
        match type_node {
            TypeNode::Named { name, args } => {
                assert_eq!(name, "List");
                assert_eq!(args.len(), 1);
                match &args[0] {
                    TypeNode::Named {
                        name: inner,
                        args: inner_args,
                    } => {
                        assert_eq!(inner, "str");
                        assert!(inner_args.is_empty());
                    }
                    _ => panic!("Expected inner TypeNode::Named"),
                }
            }
            _ => panic!("Expected TypeNode::Named, got {:?}", type_node),
        }
    }

    #[test]
    fn test_typenode_optional() {
        let source = "def foo(x: Optional[int]):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        let type_node = annotations[0]
            .type_node
            .as_ref()
            .expect("should have type_node");
        match type_node {
            TypeNode::Optional { inner } => match inner.as_ref() {
                TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                _ => panic!("Expected inner TypeNode::Named"),
            },
            _ => panic!("Expected TypeNode::Optional, got {:?}", type_node),
        }
    }

    #[test]
    fn test_typenode_union() {
        let source = "def foo(x: Union[str, int]):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        let type_node = annotations[0]
            .type_node
            .as_ref()
            .expect("should have type_node");
        match type_node {
            TypeNode::Union { members } => {
                assert_eq!(members.len(), 2);
            }
            _ => panic!("Expected TypeNode::Union, got {:?}", type_node),
        }
    }

    #[test]
    fn test_typenode_pep604_union() {
        let source = "def foo(x: str | int):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        let type_node = annotations[0]
            .type_node
            .as_ref()
            .expect("should have type_node");
        match type_node {
            TypeNode::Union { members } => {
                assert_eq!(members.len(), 2);
            }
            _ => panic!("Expected TypeNode::Union, got {:?}", type_node),
        }
    }

    #[test]
    fn test_typenode_callable() {
        let source = "def foo(x: Callable[[int], str]):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        let type_node = annotations[0]
            .type_node
            .as_ref()
            .expect("should have type_node");
        match type_node {
            TypeNode::Callable { params, returns } => {
                assert_eq!(params.len(), 1);
                match returns.as_ref() {
                    TypeNode::Named { name, .. } => assert_eq!(name, "str"),
                    _ => panic!("Expected return TypeNode::Named"),
                }
            }
            _ => panic!("Expected TypeNode::Callable, got {:?}", type_node),
        }
    }

    #[test]
    fn test_typenode_forward_ref_is_none() {
        // Forward references (string annotations) should have type_node = None
        let source = "def foo(x: \"MyClass\"):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert!(
            annotations[0].type_node.is_none(),
            "Forward reference should have type_node = None"
        );
        // But type_str should still have the value
        assert_eq!(annotations[0].type_str, "MyClass");
    }

    #[test]
    fn test_typenode_return_type() {
        let source = "def foo() -> List[int]:\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].name, "__return__");
        let type_node = annotations[0]
            .type_node
            .as_ref()
            .expect("should have type_node");
        match type_node {
            TypeNode::Named { name, args } => {
                assert_eq!(name, "List");
                assert_eq!(args.len(), 1);
            }
            _ => panic!("Expected TypeNode::Named, got {:?}", type_node),
        }
    }

    #[test]
    fn test_typenode_typing_qualified() {
        let source = "def foo(x: typing.Optional[int]):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let annotations = AnnotationCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(annotations.len(), 1);
        let type_node = annotations[0]
            .type_node
            .as_ref()
            .expect("should have type_node");
        match type_node {
            TypeNode::Optional { inner } => match inner.as_ref() {
                TypeNode::Named { name, .. } => assert_eq!(name, "int"),
                _ => panic!("Expected inner TypeNode::Named"),
            },
            _ => panic!("Expected TypeNode::Optional, got {:?}", type_node),
        }
    }
}
