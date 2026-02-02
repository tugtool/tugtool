// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! AttributeAccessCollector visitor for Python attribute access extraction.
//!
//! This module provides an [`AttributeAccessCollector`] visitor that traverses a CST and
//! collects attribute access patterns with context (Read/Write/Call).
//!
//! # What is Collected?
//!
//! - **Read**: `obj.attr` used in an expression position (load)
//! - **Write**: `obj.attr` as assignment target or augmented assignment target
//! - **Call**: `obj.attr()` method call
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, AttributeAccessCollector, AttributeAccessInfo, AttributeAccessKind};
//!
//! let source = "obj.attr = 1\nprint(obj.name)\nobj.method()";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);
//! for access in &accesses {
//!     println!("{}.{} ({:?})", access.receiver, access.attr_name, access.kind);
//! }
//! ```

use serde::{Deserialize, Serialize};

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{
    AssignTargetExpression, Attribute, AugAssign, Call, ClassDef, DelTargetExpression, Expression,
    FunctionDef, Module, Span,
};

// ============================================================================
// ReceiverPath types for structured receiver representation
// ============================================================================

/// A single step in a receiver path.
///
/// Serde representation uses adjacently tagged enum format for clear JSON output:
/// - Name: `{"type": "name", "value": "self"}`
/// - Attribute: `{"type": "attribute", "value": "handler"}`
/// - Call: `{"type": "call"}`
///
/// # Examples
///
/// ```ignore
/// // self.handler.process()
/// [
///     ReceiverStep::Name { value: "self".into() },
///     ReceiverStep::Attribute { value: "handler".into() },
///     ReceiverStep::Attribute { value: "process".into() },
///     ReceiverStep::Call,
/// ]
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReceiverStep {
    /// Simple name: `self`, `obj`, `factory`
    Name { value: String },
    /// Attribute access: `.handler`, `.process`
    Attribute { value: String },
    /// Function/method call: `()`
    Call,
    /// Subscript access: `[index]` - element type resolved from container annotation
    Subscript,
}

/// Structured receiver path extracted from CST.
///
/// This represents the chain of steps leading to an attribute access or call site.
/// It preserves the structure of the expression, distinguishing between names,
/// attribute accesses, call operations, and subscript accesses.
///
/// # Supported Patterns
///
/// - `self.handler.process()` → `[Name(self), Attr(handler), Attr(process), Call]`
/// - `get_handler().process()` → `[Name(get_handler), Call, Attr(process), Call]`
/// - `factory().create().process()` → `[Name(factory), Call, Attr(create), Call, Attr(process), Call]`
/// - `items[0].process()` → `[Name(items), Subscript, Attr(process), Call]`
///
/// # Unsupported Patterns
///
/// Returns `None` for expressions that cannot be represented as steps:
/// - Nested subscripts: `data[0][1]` → `None`
/// - Complex expressions: `(a or b).method()` → `None`
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ReceiverPath {
    pub steps: Vec<ReceiverStep>,
}

impl ReceiverPath {
    /// Create a new empty receiver path.
    pub fn new() -> Self {
        Self { steps: Vec::new() }
    }

    /// Create a receiver path with a single name step.
    pub fn from_name(name: impl Into<String>) -> Self {
        Self {
            steps: vec![ReceiverStep::Name { value: name.into() }],
        }
    }

    /// Add an attribute access step.
    pub fn with_attribute(mut self, attr: impl Into<String>) -> Self {
        self.steps.push(ReceiverStep::Attribute { value: attr.into() });
        self
    }

    /// Add a call step.
    pub fn with_call(mut self) -> Self {
        self.steps.push(ReceiverStep::Call);
        self
    }

    /// Add a subscript step.
    pub fn with_subscript(mut self) -> Self {
        self.steps.push(ReceiverStep::Subscript);
        self
    }

    /// Returns true if the path is empty.
    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    /// Returns the number of steps in the path.
    pub fn len(&self) -> usize {
        self.steps.len()
    }
}

// ============================================================================
// Conversion to Core types
// ============================================================================

use tugtool_core::facts::{
    ReceiverPath as CoreReceiverPath, ReceiverPathStep as CoreReceiverPathStep,
};

impl From<&ReceiverStep> for CoreReceiverPathStep {
    fn from(step: &ReceiverStep) -> Self {
        match step {
            ReceiverStep::Name { value } => CoreReceiverPathStep::Name {
                value: value.clone(),
            },
            ReceiverStep::Attribute { value } => CoreReceiverPathStep::Attribute {
                value: value.clone(),
            },
            ReceiverStep::Call => CoreReceiverPathStep::Call,
            ReceiverStep::Subscript => CoreReceiverPathStep::Subscript,
        }
    }
}

impl From<ReceiverStep> for CoreReceiverPathStep {
    fn from(step: ReceiverStep) -> Self {
        (&step).into()
    }
}

impl From<&ReceiverPath> for CoreReceiverPath {
    fn from(path: &ReceiverPath) -> Self {
        CoreReceiverPath::new(path.steps.iter().map(Into::into).collect())
    }
}

impl From<ReceiverPath> for CoreReceiverPath {
    fn from(path: ReceiverPath) -> Self {
        (&path).into()
    }
}

/// Extract a structured receiver path from an expression.
///
/// This function recursively traverses the expression tree and builds a
/// `ReceiverPath` representing the chain of names, attributes, and calls.
///
/// # Returns
///
/// - `Some(ReceiverPath)` for supported expression patterns
/// - `None` for unsupported patterns (subscript, complex expressions)
///
/// # Examples
///
/// ```ignore
/// // self.handler
/// extract_receiver_path(&self_handler_expr) // [Name(self), Attr(handler)]
///
/// // get_obj().method
/// extract_receiver_path(&get_obj_method_expr) // [Name(get_obj), Call, Attr(method)]
/// ```
pub fn extract_receiver_path(expr: &Expression<'_>) -> Option<ReceiverPath> {
    let mut steps = Vec::new();
    if extract_receiver_path_recursive(expr, &mut steps) {
        Some(ReceiverPath { steps })
    } else {
        None
    }
}

/// Recursive helper for extract_receiver_path.
///
/// Returns `true` if the expression was successfully converted to steps,
/// `false` if an unsupported pattern was encountered.
fn extract_receiver_path_recursive(expr: &Expression<'_>, steps: &mut Vec<ReceiverStep>) -> bool {
    match expr {
        Expression::Name(name) => {
            steps.push(ReceiverStep::Name {
                value: name.value.to_string(),
            });
            true
        }
        Expression::Attribute(attr) => {
            // First, process the receiver (value)
            if !extract_receiver_path_recursive(&attr.value, steps) {
                return false;
            }
            // Then add the attribute access
            steps.push(ReceiverStep::Attribute {
                value: attr.attr.value.to_string(),
            });
            true
        }
        Expression::Call(call) => {
            // First, process the callee (func)
            if !extract_receiver_path_recursive(&call.func, steps) {
                return false;
            }
            // Then add the call step
            steps.push(ReceiverStep::Call);
            true
        }
        Expression::Subscript(subscript) => {
            // First, process the container (value)
            if !extract_receiver_path_recursive(&subscript.value, steps) {
                return false;
            }
            // Check for nested subscript - unsupported
            if steps.iter().any(|s| matches!(s, ReceiverStep::Subscript)) {
                return false;
            }
            // Then add the subscript step
            steps.push(ReceiverStep::Subscript);
            true
        }
        // Unsupported patterns return None
        _ => false,
    }
}

/// The kind of attribute access.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AttributeAccessKind {
    /// Attribute read (load context): `x = obj.attr`
    Read,
    /// Attribute write (store context): `obj.attr = x`
    Write,
    /// Attribute call (method call): `obj.attr()`
    Call,
}

impl AttributeAccessKind {
    /// Returns the string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            AttributeAccessKind::Read => "read",
            AttributeAccessKind::Write => "write",
            AttributeAccessKind::Call => "call",
        }
    }
}

impl std::fmt::Display for AttributeAccessKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about an attribute access pattern.
#[derive(Debug, Clone)]
pub struct AttributeAccessInfo {
    /// The receiver expression as a string (e.g., "obj" in "obj.attr").
    ///
    /// This is a simple string representation for display and debugging.
    /// For resolution, use `receiver_path` when available.
    pub receiver: String,
    /// The attribute name being accessed.
    pub attr_name: String,
    /// The kind of access (Read/Write/Call).
    pub kind: AttributeAccessKind,
    /// Byte span of the attribute name (for renaming).
    pub attr_span: Option<Span>,
    /// Scope path where the access occurs.
    pub scope_path: Vec<String>,
    /// Structured receiver path for resolution.
    ///
    /// This is `Some` for expressions that can be represented as steps
    /// (names, attributes, calls). It is `None` for unsupported patterns
    /// like subscripts or complex expressions.
    pub receiver_path: Option<ReceiverPath>,
}

impl AttributeAccessInfo {
    /// Create a new AttributeAccessInfo.
    fn new(
        receiver: String,
        attr_name: String,
        kind: AttributeAccessKind,
        scope_path: Vec<String>,
        receiver_path: Option<ReceiverPath>,
    ) -> Self {
        Self {
            receiver,
            attr_name,
            kind,
            attr_span: None,
            scope_path,
            receiver_path,
        }
    }

    /// Set the span for the attribute name.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.attr_span = span;
        self
    }
}

/// A visitor that collects attribute access information from a Python CST.
///
/// AttributeAccessCollector traverses the CST and identifies attribute access patterns
/// like `obj.attr` with context detection for Read/Write/Call.
///
/// # Context Detection Strategy
///
/// Rather than using a context stack, we use HashSets to track which attribute spans
/// have already been processed as Call or Write contexts:
///
/// 1. **Call context**: When visiting a `Call` node, if the callee is an attribute,
///    we add it as Call and record the span in `call_attrs`.
/// 2. **Write context**: When visiting assign/aug_assign/del nodes, we add attribute
///    targets as Write and record their spans in `write_attrs`.
/// 3. **Read context**: When visiting a bare `Attribute` node, we check if its span
///    is already in `call_attrs` or `write_attrs`. If not, it's a Read.
///
/// This approach is O(1) for duplicate detection instead of O(n) scanning.
pub struct AttributeAccessCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected attribute accesses.
    accesses: Vec<AttributeAccessInfo>,
    /// Current scope path.
    scope_path: Vec<String>,
    /// Spans of attributes already processed as Call context.
    call_attrs: std::collections::HashSet<(usize, usize)>,
    /// Spans of attributes already processed as Write context.
    write_attrs: std::collections::HashSet<(usize, usize)>,
}

impl<'pos> Default for AttributeAccessCollector<'pos> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'pos> AttributeAccessCollector<'pos> {
    /// Create a new AttributeAccessCollector without position tracking.
    pub fn new() -> Self {
        Self {
            positions: None,
            accesses: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            call_attrs: std::collections::HashSet::new(),
            write_attrs: std::collections::HashSet::new(),
        }
    }

    /// Create a new AttributeAccessCollector with position tracking.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            accesses: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            call_attrs: std::collections::HashSet::new(),
            write_attrs: std::collections::HashSet::new(),
        }
    }

    /// Collect attribute accesses from a parsed module with position information.
    pub fn collect(
        module: &Module<'_>,
        positions: &'pos PositionTable,
    ) -> Vec<AttributeAccessInfo> {
        let mut collector = AttributeAccessCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.accesses
    }

    /// Get the collected accesses, consuming the collector.
    pub fn into_accesses(self) -> Vec<AttributeAccessInfo> {
        self.accesses
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Get the receiver name as a string.
    /// Returns the string representation of the receiver expression.
    ///
    /// For simple names, returns the name directly (e.g., "obj").
    /// For chained attributes, returns the dotted path (e.g., "obj.inner").
    /// For call expressions, extracts the callee name (e.g., "get_obj" from "get_obj()").
    /// For subscript expressions, extracts the container name (e.g., "items" from "items[0]").
    /// For other expressions, returns "<expr>".
    fn get_receiver_string(expr: &Expression<'_>) -> String {
        match expr {
            Expression::Name(name) => name.value.to_string(),
            Expression::Attribute(attr) => {
                let base = Self::get_receiver_string(&attr.value);
                format!("{}.{}", base, attr.attr.value)
            }
            Expression::Call(call) => {
                // Extract callee name from call expression.
                // For `get_obj()`, extract "get_obj".
                // For `get_obj().method()`, this would be an Attribute on a Call,
                // so the recursive call handles the chaining.
                Self::get_receiver_string(&call.func)
            }
            Expression::Subscript(subscript) => {
                // Extract container name from subscript expression.
                // For `items[0]`, extract "items".
                // For nested subscripts like `data[0][1]`, the inner subscript
                // is handled recursively, producing "data".
                Self::get_receiver_string(&subscript.value)
            }
            _ => "<expr>".to_string(),
        }
    }

    /// Add an attribute access and register its span in the appropriate set.
    fn add_attribute_access(&mut self, attr: &Attribute<'_>, kind: AttributeAccessKind) {
        let receiver = Self::get_receiver_string(&attr.value);
        let attr_name = attr.attr.value.to_string();
        let span = self.lookup_span(attr.attr.node_id);

        // Extract structured receiver path from the receiver expression.
        // For a call like `self.handler.process()`, when we're collecting the attribute access
        // for `process`, the `attr.value` is `self.handler`, so we extract from that.
        // Then we add the current attribute as an additional step.
        let receiver_path = extract_receiver_path(&attr.value);

        // Register Write spans so visit_attribute can skip them
        if kind == AttributeAccessKind::Write {
            if let Some(s) = span {
                self.write_attrs.insert((s.start, s.end));
            }
        }

        let info = AttributeAccessInfo::new(
            receiver,
            attr_name,
            kind,
            self.scope_path.clone(),
            receiver_path,
        )
        .with_span(span);

        self.accesses.push(info);
    }

    /// Process assignment targets to mark Write context for attributes.
    fn process_assign_target(&mut self, target: &AssignTargetExpression<'_>) {
        match target {
            AssignTargetExpression::Attribute(attr) => {
                self.add_attribute_access(attr, AttributeAccessKind::Write);
            }
            AssignTargetExpression::Tuple(tuple) => {
                for element in &tuple.elements {
                    match element {
                        crate::nodes::Element::Simple { value, .. } => {
                            self.process_expression_as_target(value);
                        }
                        crate::nodes::Element::Starred(starred) => {
                            self.process_expression_as_target(&starred.value);
                        }
                    }
                }
            }
            AssignTargetExpression::List(list) => {
                for element in &list.elements {
                    match element {
                        crate::nodes::Element::Simple { value, .. } => {
                            self.process_expression_as_target(value);
                        }
                        crate::nodes::Element::Starred(starred) => {
                            self.process_expression_as_target(&starred.value);
                        }
                    }
                }
            }
            AssignTargetExpression::StarredElement(starred) => {
                self.process_expression_as_target(&starred.value);
            }
            _ => {}
        }
    }

    /// Process an expression as an assignment target.
    fn process_expression_as_target(&mut self, expr: &Expression<'_>) {
        if let Expression::Attribute(attr) = expr {
            self.add_attribute_access(attr, AttributeAccessKind::Write);
        }
    }
}

impl<'a, 'pos> Visitor<'a> for AttributeAccessCollector<'pos> {
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        self.scope_path.push(node.name.value.to_string());
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        self.scope_path.push(node.name.value.to_string());
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_assign(&mut self, node: &crate::nodes::Assign<'a>) -> VisitResult {
        // Process assignment targets as Write context
        for target in &node.targets {
            self.process_assign_target(&target.target);
        }
        VisitResult::Continue
    }

    fn visit_aug_assign(&mut self, node: &AugAssign<'a>) -> VisitResult {
        // Augmented assignment target is Write
        self.process_assign_target(&node.target);
        VisitResult::Continue
    }

    fn visit_ann_assign(&mut self, node: &crate::nodes::AnnAssign<'a>) -> VisitResult {
        // Annotated assignment target is Write
        self.process_assign_target(&node.target);
        VisitResult::Continue
    }

    fn visit_del_target_expression(&mut self, node: &DelTargetExpression<'a>) -> VisitResult {
        // Del targets are treated as Write (modification)
        if let DelTargetExpression::Attribute(attr) = node {
            self.add_attribute_access(attr, AttributeAccessKind::Write);
        }
        VisitResult::Continue
    }

    fn visit_call(&mut self, node: &Call<'a>) -> VisitResult {
        // If the function is an attribute, mark it as Call
        if let Expression::Attribute(attr) = node.func.as_ref() {
            self.add_attribute_access(attr, AttributeAccessKind::Call);
            // Mark this attribute span so we don't re-add it as Read
            if let Some(span) = self.lookup_span(attr.attr.node_id) {
                self.call_attrs.insert((span.start, span.end));
            }
        }
        VisitResult::Continue
    }

    fn visit_attribute(&mut self, node: &Attribute<'a>) -> VisitResult {
        // Check if this attribute was already processed as Call or Write
        // This is O(1) lookup instead of O(n) scanning
        if let Some(span) = self.lookup_span(node.attr.node_id) {
            let key = (span.start, span.end);
            if self.call_attrs.contains(&key) || self.write_attrs.contains(&key) {
                // Already added as Call or Write, skip
                return VisitResult::Continue;
            }
        }

        // Default context is Read
        self.add_attribute_access(node, AttributeAccessKind::Read);
        VisitResult::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_attribute_access_read() {
        let source = "x = obj.attr";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].receiver, "obj");
        assert_eq!(accesses[0].attr_name, "attr");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Read);
    }

    #[test]
    fn test_attribute_access_write() {
        let source = "obj.attr = 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].receiver, "obj");
        assert_eq!(accesses[0].attr_name, "attr");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Write);
    }

    #[test]
    fn test_attribute_access_call() {
        let source = "obj.method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].receiver, "obj");
        assert_eq!(accesses[0].attr_name, "method");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Call);
    }

    #[test]
    fn test_attribute_access_aug_assign() {
        let source = "obj.count += 1";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].receiver, "obj");
        assert_eq!(accesses[0].attr_name, "count");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Write);
    }

    #[test]
    fn test_attribute_access_del() {
        let source = "del obj.attr";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].receiver, "obj");
        assert_eq!(accesses[0].attr_name, "attr");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Write);
    }

    #[test]
    fn test_attribute_access_multiple() {
        let source = r#"
x = obj.read_attr
obj.write_attr = 1
obj.call_attr()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 3);

        let reads: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Read)
            .collect();
        let writes: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Write)
            .collect();
        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();

        assert_eq!(reads.len(), 1);
        assert_eq!(writes.len(), 1);
        assert_eq!(calls.len(), 1);

        assert_eq!(reads[0].attr_name, "read_attr");
        assert_eq!(writes[0].attr_name, "write_attr");
        assert_eq!(calls[0].attr_name, "call_attr");
    }

    #[test]
    fn test_attribute_access_chained() {
        // obj.a.b.c should report three reads
        let source = "x = obj.a.b.c";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // We should get accesses for a, b, and c
        assert_eq!(accesses.len(), 3);
        let names: Vec<_> = accesses.iter().map(|a| a.attr_name.as_str()).collect();
        assert!(names.contains(&"a"));
        assert!(names.contains(&"b"));
        assert!(names.contains(&"c"));
    }

    #[test]
    fn test_attribute_access_in_function() {
        let source = r#"
def process():
    self.data = 1
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].receiver, "self");
        assert_eq!(accesses[0].attr_name, "data");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Write);
        assert_eq!(accesses[0].scope_path, vec!["<module>", "process"]);
    }

    #[test]
    fn test_attribute_access_in_class() {
        let source = r#"
class MyClass:
    def method(self):
        return self.value
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].receiver, "self");
        assert_eq!(accesses[0].attr_name, "value");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Read);
        assert_eq!(
            accesses[0].scope_path,
            vec!["<module>", "MyClass", "method"]
        );
    }

    #[test]
    fn test_attribute_access_span() {
        let source = "obj.attr";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert!(accesses[0].attr_span.is_some());
        let span = accesses[0].attr_span.unwrap();
        // "attr" starts at position 4 (after "obj.")
        assert_eq!(span.start, 4);
        assert_eq!(span.end, 8);
    }

    #[test]
    fn test_attribute_access_tuple_unpack_write() {
        let source = "obj.a, obj.b = values";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let writes: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Write)
            .collect();
        assert_eq!(writes.len(), 2);
        assert!(writes.iter().any(|w| w.attr_name == "a"));
        assert!(writes.iter().any(|w| w.attr_name == "b"));
    }

    #[test]
    fn test_attribute_access_call_with_args() {
        let source = "obj.method(1, 2, key=3)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].attr_name, "method");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Call);
    }

    #[test]
    fn test_attribute_access_ann_assign() {
        let source = "obj.attr: int = 5";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Should have a Write for obj.attr
        let writes: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Write)
            .collect();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].attr_name, "attr");
    }

    #[test]
    fn test_attribute_access_list_unpack_write() {
        // List unpacking to attributes should be Write context
        let source = "[obj.a, obj.b] = values";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let writes: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Write)
            .collect();
        assert_eq!(writes.len(), 2);
        assert!(writes.iter().any(|w| w.attr_name == "a"));
        assert!(writes.iter().any(|w| w.attr_name == "b"));
    }

    #[test]
    fn test_attribute_access_starred_element_write() {
        // Starred element in tuple unpack should be Write context
        let source = "obj.first, *obj.rest = items";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let writes: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Write)
            .collect();
        assert_eq!(writes.len(), 2);
        assert!(writes.iter().any(|w| w.attr_name == "first"));
        assert!(writes.iter().any(|w| w.attr_name == "rest"));
    }

    #[test]
    fn test_attribute_access_as_call_argument() {
        // Attribute used as a function argument should be Read context
        let source = "foo(bar=obj.attr)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Should have one Read for obj.attr (used as keyword argument)
        let reads: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Read)
            .collect();
        assert_eq!(reads.len(), 1);
        assert_eq!(reads[0].attr_name, "attr");
    }

    // ========================================================================
    // Receiver extraction from Call expressions
    // ========================================================================

    #[test]
    fn test_receiver_extraction_simple_call() {
        // get_obj().method -> receiver should be "get_obj"
        let source = "get_obj().method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Should have one Call for `.method`
        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].attr_name, "method");
        assert_eq!(calls[0].receiver, "get_obj");
    }

    #[test]
    fn test_receiver_extraction_chained_calls() {
        // get_a().get_b().method -> receiver should be "get_a.get_b"
        let source = "get_a().get_b().method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Should have three Calls: get_b on get_a(), method on get_a().get_b()
        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 2);

        // Find the final method call
        let method_call = calls.iter().find(|c| c.attr_name == "method").unwrap();
        assert_eq!(method_call.receiver, "get_a.get_b");

        // Find the intermediate get_b call
        let get_b_call = calls.iter().find(|c| c.attr_name == "get_b").unwrap();
        assert_eq!(get_b_call.receiver, "get_a");
    }

    #[test]
    fn test_receiver_extraction_subscript() {
        // data[0].method -> receiver should be "data" (container name extracted from subscript)
        let source = "data[0].method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Should have one Call for `.method`
        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].attr_name, "method");
        // Now that subscript is supported, receiver shows the container name
        assert_eq!(calls[0].receiver, "data");
    }

    #[test]
    fn test_receiver_extraction_read_context() {
        // get_obj().attr (read, not call) should also extract receiver
        let source = "x = get_obj().attr";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Should have one Read for `.attr`
        let reads: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Read)
            .collect();
        assert_eq!(reads.len(), 1);
        assert_eq!(reads[0].attr_name, "attr");
        assert_eq!(reads[0].receiver, "get_obj");
    }

    // ========================================================================
    // ReceiverPath tests - structured receiver path extraction
    // ========================================================================

    #[test]
    fn test_receiver_path_self_handler_process() {
        // self.handler.process() -> receiver_path should be [Name(self), Attr(handler)]
        // (The `process` is the attr_name, not part of receiver_path)
        let source = "self.handler.process()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Should have Call for `.process` and Read for `.handler`
        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].attr_name, "process");

        // Check the receiver_path
        let path = calls[0]
            .receiver_path
            .as_ref()
            .expect("should have receiver_path");
        assert_eq!(path.steps.len(), 2);
        assert_eq!(
            path.steps[0],
            ReceiverStep::Name {
                value: "self".to_string()
            }
        );
        assert_eq!(
            path.steps[1],
            ReceiverStep::Attribute {
                value: "handler".to_string()
            }
        );
    }

    #[test]
    fn test_receiver_path_get_handler_process() {
        // get_handler().process() -> receiver_path should be [Name(get_handler), Call]
        let source = "get_handler().process()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].attr_name, "process");

        let path = calls[0]
            .receiver_path
            .as_ref()
            .expect("should have receiver_path");
        assert_eq!(path.steps.len(), 2);
        assert_eq!(
            path.steps[0],
            ReceiverStep::Name {
                value: "get_handler".to_string()
            }
        );
        assert_eq!(path.steps[1], ReceiverStep::Call);
    }

    #[test]
    fn test_receiver_path_factory_create_process() {
        // factory().create().process() -> receiver_path should be [Name(factory), Call, Attr(create), Call]
        let source = "factory().create().process()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Find the final `.process()` call
        let process_call = accesses
            .iter()
            .find(|a| a.attr_name == "process" && a.kind == AttributeAccessKind::Call)
            .expect("should find process call");

        let path = process_call
            .receiver_path
            .as_ref()
            .expect("should have receiver_path");
        assert_eq!(path.steps.len(), 4);
        assert_eq!(
            path.steps[0],
            ReceiverStep::Name {
                value: "factory".to_string()
            }
        );
        assert_eq!(path.steps[1], ReceiverStep::Call);
        assert_eq!(
            path.steps[2],
            ReceiverStep::Attribute {
                value: "create".to_string()
            }
        );
        assert_eq!(path.steps[3], ReceiverStep::Call);
    }

    #[test]
    fn test_receiver_path_simple_obj_method() {
        // obj.method() -> receiver_path should be [Name(obj)] (Fixture 11C-F12)
        let source = "obj.method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].attr_name, "method");

        let path = calls[0]
            .receiver_path
            .as_ref()
            .expect("should have receiver_path");
        assert_eq!(path.steps.len(), 1);
        assert_eq!(
            path.steps[0],
            ReceiverStep::Name {
                value: "obj".to_string()
            }
        );
    }

    #[test]
    fn test_receiver_path_subscript_supported() {
        // data[0].method() -> receiver_path should be [Name(data), Subscript]
        let source = "data[0].method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].attr_name, "method");
        // Receiver shows the container name
        assert_eq!(calls[0].receiver, "data");
        // receiver_path should include Subscript step
        let path = calls[0]
            .receiver_path
            .as_ref()
            .expect("subscript should have receiver_path");
        assert_eq!(path.steps.len(), 2);
        assert_eq!(
            path.steps[0],
            ReceiverStep::Name {
                value: "data".to_string()
            }
        );
        assert_eq!(path.steps[1], ReceiverStep::Subscript);
    }

    #[test]
    fn test_receiver_path_nested_subscript_returns_none() {
        // data[0][1].method() -> receiver_path should be None (nested subscript unsupported)
        let source = "data[0][1].method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].attr_name, "method");
        // Nested subscript returns None receiver_path
        assert!(
            calls[0].receiver_path.is_none(),
            "nested subscript should return None receiver_path"
        );
    }

    #[test]
    fn test_receiver_path_complex_expr_returns_none() {
        // (a or b).method() -> receiver_path should be None (expr unsupported)
        let source = "(a or b).method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let calls: Vec<_> = accesses
            .iter()
            .filter(|a| a.kind == AttributeAccessKind::Call)
            .collect();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].attr_name, "method");
        // Legacy receiver shows "<expr>"
        assert_eq!(calls[0].receiver, "<expr>");
        // receiver_path should be None
        assert!(
            calls[0].receiver_path.is_none(),
            "complex expr should return None receiver_path"
        );
    }

    #[test]
    fn test_receiver_path_read_context() {
        // self.data = self.handler.value -> read of `.value` should have receiver_path
        let source = "self.data = self.handler.value";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Find the Read for `.value`
        let value_read = accesses
            .iter()
            .find(|a| a.attr_name == "value" && a.kind == AttributeAccessKind::Read)
            .expect("should find value read");

        let path = value_read
            .receiver_path
            .as_ref()
            .expect("should have receiver_path");
        assert_eq!(path.steps.len(), 2);
        assert_eq!(
            path.steps[0],
            ReceiverStep::Name {
                value: "self".to_string()
            }
        );
        assert_eq!(
            path.steps[1],
            ReceiverStep::Attribute {
                value: "handler".to_string()
            }
        );
    }

    #[test]
    fn test_receiver_path_json_serialization() {
        // Test that ReceiverPath and ReceiverStep serialize correctly to JSON
        let path = ReceiverPath {
            steps: vec![
                ReceiverStep::Name {
                    value: "self".to_string(),
                },
                ReceiverStep::Attribute {
                    value: "handler".to_string(),
                },
                ReceiverStep::Attribute {
                    value: "process".to_string(),
                },
                ReceiverStep::Call,
            ],
        };

        let json = serde_json::to_string(&path).unwrap();
        // Verify adjacently tagged format
        assert!(json.contains(r#""type":"name""#));
        assert!(json.contains(r#""value":"self""#));
        assert!(json.contains(r#""type":"attribute""#));
        assert!(json.contains(r#""value":"handler""#));
        assert!(json.contains(r#""type":"call""#));

        // Verify round-trip
        let deserialized: ReceiverPath = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, path);
    }

    #[test]
    fn test_receiver_path_subscript_json_serialization() {
        // Test that Subscript step serializes correctly to JSON
        let path = ReceiverPath {
            steps: vec![
                ReceiverStep::Name {
                    value: "items".to_string(),
                },
                ReceiverStep::Subscript,
                ReceiverStep::Attribute {
                    value: "process".to_string(),
                },
                ReceiverStep::Call,
            ],
        };

        let json = serde_json::to_string(&path).unwrap();
        // Verify subscript is serialized
        assert!(json.contains(r#""type":"subscript""#));

        // Verify round-trip
        let deserialized: ReceiverPath = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, path);
    }

    // ========================================================================
    // ReceiverStep::Attribute variant tests (Phase A: ReceiverStep Variant Rename)
    // ========================================================================

    #[test]
    fn test_receiver_step_attribute_variant() {
        // Verify ReceiverStep::Attribute works correctly
        let step = ReceiverStep::Attribute {
            value: "handler".to_string(),
        };

        // Verify it can be compared
        assert_eq!(
            step,
            ReceiverStep::Attribute {
                value: "handler".to_string()
            }
        );

        // Verify it can be cloned
        let cloned = step.clone();
        assert_eq!(step, cloned);

        // Verify it serializes with the correct type tag
        let json = serde_json::to_string(&step).unwrap();
        assert!(json.contains(r#""type":"attribute""#));
        assert!(json.contains(r#""value":"handler""#));
    }

    #[test]
    fn test_receiver_path_builder_with_attribute() {
        // Verify with_attribute() builder method works
        let path = ReceiverPath::from_name("self").with_attribute("handler");

        assert_eq!(path.steps.len(), 2);
        assert_eq!(
            path.steps[0],
            ReceiverStep::Name {
                value: "self".to_string()
            }
        );
        assert_eq!(
            path.steps[1],
            ReceiverStep::Attribute {
                value: "handler".to_string()
            }
        );

        // Verify chaining multiple attributes
        let chained = ReceiverPath::from_name("self")
            .with_attribute("handler")
            .with_attribute("process")
            .with_call();

        assert_eq!(chained.steps.len(), 4);
        assert_eq!(
            chained.steps[2],
            ReceiverStep::Attribute {
                value: "process".to_string()
            }
        );
        assert_eq!(chained.steps[3], ReceiverStep::Call);
    }

    #[test]
    fn test_receiver_step_to_core_conversion() {
        // Verify From<ReceiverStep> for CoreReceiverPathStep works correctly

        // Test Name conversion
        let name_step = ReceiverStep::Name {
            value: "obj".to_string(),
        };
        let core_name: CoreReceiverPathStep = name_step.into();
        assert!(matches!(
            core_name,
            CoreReceiverPathStep::Name { value } if value == "obj"
        ));

        // Test Attribute conversion (the renamed variant)
        let attr_step = ReceiverStep::Attribute {
            value: "handler".to_string(),
        };
        let core_attr: CoreReceiverPathStep = attr_step.into();
        assert!(matches!(
            core_attr,
            CoreReceiverPathStep::Attribute { value } if value == "handler"
        ));

        // Test Call conversion
        let call_step = ReceiverStep::Call;
        let core_call: CoreReceiverPathStep = call_step.into();
        assert!(matches!(core_call, CoreReceiverPathStep::Call));

        // Test Subscript conversion
        let subscript_step = ReceiverStep::Subscript;
        let core_subscript: CoreReceiverPathStep = subscript_step.into();
        assert!(matches!(core_subscript, CoreReceiverPathStep::Subscript));
    }

    #[test]
    fn test_attribute_access_collection_unchanged() {
        // Verify existing attribute access collection behavior is unchanged
        // after the ReceiverStep::Attr -> ReceiverStep::Attribute rename

        // Test basic attribute read
        let source = "x = obj.attr";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);
        assert_eq!(accesses.len(), 1);
        assert_eq!(accesses[0].attr_name, "attr");
        assert_eq!(accesses[0].kind, AttributeAccessKind::Read);

        // Test method call with receiver_path
        let source = "self.handler.process()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        // Find the process() call
        let process_call = accesses
            .iter()
            .find(|a| a.attr_name == "process")
            .expect("should find process");
        assert_eq!(process_call.kind, AttributeAccessKind::Call);

        // Verify receiver_path uses Attribute variant (not Attr)
        let path = process_call.receiver_path.as_ref().expect("should have path");
        assert_eq!(path.steps.len(), 2);
        assert!(matches!(
            &path.steps[1],
            ReceiverStep::Attribute { value } if value == "handler"
        ));
    }
}
