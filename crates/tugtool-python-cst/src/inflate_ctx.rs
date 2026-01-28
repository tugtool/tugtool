// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Inflation context for CST node construction with position tracking.
//!
//! This module provides [`InflateCtx`], a context object threaded through CST inflation
//! that enables:
//! - Stable identity assignment via [`NodeIdGenerator`]
//! - Optional position/span capture via [`PositionTable`]
//!
//! # Architecture
//!
//! During inflation, deflated CST nodes are transformed into their inflated counterparts.
//! The `InflateCtx` replaces the previous `&Config<'a>` parameter to allow mutable access
//! for identity and position tracking.
//!
//! # Position Tracking
//!
//! When position tracking is enabled, [`NodePosition`] records are stored in a
//! [`PositionTable`] keyed by [`NodeId`]. Each `NodePosition` can store up to three
//! span types:
//!
//! - **Identifier span**: Just the name text (for rename operations)
//! - **Lexical span**: Scope extent, excludes decorators (for containment queries)
//! - **Definition span**: Complete extractable definition including decorators
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, InflateCtx};
//!
//! // Parse with position tracking enabled
//! let parsed = parse_module_with_positions(source, None)?;
//! let positions = parsed.positions;
//! ```

use crate::nodes::traits::{NodeId, NodeIdGenerator};
use crate::tokenizer::whitespace_parser::Config as WhitespaceConfig;
use tugtool_core::patch::Span;

/// Position information for a single node. Different span types serve different purposes.
///
/// Not all fields will be populated for every node - only the relevant spans are recorded:
/// - `Name` nodes: `ident_span` (the identifier text)
/// - `FunctionDef`/`ClassDef`: `lexical_span` and `def_span` (scope boundaries)
/// - `If` nodes: `branch_span` (the body where type narrowing applies)
#[derive(Debug, Clone, Default)]
pub struct NodePosition {
    /// Identifier span: just the name text (for rename operations).
    ///
    /// This is the byte range covering only the identifier itself.
    /// For example, in `def foo():`, the ident_span for `foo` covers just "foo".
    pub ident_span: Option<Span>,

    /// Lexical span: scope extent, excludes decorators (for containment queries).
    ///
    /// This is the byte range defining where variables resolve to this scope.
    /// For functions, starts at `def` (or `async def`), NOT at decorators.
    pub lexical_span: Option<Span>,

    /// Definition span: complete extractable definition, includes decorators (for code extraction).
    ///
    /// This is the byte range for the complete definition, including decorators.
    /// For decorated functions, starts at the first `@` token.
    pub def_span: Option<Span>,

    /// Branch span: the body of a conditional branch (for type narrowing).
    ///
    /// For `If` nodes, this spans from after the colon to the end of the body Suite.
    /// isinstance-based type narrowing only applies within this span.
    pub branch_span: Option<Span>,
}

/// Maps NodeId to position information using Vec indexing for O(1) access.
///
/// Since [`NodeIdGenerator`] assigns sequential IDs starting from 0, we can use
/// `Vec<Option<NodePosition>>` indexed by `NodeId.0` instead of HashMap for better
/// cache locality and lower constant factors.
#[derive(Debug, Default)]
pub struct PositionTable {
    positions: Vec<Option<NodePosition>>,
}

impl PositionTable {
    /// Create an empty PositionTable.
    pub fn new() -> Self {
        Self {
            positions: Vec::new(),
        }
    }

    /// Create a PositionTable with pre-allocated capacity.
    ///
    /// Use this when you know approximately how many nodes will be tracked.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            positions: Vec::with_capacity(capacity),
        }
    }

    /// Get position information for a node, if present.
    pub fn get(&self, id: &NodeId) -> Option<&NodePosition> {
        let idx = id.0 as usize;
        self.positions.get(idx).and_then(|opt| opt.as_ref())
    }

    /// Insert position information for a node.
    ///
    /// If the Vec is too small, it is grown to accommodate the new index.
    /// Growth uses `resize(idx + 1, None)` to ensure exactly enough space.
    pub fn insert(&mut self, id: NodeId, position: NodePosition) {
        let idx = id.0 as usize;
        if idx >= self.positions.len() {
            self.positions.resize(idx + 1, None);
        }
        self.positions[idx] = Some(position);
    }

    /// Get a mutable reference to position information, inserting a default if absent.
    ///
    /// This provides entry-like semantics with an explicit default value since
    /// `NodePosition` is `Default` but we want to be explicit about initialization.
    pub fn get_or_insert(&mut self, id: NodeId, default: NodePosition) -> &mut NodePosition {
        let idx = id.0 as usize;
        if idx >= self.positions.len() {
            self.positions.resize(idx + 1, None);
        }
        if self.positions[idx].is_none() {
            self.positions[idx] = Some(default);
        }
        self.positions[idx].as_mut().unwrap()
    }

    /// Returns the number of nodes with position information.
    ///
    /// Note: This counts only nodes that have been inserted, not the Vec capacity.
    pub fn len(&self) -> usize {
        self.positions.iter().filter(|opt| opt.is_some()).count()
    }

    /// Returns true if no positions have been recorded.
    pub fn is_empty(&self) -> bool {
        self.positions.iter().all(|opt| opt.is_none())
    }

    /// Returns an iterator over (NodeId, &NodePosition) pairs.
    ///
    /// Unlike HashMap's iter() which returns (&K, &V), this returns (K, &V)
    /// since NodeId is Copy and small. Callers that previously used
    /// `for (&node_id, pos) in table.iter()` should update to
    /// `for (node_id, pos) in table.iter()`.
    pub fn iter(&self) -> impl Iterator<Item = (NodeId, &NodePosition)> {
        self.positions
            .iter()
            .enumerate()
            .filter_map(|(idx, opt)| opt.as_ref().map(|pos| (NodeId::new(idx as u32), pos)))
    }
}

/// Context threaded through inflation for identity assignment and position capture.
///
/// This struct replaces the previous `&Config<'a>` parameter in the `Inflate` trait,
/// providing mutable access needed for:
/// - NodeId assignment via `ids.next_id()`
/// - Position recording via `record_*_span()` methods
///
/// # Construction
///
/// Use [`InflateCtx::new`] for inflation without position tracking (minimal overhead),
/// or [`InflateCtx::with_positions`] when position data is needed.
pub struct InflateCtx<'a> {
    /// Existing whitespace/config inputs needed by inflate code.
    pub ws: WhitespaceConfig<'a>,

    /// Stable identity assignment - generates sequential NodeIds.
    pub ids: NodeIdGenerator,

    /// Optional position capture - None if caller doesn't need positions.
    pub positions: Option<PositionTable>,
}

impl<'a> InflateCtx<'a> {
    /// Create context for inflation without position tracking.
    ///
    /// This is the lightweight path for parsing when positions aren't needed.
    pub fn new(ws: WhitespaceConfig<'a>) -> Self {
        Self {
            ws,
            ids: NodeIdGenerator::new(),
            positions: None,
        }
    }

    /// Create context for inflation with position tracking enabled.
    ///
    /// Use this when you need to access span information after parsing.
    pub fn with_positions(ws: WhitespaceConfig<'a>) -> Self {
        Self {
            ws,
            ids: NodeIdGenerator::new(),
            positions: Some(PositionTable::new()),
        }
    }

    /// Generate the next NodeId.
    ///
    /// NodeIds are assigned sequentially in pre-order traversal order.
    pub fn next_id(&mut self) -> NodeId {
        self.ids.next_id()
    }

    /// Record an identifier span for a node (if position tracking enabled).
    ///
    /// The identifier span covers just the name text, e.g., "foo" in `def foo():`.
    pub fn record_ident_span(&mut self, id: NodeId, span: Span) {
        if let Some(ref mut positions) = self.positions {
            positions
                .get_or_insert(id, NodePosition::default())
                .ident_span = Some(span);
        }
    }

    /// Record a lexical span for a node (if position tracking enabled).
    ///
    /// The lexical span defines the scope extent, starting at `def`/`class`,
    /// NOT at decorators.
    pub fn record_lexical_span(&mut self, id: NodeId, span: Span) {
        if let Some(ref mut positions) = self.positions {
            positions
                .get_or_insert(id, NodePosition::default())
                .lexical_span = Some(span);
        }
    }

    /// Record a definition span for a node (if position tracking enabled).
    ///
    /// The definition span covers the complete extractable definition,
    /// including decorators if present.
    pub fn record_def_span(&mut self, id: NodeId, span: Span) {
        if let Some(ref mut positions) = self.positions {
            positions
                .get_or_insert(id, NodePosition::default())
                .def_span = Some(span);
        }
    }

    /// Record a branch span for a node (if position tracking enabled).
    ///
    /// The branch span covers the body of a conditional, from after the colon
    /// to the end of the suite. Used for isinstance-based type narrowing.
    pub fn record_branch_span(&mut self, id: NodeId, span: Span) {
        if let Some(ref mut positions) = self.positions {
            positions
                .get_or_insert(id, NodePosition::default())
                .branch_span = Some(span);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inflate_ctx_id_generation_is_sequential() {
        let ws = WhitespaceConfig::empty();
        let mut ctx = InflateCtx::new(ws);

        assert_eq!(ctx.next_id(), NodeId::new(0));
        assert_eq!(ctx.next_id(), NodeId::new(1));
        assert_eq!(ctx.next_id(), NodeId::new(2));
        assert_eq!(ctx.ids.count(), 3);
    }

    #[test]
    fn test_inflate_ctx_span_recording_when_disabled() {
        let ws = WhitespaceConfig::empty();
        let mut ctx = InflateCtx::new(ws);

        let id = ctx.next_id();
        ctx.record_ident_span(id, Span { start: 0, end: 3 });

        // Positions should be None when tracking is disabled
        assert!(ctx.positions.is_none());
    }

    #[test]
    fn test_inflate_ctx_span_recording_when_enabled() {
        let ws = WhitespaceConfig::empty();
        let mut ctx = InflateCtx::with_positions(ws);

        let id = ctx.next_id();
        ctx.record_ident_span(id, Span { start: 0, end: 3 });
        ctx.record_lexical_span(id, Span { start: 0, end: 20 });
        ctx.record_def_span(id, Span { start: 0, end: 25 });

        let positions = ctx.positions.as_ref().unwrap();
        let pos = positions.get(&id).unwrap();

        assert_eq!(pos.ident_span, Some(Span { start: 0, end: 3 }));
        assert_eq!(pos.lexical_span, Some(Span { start: 0, end: 20 }));
        assert_eq!(pos.def_span, Some(Span { start: 0, end: 25 }));
    }

    #[test]
    fn test_inflate_ctx_multiple_nodes() {
        let ws = WhitespaceConfig::empty();
        let mut ctx = InflateCtx::with_positions(ws);

        let id1 = ctx.next_id();
        let id2 = ctx.next_id();

        ctx.record_ident_span(id1, Span { start: 0, end: 3 });
        ctx.record_ident_span(id2, Span { start: 10, end: 15 });

        let positions = ctx.positions.as_ref().unwrap();
        assert_eq!(positions.len(), 2);
        assert_eq!(
            positions.get(&id1).unwrap().ident_span,
            Some(Span { start: 0, end: 3 })
        );
        assert_eq!(
            positions.get(&id2).unwrap().ident_span,
            Some(Span { start: 10, end: 15 })
        );
    }
}
