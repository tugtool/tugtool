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
//! NodeIds are assigned deterministically in **pre-order** traversal order:
//! - Parent nodes receive lower NodeIds than their children
//! - Left siblings receive lower NodeIds than right siblings
//! - The same source code always produces the same NodeId assignments
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
//! use tugtool_cst::{parse_module, SpanCollector, SpanTable, NodeId};
//!
//! let source = "x = 1";
//! let module = parse_module(source, None)?;
//!
//! // Collect spans from the parsed module
//! let (node_count, span_table) = SpanCollector::collect(&module, source);
//!
//! // Look up spans by NodeId
//! if let Some(span) = span_table.span_of(NodeId(3)) {
//!     println!("Node 3 spans bytes {}..{}", span.start, span.end);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::nodes::{
    AsName, Attribute, ClassDef, Float, FunctionDef, ImportAlias, Integer, Module, Name, NodeId,
    NodeIdGenerator, Param, SimpleString, Span, SpanTable,
};

/// A visitor that assigns NodeIds and collects spans for CST nodes.
///
/// SpanCollector assigns deterministic [`NodeId`]s to nodes in pre-order
/// traversal order and records spans for nodes with meaningful source positions.
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
/// let (node_count, span_table) = SpanCollector::collect(&module, source);
/// ```
pub struct SpanCollector<'src> {
    /// The original source text
    source: &'src str,
    /// Generator for assigning NodeIds
    id_gen: NodeIdGenerator,
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
            id_gen: NodeIdGenerator::new(),
            spans: SpanTable::new(),
            cursor: 0,
        }
    }

    /// Collect spans from a parsed module.
    ///
    /// Returns the total node count and the populated span table.
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
    /// let (count, spans) = SpanCollector::collect(&module, source);
    /// ```
    pub fn collect(module: &Module<'_>, source: &'src str) -> (u32, SpanTable) {
        let mut collector = SpanCollector::new(source);
        walk_module(&mut collector, module);
        (collector.id_gen.count(), collector.spans)
    }

    /// Get the current NodeId count.
    pub fn node_count(&self) -> u32 {
        self.id_gen.count()
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
}

impl<'a, 'src> Visitor<'a> for SpanCollector<'src> {
    // ========================================================================
    // Module - root node, gets NodeId(0)
    // ========================================================================

    fn visit_module(&mut self, _node: &Module<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        // Module spans the whole file, no need to record
        VisitResult::Continue
    }

    // ========================================================================
    // Statements - assign IDs but typically don't record spans
    // ========================================================================

    fn visit_statement(&mut self, _node: &crate::nodes::Statement<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_simple_statement_line(
        &mut self,
        _node: &crate::nodes::SimpleStatementLine<'a>,
    ) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_small_statement(&mut self, _node: &crate::nodes::SmallStatement<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    // ========================================================================
    // Identifiers (Name) - RECORD SPANS
    // ========================================================================

    fn visit_name(&mut self, node: &Name<'a>) -> VisitResult {
        let id = self.id_gen.next();
        if let Some(span) = self.find_and_advance(node.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Literals - RECORD SPANS
    // ========================================================================

    fn visit_integer(&mut self, node: &Integer<'a>) -> VisitResult {
        let id = self.id_gen.next();
        if let Some(span) = self.find_and_advance(node.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    fn visit_float_literal(&mut self, node: &Float<'a>) -> VisitResult {
        let id = self.id_gen.next();
        if let Some(span) = self.find_and_advance(node.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    fn visit_simple_string(&mut self, node: &SimpleString<'a>) -> VisitResult {
        let id = self.id_gen.next();
        if let Some(span) = self.find_and_advance(node.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Definitions - RECORD SPANS for names
    // ========================================================================

    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        let id = self.id_gen.next();
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
        let id = self.id_gen.next();
        // Record span for the class name (search for "class" then the name)
        if self.find_and_advance("class").is_some() {
            if let Some(span) = self.find_and_advance(node.name.value) {
                self.record_span(id, span);
            }
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Attributes - RECORD SPANS for attr name
    // ========================================================================

    fn visit_attribute(&mut self, node: &Attribute<'a>) -> VisitResult {
        let id = self.id_gen.next();
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
    // ========================================================================

    fn visit_import_alias(&mut self, node: &ImportAlias<'a>) -> VisitResult {
        let id = self.id_gen.next();
        match &node.name {
            crate::nodes::NameOrAttribute::N(name) => {
                if let Some(span) = self.find_and_advance(name.value) {
                    self.record_span(id, span);
                }
            }
            crate::nodes::NameOrAttribute::A(attr) => {
                // For dotted imports like `foo.bar`, record the full span
                // This is simplified - just records the last part
                if let Some(span) = self.find_and_advance(attr.attr.value) {
                    self.record_span(id, span);
                }
            }
        }
        VisitResult::Continue
    }

    fn visit_as_name(&mut self, node: &AsName<'a>) -> VisitResult {
        let id = self.id_gen.next();
        match &node.name {
            crate::nodes::AssignTargetExpression::Name(name) => {
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
    // Parameters - RECORD SPANS for param names
    // ========================================================================

    fn visit_param(&mut self, node: &Param<'a>) -> VisitResult {
        let id = self.id_gen.next();
        if let Some(span) = self.find_and_advance(node.name.value) {
            self.record_span(id, span);
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Expressions - assign IDs
    // ========================================================================

    fn visit_expression(&mut self, _node: &crate::nodes::Expression<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    // ========================================================================
    // Other nodes - assign IDs to maintain deterministic ordering
    // ========================================================================

    fn visit_assign(&mut self, _node: &crate::nodes::Assign<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_assign_target(&mut self, _node: &crate::nodes::AssignTarget<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_suite(&mut self, _node: &crate::nodes::Suite<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_parameters(&mut self, _node: &crate::nodes::Parameters<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_import_stmt(&mut self, _node: &crate::nodes::Import<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_import_from(&mut self, _node: &crate::nodes::ImportFrom<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_call(&mut self, _node: &crate::nodes::Call<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_arg(&mut self, _node: &crate::nodes::Arg<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_binary_operation(
        &mut self,
        _node: &crate::nodes::BinaryOperation<'a>,
    ) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_unary_operation(&mut self, _node: &crate::nodes::UnaryOperation<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_comparison(&mut self, _node: &crate::nodes::Comparison<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_if_stmt(&mut self, _node: &crate::nodes::If<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_for_stmt(&mut self, _node: &crate::nodes::For<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_while_stmt(&mut self, _node: &crate::nodes::While<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_return_stmt(&mut self, _node: &crate::nodes::Return<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_pass_stmt(&mut self, _node: &crate::nodes::Pass<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_break_stmt(&mut self, _node: &crate::nodes::Break<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_continue_stmt(&mut self, _node: &crate::nodes::Continue<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_tuple(&mut self, _node: &crate::nodes::Tuple<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_list(&mut self, _node: &crate::nodes::List<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_dict(&mut self, _node: &crate::nodes::Dict<'a>) -> VisitResult {
        let _id = self.id_gen.next();
        VisitResult::Continue
    }

    fn visit_set(&mut self, _node: &crate::nodes::Set<'a>) -> VisitResult {
        let _id = self.id_gen.next();
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
        let (node_count, span_table) = SpanCollector::collect(&module, source);

        // Should have collected some nodes
        assert!(node_count > 0, "Expected some nodes to be counted");
        // Should have collected some spans
        assert!(!span_table.is_empty(), "Expected some spans to be collected");
    }

    #[test]
    fn test_span_collector_function() {
        let source = "def foo(): pass";
        let module = parse_module(source, None).expect("parse error");
        let (node_count, span_table) = SpanCollector::collect(&module, source);

        assert!(node_count > 0);
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

        // Parse and collect twice
        let (count1, spans1) = SpanCollector::collect(&module, source);
        let (count2, spans2) = SpanCollector::collect(&module, source);

        // Node counts should be identical for the same tree
        assert_eq!(count1, count2, "NodeId assignment should be deterministic");
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
        let (_, span_table) = SpanCollector::collect(&module, source);

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
        let (_, span_table) = SpanCollector::collect(&module, source);

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
        let (_, span_table) = SpanCollector::collect(&module, source);

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
        let (_, span_table) = SpanCollector::collect(&module, source);

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
        let (_, span_table) = SpanCollector::collect(&module, source);

        // Test SpanTable methods
        assert!(!span_table.is_empty());
        assert!(span_table.len() > 0);

        // Test iteration
        let mut found_span = false;
        for (node_id, span) in span_table.iter() {
            assert!(span.start <= span.end);
            assert!(node_id.as_u32() < 100); // Sanity check
            found_span = true;
        }
        assert!(found_span);
    }
}
