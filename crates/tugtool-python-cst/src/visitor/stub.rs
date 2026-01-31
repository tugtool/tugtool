// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! StubCollector visitor for extracting symbols from Python stub files (.pyi).
//!
//! This module provides a [`StubCollector`] visitor that traverses a CST and
//! collects information about functions, classes, type aliases, and variables
//! from stub files.
//!
//! # What is Collected?
//!
//! - **Functions**: Name, spans, async status, decorators
//! - **Classes**: Name, spans, methods, attributes
//! - **Type aliases**: Name, spans (Python 3.12+ `type X = ...` syntax)
//! - **Variables**: Module-level annotated variables
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, StubSymbols};
//!
//! let source = r#"
//! def foo() -> int: ...
//! class Handler:
//!     def process(self) -> None: ...
//! "#;
//!
//! let parsed = parse_module_with_positions(source, None)?;
//! let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);
//!
//! assert_eq!(symbols.functions.len(), 1);
//! assert_eq!(symbols.classes.len(), 1);
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{
    AnnAssign, Annotation, AssignTargetExpression, BaseSlice, ClassDef, Decorator, Element,
    Expression, FunctionDef, Module, Param, Parameters, StarArg, SubscriptElement, TypeAlias,
};
use tugtool_core::patch::Span;

// ============================================================================
// Stub Symbol Types
// ============================================================================

/// A type name and its span within an annotation.
///
/// Used for precise type reference tracking in stub file annotations.
/// Each instance represents a single type name (not a composite type).
///
/// # Example
///
/// For the annotation `List[Handler]`, two `TypeNameSpan` instances are created:
/// - `TypeNameSpan { name: "List", span: ... }`
/// - `TypeNameSpan { name: "Handler", span: ... }`
#[derive(Debug, Clone)]
pub struct TypeNameSpan {
    /// The exact type name as it appears in source (e.g., "Handler", "List", "str").
    pub name: String,
    /// Span of this specific type name.
    pub span: Span,
}

/// Decorator information from a stub file.
///
/// Captures decorator names for functions and methods in stub files.
/// Decorators are important for understanding method properties
/// (e.g., @staticmethod, @classmethod, @property).
#[derive(Debug, Clone)]
pub struct StubDecorator {
    /// The decorator name (e.g., "staticmethod", "classmethod", "property").
    pub name: String,
    /// Span of the entire decorator (from @ to end of expression).
    pub span: Option<Span>,
}

/// Information about a function in a stub file.
///
/// Captures the essential spans and metadata for a function definition
/// in a .pyi file, enabling rename operations and symbol lookups.
#[derive(Debug, Clone)]
pub struct StubFunction {
    /// The function name.
    pub name: String,
    /// Span of just the function name (for rename operations).
    pub name_span: Option<Span>,
    /// Span of the function signature (from `def`/`async def` through closing paren).
    pub signature_span: Option<Span>,
    /// Span of the entire definition (including decorators).
    pub def_span: Option<Span>,
    /// Whether this is an async function.
    pub is_async: bool,
    /// Decorators applied to this function.
    pub decorators: Vec<StubDecorator>,
    /// All type name spans within the return annotation.
    ///
    /// For `-> Handler`, returns `[("Handler", span)]`.
    /// For `-> List[Handler]`, returns `[("List", span1), ("Handler", span2)]`.
    /// Empty if no return annotation.
    pub return_type_spans: Vec<TypeNameSpan>,
    /// Parameters with their type annotations.
    pub params: Vec<StubParam>,
}

/// Information about a function parameter in a stub file.
///
/// Captures parameter name and type annotation information for functions
/// and methods in stub files.
#[derive(Debug, Clone)]
pub struct StubParam {
    /// The parameter name.
    pub name: String,
    /// Span of just the parameter name.
    pub name_span: Option<Span>,
    /// All type name spans within the parameter annotation.
    ///
    /// For `handler: Handler`, returns `[("Handler", span)]`.
    /// For `items: List[Handler]`, returns `[("List", span1), ("Handler", span2)]`.
    /// Empty if no annotation.
    pub type_spans: Vec<TypeNameSpan>,
    /// Whether this is a *args parameter.
    pub is_star: bool,
    /// Whether this is a **kwargs parameter.
    pub is_star_star: bool,
}

/// Information about a class attribute in a stub file.
///
/// Captures annotated attributes defined at class level.
#[derive(Debug, Clone)]
pub struct StubAttribute {
    /// The attribute name.
    pub name: String,
    /// Span of just the attribute name.
    pub name_span: Option<Span>,
    /// All type name spans within the attribute annotation.
    ///
    /// For `handler: Handler`, returns `[("Handler", span)]`.
    /// For `items: List[Handler]`, returns `[("List", span1), ("Handler", span2)]`.
    /// Empty if no annotation.
    pub type_spans: Vec<TypeNameSpan>,
}

/// Information about a class in a stub file.
///
/// Captures class definitions with their methods and attributes,
/// enabling method lookups and class-level rename operations.
#[derive(Debug, Clone)]
pub struct StubClass {
    /// The class name.
    pub name: String,
    /// Span of just the class name (for rename operations).
    pub name_span: Option<Span>,
    /// Span of the class header (from `class` through colon).
    pub header_span: Option<Span>,
    /// Span of the entire class definition (including decorators).
    pub def_span: Option<Span>,
    /// Methods defined in this class.
    pub methods: Vec<StubFunction>,
    /// Attributes defined in this class.
    pub attributes: Vec<StubAttribute>,
}

/// Information about a type alias in a stub file.
///
/// Type aliases are defined with the `type X = ...` syntax (Python 3.12+).
#[derive(Debug, Clone)]
pub struct StubTypeAlias {
    /// The type alias name.
    pub name: String,
    /// Span of just the name (for rename operations).
    pub name_span: Option<Span>,
    /// Span of the entire definition.
    pub def_span: Option<Span>,
}

/// Information about a module-level variable in a stub file.
///
/// Captures annotated variables defined at module level.
#[derive(Debug, Clone)]
pub struct StubVariable {
    /// The variable name.
    pub name: String,
    /// Span of just the variable name.
    pub name_span: Option<Span>,
    /// All type name spans within the variable annotation.
    ///
    /// For `handler: Handler`, returns `[("Handler", span)]`.
    /// For `items: List[Handler]`, returns `[("List", span1), ("Handler", span2)]`.
    /// Empty if no annotation.
    pub type_spans: Vec<TypeNameSpan>,
}

/// Collected stub symbols from CST traversal.
///
/// Contains all the symbols extracted from a stub file, ready
/// for use by higher-level parsing APIs.
#[derive(Debug, Default, Clone)]
pub struct StubSymbols {
    /// Module-level functions.
    pub functions: Vec<StubFunction>,
    /// Class definitions.
    pub classes: Vec<StubClass>,
    /// Type aliases (Python 3.12+ `type X = ...` syntax).
    pub type_aliases: Vec<StubTypeAlias>,
    /// Module-level annotated variables.
    pub variables: Vec<StubVariable>,
}

impl StubSymbols {
    /// Collect symbols from a parsed module.
    ///
    /// This is the main entry point for stub symbol collection.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let parsed = parse_module_with_positions(source, None)?;
    /// let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);
    /// ```
    pub fn collect(module: &Module<'_>, positions: &PositionTable) -> Self {
        let mut collector = StubCollector::new(positions);
        walk_module(&mut collector, module);
        collector.into_symbols()
    }

    /// Check if a symbol exists by name.
    ///
    /// Checks functions, classes, type aliases, and variables.
    pub fn has_symbol(&self, name: &str) -> bool {
        self.functions.iter().any(|f| f.name == name)
            || self.classes.iter().any(|c| c.name == name)
            || self.type_aliases.iter().any(|t| t.name == name)
            || self.variables.iter().any(|v| v.name == name)
    }

    /// Find a function by name.
    pub fn find_function(&self, name: &str) -> Option<&StubFunction> {
        self.functions.iter().find(|f| f.name == name)
    }

    /// Find a class by name.
    pub fn find_class(&self, name: &str) -> Option<&StubClass> {
        self.classes.iter().find(|c| c.name == name)
    }

    /// Find a method within a class.
    pub fn find_method(&self, class_name: &str, method_name: &str) -> Option<&StubFunction> {
        self.find_class(class_name)
            .and_then(|c| c.methods.iter().find(|m| m.name == method_name))
    }
}

// ============================================================================
// StubCollector Visitor
// ============================================================================

/// Internal visitor for collecting stub symbols from a Python CST.
///
/// This visitor traverses a parsed stub file and extracts:
/// - Module-level functions
/// - Class definitions with their methods and attributes
/// - Type aliases
/// - Module-level variables
struct StubCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: &'pos PositionTable,
    /// Collected module-level functions.
    functions: Vec<StubFunction>,
    /// Collected class definitions.
    classes: Vec<StubClass>,
    /// Collected type aliases.
    type_aliases: Vec<StubTypeAlias>,
    /// Collected module-level variables.
    variables: Vec<StubVariable>,
    /// Current class being processed (for method collection).
    current_class: Option<StubClass>,
}

impl<'pos> StubCollector<'pos> {
    /// Create a new StubCollector with position tracking.
    fn new(positions: &'pos PositionTable) -> Self {
        Self {
            positions,
            functions: Vec::new(),
            classes: Vec::new(),
            type_aliases: Vec::new(),
            variables: Vec::new(),
            current_class: None,
        }
    }

    /// Convert the collector into the collected symbols.
    fn into_symbols(self) -> StubSymbols {
        StubSymbols {
            functions: self.functions,
            classes: self.classes,
            type_aliases: self.type_aliases,
            variables: self.variables,
        }
    }

    /// Get the identifier span for a node.
    fn get_ident_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let id = node_id?;
        self.positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Get the lexical span for a node.
    fn get_lexical_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let id = node_id?;
        self.positions.get(&id).and_then(|pos| pos.lexical_span)
    }

    /// Get the definition span for a node.
    fn get_def_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let id = node_id?;
        self.positions.get(&id).and_then(|pos| pos.def_span)
    }

    /// Extract decorator information from a decorator node.
    fn extract_decorator(&self, decorator: &Decorator<'_>) -> StubDecorator {
        let name = match &decorator.decorator {
            Expression::Name(n) => n.value.to_string(),
            Expression::Attribute(attr) => attr.attr.value.to_string(),
            Expression::Call(call) => match call.func.as_ref() {
                Expression::Name(n) => n.value.to_string(),
                Expression::Attribute(attr) => attr.attr.value.to_string(),
                _ => "<unknown>".to_string(),
            },
            _ => "<unknown>".to_string(),
        };

        // Get span from the decorator expression
        let span = match &decorator.decorator {
            Expression::Name(n) => self.get_ident_span(n.node_id),
            _ => None,
        };

        StubDecorator { name, span }
    }

    /// Extract all type name spans from an annotation expression.
    ///
    /// Recursively walks the expression tree and collects spans for every
    /// type name encountered. This enables precise rename matching without
    /// string-based pattern matching.
    ///
    /// # Handled Expression Types
    ///
    /// | Expression | Extracted Names |
    /// |------------|-----------------|
    /// | `Name("Handler")` | `[("Handler", span)]` |
    /// | `Subscript(List, [Handler])` | `[("List", span1), ("Handler", span2)]` |
    /// | `Attribute(module, Type)` | `[("Type", span)]` (attr only, not module) |
    /// | `BinaryOperation(A, \|, B)` | Recurse both sides |
    /// | `Tuple([A, B])` | Recurse all elements |
    /// | `List([A, B])` | Recurse all elements (for Callable params) |
    ///
    /// # Returns
    ///
    /// Vector of `TypeNameSpan` for all type names in the annotation.
    /// Empty vector if annotation contains no extractable type names.
    fn extract_all_type_spans(&self, annotation: &Annotation<'_>) -> Vec<TypeNameSpan> {
        let mut spans = Vec::new();
        self.collect_type_spans_from_expr(&annotation.annotation, &mut spans);
        spans
    }

    /// Recursive helper to collect type spans from an expression.
    fn collect_type_spans_from_expr(&self, expr: &Expression<'_>, spans: &mut Vec<TypeNameSpan>) {
        match expr {
            Expression::Name(n) => {
                if let Some(span) = self.get_ident_span(n.node_id) {
                    spans.push(TypeNameSpan {
                        name: n.value.to_string(),
                        span,
                    });
                }
            }
            Expression::Subscript(sub) => {
                // Collect the base type (e.g., "List" from List[T])
                self.collect_type_spans_from_expr(&sub.value, spans);
                // Collect all type arguments
                for element in &sub.slice {
                    self.collect_type_spans_from_subscript_element(element, spans);
                }
            }
            Expression::Attribute(attr) => {
                // For module.Type, only collect "Type" (the attribute)
                // The module path is not a type reference
                if let Some(span) = self.get_ident_span(attr.attr.node_id) {
                    spans.push(TypeNameSpan {
                        name: attr.attr.value.to_string(),
                        span,
                    });
                }
            }
            Expression::BinaryOperation(binop) => {
                // For union types (A | B), collect both sides
                self.collect_type_spans_from_expr(&binop.left, spans);
                self.collect_type_spans_from_expr(&binop.right, spans);
            }
            Expression::Tuple(tuple) => {
                // For Callable[[A, B], C] the params are sometimes a tuple
                for elem in &tuple.elements {
                    if let Element::Simple { value, .. } = elem {
                        self.collect_type_spans_from_expr(value, spans);
                    }
                }
            }
            Expression::List(list) => {
                // Callable parameter lists: [[Handler, Request], Response]
                for elem in &list.elements {
                    if let Element::Simple { value, .. } = elem {
                        self.collect_type_spans_from_expr(value, spans);
                    }
                }
            }
            // Other expression types don't contain type references
            // (strings handled separately, literals ignored)
            _ => {}
        }
    }

    /// Helper for subscript slice elements.
    fn collect_type_spans_from_subscript_element(
        &self,
        element: &SubscriptElement<'_>,
        spans: &mut Vec<TypeNameSpan>,
    ) {
        match &element.slice {
            BaseSlice::Index(idx) => {
                self.collect_type_spans_from_expr(&idx.value, spans);
            }
            BaseSlice::Slice(_) => {
                // Slice subscripts (a[1:2]) don't contain type references
            }
        }
    }

    /// Extract parameter information from a Param node.
    fn extract_param(&self, param: &Param<'_>, is_star: bool, is_star_star: bool) -> StubParam {
        let name = param.name.value.to_string();
        let name_span = self.get_ident_span(param.name.node_id);

        let type_spans = param
            .annotation
            .as_ref()
            .map(|ann| self.extract_all_type_spans(ann))
            .unwrap_or_default();

        StubParam {
            name,
            name_span,
            type_spans,
            is_star,
            is_star_star,
        }
    }

    /// Extract all parameters from a Parameters node.
    fn extract_params(&self, params: &Parameters<'_>) -> Vec<StubParam> {
        let mut result = Vec::new();

        // 1. Positional-only parameters
        for param in &params.posonly_params {
            result.push(self.extract_param(param, false, false));
        }

        // 2. Regular positional parameters
        for param in &params.params {
            result.push(self.extract_param(param, false, false));
        }

        // 3. *args parameter (if StarArg::Param variant)
        if let Some(StarArg::Param(star_param)) = &params.star_arg {
            result.push(self.extract_param(star_param, true, false));
        }

        // 4. Keyword-only parameters
        for param in &params.kwonly_params {
            result.push(self.extract_param(param, false, false));
        }

        // 5. **kwargs parameter
        if let Some(kwargs) = &params.star_kwarg {
            result.push(self.extract_param(kwargs, false, true));
        }

        result
    }

    /// Process a function definition.
    fn process_function(&mut self, node: &FunctionDef<'_>) {
        let name = node.name.value.to_string();
        let is_async = node.asynchronous.is_some();

        // Get spans
        let name_span = self.get_ident_span(node.name.node_id);

        // Signature span: use lexical span as approximation
        let signature_span = self.get_lexical_span(node.node_id);

        // Definition span: includes decorators
        let def_span = self
            .get_def_span(node.node_id)
            .or_else(|| self.get_lexical_span(node.node_id));

        // Extract decorators
        let decorators: Vec<StubDecorator> = node
            .decorators
            .iter()
            .map(|d| self.extract_decorator(d))
            .collect();

        // Extract all type name spans from return annotation
        let return_type_spans = node
            .returns
            .as_ref()
            .map(|ann| self.extract_all_type_spans(ann))
            .unwrap_or_default();

        // Extract parameter annotations
        let params = self.extract_params(&node.params);

        let func = StubFunction {
            name,
            name_span,
            signature_span,
            def_span,
            is_async,
            decorators,
            return_type_spans,
            params,
        };

        // Add to current class if we're inside one, otherwise to module level
        if let Some(ref mut class) = self.current_class {
            class.methods.push(func);
        } else {
            self.functions.push(func);
        }
    }

    /// Process a class definition and return the initial class struct.
    fn process_class(&self, node: &ClassDef<'_>) -> StubClass {
        let name = node.name.value.to_string();

        // Get spans
        let name_span = self.get_ident_span(node.name.node_id);
        let header_span = self.get_lexical_span(node.node_id);
        let def_span = self
            .get_def_span(node.node_id)
            .or_else(|| self.get_lexical_span(node.node_id));

        StubClass {
            name,
            name_span,
            header_span,
            def_span,
            methods: Vec::new(),
            attributes: Vec::new(),
        }
    }

    /// Process an annotated assignment and extract attribute/variable info.
    fn process_ann_assign(&mut self, node: &AnnAssign<'_>) {
        // Extract the target name - node.target is AssignTargetExpression, not Expression
        let (name, name_span) = match &node.target {
            AssignTargetExpression::Name(name_node) => {
                let name = name_node.value.to_string();
                let span = self.get_ident_span(name_node.node_id);
                (name, span)
            }
            _ => return, // Only handle simple name targets
        };

        // Get all type spans from the annotation
        let type_spans = self.extract_all_type_spans(&node.annotation);

        if self.current_class.is_some() {
            // Inside a class - this is a class attribute
            let attr = StubAttribute {
                name,
                name_span,
                type_spans,
            };

            if let Some(ref mut class) = self.current_class {
                class.attributes.push(attr);
            }
        } else {
            // Module-level annotated variable
            self.variables.push(StubVariable {
                name,
                name_span,
                type_spans,
            });
        }
    }
}

impl<'a, 'pos> Visitor<'a> for StubCollector<'pos> {
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        self.process_function(node);
        // Don't recurse into function bodies for stub files
        VisitResult::SkipChildren
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        // Start collecting a new class
        let class = self.process_class(node);
        self.current_class = Some(class);
        // Continue to collect methods and attributes
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        // Finish the current class and add it to the list
        if let Some(class) = self.current_class.take() {
            self.classes.push(class);
        }
    }

    fn visit_type_alias(&mut self, node: &TypeAlias<'a>) -> VisitResult {
        let name = node.name.value.to_string();
        let name_span = self.get_ident_span(node.name.node_id);
        let def_span = self.get_lexical_span(node.node_id);

        self.type_aliases.push(StubTypeAlias {
            name,
            name_span,
            def_span,
        });

        VisitResult::SkipChildren
    }

    fn visit_ann_assign(&mut self, node: &AnnAssign<'a>) -> VisitResult {
        self.process_ann_assign(node);
        VisitResult::SkipChildren
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_collect_function() {
        let source = "def foo() -> int: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        assert_eq!(symbols.functions[0].name, "foo");
        assert!(!symbols.functions[0].is_async);
        assert!(symbols.functions[0].name_span.is_some());
    }

    #[test]
    fn test_collect_async_function() {
        let source = "async def bar() -> str: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        assert_eq!(symbols.functions[0].name, "bar");
        assert!(symbols.functions[0].is_async);
    }

    #[test]
    fn test_collect_function_with_decorators() {
        let source = "@staticmethod\ndef method() -> None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        assert_eq!(symbols.functions[0].decorators.len(), 1);
        assert_eq!(symbols.functions[0].decorators[0].name, "staticmethod");
    }

    #[test]
    fn test_collect_class() {
        let source = "class Handler:\n    def process(self) -> None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.classes.len(), 1);
        assert_eq!(symbols.classes[0].name, "Handler");
        assert_eq!(symbols.classes[0].methods.len(), 1);
        assert_eq!(symbols.classes[0].methods[0].name, "process");
    }

    #[test]
    fn test_collect_class_attributes() {
        let source = "class Config:\n    debug: bool\n    timeout: int";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.classes.len(), 1);
        assert_eq!(symbols.classes[0].attributes.len(), 2);
        assert_eq!(symbols.classes[0].attributes[0].name, "debug");
        assert_eq!(symbols.classes[0].attributes[1].name, "timeout");
    }

    #[test]
    fn test_collect_type_alias() {
        let source = "type Handler = Callable[[bytes], str]";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.type_aliases.len(), 1);
        assert_eq!(symbols.type_aliases[0].name, "Handler");
    }

    #[test]
    fn test_collect_module_variable() {
        let source = "VERSION: str";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.variables.len(), 1);
        assert_eq!(symbols.variables[0].name, "VERSION");
    }

    #[test]
    fn test_has_symbol() {
        let source = "def foo(): ...\nclass Bar: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert!(symbols.has_symbol("foo"));
        assert!(symbols.has_symbol("Bar"));
        assert!(!symbols.has_symbol("baz"));
    }

    #[test]
    fn test_find_function() {
        let source = "def alpha(): ...\ndef beta(): ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert!(symbols.find_function("alpha").is_some());
        assert!(symbols.find_function("beta").is_some());
        assert!(symbols.find_function("gamma").is_none());
    }

    #[test]
    fn test_find_class() {
        let source = "class First: ...\nclass Second: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert!(symbols.find_class("First").is_some());
        assert!(symbols.find_class("Second").is_some());
        assert!(symbols.find_class("Third").is_none());
    }

    #[test]
    fn test_find_method() {
        let source = "class Handler:\n    def process(self): ...\n    def reset(self): ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert!(symbols.find_method("Handler", "process").is_some());
        assert!(symbols.find_method("Handler", "reset").is_some());
        assert!(symbols.find_method("Handler", "unknown").is_none());
        assert!(symbols.find_method("Unknown", "process").is_none());
    }

    #[test]
    fn test_example_3_from_plan() {
        // Example 3 from phase-13.md
        let stub_content = r#"
from typing import Optional

class Handler:
    def process(self, data: bytes) -> Optional[str]: ...
    def reset(self) -> None: ...

def create_handler(config: dict) -> Handler: ...
"#;

        let parsed = parse_module_with_positions(stub_content, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        // Verify Example 3 assertions
        assert!(symbols.has_symbol("Handler"));
        assert!(symbols.has_symbol("create_handler"));

        let handler_class = symbols.find_class("Handler").unwrap();
        assert_eq!(handler_class.methods.len(), 2);

        let process_method = symbols.find_method("Handler", "process").unwrap();
        assert_eq!(process_method.name, "process");
    }

    #[test]
    fn test_multiple_decorators() {
        let source = "@abstractmethod\n@property\ndef value(self) -> int: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        assert_eq!(symbols.functions[0].decorators.len(), 2);
        assert_eq!(symbols.functions[0].decorators[0].name, "abstractmethod");
        assert_eq!(symbols.functions[0].decorators[1].name, "property");
    }

    #[test]
    fn test_nested_class_methods() {
        let source = r#"
class Outer:
    class Inner:
        def inner_method(self): ...
    def outer_method(self): ...
"#;
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        // The collector should handle nested classes
        // Note: Current implementation treats nested classes simply
        assert!(!symbols.classes.is_empty());
    }

    // ========================================================================
    // Tests for annotation span tracking (Step 0.3.6.6.5 → 0.3.6.6.6)
    // Updated to use Vec<TypeNameSpan> for comprehensive type name tracking
    // ========================================================================

    #[test]
    fn test_stub_function_return_type_spans_simple() {
        let source = "def f() -> Handler: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        // Should have single return type span for simple type name
        assert_eq!(func.return_type_spans.len(), 1);
        let span = &func.return_type_spans[0];
        assert_eq!(span.name, "Handler");
        assert_eq!(&source[span.span.start..span.span.end], "Handler");
    }

    #[test]
    fn test_stub_function_return_type_spans_generic() {
        let source = "def f() -> List[Handler]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        // For List[Handler], should have both List AND Handler spans
        assert_eq!(func.return_type_spans.len(), 2);
        assert_eq!(func.return_type_spans[0].name, "List");
        assert_eq!(
            &source[func.return_type_spans[0].span.start..func.return_type_spans[0].span.end],
            "List"
        );
        assert_eq!(func.return_type_spans[1].name, "Handler");
        assert_eq!(
            &source[func.return_type_spans[1].span.start..func.return_type_spans[1].span.end],
            "Handler"
        );
    }

    #[test]
    fn test_stub_function_return_type_spans_qualified() {
        let source = "def f() -> module.Type: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        // For module.Type, get only 'Type' (the attribute part, not module)
        assert_eq!(func.return_type_spans.len(), 1);
        assert_eq!(func.return_type_spans[0].name, "Type");
        assert_eq!(
            &source[func.return_type_spans[0].span.start..func.return_type_spans[0].span.end],
            "Type"
        );
    }

    #[test]
    fn test_stub_function_return_type_spans_union() {
        let source = "def f() -> Handler | None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        // For union types, capture both sides
        assert_eq!(func.return_type_spans.len(), 2);
        assert_eq!(func.return_type_spans[0].name, "Handler");
        assert_eq!(func.return_type_spans[1].name, "None");
    }

    #[test]
    fn test_stub_function_param_type_spans() {
        let source = "def f(a: A, b: B) -> None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        // Should have 2 params
        assert_eq!(func.params.len(), 2);

        // First param: a: A
        assert_eq!(func.params[0].name, "a");
        assert_eq!(func.params[0].type_spans.len(), 1);
        assert_eq!(func.params[0].type_spans[0].name, "A");
        assert_eq!(
            &source[func.params[0].type_spans[0].span.start..func.params[0].type_spans[0].span.end],
            "A"
        );

        // Second param: b: B
        assert_eq!(func.params[1].name, "b");
        assert_eq!(func.params[1].type_spans.len(), 1);
        assert_eq!(func.params[1].type_spans[0].name, "B");
        assert_eq!(
            &source[func.params[1].type_spans[0].span.start..func.params[1].type_spans[0].span.end],
            "B"
        );
    }

    #[test]
    fn test_stub_function_param_self_no_annotation() {
        let source = "def f(self, x: int) -> None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        assert_eq!(func.params.len(), 2);

        // self has no annotation (empty type_spans)
        assert_eq!(func.params[0].name, "self");
        assert!(func.params[0].type_spans.is_empty());

        // x has annotation
        assert_eq!(func.params[1].name, "x");
        assert_eq!(func.params[1].type_spans.len(), 1);
        assert_eq!(func.params[1].type_spans[0].name, "int");
    }

    #[test]
    fn test_stub_function_param_no_annotation() {
        let source = "def f(x, y: int) -> None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        assert_eq!(func.params.len(), 2);

        // x has no annotation (empty type_spans)
        assert_eq!(func.params[0].name, "x");
        assert!(func.params[0].type_spans.is_empty());

        // y has annotation
        assert_eq!(func.params[1].name, "y");
        assert_eq!(func.params[1].type_spans.len(), 1);
        assert_eq!(func.params[1].type_spans[0].name, "int");
    }

    #[test]
    fn test_stub_function_param_star_args() {
        let source = "def func(*args: str) -> None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        assert_eq!(func.params.len(), 1);

        // *args
        assert_eq!(func.params[0].name, "args");
        assert!(func.params[0].is_star);
        assert!(!func.params[0].is_star_star);
        assert_eq!(func.params[0].type_spans.len(), 1);
        let span = &func.params[0].type_spans[0];
        assert_eq!(span.name, "str");
        assert_eq!(&source[span.span.start..span.span.end], "str");
    }

    #[test]
    fn test_stub_function_param_star_kwargs() {
        let source = "def func(**kwargs: int) -> None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        assert_eq!(func.params.len(), 1);

        // **kwargs
        assert_eq!(func.params[0].name, "kwargs");
        assert!(!func.params[0].is_star);
        assert!(func.params[0].is_star_star);
        assert_eq!(func.params[0].type_spans.len(), 1);
        let span = &func.params[0].type_spans[0];
        assert_eq!(span.name, "int");
        assert_eq!(&source[span.span.start..span.span.end], "int");
    }

    #[test]
    fn test_stub_function_param_all_kinds() {
        let source = "def f(a, /, b, *args, c, **kwargs) -> T: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.functions.len(), 1);
        let func = &symbols.functions[0];

        // Should have: a (posonly), b (regular), args (*), c (kwonly), kwargs (**)
        assert_eq!(func.params.len(), 5);

        assert_eq!(func.params[0].name, "a"); // positional-only
        assert_eq!(func.params[1].name, "b"); // regular
        assert_eq!(func.params[2].name, "args"); // *args
        assert!(func.params[2].is_star);
        assert_eq!(func.params[3].name, "c"); // keyword-only
        assert_eq!(func.params[4].name, "kwargs"); // **kwargs
        assert!(func.params[4].is_star_star);

        // Return type
        assert_eq!(func.return_type_spans.len(), 1);
        assert_eq!(func.return_type_spans[0].name, "T");
        assert_eq!(
            &source[func.return_type_spans[0].span.start..func.return_type_spans[0].span.end],
            "T"
        );
    }

    #[test]
    fn test_stub_method_annotations() {
        let source = "class Service:\n    def process(self, handler: Handler) -> Result: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.classes.len(), 1);
        let class = &symbols.classes[0];
        assert_eq!(class.methods.len(), 1);

        let method = &class.methods[0];
        assert_eq!(method.name, "process");

        // Check return type
        assert_eq!(method.return_type_spans.len(), 1);
        assert_eq!(method.return_type_spans[0].name, "Result");
        assert_eq!(
            &source[method.return_type_spans[0].span.start..method.return_type_spans[0].span.end],
            "Result"
        );

        // Check parameters
        assert_eq!(method.params.len(), 2);

        // self has no annotation (empty type_spans)
        assert_eq!(method.params[0].name, "self");
        assert!(method.params[0].type_spans.is_empty());

        // handler has Handler annotation
        assert_eq!(method.params[1].name, "handler");
        assert_eq!(method.params[1].type_spans.len(), 1);
        assert_eq!(method.params[1].type_spans[0].name, "Handler");
        assert_eq!(
            &source[method.params[1].type_spans[0].span.start
                ..method.params[1].type_spans[0].span.end],
            "Handler"
        );
    }

    // ========================================================================
    // New tests for CST-based annotation span collection (Step 0.3.6.6.6)
    // ========================================================================

    #[test]
    fn test_extract_type_spans_simple() {
        // Handler → [("Handler", span)]
        let source = "def f() -> Handler: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 1);
        assert_eq!(func.return_type_spans[0].name, "Handler");
    }

    #[test]
    fn test_extract_type_spans_generic() {
        // List[Handler] → [("List", s1), ("Handler", s2)]
        let source = "def f() -> List[Handler]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 2);
        assert_eq!(func.return_type_spans[0].name, "List");
        assert_eq!(func.return_type_spans[1].name, "Handler");
    }

    #[test]
    fn test_extract_type_spans_nested_generic() {
        // Dict[str, Handler] → [("Dict", s1), ("str", s2), ("Handler", s3)]
        let source = "def f() -> Dict[str, Handler]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 3);
        assert_eq!(func.return_type_spans[0].name, "Dict");
        assert_eq!(func.return_type_spans[1].name, "str");
        assert_eq!(func.return_type_spans[2].name, "Handler");
    }

    #[test]
    fn test_extract_type_spans_deeply_nested() {
        // Optional[List[Handler]] → [("Optional", s1), ("List", s2), ("Handler", s3)]
        let source = "def f() -> Optional[List[Handler]]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 3);
        assert_eq!(func.return_type_spans[0].name, "Optional");
        assert_eq!(func.return_type_spans[1].name, "List");
        assert_eq!(func.return_type_spans[2].name, "Handler");
    }

    #[test]
    fn test_extract_type_spans_union() {
        // Handler | None → [("Handler", s1), ("None", s2)]
        let source = "def f() -> Handler | None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 2);
        assert_eq!(func.return_type_spans[0].name, "Handler");
        assert_eq!(func.return_type_spans[1].name, "None");
    }

    #[test]
    fn test_extract_type_spans_union_generic() {
        // List[Handler] | None → [("List", s1), ("Handler", s2), ("None", s3)]
        let source = "def f() -> List[Handler] | None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 3);
        assert_eq!(func.return_type_spans[0].name, "List");
        assert_eq!(func.return_type_spans[1].name, "Handler");
        assert_eq!(func.return_type_spans[2].name, "None");
    }

    #[test]
    fn test_extract_type_spans_callable() {
        // Callable[[Handler], Response] → [("Callable", s1), ("Handler", s2), ("Response", s3)]
        let source = "def f() -> Callable[[Handler], Response]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 3);
        assert_eq!(func.return_type_spans[0].name, "Callable");
        assert_eq!(func.return_type_spans[1].name, "Handler");
        assert_eq!(func.return_type_spans[2].name, "Response");
    }

    #[test]
    fn test_extract_type_spans_callable_multi_param() {
        // Callable[[A, B], C] → 4 spans
        let source = "def f() -> Callable[[A, B], C]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 4);
        assert_eq!(func.return_type_spans[0].name, "Callable");
        assert_eq!(func.return_type_spans[1].name, "A");
        assert_eq!(func.return_type_spans[2].name, "B");
        assert_eq!(func.return_type_spans[3].name, "C");
    }

    #[test]
    fn test_extract_type_spans_qualified() {
        // typing.List[Handler] → [("List", s1), ("Handler", s2)] (no `typing`)
        let source = "def f() -> typing.List[Handler]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 2);
        assert_eq!(func.return_type_spans[0].name, "List");
        assert_eq!(func.return_type_spans[1].name, "Handler");
    }

    #[test]
    fn test_extract_type_spans_complex() {
        // Dict[str, Optional[List[Handler]]] → 5 spans
        let source = "def f() -> Dict[str, Optional[List[Handler]]]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 5);
        assert_eq!(func.return_type_spans[0].name, "Dict");
        assert_eq!(func.return_type_spans[1].name, "str");
        assert_eq!(func.return_type_spans[2].name, "Optional");
        assert_eq!(func.return_type_spans[3].name, "List");
        assert_eq!(func.return_type_spans[4].name, "Handler");
    }

    #[test]
    fn test_stub_function_return_type_spans_populated() {
        // Verify return_type_spans populated correctly
        let source = "def process() -> Optional[Handler]: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.return_type_spans.len(), 2);
        // Verify spans are correct positions
        assert_eq!(
            &source[func.return_type_spans[0].span.start..func.return_type_spans[0].span.end],
            "Optional"
        );
        assert_eq!(
            &source[func.return_type_spans[1].span.start..func.return_type_spans[1].span.end],
            "Handler"
        );
    }

    #[test]
    fn test_stub_param_type_spans_populated() {
        // Verify type_spans populated correctly
        let source = "def process(x: List[Handler]) -> None: ...";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        let func = &symbols.functions[0];
        assert_eq!(func.params.len(), 1);
        assert_eq!(func.params[0].type_spans.len(), 2);
        assert_eq!(func.params[0].type_spans[0].name, "List");
        assert_eq!(func.params[0].type_spans[1].name, "Handler");
    }

    #[test]
    fn test_stub_variable_type_spans_populated() {
        // Verify type_spans populated correctly
        let source = "handlers: List[Handler]";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.variables.len(), 1);
        assert_eq!(symbols.variables[0].type_spans.len(), 2);
        assert_eq!(symbols.variables[0].type_spans[0].name, "List");
        assert_eq!(symbols.variables[0].type_spans[1].name, "Handler");
    }

    #[test]
    fn test_stub_attribute_type_spans_populated() {
        // Verify type_spans populated correctly for class attributes
        let source = "class Foo:\n    handler: Optional[Handler]";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

        assert_eq!(symbols.classes.len(), 1);
        assert_eq!(symbols.classes[0].attributes.len(), 1);
        assert_eq!(symbols.classes[0].attributes[0].type_spans.len(), 2);
        assert_eq!(
            symbols.classes[0].attributes[0].type_spans[0].name,
            "Optional"
        );
        assert_eq!(
            symbols.classes[0].attributes[0].type_spans[1].name,
            "Handler"
        );
    }
}
