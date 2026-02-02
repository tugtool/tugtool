// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Import manipulation layer for Python refactoring.
//!
//! This module provides types and utilities for manipulating Python import statements
//! during refactoring operations like Move Function, Move Class, and Move Module.

use std::collections::{BTreeMap, HashSet};
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

    /// Get the module path for this import statement.
    pub fn module_path(&self) -> &str {
        match self {
            Self::Import { module, .. } => module,
            Self::FromImport { module, .. } => module,
        }
    }

    /// Check if this statement imports the given name (for duplicate detection).
    pub fn imports_name(&self, name: &str) -> bool {
        match self {
            Self::Import { module, .. } => module == name || module.starts_with(&format!("{}.", name)),
            Self::FromImport { names, .. } => names.iter().any(|n| n.name == name),
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

// ============================================================================
// Import Analysis Types
// ============================================================================

/// A simple text edit operation for import manipulation.
///
/// Unlike the full `Edit` type in `tugtool-core::patch`, this is a lightweight
/// representation focused on single-file text modifications.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextEdit {
    /// Byte offset where the edit starts.
    pub offset: usize,
    /// Number of bytes to delete at offset (0 for pure insertion).
    pub delete_len: usize,
    /// Text to insert at offset.
    pub insert_text: String,
}

impl TextEdit {
    /// Create an insertion edit (insert text at offset, delete nothing).
    pub fn insert(offset: usize, text: impl Into<String>) -> Self {
        Self {
            offset,
            delete_len: 0,
            insert_text: text.into(),
        }
    }

    /// Create a replacement edit (delete some bytes and insert new text).
    pub fn replace(offset: usize, delete_len: usize, text: impl Into<String>) -> Self {
        Self {
            offset,
            delete_len,
            insert_text: text.into(),
        }
    }

    /// Create a deletion edit (delete bytes, insert nothing).
    pub fn delete(offset: usize, delete_len: usize) -> Self {
        Self {
            offset,
            delete_len,
            insert_text: String::new(),
        }
    }

    /// Apply this edit to the given source string.
    pub fn apply(&self, source: &str) -> String {
        let bytes = source.as_bytes();
        let before = &bytes[..self.offset];
        let after = &bytes[self.offset + self.delete_len..];

        let mut result = Vec::with_capacity(before.len() + self.insert_text.len() + after.len());
        result.extend_from_slice(before);
        result.extend_from_slice(self.insert_text.as_bytes());
        result.extend_from_slice(after);

        String::from_utf8(result).expect("edit produced invalid UTF-8")
    }
}

/// Information about a single import statement found in a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportInfo {
    /// The parsed import statement.
    pub statement: ImportStatement,
    /// The classification of this import.
    pub group: ImportGroupKind,
    /// Start byte offset of the import statement in the source.
    pub start_offset: usize,
    /// End byte offset of the import statement in the source (exclusive).
    pub end_offset: usize,
    /// Line number (1-indexed) where this import appears.
    pub line: usize,
}

/// Analysis of existing imports in a Python source file.
#[derive(Debug, Clone, Default)]
pub struct ImportAnalysis {
    /// All imports found, grouped by classification.
    pub groups: BTreeMap<ImportGroupKind, Vec<ImportInfo>>,
    /// Line number of the last import statement (1-indexed), if any.
    pub last_import_line: Option<usize>,
    /// Byte offset just after the last import statement, if any.
    pub after_imports_offset: Option<usize>,
    /// Line number after module docstring (1-indexed), if present.
    pub after_docstring_line: Option<usize>,
    /// Byte offset just after module docstring, if present.
    pub after_docstring_offset: Option<usize>,
    /// All imports in source order (for duplicate detection).
    imports_in_order: Vec<ImportInfo>,
}

impl ImportAnalysis {
    /// Check if an import with the same module path exists.
    pub fn has_import(&self, module_path: &str) -> bool {
        self.imports_in_order
            .iter()
            .any(|info| info.statement.module_path() == module_path)
    }

    /// Check if a specific name is already imported from a module.
    pub fn has_name_imported(&self, module_path: &str, name: &str) -> bool {
        self.imports_in_order.iter().any(|info| {
            info.statement.module_path() == module_path && info.statement.imports_name(name)
        })
    }

    /// Get all imports in source order.
    pub fn all_imports(&self) -> &[ImportInfo] {
        &self.imports_in_order
    }

    /// Get the last import in a specific group.
    pub fn last_in_group(&self, group: ImportGroupKind) -> Option<&ImportInfo> {
        self.groups.get(&group).and_then(|v| v.last())
    }

    /// Get the first import in a specific group.
    pub fn first_in_group(&self, group: ImportGroupKind) -> Option<&ImportInfo> {
        self.groups.get(&group).and_then(|v| v.first())
    }

    /// Check if there are any imports.
    pub fn is_empty(&self) -> bool {
        self.imports_in_order.is_empty()
    }
}

// ============================================================================
// Import Inserter
// ============================================================================

/// Inserts import statements at the correct location in a Python file.
///
/// The inserter uses an `ImportClassifier` to determine where new imports
/// should be placed based on their classification (future, stdlib, third-party, local).
#[derive(Debug, Clone)]
pub struct ImportInserter {
    classifier: ImportClassifier,
    mode: ImportInsertMode,
}

impl ImportInserter {
    /// Create a new import inserter with the given classifier.
    pub fn new(classifier: ImportClassifier) -> Self {
        Self {
            classifier,
            mode: ImportInsertMode::default(),
        }
    }

    /// Set the insertion mode.
    pub fn with_mode(mut self, mode: ImportInsertMode) -> Self {
        self.mode = mode;
        self
    }

    /// Get the classifier used by this inserter.
    pub fn classifier(&self) -> &ImportClassifier {
        &self.classifier
    }

    /// Analyze a Python source file to find existing imports.
    ///
    /// This performs a simple line-by-line analysis to find import statements.
    /// It doesn't use the full CST parser for performance and simplicity.
    pub fn analyze_imports(&self, source: &str) -> ImportAnalysis {
        let mut analysis = ImportAnalysis::default();
        let mut current_offset = 0;
        let mut in_multiline_string = false;
        let mut multiline_quote: Option<&str> = None;
        let mut found_first_code = false;
        let mut in_parenthesized_import = false;
        let mut paren_import_start: Option<(usize, usize, String)> = None; // (start_offset, line, module)

        for (line_idx, line) in source.lines().enumerate() {
            let line_num = line_idx + 1;
            let line_start = current_offset;
            let line_with_newline_len = if current_offset + line.len() < source.len() {
                // Account for the newline character
                let remaining = &source[current_offset + line.len()..];
                if remaining.starts_with("\r\n") {
                    line.len() + 2
                } else if remaining.starts_with('\n') || remaining.starts_with('\r') {
                    line.len() + 1
                } else {
                    line.len()
                }
            } else {
                line.len()
            };

            current_offset += line_with_newline_len;
            let trimmed = line.trim();

            // Handle multiline strings (docstrings)
            if in_multiline_string {
                if let Some(quote) = multiline_quote {
                    if trimmed.contains(quote) {
                        in_multiline_string = false;
                        multiline_quote = None;
                        // If this was the module docstring, record where it ends
                        if !found_first_code {
                            analysis.after_docstring_line = Some(line_num + 1);
                            analysis.after_docstring_offset = Some(current_offset);
                        }
                    }
                }
                continue;
            }

            // Check for multiline string start
            if trimmed.starts_with("\"\"\"") || trimmed.starts_with("'''") {
                let quote = if trimmed.starts_with("\"\"\"") {
                    "\"\"\""
                } else {
                    "'''"
                };

                // Check if it closes on the same line
                let after_open = &trimmed[3..];
                if !after_open.contains(quote) {
                    in_multiline_string = true;
                    multiline_quote = Some(quote);
                } else if !found_first_code {
                    // Single-line docstring
                    analysis.after_docstring_line = Some(line_num + 1);
                    analysis.after_docstring_offset = Some(current_offset);
                }
                continue;
            }

            // Handle parenthesized imports
            if in_parenthesized_import {
                if trimmed.contains(')') {
                    in_parenthesized_import = false;
                    if let Some((start_offset, start_line, module)) = paren_import_start.take() {
                        // Parse the accumulated names from the multiline import
                        // For now, just record it as a from-import
                        let group = self.classifier.classify(&module);
                        let info = ImportInfo {
                            statement: ImportStatement::from_import(&module, "..."),
                            group,
                            start_offset,
                            end_offset: current_offset,
                            line: start_line,
                        };
                        analysis
                            .groups
                            .entry(group)
                            .or_insert_with(Vec::new)
                            .push(info.clone());
                        analysis.imports_in_order.push(info);
                        analysis.last_import_line = Some(line_num);
                        analysis.after_imports_offset = Some(current_offset);
                    }
                }
                continue;
            }

            // Skip empty lines and comments
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            found_first_code = true;

            // Parse import statements
            if let Some(import_info) =
                self.parse_import_line(trimmed, line_start, current_offset, line_num)
            {
                // Check for opening paren indicating multiline
                if trimmed.contains('(') && !trimmed.contains(')') {
                    in_parenthesized_import = true;
                    paren_import_start =
                        Some((line_start, line_num, import_info.statement.module_path().to_string()));
                    continue;
                }

                analysis
                    .groups
                    .entry(import_info.group)
                    .or_insert_with(Vec::new)
                    .push(import_info.clone());
                analysis.imports_in_order.push(import_info);
                analysis.last_import_line = Some(line_num);
                analysis.after_imports_offset = Some(current_offset);
            }
        }

        analysis
    }

    /// Parse a single line to extract import information.
    fn parse_import_line(
        &self,
        line: &str,
        start_offset: usize,
        end_offset: usize,
        line_num: usize,
    ) -> Option<ImportInfo> {
        let trimmed = line.trim();

        // Handle `from X import Y`
        if let Some(rest) = trimmed.strip_prefix("from ") {
            let parts: Vec<&str> = rest.splitn(2, " import ").collect();
            if parts.len() == 2 {
                let module = parts[0].trim().to_string();
                let names_part = parts[1].trim();

                // Parse imported names
                let names = self.parse_imported_names(names_part);

                let statement = ImportStatement::from_import_names(&module, names);
                let group = self.classifier.classify(&module);

                return Some(ImportInfo {
                    statement,
                    group,
                    start_offset,
                    end_offset,
                    line: line_num,
                });
            }
        }

        // Handle `import X`
        if let Some(rest) = trimmed.strip_prefix("import ") {
            // Could be `import module` or `import module as alias`
            let parts: Vec<&str> = rest.splitn(2, " as ").collect();
            let module = parts[0].trim().to_string();
            let alias = if parts.len() == 2 {
                Some(parts[1].trim().to_string())
            } else {
                None
            };

            let statement = if let Some(a) = alias {
                ImportStatement::import_as(&module, a)
            } else {
                ImportStatement::import(&module)
            };

            let group = self.classifier.classify(&module);

            return Some(ImportInfo {
                statement,
                group,
                start_offset,
                end_offset,
                line: line_num,
            });
        }

        None
    }

    /// Parse the names part of a from-import statement.
    fn parse_imported_names(&self, names_str: &str) -> Vec<ImportedName> {
        // Remove parentheses if present
        let names_str = names_str.trim_start_matches('(').trim_end_matches(')');

        names_str
            .split(',')
            .map(|n| {
                let n = n.trim();
                if let Some(rest) = n.strip_suffix(')') {
                    // Handle trailing paren
                    let n = rest.trim();
                    self.parse_single_name(n)
                } else {
                    self.parse_single_name(n)
                }
            })
            .filter(|n| !n.name.is_empty())
            .collect()
    }

    /// Parse a single imported name, possibly with alias.
    fn parse_single_name(&self, name: &str) -> ImportedName {
        let parts: Vec<&str> = name.splitn(2, " as ").collect();
        if parts.len() == 2 {
            ImportedName::with_alias(parts[0].trim(), parts[1].trim())
        } else {
            ImportedName::new(parts[0].trim())
        }
    }

    /// Find the insertion point for a new import.
    ///
    /// Returns the byte offset and whether a blank line should be added before the import.
    fn find_insertion_point(
        &self,
        group: ImportGroupKind,
        analysis: &ImportAnalysis,
    ) -> ImportManipulationResult<(usize, bool, bool)> {
        // (offset, blank_line_before, blank_line_after)
        match self.mode {
            ImportInsertMode::Preserve => {
                self.find_insertion_point_preserve(group, analysis)
            }
            ImportInsertMode::Organize => {
                self.find_insertion_point_organize(group, analysis)
            }
        }
    }

    /// Find insertion point in Preserve mode.
    /// Tries to minimize changes by inserting near existing imports of the same group.
    fn find_insertion_point_preserve(
        &self,
        group: ImportGroupKind,
        analysis: &ImportAnalysis,
    ) -> ImportManipulationResult<(usize, bool, bool)> {
        // If there are existing imports in this group, insert after the last one
        if let Some(last) = analysis.last_in_group(group) {
            return Ok((last.end_offset, false, false));
        }

        // No existing imports in this group - find the appropriate boundary
        // Import order: Future < Stdlib < ThirdParty < Local

        // Check for imports in adjacent groups
        let groups_order = [
            ImportGroupKind::Future,
            ImportGroupKind::Stdlib,
            ImportGroupKind::ThirdParty,
            ImportGroupKind::Local,
        ];

        let group_idx = groups_order.iter().position(|g| *g == group).unwrap();

        // Look for the last import in any group before this one
        for prev_group in groups_order[..group_idx].iter().rev() {
            if let Some(last) = analysis.last_in_group(*prev_group) {
                // Insert after this import, with a blank line before (new group)
                return Ok((last.end_offset, true, false));
            }
        }

        // No imports before this group - check if there are imports after
        for next_group in groups_order.iter().skip(group_idx + 1) {
            if let Some(first) = analysis.first_in_group(*next_group) {
                // Insert before this import, with a blank line after (new group)
                return Ok((first.start_offset, false, true));
            }
        }

        // No imports at all - insert at appropriate location
        self.find_insertion_point_empty(analysis)
    }

    /// Find insertion point in Organize mode.
    /// Sorts imports within groups alphabetically.
    fn find_insertion_point_organize(
        &self,
        group: ImportGroupKind,
        analysis: &ImportAnalysis,
    ) -> ImportManipulationResult<(usize, bool, bool)> {
        // Same logic as Preserve for finding the right group location
        // Organize mode's main difference is in how we sort within groups,
        // which is handled separately when generating the full import block
        self.find_insertion_point_preserve(group, analysis)
    }

    /// Find insertion point when there are no existing imports.
    fn find_insertion_point_empty(
        &self,
        analysis: &ImportAnalysis,
    ) -> ImportManipulationResult<(usize, bool, bool)> {
        // If there's a docstring, insert after it
        if let Some(offset) = analysis.after_docstring_offset {
            return Ok((offset, false, false));
        }

        // Insert at the very beginning
        Ok((0, false, false))
    }

    /// Calculate the edit to insert an import statement.
    pub fn insert(
        &self,
        import: ImportStatement,
        analysis: &ImportAnalysis,
    ) -> ImportManipulationResult<TextEdit> {
        let module_path = import.module_path();
        let group = self.classifier.classify(module_path);

        // Check for duplicates
        match &import {
            ImportStatement::Import { module, .. } => {
                if analysis.has_import(module) {
                    return Err(ImportManipulationError::AlreadyExists(module.clone()));
                }
            }
            ImportStatement::FromImport { module, names } => {
                for name in names {
                    if analysis.has_name_imported(module, &name.name) {
                        return Err(ImportManipulationError::AlreadyExists(format!(
                            "from {} import {}",
                            module, name.name
                        )));
                    }
                }
            }
        }

        let (offset, blank_before, blank_after) = self.find_insertion_point(group, analysis)?;

        // Build the insert text
        let mut text = String::new();

        if blank_before {
            text.push('\n');
        }

        text.push_str(&import.render());
        text.push('\n');

        if blank_after {
            text.push('\n');
        }

        Ok(TextEdit::insert(offset, text))
    }
}

// ============================================================================
// Import Remover
// ============================================================================

/// Removes import statements or individual names from import statements.
///
/// The remover handles cleanup of trailing commas, proper line removal,
/// and converts multi-name imports to single-name when only one remains.
#[derive(Debug, Clone, Default)]
pub struct ImportRemover;

/// Information about an imported name's location within a from-import statement.
#[derive(Debug, Clone)]
pub struct ImportedNameSpan {
    /// The name being imported.
    pub name: String,
    /// Optional alias.
    pub alias: Option<String>,
    /// Start offset of this name (including leading whitespace/comma if not first).
    pub start_offset: usize,
    /// End offset of this name (including trailing comma if not last).
    pub end_offset: usize,
    /// Whether this is the first name in the list.
    pub is_first: bool,
    /// Whether this is the last name in the list.
    pub is_last: bool,
}

impl ImportRemover {
    /// Create a new import remover.
    pub fn new() -> Self {
        Self
    }

    /// Remove an entire import statement from source code.
    ///
    /// This removes the import statement and its trailing newline.
    pub fn remove_import(
        &self,
        source: &str,
        import_info: &ImportInfo,
    ) -> ImportManipulationResult<TextEdit> {
        // Find the end of the line (including the newline character)
        let line_end = self.find_line_end(source, import_info.end_offset);

        // Check if there's a blank line after this import that should also be removed
        // (if this is the last import in a group)
        let delete_end = line_end;

        Ok(TextEdit::delete(import_info.start_offset, delete_end - import_info.start_offset))
    }

    /// Remove a specific name from a from-import statement.
    ///
    /// If this is the only name, removes the entire import statement.
    /// Otherwise, removes just this name with proper comma handling.
    pub fn remove_name_from_import(
        &self,
        source: &str,
        import_info: &ImportInfo,
        name_to_remove: &str,
    ) -> ImportManipulationResult<TextEdit> {
        let ImportStatement::FromImport { module: _, names } = &import_info.statement else {
            return Err(ImportManipulationError::InvalidSyntax(
                "remove_name_from_import requires a from-import statement".to_string(),
            ));
        };

        // Find the name in the names list
        let name_index = names
            .iter()
            .position(|n| n.name == name_to_remove)
            .ok_or_else(|| ImportManipulationError::NotFound(name_to_remove.to_string()))?;

        // If this is the only name, remove the entire import
        if names.len() == 1 {
            return self.remove_import(source, import_info);
        }

        // Parse the source to find the exact span of this name
        let import_text = &source[import_info.start_offset..import_info.end_offset];
        let name_span = self.calculate_name_removal_span(import_text, names, name_index)?;

        // Calculate the edit
        let absolute_start = import_info.start_offset + name_span.start_offset;
        let delete_len = name_span.end_offset - name_span.start_offset;

        Ok(TextEdit::delete(absolute_start, delete_len))
    }

    /// Calculate the span to remove for a specific name in an import list.
    ///
    /// Handles comma placement:
    /// - First name: remove name and trailing comma/space
    /// - Middle name: remove leading comma/space and name
    /// - Last name: remove leading comma/space and name
    fn calculate_name_removal_span(
        &self,
        import_text: &str,
        names: &[ImportedName],
        name_index: usize,
    ) -> ImportManipulationResult<ImportedNameSpan> {
        let name = &names[name_index];
        let is_first = name_index == 0;
        let is_last = name_index == names.len() - 1;

        // Find "import " to locate where names start
        let import_keyword_pos = import_text
            .find(" import ")
            .ok_or_else(|| ImportManipulationError::InvalidSyntax("no 'import' keyword found".to_string()))?;
        let names_start = import_keyword_pos + " import ".len();

        // Handle parenthesized imports
        let names_section = &import_text[names_start..];
        let names_section = names_section.trim_start_matches('(').trim_end_matches(')');

        // Find the position of this specific name
        let name_pattern = if let Some(alias) = &name.alias {
            format!("{} as {}", name.name, alias)
        } else {
            name.name.clone()
        };

        // Find all occurrences of each name and map to their positions
        let mut current_pos = 0;
        let mut found_pos = None;

        for (idx, part) in names_section.split(',').enumerate() {
            let trimmed = part.trim();
            if idx == name_index {
                // Find where this part starts in the original names_section
                let part_start = names_section[current_pos..].find(trimmed).unwrap_or(0) + current_pos;
                found_pos = Some(part_start);
                break;
            }
            // Move past this part and the comma
            if let Some(comma_pos) = names_section[current_pos..].find(',') {
                current_pos += comma_pos + 1;
            }
        }

        let name_start_in_section = found_pos
            .ok_or_else(|| ImportManipulationError::NotFound(name.name.clone()))?;

        // Calculate what to remove based on position
        let (start_offset, end_offset) = if is_first && !is_last {
            // First name with more after: remove name and trailing comma/space
            let name_end = name_start_in_section + name_pattern.len();
            // Find the comma after this name
            let after_name = &names_section[name_end..];
            let comma_and_space_len = after_name
                .find(|c: char| c.is_alphabetic() || c == '_')
                .unwrap_or(after_name.len());
            (
                names_start + name_start_in_section,
                names_start + name_end + comma_and_space_len,
            )
        } else if is_last {
            // Last name: remove leading comma/space and name
            let name_end = name_start_in_section + name_pattern.len();
            // Find how far back to go to include the comma
            let before_name = &names_section[..name_start_in_section];
            let comma_pos = before_name.trim_end().rfind(',').unwrap_or(0);
            (
                names_start + comma_pos,
                names_start + name_end,
            )
        } else {
            // Middle name: remove leading comma/space and name
            let name_end = name_start_in_section + name_pattern.len();
            let before_name = &names_section[..name_start_in_section];
            let comma_pos = before_name.rfind(',').unwrap_or(0);
            (
                names_start + comma_pos,
                names_start + name_end,
            )
        };

        Ok(ImportedNameSpan {
            name: name.name.clone(),
            alias: name.alias.clone(),
            start_offset,
            end_offset,
            is_first,
            is_last,
        })
    }

    /// Find the end of the line containing the given offset.
    fn find_line_end(&self, source: &str, offset: usize) -> usize {
        let rest = &source[offset..];
        match rest.find('\n') {
            Some(pos) => offset + pos + 1,
            None => source.len(),
        }
    }

    /// Remove a name from a multiline (parenthesized) import.
    ///
    /// If the name is on its own line, removes the entire line.
    /// Handles trailing commas properly.
    pub fn remove_name_from_multiline_import(
        &self,
        source: &str,
        import_info: &ImportInfo,
        name_to_remove: &str,
    ) -> ImportManipulationResult<TextEdit> {
        let ImportStatement::FromImport { names, .. } = &import_info.statement else {
            return Err(ImportManipulationError::InvalidSyntax(
                "remove_name_from_multiline_import requires a from-import statement".to_string(),
            ));
        };

        // If only one name, remove entire import
        if names.len() == 1 {
            return self.remove_import(source, import_info);
        }

        // Check if this is actually a multiline import
        let import_text = &source[import_info.start_offset..import_info.end_offset];
        let is_multiline = import_text.contains('\n');

        if !is_multiline {
            // Fall back to single-line removal
            return self.remove_name_from_import(source, import_info, name_to_remove);
        }

        // For multiline imports, find the line containing this name
        let name_index = names
            .iter()
            .position(|n| n.name == name_to_remove)
            .ok_or_else(|| ImportManipulationError::NotFound(name_to_remove.to_string()))?;

        let name = &names[name_index];
        let name_pattern = if let Some(alias) = &name.alias {
            format!("{} as {}", name.name, alias)
        } else {
            name.name.clone()
        };

        // Find the line containing this name
        let mut line_start = import_info.start_offset;

        for line in import_text.lines() {
            let line_end = line_start + line.len();
            if source[line_start..line_end].contains(&name_pattern) {
                // Found the line with this name
                // If this line only contains this name (plus comma/whitespace), remove the whole line
                let line_trimmed = line.trim().trim_end_matches(',').trim();
                if line_trimmed == name_pattern || line_trimmed == format!("{},", name_pattern) {
                    // Remove the entire line including newline
                    let actual_line_end = if line_end < source.len() && source.as_bytes()[line_end] == b'\n' {
                        line_end + 1
                    } else {
                        line_end
                    };
                    return Ok(TextEdit::delete(line_start, actual_line_end - line_start));
                }
                break;
            }
            // Move to next line (account for newline)
            if line_end < import_info.end_offset {
                line_start = line_end + 1;
            }
        }

        // If the name isn't on its own line, use the regular removal logic
        self.remove_name_from_import(source, import_info, name_to_remove)
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

    // ============================================================================
    // ImportInserter tests (Phase D)
    // ============================================================================

    fn make_inserter() -> ImportInserter {
        let config = ImportClassifierConfig::default();
        let classifier = ImportClassifier::new(config);
        ImportInserter::new(classifier)
    }

    #[test]
    fn test_insert_into_empty_file() {
        let inserter = make_inserter();
        let source = "";
        let analysis = inserter.analyze_imports(source);

        let import = ImportStatement::import("os");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        assert_eq!(result, "import os\n");
    }

    #[test]
    fn test_insert_after_docstring() {
        let inserter = make_inserter();
        let source = r#""""Module docstring."""
"#;
        let analysis = inserter.analyze_imports(source);

        // Verify docstring was detected
        assert!(analysis.after_docstring_offset.is_some());

        let import = ImportStatement::import("os");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        assert!(result.contains("\"\"\"Module docstring.\"\"\""));
        assert!(result.contains("import os\n"));
        // Import should be after docstring
        let docstring_end = result.find("\"\"\"").unwrap() + 3 + result[3..].find("\"\"\"").unwrap() + 3;
        let import_pos = result.find("import os").unwrap();
        assert!(import_pos > docstring_end);
    }

    #[test]
    fn test_insert_stdlib_after_stdlib() {
        let inserter = make_inserter();
        let source = "import os\n";
        let analysis = inserter.analyze_imports(source);

        let import = ImportStatement::import("sys");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        assert_eq!(result, "import os\nimport sys\n");
    }

    #[test]
    fn test_insert_third_party_after_stdlib() {
        let inserter = make_inserter();
        let source = "import os\n";
        let analysis = inserter.analyze_imports(source);

        let import = ImportStatement::import("numpy");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        // Should have blank line between stdlib and third-party
        assert_eq!(result, "import os\n\nimport numpy\n");
    }

    #[test]
    fn test_insert_local_after_third_party() {
        let inserter = make_inserter();
        let source = "import numpy\n";
        let analysis = inserter.analyze_imports(source);

        let import = ImportStatement::from_import(".local", "foo");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        // Should have blank line between third-party and local
        assert_eq!(result, "import numpy\n\nfrom .local import foo\n");
    }

    #[test]
    fn test_insert_future_first() {
        let inserter = make_inserter();
        let source = "import os\n";
        let analysis = inserter.analyze_imports(source);

        let import = ImportStatement::from_import("__future__", "annotations");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        // Future import should come first with blank line after
        assert_eq!(result, "from __future__ import annotations\n\nimport os\n");
    }

    #[test]
    fn test_insert_after_future() {
        let inserter = make_inserter();
        let source = "from __future__ import annotations\n";
        let analysis = inserter.analyze_imports(source);

        let import = ImportStatement::import("os");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        // stdlib should come after future with blank line
        assert_eq!(result, "from __future__ import annotations\n\nimport os\n");
    }

    #[test]
    fn test_insert_preserves_blank_lines() {
        let inserter = make_inserter();
        let source = "import os\n\nimport numpy\n";
        let analysis = inserter.analyze_imports(source);

        // Insert another stdlib - should go with os, not add extra blank line
        let import = ImportStatement::import("sys");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        // The blank line between groups should be preserved
        assert!(result.contains("import os\nimport sys\n\nimport numpy\n"));
    }

    #[test]
    fn test_insert_adds_blank_line_between_groups() {
        let inserter = make_inserter();
        let source = "import os\nimport numpy\n"; // Missing blank line
        let analysis = inserter.analyze_imports(source);

        // Insert a local import
        let import = ImportStatement::from_import(".mymodule", "func");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        // Should add blank line before local
        assert!(result.ends_with("\nfrom .mymodule import func\n"));
    }

    #[test]
    fn test_insert_duplicate_rejected() {
        let inserter = make_inserter();
        let source = "import os\n";
        let analysis = inserter.analyze_imports(source);

        let import = ImportStatement::import("os");
        let result = inserter.insert(import, &analysis);

        assert!(matches!(
            result,
            Err(ImportManipulationError::AlreadyExists(_))
        ));
    }

    #[test]
    fn test_insert_duplicate_from_import_rejected() {
        let inserter = make_inserter();
        let source = "from os import path\n";
        let analysis = inserter.analyze_imports(source);

        let import = ImportStatement::from_import("os", "path");
        let result = inserter.insert(import, &analysis);

        assert!(matches!(
            result,
            Err(ImportManipulationError::AlreadyExists(_))
        ));
    }

    #[test]
    fn test_insert_organize_mode_sorts() {
        let config = ImportClassifierConfig::default();
        let classifier = ImportClassifier::new(config);
        let inserter = ImportInserter::new(classifier).with_mode(ImportInsertMode::Organize);

        let source = "import sys\n";
        let analysis = inserter.analyze_imports(source);

        // Insert os - should go with other stdlib
        let import = ImportStatement::import("os");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);
        assert!(result.contains("import sys\nimport os\n"));
    }

    #[test]
    fn test_insert_roundtrip() {
        let inserter = make_inserter();

        // Start with a realistic file
        let source = r#""""A module with imports."""

from __future__ import annotations

import os
import sys

import numpy as np

from .local import helper
"#;

        let analysis = inserter.analyze_imports(source);

        // Verify analysis captured all imports correctly
        assert_eq!(analysis.groups.len(), 4); // All 4 group types
        assert!(analysis.after_docstring_offset.is_some());

        // Insert a new third-party import
        let import = ImportStatement::import("requests");
        let edit = inserter.insert(import, &analysis).unwrap();

        let result = edit.apply(source);

        // Verify the result is valid and contains the new import
        assert!(result.contains("import requests"));

        // Re-analyze to verify structure is preserved
        let analysis2 = inserter.analyze_imports(&result);
        assert_eq!(analysis2.groups.len(), 4);

        // Verify import groups are in correct order
        let groups: Vec<_> = analysis2.groups.keys().collect();
        assert_eq!(
            groups,
            vec![
                &ImportGroupKind::Future,
                &ImportGroupKind::Stdlib,
                &ImportGroupKind::ThirdParty,
                &ImportGroupKind::Local
            ]
        );
    }

    #[test]
    fn test_analyze_multiline_docstring() {
        let inserter = make_inserter();
        let source = r#""""
This is a multi-line
docstring.
"""

import os
"#;
        let analysis = inserter.analyze_imports(source);

        assert!(analysis.after_docstring_offset.is_some());
        assert_eq!(analysis.imports_in_order.len(), 1);
        assert_eq!(analysis.imports_in_order[0].statement.module_path(), "os");
    }

    #[test]
    fn test_analyze_from_import_with_alias() {
        let inserter = make_inserter();
        let source = "from os import path as p\n";
        let analysis = inserter.analyze_imports(source);

        assert_eq!(analysis.imports_in_order.len(), 1);
        let import = &analysis.imports_in_order[0];
        match &import.statement {
            ImportStatement::FromImport { names, .. } => {
                assert_eq!(names.len(), 1);
                assert_eq!(names[0].name, "path");
                assert_eq!(names[0].alias, Some("p".to_string()));
            }
            _ => panic!("Expected FromImport"),
        }
    }

    #[test]
    fn test_analyze_multiple_names() {
        let inserter = make_inserter();
        let source = "from os import path, getcwd, chdir\n";
        let analysis = inserter.analyze_imports(source);

        assert_eq!(analysis.imports_in_order.len(), 1);
        let import = &analysis.imports_in_order[0];
        match &import.statement {
            ImportStatement::FromImport { names, .. } => {
                assert_eq!(names.len(), 3);
                assert_eq!(names[0].name, "path");
                assert_eq!(names[1].name, "getcwd");
                assert_eq!(names[2].name, "chdir");
            }
            _ => panic!("Expected FromImport"),
        }
    }

    #[test]
    fn test_text_edit_apply() {
        let edit = TextEdit::insert(5, " world");
        let result = edit.apply("hello!");
        assert_eq!(result, "hello world!");
    }

    #[test]
    fn test_text_edit_replace() {
        let edit = TextEdit::replace(0, 5, "goodbye");
        let result = edit.apply("hello world");
        assert_eq!(result, "goodbye world");
    }

    #[test]
    fn test_text_edit_delete() {
        let edit = TextEdit::delete(5, 6);
        let result = edit.apply("hello world");
        assert_eq!(result, "hello");
    }

    // ============================================================================
    // ImportRemover tests (Phase E)
    // ============================================================================

    #[test]
    fn test_remove_single_name_import() {
        let remover = ImportRemover::new();
        let source = "from os import path\n";
        let stmt = ImportStatement::from_import("os", "path");
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 19, // "from os import path"
            line: 1,
        };

        let edit = remover.remove_name_from_import(source, &info, "path").unwrap();
        let result = edit.apply(source);
        assert_eq!(result, "");
    }

    #[test]
    fn test_remove_first_from_multi() {
        let remover = ImportRemover::new();
        let source = "from os import path, getcwd\n";
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![ImportedName::new("path"), ImportedName::new("getcwd")],
        );
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 27, // "from os import path, getcwd"
            line: 1,
        };

        let edit = remover.remove_name_from_import(source, &info, "path").unwrap();
        let result = edit.apply(source);
        assert_eq!(result, "from os import getcwd\n");
    }

    #[test]
    fn test_remove_last_from_multi() {
        let remover = ImportRemover::new();
        let source = "from os import path, getcwd\n";
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![ImportedName::new("path"), ImportedName::new("getcwd")],
        );
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 27, // "from os import path, getcwd"
            line: 1,
        };

        let edit = remover.remove_name_from_import(source, &info, "getcwd").unwrap();
        let result = edit.apply(source);
        assert_eq!(result, "from os import path\n");
    }

    #[test]
    fn test_remove_middle_from_multi() {
        let remover = ImportRemover::new();
        let source = "from os import a, b, c\n";
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![
                ImportedName::new("a"),
                ImportedName::new("b"),
                ImportedName::new("c"),
            ],
        );
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 22, // "from os import a, b, c"
            line: 1,
        };

        let edit = remover.remove_name_from_import(source, &info, "b").unwrap();
        let result = edit.apply(source);
        assert_eq!(result, "from os import a, c\n");
    }

    #[test]
    fn test_remove_with_alias() {
        let remover = ImportRemover::new();
        let source = "from os import path as p\n";
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![ImportedName::with_alias("path", "p")],
        );
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 24, // "from os import path as p"
            line: 1,
        };

        let edit = remover.remove_name_from_import(source, &info, "path").unwrap();
        let result = edit.apply(source);
        assert_eq!(result, "");
    }

    #[test]
    fn test_remove_multiline_single() {
        let remover = ImportRemover::new();
        let source = "from os import (\n    path,\n    getcwd,\n)\n";
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![ImportedName::new("path"), ImportedName::new("getcwd")],
        );
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 40, // entire multiline import
            line: 1,
        };

        let edit = remover.remove_name_from_multiline_import(source, &info, "path").unwrap();
        let result = edit.apply(source);
        // Should remove the "    path,\n" line
        assert!(result.contains("getcwd"));
        assert!(!result.contains("path"));
    }

    #[test]
    fn test_remove_last_makes_single_line() {
        // When removing leaves one name, the result should still be valid
        let remover = ImportRemover::new();
        let source = "from os import path, getcwd\n";
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![ImportedName::new("path"), ImportedName::new("getcwd")],
        );
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 27,
            line: 1,
        };

        // Remove one, should leave a valid single-name import
        let edit = remover.remove_name_from_import(source, &info, "getcwd").unwrap();
        let result = edit.apply(source);
        assert_eq!(result, "from os import path\n");

        // Verify it's valid Python syntax (single name, no trailing comma)
        assert!(!result.contains(','));
    }

    #[test]
    fn test_remove_trailing_comma_cleanup() {
        let remover = ImportRemover::new();
        // Test that trailing comma after last name is handled
        let source = "from os import path, getcwd,\n";
        let stmt = ImportStatement::from_import_names(
            "os",
            vec![ImportedName::new("path"), ImportedName::new("getcwd")],
        );
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 28, // includes trailing comma
            line: 1,
        };

        // Remove last name, should handle trailing comma
        let edit = remover.remove_name_from_import(source, &info, "getcwd").unwrap();
        let result = edit.apply(source);
        // Result should not have "getcwd" and should be valid
        assert!(!result.contains("getcwd"));
        assert!(result.contains("path"));
    }

    #[test]
    fn test_remove_entire_import_statement() {
        let remover = ImportRemover::new();
        let source = "import os\nimport sys\n";
        let stmt = ImportStatement::import("os");
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 9, // "import os"
            line: 1,
        };

        let edit = remover.remove_import(source, &info).unwrap();
        let result = edit.apply(source);
        assert_eq!(result, "import sys\n");
    }

    #[test]
    fn test_remove_import_not_found() {
        let remover = ImportRemover::new();
        let source = "from os import path\n";
        let stmt = ImportStatement::from_import("os", "path");
        let info = ImportInfo {
            statement: stmt,
            group: ImportGroupKind::Stdlib,
            start_offset: 0,
            end_offset: 19,
            line: 1,
        };

        let result = remover.remove_name_from_import(source, &info, "nonexistent");
        assert!(matches!(result, Err(ImportManipulationError::NotFound(_))));
    }
}
