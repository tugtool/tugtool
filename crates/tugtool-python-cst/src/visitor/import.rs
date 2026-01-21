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
//! let imports = ImportCollector::collect(&module, source);
//! for import in &imports {
//!     println!("{}: {:?}", import.module, import.kind);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::nodes::{Expression, Import, ImportFrom, ImportNames, Module, NameOrAttribute, Span};

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
}

impl ImportInfo {
    /// Create a new ImportInfo for a regular import.
    fn new_import(module: String, alias: Option<String>) -> Self {
        Self {
            kind: ImportKind::Import,
            module,
            alias,
            names: None,
            is_star: false,
            relative_level: 0,
            span: None,
            line: None,
        }
    }

    /// Create a new ImportInfo for a from import.
    fn new_from(module: String, names: Vec<ImportedName>, relative_level: usize) -> Self {
        Self {
            kind: ImportKind::From,
            module,
            alias: None,
            names: Some(names),
            is_star: false,
            relative_level,
            span: None,
            line: None,
        }
    }

    /// Create a new ImportInfo for a star import.
    fn new_star(module: String, relative_level: usize) -> Self {
        Self {
            kind: ImportKind::From,
            module,
            alias: None,
            names: None,
            is_star: true,
            relative_level,
            span: None,
            line: None,
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
/// # Example
///
/// ```ignore
/// let imports = ImportCollector::collect(&module, source);
/// ```
pub struct ImportCollector {
    /// Collected imports.
    imports: Vec<ImportInfo>,
}

impl Default for ImportCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl ImportCollector {
    /// Create a new ImportCollector.
    pub fn new() -> Self {
        Self {
            imports: Vec::new(),
        }
    }

    /// Collect imports from a parsed module.
    ///
    /// Returns the list of imports in the order they were encountered.
    ///
    /// Note: The `source` parameter is kept for API compatibility but is no longer used.
    /// Span information is derived directly from token positions in the CST.
    pub fn collect(module: &Module<'_>, _source: &str) -> Vec<ImportInfo> {
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
    fn visit_import_stmt(&mut self, node: &Import<'a>) -> VisitResult {
        // Note: Import statement spans are not currently tracked via PositionTable.
        // The import_tok field is internal to the CST. For rename operations,
        // individual imported name spans would be needed, which requires tracking
        // each ImportAlias's Name node_id.
        let span: Option<Span> = None;

        // Process each name in the import
        for alias in &node.names {
            let module = Self::get_full_name(&alias.name);
            let import_alias = alias.asname.as_ref().and_then(|asname| {
                match &asname.name {
                    crate::nodes::AssignTargetExpression::Name(name) => {
                        Some(name.value.to_string())
                    }
                    _ => None,
                }
            });

            let import = ImportInfo::new_import(module, import_alias).with_span(span);
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
                let import = ImportInfo::new_star(module, relative_level).with_span(span);
                self.imports.push(import);
            }
            ImportNames::Aliases(aliases) => {
                let names: Vec<ImportedName> = aliases
                    .iter()
                    .map(|alias| {
                        let name = Self::get_full_name(&alias.name);
                        let import_alias = alias.asname.as_ref().and_then(|asname| {
                            match &asname.name {
                                crate::nodes::AssignTargetExpression::Name(n) => {
                                    Some(n.value.to_string())
                                }
                                _ => None,
                            }
                        });
                        ImportedName {
                            name,
                            alias: import_alias,
                        }
                    })
                    .collect();

                let import = ImportInfo::new_from(module, names, relative_level).with_span(span);
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
        let imports = ImportCollector::collect(&module, source);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].kind, ImportKind::Import);
        assert_eq!(imports[0].module, "os");
        assert!(imports[0].alias.is_none());
    }

    #[test]
    fn test_import_dotted() {
        let source = "import os.path.join";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module, source);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].module, "os.path.join");
    }

    #[test]
    fn test_import_as() {
        let source = "import numpy as np";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module, source);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].module, "numpy");
        assert_eq!(imports[0].alias, Some("np".to_string()));
    }

    #[test]
    fn test_import_multiple() {
        let source = "import os, sys, json";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module, source);

        assert_eq!(imports.len(), 3);
        assert_eq!(imports[0].module, "os");
        assert_eq!(imports[1].module, "sys");
        assert_eq!(imports[2].module, "json");
    }

    #[test]
    fn test_from_import_simple() {
        let source = "from os import path";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module, source);

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
        let imports = ImportCollector::collect(&module, source);

        assert_eq!(imports.len(), 1);
        let names = imports[0].names.as_ref().unwrap();
        assert_eq!(names[0].name, "path");
        assert_eq!(names[0].alias, Some("p".to_string()));
    }

    #[test]
    fn test_from_import_multiple() {
        let source = "from os import path, getcwd, listdir";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module, source);

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
        let imports = ImportCollector::collect(&module, source);

        assert_eq!(imports.len(), 1);
        assert!(imports[0].is_star);
        assert!(imports[0].names.is_none());
    }

    #[test]
    fn test_relative_import() {
        let source = "from . import utils";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module, source);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].relative_level, 1);
        assert!(imports[0].module.is_empty());
    }

    #[test]
    fn test_relative_import_with_module() {
        let source = "from ..utils import helper";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module, source);

        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].relative_level, 2);
        assert_eq!(imports[0].module, "utils");
    }

    #[test]
    fn test_multiple_imports() {
        let source = "import os\nfrom sys import path\nimport json as j";
        let module = parse_module(source, None).unwrap();
        let imports = ImportCollector::collect(&module, source);

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
        let imports = ImportCollector::collect(&module, source);

        assert!(imports[0].span.is_none());
    }
}
