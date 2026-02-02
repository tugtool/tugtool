// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Import manipulation layer for Python refactoring.
//!
//! This module provides types and utilities for manipulating Python import statements
//! during refactoring operations like Move Function, Move Class, and Move Module.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::stdlib_modules::{is_stdlib_module, PythonVersion};

// TODO: Future enhancement (separate step):
// Load configuration from pyproject.toml [tool.tug.python.imports] section:
//
// [tool.tug.python]
// target-version = "3.11"
//
// [tool.tug.python.imports]
// src-paths = ["src", "."]
// known-first-party = ["myproject"]
// known-third-party = ["requests"]
// known-stdlib = []
//
// This would be implemented via a `ImportClassifierConfig::from_pyproject(path)`
// method in a future step.

/// Backport packages and their stdlib equivalents.
/// Maps (backport_name, stdlib_name, stdlib_since_version).
const BACKPORT_PACKAGES: &[(&str, &str, PythonVersion)] = &[
    ("dataclasses", "dataclasses", PythonVersion::new(3, 7)),
    ("tomli", "tomllib", PythonVersion::new(3, 11)),
    (
        "backports.zoneinfo",
        "zoneinfo",
        PythonVersion::new(3, 9),
    ),
    (
        "importlib_metadata",
        "importlib.metadata",
        PythonVersion::new(3, 8),
    ),
    (
        "importlib_resources",
        "importlib.resources",
        PythonVersion::new(3, 9),
    ),
];

/// Packages that are always third-party (never stdlib).
const ALWAYS_THIRD_PARTY: &[&str] = &["typing_extensions"];

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

/// Configuration for import classification.
#[derive(Debug, Clone)]
pub struct ImportClassifierConfig {
    /// Target Python version for stdlib classification.
    pub target_version: PythonVersion,

    /// Directories to search for first-party packages.
    /// Default: `["src", "."]`
    pub src_paths: Vec<PathBuf>,

    /// Packages explicitly marked as first-party (project-local).
    /// These take priority over filesystem detection.
    pub known_first_party: HashSet<String>,

    /// Packages explicitly marked as third-party.
    /// Useful for overriding misclassification.
    pub known_third_party: HashSet<String>,

    /// Packages explicitly marked as stdlib.
    /// Rarely needed, but available for edge cases.
    pub known_stdlib: HashSet<String>,

    /// Workspace root for filesystem checks.
    /// If None, filesystem-based first-party detection is disabled.
    pub workspace_root: Option<PathBuf>,
}

impl Default for ImportClassifierConfig {
    fn default() -> Self {
        Self {
            target_version: PythonVersion::DEFAULT,
            src_paths: vec![PathBuf::from("src"), PathBuf::from(".")],
            known_first_party: HashSet::new(),
            known_third_party: HashSet::new(),
            known_stdlib: HashSet::new(),
            workspace_root: None,
        }
    }
}

impl ImportClassifierConfig {
    /// Set the workspace root for filesystem-based first-party detection.
    pub fn with_workspace_root(mut self, root: impl Into<PathBuf>) -> Self {
        self.workspace_root = Some(root.into());
        self
    }

    /// Set the target Python version for stdlib classification.
    pub fn with_target_version(mut self, version: PythonVersion) -> Self {
        self.target_version = version;
        self
    }

    /// Add packages to the known first-party set.
    pub fn with_known_first_party(mut self, packages: impl IntoIterator<Item = String>) -> Self {
        self.known_first_party.extend(packages);
        self
    }

    /// Add packages to the known third-party set.
    pub fn with_known_third_party(mut self, packages: impl IntoIterator<Item = String>) -> Self {
        self.known_third_party.extend(packages);
        self
    }

    /// Add packages to the known stdlib set.
    pub fn with_known_stdlib(mut self, packages: impl IntoIterator<Item = String>) -> Self {
        self.known_stdlib.extend(packages);
        self
    }

    /// Set the source paths for first-party package detection.
    pub fn with_src_paths(mut self, paths: impl IntoIterator<Item = PathBuf>) -> Self {
        self.src_paths = paths.into_iter().collect();
        self
    }
}

/// Classifies Python imports into groups (future, stdlib, third-party, local).
#[derive(Debug, Clone)]
pub struct ImportClassifier {
    config: ImportClassifierConfig,
}

impl ImportClassifier {
    /// Create a new classifier with the given configuration.
    pub fn new(config: ImportClassifierConfig) -> Self {
        Self { config }
    }

    /// Create a classifier with default configuration.
    pub fn with_defaults() -> Self {
        Self::new(ImportClassifierConfig::default())
    }

    /// Get the classifier's configuration.
    pub fn config(&self) -> &ImportClassifierConfig {
        &self.config
    }

    /// Classify an import module path.
    pub fn classify(&self, module_path: &str) -> ImportGroupKind {
        // 1. Future imports (highest priority)
        if module_path == "__future__" {
            return ImportGroupKind::Future;
        }

        // 2. Relative imports are always local
        if module_path.starts_with('.') {
            return ImportGroupKind::Local;
        }

        let top_level = module_path.split('.').next().unwrap_or(module_path);

        // 3. Explicit overrides (after future/relative)
        if self.config.known_first_party.contains(top_level) {
            return ImportGroupKind::Local;
        }
        if self.config.known_third_party.contains(top_level) {
            return ImportGroupKind::ThirdParty;
        }
        if self.config.known_stdlib.contains(top_level) {
            return ImportGroupKind::Stdlib;
        }

        // 4. Always third-party packages
        if ALWAYS_THIRD_PARTY.contains(&top_level) {
            return ImportGroupKind::ThirdParty;
        }

        // 5. Backport-aware stdlib check
        if self.is_stdlib_for_version(top_level) {
            return ImportGroupKind::Stdlib;
        }

        // 6. Filesystem check for first-party
        if self.exists_in_src_paths(module_path) {
            return ImportGroupKind::Local;
        }

        // 7. Default to third-party
        ImportGroupKind::ThirdParty
    }

    /// Check if module is stdlib for the configured Python version.
    fn is_stdlib_for_version(&self, top_level: &str) -> bool {
        // Check if this is a backport that became stdlib
        for (backport, stdlib_name, since_version) in BACKPORT_PACKAGES {
            if top_level == *backport {
                // Backports are always third-party (even if stdlib equivalent exists)
                return false;
            }
            if top_level == stdlib_name.split('.').next().unwrap_or(stdlib_name) {
                // This is the stdlib module - check if available in target version
                return self.config.target_version >= *since_version;
            }
        }

        // Standard stdlib check
        is_stdlib_module(top_level, self.config.target_version)
    }

    /// Check if a module exists in any of the configured src_paths.
    fn exists_in_src_paths(&self, module_path: &str) -> bool {
        let workspace_root = match &self.config.workspace_root {
            Some(root) => root,
            None => return false, // No workspace, can't check filesystem
        };

        let top_level = module_path.split('.').next().unwrap_or(module_path);

        for src_path in &self.config.src_paths {
            let base = workspace_root.join(src_path);

            // Check for regular package: {src_path}/{module}/__init__.py
            let pkg_init = base.join(top_level).join("__init__.py");
            if pkg_init.exists() {
                return true;
            }

            // Check for namespace package (PEP 420): {src_path}/{module}/ with any .py files
            let pkg_dir = base.join(top_level);
            if pkg_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&pkg_dir) {
                    for entry in entries.flatten() {
                        if entry.path().extension().is_some_and(|e| e == "py") {
                            return true;
                        }
                    }
                }
            }

            // Check for module file: {src_path}/{module}.py
            let module_file = base.join(format!("{}.py", top_level));
            if module_file.exists() {
                return true;
            }
        }

        false
    }

    /// Classify import with same-package heuristic.
    ///
    /// If the import target is within the same package as the source file,
    /// it's classified as Local even without explicit configuration.
    pub fn classify_from_file(&self, module_path: &str, source_file: &Path) -> ImportGroupKind {
        // If relative, always local
        if module_path.starts_with('.') {
            return ImportGroupKind::Local;
        }

        // Check if source file is in a package that matches the import
        if let Some(workspace) = &self.config.workspace_root {
            if let Ok(rel_path) = source_file.strip_prefix(workspace) {
                let import_top = module_path.split('.').next().unwrap_or(module_path);
                // Check if file path contains the same top-level package
                for component in rel_path.components() {
                    if let std::path::Component::Normal(name) = component {
                        if name.to_string_lossy() == import_top {
                            return ImportGroupKind::Local;
                        }
                    }
                }
            }
        }

        // Fall back to standard classification
        self.classify(module_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // ============================================================================
    // ImportStatement tests (Phase A)
    // ============================================================================

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

    // ============================================================================
    // ImportClassifier tests (Phase C)
    // ============================================================================

    #[test]
    fn test_classify_future_import() {
        let classifier = ImportClassifier::with_defaults();
        assert_eq!(classifier.classify("__future__"), ImportGroupKind::Future);
    }

    #[test]
    fn test_classify_relative_import() {
        let classifier = ImportClassifier::with_defaults();
        assert_eq!(classifier.classify(".module"), ImportGroupKind::Local);
        assert_eq!(classifier.classify("..parent"), ImportGroupKind::Local);
        assert_eq!(classifier.classify("...grandparent"), ImportGroupKind::Local);
    }

    #[test]
    fn test_classify_explicit_first_party() {
        // known_first_party should override stdlib classification
        let config = ImportClassifierConfig::default()
            .with_known_first_party(vec!["os".to_string()]);
        let classifier = ImportClassifier::new(config);
        // os is normally stdlib, but we've marked it as first-party
        assert_eq!(classifier.classify("os"), ImportGroupKind::Local);
        assert_eq!(classifier.classify("os.path"), ImportGroupKind::Local);
    }

    #[test]
    fn test_classify_explicit_third_party() {
        let temp_dir = TempDir::new().unwrap();
        // Create a package that would be detected as first-party
        std::fs::create_dir_all(temp_dir.path().join("mypackage")).unwrap();
        std::fs::write(temp_dir.path().join("mypackage/__init__.py"), "").unwrap();

        // But mark it explicitly as third-party
        let config = ImportClassifierConfig::default()
            .with_workspace_root(temp_dir.path())
            .with_known_third_party(vec!["mypackage".to_string()]);
        let classifier = ImportClassifier::new(config);

        // Explicit third-party wins over filesystem detection
        assert_eq!(classifier.classify("mypackage"), ImportGroupKind::ThirdParty);
    }

    #[test]
    fn test_classify_explicit_stdlib() {
        // known_stdlib should override the default classification
        let config = ImportClassifierConfig::default()
            .with_known_stdlib(vec!["customstdlib".to_string()]);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("customstdlib"), ImportGroupKind::Stdlib);
    }

    #[test]
    fn test_classify_stdlib_os() {
        // os is stdlib on all versions
        for version in [
            PythonVersion::PY38,
            PythonVersion::PY39,
            PythonVersion::PY310,
            PythonVersion::PY311,
            PythonVersion::PY312,
            PythonVersion::PY313,
        ] {
            let config = ImportClassifierConfig::default().with_target_version(version);
            let classifier = ImportClassifier::new(config);
            assert_eq!(
                classifier.classify("os"),
                ImportGroupKind::Stdlib,
                "os should be stdlib on Python {:?}",
                version
            );
        }
    }

    #[test]
    fn test_classify_stdlib_sys() {
        // sys is stdlib on all versions
        for version in [
            PythonVersion::PY38,
            PythonVersion::PY39,
            PythonVersion::PY310,
            PythonVersion::PY311,
            PythonVersion::PY312,
            PythonVersion::PY313,
        ] {
            let config = ImportClassifierConfig::default().with_target_version(version);
            let classifier = ImportClassifier::new(config);
            assert_eq!(
                classifier.classify("sys"),
                ImportGroupKind::Stdlib,
                "sys should be stdlib on Python {:?}",
                version
            );
        }
    }

    #[test]
    fn test_classify_stdlib_submodule() {
        let classifier = ImportClassifier::with_defaults();
        // Submodules should be classified by their top-level package
        assert_eq!(classifier.classify("os.path"), ImportGroupKind::Stdlib);
        assert_eq!(classifier.classify("collections.abc"), ImportGroupKind::Stdlib);
        assert_eq!(classifier.classify("urllib.parse"), ImportGroupKind::Stdlib);
    }

    #[test]
    fn test_classify_tomllib_311() {
        // tomllib is stdlib on 3.11+
        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY311);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("tomllib"), ImportGroupKind::Stdlib);

        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY312);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("tomllib"), ImportGroupKind::Stdlib);

        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY313);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("tomllib"), ImportGroupKind::Stdlib);
    }

    #[test]
    fn test_classify_tomllib_310() {
        // tomllib doesn't exist in 3.10, so it would be third-party
        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY310);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("tomllib"), ImportGroupKind::ThirdParty);

        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY39);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("tomllib"), ImportGroupKind::ThirdParty);
    }

    #[test]
    fn test_classify_tomli_always_third_party() {
        // tomli (the backport) is always third-party, even on 3.11+
        for version in [
            PythonVersion::PY38,
            PythonVersion::PY39,
            PythonVersion::PY310,
            PythonVersion::PY311,
            PythonVersion::PY312,
            PythonVersion::PY313,
        ] {
            let config = ImportClassifierConfig::default().with_target_version(version);
            let classifier = ImportClassifier::new(config);
            assert_eq!(
                classifier.classify("tomli"),
                ImportGroupKind::ThirdParty,
                "tomli should be third-party on Python {:?}",
                version
            );
        }
    }

    #[test]
    fn test_classify_graphlib_39() {
        // graphlib is stdlib on 3.9+, third-party on 3.8
        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY38);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("graphlib"), ImportGroupKind::ThirdParty);

        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY39);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("graphlib"), ImportGroupKind::Stdlib);

        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY311);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("graphlib"), ImportGroupKind::Stdlib);
    }

    #[test]
    fn test_classify_distutils_312() {
        // distutils is stdlib on 3.11, removed (third-party) on 3.12+
        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY311);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("distutils"), ImportGroupKind::Stdlib);

        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY312);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("distutils"), ImportGroupKind::ThirdParty);

        let config = ImportClassifierConfig::default().with_target_version(PythonVersion::PY313);
        let classifier = ImportClassifier::new(config);
        assert_eq!(classifier.classify("distutils"), ImportGroupKind::ThirdParty);
    }

    #[test]
    fn test_classify_typing_extensions() {
        // typing_extensions is always third-party (never stdlib)
        for version in [
            PythonVersion::PY38,
            PythonVersion::PY39,
            PythonVersion::PY310,
            PythonVersion::PY311,
            PythonVersion::PY312,
            PythonVersion::PY313,
        ] {
            let config = ImportClassifierConfig::default().with_target_version(version);
            let classifier = ImportClassifier::new(config);
            assert_eq!(
                classifier.classify("typing_extensions"),
                ImportGroupKind::ThirdParty,
                "typing_extensions should be third-party on Python {:?}",
                version
            );
        }
    }

    #[test]
    fn test_classify_third_party_numpy() {
        let classifier = ImportClassifier::with_defaults();
        assert_eq!(classifier.classify("numpy"), ImportGroupKind::ThirdParty);
        assert_eq!(classifier.classify("numpy.linalg"), ImportGroupKind::ThirdParty);
    }

    #[test]
    fn test_classify_third_party_requests() {
        let classifier = ImportClassifier::with_defaults();
        assert_eq!(classifier.classify("requests"), ImportGroupKind::ThirdParty);
        assert_eq!(classifier.classify("requests.auth"), ImportGroupKind::ThirdParty);
    }

    #[test]
    fn test_classify_filesystem_regular_package() {
        // Create a temp directory with a regular package (has __init__.py)
        let temp_dir = TempDir::new().unwrap();
        std::fs::create_dir_all(temp_dir.path().join("mypackage")).unwrap();
        std::fs::write(temp_dir.path().join("mypackage/__init__.py"), "").unwrap();

        let config = ImportClassifierConfig::default().with_workspace_root(temp_dir.path());
        let classifier = ImportClassifier::new(config);

        assert_eq!(classifier.classify("mypackage"), ImportGroupKind::Local);
        assert_eq!(classifier.classify("mypackage.submodule"), ImportGroupKind::Local);
    }

    #[test]
    fn test_classify_filesystem_namespace_package() {
        // Create a temp directory with a namespace package (no __init__.py, but has .py files)
        let temp_dir = TempDir::new().unwrap();
        std::fs::create_dir_all(temp_dir.path().join("namespace_pkg")).unwrap();
        std::fs::write(temp_dir.path().join("namespace_pkg/module.py"), "").unwrap();

        let config = ImportClassifierConfig::default().with_workspace_root(temp_dir.path());
        let classifier = ImportClassifier::new(config);

        assert_eq!(classifier.classify("namespace_pkg"), ImportGroupKind::Local);
    }

    #[test]
    fn test_classify_filesystem_module_file() {
        // Create a temp directory with a module file
        let temp_dir = TempDir::new().unwrap();
        std::fs::write(temp_dir.path().join("mymodule.py"), "").unwrap();

        let config = ImportClassifierConfig::default().with_workspace_root(temp_dir.path());
        let classifier = ImportClassifier::new(config);

        assert_eq!(classifier.classify("mymodule"), ImportGroupKind::Local);
    }

    #[test]
    fn test_classify_filesystem_src_layout() {
        // Create a temp directory with src layout
        let temp_dir = TempDir::new().unwrap();
        std::fs::create_dir_all(temp_dir.path().join("src/myproject")).unwrap();
        std::fs::write(temp_dir.path().join("src/myproject/__init__.py"), "").unwrap();

        let config = ImportClassifierConfig::default().with_workspace_root(temp_dir.path());
        let classifier = ImportClassifier::new(config);

        assert_eq!(classifier.classify("myproject"), ImportGroupKind::Local);
    }

    #[test]
    fn test_classify_same_package_heuristic() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::create_dir_all(temp_dir.path().join("myproject/subpkg")).unwrap();
        std::fs::write(temp_dir.path().join("myproject/__init__.py"), "").unwrap();
        std::fs::write(temp_dir.path().join("myproject/main.py"), "").unwrap();
        std::fs::write(temp_dir.path().join("myproject/subpkg/__init__.py"), "").unwrap();

        let config = ImportClassifierConfig::default().with_workspace_root(temp_dir.path());
        let classifier = ImportClassifier::new(config);

        // When classifying from within myproject/main.py, import of myproject should be Local
        let source_file = temp_dir.path().join("myproject/main.py");
        assert_eq!(
            classifier.classify_from_file("myproject", &source_file),
            ImportGroupKind::Local
        );
        assert_eq!(
            classifier.classify_from_file("myproject.subpkg", &source_file),
            ImportGroupKind::Local
        );
    }

    #[test]
    fn test_classify_no_workspace_skips_filesystem() {
        // Without workspace_root, filesystem checks are skipped
        let config = ImportClassifierConfig::default();
        let classifier = ImportClassifier::new(config);

        // This would be first-party if filesystem checks worked, but without
        // workspace_root, it defaults to third-party
        assert_eq!(
            classifier.classify("unknown_package"),
            ImportGroupKind::ThirdParty
        );
    }

    #[test]
    fn test_classifier_with_temp_workspace() {
        // Full integration test with a realistic workspace structure
        let temp_dir = TempDir::new().unwrap();

        // Create workspace structure:
        // workspace/
        //   src/
        //     myproject/
        //       __init__.py
        //       core.py
        //       utils/
        //         __init__.py
        //   tests/
        //     test_core.py
        std::fs::create_dir_all(temp_dir.path().join("src/myproject/utils")).unwrap();
        std::fs::create_dir_all(temp_dir.path().join("tests")).unwrap();
        std::fs::write(temp_dir.path().join("src/myproject/__init__.py"), "").unwrap();
        std::fs::write(temp_dir.path().join("src/myproject/core.py"), "").unwrap();
        std::fs::write(temp_dir.path().join("src/myproject/utils/__init__.py"), "").unwrap();
        std::fs::write(temp_dir.path().join("tests/test_core.py"), "").unwrap();

        let config = ImportClassifierConfig::default()
            .with_workspace_root(temp_dir.path())
            .with_target_version(PythonVersion::PY311);
        let classifier = ImportClassifier::new(config);

        // Test various import classifications
        assert_eq!(classifier.classify("__future__"), ImportGroupKind::Future);
        assert_eq!(classifier.classify("os"), ImportGroupKind::Stdlib);
        assert_eq!(classifier.classify("sys"), ImportGroupKind::Stdlib);
        assert_eq!(classifier.classify("tomllib"), ImportGroupKind::Stdlib);
        assert_eq!(classifier.classify("numpy"), ImportGroupKind::ThirdParty);
        assert_eq!(classifier.classify("requests"), ImportGroupKind::ThirdParty);
        assert_eq!(classifier.classify("myproject"), ImportGroupKind::Local);
        assert_eq!(classifier.classify("myproject.core"), ImportGroupKind::Local);
        assert_eq!(classifier.classify("myproject.utils"), ImportGroupKind::Local);
        assert_eq!(classifier.classify(".relative"), ImportGroupKind::Local);
    }
}
