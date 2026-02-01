// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! CallSiteCollector visitor for Python call site extraction with argument walking.
//!
//! This module provides a [`CallSiteCollector`] visitor that traverses a CST and
//! collects call sites with detailed argument information.
//!
//! # What is Collected?
//!
//! - Function calls: `foo()`, `foo(1, 2)`
//! - Method calls: `obj.method()`, `obj.method(x, y=1)`
//! - Constructor calls: `MyClass()`, `MyClass(arg)`
//! - Arguments with keyword names and spans
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, CallSiteCollector, CallSiteInfo, CallArgInfo};
//!
//! let source = "foo(1, key=2)";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);
//! for call in &calls {
//!     println!("Call to {} with {} args", call.callee, call.args.len());
//! }
//! ```

use super::attribute_access::{extract_receiver_path, ReceiverPath};
use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{Arg, Attribute, Call, ClassDef, Expression, FunctionDef, Module, Span};

/// Information about a call argument.
#[derive(Debug, Clone)]
pub struct CallArgInfo {
    /// Argument name for keyword args, None for positional.
    pub name: Option<String>,
    /// Byte span of the argument expression (the value part).
    pub span: Option<Span>,
    /// Byte span of the keyword name (for keyword arguments only).
    /// This is the span of just the keyword name in `key=value`, which is needed
    /// for rename-param operations to rename keyword argument names at call sites.
    pub keyword_name_span: Option<Span>,
}

impl CallArgInfo {
    /// Create a new positional argument.
    pub fn positional(span: Option<Span>) -> Self {
        Self {
            name: None,
            span,
            keyword_name_span: None,
        }
    }

    /// Create a new keyword argument.
    pub fn keyword(
        name: String,
        value_span: Option<Span>,
        keyword_name_span: Option<Span>,
    ) -> Self {
        Self {
            name: Some(name),
            span: value_span,
            keyword_name_span,
        }
    }
}

/// Information about a call site.
#[derive(Debug, Clone)]
pub struct CallSiteInfo {
    /// The callee expression as a string (function/method name).
    pub callee: String,
    /// Whether this is a method call (has a receiver).
    pub is_method_call: bool,
    /// Receiver name for method calls (e.g., "obj" in "obj.method()").
    ///
    /// This is a simple string representation for display and debugging.
    /// For resolution, use `receiver_path` when available.
    pub receiver: Option<String>,
    /// Byte span of the entire call expression.
    pub span: Option<Span>,
    /// Call arguments.
    pub args: Vec<CallArgInfo>,
    /// Scope path where the call occurs.
    pub scope_path: Vec<String>,
    /// Structured receiver path for method calls (e.g., `obj.method()` or `factory().create()`).
    ///
    /// This is `Some` for method calls where the receiver can be represented as steps
    /// (names, attributes, calls). It is `None` for simple function calls without a receiver,
    /// or for unsupported patterns like subscripts or complex expressions.
    pub receiver_path: Option<ReceiverPath>,
}

impl CallSiteInfo {
    /// Create a new function call.
    fn function_call(callee: String, scope_path: Vec<String>) -> Self {
        Self {
            callee,
            is_method_call: false,
            receiver: None,
            span: None,
            args: Vec::new(),
            scope_path,
            receiver_path: None,
        }
    }

    /// Create a new method call.
    fn method_call(
        receiver: String,
        method: String,
        scope_path: Vec<String>,
        receiver_path: Option<ReceiverPath>,
    ) -> Self {
        Self {
            callee: method,
            is_method_call: true,
            receiver: Some(receiver),
            span: None,
            args: Vec::new(),
            scope_path,
            receiver_path,
        }
    }

    /// Set the span for this call site.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }

    /// Add arguments to this call site.
    fn with_args(mut self, args: Vec<CallArgInfo>) -> Self {
        self.args = args;
        self
    }
}

/// A visitor that collects call site information from a Python CST.
///
/// CallSiteCollector traverses the CST and identifies call sites with
/// detailed argument information (positional vs keyword, spans).
pub struct CallSiteCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected call sites.
    calls: Vec<CallSiteInfo>,
    /// Current scope path.
    scope_path: Vec<String>,
}

impl<'pos> Default for CallSiteCollector<'pos> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'pos> CallSiteCollector<'pos> {
    /// Create a new CallSiteCollector without position tracking.
    pub fn new() -> Self {
        Self {
            positions: None,
            calls: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Create a new CallSiteCollector with position tracking.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            calls: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Collect call sites from a parsed module with position information.
    pub fn collect(module: &Module<'_>, positions: &'pos PositionTable) -> Vec<CallSiteInfo> {
        let mut collector = CallSiteCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.calls
    }

    /// Get the collected call sites, consuming the collector.
    pub fn into_calls(self) -> Vec<CallSiteInfo> {
        self.calls
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Get the callee name from a function expression.
    fn get_callee_name(expr: &Expression<'_>) -> String {
        match expr {
            Expression::Name(name) => name.value.to_string(),
            Expression::Attribute(attr) => attr.attr.value.to_string(),
            _ => "<expr>".to_string(),
        }
    }

    /// Get the receiver name from an attribute expression.
    fn get_receiver_name(attr: &Attribute<'_>) -> String {
        match &*attr.value {
            Expression::Name(name) => name.value.to_string(),
            Expression::Attribute(inner_attr) => {
                let base = Self::get_receiver_name(inner_attr);
                format!("{}.{}", base, inner_attr.attr.value)
            }
            _ => "<expr>".to_string(),
        }
    }

    /// Collect argument info from a call's args.
    fn collect_args(&self, args: &[Arg<'_>]) -> Vec<CallArgInfo> {
        let mut result = Vec::new();

        for arg in args {
            // Get the argument name (if keyword) and span
            let name = arg.keyword.as_ref().map(|kw| kw.value.to_string());

            // Try to get the span of the value expression
            let value_span = self.get_expression_span(&arg.value);

            // For keyword arguments, get the span of the keyword name
            // This is essential for rename-param to rename `key` in `func(key=value)`
            let keyword_name_span = arg
                .keyword
                .as_ref()
                .and_then(|kw| self.lookup_span(kw.node_id));

            result.push(CallArgInfo {
                name,
                span: value_span,
                keyword_name_span,
            });
        }

        result
    }

    /// Get the span for an expression node.
    fn get_expression_span(&self, expr: &Expression<'_>) -> Option<Span> {
        match expr {
            Expression::Name(name) => self.lookup_span(name.node_id),
            Expression::Integer(int) => self.lookup_span(int.node_id),
            Expression::Float(f) => self.lookup_span(f.node_id),
            Expression::SimpleString(s) => self.lookup_span(s.node_id),
            Expression::Attribute(attr) => self.lookup_span(attr.attr.node_id),
            // For complex expressions, we can't easily get the span
            // A more complete implementation would track expression spans
            _ => None,
        }
    }
}

impl<'a, 'pos> Visitor<'a> for CallSiteCollector<'pos> {
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
        // Determine if this is a method call or function call
        let info = match node.func.as_ref() {
            Expression::Attribute(attr) => {
                // Method call: obj.method()
                let receiver = Self::get_receiver_name(attr);
                let method = attr.attr.value.to_string();

                // Extract structured receiver path from the receiver expression.
                // For `obj.method()`, we extract from `attr.value` (which is `obj`).
                // Note: The receiver_path does NOT include the method name itself;
                // it represents the receiver chain that the method is called on.
                let receiver_path = extract_receiver_path(&attr.value);

                CallSiteInfo::method_call(receiver, method, self.scope_path.clone(), receiver_path)
            }
            Expression::Name(name) => {
                // Function call: foo()
                CallSiteInfo::function_call(name.value.to_string(), self.scope_path.clone())
            }
            _ => {
                // Complex expression call: (lambda: x)(), etc.
                CallSiteInfo::function_call(
                    Self::get_callee_name(node.func.as_ref()),
                    self.scope_path.clone(),
                )
            }
        };

        // Collect arguments
        let args = self.collect_args(&node.args);

        // Get the span for the callee name
        let span = match node.func.as_ref() {
            Expression::Name(name) => self.lookup_span(name.node_id),
            Expression::Attribute(attr) => self.lookup_span(attr.attr.node_id),
            _ => None,
        };

        let call = info.with_span(span).with_args(args);
        self.calls.push(call);

        VisitResult::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_call_site_simple_function() {
        let source = "foo()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "foo");
        assert!(!calls[0].is_method_call);
        assert!(calls[0].receiver.is_none());
        assert!(calls[0].args.is_empty());
    }

    #[test]
    fn test_call_site_with_positional_args() {
        let source = "foo(1, 2, 3)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "foo");
        assert_eq!(calls[0].args.len(), 3);
        assert!(calls[0].args.iter().all(|a| a.name.is_none()));
    }

    #[test]
    fn test_call_site_with_keyword_args() {
        let source = "foo(x=1, y=2)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].args.len(), 2);
        assert_eq!(calls[0].args[0].name, Some("x".to_string()));
        assert_eq!(calls[0].args[1].name, Some("y".to_string()));
    }

    #[test]
    fn test_call_site_mixed_args() {
        let source = "foo(1, key=2)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].args.len(), 2);
        assert!(calls[0].args[0].name.is_none()); // positional
        assert_eq!(calls[0].args[1].name, Some("key".to_string())); // keyword
    }

    #[test]
    fn test_call_site_method_call() {
        let source = "obj.method()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "method");
        assert!(calls[0].is_method_call);
        assert_eq!(calls[0].receiver, Some("obj".to_string()));
    }

    #[test]
    fn test_call_site_method_call_with_args() {
        let source = "obj.method(1, x=2)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "method");
        assert!(calls[0].is_method_call);
        assert_eq!(calls[0].args.len(), 2);
    }

    #[test]
    fn test_call_site_chained_method() {
        let source = "obj.a.b()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "b");
        assert!(calls[0].is_method_call);
        assert_eq!(calls[0].receiver, Some("obj.a".to_string()));
    }

    #[test]
    fn test_call_site_constructor() {
        let source = "MyClass(arg)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "MyClass");
        assert!(!calls[0].is_method_call);
        assert_eq!(calls[0].args.len(), 1);
    }

    #[test]
    fn test_call_site_multiple() {
        let source = r#"
foo()
bar(1)
obj.method(x=2)
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0].callee, "foo");
        assert_eq!(calls[1].callee, "bar");
        assert_eq!(calls[2].callee, "method");
    }

    #[test]
    fn test_call_site_in_function() {
        let source = r#"
def process():
    foo()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "foo");
        assert_eq!(calls[0].scope_path, vec!["<module>", "process"]);
    }

    #[test]
    fn test_call_site_in_class() {
        let source = r#"
class MyClass:
    def method(self):
        self.helper()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "helper");
        assert!(calls[0].is_method_call);
        assert_eq!(calls[0].receiver, Some("self".to_string()));
        assert_eq!(calls[0].scope_path, vec!["<module>", "MyClass", "method"]);
    }

    #[test]
    fn test_call_site_nested_calls() {
        let source = "foo(bar())";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        // Both calls should be collected
        assert_eq!(calls.len(), 2);
        let callees: Vec<_> = calls.iter().map(|c| c.callee.as_str()).collect();
        assert!(callees.contains(&"foo"));
        assert!(callees.contains(&"bar"));
    }

    #[test]
    fn test_call_site_span() {
        let source = "foo()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert!(calls[0].span.is_some());
        let span = calls[0].span.unwrap();
        // "foo" is at position 0-3
        assert_eq!(span.start, 0);
        assert_eq!(span.end, 3);
    }

    #[test]
    fn test_call_site_self_method() {
        let source = "self.process()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].callee, "process");
        assert!(calls[0].is_method_call);
        assert_eq!(calls[0].receiver, Some("self".to_string()));
    }

    #[test]
    fn test_call_site_arg_spans() {
        let source = "foo(x)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let calls = CallSiteCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].args.len(), 1);
        // The span should cover the variable name
        assert!(calls[0].args[0].span.is_some());
        let span = calls[0].args[0].span.unwrap();
        // "x" is at position 4
        assert_eq!(span.start, 4);
        assert_eq!(span.end, 5);
    }
}
