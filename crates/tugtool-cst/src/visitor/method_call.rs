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
//! use tugtool_cst::{parse_module, MethodCallCollector, MethodCallInfo};
//!
//! let source = "handler = Handler()\nhandler.process()";
//! let module = parse_module(source, None)?;
//!
//! let calls = MethodCallCollector::collect(&module, source);
//! for call in &calls {
//!     println!("{}.{}()", call.receiver, call.method);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::nodes::{Attribute, Call, ClassDef, Expression, FunctionDef, Module, Span};

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
/// let calls = MethodCallCollector::collect(&module, source);
/// ```
pub struct MethodCallCollector<'src> {
    /// The original source text (for span calculation).
    source: &'src str,
    /// Collected method calls.
    calls: Vec<MethodCallInfo>,
    /// Current scope path.
    scope_path: Vec<String>,
    /// Current search cursor position in the source.
    cursor: usize,
}

impl<'src> MethodCallCollector<'src> {
    /// Create a new MethodCallCollector.
    pub fn new(source: &'src str) -> Self {
        Self {
            source,
            calls: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            cursor: 0,
        }
    }

    /// Collect method calls from a parsed module.
    ///
    /// Returns the list of method calls in the order they were encountered.
    pub fn collect(module: &Module<'_>, source: &'src str) -> Vec<MethodCallInfo> {
        let mut collector = MethodCallCollector::new(source);
        walk_module(&mut collector, module);
        collector.calls
    }

    /// Get the collected method calls, consuming the collector.
    pub fn into_calls(self) -> Vec<MethodCallInfo> {
        self.calls
    }

    /// Find a string in the source starting from the cursor, and advance cursor past it.
    fn find_and_advance(&mut self, needle: &str) -> Option<Span> {
        if needle.is_empty() {
            return None;
        }

        let search_area = &self.source[self.cursor..];
        if let Some(offset) = search_area.find(needle) {
            let start = (self.cursor + offset) as u64;
            let end = start + needle.len() as u64;
            self.cursor = self.cursor + offset + needle.len();
            Some(Span::new(start, end))
        } else {
            None
        }
    }

    /// Check if a call expression is a method call (obj.method()) and extract info.
    fn extract_method_call_info(call: &Call<'_>) -> Option<(String, String)> {
        // Check if the function is an attribute access (obj.method)
        if let Expression::Attribute(attr) = &*call.func {
            // Check if the receiver is a simple name
            if let Some(receiver) = Self::get_receiver_name(attr) {
                let method = attr.attr.value.to_string();
                return Some((receiver, method));
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

impl<'a, 'src> Visitor<'a> for MethodCallCollector<'src> {
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
        if let Some((receiver, method)) = Self::extract_method_call_info(node) {
            // Find the span for the method name
            let span = self.find_and_advance(&method);

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
    use crate::parse_module;

    #[test]
    fn test_method_call_simple() {
        let source = "obj.method()";
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "obj");
        assert_eq!(calls[0].method, "method");
    }

    #[test]
    fn test_method_call_with_args() {
        let source = "obj.method(1, 2, 3)";
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "obj");
        assert_eq!(calls[0].method, "method");
    }

    #[test]
    fn test_method_call_self() {
        let source = "self.process()";
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

        // Plain function calls are not method calls
        assert!(calls.is_empty());
    }

    #[test]
    fn test_constructor_call_not_collected() {
        let source = "obj = MyClass()";
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

        // Constructor calls are not method calls
        assert!(calls.is_empty());
    }

    #[test]
    fn test_chained_call_only_first() {
        // For chained calls, we only collect the first one where receiver is a simple name
        let source = "obj.method1().method2()";
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

        // Only obj.method1() is collected because method2()'s receiver is a call expression
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].receiver, "obj");
        assert_eq!(calls[0].method, "method1");
    }

    #[test]
    fn test_method_call_has_span() {
        let source = "obj.method()";
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

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
        let module = parse_module(source, None).unwrap();
        let calls = MethodCallCollector::collect(&module, source);

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
