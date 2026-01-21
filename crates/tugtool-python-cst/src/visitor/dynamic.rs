// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! DynamicPatternDetector visitor for detecting dynamic attribute access patterns.
//!
//! This module provides a [`DynamicPatternDetector`] visitor that traverses a CST and
//! detects patterns that indicate dynamic attribute access, which may affect rename safety.
//!
//! # What is Detected?
//!
//! - **Dynamic attribute access**: `getattr(obj, 'name')`, `setattr(obj, 'name', value)`, `delattr(obj, 'name')`
//! - **Dynamic code execution**: `eval(...)`, `exec(...)`
//! - **Globals/locals subscript**: `globals()['name']`, `locals()['name']`
//! - **Magic method definitions**: `def __getattr__(self, name)`, `def __setattr__(self, name, value)`
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, DynamicPatternDetector, DynamicPatternInfo};
//!
//! let source = "x = getattr(obj, 'foo')";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);
//! for pattern in &patterns {
//!     println!("{:?}: {}", pattern.kind, pattern.description);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::traits::NodeId;
use crate::nodes::{Call, ClassDef, Expression, FunctionDef, Module, Span, Subscript};

/// The kind of dynamic pattern detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DynamicPatternKind {
    /// `getattr(obj, 'name')` call.
    Getattr,
    /// `setattr(obj, 'name', value)` call.
    Setattr,
    /// `delattr(obj, 'name')` call.
    Delattr,
    /// `hasattr(obj, 'name')` call.
    Hasattr,
    /// `eval(...)` call.
    Eval,
    /// `exec(...)` call.
    Exec,
    /// `globals()['name']` subscript access.
    GlobalsSubscript,
    /// `locals()['name']` subscript access.
    LocalsSubscript,
    /// `__getattr__` method definition.
    GetAttrMethod,
    /// `__setattr__` method definition.
    SetAttrMethod,
    /// `__delattr__` method definition.
    DelAttrMethod,
    /// `__getattribute__` method definition.
    GetAttributeMethod,
}

impl DynamicPatternKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            DynamicPatternKind::Getattr => "getattr",
            DynamicPatternKind::Setattr => "setattr",
            DynamicPatternKind::Delattr => "delattr",
            DynamicPatternKind::Hasattr => "hasattr",
            DynamicPatternKind::Eval => "eval",
            DynamicPatternKind::Exec => "exec",
            DynamicPatternKind::GlobalsSubscript => "globals_subscript",
            DynamicPatternKind::LocalsSubscript => "locals_subscript",
            DynamicPatternKind::GetAttrMethod => "__getattr__",
            DynamicPatternKind::SetAttrMethod => "__setattr__",
            DynamicPatternKind::DelAttrMethod => "__delattr__",
            DynamicPatternKind::GetAttributeMethod => "__getattribute__",
        }
    }

    /// Returns true if this pattern could affect attribute lookups.
    pub fn affects_attribute_lookup(&self) -> bool {
        matches!(
            self,
            DynamicPatternKind::Getattr
                | DynamicPatternKind::Setattr
                | DynamicPatternKind::Delattr
                | DynamicPatternKind::Hasattr
                | DynamicPatternKind::GetAttrMethod
                | DynamicPatternKind::SetAttrMethod
                | DynamicPatternKind::DelAttrMethod
                | DynamicPatternKind::GetAttributeMethod
        )
    }

    /// Returns true if this pattern involves dynamic code execution.
    pub fn is_code_execution(&self) -> bool {
        matches!(self, DynamicPatternKind::Eval | DynamicPatternKind::Exec)
    }

    /// Returns true if this pattern involves namespace manipulation.
    pub fn is_namespace_manipulation(&self) -> bool {
        matches!(
            self,
            DynamicPatternKind::GlobalsSubscript | DynamicPatternKind::LocalsSubscript
        )
    }
}

impl std::fmt::Display for DynamicPatternKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about a detected dynamic pattern.
#[derive(Debug, Clone)]
pub struct DynamicPatternInfo {
    /// The kind of dynamic pattern detected.
    pub kind: DynamicPatternKind,
    /// Human-readable description of the pattern.
    pub description: String,
    /// Scope path where the pattern occurs.
    pub scope_path: Vec<String>,
    /// Byte span of the pattern (for diagnostics).
    pub span: Option<Span>,
    /// The attribute name if statically known (e.g., from string literal in getattr).
    pub attribute_name: Option<String>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Column number (1-indexed).
    pub col: Option<u32>,
}

impl DynamicPatternInfo {
    /// Create a new DynamicPatternInfo.
    fn new(kind: DynamicPatternKind, description: String, scope_path: Vec<String>) -> Self {
        Self {
            kind,
            description,
            scope_path,
            span: None,
            attribute_name: None,
            line: None,
            col: None,
        }
    }

    /// Set the span for this pattern.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }

    /// Set the attribute name for this pattern.
    fn with_attribute_name(mut self, name: Option<String>) -> Self {
        self.attribute_name = name;
        self
    }
}

/// A visitor that detects dynamic attribute access patterns in a Python CST.
///
/// DynamicPatternDetector traverses the CST and identifies patterns that indicate
/// dynamic attribute access or code execution. These patterns may affect the safety
/// of rename operations.
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);
/// ```
pub struct DynamicPatternDetector<'pos> {
    /// Reference to position table for span lookups.
    positions: Option<&'pos PositionTable>,
    /// Collected dynamic patterns.
    patterns: Vec<DynamicPatternInfo>,
    /// Current scope path.
    scope_path: Vec<String>,
    /// Whether we're currently inside a class body (for detecting method definitions).
    in_class: bool,
}

impl<'pos> DynamicPatternDetector<'pos> {
    /// Create a new DynamicPatternDetector without position tracking.
    ///
    /// Patterns will be collected but spans will be None.
    pub fn new() -> Self {
        Self {
            positions: None,
            patterns: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            in_class: false,
        }
    }

    /// Create a new DynamicPatternDetector with position tracking.
    ///
    /// Patterns will include spans from the PositionTable.
    pub fn with_positions(positions: &'pos PositionTable) -> Self {
        Self {
            positions: Some(positions),
            patterns: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            in_class: false,
        }
    }

    /// Collect dynamic patterns from a parsed module with position information.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    pub fn collect(
        module: &Module<'_>,
        positions: &'pos PositionTable,
    ) -> Vec<DynamicPatternInfo> {
        let mut detector = DynamicPatternDetector::with_positions(positions);
        walk_module(&mut detector, module);
        detector.patterns
    }

    /// Get the collected patterns, consuming the detector.
    pub fn into_patterns(self) -> Vec<DynamicPatternInfo> {
        self.patterns
    }

    /// Look up the span for a node from the PositionTable.
    fn lookup_span(&self, node_id: Option<NodeId>) -> Option<Span> {
        let positions = self.positions?;
        let id = node_id?;
        positions.get(&id).and_then(|pos| pos.ident_span)
    }

    /// Check if a call is to one of the dynamic attribute functions (getattr, setattr, etc.).
    fn check_dynamic_attr_call(&mut self, call: &Call<'_>) {
        // Check if the function is a simple name
        if let Expression::Name(name) = &*call.func {
            let func_name = name.value;

            let kind = match func_name {
                "getattr" => Some(DynamicPatternKind::Getattr),
                "setattr" => Some(DynamicPatternKind::Setattr),
                "delattr" => Some(DynamicPatternKind::Delattr),
                "hasattr" => Some(DynamicPatternKind::Hasattr),
                "eval" => Some(DynamicPatternKind::Eval),
                "exec" => Some(DynamicPatternKind::Exec),
                _ => None,
            };

            if let Some(kind) = kind {
                // Look up span from the Name node's embedded node_id
                let span = self.lookup_span(name.node_id);

                // Try to extract the attribute name from the second argument if it's a string literal
                let attr_name = self.extract_attribute_name_from_call(call);

                let description = match kind {
                    DynamicPatternKind::Getattr => {
                        if let Some(ref attr) = attr_name {
                            format!("getattr() call with attribute '{}'", attr)
                        } else {
                            "getattr() call with dynamic attribute".to_string()
                        }
                    }
                    DynamicPatternKind::Setattr => {
                        if let Some(ref attr) = attr_name {
                            format!("setattr() call with attribute '{}'", attr)
                        } else {
                            "setattr() call with dynamic attribute".to_string()
                        }
                    }
                    DynamicPatternKind::Delattr => {
                        if let Some(ref attr) = attr_name {
                            format!("delattr() call with attribute '{}'", attr)
                        } else {
                            "delattr() call with dynamic attribute".to_string()
                        }
                    }
                    DynamicPatternKind::Hasattr => {
                        if let Some(ref attr) = attr_name {
                            format!("hasattr() call with attribute '{}'", attr)
                        } else {
                            "hasattr() call with dynamic attribute".to_string()
                        }
                    }
                    DynamicPatternKind::Eval => "eval() call - dynamic code execution".to_string(),
                    DynamicPatternKind::Exec => "exec() call - dynamic code execution".to_string(),
                    _ => format!("{} call", kind),
                };

                let info = DynamicPatternInfo::new(kind, description, self.scope_path.clone())
                    .with_span(span)
                    .with_attribute_name(attr_name);
                self.patterns.push(info);
            }
        }
    }

    /// Try to extract the attribute name from the second argument of a getattr/setattr/etc call.
    fn extract_attribute_name_from_call(&self, call: &Call<'_>) -> Option<String> {
        // getattr(obj, 'name') - the attribute name is the second positional argument
        if call.args.len() >= 2 {
            let second_arg = &call.args[1];
            if let Expression::SimpleString(s) = &second_arg.value {
                // Remove quotes from the string value
                let value = s.value;
                if (value.starts_with('"') && value.ends_with('"'))
                    || (value.starts_with('\'') && value.ends_with('\''))
                {
                    return Some(value[1..value.len() - 1].to_string());
                }
            }
        }
        None
    }

    /// Check if a subscript is accessing globals() or locals().
    fn check_globals_locals_subscript(&mut self, subscript: &Subscript<'_>) {
        // Check if the value is a call to globals() or locals()
        if let Expression::Call(call) = &*subscript.value {
            if let Expression::Name(name) = &*call.func {
                let func_name = name.value;

                let kind = match func_name {
                    "globals" => Some(DynamicPatternKind::GlobalsSubscript),
                    "locals" => Some(DynamicPatternKind::LocalsSubscript),
                    _ => None,
                };

                if let Some(kind) = kind {
                    // Look up span from the Name node's embedded node_id
                    let span = self.lookup_span(name.node_id);

                    let description = match kind {
                        DynamicPatternKind::GlobalsSubscript => {
                            "globals() subscript access".to_string()
                        }
                        DynamicPatternKind::LocalsSubscript => "locals() subscript access".to_string(),
                        _ => format!("{} access", kind),
                    };

                    let info = DynamicPatternInfo::new(kind, description, self.scope_path.clone())
                        .with_span(span);
                    self.patterns.push(info);
                }
            }
        }
    }

    /// Check if a function definition is a magic method that affects attribute access.
    fn check_magic_method(&mut self, func_def: &FunctionDef<'_>) {
        // Only check methods (functions defined inside a class)
        if !self.in_class {
            return;
        }

        let method_name = func_def.name.value;

        let kind = match method_name {
            "__getattr__" => Some(DynamicPatternKind::GetAttrMethod),
            "__setattr__" => Some(DynamicPatternKind::SetAttrMethod),
            "__delattr__" => Some(DynamicPatternKind::DelAttrMethod),
            "__getattribute__" => Some(DynamicPatternKind::GetAttributeMethod),
            _ => None,
        };

        if let Some(kind) = kind {
            // Look up span from the Name node's embedded node_id
            let span = self.lookup_span(func_def.name.node_id);

            let description = format!("{} method definition - custom attribute handling", method_name);

            let info = DynamicPatternInfo::new(kind, description, self.scope_path.clone())
                .with_span(span);
            self.patterns.push(info);
        }
    }
}

impl<'a, 'pos> Visitor<'a> for DynamicPatternDetector<'pos> {
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        // Check for magic methods before entering the scope
        self.check_magic_method(node);

        self.scope_path.push(node.name.value.to_string());
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.scope_path.pop();
    }

    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        self.scope_path.push(node.name.value.to_string());
        self.in_class = true;
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
        self.in_class = false;
    }

    fn visit_call(&mut self, node: &Call<'a>) -> VisitResult {
        self.check_dynamic_attr_call(node);
        VisitResult::Continue
    }

    fn visit_subscript(&mut self, node: &Subscript<'a>) -> VisitResult {
        self.check_globals_locals_subscript(node);
        VisitResult::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_detect_getattr() {
        let source = "x = getattr(obj, 'foo')";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::Getattr);
        assert_eq!(patterns[0].attribute_name, Some("foo".to_string()));
    }

    #[test]
    fn test_detect_getattr_dynamic() {
        let source = "x = getattr(obj, name)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::Getattr);
        assert_eq!(patterns[0].attribute_name, None);
    }

    #[test]
    fn test_detect_setattr() {
        let source = "setattr(obj, 'bar', value)";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::Setattr);
        assert_eq!(patterns[0].attribute_name, Some("bar".to_string()));
    }

    #[test]
    fn test_detect_delattr() {
        let source = "delattr(obj, 'baz')";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::Delattr);
        assert_eq!(patterns[0].attribute_name, Some("baz".to_string()));
    }

    #[test]
    fn test_detect_hasattr() {
        let source = "if hasattr(obj, 'method'): pass";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::Hasattr);
        assert_eq!(patterns[0].attribute_name, Some("method".to_string()));
    }

    #[test]
    fn test_detect_eval() {
        let source = "result = eval('1 + 2')";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::Eval);
        assert!(patterns[0].kind.is_code_execution());
    }

    #[test]
    fn test_detect_exec() {
        let source = "exec('x = 1')";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::Exec);
        assert!(patterns[0].kind.is_code_execution());
    }

    #[test]
    fn test_detect_globals_subscript() {
        let source = "x = globals()['foo']";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::GlobalsSubscript);
        assert!(patterns[0].kind.is_namespace_manipulation());
    }

    #[test]
    fn test_detect_locals_subscript() {
        let source = "x = locals()['bar']";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::LocalsSubscript);
        assert!(patterns[0].kind.is_namespace_manipulation());
    }

    #[test]
    fn test_detect_getattr_method() {
        let source = r#"class MyClass:
    def __getattr__(self, name):
        return None
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::GetAttrMethod);
        assert!(patterns[0].kind.affects_attribute_lookup());
    }

    #[test]
    fn test_detect_setattr_method() {
        let source = r#"class MyClass:
    def __setattr__(self, name, value):
        pass
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::SetAttrMethod);
    }

    #[test]
    fn test_detect_delattr_method() {
        let source = r#"class MyClass:
    def __delattr__(self, name):
        pass
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::DelAttrMethod);
    }

    #[test]
    fn test_detect_getattribute_method() {
        let source = r#"class MyClass:
    def __getattribute__(self, name):
        return super().__getattribute__(name)
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].kind, DynamicPatternKind::GetAttributeMethod);
    }

    #[test]
    fn test_magic_method_not_detected_outside_class() {
        // __getattr__ defined at module level is just a regular function
        let source = r#"def __getattr__(name):
    return None
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        // Should not be detected because it's not inside a class
        assert!(patterns.is_empty());
    }

    #[test]
    fn test_multiple_patterns() {
        let source = r#"class Proxy:
    def __getattr__(self, name):
        return getattr(self._target, name)

    def __setattr__(self, name, value):
        if name == '_target':
            super().__setattr__(name, value)
        else:
            setattr(self._target, name, value)
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        // Should detect: __getattr__, getattr, __setattr__, setattr
        assert_eq!(patterns.len(), 4);

        let kinds: Vec<_> = patterns.iter().map(|p| p.kind).collect();
        assert!(kinds.contains(&DynamicPatternKind::GetAttrMethod));
        assert!(kinds.contains(&DynamicPatternKind::Getattr));
        assert!(kinds.contains(&DynamicPatternKind::SetAttrMethod));
        assert!(kinds.contains(&DynamicPatternKind::Setattr));
    }

    #[test]
    fn test_scope_path_tracking() {
        let source = r#"class MyClass:
    def method(self):
        x = getattr(obj, 'foo')
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert_eq!(
            patterns[0].scope_path,
            vec!["<module>", "MyClass", "method"]
        );
    }

    #[test]
    fn test_pattern_has_span() {
        let source = "getattr(obj, 'foo')";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert_eq!(patterns.len(), 1);
        assert!(patterns[0].span.is_some());
        let span = patterns[0].span.unwrap();
        // "getattr" starts at position 0
        assert_eq!(span.start, 0);
        assert_eq!(span.end, 7); // "getattr" is 7 characters
    }

    #[test]
    fn test_no_false_positives() {
        // These should not be detected
        let source = r#"
# Normal function calls
print("hello")
len([1, 2, 3])

# Normal attribute access
obj.attr = value
x = obj.attr

# Normal subscript
data = items[0]
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        assert!(patterns.is_empty());
    }

    #[test]
    fn test_combined_patterns() {
        let source = r#"
# All the dynamic patterns in one file
x = getattr(obj, 'attr')
setattr(obj, 'attr', value)
delattr(obj, 'attr')
if hasattr(obj, 'attr'):
    pass

result = eval('1 + 2')
exec('x = 1')

g = globals()['name']
l = locals()['name']

class Dynamic:
    def __getattr__(self, name):
        pass
    def __setattr__(self, name, value):
        pass
    def __delattr__(self, name):
        pass
    def __getattribute__(self, name):
        pass
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let patterns = DynamicPatternDetector::collect(&parsed.module, &parsed.positions);

        // Should detect all patterns
        // getattr, setattr, delattr, hasattr, eval, exec, globals[], locals[]
        // __getattr__, __setattr__, __delattr__, __getattribute__
        assert_eq!(patterns.len(), 12);
    }
}
