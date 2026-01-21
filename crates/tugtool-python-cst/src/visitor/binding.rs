// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! BindingCollector visitor for Python name binding extraction.
//!
//! This module provides a [`BindingCollector`] visitor that traverses a CST and
//! collects all name bindings (definitions) with their kinds, scope paths, and spans.
//!
//! # What is a Binding?
//!
//! A binding is a name definition in Python code. This includes:
//! - **Function definitions**: `def foo():`
//! - **Class definitions**: `class Foo:`
//! - **Parameters**: function and lambda parameters
//! - **Variables**: assignment targets, loop variables
//! - **Imports**: `import foo`, `from bar import baz`
//!
//! # Span Extraction
//!
//! Spans are extracted from the [`PositionTable`] populated during CST inflation.
//! Each `Name` node has an embedded `node_id` that maps to its `ident_span` in
//! the position table. This provides accurate, token-derived positions without
//! relying on cursor-based string search.
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, BindingCollector, BindingInfo, BindingKind};
//!
//! let source = "def foo(): pass";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);
//! for binding in &bindings {
//!     println!("{}: {:?} at {:?}", binding.name, binding.kind, binding.span);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::{
    AnnAssign, Assign, AssignTargetExpression, ClassDef, Element, ExceptHandler, Expression, For,
    FunctionDef, Import, ImportFrom, ImportNames, Module, NameOrAttribute, NamedExpr, NodeId,
    Param, Span, With,
};

/// The kind of binding in Python.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BindingKind {
    /// Function definition (`def foo():`).
    Function,
    /// Class definition (`class Foo:`).
    Class,
    /// Function or lambda parameter.
    Parameter,
    /// Variable assignment target.
    Variable,
    /// Import statement (`import foo`).
    Import,
    /// Import alias (`import foo as bar`, `from x import y as z`).
    ImportAlias,
}

impl BindingKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            BindingKind::Function => "function",
            BindingKind::Class => "class",
            BindingKind::Parameter => "parameter",
            BindingKind::Variable => "variable",
            BindingKind::Import => "import",
            BindingKind::ImportAlias => "import_alias",
        }
    }
}

impl std::fmt::Display for BindingKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about a single binding in the Python source.
///
/// Each binding represents a name definition with its kind, the scope path
/// where it was defined, and the source span of the name.
#[derive(Debug, Clone)]
pub struct BindingInfo {
    /// The name being bound.
    pub name: String,
    /// The kind of binding.
    pub kind: BindingKind,
    /// The scope path where this binding was defined (e.g., `["<module>", "Foo", "bar"]`).
    pub scope_path: Vec<String>,
    /// Source span for the binding name (byte offsets).
    pub span: Option<Span>,
}

impl BindingInfo {
    /// Create a new BindingInfo.
    fn new(name: String, kind: BindingKind, scope_path: Vec<String>) -> Self {
        Self {
            name,
            kind,
            scope_path,
            span: None,
        }
    }

    /// Set the span for this binding.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }
}

/// A visitor that collects binding information from a Python CST.
///
/// BindingCollector traverses the CST and identifies all name bindings:
/// - Function and class definitions
/// - Parameters (function and lambda)
/// - Assignment targets (including tuple unpacking)
/// - For loop targets
/// - Import statements
/// - Except handler names
/// - With statement `as` targets
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);
/// ```
pub struct BindingCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected bindings.
    bindings: Vec<BindingInfo>,
    /// Current scope path for tracking where bindings are defined.
    scope_path: Vec<String>,
}

impl<'pos> BindingCollector<'pos> {
    /// Create a new BindingCollector without position tracking.
    ///
    /// Bindings will be collected but spans will be None.
    pub fn new() -> Self {
        Self {
            positions: None,
            bindings: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Create a new BindingCollector with position tracking.
    ///
    /// Bindings will include spans from the PositionTable.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            bindings: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Collect bindings from a parsed module with position information.
    ///
    /// This is the preferred method for collecting bindings with accurate spans.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    ///
    /// # Example
    ///
    /// ```ignore
    /// let parsed = parse_module_with_positions(source, None)?;
    /// let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);
    /// ```
    pub fn collect(module: &Module<'_>, positions: &'pos PositionTable) -> Vec<BindingInfo> {
        let mut collector = BindingCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.bindings
    }

    /// Get the collected bindings, consuming the collector.
    pub fn into_bindings(self) -> Vec<BindingInfo> {
        self.bindings
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Add a binding with span looked up from PositionTable.
    fn add_binding_with_id(&mut self, name: &str, kind: BindingKind, node_id: Option<NodeId>) {
        let span = self.lookup_span(node_id);
        let binding =
            BindingInfo::new(name.to_string(), kind, self.scope_path.clone()).with_span(span);
        self.bindings.push(binding);
    }

    /// Extract names from assignment target expressions (handles tuple unpacking).
    fn extract_assign_targets(&mut self, target: &AssignTargetExpression<'_>, kind: BindingKind) {
        match target {
            AssignTargetExpression::Name(name) => {
                self.add_binding_with_id(name.value, kind, name.node_id);
            }
            AssignTargetExpression::Tuple(tuple) => {
                self.extract_from_tuple_elements(&tuple.elements, kind);
            }
            AssignTargetExpression::List(list) => {
                self.extract_from_tuple_elements(&list.elements, kind);
            }
            AssignTargetExpression::StarredElement(starred) => {
                // For starred assignment, extract the inner value
                self.extract_from_expression(&starred.value, kind);
            }
            // Attribute and Subscript targets don't create bindings in the current scope
            AssignTargetExpression::Attribute(_) | AssignTargetExpression::Subscript(_) => {}
        }
    }

    /// Extract names from tuple/list elements.
    fn extract_from_tuple_elements(&mut self, elements: &[Element<'_>], kind: BindingKind) {
        for element in elements {
            match element {
                Element::Simple { value, .. } => {
                    self.extract_from_expression(value, kind);
                }
                Element::Starred(starred) => {
                    self.extract_from_expression(&starred.value, kind);
                }
            }
        }
    }

    /// Extract name bindings from an expression (used for walrus operator targets).
    fn extract_from_expression(&mut self, expr: &Expression<'_>, kind: BindingKind) {
        match expr {
            Expression::Name(name) => {
                self.add_binding_with_id(name.value, kind, name.node_id);
            }
            Expression::Tuple(tuple) => {
                self.extract_from_tuple_elements(&tuple.elements, kind);
            }
            Expression::List(list) => {
                self.extract_from_tuple_elements(&list.elements, kind);
            }
            Expression::StarredElement(starred) => {
                self.extract_from_expression(&starred.value, kind);
            }
            // Other expressions don't create bindings
            _ => {}
        }
    }

    /// Get the root name from a NameOrAttribute (for `import a.b.c`, returns `a`).
    fn get_root_name_with_id<'a>(
        &self,
        name_or_attr: &'a NameOrAttribute<'_>,
    ) -> Option<(&'a str, Option<NodeId>)> {
        match name_or_attr {
            NameOrAttribute::N(name) => Some((name.value, name.node_id)),
            NameOrAttribute::A(attr) => {
                // For a.b.c, get the leftmost name
                let mut current = &attr.value;
                loop {
                    match current.as_ref() {
                        Expression::Name(name) => return Some((name.value, name.node_id)),
                        Expression::Attribute(inner_attr) => {
                            current = &inner_attr.value;
                        }
                        _ => return None,
                    }
                }
            }
        }
    }
}

impl Default for BindingCollector<'_> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a, 'pos> Visitor<'a> for BindingCollector<'pos> {
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        // Record the function name as a binding
        self.add_binding_with_id(node.name.value, BindingKind::Function, node.name.node_id);
        // Enter the function scope
        self.scope_path.push(node.name.value.to_string());
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        // Record the class name as a binding
        self.add_binding_with_id(node.name.value, BindingKind::Class, node.name.node_id);
        // Enter the class scope
        self.scope_path.push(node.name.value.to_string());
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_param(&mut self, node: &Param<'a>) -> VisitResult {
        // Record parameters as bindings
        self.add_binding_with_id(node.name.value, BindingKind::Parameter, node.name.node_id);
        VisitResult::Continue
    }

    fn visit_assign(&mut self, node: &Assign<'a>) -> VisitResult {
        // Extract bindings from all targets
        for target in &node.targets {
            self.extract_assign_targets(&target.target, BindingKind::Variable);
        }
        VisitResult::Continue
    }

    fn visit_ann_assign(&mut self, node: &AnnAssign<'a>) -> VisitResult {
        // Extract binding from annotated assignment target
        self.extract_assign_targets(&node.target, BindingKind::Variable);
        VisitResult::Continue
    }

    fn visit_named_expr(&mut self, node: &NamedExpr<'a>) -> VisitResult {
        // Walrus operator creates a binding for its target
        self.extract_from_expression(&node.target, BindingKind::Variable);
        VisitResult::Continue
    }

    fn visit_for_stmt(&mut self, node: &For<'a>) -> VisitResult {
        // For loop target creates bindings
        self.extract_assign_targets(&node.target, BindingKind::Variable);
        VisitResult::Continue
    }

    fn visit_import_stmt(&mut self, node: &Import<'a>) -> VisitResult {
        // Handle `import a`, `import a.b.c`, `import a as b`
        for alias in &node.names {
            if let Some(asname) = &alias.asname {
                // `import foo as bar` - bar is the binding
                if let AssignTargetExpression::Name(name) = &asname.name {
                    self.add_binding_with_id(name.value, BindingKind::ImportAlias, name.node_id);
                }
            } else {
                // `import foo` or `import foo.bar.baz` - the root name is the binding
                if let Some((root_name, node_id)) = self.get_root_name_with_id(&alias.name) {
                    self.add_binding_with_id(root_name, BindingKind::Import, node_id);
                }
            }
        }
        // Don't visit children - we've already handled the imports
        VisitResult::SkipChildren
    }

    fn visit_import_from(&mut self, node: &ImportFrom<'a>) -> VisitResult {
        // Handle `from x import y`, `from x import y as z`, `from x import *`
        match &node.names {
            ImportNames::Star(_) => {
                // Star import - bind "*" as a special marker (no node_id for "*")
                let binding = BindingInfo::new(
                    "*".to_string(),
                    BindingKind::Import,
                    self.scope_path.clone(),
                );
                self.bindings.push(binding);
            }
            ImportNames::Aliases(aliases) => {
                for alias in aliases {
                    if let Some(asname) = &alias.asname {
                        // `from x import y as z` - z is the binding
                        if let AssignTargetExpression::Name(name) = &asname.name {
                            self.add_binding_with_id(
                                name.value,
                                BindingKind::ImportAlias,
                                name.node_id,
                            );
                        }
                    } else {
                        // `from x import y` - y is the binding
                        match &alias.name {
                            NameOrAttribute::N(name) => {
                                self.add_binding_with_id(
                                    name.value,
                                    BindingKind::Import,
                                    name.node_id,
                                );
                            }
                            NameOrAttribute::A(_) => {
                                // This shouldn't happen in a from import, but handle gracefully
                            }
                        }
                    }
                }
            }
        }
        // Don't visit children - we've already handled the imports
        VisitResult::SkipChildren
    }

    fn visit_except_handler(&mut self, node: &ExceptHandler<'a>) -> VisitResult {
        // Except handler with `as` clause: `except Exception as e:`
        if let Some(asname) = &node.name {
            if let AssignTargetExpression::Name(name) = &asname.name {
                self.add_binding_with_id(name.value, BindingKind::Variable, name.node_id);
            }
        }
        VisitResult::Continue
    }

    fn visit_with_stmt(&mut self, node: &With<'a>) -> VisitResult {
        // With statement `as` targets: `with open(f) as file:`
        for item in &node.items {
            if let Some(asname) = &item.asname {
                self.extract_assign_targets(&asname.name, BindingKind::Variable);
            }
        }
        VisitResult::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    // ========================================================================
    // Tests using collect() API
    // ========================================================================

    #[test]
    fn test_binding_function_def() {
        let source = "def foo():\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "foo");
        assert_eq!(bindings[0].kind, BindingKind::Function);
        assert_eq!(bindings[0].scope_path, vec!["<module>"]);
    }

    #[test]
    fn test_binding_class_def() {
        let source = "class Foo:\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "Foo");
        assert_eq!(bindings[0].kind, BindingKind::Class);
        assert_eq!(bindings[0].scope_path, vec!["<module>"]);
    }

    #[test]
    fn test_binding_parameters() {
        let source = "def foo(a, b, c):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        // Function + 3 parameters
        assert_eq!(bindings.len(), 4);
        assert_eq!(bindings[0].name, "foo");
        assert_eq!(bindings[0].kind, BindingKind::Function);

        assert_eq!(bindings[1].name, "a");
        assert_eq!(bindings[1].kind, BindingKind::Parameter);
        assert_eq!(bindings[1].scope_path, vec!["<module>", "foo"]);

        assert_eq!(bindings[2].name, "b");
        assert_eq!(bindings[2].kind, BindingKind::Parameter);

        assert_eq!(bindings[3].name, "c");
        assert_eq!(bindings[3].kind, BindingKind::Parameter);
    }

    #[test]
    fn test_binding_simple_assignment() {
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "x");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_tuple_unpacking() {
        let source = "a, b, c = values";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 3);
        assert_eq!(bindings[0].name, "a");
        assert_eq!(bindings[1].name, "b");
        assert_eq!(bindings[2].name, "c");
        for b in &bindings {
            assert_eq!(b.kind, BindingKind::Variable);
        }
    }

    #[test]
    fn test_binding_nested_tuple_unpacking() {
        let source = "(a, (b, c)), d = values";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 4);
        let names: Vec<_> = bindings.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"a"));
        assert!(names.contains(&"b"));
        assert!(names.contains(&"c"));
        assert!(names.contains(&"d"));
    }

    #[test]
    fn test_binding_import() {
        let source = "import foo";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "foo");
        assert_eq!(bindings[0].kind, BindingKind::Import);
    }

    #[test]
    fn test_binding_import_dotted() {
        let source = "import foo.bar.baz";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        // `import foo.bar.baz` binds `foo` (the root)
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "foo");
        assert_eq!(bindings[0].kind, BindingKind::Import);
    }

    #[test]
    fn test_binding_import_as() {
        let source = "import foo as bar";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "bar");
        assert_eq!(bindings[0].kind, BindingKind::ImportAlias);
    }

    #[test]
    fn test_binding_from_import() {
        let source = "from os import path";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "path");
        assert_eq!(bindings[0].kind, BindingKind::Import);
    }

    #[test]
    fn test_binding_from_import_as() {
        let source = "from os import path as p";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "p");
        assert_eq!(bindings[0].kind, BindingKind::ImportAlias);
    }

    #[test]
    fn test_binding_from_import_star() {
        let source = "from os import *";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "*");
        assert_eq!(bindings[0].kind, BindingKind::Import);
    }

    #[test]
    fn test_binding_for_loop() {
        let source = "for i in range(10):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "i");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_for_loop_tuple_unpacking() {
        let source = "for k, v in items:\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[0].name, "k");
        assert_eq!(bindings[1].name, "v");
        for b in &bindings {
            assert_eq!(b.kind, BindingKind::Variable);
        }
    }

    #[test]
    fn test_binding_except_handler() {
        let source = "try:\n    pass\nexcept Exception as e:\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "e");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_with_statement() {
        let source = "with open('f') as file:\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "file");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_with_statement_tuple() {
        let source = "with ctx() as (a, b):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[0].name, "a");
        assert_eq!(bindings[1].name, "b");
    }

    #[test]
    fn test_binding_annotated_assignment() {
        let source = "x: int = 5";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "x");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_walrus_operator() {
        let source = "if (x := 5) > 0:\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "x");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_nested_scope() {
        let source = r#"class Outer:
    def method(self):
        x = 1
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        // class Outer, def method, param self, var x
        assert_eq!(bindings.len(), 4);

        assert_eq!(bindings[0].name, "Outer");
        assert_eq!(bindings[0].scope_path, vec!["<module>"]);

        assert_eq!(bindings[1].name, "method");
        assert_eq!(bindings[1].scope_path, vec!["<module>", "Outer"]);

        assert_eq!(bindings[2].name, "self");
        assert_eq!(bindings[2].scope_path, vec!["<module>", "Outer", "method"]);

        assert_eq!(bindings[3].name, "x");
        assert_eq!(bindings[3].scope_path, vec!["<module>", "Outer", "method"]);
    }

    #[test]
    fn test_binding_multiple_imports() {
        let source = "from os import path, getcwd";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[0].name, "path");
        assert_eq!(bindings[1].name, "getcwd");
    }

    #[test]
    fn test_binding_chained_assignment() {
        let source = "x = y = z = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 3);
        let names: Vec<_> = bindings.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"x"));
        assert!(names.contains(&"y"));
        assert!(names.contains(&"z"));
    }

    #[test]
    fn test_binding_starred_assignment() {
        let source = "first, *rest, last = items";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 3);
        let names: Vec<_> = bindings.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"first"));
        assert!(names.contains(&"rest"));
        assert!(names.contains(&"last"));
    }

    #[test]
    fn test_binding_lambda_params() {
        let source = "f = lambda a, b: a + b";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        // var f, params a and b
        assert_eq!(bindings.len(), 3);
        assert_eq!(bindings[0].name, "f");
        assert_eq!(bindings[0].kind, BindingKind::Variable);

        assert_eq!(bindings[1].name, "a");
        assert_eq!(bindings[1].kind, BindingKind::Parameter);

        assert_eq!(bindings[2].name, "b");
        assert_eq!(bindings[2].kind, BindingKind::Parameter);
    }

    // ========================================================================
    // Tests for span verification
    // ========================================================================

    #[test]
    fn test_binding_spans_match_token_positions() {
        let source = "def foo(): pass";
        //            01234567890123456
        //                ^foo: 4-7

        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "foo");

        let span = bindings[0].span.expect("Should have span");
        assert_eq!(span.start, 4, "'foo' should start at byte 4");
        assert_eq!(span.end, 7, "'foo' should end at byte 7");
    }

    #[test]
    fn test_binding_spans_for_variable() {
        let source = "my_var = 42";
        //            01234567890
        //            ^my_var: 0-6

        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        let span = bindings[0].span.expect("Should have span");
        assert_eq!(span.start, 0);
        assert_eq!(span.end, 6);
    }

    #[test]
    fn test_multiple_bindings_same_name_have_distinct_spans() {
        // Key test: multiple bindings with same name should have correct distinct spans
        let source = "x = 1\nx = 2\nx = 3";
        //            01234 56789 01234
        //            ^x:0  ^x:6  ^x:12

        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 3, "Should have 3 bindings");

        // All bindings should be named "x"
        for b in &bindings {
            assert_eq!(b.name, "x");
        }

        // Each should have a distinct span
        let spans: Vec<_> = bindings
            .iter()
            .filter_map(|b| b.span)
            .map(|s| s.start)
            .collect();

        assert_eq!(spans.len(), 3, "All bindings should have spans");
        assert!(
            spans.contains(&0),
            "Should have span starting at 0, got {:?}",
            spans
        );
        assert!(
            spans.contains(&6),
            "Should have span starting at 6, got {:?}",
            spans
        );
        assert!(
            spans.contains(&12),
            "Should have span starting at 12, got {:?}",
            spans
        );
    }

    #[test]
    fn test_binding_spans_for_parameters() {
        let source = "def add(first, second): pass";
        //            0123456789012345678901234567
        //                    ^first:8-13 ^second:15-21

        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        // Function "add" + params "first" and "second"
        assert_eq!(bindings.len(), 3);

        let add_binding = &bindings[0];
        assert_eq!(add_binding.name, "add");
        let add_span = add_binding.span.expect("add should have span");
        assert_eq!(add_span.start, 4); // "add" at position 4
        assert_eq!(add_span.end, 7);

        let first_binding = &bindings[1];
        assert_eq!(first_binding.name, "first");
        let first_span = first_binding.span.expect("first should have span");
        assert_eq!(first_span.start, 8);
        assert_eq!(first_span.end, 13);

        let second_binding = &bindings[2];
        assert_eq!(second_binding.name, "second");
        let second_span = second_binding.span.expect("second should have span");
        assert_eq!(second_span.start, 15);
        assert_eq!(second_span.end, 21);
    }

    #[test]
    fn test_binding_spans_in_nested_scope() {
        let source = r#"class A:
    def m(self):
        x = 1
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        // class A, def m, param self, var x
        assert_eq!(bindings.len(), 4);

        // All should have spans
        for b in &bindings {
            assert!(b.span.is_some(), "Binding '{}' should have span", b.name);
        }

        // Verify the span text matches the binding name
        for b in &bindings {
            if let Some(span) = b.span {
                let text = &source[span.start as usize..span.end as usize];
                assert_eq!(
                    text, b.name,
                    "Span text should match binding name for '{}'",
                    b.name
                );
            }
        }
    }

    #[test]
    fn test_binding_spans_for_import() {
        let source = "from os import path";
        //            01234567890123456789
        //                           ^path:15-19

        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "path");

        let span = bindings[0].span.expect("Should have span");
        assert_eq!(span.start, 15);
        assert_eq!(span.end, 19);
    }

    #[test]
    fn test_binding_spans_for_chained_assignment() {
        let source = "a = b = c = 1";
        //            0123456789012
        //            ^a  ^b  ^c
        //            0   4   8

        let parsed = parse_module_with_positions(source, None).unwrap();
        let bindings = BindingCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(bindings.len(), 3);

        // Verify each has a span at the correct position
        let a_binding = bindings.iter().find(|b| b.name == "a").unwrap();
        let b_binding = bindings.iter().find(|b| b.name == "b").unwrap();
        let c_binding = bindings.iter().find(|b| b.name == "c").unwrap();

        assert_eq!(a_binding.span.unwrap().start, 0);
        assert_eq!(b_binding.span.unwrap().start, 4);
        assert_eq!(c_binding.span.unwrap().start, 8);
    }
}
