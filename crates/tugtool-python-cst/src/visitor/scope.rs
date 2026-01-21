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
//! # Span Extraction
//!
//! Lexical spans for scopes are extracted from the [`PositionTable`] populated
//! during CST inflation. `FunctionDef` and `ClassDef` nodes have `lexical_span`
//! recorded during inflation, which defines where variables resolve to that scope.
//!
//! **Important:** Lexical spans do NOT include decorators. Decorators execute
//! before the scope exists, so the lexical span starts at `def` or `class`.
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, ScopeCollector, ScopeInfo, ScopeKind};
//!
//! let source = "def foo(): pass";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);
//! for scope in &scopes {
//!     println!("Scope: {:?} kind={:?}", scope.id, scope.kind);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::{
    ClassDef, DictComp, FunctionDef, GeneratorExp, Global, Lambda, ListComp, Module, NodeId,
    Nonlocal, SetComp, Span,
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
/// - Lexical spans for each scope (from PositionTable)
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);
/// ```
pub struct ScopeCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Length of source (for module scope span).
    source_len: usize,
    /// Collected scopes.
    scopes: Vec<ScopeInfo>,
    /// Stack of scope IDs for tracking the current scope.
    scope_stack: Vec<String>,
    /// Counter for generating unique scope IDs.
    next_scope_id: u32,
}

impl<'pos> ScopeCollector<'pos> {
    /// Create a new ScopeCollector without position tracking.
    ///
    /// Scopes will be collected but spans will be None (except module scope).
    pub fn new(source_len: usize) -> Self {
        Self {
            positions: None,
            source_len,
            scopes: Vec::new(),
            scope_stack: Vec::new(),
            next_scope_id: 0,
        }
    }

    /// Create a new ScopeCollector with position tracking.
    ///
    /// Scopes will include lexical spans from the PositionTable.
    pub fn with_positions(positions: &'pos PositionTable, source_len: usize) -> Self {
        Self {
            positions: Some(positions),
            source_len,
            scopes: Vec::new(),
            scope_stack: Vec::new(),
            next_scope_id: 0,
        }
    }

    /// Collect scopes from a parsed module with position information.
    ///
    /// This is the preferred method for collecting scopes with accurate lexical spans.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    /// * `source` - The original source code (for module span length)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let parsed = parse_module_with_positions(source, None)?;
    /// let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);
    /// ```
    pub fn collect(
        module: &Module<'_>,
        positions: &'pos PositionTable,
        source: &str,
    ) -> Vec<ScopeInfo> {
        let mut collector = ScopeCollector::with_positions(positions, source.len());
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

    /// Look up the lexical span for a node from the PositionTable.
    fn lookup_lexical_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.lexical_span)
    }

    /// Enter a new scope with node_id for span lookup.
    fn enter_scope_with_id(
        &mut self,
        kind: ScopeKind,
        name: Option<&str>,
        node_id: Option<NodeId>,
    ) {
        let scope_id = self.generate_scope_id();
        let parent = self.current_parent();

        // Look up the lexical span from the PositionTable
        let span = self.lookup_lexical_span(node_id);

        let scope = ScopeInfo::new(scope_id.clone(), kind, name.map(|s| s.to_string()), parent)
            .with_span(span);

        self.scopes.push(scope);
        self.scope_stack.push(scope_id);
    }

    /// Enter a new scope without node_id (for comprehensions, lambdas which don't have lexical_span yet).
    ///
    /// These scope types don't have lexical_span recorded during inflation (follow-on work).
    fn enter_scope(&mut self, kind: ScopeKind, name: Option<&str>) {
        let scope_id = self.generate_scope_id();
        let parent = self.current_parent();

        // No span for these scope types (lambda/comprehension spans are follow-on work)
        let scope = ScopeInfo::new(scope_id.clone(), kind, name.map(|s| s.to_string()), parent);

        self.scopes.push(scope);
        self.scope_stack.push(scope_id);
    }

    /// Exit the current scope.
    fn exit_scope(&mut self) {
        self.scope_stack.pop();
    }
}

impl<'a, 'pos> Visitor<'a> for ScopeCollector<'pos> {
    fn visit_module(&mut self, _node: &Module<'a>) -> VisitResult {
        // Module scope - spans from byte 0 to end of source
        let scope_id = self.generate_scope_id();
        let scope = ScopeInfo::new(scope_id.clone(), ScopeKind::Module, None, None)
            .with_span(Some(Span::new(0, self.source_len as u64)));

        self.scopes.push(scope);
        self.scope_stack.push(scope_id);
        VisitResult::Continue
    }

    fn leave_module(&mut self, _node: &Module<'a>) {
        self.exit_scope();
    }

    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        // Look up lexical span from PositionTable using FunctionDef's node_id
        self.enter_scope_with_id(ScopeKind::Function, Some(node.name.value), node.node_id);
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.exit_scope();
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        // Look up lexical span from PositionTable using ClassDef's node_id
        self.enter_scope_with_id(ScopeKind::Class, Some(node.name.value), node.node_id);
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.exit_scope();
    }

    fn visit_lambda(&mut self, _node: &Lambda<'a>) -> VisitResult {
        // Lambda spans are follow-on work (no lexical_span recorded yet)
        self.enter_scope(ScopeKind::Lambda, None);
        VisitResult::Continue
    }

    fn leave_lambda(&mut self, _node: &Lambda<'a>) {
        self.exit_scope();
    }

    fn visit_list_comp(&mut self, _node: &ListComp<'a>) -> VisitResult {
        // List comprehensions create their own scope in Python 3
        // Comprehension spans are follow-on work (no lexical_span recorded yet)
        self.enter_scope(ScopeKind::Comprehension, None);
        VisitResult::Continue
    }

    fn leave_list_comp(&mut self, _node: &ListComp<'a>) {
        self.exit_scope();
    }

    fn visit_set_comp(&mut self, _node: &SetComp<'a>) -> VisitResult {
        // Comprehension spans are follow-on work
        self.enter_scope(ScopeKind::Comprehension, None);
        VisitResult::Continue
    }

    fn leave_set_comp(&mut self, _node: &SetComp<'a>) {
        self.exit_scope();
    }

    fn visit_dict_comp(&mut self, _node: &DictComp<'a>) -> VisitResult {
        // Comprehension spans are follow-on work
        self.enter_scope(ScopeKind::Comprehension, None);
        VisitResult::Continue
    }

    fn leave_dict_comp(&mut self, _node: &DictComp<'a>) {
        self.exit_scope();
    }

    fn visit_generator_exp(&mut self, _node: &GeneratorExp<'a>) -> VisitResult {
        // Comprehension spans are follow-on work
        self.enter_scope(ScopeKind::Comprehension, None);
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
    use crate::parse_module_with_positions;

    // ========================================================================
    // Tests using collect() API
    // ========================================================================

    #[test]
    fn test_scope_simple_function() {
        let source = "def foo():\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].globals, vec!["x", "y", "z"]);
    }

    #[test]
    fn test_scope_generator_expression() {
        let source = "g = (x for x in range(10))";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);

        // Generator expression scope (comprehension)
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
    }

    #[test]
    fn test_scope_dict_comprehension() {
        let source = "d = {k: v for k, v in items}";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
    }

    #[test]
    fn test_scope_set_comprehension() {
        let source = "s = {x for x in items}";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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
        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

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

    // ========================================================================
    // Tests for lexical span verification
    // ========================================================================

    #[test]
    fn test_scope_function_lexical_span_starts_at_def_not_decorator() {
        // Key test: lexical span should start at 'def', not at decorator '@'
        let source = "@decorator\ndef foo():\n    pass\n";
        //            0123456789 012345678901234567890
        //            @decorator\ndef foo():\n    pass
        //            0         1111111111122222222223
        //            0         1234567890123456789012
        //                      ^def starts at byte 11

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);
        let module_span = scopes[0].span.expect("Module should have span");
        assert_eq!(module_span.start, 0);
        assert_eq!(module_span.end, source.len() as u64);

        // Function scope - lexical span should start at 'def', not '@'
        assert_eq!(scopes[1].kind, ScopeKind::Function);
        let func_span = scopes[1].span.expect("Function should have lexical span");
        // The 'def' keyword starts at byte 11 (after "@decorator\n")
        assert_eq!(
            func_span.start, 11,
            "Lexical span should start at 'def' (byte 11), not at decorator '@' (byte 0)"
        );
    }

    #[test]
    fn test_scope_class_lexical_span_starts_at_class() {
        let source = "class Foo:\n    pass\n";
        //            01234567890123456789
        //            ^class starts at 0

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);

        // Class scope - lexical span should start at 'class'
        assert_eq!(scopes[1].kind, ScopeKind::Class);
        let class_span = scopes[1].span.expect("Class should have lexical span");
        assert_eq!(class_span.start, 0, "Lexical span should start at 'class'");
    }

    #[test]
    fn test_scope_decorated_class_lexical_span_excludes_decorator() {
        let source = "@dataclass\nclass Foo:\n    pass\n";
        //            012345678901234567890123456789012
        //            @dataclass\nclass Foo:\n    pass
        //            0         1111111111122222222223
        //            0         1234567890123456789012
        //                      ^class starts at byte 11

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);

        // Class scope - lexical span should start at 'class', not '@'
        assert_eq!(scopes[1].kind, ScopeKind::Class);
        let class_span = scopes[1].span.expect("Class should have lexical span");
        assert_eq!(
            class_span.start, 11,
            "Lexical span should start at 'class' (byte 11), not at decorator '@' (byte 0)"
        );
    }

    #[test]
    fn test_scope_module_spans_entire_file() {
        let source = "x = 1\ny = 2\n";

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 1);

        // Module scope should span entire file
        assert_eq!(scopes[0].kind, ScopeKind::Module);
        let module_span = scopes[0].span.expect("Module should have span");
        assert_eq!(module_span.start, 0, "Module span should start at 0");
        assert_eq!(
            module_span.end,
            source.len() as u64,
            "Module span should end at source length"
        );
    }

    #[test]
    fn test_scope_nested_functions_have_correct_containment() {
        let source = "def outer():\n    def inner():\n        pass\n";
        //            0123456789012345678901234567890123456789012345
        //            def outer():\n    def inner():\n        pass
        //            0         1111111111122222222223333333333444444
        //            0123456789012345678901234567890123456789012345

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 3);

        // Module scope
        let module_span = scopes[0].span.expect("Module should have span");

        // Outer function scope
        let outer_span = scopes[1].span.expect("outer should have lexical span");
        assert_eq!(scopes[1].name, Some("outer".to_string()));

        // Inner function scope
        let inner_span = scopes[2].span.expect("inner should have lexical span");
        assert_eq!(scopes[2].name, Some("inner".to_string()));

        // Verify containment: module contains outer, outer contains inner
        assert!(
            module_span.start <= outer_span.start && outer_span.end <= module_span.end,
            "outer should be contained within module"
        );
        assert!(
            outer_span.start <= inner_span.start && inner_span.end <= outer_span.end,
            "inner should be contained within outer"
        );

        // Inner should NOT extend past outer
        assert!(
            inner_span.end <= outer_span.end,
            "inner span end ({}) should not exceed outer span end ({})",
            inner_span.end,
            outer_span.end
        );
    }

    #[test]
    fn test_scope_function_with_multiple_decorators() {
        let source = "@dec1\n@dec2\n@dec3\ndef foo():\n    pass\n";
        //            01234 56789 01234 567890123456789012345
        //            @dec1\n@dec2\n@dec3\ndef foo():\n    pass
        //            0    5     11    17
        //                              ^def starts at byte 18

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);

        // Function scope - lexical span should start at 'def', not at first decorator
        assert_eq!(scopes[1].kind, ScopeKind::Function);
        let func_span = scopes[1].span.expect("Function should have lexical span");
        assert_eq!(
            func_span.start, 18,
            "Lexical span should start at 'def' (byte 18), not at first decorator '@dec1' (byte 0)"
        );
    }

    #[test]
    fn test_scope_async_function_lexical_span_starts_at_async() {
        let source = "async def foo():\n    pass\n";
        //            0123456789012345678901234567
        //            ^async starts at 0

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);

        // Function scope - lexical span should start at 'async'
        assert_eq!(scopes[1].kind, ScopeKind::Function);
        let func_span = scopes[1].span.expect("Function should have lexical span");
        assert_eq!(
            func_span.start, 0,
            "Lexical span for async function should start at 'async'"
        );
    }

    #[test]
    fn test_scope_decorated_async_function() {
        let source = "@decorator\nasync def foo():\n    pass\n";
        //            0123456789 0123456789012345678901234567
        //            @decorator\nasync def foo():\n    pass
        //            0         1111111111122222222223333333
        //            0         1234567890123456789012345678
        //                      ^async starts at byte 11

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);

        // Function scope - lexical span should start at 'async', not '@'
        assert_eq!(scopes[1].kind, ScopeKind::Function);
        let func_span = scopes[1].span.expect("Function should have lexical span");
        assert_eq!(
            func_span.start, 11,
            "Lexical span should start at 'async' (byte 11), not at decorator '@' (byte 0)"
        );
    }
}
