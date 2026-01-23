// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! SpanCollector for building SpanTables from PositionTables.
//!
//! This module provides [`SpanCollector`] which extracts identifier spans from
//! a [`PositionTable`] (captured during inflation) and builds a [`SpanTable`]
//! mapping [`NodeId`]s to their source [`Span`]s.
//!
//! # Architecture
//!
//! Spans are captured during CST inflation via [`parse_module_with_positions`].
//! The `PositionTable` stores [`NodePosition`] records containing optional
//! `ident_span`, `lexical_span`, and `def_span` fields.
//!
//! `SpanCollector` provides a bridge from this inflation-time position data
//! to the simpler `SpanTable` format used by downstream consumers.
//!
//! # Span Types
//!
//! - **ident_span**: Identifier text span (for rename operations)
//! - **lexical_span**: Scope extent, excludes decorators (for containment queries)
//! - **def_span**: Complete definition including decorators (for code extraction)
//!
//! For identifier-based consumers (like rename), `SpanCollector` extracts
//! `ident_span` values from the `PositionTable`.
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, SpanCollector, SpanTable, NodeId};
//!
//! let source = "x = 1";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! // Build SpanTable from PositionTable
//! let span_table = SpanCollector::from_positions(&parsed.positions);
//!
//! // Look up spans by NodeId
//! if let Some(span) = span_table.span_of(NodeId(0)) {
//!     println!("Node 0 spans bytes {}..{}", span.start, span.end);
//! }
//! ```
//!
//! # Migration Note
//!
//! Previously, SpanCollector used cursor-based string search (`find_and_advance`)
//! to discover span positions during CST traversal. This approach was replaced
//! with token-derived positions captured during inflation, providing:
//! - **Accuracy**: No risk of finding the wrong occurrence of repeated identifiers
//! - **Determinism**: Positions derived from tokenizer, not search
//! - **Simplicity**: No cursor state to manage
//!
//! [`parse_module_with_positions`]: crate::parse_module_with_positions
//! [`PositionTable`]: crate::PositionTable
//! [`NodePosition`]: crate::NodePosition

use crate::inflate_ctx::PositionTable;
use crate::nodes::{NodeId, SpanTable};

/// A converter that builds SpanTables from PositionTables.
///
/// SpanCollector extracts identifier spans (`ident_span`) from a [`PositionTable`]
/// populated during CST inflation and builds a [`SpanTable`] for downstream use.
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let span_table = SpanCollector::from_positions(&parsed.positions);
/// ```
pub struct SpanCollector;

impl SpanCollector {
    /// Build a SpanTable from a PositionTable.
    ///
    /// This extracts `ident_span` values from the PositionTable for all nodes
    /// that have identifier spans recorded. Nodes without `ident_span` are skipped.
    ///
    /// # Arguments
    ///
    /// * `positions` - The PositionTable from `parse_module_with_positions()`
    ///
    /// # Returns
    ///
    /// A SpanTable mapping NodeIds to their identifier spans.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let parsed = parse_module_with_positions("x = 1", None)?;
    /// let spans = SpanCollector::from_positions(&parsed.positions);
    /// ```
    pub fn from_positions(positions: &PositionTable) -> SpanTable {
        let mut spans = SpanTable::new();

        for (node_id, pos) in positions.iter() {
            // Extract ident_span if present
            if let Some(span) = pos.ident_span {
                spans.insert(node_id, span);
            }
        }

        spans
    }

    /// Build a SpanTable from a PositionTable, including lexical spans.
    ///
    /// This is an extended version that includes lexical spans for scope-defining
    /// nodes (FunctionDef, ClassDef). For most use cases, [`from_positions`] is
    /// sufficient.
    ///
    /// # Note
    ///
    /// When both `ident_span` and `lexical_span` exist for a node, the `ident_span`
    /// is used. Lexical spans are only included for nodes that don't have identifier
    /// spans (i.e., scope boundaries without a name lookup).
    ///
    /// [`from_positions`]: Self::from_positions
    pub fn from_positions_with_lexical(positions: &PositionTable) -> SpanTable {
        let mut spans = SpanTable::new();

        for (node_id, pos) in positions.iter() {
            // Prefer ident_span, fall back to lexical_span
            if let Some(span) = pos.ident_span.or(pos.lexical_span) {
                spans.insert(node_id, span);
            }
        }

        spans
    }

    /// Get the node_id from a tracked node, with a debug assertion.
    ///
    /// # Panics
    ///
    /// Panics in debug builds if node_id is None (indicates a non-parse-produced node).
    #[allow(dead_code)]
    fn expect_node_id(node_id: Option<NodeId>, node_type: &str) -> NodeId {
        debug_assert!(
            node_id.is_some(),
            "SpanCollector: {} node missing node_id - only use with parse-produced CSTs",
            node_type
        );
        node_id.unwrap_or({
            // In release builds, use a sentinel value to avoid panics
            // This should never happen with parse-produced trees
            NodeId(u32::MAX)
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    // ========================================================================
    // Tests using from_positions() API
    // ========================================================================

    #[test]
    fn test_span_collector_basic() {
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

        // Should have collected some spans
        assert!(
            !span_table.is_empty(),
            "Expected some spans to be collected"
        );
    }

    #[test]
    fn test_span_collector_function() {
        let source = "def foo(): pass";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

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

        // Parse and collect twice
        let parsed1 = parse_module_with_positions(source, None).expect("parse error");
        let parsed2 = parse_module_with_positions(source, None).expect("parse error");
        let spans1 = SpanCollector::from_positions(&parsed1.positions);
        let spans2 = SpanCollector::from_positions(&parsed2.positions);

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
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

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
        // NOTE: In Phase 4, Integer literals receive node_id but NOT ident_span.
        // Span recording for literals is follow-on work.
        // This test verifies that the identifier 'x' has a span.
        let source = "x = 42";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

        // Verify we have a span for the identifier 'x'
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
    fn test_multiple_identifiers() {
        let source = "x = y";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

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
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

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
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

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
    fn test_from_positions_basic() {
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

        // Should have collected some spans
        assert!(!span_table.is_empty(), "Expected some spans from positions");
    }

    #[test]
    fn test_repeated_identifiers_have_distinct_spans() {
        // This is the key test - string search would fail here, but token-derived
        // positions should correctly identify each occurrence
        let source = "x = x + x";
        //            0   4   8
        //            ^x  ^x  ^x

        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

        // All three 'x' occurrences should have spans
        let x_spans: Vec<_> = span_table
            .iter()
            .filter(|(_, span)| &source[span.start as usize..span.end as usize] == "x")
            .collect();

        assert_eq!(x_spans.len(), 3, "Should have 3 distinct spans for 'x'");

        // Verify they have different start positions
        let mut starts: Vec<_> = x_spans.iter().map(|(_, span)| span.start).collect();
        starts.sort();
        assert_eq!(
            starts,
            vec![0, 4, 8],
            "Each 'x' should have correct position"
        );
    }

    #[test]
    fn test_repeated_identifiers_with_same_name() {
        // Another test for repeated identifiers
        let source = "a = a\nb = a";
        //            01234 567890
        //            ^a ^a   ^a

        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

        // All 'a' occurrences should have distinct spans
        let a_spans: Vec<_> = span_table
            .iter()
            .filter(|(_, span)| &source[span.start as usize..span.end as usize] == "a")
            .collect();

        assert!(
            a_spans.len() >= 3,
            "Should have at least 3 spans for 'a', got {}",
            a_spans.len()
        );
    }

    #[test]
    fn test_from_positions_function_name() {
        let source = "def my_func(): pass";
        //            01234567890123456789
        //                ^my_func: bytes 4-11

        let parsed = parse_module_with_positions(source, None).expect("parse error");
        let span_table = SpanCollector::from_positions(&parsed.positions);

        // Find the span for "my_func"
        let func_span = span_table
            .iter()
            .find(|(_, span)| &source[span.start as usize..span.end as usize] == "my_func");

        assert!(func_span.is_some(), "Should have span for 'my_func'");
        let (_, span) = func_span.unwrap();
        assert_eq!(span.start, 4, "'my_func' should start at byte 4");
        assert_eq!(span.end, 11, "'my_func' should end at byte 11");
    }

    #[test]
    fn test_from_positions_with_lexical_spans() {
        let source = "def foo(): pass\n";
        let parsed = parse_module_with_positions(source, None).expect("parse error");

        // from_positions only includes ident_spans
        let ident_spans = SpanCollector::from_positions(&parsed.positions);

        // from_positions_with_lexical includes both
        let all_spans = SpanCollector::from_positions_with_lexical(&parsed.positions);

        // with_lexical should have at least as many spans
        assert!(
            all_spans.len() >= ident_spans.len(),
            "with_lexical should have >= ident-only spans"
        );
    }

    #[test]
    fn test_embedded_nodeid_matches_span_collector() {
        // This test verifies that spans from PositionTable match embedded node_ids
        let source = "def foo(): pass";
        let parsed = parse_module_with_positions(source, None).expect("parse error");

        // Get the FunctionDef's embedded node_id
        if let Some(crate::nodes::Statement::Compound(
            crate::nodes::CompoundStatement::FunctionDef(func),
        )) = parsed.module.body.first()
        {
            // FunctionDef stores lexical/def spans, not ident spans
            // The function NAME stores the ident span
            let name_id = func
                .name
                .node_id
                .expect("Name should have embedded node_id");

            // Build span table
            let span_table = SpanCollector::from_positions(&parsed.positions);

            // The Name's node_id should have a span in the table
            assert!(
                span_table.span_of(name_id).is_some(),
                "SpanTable should contain span for function name's node_id"
            );

            // Verify the span points to "foo"
            let span = span_table.span_of(name_id).unwrap();
            let text = &source[span.start as usize..span.end as usize];
            assert_eq!(text, "foo", "Name span should point to function name");
        } else {
            panic!("Expected FunctionDef as first statement");
        }
    }

    #[test]
    fn test_embedded_nodeid_for_name() {
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).expect("parse error");

        // Find the Name node for "x"
        if let Some(crate::nodes::Statement::Simple(simple)) = parsed.module.body.first() {
            if let Some(crate::nodes::SmallStatement::Assign(assign)) = simple.body.first() {
                if let Some(target) = assign.targets.first() {
                    if let crate::nodes::AssignTargetExpression::Name(name) = &target.target {
                        let embedded_id = name.node_id.expect("Name should have embedded node_id");

                        // Build span table from positions
                        let span_table = SpanCollector::from_positions(&parsed.positions);

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
