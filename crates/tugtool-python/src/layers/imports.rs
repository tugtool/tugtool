// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Import manipulation layer for Python refactoring.
//!
//! This module provides types and utilities for manipulating Python import statements
//! during refactoring operations like Move Function, Move Class, and Move Module.

/// Classification of import groups for organization.
///
/// Python imports are conventionally organized into groups separated by blank lines:
/// 1. Future imports (`from __future__ import ...`)
/// 2. Standard library imports
/// 3. Third-party package imports
/// 4. Local/project imports
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ImportGroupKind {
    /// Future imports (`from __future__ import ...`)
    Future,
    /// Standard library imports
    Stdlib,
    /// Third-party package imports
    ThirdParty,
    /// Local/project imports
    Local,
}

/// Mode for import insertion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ImportInsertMode {
    /// Minimal diff mode: insert at the first reasonable location.
    /// This mode preserves existing organization and minimizes changes.
    #[default]
    Preserve,
    /// Full organization mode: sort imports into groups.
    /// This mode reorganizes imports according to PEP 8 conventions.
    Organize,
}

/// Error type for import manipulation operations.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ImportManipulationError {
    /// The import already exists in the file.
    #[error("import already exists: {0}")]
    AlreadyExists(String),
    /// The import was not found in the file.
    #[error("import not found: {0}")]
    NotFound(String),
    /// The import syntax is invalid.
    #[error("invalid import syntax: {0}")]
    InvalidSyntax(String),
    /// Unable to classify the import (unknown module).
    #[error("cannot classify import: {0}")]
    UnknownClassification(String),
    /// No suitable location was found for inserting the import.
    #[error("no suitable insertion point found")]
    NoInsertionPoint,
}

/// Result type for import manipulation operations.
pub type ImportManipulationResult<T> = Result<T, ImportManipulationError>;

/// A name imported via `from ... import`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedName {
    /// The imported name.
    pub name: String,
    /// Optional alias (`as ...`).
    pub alias: Option<String>,
}

impl ImportedName {
    /// Create a new imported name without an alias.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            alias: None,
        }
    }

    /// Create a new imported name with an alias.
    pub fn with_alias(name: impl Into<String>, alias: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            alias: Some(alias.into()),
        }
    }

    /// Render this imported name as it would appear in Python source.
    pub fn render(&self) -> String {
        match &self.alias {
            Some(alias) => format!("{} as {}", self.name, alias),
            None => self.name.clone(),
        }
    }
}

/// A Python import statement to insert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportStatement {
    /// A simple import statement: `import module` or `import module as alias`
    Import {
        /// The module to import.
        module: String,
        /// Optional alias for the module.
        alias: Option<String>,
    },
    /// A from-import statement: `from module import name1, name2`
    FromImport {
        /// The module to import from.
        module: String,
        /// The names to import from the module.
        names: Vec<ImportedName>,
    },
}

impl ImportStatement {
    /// Create a simple import statement: `import module`
    pub fn import(module: impl Into<String>) -> Self {
        Self::Import {
            module: module.into(),
            alias: None,
        }
    }

    /// Create a simple import statement with an alias: `import module as alias`
    pub fn import_as(module: impl Into<String>, alias: impl Into<String>) -> Self {
        Self::Import {
            module: module.into(),
            alias: Some(alias.into()),
        }
    }

    /// Create a from-import statement: `from module import name`
    pub fn from_import(module: impl Into<String>, name: impl Into<String>) -> Self {
        Self::FromImport {
            module: module.into(),
            names: vec![ImportedName::new(name)],
        }
    }

    /// Create a from-import statement with multiple names.
    pub fn from_import_names(module: impl Into<String>, names: Vec<ImportedName>) -> Self {
        Self::FromImport {
            module: module.into(),
            names,
        }
    }

    /// Render this import statement as it would appear in Python source.
    pub fn render(&self) -> String {
        match self {
            Self::Import { module, alias } => match alias {
                Some(a) => format!("import {} as {}", module, a),
                None => format!("import {}", module),
            },
            Self::FromImport { module, names } => {
                let names_str = names
                    .iter()
                    .map(|n| n.render())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("from {} import {}", module, names_str)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_statement_render_simple() {
        let stmt = ImportStatement::import("os");
        assert_eq!(stmt.render(), "import os");
    }

    #[test]
    fn test_import_statement_render_alias() {
        let stmt = ImportStatement::import_as("numpy", "np");
        assert_eq!(stmt.render(), "import numpy as np");
    }

    #[test]
    fn test_import_statement_render_from() {
        let stmt = ImportStatement::from_import("os", "path");
        assert_eq!(stmt.render(), "from os import path");
    }

    #[test]
    fn test_import_statement_render_from_alias() {
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![ImportedName::with_alias("path", "p")],
        );
        assert_eq!(stmt.render(), "from os import path as p");
    }

    #[test]
    fn test_import_statement_render_from_multiple() {
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![ImportedName::new("path"), ImportedName::new("getcwd")],
        );
        assert_eq!(stmt.render(), "from os import path, getcwd");
    }

    #[test]
    fn test_imported_name_simple() {
        let name = ImportedName::new("path");
        assert_eq!(name.render(), "path");
    }

    #[test]
    fn test_imported_name_with_alias() {
        let name = ImportedName::with_alias("path", "p");
        assert_eq!(name.render(), "path as p");
    }

    #[test]
    fn test_import_group_kind_ordering() {
        // ImportGroupKind should be ordered: Future < Stdlib < ThirdParty < Local
        assert!(ImportGroupKind::Future < ImportGroupKind::Stdlib);
        assert!(ImportGroupKind::Stdlib < ImportGroupKind::ThirdParty);
        assert!(ImportGroupKind::ThirdParty < ImportGroupKind::Local);
    }

    #[test]
    fn test_import_insert_mode_default() {
        let mode: ImportInsertMode = Default::default();
        assert_eq!(mode, ImportInsertMode::Preserve);
    }

    #[test]
    fn test_import_manipulation_error_display() {
        let err = ImportManipulationError::AlreadyExists("os".to_string());
        assert_eq!(err.to_string(), "import already exists: os");

        let err = ImportManipulationError::NotFound("missing".to_string());
        assert_eq!(err.to_string(), "import not found: missing");

        let err = ImportManipulationError::InvalidSyntax("bad syntax".to_string());
        assert_eq!(err.to_string(), "invalid import syntax: bad syntax");

        let err = ImportManipulationError::UnknownClassification("unknown".to_string());
        assert_eq!(err.to_string(), "cannot classify import: unknown");

        let err = ImportManipulationError::NoInsertionPoint;
        assert_eq!(err.to_string(), "no suitable insertion point found");
    }
}
