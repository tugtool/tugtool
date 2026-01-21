// Copyright (c) Meta Platforms, Inc. and affiliates.
// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree

//! Core traits and types for CST nodes.
//!
//! # Node Identity and Position Tracking
//!
//! ## NodeId
//!
//! [`NodeId`] provides stable identity for CST nodes. Each node receives a unique,
//! deterministic identifier during construction. NodeIds are assigned in pre-order
//! traversal order (parent before children, left-to-right).
//!
//! ```text
//! Given code: x = 1
//! NodeId assignment order:
//!   NodeId(0) -> Module
//!   NodeId(1) -> Statement
//!   NodeId(2) -> Assign
//!   NodeId(3) -> Name "x"
//!   NodeId(4) -> Integer "1"
//! ```
//!
//! ## SpanTable
//!
//! [`SpanTable`] stores source positions (byte offsets) for nodes, keyed by [`NodeId`].
//! Not all nodes have spans recorded - only nodes with meaningful source positions
//! (identifiers, literals, definitions) are tracked.
//!
//! Spans use [`tugtool_core::patch::Span`] with u64 byte offsets into UTF-8 source.

use crate::{
    inflate_ctx::InflateCtx,
    nodes::expression::{DeflatedLeftParen, DeflatedRightParen},
    nodes::op::DeflatedComma,
    tokenizer::whitespace_parser::WhitespaceError,
    Codegen, CodegenState, EmptyLine, LeftParen, RightParen,
};
use std::collections::HashMap;
use std::ops::Deref;

// Re-export Span from tugtool_core for convenience
pub use tugtool_core::patch::Span;

// ============================================================================
// Node Identity
// ============================================================================

/// A stable, unique identifier for a CST node.
///
/// NodeIds are assigned deterministically during CST construction in pre-order
/// traversal order. This ensures:
/// - The same source code always produces the same NodeId assignments
/// - Parent nodes have lower NodeIds than their children
/// - Left siblings have lower NodeIds than right siblings
///
/// NodeIds are the key for side tables like [`SpanTable`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(pub u32);

impl NodeId {
    /// Create a new NodeId with the given value.
    pub fn new(id: u32) -> Self {
        Self(id)
    }

    /// Get the raw u32 value.
    pub fn as_u32(&self) -> u32 {
        self.0
    }
}

impl std::fmt::Display for NodeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "NodeId({})", self.0)
    }
}

// ============================================================================
// Span Table
// ============================================================================

/// A table mapping [`NodeId`]s to their source [`Span`]s.
///
/// Not all nodes have spans recorded. Spans are captured for nodes with
/// meaningful source positions, including:
/// - Identifiers (`Name`)
/// - Function and class definitions (`FunctionDef`, `ClassDef`)
/// - Parameters (`Param`)
/// - Import aliases (`ImportAlias`, `AsName`)
/// - Attributes (`Attribute`)
/// - Literals (`Integer`, `Float`, `SimpleString`)
///
/// Spans are byte offsets into UTF-8 source code. The start offset is inclusive
/// and the end offset is exclusive.
#[derive(Debug, Default)]
pub struct SpanTable {
    spans: HashMap<NodeId, Span>,
}

impl SpanTable {
    /// Create a new empty SpanTable.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a SpanTable with the given initial capacity.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            spans: HashMap::with_capacity(capacity),
        }
    }

    /// Record a span for a node.
    pub fn insert(&mut self, node_id: NodeId, span: Span) {
        self.spans.insert(node_id, span);
    }

    /// Get the span for a node, if recorded.
    pub fn span_of(&self, node_id: NodeId) -> Option<Span> {
        self.spans.get(&node_id).copied()
    }

    /// Check if a span is recorded for a node.
    pub fn contains(&self, node_id: NodeId) -> bool {
        self.spans.contains_key(&node_id)
    }

    /// Get the number of recorded spans.
    pub fn len(&self) -> usize {
        self.spans.len()
    }

    /// Check if the table is empty.
    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }

    /// Iterate over all (NodeId, Span) pairs.
    pub fn iter(&self) -> impl Iterator<Item = (&NodeId, &Span)> {
        self.spans.iter()
    }
}

// ============================================================================
// NodeId Generator
// ============================================================================

/// Generator for assigning sequential [`NodeId`]s.
///
/// Used during CST traversal to assign deterministic ids.
#[derive(Debug, Default)]
pub struct NodeIdGenerator {
    next_id: u32,
}

impl NodeIdGenerator {
    /// Create a new generator starting from NodeId(0).
    pub fn new() -> Self {
        Self::default()
    }

    /// Generate the next NodeId.
    pub fn next_id(&mut self) -> NodeId {
        let id = NodeId(self.next_id);
        self.next_id += 1;
        id
    }

    /// Get the current count of generated NodeIds.
    pub fn count(&self) -> u32 {
        self.next_id
    }

    /// Reset the generator to start from NodeId(0).
    pub fn reset(&mut self) {
        self.next_id = 0;
    }
}

pub trait WithComma<'r, 'a> {
    fn with_comma(self, comma: DeflatedComma<'r, 'a>) -> Self;
}

pub trait ParenthesizedNode<'a> {
    fn lpar(&self) -> &Vec<LeftParen<'a>>;
    fn rpar(&self) -> &Vec<RightParen<'a>>;

    fn parenthesize<F>(&self, state: &mut CodegenState<'a>, f: F)
    where
        F: FnOnce(&mut CodegenState<'a>),
    {
        for lpar in self.lpar() {
            lpar.codegen(state);
        }
        f(state);
        for rpar in self.rpar() {
            rpar.codegen(state);
        }
    }

    fn with_parens(self, left: LeftParen<'a>, right: RightParen<'a>) -> Self;
}

impl<'a, T: ParenthesizedNode<'a>> ParenthesizedNode<'a> for Box<T> {
    fn lpar(&self) -> &Vec<LeftParen<'a>> {
        self.deref().lpar()
    }
    fn rpar(&self) -> &Vec<RightParen<'a>> {
        self.deref().rpar()
    }
    fn parenthesize<F>(&self, state: &mut CodegenState<'a>, f: F)
    where
        F: FnOnce(&mut CodegenState<'a>),
    {
        self.deref().parenthesize(state, f)
    }
    fn with_parens(self, left: LeftParen<'a>, right: RightParen<'a>) -> Self {
        Self::new((*self).with_parens(left, right))
    }
}

#[allow(dead_code)]
pub trait ParenthesizedDeflatedNode<'r, 'a> {
    fn lpar(&self) -> &Vec<DeflatedLeftParen<'r, 'a>>;
    fn rpar(&self) -> &Vec<DeflatedRightParen<'r, 'a>>;

    fn with_parens(
        self,
        left: DeflatedLeftParen<'r, 'a>,
        right: DeflatedRightParen<'r, 'a>,
    ) -> Self;
}
impl<'r, 'a, T: ParenthesizedDeflatedNode<'r, 'a>> ParenthesizedDeflatedNode<'r, 'a> for Box<T> {
    fn lpar(&self) -> &Vec<DeflatedLeftParen<'r, 'a>> {
        self.deref().lpar()
    }
    fn rpar(&self) -> &Vec<DeflatedRightParen<'r, 'a>> {
        self.deref().rpar()
    }
    fn with_parens(
        self,
        left: DeflatedLeftParen<'r, 'a>,
        right: DeflatedRightParen<'r, 'a>,
    ) -> Self {
        Self::new((*self).with_parens(left, right))
    }
}

pub trait WithLeadingLines<'a> {
    fn leading_lines(&mut self) -> &mut Vec<EmptyLine<'a>>;
}

pub type Result<T> = std::result::Result<T, WhitespaceError>;

pub trait Inflate<'a>
where
    Self: Sized,
{
    type Inflated;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated>;
}

impl<'a, T: Inflate<'a>> Inflate<'a> for Option<T> {
    type Inflated = Option<T::Inflated>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        self.map(|x| x.inflate(ctx)).transpose()
    }
}

impl<'a, T: Inflate<'a>> Inflate<'a> for Box<T> {
    type Inflated = Box<T::Inflated>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        match (*self).inflate(ctx) {
            Ok(a) => Ok(Box::new(a)),
            Err(e) => Err(e),
        }
    }
}

impl<'a, T: Inflate<'a>> Inflate<'a> for Vec<T> {
    type Inflated = Vec<T::Inflated>;
    fn inflate(self, ctx: &mut InflateCtx<'a>) -> Result<Self::Inflated> {
        self.into_iter().map(|item| item.inflate(ctx)).collect()
    }
}
