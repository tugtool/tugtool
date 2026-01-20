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
//! # Usage
//!
//! ```ignore
//! use tugtool_cst::{parse_module, BindingCollector, BindingInfo, BindingKind};
//!
//! let source = "def foo(): pass";
//! let module = parse_module(source, None)?;
//!
//! let bindings = BindingCollector::collect(&module, source);
//! for binding in &bindings {
//!     println!("{}: {:?}", binding.name, binding.kind);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::nodes::{
    AnnAssign, Assign, AssignTargetExpression, ClassDef, Element, ExceptHandler, Expression, For,
    FunctionDef, Import, ImportFrom, ImportNames, Module, NameOrAttribute, NamedExpr, Param,
    Span, With,
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
/// let bindings = BindingCollector::collect(&module, source);
/// ```
pub struct BindingCollector<'src> {
    /// The original source text (for span calculation).
    source: &'src str,
    /// Collected bindings.
    bindings: Vec<BindingInfo>,
    /// Current scope path for tracking where bindings are defined.
    scope_path: Vec<String>,
    /// Current search cursor position in the source.
    cursor: usize,
}

impl<'src> BindingCollector<'src> {
    /// Create a new BindingCollector.
    pub fn new(source: &'src str) -> Self {
        Self {
            source,
            bindings: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            cursor: 0,
        }
    }

    /// Collect bindings from a parsed module.
    ///
    /// Returns the list of bindings in the order they were encountered.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `source` - The original source code (must match what was parsed)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let source = "x = 1";
    /// let module = parse_module(source, None)?;
    /// let bindings = BindingCollector::collect(&module, source);
    /// ```
    pub fn collect(module: &Module<'_>, source: &'src str) -> Vec<BindingInfo> {
        let mut collector = BindingCollector::new(source);
        walk_module(&mut collector, module);
        collector.bindings
    }

    /// Get the collected bindings, consuming the collector.
    pub fn into_bindings(self) -> Vec<BindingInfo> {
        self.bindings
    }

    /// Find a string in the source starting from the cursor, and advance cursor past it.
    ///
    /// Returns the span if found.
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

    /// Add a binding with a name found in the source.
    fn add_binding(&mut self, name: &str, kind: BindingKind) {
        let span = self.find_and_advance(name);
        let binding = BindingInfo::new(name.to_string(), kind, self.scope_path.clone())
            .with_span(span);
        self.bindings.push(binding);
    }

    /// Extract names from assignment target expressions (handles tuple unpacking).
    fn extract_assign_targets(&mut self, target: &AssignTargetExpression<'_>, kind: BindingKind) {
        match target {
            AssignTargetExpression::Name(name) => {
                self.add_binding(name.value, kind);
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
                self.add_binding(name.value, kind);
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
    fn get_root_name<'a>(&self, name_or_attr: &'a NameOrAttribute<'_>) -> Option<&'a str> {
        match name_or_attr {
            NameOrAttribute::N(name) => Some(name.value),
            NameOrAttribute::A(attr) => {
                // For a.b.c, get the leftmost name
                let mut current = &attr.value;
                loop {
                    match current.as_ref() {
                        Expression::Name(name) => return Some(name.value),
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

impl<'a, 'src> Visitor<'a> for BindingCollector<'src> {
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        // Record the function name as a binding
        self.add_binding(node.name.value, BindingKind::Function);
        // Enter the function scope
        self.scope_path.push(node.name.value.to_string());
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        // Record the class name as a binding
        self.add_binding(node.name.value, BindingKind::Class);
        // Enter the class scope
        self.scope_path.push(node.name.value.to_string());
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_param(&mut self, node: &Param<'a>) -> VisitResult {
        // Record parameters as bindings
        self.add_binding(node.name.value, BindingKind::Parameter);
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
                    self.add_binding(name.value, BindingKind::ImportAlias);
                }
            } else {
                // `import foo` or `import foo.bar.baz` - the root name is the binding
                if let Some(root_name) = self.get_root_name(&alias.name) {
                    self.add_binding(root_name, BindingKind::Import);
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
                // Star import - bind "*" as a special marker
                self.add_binding("*", BindingKind::Import);
            }
            ImportNames::Aliases(aliases) => {
                for alias in aliases {
                    if let Some(asname) = &alias.asname {
                        // `from x import y as z` - z is the binding
                        if let AssignTargetExpression::Name(name) = &asname.name {
                            self.add_binding(name.value, BindingKind::ImportAlias);
                        }
                    } else {
                        // `from x import y` - y is the binding
                        match &alias.name {
                            NameOrAttribute::N(name) => {
                                self.add_binding(name.value, BindingKind::Import);
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
                self.add_binding(name.value, BindingKind::Variable);
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
    use crate::parse_module;

    #[test]
    fn test_binding_function_def() {
        let source = "def foo():\n    pass";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "foo");
        assert_eq!(bindings[0].kind, BindingKind::Function);
        assert_eq!(bindings[0].scope_path, vec!["<module>"]);
    }

    #[test]
    fn test_binding_class_def() {
        let source = "class Foo:\n    pass";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "Foo");
        assert_eq!(bindings[0].kind, BindingKind::Class);
        assert_eq!(bindings[0].scope_path, vec!["<module>"]);
    }

    #[test]
    fn test_binding_parameters() {
        let source = "def foo(a, b, c):\n    pass";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "x");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_tuple_unpacking() {
        let source = "a, b, c = values";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "foo");
        assert_eq!(bindings[0].kind, BindingKind::Import);
    }

    #[test]
    fn test_binding_import_dotted() {
        let source = "import foo.bar.baz";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        // `import foo.bar.baz` binds `foo` (the root)
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "foo");
        assert_eq!(bindings[0].kind, BindingKind::Import);
    }

    #[test]
    fn test_binding_import_as() {
        let source = "import foo as bar";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "bar");
        assert_eq!(bindings[0].kind, BindingKind::ImportAlias);
    }

    #[test]
    fn test_binding_from_import() {
        let source = "from os import path";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "path");
        assert_eq!(bindings[0].kind, BindingKind::Import);
    }

    #[test]
    fn test_binding_from_import_as() {
        let source = "from os import path as p";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "p");
        assert_eq!(bindings[0].kind, BindingKind::ImportAlias);
    }

    #[test]
    fn test_binding_from_import_star() {
        let source = "from os import *";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "*");
        assert_eq!(bindings[0].kind, BindingKind::Import);
    }

    #[test]
    fn test_binding_for_loop() {
        let source = "for i in range(10):\n    pass";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "i");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_for_loop_tuple_unpacking() {
        let source = "for k, v in items:\n    pass";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "e");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_with_statement() {
        let source = "with open('f') as file:\n    pass";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "file");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_with_statement_tuple() {
        let source = "with ctx() as (a, b):\n    pass";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[0].name, "a");
        assert_eq!(bindings[1].name, "b");
    }

    #[test]
    fn test_binding_annotated_assignment() {
        let source = "x: int = 5";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].name, "x");
        assert_eq!(bindings[0].kind, BindingKind::Variable);
    }

    #[test]
    fn test_binding_walrus_operator() {
        let source = "if (x := 5) > 0:\n    pass";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[0].name, "path");
        assert_eq!(bindings[1].name, "getcwd");
    }

    #[test]
    fn test_binding_chained_assignment() {
        let source = "x = y = z = 1";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 3);
        let names: Vec<_> = bindings.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"x"));
        assert!(names.contains(&"y"));
        assert!(names.contains(&"z"));
    }

    #[test]
    fn test_binding_starred_assignment() {
        let source = "first, *rest, last = items";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        assert_eq!(bindings.len(), 3);
        let names: Vec<_> = bindings.iter().map(|b| b.name.as_str()).collect();
        assert!(names.contains(&"first"));
        assert!(names.contains(&"rest"));
        assert!(names.contains(&"last"));
    }

    #[test]
    fn test_binding_lambda_params() {
        let source = "f = lambda a, b: a + b";
        let module = parse_module(source, None).unwrap();
        let bindings = BindingCollector::collect(&module, source);

        // var f, params a and b
        assert_eq!(bindings.len(), 3);
        assert_eq!(bindings[0].name, "f");
        assert_eq!(bindings[0].kind, BindingKind::Variable);

        assert_eq!(bindings[1].name, "a");
        assert_eq!(bindings[1].kind, BindingKind::Parameter);

        assert_eq!(bindings[2].name, "b");
        assert_eq!(bindings[2].kind, BindingKind::Parameter);
    }
}
