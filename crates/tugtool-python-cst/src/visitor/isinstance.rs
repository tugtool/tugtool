// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! IsInstanceCollector visitor for detecting isinstance checks in conditional expressions.
//!
//! This module provides a [`IsInstanceCollector`] visitor that traverses a CST and
//! collects isinstance check patterns from if-statements for type narrowing.
//!
//! # What is Collected?
//!
//! - `isinstance(x, SomeClass)` - single type check
//! - `isinstance(x, (ClassA, ClassB))` - tuple of types (narrows to Union)
//!
//! # What is NOT Collected?
//!
//! - Attribute narrowing: `isinstance(self.field, SomeClass)`
//! - Negated checks: `not isinstance(x, SomeClass)`
//! - Compound conditions: `isinstance(x, A) and other_condition`
//! - Dynamic type arguments: `isinstance(x, type_var)`
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, IsInstanceCollector, IsInstanceCheck};
//!
//! let source = "if isinstance(x, Handler):\n    x.process()";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);
//! for check in &checks {
//!     println!("{} is narrowed to {:?} in branch", check.variable, check.checked_types);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::{Call, ClassDef, Element, Expression, FunctionDef, If, Module, Span};

/// Information about an isinstance check in a conditional expression.
///
/// This struct captures the variable being checked, the types it's being checked against,
/// and the span of the branch body where narrowing applies.
#[derive(Debug, Clone)]
pub struct IsInstanceCheck {
    /// The variable being checked.
    pub variable: String,
    /// The scope path where the check occurs.
    pub scope_path: Vec<String>,
    /// The type(s) being checked against.
    /// For single type: `["Handler"]`
    /// For tuple: `["Handler", "Worker"]` (narrows to `Union[Handler, Worker]`)
    pub checked_types: Vec<String>,
    /// Span of the isinstance call (for diagnostics).
    pub check_span: Option<Span>,
    /// Span of the if-branch body where narrowing applies.
    /// Narrowing is only active when the site span falls within this span.
    pub branch_span: Span,
}

impl IsInstanceCheck {
    /// Create a new IsInstanceCheck.
    fn new(
        variable: String,
        scope_path: Vec<String>,
        checked_types: Vec<String>,
        check_span: Option<Span>,
        branch_span: Span,
    ) -> Self {
        Self {
            variable,
            scope_path,
            checked_types,
            check_span,
            branch_span,
        }
    }
}

/// A visitor that collects isinstance checks from conditional expressions.
///
/// IsInstanceCollector detects `isinstance(var, Type)` patterns in if-statement
/// conditions and captures the narrowing information for use in type resolution.
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);
/// ```
pub struct IsInstanceCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected isinstance checks.
    checks: Vec<IsInstanceCheck>,
    /// Current scope path.
    scope_path: Vec<String>,
}

impl<'pos> Default for IsInstanceCollector<'pos> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'pos> IsInstanceCollector<'pos> {
    /// Create a new IsInstanceCollector without position tracking.
    pub fn new() -> Self {
        Self {
            positions: None,
            checks: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Create a new IsInstanceCollector with position tracking.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            checks: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Collect isinstance checks from a parsed module with position information.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    pub fn collect(module: &Module<'_>, positions: &'pos PositionTable) -> Vec<IsInstanceCheck> {
        let mut collector = IsInstanceCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.checks
    }

    /// Collect isinstance checks without position tracking.
    pub fn collect_without_positions(module: &Module<'_>) -> Vec<IsInstanceCheck> {
        let mut collector = IsInstanceCollector::new();
        walk_module(&mut collector, module);
        collector.checks
    }

    /// Get the collected checks, consuming the collector.
    pub fn into_checks(self) -> Vec<IsInstanceCheck> {
        self.checks
    }

    /// Look up the ident_span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<crate::nodes::traits::NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Get the branch span from the If node's position in the PositionTable.
    ///
    /// The branch span is computed during CST inflation (in DeflatedIf::inflate)
    /// and stored in the PositionTable. This is the proper way to get the span
    /// because token positions are only available during inflation, not after.
    fn get_branch_span_from_if(&self, if_node: &If<'_>) -> Span {
        if let Some(positions) = self.positions {
            if let Some(node_id) = if_node.node_id {
                if let Some(pos) = positions.get(&node_id) {
                    if let Some(span) = pos.branch_span {
                        return span;
                    }
                }
            }
        }
        // Fallback: empty span (narrowing won't apply)
        Span::new(0, 0)
    }

    /// Attempt to extract isinstance check info from an if-statement condition.
    ///
    /// Returns `Some(IsInstanceCheck)` if the condition is a simple `isinstance(var, Type)`
    /// or `isinstance(var, (A, B))` pattern. Returns `None` for unsupported patterns.
    fn extract_isinstance_check(
        &self,
        test: &Expression<'_>,
        if_node: &If<'_>,
    ) -> Option<IsInstanceCheck> {
        // The test must be a Call expression
        let call = match test {
            Expression::Call(call) => call,
            _ => return None,
        };

        // The callee must be a simple name "isinstance"
        if !Self::is_isinstance_call(call) {
            return None;
        }

        // isinstance takes exactly 2 arguments
        if call.args.len() != 2 {
            return None;
        }

        // First argument must be a simple name (not attribute access)
        let variable = Self::extract_simple_name(&call.args[0].value)?;

        // Second argument is either a single type or a tuple of types
        let checked_types = Self::extract_checked_types(&call.args[1].value)?;

        // Get span of the isinstance call - try to get from call's func node
        let check_span = self.get_call_span(call);

        // Get branch span via node_id lookup from the PositionTable
        let branch_span = self.get_branch_span_from_if(if_node);

        Some(IsInstanceCheck::new(
            variable,
            self.scope_path.clone(),
            checked_types,
            check_span,
            branch_span,
        ))
    }

    /// Get span for a call expression by looking up the func's Name node.
    fn get_call_span(&self, call: &Call<'_>) -> Option<Span> {
        if let Expression::Name(name) = &*call.func {
            self.lookup_span(name.node_id)
        } else {
            None
        }
    }

    /// Check if a call expression is `isinstance(...)`.
    fn is_isinstance_call(call: &Call<'_>) -> bool {
        match &*call.func {
            Expression::Name(name) => name.value == "isinstance",
            _ => false,
        }
    }

    /// Extract a simple variable name from an expression.
    /// Returns None for complex expressions (attributes, subscripts, etc.).
    fn extract_simple_name(expr: &Expression<'_>) -> Option<String> {
        match expr {
            Expression::Name(name) => Some(name.value.to_string()),
            _ => None,
        }
    }

    /// Extract checked types from the second isinstance argument.
    ///
    /// Handles:
    /// - Single type: `isinstance(x, Handler)` -> `["Handler"]`
    /// - Tuple of types: `isinstance(x, (A, B))` -> `["A", "B"]`
    fn extract_checked_types(expr: &Expression<'_>) -> Option<Vec<String>> {
        match expr {
            // Single type: isinstance(x, Handler)
            Expression::Name(name) => Some(vec![name.value.to_string()]),

            // Tuple of types: isinstance(x, (A, B))
            Expression::Tuple(tuple) => {
                let mut types = Vec::new();
                for element in &tuple.elements {
                    match element {
                        Element::Simple { value, .. } => {
                            if let Expression::Name(name) = value {
                                types.push(name.value.to_string());
                            } else {
                                // Non-name element in tuple - unsupported
                                return None;
                            }
                        }
                        Element::Starred(_) => {
                            // Starred elements not supported
                            return None;
                        }
                    }
                }
                if types.is_empty() {
                    None
                } else {
                    Some(types)
                }
            }

            // Attribute access: isinstance(x, module.Handler)
            // Not supported for now (would need to resolve the attribute)
            Expression::Attribute(_) => None,

            // All other expressions are unsupported
            _ => None,
        }
    }
}

impl<'a, 'pos> Visitor<'a> for IsInstanceCollector<'pos> {
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

    fn visit_if_stmt(&mut self, node: &If<'a>) -> VisitResult {
        // Try to extract isinstance check from the condition
        if let Some(check) = self.extract_isinstance_check(&node.test, node) {
            self.checks.push(check);
        }

        // Continue walking to handle nested if statements
        VisitResult::Continue
    }

    fn leave_if_stmt(&mut self, _node: &If<'a>) {
        // Nothing to do on leave
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_isinstance_single_type_detected() {
        let source = r#"def process(x):
    if isinstance(x, Handler):
        x.process()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(checks.len(), 1, "Should detect one isinstance check");
        let check = &checks[0];
        assert_eq!(check.variable, "x");
        assert_eq!(check.checked_types, vec!["Handler"]);
        assert_eq!(check.scope_path, vec!["<module>", "process"]);
    }

    #[test]
    fn test_isinstance_tuple_types_detected() {
        let source = r#"def handle(obj):
    if isinstance(obj, (Handler, Worker)):
        obj.process()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(checks.len(), 1, "Should detect one isinstance check");
        let check = &checks[0];
        assert_eq!(check.variable, "obj");
        assert_eq!(check.checked_types, vec!["Handler", "Worker"]);
    }

    #[test]
    fn test_isinstance_nested_elif_detected() {
        let source = r#"def handle(x):
    if isinstance(x, A):
        x.a_method()
    elif isinstance(x, B):
        x.b_method()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        // Both the if and elif should be detected
        assert_eq!(checks.len(), 2, "Should detect two isinstance checks");

        let check_a = checks.iter().find(|c| c.checked_types == vec!["A"]).unwrap();
        assert_eq!(check_a.variable, "x");

        let check_b = checks.iter().find(|c| c.checked_types == vec!["B"]).unwrap();
        assert_eq!(check_b.variable, "x");
    }

    #[test]
    fn test_non_isinstance_conditions_ignored() {
        let source = r#"def handle(x):
    if x is not None:
        x.process()
    if len(x) > 0:
        x.first()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(checks.len(), 0, "Should not detect non-isinstance conditions");
    }

    #[test]
    fn test_isinstance_complex_expressions_ignored() {
        let source = r#"def handle(obj):
    if isinstance(obj.field, Handler):
        obj.field.process()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        // Attribute access in first argument is not supported
        assert_eq!(checks.len(), 0, "Should not detect isinstance with attribute access");
    }

    #[test]
    fn test_isinstance_branch_span_multiline() {
        let source = r#"def process(x):
    if isinstance(x, Handler):
        x.process()
        x.finish()
    other()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(checks.len(), 1);
        let check = &checks[0];

        // Branch span should cover the indented body, not the whole file
        let branch_text = &source[check.branch_span.start..check.branch_span.end];

        // Should contain the body statements
        assert!(
            branch_text.contains("x.process()"),
            "branch should contain x.process(), got: {:?}",
            branch_text
        );
        assert!(
            branch_text.contains("x.finish()"),
            "branch should contain x.finish(), got: {:?}",
            branch_text
        );

        // Should NOT contain code outside the branch
        assert!(
            !branch_text.contains("other()"),
            "branch should NOT contain other(), got: {:?}",
            branch_text
        );
        assert!(
            !branch_text.contains("def process"),
            "branch should NOT contain def process, got: {:?}",
            branch_text
        );
    }

    #[test]
    fn test_isinstance_branch_span_single_line() {
        let source = "if isinstance(x, A): x.process()\n";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(checks.len(), 1);
        let check = &checks[0];

        let branch_text = &source[check.branch_span.start..check.branch_span.end];

        // Should contain just the single-line body
        assert!(
            branch_text.contains("x.process()"),
            "branch should contain x.process(), got: {:?}",
            branch_text
        );

        // Should NOT contain the condition
        assert!(
            !branch_text.contains("isinstance"),
            "branch should NOT contain isinstance, got: {:?}",
            branch_text
        );
    }

    #[test]
    fn test_isinstance_branch_span_with_elif() {
        let source = r#"def process(x):
    if isinstance(x, A):
        x.a_method()
    elif isinstance(x, B):
        x.b_method()
    else:
        x.default()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        // Should have two isinstance checks
        assert_eq!(checks.len(), 2);

        // First check's branch should only cover A's body
        let check_a = checks.iter().find(|c| c.checked_types == vec!["A"]).unwrap();
        let branch_a = &source[check_a.branch_span.start..check_a.branch_span.end];
        assert!(
            branch_a.contains("a_method"),
            "A's branch should contain a_method, got: {:?}",
            branch_a
        );
        assert!(
            !branch_a.contains("b_method"),
            "A's branch should NOT contain b_method, got: {:?}",
            branch_a
        );
        assert!(
            !branch_a.contains("default"),
            "A's branch should NOT contain default, got: {:?}",
            branch_a
        );

        // Second check's branch should only cover B's body
        let check_b = checks.iter().find(|c| c.checked_types == vec!["B"]).unwrap();
        let branch_b = &source[check_b.branch_span.start..check_b.branch_span.end];
        assert!(
            branch_b.contains("b_method"),
            "B's branch should contain b_method, got: {:?}",
            branch_b
        );
        assert!(
            !branch_b.contains("a_method"),
            "B's branch should NOT contain a_method, got: {:?}",
            branch_b
        );
        assert!(
            !branch_b.contains("default"),
            "B's branch should NOT contain default, got: {:?}",
            branch_b
        );
    }

    #[test]
    fn test_isinstance_branch_span_does_not_include_condition() {
        let source = r#"if isinstance(x, Handler):
    x.process()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(checks.len(), 1);
        let check = &checks[0];

        let branch_text = &source[check.branch_span.start..check.branch_span.end];

        // Should NOT contain the condition expression
        assert!(
            !branch_text.contains("isinstance"),
            "branch should NOT contain isinstance, got: {:?}",
            branch_text
        );
        assert!(
            !branch_text.contains("Handler"),
            "branch should NOT contain Handler (from condition), got: {:?}",
            branch_text
        );
    }

    #[test]
    fn test_isinstance_in_class_method() {
        let source = r#"class MyClass:
    def process(self, x):
        if isinstance(x, Handler):
            x.handle()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let checks = IsInstanceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(checks.len(), 1);
        let check = &checks[0];
        assert_eq!(check.scope_path, vec!["<module>", "MyClass", "process"]);
    }
}
