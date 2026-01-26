// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! SignatureCollector visitor for Python function signature extraction.
//!
//! This module provides a [`SignatureCollector`] visitor that traverses a CST and
//! collects function/method signatures with parameter kinds and annotations.
//!
//! # What is Collected?
//!
//! - **Parameters**: Names, kinds (regular, positional-only, keyword-only, *args, **kwargs)
//! - **Default values**: Spans for default value expressions
//! - **Annotations**: Parameter type annotations and return types
//! - **Modifiers**: async, decorators (@staticmethod, @classmethod, @property, etc.)
//! - **Type parameters**: Generic type parameters (Python 3.12+)
//!
//! # Parameter Kind Classification
//!
//! Python parameters are classified based on their position in the function signature:
//! - `posonly_params` → `PositionalOnly` (before `/` separator)
//! - `params` → `Regular` (default parameters)
//! - `star_arg` → `VarArgs` (`*args`)
//! - `kwonly_params` → `KeywordOnly` (after `*` separator)
//! - `star_kwarg` → `KwArgs` (`**kwargs`)
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, SignatureCollector, SignatureInfo};
//!
//! let source = "def foo(x: int, /, y, *args, z=1, **kwargs) -> str: pass";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);
//! for sig in &signatures {
//!     println!("{}: {:?}", sig.name, sig.params);
//! }
//! ```

use super::annotation::build_typenode_from_cst_annotation;
use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{
    Annotation, ClassDef, Decorator, Expression, FunctionDef, Module, Parameters, Span, StarArg,
    TypeParameters, TypeVarLike,
};
use tugtool_core::facts::TypeNode;

/// Parameter kind classification for Python functions.
///
/// Matches the variants in `tugtool_core::facts::ParamKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ParamKind {
    /// Standard named parameter (default).
    Regular,
    /// Python positional-only parameter (before `/` separator).
    PositionalOnly,
    /// Python keyword-only parameter (after `*` separator).
    KeywordOnly,
    /// Python variadic positional parameter (`*args`).
    VarArgs,
    /// Python variadic keyword parameter (`**kwargs`).
    KwArgs,
}

impl ParamKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            ParamKind::Regular => "regular",
            ParamKind::PositionalOnly => "positional_only",
            ParamKind::KeywordOnly => "keyword_only",
            ParamKind::VarArgs => "var_args",
            ParamKind::KwArgs => "kwargs",
        }
    }
}

impl std::fmt::Display for ParamKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Function/method modifier (async, decorators).
///
/// Matches the variants in `tugtool_core::facts::Modifier`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Modifier {
    /// Async function/method.
    Async,
    /// Static method (`@staticmethod`).
    Static,
    /// Class method (`@classmethod`).
    ClassMethod,
    /// Property accessor (`@property`).
    Property,
    /// Abstract method (`@abstractmethod`).
    Abstract,
    /// Final method (`@final`).
    Final,
    /// Override (`@override`).
    Override,
    /// Generator function (detected by yield, but we'll mark here for completeness).
    Generator,
}

impl Modifier {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            Modifier::Async => "async",
            Modifier::Static => "static",
            Modifier::ClassMethod => "classmethod",
            Modifier::Property => "property",
            Modifier::Abstract => "abstract",
            Modifier::Final => "final",
            Modifier::Override => "override",
            Modifier::Generator => "generator",
        }
    }
}

impl std::fmt::Display for Modifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about a single parameter in a function signature.
#[derive(Debug, Clone)]
pub struct ParamInfo {
    /// Parameter name.
    pub name: String,
    /// Parameter kind (regular, positional-only, keyword-only, etc.).
    pub kind: ParamKind,
    /// Span of the default value expression (if present).
    pub default_span: Option<Span>,
    /// Type annotation string (if present).
    pub annotation: Option<String>,
    /// Structured type representation built from CST at collection time.
    ///
    /// Contains the `TypeNode` representation of the parameter's type annotation,
    /// preserving structural information (generics, unions, optionals, etc.).
    pub annotation_node: Option<TypeNode>,
    /// Source span for the parameter name.
    pub span: Option<Span>,
}

impl ParamInfo {
    /// Create a new ParamInfo.
    fn new(name: String, kind: ParamKind) -> Self {
        Self {
            name,
            kind,
            default_span: None,
            annotation: None,
            annotation_node: None,
            span: None,
        }
    }
}

/// Information about a type parameter in a generic function/class.
#[derive(Debug, Clone)]
pub struct TypeParamInfo {
    /// Type parameter name.
    pub name: String,
    /// Bound type string (if present, e.g., `T: Bound`).
    pub bound: Option<String>,
    /// Default type string (if present).
    pub default: Option<String>,
}

/// Information about a function/method signature.
#[derive(Debug, Clone)]
pub struct SignatureInfo {
    /// Function/method name.
    pub name: String,
    /// Parameters in declaration order.
    pub params: Vec<ParamInfo>,
    /// Return type annotation string (if present).
    pub returns: Option<String>,
    /// Structured return type representation built from CST at collection time.
    ///
    /// Contains the `TypeNode` representation of the return type annotation,
    /// preserving structural information (generics, unions, optionals, etc.).
    pub returns_node: Option<TypeNode>,
    /// Modifiers (async, decorators).
    pub modifiers: Vec<Modifier>,
    /// Type parameters for generic functions (Python 3.12+).
    pub type_params: Vec<TypeParamInfo>,
    /// Scope path where this function is defined (for qualified name computation).
    pub scope_path: Vec<String>,
    /// Source span for the function name.
    pub span: Option<Span>,
    /// Whether this function is defined inside a class.
    pub is_method: bool,
}

impl SignatureInfo {
    /// Create a new SignatureInfo.
    fn new(name: String, scope_path: Vec<String>, is_method: bool) -> Self {
        Self {
            name,
            params: vec![],
            returns: None,
            returns_node: None,
            modifiers: vec![],
            type_params: vec![],
            scope_path,
            span: None,
            is_method,
        }
    }
}

/// A visitor that collects function signatures from a Python CST.
///
/// SignatureCollector traverses the CST and identifies all function/method signatures:
/// - Parameter names, kinds, defaults, and annotations
/// - Return type annotations
/// - Modifiers (async, @staticmethod, @classmethod, @property, etc.)
/// - Type parameters (Python 3.12+ generics)
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);
/// ```
pub struct SignatureCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected signatures.
    signatures: Vec<SignatureInfo>,
    /// Current scope path for tracking where functions are defined.
    scope_path: Vec<String>,
    /// Whether we're currently inside a class body.
    in_class: bool,
}

impl<'pos> Default for SignatureCollector<'pos> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'pos> SignatureCollector<'pos> {
    /// Create a new SignatureCollector without position tracking.
    pub fn new() -> Self {
        Self {
            positions: None,
            signatures: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            in_class: false,
        }
    }

    /// Create a new SignatureCollector with position tracking.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            signatures: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            in_class: false,
        }
    }

    /// Collect signatures from a parsed module with position information.
    pub fn collect(module: &Module<'_>, positions: &'pos PositionTable) -> Vec<SignatureInfo> {
        let mut collector = SignatureCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.signatures
    }

    /// Get the collected signatures, consuming the collector.
    pub fn into_signatures(self) -> Vec<SignatureInfo> {
        self.signatures
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Extract annotation string from an Annotation node.
    fn annotation_to_string(&self, ann: &Annotation<'_>) -> String {
        // Use the annotation's expression to get its string representation
        expression_to_string(&ann.annotation)
    }

    /// Extract parameters from a Parameters node with kind classification.
    fn extract_params(&self, params: &Parameters<'_>) -> Vec<ParamInfo> {
        let mut result = Vec::new();

        // Positional-only parameters (before `/`)
        for p in &params.posonly_params {
            let mut info = ParamInfo::new(p.name.value.to_string(), ParamKind::PositionalOnly);
            info.span = self.lookup_span(p.name.node_id);
            if let Some(ann) = &p.annotation {
                info.annotation = Some(self.annotation_to_string(ann));
                // Build TypeNode from CST while it's still available
                info.annotation_node = build_typenode_from_cst_annotation(&ann.annotation);
            }
            if let Some(default) = &p.default {
                info.default_span = expression_span(default);
            }
            result.push(info);
        }

        // Regular parameters
        for p in &params.params {
            let mut info = ParamInfo::new(p.name.value.to_string(), ParamKind::Regular);
            info.span = self.lookup_span(p.name.node_id);
            if let Some(ann) = &p.annotation {
                info.annotation = Some(self.annotation_to_string(ann));
                // Build TypeNode from CST while it's still available
                info.annotation_node = build_typenode_from_cst_annotation(&ann.annotation);
            }
            if let Some(default) = &p.default {
                info.default_span = expression_span(default);
            }
            result.push(info);
        }

        // Star arg (*args)
        if let Some(StarArg::Param(p)) = &params.star_arg {
            let mut info = ParamInfo::new(p.name.value.to_string(), ParamKind::VarArgs);
            info.span = self.lookup_span(p.name.node_id);
            if let Some(ann) = &p.annotation {
                info.annotation = Some(self.annotation_to_string(ann));
                // Build TypeNode from CST while it's still available
                info.annotation_node = build_typenode_from_cst_annotation(&ann.annotation);
            }
            result.push(info);
        }
        // StarArg::Star is just the `*` separator with no parameter

        // Keyword-only parameters (after `*`)
        for p in &params.kwonly_params {
            let mut info = ParamInfo::new(p.name.value.to_string(), ParamKind::KeywordOnly);
            info.span = self.lookup_span(p.name.node_id);
            if let Some(ann) = &p.annotation {
                info.annotation = Some(self.annotation_to_string(ann));
                // Build TypeNode from CST while it's still available
                info.annotation_node = build_typenode_from_cst_annotation(&ann.annotation);
            }
            if let Some(default) = &p.default {
                info.default_span = expression_span(default);
            }
            result.push(info);
        }

        // Star kwarg (**kwargs)
        if let Some(p) = &params.star_kwarg {
            let mut info = ParamInfo::new(p.name.value.to_string(), ParamKind::KwArgs);
            info.span = self.lookup_span(p.name.node_id);
            if let Some(ann) = &p.annotation {
                info.annotation = Some(self.annotation_to_string(ann));
                // Build TypeNode from CST while it's still available
                info.annotation_node = build_typenode_from_cst_annotation(&ann.annotation);
            }
            result.push(info);
        }

        result
    }

    /// Extract modifiers from decorators and async keyword.
    fn extract_modifiers(&self, decorators: &[Decorator<'_>], is_async: bool) -> Vec<Modifier> {
        let mut modifiers = Vec::new();

        if is_async {
            modifiers.push(Modifier::Async);
        }

        for dec in decorators {
            if let Some(modifier) = decorator_to_modifier(dec) {
                modifiers.push(modifier);
            }
        }

        modifiers
    }

    /// Extract type parameters from TypeParameters node.
    fn extract_type_params(&self, type_params: &TypeParameters<'_>) -> Vec<TypeParamInfo> {
        let mut result = Vec::new();

        for tp in &type_params.params {
            let name = type_var_like_name(&tp.param);
            let bound = type_var_like_bound(&tp.param);
            let default = tp.default.as_ref().map(|e| expression_to_string(e));
            result.push(TypeParamInfo {
                name,
                bound,
                default,
            });
        }

        result
    }

    /// Process a function definition and extract its signature.
    fn process_function(&mut self, node: &FunctionDef<'_>) {
        let name = node.name.value.to_string();
        let is_async = node.asynchronous.is_some();
        let is_method = self.in_class;

        let mut sig = SignatureInfo::new(name, self.scope_path.clone(), is_method);
        sig.span = self.lookup_span(node.name.node_id);
        sig.params = self.extract_params(&node.params);
        sig.modifiers = self.extract_modifiers(&node.decorators, is_async);

        // Extract return type
        if let Some(returns) = &node.returns {
            sig.returns = Some(self.annotation_to_string(returns));
            // Build TypeNode from CST while it's still available
            sig.returns_node = build_typenode_from_cst_annotation(&returns.annotation);
        }

        // Extract type parameters (Python 3.12+)
        if let Some(type_params) = &node.type_parameters {
            sig.type_params = self.extract_type_params(type_params);
        }

        self.signatures.push(sig);
    }
}

impl<'a, 'pos> Visitor<'a> for SignatureCollector<'pos> {
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        self.process_function(node);

        // Push function name onto scope path for nested functions
        self.scope_path.push(node.name.value.to_string());

        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        // Enter class scope
        self.scope_path.push(node.name.value.to_string());
        self.in_class = true;

        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
        // Reset in_class when leaving a class scope
        // This is a simplification that doesn't handle nested classes perfectly,
        // but works for the common case of class-level methods
        self.in_class = false;
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Convert a decorator to a Modifier if it matches known patterns.
fn decorator_to_modifier(dec: &Decorator<'_>) -> Option<Modifier> {
    // Get the decorator name
    let name = match &dec.decorator {
        Expression::Name(n) => n.value,
        Expression::Attribute(attr) => {
            // Handle cases like `abc.abstractmethod`
            attr.attr.value
        }
        Expression::Call(call) => {
            // Handle cases like `property()` or `staticmethod()`
            match call.func.as_ref() {
                Expression::Name(n) => n.value,
                Expression::Attribute(attr) => attr.attr.value,
                _ => return None,
            }
        }
        _ => return None,
    };

    match name {
        "staticmethod" => Some(Modifier::Static),
        "classmethod" => Some(Modifier::ClassMethod),
        "property" => Some(Modifier::Property),
        "abstractmethod" => Some(Modifier::Abstract),
        "final" => Some(Modifier::Final),
        "override" => Some(Modifier::Override),
        _ => None,
    }
}

/// Get the name from a TypeVarLike.
fn type_var_like_name(tvl: &TypeVarLike<'_>) -> String {
    match tvl {
        TypeVarLike::TypeVar(tv) => tv.name.value.to_string(),
        TypeVarLike::TypeVarTuple(tvt) => tvt.name.value.to_string(),
        TypeVarLike::ParamSpec(ps) => ps.name.value.to_string(),
    }
}

/// Get the bound from a TypeVarLike (if any).
fn type_var_like_bound(tvl: &TypeVarLike<'_>) -> Option<String> {
    match tvl {
        TypeVarLike::TypeVar(tv) => tv.bound.as_ref().map(|b| expression_to_string(b)),
        TypeVarLike::TypeVarTuple(_) => None,
        TypeVarLike::ParamSpec(_) => None,
    }
}

/// Convert an expression to its string representation.
fn expression_to_string(expr: &Expression<'_>) -> String {
    match expr {
        Expression::Name(n) => n.value.to_string(),
        Expression::Attribute(attr) => {
            format!("{}.{}", expression_to_string(&attr.value), attr.attr.value)
        }
        Expression::Subscript(sub) => {
            format!(
                "{}[{}]",
                expression_to_string(&sub.value),
                slice_to_string(&sub.slice)
            )
        }
        Expression::BinaryOperation(bin) => {
            // Handle union types (X | Y)
            format!(
                "{} | {}",
                expression_to_string(&bin.left),
                expression_to_string(&bin.right)
            )
        }
        Expression::Tuple(tuple) => {
            let elements: Vec<String> = tuple
                .elements
                .iter()
                .map(|e| match e {
                    crate::nodes::Element::Simple { value, .. } => expression_to_string(value),
                    crate::nodes::Element::Starred(s) => {
                        format!("*{}", expression_to_string(&s.value))
                    }
                })
                .collect();
            elements.join(", ")
        }
        Expression::SimpleString(s) => s.value.to_string(),
        Expression::ConcatenatedString(cs) => {
            // Just return the left part for simplicity
            string_to_string(&cs.left)
        }
        Expression::FormattedString(_) => "...".to_string(),
        Expression::Integer(i) => i.value.to_string(),
        Expression::Float(f) => f.value.to_string(),
        Expression::Ellipsis(_) => "...".to_string(),
        Expression::NamedExpr(ne) => expression_to_string(&ne.value),
        _ => "...".to_string(),
    }
}

/// Convert a String node to its string representation.
fn string_to_string(s: &crate::nodes::String<'_>) -> String {
    match s {
        crate::nodes::String::Simple(ss) => ss.value.to_string(),
        crate::nodes::String::Concatenated(cs) => string_to_string(&cs.left),
        crate::nodes::String::Formatted(_) => "...".to_string(),
        crate::nodes::String::Templated(_) => "...".to_string(),
    }
}

/// Convert a subscript slice to string.
fn slice_to_string(slice: &[crate::nodes::SubscriptElement<'_>]) -> String {
    let parts: Vec<String> = slice
        .iter()
        .map(|e| match &e.slice {
            crate::nodes::BaseSlice::Index(idx) => expression_to_string(&idx.value),
            crate::nodes::BaseSlice::Slice(s) => {
                let lower = s
                    .lower
                    .as_ref()
                    .map(|e| expression_to_string(e))
                    .unwrap_or_default();
                let upper = s
                    .upper
                    .as_ref()
                    .map(|e| expression_to_string(e))
                    .unwrap_or_default();
                format!("{}:{}", lower, upper)
            }
        })
        .collect();
    parts.join(", ")
}

/// Get the span of an expression (if available).
fn expression_span(_expr: &Expression<'_>) -> Option<Span> {
    // Expressions don't directly have spans in this CST representation
    // We would need position table lookups for the specific expression tokens
    // For now, return None - the integration layer can handle missing spans
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_simple_function() {
        let source = "def foo(): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].name, "foo");
        assert!(signatures[0].params.is_empty());
        assert!(signatures[0].returns.is_none());
        assert!(!signatures[0].is_method);
    }

    #[test]
    fn test_function_with_params() {
        let source = "def foo(x, y): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].params.len(), 2);
        assert_eq!(signatures[0].params[0].name, "x");
        assert_eq!(signatures[0].params[0].kind, ParamKind::Regular);
        assert_eq!(signatures[0].params[1].name, "y");
        assert_eq!(signatures[0].params[1].kind, ParamKind::Regular);
    }

    #[test]
    fn test_positional_only_params() {
        let source = "def foo(x, /, y): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].params.len(), 2);
        assert_eq!(signatures[0].params[0].name, "x");
        assert_eq!(signatures[0].params[0].kind, ParamKind::PositionalOnly);
        assert_eq!(signatures[0].params[1].name, "y");
        assert_eq!(signatures[0].params[1].kind, ParamKind::Regular);
    }

    #[test]
    fn test_keyword_only_params() {
        let source = "def foo(x, *, y): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].params.len(), 2);
        assert_eq!(signatures[0].params[0].name, "x");
        assert_eq!(signatures[0].params[0].kind, ParamKind::Regular);
        assert_eq!(signatures[0].params[1].name, "y");
        assert_eq!(signatures[0].params[1].kind, ParamKind::KeywordOnly);
    }

    #[test]
    fn test_varargs_and_kwargs() {
        let source = "def foo(*args, **kwargs): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].params.len(), 2);
        assert_eq!(signatures[0].params[0].name, "args");
        assert_eq!(signatures[0].params[0].kind, ParamKind::VarArgs);
        assert_eq!(signatures[0].params[1].name, "kwargs");
        assert_eq!(signatures[0].params[1].kind, ParamKind::KwArgs);
    }

    #[test]
    fn test_all_param_kinds() {
        let source = "def foo(a, /, b, *args, c, **kwargs): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].params.len(), 5);
        assert_eq!(signatures[0].params[0].kind, ParamKind::PositionalOnly); // a
        assert_eq!(signatures[0].params[1].kind, ParamKind::Regular); // b
        assert_eq!(signatures[0].params[2].kind, ParamKind::VarArgs); // args
        assert_eq!(signatures[0].params[3].kind, ParamKind::KeywordOnly); // c
        assert_eq!(signatures[0].params[4].kind, ParamKind::KwArgs); // kwargs
    }

    #[test]
    fn test_return_type() {
        let source = "def foo() -> int: pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].returns, Some("int".to_string()));
    }

    #[test]
    fn test_param_annotations() {
        let source = "def foo(x: int, y: str) -> bool: pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].params[0].annotation, Some("int".to_string()));
        assert_eq!(signatures[0].params[1].annotation, Some("str".to_string()));
        assert_eq!(signatures[0].returns, Some("bool".to_string()));
    }

    #[test]
    fn test_async_function() {
        let source = "async def foo(): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert!(signatures[0].modifiers.contains(&Modifier::Async));
    }

    #[test]
    fn test_staticmethod_decorator() {
        let source = "@staticmethod\ndef foo(): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert!(signatures[0].modifiers.contains(&Modifier::Static));
    }

    #[test]
    fn test_classmethod_decorator() {
        let source = "@classmethod\ndef foo(cls): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert!(signatures[0].modifiers.contains(&Modifier::ClassMethod));
    }

    #[test]
    fn test_property_decorator() {
        let source = "@property\ndef name(self): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert!(signatures[0].modifiers.contains(&Modifier::Property));
    }

    #[test]
    fn test_abstractmethod_decorator() {
        let source = "@abstractmethod\ndef foo(self): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert!(signatures[0].modifiers.contains(&Modifier::Abstract));
    }

    #[test]
    fn test_method_in_class() {
        let source = "class Foo:\n    def bar(self): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(signatures[0].name, "bar");
        assert!(signatures[0].is_method);
        assert_eq!(signatures[0].scope_path, vec!["<module>", "Foo"]);
    }

    #[test]
    fn test_nested_function() {
        let source = "def outer():\n    def inner(): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 2);
        assert_eq!(signatures[0].name, "outer");
        assert_eq!(signatures[0].scope_path, vec!["<module>"]);
        assert_eq!(signatures[1].name, "inner");
        assert_eq!(signatures[1].scope_path, vec!["<module>", "outer"]);
    }

    #[test]
    fn test_complex_annotations() {
        let source = "def foo(x: List[int], y: Dict[str, int]) -> Optional[str]: pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert_eq!(
            signatures[0].params[0].annotation,
            Some("List[int]".to_string())
        );
        assert_eq!(
            signatures[0].params[1].annotation,
            Some("Dict[str, int]".to_string())
        );
        assert_eq!(signatures[0].returns, Some("Optional[str]".to_string()));
    }

    #[test]
    fn test_multiple_decorators() {
        let source = "@staticmethod\n@final\ndef foo(): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let signatures = SignatureCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(signatures.len(), 1);
        assert!(signatures[0].modifiers.contains(&Modifier::Static));
        assert!(signatures[0].modifiers.contains(&Modifier::Final));
    }
}
