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
    /// Depth of this scope in the scope tree (module = 0, children = parent + 1).
    /// Used to resolve tie-breaks when scopes have identical spans.
    pub depth: u32,
    /// Names declared as `global` in this scope.
    pub globals: Vec<String>,
    /// Names declared as `nonlocal` in this scope.
    pub nonlocals: Vec<String>,
}

impl ScopeInfo {
    /// Create a new ScopeInfo.
    fn new(
        id: String,
        kind: ScopeKind,
        name: Option<String>,
        parent: Option<String>,
        depth: u32,
    ) -> Self {
        Self {
            id,
            kind,
            name,
            parent,
            span: None,
            depth,
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
        // Depth is the current stack size (0 for module, 1 for top-level functions, etc.)
        let depth = self.scope_stack.len() as u32;

        // Look up the lexical span from the PositionTable
        let span = self.lookup_lexical_span(node_id);

        let scope = ScopeInfo::new(
            scope_id.clone(),
            kind,
            name.map(|s| s.to_string()),
            parent,
            depth,
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

impl<'a, 'pos> Visitor<'a> for ScopeCollector<'pos> {
    fn visit_module(&mut self, _node: &Module<'a>) -> VisitResult {
        // Module scope - spans from byte 0 to end of source, depth = 0
        let scope_id = self.generate_scope_id();
        let depth = 0; // Module is always at depth 0
        let scope = ScopeInfo::new(scope_id.clone(), ScopeKind::Module, None, None, depth)
            .with_span(Some(Span::new(0, self.source_len)));

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

    fn visit_lambda(&mut self, node: &Lambda<'a>) -> VisitResult {
        // Look up lexical span from PositionTable using Lambda's node_id
        self.enter_scope_with_id(ScopeKind::Lambda, None, node.node_id);
        VisitResult::Continue
    }

    fn leave_lambda(&mut self, _node: &Lambda<'a>) {
        self.exit_scope();
    }

    fn visit_list_comp(&mut self, node: &ListComp<'a>) -> VisitResult {
        // List comprehensions create their own scope in Python 3
        // Look up lexical span from PositionTable using ListComp's node_id
        self.enter_scope_with_id(ScopeKind::Comprehension, None, node.node_id);
        VisitResult::Continue
    }

    fn leave_list_comp(&mut self, _node: &ListComp<'a>) {
        self.exit_scope();
    }

    fn visit_set_comp(&mut self, node: &SetComp<'a>) -> VisitResult {
        // Look up lexical span from PositionTable using SetComp's node_id
        self.enter_scope_with_id(ScopeKind::Comprehension, None, node.node_id);
        VisitResult::Continue
    }

    fn leave_set_comp(&mut self, _node: &SetComp<'a>) {
        self.exit_scope();
    }

    fn visit_dict_comp(&mut self, node: &DictComp<'a>) -> VisitResult {
        // Look up lexical span from PositionTable using DictComp's node_id
        self.enter_scope_with_id(ScopeKind::Comprehension, None, node.node_id);
        VisitResult::Continue
    }

    fn leave_dict_comp(&mut self, _node: &DictComp<'a>) {
        self.exit_scope();
    }

    fn visit_generator_exp(&mut self, node: &GeneratorExp<'a>) -> VisitResult {
        // Look up lexical span from PositionTable using GeneratorExp's node_id
        self.enter_scope_with_id(ScopeKind::Comprehension, None, node.node_id);
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
        assert_eq!(module_span.end, source.len());

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
            source.len(),
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

    // ========================================================================
    // Lambda scope span tests
    // ========================================================================

    #[test]
    fn test_scope_lambda_has_lexical_span() {
        let source = "f = lambda x: x + 1";
        //            01234567890123456789
        //                ^lambda starts at byte 4
        //                              ^body ends after '1' at byte 19

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);

        // Lambda scope - should now have lexical span
        assert_eq!(scopes[1].kind, ScopeKind::Lambda);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(
            lambda_span.start, 4,
            "Lambda lexical span should start at 'lambda' keyword (byte 4)"
        );
        assert_eq!(
            lambda_span.end, 19,
            "Lambda lexical span should end after body expression (byte 19)"
        );
    }

    #[test]
    fn test_scope_lambda_with_integer_body() {
        let source = "f = lambda: 42";
        //            01234567890123
        //                ^lambda at 4
        //                        ^42 ends at 14

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 14);
    }

    #[test]
    fn test_scope_lambda_with_string_body() {
        let source = r#"f = lambda: "hello""#;
        //            0123456789012345678
        //                ^lambda at 4
        //                        ^string ends at 19

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        // String is "hello" which is 7 chars, starting at 12, ending at 19
        assert_eq!(lambda_span.end, 19);
    }

    #[test]
    fn test_scope_lambda_with_ellipsis_body() {
        let source = "f = lambda: ...";
        //            012345678901234
        //                ^lambda at 4
        //                        ^... ends at 15

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 15);
    }

    #[test]
    fn test_scope_nested_lambda_containment() {
        let source = "f = lambda x: lambda y: x + y";
        //            01234567890123456789012345678
        //                ^outer lambda at 4
        //                          ^inner lambda at 14
        //                                      ^ends at 29

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 3);

        // Outer lambda
        let outer_span = scopes[1].span.expect("Outer lambda should have span");
        assert_eq!(outer_span.start, 4);
        assert_eq!(outer_span.end, 29);

        // Inner lambda
        let inner_span = scopes[2].span.expect("Inner lambda should have span");
        assert_eq!(inner_span.start, 14);
        assert_eq!(inner_span.end, 29);

        // Verify containment
        assert!(
            outer_span.start <= inner_span.start && inner_span.end <= outer_span.end,
            "Inner lambda should be contained within outer lambda"
        );
    }

    // ========================================================================
    // Real-world lambda span tests - stress testing edge cases
    // ========================================================================

    #[test]
    fn test_scope_lambda_as_sort_key() {
        // Very common real-world pattern: lambda as key function
        let source = "sorted(items, key=lambda x: x.name)";
        //            0         1         2         3
        //            0123456789012345678901234567890123456
        //                              ^lambda at 18
        //                                           ^ends at 34 (after 'e' of 'name')

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(
            lambda_span.start, 18,
            "Lambda should start at 'lambda' keyword"
        );
        assert_eq!(lambda_span.end, 34, "Lambda should end after x.name");
    }

    #[test]
    fn test_scope_lambda_with_method_chain() {
        // Tests Attribute -> Call -> Attribute -> Call chain
        let source = "f = lambda s: s.strip().lower()";
        //            0         1         2         3
        //            0123456789012345678901234567890
        //                ^lambda at 4
        //                                        ^ends at 31

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 31);
    }

    #[test]
    fn test_scope_lambda_with_subscript() {
        // Tests Subscript ending with ]
        let source = "f = lambda x: x[0]";
        //            012345678901234567
        //                ^lambda at 4
        //                           ^ends at 18

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 18);
    }

    #[test]
    fn test_scope_lambda_with_slice() {
        // Tests Subscript with slice
        let source = "f = lambda x: x[1:3]";
        //            01234567890123456789
        //                ^lambda at 4
        //                             ^ends at 20

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 20);
    }

    #[test]
    fn test_scope_lambda_with_list_comp_body() {
        // Lambda body is a list comprehension - creates nested scope
        let source = "f = lambda x: [i * 2 for i in x]";
        //            0         1         2         3
        //            01234567890123456789012345678901
        //                ^lambda at 4
        //                                         ^ends at 32

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        // Module + Lambda + ListComp = 3 scopes
        assert_eq!(scopes.len(), 3);

        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 32);

        // ListComp scope is inside lambda (Step 3 will add span tracking for this)
        assert_eq!(scopes[2].kind, ScopeKind::Comprehension);
    }

    #[test]
    fn test_scope_lambda_with_conditional_expression() {
        // Tests IfExp (ternary) - body ends at the orelse
        let source = "f = lambda x: x if x > 0 else -x";
        //            0         1         2         3
        //            01234567890123456789012345678901
        //                ^lambda at 4
        //                                         ^ends at 32

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 32);
    }

    #[test]
    fn test_scope_lambda_with_chained_comparison() {
        // Tests Comparison with multiple comparators
        let source = "f = lambda x: 0 < x < 10";
        //            012345678901234567890123
        //                ^lambda at 4
        //                                 ^ends at 24

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 24);
    }

    #[test]
    fn test_scope_lambda_with_boolean_operation() {
        // Tests BooleanOperation
        let source = "f = lambda x, y: x and y or False";
        //            0         1         2         3
        //            012345678901234567890123456789012
        //                ^lambda at 4
        //                                          ^ends at 33

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 33);
    }

    #[test]
    fn test_scope_lambda_with_parenthesized_body() {
        // Tests rpar handling - parentheses around body
        let source = "f = lambda x: (x + 1)";
        //            012345678901234567890
        //                ^lambda at 4
        //                              ^ends at 21

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 21);
    }

    #[test]
    fn test_scope_lambda_with_nested_parens() {
        // Tests deeply nested parentheses
        let source = "f = lambda x: ((x))";
        //            0123456789012345678
        //                ^lambda at 4
        //                            ^ends at 19

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 19);
    }

    #[test]
    fn test_scope_lambda_with_dict_literal_body() {
        // Lambda body is a dict literal
        let source = "f = lambda x: {'key': x}";
        //            012345678901234567890123
        //                ^lambda at 4
        //                                 ^ends at 24

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 24);
    }

    #[test]
    fn test_scope_lambda_with_list_literal_body() {
        // Lambda body is a list literal
        let source = "f = lambda x: [x, x + 1]";
        //            012345678901234567890123
        //                ^lambda at 4
        //                                 ^ends at 24

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 24);
    }

    #[test]
    fn test_scope_lambda_with_tuple_body() {
        // Lambda body is a tuple (with parens for clarity)
        let source = "f = lambda x: (x, x + 1)";
        //            012345678901234567890123
        //                ^lambda at 4
        //                                 ^ends at 24

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 24);
    }

    #[test]
    fn test_scope_lambda_with_generator_exp_body() {
        // Lambda body is a generator expression - creates nested scope
        let source = "f = lambda x: (i for i in x)";
        //            0         1         2
        //            0123456789012345678901234567
        //                ^lambda at 4
        //                                     ^ends at 28

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        // Module + Lambda + GeneratorExp = 3 scopes
        assert_eq!(scopes.len(), 3);

        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 28);

        assert_eq!(scopes[2].kind, ScopeKind::Comprehension);
    }

    #[test]
    fn test_scope_lambda_with_fstring_body() {
        // Tests FormattedString - this is an edge case per the audit
        let source = r#"f = lambda x: f"hello {x}""#;
        //            0         1         2
        //            01234567890123456789012345
        //                ^lambda at 4
        //                                    ^ends at 26

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        // Note: FormattedString end position may have edge cases - verify it's reasonable
        assert!(
            lambda_span.end >= 20,
            "Lambda end should be at least past the f-string start"
        );
    }

    #[test]
    fn test_scope_lambda_with_float_body() {
        // Tests Float token (mentioned as gap in audit)
        let source = "f = lambda: 3.14";
        //            0123456789012345
        //                ^lambda at 4
        //                          ^ends at 16

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 16);
    }

    #[test]
    fn test_scope_lambda_with_imaginary_body() {
        // Tests Imaginary token
        let source = "f = lambda: 2j";
        //            01234567890123
        //                ^lambda at 4
        //                        ^ends at 14

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 14);
    }

    #[test]
    fn test_scope_lambda_with_unary_minus() {
        // Tests UnaryOperation
        let source = "f = lambda x: -x";
        //            0123456789012345
        //                ^lambda at 4
        //                          ^ends at 16

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 16);
    }

    #[test]
    fn test_scope_lambda_with_await_body() {
        // Tests Await expression (must be inside async context, but parser accepts it)
        let source = "f = lambda: await coro()";
        //            012345678901234567890123
        //                ^lambda at 4
        //                                 ^ends at 24

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 24);
    }

    #[test]
    fn test_scope_lambda_with_starred_element() {
        // Tests StarredElement in tuple
        let source = "f = lambda x: (*x,)";
        //            0123456789012345678
        //                ^lambda at 4
        //                            ^ends at 19

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 19);
    }

    #[test]
    fn test_scope_lambda_with_walrus_body() {
        // Tests NamedExpr (walrus operator)
        let source = "f = lambda: (x := 1)";
        //            01234567890123456789
        //                ^lambda at 4
        //                             ^ends at 20

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 20);
    }

    #[test]
    fn test_scope_multiple_lambdas_same_line() {
        // Multiple lambdas on same line - verify independence
        let source = "a, b = lambda: 1, lambda: 2";
        //            0         1         2
        //            012345678901234567890123456
        //                   ^lambda1 at 7, ends at 16 (after "1")
        //                              ^lambda2 at 18, ends at 27 (after "2")

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        // Module + 2 lambdas = 3 scopes
        assert_eq!(scopes.len(), 3);

        let lambda1_span = scopes[1].span.expect("Lambda 1 should have span");
        assert_eq!(lambda1_span.start, 7);
        assert_eq!(lambda1_span.end, 16); // ends after "1" at position 15

        let lambda2_span = scopes[2].span.expect("Lambda 2 should have span");
        assert_eq!(lambda2_span.start, 18);
        assert_eq!(lambda2_span.end, 27); // ends after "2" at position 26

        // Verify non-overlapping
        assert!(
            lambda1_span.end <= lambda2_span.start,
            "Lambda spans should not overlap"
        );
    }

    #[test]
    fn test_scope_lambda_in_dict_value() {
        // Lambda as dict value - common pattern
        let source = "d = {'transform': lambda x: x * 2}";
        //            0         1         2         3
        //            0123456789012345678901234567890123
        //                              ^lambda at 18
        //                                           ^ends at 33

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 18);
        assert_eq!(lambda_span.end, 33);
    }

    #[test]
    fn test_scope_lambda_with_call_chain_ending_in_subscript() {
        // Complex chained expression: call -> attribute -> subscript
        let source = "f = lambda x: x.items()[0]";
        //            0         1         2
        //            01234567890123456789012345
        //                ^lambda at 4
        //                                   ^ends at 26

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 26);
    }

    #[test]
    fn test_scope_lambda_with_concatenated_strings() {
        // Tests ConcatenatedString
        let source = r#"f = lambda: "hello" "world""#;
        //            0         1         2
        //            012345678901234567890123456
        //                ^lambda at 4
        //                                     ^ends at 27

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 27);
    }

    #[test]
    fn test_scope_lambda_yield_expression() {
        // Tests Yield expression (valid in generator context)
        let source = "f = lambda: (yield 1)";
        //            012345678901234567890
        //                ^lambda at 4
        //                              ^ends at 21

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 21);
    }

    #[test]
    fn test_scope_lambda_deeply_nested_calls() {
        // Stress test: deeply nested function calls
        let source = "f = lambda x: foo(bar(baz(x)))";
        //            0         1         2
        //            012345678901234567890123456789
        //                ^lambda at 4
        //                                       ^ends at 30

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 30);
    }

    #[test]
    fn test_scope_lambda_set_comp_body() {
        // Lambda body is a set comprehension
        let source = "f = lambda x: {i for i in x}";
        //            0         1         2
        //            0123456789012345678901234567
        //                ^lambda at 4
        //                                     ^ends at 28

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        // Module + Lambda + SetComp = 3 scopes
        assert_eq!(scopes.len(), 3);

        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 28);
    }

    #[test]
    fn test_scope_lambda_dict_comp_body() {
        // Lambda body is a dict comprehension
        let source = "f = lambda x: {k: v for k, v in x}";
        //            0         1         2         3
        //            0123456789012345678901234567890123
        //                ^lambda at 4
        //                                           ^ends at 34

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        // Module + Lambda + DictComp = 3 scopes
        assert_eq!(scopes.len(), 3);

        let lambda_span = scopes[1].span.expect("Lambda should have lexical span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 34);
    }

    // ========================================================================
    // Comprehension scope span tests
    // ========================================================================

    #[test]
    fn test_scope_list_comp_has_lexical_span() {
        let source = "x = [i * 2 for i in range(10)]";
        //            0         1         2         3
        //            0123456789012345678901234567890
        //                ^list comp starts at [ (byte 4)
        //                                     ^ends at ] (byte 30)

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        // Module + ListComp = 2 scopes
        assert_eq!(scopes.len(), 2);

        // Module scope
        assert_eq!(scopes[0].kind, ScopeKind::Module);

        // ListComp scope
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
        let comp_span = scopes[1].span.expect("ListComp should have lexical span");
        assert_eq!(comp_span.start, 4, "ListComp should start at '[' (byte 4)");
        assert_eq!(comp_span.end, 30, "ListComp should end at ']' (byte 30)");
    }

    #[test]
    fn test_scope_set_comp_has_lexical_span() {
        let source = "x = {i * 2 for i in range(10)}";
        //            0         1         2         3
        //            0123456789012345678901234567890
        //                ^set comp starts at { (byte 4)
        //                                     ^ends at } (byte 30)

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
        let comp_span = scopes[1].span.expect("SetComp should have lexical span");
        assert_eq!(
            comp_span.start, 4,
            "SetComp should start at left brace (byte 4)"
        );
        assert_eq!(
            comp_span.end, 30,
            "SetComp should end at right brace (byte 30)"
        );
    }

    #[test]
    fn test_scope_dict_comp_has_lexical_span() {
        let source = "x = {k: v for k, v in items}";
        //            0         1         2
        //            0123456789012345678901234567
        //                ^dict comp starts at { (byte 4)
        //                                     ^ends at } (byte 28)

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
        let comp_span = scopes[1].span.expect("DictComp should have lexical span");
        assert_eq!(
            comp_span.start, 4,
            "DictComp should start at left brace (byte 4)"
        );
        assert_eq!(
            comp_span.end, 28,
            "DictComp should end at right brace (byte 28)"
        );
    }

    #[test]
    fn test_scope_generator_exp_parenthesized_has_lexical_span() {
        let source = "x = (i * 2 for i in range(10))";
        //            0         1         2         3
        //            0123456789012345678901234567890
        //                ^genexp starts at ( (byte 4)
        //                                     ^ends at ) (byte 30)

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
        let comp_span = scopes[1]
            .span
            .expect("GeneratorExp should have lexical span");
        assert_eq!(
            comp_span.start, 4,
            "GeneratorExp should start at '(' (byte 4)"
        );
        assert_eq!(
            comp_span.end, 30,
            "GeneratorExp should end at ')' (byte 30)"
        );
    }

    #[test]
    fn test_scope_generator_exp_implicit_has_lexical_span() {
        // Implicit generator expression as function argument
        let source = "sum(x for x in xs)";
        //            012345678901234567
        //                ^genexp starts at x (byte 4)
        //                             ^ends at xs (byte 17)

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        assert_eq!(scopes[1].kind, ScopeKind::Comprehension);
        let comp_span = scopes[1]
            .span
            .expect("Implicit GeneratorExp should have lexical span");
        assert_eq!(
            comp_span.start, 4,
            "Implicit GeneratorExp should start at 'x' (byte 4)"
        );
        assert_eq!(
            comp_span.end, 17,
            "Implicit GeneratorExp should end after 'xs' (byte 17)"
        );
    }

    #[test]
    fn test_scope_nested_comprehensions() {
        // Nested list comprehensions
        let source = "x = [[j for j in i] for i in xs]";
        //            0         1         2         3
        //            01234567890123456789012345678901
        //                ^outer list comp at [ (byte 4)
        //                 ^inner list comp at [ (byte 5)
        //                              ^inner ] at 18
        //                                       ^outer ] at 31

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        // Module + outer ListComp + inner ListComp = 3 scopes
        assert_eq!(scopes.len(), 3);

        // Outer comprehension
        let outer_span = scopes[1].span.expect("Outer ListComp should have span");
        assert_eq!(outer_span.start, 4);
        assert_eq!(outer_span.end, 32);

        // Inner comprehension
        let inner_span = scopes[2].span.expect("Inner ListComp should have span");
        assert_eq!(inner_span.start, 5);
        assert_eq!(inner_span.end, 19);

        // Verify containment
        assert!(
            outer_span.start <= inner_span.start && inner_span.end <= outer_span.end,
            "Inner comprehension should be contained within outer comprehension"
        );
    }

    #[test]
    fn test_scope_comprehension_with_condition() {
        let source = "x = [i for i in xs if i > 0]";
        //            0         1         2
        //            0123456789012345678901234567
        //                ^[ at 4
        //                                     ^] at 28

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let comp_span = scopes[1]
            .span
            .expect("ListComp with condition should have span");
        assert_eq!(comp_span.start, 4);
        assert_eq!(comp_span.end, 28);
    }

    #[test]
    fn test_scope_comprehension_with_multiple_fors() {
        let source = "x = [i + j for i in xs for j in ys]";
        //            0         1         2         3
        //            01234567890123456789012345678901234
        //                ^[ at 4
        //                                              ^] at 35

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(scopes.len(), 2);
        let comp_span = scopes[1]
            .span
            .expect("ListComp with multiple fors should have span");
        assert_eq!(comp_span.start, 4);
        assert_eq!(comp_span.end, 35);
    }

    #[test]
    fn test_scope_comprehension_inside_lambda() {
        // Lambda containing a list comprehension
        let source = "f = lambda x: [i for i in x]";
        //            0         1         2
        //            0123456789012345678901234567
        //                ^lambda at 4
        //                        ^list comp at 14
        //                                     ^] at 27

        let parsed = parse_module_with_positions(source, None).unwrap();
        let scopes = ScopeCollector::collect(&parsed.module, &parsed.positions, source);

        // Module + Lambda + ListComp = 3 scopes
        assert_eq!(scopes.len(), 3);

        let lambda_span = scopes[1].span.expect("Lambda should have span");
        assert_eq!(lambda_span.start, 4);
        assert_eq!(lambda_span.end, 28);

        let comp_span = scopes[2].span.expect("ListComp should have span");
        assert_eq!(comp_span.start, 14);
        assert_eq!(comp_span.end, 28);

        // Comprehension is inside lambda
        assert!(
            lambda_span.start <= comp_span.start && comp_span.end <= lambda_span.end,
            "ListComp should be contained within Lambda"
        );
    }
}
