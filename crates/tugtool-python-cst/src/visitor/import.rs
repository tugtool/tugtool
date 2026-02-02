// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! ImportCollector visitor for Python import statement extraction.
//!
//! This module provides an [`ImportCollector`] visitor that traverses a CST and
//! collects all import statements with their details (module, names, aliases).
//!
//! # What is Collected?
//!
//! - **import statements**: `import os`, `import os.path`
//! - **from imports**: `from os import path`, `from os import path as p`
//! - **star imports**: `from os import *`
//! - **relative imports**: `from . import foo`, `from ..utils import bar`
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module, ImportCollector, ImportInfo};
//!
//! let source = "import os\nfrom sys import path";
//! let module = parse_module(source, None)?;
//!
//! let imports = ImportCollector::collect(&module);
//! for import in &imports {
//!     println!("{}: {:?}", import.module, import.kind);
//! }
//! ```

use super::dispatch::{walk_expression, walk_module, walk_or_else, walk_suite};
use super::traits::{VisitResult, Visitor};
use crate::nodes::{
    ClassDef, Expression, FunctionDef, If, Import, ImportFrom, ImportNames, Module,
    NameOrAttribute, Span,
};

/// The kind of import statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ImportKind {
    /// Regular import (`import os`).
    Import,
    /// From import (`from os import path`).
    From,
}

impl ImportKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            ImportKind::Import => "import",
            ImportKind::From => "from",
        }
    }
}

impl std::fmt::Display for ImportKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// A single imported name within an import statement.
#[derive(Debug, Clone)]
pub struct ImportedName {
    /// The imported name.
    pub name: String,
    /// The alias if using `as` clause.
    pub alias: Option<String>,
}

/// Information about a single import statement in the Python source.
#[derive(Debug, Clone)]
pub struct ImportInfo {
    /// The kind of import.
    pub kind: ImportKind,
    /// The module being imported from (full dotted path).
    pub module: String,
    /// Alias for the whole module (for `import x as y`).
    pub alias: Option<String>,
    /// Individual names being imported (for from imports).
    pub names: Option<Vec<ImportedName>>,
    /// Whether this is a star import (`from x import *`).
    pub is_star: bool,
    /// Number of leading dots for relative imports.
    pub relative_level: usize,
    /// Source span for the import statement.
    pub span: Option<Span>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Scope path where this import is defined.
    /// For module-level imports: `["<module>"]`
    /// For function-level: `["<module>", "MyClass", "my_method"]`
    pub scope_path: Vec<String>,
    /// True if this import is inside an `if TYPE_CHECKING:` block.
    pub is_type_checking: bool,
}

impl ImportInfo {
    /// Create a new ImportInfo for a regular import.
    fn new_import(
        module: String,
        alias: Option<String>,
        scope_path: Vec<String>,
        is_type_checking: bool,
    ) -> Self {
        Self {
            kind: ImportKind::Import,
            module,
            alias,
            names: None,
            is_star: false,
            relative_level: 0,
            span: None,
            line: None,
            scope_path,
            is_type_checking,
        }
    }

    /// Create a new ImportInfo for a from import.
    fn new_from(
        module: String,
        names: Vec<ImportedName>,
        relative_level: usize,
        scope_path: Vec<String>,
        is_type_checking: bool,
    ) -> Self {
        Self {
            kind: ImportKind::From,
            module,
            alias: None,
            names: Some(names),
            is_star: false,
            relative_level,
            span: None,
            line: None,
            scope_path,
            is_type_checking,
        }
    }

    /// Create a new ImportInfo for a star import.
    fn new_star(
        module: String,
        relative_level: usize,
        scope_path: Vec<String>,
        is_type_checking: bool,
    ) -> Self {
        Self {
            kind: ImportKind::From,
            module,
            alias: None,
            names: None,
            is_star: true,
            relative_level,
            span: None,
            line: None,
            scope_path,
            is_type_checking,
        }
    }

    /// Set the span for this import.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }
}

/// A visitor that collects import information from a Python CST.
///
/// ImportCollector traverses the CST and identifies all import statements:
/// - `import x`, `import x.y.z`
/// - `import x as y`
/// - `from x import y`, `from x import y as z`
/// - `from x import *`
/// - `from . import x`, `from ..x import y`
///
/// # Scope Tracking
///
/// The collector tracks the scope path (class/function nesting) where each import
/// is defined. This enables proper scope-chain lookup for function-level imports.
///
/// # Example
///
/// ```ignore
/// let imports = ImportCollector::collect(&module);
/// for import in &imports {
///     println!("{}: {:?} at {:?}", import.module, import.kind, import.scope_path);
/// }
/// ```
pub struct ImportCollector {
    /// Collected imports.
    imports: Vec<ImportInfo>,
    /// Current scope path (class/function nesting).
    /// Initialized with `["<module>"]` for module-level imports.
    scope_path: Vec<String>,
    /// Depth of nested `if TYPE_CHECKING:` blocks.
    /// When > 0, imports are inside a TYPE_CHECKING block.
    type_checking_depth: usize,
}

impl Default for ImportCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl ImportCollector {
    /// Create a new ImportCollector.
    ///
    /// Initializes the scope path with `["<module>"]` to represent the module-level scope.
    pub fn new() -> Self {
        Self {
            imports: Vec::new(),
            scope_path: vec!["<module>".to_string()],
            type_checking_depth: 0,
        }
    }

    /// Check if the given expression is a TYPE_CHECKING condition.
    ///
    /// Matches:
    /// - `TYPE_CHECKING` (bare name)
    /// - `typing.TYPE_CHECKING`
    fn is_type_checking_condition(expr: &Expression<'_>) -> bool {
        match expr {
            Expression::Name(name) => name.value == "TYPE_CHECKING",
            Expression::Attribute(attr) => {
                // Check for `typing.TYPE_CHECKING`
                if attr.attr.value == "TYPE_CHECKING" {
                    if let Expression::Name(base) = &*attr.value {
                        return base.value == "typing";
                    }
                }
                false
            }
            _ => false,
        }
    }

    /// Returns true if currently inside a TYPE_CHECKING block.
    fn is_in_type_checking(&self) -> bool {
        self.type_checking_depth > 0
    }

    /// Collect imports from a parsed module.
    ///
    /// Returns the list of imports in the order they were encountered.
    pub fn collect(module: &Module<'_>) -> Vec<ImportInfo> {
        let mut collector = ImportCollector::new();
        walk_module(&mut collector, module);
        collector.imports
    }

    /// Get the collected imports, consuming the collector.
    pub fn into_imports(self) -> Vec<ImportInfo> {
        self.imports
    }

    /// Get the full dotted name from a NameOrAttribute.
    fn get_full_name(name_or_attr: &NameOrAttribute<'_>) -> String {
        match name_or_attr {
            NameOrAttribute::N(name) => name.value.to_string(),
            NameOrAttribute::A(attr) => {
                // Build the dotted name recursively
                let mut parts = Vec::new();
                Self::collect_attribute_parts(&attr.value, &mut parts);
                parts.push(attr.attr.value.to_string());
                parts.join(".")
            }
        }
    }

    /// Recursively collect parts of an attribute chain.
    fn collect_attribute_parts(expr: &Expression<'_>, parts: &mut Vec<String>) {
        match expr {
            Expression::Name(name) => {
                parts.push(name.value.to_string());
            }
            Expression::Attribute(attr) => {
                Self::collect_attribute_parts(&attr.value, parts);
                parts.push(attr.attr.value.to_string());
            }
            _ => {}
        }
    }
}

impl<'a> Visitor<'a> for ImportCollector {
    // Scope tracking: push class name on entry, pop on exit
    fn visit_class_def(&mut self, node: &ClassDef<'a>) -> VisitResult {
        self.scope_path.push(node.name.value.to_string());
        // Continue to let the walker descend into children
        VisitResult::Continue
    }

    fn leave_class_def(&mut self, _node: &ClassDef<'a>) {
        self.scope_path.pop();
    }

    // Scope tracking: push function name on entry, pop on exit
    fn visit_function_def(&mut self, node: &FunctionDef<'a>) -> VisitResult {
        self.scope_path.push(node.name.value.to_string());
        // Continue to let the walker descend into children
        VisitResult::Continue
    }

    fn leave_function_def(&mut self, _node: &FunctionDef<'a>) {
        self.scope_path.pop();
    }

    // TYPE_CHECKING block tracking: manually walk to ensure TYPE_CHECKING depth
    // is only active for the if-body, not the else branch
    fn visit_if_stmt(&mut self, node: &If<'a>) -> VisitResult {
        let is_type_checking_block = Self::is_type_checking_condition(&node.test);

        // Walk test expression (not inside TYPE_CHECKING scope)
        walk_expression(self, &node.test);

        // If this is a TYPE_CHECKING block, increment depth before walking body
        if is_type_checking_block {
            self.type_checking_depth += 1;
        }

        // Walk body (imports here are inside TYPE_CHECKING if applicable)
        walk_suite(self, &node.body);

        // Decrement depth before walking orelse (else/elif is NOT inside TYPE_CHECKING)
        if is_type_checking_block {
            self.type_checking_depth = self.type_checking_depth.saturating_sub(1);
        }

        // Walk orelse (elif or else) - NOT inside this TYPE_CHECKING block
        if let Some(orelse) = &node.orelse {
            walk_or_else(self, orelse);
        }

        // Skip automatic child traversal since we handled it manually
        VisitResult::SkipChildren
    }

    fn leave_if_stmt(&mut self, _node: &If<'a>) {
        // No-op: depth management is handled in visit_if_stmt
    }

    fn visit_import_stmt(&mut self, node: &Import<'a>) -> VisitResult {
        // Note: Import statement spans are not currently tracked via PositionTable.
        // The import_tok field is internal to the CST. For rename operations,
        // individual imported name spans would be needed, which requires tracking
        // each ImportAlias's Name node_id.
        let span: Option<Span> = None;

        // Process each name in the import
        for alias in &node.names {
            let module = Self::get_full_name(&alias.name);
            let import_alias = alias.asname.as_ref().and_then(|asname| match &asname.name {
                crate::nodes::AssignTargetExpression::Name(name) => Some(name.value.to_string()),
                _ => None,
            });

            let import = ImportInfo::new_import(
                module,
                import_alias,
                self.scope_path.clone(),
                self.is_in_type_checking(),
            )
            .with_span(span);
            self.imports.push(import);
        }

        VisitResult::SkipChildren
    }

    fn visit_import_from(&mut self, node: &ImportFrom<'a>) -> VisitResult {
        // Note: Import statement spans are not currently tracked via PositionTable.
        // The from_tok field is internal to the CST.
        let span: Option<Span> = None;

        // Get the module name (empty string for pure relative imports like `from . import x`)
        let module = node
            .module
            .as_ref()
            .map(|m| Self::get_full_name(m))
            .unwrap_or_default();

        // Count relative import level (number of dots)
        let relative_level = node.relative.len();

        match &node.names {
            ImportNames::Star(_) => {
                let import = ImportInfo::new_star(
                    module,
                    relative_level,
                    self.scope_path.clone(),
                    self.is_in_type_checking(),
                )
                .with_span(span);
                self.imports.push(import);
            }
            ImportNames::Aliases(aliases) => {
                let names: Vec<ImportedName> = aliases
                    .iter()
                    .map(|alias| {
                        let name = Self::get_full_name(&alias.name);
                        let import_alias =
                            alias.asname.as_ref().and_then(|asname| match &asname.name {
                                crate::nodes::AssignTargetExpression::Name(n) => {
                                    Some(n.value.to_string())
                                }
                                _ => None,
                            });
                        ImportedName {
                            name,
                            alias: import_alias,
                        }
                    })
                    .collect();

                let import = ImportInfo::new_from(
                    module,
                    names,
                    relative_level,
                    self.scope_path.clone(),
                    self.is_in_type_checking(),
                )
                .with_span(span);
                self.imports.push(import);
            }
        }

        VisitResult::SkipChildren
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module;

    #[test]
    fn test_import_simple() {
        let source = "import os";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].kind, ImportKind::Import);
        assert_eq!(imports[0].module, "os");
        assert!(imports[0].alias.is_none());
    }

    #[test]
    fn test_import_dotted() {
        let source = "import os.path.join";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].module, "os.path.join");
    }

    #[test]
    fn test_import_as() {
        let source = "import numpy as np";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].module, "numpy");
        assert_eq!(imports[0].alias, Some("np".to_string()));
    }

    #[test]
    fn test_import_multiple() {
        let source = "import os, sys, json";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 3);
        assert_eq!(imports[0].module, "os");
        assert_eq!(imports[1].module, "sys");
        assert_eq!(imports[2].module, "json");
    }

    #[test]
    fn test_from_import_simple() {
        let source = "from os import path";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].kind, ImportKind::From);
        assert_eq!(imports[0].module, "os");
        assert!(!imports[0].is_star);

        let names = imports[0].names.as_ref().unwrap();
        assert_eq!(names.len(), 1);
        assert_eq!(names[0].name, "path");
        assert!(names[0].alias.is_none());
    }

    #[test]
    fn test_from_import_as() {
        let source = "from os import path as p";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        let names = imports[0].names.as_ref().unwrap();
        assert_eq!(names[0].name, "path");
        assert_eq!(names[0].alias, Some("p".to_string()));
    }

    #[test]
    fn test_from_import_multiple() {
        let source = "from os import path, getcwd, listdir";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        let names = imports[0].names.as_ref().unwrap();
        assert_eq!(names.len(), 3);
        assert_eq!(names[0].name, "path");
        assert_eq!(names[1].name, "getcwd");
        assert_eq!(names[2].name, "listdir");
    }

    #[test]
    fn test_from_import_star() {
        let source = "from os import *";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert!(imports[0].is_star);
        assert!(imports[0].names.is_none());
    }

    #[test]
    fn test_relative_import() {
        let source = "from . import utils";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].relative_level, 1);
        assert!(imports[0].module.is_empty());
    }

    #[test]
    fn test_relative_import_with_module() {
        let source = "from ..utils import helper";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].relative_level, 2);
        assert_eq!(imports[0].module, "utils");
    }

    #[test]
    fn test_multiple_imports() {
        let source = "import os\nfrom sys import path\nimport json as j";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 3);
        assert_eq!(imports[0].kind, ImportKind::Import);
        assert_eq!(imports[0].module, "os");

        assert_eq!(imports[1].kind, ImportKind::From);
        assert_eq!(imports[1].module, "sys");

        assert_eq!(imports[2].kind, ImportKind::Import);
        assert_eq!(imports[2].module, "json");
        assert_eq!(imports[2].alias, Some("j".to_string()));
    }

    #[test]
    fn test_import_span_not_tracked() {
        // Import statement spans are not currently tracked via PositionTable.
        // This test documents the current behavior.
        let source = "import os";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert!(imports[0].span.is_none());
    }

    // =========================================================================
    // Scope Path Tracking Tests (Phase 11E)
    // =========================================================================

    #[test]
    fn test_module_level_import_scope_path() {
        // Module-level imports should have scope_path ["<module>"]
        let source = "import os";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].scope_path, vec!["<module>"]);
    }

    #[test]
    fn test_function_level_import_scope_path() {
        // Import inside a function should include the function name in scope_path
        let source = r#"
def process():
    from handler import Handler
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].scope_path, vec!["<module>", "process"]);
        assert_eq!(imports[0].module, "handler");
    }

    #[test]
    fn test_nested_function_import_scope_path() {
        // Import inside a nested function should have full scope chain
        let source = r#"
def outer():
    def inner():
        import json
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].scope_path, vec!["<module>", "outer", "inner"]);
    }

    #[test]
    fn test_class_method_import_scope_path() {
        // Import inside a class method should include class and method names
        let source = r#"
class MyClass:
    def method(self):
        from utils import helper
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].scope_path, vec!["<module>", "MyClass", "method"]);
    }

    #[test]
    fn test_class_level_import_scope_path() {
        // Import at class level (unusual but valid Python)
        let source = r#"
class MyClass:
    from typing import List
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].scope_path, vec!["<module>", "MyClass"]);
    }

    #[test]
    fn test_mixed_scope_imports() {
        // Multiple imports at different scope levels
        let source = r#"
import os

class Handler:
    from typing import Optional

    def process(self):
        from json import loads

def standalone():
    import sys
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 4);

        // Module-level: import os
        assert_eq!(imports[0].module, "os");
        assert_eq!(imports[0].scope_path, vec!["<module>"]);

        // Class-level: from typing import Optional
        assert_eq!(imports[1].module, "typing");
        assert_eq!(imports[1].scope_path, vec!["<module>", "Handler"]);

        // Method-level: from json import loads
        assert_eq!(imports[2].module, "json");
        assert_eq!(
            imports[2].scope_path,
            vec!["<module>", "Handler", "process"]
        );

        // Function-level: import sys
        assert_eq!(imports[3].module, "sys");
        assert_eq!(imports[3].scope_path, vec!["<module>", "standalone"]);
    }

    #[test]
    fn test_deeply_nested_import_scope_path() {
        // Import deep inside nested classes and functions
        let source = r#"
class Outer:
    class Inner:
        def method(self):
            def nested():
                from deep import module
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 1);
        assert_eq!(
            imports[0].scope_path,
            vec!["<module>", "Outer", "Inner", "method", "nested"]
        );
    }

    #[test]
    fn test_sibling_functions_import_scope_isolation() {
        // Imports in sibling functions should have independent scope paths
        let source = r#"
def func_a():
    import module_a

def func_b():
    import module_b
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 2);
        assert_eq!(imports[0].scope_path, vec!["<module>", "func_a"]);
        assert_eq!(imports[1].scope_path, vec!["<module>", "func_b"]);
    }

    // =========================================================================
    // TYPE_CHECKING Block Tests (Phase 13 Step 0.9 Phase G)
    // =========================================================================

    #[test]
    fn test_type_checking_import_detected() {
        // Import inside `if TYPE_CHECKING:` should be flagged
        let source = r#"
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from foo import Bar
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 2);
        // First import: from typing import TYPE_CHECKING (not inside TYPE_CHECKING)
        assert_eq!(imports[0].module, "typing");
        assert!(!imports[0].is_type_checking);
        // Second import: from foo import Bar (inside TYPE_CHECKING)
        assert_eq!(imports[1].module, "foo");
        assert!(imports[1].is_type_checking);
    }

    #[test]
    fn test_typing_type_checking_detected() {
        // Import inside `if typing.TYPE_CHECKING:` should be flagged
        let source = r#"
import typing

if typing.TYPE_CHECKING:
    from foo import Bar
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 2);
        // First import: import typing (not inside TYPE_CHECKING)
        assert_eq!(imports[0].module, "typing");
        assert!(!imports[0].is_type_checking);
        // Second import: from foo import Bar (inside TYPE_CHECKING)
        assert_eq!(imports[1].module, "foo");
        assert!(imports[1].is_type_checking);
    }

    #[test]
    fn test_regular_import_not_flagged() {
        // Normal imports should have is_type_checking=false
        let source = r#"
import os
from sys import path
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 2);
        assert!(!imports[0].is_type_checking);
        assert!(!imports[1].is_type_checking);
    }

    #[test]
    fn test_nested_type_checking() {
        // Nested if inside TYPE_CHECKING block - imports should still be flagged
        let source = r#"
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import sys
    if True:
        from foo import Bar
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 3);
        // First import: from typing import TYPE_CHECKING
        assert!(!imports[0].is_type_checking);
        // Second import: import sys (inside TYPE_CHECKING)
        assert!(imports[1].is_type_checking);
        // Third import: from foo import Bar (nested inside TYPE_CHECKING)
        assert!(imports[2].is_type_checking);
    }

    #[test]
    fn test_type_checking_with_else() {
        // Only the if branch should be flagged, not the else
        let source = r#"
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from type_stubs import Stub
else:
    from runtime import Impl
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 3);
        // First import: from typing import TYPE_CHECKING
        assert!(!imports[0].is_type_checking);
        // Second import: from type_stubs import Stub (inside TYPE_CHECKING)
        assert!(imports[1].is_type_checking);
        // Third import: from runtime import Impl (inside else, NOT TYPE_CHECKING)
        assert!(!imports[2].is_type_checking);
    }

    #[test]
    fn test_multiple_type_checking_blocks() {
        // Multiple TYPE_CHECKING blocks should all be detected
        let source = r#"
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from foo import A

import os

if TYPE_CHECKING:
    from bar import B
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 4);
        assert!(!imports[0].is_type_checking); // from typing import TYPE_CHECKING
        assert!(imports[1].is_type_checking); // from foo import A
        assert!(!imports[2].is_type_checking); // import os
        assert!(imports[3].is_type_checking); // from bar import B
    }

    #[test]
    fn test_type_checking_star_import() {
        // Star imports inside TYPE_CHECKING should be flagged
        let source = r#"
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from foo import *
"#;
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module);

        assert_eq!(imports.len(), 2);
        assert!(!imports[0].is_type_checking);
        assert!(imports[1].is_type_checking);
        assert!(imports[1].is_star);
    }
}
