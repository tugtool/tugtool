//! Facts model: normalized code facts tables and indexes.
//!
//! This module provides the semantic program data model for tug:
//! - [`File`]: Source files with content hashes
//! - [`Module`]: Language modules with hierarchy
//! - [`Symbol`]: Symbol definitions (functions, classes, variables, etc.)
//! - [`Reference`]: Usages of symbols
//! - [`Import`]: Import statements
//! - [`PublicExport`]: Language-agnostic export declarations
//!
//! The [`FactsStore`] provides in-memory storage with:
//! - Hash maps for O(1) ID lookups
//! - Postings lists for efficient queries (symbol → refs, file → imports)
//! - Deterministic iteration order
//!
//! # Visibility Model
//!
//! The [`Visibility`] enum provides a language-agnostic access control model that
//! generalizes across supported languages. See the enum documentation for details.
//!
//! ## Language Mapping
//!
//! | Language | Public | Crate | Module | Private | Protected |
//! |----------|--------|-------|--------|---------|-----------|
//! | **Rust** | `pub` | `pub(crate)` | `pub(super)` | (default) | N/A |
//! | **Python** | (default) | N/A | N/A | `_name` | N/A |
//! | **Java** | `public` | `package` | N/A | `private` | `protected` |
//! | **Go** | Uppercase | lowercase | N/A | lowercase | N/A |
//!
//! For Python, visibility is **optional** and can be inferred from naming conventions
//! when enabled via analyzer options. By default, Python symbols have `visibility = None`.
//!
//! # Export Model
//!
//! The [`PublicExport`] type provides a unified export model across languages.
//! An export is a declaration that makes a symbol accessible from outside its
//! defining scope. Different languages have different mechanisms:
//!
//! | Language | Export Mechanism | Example |
//! |----------|------------------|---------|
//! | Python | `__all__` list | `__all__ = ["foo", "bar"]` |
//! | Rust | `pub use` | `pub use crate::internal::Foo;` |
//! | TypeScript | `export` keyword | `export { foo, bar };` |
//! | Go | Uppercase name | `func Foo()` vs `func foo()` |
//!
//! ## Declared vs Effective Exports
//!
//! - **Declared** ([`ExportIntent::Declared`]): Explicit export statements or lists
//! - **Effective** ([`ExportIntent::Effective`]): Resulting public API after language rules
//!
//! ## Export Origin
//!
//! - **Local** ([`ExportOrigin::Local`]): Symbol defined in the same module
//! - **ReExport** ([`ExportOrigin::ReExport`]): Symbol re-exported from another module
//! - **Implicit** ([`ExportOrigin::Implicit`]): No explicit export (e.g., Go uppercase)
//!
//! # Schema Versioning
//!
//! The [`FACTS_SCHEMA_VERSION`] constant tracks breaking changes to the FactsStore
//! schema. This is independent of the agent-facing output schema version in `output.rs`.

use crate::output::AliasOutput;
use crate::patch::{ContentHash, FileId, Span};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

// ============================================================================
// Schema Version
// ============================================================================

/// Schema version for FactsStore serialization.
///
/// This version tracks breaking changes to the internal FactsStore schema.
/// It is independent of the agent-facing output schema version in `output.rs`.
///
/// Increment this when:
/// - Adding/removing fields from serialized structs
/// - Changing field types or serialization format
/// - Breaking changes to enum variants
pub const FACTS_SCHEMA_VERSION: u32 = 11;

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

/// Unique identifier for a public export within a snapshot.
///
/// This is the language-agnostic export model for tracking public API exports
/// across all supported languages (Python `__all__`, Rust `pub use`, etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct PublicExportId(pub u32);

impl PublicExportId {
    /// Create a new public export ID.
    pub fn new(id: u32) -> Self {
        PublicExportId(id)
    }
}

impl std::fmt::Display for PublicExportId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "pub_exp_{}", self.0)
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

/// Unique identifier for an alias edge within a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct AliasEdgeId(pub u32);

impl AliasEdgeId {
    /// Create a new alias edge ID.
    pub fn new(id: u32) -> Self {
        AliasEdgeId(id)
    }
}

impl std::fmt::Display for AliasEdgeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "alias_{}", self.0)
    }
}

/// Unique identifier for an attribute access within a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct AttributeAccessId(pub u32);

impl AttributeAccessId {
    /// Create a new attribute access ID.
    pub fn new(id: u32) -> Self {
        AttributeAccessId(id)
    }
}

impl std::fmt::Display for AttributeAccessId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "attr_{}", self.0)
    }
}

/// Unique identifier for a call site within a snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct CallSiteId(pub u32);

impl CallSiteId {
    /// Create a new call site ID.
    pub fn new(id: u32) -> Self {
        CallSiteId(id)
    }
}

impl std::fmt::Display for CallSiteId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "call_{}", self.0)
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
    /// Single-file module (e.g., `foo.rs`, `foo.py`).
    #[default]
    File,
    /// Directory-based module/package (Rust mod.rs, Go package, Python package).
    Directory,
    /// Inline module defined within another file (Rust `mod foo { ... }`).
    Inline,
    /// Namespace module (no concrete file, language-defined).
    Namespace,
}

/// Kind of import statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ImportKind {
    /// `import module` (Python), `use module` (Rust), `import * as` (TS)
    #[default]
    Module,
    /// `from module import name`
    Named,
    /// `import module as alias` or `from module import name as alias`
    Alias,
    /// `from module import *` / glob import
    Glob,
    /// Re-export (e.g., Rust `pub use`, TypeScript `export { ... } from`)
    ReExport,
    /// Default import (JavaScript/TypeScript)
    Default,
}

/// Kind of alias relationship.
///
/// Classifies how an alias was created, enabling language-agnostic
/// alias chain reasoning for refactoring operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum AliasKind {
    /// Direct assignment alias (e.g., Python `b = a`).
    #[default]
    Assignment,
    /// Alias created via import (e.g., Python `from foo import bar as baz`).
    Import,
    /// Re-export alias (e.g., Rust `pub use foo::Bar as Baz`).
    ReExport,
    /// Unknown or unclassified alias.
    Unknown,
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
    /// Delete expression (e.g., Python `del`).
    Delete,
}

impl ReferenceKind {
    /// Convert to spec-compliant output kind string.
    ///
    /// Per 26.0.7 spec, valid kinds are: definition, call, reference, import, attribute.
    /// Internal kinds that don't map directly are converted to the closest equivalent:
    /// - `TypeAnnotation` → `"reference"` (type annotations are a form of reference)
    /// - `Write` → `"reference"` (writes are references with assignment)
    /// - `Delete` → `"reference"` (deletes are write-like operations)
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
            ReferenceKind::Delete => "reference",
        }
    }
}

/// Kind of scope in the code.
///
/// This enum is `#[non_exhaustive]` to allow adding language-specific variants
/// without breaking downstream code. Match statements should include a wildcard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
#[non_exhaustive]
pub enum ScopeKind {
    // ========================================================================
    // Language-agnostic variants
    // ========================================================================
    /// Module-level scope.
    #[default]
    Module,
    /// Class body scope (Python class, Rust struct/enum conceptually).
    Class,
    /// Function/method body scope.
    Function,

    // ========================================================================
    // Python-specific variants
    // ========================================================================
    /// List/dict/set/generator comprehension scope (Python-specific).
    Comprehension,
    /// Lambda expression scope (Python-specific; Rust closures use `Closure`).
    Lambda,

    // ========================================================================
    // Rust-specific variants
    // ========================================================================
    /// Rust impl block scope.
    Impl,
    /// Rust trait definition scope.
    Trait,
    /// Rust closure scope (different from Python lambda due to capture semantics).
    Closure,
    /// Rust unsafe block scope.
    Unsafe,
    /// Rust match arm scope (pattern bindings create a new scope).
    MatchArm,
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

/// Kind of parameter in a function/method signature.
///
/// This enum is `#[non_exhaustive]` to allow adding language-specific variants
/// without breaking downstream code. Match statements should include a wildcard.
///
/// # Language Support
///
/// - **Python**: `Regular`, `PositionalOnly`, `KeywordOnly`, `VarArgs`, `KwArgs`
/// - **Rust**: `Regular`, `SelfValue`, `SelfRef`, `SelfMutRef`
/// - **Other languages**: Use `Regular` for standard parameters
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
#[non_exhaustive]
pub enum ParamKind {
    // ========================================================================
    // Language-agnostic variants
    // ========================================================================
    /// Standard named parameter (default).
    #[default]
    Regular,

    // ========================================================================
    // Python-specific variants
    // ========================================================================
    /// Python positional-only parameter (before `/` separator).
    PositionalOnly,
    /// Python keyword-only parameter (after `*` separator).
    KeywordOnly,
    /// Python variadic positional parameter (`*args`).
    VarArgs,
    /// Python variadic keyword parameter (`**kwargs`).
    KwArgs,

    // ========================================================================
    // Rust-specific variants
    // ========================================================================
    /// Rust `self` (move semantics).
    SelfValue,
    /// Rust `&self` (shared reference).
    SelfRef,
    /// Rust `&mut self` (mutable reference).
    SelfMutRef,
}

/// Access control level for a symbol.
///
/// This enum generalizes visibility across languages:
/// - Rust: `pub` → Public, `pub(crate)` → Crate, `pub(super)` → Module, private → Private
/// - Python: public → Public (opt-in), `_name` → Private, `__name` → Private
/// - Java/C++: public/private/protected map directly
/// - Go: uppercase → Public, lowercase → Private
///
/// # Language-Specific Mapping
///
/// ## Rust
///
/// | Rust Syntax | Visibility |
/// |-------------|------------|
/// | `pub` | [`Visibility::Public`] |
/// | `pub(crate)` | [`Visibility::Crate`] |
/// | `pub(super)` | [`Visibility::Module`] |
/// | `pub(in path)` | [`Visibility::Module`] (approximation) |
/// | (default) | [`Visibility::Private`] |
///
/// ## Python
///
/// Python has no formal visibility syntax. When visibility inference is enabled:
///
/// | Python Pattern | Visibility |
/// |----------------|------------|
/// | `name` | `None` (no inference) or `Public` |
/// | `_name` | [`Visibility::Private`] (convention) |
/// | `__name` | [`Visibility::Private`] (name mangling) |
/// | `__name__` | [`Visibility::Public`] (dunder methods) |
///
/// # Examples
///
/// ```
/// use tugtool_core::facts::Visibility;
///
/// // Rust public function
/// let vis = Visibility::Public;
/// assert_eq!(vis, Visibility::Public);
///
/// // Rust crate-private item
/// let vis = Visibility::Crate;
/// assert_eq!(format!("{:?}", vis), "Crate");
///
/// // Python private convention (_name)
/// let vis = Visibility::Private;
/// assert_eq!(vis, Visibility::Private);
/// ```
///
/// # Serialization
///
/// Visibility serializes to snake_case strings:
///
/// ```
/// use tugtool_core::facts::Visibility;
///
/// let vis = Visibility::Public;
/// assert_eq!(serde_json::to_string(&vis).unwrap(), "\"public\"");
///
/// let vis = Visibility::Crate;
/// assert_eq!(serde_json::to_string(&vis).unwrap(), "\"crate\"");
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    /// Accessible from anywhere (Python default, Rust `pub`).
    Public,
    /// Accessible within the crate/package (Rust `pub(crate)`).
    Crate,
    /// Accessible within the module and descendants (Rust `pub(super)`).
    Module,
    /// Accessible only within the defining scope (Rust private, Python `_name`).
    Private,
    /// Accessible within the class hierarchy (Java/C++ protected).
    Protected,
}

/// Kind of attribute access.
///
/// Classifies how an attribute is being accessed, enabling method resolution,
/// property refactors, and safe member renames.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum AttributeAccessKind {
    /// Attribute read (e.g., `x = obj.attr`).
    #[default]
    Read,
    /// Attribute write (e.g., `obj.attr = x`).
    Write,
    /// Attribute call (e.g., `obj.method()`).
    Call,
}

/// Semantic modifier on a symbol.
///
/// Captures semantic attributes (async, static, property, etc.) in a
/// language-agnostic way. Modifiers are stored per-symbol and can be
/// queried efficiently.
///
/// This enum is `#[non_exhaustive]` to allow adding language-specific
/// variants without breaking downstream code.
///
/// # Language Support
///
/// - **Python**: `Async`, `Static`, `ClassMethod`, `Property`, `Abstract`, `Generator`
/// - **Rust**: `Async` (async fn), potentially others in future
/// - **Java/TypeScript**: `Static`, `Abstract`, `Final`, `Override`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum Modifier {
    /// Async function/method (Python `async def`, Rust `async fn`).
    Async,
    /// Static method (Python `@staticmethod`).
    Static,
    /// Class method (Python `@classmethod`).
    ClassMethod,
    /// Property accessor (Python `@property`).
    Property,
    /// Abstract method (Python `@abstractmethod`, Java `abstract`).
    Abstract,
    /// Final/sealed method or class (Python `@final`, Java `final`).
    Final,
    /// Override of base class method (Python `@override`, Java `@Override`).
    Override,
    /// Generator function (Python function with `yield`).
    Generator,
}

// ============================================================================
// Export Model Types
// ============================================================================

/// The mechanism used to export a symbol.
///
/// Classifies the language-specific syntax used for the export. This allows
/// consumers to handle language-specific cases while using the common
/// `PublicExport` type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportKind {
    /// Python `__all__` string literal.
    PythonAll,
    /// Rust `pub use` re-export (named).
    RustPubUse,
    /// Rust `pub use` glob re-export (`pub use foo::*;`).
    RustPubUseGlob,
    /// Rust `pub mod` (module re-export).
    RustPubMod,
    /// JavaScript/TypeScript export statement.
    JsExport,
    /// Go exported identifier (uppercase).
    GoExported,
}

/// What kind of target this export represents.
///
/// Classifies the intent of the export, which affects how consumers
/// resolve and handle it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportTarget {
    /// A single named symbol (e.g., `pub use foo::Bar;`, `__all__ = ["foo"]`).
    Single,
    /// A glob export (e.g., `pub use foo::*;`).
    Glob,
    /// A module export (e.g., `pub mod bar;`).
    Module,
    /// Implicit export by naming convention (e.g., Go uppercase).
    Implicit,
}

/// Declared vs effective export entry.
///
/// Distinguishes between explicit export declarations and computed
/// public API entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportIntent {
    /// Explicit declaration site (e.g., `__all__`, `pub use`, `export` statement).
    Declared,
    /// Effective public API entry (includes derived/re-exported visibility).
    Effective,
}

/// Origin classification for exports.
///
/// Tracks where an exported symbol originates, enabling re-export chain
/// reasoning and move-module refactors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportOrigin {
    /// Exported from the same module where it is defined.
    Local,
    /// Exported via re-export from another module.
    ReExport,
    /// Exported implicitly (e.g., Go uppercase, Rust `pub` items).
    Implicit,
    /// Unknown or unresolved origin.
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
    /// Declaration span for inline modules (None for file/directory modules).
    ///
    /// For Rust `mod foo { ... }`, this is the span of the module declaration.
    /// For Python modules, this is always `None` since Python does not support
    /// inline module definitions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decl_span: Option<Span>,
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
            decl_span: None,
        }
    }

    /// Set the declaration span for inline modules.
    ///
    /// Use this for Rust `mod foo { ... }` blocks within a file.
    pub fn with_decl_span(mut self, span: Span) -> Self {
        self.decl_span = Some(span);
        self
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
    /// Visibility/access control for this symbol.
    ///
    /// `None` for languages without visibility semantics (Python default).
    /// `Some(visibility)` for languages with explicit access control (Rust).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<Visibility>,
}

impl Symbol {
    /// Create a new symbol entry.
    ///
    /// Visibility defaults to `None` (not analyzed). Use `with_visibility()` to set it.
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
            visibility: None,
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

    /// Set the visibility.
    pub fn with_visibility(mut self, visibility: Visibility) -> Self {
        self.visibility = Some(visibility);
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
    /// Kind of import statement.
    pub kind: ImportKind,
}

impl Import {
    /// Create a new import entry.
    ///
    /// Defaults to `ImportKind::Module` (bare `import foo`).
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
            kind: ImportKind::Module,
        }
    }

    /// Set the imported name. Auto-sets kind to `Named`.
    ///
    /// Example: `from foo import bar` → `Import::new(...).with_imported_name("bar")`
    pub fn with_imported_name(mut self, name: impl Into<String>) -> Self {
        self.imported_name = Some(name.into());
        // Auto-set kind to Named (unless overridden by with_kind or higher-precedence builder)
        self.kind = self.derive_kind_with_named();
        self
    }

    /// Set the alias. Auto-sets kind to `Alias`.
    ///
    /// Example: `from foo import bar as baz` → `Import::new(...).with_imported_name("bar").with_alias("baz")`
    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.alias = Some(alias.into());
        // Auto-set kind to Alias (unless overridden by with_kind or higher-precedence builder)
        self.kind = self.derive_kind_with_alias();
        self
    }

    /// Set as glob import. Sets kind to `Glob`.
    ///
    /// Example: `from foo import *` → `Import::new(...).with_glob()`
    pub fn with_glob(mut self) -> Self {
        self.kind = ImportKind::Glob;
        self
    }

    /// Explicit kind override for `ReExport`, `Default`, etc.
    ///
    /// This overrides any auto-derived kinds from `with_imported_name` or `with_alias`.
    pub fn with_kind(mut self, kind: ImportKind) -> Self {
        self.kind = kind;
        self
    }

    /// Get the effective name (alias if present, otherwise imported_name).
    pub fn effective_name(&self) -> Option<&str> {
        self.alias.as_deref().or(self.imported_name.as_deref())
    }

    /// Derive import kind considering Named precedence.
    ///
    /// Order-independent: Alias > Named > Module
    fn derive_kind_with_named(&self) -> ImportKind {
        if self.alias.is_some() {
            ImportKind::Alias
        } else {
            ImportKind::Named
        }
    }

    /// Derive import kind considering Alias precedence.
    ///
    /// Order-independent: Alias > Named > Module
    fn derive_kind_with_alias(&self) -> ImportKind {
        // Alias has higher precedence than Named, so always return Alias
        ImportKind::Alias
    }
}

/// Language-agnostic representation of a public export.
///
/// This is the canonical export model for all supported languages:
/// - Python `__all__` entries
/// - Rust `pub use` and `pub mod` re-exports
/// - JavaScript/TypeScript `export` statements
/// - Go uppercase identifier exports
///
/// # Span Semantics
///
/// For Python `__all__ = ["foo", "bar"]`:
/// - `decl_span` covers `"foo"` (full string literal including quotes)
/// - `exported_name_span` covers `foo` (string content only, no quotes)
///
/// This enables safe rename operations that preserve quote characters.
///
/// # Examples
///
/// ## Creating a Python `__all__` Export
///
/// ```
/// use tugtool_core::facts::{
///     PublicExport, PublicExportId, ExportKind, ExportTarget,
///     ExportIntent, ExportOrigin,
/// };
/// use tugtool_core::patch::{FileId, Span};
///
/// let export = PublicExport::new(
///     PublicExportId(1),
///     FileId(1),
///     Span::new(100, 105),  // decl_span covers "foo"
///     ExportKind::PythonAll,
///     ExportTarget::Single,
///     ExportIntent::Declared,
///     ExportOrigin::Local,
/// )
/// .with_name("foo")
/// .with_exported_name_span(Span::new(101, 104));  // content without quotes
///
/// assert_eq!(export.exported_name, Some("foo".into()));
/// assert!(export.is_single());
/// assert!(export.is_declared());
/// ```
///
/// ## Creating a Rust `pub use` Re-export with Alias
///
/// ```
/// use tugtool_core::facts::{
///     PublicExport, PublicExportId, ExportKind, ExportTarget,
///     ExportIntent, ExportOrigin,
/// };
/// use tugtool_core::patch::{FileId, Span};
///
/// // For `pub use foo::Bar as Baz;`
/// let export = PublicExport::new(
///     PublicExportId(2),
///     FileId(1),
///     Span::new(0, 24),  // full declaration span
///     ExportKind::RustPubUse,
///     ExportTarget::Single,
///     ExportIntent::Declared,
///     ExportOrigin::ReExport,
/// )
/// .with_exported_name("Baz")  // the alias
/// .with_source_name("Bar");   // original name
///
/// assert_eq!(export.exported_name, Some("Baz".into()));
/// assert_eq!(export.source_name, Some("Bar".into()));
/// assert!(!export.is_local());
/// ```
///
/// ## Serialization
///
/// PublicExport serializes to JSON with optional fields omitted when `None`:
///
/// ```
/// use tugtool_core::facts::{
///     PublicExport, PublicExportId, ExportKind, ExportTarget,
///     ExportIntent, ExportOrigin,
/// };
/// use tugtool_core::patch::{FileId, Span};
///
/// let export = PublicExport::new(
///     PublicExportId(1),
///     FileId(1),
///     Span::new(10, 20),
///     ExportKind::PythonAll,
///     ExportTarget::Single,
///     ExportIntent::Declared,
///     ExportOrigin::Local,
/// )
/// .with_name("process_data");
///
/// let json = serde_json::to_string_pretty(&export).unwrap();
/// assert!(json.contains("\"exported_name\": \"process_data\""));
/// assert!(json.contains("\"export_kind\": \"python_all\""));
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicExport {
    /// Unique identifier for this export.
    pub export_id: PublicExportId,
    /// The symbol being exported (if resolved).
    ///
    /// `None` for glob exports (`pub use foo::*;`) or unresolved exports.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol_id: Option<SymbolId>,
    /// File containing this export declaration.
    pub file_id: FileId,
    /// Name as exported (may differ from symbol name due to aliasing).
    ///
    /// `None` for glob exports (`pub use foo::*;`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_name: Option<String>,
    /// Original name in source (for rename operations).
    ///
    /// `None` for glob exports or implicit exports (e.g., Go uppercase).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    /// Byte span of the entire export declaration.
    pub decl_span: Span,
    /// Byte span of the exported name (alias or `__all__` string content).
    ///
    /// For Python `__all__`, this points at the string content (no quotes).
    /// `None` for glob/implicit exports where no explicit name exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_name_span: Option<Span>,
    /// Byte span of the source/original name in the declaration.
    ///
    /// `None` for implicit exports or when source name is not present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name_span: Option<Span>,
    /// Whether this is a declared export or an effective/export-surface entry.
    pub export_intent: ExportIntent,
    /// Where this export originates (local vs re-export vs implicit).
    pub export_origin: ExportOrigin,
    /// Module that originated the export (re-export chain support).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_module_id: Option<ModuleId>,
    /// Optional pointer to a prior export in the chain (when available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_export_id: Option<PublicExportId>,
    /// Kind of export mechanism (language-specific).
    pub export_kind: ExportKind,
    /// Target classification (single, glob, module, implicit).
    pub export_target: ExportTarget,
}

impl PublicExport {
    /// Create a new public export entry.
    ///
    /// Most fields default to `None`. Use builder methods to set them.
    pub fn new(
        export_id: PublicExportId,
        file_id: FileId,
        decl_span: Span,
        export_kind: ExportKind,
        export_target: ExportTarget,
        export_intent: ExportIntent,
        export_origin: ExportOrigin,
    ) -> Self {
        PublicExport {
            export_id,
            symbol_id: None,
            file_id,
            exported_name: None,
            source_name: None,
            decl_span,
            exported_name_span: None,
            source_name_span: None,
            export_intent,
            export_origin,
            origin_module_id: None,
            origin_export_id: None,
            export_kind,
            export_target,
        }
    }

    /// Set the symbol ID for this export.
    pub fn with_symbol(mut self, symbol_id: SymbolId) -> Self {
        self.symbol_id = Some(symbol_id);
        self
    }

    /// Set the exported name.
    pub fn with_exported_name(mut self, name: impl Into<String>) -> Self {
        self.exported_name = Some(name.into());
        self
    }

    /// Set the source name.
    pub fn with_source_name(mut self, name: impl Into<String>) -> Self {
        self.source_name = Some(name.into());
        self
    }

    /// Set both exported and source names to the same value.
    ///
    /// Use this for non-aliased exports where the name doesn't change.
    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        let name = name.into();
        self.exported_name = Some(name.clone());
        self.source_name = Some(name);
        self
    }

    /// Set the exported name span.
    pub fn with_exported_name_span(mut self, span: Span) -> Self {
        self.exported_name_span = Some(span);
        self
    }

    /// Set the source name span.
    pub fn with_source_name_span(mut self, span: Span) -> Self {
        self.source_name_span = Some(span);
        self
    }

    /// Set the origin module ID for re-exports.
    pub fn with_origin_module(mut self, module_id: ModuleId) -> Self {
        self.origin_module_id = Some(module_id);
        self
    }

    /// Set the origin export ID for re-export chains.
    pub fn with_origin_export(mut self, export_id: PublicExportId) -> Self {
        self.origin_export_id = Some(export_id);
        self
    }

    /// Check if this is a glob export.
    pub fn is_glob(&self) -> bool {
        self.export_target == ExportTarget::Glob
    }

    /// Check if this is a single-symbol export.
    pub fn is_single(&self) -> bool {
        self.export_target == ExportTarget::Single
    }

    /// Check if this is a declared export.
    pub fn is_declared(&self) -> bool {
        self.export_intent == ExportIntent::Declared
    }

    /// Check if this is an effective export.
    pub fn is_effective(&self) -> bool {
        self.export_intent == ExportIntent::Effective
    }

    /// Check if this is a re-export.
    pub fn is_reexport(&self) -> bool {
        self.export_origin == ExportOrigin::ReExport
    }

    /// Check if this is a local export.
    pub fn is_local(&self) -> bool {
        self.export_origin == ExportOrigin::Local
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
    pub fn contains_position(&self, position: usize) -> bool {
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
    /// Optional structured type representation.
    ///
    /// When present, provides machine-readable type information beyond the string
    /// representation. Can be populated from type annotations or type inference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured: Option<TypeNode>,
}

impl TypeInfo {
    /// Create a new type info entry.
    pub fn new(symbol_id: SymbolId, type_repr: impl Into<String>, source: TypeSource) -> Self {
        TypeInfo {
            symbol_id,
            type_repr: type_repr.into(),
            source,
            structured: None,
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

    /// Set the structured type representation.
    ///
    /// Builder method that adds a machine-readable [`TypeNode`] to this type info.
    ///
    /// # Example
    ///
    /// ```
    /// use tugtool_core::facts::{TypeInfo, TypeNode, TypeSource, SymbolId};
    ///
    /// let type_info = TypeInfo::annotated(SymbolId::new(1), "List[int]")
    ///     .with_structured(TypeNode::named_with_args("List", vec![TypeNode::named("int")]));
    ///
    /// assert!(type_info.structured.is_some());
    /// ```
    pub fn with_structured(mut self, node: TypeNode) -> Self {
        self.structured = Some(node);
        self
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

/// An alias relationship between symbols.
///
/// Represents that one symbol is an alias for another, tracking the kind
/// of aliasing and optional confidence score for uncertain aliases.
///
/// # Examples
///
/// - Python assignment: `b = a` → `AliasEdge { alias: b, target: a, kind: Assignment }`
/// - Python import alias: `from foo import bar as baz` → `AliasEdge { alias: baz, target: bar, kind: Import }`
/// - Re-export: `pub use foo::Bar as Baz` → `AliasEdge { alias: Baz, target: Bar, kind: ReExport }`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AliasEdge {
    /// Unique identifier for this alias edge.
    pub alias_id: AliasEdgeId,
    /// File containing this alias.
    pub file_id: FileId,
    /// Byte span of the alias expression.
    pub span: Span,
    /// The alias symbol (the new name).
    pub alias_symbol_id: SymbolId,
    /// The target symbol being aliased (if resolved).
    /// None when the target cannot be resolved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_symbol_id: Option<SymbolId>,
    /// Kind of alias relationship.
    pub kind: AliasKind,
    /// Confidence score for uncertain aliases.
    /// - `None`: Language has no aliasing uncertainty concept
    /// - `Some(1.0)`: Certain alias (direct assignment, import alias)
    /// - `Some(0.0..1.0)`: Graduated confidence based on analysis
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

impl AliasEdge {
    /// Create a new alias edge.
    pub fn new(
        alias_id: AliasEdgeId,
        file_id: FileId,
        span: Span,
        alias_symbol_id: SymbolId,
        kind: AliasKind,
    ) -> Self {
        AliasEdge {
            alias_id,
            file_id,
            span,
            alias_symbol_id,
            target_symbol_id: None,
            kind,
            confidence: None,
        }
    }

    /// Set the target symbol.
    pub fn with_target(mut self, target: SymbolId) -> Self {
        self.target_symbol_id = Some(target);
        self
    }

    /// Set the confidence score.
    pub fn with_confidence(mut self, confidence: f32) -> Self {
        self.confidence = Some(confidence);
        self
    }
}

/// Structured representation of a type.
///
/// This provides machine-readable type information beyond string representations.
/// Used for type-aware refactoring operations like method resolution.
///
/// This enum is `#[non_exhaustive]` to allow adding language-specific variants
/// via the `Extension` variant without breaking downstream code.
///
/// # Examples
///
/// ```
/// use tugtool_core::facts::TypeNode;
///
/// // Python: List[int]
/// let list_int = TypeNode::Named {
///     name: "List".to_string(),
///     args: vec![TypeNode::Named { name: "int".to_string(), args: vec![] }],
/// };
///
/// // Python: Optional[str]
/// let opt_str = TypeNode::Optional {
///     inner: Box::new(TypeNode::Named { name: "str".to_string(), args: vec![] }),
/// };
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[non_exhaustive]
pub enum TypeNode {
    /// A named type (class, struct, primitive).
    Named {
        /// The fully-qualified type name.
        name: String,
        /// Generic type arguments, if any.
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        args: Vec<TypeNode>,
    },
    /// A union of types (Python Union, TypeScript |).
    Union {
        /// The member types.
        members: Vec<TypeNode>,
    },
    /// An optional type (Python Optional, Rust Option).
    Optional {
        /// The inner type.
        inner: Box<TypeNode>,
    },
    /// A function/callable type.
    Callable {
        /// Parameter types.
        params: Vec<TypeNode>,
        /// Return type.
        returns: Box<TypeNode>,
    },
    /// A tuple type.
    Tuple {
        /// Element types.
        elements: Vec<TypeNode>,
    },
    /// Language-specific extension node.
    ///
    /// Reserved for future Rust/other-language constructs (reference, pointer,
    /// slice, array, trait objects, impl traits, never type, lifetimes).
    Extension {
        /// Extension name (e.g., "reference", "lifetime").
        name: String,
        /// Nested type arguments, if any.
        #[serde(skip_serializing_if = "Vec::is_empty", default)]
        args: Vec<TypeNode>,
    },
    /// Unknown/unresolved type.
    Unknown,
}

impl TypeNode {
    /// Create a named type without arguments.
    pub fn named(name: impl Into<String>) -> Self {
        TypeNode::Named {
            name: name.into(),
            args: vec![],
        }
    }

    /// Create a named type with arguments.
    pub fn named_with_args(name: impl Into<String>, args: Vec<TypeNode>) -> Self {
        TypeNode::Named {
            name: name.into(),
            args,
        }
    }

    /// Create an optional type.
    pub fn optional(inner: TypeNode) -> Self {
        TypeNode::Optional {
            inner: Box::new(inner),
        }
    }

    /// Create a union type.
    pub fn union(members: Vec<TypeNode>) -> Self {
        TypeNode::Union { members }
    }

    /// Create a callable type.
    pub fn callable(params: Vec<TypeNode>, returns: TypeNode) -> Self {
        TypeNode::Callable {
            params,
            returns: Box::new(returns),
        }
    }

    /// Create a tuple type.
    pub fn tuple(elements: Vec<TypeNode>) -> Self {
        TypeNode::Tuple { elements }
    }

    /// Create an extension type for language-specific constructs.
    pub fn extension(name: impl Into<String>, args: Vec<TypeNode>) -> Self {
        TypeNode::Extension {
            name: name.into(),
            args,
        }
    }
}

/// A parameter in a function or method signature.
///
/// Captures the parameter name, kind (positional-only, keyword-only, etc.),
/// default value span (for refactoring), and optional type annotation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Parameter {
    /// Parameter name.
    pub name: String,
    /// Kind of parameter.
    pub kind: ParamKind,
    /// Span of the parameter name in source.
    /// Used for rename-param operations to locate the parameter name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name_span: Option<Span>,
    /// Span of the default value expression (if present).
    /// Used for refactoring operations that need to modify defaults.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_span: Option<Span>,
    /// Type annotation as a structured TypeNode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotation: Option<TypeNode>,
}

impl Parameter {
    /// Create a new parameter with the given name and kind.
    pub fn new(name: impl Into<String>, kind: ParamKind) -> Self {
        Parameter {
            name: name.into(),
            kind,
            name_span: None,
            default_span: None,
            annotation: None,
        }
    }

    /// Create a regular parameter (most common case).
    pub fn regular(name: impl Into<String>) -> Self {
        Self::new(name, ParamKind::Regular)
    }

    /// Set the name span (location of parameter name in source).
    pub fn with_name_span(mut self, span: Span) -> Self {
        self.name_span = Some(span);
        self
    }

    /// Set the default value span.
    pub fn with_default_span(mut self, span: Span) -> Self {
        self.default_span = Some(span);
        self
    }

    /// Set the type annotation.
    pub fn with_annotation(mut self, annotation: TypeNode) -> Self {
        self.annotation = Some(annotation);
        self
    }
}

/// A function or method signature.
///
/// Contains the parameters and optional return type for a callable symbol.
/// Signatures are keyed by `SymbolId` in FactsStore.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Signature {
    /// The symbol this signature belongs to.
    pub symbol_id: SymbolId,
    /// Parameters in declaration order.
    pub params: Vec<Parameter>,
    /// Return type (if annotated).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub returns: Option<TypeNode>,
}

impl Signature {
    /// Create a new signature for a symbol.
    pub fn new(symbol_id: SymbolId) -> Self {
        Signature {
            symbol_id,
            params: vec![],
            returns: None,
        }
    }

    /// Set the parameters.
    pub fn with_params(mut self, params: Vec<Parameter>) -> Self {
        self.params = params;
        self
    }

    /// Set the return type.
    pub fn with_returns(mut self, returns: TypeNode) -> Self {
        self.returns = Some(returns);
        self
    }
}

/// A generic type parameter.
///
/// Represents type parameters on generic functions/classes (e.g., `T`, `T: Bound`).
/// Type parameters are stored per-symbol in FactsStore.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypeParam {
    /// Type parameter name (e.g., "T", "K", "V").
    pub name: String,
    /// Bound constraints on the type parameter.
    /// Empty for unconstrained type parameters.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub bounds: Vec<TypeNode>,
    /// Default type if not specified by caller.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<TypeNode>,
}

impl TypeParam {
    /// Create a new type parameter with the given name.
    pub fn new(name: impl Into<String>) -> Self {
        TypeParam {
            name: name.into(),
            bounds: vec![],
            default: None,
        }
    }

    /// Add a bound constraint.
    pub fn with_bound(mut self, bound: TypeNode) -> Self {
        self.bounds.push(bound);
        self
    }

    /// Set multiple bound constraints.
    pub fn with_bounds(mut self, bounds: Vec<TypeNode>) -> Self {
        self.bounds = bounds;
        self
    }

    /// Set the default type.
    pub fn with_default(mut self, default: TypeNode) -> Self {
        self.default = Some(default);
        self
    }
}

/// An attribute access (e.g., `obj.attr`, `obj.method()`).
///
/// Represents accessing an attribute on an object, enabling method resolution,
/// property refactors, and safe member renames.
///
/// # Examples
///
/// - `obj.attr` → Read access
/// - `obj.attr = value` → Write access
/// - `obj.method()` → Call access
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttributeAccess {
    /// Unique identifier for this attribute access.
    pub access_id: AttributeAccessId,
    /// File containing this attribute access.
    pub file_id: FileId,
    /// Byte span of the attribute name.
    pub span: Span,
    /// The base symbol being accessed (if resolved).
    /// None when the base expression cannot be resolved to a symbol.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_symbol_id: Option<SymbolId>,
    /// Attribute name being accessed.
    pub name: String,
    /// Kind of attribute access.
    pub kind: AttributeAccessKind,
}

impl AttributeAccess {
    /// Create a new attribute access.
    pub fn new(
        access_id: AttributeAccessId,
        file_id: FileId,
        span: Span,
        name: impl Into<String>,
        kind: AttributeAccessKind,
    ) -> Self {
        AttributeAccess {
            access_id,
            file_id,
            span,
            base_symbol_id: None,
            name: name.into(),
            kind,
        }
    }

    /// Set the base symbol.
    pub fn with_base_symbol(mut self, symbol_id: SymbolId) -> Self {
        self.base_symbol_id = Some(symbol_id);
        self
    }
}

/// An argument in a call expression.
///
/// Represents a single argument passed to a function/method call.
/// Used to track positional and keyword arguments for parameter rename operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallArg {
    /// Argument name for keyword args, None for positional args.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Byte span of the argument expression.
    pub span: Span,
    /// Byte span of the keyword name (for keyword arguments only).
    ///
    /// This is the span of `key` in `func(key=value)`, which is needed for
    /// rename-param operations to rename keyword argument names at call sites.
    /// `None` for positional arguments or if the span is unavailable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyword_name_span: Option<Span>,
}

impl CallArg {
    /// Create a positional argument.
    pub fn positional(span: Span) -> Self {
        CallArg {
            name: None,
            span,
            keyword_name_span: None,
        }
    }

    /// Create a keyword argument.
    ///
    /// # Arguments
    ///
    /// * `name` - The keyword argument name (e.g., "key" in `func(key=value)`)
    /// * `span` - Byte span of the argument value expression
    /// * `keyword_name_span` - Byte span of the keyword name (for rename-param)
    pub fn keyword(name: impl Into<String>, span: Span, keyword_name_span: Option<Span>) -> Self {
        CallArg {
            name: Some(name.into()),
            span,
            keyword_name_span,
        }
    }
}

/// A step in a receiver path for method call resolution.
///
/// Represents one step in the chain of accesses leading to a method call,
/// enabling cross-file type resolution.
///
/// This is the language-agnostic representation stored in FactsStore.
/// Language-specific CST types convert to this via `From` implementations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ReceiverPathStep {
    /// A simple name lookup (e.g., `obj` in `obj.method()`).
    Name { value: String },
    /// An attribute access (e.g., `.handler` in `self.handler.process()`).
    Attribute { value: String },
    /// A call expression (e.g., `()` in `factory().create()`).
    Call,
    /// A subscript access (e.g., `[0]` in `items[0].method()`).
    Subscript,
}

/// Structured receiver path for method calls.
///
/// Represents the chain of accesses leading to a method call, enabling
/// cross-file type resolution. For example:
/// - `obj.method()` → `[Name("obj")]`
/// - `self.handler.process()` → `[Name("self"), Attribute("handler")]`
/// - `factory().create()` → `[Name("factory"), Call]`
/// - `items[0].method()` → `[Name("items"), Subscript]`
///
/// This is the language-agnostic representation stored in FactsStore.
/// Language-specific CST types convert to this via `From` implementations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiverPath {
    /// Steps in the receiver path.
    pub steps: Vec<ReceiverPathStep>,
}

impl ReceiverPath {
    /// Create a new receiver path with the given steps.
    pub fn new(steps: Vec<ReceiverPathStep>) -> Self {
        ReceiverPath { steps }
    }

    /// Create an empty receiver path.
    pub fn empty() -> Self {
        ReceiverPath { steps: vec![] }
    }

    /// Returns true if the receiver path is empty.
    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }
}

/// A call site in the code.
///
/// Represents a function/method call, including the callee and arguments.
/// Used for parameter rename operations and API migration.
///
/// # Examples
///
/// - `foo()` → Call with no arguments
/// - `foo(1, 2)` → Call with positional arguments
/// - `foo(a=1, b=2)` → Call with keyword arguments
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CallSite {
    /// Unique identifier for this call site.
    pub call_id: CallSiteId,
    /// File containing this call site.
    pub file_id: FileId,
    /// Byte span of the entire call expression.
    pub span: Span,
    /// The callee symbol (if resolved).
    /// None when the callee cannot be resolved to a symbol.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callee_symbol_id: Option<SymbolId>,
    /// Arguments in call order.
    pub args: Vec<CallArg>,
    /// Receiver path for method calls (e.g., `self.handler` in `self.handler.process()`).
    /// None for simple function calls like `foo()`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_path: Option<ReceiverPath>,
    /// Scope path where this call site occurs (e.g., `["<module>", "MyClass", "my_method"]`).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub scope_path: Vec<String>,
    /// Whether this is a method call (as opposed to a function call).
    #[serde(skip_serializing_if = "std::ops::Not::not", default)]
    pub is_method_call: bool,
}

impl CallSite {
    /// Create a new call site.
    pub fn new(call_id: CallSiteId, file_id: FileId, span: Span) -> Self {
        CallSite {
            call_id,
            file_id,
            span,
            callee_symbol_id: None,
            args: vec![],
            receiver_path: None,
            scope_path: vec![],
            is_method_call: false,
        }
    }

    /// Set the callee symbol.
    pub fn with_callee(mut self, symbol_id: SymbolId) -> Self {
        self.callee_symbol_id = Some(symbol_id);
        self
    }

    /// Set the receiver path.
    pub fn with_receiver_path(mut self, path: ReceiverPath) -> Self {
        self.receiver_path = Some(path);
        self
    }

    /// Set the scope path.
    pub fn with_scope_path(mut self, scope_path: Vec<String>) -> Self {
        self.scope_path = scope_path;
        self
    }

    /// Set whether this is a method call.
    pub fn with_is_method_call(mut self, is_method: bool) -> Self {
        self.is_method_call = is_method;
        self
    }

    /// Set the arguments.
    pub fn with_args(mut self, args: Vec<CallArg>) -> Self {
        self.args = args;
        self
    }
}

/// A qualified name for a symbol.
///
/// Provides a stable cross-module identifier for a symbol, enabling
/// consistent lookup across files and refactoring sessions.
///
/// # Examples
///
/// - `"myproject.utils.parse"` for a function
/// - `"myproject.models.User.save"` for a method
/// - `"myproject.constants.MAX_SIZE"` for a constant
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QualifiedName {
    /// The symbol this qualified name belongs to.
    pub symbol_id: SymbolId,
    /// Fully-qualified path (e.g., `"pkg.mod.Class.method"`).
    pub path: String,
}

impl QualifiedName {
    /// Create a new qualified name for a symbol.
    pub fn new(symbol_id: SymbolId, path: impl Into<String>) -> Self {
        QualifiedName {
            symbol_id,
            path: path.into(),
        }
    }
}

/// Modifiers associated with a symbol.
///
/// Stores the semantic modifiers (async, static, property, etc.) for a symbol.
/// This is keyed by `SymbolId` in FactsStore.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolModifiers {
    /// The symbol these modifiers belong to.
    pub symbol_id: SymbolId,
    /// List of modifiers on this symbol.
    pub modifiers: Vec<Modifier>,
}

impl SymbolModifiers {
    /// Create new symbol modifiers.
    pub fn new(symbol_id: SymbolId, modifiers: Vec<Modifier>) -> Self {
        SymbolModifiers {
            symbol_id,
            modifiers,
        }
    }

    /// Check if a specific modifier is present.
    pub fn has(&self, modifier: Modifier) -> bool {
        self.modifiers.contains(&modifier)
    }
}

// ============================================================================
// Module Resolution
// ============================================================================

/// Module resolution mapping from module path to module IDs.
///
/// This struct supports namespace packages where a single module path
/// (e.g., `"pkg.sub"`) can map to multiple modules (multiple files/directories
/// that contribute to the same logical module).
///
/// Examples:
/// - Single file module: `"mypackage.utils"` → `[ModuleId(1)]`
/// - Namespace package: `"mypackage.plugins"` → `[ModuleId(2), ModuleId(3)]`
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModuleResolution {
    /// Module path (e.g., `"pkg.sub"`, `"mypackage.utils"`).
    pub module_path: String,
    /// Module IDs that implement this module path.
    ///
    /// For regular modules, this contains exactly one ModuleId.
    /// For namespace packages, this may contain multiple ModuleIds.
    pub module_ids: Vec<ModuleId>,
}

impl ModuleResolution {
    /// Create a new module resolution with a single module.
    pub fn new(module_path: impl Into<String>, module_id: ModuleId) -> Self {
        ModuleResolution {
            module_path: module_path.into(),
            module_ids: vec![module_id],
        }
    }

    /// Create a new module resolution with multiple modules (namespace package).
    pub fn with_modules(module_path: impl Into<String>, module_ids: Vec<ModuleId>) -> Self {
        ModuleResolution {
            module_path: module_path.into(),
            module_ids,
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
#[derive(Debug)]
pub struct FactsStore {
    /// Schema version for serialization compatibility checks.
    ///
    /// This is set to `FACTS_SCHEMA_VERSION` on creation and should be
    /// checked when deserializing to detect incompatible schema changes.
    pub schema_version: u32,

    // Primary storage (BTreeMap for deterministic iteration)
    files: BTreeMap<FileId, File>,
    modules: BTreeMap<ModuleId, Module>,
    symbols: BTreeMap<SymbolId, Symbol>,
    references: BTreeMap<ReferenceId, Reference>,
    imports: BTreeMap<ImportId, Import>,
    scopes: BTreeMap<ScopeId, ScopeInfo>,
    alias_edges: BTreeMap<AliasEdgeId, AliasEdge>,

    // Type information (symbol_id → type)
    types: HashMap<SymbolId, TypeInfo>,

    // Signatures (symbol_id → signature)
    /// Function/method signatures keyed by symbol ID.
    signatures: BTreeMap<SymbolId, Signature>,

    // Type parameters (symbol_id → type params)
    /// Generic type parameters per symbol (for generic functions/classes).
    type_params: BTreeMap<SymbolId, Vec<TypeParam>>,

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

    // Alias edge indexes
    /// file_id → alias_edge_ids[] (alias edges in file).
    alias_edges_by_file: HashMap<FileId, Vec<AliasEdgeId>>,
    /// alias_symbol_id → alias_edge_ids[] (forward lookup: alias → edge).
    alias_edges_by_alias: HashMap<SymbolId, Vec<AliasEdgeId>>,
    /// target_symbol_id → alias_edge_ids[] (reverse lookup: target → edges).
    alias_edges_by_target: HashMap<SymbolId, Vec<AliasEdgeId>>,

    // Attribute access storage
    /// Primary storage for attribute accesses.
    attribute_accesses: BTreeMap<AttributeAccessId, AttributeAccess>,
    /// file_id → attribute_access_ids[] (attribute accesses in file).
    attribute_accesses_by_file: HashMap<FileId, Vec<AttributeAccessId>>,
    /// attribute_name → attribute_access_ids[] (accesses to this attribute name).
    attribute_accesses_by_name: HashMap<String, Vec<AttributeAccessId>>,

    // Call site storage
    /// Primary storage for call sites.
    call_sites: BTreeMap<CallSiteId, CallSite>,
    /// file_id → call_site_ids[] (call sites in file).
    call_sites_by_file: HashMap<FileId, Vec<CallSiteId>>,
    /// callee_symbol_id → call_site_ids[] (calls to this callee).
    call_sites_by_callee: HashMap<SymbolId, Vec<CallSiteId>>,

    // Qualified names and modifiers
    /// symbol_id → qualified name (stable cross-module identifier).
    qualified_names: BTreeMap<SymbolId, QualifiedName>,
    /// qualified path → symbol_id (reverse lookup for symbol resolution).
    qualified_names_by_path: HashMap<String, SymbolId>,
    /// symbol_id → modifiers (semantic attributes like async, static, property).
    symbol_modifiers: BTreeMap<SymbolId, SymbolModifiers>,

    // Module resolution
    /// module_path → module resolution (for import path resolution).
    module_resolutions: BTreeMap<String, ModuleResolution>,

    // Public export storage (language-agnostic)
    /// Primary storage for public exports.
    public_exports: BTreeMap<PublicExportId, PublicExport>,
    /// file_id → public_export_ids[] (public exports in file).
    public_exports_by_file: HashMap<FileId, Vec<PublicExportId>>,
    /// exported_name → public_export_ids[] (exports with this name, for non-glob exports).
    public_exports_by_name: HashMap<String, Vec<PublicExportId>>,
    /// export_intent → public_export_ids[] (for filtering by declared vs effective).
    public_exports_by_intent: HashMap<ExportIntent, Vec<PublicExportId>>,

    // ID generators
    next_file_id: u32,
    next_module_id: u32,
    next_symbol_id: u32,
    next_ref_id: u32,
    next_import_id: u32,
    next_scope_id: u32,
    next_alias_edge_id: u32,
    next_attribute_access_id: u32,
    next_call_site_id: u32,
    next_public_export_id: u32,
}

impl Default for FactsStore {
    fn default() -> Self {
        FactsStore {
            schema_version: FACTS_SCHEMA_VERSION,
            files: BTreeMap::new(),
            modules: BTreeMap::new(),
            symbols: BTreeMap::new(),
            references: BTreeMap::new(),
            imports: BTreeMap::new(),
            scopes: BTreeMap::new(),
            alias_edges: BTreeMap::new(),
            types: HashMap::new(),
            signatures: BTreeMap::new(),
            type_params: BTreeMap::new(),
            inheritance: Vec::new(),
            parents_of: HashMap::new(),
            children_of: HashMap::new(),
            file_by_path: HashMap::new(),
            symbols_by_name: HashMap::new(),
            refs_by_symbol: HashMap::new(),
            imports_by_file: HashMap::new(),
            symbols_by_file: HashMap::new(),
            refs_by_file: HashMap::new(),
            scopes_by_file: HashMap::new(),
            alias_edges_by_file: HashMap::new(),
            alias_edges_by_alias: HashMap::new(),
            alias_edges_by_target: HashMap::new(),
            attribute_accesses: BTreeMap::new(),
            attribute_accesses_by_file: HashMap::new(),
            attribute_accesses_by_name: HashMap::new(),
            call_sites: BTreeMap::new(),
            call_sites_by_file: HashMap::new(),
            call_sites_by_callee: HashMap::new(),
            qualified_names: BTreeMap::new(),
            qualified_names_by_path: HashMap::new(),
            symbol_modifiers: BTreeMap::new(),
            module_resolutions: BTreeMap::new(),
            public_exports: BTreeMap::new(),
            public_exports_by_file: HashMap::new(),
            public_exports_by_name: HashMap::new(),
            public_exports_by_intent: HashMap::new(),
            next_file_id: 0,
            next_module_id: 0,
            next_symbol_id: 0,
            next_ref_id: 0,
            next_import_id: 0,
            next_scope_id: 0,
            next_alias_edge_id: 0,
            next_attribute_access_id: 0,
            next_call_site_id: 0,
            next_public_export_id: 0,
        }
    }
}

impl FactsStore {
    /// Create a new empty FactsStore.
    ///
    /// The schema version is automatically set to `FACTS_SCHEMA_VERSION`.
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

    /// Generate the next AliasEdgeId.
    pub fn next_alias_edge_id(&mut self) -> AliasEdgeId {
        let id = AliasEdgeId::new(self.next_alias_edge_id);
        self.next_alias_edge_id += 1;
        id
    }

    /// Generate the next AttributeAccessId.
    pub fn next_attribute_access_id(&mut self) -> AttributeAccessId {
        let id = AttributeAccessId::new(self.next_attribute_access_id);
        self.next_attribute_access_id += 1;
        id
    }

    /// Generate the next CallSiteId.
    pub fn next_call_site_id(&mut self) -> CallSiteId {
        let id = CallSiteId::new(self.next_call_site_id);
        self.next_call_site_id += 1;
        id
    }

    /// Generate the next PublicExportId.
    pub fn next_public_export_id(&mut self) -> PublicExportId {
        let id = PublicExportId::new(self.next_public_export_id);
        self.next_public_export_id += 1;
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

    /// Insert an alias edge.
    ///
    /// Records that `alias_symbol_id` is an alias for `target_symbol_id`.
    /// Updates all relevant indexes for efficient lookup.
    pub fn insert_alias_edge(&mut self, edge: AliasEdge) {
        // Update file index
        self.alias_edges_by_file
            .entry(edge.file_id)
            .or_default()
            .push(edge.alias_id);

        // Update alias (forward) index
        self.alias_edges_by_alias
            .entry(edge.alias_symbol_id)
            .or_default()
            .push(edge.alias_id);

        // Update target (reverse) index if target is resolved
        if let Some(target_id) = edge.target_symbol_id {
            self.alias_edges_by_target
                .entry(target_id)
                .or_default()
                .push(edge.alias_id);
        }

        // Insert into primary storage
        self.alias_edges.insert(edge.alias_id, edge);
    }

    /// Insert a signature for a symbol.
    ///
    /// If the symbol already has a signature, this replaces it.
    /// Typically used for functions, methods, and __init__ methods.
    pub fn insert_signature(&mut self, signature: Signature) {
        self.signatures.insert(signature.symbol_id, signature);
    }

    /// Insert type parameters for a symbol.
    ///
    /// If the symbol already has type parameters, this replaces them.
    /// Typically used for generic functions, classes, or type aliases.
    pub fn insert_type_params(&mut self, symbol_id: SymbolId, params: Vec<TypeParam>) {
        self.type_params.insert(symbol_id, params);
    }

    /// Insert an attribute access.
    ///
    /// Updates all relevant indexes for efficient lookup.
    pub fn insert_attribute_access(&mut self, access: AttributeAccess) {
        // Update file index
        self.attribute_accesses_by_file
            .entry(access.file_id)
            .or_default()
            .push(access.access_id);

        // Update name index
        self.attribute_accesses_by_name
            .entry(access.name.clone())
            .or_default()
            .push(access.access_id);

        // Insert into primary storage
        self.attribute_accesses.insert(access.access_id, access);
    }

    /// Insert a call site.
    ///
    /// Updates all relevant indexes for efficient lookup.
    pub fn insert_call_site(&mut self, call: CallSite) {
        // Update file index
        self.call_sites_by_file
            .entry(call.file_id)
            .or_default()
            .push(call.call_id);

        // Update callee index if callee is resolved
        if let Some(callee_id) = call.callee_symbol_id {
            self.call_sites_by_callee
                .entry(callee_id)
                .or_default()
                .push(call.call_id);
        }

        // Insert into primary storage
        self.call_sites.insert(call.call_id, call);
    }

    /// Insert a qualified name for a symbol.
    ///
    /// If the symbol already has a qualified name, this replaces it.
    /// Also updates the reverse lookup index.
    pub fn insert_qualified_name(&mut self, qname: QualifiedName) {
        // Remove old path from reverse index if symbol had a previous qualified name
        if let Some(old_qname) = self.qualified_names.get(&qname.symbol_id) {
            self.qualified_names_by_path.remove(&old_qname.path);
        }

        // Update reverse index
        self.qualified_names_by_path
            .insert(qname.path.clone(), qname.symbol_id);

        // Insert into primary storage
        self.qualified_names.insert(qname.symbol_id, qname);
    }

    /// Insert modifiers for a symbol.
    ///
    /// If the symbol already has modifiers, this replaces them.
    pub fn insert_modifiers(&mut self, modifiers: SymbolModifiers) {
        self.symbol_modifiers.insert(modifiers.symbol_id, modifiers);
    }

    /// Insert a public export.
    ///
    /// Updates all relevant indexes for efficient lookup:
    /// - `public_exports_by_file`: file → export IDs
    /// - `public_exports_by_name`: exported_name → export IDs (for non-glob exports)
    /// - `public_exports_by_intent`: intent → export IDs
    pub fn insert_public_export(&mut self, export: PublicExport) {
        // Update file index
        self.public_exports_by_file
            .entry(export.file_id)
            .or_default()
            .push(export.export_id);

        // Update name index (only for non-glob exports with an exported_name)
        if let Some(ref name) = export.exported_name {
            self.public_exports_by_name
                .entry(name.clone())
                .or_default()
                .push(export.export_id);
        }

        // Update intent index
        self.public_exports_by_intent
            .entry(export.export_intent)
            .or_default()
            .push(export.export_id);

        // Insert into primary storage
        self.public_exports.insert(export.export_id, export);
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

    /// Get a public export by ID.
    pub fn public_export(&self, id: PublicExportId) -> Option<&PublicExport> {
        self.public_exports.get(&id)
    }

    /// Get a scope by ID.
    pub fn scope(&self, id: ScopeId) -> Option<&ScopeInfo> {
        self.scopes.get(&id)
    }

    /// Get an alias edge by ID.
    pub fn alias_edge(&self, id: AliasEdgeId) -> Option<&AliasEdge> {
        self.alias_edges.get(&id)
    }

    /// Get the signature for a symbol.
    ///
    /// Returns None if the symbol has no signature (e.g., variables, classes without __init__).
    pub fn signature(&self, symbol_id: SymbolId) -> Option<&Signature> {
        self.signatures.get(&symbol_id)
    }

    /// Get the type parameters for a symbol.
    ///
    /// Returns None if the symbol has no type parameters.
    /// Returns Some(&[]) is technically not possible since we only store non-empty params.
    pub fn type_params_for(&self, symbol_id: SymbolId) -> Option<&[TypeParam]> {
        self.type_params.get(&symbol_id).map(|v| v.as_slice())
    }

    /// Get an attribute access by ID.
    pub fn attribute_access(&self, id: AttributeAccessId) -> Option<&AttributeAccess> {
        self.attribute_accesses.get(&id)
    }

    /// Get a call site by ID.
    pub fn call_site(&self, id: CallSiteId) -> Option<&CallSite> {
        self.call_sites.get(&id)
    }

    /// Get the qualified name for a symbol.
    ///
    /// Returns None if the symbol has no qualified name assigned.
    pub fn qualified_name(&self, symbol_id: SymbolId) -> Option<&QualifiedName> {
        self.qualified_names.get(&symbol_id)
    }

    /// Look up a symbol by its qualified path.
    ///
    /// Returns the SymbolId for the symbol with this qualified path,
    /// or None if no symbol has this path.
    pub fn symbol_by_qualified_name(&self, path: &str) -> Option<SymbolId> {
        self.qualified_names_by_path.get(path).copied()
    }

    /// Get the modifiers for a symbol.
    ///
    /// Returns None if the symbol has no modifiers assigned.
    pub fn modifiers_for(&self, symbol_id: SymbolId) -> Option<&SymbolModifiers> {
        self.symbol_modifiers.get(&symbol_id)
    }

    /// Check if a symbol has a specific modifier.
    ///
    /// Returns false if the symbol has no modifiers or doesn't have the specified modifier.
    pub fn has_modifier(&self, symbol_id: SymbolId, modifier: Modifier) -> bool {
        self.symbol_modifiers
            .get(&symbol_id)
            .is_some_and(|m| m.has(modifier))
    }

    /// Insert a module resolution mapping.
    ///
    /// If a resolution for this module path already exists, the new module_ids
    /// are merged (appended) to the existing ones. This supports namespace
    /// packages where multiple directories contribute to the same module path.
    ///
    /// Duplicate module IDs are not filtered - the caller should ensure
    /// uniqueness if required.
    pub fn insert_module_resolution(&mut self, resolution: ModuleResolution) {
        match self
            .module_resolutions
            .entry(resolution.module_path.clone())
        {
            std::collections::btree_map::Entry::Occupied(mut entry) => {
                // Merge: append new module_ids to existing
                entry.get_mut().module_ids.extend(resolution.module_ids);
            }
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(resolution);
            }
        }
    }

    /// Resolve a module path to its ModuleResolution.
    ///
    /// Returns None if the module path is not registered.
    pub fn resolve_module_path(&self, module_path: &str) -> Option<&ModuleResolution> {
        self.module_resolutions.get(module_path)
    }

    /// Get the module IDs for a module path.
    ///
    /// Returns an empty slice if the module path is not registered.
    /// For regular modules, returns a slice with one element.
    /// For namespace packages, may return multiple elements.
    pub fn module_ids_for_path(&self, module_path: &str) -> &[ModuleId] {
        self.module_resolutions
            .get(module_path)
            .map(|r| r.module_ids.as_slice())
            .unwrap_or(&[])
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

    /// Get all public exports in a file.
    ///
    /// Returns exports in deterministic order (by PublicExportId).
    pub fn public_exports_in_file(&self, file_id: FileId) -> Vec<&PublicExport> {
        self.public_exports_by_file
            .get(&file_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.public_exports.get(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get all public exports with a given exported name.
    ///
    /// Returns exports in deterministic order (by PublicExportId).
    /// This is the primary method for finding exports to rename.
    ///
    /// Note: Glob exports (which have no exported_name) will not appear in these results.
    pub fn public_exports_named(&self, name: &str) -> Vec<&PublicExport> {
        self.public_exports_by_name
            .get(name)
            .map(|ids| {
                let mut exports: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.public_exports.get(id))
                    .collect();
                exports.sort_by_key(|e| e.export_id);
                exports
            })
            .unwrap_or_default()
    }

    /// Get all public exports with a given intent (Declared or Effective).
    ///
    /// Returns exports in deterministic order (by PublicExportId).
    pub fn public_exports_with_intent(&self, intent: ExportIntent) -> Vec<&PublicExport> {
        self.public_exports_by_intent
            .get(&intent)
            .map(|ids| {
                let mut exports: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.public_exports.get(id))
                    .collect();
                exports.sort_by_key(|e| e.export_id);
                exports
            })
            .unwrap_or_default()
    }

    /// Iterate over all public exports in deterministic order.
    ///
    /// Returns an iterator over (PublicExportId, &PublicExport) pairs.
    pub fn public_exports(&self) -> impl Iterator<Item = &PublicExport> {
        self.public_exports.values()
    }

    /// Get the count of public exports.
    pub fn public_export_count(&self) -> usize {
        self.public_exports.len()
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
    pub fn scope_at_position(&self, file_id: FileId, position: usize) -> Option<&ScopeInfo> {
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

    /// Get all alias edges where the given symbol is the alias.
    ///
    /// Forward lookup: given an alias symbol, find the edges describing
    /// what it aliases to.
    pub fn alias_edges_for_symbol(&self, alias_symbol_id: SymbolId) -> Vec<&AliasEdge> {
        self.alias_edges_by_alias
            .get(&alias_symbol_id)
            .map(|ids| {
                let mut edges: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.alias_edges.get(id))
                    .collect();
                edges.sort_by_key(|e| e.alias_id);
                edges
            })
            .unwrap_or_default()
    }

    /// Get all alias edges where the given symbol is the target.
    ///
    /// Reverse lookup: given a target symbol, find all symbols that alias to it.
    pub fn alias_sources_for_target(&self, target_symbol_id: SymbolId) -> Vec<&AliasEdge> {
        self.alias_edges_by_target
            .get(&target_symbol_id)
            .map(|ids| {
                let mut edges: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.alias_edges.get(id))
                    .collect();
                edges.sort_by_key(|e| e.alias_id);
                edges
            })
            .unwrap_or_default()
    }

    /// Get all alias edges in a file.
    pub fn alias_edges_in_file(&self, file_id: FileId) -> Vec<&AliasEdge> {
        self.alias_edges_by_file
            .get(&file_id)
            .map(|ids| {
                let mut edges: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.alias_edges.get(id))
                    .collect();
                edges.sort_by_key(|e| e.alias_id);
                edges
            })
            .unwrap_or_default()
    }

    /// Get all attribute accesses in a file.
    ///
    /// Returns attribute accesses in deterministic order (by AttributeAccessId).
    pub fn attribute_accesses_in_file(&self, file_id: FileId) -> Vec<&AttributeAccess> {
        self.attribute_accesses_by_file
            .get(&file_id)
            .map(|ids| {
                let mut accesses: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.attribute_accesses.get(id))
                    .collect();
                accesses.sort_by_key(|a| a.access_id);
                accesses
            })
            .unwrap_or_default()
    }

    /// Get all attribute accesses with a given attribute name.
    ///
    /// Returns attribute accesses in deterministic order (by AttributeAccessId).
    /// This is the primary method for finding attribute accesses to rename.
    pub fn attribute_accesses_named(&self, name: &str) -> Vec<&AttributeAccess> {
        self.attribute_accesses_by_name
            .get(name)
            .map(|ids| {
                let mut accesses: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.attribute_accesses.get(id))
                    .collect();
                accesses.sort_by_key(|a| a.access_id);
                accesses
            })
            .unwrap_or_default()
    }

    /// Get all call sites in a file.
    ///
    /// Returns call sites in deterministic order (by CallSiteId).
    pub fn call_sites_in_file(&self, file_id: FileId) -> Vec<&CallSite> {
        self.call_sites_by_file
            .get(&file_id)
            .map(|ids| {
                let mut calls: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.call_sites.get(id))
                    .collect();
                calls.sort_by_key(|c| c.call_id);
                calls
            })
            .unwrap_or_default()
    }

    /// Get all call sites calling a given symbol.
    ///
    /// Returns call sites in deterministic order (by CallSiteId).
    /// This is the primary method for finding call sites for API migration.
    pub fn call_sites_to_callee(&self, callee_symbol_id: SymbolId) -> Vec<&CallSite> {
        self.call_sites_by_callee
            .get(&callee_symbol_id)
            .map(|ids| {
                let mut calls: Vec<_> = ids
                    .iter()
                    .filter_map(|id| self.call_sites.get(id))
                    .collect();
                calls.sort_by_key(|c| c.call_id);
                calls
            })
            .unwrap_or_default()
    }

    /// Convert alias edges to AliasOutput format for JSON serialization.
    ///
    /// Performs symbol lookup to convert SymbolId references to string names.
    /// Requires file content for line/column calculation.
    ///
    /// # Arguments
    /// * `file_contents` - Map from file path to file content (for position calculation)
    ///
    /// # Returns
    /// A vector of `AliasOutput` structs suitable for JSON output.
    pub fn aliases_from_edges(&self, file_contents: &HashMap<String, String>) -> Vec<AliasOutput> {
        // Precompute line indexes for all files (O(n) per file, done once)
        let line_indexes: HashMap<&str, LineIndex> = file_contents
            .iter()
            .map(|(path, content)| (path.as_str(), LineIndex::new(content)))
            .collect();

        self.alias_edges
            .values()
            .filter_map(|edge| {
                // Get alias symbol name
                let alias_symbol = self.symbol(edge.alias_symbol_id)?;
                let alias_name = alias_symbol.name.clone();

                // Get target symbol name
                let source_name = if let Some(target_id) = edge.target_symbol_id {
                    self.symbol(target_id).map(|s| s.name.clone())
                } else {
                    None
                }?;

                // Get file path
                let file = self.file(edge.file_id)?;
                let file_path = file.path.clone();

                // Calculate line and column from span (O(log n) with precomputed index)
                let (line, col) = if let Some(index) = line_indexes.get(file_path.as_str()) {
                    index.line_col(edge.span.start)
                } else {
                    (1, 1) // Default to 1:1 if content unavailable
                };

                // Determine is_import_alias from AliasKind
                let is_import_alias = matches!(edge.kind, AliasKind::Import | AliasKind::ReExport);

                // Get confidence (default to 1.0 if not set)
                let confidence = edge.confidence.unwrap_or(1.0);

                // Build scope path (simplified - just module for now)
                // Full scope path would require traversing scope hierarchy
                let scope = vec!["module".to_string()];

                Some(AliasOutput::new(
                    alias_name,
                    source_name,
                    file_path,
                    line,
                    col,
                    scope,
                    is_import_alias,
                    confidence,
                ))
            })
            .collect()
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

    /// Iterate over all alias edges in deterministic order.
    pub fn alias_edges(&self) -> impl Iterator<Item = &AliasEdge> {
        self.alias_edges.values()
    }

    /// Iterate over all signatures in deterministic order (by SymbolId).
    pub fn signatures(&self) -> impl Iterator<Item = &Signature> {
        self.signatures.values()
    }

    /// Iterate over all type parameters in deterministic order (by SymbolId).
    ///
    /// Returns (symbol_id, type_params) pairs.
    pub fn type_params(&self) -> impl Iterator<Item = (SymbolId, &[TypeParam])> {
        self.type_params
            .iter()
            .map(|(id, params)| (*id, params.as_slice()))
    }

    /// Iterate over all attribute accesses in deterministic order.
    pub fn attribute_accesses(&self) -> impl Iterator<Item = &AttributeAccess> {
        self.attribute_accesses.values()
    }

    /// Iterate over all call sites in deterministic order.
    pub fn call_sites(&self) -> impl Iterator<Item = &CallSite> {
        self.call_sites.values()
    }

    /// Iterate over all qualified names in deterministic order.
    pub fn qualified_names(&self) -> impl Iterator<Item = &QualifiedName> {
        self.qualified_names.values()
    }

    /// Iterate over all symbol modifiers in deterministic order.
    pub fn all_modifiers(&self) -> impl Iterator<Item = &SymbolModifiers> {
        self.symbol_modifiers.values()
    }

    /// Iterate over all module paths in deterministic order.
    ///
    /// Returns the module paths (strings) for which resolutions exist.
    /// Order is lexicographic by module path.
    pub fn all_module_paths(&self) -> impl Iterator<Item = &str> {
        self.module_resolutions.keys().map(|s| s.as_str())
    }

    /// Iterate over all module resolutions in deterministic order.
    pub fn module_resolutions(&self) -> impl Iterator<Item = &ModuleResolution> {
        self.module_resolutions.values()
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

    /// Number of alias edges.
    pub fn alias_edge_count(&self) -> usize {
        self.alias_edges.len()
    }

    /// Number of signatures.
    pub fn signature_count(&self) -> usize {
        self.signatures.len()
    }

    /// Number of symbols with type parameters.
    pub fn type_params_count(&self) -> usize {
        self.type_params.len()
    }

    /// Number of attribute accesses.
    pub fn attribute_access_count(&self) -> usize {
        self.attribute_accesses.len()
    }

    /// Number of call sites.
    pub fn call_site_count(&self) -> usize {
        self.call_sites.len()
    }

    /// Number of qualified names.
    pub fn qualified_name_count(&self) -> usize {
        self.qualified_names.len()
    }

    /// Number of symbols with modifiers.
    pub fn symbol_modifiers_count(&self) -> usize {
        self.symbol_modifiers.len()
    }

    /// Number of module resolutions.
    pub fn module_resolution_count(&self) -> usize {
        self.module_resolutions.len()
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
        self.signatures.clear();
        self.type_params.clear();
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

        self.alias_edges.clear();
        self.alias_edges_by_file.clear();
        self.alias_edges_by_alias.clear();
        self.alias_edges_by_target.clear();

        self.attribute_accesses.clear();
        self.attribute_accesses_by_file.clear();
        self.attribute_accesses_by_name.clear();

        self.call_sites.clear();
        self.call_sites_by_file.clear();
        self.call_sites_by_callee.clear();

        self.qualified_names.clear();
        self.qualified_names_by_path.clear();
        self.symbol_modifiers.clear();

        self.module_resolutions.clear();

        self.public_exports.clear();
        self.public_exports_by_file.clear();
        self.public_exports_by_name.clear();
        self.public_exports_by_intent.clear();

        // Note: We don't reset ID generators to preserve uniqueness
    }
}

// ============================================================================
// Helper Types
// ============================================================================

/// Precomputed index of line start offsets for fast byte-to-line-col conversion.
///
/// Build once per file with O(n), then each lookup is O(log n) via binary search.
struct LineIndex {
    /// Byte offsets where each line begins.
    /// line_starts[0] = 0 (line 1), line_starts[1] = first newline + 1 (line 2), etc.
    line_starts: Vec<usize>,
}

impl LineIndex {
    /// Build a line index from file content. O(n) where n is content length.
    fn new(content: &str) -> Self {
        let mut line_starts = vec![0]; // Line 1 starts at byte 0
        for (offset, ch) in content.char_indices() {
            if ch == '\n' {
                line_starts.push(offset + 1);
            }
        }
        LineIndex { line_starts }
    }

    /// Convert a byte offset to (line, col). O(log n) where n is number of lines.
    ///
    /// Both line and col are 1-indexed to match editor conventions.
    fn line_col(&self, byte_offset: usize) -> (u32, u32) {
        // Binary search to find which line contains this offset
        let line_idx = match self.line_starts.binary_search(&byte_offset) {
            Ok(idx) => idx,      // Exact match: offset is at line start
            Err(idx) => idx - 1, // Between two line starts: use previous line
        };
        let line_start = self.line_starts[line_idx];
        let col = byte_offset - line_start + 1; // 1-indexed column
        let line = line_idx + 1; // 1-indexed line
        (line as u32, col as u32)
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

    fn test_symbol(store: &mut FactsStore, name: &str, file_id: FileId, start: usize) -> Symbol {
        let symbol_id = store.next_symbol_id();
        Symbol::new(
            symbol_id,
            SymbolKind::Function,
            name,
            file_id,
            Span::new(start, start + name.len()),
        )
    }

    fn test_reference(
        store: &mut FactsStore,
        symbol_id: SymbolId,
        file_id: FileId,
        start: usize,
        end: usize,
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
                ModuleKind::Directory,
                None,
                Some(file_id),
            );
            store.insert_module(module);

            let retrieved = store.module(module_id).unwrap();
            assert_eq!(retrieved.path, "src.utils");
            assert_eq!(retrieved.kind, ModuleKind::Directory);
            assert_eq!(retrieved.file_id, Some(file_id));
        }

        #[test]
        fn module_hierarchy() {
            let mut store = FactsStore::new();

            // Create parent module
            let parent_id = store.next_module_id();
            let parent = Module::new(parent_id, "myproject", ModuleKind::Directory, None, None);
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
        fn glob_import() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let import = test_import(&mut store, file_id, "os.path").with_glob();
            let import_id = import.import_id;
            store.insert_import(import);

            let retrieved = store.import(import_id).unwrap();
            assert_eq!(retrieved.kind, ImportKind::Glob);
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

            // Test all 10 ScopeKind variants (5 Python + 5 Rust)
            let kinds = [
                // Python variants
                ScopeKind::Module,
                ScopeKind::Class,
                ScopeKind::Function,
                ScopeKind::Comprehension,
                ScopeKind::Lambda,
                // Rust variants
                ScopeKind::Impl,
                ScopeKind::Trait,
                ScopeKind::Closure,
                ScopeKind::Unsafe,
                ScopeKind::MatchArm,
            ];

            for (i, kind) in kinds.iter().enumerate() {
                let scope_id = store.next_scope_id();
                let scope =
                    ScopeInfo::new(scope_id, file_id, Span::new(i * 10, (i + 1) * 10), *kind);
                store.insert_scope(scope);

                let retrieved = store.scope(scope_id).unwrap();
                assert_eq!(retrieved.kind, *kind);
            }

            assert_eq!(store.scope_count(), 10);
        }

        #[test]
        fn scope_kind_default() {
            assert_eq!(ScopeKind::default(), ScopeKind::Module);
        }

        #[test]
        fn scope_kind_new_variants_serialization() {
            // Test that new Rust-specific variants serialize correctly
            let rust_kinds = [
                (ScopeKind::Impl, "\"impl\""),
                (ScopeKind::Trait, "\"trait\""),
                (ScopeKind::Closure, "\"closure\""),
                (ScopeKind::Unsafe, "\"unsafe\""),
                (ScopeKind::MatchArm, "\"match_arm\""),
            ];

            for (kind, expected_json) in rust_kinds {
                let json = serde_json::to_string(&kind).unwrap();
                assert_eq!(json, expected_json, "Failed for {:?}", kind);
            }
        }

        #[test]
        fn scope_kind_existing_variants_deserialization() {
            // Test that existing Python variants still deserialize correctly
            let cases = [
                ("\"module\"", ScopeKind::Module),
                ("\"class\"", ScopeKind::Class),
                ("\"function\"", ScopeKind::Function),
                ("\"comprehension\"", ScopeKind::Comprehension),
                ("\"lambda\"", ScopeKind::Lambda),
            ];

            for (json, expected_kind) in cases {
                let deserialized: ScopeKind = serde_json::from_str(json).unwrap();
                assert_eq!(deserialized, expected_kind, "Failed for {}", json);
            }
        }

        #[test]
        fn scope_kind_serialization_roundtrip() {
            // Test all variants serialize and deserialize correctly
            let all_kinds = [
                ScopeKind::Module,
                ScopeKind::Class,
                ScopeKind::Function,
                ScopeKind::Comprehension,
                ScopeKind::Lambda,
                ScopeKind::Impl,
                ScopeKind::Trait,
                ScopeKind::Closure,
                ScopeKind::Unsafe,
                ScopeKind::MatchArm,
            ];

            for kind in all_kinds {
                let json = serde_json::to_string(&kind).unwrap();
                let deserialized: ScopeKind = serde_json::from_str(&json).unwrap();
                assert_eq!(kind, deserialized, "Roundtrip failed for {:?}", kind);
            }
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

    mod reference_kind_tests {
        use super::*;

        #[test]
        fn reference_kind_delete_serialization() {
            // Test that Delete variant serializes correctly
            let json = serde_json::to_string(&ReferenceKind::Delete).unwrap();
            assert_eq!(json, "\"delete\"");
        }

        #[test]
        fn reference_kind_delete_deserialization() {
            // Test that Delete variant deserializes correctly
            let deserialized: ReferenceKind = serde_json::from_str("\"delete\"").unwrap();
            assert_eq!(deserialized, ReferenceKind::Delete);
        }

        #[test]
        fn reference_kind_delete_to_output_kind() {
            // Per [D14]: Delete maps to "reference" for output compatibility
            assert_eq!(ReferenceKind::Delete.to_output_kind(), "reference");
        }

        #[test]
        fn reference_kind_serialization_roundtrip() {
            // Test all variants serialize and deserialize correctly
            let all_kinds = [
                ReferenceKind::Definition,
                ReferenceKind::Call,
                ReferenceKind::Reference,
                ReferenceKind::Import,
                ReferenceKind::Attribute,
                ReferenceKind::TypeAnnotation,
                ReferenceKind::Write,
                ReferenceKind::Delete,
            ];

            for kind in all_kinds {
                let json = serde_json::to_string(&kind).unwrap();
                let deserialized: ReferenceKind = serde_json::from_str(&json).unwrap();
                assert_eq!(kind, deserialized, "Roundtrip failed for {:?}", kind);
            }
        }

        #[test]
        fn reference_kind_to_output_kind_all_variants() {
            // Test all variants map to expected output kinds
            assert_eq!(ReferenceKind::Definition.to_output_kind(), "definition");
            assert_eq!(ReferenceKind::Call.to_output_kind(), "call");
            assert_eq!(ReferenceKind::Reference.to_output_kind(), "reference");
            assert_eq!(ReferenceKind::Import.to_output_kind(), "import");
            assert_eq!(ReferenceKind::Attribute.to_output_kind(), "attribute");
            // Internal kinds map to "reference"
            assert_eq!(ReferenceKind::TypeAnnotation.to_output_kind(), "reference");
            assert_eq!(ReferenceKind::Write.to_output_kind(), "reference");
            assert_eq!(ReferenceKind::Delete.to_output_kind(), "reference");
        }

        #[test]
        fn reference_kind_default() {
            assert_eq!(ReferenceKind::default(), ReferenceKind::Reference);
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

        #[test]
        fn type_info_structured_none_serialization() {
            let type_info = TypeInfo::annotated(SymbolId::new(1), "List[int]");

            // structured should be None by default
            assert!(type_info.structured.is_none());

            // When structured is None, it should not appear in JSON
            let json = serde_json::to_string(&type_info).unwrap();
            assert!(
                !json.contains("structured"),
                "structured field should be omitted when None"
            );

            // Required fields should be present
            assert!(json.contains("\"symbol_id\""));
            assert!(json.contains("\"type_repr\":\"List[int]\""));
            assert!(json.contains("\"source\":\"annotated\""));
        }

        #[test]
        fn type_info_structured_some_serialization() {
            let type_info = TypeInfo::annotated(SymbolId::new(1), "List[int]").with_structured(
                TypeNode::named_with_args("List", vec![TypeNode::named("int")]),
            );

            // structured should be Some
            assert!(type_info.structured.is_some());

            // When structured is Some, it should appear in JSON
            let json = serde_json::to_string(&type_info).unwrap();
            assert!(
                json.contains("\"structured\""),
                "structured field should be present when Some"
            );
            assert!(json.contains("\"kind\":\"named\""));
            assert!(json.contains("\"name\":\"List\""));
            assert!(json.contains("\"args\""));
        }

        #[test]
        fn type_info_with_structured_builder() {
            let sym_id = SymbolId::new(42);
            let structured_type = TypeNode::optional(TypeNode::named("str"));

            let type_info = TypeInfo::annotated(sym_id, "Optional[str]")
                .with_structured(structured_type.clone());

            assert_eq!(type_info.symbol_id, sym_id);
            assert_eq!(type_info.type_repr, "Optional[str]");
            assert_eq!(type_info.source, TypeSource::Annotated);
            assert_eq!(type_info.structured, Some(structured_type));
        }

        #[test]
        fn type_info_structured_roundtrip() {
            let type_info = TypeInfo::annotated(SymbolId::new(1), "Dict[str, int]")
                .with_structured(TypeNode::named_with_args(
                    "Dict",
                    vec![TypeNode::named("str"), TypeNode::named("int")],
                ));

            let json = serde_json::to_string(&type_info).unwrap();
            let parsed: TypeInfo = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed, type_info);
            assert!(parsed.structured.is_some());
        }

        /// Golden test: TypeInfo with structured types.
        ///
        /// Documents expected JSON format for TypeInfo with structured field.
        #[test]
        fn type_info_structured_golden() {
            let type_info =
                TypeInfo::annotated(SymbolId::new(1), "Callable[[int], str]").with_structured(
                    TypeNode::callable(vec![TypeNode::named("int")], TypeNode::named("str")),
                );

            let json = serde_json::to_string_pretty(&type_info).unwrap();

            // Verify structure
            assert!(json.contains("\"symbol_id\": 1"));
            assert!(json.contains("\"type_repr\": \"Callable[[int], str]\""));
            assert!(json.contains("\"source\": \"annotated\""));
            assert!(json.contains("\"structured\""));
            assert!(json.contains("\"kind\": \"callable\""));
            assert!(json.contains("\"params\""));
            assert!(json.contains("\"returns\""));
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

    mod visibility_tests {
        use super::*;

        #[test]
        fn visibility_serialization_roundtrip() {
            // Test all visibility variants serialize and deserialize correctly
            let variants = [
                Visibility::Public,
                Visibility::Crate,
                Visibility::Module,
                Visibility::Private,
                Visibility::Protected,
            ];

            for visibility in variants {
                let json = serde_json::to_string(&visibility).unwrap();
                let deserialized: Visibility = serde_json::from_str(&json).unwrap();
                assert_eq!(visibility, deserialized);
            }
        }

        #[test]
        fn visibility_serializes_to_snake_case() {
            assert_eq!(
                serde_json::to_string(&Visibility::Public).unwrap(),
                "\"public\""
            );
            assert_eq!(
                serde_json::to_string(&Visibility::Crate).unwrap(),
                "\"crate\""
            );
            assert_eq!(
                serde_json::to_string(&Visibility::Module).unwrap(),
                "\"module\""
            );
            assert_eq!(
                serde_json::to_string(&Visibility::Private).unwrap(),
                "\"private\""
            );
            assert_eq!(
                serde_json::to_string(&Visibility::Protected).unwrap(),
                "\"protected\""
            );
        }

        #[test]
        fn symbol_visibility_none_not_serialized() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.py");
            let file_id = file.file_id;

            let symbol = test_symbol(&mut store, "foo", file_id, 0);
            // Visibility should default to None
            assert!(symbol.visibility.is_none());

            // When serialized, visibility should not appear in JSON
            let json = serde_json::to_string(&symbol).unwrap();
            assert!(!json.contains("visibility"));
        }

        #[test]
        fn symbol_visibility_some_serialized() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.rs");
            let file_id = file.file_id;

            let symbol =
                test_symbol(&mut store, "bar", file_id, 0).with_visibility(Visibility::Public);
            assert_eq!(symbol.visibility, Some(Visibility::Public));

            // When serialized, visibility should appear in JSON
            let json = serde_json::to_string(&symbol).unwrap();
            assert!(json.contains("\"visibility\":\"public\""));
        }

        #[test]
        fn symbol_with_visibility_builder() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.rs");
            let file_id = file.file_id;

            // Test chaining with_visibility builder
            let symbol = test_symbol(&mut store, "baz", file_id, 0)
                .with_module(ModuleId::new(1))
                .with_visibility(Visibility::Private);

            assert_eq!(symbol.visibility, Some(Visibility::Private));
            assert_eq!(symbol.module_id, Some(ModuleId::new(1)));
        }
    }

    mod import_kind_tests {
        use super::*;

        #[test]
        fn import_kind_serialization_roundtrip() {
            let variants = [
                ImportKind::Module,
                ImportKind::Named,
                ImportKind::Alias,
                ImportKind::Glob,
                ImportKind::ReExport,
                ImportKind::Default,
            ];

            for kind in variants {
                let json = serde_json::to_string(&kind).unwrap();
                let deserialized: ImportKind = serde_json::from_str(&json).unwrap();
                assert_eq!(kind, deserialized);
            }
        }

        #[test]
        fn import_kind_serializes_to_snake_case() {
            assert_eq!(
                serde_json::to_string(&ImportKind::Module).unwrap(),
                "\"module\""
            );
            assert_eq!(
                serde_json::to_string(&ImportKind::Named).unwrap(),
                "\"named\""
            );
            assert_eq!(
                serde_json::to_string(&ImportKind::Alias).unwrap(),
                "\"alias\""
            );
            assert_eq!(
                serde_json::to_string(&ImportKind::Glob).unwrap(),
                "\"glob\""
            );
            assert_eq!(
                serde_json::to_string(&ImportKind::ReExport).unwrap(),
                "\"re_export\""
            );
            assert_eq!(
                serde_json::to_string(&ImportKind::Default).unwrap(),
                "\"default\""
            );
        }

        #[test]
        fn import_with_imported_name_sets_named_kind() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // from foo import bar → Named
            let import = test_import(&mut store, file_id, "foo").with_imported_name("bar");
            assert_eq!(import.kind, ImportKind::Named);
            assert_eq!(import.imported_name, Some("bar".to_string()));
        }

        #[test]
        fn import_with_alias_sets_alias_kind() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // import foo as f → Alias
            let import = test_import(&mut store, file_id, "foo").with_alias("f");
            assert_eq!(import.kind, ImportKind::Alias);
            assert_eq!(import.alias, Some("f".to_string()));
        }

        #[test]
        fn import_with_glob_sets_glob_kind() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // from foo import * → Glob
            let import = test_import(&mut store, file_id, "foo").with_glob();
            assert_eq!(import.kind, ImportKind::Glob);
        }

        #[test]
        fn import_builder_precedence_is_order_independent() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // from foo import bar as baz
            // Order 1: with_imported_name first, then with_alias
            let import1 = test_import(&mut store, file_id, "foo")
                .with_imported_name("bar")
                .with_alias("baz");
            assert_eq!(import1.kind, ImportKind::Alias);

            // Order 2: with_alias first, then with_imported_name
            let import2 = test_import(&mut store, file_id, "foo")
                .with_alias("baz")
                .with_imported_name("bar");
            assert_eq!(import2.kind, ImportKind::Alias);
        }

        #[test]
        fn import_with_kind_overrides_auto_derived() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Explicit kind override
            let import = test_import(&mut store, file_id, "foo")
                .with_imported_name("bar")
                .with_kind(ImportKind::ReExport);
            assert_eq!(import.kind, ImportKind::ReExport);
        }

        #[test]
        fn import_default_kind_is_module() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "test.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // import foo → Module
            let import = test_import(&mut store, file_id, "foo");
            assert_eq!(import.kind, ImportKind::Module);
        }
    }

    mod module_kind_tests {
        use super::*;

        #[test]
        fn module_kind_serialization_roundtrip() {
            let variants = [
                ModuleKind::File,
                ModuleKind::Directory,
                ModuleKind::Inline,
                ModuleKind::Namespace,
            ];

            for kind in variants {
                let json = serde_json::to_string(&kind).unwrap();
                let deserialized: ModuleKind = serde_json::from_str(&json).unwrap();
                assert_eq!(kind, deserialized);
            }
        }

        #[test]
        fn module_kind_serializes_to_snake_case() {
            assert_eq!(
                serde_json::to_string(&ModuleKind::File).unwrap(),
                "\"file\""
            );
            assert_eq!(
                serde_json::to_string(&ModuleKind::Directory).unwrap(),
                "\"directory\""
            );
            assert_eq!(
                serde_json::to_string(&ModuleKind::Inline).unwrap(),
                "\"inline\""
            );
            assert_eq!(
                serde_json::to_string(&ModuleKind::Namespace).unwrap(),
                "\"namespace\""
            );
        }

        #[test]
        fn module_default_kind_is_file() {
            assert_eq!(ModuleKind::default(), ModuleKind::File);
        }

        #[test]
        fn module_with_decl_span_sets_span() {
            let mut store = FactsStore::new();
            let module_id = store.next_module_id();
            let module = Module::new(module_id, "mymodule", ModuleKind::Inline, None, None)
                .with_decl_span(Span::new(10, 50));

            assert_eq!(module.kind, ModuleKind::Inline);
            assert_eq!(module.decl_span, Some(Span::new(10, 50)));
        }

        #[test]
        fn module_decl_span_none_not_serialized() {
            let mut store = FactsStore::new();
            let module_id = store.next_module_id();
            let module = Module::new(module_id, "mymodule", ModuleKind::File, None, None);

            // decl_span should be None by default
            assert!(module.decl_span.is_none());

            // When serialized, decl_span should not appear in JSON
            let json = serde_json::to_string(&module).unwrap();
            assert!(!json.contains("decl_span"));
        }

        #[test]
        fn module_decl_span_some_serialized() {
            let mut store = FactsStore::new();
            let module_id = store.next_module_id();
            let module = Module::new(module_id, "mymodule", ModuleKind::Inline, None, None)
                .with_decl_span(Span::new(10, 50));

            // When serialized, decl_span should appear in JSON
            let json = serde_json::to_string(&module).unwrap();
            assert!(json.contains("\"decl_span\""));
        }
    }

    mod schema_version_tests {
        use super::*;

        #[test]
        fn facts_schema_version_is_11() {
            assert_eq!(FACTS_SCHEMA_VERSION, 11);
        }

        #[test]
        fn facts_store_new_sets_schema_version() {
            let store = FactsStore::new();
            assert_eq!(store.schema_version, FACTS_SCHEMA_VERSION);
        }

        #[test]
        fn facts_store_default_sets_schema_version() {
            let store = FactsStore::default();
            assert_eq!(store.schema_version, FACTS_SCHEMA_VERSION);
        }
    }

    mod alias_edge_tests {
        use super::*;

        #[test]
        fn alias_kind_serialization() {
            // Test all AliasKind variants serialize correctly
            let kinds = [
                (AliasKind::Assignment, "\"assignment\""),
                (AliasKind::Import, "\"import\""),
                (AliasKind::ReExport, "\"re_export\""),
                (AliasKind::Unknown, "\"unknown\""),
            ];

            for (kind, expected_json) in kinds {
                let json = serde_json::to_string(&kind).unwrap();
                assert_eq!(json, expected_json, "Failed for {:?}", kind);
            }
        }

        #[test]
        fn alias_kind_deserialization() {
            let cases = [
                ("\"assignment\"", AliasKind::Assignment),
                ("\"import\"", AliasKind::Import),
                ("\"re_export\"", AliasKind::ReExport),
                ("\"unknown\"", AliasKind::Unknown),
            ];

            for (json, expected_kind) in cases {
                let deserialized: AliasKind = serde_json::from_str(json).unwrap();
                assert_eq!(deserialized, expected_kind, "Failed for {}", json);
            }
        }

        #[test]
        fn alias_kind_default() {
            assert_eq!(AliasKind::default(), AliasKind::Assignment);
        }

        #[test]
        fn alias_edge_without_confidence_serializes_without_field() {
            let edge = AliasEdge::new(
                AliasEdgeId::new(0),
                FileId::new(0),
                Span::new(10, 20),
                SymbolId::new(1),
                AliasKind::Assignment,
            );

            let json = serde_json::to_string(&edge).unwrap();
            assert!(
                !json.contains("confidence"),
                "confidence should be omitted when None"
            );
            assert!(
                !json.contains("target_symbol_id"),
                "target_symbol_id should be omitted when None"
            );
        }

        #[test]
        fn alias_edge_with_confidence_serializes_correctly() {
            let edge = AliasEdge::new(
                AliasEdgeId::new(0),
                FileId::new(0),
                Span::new(10, 20),
                SymbolId::new(1),
                AliasKind::Assignment,
            )
            .with_confidence(0.8);

            let json = serde_json::to_string(&edge).unwrap();
            assert!(
                json.contains("\"confidence\":0.8"),
                "confidence should be in JSON: {}",
                json
            );
        }

        #[test]
        fn alias_edge_with_target_serializes_correctly() {
            let edge = AliasEdge::new(
                AliasEdgeId::new(0),
                FileId::new(0),
                Span::new(10, 20),
                SymbolId::new(1),
                AliasKind::Assignment,
            )
            .with_target(SymbolId::new(2));

            let json = serde_json::to_string(&edge).unwrap();
            assert!(
                json.contains("target_symbol_id"),
                "target_symbol_id should be in JSON: {}",
                json
            );
        }

        #[test]
        fn alias_edge_insert_and_query_roundtrip() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create two symbols: alias and target
            let target_id = store.next_symbol_id();
            let target_sym = Symbol::new(
                target_id,
                SymbolKind::Variable,
                "original",
                file_id,
                Span::new(0, 8),
            );
            store.insert_symbol(target_sym);

            let alias_id = store.next_symbol_id();
            let alias_sym = Symbol::new(
                alias_id,
                SymbolKind::Variable,
                "aliased",
                file_id,
                Span::new(10, 17),
            );
            store.insert_symbol(alias_sym);

            // Create alias edge
            let edge_id = store.next_alias_edge_id();
            let edge = AliasEdge::new(
                edge_id,
                file_id,
                Span::new(10, 20),
                alias_id,
                AliasKind::Assignment,
            )
            .with_target(target_id)
            .with_confidence(1.0);

            store.insert_alias_edge(edge);

            // Query by ID
            let retrieved = store.alias_edge(edge_id).unwrap();
            assert_eq!(retrieved.alias_symbol_id, alias_id);
            assert_eq!(retrieved.target_symbol_id, Some(target_id));
            assert_eq!(retrieved.kind, AliasKind::Assignment);
            assert_eq!(retrieved.confidence, Some(1.0));
        }

        #[test]
        fn alias_edge_forward_and_reverse_lookups() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create symbols
            let target_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                target_id,
                SymbolKind::Variable,
                "target",
                file_id,
                Span::new(0, 6),
            ));

            let alias1_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                alias1_id,
                SymbolKind::Variable,
                "alias1",
                file_id,
                Span::new(10, 16),
            ));

            let alias2_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                alias2_id,
                SymbolKind::Variable,
                "alias2",
                file_id,
                Span::new(20, 26),
            ));

            // Create two alias edges pointing to the same target
            let edge1_id = store.next_alias_edge_id();
            store.insert_alias_edge(
                AliasEdge::new(
                    edge1_id,
                    file_id,
                    Span::new(10, 20),
                    alias1_id,
                    AliasKind::Assignment,
                )
                .with_target(target_id),
            );

            let edge2_id = store.next_alias_edge_id();
            store.insert_alias_edge(
                AliasEdge::new(
                    edge2_id,
                    file_id,
                    Span::new(20, 30),
                    alias2_id,
                    AliasKind::Assignment,
                )
                .with_target(target_id),
            );

            // Forward lookup: alias1 → edges
            let alias1_edges = store.alias_edges_for_symbol(alias1_id);
            assert_eq!(alias1_edges.len(), 1);
            assert_eq!(alias1_edges[0].alias_id, edge1_id);

            // Reverse lookup: target → all aliasing edges
            let target_edges = store.alias_sources_for_target(target_id);
            assert_eq!(target_edges.len(), 2);

            // Verify count
            assert_eq!(store.alias_edge_count(), 2);
        }

        #[test]
        fn aliases_from_edges_produces_valid_alias_output() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create symbols
            let target_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                target_id,
                SymbolKind::Variable,
                "original",
                file_id,
                Span::new(0, 8),
            ));

            let alias_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                alias_id,
                SymbolKind::Variable,
                "aliased",
                file_id,
                Span::new(10, 17),
            ));

            // Create alias edge
            let edge_id = store.next_alias_edge_id();
            store.insert_alias_edge(
                AliasEdge::new(
                    edge_id,
                    file_id,
                    Span::new(10, 20),
                    alias_id,
                    AliasKind::Assignment,
                )
                .with_target(target_id)
                .with_confidence(0.9),
            );

            // Create file contents for position calculation
            let mut file_contents = std::collections::HashMap::new();
            file_contents.insert(
                "src/main.py".to_string(),
                "original\n\naliased = original".to_string(),
            );

            let aliases = store.aliases_from_edges(&file_contents);
            assert_eq!(aliases.len(), 1);

            let alias_output = &aliases[0];
            assert_eq!(alias_output.alias_name, "aliased");
            assert_eq!(alias_output.source_name, "original");
            assert_eq!(alias_output.file, "src/main.py");
            assert!(!alias_output.is_import_alias);
            assert!((alias_output.confidence - 0.9).abs() < 0.001);
        }

        #[test]
        fn alias_edge_id_display() {
            let id = AliasEdgeId::new(42);
            assert_eq!(format!("{}", id), "alias_42");
        }

        #[test]
        fn alias_edge_iteration() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let sym_id = store.next_symbol_id();
            store.insert_symbol(Symbol::new(
                sym_id,
                SymbolKind::Variable,
                "x",
                file_id,
                Span::new(0, 1),
            ));

            // Insert 3 alias edges
            for i in 0..3 {
                let edge_id = store.next_alias_edge_id();
                store.insert_alias_edge(AliasEdge::new(
                    edge_id,
                    file_id,
                    Span::new(i * 10, (i + 1) * 10),
                    sym_id,
                    AliasKind::Assignment,
                ));
            }

            let edges: Vec<_> = store.alias_edges().collect();
            assert_eq!(edges.len(), 3);
        }
    }

    mod signature_tests {
        use super::*;

        #[test]
        fn param_kind_serialization() {
            // Test all ParamKind variants serialize correctly
            assert_eq!(
                serde_json::to_string(&ParamKind::Regular).unwrap(),
                "\"regular\""
            );
            assert_eq!(
                serde_json::to_string(&ParamKind::PositionalOnly).unwrap(),
                "\"positional_only\""
            );
            assert_eq!(
                serde_json::to_string(&ParamKind::KeywordOnly).unwrap(),
                "\"keyword_only\""
            );
            assert_eq!(
                serde_json::to_string(&ParamKind::VarArgs).unwrap(),
                "\"var_args\""
            );
            assert_eq!(
                serde_json::to_string(&ParamKind::KwArgs).unwrap(),
                "\"kw_args\""
            );
            assert_eq!(
                serde_json::to_string(&ParamKind::SelfValue).unwrap(),
                "\"self_value\""
            );
            assert_eq!(
                serde_json::to_string(&ParamKind::SelfRef).unwrap(),
                "\"self_ref\""
            );
            assert_eq!(
                serde_json::to_string(&ParamKind::SelfMutRef).unwrap(),
                "\"self_mut_ref\""
            );
        }

        #[test]
        fn param_kind_deserialization() {
            // Round-trip test
            let kinds = [
                ParamKind::Regular,
                ParamKind::PositionalOnly,
                ParamKind::KeywordOnly,
                ParamKind::VarArgs,
                ParamKind::KwArgs,
                ParamKind::SelfValue,
                ParamKind::SelfRef,
                ParamKind::SelfMutRef,
            ];
            for kind in kinds {
                let json = serde_json::to_string(&kind).unwrap();
                let parsed: ParamKind = serde_json::from_str(&json).unwrap();
                assert_eq!(parsed, kind);
            }
        }

        #[test]
        fn parameter_without_annotation() {
            let param = Parameter::regular("x");
            assert_eq!(param.name, "x");
            assert_eq!(param.kind, ParamKind::Regular);
            assert!(param.default_span.is_none());
            assert!(param.annotation.is_none());

            // Serialization should skip None fields
            let json = serde_json::to_string(&param).unwrap();
            assert!(!json.contains("default_span"));
            assert!(!json.contains("annotation"));
        }

        #[test]
        fn parameter_with_annotation() {
            let param = Parameter::new("count", ParamKind::KeywordOnly)
                .with_annotation(TypeNode::named("int"))
                .with_default_span(Span::new(10, 15));

            assert_eq!(param.name, "count");
            assert_eq!(param.kind, ParamKind::KeywordOnly);
            assert_eq!(param.default_span, Some(Span::new(10, 15)));
            assert!(param.annotation.is_some());

            // Serialization should include all fields
            let json = serde_json::to_string(&param).unwrap();
            assert!(json.contains("\"kind\":\"keyword_only\""));
            assert!(json.contains("\"name\":\"count\""));
            assert!(json.contains("\"default_span\""));
            assert!(json.contains("\"annotation\""));
        }

        #[test]
        fn signature_with_multiple_params_and_return_type() {
            let symbol_id = SymbolId::new(42);
            let sig = Signature::new(symbol_id)
                .with_params(vec![
                    Parameter::regular("self"),
                    Parameter::regular("x").with_annotation(TypeNode::named("int")),
                    Parameter::new("y", ParamKind::KeywordOnly)
                        .with_annotation(TypeNode::optional(TypeNode::named("str"))),
                ])
                .with_returns(TypeNode::named("bool"));

            assert_eq!(sig.symbol_id, symbol_id);
            assert_eq!(sig.params.len(), 3);
            assert_eq!(sig.params[0].name, "self");
            assert_eq!(sig.params[1].kind, ParamKind::Regular);
            assert_eq!(sig.params[2].kind, ParamKind::KeywordOnly);
            assert!(sig.returns.is_some());
        }

        #[test]
        fn signature_insert_and_query() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "process", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            // Create and insert signature
            let sig = Signature::new(symbol_id)
                .with_params(vec![
                    Parameter::regular("data"),
                    Parameter::new("verbose", ParamKind::KeywordOnly)
                        .with_annotation(TypeNode::named("bool")),
                ])
                .with_returns(TypeNode::named("Result"));

            store.insert_signature(sig);

            // Query signature
            let retrieved = store.signature(symbol_id).unwrap();
            assert_eq!(retrieved.params.len(), 2);
            assert_eq!(retrieved.params[0].name, "data");
            assert_eq!(retrieved.params[1].name, "verbose");
            assert!(retrieved.returns.is_some());
        }

        #[test]
        fn signature_count_and_iteration() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Insert 3 functions with signatures
            for i in 0..3 {
                let symbol = test_symbol(&mut store, &format!("func{}", i), file_id, i * 20);
                let symbol_id = symbol.symbol_id;
                store.insert_symbol(symbol);
                store.insert_signature(Signature::new(symbol_id));
            }

            assert_eq!(store.signature_count(), 3);
            let sigs: Vec<_> = store.signatures().collect();
            assert_eq!(sigs.len(), 3);
        }

        #[test]
        fn signature_replaces_on_duplicate_insert() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "func", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            // Insert initial signature with 1 param
            store.insert_signature(
                Signature::new(symbol_id).with_params(vec![Parameter::regular("a")]),
            );

            // Replace with 2 params
            store.insert_signature(
                Signature::new(symbol_id)
                    .with_params(vec![Parameter::regular("x"), Parameter::regular("y")]),
            );

            let sig = store.signature(symbol_id).unwrap();
            assert_eq!(sig.params.len(), 2);
            assert_eq!(sig.params[0].name, "x");
            assert_eq!(store.signature_count(), 1);
        }

        #[test]
        fn signature_returns_none_for_missing() {
            let store = FactsStore::new();
            assert!(store.signature(SymbolId::new(999)).is_none());
        }
    }

    mod type_param_tests {
        use super::*;

        #[test]
        fn type_param_without_bounds() {
            let tp = TypeParam::new("T");
            assert_eq!(tp.name, "T");
            assert!(tp.bounds.is_empty());
            assert!(tp.default.is_none());

            // Empty bounds should not serialize
            let json = serde_json::to_string(&tp).unwrap();
            assert!(!json.contains("bounds"));
        }

        #[test]
        fn type_param_with_bounds_and_default() {
            let tp = TypeParam::new("T")
                .with_bounds(vec![
                    TypeNode::named("Comparable"),
                    TypeNode::named("Hashable"),
                ])
                .with_default(TypeNode::named("int"));

            assert_eq!(tp.name, "T");
            assert_eq!(tp.bounds.len(), 2);
            assert!(tp.default.is_some());
        }

        #[test]
        fn type_param_serialization_roundtrip() {
            let tp = TypeParam::new("K")
                .with_bound(TypeNode::named("Hash"))
                .with_default(TypeNode::named("str"));

            let json = serde_json::to_string(&tp).unwrap();
            let parsed: TypeParam = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed.name, tp.name);
            assert_eq!(parsed.bounds.len(), tp.bounds.len());
        }

        #[test]
        fn type_params_insert_and_query() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "GenericClass", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            // Insert type params
            store.insert_type_params(
                symbol_id,
                vec![
                    TypeParam::new("T"),
                    TypeParam::new("U").with_bound(TypeNode::named("Numeric")),
                ],
            );

            // Query
            let params = store.type_params_for(symbol_id).unwrap();
            assert_eq!(params.len(), 2);
            assert_eq!(params[0].name, "T");
            assert_eq!(params[1].name, "U");
        }

        #[test]
        fn type_params_count_and_iteration() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Insert 2 generic symbols
            for name in ["GenericA", "GenericB"] {
                let symbol = test_symbol(&mut store, name, file_id, 0);
                let symbol_id = symbol.symbol_id;
                store.insert_symbol(symbol);
                store.insert_type_params(symbol_id, vec![TypeParam::new("T")]);
            }

            assert_eq!(store.type_params_count(), 2);
            let all: Vec<_> = store.type_params().collect();
            assert_eq!(all.len(), 2);
        }

        #[test]
        fn type_params_returns_none_for_missing() {
            let store = FactsStore::new();
            assert!(store.type_params_for(SymbolId::new(999)).is_none());
        }

        #[test]
        fn type_params_replaces_on_duplicate_insert() {
            let mut store = FactsStore::new();

            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let symbol = test_symbol(&mut store, "Generic", file_id, 10);
            let symbol_id = symbol.symbol_id;
            store.insert_symbol(symbol);

            // Insert initial
            store.insert_type_params(symbol_id, vec![TypeParam::new("T")]);

            // Replace
            store.insert_type_params(symbol_id, vec![TypeParam::new("K"), TypeParam::new("V")]);

            let params = store.type_params_for(symbol_id).unwrap();
            assert_eq!(params.len(), 2);
            assert_eq!(params[0].name, "K");
        }
    }

    mod type_node_tests {
        use super::*;

        #[test]
        fn type_node_named_serialization() {
            let node = TypeNode::named("int");
            let json = serde_json::to_string(&node).unwrap();
            assert!(json.contains("\"kind\":\"named\""));
            assert!(json.contains("\"name\":\"int\""));
            // Empty args should not be serialized
            assert!(!json.contains("args"));
        }

        #[test]
        fn type_node_named_with_args_serialization() {
            let node = TypeNode::named_with_args("List", vec![TypeNode::named("int")]);
            let json = serde_json::to_string(&node).unwrap();
            assert!(json.contains("\"kind\":\"named\""));
            assert!(json.contains("\"name\":\"List\""));
            assert!(json.contains("\"args\""));
        }

        #[test]
        fn type_node_optional_serialization() {
            let node = TypeNode::optional(TypeNode::named("str"));
            let json = serde_json::to_string(&node).unwrap();
            assert!(json.contains("\"kind\":\"optional\""));
            assert!(json.contains("\"inner\""));
        }

        #[test]
        fn type_node_union_serialization() {
            let node = TypeNode::union(vec![TypeNode::named("str"), TypeNode::named("int")]);
            let json = serde_json::to_string(&node).unwrap();
            assert!(json.contains("\"kind\":\"union\""));
            assert!(json.contains("\"members\""));
        }

        #[test]
        fn type_node_callable_serialization() {
            let node = TypeNode::callable(
                vec![TypeNode::named("int"), TypeNode::named("str")],
                TypeNode::named("bool"),
            );
            let json = serde_json::to_string(&node).unwrap();
            assert!(json.contains("\"kind\":\"callable\""));
            assert!(json.contains("\"params\""));
            assert!(json.contains("\"returns\""));
        }

        #[test]
        fn type_node_tuple_serialization() {
            let node = TypeNode::tuple(vec![
                TypeNode::named("int"),
                TypeNode::named("str"),
                TypeNode::named("bool"),
            ]);
            let json = serde_json::to_string(&node).unwrap();
            assert!(json.contains("\"kind\":\"tuple\""));
            assert!(json.contains("\"elements\""));
        }

        #[test]
        fn type_node_extension_serialization() {
            let node = TypeNode::extension("reference", vec![TypeNode::named("str")]);
            let json = serde_json::to_string(&node).unwrap();
            assert!(json.contains("\"kind\":\"extension\""));
            assert!(json.contains("\"name\":\"reference\""));
        }

        #[test]
        fn type_node_unknown_serialization() {
            let node = TypeNode::Unknown;
            let json = serde_json::to_string(&node).unwrap();
            assert_eq!(json, "{\"kind\":\"unknown\"}");
        }

        #[test]
        fn type_node_roundtrip() {
            // Test complex nested type: Dict[str, List[Optional[int]]]
            let node = TypeNode::named_with_args(
                "Dict",
                vec![
                    TypeNode::named("str"),
                    TypeNode::named_with_args(
                        "List",
                        vec![TypeNode::optional(TypeNode::named("int"))],
                    ),
                ],
            );

            let json = serde_json::to_string(&node).unwrap();
            let parsed: TypeNode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, node);
        }

        #[test]
        fn typenode_named_roundtrip() {
            let node = TypeNode::named("MyClass");
            let json = serde_json::to_string(&node).unwrap();
            let parsed: TypeNode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, node);
        }

        #[test]
        fn typenode_union_roundtrip() {
            let node = TypeNode::union(vec![
                TypeNode::named("str"),
                TypeNode::named("int"),
                TypeNode::named("None"),
            ]);
            let json = serde_json::to_string(&node).unwrap();
            let parsed: TypeNode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, node);
        }

        #[test]
        fn typenode_optional_roundtrip() {
            let node = TypeNode::optional(TypeNode::named("str"));
            let json = serde_json::to_string(&node).unwrap();
            let parsed: TypeNode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, node);
        }

        #[test]
        fn typenode_callable_roundtrip() {
            let node = TypeNode::callable(
                vec![TypeNode::named("int"), TypeNode::named("str")],
                TypeNode::named("bool"),
            );
            let json = serde_json::to_string(&node).unwrap();
            let parsed: TypeNode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, node);
        }

        #[test]
        fn typenode_tuple_roundtrip() {
            let node = TypeNode::tuple(vec![
                TypeNode::named("int"),
                TypeNode::named("str"),
                TypeNode::named("bool"),
            ]);
            let json = serde_json::to_string(&node).unwrap();
            let parsed: TypeNode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, node);
        }

        #[test]
        fn typenode_unknown_roundtrip() {
            let node = TypeNode::Unknown;
            let json = serde_json::to_string(&node).unwrap();
            let parsed: TypeNode = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, node);
        }
    }

    mod attribute_access_tests {
        use super::*;

        #[test]
        fn attribute_access_kind_serialization() {
            // Test all variants serialize correctly
            assert_eq!(
                serde_json::to_string(&AttributeAccessKind::Read).unwrap(),
                "\"read\""
            );
            assert_eq!(
                serde_json::to_string(&AttributeAccessKind::Write).unwrap(),
                "\"write\""
            );
            assert_eq!(
                serde_json::to_string(&AttributeAccessKind::Call).unwrap(),
                "\"call\""
            );
        }

        #[test]
        fn attribute_access_kind_deserialization() {
            let read: AttributeAccessKind = serde_json::from_str("\"read\"").unwrap();
            assert_eq!(read, AttributeAccessKind::Read);

            let write: AttributeAccessKind = serde_json::from_str("\"write\"").unwrap();
            assert_eq!(write, AttributeAccessKind::Write);

            let call: AttributeAccessKind = serde_json::from_str("\"call\"").unwrap();
            assert_eq!(call, AttributeAccessKind::Call);
        }

        #[test]
        fn attribute_access_kind_default() {
            assert_eq!(AttributeAccessKind::default(), AttributeAccessKind::Read);
        }

        #[test]
        fn attribute_access_with_resolved_base() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create a symbol for the base object
            let base_symbol = test_symbol(&mut store, "obj", file_id, 10);
            let base_symbol_id = base_symbol.symbol_id;
            store.insert_symbol(base_symbol);

            // Create an attribute access with resolved base
            let access_id = store.next_attribute_access_id();
            let access = AttributeAccess::new(
                access_id,
                file_id,
                Span::new(50, 54),
                "attr",
                AttributeAccessKind::Read,
            )
            .with_base_symbol(base_symbol_id);
            store.insert_attribute_access(access);

            let retrieved = store.attribute_access(access_id).unwrap();
            assert_eq!(retrieved.name, "attr");
            assert_eq!(retrieved.kind, AttributeAccessKind::Read);
            assert_eq!(retrieved.base_symbol_id, Some(base_symbol_id));
        }

        #[test]
        fn attribute_access_with_unresolved_base() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create an attribute access without resolved base
            let access_id = store.next_attribute_access_id();
            let access = AttributeAccess::new(
                access_id,
                file_id,
                Span::new(50, 54),
                "method",
                AttributeAccessKind::Call,
            );
            store.insert_attribute_access(access);

            let retrieved = store.attribute_access(access_id).unwrap();
            assert_eq!(retrieved.name, "method");
            assert_eq!(retrieved.kind, AttributeAccessKind::Call);
            assert_eq!(retrieved.base_symbol_id, None);
        }

        #[test]
        fn attribute_access_insert_query_roundtrip() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Insert multiple attribute accesses
            for (i, name) in ["attr1", "attr2", "attr3"].iter().enumerate() {
                let access_id = store.next_attribute_access_id();
                let access = AttributeAccess::new(
                    access_id,
                    file_id,
                    Span::new(i * 10, i * 10 + 5),
                    *name,
                    AttributeAccessKind::Read,
                );
                store.insert_attribute_access(access);
            }

            assert_eq!(store.attribute_access_count(), 3);

            // Query by file
            let in_file = store.attribute_accesses_in_file(file_id);
            assert_eq!(in_file.len(), 3);
        }

        #[test]
        fn attribute_access_query_by_name() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Insert accesses to same attribute name in different positions
            for i in 0..3 {
                let access_id = store.next_attribute_access_id();
                let access = AttributeAccess::new(
                    access_id,
                    file_id,
                    Span::new(i * 10, i * 10 + 4),
                    "data",
                    AttributeAccessKind::Read,
                );
                store.insert_attribute_access(access);
            }

            // Insert one access to a different name
            let access_id = store.next_attribute_access_id();
            let access = AttributeAccess::new(
                access_id,
                file_id,
                Span::new(100, 106),
                "config",
                AttributeAccessKind::Read,
            );
            store.insert_attribute_access(access);

            // Query by name should find all "data" accesses
            let data_accesses = store.attribute_accesses_named("data");
            assert_eq!(data_accesses.len(), 3);

            let config_accesses = store.attribute_accesses_named("config");
            assert_eq!(config_accesses.len(), 1);

            let unknown = store.attribute_accesses_named("unknown");
            assert!(unknown.is_empty());
        }

        #[test]
        fn attribute_access_iteration() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            for i in 0..5 {
                let access_id = store.next_attribute_access_id();
                let access = AttributeAccess::new(
                    access_id,
                    file_id,
                    Span::new(i * 10, i * 10 + 4),
                    format!("attr{}", i),
                    AttributeAccessKind::Read,
                );
                store.insert_attribute_access(access);
            }

            // Iteration should be deterministic
            let iter1: Vec<_> = store.attribute_accesses().map(|a| a.access_id).collect();
            let iter2: Vec<_> = store.attribute_accesses().map(|a| a.access_id).collect();
            assert_eq!(iter1, iter2);
            assert_eq!(iter1.len(), 5);
        }

        #[test]
        fn attribute_access_serialization() {
            let access = AttributeAccess::new(
                AttributeAccessId::new(1),
                FileId::new(0),
                Span::new(10, 14),
                "attr",
                AttributeAccessKind::Write,
            );

            let json = serde_json::to_string(&access).unwrap();
            assert!(json.contains("\"access_id\":1"));
            assert!(json.contains("\"name\":\"attr\""));
            assert!(json.contains("\"kind\":\"write\""));
            // base_symbol_id should not appear when None
            assert!(!json.contains("base_symbol_id"));
        }
    }

    mod call_site_tests {
        use super::*;

        #[test]
        fn call_arg_positional() {
            let arg = CallArg::positional(Span::new(10, 15));
            assert_eq!(arg.name, None);
            assert_eq!(arg.span.start, 10);
        }

        #[test]
        fn call_arg_keyword() {
            let arg = CallArg::keyword("value", Span::new(20, 30), Some(Span::new(14, 19)));
            assert_eq!(arg.name, Some("value".to_string()));
            assert_eq!(arg.span.start, 20);
            assert_eq!(arg.keyword_name_span, Some(Span::new(14, 19)));
        }

        #[test]
        fn call_arg_positional_has_no_keyword_name_span() {
            let arg = CallArg::positional(Span::new(10, 15));
            assert!(arg.keyword_name_span.is_none());
        }

        #[test]
        fn call_arg_serialization() {
            let positional = CallArg::positional(Span::new(10, 15));
            let json = serde_json::to_string(&positional).unwrap();
            // name should not appear when None
            assert!(!json.contains("\"name\""));
            assert!(json.contains("\"span\""));

            let keyword = CallArg::keyword("arg", Span::new(20, 25), Some(Span::new(15, 18)));
            let json = serde_json::to_string(&keyword).unwrap();
            assert!(json.contains("\"name\":\"arg\""));
            assert!(json.contains("\"keyword_name_span\""));
        }

        #[test]
        fn call_site_with_resolved_callee() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create a symbol for the callee
            let callee_symbol = test_symbol(&mut store, "process", file_id, 10);
            let callee_symbol_id = callee_symbol.symbol_id;
            store.insert_symbol(callee_symbol);

            // Create a call site with resolved callee
            let call_id = store.next_call_site_id();
            let call = CallSite::new(call_id, file_id, Span::new(50, 70))
                .with_callee(callee_symbol_id)
                .with_args(vec![
                    CallArg::positional(Span::new(58, 59)),
                    CallArg::keyword("value", Span::new(67, 69), Some(Span::new(61, 66))),
                ]);
            store.insert_call_site(call);

            let retrieved = store.call_site(call_id).unwrap();
            assert_eq!(retrieved.callee_symbol_id, Some(callee_symbol_id));
            assert_eq!(retrieved.args.len(), 2);
            assert_eq!(retrieved.args[0].name, None);
            assert_eq!(retrieved.args[1].name, Some("value".to_string()));
        }

        #[test]
        fn call_site_with_unresolved_callee() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let call_id = store.next_call_site_id();
            let call = CallSite::new(call_id, file_id, Span::new(50, 60));
            store.insert_call_site(call);

            let retrieved = store.call_site(call_id).unwrap();
            assert_eq!(retrieved.callee_symbol_id, None);
            assert!(retrieved.args.is_empty());
        }

        #[test]
        fn call_site_insert_query_roundtrip() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Insert multiple call sites
            for i in 0..3 {
                let call_id = store.next_call_site_id();
                let call = CallSite::new(call_id, file_id, Span::new(i * 20, i * 20 + 10));
                store.insert_call_site(call);
            }

            assert_eq!(store.call_site_count(), 3);

            // Query by file
            let in_file = store.call_sites_in_file(file_id);
            assert_eq!(in_file.len(), 3);
        }

        #[test]
        fn call_site_query_by_callee() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Create callee symbols
            let callee1 = test_symbol(&mut store, "foo", file_id, 10);
            let callee1_id = callee1.symbol_id;
            store.insert_symbol(callee1);

            let callee2 = test_symbol(&mut store, "bar", file_id, 50);
            let callee2_id = callee2.symbol_id;
            store.insert_symbol(callee2);

            // Insert calls to callee1 (3 calls)
            for i in 0..3 {
                let call_id = store.next_call_site_id();
                let call = CallSite::new(call_id, file_id, Span::new(100 + i * 10, 105 + i * 10))
                    .with_callee(callee1_id);
                store.insert_call_site(call);
            }

            // Insert calls to callee2 (1 call)
            let call_id = store.next_call_site_id();
            let call = CallSite::new(call_id, file_id, Span::new(200, 210)).with_callee(callee2_id);
            store.insert_call_site(call);

            // Query by callee
            let calls_to_foo = store.call_sites_to_callee(callee1_id);
            assert_eq!(calls_to_foo.len(), 3);

            let calls_to_bar = store.call_sites_to_callee(callee2_id);
            assert_eq!(calls_to_bar.len(), 1);

            // Unknown callee returns empty
            let unknown = store.call_sites_to_callee(SymbolId::new(999));
            assert!(unknown.is_empty());
        }

        #[test]
        fn call_site_iteration() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            for i in 0..5 {
                let call_id = store.next_call_site_id();
                let call = CallSite::new(call_id, file_id, Span::new(i * 20, i * 20 + 10));
                store.insert_call_site(call);
            }

            // Iteration should be deterministic
            let iter1: Vec<_> = store.call_sites().map(|c| c.call_id).collect();
            let iter2: Vec<_> = store.call_sites().map(|c| c.call_id).collect();
            assert_eq!(iter1, iter2);
            assert_eq!(iter1.len(), 5);
        }

        #[test]
        fn call_site_serialization() {
            let call = CallSite::new(CallSiteId::new(1), FileId::new(0), Span::new(10, 30))
                .with_args(vec![CallArg::positional(Span::new(15, 20))]);

            let json = serde_json::to_string(&call).unwrap();
            assert!(json.contains("\"call_id\":1"));
            assert!(json.contains("\"args\""));
            // callee_symbol_id should not appear when None
            assert!(!json.contains("callee_symbol_id"));
        }

        #[test]
        fn call_site_with_mixed_args() {
            let call = CallSite::new(CallSiteId::new(1), FileId::new(0), Span::new(10, 50))
                .with_args(vec![
                    CallArg::positional(Span::new(15, 16)), // x
                    CallArg::positional(Span::new(18, 19)), // y
                    CallArg::keyword("timeout", Span::new(29, 30), Some(Span::new(21, 28))),
                    CallArg::keyword("retries", Span::new(40, 41), Some(Span::new(32, 39))),
                ]);

            assert_eq!(call.args.len(), 4);
            assert_eq!(call.args[0].name, None);
            assert_eq!(call.args[1].name, None);
            assert_eq!(call.args[2].name, Some("timeout".to_string()));
            assert_eq!(call.args[3].name, Some("retries".to_string()));
            // keyword args have keyword_name_span
            assert!(call.args[2].keyword_name_span.is_some());
            assert!(call.args[3].keyword_name_span.is_some());
        }

        #[test]
        fn call_site_id_display() {
            let id = CallSiteId::new(42);
            assert_eq!(format!("{}", id), "call_42");
        }

        #[test]
        fn attribute_access_id_display() {
            let id = AttributeAccessId::new(42);
            assert_eq!(format!("{}", id), "attr_42");
        }
    }

    /// Tests for Modifier enum.
    mod modifier_tests {
        use super::*;

        #[test]
        fn modifier_serialization_all_variants() {
            // Test that all variants serialize to snake_case
            let modifiers = vec![
                (Modifier::Async, "async"),
                (Modifier::Static, "static"),
                (Modifier::ClassMethod, "class_method"),
                (Modifier::Property, "property"),
                (Modifier::Abstract, "abstract"),
                (Modifier::Final, "final"),
                (Modifier::Override, "override"),
                (Modifier::Generator, "generator"),
            ];

            for (modifier, expected) in modifiers {
                let json = serde_json::to_string(&modifier).unwrap();
                assert_eq!(json, format!("\"{}\"", expected));

                // Roundtrip
                let deserialized: Modifier = serde_json::from_str(&json).unwrap();
                assert_eq!(deserialized, modifier);
            }
        }

        #[test]
        fn modifier_hash_and_eq() {
            use std::collections::HashSet;
            let mut set = HashSet::new();
            set.insert(Modifier::Async);
            set.insert(Modifier::Static);
            set.insert(Modifier::Async); // duplicate

            assert_eq!(set.len(), 2);
            assert!(set.contains(&Modifier::Async));
            assert!(set.contains(&Modifier::Static));
            assert!(!set.contains(&Modifier::Property));
        }
    }

    /// Tests for QualifiedName struct.
    mod qualified_name_tests {
        use super::*;

        #[test]
        fn qualified_name_roundtrip() {
            let symbol_id = SymbolId::new(42);
            let qname = QualifiedName::new(symbol_id, "mypackage.mymodule.MyClass.my_method");

            assert_eq!(qname.symbol_id, symbol_id);
            assert_eq!(qname.path, "mypackage.mymodule.MyClass.my_method");

            // Serialization roundtrip
            let json = serde_json::to_string(&qname).unwrap();
            let deserialized: QualifiedName = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, qname);
        }

        #[test]
        fn qualified_name_insert_and_lookup() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let sym = test_symbol(&mut store, "foo", file_id, 10);
            let sym_id = sym.symbol_id;
            store.insert_symbol(sym);

            let qname = QualifiedName::new(sym_id, "pkg.mod.foo");
            store.insert_qualified_name(qname.clone());

            // Lookup by symbol ID
            let retrieved = store.qualified_name(sym_id).unwrap();
            assert_eq!(retrieved.path, "pkg.mod.foo");

            // Reverse lookup by path
            let found_id = store.symbol_by_qualified_name("pkg.mod.foo").unwrap();
            assert_eq!(found_id, sym_id);
        }

        #[test]
        fn qualified_name_reverse_lookup() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            // Insert multiple symbols with qualified names
            for name in ["foo", "bar", "baz"] {
                let sym = test_symbol(&mut store, name, file_id, 10);
                let sym_id = sym.symbol_id;
                store.insert_symbol(sym);
                store.insert_qualified_name(QualifiedName::new(sym_id, format!("pkg.{}", name)));
            }

            // Each should be lookupable by path
            assert!(store.symbol_by_qualified_name("pkg.foo").is_some());
            assert!(store.symbol_by_qualified_name("pkg.bar").is_some());
            assert!(store.symbol_by_qualified_name("pkg.baz").is_some());

            // Unknown path returns None
            assert!(store.symbol_by_qualified_name("pkg.unknown").is_none());
        }

        #[test]
        fn qualified_name_replace_updates_reverse_index() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let sym = test_symbol(&mut store, "foo", file_id, 10);
            let sym_id = sym.symbol_id;
            store.insert_symbol(sym);

            // Insert initial qualified name
            store.insert_qualified_name(QualifiedName::new(sym_id, "old.path.foo"));
            assert!(store.symbol_by_qualified_name("old.path.foo").is_some());

            // Replace with new qualified name
            store.insert_qualified_name(QualifiedName::new(sym_id, "new.path.foo"));

            // Old path should no longer work
            assert!(store.symbol_by_qualified_name("old.path.foo").is_none());
            // New path should work
            assert_eq!(
                store.symbol_by_qualified_name("new.path.foo").unwrap(),
                sym_id
            );
        }

        #[test]
        fn qualified_name_iteration() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            for i in 0..5 {
                let sym = test_symbol(&mut store, &format!("sym{}", i), file_id, i * 10);
                let sym_id = sym.symbol_id;
                store.insert_symbol(sym);
                store.insert_qualified_name(QualifiedName::new(sym_id, format!("pkg.sym{}", i)));
            }

            assert_eq!(store.qualified_name_count(), 5);

            // Iteration should be deterministic
            let iter1: Vec<_> = store.qualified_names().map(|q| &q.path).collect();
            let iter2: Vec<_> = store.qualified_names().map(|q| &q.path).collect();
            assert_eq!(iter1, iter2);
        }
    }

    /// Tests for SymbolModifiers struct.
    mod symbol_modifiers_tests {
        use super::*;

        #[test]
        fn symbol_modifiers_multiple() {
            let symbol_id = SymbolId::new(42);
            let modifiers = SymbolModifiers::new(
                symbol_id,
                vec![Modifier::Async, Modifier::Static, Modifier::ClassMethod],
            );

            assert_eq!(modifiers.symbol_id, symbol_id);
            assert!(modifiers.has(Modifier::Async));
            assert!(modifiers.has(Modifier::Static));
            assert!(modifiers.has(Modifier::ClassMethod));
            assert!(!modifiers.has(Modifier::Property));
        }

        #[test]
        fn symbol_modifiers_insert_and_query() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let sym = test_symbol(&mut store, "my_method", file_id, 10);
            let sym_id = sym.symbol_id;
            store.insert_symbol(sym);

            // Insert modifiers
            store.insert_modifiers(SymbolModifiers::new(
                sym_id,
                vec![Modifier::Async, Modifier::Property],
            ));

            // Query
            let mods = store.modifiers_for(sym_id).unwrap();
            assert!(mods.has(Modifier::Async));
            assert!(mods.has(Modifier::Property));
            assert!(!mods.has(Modifier::Static));
        }

        #[test]
        fn has_modifier_convenience() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let sym = test_symbol(&mut store, "generator_fn", file_id, 10);
            let sym_id = sym.symbol_id;
            store.insert_symbol(sym);

            // Without modifiers, has_modifier returns false
            assert!(!store.has_modifier(sym_id, Modifier::Generator));

            // With modifiers
            store.insert_modifiers(SymbolModifiers::new(sym_id, vec![Modifier::Generator]));
            assert!(store.has_modifier(sym_id, Modifier::Generator));
            assert!(!store.has_modifier(sym_id, Modifier::Async));

            // Unknown symbol returns false
            assert!(!store.has_modifier(SymbolId::new(999), Modifier::Async));
        }

        #[test]
        fn symbol_modifiers_serialization() {
            let modifiers =
                SymbolModifiers::new(SymbolId::new(42), vec![Modifier::Async, Modifier::Override]);

            let json = serde_json::to_string(&modifiers).unwrap();
            assert!(json.contains("\"async\""));
            assert!(json.contains("\"override\""));

            // Roundtrip
            let deserialized: SymbolModifiers = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, modifiers);
        }

        #[test]
        fn symbol_modifiers_replace() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            let sym = test_symbol(&mut store, "method", file_id, 10);
            let sym_id = sym.symbol_id;
            store.insert_symbol(sym);

            // Initial modifiers
            store.insert_modifiers(SymbolModifiers::new(sym_id, vec![Modifier::Static]));
            assert!(store.has_modifier(sym_id, Modifier::Static));

            // Replace with new modifiers
            store.insert_modifiers(SymbolModifiers::new(
                sym_id,
                vec![Modifier::ClassMethod, Modifier::Abstract],
            ));

            // Old modifier gone, new modifiers present
            assert!(!store.has_modifier(sym_id, Modifier::Static));
            assert!(store.has_modifier(sym_id, Modifier::ClassMethod));
            assert!(store.has_modifier(sym_id, Modifier::Abstract));
        }

        #[test]
        fn symbol_modifiers_iteration() {
            let mut store = FactsStore::new();
            let file = test_file(&mut store, "src/main.py");
            let file_id = file.file_id;
            store.insert_file(file);

            for i in 0..3 {
                let sym = test_symbol(&mut store, &format!("method{}", i), file_id, i * 10);
                let sym_id = sym.symbol_id;
                store.insert_symbol(sym);
                store.insert_modifiers(SymbolModifiers::new(sym_id, vec![Modifier::Async]));
            }

            assert_eq!(store.symbol_modifiers_count(), 3);

            // Iteration should be deterministic
            let iter1: Vec<_> = store.all_modifiers().map(|m| m.symbol_id).collect();
            let iter2: Vec<_> = store.all_modifiers().map(|m| m.symbol_id).collect();
            assert_eq!(iter1, iter2);
        }
    }

    /// Tests for ModuleResolution struct.
    mod module_resolution_tests {
        use super::*;

        #[test]
        fn module_resolution_serialization() {
            let resolution = ModuleResolution::new("mypackage.utils", ModuleId::new(1));

            let json = serde_json::to_string(&resolution).unwrap();
            assert!(json.contains("\"module_path\""));
            assert!(json.contains("\"mypackage.utils\""));
            assert!(json.contains("\"module_ids\""));

            // Roundtrip
            let deserialized: ModuleResolution = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, resolution);
        }

        #[test]
        fn module_resolution_single_module() {
            let mut store = FactsStore::new();

            // Create a module
            let module_id = store.next_module_id();
            let module = Module {
                module_id,
                path: "mypackage/utils.py".to_string(),
                kind: ModuleKind::File,
                parent_module_id: None,
                file_id: None,
                decl_span: None,
            };
            store.insert_module(module);

            // Add module resolution
            let resolution = ModuleResolution::new("mypackage.utils", module_id);
            store.insert_module_resolution(resolution);

            // Query by path
            let resolved = store.resolve_module_path("mypackage.utils").unwrap();
            assert_eq!(resolved.module_path, "mypackage.utils");
            assert_eq!(resolved.module_ids.len(), 1);
            assert_eq!(resolved.module_ids[0], module_id);

            // Query module IDs directly
            let ids = store.module_ids_for_path("mypackage.utils");
            assert_eq!(ids.len(), 1);
            assert_eq!(ids[0], module_id);
        }

        #[test]
        fn module_resolution_namespace_package() {
            let mut store = FactsStore::new();

            // Create multiple modules for the same namespace
            let module_id1 = store.next_module_id();
            let module_id2 = store.next_module_id();

            let module1 = Module {
                module_id: module_id1,
                path: "vendor1/pkg/plugins".to_string(),
                kind: ModuleKind::Directory,
                parent_module_id: None,
                file_id: None,
                decl_span: None,
            };
            let module2 = Module {
                module_id: module_id2,
                path: "vendor2/pkg/plugins".to_string(),
                kind: ModuleKind::Directory,
                parent_module_id: None,
                file_id: None,
                decl_span: None,
            };

            store.insert_module(module1);
            store.insert_module(module2);

            // Add namespace package resolution with multiple modules
            let resolution =
                ModuleResolution::with_modules("pkg.plugins", vec![module_id1, module_id2]);
            store.insert_module_resolution(resolution);

            // Query should return both modules
            let ids = store.module_ids_for_path("pkg.plugins");
            assert_eq!(ids.len(), 2);
            assert!(ids.contains(&module_id1));
            assert!(ids.contains(&module_id2));
        }

        #[test]
        fn module_resolution_merge_behavior() {
            let mut store = FactsStore::new();

            // Create modules
            let module_id1 = store.next_module_id();
            let module_id2 = store.next_module_id();
            let module_id3 = store.next_module_id();

            // Insert first resolution
            store.insert_module_resolution(ModuleResolution::new("pkg.plugins", module_id1));
            assert_eq!(store.module_ids_for_path("pkg.plugins").len(), 1);

            // Insert second resolution for same path - should merge
            store.insert_module_resolution(ModuleResolution::new("pkg.plugins", module_id2));
            let ids = store.module_ids_for_path("pkg.plugins");
            assert_eq!(ids.len(), 2);
            assert_eq!(ids[0], module_id1);
            assert_eq!(ids[1], module_id2);

            // Insert third resolution with multiple modules - should also merge
            store.insert_module_resolution(ModuleResolution::with_modules(
                "pkg.plugins",
                vec![module_id3],
            ));
            let ids = store.module_ids_for_path("pkg.plugins");
            assert_eq!(ids.len(), 3);
            assert_eq!(ids[2], module_id3);
        }

        #[test]
        fn module_ids_for_path_unknown_returns_empty() {
            let store = FactsStore::new();

            // Unknown path should return empty slice
            let ids = store.module_ids_for_path("unknown.module");
            assert!(ids.is_empty());
        }

        #[test]
        fn module_resolution_all_paths_iterator() {
            let mut store = FactsStore::new();

            // Add several module resolutions
            store.insert_module_resolution(ModuleResolution::new("zebra.module", ModuleId::new(1)));
            store.insert_module_resolution(ModuleResolution::new("alpha.module", ModuleId::new(2)));
            store.insert_module_resolution(ModuleResolution::new("beta.module", ModuleId::new(3)));

            // all_module_paths should iterate in lexicographic order (BTreeMap)
            let paths: Vec<_> = store.all_module_paths().collect();
            assert_eq!(paths.len(), 3);
            assert_eq!(paths[0], "alpha.module");
            assert_eq!(paths[1], "beta.module");
            assert_eq!(paths[2], "zebra.module");

            // Count should match
            assert_eq!(store.module_resolution_count(), 3);
        }

        #[test]
        fn module_resolution_iteration() {
            let mut store = FactsStore::new();

            store.insert_module_resolution(ModuleResolution::new("pkg.a", ModuleId::new(1)));
            store.insert_module_resolution(ModuleResolution::new("pkg.b", ModuleId::new(2)));

            // module_resolutions() iterator
            let resolutions: Vec<_> = store.module_resolutions().collect();
            assert_eq!(resolutions.len(), 2);

            // Iteration should be deterministic
            let iter1: Vec<_> = store.module_resolutions().map(|r| &r.module_path).collect();
            let iter2: Vec<_> = store.module_resolutions().map(|r| &r.module_path).collect();
            assert_eq!(iter1, iter2);
        }

        #[test]
        fn module_resolution_clear() {
            let mut store = FactsStore::new();

            store.insert_module_resolution(ModuleResolution::new("pkg.a", ModuleId::new(1)));
            store.insert_module_resolution(ModuleResolution::new("pkg.b", ModuleId::new(2)));

            assert_eq!(store.module_resolution_count(), 2);

            store.clear();

            assert_eq!(store.module_resolution_count(), 0);
            assert!(store.module_ids_for_path("pkg.a").is_empty());
        }
    }

    /// Tests for PublicExport types and FactsStore operations.
    mod public_export_tests {
        use super::*;

        #[test]
        fn public_export_id_display() {
            let id = PublicExportId::new(42);
            assert_eq!(format!("{}", id), "pub_exp_42");
        }

        #[test]
        fn export_kind_serialization() {
            let kind = ExportKind::PythonAll;
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, r#""python_all""#);

            let kind = ExportKind::RustPubUse;
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, r#""rust_pub_use""#);

            let kind = ExportKind::RustPubUseGlob;
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, r#""rust_pub_use_glob""#);

            let kind = ExportKind::GoExported;
            let json = serde_json::to_string(&kind).unwrap();
            assert_eq!(json, r#""go_exported""#);
        }

        #[test]
        fn export_target_serialization() {
            let target = ExportTarget::Single;
            let json = serde_json::to_string(&target).unwrap();
            assert_eq!(json, r#""single""#);

            let target = ExportTarget::Glob;
            let json = serde_json::to_string(&target).unwrap();
            assert_eq!(json, r#""glob""#);

            let target = ExportTarget::Module;
            let json = serde_json::to_string(&target).unwrap();
            assert_eq!(json, r#""module""#);

            let target = ExportTarget::Implicit;
            let json = serde_json::to_string(&target).unwrap();
            assert_eq!(json, r#""implicit""#);
        }

        #[test]
        fn export_intent_serialization() {
            let intent = ExportIntent::Declared;
            let json = serde_json::to_string(&intent).unwrap();
            assert_eq!(json, r#""declared""#);

            let intent = ExportIntent::Effective;
            let json = serde_json::to_string(&intent).unwrap();
            assert_eq!(json, r#""effective""#);
        }

        #[test]
        fn export_origin_serialization() {
            let origin = ExportOrigin::Local;
            let json = serde_json::to_string(&origin).unwrap();
            assert_eq!(json, r#""local""#);

            let origin = ExportOrigin::ReExport;
            let json = serde_json::to_string(&origin).unwrap();
            assert_eq!(json, r#""re_export""#);

            let origin = ExportOrigin::Implicit;
            let json = serde_json::to_string(&origin).unwrap();
            assert_eq!(json, r#""implicit""#);

            let origin = ExportOrigin::Unknown;
            let json = serde_json::to_string(&origin).unwrap();
            assert_eq!(json, r#""unknown""#);
        }

        #[test]
        fn public_export_crud() {
            let mut store = FactsStore::new();

            // Create a file for the export
            let file_id = store.next_file_id();
            let file = File::new(
                file_id,
                "test.py",
                ContentHash::compute(b"test"),
                Language::Python,
            );
            store.insert_file(file);

            // Create a symbol
            let symbol_id = store.next_symbol_id();
            let symbol = Symbol::new(
                symbol_id,
                SymbolKind::Function,
                "my_func",
                file_id,
                Span::new(0, 10),
            );
            store.insert_symbol(symbol);

            // Create a public export
            let export_id = store.next_public_export_id();
            let export = PublicExport::new(
                export_id,
                file_id,
                Span::new(100, 110),
                ExportKind::PythonAll,
                ExportTarget::Single,
                ExportIntent::Declared,
                ExportOrigin::Local,
            )
            .with_symbol(symbol_id)
            .with_name("my_func")
            .with_exported_name_span(Span::new(101, 109));

            store.insert_public_export(export);

            // Lookup by ID
            let retrieved = store.public_export(export_id).unwrap();
            assert_eq!(retrieved.export_id, export_id);
            assert_eq!(retrieved.symbol_id, Some(symbol_id));
            assert_eq!(retrieved.exported_name, Some("my_func".to_string()));
            assert_eq!(retrieved.source_name, Some("my_func".to_string()));
            assert_eq!(retrieved.export_kind, ExportKind::PythonAll);
            assert_eq!(retrieved.export_target, ExportTarget::Single);
            assert_eq!(retrieved.export_intent, ExportIntent::Declared);
            assert_eq!(retrieved.export_origin, ExportOrigin::Local);
            assert!(retrieved.is_declared());
            assert!(retrieved.is_local());
            assert!(retrieved.is_single());
            assert!(!retrieved.is_glob());
        }

        #[test]
        fn public_exports_query_by_name() {
            let mut store = FactsStore::new();

            let file_id = store.next_file_id();
            store.insert_file(File::new(
                file_id,
                "test.py",
                ContentHash::compute(b"test"),
                Language::Python,
            ));

            // Insert multiple exports with same name
            let export1_id = store.next_public_export_id();
            let export1 = PublicExport::new(
                export1_id,
                file_id,
                Span::new(0, 10),
                ExportKind::PythonAll,
                ExportTarget::Single,
                ExportIntent::Declared,
                ExportOrigin::Local,
            )
            .with_name("foo");
            store.insert_public_export(export1);

            let export2_id = store.next_public_export_id();
            let export2 = PublicExport::new(
                export2_id,
                file_id,
                Span::new(20, 30),
                ExportKind::PythonAll,
                ExportTarget::Single,
                ExportIntent::Declared,
                ExportOrigin::Local,
            )
            .with_name("foo");
            store.insert_public_export(export2);

            let export3_id = store.next_public_export_id();
            let export3 = PublicExport::new(
                export3_id,
                file_id,
                Span::new(40, 50),
                ExportKind::PythonAll,
                ExportTarget::Single,
                ExportIntent::Declared,
                ExportOrigin::Local,
            )
            .with_name("bar");
            store.insert_public_export(export3);

            // Query by name
            let foo_exports = store.public_exports_named("foo");
            assert_eq!(foo_exports.len(), 2);
            assert_eq!(foo_exports[0].export_id, export1_id);
            assert_eq!(foo_exports[1].export_id, export2_id);

            let bar_exports = store.public_exports_named("bar");
            assert_eq!(bar_exports.len(), 1);
            assert_eq!(bar_exports[0].export_id, export3_id);

            let baz_exports = store.public_exports_named("baz");
            assert!(baz_exports.is_empty());
        }

        #[test]
        fn public_exports_query_by_file() {
            let mut store = FactsStore::new();

            let file1_id = store.next_file_id();
            store.insert_file(File::new(
                file1_id,
                "test1.py",
                ContentHash::compute(b"test"),
                Language::Python,
            ));

            let file2_id = store.next_file_id();
            store.insert_file(File::new(
                file2_id,
                "test2.py",
                ContentHash::compute(b"test2"),
                Language::Python,
            ));

            // Insert exports in different files
            let export1_id = store.next_public_export_id();
            store.insert_public_export(
                PublicExport::new(
                    export1_id,
                    file1_id,
                    Span::new(0, 10),
                    ExportKind::PythonAll,
                    ExportTarget::Single,
                    ExportIntent::Declared,
                    ExportOrigin::Local,
                )
                .with_name("foo"),
            );

            let export2_id = store.next_public_export_id();
            store.insert_public_export(
                PublicExport::new(
                    export2_id,
                    file2_id,
                    Span::new(0, 10),
                    ExportKind::PythonAll,
                    ExportTarget::Single,
                    ExportIntent::Declared,
                    ExportOrigin::Local,
                )
                .with_name("bar"),
            );

            // Query by file
            let file1_exports = store.public_exports_in_file(file1_id);
            assert_eq!(file1_exports.len(), 1);
            assert_eq!(file1_exports[0].export_id, export1_id);

            let file2_exports = store.public_exports_in_file(file2_id);
            assert_eq!(file2_exports.len(), 1);
            assert_eq!(file2_exports[0].export_id, export2_id);

            // Unknown file returns empty
            let unknown_id = FileId::new(999);
            assert!(store.public_exports_in_file(unknown_id).is_empty());
        }

        #[test]
        fn public_exports_query_by_intent() {
            let mut store = FactsStore::new();

            let file_id = store.next_file_id();
            store.insert_file(File::new(
                file_id,
                "test.py",
                ContentHash::compute(b"test"),
                Language::Python,
            ));

            // Insert declared export
            let declared_id = store.next_public_export_id();
            store.insert_public_export(
                PublicExport::new(
                    declared_id,
                    file_id,
                    Span::new(0, 10),
                    ExportKind::PythonAll,
                    ExportTarget::Single,
                    ExportIntent::Declared,
                    ExportOrigin::Local,
                )
                .with_name("foo"),
            );

            // Insert effective export
            let effective_id = store.next_public_export_id();
            store.insert_public_export(
                PublicExport::new(
                    effective_id,
                    file_id,
                    Span::new(20, 30),
                    ExportKind::GoExported,
                    ExportTarget::Implicit,
                    ExportIntent::Effective,
                    ExportOrigin::Implicit,
                )
                .with_name("Bar"),
            );

            // Query by intent
            let declared = store.public_exports_with_intent(ExportIntent::Declared);
            assert_eq!(declared.len(), 1);
            assert_eq!(declared[0].export_id, declared_id);

            let effective = store.public_exports_with_intent(ExportIntent::Effective);
            assert_eq!(effective.len(), 1);
            assert_eq!(effective[0].export_id, effective_id);
        }

        #[test]
        fn public_export_glob_not_in_name_index() {
            let mut store = FactsStore::new();

            let file_id = store.next_file_id();
            store.insert_file(File::new(
                file_id,
                "test.rs",
                ContentHash::compute(b"test"),
                Language::Rust,
            ));

            // Insert a glob export (no exported_name)
            let glob_id = store.next_public_export_id();
            store.insert_public_export(PublicExport::new(
                glob_id,
                file_id,
                Span::new(0, 20),
                ExportKind::RustPubUseGlob,
                ExportTarget::Glob,
                ExportIntent::Declared,
                ExportOrigin::ReExport,
            ));

            // Glob should be findable by file and iterator
            let file_exports = store.public_exports_in_file(file_id);
            assert_eq!(file_exports.len(), 1);
            assert!(file_exports[0].is_glob());

            // But not by name (no exported_name)
            // The name index only contains non-glob exports
            assert_eq!(store.public_export_count(), 1);
        }

        #[test]
        fn public_export_iterator() {
            let mut store = FactsStore::new();

            let file_id = store.next_file_id();
            store.insert_file(File::new(
                file_id,
                "test.py",
                ContentHash::compute(b"test"),
                Language::Python,
            ));

            for i in 0..5 {
                let id = store.next_public_export_id();
                store.insert_public_export(
                    PublicExport::new(
                        id,
                        file_id,
                        Span::new(i * 10, i * 10 + 5),
                        ExportKind::PythonAll,
                        ExportTarget::Single,
                        ExportIntent::Declared,
                        ExportOrigin::Local,
                    )
                    .with_name(format!("name_{}", i)),
                );
            }

            // Iterator should return all exports
            let all: Vec<_> = store.public_exports().collect();
            assert_eq!(all.len(), 5);

            // Count should match
            assert_eq!(store.public_export_count(), 5);
        }

        #[test]
        fn public_export_clear() {
            let mut store = FactsStore::new();

            let file_id = store.next_file_id();
            store.insert_file(File::new(
                file_id,
                "test.py",
                ContentHash::compute(b"test"),
                Language::Python,
            ));

            let export_id = store.next_public_export_id();
            store.insert_public_export(
                PublicExport::new(
                    export_id,
                    file_id,
                    Span::new(0, 10),
                    ExportKind::PythonAll,
                    ExportTarget::Single,
                    ExportIntent::Declared,
                    ExportOrigin::Local,
                )
                .with_name("foo"),
            );

            assert_eq!(store.public_export_count(), 1);

            store.clear();

            assert_eq!(store.public_export_count(), 0);
            assert!(store.public_export(export_id).is_none());
            assert!(store.public_exports_named("foo").is_empty());
        }

        #[test]
        fn public_export_builder_methods() {
            let export_id = PublicExportId::new(1);
            let file_id = FileId::new(1);
            let symbol_id = SymbolId::new(1);
            let module_id = ModuleId::new(1);
            let origin_export_id = PublicExportId::new(0);

            let export = PublicExport::new(
                export_id,
                file_id,
                Span::new(0, 100),
                ExportKind::RustPubUse,
                ExportTarget::Single,
                ExportIntent::Declared,
                ExportOrigin::ReExport,
            )
            .with_symbol(symbol_id)
            .with_exported_name("Alias")
            .with_source_name("Original")
            .with_exported_name_span(Span::new(10, 15))
            .with_source_name_span(Span::new(20, 28))
            .with_origin_module(module_id)
            .with_origin_export(origin_export_id);

            assert_eq!(export.symbol_id, Some(symbol_id));
            assert_eq!(export.exported_name, Some("Alias".to_string()));
            assert_eq!(export.source_name, Some("Original".to_string()));
            assert_eq!(export.exported_name_span, Some(Span::new(10, 15)));
            assert_eq!(export.source_name_span, Some(Span::new(20, 28)));
            assert_eq!(export.origin_module_id, Some(module_id));
            assert_eq!(export.origin_export_id, Some(origin_export_id));
            assert!(export.is_reexport());
        }

        #[test]
        fn public_export_helper_methods() {
            let export_id = PublicExportId::new(1);
            let file_id = FileId::new(1);

            // Test glob export
            let glob = PublicExport::new(
                export_id,
                file_id,
                Span::new(0, 10),
                ExportKind::RustPubUseGlob,
                ExportTarget::Glob,
                ExportIntent::Declared,
                ExportOrigin::ReExport,
            );
            assert!(glob.is_glob());
            assert!(!glob.is_single());
            assert!(glob.is_declared());
            assert!(!glob.is_effective());
            assert!(glob.is_reexport());
            assert!(!glob.is_local());

            // Test effective local export
            let effective = PublicExport::new(
                export_id,
                file_id,
                Span::new(0, 10),
                ExportKind::GoExported,
                ExportTarget::Implicit,
                ExportIntent::Effective,
                ExportOrigin::Local,
            );
            assert!(!effective.is_glob());
            assert!(!effective.is_single());
            assert!(!effective.is_declared());
            assert!(effective.is_effective());
            assert!(!effective.is_reexport());
            assert!(effective.is_local());
        }

        /// Golden test: PublicExport serializes all span fields and intent/origin correctly.
        ///
        /// This test verifies the JSON schema contract for PublicExport, ensuring:
        /// - All required fields are present (export_id, file_id, decl_span, export_kind, etc.)
        /// - Optional span fields serialize when present (exported_name_span, source_name_span)
        /// - Intent and origin fields serialize with correct values
        /// - Re-export chain fields work correctly (origin_module_id, origin_export_id)
        #[test]
        fn public_export_golden_serialization() {
            let export = PublicExport::new(
                PublicExportId::new(42),
                FileId::new(1),
                Span::new(100, 150),
                ExportKind::RustPubUse,
                ExportTarget::Single,
                ExportIntent::Declared,
                ExportOrigin::ReExport,
            )
            .with_symbol(SymbolId::new(7))
            .with_exported_name("Alias")
            .with_source_name("Original")
            .with_exported_name_span(Span::new(110, 115))
            .with_source_name_span(Span::new(120, 128))
            .with_origin_module(ModuleId::new(3))
            .with_origin_export(PublicExportId::new(10));

            let json = serde_json::to_string_pretty(&export).unwrap();

            // Verify all required fields
            assert!(json.contains("\"export_id\": 42"), "Missing export_id");
            assert!(json.contains("\"file_id\": 1"), "Missing file_id");
            assert!(json.contains("\"decl_span\""), "Missing decl_span");
            assert!(
                json.contains("\"export_kind\": \"rust_pub_use\""),
                "Missing/wrong export_kind"
            );
            assert!(
                json.contains("\"export_target\": \"single\""),
                "Missing/wrong export_target"
            );
            assert!(
                json.contains("\"export_intent\": \"declared\""),
                "Missing/wrong export_intent"
            );
            assert!(
                json.contains("\"export_origin\": \"re_export\""),
                "Missing/wrong export_origin"
            );

            // Verify optional fields are present
            assert!(json.contains("\"symbol_id\": 7"), "Missing symbol_id");
            assert!(
                json.contains("\"exported_name\": \"Alias\""),
                "Missing exported_name"
            );
            assert!(
                json.contains("\"source_name\": \"Original\""),
                "Missing source_name"
            );

            // Verify span fields
            assert!(
                json.contains("\"exported_name_span\""),
                "Missing exported_name_span"
            );
            assert!(
                json.contains("\"source_name_span\""),
                "Missing source_name_span"
            );

            // Verify re-export chain fields
            assert!(
                json.contains("\"origin_module_id\": 3"),
                "Missing origin_module_id"
            );
            assert!(
                json.contains("\"origin_export_id\": 10"),
                "Missing origin_export_id"
            );
        }

        /// Golden test: PublicExport with minimal fields omits optional fields.
        ///
        /// Tests skip_serializing_if behavior for Option fields.
        #[test]
        fn public_export_minimal_serialization() {
            let export = PublicExport::new(
                PublicExportId::new(1),
                FileId::new(1),
                Span::new(0, 10),
                ExportKind::PythonAll,
                ExportTarget::Single,
                ExportIntent::Declared,
                ExportOrigin::Local,
            );
            // Note: Don't set any optional fields

            let json = serde_json::to_string(&export).unwrap();

            // Required fields are present
            assert!(json.contains("\"export_id\""));
            assert!(json.contains("\"file_id\""));
            assert!(json.contains("\"decl_span\""));
            assert!(json.contains("\"export_kind\":\"python_all\""));
            assert!(json.contains("\"export_intent\":\"declared\""));
            assert!(json.contains("\"export_origin\":\"local\""));

            // Optional fields should NOT be present (skip_serializing_if)
            assert!(!json.contains("symbol_id"), "symbol_id should be omitted");
            assert!(
                !json.contains("exported_name"),
                "exported_name should be omitted"
            );
            assert!(
                !json.contains("source_name"),
                "source_name should be omitted"
            );
            assert!(
                !json.contains("exported_name_span"),
                "exported_name_span should be omitted"
            );
            assert!(
                !json.contains("source_name_span"),
                "source_name_span should be omitted"
            );
            assert!(
                !json.contains("origin_module_id"),
                "origin_module_id should be omitted"
            );
            assert!(
                !json.contains("origin_export_id"),
                "origin_export_id should be omitted"
            );
        }

        /// Golden test: Verify Symbol with visibility serializes correctly.
        ///
        /// This test documents the expected JSON format for Symbol with visibility.
        #[test]
        fn symbol_with_visibility_golden_serialization() {
            let symbol = Symbol::new(
                SymbolId::new(42),
                SymbolKind::Function,
                "my_function",
                FileId::new(1),
                Span::new(10, 21),
            )
            .with_module(ModuleId::new(5))
            .with_visibility(Visibility::Public);

            let json = serde_json::to_string_pretty(&symbol).unwrap();

            // Verify required fields
            assert!(json.contains("\"symbol_id\": 42"));
            assert!(json.contains("\"kind\": \"function\""));
            assert!(json.contains("\"name\": \"my_function\""));
            assert!(json.contains("\"decl_file_id\": 1"));
            assert!(json.contains("\"decl_span\""));

            // Verify optional fields are present
            assert!(json.contains("\"module_id\": 5"));
            assert!(json.contains("\"visibility\": \"public\""));
        }

        /// Golden test: Verify TypeNode nested structure serializes correctly.
        ///
        /// Documents expected format for complex types like Dict[str, List[int]].
        #[test]
        fn typenode_complex_golden_serialization() {
            // Dict[str, List[int]]
            let node = TypeNode::named_with_args(
                "Dict",
                vec![
                    TypeNode::named("str"),
                    TypeNode::named_with_args("List", vec![TypeNode::named("int")]),
                ],
            );

            let json = serde_json::to_string_pretty(&node).unwrap();

            // Verify structure
            assert!(json.contains("\"kind\": \"named\""));
            assert!(json.contains("\"name\": \"Dict\""));
            assert!(json.contains("\"args\""));
            // Nested types
            assert!(json.contains("\"name\": \"str\""));
            assert!(json.contains("\"name\": \"List\""));
            assert!(json.contains("\"name\": \"int\""));
        }
    }

    mod phase_b_tests {
        use super::*;

        #[test]
        fn test_parameter_name_span() {
            // Parameter with name_span serializes correctly
            let param = Parameter::new("arg", ParamKind::Regular).with_name_span(Span::new(10, 13));

            let json = serde_json::to_string(&param).unwrap();
            assert!(json.contains("\"name\":\"arg\""));
            assert!(json.contains("\"name_span\""));
            assert!(json.contains("\"start\":10"));
            assert!(json.contains("\"end\":13"));
        }

        #[test]
        fn test_callsite_receiver_path() {
            // CallSite with receiver_path serializes correctly
            let mut store = FactsStore::new();
            let call_id = store.next_call_site_id();
            let file_id = store.next_file_id();

            let receiver_path = ReceiverPath::new(vec![
                ReceiverPathStep::Name {
                    value: "self".to_string(),
                },
                ReceiverPathStep::Attribute {
                    value: "handler".to_string(),
                },
            ]);

            let call_site = CallSite::new(call_id, file_id, Span::new(0, 20))
                .with_receiver_path(receiver_path)
                .with_is_method_call(true);

            let json = serde_json::to_string(&call_site).unwrap();
            assert!(json.contains("\"receiver_path\""));
            assert!(json.contains("\"type\":\"name\""));
            assert!(json.contains("\"value\":\"self\""));
            assert!(json.contains("\"type\":\"attribute\""));
            assert!(json.contains("\"value\":\"handler\""));
            assert!(json.contains("\"is_method_call\":true"));
        }

        #[test]
        fn test_callsite_scope_path() {
            // CallSite with scope_path serializes correctly
            let mut store = FactsStore::new();
            let call_id = store.next_call_site_id();
            let file_id = store.next_file_id();

            let call_site = CallSite::new(call_id, file_id, Span::new(0, 20))
                .with_scope_path(vec![
                    "<module>".to_string(),
                    "MyClass".to_string(),
                    "my_method".to_string(),
                ]);

            let json = serde_json::to_string(&call_site).unwrap();
            assert!(json.contains("\"scope_path\""));
            assert!(json.contains("\"<module>\""));
            assert!(json.contains("\"MyClass\""));
            assert!(json.contains("\"my_method\""));
        }

        #[test]
        fn test_receiver_path_step_variants() {
            // All ReceiverPathStep variants serialize correctly
            let steps = vec![
                ReceiverPathStep::Name {
                    value: "obj".to_string(),
                },
                ReceiverPathStep::Attribute {
                    value: "attr".to_string(),
                },
                ReceiverPathStep::Call,
                ReceiverPathStep::Subscript,
            ];

            let path = ReceiverPath::new(steps);
            let json = serde_json::to_string(&path).unwrap();

            assert!(json.contains("\"type\":\"name\""));
            assert!(json.contains("\"type\":\"attribute\""));
            assert!(json.contains("\"type\":\"call\""));
            assert!(json.contains("\"type\":\"subscript\""));
        }
    }
}
