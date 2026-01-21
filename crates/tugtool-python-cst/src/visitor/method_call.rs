// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! MethodCallCollector visitor for Python method call pattern extraction.
//!
//! This module provides a [`MethodCallCollector`] visitor that traverses a CST and
//! collects `obj.method()` patterns for type-based resolution.
//!
//! # What is Collected?
//!
//! - **Method calls**: `obj.method()`, `self.process()`, `handler.execute()`
//! - Only calls where the receiver is a simple name (not complex expressions)
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, MethodCallCollector, MethodCallInfo};
//!
//! let source = "handler = Handler()\nhandler.process()";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);
//! for call in &calls {
//!     println!("{}.{}()", call.receiver, call.method);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{Attribute, Call, ClassDef, Expression, FunctionDef, Module, Name, Span};

/// Information about a method call pattern (`obj.method()`).
#[derive(Debug, Clone)]
pub struct MethodCallInfo {
    /// The receiver variable name (e.g., "handler" in "handler.process()").
    pub receiver: String,
    /// The method name being called (e.g., "process").
    pub method: String,
    /// Scope path where the call occurs.
    pub scope_path: Vec<String>,
    /// Byte span of the method name (for renaming).
    pub method_span: Option<Span>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Column number (1-indexed).
    pub col: Option<u32>,
}

impl MethodCallInfo {
    /// Create a new MethodCallInfo.
    fn new(receiver: String, method: String, scope_path: Vec<String>) -> Self {
        Self {
            receiver,
            method,
            scope_path,
            method_span: None,
            line: None,
            col: None,
        }
    }

    /// Set the span for the method name.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.method_span = span;
        self
    }
}

/// A visitor that collects method call information from a Python CST.
///
/// MethodCallCollector traverses the CST and identifies method call patterns
/// like `obj.method()` where `obj` is a simple variable name. This enables
/// type-based resolution during rename operations.
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);
/// ```
pub struct MethodCallCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected method calls.
    calls: Vec<MethodCallInfo>,
    /// Current scope path.
    scope_path: Vec<String>,
}

impl<'pos> MethodCallCollector<'pos> {
    /// Create a new MethodCallCollector without position tracking.
    ///
    /// Calls will be collected but spans will be None.
    pub fn new() -> Self {
        Self {
            positions: None,
            calls: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Create a new MethodCallCollector with position tracking.
    ///
    /// Calls will include spans from the PositionTable.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            calls: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Collect method calls from a parsed module with position information.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    pub fn collect(
        module: &Module<'_>,
        positions: &'pos PositionTable,
    ) -> Vec<MethodCallInfo> {
        let mut collector = MethodCallCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.calls
    }

    /// Get the collected method calls, consuming the collector.
    pub fn into_calls(self) -> Vec<MethodCallInfo> {
        self.calls
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Check if a call expression is a method call (obj.method()) and extract info.
    /// Returns (receiver_name, method_name, method_name_node_for_span).
    fn extract_method_call_info<'a>(call: &'a Call<'_>) -> Option<(String, String, &'a Name<'a>)> {
        // Check if the function is an attribute access (obj.method)
        if let Expression::Attribute(attr) = &*call.func {
            // Check if the receiver is a simple name
            if let Some(receiver) = Self::get_receiver_name(attr) {
                let method = attr.attr.value.to_string();
                return Some((receiver, method, &attr.attr));
            }
        }
        None
    }

    /// Get the receiver name from an attribute expression.
    /// Only returns Some for simple name receivers (not complex expressions).
    fn get_receiver_name(attr: &Attribute<'_>) -> Option<String> {
        match &*attr.value {
            Expression::Name(name) => Some(name.value.to_string()),
            // For chained calls like obj.method1().method2(), we skip
            // We only want direct variable.method() patterns
            _ => None,
        }
    }
}

impl<'a, 'pos> Visitor<'a> for MethodCallCollector<'pos> {
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

    fn visit_call(&mut self, node: &Call<'a>) -> VisitResult {
        if let Some((receiver, method, method_name_node)) = Self::extract_method_call_info(node) {
            // Look up span from the Name node's embedded node_id
            let span = self.lookup_span(method_name_node.node_id);

            let info =
                MethodCallInfo::new(receiver, method, self.scope_path.clone()).with_span(span);
            self.calls.push(info);
        }
        VisitResult::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_method_call_simple() {
        let source = "obj.method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "obj");
        assert_eq!(calls[0].method, "method");
    }

    #[test]
    fn test_method_call_with_args() {
        let source = "obj.method(1, 2, 3)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "obj");
        assert_eq!(calls[0].method, "method");
    }

    #[test]
    fn test_method_call_self() {
        let source = "self.process()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "self");
        assert_eq!(calls[0].method, "process");
    }

    #[test]
    fn test_method_call_multiple() {
        let source = r#"handler.process()
result.save()
data.validate()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0].receiver, "handler");
        assert_eq!(calls[0].method, "process");
        assert_eq!(calls[1].receiver, "result");
        assert_eq!(calls[1].method, "save");
        assert_eq!(calls[2].receiver, "data");
        assert_eq!(calls[2].method, "validate");
    }

    #[test]
    fn test_method_call_in_function() {
        let source = r#"def use_handler():
    handler = Handler()
    handler.process()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        // The Handler() call is not a method call, only handler.process() is
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "handler");
        assert_eq!(calls[0].method, "process");
        assert_eq!(calls[0].scope_path, vec!["<module>", "use_handler"]);
    }

    #[test]
    fn test_method_call_in_class() {
        let source = r#"class MyClass:
    def method(self):
        self.helper()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "self");
        assert_eq!(calls[0].method, "helper");
        assert_eq!(
            calls[0].scope_path,
            vec!["<module>", "MyClass", "method"]
        );
    }

    #[test]
    fn test_plain_function_call_not_collected() {
        let source = "print('hello')";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        // Plain function calls are not method calls
        assert!(calls.is_empty());
    }

    #[test]
    fn test_constructor_call_not_collected() {
        let source = "obj = MyClass()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        // Constructor calls are not method calls
        assert!(calls.is_empty());
    }

    #[test]
    fn test_chained_call_only_first() {
        // For chained calls, we only collect the first one where receiver is a simple name
        let source = "obj.method1().method2()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        // Only obj.method1() is collected because method2()'s receiver is a call expression
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "obj");
        assert_eq!(calls[0].method, "method1");
    }

    #[test]
    fn test_method_call_has_span() {
        let source = "obj.method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        assert!(calls[0].method_span.is_some());
        let span = calls[0].method_span.unwrap();
        // "method" starts at position 4 (after "obj.")
        assert_eq!(span.start, 4);
        assert_eq!(span.end, 10); // "method" is 6 characters
    }

    #[test]
    fn test_handler_pattern() {
        // Real-world pattern for type-based rename
        let source = r#"def use_handlers():
    handler = MyHandler()
    handler.process()

    other = handler
    other.process()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 2);

        assert_eq!(calls[0].receiver, "handler");
        assert_eq!(calls[0].method, "process");

        assert_eq!(calls[1].receiver, "other");
        assert_eq!(calls[1].method, "process");
    }

    #[test]
    fn test_module_function_not_collected() {
        // Module-level attribute access that's a function call, not a method call
        let source = "os.path.join('a', 'b')";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = MethodCallCollector::collect(&parsed.module, &parsed.positions);

        // os.path.join - "path" is an attribute, not a simple name receiver
        // We should collect os.path since os is a simple name
        // But os.path.join - path.join's receiver is os.path which is an attribute
        // Actually let's check what we get
        // os.path.join() -> func = Attribute(value=Attribute(value=Name(os), attr=path), attr=join)
        // The receiver for "join" would be "os.path" which is an Attribute, not a Name
        // So this should be empty
        assert!(calls.is_empty());
    }
}
