// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! InheritanceCollector visitor for Python class inheritance hierarchy extraction.
//!
//! This module provides an [`InheritanceCollector`] visitor that traverses a CST and
//! collects class definitions with their base classes for building inheritance hierarchies.
//!
//! # What is Collected?
//!
//! - **Class definitions**: `class Foo:`, `class Foo(Bar):`, `class Foo(Bar, Baz):`
//! - **Base classes**: Direct parent classes for each class
//! - **Generic subscripts**: `class Foo(Generic[T]):`, `class Foo(List[T]):`
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module, InheritanceCollector, ClassInheritanceInfo};
//!
//! let source = "class Child(Parent):\n    pass";
//! let module = parse_module(source, None)?;
//!
//! let classes = InheritanceCollector::collect(&module, source);
//! for cls in &classes {
//!     println!("{} inherits from {:?}", cls.name, cls.bases);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::nodes::{Arg, ClassDef, Expression, Module, Span};

/// Information about a class and its inheritance hierarchy.
#[derive(Debug, Clone)]
pub struct ClassInheritanceInfo {
    /// The class name.
    pub name: String,
    /// List of base class names (direct parents only).
    pub bases: Vec<String>,
    /// Scope path where the class is defined.
    pub scope_path: Vec<String>,
    /// Byte span of the class name.
    pub span: Option<Span>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Column number (1-indexed).
    pub col: Option<u32>,
}

impl ClassInheritanceInfo {
    /// Create a new ClassInheritanceInfo.
    fn new(name: String, bases: Vec<String>, scope_path: Vec<String>) -> Self {
        Self {
            name,
            bases,
            scope_path,
            span: None,
            line: None,
            col: None,
        }
    }

    /// Set the span for this class.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }
}

/// A visitor that collects class inheritance information from a Python CST.
///
/// InheritanceCollector traverses the CST and identifies all class definitions
/// with their base classes. This enables building the inheritance hierarchy
/// for method override tracking during rename operations.
///
/// # Example
///
/// ```ignore
/// let classes = InheritanceCollector::collect(&module, source);
/// ```
pub struct InheritanceCollector<'src> {
    /// The original source text (for span calculation).
    source: &'src str,
    /// Collected class inheritance information.
    classes: Vec<ClassInheritanceInfo>,
    /// Current scope path.
    scope_path: Vec<String>,
    /// Current search cursor position in the source.
    cursor: usize,
}

impl<'src> InheritanceCollector<'src> {
    /// Create a new InheritanceCollector.
    pub fn new(source: &'src str) -> Self {
        Self {
            source,
            classes: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            cursor: 0,
        }
    }

    /// Collect class inheritance information from a parsed module.
    ///
    /// Returns the list of classes with their inheritance information.
    pub fn collect(module: &Module<'_>, source: &'src str) -> Vec<ClassInheritanceInfo> {
        let mut collector = InheritanceCollector::new(source);
        walk_module(&mut collector, module);
        collector.classes
    }

    /// Get the collected class info, consuming the collector.
    pub fn into_classes(self) -> Vec<ClassInheritanceInfo> {
        self.classes
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

    /// Extract the base class name from an Arg (which represents a base class expression).
    fn extract_base_name(arg: &Arg<'_>) -> Option<String> {
        Self::expression_to_base_name(&arg.value)
    }

    /// Extract the base class name from an expression.
    /// Handles: Name, Attribute, Subscript (for Generic[T], etc.)
    fn expression_to_base_name(expr: &Expression<'_>) -> Option<String> {
        match expr {
            Expression::Name(name) => Some(name.value.to_string()),
            Expression::Attribute(attr) => {
                // module.ClassName - return the full dotted name
                let base = Self::expression_to_base_name(&attr.value)?;
                Some(format!("{}.{}", base, attr.attr.value))
            }
            Expression::Subscript(sub) => {
                // Generic[T], List[T], etc. - return the base type name
                Self::expression_to_base_name(&sub.value)
            }
            _ => None,
        }
    }
}

impl<'a, 'src> Visitor<'a> for InheritanceCollector<'src> {
    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        let class_name = node.name.value.to_string();

        // Extract base class names
        let bases: Vec<String> = node
            .bases
            .iter()
            .filter_map(|base| Self::extract_base_name(base))
            .collect();

        // Find the span for the class name
        let span = self.find_and_advance(&class_name);

        let info = ClassInheritanceInfo::new(class_name.clone(), bases, self.scope_path.clone())
            .with_span(span);
        self.classes.push(info);

        // Enter class scope for nested classes
        self.scope_path.push(class_name);

        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module;

    #[test]
    fn test_inheritance_no_bases() {
        let source = "class Foo:\n    pass";
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].name, "Foo");
        assert!(classes[0].bases.is_empty());
    }

    #[test]
    fn test_inheritance_single_base() {
        let source = "class Child(Parent):\n    pass";
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].name, "Child");
        assert_eq!(classes[0].bases, vec!["Parent"]);
    }

    #[test]
    fn test_inheritance_multiple_bases() {
        let source = "class Child(Parent1, Parent2, Parent3):\n    pass";
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].name, "Child");
        assert_eq!(classes[0].bases, vec!["Parent1", "Parent2", "Parent3"]);
    }

    #[test]
    fn test_inheritance_dotted_base() {
        let source = "class Child(module.Parent):\n    pass";
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].bases, vec!["module.Parent"]);
    }

    #[test]
    fn test_inheritance_generic_subscript() {
        let source = "class MyList(Generic[T]):\n    pass";
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].bases, vec!["Generic"]);
    }

    #[test]
    fn test_inheritance_list_subscript() {
        let source = "class IntList(List[int]):\n    pass";
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].bases, vec!["List"]);
    }

    #[test]
    fn test_inheritance_mixed_bases() {
        let source = "class Child(Parent, Generic[T], mixin.Mixin):\n    pass";
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].bases, vec!["Parent", "Generic", "mixin.Mixin"]);
    }

    #[test]
    fn test_inheritance_multiple_classes() {
        let source = r#"class Parent:
    pass

class Child(Parent):
    pass
"#;
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 2);

        let parent = classes.iter().find(|c| c.name == "Parent").unwrap();
        assert!(parent.bases.is_empty());

        let child = classes.iter().find(|c| c.name == "Child").unwrap();
        assert_eq!(child.bases, vec!["Parent"]);
    }

    #[test]
    fn test_inheritance_nested_class() {
        let source = r#"class Outer:
    class Inner(Base):
        pass
"#;
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 2);

        let outer = classes.iter().find(|c| c.name == "Outer").unwrap();
        assert_eq!(outer.scope_path, vec!["<module>"]);

        let inner = classes.iter().find(|c| c.name == "Inner").unwrap();
        assert_eq!(inner.scope_path, vec!["<module>", "Outer"]);
        assert_eq!(inner.bases, vec!["Base"]);
    }

    #[test]
    fn test_inheritance_has_span() {
        let source = "class Foo(Bar):\n    pass";
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert!(classes[0].span.is_some());
        let span = classes[0].span.unwrap();
        // "class Foo" - Foo starts at position 6
        assert_eq!(span.start, 6);
        assert_eq!(span.end, 9); // "Foo" is 3 characters
    }

    #[test]
    fn test_inheritance_handler_pattern() {
        // Real-world pattern for rename testing
        let source = r#"class BaseHandler:
    def process(self):
        pass

class JsonHandler(BaseHandler):
    def process(self):
        pass

class XmlHandler(BaseHandler):
    def process(self):
        pass
"#;
        let module = parse_module(source, None).unwrap();
        let classes = InheritanceCollector::collect(&module, source);

        assert_eq!(classes.len(), 3);

        let base = classes.iter().find(|c| c.name == "BaseHandler").unwrap();
        assert!(base.bases.is_empty());

        let json = classes.iter().find(|c| c.name == "JsonHandler").unwrap();
        assert_eq!(json.bases, vec!["BaseHandler"]);

        let xml = classes.iter().find(|c| c.name == "XmlHandler").unwrap();
        assert_eq!(xml.bases, vec!["BaseHandler"]);
    }
}
