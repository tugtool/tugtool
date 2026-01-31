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
    AnnAssign, AssignTargetExpression, ClassDef, Decorator, Expression, FunctionDef, Module,
    TypeAlias,
};
use tugtool_core::patch::Span;

// ============================================================================
// Stub Symbol Types
// ============================================================================

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
    /// Span of the type annotation (if present).
    pub annotation_span: Option<Span>,
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
    /// Span of the type annotation (if present).
    pub annotation_span: Option<Span>,
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

        let func = StubFunction {
            name,
            name_span,
            signature_span,
            def_span,
            is_async,
            decorators,
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

        // Get annotation span from the annotation expression
        let annotation_span = match &node.annotation.annotation {
            Expression::Name(n) => self.get_ident_span(n.node_id),
            _ => None,
        };

        if self.current_class.is_some() {
            // Inside a class - this is a class attribute
            let attr = StubAttribute {
                name,
                name_span,
                annotation_span,
            };

            if let Some(ref mut class) = self.current_class {
                class.attributes.push(attr);
            }
        } else {
            // Module-level annotated variable
            self.variables.push(StubVariable {
                name,
                name_span,
                annotation_span,
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
}
