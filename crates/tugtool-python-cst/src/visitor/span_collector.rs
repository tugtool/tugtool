// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! SpanCollector visitor for position tracking.
//!
//! This module provides a [`SpanCollector`] visitor that traverses a CST and
//! builds a [`SpanTable`] mapping [`NodeId`]s to their source [`Span`]s.
//!
//! # NodeId Assignment
//!
//! NodeIds are assigned during inflation (parsing) and embedded directly on
//! tracked nodes (Name, Integer, Float, SimpleString, FunctionDef, ClassDef,
//! Param, Decorator). SpanCollector reads these embedded IDs rather than
//! generating them during traversal.
//!
//! # Span Collection Strategy
//!
//! Spans are byte offsets into UTF-8 source code. The start offset is inclusive
//! and the end offset is exclusive.
//!
//! Spans are recorded for nodes with meaningful, identifiable source positions:
//! - **Identifiers**: `Name` nodes
//! - **Literals**: `Integer`, `Float`, `SimpleString`
//! - **Definitions**: Function and class names
//! - **Attributes**: Attribute access names
//! - **Imports**: Import aliases
//! - **Parameters**: Parameter names
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module, SpanCollector, SpanTable, NodeId};
//!
//! let source = "x = 1";
//! let module = parse_module(source, None)?;
//!
//! // Collect spans from the parsed module
//! let span_table = SpanCollector::collect(&module, source);
//!
//! // Look up spans by NodeId
//! if let Some(span) = span_table.span_of(NodeId(3)) {
//!     println!("Node 3 spans bytes {}..{}", span.start, span.end);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::nodes::{
    AsName, Attribute, ClassDef, Decorator, Float, FunctionDef, ImportAlias, Integer, Module,
    Name, NodeId, Param, SimpleString, Span, SpanTable,
};

/// A visitor that collects spans for CST nodes using their embedded NodeIds.
///
/// SpanCollector reads embedded [`NodeId`]s from tracked nodes (assigned during
/// inflation) and records spans for nodes with meaningful source positions.
///
/// # Position Tracking
///
/// This collector uses a cursor-based approach to track position in the source.
/// As it traverses nodes in source order, it advances a cursor to find each
/// node's position. This ensures that repeated identifiers (like multiple uses
/// of `x`) each get their correct, distinct spans.
///
/// # Example
///
/// ```ignore
/// let span_table = SpanCollector::collect(&module, source);
/// ```
pub struct SpanCollector<'src> {
    /// The original source text
    source: &'src str,
    /// Table of collected spans
    spans: SpanTable,
    /// Current search cursor position in the source
    cursor: usize,
}

impl<'src> SpanCollector<'src> {
    /// Create a new SpanCollector for the given source.
    pub fn new(source: &'src str) -> Self {
        Self {
            source,
            spans: SpanTable::new(),
            cursor: 0,
        }
    }

    /// Collect spans from a parsed module.
    ///
    /// Returns the populated span table.
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
    /// let spans = SpanCollector::collect(&module, source);
    /// ```
    pub fn collect(module: &Module<'_>, source: &'src str) -> SpanTable {
        let mut collector = SpanCollector::new(source);
        walk_module(&mut collector, module);
        collector.spans
    }

    /// Get the collected SpanTable, consuming the collector.
    pub fn into_span_table(self) -> SpanTable {
        self.spans
    }

    /// Find a string in the source starting from the cursor, and advance cursor past it.
    ///
    /// Returns the span if found. The cursor is advanced to just after the found string,
    /// so subsequent searches will find later occurrences.
    fn find_and_advance(&mut self, needle: &str) -> Option<Span> {
        if needle.is_empty() {
            return None;
        }

        let search_area = &self.source[self.cursor..];
        if let Some(offset) = search_area.find(needle) {
            let start = (self.cursor + offset) as u64;
            let end = start + needle.len() as u64;
            // Advance cursor past this occurrence
            self.cursor = self.cursor + offset + needle.len();
            Some(Span::new(start, end))
        } else {
            None
        }
    }

    /// Record a span for a node.
    fn record_span(&mut self, node_id: NodeId, span: Span) {
        self.spans.insert(node_id, span);
    }

    /// Get the node_id from a tracked node, with a debug assertion.
    ///
    /// # Panics
    ///
    /// Panics in debug builds if node_id is None (indicates a non-parse-produced node).
    fn expect_node_id(node_id: Option<NodeId>, node_type: &str) -> NodeId {
        debug_assert!(
            node_id.is_some(),
            "SpanCollector: {} node missing node_id - only use with parse-produced CSTs",
            node_type
        );
        node_id.unwrap_or_else(|| {
            // In release builds, use a sentinel value to avoid panics
            // This should never happen with parse-produced trees
            NodeId(u32::MAX)
        })
    }
}

impl<'a, 'src> Visitor<'a> for SpanCollector<'src> {
    // ========================================================================
    // Identifiers (Name) - RECORD SPANS using embedded node_id
    // ========================================================================

    fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
        let id = Self::expect_node_id(node.node_id, "Name");
        if let Some(span) = self.find_and_advance(node.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Literals - RECORD SPANS using embedded node_id
    // ========================================================================

    fn visit_integer(&mut self, node: &Integer<'a>) -> VisitResult {
        let id = Self::expect_node_id(node.node_id, "Integer");
        if let Some(span) = self.find_and_advance(node.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    fn visit_float_literal(&mut self, node: &Float<'a>) -> VisitResult {
        let id = Self::expect_node_id(node.node_id, "Float");
        if let Some(span) = self.find_and_advance(node.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    fn visit_simple_string(&mut self, node: &SimpleString<'a>) -> VisitResult {
        let id = Self::expect_node_id(node.node_id, "SimpleString");
        if let Some(span) = self.find_and_advance(node.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Definitions - RECORD SPANS using embedded node_id
    // ========================================================================

    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        let id = Self::expect_node_id(node.node_id, "FunctionDef");
        // Record span for the function name (search for "def" then the name)
        // First find "def" to position cursor correctly
        if self.find_and_advance("def").is_some() {
            if let Some(span) = self.find_and_advance(node.name.value) {
                self.record_span(id, span);
            }
        }
        VisitResult::Continue
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        let id = Self::expect_node_id(node.node_id, "ClassDef");
        // Record span for the class name (search for "class" then the name)
        if self.find_and_advance("class").is_some() {
            if let Some(span) = self.find_and_advance(node.name.value) {
                self.record_span(id, span);
            }
        }
        VisitResult::Continue
    }

    fn visit_decorator(&mut self, node: &Decorator<'a>) -> VisitResult {
        // Decorator has embedded node_id but we don't record a span for it here
        // (decorator name spans are handled via the Name node inside decorator.decorator)
        let _id = Self::expect_node_id(node.node_id, "Decorator");
        VisitResult::Continue
    }

    // ========================================================================
    // Attributes - RECORD SPANS
    // Note: Attribute.attr is a Name which has its own embedded node_id.
    // We record the span for the attr Name here using find_and_advance for cursor positioning.
    // ========================================================================

    fn visit_attribute(&mut self, node: &Attribute<'a>) -> VisitResult {
        // Attribute.attr is a Name, which has embedded node_id
        let id = Self::expect_node_id(node.attr.node_id, "Attribute.attr (Name)");
        // Attribute span is just the attr name after the dot
        // First find the dot, then the attr name
        if self.find_and_advance(".").is_some() {
            if let Some(span) = self.find_and_advance(node.attr.value) {
                self.record_span(id, span);
            }
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Imports - RECORD SPANS
    // Note: Import names contain Name nodes with embedded node_ids
    // ========================================================================

    fn visit_import_alias(&mut self, node: &ImportAlias<'a>) -> VisitResult {
        match &node.name {
            crate::nodes::NameOrAttribute::N(name) => {
                let id = Self::expect_node_id(name.node_id, "ImportAlias name (Name)");
                if let Some(span) = self.find_and_advance(name.value) {
                    self.record_span(id, span);
                }
            }
            crate::nodes::NameOrAttribute::A(attr) => {
                // For dotted imports like `foo.bar`, record the last part (attr name)
                let id = Self::expect_node_id(attr.attr.node_id, "ImportAlias attr (Name)");
                if let Some(span) = self.find_and_advance(attr.attr.value) {
                    self.record_span(id, span);
                }
            }
        }
        VisitResult::Continue
    }

    fn visit_as_name(&mut self, node: &AsName<'a>) -> VisitResult {
        match &node.name {
            crate::nodes::AssignTargetExpression::Name(name) => {
                let id = Self::expect_node_id(name.node_id, "AsName name (Name)");
                // Find "as" keyword first, then the alias name
                if self.find_and_advance("as").is_some() {
                    if let Some(span) = self.find_and_advance(name.value) {
                        self.record_span(id, span);
                    }
                }
            }
            _ => {}
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Parameters - RECORD SPANS using embedded node_id
    // ========================================================================

    fn visit_param(&mut self, node: &Param<'a>) -> VisitResult {
        let id = Self::expect_node_id(node.node_id, "Param");
        if let Some(span) = self.find_and_advance(node.name.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module;

    #[test]
    fn test_span_collector_basic() {
        let source = "x = 1";
        let module = parse_module(source, None).expect("parse error");
        let span_table = SpanCollector::collect(&module, source);

        // Should have collected some spans
        assert!(!span_table.is_empty(), "Expected some spans to be collected");
    }

    #[test]
    fn test_span_collector_function() {
        let source = "def foo(): pass";
        let module = parse_module(source, None).expect("parse error");
        let span_table = SpanCollector::collect(&module, source);

        // Should have spans for function name
        assert!(!span_table.is_empty());

        // Verify function name span is accurate
        // "foo" starts at byte 4 (after "def ")
        let has_foo_span = span_table.iter().any(|(_, span)| {
            let text = &source[span.start as usize..span.end as usize];
            text == "foo"
        });
        assert!(has_foo_span, "Should have span for 'foo'");
    }

    #[test]
    fn test_nodeid_determinism() {
        let source = "x = 1\ny = 2";
        let module = parse_module(source, None).expect("parse error");

        // Parse and collect twice from the same module
        let spans1 = SpanCollector::collect(&module, source);
        let spans2 = SpanCollector::collect(&module, source);

        // Span collection should be deterministic
        assert_eq!(
            spans1.len(),
            spans2.len(),
            "Span collection should be deterministic"
        );
    }

    #[test]
    fn test_span_accuracy_identifiers() {
        let source = "x = 1";
        let module = parse_module(source, None).expect("parse error");
        let span_table = SpanCollector::collect(&module, source);

        // Find the span for "x"
        let x_span = span_table.iter().find(|(_, span)| {
            let text = &source[span.start as usize..span.end as usize];
            text == "x"
        });
        assert!(x_span.is_some(), "Should have span for 'x'");

        let (_, span) = x_span.unwrap();
        assert_eq!(span.start, 0, "'x' should start at byte 0");
        assert_eq!(span.end, 1, "'x' should end at byte 1");
    }

    #[test]
    fn test_span_accuracy_integer() {
        let source = "x = 42";
        let module = parse_module(source, None).expect("parse error");
        let span_table = SpanCollector::collect(&module, source);

        // Find the span for "42"
        let int_span = span_table.iter().find(|(_, span)| {
            let text = &source[span.start as usize..span.end as usize];
            text == "42"
        });
        assert!(int_span.is_some(), "Should have span for '42'");

        let (_, span) = int_span.unwrap();
        assert_eq!(span.start, 4, "'42' should start at byte 4");
        assert_eq!(span.end, 6, "'42' should end at byte 6");
    }

    #[test]
    fn test_multiple_identifiers() {
        let source = "x = y";
        let module = parse_module(source, None).expect("parse error");
        let span_table = SpanCollector::collect(&module, source);

        // Should have spans for both x and y
        let spans: Vec<_> = span_table.iter().collect();

        let x_span = spans.iter().find(|(_, span)| {
            let text = &source[span.start as usize..span.end as usize];
            text == "x"
        });
        let y_span = spans.iter().find(|(_, span)| {
            let text = &source[span.start as usize..span.end as usize];
            text == "y"
        });

        assert!(x_span.is_some(), "Should have span for 'x'");
        assert!(y_span.is_some(), "Should have span for 'y'");

        // Verify positions
        let (_, x) = x_span.unwrap();
        let (_, y) = y_span.unwrap();
        assert_eq!(x.start, 0);
        assert_eq!(y.start, 4);
    }

    #[test]
    fn test_function_with_params() {
        let source = "def add(a, b): return a + b";
        let module = parse_module(source, None).expect("parse error");
        let span_table = SpanCollector::collect(&module, source);

        // Should have spans for function name and parameters
        let has_add = span_table
            .iter()
            .any(|(_, span)| &source[span.start as usize..span.end as usize] == "add");
        let has_a = span_table
            .iter()
            .any(|(_, span)| &source[span.start as usize..span.end as usize] == "a");
        let has_b = span_table
            .iter()
            .any(|(_, span)| &source[span.start as usize..span.end as usize] == "b");

        assert!(has_add, "Should have span for 'add'");
        assert!(has_a, "Should have span for 'a'");
        assert!(has_b, "Should have span for 'b'");
    }

    #[test]
    fn test_span_table_helpers() {
        let source = "x = 1";
        let module = parse_module(source, None).expect("parse error");
        let span_table = SpanCollector::collect(&module, source);

        // Test SpanTable methods
        assert!(!span_table.is_empty());
        assert!(span_table.len() > 0);

        // Test iteration
        let mut found_span = false;
        for (node_id, span) in span_table.iter() {
            assert!(span.start <= span.end);
            assert!(node_id.as_u32() < 1000); // Sanity check (NodeIds can be larger now)
            found_span = true;
        }
        assert!(found_span);
    }

    #[test]
    fn test_embedded_nodeid_matches_span_collector() {
        // This test verifies that SpanCollector uses the embedded node_id from nodes
        let source = "def foo(): pass";
        let module = parse_module(source, None).expect("parse error");

        // Get the FunctionDef's embedded node_id
        if let Some(crate::nodes::Statement::Compound(
            crate::nodes::CompoundStatement::FunctionDef(func),
        )) = module.body.first()
        {
            let embedded_id = func
                .node_id
                .expect("FunctionDef should have embedded node_id");

            // Collect spans
            let span_table = SpanCollector::collect(&module, source);

            // The FunctionDef's node_id should have a span in the table
            assert!(
                span_table.span_of(embedded_id).is_some(),
                "SpanTable should contain span for FunctionDef's embedded node_id"
            );

            // Verify the span points to "foo"
            let span = span_table.span_of(embedded_id).unwrap();
            let text = &source[span.start as usize..span.end as usize];
            assert_eq!(text, "foo", "FunctionDef span should point to function name");
        } else {
            panic!("Expected FunctionDef as first statement");
        }
    }

    #[test]
    fn test_embedded_nodeid_for_name() {
        let source = "x = 1";
        let module = parse_module(source, None).expect("parse error");

        // Find the Name node for "x"
        if let Some(crate::nodes::Statement::Simple(simple)) = module.body.first() {
            if let Some(crate::nodes::SmallStatement::Assign(assign)) = simple.body.first() {
                if let Some(target) = assign.targets.first() {
                    if let crate::nodes::AssignTargetExpression::Name(name) = &target.target {
                        let embedded_id =
                            name.node_id.expect("Name should have embedded node_id");

                        // Collect spans
                        let span_table = SpanCollector::collect(&module, source);

                        // The Name's node_id should have a span in the table
                        assert!(
                            span_table.span_of(embedded_id).is_some(),
                            "SpanTable should contain span for Name's embedded node_id"
                        );

                        // Verify the span points to "x"
                        let span = span_table.span_of(embedded_id).unwrap();
                        let text = &source[span.start as usize..span.end as usize];
                        assert_eq!(text, "x", "Name span should point to identifier");
                        return;
                    }
                }
            }
        }
        panic!("Could not find Name node in AST");
    }
}
