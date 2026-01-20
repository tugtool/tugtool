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
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module, ReferenceCollector, ReferenceInfo, ReferenceKind};
//!
//! let source = "x = 1\nprint(x)";
//! let module = parse_module(source, None)?;
//!
//! let collector = ReferenceCollector::collect(&module, source);
//! for (name, refs) in collector.all_references() {
//!     println!("{}: {:?}", name, refs);
//! }
//! ```

use std::collections::HashMap;

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::nodes::{
    AnnAssign, Assign, AssignTargetExpression, Attribute, Call, ClassDef, Element, Expression,
    FunctionDef, Import, ImportFrom, Module, Name, Param, Span,
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
/// Each reference records the kind of reference and its source location.
#[derive(Debug, Clone)]
pub struct ReferenceInfo {
    /// The kind of reference.
    pub kind: ReferenceKind,
    /// Source span for the reference (byte offsets).
    pub span: Option<Span>,
}

impl ReferenceInfo {
    /// Create a new ReferenceInfo.
    fn new(kind: ReferenceKind) -> Self {
        Self { kind, span: None }
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
    /// Inside an import statement
    Import,
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
/// let collector = ReferenceCollector::collect(&module, source);
/// let refs = collector.references_for("x");
/// ```
pub struct ReferenceCollector<'src> {
    /// The original source text (for span calculation).
    source: &'src str,
    /// Map of name -> list of references.
    references: HashMap<String, Vec<ReferenceInfo>>,
    /// Context stack for determining reference kinds.
    context_stack: Vec<ContextEntry>,
    /// Current search cursor position in the source.
    cursor: usize,
    /// Stack tracking how many skip contexts were pushed by each assignment.
    assign_skip_counts: Vec<usize>,
}

impl<'src> ReferenceCollector<'src> {
    /// Create a new ReferenceCollector.
    pub fn new(source: &'src str) -> Self {
        Self {
            source,
            references: HashMap::new(),
            context_stack: Vec::new(),
            cursor: 0,
            assign_skip_counts: Vec::new(),
        }
    }

    /// Collect references from a parsed module.
    ///
    /// Returns the collector with populated reference data.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `source` - The original source code (must match what was parsed)
    ///
    /// # Example
    ///
    /// ```ignore
    /// let source = "x = 1\nprint(x)";
    /// let module = parse_module(source, None)?;
    /// let collector = ReferenceCollector::collect(&module, source);
    /// ```
    pub fn collect(module: &Module<'_>, source: &'src str) -> Self {
        let mut collector = ReferenceCollector::new(source);
        walk_module(&mut collector, module);
        collector
    }

    /// Get all references for a specific name.
    ///
    /// Returns None if the name was never referenced.
    pub fn references_for(&self, name: &str) -> Option<&Vec<ReferenceInfo>> {
        self.references.get(name)
    }

    /// Get all references as a HashMap, consuming the collector.
    pub fn into_references(self) -> HashMap<String, Vec<ReferenceInfo>> {
        self.references
    }

    /// Get a reference to the internal references map.
    pub fn all_references(&self) -> &HashMap<String, Vec<ReferenceInfo>> {
        &self.references
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

    /// Get the current reference kind based on context stack.
    /// Returns None if the name should be skipped (already handled as definition).
    fn get_current_kind(&self, name: &str) -> Option<ReferenceKind> {
        for entry in self.context_stack.iter().rev() {
            match entry.kind {
                ContextKind::Import => return Some(ReferenceKind::Import),
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

    /// Add a reference for a name.
    fn add_reference(&mut self, name: &str, kind: ReferenceKind) {
        let span = self.find_and_advance(name);
        let info = ReferenceInfo::new(kind).with_span(span);

        self.references
            .entry(name.to_string())
            .or_default()
            .push(info);
    }

    /// Mark assignment targets as definitions and add skip contexts.
    /// Returns the names that were marked for later context cleanup.
    fn mark_assign_definitions(&mut self, target: &AssignTargetExpression<'_>) -> Vec<String> {
        let mut names = Vec::new();
        self.collect_assign_names(target, &mut names);

        // Add all definitions first
        for name in &names {
            self.add_reference(name, ReferenceKind::Definition);
        }

        // Push skip contexts for all names
        for name in &names {
            self.context_stack.push(ContextEntry {
                kind: ContextKind::SkipName,
                name: Some(name.clone()),
            });
        }

        names
    }

    /// Collect all names from an assignment target.
    fn collect_assign_names(&self, target: &AssignTargetExpression<'_>, names: &mut Vec<String>) {
        match target {
            AssignTargetExpression::Name(name) => {
                names.push(name.value.to_string());
            }
            AssignTargetExpression::Tuple(tuple) => {
                for element in &tuple.elements {
                    self.collect_element_names(element, names);
                }
            }
            AssignTargetExpression::List(list) => {
                for element in &list.elements {
                    self.collect_element_names(element, names);
                }
            }
            AssignTargetExpression::StarredElement(starred) => {
                self.collect_expression_names(&starred.value, names);
            }
            // Attribute and Subscript don't create local definitions
            AssignTargetExpression::Attribute(_) | AssignTargetExpression::Subscript(_) => {}
        }
    }

    /// Collect names from tuple/list elements.
    fn collect_element_names(&self, element: &Element<'_>, names: &mut Vec<String>) {
        match element {
            Element::Simple { value, .. } => {
                self.collect_expression_names(value, names);
            }
            Element::Starred(starred) => {
                self.collect_expression_names(&starred.value, names);
            }
        }
    }

    /// Collect names from expressions (for nested tuple unpacking).
    fn collect_expression_names(&self, expr: &Expression<'_>, names: &mut Vec<String>) {
        match expr {
            Expression::Name(name) => {
                names.push(name.value.to_string());
            }
            Expression::Tuple(tuple) => {
                for element in &tuple.elements {
                    self.collect_element_names(element, names);
                }
            }
            Expression::List(list) => {
                for element in &list.elements {
                    self.collect_element_names(element, names);
                }
            }
            Expression::StarredElement(starred) => {
                self.collect_expression_names(&starred.value, names);
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

impl<'a, 'src> Visitor<'a> for ReferenceCollector<'src> {
    // =========================================================================
    // Context tracking for Call nodes
    // =========================================================================

    fn visit_call(&mut self, node: &Call<'a>) -> VisitResult {
        // If the function is a simple Name, track it for Call kind
        if let Expression::Name(name) = node.func.as_ref() {
            self.context_stack.push(ContextEntry {
                kind: ContextKind::CallFunc,
                name: Some(name.value.to_string()),
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
        self.context_stack.push(ContextEntry {
            kind: ContextKind::AttributeAttr,
            name: Some(node.attr.value.to_string()),
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

    fn visit_import_stmt(&mut self, _node: &Import<'a>) -> VisitResult {
        self.context_stack.push(ContextEntry {
            kind: ContextKind::Import,
            name: None,
        });
        VisitResult::Continue
    }

    fn leave_import_stmt(&mut self, _node: &Import<'a>) {
        if let Some(entry) = self.context_stack.last() {
            if entry.kind == ContextKind::Import {
                self.context_stack.pop();
            }
        }
    }

    fn visit_import_from(&mut self, _node: &ImportFrom<'a>) -> VisitResult {
        self.context_stack.push(ContextEntry {
            kind: ContextKind::Import,
            name: None,
        });
        VisitResult::Continue
    }

    fn leave_import_from(&mut self, _node: &ImportFrom<'a>) {
        if let Some(entry) = self.context_stack.last() {
            if entry.kind == ContextKind::Import {
                self.context_stack.pop();
            }
        }
    }

    // =========================================================================
    // Visit Name nodes - classify based on context
    // =========================================================================

    fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
        let name = node.value;
        if let Some(kind) = self.get_current_kind(name) {
            self.add_reference(name, kind);
        }
        // Don't visit children of Name (there are none meaningful)
        VisitResult::SkipChildren
    }

    // =========================================================================
    // Definition tracking - capture definitions explicitly
    // =========================================================================

    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        self.add_reference(node.name.value, ReferenceKind::Definition);
        // Push skip context so the Name node inside isn't double-counted
        self.context_stack.push(ContextEntry {
            kind: ContextKind::SkipName,
            name: Some(node.name.value.to_string()),
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
        self.add_reference(node.name.value, ReferenceKind::Definition);
        // Push skip context so the Name node inside isn't double-counted
        self.context_stack.push(ContextEntry {
            kind: ContextKind::SkipName,
            name: Some(node.name.value.to_string()),
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
        self.add_reference(node.name.value, ReferenceKind::Definition);
        // Push skip context so the Name node inside isn't double-counted
        self.context_stack.push(ContextEntry {
            kind: ContextKind::SkipName,
            name: Some(node.name.value.to_string()),
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module;

    #[test]
    fn test_reference_name_collected() {
        let source = "x = 1\nprint(x)";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        // x is defined and referenced
        let refs = collector.references_for("x").unwrap();
        assert_eq!(refs.len(), 2);

        // First is definition
        assert_eq!(refs[0].kind, ReferenceKind::Definition);

        // Second is reference (argument to print)
        assert_eq!(refs[1].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_definition_collected() {
        let source = "def foo():\n    pass";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.references_for("foo").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_call_collected() {
        let source = "foo()";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.references_for("foo").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, ReferenceKind::Call);
    }

    #[test]
    fn test_reference_attribute_collected() {
        let source = "obj.attr";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        // obj is a reference
        let obj_refs = collector.references_for("obj").unwrap();
        assert_eq!(obj_refs.len(), 1);
        assert_eq!(obj_refs[0].kind, ReferenceKind::Reference);

        // attr is an attribute
        let attr_refs = collector.references_for("attr").unwrap();
        assert_eq!(attr_refs.len(), 1);
        assert_eq!(attr_refs[0].kind, ReferenceKind::Attribute);
    }

    #[test]
    fn test_reference_import_collected() {
        let source = "import foo";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.references_for("foo").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, ReferenceKind::Import);
    }

    #[test]
    fn test_reference_from_import_collected() {
        let source = "from os import path";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        // path is an import
        let refs = collector.references_for("path").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, ReferenceKind::Import);
    }

    #[test]
    fn test_reference_all_for_name() {
        let source = r#"
def foo():
    pass

foo()
x = foo
"#;
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.references_for("foo").unwrap();
        assert_eq!(refs.len(), 3);

        // Definition from def
        assert_eq!(refs[0].kind, ReferenceKind::Definition);
        // Call
        assert_eq!(refs[1].kind, ReferenceKind::Call);
        // Reference in assignment
        assert_eq!(refs[2].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_class_definition() {
        let source = "class Foo:\n    pass";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.references_for("Foo").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_parameter_definition() {
        let source = "def foo(a, b):\n    pass";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let a_refs = collector.references_for("a").unwrap();
        assert_eq!(a_refs.len(), 1);
        assert_eq!(a_refs[0].kind, ReferenceKind::Definition);

        let b_refs = collector.references_for("b").unwrap();
        assert_eq!(b_refs.len(), 1);
        assert_eq!(b_refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_assignment_definition() {
        let source = "x = 1";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.references_for("x").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_tuple_unpacking_definitions() {
        let source = "a, b, c = values";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        for name in &["a", "b", "c"] {
            let refs = collector.references_for(name).unwrap();
            assert_eq!(refs.len(), 1);
            assert_eq!(refs[0].kind, ReferenceKind::Definition);
        }

        // values is a reference
        let refs = collector.references_for("values").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, ReferenceKind::Reference);
    }

    #[test]
    fn test_reference_annotated_assignment() {
        let source = "x: int = 5";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.references_for("x").unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, ReferenceKind::Definition);
    }

    #[test]
    fn test_reference_method_call() {
        let source = "obj.method()";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        // obj is a reference
        let obj_refs = collector.references_for("obj").unwrap();
        assert_eq!(obj_refs.len(), 1);
        assert_eq!(obj_refs[0].kind, ReferenceKind::Reference);

        // method is an attribute (the attr part of Attribute node)
        let method_refs = collector.references_for("method").unwrap();
        assert_eq!(method_refs.len(), 1);
        assert_eq!(method_refs[0].kind, ReferenceKind::Attribute);
    }

    #[test]
    fn test_reference_chained_calls() {
        let source = "foo().bar()";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        // foo is a call
        let foo_refs = collector.references_for("foo").unwrap();
        assert_eq!(foo_refs.len(), 1);
        assert_eq!(foo_refs[0].kind, ReferenceKind::Call);

        // bar is an attribute
        let bar_refs = collector.references_for("bar").unwrap();
        assert_eq!(bar_refs.len(), 1);
        assert_eq!(bar_refs[0].kind, ReferenceKind::Attribute);
    }

    #[test]
    fn test_reference_into_references() {
        let source = "x = 1\ny = x";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.into_references();
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
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        // os is imported
        let os_refs = collector.references_for("os").unwrap();
        assert!(os_refs.iter().any(|r| r.kind == ReferenceKind::Import));

        // Path is imported
        let path_refs = collector.references_for("Path").unwrap();
        assert!(path_refs.iter().any(|r| r.kind == ReferenceKind::Import));

        // FileProcessor is defined and then called
        let fp_refs = collector.references_for("FileProcessor").unwrap();
        assert!(fp_refs.iter().any(|r| r.kind == ReferenceKind::Definition));
        assert!(fp_refs.iter().any(|r| r.kind == ReferenceKind::Call));

        // processor is defined and referenced
        let proc_refs = collector.references_for("processor").unwrap();
        assert!(proc_refs.iter().any(|r| r.kind == ReferenceKind::Definition));
        assert!(proc_refs.iter().any(|r| r.kind == ReferenceKind::Reference));
    }

    #[test]
    fn test_reference_spans() {
        let source = "x = 1";
        let module = parse_module(source, None).unwrap();
        let collector = ReferenceCollector::collect(&module, source);

        let refs = collector.references_for("x").unwrap();
        assert_eq!(refs.len(), 1);

        // x is at position 0
        let span = refs[0].span.as_ref().unwrap();
        assert_eq!(span.start, 0);
        assert_eq!(span.end, 1);
    }
}
