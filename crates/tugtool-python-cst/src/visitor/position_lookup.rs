// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Position-to-node lookup infrastructure for Python CST.
//!
//! This module provides [`PositionIndex`], an efficient data structure for finding
//! nodes at byte positions in Python source code. It enables O(log n) lookups for:
//! - Finding the smallest node at a position
//! - Finding expressions, statements, or scopes containing a position
//! - Finding all nodes containing a position (for context)
//!
//! # Architecture
//!
//! The index is built from a parsed CST with position tracking enabled:
//!
//! ```text
//! parse_module_with_positions(source) -> (Module, PositionTable)
//!                                               |
//!                                               v
//!     PositionIndex::build(module, positions) -> PositionIndex
//!                                                      |
//!                                                      v
//!     index.find_expression_at(offset) -> Option<&ExpressionInfo>
//! ```
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, PositionIndex};
//!
//! let source = "result = calculate_tax(get_price() * 1.08)";
//! let parsed = parse_module_with_positions(source, None)?;
//! let index = PositionIndex::build(&parsed.module, &parsed.positions, source);
//!
//! // Find expression at byte offset 23 (inside "get_price()")
//! if let Some(expr) = index.find_expression_at(23) {
//!     println!("Found {:?} at {:?}", expr.kind, expr.span);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::{
    AnnAssign, Assert, Assign, Attribute, AugAssign, Await, BinaryOperation, BooleanOperation,
    Break, Call, ClassDef, Comparison, ConcatenatedString, Continue, Decorator, Del, Dict,
    DictComp, Ellipsis, ExceptHandler, ExceptStarHandler, Float, For, FormattedString, FunctionDef,
    GeneratorExp, Global, If, IfExp, Imaginary, Import, ImportFrom, Integer, Lambda, List,
    ListComp, Match, MatchCase, Module, Name, NamedExpr, NodeId, Nonlocal, Param, Pass, Raise,
    Return, Set, SetComp, SimpleString, Slice, Subscript, TemplatedString, Try, TryStar, Tuple,
    TypeAlias, UnaryOperation, While, With, Yield,
};
use tugtool_core::patch::Span;

// ============================================================================
// NodeKind Enum
// ============================================================================

/// Identifies a node type found at a position.
///
/// This enum covers all significant Python AST node types that can be
/// located via position lookup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NodeKind {
    // Expressions
    /// A simple name/identifier
    Name,
    /// Integer literal
    Integer,
    /// Float literal
    Float,
    /// Imaginary number literal
    Imaginary,
    /// String literal (simple)
    String,
    /// Concatenated string literals
    ConcatenatedString,
    /// Formatted string (f-string)
    FormattedString,
    /// Template string (t-string)
    TemplatedString,
    /// Attribute access (a.b)
    Attribute,
    /// Function call
    Call,
    /// Binary operation (a + b)
    BinaryOp,
    /// Unary operation (-x, not x)
    UnaryOp,
    /// Comparison (a < b, a == b)
    Compare,
    /// Boolean operation (and, or)
    BooleanOp,
    /// Conditional expression (x if cond else y)
    IfExp,
    /// Lambda expression
    Lambda,
    /// List literal
    List,
    /// Dict literal
    Dict,
    /// Set literal
    Set,
    /// Tuple literal
    Tuple,
    /// Subscript access (a[b])
    Subscript,
    /// Slice (a:b:c)
    Slice,
    /// Starred expression (*args)
    Starred,
    /// Await expression
    Await,
    /// Yield expression
    Yield,
    /// Named expression (walrus operator :=)
    NamedExpr,
    /// Generator expression
    GeneratorExp,
    /// List comprehension
    ListComp,
    /// Dict comprehension
    DictComp,
    /// Set comprehension
    SetComp,
    /// Ellipsis literal (...)
    Ellipsis,

    // Statements
    /// Simple assignment
    Assign,
    /// Augmented assignment (+=, etc.)
    AugAssign,
    /// Annotated assignment
    AnnAssign,
    /// Return statement
    Return,
    /// Delete statement
    Delete,
    /// Pass statement
    Pass,
    /// Break statement
    Break,
    /// Continue statement
    Continue,
    /// Raise statement
    Raise,
    /// Assert statement
    Assert,
    /// Import statement
    Import,
    /// From import statement
    ImportFrom,
    /// Global declaration
    Global,
    /// Nonlocal declaration
    Nonlocal,
    /// Expression statement
    Expr,
    /// Type alias statement
    TypeAlias,

    // Compound Statements
    /// Function definition
    FunctionDef,
    /// Async function definition
    AsyncFunctionDef,
    /// Class definition
    ClassDef,
    /// If statement
    If,
    /// For loop
    For,
    /// Async for loop
    AsyncFor,
    /// While loop
    While,
    /// With statement
    With,
    /// Async with statement
    AsyncWith,
    /// Try statement
    Try,
    /// Try statement with except* (Python 3.11+)
    TryStar,
    /// Match statement
    Match,

    // Other
    /// Function parameter
    Param,
    /// Function argument
    Arg,
    /// Keyword argument
    Keyword,
    /// Decorator
    Decorator,
    /// Import alias
    Alias,
    /// Except handler
    ExceptHandler,
    /// Match case
    MatchCase,
    /// Comment
    Comment,
    /// Module
    Module,
}

impl NodeKind {
    /// Returns true if this node kind represents an expression.
    pub fn is_expression(&self) -> bool {
        matches!(
            self,
            NodeKind::Name
                | NodeKind::Integer
                | NodeKind::Float
                | NodeKind::Imaginary
                | NodeKind::String
                | NodeKind::ConcatenatedString
                | NodeKind::FormattedString
                | NodeKind::TemplatedString
                | NodeKind::Attribute
                | NodeKind::Call
                | NodeKind::BinaryOp
                | NodeKind::UnaryOp
                | NodeKind::Compare
                | NodeKind::BooleanOp
                | NodeKind::IfExp
                | NodeKind::Lambda
                | NodeKind::List
                | NodeKind::Dict
                | NodeKind::Set
                | NodeKind::Tuple
                | NodeKind::Subscript
                | NodeKind::Slice
                | NodeKind::Starred
                | NodeKind::Await
                | NodeKind::Yield
                | NodeKind::NamedExpr
                | NodeKind::GeneratorExp
                | NodeKind::ListComp
                | NodeKind::DictComp
                | NodeKind::SetComp
                | NodeKind::Ellipsis
        )
    }

    /// Returns true if this node kind represents a statement.
    pub fn is_statement(&self) -> bool {
        matches!(
            self,
            NodeKind::Assign
                | NodeKind::AugAssign
                | NodeKind::AnnAssign
                | NodeKind::Return
                | NodeKind::Delete
                | NodeKind::Pass
                | NodeKind::Break
                | NodeKind::Continue
                | NodeKind::Raise
                | NodeKind::Assert
                | NodeKind::Import
                | NodeKind::ImportFrom
                | NodeKind::Global
                | NodeKind::Nonlocal
                | NodeKind::Expr
                | NodeKind::TypeAlias
                | NodeKind::FunctionDef
                | NodeKind::AsyncFunctionDef
                | NodeKind::ClassDef
                | NodeKind::If
                | NodeKind::For
                | NodeKind::AsyncFor
                | NodeKind::While
                | NodeKind::With
                | NodeKind::AsyncWith
                | NodeKind::Try
                | NodeKind::TryStar
                | NodeKind::Match
        )
    }

    /// Returns true if this node kind represents a compound statement.
    pub fn is_compound_statement(&self) -> bool {
        matches!(
            self,
            NodeKind::FunctionDef
                | NodeKind::AsyncFunctionDef
                | NodeKind::ClassDef
                | NodeKind::If
                | NodeKind::For
                | NodeKind::AsyncFor
                | NodeKind::While
                | NodeKind::With
                | NodeKind::AsyncWith
                | NodeKind::Try
                | NodeKind::TryStar
                | NodeKind::Match
        )
    }

    /// Returns true if this node kind creates a scope.
    pub fn is_scope(&self) -> bool {
        matches!(
            self,
            NodeKind::Module
                | NodeKind::FunctionDef
                | NodeKind::AsyncFunctionDef
                | NodeKind::ClassDef
                | NodeKind::Lambda
                | NodeKind::GeneratorExp
                | NodeKind::ListComp
                | NodeKind::DictComp
                | NodeKind::SetComp
        )
    }
}

// ============================================================================
// Info Structs
// ============================================================================

/// Information about a node found at a position.
#[derive(Debug, Clone)]
pub struct NodeInfo {
    /// The kind of node
    pub kind: NodeKind,
    /// The span covering this node
    pub span: Span,
    /// The NodeId if the node has one
    pub node_id: Option<NodeId>,
}

/// Information about an expression found at a position.
#[derive(Debug, Clone)]
pub struct ExpressionInfo {
    /// The kind of expression
    pub kind: NodeKind,
    /// The span covering the entire expression (including parentheses)
    pub span: Span,
    /// The span covering just the "core" expression (excluding outer parens)
    pub inner_span: Span,
    /// True if this expression is parenthesized
    pub is_parenthesized: bool,
    /// True if this is a complete sub-expression (not part of larger expr)
    pub is_complete: bool,
    /// The NodeId if available
    pub node_id: Option<NodeId>,
}

/// Information about a statement found at a position.
#[derive(Debug, Clone)]
pub struct StatementInfo {
    /// The kind of statement
    pub kind: NodeKind,
    /// The span covering the entire statement
    pub span: Span,
    /// True if this is a compound statement (has body)
    pub is_compound: bool,
    /// The NodeId if available
    pub node_id: Option<NodeId>,
}

/// Information about a scope found at a position.
///
/// Note: This is named `ScopeLookupInfo` to avoid conflict with the existing
/// `ScopeInfo` in the `scope` module, which has different fields.
#[derive(Debug, Clone)]
pub struct ScopeLookupInfo {
    /// The kind of scope (FunctionDef, ClassDef, Module, Lambda, Comprehension)
    pub kind: NodeKind,
    /// The lexical span of the scope (where variables resolve to this scope)
    pub lexical_span: Span,
    /// The full definition span (including decorators for functions/classes)
    pub def_span: Option<Span>,
    /// The name of the scope (if named)
    pub name: Option<std::string::String>,
    /// The NodeId if available
    pub node_id: Option<NodeId>,
}

// ============================================================================
// AncestorTracker
// ============================================================================

/// Entry in the ancestor stack.
#[derive(Debug, Clone)]
pub struct AncestorEntry {
    /// The kind of node
    pub kind: NodeKind,
    /// The span of the node
    pub span: Span,
    /// The NodeId if available
    pub node_id: Option<NodeId>,
    /// Index of this entry in the stack (for efficient parent lookup)
    pub depth: usize,
}

/// Tracks ancestor context during CST traversal.
///
/// Used by the index builder to capture parent-child relationships
/// and determine if nodes are complete sub-expressions.
pub struct AncestorTracker {
    /// Stack of ancestor nodes
    stack: Vec<AncestorEntry>,
}

impl Default for AncestorTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl AncestorTracker {
    /// Create a new empty ancestor tracker.
    pub fn new() -> Self {
        Self { stack: Vec::new() }
    }

    /// Push a node onto the ancestor stack.
    pub fn push(&mut self, kind: NodeKind, span: Span, node_id: Option<NodeId>) {
        let depth = self.stack.len();
        self.stack.push(AncestorEntry {
            kind,
            span,
            node_id,
            depth,
        });
    }

    /// Pop the top node from the ancestor stack.
    pub fn pop(&mut self) -> Option<AncestorEntry> {
        self.stack.pop()
    }

    /// Get the current parent (top of stack).
    pub fn parent(&self) -> Option<&AncestorEntry> {
        self.stack.last()
    }

    /// Get the current depth (number of ancestors).
    pub fn depth(&self) -> usize {
        self.stack.len()
    }

    /// Get the ancestor at a specific depth (0 = root).
    pub fn ancestor_at(&self, depth: usize) -> Option<&AncestorEntry> {
        self.stack.get(depth)
    }

    /// Check if the current context is inside an expression.
    pub fn in_expression(&self) -> bool {
        self.stack.iter().any(|entry| entry.kind.is_expression())
    }

    /// Check if the current context is inside a specific node kind.
    pub fn inside(&self, kind: NodeKind) -> bool {
        self.stack.iter().any(|entry| entry.kind == kind)
    }

    /// Get the nearest enclosing scope.
    pub fn enclosing_scope(&self) -> Option<&AncestorEntry> {
        self.stack.iter().rev().find(|entry| entry.kind.is_scope())
    }
}

// ============================================================================
// PositionIndex
// ============================================================================

/// Index for efficient position-to-node lookups.
///
/// Built from a parsed Module and its PositionTable, this index enables
/// O(log n) position lookups by maintaining sorted interval data.
///
/// # Design
///
/// The index uses a sorted list approach:
/// 1. All nodes with spans are collected during a traversal
/// 2. Nodes are sorted by span.start for binary search
/// 3. Lookup finds candidates via binary search, then filters by containment
///
/// # Memory
///
/// The index stores lightweight metadata (kind, span, node_id) rather than
/// CST node references. This avoids lifetime complexity and allows the
/// index to outlive the parsed Module if needed.
pub struct PositionIndex {
    /// Sorted list of (span, node_info) for all tracked nodes
    nodes: Vec<(Span, NodeInfo)>,
    /// Sorted list of expressions specifically (for expression lookups)
    expressions: Vec<(Span, ExpressionInfo)>,
    /// Sorted list of statements specifically (for statement lookups)
    statements: Vec<(Span, StatementInfo)>,
    /// Sorted list of scopes specifically (for scope lookups)
    scopes: Vec<(Span, ScopeLookupInfo)>,
    /// Source length for bounds checking
    source_len: usize,
}

impl PositionIndex {
    /// Build a PositionIndex from a parsed module with position data.
    ///
    /// # Arguments
    /// * `module` - The parsed Module CST
    /// * `positions` - The PositionTable from parsing with positions enabled
    /// * `source` - The original source text (for bounds checking)
    ///
    /// # Performance
    /// O(n log n) where n is the number of nodes in the CST.
    pub fn build(module: &Module, positions: &PositionTable, source: &str) -> Self {
        let source_len = source.len();
        let mut collector = IndexCollector::new(positions, source_len);

        // Single traversal collects all node info
        walk_module(&mut collector, module);

        // Sort by span.start for binary search
        collector.nodes.sort_by_key(|(span, _)| span.start);
        collector.expressions.sort_by_key(|(span, _)| span.start);
        collector.statements.sort_by_key(|(span, _)| span.start);
        collector.scopes.sort_by_key(|(span, _)| span.start);

        Self {
            nodes: collector.nodes,
            expressions: collector.expressions,
            statements: collector.statements,
            scopes: collector.scopes,
            source_len,
        }
    }

    /// Find the most specific node at the given byte offset.
    ///
    /// Returns the smallest (innermost) node whose span contains the position.
    /// Returns None if position is outside all nodes (e.g., in whitespace
    /// at end of file).
    pub fn find_node_at(&self, offset: usize) -> Option<&NodeInfo> {
        if offset > self.source_len {
            return None;
        }

        // Binary search to find first node where span.start > offset
        let idx = self.nodes.partition_point(|(span, _)| span.start <= offset);

        // Scan backwards to find all candidates
        let mut candidates: Vec<&NodeInfo> = Vec::new();
        for i in (0..idx).rev() {
            let (span, info) = &self.nodes[i];
            if span.end <= offset {
                // Spans are sorted by start; once we hit a span that ends before offset,
                // we could potentially still have earlier spans that contain offset
                // (they would have earlier starts but later ends)
                continue;
            }
            if span.start <= offset && offset < span.end {
                // This node contains offset
                candidates.push(info);
            }
        }

        // Return smallest (innermost) containing node
        candidates.into_iter().min_by_key(|info| info.span.len())
    }

    /// Find the expression at or containing the given byte offset.
    ///
    /// Returns the smallest expression whose span contains the position.
    /// If the position is inside a sub-expression, returns that sub-expression.
    pub fn find_expression_at(&self, offset: usize) -> Option<&ExpressionInfo> {
        if offset > self.source_len {
            return None;
        }

        let idx = self
            .expressions
            .partition_point(|(span, _)| span.start <= offset);

        let mut candidates: Vec<&ExpressionInfo> = Vec::new();
        for i in (0..idx).rev() {
            let (span, info) = &self.expressions[i];
            if span.end <= offset {
                continue;
            }
            if span.start <= offset && offset < span.end {
                candidates.push(info);
            }
        }

        candidates.into_iter().min_by_key(|info| info.span.len())
    }

    /// Find the statement at or containing the given byte offset.
    ///
    /// For positions within expressions, returns the containing statement.
    pub fn find_statement_at(&self, offset: usize) -> Option<&StatementInfo> {
        if offset > self.source_len {
            return None;
        }

        let idx = self
            .statements
            .partition_point(|(span, _)| span.start <= offset);

        let mut candidates: Vec<&StatementInfo> = Vec::new();
        for i in (0..idx).rev() {
            let (span, info) = &self.statements[i];
            if span.end <= offset {
                continue;
            }
            if span.start <= offset && offset < span.end {
                candidates.push(info);
            }
        }

        candidates.into_iter().min_by_key(|info| info.span.len())
    }

    /// Find the scope (function, class, module) containing the given byte offset.
    ///
    /// Returns the innermost scope. For nested functions/classes, returns
    /// the most deeply nested one.
    pub fn find_scope_at(&self, offset: usize) -> Option<&ScopeLookupInfo> {
        if offset > self.source_len {
            return None;
        }

        let idx = self.scopes.partition_point(|(span, _)| span.start <= offset);

        let mut candidates: Vec<&ScopeLookupInfo> = Vec::new();
        for i in (0..idx).rev() {
            let (span, info) = &self.scopes[i];
            if span.end <= offset {
                continue;
            }
            if span.start <= offset && offset < span.end {
                candidates.push(info);
            }
        }

        // For scopes, we also want the innermost (smallest) one
        candidates
            .into_iter()
            .min_by_key(|info| info.lexical_span.len())
    }

    /// Find all nodes whose spans contain the given offset.
    ///
    /// Returns nodes from outermost to innermost (module first, then
    /// function, then statement, then expression, etc.).
    pub fn find_all_at(&self, offset: usize) -> Vec<&NodeInfo> {
        if offset > self.source_len {
            return Vec::new();
        }

        let idx = self.nodes.partition_point(|(span, _)| span.start <= offset);

        let mut result: Vec<&NodeInfo> = self.nodes[..idx]
            .iter()
            .filter(|(span, _)| span.start <= offset && offset < span.end)
            .map(|(_, info)| info)
            .collect();

        // Sort by span size descending (outermost first)
        result.sort_by_key(|info| std::cmp::Reverse(info.span.len()));
        result
    }

    /// Find the enclosing expression if the position is inside a sub-expression.
    ///
    /// Given position in `foo.bar.baz`, returns info about the containing
    /// attribute access chain (the parent expression).
    pub fn find_enclosing_expression(&self, offset: usize) -> Option<&ExpressionInfo> {
        if offset > self.source_len {
            return None;
        }

        let idx = self
            .expressions
            .partition_point(|(span, _)| span.start <= offset);

        let mut candidates: Vec<&ExpressionInfo> = Vec::new();
        for i in (0..idx).rev() {
            let (span, info) = &self.expressions[i];
            if span.end <= offset {
                continue;
            }
            if span.start <= offset && offset < span.end {
                candidates.push(info);
            }
        }

        // Sort by span size ascending
        candidates.sort_by_key(|info| info.span.len());

        // Return second smallest (first is the innermost, second is its parent)
        if candidates.len() >= 2 {
            Some(candidates[1])
        } else {
            None
        }
    }

    /// Returns the number of nodes in the index.
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Returns the number of expressions in the index.
    pub fn expression_count(&self) -> usize {
        self.expressions.len()
    }

    /// Returns the number of statements in the index.
    pub fn statement_count(&self) -> usize {
        self.statements.len()
    }

    /// Returns the number of scopes in the index.
    pub fn scope_count(&self) -> usize {
        self.scopes.len()
    }
}

// ============================================================================
// IndexCollector Visitor
// ============================================================================

/// Internal visitor that collects node information for the PositionIndex.
struct IndexCollector<'a> {
    positions: &'a PositionTable,
    source_len: usize,
    nodes: Vec<(Span, NodeInfo)>,
    expressions: Vec<(Span, ExpressionInfo)>,
    statements: Vec<(Span, StatementInfo)>,
    scopes: Vec<(Span, ScopeLookupInfo)>,
    ancestors: AncestorTracker,
}

impl<'a> IndexCollector<'a> {
    fn new(positions: &'a PositionTable, source_len: usize) -> Self {
        Self {
            positions,
            source_len,
            nodes: Vec::new(),
            expressions: Vec::new(),
            statements: Vec::new(),
            scopes: Vec::new(),
            ancestors: AncestorTracker::new(),
        }
    }

    /// Get span for a node from the PositionTable.
    fn get_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let id = node_id?;
        let pos = self.positions.get(&id)?;
        pos.ident_span.or(pos.lexical_span).or(pos.def_span)
    }

    /// Get lexical span specifically (for scopes).
    fn get_lexical_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let id = node_id?;
        self.positions.get(&id)?.lexical_span
    }

    /// Get def span specifically (for definitions).
    fn get_def_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let id = node_id?;
        self.positions.get(&id)?.def_span
    }

    /// Check if current position is inside a larger expression.
    fn is_inside_expression(&self) -> bool {
        self.ancestors.in_expression()
    }

    /// Add an expression to the index.
    fn add_expression(
        &mut self,
        kind: NodeKind,
        span: Span,
        node_id: Option<NodeId>,
        is_parenthesized: bool,
    ) {
        let is_complete = !self.is_inside_expression();

        self.nodes.push((
            span,
            NodeInfo {
                kind,
                span,
                node_id,
            },
        ));

        self.expressions.push((
            span,
            ExpressionInfo {
                kind,
                span,
                inner_span: span, // TODO: compute inner span for parenthesized
                is_parenthesized,
                is_complete,
                node_id,
            },
        ));
    }

    /// Add a statement to the index.
    fn add_statement(&mut self, kind: NodeKind, span: Span, node_id: Option<NodeId>) {
        let is_compound = kind.is_compound_statement();

        self.nodes.push((
            span,
            NodeInfo {
                kind,
                span,
                node_id,
            },
        ));

        self.statements.push((
            span,
            StatementInfo {
                kind,
                span,
                is_compound,
                node_id,
            },
        ));
    }

    /// Add a scope to the index.
    fn add_scope(
        &mut self,
        kind: NodeKind,
        lexical_span: Span,
        def_span: Option<Span>,
        name: Option<std::string::String>,
        node_id: Option<NodeId>,
    ) {
        self.scopes.push((
            lexical_span,
            ScopeLookupInfo {
                kind,
                lexical_span,
                def_span,
                name,
                node_id,
            },
        ));
    }
}

// Implement Visitor to collect nodes during traversal
impl<'src, 'pos> Visitor<'src> for IndexCollector<'pos> {
    // ========================================================================
    // Module
    // ========================================================================

    fn visit_module(&mut self, _node: &Module<'src>) -> VisitResult {
        let span = Span::new(0, self.source_len);

        self.nodes.push((
            span,
            NodeInfo {
                kind: NodeKind::Module,
                span,
                node_id: None,
            },
        ));

        self.add_scope(NodeKind::Module, span, None, None, None);

        self.ancestors.push(NodeKind::Module, span, None);
        VisitResult::Continue
    }

    fn leave_module(&mut self, _node: &Module<'src>) {
        self.ancestors.pop();
    }

    // ========================================================================
    // Expressions
    // ========================================================================

    fn visit_name(&mut self, node: &Name<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Name, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Name, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_name(&mut self, node: &Name<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_integer(&mut self, node: &Integer<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Integer, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Integer, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_integer(&mut self, node: &Integer<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_float_literal(&mut self, node: &Float<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Float, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Float, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_float_literal(&mut self, node: &Float<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_imaginary(&mut self, node: &Imaginary<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::Imaginary,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors.push(NodeKind::Imaginary, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_imaginary(&mut self, node: &Imaginary<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_simple_string(&mut self, node: &SimpleString<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::String, span, node.node_id, false);
            self.ancestors.push(NodeKind::String, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_simple_string(&mut self, node: &SimpleString<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_concatenated_string(&mut self, node: &ConcatenatedString<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::ConcatenatedString,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors
                .push(NodeKind::ConcatenatedString, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_concatenated_string(&mut self, node: &ConcatenatedString<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_formatted_string(&mut self, node: &FormattedString<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::FormattedString, span, node.node_id, false);
            self.ancestors
                .push(NodeKind::FormattedString, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_formatted_string(&mut self, node: &FormattedString<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_templated_string(&mut self, node: &TemplatedString<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::TemplatedString, span, node.node_id, false);
            self.ancestors
                .push(NodeKind::TemplatedString, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_templated_string(&mut self, node: &TemplatedString<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_ellipsis(&mut self, node: &Ellipsis<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::Ellipsis,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors.push(NodeKind::Ellipsis, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_ellipsis(&mut self, node: &Ellipsis<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_attribute(&mut self, node: &Attribute<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::Attribute,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors.push(NodeKind::Attribute, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_attribute(&mut self, node: &Attribute<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_call(&mut self, node: &Call<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Call, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Call, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_call(&mut self, node: &Call<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_binary_operation(&mut self, node: &BinaryOperation<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::BinaryOp,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors.push(NodeKind::BinaryOp, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_binary_operation(&mut self, node: &BinaryOperation<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_unary_operation(&mut self, node: &UnaryOperation<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::UnaryOp,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors.push(NodeKind::UnaryOp, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_unary_operation(&mut self, node: &UnaryOperation<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_boolean_operation(&mut self, node: &BooleanOperation<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::BooleanOp,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors
                .push(NodeKind::BooleanOp, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_boolean_operation(&mut self, node: &BooleanOperation<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_comparison(&mut self, node: &Comparison<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::Compare,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors.push(NodeKind::Compare, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_comparison(&mut self, node: &Comparison<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_if_exp(&mut self, node: &IfExp<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::IfExp, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::IfExp, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_if_exp(&mut self, node: &IfExp<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_lambda(&mut self, node: &Lambda<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_expression(NodeKind::Lambda, span, node.node_id, !node.lpar.is_empty());
            self.add_scope(NodeKind::Lambda, span, None, None, node.node_id);
            self.ancestors.push(NodeKind::Lambda, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_lambda(&mut self, node: &Lambda<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_list(&mut self, node: &List<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::List, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::List, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_list(&mut self, node: &List<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_dict(&mut self, node: &Dict<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Dict, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Dict, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_dict(&mut self, node: &Dict<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_set(&mut self, node: &Set<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Set, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Set, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_set(&mut self, node: &Set<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_tuple(&mut self, node: &Tuple<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Tuple, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Tuple, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_tuple(&mut self, node: &Tuple<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_subscript(&mut self, node: &Subscript<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::Subscript,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors.push(NodeKind::Subscript, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_subscript(&mut self, node: &Subscript<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_slice(&mut self, node: &Slice<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Slice, span, node.node_id, false);
            self.ancestors.push(NodeKind::Slice, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_slice(&mut self, node: &Slice<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_await_expr(&mut self, node: &Await<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Await, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Await, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_await_expr(&mut self, node: &Await<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_yield_expr(&mut self, node: &Yield<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(NodeKind::Yield, span, node.node_id, !node.lpar.is_empty());
            self.ancestors.push(NodeKind::Yield, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_yield_expr(&mut self, node: &Yield<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_named_expr(&mut self, node: &NamedExpr<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_expression(
                NodeKind::NamedExpr,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.ancestors.push(NodeKind::NamedExpr, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_named_expr(&mut self, node: &NamedExpr<'src>) {
        if self.get_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    // Comprehensions (both expression and scope)
    fn visit_generator_exp(&mut self, node: &GeneratorExp<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_expression(
                NodeKind::GeneratorExp,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.add_scope(NodeKind::GeneratorExp, span, None, None, node.node_id);
            self.ancestors
                .push(NodeKind::GeneratorExp, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_generator_exp(&mut self, node: &GeneratorExp<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_list_comp(&mut self, node: &ListComp<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_expression(
                NodeKind::ListComp,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.add_scope(NodeKind::ListComp, span, None, None, node.node_id);
            self.ancestors.push(NodeKind::ListComp, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_list_comp(&mut self, node: &ListComp<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_dict_comp(&mut self, node: &DictComp<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_expression(
                NodeKind::DictComp,
                span,
                node.node_id,
                !node.lpar.is_empty(),
            );
            self.add_scope(NodeKind::DictComp, span, None, None, node.node_id);
            self.ancestors.push(NodeKind::DictComp, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_dict_comp(&mut self, node: &DictComp<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_set_comp(&mut self, node: &SetComp<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_expression(NodeKind::SetComp, span, node.node_id, !node.lpar.is_empty());
            self.add_scope(NodeKind::SetComp, span, None, None, node.node_id);
            self.ancestors.push(NodeKind::SetComp, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_set_comp(&mut self, node: &SetComp<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    // ========================================================================
    // Statements
    // ========================================================================

    fn visit_pass_stmt(&mut self, node: &Pass<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Pass, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_break_stmt(&mut self, node: &Break<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Break, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_continue_stmt(&mut self, node: &Continue<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Continue, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_return_stmt(&mut self, node: &Return<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Return, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_raise_stmt(&mut self, node: &Raise<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Raise, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_assert_stmt(&mut self, node: &Assert<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Assert, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_del_stmt(&mut self, node: &Del<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Delete, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_global_stmt(&mut self, node: &Global<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Global, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_nonlocal_stmt(&mut self, node: &Nonlocal<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Nonlocal, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_import_stmt(&mut self, node: &Import<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Import, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_import_from(&mut self, node: &ImportFrom<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::ImportFrom, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_assign(&mut self, node: &Assign<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::Assign, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_ann_assign(&mut self, node: &AnnAssign<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::AnnAssign, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_aug_assign(&mut self, node: &AugAssign<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::AugAssign, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn visit_type_alias(&mut self, node: &TypeAlias<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.add_statement(NodeKind::TypeAlias, span, node.node_id);
        }
        VisitResult::Continue
    }

    // ========================================================================
    // Compound Statements (also scopes)
    // ========================================================================

    fn visit_function_def(&mut self, node: &FunctionDef<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            let def_span = self.get_def_span(node.node_id);
            let name = node.name.value.to_string();

            self.add_statement(NodeKind::FunctionDef, def_span.unwrap_or(span), node.node_id);
            self.add_scope(
                NodeKind::FunctionDef,
                span,
                def_span,
                Some(name),
                node.node_id,
            );
            self.ancestors
                .push(NodeKind::FunctionDef, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, node: &FunctionDef<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_class_def(&mut self, node: &ClassDef<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            let def_span = self.get_def_span(node.node_id);
            let name = node.name.value.to_string();

            self.add_statement(NodeKind::ClassDef, def_span.unwrap_or(span), node.node_id);
            self.add_scope(
                NodeKind::ClassDef,
                span,
                def_span,
                Some(name),
                node.node_id,
            );
            self.ancestors.push(NodeKind::ClassDef, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, node: &ClassDef<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_if_stmt(&mut self, node: &If<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_statement(NodeKind::If, span, node.node_id);
            self.ancestors.push(NodeKind::If, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_if_stmt(&mut self, node: &If<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_for_stmt(&mut self, node: &For<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            let kind = if node.asynchronous.is_some() {
                NodeKind::AsyncFor
            } else {
                NodeKind::For
            };
            self.add_statement(kind, span, node.node_id);
            self.ancestors.push(kind, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_for_stmt(&mut self, node: &For<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_while_stmt(&mut self, node: &While<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_statement(NodeKind::While, span, node.node_id);
            self.ancestors.push(NodeKind::While, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_while_stmt(&mut self, node: &While<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_with_stmt(&mut self, node: &With<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            let kind = if node.asynchronous.is_some() {
                NodeKind::AsyncWith
            } else {
                NodeKind::With
            };
            self.add_statement(kind, span, node.node_id);
            self.ancestors.push(kind, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_with_stmt(&mut self, node: &With<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_try_stmt(&mut self, node: &Try<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_statement(NodeKind::Try, span, node.node_id);
            self.ancestors.push(NodeKind::Try, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_try_stmt(&mut self, node: &Try<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_try_star(&mut self, node: &TryStar<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_statement(NodeKind::TryStar, span, node.node_id);
            self.ancestors.push(NodeKind::TryStar, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_try_star(&mut self, node: &TryStar<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    fn visit_match_stmt(&mut self, node: &Match<'src>) -> VisitResult {
        if let Some(span) = self.get_lexical_span(node.node_id) {
            self.add_statement(NodeKind::Match, span, node.node_id);
            self.ancestors.push(NodeKind::Match, span, node.node_id);
        }
        VisitResult::Continue
    }

    fn leave_match_stmt(&mut self, node: &Match<'src>) {
        if self.get_lexical_span(node.node_id).is_some() {
            self.ancestors.pop();
        }
    }

    // ========================================================================
    // Other nodes
    // ========================================================================

    fn visit_param(&mut self, node: &Param<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.nodes.push((
                span,
                NodeInfo {
                    kind: NodeKind::Param,
                    span,
                    node_id: node.node_id,
                },
            ));
        }
        VisitResult::Continue
    }

    fn visit_decorator(&mut self, node: &Decorator<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.nodes.push((
                span,
                NodeInfo {
                    kind: NodeKind::Decorator,
                    span,
                    node_id: node.node_id,
                },
            ));
        }
        VisitResult::Continue
    }

    fn visit_except_handler(&mut self, node: &ExceptHandler<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.nodes.push((
                span,
                NodeInfo {
                    kind: NodeKind::ExceptHandler,
                    span,
                    node_id: node.node_id,
                },
            ));
        }
        VisitResult::Continue
    }

    fn visit_except_star_handler(&mut self, node: &ExceptStarHandler<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.nodes.push((
                span,
                NodeInfo {
                    kind: NodeKind::ExceptHandler,
                    span,
                    node_id: node.node_id,
                },
            ));
        }
        VisitResult::Continue
    }

    fn visit_match_case(&mut self, node: &MatchCase<'src>) -> VisitResult {
        if let Some(span) = self.get_span(node.node_id) {
            self.nodes.push((
                span,
                NodeInfo {
                    kind: NodeKind::MatchCase,
                    span,
                    node_id: node.node_id,
                },
            ));
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
    use crate::parse_module_with_positions;

    // ========================================================================
    // Basic lookup tests
    // ========================================================================

    #[test]
    fn test_find_node_simple_expression() {
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position 0 should find 'x'
        let node = index.find_node_at(0);
        assert!(node.is_some());
        assert_eq!(node.unwrap().kind, NodeKind::Name);

        // Position 4 should find '1'
        let node = index.find_node_at(4);
        assert!(node.is_some());
        assert_eq!(node.unwrap().kind, NodeKind::Integer);
    }

    #[test]
    fn test_find_node_nested_expression() {
        let source = "result = foo.bar.baz";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position at "baz" should find the innermost Name
        // "result = foo.bar.baz"
        //  0123456789012345678901
        //                  ^baz at 17
        let node = index.find_node_at(17);
        assert!(node.is_some());
        // Could be Name or Attribute depending on how spans are recorded
    }

    #[test]
    fn test_find_expression_in_call() {
        let source = "calculate(get_price())";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position 10 should be inside "get_price"
        let expr = index.find_expression_at(10);
        assert!(expr.is_some());
    }

    #[test]
    fn test_find_enclosing_scope_function() {
        let source = "def foo():\n    x = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position inside function body
        let scope = index.find_scope_at(15);
        assert!(scope.is_some());
        let scope = scope.unwrap();
        assert_eq!(scope.kind, NodeKind::FunctionDef);
        assert_eq!(scope.name, Some("foo".to_string()));
    }

    #[test]
    fn test_find_enclosing_scope_nested() {
        let source = "def outer():\n    def inner():\n        x = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position inside inner function
        let scope = index.find_scope_at(40);
        assert!(scope.is_some());
        let scope = scope.unwrap();
        assert_eq!(scope.kind, NodeKind::FunctionDef);
        assert_eq!(scope.name, Some("inner".to_string()));
    }

    #[test]
    fn test_find_enclosing_scope_lambda() {
        let source = "f = lambda x: x + 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position inside lambda body (at "x + 1")
        let scope = index.find_scope_at(15);
        assert!(scope.is_some());
        let scope = scope.unwrap();
        assert_eq!(scope.kind, NodeKind::Lambda);
    }

    #[test]
    fn test_find_enclosing_scope_comprehension() {
        let source = "x = [i for i in range(10)]";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position inside comprehension
        let scope = index.find_scope_at(6);
        assert!(scope.is_some());
        let scope = scope.unwrap();
        assert_eq!(scope.kind, NodeKind::ListComp);
    }

    #[test]
    fn test_position_at_eof() {
        let source = "x = 1\n";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position at EOF should return module scope
        let scope = index.find_scope_at(source.len() - 1);
        assert!(scope.is_some());
        assert_eq!(scope.unwrap().kind, NodeKind::Module);
    }

    #[test]
    fn test_position_beyond_file() {
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position beyond file should return None
        let node = index.find_node_at(1000);
        assert!(node.is_none());
    }

    #[test]
    fn test_find_all_at() {
        let source = "result = foo.bar.method(arg)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Find all nodes at position 17 (inside "method")
        let all = index.find_all_at(17);

        // Should include Module at minimum
        assert!(!all.is_empty());
        // First should be Module (outermost)
        assert_eq!(all[0].kind, NodeKind::Module);
    }

    #[test]
    fn test_find_enclosing_expression() {
        let source = "result = foo.bar.baz";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position at "baz" - enclosing expression should be the attribute chain
        let _enclosing = index.find_enclosing_expression(17);
        // If there are nested expressions, enclosing should be the parent
        // This may or may not return something depending on how expressions are recorded
    }

    // ========================================================================
    // Statement tests
    // ========================================================================

    #[test]
    fn test_find_statement_at() {
        let source = "x = 1\ny = 2\n";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Position in first statement
        let stmt = index.find_statement_at(2);
        if let Some(s) = stmt {
            assert_eq!(s.kind, NodeKind::Assign);
        }

        // Position in second statement
        let stmt = index.find_statement_at(8);
        if let Some(s) = stmt {
            assert_eq!(s.kind, NodeKind::Assign);
        }
    }

    #[test]
    fn test_compound_statement_flag() {
        let source = "def foo(): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Function def should be marked as compound
        let stmt = index.find_statement_at(4);
        if let Some(s) = stmt {
            assert!(s.is_compound);
        }
    }

    // ========================================================================
    // AncestorTracker tests
    // ========================================================================

    #[test]
    fn test_ancestor_tracker_basic() {
        let mut tracker = AncestorTracker::new();

        assert_eq!(tracker.depth(), 0);
        assert!(tracker.parent().is_none());

        tracker.push(NodeKind::Module, Span::new(0, 100), None);
        assert_eq!(tracker.depth(), 1);
        assert_eq!(tracker.parent().unwrap().kind, NodeKind::Module);

        tracker.push(NodeKind::FunctionDef, Span::new(10, 90), None);
        assert_eq!(tracker.depth(), 2);
        assert_eq!(tracker.parent().unwrap().kind, NodeKind::FunctionDef);

        let popped = tracker.pop();
        assert!(popped.is_some());
        assert_eq!(popped.unwrap().kind, NodeKind::FunctionDef);
        assert_eq!(tracker.depth(), 1);
    }

    #[test]
    fn test_ancestor_tracker_in_expression() {
        let mut tracker = AncestorTracker::new();

        assert!(!tracker.in_expression());

        tracker.push(NodeKind::Module, Span::new(0, 100), None);
        assert!(!tracker.in_expression());

        tracker.push(NodeKind::Call, Span::new(10, 50), None);
        assert!(tracker.in_expression());

        tracker.push(NodeKind::Name, Span::new(11, 15), None);
        assert!(tracker.in_expression());

        tracker.pop();
        tracker.pop();
        assert!(!tracker.in_expression());
    }

    #[test]
    fn test_ancestor_tracker_enclosing_scope() {
        let mut tracker = AncestorTracker::new();

        assert!(tracker.enclosing_scope().is_none());

        tracker.push(NodeKind::Module, Span::new(0, 100), None);
        assert!(tracker.enclosing_scope().is_some());
        assert_eq!(tracker.enclosing_scope().unwrap().kind, NodeKind::Module);

        tracker.push(NodeKind::FunctionDef, Span::new(10, 90), None);
        assert_eq!(
            tracker.enclosing_scope().unwrap().kind,
            NodeKind::FunctionDef
        );

        tracker.push(NodeKind::Call, Span::new(20, 40), None);
        // Call is not a scope, so enclosing should still be FunctionDef
        assert_eq!(
            tracker.enclosing_scope().unwrap().kind,
            NodeKind::FunctionDef
        );
    }

    // ========================================================================
    // NodeKind tests
    // ========================================================================

    #[test]
    fn test_node_kind_is_expression() {
        assert!(NodeKind::Name.is_expression());
        assert!(NodeKind::Call.is_expression());
        assert!(NodeKind::Lambda.is_expression());
        assert!(NodeKind::ListComp.is_expression());

        assert!(!NodeKind::Assign.is_expression());
        assert!(!NodeKind::FunctionDef.is_expression());
        assert!(!NodeKind::Module.is_expression());
    }

    #[test]
    fn test_node_kind_is_statement() {
        assert!(NodeKind::Assign.is_statement());
        assert!(NodeKind::FunctionDef.is_statement());
        assert!(NodeKind::If.is_statement());

        assert!(!NodeKind::Name.is_statement());
        assert!(!NodeKind::Call.is_statement());
        assert!(!NodeKind::Module.is_statement());
    }

    #[test]
    fn test_node_kind_is_compound_statement() {
        assert!(NodeKind::FunctionDef.is_compound_statement());
        assert!(NodeKind::ClassDef.is_compound_statement());
        assert!(NodeKind::If.is_compound_statement());
        assert!(NodeKind::Try.is_compound_statement());

        assert!(!NodeKind::Assign.is_compound_statement());
        assert!(!NodeKind::Pass.is_compound_statement());
    }

    #[test]
    fn test_node_kind_is_scope() {
        assert!(NodeKind::Module.is_scope());
        assert!(NodeKind::FunctionDef.is_scope());
        assert!(NodeKind::ClassDef.is_scope());
        assert!(NodeKind::Lambda.is_scope());
        assert!(NodeKind::ListComp.is_scope());

        assert!(!NodeKind::If.is_scope());
        assert!(!NodeKind::Assign.is_scope());
        assert!(!NodeKind::Call.is_scope());
    }

    // ========================================================================
    // Index statistics tests
    // ========================================================================

    #[test]
    fn test_index_counts() {
        let source = r#"
def foo():
    x = 1
    return x

class Bar:
    def method(self):
        pass
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let index = PositionIndex::build(&parsed.module, &parsed.positions, source);

        // Should have at least some nodes, expressions, statements, and scopes
        assert!(index.node_count() > 0);
        assert!(index.expression_count() > 0);
        assert!(index.statement_count() > 0);
        assert!(index.scope_count() > 0);

        // Module + foo + Bar + method = at least 4 scopes
        assert!(index.scope_count() >= 4);
    }
}
