// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! ReferenceCollector visitor for Python name reference extraction.
//!
//! This module provides a [`ReferenceCollector`] visitor that traverses a CST and
//! collects all name references with their kinds and spans, organized by name.
//!
//! # What is a Reference?
//!
//! A reference is any usage of a name in Python code. This includes:
//! - **Definitions**: function/class definitions, parameters, assignment targets
//! - **References**: simple name lookups (`x`, `foo`)
//! - **Calls**: function/method call targets (`foo()`, `obj.method()`)
//! - **Attributes**: attribute access names (`obj.attr`)
//! - **Imports**: names in import statements
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
//! use tugtool_python_cst::{parse_module_with_positions, ReferenceCollector, CstReferenceRecord, ReferenceKind};
//!
//! let source = "x = 1\nprint(x)";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);
//! for (name, ref_list) in &refs {
//!     println!("{}: {:?}", name, ref_list);
//! }
//! ```

use std::collections::{HashMap, HashSet};

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use super::SCOPE_MODULE;
use crate::inflate_ctx::PositionTable;
use crate::nodes::{
    AnnAssign, Assign, AssignTargetExpression, Attribute, Call, ClassDef, Element, Expression,
    FunctionDef, Import, ImportAlias, ImportFrom, ImportNames, Module, Name, NameOrAttribute,
    NamedExpr, NodeId, Param, Span,
};

/// The kind of reference in Python.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReferenceKind {
    /// A name definition (function, class, parameter, assignment target).
    Definition,
    /// A simple name reference (variable lookup).
    Reference,
    /// A function/method call target.
    Call,
    /// An attribute access name (`obj.attr` - the `attr` part).
    Attribute,
    /// A name in an import statement.
    Import,
}

impl ReferenceKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            ReferenceKind::Definition => "definition",
            ReferenceKind::Reference => "reference",
            ReferenceKind::Call => "call",
            ReferenceKind::Attribute => "attribute",
            ReferenceKind::Import => "import",
        }
    }
}

impl std::fmt::Display for ReferenceKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about a single reference to a name.
///
/// Each reference records the kind of reference, its source location, and
/// the scope path where the reference occurs.
#[derive(Debug, Clone)]
pub struct CstReferenceRecord {
    /// The kind of reference.
    pub kind: ReferenceKind,
    /// Source span for the reference (byte offsets).
    pub span: Option<Span>,
    /// The scope path where this reference occurs (e.g., `["<module>", "MyClass", "my_method"]`).
    pub scope_path: Vec<String>,
}

impl CstReferenceRecord {
    /// Create a new CstReferenceRecord with the given kind and scope path.
    fn new(kind: ReferenceKind, scope_path: Vec<String>) -> Self {
        Self {
            kind,
            span: None,
            scope_path,
        }
    }

    /// Set the span for this reference.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }
}

/// Context type for tracking what kind of reference we're in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ContextKind {
    /// Inside a Call node - the func name should be tagged as Call
    CallFunc,
    /// Inside an Attribute node - the attr name should be tagged as Attribute
    AttributeAttr,
    /// Inside a definition - skip the name (we handle it explicitly)
    SkipName,
}

/// A context entry for the context stack.
#[derive(Debug, Clone)]
struct ContextEntry {
    kind: ContextKind,
    name: Option<String>,
}

/// A visitor that collects all name references from a Python CST.
///
/// ReferenceCollector traverses the CST and identifies all name usages:
/// - Definitions (function/class names, parameters, assignment targets)
/// - Simple references (variable lookups)
/// - Call targets (function/method calls)
/// - Attribute accesses
/// - Import names
///
/// References are organized by name in a HashMap for efficient lookup.
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);
/// let x_refs = refs.get("x");
/// ```
pub struct ReferenceCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Map of name -> list of references.
    references: HashMap<String, Vec<CstReferenceRecord>>,
    /// Context stack for determining reference kinds.
    context_stack: Vec<ContextEntry>,
    /// Stack tracking how many skip contexts were pushed by each assignment.
    assign_skip_counts: Vec<usize>,
    /// Set of names currently in context stack for O(1) membership check.
    /// This optimizes the common case where a name is not in the stack.
    context_names: HashSet<String>,
    /// Current scope path for tracking where references occur.
    scope_path: Vec<String>,
}

impl<'pos> ReferenceCollector<'pos> {
    /// Create a new ReferenceCollector without position tracking.
    ///
    /// References will be collected but spans will be None.
    pub fn new() -> Self {
        Self {
            positions: None,
            references: HashMap::new(),
            context_stack: Vec::new(),
            assign_skip_counts: Vec::new(),
            context_names: HashSet::new(),
            scope_path: vec![SCOPE_MODULE.to_string()],
        }
    }

    /// Create a new ReferenceCollector with position tracking.
    ///
    /// References will include spans from the PositionTable.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            references: HashMap::new(),
            context_stack: Vec::new(),
            assign_skip_counts: Vec::new(),
            context_names: HashSet::new(),
            scope_path: vec![SCOPE_MODULE.to_string()],
        }
    }

    /// Collect references from a parsed module with position information.
    ///
    /// This is the preferred method for collecting references with accurate spans.
    /// Returns a HashMap mapping names to their reference information.
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
    /// let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);
    /// let x_refs = refs.get("x");
    /// ```
    pub fn collect(
        module: &Module<'_>,
        positions: &PositionTable,
    ) -> HashMap<String, Vec<CstReferenceRecord>> {
        let mut collector = ReferenceCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.references
    }

    /// Get all references for a specific name.
    ///
    /// Returns None if the name was never referenced.
    pub fn references_for(&self, name: &str) -> Option<&Vec<CstReferenceRecord>> {
        self.references.get(name)
    }

    /// Get all references as a HashMap, consuming the collector.
    pub fn into_references(self) -> HashMap<String, Vec<CstReferenceRecord>> {
        self.references
    }

    /// Get a reference to the internal references map.
    pub fn all_references(&self) -> &HashMap<String, Vec<CstReferenceRecord>> {
        &self.references
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Get the current reference kind based on context stack.
    /// Returns None if the name should be skipped (already handled as definition).
    fn get_current_kind(&self, name: &str) -> Option<ReferenceKind> {
        // Fast path: if name not in context at all, it's a simple reference
        // This O(1) check avoids O(depth) stack iteration for most names
        if !self.context_names.contains(name) {
            return Some(ReferenceKind::Reference);
        }

        // Name is in context - iterate stack to find specific kind
        for entry in self.context_stack.iter().rev() {
            match entry.kind {
                ContextKind::CallFunc => {
                    if entry.name.as_deref() == Some(name) {
                        return Some(ReferenceKind::Call);
                    }
                }
                ContextKind::AttributeAttr => {
                    if entry.name.as_deref() == Some(name) {
                        return Some(ReferenceKind::Attribute);
                    }
                }
                ContextKind::SkipName => {
                    if entry.name.as_deref() == Some(name) {
                        return None; // Skip - already handled as definition
                    }
                }
            }
        }
        Some(ReferenceKind::Reference)
    }

    /// Add a reference for a name with span looked up from PositionTable.
    fn add_reference_with_id(&mut self, name: &str, kind: ReferenceKind, node_id: Option<NodeId>) {
        let span = self.lookup_span(node_id);
        let info = CstReferenceRecord::new(kind, self.scope_path.clone()).with_span(span);

        self.references
            .entry(name.to_string())
            .or_default()
            .push(info);
    }

    /// Handle an import alias by adding a reference for the imported name.
    ///
    /// For `from x import foo as bar`:
    /// - Creates a reference for "foo" with ReferenceKind::Import
    /// - Uses the span of "foo" (not "bar") so renames update the correct location
    ///
    /// For `from x import foo`:
    /// - Creates a reference for "foo" with ReferenceKind::Import
    fn handle_import_alias(&mut self, alias: &ImportAlias<'_>) {
        // Extract the imported name and its node_id from the alias.name field
        match &alias.name {
            NameOrAttribute::N(name) => {
                // Simple import: `from x import foo` or `from x import foo as bar`
                // The span should be for the imported name (foo), not the alias (bar)
                self.add_reference_with_id(name.value, ReferenceKind::Import, name.node_id);
            }
            NameOrAttribute::A(attr) => {
                // Dotted import: `from x import foo.bar` (rare but valid)
                // Use the full attribute name
                let full_name = self.get_attribute_full_name(attr);
                // For attributes, we use the value's node_id for the span
                if let Expression::Name(name) = &*attr.value {
                    self.add_reference_with_id(&full_name, ReferenceKind::Import, name.node_id);
                }
            }
        }
    }

    /// Get the full dotted name from an Attribute node.
    fn get_attribute_full_name(&self, attr: &Attribute<'_>) -> String {
        let mut parts = vec![attr.attr.value.to_string()];
        let mut current = &*attr.value;
        loop {
            match current {
                Expression::Name(n) => {
                    parts.push(n.value.to_string());
                    break;
                }
                Expression::Attribute(a) => {
                    parts.push(a.attr.value.to_string());
                    current = &*a.value;
                }
                _ => break,
            }
        }
        parts.reverse();
        parts.join(".")
    }

    /// Mark assignment targets as definitions and add skip contexts.
    /// Returns the names that were marked for later context cleanup.
    fn mark_assign_definitions(&mut self, target: &AssignTargetExpression<'_>) -> Vec<String> {
        let mut names_with_ids: Vec<(String, Option<NodeId>)> = Vec::new();
        self.collect_assign_names_with_ids(target, &mut names_with_ids);

        // Add all definitions first
        for (name, node_id) in &names_with_ids {
            self.add_reference_with_id(name, ReferenceKind::Definition, *node_id);
        }

        // Push skip contexts for all names
        let names: Vec<String> = names_with_ids.into_iter().map(|(n, _)| n).collect();
        for name in &names {
            self.context_names.insert(name.clone());
            self.context_stack.push(ContextEntry {
                kind: ContextKind::SkipName,
                name: Some(name.clone()),
            });
        }

        names
    }

    /// Collect all names with their NodeIds from an assignment target.
    fn collect_assign_names_with_ids(
        &self,
        target: &AssignTargetExpression<'_>,
        names: &mut Vec<(String, Option<NodeId>)>,
    ) {
        match target {
            AssignTargetExpression::Name(name) => {
                names.push((name.value.to_string(), name.node_id));
            }
            AssignTargetExpression::Tuple(tuple) => {
                for element in &tuple.elements {
                    self.collect_element_names_with_ids(element, names);
                }
            }
            AssignTargetExpression::List(list) => {
                for element in &list.elements {
                    self.collect_element_names_with_ids(element, names);
                }
            }
            AssignTargetExpression::StarredElement(starred) => {
                self.collect_expression_names_with_ids(&starred.value, names);
            }
            // Attribute and Subscript don't create local definitions
            AssignTargetExpression::Attribute(_) | AssignTargetExpression::Subscript(_) => {}
        }
    }

    /// Collect names with NodeIds from tuple/list elements.
    fn collect_element_names_with_ids(
        &self,
        element: &Element<'_>,
        names: &mut Vec<(String, Option<NodeId>)>,
    ) {
        match element {
            Element::Simple { value, .. } => {
                self.collect_expression_names_with_ids(value, names);
            }
            Element::Starred(starred) => {
                self.collect_expression_names_with_ids(&starred.value, names);
            }
        }
    }

    /// Collect names with NodeIds from expressions (for nested tuple unpacking).
    fn collect_expression_names_with_ids(
        &self,
        expr: &Expression<'_>,
        names: &mut Vec<(String, Option<NodeId>)>,
    ) {
        match expr {
            Expression::Name(name) => {
                names.push((name.value.to_string(), name.node_id));
            }
            Expression::Tuple(tuple) => {
                for element in &tuple.elements {
                    self.collect_element_names_with_ids(element, names);
                }
            }
            Expression::List(list) => {
                for element in &list.elements {
                    self.collect_element_names_with_ids(element, names);
                }
            }
            Expression::StarredElement(starred) => {
                self.collect_expression_names_with_ids(&starred.value, names);
            }
            _ => {}
        }
    }

    /// Pop skip contexts for assignment names.
    fn pop_assign_contexts(&mut self, count: usize) {
        for _ in 0..count {
            if let Some(entry) = self.context_stack.last() {
                if entry.kind == ContextKind::SkipName {
                    self.context_stack.pop();
                }
            }
        }
    }
}

impl Default for ReferenceCollector<'_> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a, 'pos> Visitor<'a> for ReferenceCollector<'pos> {
    // =========================================================================
    // Context tracking for Call nodes
    // =========================================================================

    fn visit_call(&mut self, node: &Call<'a>) -> VisitResult {
        // If the function is a simple Name, track it for Call kind
        if let Expression::Name(name) = node.func.as_ref() {
            let name_str = name.value.to_string();
            self.context_names.insert(name_str.clone());
            self.context_stack.push(ContextEntry {
                kind: ContextKind::CallFunc,
                name: Some(name_str),
            });
        }
        VisitResult::Continue
    }

    fn leave_call(&mut self, node: &Call<'a>) {
        // Pop the context if we pushed it for a Name func
        if let Expression::Name(_) = node.func.as_ref() {
            if let Some(entry) = self.context_stack.last() {
                if entry.kind == ContextKind::CallFunc {
                    self.context_stack.pop();
                }
            }
        }
    }

    // =========================================================================
    // Context tracking for Attribute access
    // =========================================================================

    fn visit_attribute(&mut self, node: &Attribute<'a>) -> VisitResult {
        // Track the attribute name for Attribute kind
        let name_str = node.attr.value.to_string();
        self.context_names.insert(name_str.clone());
        self.context_stack.push(ContextEntry {
            kind: ContextKind::AttributeAttr,
            name: Some(name_str),
        });
        VisitResult::Continue
    }

    fn leave_attribute(&mut self, _node: &Attribute<'a>) {
        if let Some(entry) = self.context_stack.last() {
            if entry.kind == ContextKind::AttributeAttr {
                self.context_stack.pop();
            }
        }
    }

    // =========================================================================
    // Context tracking for Import statements
    // =========================================================================

    fn visit_import_stmt(&mut self, node: &Import<'a>) -> VisitResult {
        // Explicitly handle imports to get correct spans for aliased imports.
        // For `import foo as bar`, we want:
        // - Reference for "foo" (the imported name) with ReferenceKind::Import
        // - Skip "bar" (the alias) since it's a definition, not a reference
        for alias in &node.names {
            self.handle_import_alias(alias);
        }
        // Skip children to prevent visit_name from re-processing these names
        VisitResult::SkipChildren
    }

    fn leave_import_stmt(&mut self, _node: &Import<'a>) {
        // No context to pop since we skip children
    }

    fn visit_import_from(&mut self, node: &ImportFrom<'a>) -> VisitResult {
        // Explicitly handle imports to get correct spans for aliased imports.
        // For `from x import foo as bar`, we want:
        // - Reference for "x" (the module name) with ReferenceKind::Import
        // - Reference for "foo" (the imported name) with ReferenceKind::Import
        // - Skip "bar" (the alias) since it's a definition, not a reference

        // Handle the module name (e.g., "pathlib" in "from pathlib import Path")
        if let Some(ref module) = node.module {
            match module {
                NameOrAttribute::N(name) => {
                    self.add_reference_with_id(name.value, ReferenceKind::Import, name.node_id);
                }
                NameOrAttribute::A(attr) => {
                    // Dotted module path: visit the full attribute chain
                    let full_name = self.get_attribute_full_name(attr);
                    if let Expression::Name(name) = &*attr.value {
                        self.add_reference_with_id(&full_name, ReferenceKind::Import, name.node_id);
                    }
                }
            }
        }

        // Handle the imported names
        match &node.names {
            ImportNames::Aliases(aliases) => {
                for alias in aliases {
                    self.handle_import_alias(alias);
                }
            }
            ImportNames::Star(_) => {
                // Star imports don't create individual name references
            }
        }
        // Skip children to prevent visit_name from re-processing these names
        VisitResult::SkipChildren
    }

    fn leave_import_from(&mut self, _node: &ImportFrom<'a>) {
        // No context to pop since we skip children
    }

    // =========================================================================
    // Visit Name nodes - classify based on context
    // =========================================================================

    fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
        let name = node.value;
        if let Some(kind) = self.get_current_kind(name) {
            self.add_reference_with_id(name, kind, node.node_id);
        }
        // Don't visit children of Name (there are none meaningful)
        VisitResult::SkipChildren
    }

    // =========================================================================
    // Definition tracking - capture definitions explicitly
    // =========================================================================

    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        self.add_reference_with_id(
            node.name.value,
            ReferenceKind::Definition,
            node.name.node_id,
        );
        // Push skip context so the Name node inside isn't double-counted
        let name_str = node.name.value.to_string();
        self.context_names.insert(name_str.clone());
        self.context_stack.push(ContextEntry {
            kind: ContextKind::SkipName,
            name: Some(name_str),
        });
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        if let Some(entry) = self.context_stack.last() {
            if entry.kind == ContextKind::SkipName {
                self.context_stack.pop();
            }
        }
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        self.add_reference_with_id(
            node.name.value,
            ReferenceKind::Definition,
            node.name.node_id,
        );
        // Push skip context so the Name node inside isn't double-counted
        let name_str = node.name.value.to_string();
        self.context_names.insert(name_str.clone());
        self.context_stack.push(ContextEntry {
            kind: ContextKind::SkipName,
            name: Some(name_str),
        });
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        if let Some(entry) = self.context_stack.last() {
            if entry.kind == ContextKind::SkipName {
                self.context_stack.pop();
            }
        }
    }

    fn visit_param(&mut self, node: &Param<'a>) -> VisitResult {
        self.add_reference_with_id(
            node.name.value,
            ReferenceKind::Definition,
            node.name.node_id,
        );
        // Push skip context so the Name node inside isn't double-counted
        let name_str = node.name.value.to_string();
        self.context_names.insert(name_str.clone());
        self.context_stack.push(ContextEntry {
            kind: ContextKind::SkipName,
            name: Some(name_str),
        });
        VisitResult::Continue
    }

    fn leave_param(&mut self, _node: &Param<'a>) {
        if let Some(entry) = self.context_stack.last() {
            if entry.kind == ContextKind::SkipName {
                self.context_stack.pop();
            }
        }
    }

    fn visit_assign(&mut self, node: &Assign<'a>) -> VisitResult {
        let mut total_count = 0;
        for target in &node.targets {
            let names = self.mark_assign_definitions(&target.target);
            total_count += names.len();
        }
        self.assign_skip_counts.push(total_count);
        VisitResult::Continue
    }

    fn leave_assign(&mut self, _node: &Assign<'a>) {
        if let Some(count) = self.assign_skip_counts.pop() {
            self.pop_assign_contexts(count);
        }
    }

    fn visit_ann_assign(&mut self, node: &AnnAssign<'a>) -> VisitResult {
        let names = self.mark_assign_definitions(&node.target);
        self.assign_skip_counts.push(names.len());
        VisitResult::Continue
    }

    fn leave_ann_assign(&mut self, _node: &AnnAssign<'a>) {
        if let Some(count) = self.assign_skip_counts.pop() {
            self.pop_assign_contexts(count);
        }
    }

    // NOTE: No visit_comp_for handler needed. Comprehension iteration variables
    // are treated as References (not Definitions) for rename purposes. The default
    // traversal visits Name nodes in the target and classifies them as References.
    // This is correct because for rename operations we want to find ALL occurrences.

    fn visit_named_expr(&mut self, node: &NamedExpr<'a>) -> VisitResult {
        // Walrus operator target is a definition: (x := 5)
        // The target of a NamedExpr is an Expression (usually Name)
        if let Expression::Name(name) = node.target.as_ref() {
            self.add_reference_with_id(name.value, ReferenceKind::Definition, name.node_id);
            // Push skip context so visit_name doesn't double-count
            let name_str = name.value.to_string();
            self.context_names.insert(name_str.clone());
            self.context_stack.push(ContextEntry {
                kind: ContextKind::SkipName,
                name: Some(name_str),
            });
        }
        VisitResult::Continue
    }

    fn leave_named_expr(&mut self, _node: &NamedExpr<'a>) {
        // Pop the skip context if we pushed one
        if let Some(entry) = self.context_stack.last() {
            if entry.kind == ContextKind::SkipName {
                self.context_stack.pop();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_reference_name_collected() {
        let source = "x = 1\nprint(x)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // x is defined and referenced
        let x_refs = refs.get("x").unwrap();
        assert_eq!(x_refs.len(), 2);

        // First is definition
        assert_eq!(x_refs[0].kind, ReferenceKind::Definition);

        // Second is reference (argument to print)
        assert_eq!(x_refs[1].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_definition_collected() {
        let source = "def foo():\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let foo_refs = refs.get("foo").unwrap();
        assert_eq!(foo_refs.len(), 1);
        assert_eq!(foo_refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_call_collected() {
        let source = "foo()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let foo_refs = refs.get("foo").unwrap();
        assert_eq!(foo_refs.len(), 1);
        assert_eq!(foo_refs[0].kind, ReferenceKind::Call);
    }

    #[test]
    fn test_reference_attribute_collected() {
        let source = "obj.attr";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // obj is a reference
        let obj_refs = refs.get("obj").unwrap();
        assert_eq!(obj_refs.len(), 1);
        assert_eq!(obj_refs[0].kind, ReferenceKind::Reference);

        // attr is an attribute
        let attr_refs = refs.get("attr").unwrap();
        assert_eq!(attr_refs.len(), 1);
        assert_eq!(attr_refs[0].kind, ReferenceKind::Attribute);
    }

    #[test]
    fn test_reference_import_collected() {
        let source = "import foo";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let foo_refs = refs.get("foo").unwrap();
        assert_eq!(foo_refs.len(), 1);
        assert_eq!(foo_refs[0].kind, ReferenceKind::Import);
    }

    #[test]
    fn test_reference_from_import_collected() {
        let source = "from os import path";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // path is an import
        let path_refs = refs.get("path").unwrap();
        assert_eq!(path_refs.len(), 1);
        assert_eq!(path_refs[0].kind, ReferenceKind::Import);
    }

    #[test]
    fn test_reference_all_for_name() {
        let source = r#"
def foo():
    pass

foo()
x = foo
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let foo_refs = refs.get("foo").unwrap();
        assert_eq!(foo_refs.len(), 3);

        // Definition from def
        assert_eq!(foo_refs[0].kind, ReferenceKind::Definition);
        // Call
        assert_eq!(foo_refs[1].kind, ReferenceKind::Call);
        // Reference in assignment
        assert_eq!(foo_refs[2].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_class_definition() {
        let source = "class Foo:\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let foo_refs = refs.get("Foo").unwrap();
        assert_eq!(foo_refs.len(), 1);
        assert_eq!(foo_refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_parameter_definition() {
        let source = "def foo(a, b):\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let a_refs = refs.get("a").unwrap();
        assert_eq!(a_refs.len(), 1);
        assert_eq!(a_refs[0].kind, ReferenceKind::Definition);

        let b_refs = refs.get("b").unwrap();
        assert_eq!(b_refs.len(), 1);
        assert_eq!(b_refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_assignment_definition() {
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let x_refs = refs.get("x").unwrap();
        assert_eq!(x_refs.len(), 1);
        assert_eq!(x_refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_tuple_unpacking_definitions() {
        let source = "a, b, c = values";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        for name in &["a", "b", "c"] {
            let name_refs = refs.get(*name).unwrap();
            assert_eq!(name_refs.len(), 1);
            assert_eq!(name_refs[0].kind, ReferenceKind::Definition);
        }

        // values is a reference
        let values_refs = refs.get("values").unwrap();
        assert_eq!(values_refs.len(), 1);
        assert_eq!(values_refs[0].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_annotated_assignment() {
        let source = "x: int = 5";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let x_refs = refs.get("x").unwrap();
        assert_eq!(x_refs.len(), 1);
        assert_eq!(x_refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_method_call() {
        let source = "obj.method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // obj is a reference
        let obj_refs = refs.get("obj").unwrap();
        assert_eq!(obj_refs.len(), 1);
        assert_eq!(obj_refs[0].kind, ReferenceKind::Reference);

        // method is an attribute (the attr part of Attribute node)
        let method_refs = refs.get("method").unwrap();
        assert_eq!(method_refs.len(), 1);
        assert_eq!(method_refs[0].kind, ReferenceKind::Attribute);
    }

    #[test]
    fn test_reference_chained_calls() {
        let source = "foo().bar()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // foo is a call
        let foo_refs = refs.get("foo").unwrap();
        assert_eq!(foo_refs.len(), 1);
        assert_eq!(foo_refs[0].kind, ReferenceKind::Call);

        // bar is an attribute
        let bar_refs = refs.get("bar").unwrap();
        assert_eq!(bar_refs.len(), 1);
        assert_eq!(bar_refs[0].kind, ReferenceKind::Attribute);
    }

    #[test]
    fn test_reference_hashmap_returned() {
        let source = "x = 1\ny = x";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // collect() returns HashMap directly
        assert!(refs.contains_key("x"));
        assert!(refs.contains_key("y"));
    }

    #[test]
    fn test_reference_complex_example() {
        let source = r#"
import os
from pathlib import Path

class FileProcessor:
    def __init__(self, path):
        self.path = path

    def process(self):
        return os.path.exists(self.path)

processor = FileProcessor("test.txt")
result = processor.process()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // os is imported
        let os_refs = refs.get("os").unwrap();
        assert!(os_refs.iter().any(|r| r.kind == ReferenceKind::Import));

        // Path is imported
        let path_refs = refs.get("Path").unwrap();
        assert!(path_refs.iter().any(|r| r.kind == ReferenceKind::Import));

        // FileProcessor is defined and then called
        let fp_refs = refs.get("FileProcessor").unwrap();
        assert!(fp_refs.iter().any(|r| r.kind == ReferenceKind::Definition));
        assert!(fp_refs.iter().any(|r| r.kind == ReferenceKind::Call));

        // processor is defined and referenced
        let proc_refs = refs.get("processor").unwrap();
        assert!(proc_refs
            .iter()
            .any(|r| r.kind == ReferenceKind::Definition));
        assert!(proc_refs.iter().any(|r| r.kind == ReferenceKind::Reference));
    }

    #[test]
    fn test_reference_spans() {
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        let x_refs = refs.get("x").unwrap();
        assert_eq!(x_refs.len(), 1);

        // x is at position 0
        let span = x_refs[0].span.as_ref().unwrap();
        assert_eq!(span.start, 0);
        assert_eq!(span.end, 1);
    }

    // =========================================================================
    // Decorator argument reference tests
    // =========================================================================

    #[test]
    fn test_reference_decorator_argument() {
        // Decorator arguments should be collected as references
        let source = "@decorator(some_arg)\ndef func():\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // decorator is a call
        let dec_refs = refs.get("decorator").unwrap();
        assert_eq!(dec_refs.len(), 1);
        assert_eq!(dec_refs[0].kind, ReferenceKind::Call);

        // some_arg is a reference inside the decorator call
        let arg_refs = refs.get("some_arg").unwrap();
        assert_eq!(arg_refs.len(), 1);
        assert_eq!(arg_refs[0].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_decorator_simple() {
        // Simple decorators like @staticmethod should be collected
        let source = "@staticmethod\ndef func():\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // staticmethod is a reference (used as decorator, not called)
        let dec_refs = refs.get("staticmethod").unwrap();
        assert_eq!(dec_refs.len(), 1);
        assert_eq!(dec_refs[0].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_decorator_attribute() {
        // Attribute decorators like @module.decorator
        let source = "@module.decorator\ndef func():\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // module is a reference
        let mod_refs = refs.get("module").unwrap();
        assert_eq!(mod_refs.len(), 1);
        assert_eq!(mod_refs[0].kind, ReferenceKind::Reference);

        // decorator is an attribute
        let dec_refs = refs.get("decorator").unwrap();
        assert_eq!(dec_refs.len(), 1);
        assert_eq!(dec_refs[0].kind, ReferenceKind::Attribute);
    }

    #[test]
    fn test_reference_decorator_call_with_multiple_args() {
        // Decorator with multiple arguments
        let source = "@register(name, value)\ndef func():\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // register is a call
        let reg_refs = refs.get("register").unwrap();
        assert_eq!(reg_refs.len(), 1);
        assert_eq!(reg_refs[0].kind, ReferenceKind::Call);

        // name and value are references
        let name_refs = refs.get("name").unwrap();
        assert_eq!(name_refs.len(), 1);
        assert_eq!(name_refs[0].kind, ReferenceKind::Reference);

        let value_refs = refs.get("value").unwrap();
        assert_eq!(value_refs.len(), 1);
        assert_eq!(value_refs[0].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_class_decorator_argument() {
        // Class decorators with arguments
        let source = "@dataclass(frozen=True)\nclass MyClass:\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // dataclass is a call
        let dc_refs = refs.get("dataclass").unwrap();
        assert_eq!(dc_refs.len(), 1);
        assert_eq!(dc_refs[0].kind, ReferenceKind::Call);

        // MyClass is a definition
        let cls_refs = refs.get("MyClass").unwrap();
        assert_eq!(cls_refs.len(), 1);
        assert_eq!(cls_refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_decorator_with_method_call() {
        // Decorator using method call @obj.method()
        let source = "@factory.create(config)\ndef func():\n    pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // factory is a reference
        let factory_refs = refs.get("factory").unwrap();
        assert_eq!(factory_refs.len(), 1);
        assert_eq!(factory_refs[0].kind, ReferenceKind::Reference);

        // create is an attribute
        let create_refs = refs.get("create").unwrap();
        assert_eq!(create_refs.len(), 1);
        assert_eq!(create_refs[0].kind, ReferenceKind::Attribute);

        // config is a reference
        let config_refs = refs.get("config").unwrap();
        assert_eq!(config_refs.len(), 1);
        assert_eq!(config_refs[0].kind, ReferenceKind::Reference);
    }

    // =========================================================================
    // Comprehension iteration variable tests
    // =========================================================================

    #[test]
    fn test_reference_list_comprehension_variable() {
        let source = "[i * 2 for i in items]";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // Comprehension iteration variables are all References (not Definitions).
        // For rename purposes, we want to find ALL occurrences.
        let i_refs = refs.get("i").unwrap();
        assert_eq!(i_refs.len(), 2);
        assert!(
            i_refs.iter().all(|r| r.kind == ReferenceKind::Reference),
            "all comprehension variable occurrences should be References"
        );

        // items is a reference
        let items_refs = refs.get("items").unwrap();
        assert_eq!(items_refs.len(), 1);
        assert_eq!(items_refs[0].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_dict_comprehension_variable() {
        let source = "{k: v for k, v in items}";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // k appears twice - both as References
        let k_refs = refs.get("k").unwrap();
        assert_eq!(k_refs.len(), 2);
        assert!(k_refs.iter().all(|r| r.kind == ReferenceKind::Reference));

        // v appears twice - both as References
        let v_refs = refs.get("v").unwrap();
        assert_eq!(v_refs.len(), 2);
        assert!(v_refs.iter().all(|r| r.kind == ReferenceKind::Reference));

        // items is a reference
        let items_refs = refs.get("items").unwrap();
        assert_eq!(items_refs.len(), 1);
    }

    #[test]
    fn test_reference_comprehension_uses_outer_variable() {
        // Comprehension references a variable from outer scope
        let source = "x = [i + offset for i in items]";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // offset is a reference (from outer scope)
        let offset_refs = refs.get("offset").unwrap();
        assert_eq!(offset_refs.len(), 1);
        assert_eq!(offset_refs[0].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_for_loop_variable() {
        // For-loop iteration variables are treated as References for rename purposes
        let source = "for i in items:\n    print(i)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // i appears twice - both as References
        let i_refs = refs.get("i").unwrap();
        assert_eq!(i_refs.len(), 2, "i should have 2 references, got {:?}", i_refs);
        assert!(
            i_refs.iter().all(|r| r.kind == ReferenceKind::Reference),
            "all for-loop variable occurrences should be References"
        );
    }

    #[test]
    fn test_reference_walrus_operator_simple() {
        // Simple walrus operator test - walrus targets ARE Definitions
        let source = "if (x := 5) > 0:\n    print(x)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // x is defined (via walrus) and referenced (in print call)
        let x_refs = refs.get("x").unwrap();
        assert_eq!(x_refs.len(), 2);
        assert!(x_refs.iter().any(|r| r.kind == ReferenceKind::Definition));
        assert!(x_refs.iter().any(|r| r.kind == ReferenceKind::Reference));
    }

    #[test]
    fn test_reference_walrus_in_comprehension() {
        // Walrus operator inside comprehension
        let source = "[y for x in items if (y := x * 2) > 0]";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // y appears twice: Reference in output [y ...], Definition in walrus (y := ...)
        let y_refs = refs.get("y").unwrap();
        assert_eq!(y_refs.len(), 2, "y should have 2 references, got {:?}", y_refs);
        assert!(y_refs.iter().any(|r| r.kind == ReferenceKind::Definition));
        assert!(y_refs.iter().any(|r| r.kind == ReferenceKind::Reference));

        // x appears twice: Reference in `for x` and Reference in `x * 2`
        // (comprehension iteration variables are all References)
        let x_refs = refs.get("x").unwrap();
        assert_eq!(x_refs.len(), 2);
        assert!(x_refs.iter().all(|r| r.kind == ReferenceKind::Reference));
    }

    // =========================================================================
    // Phase A: Scope Infrastructure Tests
    // =========================================================================

    #[test]
    fn test_scope_constants_defined() {
        // Verify all SCOPE_* constants are accessible and have expected values
        use super::super::{
            SCOPE_DICTCOMP, SCOPE_GENEXPR, SCOPE_LAMBDA, SCOPE_LISTCOMP, SCOPE_MODULE,
            SCOPE_SETCOMP,
        };

        assert_eq!(SCOPE_MODULE, "<module>");
        assert_eq!(SCOPE_LAMBDA, "<lambda>");
        assert_eq!(SCOPE_LISTCOMP, "<listcomp>");
        assert_eq!(SCOPE_DICTCOMP, "<dictcomp>");
        assert_eq!(SCOPE_SETCOMP, "<setcomp>");
        assert_eq!(SCOPE_GENEXPR, "<genexpr>");
    }

    #[test]
    fn test_cst_reference_record_has_scope_path() {
        // Verify CstReferenceRecord has scope_path field accessible
        let record = CstReferenceRecord::new(
            ReferenceKind::Reference,
            vec!["<module>".to_string(), "MyClass".to_string()],
        );

        assert_eq!(record.kind, ReferenceKind::Reference);
        assert_eq!(record.scope_path, vec!["<module>", "MyClass"]);
        assert!(record.span.is_none());
    }

    #[test]
    fn test_reference_collector_initializes_module_scope() {
        use super::super::SCOPE_MODULE;

        // New collector should have scope_path initialized to [SCOPE_MODULE]
        let collector = ReferenceCollector::new();

        // We can't directly access scope_path since it's private,
        // but we can verify through collecting a reference
        // For now, just verify the collector can be created
        assert!(collector.all_references().is_empty());

        // Collector with positions should also initialize to module scope
        let positions = crate::inflate_ctx::PositionTable::new();
        let collector_with_pos = ReferenceCollector::with_positions(&positions);
        assert!(collector_with_pos.all_references().is_empty());

        // The SCOPE_MODULE constant should be accessible
        assert_eq!(SCOPE_MODULE, "<module>");
    }

    #[test]
    fn test_reference_scope_path_module_level() {
        use super::super::SCOPE_MODULE;

        // Module-level reference should have scope_path: [SCOPE_MODULE]
        let source = "x = 1\nprint(x)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let refs = ReferenceCollector::collect(&parsed.module, &parsed.positions);

        // x is defined and referenced at module level
        let x_refs = refs.get("x").unwrap();
        assert_eq!(x_refs.len(), 2);

        // Both references should have scope_path = [SCOPE_MODULE]
        for r in x_refs {
            assert_eq!(
                r.scope_path,
                vec![SCOPE_MODULE],
                "Module-level reference should have scope_path [SCOPE_MODULE]"
            );
        }

        // print is also referenced at module level
        let print_refs = refs.get("print").unwrap();
        assert_eq!(print_refs.len(), 1);
        assert_eq!(print_refs[0].scope_path, vec![SCOPE_MODULE]);
    }
}
