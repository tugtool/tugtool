//! Facts model: normalized code facts tables and indexes.
//!
//! This module provides the semantic program data model for tug:
//! - `File`: Source files with content hashes
//! - `Module`: Python/Rust modules with hierarchy
//! - `Symbol`: Definitions (functions, classes, variables, etc.)
//! - `Reference`: Usages of symbols
//! - `Import`: Import statements
//!
//! The `FactsStore` provides in-memory storage with:
//! - Hash maps for O(1) ID lookups
//! - Postings lists for efficient queries (symbol → refs, file → imports)
//! - Deterministic iteration order

use crate::patch::{ContentHash, FileId, Span};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

// ============================================================================
// ID Types
// ============================================================================

/// Unique identifier for a module within a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct ModuleId(pub u32);

impl ModuleId {
    /// Create a new module ID.
    pub fn new(id: u32) -> Self {
        ModuleId(id)
    }
}

impl std::fmt::Display for ModuleId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "mod_{}", self.0)
    }
}

/// Unique identifier for a symbol within a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct SymbolId(pub u32);

impl SymbolId {
    /// Create a new symbol ID.
    pub fn new(id: u32) -> Self {
        SymbolId(id)
    }
}

impl std::fmt::Display for SymbolId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "sym_{}", self.0)
    }
}

/// Unique identifier for a reference within a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct ReferenceId(pub u32);

impl ReferenceId {
    /// Create a new reference ID.
    pub fn new(id: u32) -> Self {
        ReferenceId(id)
    }
}

impl std::fmt::Display for ReferenceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ref_{}", self.0)
    }
}

/// Unique identifier for an import within a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct ImportId(pub u32);

impl ImportId {
    /// Create a new import ID.
    pub fn new(id: u32) -> Self {
        ImportId(id)
    }
}

impl std::fmt::Display for ImportId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "imp_{}", self.0)
    }
}

/// Unique identifier for a scope within a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct ScopeId(pub u32);

impl ScopeId {
    /// Create a new scope ID.
    pub fn new(id: u32) -> Self {
        ScopeId(id)
    }
}

impl std::fmt::Display for ScopeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "scope_{}", self.0)
    }
}

// ============================================================================
// Enums
// ============================================================================

/// Programming language of a source file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum Language {
    Python,
    Rust,
    #[default]
    Unknown,
}

/// Kind of module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ModuleKind {
    /// Regular module (single file).
    #[default]
    File,
    /// Package module (__init__.py or mod.rs).
    Package,
    /// Namespace package (no __init__.py).
    Namespace,
}

/// Kind of symbol definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum SymbolKind {
    Function,
    Class,
    Method,
    #[default]
    Variable,
    Parameter,
    Module,
    Import,
    Constant,
    TypeAlias,
}

impl SymbolKind {
    /// Convert to spec-compliant output kind string.
    ///
    /// Per 26.0.7 spec, valid kinds are: function, class, method, variable, parameter, module, import.
    /// Internal kinds that don't map directly are converted to the closest equivalent:
    /// - `Constant` → `"variable"` (constants are a kind of variable)
    /// - `TypeAlias` → `"variable"` (type aliases are variable-like bindings)
    pub fn to_output_kind(&self) -> &'static str {
        match self {
            SymbolKind::Function => "function",
            SymbolKind::Class => "class",
            SymbolKind::Method => "method",
            SymbolKind::Variable => "variable",
            SymbolKind::Parameter => "parameter",
            SymbolKind::Module => "module",
            SymbolKind::Import => "import",
            // Map internal-only kinds to spec-compliant equivalents
            SymbolKind::Constant => "variable",
            SymbolKind::TypeAlias => "variable",
        }
    }
}

/// Kind of reference to a symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ReferenceKind {
    /// The definition site itself.
    Definition,
    /// A call to a function/method.
    Call,
    /// A simple name reference (read).
    #[default]
    Reference,
    /// An import statement.
    Import,
    /// Attribute access (obj.attr).
    Attribute,
    /// Type annotation reference.
    TypeAnnotation,
    /// Assignment target (write).
    Write,
}

impl ReferenceKind {
    /// Convert to spec-compliant output kind string.
    ///
    /// Per 26.0.7 spec, valid kinds are: definition, call, reference, import, attribute.
    /// Internal kinds that don't map directly are converted to the closest equivalent:
    /// - `TypeAnnotation` → `"reference"` (type annotations are a form of reference)
    /// - `Write` → `"reference"` (writes are references with assignment)
    pub fn to_output_kind(&self) -> &'static str {
        match self {
            ReferenceKind::Definition => "definition",
            ReferenceKind::Call => "call",
            ReferenceKind::Reference => "reference",
            ReferenceKind::Import => "import",
            ReferenceKind::Attribute => "attribute",
            // Map internal-only kinds to spec-compliant equivalents
            ReferenceKind::TypeAnnotation => "reference",
            ReferenceKind::Write => "reference",
        }
    }
}

/// Kind of scope in the code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ScopeKind {
    /// Module-level scope.
    #[default]
    Module,
    /// Class body scope.
    Class,
    /// Function/method body scope.
    Function,
    /// List/dict/set/generator comprehension scope.
    Comprehension,
    /// Lambda expression scope.
    Lambda,
}

/// Source of type information for a symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum TypeSource {
    /// Type inferred from assignment (e.g., `x = MyClass()`).
    Inferred,
    /// Type from explicit annotation (e.g., `x: MyClass`).
    Annotated,
    /// Type is unknown.
    #[default]
    Unknown,
}

// ============================================================================
// Facts Tables
// ============================================================================

/// A source file in the workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct File {
    /// Unique identifier for this file.
    pub file_id: FileId,
    /// Workspace-relative path.
    pub path: String,
    /// SHA-256 hash of file content.
    pub content_hash: ContentHash,
    /// Programming language.
    pub language: Language,
}

impl File {
    /// Create a new file entry.
    pub fn new(
        file_id: FileId,
        path: impl Into<String>,
        content_hash: ContentHash,
        language: Language,
    ) -> Self {
        File {
            file_id,
            path: path.into(),
            content_hash,
            language,
        }
    }
}

/// A module (Python package/module, Rust module).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Module {
    /// Unique identifier for this module.
    pub module_id: ModuleId,
    /// Qualified module path (e.g., "myproject.utils").
    pub path: String,
    /// Kind of module.
    pub kind: ModuleKind,
    /// Parent module (None for top-level).
    pub parent_module_id: Option<ModuleId>,
    /// File that defines this module.
    pub file_id: Option<FileId>,
}

impl Module {
    /// Create a new module entry.
    pub fn new(
        module_id: ModuleId,
        path: impl Into<String>,
        kind: ModuleKind,
        parent_module_id: Option<ModuleId>,
        file_id: Option<FileId>,
    ) -> Self {
        Module {
            module_id,
            path: path.into(),
            kind,
            parent_module_id,
            file_id,
        }
    }
}

/// A symbol definition (function, class, variable, etc.).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Symbol {
    /// Unique identifier for this symbol.
    pub symbol_id: SymbolId,
    /// Kind of symbol.
    pub kind: SymbolKind,
    /// Symbol name.
    pub name: String,
    /// File where this symbol is declared.
    pub decl_file_id: FileId,
    /// Byte span of the symbol name in the declaration.
    pub decl_span: Span,
    /// Container symbol (e.g., class for a method).
    pub container_symbol_id: Option<SymbolId>,
    /// Module this symbol belongs to.
    pub module_id: Option<ModuleId>,
}

impl Symbol {
    /// Create a new symbol entry.
    pub fn new(
        symbol_id: SymbolId,
        kind: SymbolKind,
        name: impl Into<String>,
        decl_file_id: FileId,
        decl_span: Span,
    ) -> Self {
        Symbol {
            symbol_id,
            kind,
            name: name.into(),
            decl_file_id,
            decl_span,
            container_symbol_id: None,
            module_id: None,
        }
    }

    /// Set the container symbol.
    pub fn with_container(mut self, container: SymbolId) -> Self {
        self.container_symbol_id = Some(container);
        self
    }

    /// Set the module.
    pub fn with_module(mut self, module: ModuleId) -> Self {
        self.module_id = Some(module);
        self
    }
}

/// A reference to a symbol.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reference {
    /// Unique identifier for this reference.
    pub ref_id: ReferenceId,
    /// The symbol being referenced.
    pub symbol_id: SymbolId,
    /// File containing this reference.
    pub file_id: FileId,
    /// Byte span of the reference.
    pub span: Span,
    /// Kind of reference.
    pub ref_kind: ReferenceKind,
}

impl Reference {
    /// Create a new reference entry.
    pub fn new(
        ref_id: ReferenceId,
        symbol_id: SymbolId,
        file_id: FileId,
        span: Span,
        ref_kind: ReferenceKind,
    ) -> Self {
        Reference {
            ref_id,
            symbol_id,
            file_id,
            span,
            ref_kind,
        }
    }
}

/// An import statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Import {
    /// Unique identifier for this import.
    pub import_id: ImportId,
    /// File containing this import.
    pub file_id: FileId,
    /// Byte span of the import statement.
    pub span: Span,
    /// Module path being imported (e.g., "os.path").
    pub module_path: String,
    /// Name being imported (None for module imports like `import os`).
    pub imported_name: Option<String>,
    /// Alias if using `as` (e.g., `import numpy as np` → alias = "np").
    pub alias: Option<String>,
    /// Whether this is a star import (`from x import *`).
    pub is_star: bool,
}

impl Import {
    /// Create a new import entry.
    pub fn new(
        import_id: ImportId,
        file_id: FileId,
        span: Span,
        module_path: impl Into<String>,
    ) -> Self {
        Import {
            import_id,
            file_id,
            span,
            module_path: module_path.into(),
            imported_name: None,
            alias: None,
            is_star: false,
        }
    }

    /// Set the imported name.
    pub fn with_imported_name(mut self, name: impl Into<String>) -> Self {
        self.imported_name = Some(name.into());
        self
    }

    /// Set the alias.
    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.alias = Some(alias.into());
        self
    }

    /// Set as star import.
    pub fn with_star(mut self) -> Self {
        self.is_star = true;
        self
    }

    /// Get the effective name (alias if present, otherwise imported_name).
    pub fn effective_name(&self) -> Option<&str> {
        self.alias.as_deref().or(self.imported_name.as_deref())
    }
}

/// A scope in the code (module, class, function, etc.).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeInfo {
    /// Unique identifier for this scope.
    pub scope_id: ScopeId,
    /// File containing this scope.
    pub file_id: FileId,
    /// Byte span of the scope.
    pub span: Span,
    /// Kind of scope.
    pub kind: ScopeKind,
    /// Parent scope (None for module-level scope).
    pub parent: Option<ScopeId>,
}

impl ScopeInfo {
    /// Create a new scope entry.
    pub fn new(scope_id: ScopeId, file_id: FileId, span: Span, kind: ScopeKind) -> Self {
        ScopeInfo {
            scope_id,
            file_id,
            span,
            kind,
            parent: None,
        }
    }

    /// Set the parent scope.
    pub fn with_parent(mut self, parent: ScopeId) -> Self {
        self.parent = Some(parent);
        self
    }

    /// Check if a byte position is within this scope.
    pub fn contains_position(&self, position: u64) -> bool {
        position >= self.span.start && position < self.span.end
    }
}

/// Type information for a symbol.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypeInfo {
    /// The symbol this type information applies to.
    pub symbol_id: SymbolId,
    /// String representation of the type (e.g., "MyClass", "List\[int\]").
    pub type_repr: String,
    /// Source of this type information.
    pub source: TypeSource,
}

impl TypeInfo {
    /// Create a new type info entry.
    pub fn new(symbol_id: SymbolId, type_repr: impl Into<String>, source: TypeSource) -> Self {
        TypeInfo {
            symbol_id,
            type_repr: type_repr.into(),
            source,
        }
    }

    /// Create type info for an inferred type.
    pub fn inferred(symbol_id: SymbolId, type_repr: impl Into<String>) -> Self {
        Self::new(symbol_id, type_repr, TypeSource::Inferred)
    }

    /// Create type info for an annotated type.
    pub fn annotated(symbol_id: SymbolId, type_repr: impl Into<String>) -> Self {
        Self::new(symbol_id, type_repr, TypeSource::Annotated)
    }
}

/// Inheritance relationship between classes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InheritanceInfo {
    /// The child class (subclass).
    pub child_id: SymbolId,
    /// The parent class (superclass).
    pub parent_id: SymbolId,
}

impl InheritanceInfo {
    /// Create a new inheritance relationship.
    pub fn new(child_id: SymbolId, parent_id: SymbolId) -> Self {
        InheritanceInfo {
            child_id,
            parent_id,
        }
    }
}

// ============================================================================
// FactsStore
// ============================================================================

/// In-memory storage for code facts with efficient lookups.
///
/// Provides:
/// - O(1) lookup by ID for all entity types
/// - Postings lists for common queries (refs by symbol, imports by file)
/// - Deterministic iteration order (sorted by ID)
#[derive(Debug, Default)]
pub struct FactsStore {
    // Primary storage (BTreeMap for deterministic iteration)
    files: BTreeMap<FileId, File>,
    modules: BTreeMap<ModuleId, Module>,
    symbols: BTreeMap<SymbolId, Symbol>,
    references: BTreeMap<ReferenceId, Reference>,
    imports: BTreeMap<ImportId, Import>,
    scopes: BTreeMap<ScopeId, ScopeInfo>,

    // Type information (symbol_id → type)
    types: HashMap<SymbolId, TypeInfo>,

    // Inheritance relationships
    inheritance: Vec<InheritanceInfo>,
    /// child_symbol_id → parent_symbol_ids[]
    parents_of: HashMap<SymbolId, Vec<SymbolId>>,
    /// parent_symbol_id → child_symbol_ids[]
    children_of: HashMap<SymbolId, Vec<SymbolId>>,

    // Secondary indexes
    /// Map from file path to FileId.
    file_by_path: HashMap<String, FileId>,
    /// Map from symbol name to SymbolIds (multiple symbols can have same name).
    symbols_by_name: HashMap<String, Vec<SymbolId>>,

    // Postings lists
    /// symbol_id → ref_ids[] (sorted by ref_id for determinism).
    refs_by_symbol: HashMap<SymbolId, Vec<ReferenceId>>,
    /// file_id → import_ids[] (sorted by import_id for determinism).
    imports_by_file: HashMap<FileId, Vec<ImportId>>,
    /// file_id → symbol_ids[] (symbols declared in file).
    symbols_by_file: HashMap<FileId, Vec<SymbolId>>,
    /// file_id → ref_ids[] (references in file).
    refs_by_file: HashMap<FileId, Vec<ReferenceId>>,
    /// file_id → scope_ids[] (scopes in file, sorted by scope_id).
    scopes_by_file: HashMap<FileId, Vec<ScopeId>>,

    // ID generators
    next_file_id: u32,
    next_module_id: u32,
    next_symbol_id: u32,
    next_ref_id: u32,
    next_import_id: u32,
    next_scope_id: u32,
}

impl FactsStore {
    /// Create a new empty FactsStore.
    pub fn new() -> Self {
        FactsStore::default()
    }

    // ========================================================================
    // ID Generation
    // ========================================================================

    /// Generate the next FileId.
    pub fn next_file_id(&mut self) -> FileId {
        let id = FileId::new(self.next_file_id);
        self.next_file_id += 1;
        id
    }

    /// Generate the next ModuleId.
    pub fn next_module_id(&mut self) -> ModuleId {
        let id = ModuleId::new(self.next_module_id);
        self.next_module_id += 1;
        id
    }

    /// Generate the next SymbolId.
    pub fn next_symbol_id(&mut self) -> SymbolId {
        let id = SymbolId::new(self.next_symbol_id);
        self.next_symbol_id += 1;
        id
    }

    /// Generate the next ReferenceId.
    pub fn next_reference_id(&mut self) -> ReferenceId {
        let id = ReferenceId::new(self.next_ref_id);
        self.next_ref_id += 1;
        id
    }

    /// Generate the next ImportId.
    pub fn next_import_id(&mut self) -> ImportId {
        let id = ImportId::new(self.next_import_id);
        self.next_import_id += 1;
        id
    }

    /// Generate the next ScopeId.
    pub fn next_scope_id(&mut self) -> ScopeId {
        let id = ScopeId::new(self.next_scope_id);
        self.next_scope_id += 1;
        id
    }

    // ========================================================================
    // Insert Operations
    // ========================================================================

    /// Insert a file.
    pub fn insert_file(&mut self, file: File) {
        self.file_by_path.insert(file.path.clone(), file.file_id);
        self.files.insert(file.file_id, file);
    }

    /// Insert a module.
    pub fn insert_module(&mut self, module: Module) {
        self.modules.insert(module.module_id, module);
    }

    /// Insert a symbol.
    pub fn insert_symbol(&mut self, symbol: Symbol) {
        // Update name index
        self.symbols_by_name
            .entry(symbol.name.clone())
            .or_default()
            .push(symbol.symbol_id);

        // Update file index
        self.symbols_by_file
            .entry(symbol.decl_file_id)
            .or_default()
            .push(symbol.symbol_id);

        // Insert into primary storage
        self.symbols.insert(symbol.symbol_id, symbol);
    }

    /// Insert a reference.
    pub fn insert_reference(&mut self, reference: Reference) {
        // Update symbol postings list
        self.refs_by_symbol
            .entry(reference.symbol_id)
            .or_default()
            .push(reference.ref_id);

        // Update file postings list
        self.refs_by_file
            .entry(reference.file_id)
            .or_default()
            .push(reference.ref_id);

        // Insert into primary storage
        self.references.insert(reference.ref_id, reference);
    }

    /// Insert an import.
    pub fn insert_import(&mut self, import: Import) {
        // Update file postings list
        self.imports_by_file
            .entry(import.file_id)
            .or_default()
            .push(import.import_id);

        // Insert into primary storage
        self.imports.insert(import.import_id, import);
    }

    /// Insert a scope.
    pub fn insert_scope(&mut self, scope: ScopeInfo) {
        // Update file postings list
        self.scopes_by_file
            .entry(scope.file_id)
            .or_default()
            .push(scope.scope_id);

        // Insert into primary storage
        self.scopes.insert(scope.scope_id, scope);
    }

    /// Insert type information for a symbol.
    ///
    /// If the symbol already has type info, this replaces it.
    /// Annotated types are generally preferred over inferred types.
    pub fn insert_type(&mut self, type_info: TypeInfo) {
        self.types.insert(type_info.symbol_id, type_info);
    }

    /// Insert an inheritance relationship.
    ///
    /// Records that `child_id` inherits from `parent_id`.
    pub fn insert_inheritance(&mut self, info: InheritanceInfo) {
        // Update parent index
        self.parents_of
            .entry(info.child_id)
            .or_default()
            .push(info.parent_id);

        // Update children index
        self.children_of
            .entry(info.parent_id)
            .or_default()
            .push(info.child_id);

        // Store the relationship
        self.inheritance.push(info);
    }

    // ========================================================================
    // Lookup by ID
    // ========================================================================

    /// Get a file by ID.
    pub fn file(&self, id: FileId) -> Option<&File> {
        self.files.get(&id)
    }

    /// Get a module by ID.
    pub fn module(&self, id: ModuleId) -> Option<&Module> {
        self.modules.get(&id)
    }

    /// Get a symbol by ID.
    pub fn symbol(&self, id: SymbolId) -> Option<&Symbol> {
        self.symbols.get(&id)
    }

    /// Get a reference by ID.
    pub fn reference(&self, id: ReferenceId) -> Option<&Reference> {
        self.references.get(&id)
    }

    /// Get an import by ID.
    pub fn import(&self, id: ImportId) -> Option<&Import> {
        self.imports.get(&id)
    }

    /// Get a scope by ID.
    pub fn scope(&self, id: ScopeId) -> Option<&ScopeInfo> {
        self.scopes.get(&id)
    }

    // ========================================================================
    // Query Surface
    // ========================================================================

    /// Get all references to a symbol.
    ///
    /// Returns references in deterministic order (by ReferenceId).
    pub fn refs_of_symbol(&self, symbol_id: SymbolId) -> Vec<&Reference> {
        self.refs_by_symbol
            .get(&symbol_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.references.get(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all imports in a file.
    ///
    /// Returns imports in deterministic order (by ImportId).
    pub fn imports_in_file(&self, file_id: FileId) -> Vec<&Import> {
        self.imports_by_file
            .get(&file_id)
            .map(|ids| ids.iter().filter_map(|id| self.imports.get(id)).collect())
            .unwrap_or_default()
    }

    /// Get all symbols with a given name.
    ///
    /// Returns symbols in deterministic order (by SymbolId).
    pub fn symbols_named(&self, name: &str) -> Vec<&Symbol> {
        self.symbols_by_name
            .get(name)
            .map(|ids| {
                let mut symbols: Vec<_> =
                    ids.iter().filter_map(|id| self.symbols.get(id)).collect();
                // Sort by SymbolId for determinism
                symbols.sort_by_key(|s| s.symbol_id);
                symbols
            })
            .unwrap_or_default()
    }

    /// Get a file by path.
    pub fn file_by_path(&self, path: &str) -> Option<&File> {
        self.file_by_path
            .get(path)
            .and_then(|id| self.files.get(id))
    }

    /// Get all symbols declared in a file.
    ///
    /// Returns symbols in deterministic order (by SymbolId).
    pub fn symbols_in_file(&self, file_id: FileId) -> Vec<&Symbol> {
        self.symbols_by_file
            .get(&file_id)
            .map(|ids| {
                let mut symbols: Vec<_> =
                    ids.iter().filter_map(|id| self.symbols.get(id)).collect();
                symbols.sort_by_key(|s| s.symbol_id);
                symbols
            })
            .unwrap_or_default()
    }

    /// Get all references in a file.
    ///
    /// Returns references in deterministic order (by ReferenceId).
    pub fn refs_in_file(&self, file_id: FileId) -> Vec<&Reference> {
        self.refs_by_file
            .get(&file_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.references.get(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get type information for a symbol.
    pub fn type_of_symbol(&self, symbol_id: SymbolId) -> Option<&TypeInfo> {
        self.types.get(&symbol_id)
    }

    /// Get all scopes in a file.
    ///
    /// Returns scopes in deterministic order (by ScopeId).
    pub fn scopes_in_file(&self, file_id: FileId) -> Vec<&ScopeInfo> {
        self.scopes_by_file
            .get(&file_id)
            .map(|ids| {
                let mut scopes: Vec<_> = ids.iter().filter_map(|id| self.scopes.get(id)).collect();
                scopes.sort_by_key(|s| s.scope_id);
                scopes
            })
            .unwrap_or_default()
    }

    /// Find the innermost scope containing a byte position in a file.
    ///
    /// Returns the most specific (innermost) scope that contains the position,
    /// or None if no scope contains it.
    pub fn scope_at_position(&self, file_id: FileId, position: u64) -> Option<&ScopeInfo> {
        let scopes = self.scopes_in_file(file_id);

        // Find all scopes containing the position
        let containing: Vec<_> = scopes
            .into_iter()
            .filter(|s| s.contains_position(position))
            .collect();

        // Return the innermost (smallest span) scope
        containing
            .into_iter()
            .min_by_key(|s| s.span.end - s.span.start)
    }

    /// Get all child classes of a class.
    ///
    /// Returns the symbol IDs of classes that directly inherit from the given class.
    pub fn children_of_class(&self, symbol_id: SymbolId) -> Vec<SymbolId> {
        self.children_of
            .get(&symbol_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Get all parent classes of a class.
    ///
    /// Returns the symbol IDs of classes that the given class directly inherits from.
    pub fn parents_of_class(&self, symbol_id: SymbolId) -> Vec<SymbolId> {
        self.parents_of.get(&symbol_id).cloned().unwrap_or_default()
    }

    // ========================================================================
    // Iteration
    // ========================================================================

    /// Iterate over all files in deterministic order.
    pub fn files(&self) -> impl Iterator<Item = &File> {
        self.files.values()
    }

    /// Iterate over all modules in deterministic order.
    pub fn modules(&self) -> impl Iterator<Item = &Module> {
        self.modules.values()
    }

    /// Iterate over all symbols in deterministic order.
    pub fn symbols(&self) -> impl Iterator<Item = &Symbol> {
        self.symbols.values()
    }

    /// Iterate over all references in deterministic order.
    pub fn references(&self) -> impl Iterator<Item = &Reference> {
        self.references.values()
    }

    /// Iterate over all imports in deterministic order.
    pub fn imports(&self) -> impl Iterator<Item = &Import> {
        self.imports.values()
    }

    /// Iterate over all scopes in deterministic order.
    pub fn scopes(&self) -> impl Iterator<Item = &ScopeInfo> {
        self.scopes.values()
    }

    /// Iterate over all inheritance relationships.
    pub fn inheritance(&self) -> impl Iterator<Item = &InheritanceInfo> {
        self.inheritance.iter()
    }

    // ========================================================================
    // Counts
    // ========================================================================

    /// Number of files.
    pub fn file_count(&self) -> usize {
        self.files.len()
    }

    /// Number of modules.
    pub fn module_count(&self) -> usize {
        self.modules.len()
    }

    /// Number of symbols.
    pub fn symbol_count(&self) -> usize {
        self.symbols.len()
    }

    /// Number of references.
    pub fn reference_count(&self) -> usize {
        self.references.len()
    }

    /// Number of imports.
    pub fn import_count(&self) -> usize {
        self.imports.len()
    }

    /// Number of scopes.
    pub fn scope_count(&self) -> usize {
        self.scopes.len()
    }

    /// Number of type annotations.
    pub fn type_count(&self) -> usize {
        self.types.len()
    }

    /// Number of inheritance relationships.
    pub fn inheritance_count(&self) -> usize {
        self.inheritance.len()
    }

    // ========================================================================
    // Bulk Operations
    // ========================================================================

    /// Clear all data from the store.
    pub fn clear(&mut self) {
        self.files.clear();
        self.modules.clear();
        self.symbols.clear();
        self.references.clear();
        self.imports.clear();
        self.scopes.clear();

        self.types.clear();
        self.inheritance.clear();
        self.parents_of.clear();
        self.children_of.clear();

        self.file_by_path.clear();
        self.symbols_by_name.clear();

        self.refs_by_symbol.clear();
        self.imports_by_file.clear();
        self.symbols_by_file.clear();
        self.refs_by_file.clear();
        self.scopes_by_file.clear();

        // Note: We don't reset ID generators to preserve uniqueness
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn test_file(store: &mut FactsStore, path: &str) -> File {
        let file_id = store.next_file_id();
        File::new(
            file_id,
            path,
            ContentHash::compute(path.as_bytes()),
            Language::Python,
        )
    }

    fn test_symbol(store: &mut FactsStore, name: &str, file_id: FileId, start: u64) -> Symbol {
        let symbol_id = store.next_symbol_id();
        Symbol::new(
            symbol_id,
            SymbolKind::Function,
            name,
            file_id,
            Span::new(start, start + name.len() as u64),
        )
    }

    fn test_reference(
        store: &mut FactsStore,
        symbol_id: SymbolId,
        file_id: FileId,
        start: u64,
        end: u64,
    ) -> Reference {
        let ref_id = store.next_reference_id();
        Reference::new(
            ref_id,
            symbol_id,
            file_id,
            Span::new(start, end),
            ReferenceKind::Call,
        )
    }

    fn test_import(store: &mut FactsStore, file_id: FileId, module: &str) -> Import {
        let import_id = store.next_import_id();
        Import::new(import_id, file_id, Span::new(0, 10), module)
    }

    mod facts_store_tests {
        use super::*;

        #[test]
        fn insert_and_retrieve_file() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;

            store.insert_file(file);

            let retrieved = store.file(file_id).unwrap();
            assert_eq!(retrieved.path, "src/main.py");
            assert_eq!(retrieved.language, Language::Python);
        }

        #[test]
        fn insert_and_retrieve_symbol() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "process_data", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            let retrieved = store.symbol(symbol_id).unwrap();
            assert_eq!(retrieved.name, "process_data");
            assert_eq!(retrieved.kind, SymbolKind::Function);
            assert_eq!(retrieved.decl_file_id, file_id);
        }

        #[test]
        fn insert_and_retrieve_reference() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "foo", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            let reference = test_reference(&mut store, symbol_id, file_id, 50, 53);
            let ref_id = reference.ref_id;
            store.insert_reference(reference);

            let retrieved = store.reference(ref_id).unwrap();
            assert_eq!(retrieved.symbol_id, symbol_id);
            assert_eq!(retrieved.file_id, file_id);
            assert_eq!(retrieved.ref_kind, ReferenceKind::Call);
        }

        #[test]
        fn insert_and_retrieve_import() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let import = test_import(&mut store, file_id, "os.path")
                .with_imported_name("join")
                .with_alias("path_join");
            let import_id = import.import_id;
            store.insert_import(import);

            let retrieved = store.import(import_id).unwrap();
            assert_eq!(retrieved.module_path, "os.path");
            assert_eq!(retrieved.imported_name, Some("join".to_string()));
            assert_eq!(retrieved.alias, Some("path_join".to_string()));
            assert_eq!(retrieved.effective_name(), Some("path_join"));
        }
    }

    mod postings_list_tests {
        use super::*;

        #[test]
        fn refs_of_symbol_returns_all_references() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "foo", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            // Add multiple references
            let ref1 = test_reference(&mut store, symbol_id, file_id, 50, 53);
            let ref2 = test_reference(&mut store, symbol_id, file_id, 100, 103);
            let ref3 = test_reference(&mut store, symbol_id, file_id, 150, 153);
            store.insert_reference(ref1);
            store.insert_reference(ref2);
            store.insert_reference(ref3);

            let refs = store.refs_of_symbol(symbol_id);
            assert_eq!(refs.len(), 3);

            // Verify deterministic ordering (by ReferenceId)
            assert!(refs[0].ref_id.0 < refs[1].ref_id.0);
            assert!(refs[1].ref_id.0 < refs[2].ref_id.0);
        }

        #[test]
        fn refs_of_symbol_returns_empty_for_unknown_symbol() {
            let store = FactsStore::new();
            let refs = store.refs_of_symbol(SymbolId::new(999));
            assert!(refs.is_empty());
        }

        #[test]
        fn imports_in_file_returns_all_imports() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Add multiple imports
            let import1 = test_import(&mut store, file_id, "os");
            let import2 = test_import(&mut store, file_id, "sys");
            let import3 = test_import(&mut store, file_id, "json");
            store.insert_import(import1);
            store.insert_import(import2);
            store.insert_import(import3);

            let imports = store.imports_in_file(file_id);
            assert_eq!(imports.len(), 3);

            // Verify deterministic ordering (by ImportId)
            assert!(imports[0].import_id.0 < imports[1].import_id.0);
            assert!(imports[1].import_id.0 < imports[2].import_id.0);
        }

        #[test]
        fn imports_in_file_returns_empty_for_unknown_file() {
            let store = FactsStore::new();
            let imports = store.imports_in_file(FileId::new(999));
            assert!(imports.is_empty());
        }

        #[test]
        fn postings_maintain_deterministic_order() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "foo", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            // Insert references in non-sequential order
            let ref1 = test_reference(&mut store, symbol_id, file_id, 100, 103);
            let ref2 = test_reference(&mut store, symbol_id, file_id, 50, 53);
            let ref3 = test_reference(&mut store, symbol_id, file_id, 150, 153);
            store.insert_reference(ref1);
            store.insert_reference(ref2);
            store.insert_reference(ref3);

            // Multiple queries should return same order
            let refs1 = store.refs_of_symbol(symbol_id);
            let refs2 = store.refs_of_symbol(symbol_id);

            assert_eq!(refs1.len(), refs2.len());
            for (r1, r2) in refs1.iter().zip(refs2.iter()) {
                assert_eq!(r1.ref_id, r2.ref_id);
            }
        }
    }

    mod query_tests {
        use super::*;

        #[test]
        fn symbols_named_returns_all_matches() {
            let mut store = FactsStore::new();
            let file1 = test_file(&mut store, "src/a.py");
            let file1_id = file1.file_id;
            store.insert_file(file1);

            let file2 = test_file(&mut store, "src/b.py");
            let file2_id = file2.file_id;
            store.insert_file(file2);

            // Create symbols with same name in different files
            let symbol1 = test_symbol(&mut store, "process", file1_id, 10);
            let symbol2 = test_symbol(&mut store, "process", file2_id, 20);
            let symbol3 = test_symbol(&mut store, "transform", file1_id, 50);
            store.insert_symbol(symbol1);
            store.insert_symbol(symbol2);
            store.insert_symbol(symbol3);

            let matches = store.symbols_named("process");
            assert_eq!(matches.len(), 2);

            // All should have name "process"
            for s in &matches {
                assert_eq!(s.name, "process");
            }

            // Verify deterministic ordering (by SymbolId)
            assert!(matches[0].symbol_id.0 < matches[1].symbol_id.0);
        }

        #[test]
        fn symbols_named_returns_empty_for_unknown_name() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            store.insert_file(file);

            let matches = store.symbols_named("nonexistent");
            assert!(matches.is_empty());
        }

        #[test]
        fn file_by_path_works() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/utils.py");
            store.insert_file(file);

            let found = store.file_by_path("src/utils.py");
            assert!(found.is_some());
            assert_eq!(found.unwrap().path, "src/utils.py");

            let not_found = store.file_by_path("src/other.py");
            assert!(not_found.is_none());
        }

        #[test]
        fn symbols_in_file_returns_all_symbols() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol1 = test_symbol(&mut store, "foo", file_id, 10);
            let symbol2 = test_symbol(&mut store, "bar", file_id, 50);
            let symbol3 = test_symbol(&mut store, "baz", file_id, 100);
            store.insert_symbol(symbol1);
            store.insert_symbol(symbol2);
            store.insert_symbol(symbol3);

            let symbols = store.symbols_in_file(file_id);
            assert_eq!(symbols.len(), 3);

            // Verify deterministic ordering (by SymbolId)
            assert!(symbols[0].symbol_id.0 < symbols[1].symbol_id.0);
            assert!(symbols[1].symbol_id.0 < symbols[2].symbol_id.0);
        }

        #[test]
        fn refs_in_file_returns_all_references() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "foo", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            let ref1 = test_reference(&mut store, symbol_id, file_id, 50, 53);
            let ref2 = test_reference(&mut store, symbol_id, file_id, 100, 103);
            store.insert_reference(ref1);
            store.insert_reference(ref2);

            let refs = store.refs_in_file(file_id);
            assert_eq!(refs.len(), 2);
        }
    }

    mod iteration_tests {
        use super::*;

        #[test]
        fn iteration_is_deterministic() {
            let mut store = FactsStore::new();

            // Add files in arbitrary order
            let file2 = test_file(&mut store, "src/b.py");
            let file1 = test_file(&mut store, "src/a.py");
            let file3 = test_file(&mut store, "src/c.py");

            store.insert_file(file2);
            store.insert_file(file1);
            store.insert_file(file3);

            // Iteration should be by FileId (insertion order since IDs are sequential)
            let files: Vec<_> = store.files().collect();
            assert_eq!(files.len(), 3);

            // FileIds should be in order
            assert!(files[0].file_id.0 < files[1].file_id.0);
            assert!(files[1].file_id.0 < files[2].file_id.0);
        }

        #[test]
        fn counts_are_accurate() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "foo", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            let reference = test_reference(&mut store, symbol_id, file_id, 50, 53);
            store.insert_reference(reference);

            let import = test_import(&mut store, file_id, "os");
            store.insert_import(import);

            assert_eq!(store.file_count(), 1);
            assert_eq!(store.symbol_count(), 1);
            assert_eq!(store.reference_count(), 1);
            assert_eq!(store.import_count(), 1);
        }

        #[test]
        fn clear_removes_all_data() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "foo", file_id, 10);
            store.insert_symbol(symbol);

            store.clear();

            assert_eq!(store.file_count(), 0);
            assert_eq!(store.symbol_count(), 0);
            assert!(store.file_by_path("src/main.py").is_none());
            assert!(store.symbols_named("foo").is_empty());
        }
    }

    mod module_tests {
        use super::*;

        #[test]
        fn insert_and_retrieve_module() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/utils/__init__.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let module_id = store.next_module_id();
            let module = Module::new(
                module_id,
                "src.utils",
                ModuleKind::Package,
                None,
                Some(file_id),
            );
            store.insert_module(module);

            let retrieved = store.module(module_id).unwrap();
            assert_eq!(retrieved.path, "src.utils");
            assert_eq!(retrieved.kind, ModuleKind::Package);
            assert_eq!(retrieved.file_id, Some(file_id));
        }

        #[test]
        fn module_hierarchy() {
            let mut store = FactsStore::new();

            // Create parent module
            let parent_id = store.next_module_id();
            let parent = Module::new(parent_id, "myproject", ModuleKind::Package, None, None);
            store.insert_module(parent);

            // Create child module
            let child_id = store.next_module_id();
            let child = Module::new(
                child_id,
                "myproject.utils",
                ModuleKind::File,
                Some(parent_id),
                None,
            );
            store.insert_module(child);

            let retrieved_child = store.module(child_id).unwrap();
            assert_eq!(retrieved_child.parent_module_id, Some(parent_id));
        }
    }

    mod symbol_container_tests {
        use super::*;

        #[test]
        fn symbol_with_container() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create class symbol
            let class_id = store.next_symbol_id();
            let class_symbol = Symbol::new(
                class_id,
                SymbolKind::Class,
                "MyClass",
                file_id,
                Span::new(10, 17),
            );
            store.insert_symbol(class_symbol);

            // Create method symbol with class as container
            let method_id = store.next_symbol_id();
            let method_symbol = Symbol::new(
                method_id,
                SymbolKind::Method,
                "my_method",
                file_id,
                Span::new(30, 39),
            )
            .with_container(class_id);
            store.insert_symbol(method_symbol);

            let retrieved = store.symbol(method_id).unwrap();
            assert_eq!(retrieved.container_symbol_id, Some(class_id));
        }
    }

    mod import_tests {
        use super::*;

        #[test]
        fn star_import() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let import = test_import(&mut store, file_id, "os.path").with_star();
            let import_id = import.import_id;
            store.insert_import(import);

            let retrieved = store.import(import_id).unwrap();
            assert!(retrieved.is_star);
            assert_eq!(retrieved.effective_name(), None);
        }

        #[test]
        fn effective_name_prefers_alias() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let import = test_import(&mut store, file_id, "numpy")
                .with_imported_name("array")
                .with_alias("np_array");
            let import_id = import.import_id;
            store.insert_import(import);

            let retrieved = store.import(import_id).unwrap();
            assert_eq!(retrieved.effective_name(), Some("np_array"));
        }

        #[test]
        fn effective_name_falls_back_to_imported_name() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let import = test_import(&mut store, file_id, "os.path").with_imported_name("join");
            let import_id = import.import_id;
            store.insert_import(import);

            let retrieved = store.import(import_id).unwrap();
            assert_eq!(retrieved.effective_name(), Some("join"));
        }
    }

    mod scope_tests {
        use super::*;

        #[test]
        fn insert_and_retrieve_scope() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let scope_id = store.next_scope_id();
            let scope = ScopeInfo::new(scope_id, file_id, Span::new(0, 100), ScopeKind::Module);
            store.insert_scope(scope);

            let retrieved = store.scope(scope_id).unwrap();
            assert_eq!(retrieved.file_id, file_id);
            assert_eq!(retrieved.kind, ScopeKind::Module);
            assert_eq!(retrieved.span.start, 0);
            assert_eq!(retrieved.span.end, 100);
            assert!(retrieved.parent.is_none());
        }

        #[test]
        fn scope_with_parent_relationship() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create module scope (parent)
            let module_scope_id = store.next_scope_id();
            let module_scope = ScopeInfo::new(
                module_scope_id,
                file_id,
                Span::new(0, 200),
                ScopeKind::Module,
            );
            store.insert_scope(module_scope);

            // Create function scope (child)
            let func_scope_id = store.next_scope_id();
            let func_scope = ScopeInfo::new(
                func_scope_id,
                file_id,
                Span::new(10, 100),
                ScopeKind::Function,
            )
            .with_parent(module_scope_id);
            store.insert_scope(func_scope);

            // Create nested class scope (grandchild)
            let class_scope_id = store.next_scope_id();
            let class_scope =
                ScopeInfo::new(class_scope_id, file_id, Span::new(20, 80), ScopeKind::Class)
                    .with_parent(func_scope_id);
            store.insert_scope(class_scope);

            // Verify parent relationships
            let retrieved_func = store.scope(func_scope_id).unwrap();
            assert_eq!(retrieved_func.parent, Some(module_scope_id));

            let retrieved_class = store.scope(class_scope_id).unwrap();
            assert_eq!(retrieved_class.parent, Some(func_scope_id));
        }

        #[test]
        fn scopes_in_file_returns_all_scopes() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create multiple scopes
            let scope1_id = store.next_scope_id();
            let scope1 = ScopeInfo::new(scope1_id, file_id, Span::new(0, 200), ScopeKind::Module);
            store.insert_scope(scope1);

            let scope2_id = store.next_scope_id();
            let scope2 =
                ScopeInfo::new(scope2_id, file_id, Span::new(10, 100), ScopeKind::Function);
            store.insert_scope(scope2);

            let scope3_id = store.next_scope_id();
            let scope3 = ScopeInfo::new(scope3_id, file_id, Span::new(50, 90), ScopeKind::Lambda);
            store.insert_scope(scope3);

            let scopes = store.scopes_in_file(file_id);
            assert_eq!(scopes.len(), 3);

            // Verify deterministic ordering (by ScopeId)
            assert!(scopes[0].scope_id.0 < scopes[1].scope_id.0);
            assert!(scopes[1].scope_id.0 < scopes[2].scope_id.0);
        }

        #[test]
        fn scope_at_position_finds_innermost_scope() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create nested scopes:
            // Module: 0-200
            //   Function: 10-100
            //     Lambda: 50-90
            let module_id = store.next_scope_id();
            let module = ScopeInfo::new(module_id, file_id, Span::new(0, 200), ScopeKind::Module);
            store.insert_scope(module);

            let func_id = store.next_scope_id();
            let func = ScopeInfo::new(func_id, file_id, Span::new(10, 100), ScopeKind::Function);
            store.insert_scope(func);

            let lambda_id = store.next_scope_id();
            let lambda = ScopeInfo::new(lambda_id, file_id, Span::new(50, 90), ScopeKind::Lambda);
            store.insert_scope(lambda);

            // Position 60 is inside all three scopes - should return innermost (lambda)
            let innermost = store.scope_at_position(file_id, 60).unwrap();
            assert_eq!(innermost.kind, ScopeKind::Lambda);
            assert_eq!(innermost.scope_id, lambda_id);

            // Position 30 is inside module and function, but not lambda
            let mid = store.scope_at_position(file_id, 30).unwrap();
            assert_eq!(mid.kind, ScopeKind::Function);
            assert_eq!(mid.scope_id, func_id);

            // Position 5 is only inside module
            let outer = store.scope_at_position(file_id, 5).unwrap();
            assert_eq!(outer.kind, ScopeKind::Module);
            assert_eq!(outer.scope_id, module_id);

            // Position 150 is only inside module (outside function)
            let after_func = store.scope_at_position(file_id, 150).unwrap();
            assert_eq!(after_func.kind, ScopeKind::Module);
        }

        #[test]
        fn scope_at_position_returns_none_for_outside_all_scopes() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create scope that doesn't cover position 0
            let scope_id = store.next_scope_id();
            let scope = ScopeInfo::new(scope_id, file_id, Span::new(10, 100), ScopeKind::Function);
            store.insert_scope(scope);

            // Position 5 is outside the scope
            assert!(store.scope_at_position(file_id, 5).is_none());

            // Position 100 is at the boundary (exclusive end)
            assert!(store.scope_at_position(file_id, 100).is_none());
        }

        #[test]
        fn scope_contains_position() {
            let scope = ScopeInfo::new(
                ScopeId::new(0),
                FileId::new(0),
                Span::new(10, 50),
                ScopeKind::Function,
            );

            assert!(!scope.contains_position(9)); // before
            assert!(scope.contains_position(10)); // at start (inclusive)
            assert!(scope.contains_position(30)); // middle
            assert!(scope.contains_position(49)); // just before end
            assert!(!scope.contains_position(50)); // at end (exclusive)
            assert!(!scope.contains_position(51)); // after
        }

        #[test]
        fn all_scope_kinds() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Test all 5 ScopeKind variants
            let kinds = [
                ScopeKind::Module,
                ScopeKind::Class,
                ScopeKind::Function,
                ScopeKind::Comprehension,
                ScopeKind::Lambda,
            ];

            for (i, kind) in kinds.iter().enumerate() {
                let scope_id = store.next_scope_id();
                let scope = ScopeInfo::new(
                    scope_id,
                    file_id,
                    Span::new((i * 10) as u64, ((i + 1) * 10) as u64),
                    *kind,
                );
                store.insert_scope(scope);

                let retrieved = store.scope(scope_id).unwrap();
                assert_eq!(retrieved.kind, *kind);
            }

            assert_eq!(store.scope_count(), 5);
        }

        #[test]
        fn scope_kind_default() {
            assert_eq!(ScopeKind::default(), ScopeKind::Module);
        }

        #[test]
        fn scope_id_display() {
            let id = ScopeId::new(42);
            assert_eq!(format!("{}", id), "scope_42");
        }

        #[test]
        fn scope_id_ordering() {
            let id1 = ScopeId::new(1);
            let id2 = ScopeId::new(2);
            let id3 = ScopeId::new(3);

            assert!(id1 < id2);
            assert!(id2 < id3);
            assert!(id1 < id3);
        }

        #[test]
        fn scope_id_generation_is_sequential() {
            let mut store = FactsStore::new();

            let id1 = store.next_scope_id();
            let id2 = store.next_scope_id();
            let id3 = store.next_scope_id();

            assert_eq!(id1.0, 0);
            assert_eq!(id2.0, 1);
            assert_eq!(id3.0, 2);
        }

        #[test]
        fn scopes_across_multiple_files() {
            let mut store = FactsStore::new();

            let file1 = test_file(&mut store, "src/a.py");
            let file1_id = file1.file_id;
            store.insert_file(file1);

            let file2 = test_file(&mut store, "src/b.py");
            let file2_id = file2.file_id;
            store.insert_file(file2);

            // Add scopes to file1
            let scope1_id = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                scope1_id,
                file1_id,
                Span::new(0, 100),
                ScopeKind::Module,
            ));

            let scope2_id = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                scope2_id,
                file1_id,
                Span::new(10, 50),
                ScopeKind::Function,
            ));

            // Add scopes to file2
            let scope3_id = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                scope3_id,
                file2_id,
                Span::new(0, 200),
                ScopeKind::Module,
            ));

            // Verify scopes_in_file returns only scopes for that file
            assert_eq!(store.scopes_in_file(file1_id).len(), 2);
            assert_eq!(store.scopes_in_file(file2_id).len(), 1);

            // Verify scope_at_position respects file boundaries
            let scope_in_file1 = store.scope_at_position(file1_id, 25).unwrap();
            assert_eq!(scope_in_file1.kind, ScopeKind::Function);

            let scope_in_file2 = store.scope_at_position(file2_id, 25).unwrap();
            assert_eq!(scope_in_file2.kind, ScopeKind::Module);
        }

        #[test]
        fn scope_at_position_with_equal_size_nested_scopes() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Two scopes of equal size (pathological case)
            // In reality this shouldn't happen, but we should handle it deterministically
            let scope1_id = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                scope1_id,
                file_id,
                Span::new(10, 50),
                ScopeKind::Function,
            ));

            let scope2_id = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                scope2_id,
                file_id,
                Span::new(10, 50),
                ScopeKind::Lambda,
            ));

            // Both contain position 30 and have equal size - should return one deterministically
            let result = store.scope_at_position(file_id, 30);
            assert!(result.is_some());
        }

        #[test]
        fn scopes_iterator_is_deterministic() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Insert scopes in non-sequential order by span
            let id1 = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                id1,
                file_id,
                Span::new(100, 200),
                ScopeKind::Function,
            ));

            let id2 = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                id2,
                file_id,
                Span::new(0, 300),
                ScopeKind::Module,
            ));

            let id3 = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                id3,
                file_id,
                Span::new(50, 80),
                ScopeKind::Lambda,
            ));

            // Multiple iterations should return same order (by ScopeId due to BTreeMap)
            let iter1: Vec<_> = store.scopes().map(|s| s.scope_id).collect();
            let iter2: Vec<_> = store.scopes().map(|s| s.scope_id).collect();

            assert_eq!(iter1, iter2);
            assert_eq!(iter1, vec![id1, id2, id3]);
        }

        #[test]
        fn scope_count_accuracy() {
            let mut store = FactsStore::new();
            assert_eq!(store.scope_count(), 0);

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            for i in 0..10 {
                let id = store.next_scope_id();
                store.insert_scope(ScopeInfo::new(
                    id,
                    file_id,
                    Span::new(i * 10, (i + 1) * 10),
                    ScopeKind::Function,
                ));
            }

            assert_eq!(store.scope_count(), 10);
        }

        #[test]
        fn scope_not_found_returns_none() {
            let store = FactsStore::new();
            assert!(store.scope(ScopeId::new(999)).is_none());
        }

        #[test]
        fn scopes_in_file_empty_for_unknown_file() {
            let store = FactsStore::new();
            assert!(store.scopes_in_file(FileId::new(999)).is_empty());
        }

        #[test]
        fn deeply_nested_scopes() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create 5 levels of nesting
            // Module: 0-1000
            //   Class: 10-900
            //     Function: 20-800
            //       Comprehension: 30-700
            //         Lambda: 40-600
            let module_id = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                module_id,
                file_id,
                Span::new(0, 1000),
                ScopeKind::Module,
            ));

            let class_id = store.next_scope_id();
            store.insert_scope(
                ScopeInfo::new(class_id, file_id, Span::new(10, 900), ScopeKind::Class)
                    .with_parent(module_id),
            );

            let func_id = store.next_scope_id();
            store.insert_scope(
                ScopeInfo::new(func_id, file_id, Span::new(20, 800), ScopeKind::Function)
                    .with_parent(class_id),
            );

            let comp_id = store.next_scope_id();
            store.insert_scope(
                ScopeInfo::new(
                    comp_id,
                    file_id,
                    Span::new(30, 700),
                    ScopeKind::Comprehension,
                )
                .with_parent(func_id),
            );

            let lambda_id = store.next_scope_id();
            store.insert_scope(
                ScopeInfo::new(lambda_id, file_id, Span::new(40, 600), ScopeKind::Lambda)
                    .with_parent(comp_id),
            );

            // Position 50 is in all 5 scopes - should return innermost (lambda)
            let innermost = store.scope_at_position(file_id, 50).unwrap();
            assert_eq!(innermost.kind, ScopeKind::Lambda);
            assert_eq!(innermost.scope_id, lambda_id);

            // Verify parent chain
            assert_eq!(store.scope(lambda_id).unwrap().parent, Some(comp_id));
            assert_eq!(store.scope(comp_id).unwrap().parent, Some(func_id));
            assert_eq!(store.scope(func_id).unwrap().parent, Some(class_id));
            assert_eq!(store.scope(class_id).unwrap().parent, Some(module_id));
            assert_eq!(store.scope(module_id).unwrap().parent, None);
        }
    }

    mod type_tests {
        use super::*;

        #[test]
        fn insert_and_retrieve_type_info() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "x", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            let type_info = TypeInfo::new(symbol_id, "MyClass", TypeSource::Inferred);
            store.insert_type(type_info);

            let retrieved = store.type_of_symbol(symbol_id).unwrap();
            assert_eq!(retrieved.type_repr, "MyClass");
            assert_eq!(retrieved.source, TypeSource::Inferred);
        }

        #[test]
        fn type_info_annotated_constructor() {
            let symbol_id = SymbolId::new(42);
            let type_info = TypeInfo::annotated(symbol_id, "List[int]");

            assert_eq!(type_info.symbol_id, symbol_id);
            assert_eq!(type_info.type_repr, "List[int]");
            assert_eq!(type_info.source, TypeSource::Annotated);
        }

        #[test]
        fn type_info_inferred_constructor() {
            let symbol_id = SymbolId::new(42);
            let type_info = TypeInfo::inferred(symbol_id, "MyClass");

            assert_eq!(type_info.symbol_id, symbol_id);
            assert_eq!(type_info.type_repr, "MyClass");
            assert_eq!(type_info.source, TypeSource::Inferred);
        }

        #[test]
        fn insert_type_replaces_existing() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "x", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            // Insert inferred type
            let inferred = TypeInfo::inferred(symbol_id, "InferredType");
            store.insert_type(inferred);

            // Replace with annotated type
            let annotated = TypeInfo::annotated(symbol_id, "AnnotatedType");
            store.insert_type(annotated);

            // Should have the annotated type
            let retrieved = store.type_of_symbol(symbol_id).unwrap();
            assert_eq!(retrieved.type_repr, "AnnotatedType");
            assert_eq!(retrieved.source, TypeSource::Annotated);
        }

        #[test]
        fn type_of_symbol_returns_none_for_unknown() {
            let store = FactsStore::new();
            assert!(store.type_of_symbol(SymbolId::new(999)).is_none());
        }

        #[test]
        fn type_count_is_accurate() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let sym1 = test_symbol(&mut store, "x", file_id, 10);
            let sym1_id = sym1.symbol_id;
            store.insert_symbol(sym1);

            let sym2 = test_symbol(&mut store, "y", file_id, 20);
            let sym2_id = sym2.symbol_id;
            store.insert_symbol(sym2);

            store.insert_type(TypeInfo::inferred(sym1_id, "int"));
            store.insert_type(TypeInfo::annotated(sym2_id, "str"));

            assert_eq!(store.type_count(), 2);
        }

        #[test]
        fn type_source_default() {
            assert_eq!(TypeSource::default(), TypeSource::Unknown);
        }

        #[test]
        fn all_type_sources() {
            let symbol_id = SymbolId::new(1);

            let inferred = TypeInfo::new(symbol_id, "int", TypeSource::Inferred);
            assert_eq!(inferred.source, TypeSource::Inferred);

            let annotated = TypeInfo::new(symbol_id, "str", TypeSource::Annotated);
            assert_eq!(annotated.source, TypeSource::Annotated);

            let unknown = TypeInfo::new(symbol_id, "Any", TypeSource::Unknown);
            assert_eq!(unknown.source, TypeSource::Unknown);
        }

        #[test]
        fn type_info_with_complex_type_repr() {
            let symbol_id = SymbolId::new(1);

            // Generic types
            let generic = TypeInfo::annotated(symbol_id, "Dict[str, List[int]]");
            assert_eq!(generic.type_repr, "Dict[str, List[int]]");

            // Union types
            let union = TypeInfo::annotated(symbol_id, "Optional[str]");
            assert_eq!(union.type_repr, "Optional[str]");

            // Callable types
            let callable = TypeInfo::annotated(symbol_id, "Callable[[int, str], bool]");
            assert_eq!(callable.type_repr, "Callable[[int, str], bool]");
        }

        #[test]
        fn multiple_symbols_with_types() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create 10 symbols with types
            for i in 0..10 {
                let sym = test_symbol(&mut store, &format!("var{}", i), file_id, i * 10);
                let sym_id = sym.symbol_id;
                store.insert_symbol(sym);
                store.insert_type(TypeInfo::inferred(sym_id, format!("Type{}", i)));
            }

            assert_eq!(store.type_count(), 10);

            // Verify each can be retrieved
            for i in 0..10 {
                let sym_id = SymbolId::new(i);
                let type_info = store.type_of_symbol(sym_id).unwrap();
                assert_eq!(type_info.type_repr, format!("Type{}", i));
            }
        }

        #[test]
        fn type_info_equality() {
            let sym_id = SymbolId::new(1);

            let t1 = TypeInfo::new(sym_id, "MyClass", TypeSource::Inferred);
            let t2 = TypeInfo::new(sym_id, "MyClass", TypeSource::Inferred);
            let t3 = TypeInfo::new(sym_id, "MyClass", TypeSource::Annotated);
            let t4 = TypeInfo::new(sym_id, "OtherClass", TypeSource::Inferred);

            assert_eq!(t1, t2);
            assert_ne!(t1, t3); // Different source
            assert_ne!(t1, t4); // Different type_repr
        }

        #[test]
        fn type_info_clone() {
            let t1 = TypeInfo::annotated(SymbolId::new(1), "MyClass");
            let t2 = t1.clone();

            assert_eq!(t1, t2);
            assert_eq!(t1.symbol_id, t2.symbol_id);
            assert_eq!(t1.type_repr, t2.type_repr);
            assert_eq!(t1.source, t2.source);
        }
    }

    mod inheritance_tests {
        use super::*;

        #[test]
        fn insert_and_query_inheritance() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create parent class
            let parent_id = store.next_symbol_id();
            let parent = Symbol::new(
                parent_id,
                SymbolKind::Class,
                "Animal",
                file_id,
                Span::new(0, 50),
            );
            store.insert_symbol(parent);

            // Create child class
            let child_id = store.next_symbol_id();
            let child = Symbol::new(
                child_id,
                SymbolKind::Class,
                "Dog",
                file_id,
                Span::new(60, 120),
            );
            store.insert_symbol(child);

            // Record inheritance
            let inheritance = InheritanceInfo::new(child_id, parent_id);
            store.insert_inheritance(inheritance);

            // Query from parent's perspective
            let children = store.children_of_class(parent_id);
            assert_eq!(children.len(), 1);
            assert_eq!(children[0], child_id);

            // Query from child's perspective
            let parents = store.parents_of_class(child_id);
            assert_eq!(parents.len(), 1);
            assert_eq!(parents[0], parent_id);
        }

        #[test]
        fn multiple_inheritance() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create two parent classes
            let parent1_id = store.next_symbol_id();
            let parent1 = Symbol::new(
                parent1_id,
                SymbolKind::Class,
                "Flyable",
                file_id,
                Span::new(0, 30),
            );
            store.insert_symbol(parent1);

            let parent2_id = store.next_symbol_id();
            let parent2 = Symbol::new(
                parent2_id,
                SymbolKind::Class,
                "Swimmable",
                file_id,
                Span::new(40, 70),
            );
            store.insert_symbol(parent2);

            // Create child class that inherits from both
            let child_id = store.next_symbol_id();
            let child = Symbol::new(
                child_id,
                SymbolKind::Class,
                "Duck",
                file_id,
                Span::new(80, 140),
            );
            store.insert_symbol(child);

            // Record both inheritance relationships
            store.insert_inheritance(InheritanceInfo::new(child_id, parent1_id));
            store.insert_inheritance(InheritanceInfo::new(child_id, parent2_id));

            // Child should have two parents
            let parents = store.parents_of_class(child_id);
            assert_eq!(parents.len(), 2);
            assert!(parents.contains(&parent1_id));
            assert!(parents.contains(&parent2_id));

            // Each parent should have one child
            assert_eq!(store.children_of_class(parent1_id), vec![child_id]);
            assert_eq!(store.children_of_class(parent2_id), vec![child_id]);
        }

        #[test]
        fn class_hierarchy_with_multiple_children() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create parent class
            let parent_id = store.next_symbol_id();
            let parent = Symbol::new(
                parent_id,
                SymbolKind::Class,
                "Animal",
                file_id,
                Span::new(0, 50),
            );
            store.insert_symbol(parent);

            // Create multiple child classes
            let child1_id = store.next_symbol_id();
            let child1 = Symbol::new(
                child1_id,
                SymbolKind::Class,
                "Dog",
                file_id,
                Span::new(60, 100),
            );
            store.insert_symbol(child1);

            let child2_id = store.next_symbol_id();
            let child2 = Symbol::new(
                child2_id,
                SymbolKind::Class,
                "Cat",
                file_id,
                Span::new(110, 150),
            );
            store.insert_symbol(child2);

            let child3_id = store.next_symbol_id();
            let child3 = Symbol::new(
                child3_id,
                SymbolKind::Class,
                "Bird",
                file_id,
                Span::new(160, 200),
            );
            store.insert_symbol(child3);

            // Record inheritance for all children
            store.insert_inheritance(InheritanceInfo::new(child1_id, parent_id));
            store.insert_inheritance(InheritanceInfo::new(child2_id, parent_id));
            store.insert_inheritance(InheritanceInfo::new(child3_id, parent_id));

            // Parent should have three children
            let children = store.children_of_class(parent_id);
            assert_eq!(children.len(), 3);
            assert!(children.contains(&child1_id));
            assert!(children.contains(&child2_id));
            assert!(children.contains(&child3_id));
        }

        #[test]
        fn empty_inheritance_queries() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let class_id = store.next_symbol_id();
            let class = Symbol::new(
                class_id,
                SymbolKind::Class,
                "StandaloneClass",
                file_id,
                Span::new(0, 50),
            );
            store.insert_symbol(class);

            // No inheritance recorded
            assert!(store.children_of_class(class_id).is_empty());
            assert!(store.parents_of_class(class_id).is_empty());
        }

        #[test]
        fn inheritance_count_is_accurate() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let parent_id = store.next_symbol_id();
            let parent = Symbol::new(
                parent_id,
                SymbolKind::Class,
                "Base",
                file_id,
                Span::new(0, 30),
            );
            store.insert_symbol(parent);

            let child1_id = store.next_symbol_id();
            let child1 = Symbol::new(
                child1_id,
                SymbolKind::Class,
                "Child1",
                file_id,
                Span::new(40, 70),
            );
            store.insert_symbol(child1);

            let child2_id = store.next_symbol_id();
            let child2 = Symbol::new(
                child2_id,
                SymbolKind::Class,
                "Child2",
                file_id,
                Span::new(80, 110),
            );
            store.insert_symbol(child2);

            store.insert_inheritance(InheritanceInfo::new(child1_id, parent_id));
            store.insert_inheritance(InheritanceInfo::new(child2_id, parent_id));

            assert_eq!(store.inheritance_count(), 2);
        }

        #[test]
        fn inheritance_iterator() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let parent_id = store.next_symbol_id();
            let parent = Symbol::new(
                parent_id,
                SymbolKind::Class,
                "Base",
                file_id,
                Span::new(0, 30),
            );
            store.insert_symbol(parent);

            let child_id = store.next_symbol_id();
            let child = Symbol::new(
                child_id,
                SymbolKind::Class,
                "Child",
                file_id,
                Span::new(40, 70),
            );
            store.insert_symbol(child);

            store.insert_inheritance(InheritanceInfo::new(child_id, parent_id));

            let relationships: Vec<_> = store.inheritance().collect();
            assert_eq!(relationships.len(), 1);
            assert_eq!(relationships[0].child_id, child_id);
            assert_eq!(relationships[0].parent_id, parent_id);
        }

        #[test]
        fn inheritance_info_equality() {
            let child1 = SymbolId::new(1);
            let child2 = SymbolId::new(2);
            let parent1 = SymbolId::new(10);
            let parent2 = SymbolId::new(20);

            let i1 = InheritanceInfo::new(child1, parent1);
            let i2 = InheritanceInfo::new(child1, parent1);
            let i3 = InheritanceInfo::new(child2, parent1);
            let i4 = InheritanceInfo::new(child1, parent2);

            assert_eq!(i1, i2);
            assert_ne!(i1, i3); // Different child
            assert_ne!(i1, i4); // Different parent
        }

        #[test]
        fn inheritance_info_clone() {
            let info = InheritanceInfo::new(SymbolId::new(1), SymbolId::new(2));
            let cloned = info.clone();

            assert_eq!(info, cloned);
            assert_eq!(info.child_id, cloned.child_id);
            assert_eq!(info.parent_id, cloned.parent_id);
        }

        #[test]
        fn diamond_inheritance() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Diamond pattern:
            //      A
            //     / \
            //    B   C
            //     \ /
            //      D
            let a_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                a_id,
                SymbolKind::Class,
                "A",
                file_id,
                Span::new(0, 10),
            ));

            let b_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                b_id,
                SymbolKind::Class,
                "B",
                file_id,
                Span::new(20, 30),
            ));

            let c_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                c_id,
                SymbolKind::Class,
                "C",
                file_id,
                Span::new(40, 50),
            ));

            let d_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                d_id,
                SymbolKind::Class,
                "D",
                file_id,
                Span::new(60, 70),
            ));

            // B and C inherit from A
            store.insert_inheritance(InheritanceInfo::new(b_id, a_id));
            store.insert_inheritance(InheritanceInfo::new(c_id, a_id));

            // D inherits from B and C
            store.insert_inheritance(InheritanceInfo::new(d_id, b_id));
            store.insert_inheritance(InheritanceInfo::new(d_id, c_id));

            // A has two children (B and C)
            let a_children = store.children_of_class(a_id);
            assert_eq!(a_children.len(), 2);
            assert!(a_children.contains(&b_id));
            assert!(a_children.contains(&c_id));

            // D has two parents (B and C)
            let d_parents = store.parents_of_class(d_id);
            assert_eq!(d_parents.len(), 2);
            assert!(d_parents.contains(&b_id));
            assert!(d_parents.contains(&c_id));

            // B has one parent (A) and one child (D)
            assert_eq!(store.parents_of_class(b_id), vec![a_id]);
            assert_eq!(store.children_of_class(b_id), vec![d_id]);
        }

        #[test]
        fn deep_inheritance_chain() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Chain: A -> B -> C -> D -> E
            let mut prev_id: Option<SymbolId> = None;
            let mut class_ids = Vec::new();

            for i in 0..5 {
                let class_id = store.next_symbol_id();
                let name = format!("Class{}", (b'A' + i as u8) as char);
                store.insert_symbol(Symbol::new(
                    class_id,
                    SymbolKind::Class,
                    name,
                    file_id,
                    Span::new(i * 20, (i + 1) * 20),
                ));

                if let Some(parent) = prev_id {
                    store.insert_inheritance(InheritanceInfo::new(class_id, parent));
                }

                class_ids.push(class_id);
                prev_id = Some(class_id);
            }

            // Verify the chain
            assert!(store.parents_of_class(class_ids[0]).is_empty()); // A has no parent
            assert_eq!(store.parents_of_class(class_ids[1]), vec![class_ids[0]]); // B -> A
            assert_eq!(store.parents_of_class(class_ids[2]), vec![class_ids[1]]); // C -> B
            assert_eq!(store.parents_of_class(class_ids[3]), vec![class_ids[2]]); // D -> C
            assert_eq!(store.parents_of_class(class_ids[4]), vec![class_ids[3]]); // E -> D

            assert_eq!(store.children_of_class(class_ids[0]), vec![class_ids[1]]); // A -> B
            assert!(store.children_of_class(class_ids[4]).is_empty()); // E has no children
        }
    }

    mod clear_tests {
        use super::*;

        #[test]
        fn clear_removes_all_new_fields() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Add scopes
            let scope_id = store.next_scope_id();
            store.insert_scope(ScopeInfo::new(
                scope_id,
                file_id,
                Span::new(0, 100),
                ScopeKind::Module,
            ));

            // Add symbols and types
            let sym = test_symbol(&mut store, "x", file_id, 10);
            let sym_id = sym.symbol_id;
            store.insert_symbol(sym);
            store.insert_type(TypeInfo::inferred(sym_id, "int"));

            // Add inheritance
            let parent_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                parent_id,
                SymbolKind::Class,
                "Parent",
                file_id,
                Span::new(20, 40),
            ));
            let child_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                child_id,
                SymbolKind::Class,
                "Child",
                file_id,
                Span::new(50, 70),
            ));
            store.insert_inheritance(InheritanceInfo::new(child_id, parent_id));

            // Verify data exists
            assert!(store.scope_count() > 0);
            assert!(store.type_count() > 0);
            assert!(store.inheritance_count() > 0);
            assert!(!store.scopes_in_file(file_id).is_empty());

            // Clear everything
            store.clear();

            // Verify all new fields are cleared
            assert_eq!(store.scope_count(), 0);
            assert_eq!(store.type_count(), 0);
            assert_eq!(store.inheritance_count(), 0);
            assert!(store.scopes_in_file(file_id).is_empty());
            assert!(store.type_of_symbol(sym_id).is_none());
            assert!(store.children_of_class(parent_id).is_empty());
            assert!(store.parents_of_class(child_id).is_empty());
            assert!(store.scope(scope_id).is_none());

            // Also verify existing fields are cleared
            assert_eq!(store.file_count(), 0);
            assert_eq!(store.symbol_count(), 0);
        }

        #[test]
        fn clear_preserves_id_generators() {
            let mut store = FactsStore::new();

            // Generate some IDs
            let _ = store.next_file_id();
            let _ = store.next_scope_id();
            let _ = store.next_scope_id();

            store.clear();

            // IDs should continue from where they were, not reset
            let file_id = store.next_file_id();
            let scope_id = store.next_scope_id();

            assert_eq!(file_id.0, 1);
            assert_eq!(scope_id.0, 2);
        }
    }
}
