// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! ScopeCollector visitor for Python scope hierarchy extraction.
//!
//! This module provides a [`ScopeCollector`] visitor that traverses a CST and
//! builds a list of [`ScopeInfo`] structures representing the scope hierarchy.
//!
//! # Python Scoping Rules
//!
//! Python has several types of scopes:
//! - **Module**: The top-level scope of a file
//! - **Class**: Class body scope (special rules for name lookup)
//! - **Function**: Function/method body scope
//! - **Lambda**: Lambda expression scope
//! - **Comprehension**: List/set/dict comprehension and generator expression scope
//!
//! # Global and Nonlocal Declarations
//!
//! Within function scopes, `global` and `nonlocal` statements modify how names
//! are resolved:
//! - `global x` - `x` refers to module-level binding
//! - `nonlocal x` - `x` refers to enclosing function scope binding
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_cst::{parse_module, ScopeCollector, ScopeInfo, ScopeKind};
//!
//! let source = "def foo(): pass";
//! let module = parse_module(source, None)?;
//!
//! let scopes = ScopeCollector::collect(&module, source);
//! for scope in &scopes {
//!     println!("Scope: {:?} kind={:?}", scope.id, scope.kind);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::nodes::{
    ClassDef, DictComp, FunctionDef, GeneratorExp, Global, Lambda, ListComp, Module, Nonlocal,
    SetComp, Span,
};

/// The kind of scope in Python.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScopeKind {
    /// Module-level scope (top-level of a file).
    Module,
    /// Class body scope.
    Class,
    /// Function or method body scope.
    Function,
    /// Lambda expression scope.
    Lambda,
    /// Comprehension scope (list/set/dict comp, generator expression).
    Comprehension,
}

impl ScopeKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            ScopeKind::Module => "module",
            ScopeKind::Class => "class",
            ScopeKind::Function => "function",
            ScopeKind::Lambda => "lambda",
            ScopeKind::Comprehension => "comprehension",
        }
    }
}

impl std::fmt::Display for ScopeKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about a single scope in the Python source.
///
/// Each scope has a unique ID, a kind indicating what created it, an optional
/// name (for functions and classes), and tracks any `global` or `nonlocal`
/// declarations within it.
#[derive(Debug, Clone)]
pub struct ScopeInfo {
    /// Unique identifier for this scope (e.g., "scope_0", "scope_1").
    pub id: String,
    /// The kind of scope.
    pub kind: ScopeKind,
    /// The name of the function or class that created this scope, if applicable.
    pub name: Option<String>,
    /// The ID of the parent scope, or None for the module scope.
    pub parent: Option<String>,
    /// Source span for the scope (byte offsets).
    pub span: Option<Span>,
    /// Names declared as `global` in this scope.
    pub globals: Vec<String>,
    /// Names declared as `nonlocal` in this scope.
    pub nonlocals: Vec<String>,
}

impl ScopeInfo {
    /// Create a new ScopeInfo.
    fn new(id: String, kind: ScopeKind, name: Option<String>, parent: Option<String>) -> Self {
        Self {
            id,
            kind,
            name,
            parent,
            span: None,
            globals: Vec::new(),
            nonlocals: Vec::new(),
        }
    }

    /// Set the span for this scope.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }
}

/// A visitor that collects scope information from a Python CST.
///
/// ScopeCollector traverses the CST and identifies all scopes, tracking:
/// - Scope hierarchy (parent-child relationships)
/// - Scope kinds (module, class, function, lambda, comprehension)
/// - Global and nonlocal declarations within each scope
///
/// # Example
///
/// ```ignore
/// let scopes = ScopeCollector::collect(&module, source);
/// ```
pub struct ScopeCollector<'src> {
    /// The original source text (for span calculation).
    source: &'src str,
    /// Collected scopes.
    scopes: Vec<ScopeInfo>,
    /// Stack of scope IDs for tracking the current scope.
    scope_stack: Vec<String>,
    /// Counter for generating unique scope IDs.
    next_scope_id: u32,
    /// Current search cursor position in the source.
    cursor: usize,
}

impl<'src> ScopeCollector<'src> {
    /// Create a new ScopeCollector.
    pub fn new(source: &'src str) -> Self {
        Self {
            source,
            scopes: Vec::new(),
            scope_stack: Vec::new(),
            next_scope_id: 0,
            cursor: 0,
        }
    }

    /// Collect scopes from a parsed module.
    ///
    /// Returns the list of scopes in the order they were encountered.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `source` - The original source code (must match what was parsed)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let source = "def foo(): pass";
    /// let module = parse_module(source, None)?;
    /// let scopes = ScopeCollector::collect(&module, source);
    /// ```
    pub fn collect(module: &Module<'_>, source: &'src str) -> Vec<ScopeInfo> {
        let mut collector = ScopeCollector::new(source);
        walk_module(&mut collector, module);
        collector.scopes
    }

    /// Get the collected scopes, consuming the collector.
    pub fn into_scopes(self) -> Vec<ScopeInfo> {
        self.scopes
    }

    /// Generate a new unique scope ID.
    fn generate_scope_id(&mut self) -> String {
        let id = format!("scope_{}", self.next_scope_id);
        self.next_scope_id += 1;
        id
    }

    /// Get the current parent scope ID.
    fn current_parent(&self) -> Option<String> {
        self.scope_stack.last().cloned()
    }

    /// Get the current scope ID.
    fn current_scope_id(&self) -> Option<&str> {
        self.scope_stack.last().map(|s| s.as_str())
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

    /// Enter a new scope.
    fn enter_scope(&mut self, kind: ScopeKind, name: Option<&str>, keyword: &str) {
        let scope_id = self.generate_scope_id();
        let parent = self.current_parent();

        // Find the span for this scope by looking for the keyword
        let span = self.find_and_advance(keyword);

        let scope = ScopeInfo::new(
            scope_id.clone(),
            kind,
            name.map(|s| s.to_string()),
            parent,
        )
        .with_span(span);

        self.scopes.push(scope);
        self.scope_stack.push(scope_id);
    }

    /// Exit the current scope.
    fn exit_scope(&mut self) {
        self.scope_stack.pop();
    }
}

impl<'a, 'src> Visitor<'a> for ScopeCollector<'src> {
    fn visit_module(&mut self, _node: &Module<'a>) -> VisitResult {
        // Module scope - no keyword to find, starts at beginning
        let scope_id = self.generate_scope_id();
        let scope = ScopeInfo::new(scope_id.clone(), ScopeKind::Module, None, None)
            .with_span(Some(Span::new(0, self.source.len() as u64)));

        self.scopes.push(scope);
        self.scope_stack.push(scope_id);
        VisitResult::Continue
    }

    fn leave_module(&mut self, _node: &Module<'a>) {
        self.exit_scope();
    }

    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        self.enter_scope(ScopeKind::Function, Some(node.name.value), "def");
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.exit_scope();
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        self.enter_scope(ScopeKind::Class, Some(node.name.value), "class");
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.exit_scope();
    }

    fn visit_lambda(&mut self, _node: &Lambda<'a>) -> VisitResult {
        self.enter_scope(ScopeKind::Lambda, None, "lambda");
        VisitResult::Continue
    }

    fn leave_lambda(&mut self, _node: &Lambda<'a>) {
        self.exit_scope();
    }

    fn visit_list_comp(&mut self, _node: &ListComp<'a>) -> VisitResult {
        // List comprehensions create their own scope in Python 3
        self.enter_scope(ScopeKind::Comprehension, None, "[");
        VisitResult::Continue
    }

    fn leave_list_comp(&mut self, _node: &ListComp<'a>) {
        self.exit_scope();
    }

    fn visit_set_comp(&mut self, _node: &SetComp<'a>) -> VisitResult {
        self.enter_scope(ScopeKind::Comprehension, None, "{");
        VisitResult::Continue
    }

    fn leave_set_comp(&mut self, _node: &SetComp<'a>) {
        self.exit_scope();
    }

    fn visit_dict_comp(&mut self, _node: &DictComp<'a>) -> VisitResult {
        self.enter_scope(ScopeKind::Comprehension, None, "{");
        VisitResult::Continue
    }

    fn leave_dict_comp(&mut self, _node: &DictComp<'a>) {
        self.exit_scope();
    }

    fn visit_generator_exp(&mut self, _node: &GeneratorExp<'a>) -> VisitResult {
        self.enter_scope(ScopeKind::Comprehension, None, "(");
        VisitResult::Continue
    }

    fn leave_generator_exp(&mut self, _node: &GeneratorExp<'a>) {
        self.exit_scope();
    }

    fn visit_global_stmt(&mut self, node: &Global<'a>) -> VisitResult {
        // Record global declarations in the current scope
        if let Some(scope_id) = self.current_scope_id() {
            let scope_id = scope_id.to_string();
            for name_item in &node.names {
                // Find the scope and add the global name
                for scope in &mut self.scopes {
                    if scope.id == scope_id {
                        scope.globals.push(name_item.name.value.to_string());
                        break;
                    }
                }
            }
        }
        // Don't visit children - we've already extracted the names
        VisitResult::SkipChildren
    }

    fn visit_nonlocal_stmt(&mut self, node: &Nonlocal<'a>) -> VisitResult {
        // Record nonlocal declarations in the current scope
        if let Some(scope_id) = self.current_scope_id() {
            let scope_id = scope_id.to_string();
            for name_item in &node.names {
                // Find the scope and add the nonlocal name
                for scope in &mut self.scopes {
                    if scope.id == scope_id {
                        scope.nonlocals.push(name_item.name.value.to_string());
                        break;
                    }
                }
            }
        }
        // Don't visit children - we've already extracted the names
        VisitResult::SkipChildren
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module;

    #[test]
    fn test_scope_simple_function() {
        let source = "def foo():\n    pass";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 2);

        // Module scope
        assert_eq!(scopes[0].id, "scope_0");
        assert_eq!(scopes[0].kind, ScopeKind::Module);
        assert!(scopes[0].name.is_none());
        assert!(scopes[0].parent.is_none());

        // Function scope
        assert_eq!(scopes[1].id, "scope_1");
        assert_eq!(scopes[1].kind, ScopeKind::Function);
        assert_eq!(scopes[1].name, Some("foo".to_string()));
        assert_eq!(scopes[1].parent, Some("scope_0".to_string()));
    }

    #[test]
    fn test_scope_nested_functions() {
        let source = "def outer():\n    def inner():\n        pass";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 3);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);

        // Outer function scope
        assert_eq!(scopes[1].kind, ScopeKind::Function);
        assert_eq!(scopes[1].name, Some("outer".to_string()));
        assert_eq!(scopes[1].parent, Some("scope_0".to_string()));

        // Inner function scope
        assert_eq!(scopes[2].kind, ScopeKind::Function);
        assert_eq!(scopes[2].name, Some("inner".to_string()));
        assert_eq!(scopes[2].parent, Some("scope_1".to_string()));
    }

    #[test]
    fn test_scope_class_with_methods() {
        let source = "class Foo:\n    def bar(self):\n        pass";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 3);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);

        // Class scope
        assert_eq!(scopes[1].kind, ScopeKind::Class);
        assert_eq!(scopes[1].name, Some("Foo".to_string()));
        assert_eq!(scopes[1].parent, Some("scope_0".to_string()));

        // Method scope (function inside class)
        assert_eq!(scopes[2].kind, ScopeKind::Function);
        assert_eq!(scopes[2].name, Some("bar".to_string()));
        assert_eq!(scopes[2].parent, Some("scope_1".to_string()));
    }

    #[test]
    fn test_scope_comprehensions() {
        let source = "x = [i for i in range(10)]";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 2);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);

        // Comprehension scope
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
        assert!(scopes[1].name.is_none());
        assert_eq!(scopes[1].parent, Some("scope_0".to_string()));
    }

    #[test]
    fn test_scope_lambda() {
        let source = "f = lambda x: x + 1";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 2);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);

        // Lambda scope
        assert_eq!(scopes[1].kind, ScopeKind::Lambda);
        assert!(scopes[1].name.is_none());
        assert_eq!(scopes[1].parent, Some("scope_0".to_string()));
    }

    #[test]
    fn test_scope_global_declaration() {
        let source = "x = 1\ndef foo():\n    global x\n    x = 2";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 2);

        // Module scope should have no globals (global is declared in function)
        assert!(scopes[0].globals.is_empty());

        // Function scope should have x as global
        assert_eq!(scopes[1].globals, vec!["x"]);
        assert!(scopes[1].nonlocals.is_empty());
    }

    #[test]
    fn test_scope_nonlocal_declaration() {
        let source = "def outer():\n    x = 1\n    def inner():\n        nonlocal x\n        x = 2";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 3);

        // Module scope
        assert!(scopes[0].globals.is_empty());
        assert!(scopes[0].nonlocals.is_empty());

        // Outer function scope
        assert!(scopes[1].globals.is_empty());
        assert!(scopes[1].nonlocals.is_empty());

        // Inner function scope should have x as nonlocal
        assert!(scopes[2].globals.is_empty());
        assert_eq!(scopes[2].nonlocals, vec!["x"]);
    }

    #[test]
    fn test_scope_multiple_global_names() {
        let source = "def foo():\n    global x, y, z";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].globals, vec!["x", "y", "z"]);
    }

    #[test]
    fn test_scope_generator_expression() {
        let source = "g = (x for x in range(10))";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 2);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);

        // Generator expression scope (comprehension)
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
    }

    #[test]
    fn test_scope_dict_comprehension() {
        let source = "d = {k: v for k, v in items}";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
    }

    #[test]
    fn test_scope_set_comprehension() {
        let source = "s = {x for x in items}";
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
    }

    #[test]
    fn test_scope_complex_hierarchy() {
        let source = r#"class Outer:
    x = [i for i in range(10)]

    def method(self):
        y = lambda z: z + 1
"#;
        let module = parse_module(source, None).unwrap();
        let scopes = ScopeCollector::collect(&module, source);

        // Module, Class, Comprehension, Function, Lambda
        assert_eq!(scopes.len(), 5);

        assert_eq!(scopes[0].kind, ScopeKind::Module);
        assert_eq!(scopes[1].kind, ScopeKind::Class);
        assert_eq!(scopes[1].name, Some("Outer".to_string()));
        assert_eq!(scopes[2].kind, ScopeKind::Comprehension);
        assert_eq!(scopes[2].parent, Some("scope_1".to_string())); // Inside class
        assert_eq!(scopes[3].kind, ScopeKind::Function);
        assert_eq!(scopes[3].name, Some("method".to_string()));
        assert_eq!(scopes[4].kind, ScopeKind::Lambda);
        assert_eq!(scopes[4].parent, Some("scope_3".to_string())); // Inside method
    }
}
