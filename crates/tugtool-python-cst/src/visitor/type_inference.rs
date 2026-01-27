// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! TypeInferenceCollector visitor for Level 1 type inference.
//!
//! This module provides a [`TypeInferenceCollector`] visitor that traverses a CST and
//! collects assignment type information for Level 1 type inference.
//!
//! # What is Collected?
//!
//! Level 1 type inference collects assignments where we can infer the type:
//! - **Constructor calls**: `x = MyClass()` - infer `x` has type `MyClass`
//! - **Variable references**: `y = x` - track that `y` aliases `x`
//! - **Function calls**: `z = get_handler()` - track the callee for return type propagation
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, TypeInferenceCollector, AssignmentInfo};
//!
//! let source = "x = MyClass()\ny = x";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);
//! for assign in &assignments {
//!     if let Some(t) = &assign.inferred_type {
//!         println!("{} has type {}", assign.target, t);
//!     }
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{
    AnnAssign, Assign, AssignTargetExpression, Call, ClassDef, Expression, FunctionDef, Module,
    Span,
};

/// How the type was determined for an assignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TypeSource {
    /// Type inferred from constructor call: `x = MyClass()`.
    Constructor,
    /// Type copied from another variable: `y = x`.
    Variable,
    /// Type from function call (for return type propagation): `z = get_data()`.
    FunctionCall,
    /// Type could not be determined.
    Unknown,
}

impl TypeSource {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            TypeSource::Constructor => "constructor",
            TypeSource::Variable => "variable",
            TypeSource::FunctionCall => "function_call",
            TypeSource::Unknown => "unknown",
        }
    }
}

impl std::fmt::Display for TypeSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about an assignment for type inference.
#[derive(Debug, Clone)]
pub struct AssignmentInfo {
    /// Target variable name.
    pub target: String,
    /// Scope path where assignment occurs.
    pub scope_path: Vec<String>,
    /// How the type was determined.
    pub type_source: TypeSource,
    /// Inferred type name (if type_source is Constructor).
    pub inferred_type: Option<String>,
    /// RHS variable name (if type_source is Variable).
    pub rhs_name: Option<String>,
    /// Callee name (if type_source is FunctionCall).
    pub callee_name: Option<String>,
    /// Byte span of the target.
    pub span: Option<Span>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Column number (1-indexed).
    pub col: Option<u32>,
    /// True if this assignment targets `self.attr` or `cls.attr` (instance/class attribute).
    /// Default: false for backward compatibility.
    pub is_self_attribute: bool,
    /// Attribute name when is_self_attribute is true (e.g., "handler" for `self.handler = ...`).
    pub attribute_name: Option<String>,
}

impl AssignmentInfo {
    /// Create a new AssignmentInfo for a constructor call.
    fn new_constructor(target: String, class_name: String, scope_path: Vec<String>) -> Self {
        Self {
            target,
            scope_path,
            type_source: TypeSource::Constructor,
            inferred_type: Some(class_name),
            rhs_name: None,
            callee_name: None,
            span: None,
            line: None,
            col: None,
            is_self_attribute: false,
            attribute_name: None,
        }
    }

    /// Create a new AssignmentInfo for a variable reference.
    fn new_variable(target: String, rhs_name: String, scope_path: Vec<String>) -> Self {
        Self {
            target,
            scope_path,
            type_source: TypeSource::Variable,
            inferred_type: None,
            rhs_name: Some(rhs_name),
            callee_name: None,
            span: None,
            line: None,
            col: None,
            is_self_attribute: false,
            attribute_name: None,
        }
    }

    /// Create a new AssignmentInfo for a function call.
    fn new_function_call(target: String, callee_name: String, scope_path: Vec<String>) -> Self {
        Self {
            target,
            scope_path,
            type_source: TypeSource::FunctionCall,
            inferred_type: None,
            rhs_name: None,
            callee_name: Some(callee_name),
            span: None,
            line: None,
            col: None,
            is_self_attribute: false,
            attribute_name: None,
        }
    }

    /// Create a new AssignmentInfo with unknown type.
    fn new_unknown(target: String, scope_path: Vec<String>) -> Self {
        Self {
            target,
            scope_path,
            type_source: TypeSource::Unknown,
            inferred_type: None,
            rhs_name: None,
            callee_name: None,
            span: None,
            line: None,
            col: None,
            is_self_attribute: false,
            attribute_name: None,
        }
    }

    /// Set the span for this assignment.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }

    /// Mark this assignment as targeting a self/cls attribute.
    fn with_self_attribute(mut self, attribute_name: String) -> Self {
        self.is_self_attribute = true;
        self.attribute_name = Some(attribute_name);
        self
    }
}

/// A visitor that collects type inference information from assignments.
///
/// TypeInferenceCollector implements Level 1 type inference by tracking:
/// - Constructor calls: `x = MyClass()` → x has type MyClass
/// - Variable aliases: `y = x` → y has same type as x
/// - Function calls: `z = get_handler()` → track for return type propagation
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);
/// ```
pub struct TypeInferenceCollector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected assignments.
    assignments: Vec<AssignmentInfo>,
    /// Current scope path.
    scope_path: Vec<String>,
}

impl<'pos> Default for TypeInferenceCollector<'pos> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'pos> TypeInferenceCollector<'pos> {
    /// Create a new TypeInferenceCollector without position tracking.
    ///
    /// Assignments will be collected but spans will be None.
    pub fn new() -> Self {
        Self {
            positions: None,
            assignments: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Create a new TypeInferenceCollector with position tracking.
    ///
    /// Assignments will include spans from the PositionTable.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            assignments: Vec::new(),
            scope_path: vec!["<module>".to_string()],
        }
    }

    /// Collect type inference data from a parsed module with position information.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    pub fn collect(module: &Module<'_>, positions: &'pos PositionTable) -> Vec<AssignmentInfo> {
        let mut collector = TypeInferenceCollector::with_positions(positions);
        walk_module(&mut collector, module);
        collector.assignments
    }

    /// Get the collected assignments, consuming the collector.
    pub fn into_assignments(self) -> Vec<AssignmentInfo> {
        self.assignments
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Check if an expression is a constructor call (Name followed by Call).
    /// Returns the class name if it looks like a constructor.
    fn get_constructor_name(expr: &Expression<'_>) -> Option<String> {
        if let Expression::Call(call) = expr {
            Self::get_callee_name_for_constructor(call)
        } else {
            None
        }
    }

    /// Get the callee name from a call expression if it looks like a constructor.
    /// Constructors are calls to capitalized names (e.g., MyClass(), not my_function()).
    fn get_callee_name_for_constructor(call: &Call<'_>) -> Option<String> {
        match &*call.func {
            Expression::Name(name) => {
                let value = name.value;
                // Check if it starts with uppercase (convention for class names)
                if value.chars().next().is_some_and(|c| c.is_uppercase()) {
                    Some(value.to_string())
                } else {
                    None
                }
            }
            Expression::Attribute(attr) => {
                // module.ClassName() - check if the attribute is capitalized
                let attr_name = attr.attr.value;
                if attr_name.chars().next().is_some_and(|c| c.is_uppercase()) {
                    Some(attr_name.to_string())
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// Get the callee name from any call expression (for function call tracking).
    fn get_callee_name(call: &Call<'_>) -> Option<String> {
        match &*call.func {
            Expression::Name(name) => Some(name.value.to_string()),
            Expression::Attribute(attr) => Some(attr.attr.value.to_string()),
            _ => None,
        }
    }

    /// Check if an expression is a simple name reference.
    fn get_variable_name(expr: &Expression<'_>) -> Option<String> {
        if let Expression::Name(name) = expr {
            Some(name.value.to_string())
        } else {
            None
        }
    }

    /// Check if an expression is `self` or `cls` (instance or class reference).
    fn is_self_or_cls(expr: &Expression<'_>) -> bool {
        if let Expression::Name(name) = expr {
            name.value == "self" || name.value == "cls"
        } else {
            false
        }
    }

    /// Process an assignment and determine type information.
    ///
    /// # Arguments
    /// * `target` - The target name (variable name or "self"/"cls" for attribute targets)
    /// * `value` - The RHS expression
    /// * `node_id` - Optional node ID for span lookup
    /// * `self_attr_name` - If Some, this is a `self.attr = ...` pattern; contains the attribute name
    fn process_assignment(
        &mut self,
        target: &str,
        value: &Expression<'_>,
        node_id: Option<NodeId>,
        self_attr_name: Option<&str>,
    ) {
        // Look up span from the PositionTable using the node_id
        let span = self.lookup_span(node_id);

        // Check for constructor call: x = MyClass()
        if let Some(class_name) = Self::get_constructor_name(value) {
            let mut info = AssignmentInfo::new_constructor(
                target.to_string(),
                class_name,
                self.scope_path.clone(),
            )
            .with_span(span);
            if let Some(attr_name) = self_attr_name {
                info = info.with_self_attribute(attr_name.to_string());
            }
            self.assignments.push(info);
            return;
        }

        // Check for variable reference: y = x
        if let Some(rhs_name) = Self::get_variable_name(value) {
            let mut info =
                AssignmentInfo::new_variable(target.to_string(), rhs_name, self.scope_path.clone())
                    .with_span(span);
            if let Some(attr_name) = self_attr_name {
                info = info.with_self_attribute(attr_name.to_string());
            }
            self.assignments.push(info);
            return;
        }

        // Check for function call: z = get_handler()
        if let Expression::Call(call) = value {
            if let Some(callee_name) = Self::get_callee_name(call) {
                let mut info = AssignmentInfo::new_function_call(
                    target.to_string(),
                    callee_name,
                    self.scope_path.clone(),
                )
                .with_span(span);
                if let Some(attr_name) = self_attr_name {
                    info = info.with_self_attribute(attr_name.to_string());
                }
                self.assignments.push(info);
                return;
            }
        }

        // Unknown type source
        let mut info = AssignmentInfo::new_unknown(target.to_string(), self.scope_path.clone())
            .with_span(span);
        if let Some(attr_name) = self_attr_name {
            info = info.with_self_attribute(attr_name.to_string());
        }
        self.assignments.push(info);
    }
}

impl<'a, 'pos> Visitor<'a> for TypeInferenceCollector<'pos> {
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

    fn visit_assign(&mut self, node: &Assign<'a>) -> VisitResult {
        // Process each target in the assignment
        for target in &node.targets {
            match &target.target {
                // Handle simple name targets: x = ...
                AssignTargetExpression::Name(name) => {
                    self.process_assignment(name.value, &node.value, name.node_id, None);
                }
                // Handle attribute targets: self.attr = ... or cls.attr = ...
                AssignTargetExpression::Attribute(attr) => {
                    if Self::is_self_or_cls(&attr.value) {
                        let attr_name = attr.attr.value;
                        self.process_assignment(
                            "self", // Use "self" as the target name
                            &node.value,
                            attr.attr.node_id,
                            Some(attr_name),
                        );
                    }
                }
                _ => {}
            }
        }
        VisitResult::Continue
    }

    fn visit_ann_assign(&mut self, node: &AnnAssign<'a>) -> VisitResult {
        // Annotated assignments: target: annotation = value
        // We only process the assignment if there's a value
        if let Some(ref value) = node.value {
            match &node.target {
                // Handle simple name targets: x: Type = ...
                AssignTargetExpression::Name(name) => {
                    self.process_assignment(name.value, value, name.node_id, None);
                }
                // Handle attribute targets: self.attr: Type = ...
                AssignTargetExpression::Attribute(attr) => {
                    if Self::is_self_or_cls(&attr.value) {
                        let attr_name = attr.attr.value;
                        self.process_assignment("self", value, attr.attr.node_id, Some(attr_name));
                    }
                }
                _ => {}
            }
        }
        VisitResult::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_type_inference_constructor() {
        let source = "x = MyClass()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].target, "x");
        assert_eq!(assignments[0].type_source, TypeSource::Constructor);
        assert_eq!(assignments[0].inferred_type, Some("MyClass".to_string()));
    }

    #[test]
    fn test_type_inference_variable() {
        let source = "x = MyClass()\ny = x";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 2);

        assert_eq!(assignments[0].target, "x");
        assert_eq!(assignments[0].type_source, TypeSource::Constructor);

        assert_eq!(assignments[1].target, "y");
        assert_eq!(assignments[1].type_source, TypeSource::Variable);
        assert_eq!(assignments[1].rhs_name, Some("x".to_string()));
    }

    #[test]
    fn test_type_inference_function_call() {
        let source = "x = get_handler()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].target, "x");
        assert_eq!(assignments[0].type_source, TypeSource::FunctionCall);
        assert_eq!(assignments[0].callee_name, Some("get_handler".to_string()));
    }

    #[test]
    fn test_type_inference_module_constructor() {
        let source = "x = module.MyClass()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].target, "x");
        assert_eq!(assignments[0].type_source, TypeSource::Constructor);
        assert_eq!(assignments[0].inferred_type, Some("MyClass".to_string()));
    }

    #[test]
    fn test_type_inference_unknown() {
        let source = "x = 1 + 2";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].target, "x");
        assert_eq!(assignments[0].type_source, TypeSource::Unknown);
    }

    #[test]
    fn test_type_inference_scope_path() {
        let source = r#"class MyClass:
    def method(self):
        handler = Handler()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].target, "handler");
        assert_eq!(
            assignments[0].scope_path,
            vec!["<module>", "MyClass", "method"]
        );
    }

    #[test]
    fn test_type_inference_chained_assignment() {
        let source = "x = y = MyClass()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        // Both x and y should be tracked
        assert_eq!(assignments.len(), 2);
        let targets: Vec<_> = assignments.iter().map(|a| a.target.as_str()).collect();
        assert!(targets.contains(&"x"));
        assert!(targets.contains(&"y"));
    }

    #[test]
    fn test_type_inference_lowercase_not_constructor() {
        // Lowercase function names are not treated as constructors
        let source = "x = my_class()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].type_source, TypeSource::FunctionCall);
        // Not Constructor because it's lowercase
        assert!(assignments[0].inferred_type.is_none());
    }

    #[test]
    fn test_type_inference_multiple_in_function() {
        let source = r#"def use_handlers():
    handler = MyHandler()
    processor = handler
    result = process()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 3);

        let handler = assignments.iter().find(|a| a.target == "handler").unwrap();
        assert_eq!(handler.type_source, TypeSource::Constructor);
        assert_eq!(handler.inferred_type, Some("MyHandler".to_string()));

        let processor = assignments
            .iter()
            .find(|a| a.target == "processor")
            .unwrap();
        assert_eq!(processor.type_source, TypeSource::Variable);
        assert_eq!(processor.rhs_name, Some("handler".to_string()));

        let result = assignments.iter().find(|a| a.target == "result").unwrap();
        assert_eq!(result.type_source, TypeSource::FunctionCall);
        assert_eq!(result.callee_name, Some("process".to_string()));
    }

    #[test]
    fn test_type_inference_has_span() {
        let source = "x = MyClass()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert!(assignments[0].span.is_some());
        let span = assignments[0].span.unwrap();
        assert_eq!(span.start, 0);
        assert_eq!(span.end, 1); // "x" is 1 character
    }

    // Self-attribute detection tests for Phase 11C Step 1a

    #[test]
    fn test_self_attr_constructor() {
        // Test: self.handler = Handler() sets is_self_attribute: true, attribute_name: Some("handler")
        let source = r#"class MyClass:
    def __init__(self):
        self.handler = Handler()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        let assign = &assignments[0];
        assert_eq!(assign.target, "self");
        assert!(assign.is_self_attribute);
        assert_eq!(assign.attribute_name, Some("handler".to_string()));
        assert_eq!(assign.type_source, TypeSource::Constructor);
        assert_eq!(assign.inferred_type, Some("Handler".to_string()));
        assert_eq!(
            assign.scope_path,
            vec!["<module>", "MyClass", "__init__"]
        );
    }

    #[test]
    fn test_self_attr_annotated() {
        // Test: self.handler: Handler = ... (annotated) also sets flags
        let source = r#"class MyClass:
    def __init__(self):
        self.handler: Handler = create_handler()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        let assign = &assignments[0];
        assert_eq!(assign.target, "self");
        assert!(assign.is_self_attribute);
        assert_eq!(assign.attribute_name, Some("handler".to_string()));
        // The RHS is a function call, so type_source should be FunctionCall
        assert_eq!(assign.type_source, TypeSource::FunctionCall);
        assert_eq!(assign.callee_name, Some("create_handler".to_string()));
    }

    #[test]
    fn test_other_attr_not_self() {
        // Test: other.attr = ... does NOT set is_self_attribute
        let source = r#"class MyClass:
    def method(self, other):
        other.attr = Handler()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        // other.attr should NOT be tracked as a self attribute
        assert_eq!(assignments.len(), 0);
    }

    #[test]
    fn test_self_attr_outside_init() {
        // Test: Assignment outside __init__ still detected (for annotation-based types)
        let source = r#"class MyClass:
    def method(self):
        self.data = SomeData()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        let assign = &assignments[0];
        assert!(assign.is_self_attribute);
        assert_eq!(assign.attribute_name, Some("data".to_string()));
        assert_eq!(assign.type_source, TypeSource::Constructor);
        assert_eq!(assign.inferred_type, Some("SomeData".to_string()));
        // Scope path shows it's not in __init__
        assert_eq!(
            assign.scope_path,
            vec!["<module>", "MyClass", "method"]
        );
    }

    #[test]
    fn test_cls_attr_in_classmethod() {
        // Test: cls.attr in classmethod also detected
        let source = r#"class MyClass:
    @classmethod
    def factory(cls):
        cls.instance = MyClass()
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        let assign = &assignments[0];
        assert!(assign.is_self_attribute);
        assert_eq!(assign.attribute_name, Some("instance".to_string()));
        assert_eq!(assign.type_source, TypeSource::Constructor);
        assert_eq!(assign.inferred_type, Some("MyClass".to_string()));
    }

    #[test]
    fn test_self_attr_variable_assignment() {
        // Test: self.data = other_var propagates variable info
        let source = r#"class MyClass:
    def __init__(self, handler):
        self.handler = handler
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        let assign = &assignments[0];
        assert!(assign.is_self_attribute);
        assert_eq!(assign.attribute_name, Some("handler".to_string()));
        assert_eq!(assign.type_source, TypeSource::Variable);
        assert_eq!(assign.rhs_name, Some("handler".to_string()));
    }

    #[test]
    fn test_regular_assignment_no_self_attr() {
        // Test: Regular assignment should NOT have is_self_attribute set
        let source = "x = Handler()";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let assignments = TypeInferenceCollector::collect(&parsed.module, &parsed.positions);

        assert_eq!(assignments.len(), 1);
        assert!(!assignments[0].is_self_attribute);
        assert_eq!(assignments[0].attribute_name, None);
    }
}
