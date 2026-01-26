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

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{
    AssignTargetExpression, Attribute, AugAssign, Call, ClassDef, DelTargetExpression, Expression,
    FunctionDef, Module, Span,
};

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
    pub receiver: String,
    /// The attribute name being accessed.
    pub attr_name: String,
    /// The kind of access (Read/Write/Call).
    pub kind: AttributeAccessKind,
    /// Byte span of the attribute name (for renaming).
    pub attr_span: Option<Span>,
    /// Scope path where the access occurs.
    pub scope_path: Vec<String>,
}

impl AttributeAccessInfo {
    /// Create a new AttributeAccessInfo.
    fn new(
        receiver: String,
        attr_name: String,
        kind: AttributeAccessKind,
        scope_path: Vec<String>,
    ) -> Self {
        Self {
            receiver,
            attr_name,
            kind,
            attr_span: None,
            scope_path,
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
    pub fn collect(module: &Module<'_>, positions: &'pos PositionTable) -> Vec<AttributeAccessInfo> {
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
    fn get_receiver_string(expr: &Expression<'_>) -> String {
        match expr {
            Expression::Name(name) => name.value.to_string(),
            Expression::Attribute(attr) => {
                let base = Self::get_receiver_string(&attr.value);
                format!("{}.{}", base, attr.attr.value)
            }
            Expression::Call(_) => "<call>".to_string(),
            _ => "<expr>".to_string(),
        }
    }

    /// Add an attribute access and register its span in the appropriate set.
    fn add_attribute_access(&mut self, attr: &Attribute<'_>, kind: AttributeAccessKind) {
        let receiver = Self::get_receiver_string(&attr.value);
        let attr_name = attr.attr.value.to_string();
        let span = self.lookup_span(attr.attr.node_id);

        // Register Write spans so visit_attribute can skip them
        if kind == AttributeAccessKind::Write {
            if let Some(s) = span {
                self.write_attrs.insert((s.start, s.end));
            }
        }

        let info = AttributeAccessInfo::new(receiver, attr_name, kind, self.scope_path.clone())
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

    fn visit_del_target_expression(
        &mut self,
        node: &DelTargetExpression<'a>,
    ) -> VisitResult {
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

        let reads: Vec<_> = accesses.iter().filter(|a| a.kind == AttributeAccessKind::Read).collect();
        let writes: Vec<_> = accesses.iter().filter(|a| a.kind == AttributeAccessKind::Write).collect();
        let calls: Vec<_> = accesses.iter().filter(|a| a.kind == AttributeAccessKind::Call).collect();

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
        assert_eq!(accesses[0].scope_path, vec!["<module>", "MyClass", "method"]);
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

        let writes: Vec<_> = accesses.iter().filter(|a| a.kind == AttributeAccessKind::Write).collect();
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
        let writes: Vec<_> = accesses.iter().filter(|a| a.kind == AttributeAccessKind::Write).collect();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].attr_name, "attr");
    }

    #[test]
    fn test_attribute_access_list_unpack_write() {
        // List unpacking to attributes should be Write context
        let source = "[obj.a, obj.b] = values";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let accesses = AttributeAccessCollector::collect(&parsed.module, &parsed.positions);

        let writes: Vec<_> = accesses.iter().filter(|a| a.kind == AttributeAccessKind::Write).collect();
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

        let writes: Vec<_> = accesses.iter().filter(|a| a.kind == AttributeAccessKind::Write).collect();
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
        let reads: Vec<_> = accesses.iter().filter(|a| a.kind == AttributeAccessKind::Read).collect();
        assert_eq!(reads.len(), 1);
        assert_eq!(reads[0].attr_name, "attr");
    }
}
