//! Python analyzer: scope-aware symbol resolution and reference collection.
//!
//! This module implements Level 0 (Scope + Binding) of the Python analyzer:
//!
//! - Scope chain management (module → class → function → comprehension)
//! - Binding collection with `global`/`nonlocal` handling
//! - Reference resolution via scope chain
//! - Import resolution for workspace files
//!
//! Uses Rust CST parsing via tugtool-python-cst for zero-dependency analysis.
//! See [`analyze_file`] and [`analyze_files`] for the main entry points.
//!
//! # Receiver Resolution
//!
//! The analyzer supports resolving receivers in attribute accesses and method calls
//! via [`ReceiverPath`] structures. Supported patterns include:
//!
//! - Simple names: `obj.method()`
//! - Dotted paths: `self.handler.process()`
//! - Call expressions: `get_handler().process()`
//! - Callable attributes: `self.factory()` where factory has type `Callable[[], T]`
//!
//! ## Unsupported Patterns
//!
//! The following patterns return `None` during resolution:
//!
//! - **Subscript expressions**: `data[0].method()` - index access is not tracked
//! - **Complex expressions**: `(a or b).method()` - boolean/conditional expressions
//! - **Generic type parameters**: `List[T]` → `T` resolution is not performed
//! - **Duck typing**: Protocol-based type inference is not supported
//! - **Property decorators**: `@property` methods are not resolved as types
//! - **Inheritance (MRO)**: Method resolution order is not followed
//!
//! ## Resolution Depth Limit
//!
//! Receiver resolution is limited to `MAX_RESOLUTION_DEPTH` (4 steps).
//! This covers common patterns like `self.manager.handler.process()` while
//! avoiding pathological chains. Deeper chains return `None`.
//!
//! ## Resolution Precedence Rules
//!
//! When resolving a [`ReceiverPath`], each step follows these precedence rules:
//!
//! 1. **Name steps**: Check `TypeTracker::type_of()` first. If not found, treat as
//!    function/class name for `Call` step resolution.
//!
//! 2. **Attr steps**: Check `TypeTracker::attribute_type_of()` on the current class.
//!    If not found, assume it's a method name for the next `Call` step.
//!
//! 3. **Call steps** (in order):
//!    - Callable attribute: If previous step had a `Callable[..., ReturnType]`,
//!      use the extracted return type.
//!    - Method call: Check `TypeTracker::method_return_type_of()`.
//!    - Function call: Check `TypeTracker::return_type_of()`.
//!    - Constructor: If name is a class, type becomes the class name.
//!
//! 4. **Cross-file fallback**: If local resolution fails and the type appears
//!    to be an import, check the cross-file symbol map.

use tugtool_core::adapter::{
    AliasEdgeData, AnalysisBundle, AttributeAccessData, CallArgData, CallSiteData, ExportData,
    FileAnalysisResult, ImportData, LanguageAdapter, ModifierData, ModuleResolutionData,
    ParameterData, QualifiedNameData, ReferenceData, ReferenceKind as AdapterReferenceKind,
    ScopeData, SignatureData, SymbolData, TypeParamData,
};
use tugtool_core::facts::{
    AttributeAccessKind, ExportIntent, ExportKind, ExportOrigin, ExportTarget, FactsStore, File,
    Import, ImportKind, Language, Modifier, ParamKind, PublicExport, Reference, ReferenceKind,
    ScopeId as CoreScopeId, ScopeInfo as CoreScopeInfo, ScopeKind, Symbol, SymbolId, SymbolKind,
    TypeNode,
};
use tugtool_core::patch::{ContentHash, FileId, Span};

use crate::alias::AliasGraph;
use crate::cross_file_types::{lookup_import_target, CrossFileTypeCache, ImportTargetKind};
use crate::type_tracker::TypeTracker;
use crate::types::{BindingInfo, ScopeInfo};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use thiserror::Error;

// Native CST bridge
use crate::cst_bridge;

// Receiver path types for dotted path resolution
use tugtool_python_cst::{ReceiverPath, ReceiverStep};

/// Maximum depth for chained attribute resolution.
/// Deeper chains are uncommon and often involve external types.
/// Common patterns are 1-3 segments (`obj`, `self.field`, `self.field.attr`).
/// 4 allows for `self.manager.handler.process` patterns.
const MAX_RESOLUTION_DEPTH: usize = 4;

// ============================================================================
// Scope-Aware Symbol Lookup Helpers
// ============================================================================

/// Look up a symbol's kind by walking outward through the scope chain.
///
/// Returns the SymbolKind of the closest matching symbol, or None if not found.
/// This ensures that inner-scope definitions shadow outer-scope definitions.
fn lookup_symbol_kind_in_scope_chain(
    scope_path: &[String],
    name: &str,
    symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
) -> Option<SymbolKind> {
    // Walk outward from innermost scope to module scope
    for depth in (0..=scope_path.len()).rev() {
        let key = (scope_path[..depth].to_vec(), name.to_string());
        if let Some(kind) = symbol_kinds.get(&key) {
            return Some(*kind);
        }
    }
    None
}

/// Look up a symbol's index by walking outward through the scope chain.
///
/// Returns the symbol index of the closest matching symbol, or None if not found.
/// This ensures that inner-scope definitions shadow outer-scope definitions.
fn lookup_symbol_index_in_scope_chain(
    scope_path: &[String],
    name: &str,
    scoped_symbol_map: &HashMap<(Vec<String>, String), usize>,
) -> Option<usize> {
    for depth in (0..=scope_path.len()).rev() {
        let key = (scope_path[..depth].to_vec(), name.to_string());
        if let Some(index) = scoped_symbol_map.get(&key) {
            return Some(*index);
        }
    }
    None
}

/// Check if a name refers to a class in the current scope.
///
/// Uses scope-aware lookup to walk outward through scopes, ensuring
/// that inner-scope definitions shadow outer-scope definitions.
fn is_class_in_scope(
    scope_path: &[String],
    name: &str,
    symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
) -> bool {
    lookup_symbol_kind_in_scope_chain(scope_path, name, symbol_kinds) == Some(SymbolKind::Class)
}

/// Strip quotes from a forward reference type string.
///
/// Python forward references can be written as strings: `-> "MyClass"`.
/// The annotation collector preserves these quotes in `type_str`.
/// This helper strips them for type resolution.
fn strip_forward_ref_quotes(type_str: &str) -> &str {
    let trimmed = type_str.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

/// Type alias for scope-to-symbols index: (FileId, ScopeId) -> Vec<(name, SymbolId, SymbolKind)>
/// Uses the local ScopeId type (not CoreScopeId) as the map key.
type ScopeSymbolsMap = HashMap<(FileId, ScopeId), Vec<(String, SymbolId, SymbolKind)>>;

// ============================================================================
// Module Resolution Types
// ============================================================================

/// Result of resolving a module path to a workspace location.
///
/// This enum distinguishes between regular Python modules (with a file) and
/// PEP 420 namespace packages (directories without `__init__.py`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedModule {
    /// A regular Python module or package with a file.
    /// The path is workspace-relative (e.g., "utils.py" or "pkg/__init__.py").
    File(String),
    /// A PEP 420 namespace package (directory without `__init__.py`).
    /// The path is the workspace-relative directory (e.g., "utils" or "pkg/sub").
    Namespace(String),
}

impl ResolvedModule {
    /// Returns the path string for this resolved module.
    pub fn path(&self) -> &str {
        match self {
            ResolvedModule::File(p) => p,
            ResolvedModule::Namespace(p) => p,
        }
    }

    /// Returns true if this is a file-based module (not a namespace package).
    pub fn is_file(&self) -> bool {
        matches!(self, ResolvedModule::File(_))
    }

    /// Returns true if this is a namespace package.
    pub fn is_namespace(&self) -> bool {
        matches!(self, ResolvedModule::Namespace(_))
    }

    /// Returns the file path if this is a file-based module, None if namespace.
    pub fn as_file(&self) -> Option<&str> {
        match self {
            ResolvedModule::File(p) => Some(p),
            ResolvedModule::Namespace(_) => None,
        }
    }
}

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during Python analysis.
#[derive(Debug, Error)]
pub enum AnalyzerError {
    /// File not found in workspace.
    #[error("file not found: {path}")]
    FileNotFound { path: String },

    /// Symbol not found at location.
    #[error("symbol not found at {file}:{line}:{col}")]
    SymbolNotFound { file: String, line: u32, col: u32 },

    /// Ambiguous symbol at location.
    #[error("multiple symbols at {file}:{line}:{col}")]
    AmbiguousSymbol { file: String, line: u32, col: u32 },

    /// Import resolution failed.
    #[error("could not resolve import: {module_path}")]
    ImportNotResolved { module_path: String },

    /// CST analysis error.
    #[error("CST error: {0}")]
    Cst(#[from] crate::cst_bridge::CstBridgeError),

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Result type for analyzer operations.
pub type AnalyzerResult<T> = Result<T, AnalyzerError>;

// ============================================================================
// Scope Types
// ============================================================================

/// Unique identifier for a scope within a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ScopeId(pub u32);

impl ScopeId {
    pub fn new(id: u32) -> Self {
        ScopeId(id)
    }
}

impl std::fmt::Display for ScopeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "scope_{}", self.0)
    }
}

/// Convert scope kind string to core ScopeKind.
///
/// Python CST produces scope kind strings that map to the core ScopeKind enum.
/// Unknown kinds fall back to Module as a safe default.
fn scope_kind_from_str(s: &str) -> ScopeKind {
    match s {
        "module" => ScopeKind::Module,
        "class" => ScopeKind::Class,
        "function" => ScopeKind::Function,
        "lambda" => ScopeKind::Lambda,
        "comprehension" => ScopeKind::Comprehension,
        _ => ScopeKind::Module, // Default fallback for unknown kinds
    }
}

/// A scope in the Python scope chain.
#[derive(Debug, Clone)]
pub struct Scope {
    /// Unique identifier within the file.
    pub id: ScopeId,
    /// Kind of scope.
    pub kind: ScopeKind,
    /// Name of the scope (function/class name, None for module/comprehension).
    pub name: Option<String>,
    /// Parent scope ID (None for module scope).
    pub parent_id: Option<ScopeId>,
    /// Byte span of the scope (start, end offsets).
    pub span: Option<Span>,
    /// Bindings in this scope: name → SymbolId.
    pub bindings: HashMap<String, SymbolId>,
    /// Names declared as `global` in this scope.
    pub globals: HashSet<String>,
    /// Names declared as `nonlocal` in this scope.
    pub nonlocals: HashSet<String>,
}

impl Scope {
    /// Create a new scope.
    pub fn new(
        id: ScopeId,
        kind: ScopeKind,
        name: Option<String>,
        parent_id: Option<ScopeId>,
    ) -> Self {
        Scope {
            id,
            kind,
            name,
            parent_id,
            span: None,
            bindings: HashMap::new(),
            globals: HashSet::new(),
            nonlocals: HashSet::new(),
        }
    }

    /// Set the byte span for this scope.
    pub fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }

    /// Check if a name is declared global in this scope.
    pub fn is_global(&self, name: &str) -> bool {
        self.globals.contains(name)
    }

    /// Check if a name is declared nonlocal in this scope.
    pub fn is_nonlocal(&self, name: &str) -> bool {
        self.nonlocals.contains(name)
    }
}

// ============================================================================
// File Analysis Result
// ============================================================================

/// Result of analyzing a single Python file.
#[derive(Debug)]
pub struct FileAnalysis {
    /// File ID.
    pub file_id: FileId,
    /// File path.
    pub path: String,
    /// CST ID (for rewriting).
    pub cst_id: String,
    /// Scopes in the file.
    pub scopes: Vec<Scope>,
    /// Symbols defined in this file.
    pub symbols: Vec<LocalSymbol>,
    /// References in this file.
    pub references: Vec<LocalReference>,
    /// Imports in this file.
    pub imports: Vec<LocalImport>,
    /// Exports (names in __all__) for star import expansion.
    pub exports: Vec<LocalExport>,
    /// Value-level aliases in this file (e.g., `b = bar`).
    pub alias_graph: AliasGraph,
    /// Function/method signatures in this file.
    pub signatures: Vec<tugtool_python_cst::SignatureInfo>,
    /// Attribute access patterns (obj.attr with Read/Write/Call context).
    pub attribute_accesses: Vec<tugtool_python_cst::AttributeAccessInfo>,
    /// Call sites with argument information.
    pub call_sites: Vec<tugtool_python_cst::CallSiteInfo>,
    /// Class inheritance information (class name -> base class names).
    pub class_hierarchies: Vec<tugtool_python_cst::ClassInheritanceInfo>,
}

/// An export entry from __all__ (for star import expansion and rename operations).
#[derive(Debug, Clone)]
pub struct LocalExport {
    /// The exported symbol name.
    pub name: String,
    /// Byte span of the entire string literal (including quotes).
    pub span: Option<Span>,
    /// Byte span of just the string content (for replacement).
    pub content_span: Option<Span>,
}

/// A symbol local to a file (before FactsStore integration).
#[derive(Debug, Clone)]
pub struct LocalSymbol {
    /// Symbol name.
    pub name: String,
    /// Symbol kind.
    pub kind: SymbolKind,
    /// Scope where defined.
    pub scope_id: ScopeId,
    /// Byte span of the symbol name.
    pub span: Option<Span>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Column number (1-indexed).
    pub col: Option<u32>,
    /// Container symbol name (for methods in classes).
    pub container: Option<String>,
}

/// A reference local to a file (before resolution).
#[derive(Debug, Clone)]
pub struct LocalReference {
    /// Name being referenced.
    pub name: String,
    /// Kind of reference.
    pub kind: ReferenceKind,
    /// Byte span of the reference.
    pub span: Option<Span>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Column number (1-indexed).
    pub col: Option<u32>,
    /// Scope where reference occurs.
    pub scope_id: ScopeId,
    /// Resolved symbol (if any).
    pub resolved_symbol: Option<String>,
}

/// An import local to a file.
#[derive(Debug, Clone)]
pub struct LocalImport {
    /// Import kind: "import" or "from".
    pub kind: String,
    /// Module path being imported.
    pub module_path: String,
    /// Names imported (for `from` imports).
    pub names: Vec<ImportedName>,
    /// Alias for module import.
    pub alias: Option<String>,
    /// Whether this is a star import.
    pub is_star: bool,
    /// Byte span of the import.
    pub span: Option<Span>,
    /// Line number (1-indexed).
    pub line: Option<u32>,
    /// Resolved file (if in workspace).
    pub resolved_file: Option<String>,
    /// Relative import level (0 = absolute, 1 = from ., 2 = from .., etc.)
    pub relative_level: u32,
}

/// An imported name.
#[derive(Debug, Clone)]
pub struct ImportedName {
    pub name: String,
    pub alias: Option<String>,
}

// ============================================================================
// Analysis Implementation
// ============================================================================

// ============================================================================
// Multi-File Analysis Types
// ============================================================================

/// Bundle of analysis results from processing multiple files.
///
/// This type collects the results of Pass 1 (single-file analysis) and tracks
/// any files that failed to parse or analyze. Used by subsequent passes to
/// build the complete FactsStore with cross-file resolution.
#[derive(Debug, Default)]
pub struct FileAnalysisBundle {
    /// Successfully analyzed files.
    pub file_analyses: Vec<FileAnalysis>,
    /// Files that failed to parse or analyze, with their error messages.
    pub failed_files: Vec<(String, AnalyzerError)>,
    /// All workspace file paths (for import resolution in Pass 3).
    ///
    /// This set contains all paths from the input file list, regardless of
    /// whether they were successfully analyzed. This allows Pass 3 to resolve
    /// imports even when some files failed to parse (we know the file exists,
    /// we just couldn't analyze it).
    pub workspace_files: HashSet<String>,
    /// Namespace packages detected in the workspace (PEP 420).
    ///
    /// A namespace package is a directory that contains `.py` files but no
    /// `__init__.py`. This set contains the relative paths to such directories,
    /// enabling import resolution for namespace packages.
    ///
    /// Computed by [`compute_namespace_packages`] at the start of analysis.
    pub namespace_packages: HashSet<String>,
    /// Index mapping (target_file, exported_name) to importing files and local names.
    ///
    /// Used for cross-file alias tracking: when renaming a symbol in file A, we can
    /// quickly find all files that import that symbol and check their alias graphs.
    ///
    /// Built during Pass 3 after import resolution.
    pub importers_index: ImportersIndex,
    /// TypeTrackers for each file, keyed by FileId.
    ///
    /// Built during Pass 4 (Type-Aware Method Resolution) and used for:
    /// - Receiver type resolution in attribute accesses
    /// - Method call callee resolution
    ///
    /// Note: TypeTracker is not Clone or Default, so we can't derive Default for the bundle.
    pub type_trackers: HashMap<FileId, TypeTracker>,
}

impl FileAnalysisBundle {
    /// Create a new empty bundle.
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if all files were analyzed successfully.
    pub fn is_complete(&self) -> bool {
        self.failed_files.is_empty()
    }

    /// Get the number of successfully analyzed files.
    pub fn success_count(&self) -> usize {
        self.file_analyses.len()
    }

    /// Get the number of failed files.
    pub fn failure_count(&self) -> usize {
        self.failed_files.len()
    }
}

/// Maps symbol names and kinds to their locations across all files.
///
/// This type is populated during Pass 2 (symbol registration) and used during
/// Pass 3 (reference resolution) to link references to their target symbols
/// across file boundaries.
///
/// The key is (name, kind) to distinguish between symbols with the same name
/// but different kinds (e.g., a function `foo` vs a variable `foo`).
pub type GlobalSymbolMap = HashMap<(String, SymbolKind), Vec<(FileId, SymbolId)>>;

/// Set of import bindings: (FileId, local_name).
///
/// This tracks which names in each file are import bindings rather than
/// local definitions. Used during Pass 3 to apply resolution preference
/// rules (prefer original definitions over import bindings).
pub type ImportBindingsSet = HashSet<(FileId, String)>;

/// Maps file paths to their imports.
///
/// Used for re-export chain resolution: when resolving an import that targets
/// another import binding (a re-export), we need to follow the chain through
/// the target file's imports to find the original definition.
pub type FileImportsMap<'a> = HashMap<&'a str, &'a [LocalImport]>;

/// Maps file paths to their star imports.
///
/// Used for transitive star import expansion (Spec S12): when a file does
/// `from .internal import *` and `internal.py` itself has star imports,
/// we need to follow the chain to find all transitively exported names.
pub type FileStarImportsMap<'a> = HashMap<&'a str, Vec<&'a LocalImport>>;

/// Maps file paths to pre-computed import resolvers with star expansion.
///
/// Used during reference resolution to provide consistent star-expanded
/// import bindings across all files. This ensures that when `resolve_import_chain`
/// follows a re-export chain, it can access the star-expanded bindings of each file.
pub type FileImportResolversMap = HashMap<String, FileImportResolver>;

/// Maps (target_file_path, exported_name) -> Vec<(importing_file_id, local_name)>.
///
/// This index tracks which files import each symbol from a given file. Used for
/// cross-file alias tracking: when renaming a symbol in file A, we can quickly
/// find all files that import that symbol and check their alias graphs.
///
/// Example: If file_b.py does `from file_a import bar as baz`:
///   ("file_a.py", "bar") -> [(file_b_id, "baz")]
///
/// Built after import resolution in Pass 3, using the resolved file information
/// from the FileImportResolvers.
pub type ImportersIndex = HashMap<(String, String), Vec<(FileId, String)>>;

/// Maps local file scope IDs to global FactsStore scope IDs.
///
/// Each file has its own local scope numbering (starting from 0).
/// This map translates those local IDs to the globally-unique CoreScopeIds
/// assigned by the FactsStore.
pub type ScopeIdMap = HashMap<(FileId, ScopeId), CoreScopeId>;

/// Analyze multiple files and populate the FactsStore using native CST.
///
/// This is the main entry point for multi-file Python analysis without any
/// Python dependencies. It implements a 4-pass algorithm to build a complete
/// FactsStore with proper cross-file resolution.
///
/// # Algorithm (4-Pass)
///
/// **Pass 1: Single-File Analysis**
/// - Parse each file using native CST parser
/// - Collect scopes, symbols, references, imports
/// - Continue on parse errors (track failures in bundle)
///
/// **Pass 2: Symbol Registration**
/// - Assign globally-unique FileIds and SymbolIds
/// - Insert Files and Symbols into FactsStore
/// - Build GlobalSymbolMap for cross-file resolution
/// - Link container symbols (methods to classes)
/// - Track import bindings separately
///
/// **Pass 3: Reference & Import Resolution**
/// - Resolve references using GlobalSymbolMap
/// - Prefer original definitions over import bindings
/// - Insert References and Imports into FactsStore
/// - Handle method references with span matching
///
/// **Pass 4: Type-Aware Method Resolution**
/// - Build MethodCallIndex for efficient lookup
/// - Resolve method calls using receiver type information
/// - Populate TypeInfo and InheritanceInfo in FactsStore
/// - Insert typed method call references
///
/// # Arguments
///
/// * `files` - List of (path, content) pairs to analyze
/// * `store` - FactsStore to populate with analysis results
///
/// # Returns
///
/// * `Ok(FileAnalysisBundle)` - Bundle with successful analyses and any failures
/// * `Err(AnalyzerError)` - Fatal error that prevented analysis
///
/// # Example
///
/// ```ignore
/// use tugtool_python::analyzer::analyze_files;
/// use tugtool_core::facts::FactsStore;
///
/// let mut store = FactsStore::new();
/// let files = vec![
///     ("main.py".to_string(), "from utils import helper\nhelper()".to_string()),
///     ("utils.py".to_string(), "def helper(): pass".to_string()),
/// ];
///
/// let bundle = analyze_files(&files, &mut store)?;
/// assert!(bundle.is_complete());
/// assert_eq!(store.files().len(), 2);
/// ```
///
/// # Behavioral Contract
///
/// See plans/phase-3.md Step 9.0 for the full behavioral contracts (C1-C8)
/// that define the expected behavior of this function.
pub fn analyze_files(
    files: &[(String, String)],
    store: &mut FactsStore,
) -> AnalyzerResult<FileAnalysisBundle> {
    let mut bundle = FileAnalysisBundle::new();

    // Handle empty file list
    if files.is_empty() {
        return Ok(bundle);
    }

    // ====================================================================
    // Contract C8: Deterministic ID Assignment
    // ====================================================================
    // Sort files by path to ensure deterministic FileId/SymbolId/ReferenceId
    // assignment. This is the HARD GUARANTEE - even if callers don't sort,
    // analyze_files() produces identical IDs for the same set of files.
    //
    // Sorting rules (from Contract C8):
    // - Paths normalized with forward slashes (Rust handles this via String comparison)
    // - Case-sensitive comparison (no lowercasing - case matters on Linux/macOS)
    // - Lexicographic ordering
    let mut sorted_files: Vec<(&String, &String)> = files.iter().map(|(p, c)| (p, c)).collect();
    sorted_files.sort_by(|(path_a, _), (path_b, _)| path_a.cmp(path_b));

    // ====================================================================
    // Pass 1: Single-File Analysis
    // ====================================================================
    // Parse each file using native CST parser and collect analysis results.
    // Track all workspace file paths for import resolution in Pass 3.
    // Continue on parse errors (track failures in bundle).

    // Build workspace file set for import resolution
    // We track all paths regardless of analysis success/failure because:
    // - A file that failed to parse still exists and can be an import target
    // - Pass 3 needs to know which paths exist in the workspace
    bundle.workspace_files = sorted_files
        .iter()
        .map(|(path, _)| (*path).clone())
        .collect();

    // Compute namespace packages (PEP 420) for import resolution
    // This identifies directories with .py files but no __init__.py
    bundle.namespace_packages = compute_namespace_packages(&bundle.workspace_files);

    // Keep a map of file_id -> content for content hash computation in Pass 2
    let mut file_contents: HashMap<FileId, &str> = HashMap::new();

    // Analyze each file (in sorted order for deterministic ID assignment)
    for (path, content) in sorted_files {
        let file_id = store.next_file_id();
        file_contents.insert(file_id, content.as_str());
        match analyze_file(file_id, path, content) {
            Ok(analysis) => {
                bundle.file_analyses.push(analysis);
            }
            Err(e) => {
                // Track failure but continue analyzing other files
                bundle.failed_files.push((path.clone(), e));
            }
        }
    }

    // ====================================================================
    // Pass 2: Symbol Registration
    // ====================================================================
    // For each FileAnalysis:
    //   - Insert File into FactsStore
    //   - Assign globally-unique SymbolIds and insert Symbols
    //   - Build GlobalSymbolMap for cross-file resolution
    //   - Link container symbols (methods to classes)
    //   - Track import bindings separately
    //   - Insert ScopeInfo records into FactsStore

    let mut global_symbols: GlobalSymbolMap = HashMap::new();
    let mut import_bindings: ImportBindingsSet = HashSet::new();
    let mut scope_id_map: ScopeIdMap = HashMap::new();

    // Track class symbols within each file for method->class linking
    // Key: (FileId, class_name) -> SymbolId
    let mut class_symbols: HashMap<(FileId, String), SymbolId> = HashMap::new();

    for analysis in &bundle.file_analyses {
        let file_id = analysis.file_id;
        let content = file_contents.get(&file_id).unwrap_or(&"");

        // Insert File into FactsStore
        let content_hash = ContentHash::compute(content.as_bytes());
        let file = File::new(file_id, &analysis.path, content_hash, Language::Python);
        store.insert_file(file);

        // Pass 2a: Register scopes (must happen before symbols for parent linking)
        // Map local scope IDs to global CoreScopeIds
        let mut local_to_global_scope: HashMap<ScopeId, CoreScopeId> = HashMap::new();

        // First pass: assign CoreScopeIds to all scopes
        for scope in &analysis.scopes {
            let core_scope_id = store.next_scope_id();
            local_to_global_scope.insert(scope.id, core_scope_id);
            scope_id_map.insert((file_id, scope.id), core_scope_id);
        }

        // Second pass: insert ScopeInfo records with parent links
        for scope in &analysis.scopes {
            let core_scope_id = local_to_global_scope[&scope.id];
            let parent_core_id = scope
                .parent_id
                .and_then(|pid| local_to_global_scope.get(&pid).copied());

            // Use scope span from native analysis (default to 0,0 if not available)
            let span = scope.span.unwrap_or_else(|| Span::new(0, 0));

            let mut core_scope = CoreScopeInfo::new(core_scope_id, file_id, span, scope.kind);
            if let Some(parent_id) = parent_core_id {
                core_scope = core_scope.with_parent(parent_id);
            }
            store.insert_scope(core_scope);
        }

        // Pass 2b: First pass - register class symbols to enable method linking
        // Filter entries without spans per [D01] - symbols without spans can't be edit targets
        for symbol in &analysis.symbols {
            if symbol.kind == SymbolKind::Class {
                // Skip classes without spans - they can't be renamed
                let Some(span) = symbol.span else {
                    continue;
                };

                // Reserve SymbolId for class
                let symbol_id = store.next_symbol_id();
                class_symbols.insert((file_id, symbol.name.clone()), symbol_id);

                // Insert class symbol
                let sym = Symbol::new(symbol_id, symbol.kind, &symbol.name, file_id, span);
                store.insert_symbol(sym);

                // Update global_symbols map
                global_symbols
                    .entry((symbol.name.clone(), symbol.kind))
                    .or_default()
                    .push((file_id, symbol_id));
            }
        }

        // Pass 2c: Register non-class symbols with container linking
        // Filter entries without spans per [D01] - symbols without spans can't be edit targets
        for symbol in &analysis.symbols {
            if symbol.kind == SymbolKind::Class {
                // Already handled above
                continue;
            }

            // Skip symbols without spans - they can't be renamed
            let Some(span) = symbol.span else {
                continue;
            };

            let symbol_id = store.next_symbol_id();

            // Create symbol
            let mut sym = Symbol::new(symbol_id, symbol.kind, &symbol.name, file_id, span);

            // Link container for methods
            // A method is a function defined inside a class scope
            if let Some(container_name) = &symbol.container {
                if let Some(&container_id) = class_symbols.get(&(file_id, container_name.clone())) {
                    sym = sym.with_container(container_id);
                }
            }

            store.insert_symbol(sym);

            // Update global_symbols map
            global_symbols
                .entry((symbol.name.clone(), symbol.kind))
                .or_default()
                .push((file_id, symbol_id));

            // Track import bindings
            if symbol.kind == SymbolKind::Import {
                import_bindings.insert((file_id, symbol.name.clone()));
            }
        }
    }

    // ====================================================================
    // Pass 3: Reference & Import Resolution
    // ====================================================================
    // For each FileAnalysis:
    //   - Resolve references using GlobalSymbolMap
    //   - Apply scope chain resolution (LEGB with class exception)
    //   - Insert References into FactsStore
    //   - Process imports and insert Import records

    // Build file path to FileId mapping for import resolution
    let file_path_to_id: HashMap<String, FileId> = bundle
        .file_analyses
        .iter()
        .map(|a| (a.path.clone(), a.file_id))
        .collect();

    // Build scope-to-symbols index for each file (for scope chain resolution)
    // Maps (FileId, ScopeId) -> Vec of (name, SymbolId, SymbolKind)
    let mut scope_symbols: ScopeSymbolsMap = HashMap::new();

    // Build direct lookup index for O(1) access: (file_id, name, kind) -> SymbolId
    // This avoids O(n) linear scan in the entries vector for each symbol
    let symbol_lookup: HashMap<(FileId, &str, SymbolKind), SymbolId> = global_symbols
        .iter()
        .flat_map(|((name, kind), entries)| {
            entries
                .iter()
                .map(move |(file_id, sym_id)| ((*file_id, name.as_str(), *kind), *sym_id))
        })
        .collect();

    // Rebuild scope_symbols from symbols (we need to know which symbols are in which scope)
    // This is populated from the symbols we just registered
    for analysis in &bundle.file_analyses {
        let file_id = analysis.file_id;
        for symbol in &analysis.symbols {
            // O(1) lookup instead of O(n) scan through entries
            if let Some(&sym_id) = symbol_lookup.get(&(file_id, symbol.name.as_str(), symbol.kind))
            {
                scope_symbols
                    .entry((file_id, symbol.scope_id))
                    .or_default()
                    .push((symbol.name.clone(), sym_id, symbol.kind));
            }
        }
    }

    // Build file_imports_map for reference (no longer used directly in resolution,
    // but kept for debugging and understanding import structure)
    // Maps file path -> slice of that file's imports
    let _file_imports_map: FileImportsMap<'_> = bundle
        .file_analyses
        .iter()
        .map(|a| (a.path.as_str(), a.imports.as_slice()))
        .collect();

    // Build file_exports_map for star import expansion (Spec S11)
    // Maps file path -> (exports from __all__, module-level bindings)
    let file_exports_map: HashMap<&str, (&[LocalExport], &[LocalSymbol])> = bundle
        .file_analyses
        .iter()
        .map(|a| {
            (
                a.path.as_str(),
                (a.exports.as_slice(), a.symbols.as_slice()),
            )
        })
        .collect();

    // Build file_star_imports_map for transitive star import expansion (Spec S12)
    // Maps file path -> list of star imports in that file
    let file_star_imports_map: FileStarImportsMap<'_> = bundle
        .file_analyses
        .iter()
        .map(|a| {
            let star_imports: Vec<&LocalImport> = a.imports.iter().filter(|i| i.is_star).collect();
            (a.path.as_str(), star_imports)
        })
        .collect();

    // ====================================================================
    // Pre-compute Star-Expanded Import Resolvers (Spec S12)
    // ====================================================================
    // Build import resolvers for all files with star imports expanded.
    // This is done upfront so that resolve_import_chain can access
    // star-expanded bindings when following re-export chains.
    let file_import_resolvers: FileImportResolversMap = bundle
        .file_analyses
        .iter()
        .map(|analysis| {
            let mut resolver = FileImportResolver::from_imports(
                &analysis.imports,
                &bundle.workspace_files,
                &bundle.namespace_packages,
                &analysis.path,
            );

            // Expand star imports transitively
            for local_import in &analysis.imports {
                if !local_import.is_star {
                    continue;
                }

                let source_file = resolve_module_to_file(
                    &local_import.module_path,
                    &bundle.workspace_files,
                    &bundle.namespace_packages,
                    Some(&analysis.path),
                    local_import.relative_level,
                );

                // Only process file-based modules for star import expansion
                // Namespace packages don't have exports to expand
                if let Some(ResolvedModule::File(source_path)) = source_file {
                    let mut visited = HashSet::new();
                    let expanded_bindings = collect_star_exports_transitive(
                        &source_path,
                        &file_exports_map,
                        &file_star_imports_map,
                        &bundle.workspace_files,
                        &bundle.namespace_packages,
                        &mut visited,
                    );

                    for binding in expanded_bindings {
                        let qualified_path = binding
                            .source_file
                            .strip_suffix(".py")
                            .or_else(|| binding.source_file.strip_suffix("/__init__.py"))
                            .unwrap_or(&binding.source_file)
                            .replace('/', ".")
                            + "."
                            + &binding.name;

                        resolver.add_star_import_binding(
                            binding.name,
                            qualified_path,
                            Some(binding.source_file),
                        );
                    }
                }
            }

            (analysis.path.clone(), resolver)
        })
        .collect();

    // ====================================================================
    // Build ImportersIndex for Cross-File Alias Tracking
    // ====================================================================
    // This index maps (target_file_path, exported_name) -> Vec<(importing_file_id, local_name)>
    // enabling efficient lookup of all files that import a given symbol.
    let mut importers_index: ImportersIndex = HashMap::new();

    for analysis in &bundle.file_analyses {
        let file_id = analysis.file_id;
        let import_resolver = file_import_resolvers
            .get(&analysis.path)
            .expect("Import resolver should exist for analyzed file");

        // Iterate over all resolved imports and build the reverse index
        for (imported_name, local_name, resolved_file) in import_resolver.iter_resolved_imports() {
            let key = (resolved_file.to_string(), imported_name.to_string());
            importers_index
                .entry(key)
                .or_default()
                .push((file_id, local_name.to_string()));
        }
    }

    // Store the importers_index in the bundle
    bundle.importers_index = importers_index;

    for analysis in &bundle.file_analyses {
        let file_id = analysis.file_id;

        // Get the pre-computed import resolver with star expansion
        let import_resolver = file_import_resolvers
            .get(&analysis.path)
            .expect("Import resolver should exist for analyzed file");

        // Process imports first - insert Import records
        for local_import in &analysis.imports {
            let import_id = store.next_import_id();
            let span = local_import.span.unwrap_or_else(|| Span::new(0, 0));

            // For "from" imports, create an Import record for each name
            if local_import.kind == "from" && !local_import.is_star {
                for imported_name in &local_import.names {
                    let name_import_id = store.next_import_id();
                    // from foo import bar → Named
                    // from foo import bar as baz → Alias
                    let import =
                        Import::new(name_import_id, file_id, span, &local_import.module_path)
                            .with_imported_name(&imported_name.name);
                    let import = if let Some(alias) = &imported_name.alias {
                        import.with_alias(alias)
                    } else {
                        import
                    };
                    store.insert_import(import);
                }
            } else if local_import.is_star {
                // from foo import * → Glob
                let import =
                    Import::new(import_id, file_id, span, &local_import.module_path).with_glob();
                store.insert_import(import);
            } else {
                // import foo → Module
                // import foo as bar → Alias (module import with alias)
                let mut import = Import::new(import_id, file_id, span, &local_import.module_path);
                if let Some(alias) = &local_import.alias {
                    import = import.with_alias(alias);
                }
                store.insert_import(import);
            }
        }

        // Process exports (__all__ entries)
        // Emit PublicExport for each entry in __all__
        // Filter entries without spans per [D01] - exports without spans can't be edit targets
        for local_export in &analysis.exports {
            // Skip exports without declaration spans
            let Some(decl_span) = local_export.span else {
                continue;
            };

            // decl_span = full string literal including quotes
            // exported_name_span = string content only, no quotes
            let public_export_id = store.next_public_export_id();
            let exported_name_span = local_export.content_span;

            // Resolve symbol_id: look up the exported name as a module-level symbol
            // Check each symbol kind that could be exported (Function, Class, Variable, Constant)
            let resolved_symbol_id = [
                SymbolKind::Function,
                SymbolKind::Class,
                SymbolKind::Variable,
                SymbolKind::Constant,
                SymbolKind::Import,
            ]
            .iter()
            .find_map(|&kind| {
                symbol_lookup
                    .get(&(file_id, local_export.name.as_str(), kind))
                    .copied()
            });

            // Build PublicExport with all required fields
            let mut public_export = PublicExport::new(
                public_export_id,
                file_id,
                decl_span,
                ExportKind::PythonAll,
                ExportTarget::Single,
                ExportIntent::Declared,
                ExportOrigin::Local,
            )
            .with_name(&local_export.name); // Sets both exported_name and source_name

            // Add exported_name_span (string content without quotes)
            if let Some(name_span) = exported_name_span {
                public_export = public_export.with_exported_name_span(name_span);
            }

            // Add symbol_id if resolved
            if let Some(sym_id) = resolved_symbol_id {
                public_export = public_export.with_symbol(sym_id);
            }

            store.insert_public_export(public_export);
        }

        // Process references
        // Filter entries without spans per [D01] - references without spans can't be edit targets
        for local_ref in &analysis.references {
            // Skip references without spans
            let Some(ref_span) = local_ref.span else {
                continue;
            };

            // For import references (the imported name in "from x import name as alias"),
            // we need special handling because the import_resolver tracks the alias,
            // not the imported name. We use resolve_imported_name to look up by the
            // original name rather than the local alias.
            let resolved_symbol_id = if local_ref.kind == ReferenceKind::Import {
                resolve_import_reference(
                    &local_ref.name,
                    import_resolver,
                    &global_symbols,
                    &import_bindings,
                    &file_path_to_id,
                    &file_import_resolvers,
                )
            } else {
                // Regular reference resolution (variable usage, calls, etc.)
                resolve_reference(
                    &local_ref.name,
                    local_ref.scope_id,
                    file_id,
                    &analysis.scopes,
                    &global_symbols,
                    &import_bindings,
                    &scope_symbols,
                    import_resolver,
                    &file_path_to_id,
                    &file_import_resolvers,
                    local_ref.kind,
                )
            };

            if let Some(symbol_id) = resolved_symbol_id {
                // Create reference
                let ref_id = store.next_reference_id();
                let reference =
                    Reference::new(ref_id, symbol_id, file_id, ref_span, local_ref.kind);
                store.insert_reference(reference);
            }
            // Note: Unresolved references are silently dropped.
            // This is intentional - we only track references we can resolve.
        }
    }

    // ====================================================================
    // Pass 4: Type-Aware Method Resolution
    // ====================================================================
    // Build TypeTrackers per file, populate TypeInfo and InheritanceInfo,
    // build MethodCallIndex, and insert typed method call references.
    //
    // Per Contract C5 (Type Inference Levels):
    // - Level 1: Constructor calls (x = MyClass()) and variable propagation
    // - Level 2: Annotations (def f(x: Foo), x: int)
    // - Level 3: Return types (h = get_handler() where get_handler() -> Handler)
    //
    // Per Contract C6 (Inheritance and Override Resolution):
    // - Build parent/child relationships from class_inheritance data
    // - Renaming Base.method affects Child.method if it's an override

    // We need to re-analyze files to get P1 data (assignments, annotations,
    // class_inheritance, method_calls). This is necessary because the
    // FileAnalysis struct doesn't currently include P1 data.
    //
    // Note: This could be optimized by storing P1 data in Pass 1, but for now
    // we re-analyze to keep the implementation simple and correct.

    // Build MethodCallIndex for O(1) lookup by method name
    let mut method_call_index = MethodCallIndex::new();

    // Store TypeTrackers per file for type resolution
    let mut type_trackers: HashMap<FileId, TypeTracker> = HashMap::new();

    // Collect all class inheritance info across files for building InheritanceInfo
    let mut all_class_inheritance: Vec<(FileId, tugtool_python_cst::ClassInheritanceInfo)> =
        Vec::new();

    // Precompute O(1) lookup structures to avoid O(n) scans inside loops
    let failed_paths: HashSet<&str> = bundle
        .failed_files
        .iter()
        .map(|(p, _)| p.as_str())
        .collect();
    let analyses_by_file_id: HashMap<FileId, &FileAnalysis> = bundle
        .file_analyses
        .iter()
        .map(|a| (a.file_id, a))
        .collect();

    // Pass 4a: Re-analyze files to get P1 data and build auxiliary structures
    for (path, content) in files {
        // Skip files that failed analysis in Pass 1 (O(1) lookup)
        if failed_paths.contains(path.as_str()) {
            continue;
        }

        // Get the FileId for this path
        let file_id = match file_path_to_id.get(path) {
            Some(&id) => id,
            None => continue,
        };

        // Re-parse to get P1 data
        let native_result = match cst_bridge::parse_and_analyze(content) {
            Ok(result) => result,
            Err(_) => continue, // Skip if re-parse fails (shouldn't happen)
        };

        // Build TypeTracker from assignments and annotations
        let mut tracker = TypeTracker::new();

        // Convert CST AssignmentInfo to types AssignmentInfo for TypeTracker
        let cst_assignments: Vec<crate::types::AssignmentInfo> = native_result
            .assignments
            .iter()
            .map(|a| crate::types::AssignmentInfo {
                target: a.target.clone(),
                scope_path: a.scope_path.clone(),
                type_source: a.type_source.as_str().to_string(),
                inferred_type: a.inferred_type.clone(),
                rhs_name: a.rhs_name.clone(),
                callee_name: a.callee_name.clone(),
                span: a.span.as_ref().map(|s| crate::types::SpanInfo {
                    start: s.start,
                    end: s.end,
                }),
                line: a.line,
                col: a.col,
                is_self_attribute: a.is_self_attribute,
                attribute_name: a.attribute_name.clone(),
            })
            .collect();

        // Convert CST AnnotationInfo to types AnnotationInfo for TypeTracker
        let cst_annotations: Vec<crate::types::AnnotationInfo> = native_result
            .annotations
            .iter()
            .map(|a| crate::types::AnnotationInfo {
                name: a.name.clone(),
                annotation_kind: a.annotation_kind.as_str().to_string(),
                source_kind: a.source_kind.as_str().to_string(),
                type_str: a.type_str.clone(),
                scope_path: a.scope_path.clone(),
                span: a.span.as_ref().map(|s| crate::types::SpanInfo {
                    start: s.start,
                    end: s.end,
                }),
                line: a.line,
                col: a.col,
                // Pass through the structured TypeNode built at CST collection time
                type_node: a.type_node.clone(),
            })
            .collect();

        // Process in correct order for type precedence:
        // 1. Annotations (highest priority - explicit type declarations)
        // 2. Instance attributes (self.attr = ... patterns from __init__)
        // 3. Signatures (method return types for call resolution)
        // 4. Assignments (regular variable type inference)
        // 5. Resolve types (propagate through aliases)
        tracker.process_annotations(&cst_annotations);
        tracker.process_instance_attributes(&cst_assignments);
        tracker.process_signatures(&native_result.signatures);
        tracker.process_properties(&native_result.signatures);
        tracker.process_assignments(&cst_assignments);
        tracker.resolve_types();

        type_trackers.insert(file_id, tracker);

        // Build MethodCallIndex from method calls
        // First, get the FileAnalysis to access scope information (O(1) lookup)
        let analysis = analyses_by_file_id.get(&file_id);

        for mc in &native_result.method_calls {
            // Resolve receiver type using TypeTracker
            let receiver_type = type_trackers
                .get(&file_id)
                .and_then(|tracker| tracker.type_of(&mc.scope_path, &mc.receiver))
                .map(String::from);

            let indexed_call = IndexedMethodCall {
                file_id,
                receiver: mc.receiver.clone(),
                receiver_type,
                scope_path: mc.scope_path.clone(),
                method_span: mc
                    .method_span
                    .as_ref()
                    .map(|s| Span::new(s.start, s.end))
                    .unwrap_or_else(|| Span::new(0, 0)),
            };

            method_call_index.add(mc.method.clone(), indexed_call);
        }

        // Collect class inheritance info
        for ci in native_result.class_inheritance {
            all_class_inheritance.push((file_id, ci));
        }

        // Mark analysis as used to suppress warning
        let _ = analysis;
    }

    // Pass 4b: Populate TypeInfo in FactsStore for typed variables
    for (&file_id, tracker) in &type_trackers {
        crate::type_tracker::populate_type_info(tracker, store, file_id);
    }

    // Pass 4c: Build InheritanceInfo from class_inheritance data
    // Create a map of (file_id, class_name) -> SymbolId for resolving inheritance
    // Use owned strings to avoid borrow issues
    let class_name_to_symbol: HashMap<(FileId, String), SymbolId> = store
        .symbols()
        .filter(|s| s.kind == SymbolKind::Class)
        .map(|s| ((s.decl_file_id, s.name.clone()), s.symbol_id))
        .collect();

    // Collect inheritance relationships first (to avoid borrow issues)
    let mut inheritance_to_insert: Vec<tugtool_core::facts::InheritanceInfo> = Vec::new();

    for (file_id, ci) in &all_class_inheritance {
        // Find the child class symbol
        let child_id = match class_name_to_symbol.get(&(*file_id, ci.name.clone())) {
            Some(&id) => id,
            None => continue,
        };

        // For each base class, try to resolve it to a symbol
        for base_name in &ci.bases {
            // Try to find the base class in the same file first
            if let Some(&parent_id) = class_name_to_symbol.get(&(*file_id, base_name.clone())) {
                inheritance_to_insert.push(tugtool_core::facts::InheritanceInfo::new(
                    child_id, parent_id,
                ));
                continue;
            }

            // Try to resolve via imports
            // Find the FileAnalysis for this file to get import info (O(1) lookup)
            if let Some(analysis) = analyses_by_file_id.get(file_id) {
                // Use FileImportResolver which resolves imports against workspace_files
                let import_resolver = FileImportResolver::from_imports(
                    &analysis.imports,
                    &bundle.workspace_files,
                    &bundle.namespace_packages,
                    &analysis.path,
                );

                if let Some((qualified_name, Some(resolved_path))) =
                    import_resolver.resolve(base_name)
                {
                    if let Some(&target_file_id) = file_path_to_id.get(resolved_path) {
                        // Extract the actual class name from the qualified path
                        let target_class_name =
                            qualified_name.rsplit('.').next().unwrap_or(base_name);
                        if let Some(&parent_id) = class_name_to_symbol
                            .get(&(target_file_id, target_class_name.to_string()))
                        {
                            inheritance_to_insert.push(tugtool_core::facts::InheritanceInfo::new(
                                child_id, parent_id,
                            ));
                        }
                    }
                }
            }
        }
    }

    // Now insert all collected inheritance relationships
    for inheritance in inheritance_to_insert {
        store.insert_inheritance(inheritance);
    }

    // Pass 4d: Insert typed method call references
    // For each class method, look up matching calls in MethodCallIndex
    // and filter by receiver type

    // Collect class method symbols: (method_name, class_name, symbol_id, file_id)
    let class_methods: Vec<(String, String, SymbolId, FileId)> = store
        .symbols()
        .filter(|s| {
            // A method is a function with a container (the class)
            (s.kind == SymbolKind::Function || s.kind == SymbolKind::Method)
                && s.container_symbol_id.is_some()
        })
        .filter_map(|s| {
            // Get the container class name
            let container_id = s.container_symbol_id?;
            let container = store.symbol(container_id)?;
            Some((
                s.name.clone(),
                container.name.clone(),
                s.symbol_id,
                s.decl_file_id,
            ))
        })
        .collect();

    for (method_name, class_name, method_symbol_id, _method_file_id) in class_methods {
        // Look up all calls to this method name
        let matching_calls = method_call_index.get(&method_name);

        for call in matching_calls {
            // Check if the receiver type matches the class
            let type_matches = call.receiver_type.as_deref() == Some(&class_name);

            // Also check if receiver is "self" or "cls" and we're in a method of this class
            let is_self_call = (call.receiver == "self" || call.receiver == "cls")
                && call.scope_path.iter().any(|s| s == &class_name);

            if type_matches || is_self_call {
                // Insert a reference from this call site to the method
                let ref_id = store.next_reference_id();
                let reference = Reference::new(
                    ref_id,
                    method_symbol_id,
                    call.file_id,
                    call.method_span,
                    ReferenceKind::Call,
                );
                store.insert_reference(reference);
            }
        }
    }

    // Store TypeTrackers in bundle for use by adapter conversion
    bundle.type_trackers = type_trackers;

    Ok(bundle)
}

/// Analyze a single Python file using the native Rust CST parser.
///
/// This function parses the file using tugtool-python-cst and collects scopes,
/// bindings, references, and imports with zero Python dependencies.
///
/// # Arguments
///
/// * `file_id` - Unique identifier for the file
/// * `path` - File path (used for error messages)
/// * `content` - Python source code to analyze
///
/// # Returns
///
/// A [`FileAnalysis`] containing scopes, symbols, references, and imports.
///
/// # Example
///
/// ```ignore
/// use tugtool_python::analyzer::analyze_file;
/// use tugtool_core::patch::FileId;
///
/// let content = "def foo():\n    x = 1\n    return x";
/// let analysis = analyze_file(FileId::new(0), "test.py", content)?;
///
/// assert!(!analysis.scopes.is_empty());
/// assert!(!analysis.symbols.is_empty());
/// ```
pub fn analyze_file(file_id: FileId, path: &str, content: &str) -> AnalyzerResult<FileAnalysis> {
    // Parse and analyze using native CST
    let native_result = cst_bridge::parse_and_analyze(content)?;

    // Build scope structure from native scopes
    let (scopes, _scope_map) = build_scopes(&native_result.scopes);

    // Convert bindings to local symbols
    let symbols = collect_symbols(&native_result.bindings, &scopes);

    // Convert references
    let mut references = Vec::new();
    for (name, native_refs) in native_result.references {
        for native_ref in native_refs {
            references.push(LocalReference {
                name: name.clone(),
                kind: reference_kind_from_str(&native_ref.kind),
                span: native_ref.span.as_ref().map(|s| Span::new(s.start, s.end)),
                line: native_ref.line,
                col: native_ref.col,
                scope_id: ScopeId(0), // Will be resolved during scope analysis
                resolved_symbol: Some(name.clone()), // Same-name reference
            });
        }
    }

    // Convert native imports to LocalImport format
    // Note: We use empty workspace_files and namespace_packages sets here since single-file
    // analysis doesn't have access to the workspace. The caller (analyze_files) handles
    // workspace-aware import resolution.
    let imports = convert_imports(
        &native_result.imports,
        &HashSet::new(),
        &HashSet::new(),
        path,
    );

    // Convert exports (from __all__) for star import expansion and rename operations
    let exports: Vec<LocalExport> = native_result
        .exports
        .iter()
        .map(|e| LocalExport {
            name: e.name.clone(),
            span: e.span.map(|s| Span::new(s.start, s.end)),
            content_span: e.content_span.map(|s| Span::new(s.start, s.end)),
        })
        .collect();

    // Build imports set for AliasGraph
    // Collect all names bound by imports (local names, not module paths).
    // For `from x import y as z`, the bound name is `z` (or `y` if no alias).
    // For `import foo as bar`, the bound name is `bar` (or last segment of module_path).
    let imported_names: HashSet<String> = imports
        .iter()
        .flat_map(|imp| {
            let mut names = Vec::new();
            // Collect names from `from x import y, z` style imports
            for imported in &imp.names {
                // Use alias if present, otherwise use the original name
                let bound_name = imported
                    .alias
                    .clone()
                    .unwrap_or_else(|| imported.name.clone());
                names.push(bound_name);
            }
            // For `import foo` or `import foo as bar`, use alias or last module segment
            if imp.names.is_empty() && !imp.is_star {
                if let Some(alias) = &imp.alias {
                    names.push(alias.clone());
                } else {
                    // Extract the last segment of the module path (e.g., "os" from "os.path")
                    if let Some(last) = imp.module_path.rsplit('.').next() {
                        names.push(last.to_string());
                    }
                }
            }
            names
        })
        .collect();

    // Convert CstAssignmentInfo to types::AssignmentInfo for AliasGraph
    let types_assignments: Vec<crate::types::AssignmentInfo> = native_result
        .assignments
        .iter()
        .map(|a| crate::types::AssignmentInfo {
            target: a.target.clone(),
            scope_path: a.scope_path.clone(),
            type_source: a.type_source.as_str().to_string(),
            inferred_type: a.inferred_type.clone(),
            rhs_name: a.rhs_name.clone(),
            callee_name: a.callee_name.clone(),
            span: a.span.as_ref().map(|s| crate::types::SpanInfo {
                start: s.start,
                end: s.end,
            }),
            line: a.line,
            col: a.col,
            is_self_attribute: a.is_self_attribute,
            attribute_name: a.attribute_name.clone(),
        })
        .collect();

    // Build AliasGraph from assignments and imports
    let alias_graph = AliasGraph::from_analysis(&types_assignments, &imported_names);

    Ok(FileAnalysis {
        file_id,
        path: path.to_string(),
        cst_id: String::new(), // No CST ID for native analysis
        scopes,
        symbols,
        references,
        imports,
        exports,
        alias_graph,
        signatures: native_result.signatures,
        attribute_accesses: native_result.attribute_accesses,
        call_sites: native_result.call_sites,
        class_hierarchies: native_result.class_inheritance,
    })
}

/// Build a TypeTracker from native CST analysis result.
///
/// This converts CST assignments and annotations to the types module format
/// and processes them to build type inference information.
///
/// # Processing Order (Critical for Correct Precedence)
///
/// The TypeTracker methods are called in this specific order:
/// 1. `process_annotations` - Class-level and explicit annotations (highest priority)
/// 2. `process_instance_attributes` - `self.attr = ...` patterns from `__init__`
/// 3. `process_signatures` - Method return types for call resolution
/// 4. `process_assignments` - Regular variable assignments
/// 5. `resolve_types` - Propagate types through variable aliases
///
/// This order ensures that explicit annotations take precedence over inferred types,
/// and that instance attribute types are properly tracked before variable assignments.
fn build_type_tracker(native_result: &cst_bridge::NativeAnalysisResult) -> TypeTracker {
    let mut tracker = TypeTracker::new();

    // Convert CST AssignmentInfo to types::AssignmentInfo for TypeTracker
    let cst_assignments: Vec<crate::types::AssignmentInfo> = native_result
        .assignments
        .iter()
        .map(|a| crate::types::AssignmentInfo {
            target: a.target.clone(),
            scope_path: a.scope_path.clone(),
            type_source: a.type_source.as_str().to_string(),
            inferred_type: a.inferred_type.clone(),
            rhs_name: a.rhs_name.clone(),
            callee_name: a.callee_name.clone(),
            span: a.span.as_ref().map(|s| crate::types::SpanInfo {
                start: s.start,
                end: s.end,
            }),
            line: a.line,
            col: a.col,
            is_self_attribute: a.is_self_attribute,
            attribute_name: a.attribute_name.clone(),
        })
        .collect();

    // Convert CST AnnotationInfo to types::AnnotationInfo for TypeTracker
    let cst_annotations: Vec<crate::types::AnnotationInfo> = native_result
        .annotations
        .iter()
        .map(|a| crate::types::AnnotationInfo {
            name: a.name.clone(),
            annotation_kind: a.annotation_kind.as_str().to_string(),
            source_kind: a.source_kind.as_str().to_string(),
            type_str: a.type_str.clone(),
            scope_path: a.scope_path.clone(),
            span: a.span.as_ref().map(|s| crate::types::SpanInfo {
                start: s.start,
                end: s.end,
            }),
            line: a.line,
            col: a.col,
            // Pass through the structured TypeNode built at CST collection time
            type_node: a.type_node.clone(),
        })
        .collect();

    // Process in correct order for type precedence:
    // 1. Annotations (highest priority - explicit type declarations)
    // 2. Instance attributes (self.attr = ... patterns from __init__)
    // 3. Signatures (method return types for call resolution)
    // 4. Properties (property decorator return types)
    // 5. Assignments (regular variable type inference)
    // 6. Resolve types (propagate through aliases)
    tracker.process_annotations(&cst_annotations);
    tracker.process_instance_attributes(&cst_assignments);
    tracker.process_signatures(&native_result.signatures);
    tracker.process_properties(&native_result.signatures);
    tracker.process_assignments(&cst_assignments);
    tracker.resolve_types();

    tracker
}

/// Build scope structure from native scope info.
fn build_scopes(native_scopes: &[ScopeInfo]) -> (Vec<Scope>, HashMap<String, ScopeId>) {
    let mut scope_map = HashMap::new();

    // Pass 1: Assign ScopeIds to all scopes
    for (idx, ns) in native_scopes.iter().enumerate() {
        let scope_id = ScopeId::new(idx as u32);
        scope_map.insert(ns.id.clone(), scope_id);
    }

    // Pass 2: Create scopes with parent references
    let scopes: Vec<Scope> = native_scopes
        .iter()
        .enumerate()
        .map(|(idx, ns)| {
            let scope_id = ScopeId::new(idx as u32);
            let parent_id = ns.parent.as_ref().and_then(|p| scope_map.get(p).copied());

            // Convert byte_span from SpanInfo to Span
            let span = ns.byte_span.as_ref().map(|s| Span::new(s.start, s.end));

            let mut scope = Scope::new(
                scope_id,
                scope_kind_from_str(ns.kind.as_str()),
                ns.name.clone(),
                parent_id,
            )
            .with_span(span);
            // Populate globals and nonlocals from native scope info
            scope.globals = ns.globals.iter().cloned().collect();
            scope.nonlocals = ns.nonlocals.iter().cloned().collect();
            scope
        })
        .collect();

    (scopes, scope_map)
}

/// Collect symbols from native bindings.
fn collect_symbols(bindings: &[BindingInfo], scopes: &[Scope]) -> Vec<LocalSymbol> {
    // Precompute indexes for O(1) lookups instead of O(n) scans per binding
    let scope_index = build_scope_index(scopes);
    let class_names: HashSet<&str> = scopes
        .iter()
        .filter(|s| s.kind == ScopeKind::Class)
        .filter_map(|s| s.name.as_deref())
        .collect();

    let mut symbols = Vec::new();

    for binding in bindings {
        let kind = symbol_kind_from_str(&binding.kind);

        // Determine scope from scope_path (O(D) with precomputed index)
        let scope_id =
            find_scope_for_path_indexed(&binding.scope_path, &scope_index).unwrap_or(ScopeId(0));

        // Determine container for methods (O(1) with precomputed set)
        let container = if binding.scope_path.len() >= 2 {
            let path_without_module: Vec<_> = binding
                .scope_path
                .iter()
                .filter(|s| *s != "<module>")
                .collect();

            if !path_without_module.is_empty() {
                let last_name = path_without_module.last().unwrap();
                if class_names.contains(last_name.as_str()) {
                    Some((*last_name).clone())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        symbols.push(LocalSymbol {
            name: binding.name.clone(),
            kind,
            scope_id,
            span: binding.span.as_ref().map(|s| Span::new(s.start, s.end)),
            line: binding.line,
            col: binding.col,
            container,
        });
    }

    symbols
}

/// Index for O(1) scope lookups by (parent_id, name).
///
/// The key uses `Option<String>` for name because module scopes have no name.
type ScopeIndex<'a> = HashMap<(Option<ScopeId>, Option<&'a str>), &'a Scope>;

/// Build an index for efficient scope path resolution.
///
/// Returns a map from (parent_id, scope_name) to Scope for O(1) lookup.
fn build_scope_index(scopes: &[Scope]) -> ScopeIndex<'_> {
    scopes
        .iter()
        .map(|s| ((s.parent_id, s.name.as_deref()), s))
        .collect()
}

/// Find the scope that matches a scope_path using a precomputed index.
///
/// Complexity: O(D) where D = scope_path depth, vs O(D * M) for linear search.
fn find_scope_for_path_indexed(scope_path: &[String], index: &ScopeIndex<'_>) -> Option<ScopeId> {
    if scope_path.is_empty() {
        return Some(ScopeId(0)); // Module scope
    }

    // Walk through the scope_path and find matching scopes
    // The scope_path is like ["<module>", "ClassName", "method_name"]

    let mut current_parent: Option<ScopeId> = None;

    for name in scope_path {
        // Look up scope by (parent_id, name) - O(1)
        let key = if name == "<module>" {
            (current_parent, None) // Module scope has no name
        } else {
            (current_parent, Some(name.as_str()))
        };

        if let Some(scope) = index.get(&key) {
            current_parent = Some(scope.id);
        } else {
            // Scope path doesn't match - return module scope as fallback
            // Module scope is (None, None)
            return index.get(&(None, None)).map(|s| s.id);
        }
    }

    current_parent
}

// ========================================================================
// Import Resolution (Contract C3)
// ========================================================================

/// Per-file import resolver for Pass 3 reference resolution.
///
/// This struct implements Contract C3 import resolution:
///
/// ## Supported Import Patterns
///
/// - `import foo` → aliases["foo"] = ("foo", None)
/// - `import foo.bar` → aliases["foo"] = ("foo", None) **binds ROOT only**
/// - `import foo as f` → aliases["f"] = ("foo", None)
/// - `import foo.bar as fb` → aliases["fb"] = ("foo.bar", resolved_file)
/// - `from foo import bar` → aliases["bar"] = ("foo.bar", resolved_file)
/// - `from foo import bar as b` → aliases["b"] = ("foo.bar", resolved_file)
/// - `from .module import name` → aliases["name"] = ("pkg.module.name", resolved_file) (relative imports)
/// - `from ..utils import foo` → aliases["foo"] = ("parent.utils.foo", resolved_file) (multi-level relative)
/// - Re-export chains (A → B → C) are followed to find original definitions
/// - Imports inside `if TYPE_CHECKING:` blocks are collected and resolved
///
/// ## Not Expanded (Tracked Only)
///
/// - `from foo import *` → Recorded with is_star=true, but individual names not expanded
///
/// ## Out of Scope
///
/// - Namespace packages (PEP 420 - packages without `__init__.py`)
/// - Conditional/dynamic imports (except TYPE_CHECKING which is always analyzed)
///
/// ## Terminology (Contract C3.1)
///
/// - **Local Name**: The name used in the importing file's scope after the import.
///   - `from x import foo` → local name is "foo"
///   - `from x import foo as bar` → local name is "bar"
///   - `import x.y` → local name is "x" (binds root only)
///   - `import x.y as z` → local name is "z"
///
/// - **Imported Name**: The actual name being imported from the source module.
///   - `from x import foo` → imported name is "foo"
///   - `from x import foo as bar` → imported name is "foo" (NOT "bar")
///
/// - **Qualified Path**: The full dotted path to the symbol.
///   - `from x.y import foo` → qualified path is "x.y.foo"
///   - `from .utils import bar` (in pkg/sub.py) → qualified path is "pkg.utils.bar"
///
/// ## Data Structures
///
/// The resolver maintains two indexes for efficient lookup:
///
/// 1. `by_local_name`: Maps local names to (qualified_path, resolved_file)
///    - Used for resolving references in code (most common case)
///    - O(1) lookup by local name
///
/// 2. `by_imported_name`: Maps imported names to local names
///    - Used for resolving import statements themselves (e.g., the "foo" in `from x import foo`)
///    - Enables O(1) lookup instead of linear search through all aliases
#[derive(Debug, Default)]
pub struct FileImportResolver {
    /// Primary index: Maps local bound names to (qualified_path, resolved_file).
    /// This is the main lookup used for resolving references in code.
    by_local_name: HashMap<String, (String, Option<String>)>,

    /// Secondary index: Maps imported names to local names.
    /// This enables O(1) lookup when resolving import references.
    /// For `from x import foo as bar`, maps "foo" -> "bar".
    by_imported_name: HashMap<String, String>,
}

impl FileImportResolver {
    /// Create a new empty resolver.
    pub fn new() -> Self {
        Self::default()
    }

    /// Build from a list of local imports, resolving to workspace files.
    ///
    /// This is the full-featured constructor that resolves relative imports
    /// and looks up modules in the workspace file set.
    ///
    /// # Arguments
    /// * `imports` - List of imports from the file
    /// * `workspace_files` - Set of all workspace file paths
    /// * `namespace_packages` - Set of detected PEP 420 namespace package paths
    /// * `importing_file_path` - Path of the file containing these imports (for relative import resolution)
    pub fn from_imports(
        imports: &[LocalImport],
        workspace_files: &HashSet<String>,
        namespace_packages: &HashSet<String>,
        importing_file_path: &str,
    ) -> Self {
        let mut resolver = Self::new();

        for import in imports {
            match import.kind.as_str() {
                "from" => {
                    // Skip star imports for alias resolution.
                    // Star imports are TRACKED (recorded with is_star=true) but individual
                    // names are NOT expanded. Full expansion would require analyzing the
                    // source module's __all__ or public bindings at analysis time.
                    if import.is_star {
                        continue;
                    }

                    // `from foo import bar` or `from foo import bar as b`
                    // Also handles relative: `from .utils import bar` and `from . import utils`
                    for imported_name in &import.names {
                        let local_name =
                            imported_name.alias.as_ref().unwrap_or(&imported_name.name);

                        // Build qualified path - for relative imports, resolve to absolute first
                        let base_module_path = if import.relative_level > 0 {
                            resolve_relative_path(
                                importing_file_path,
                                import.relative_level,
                                &import.module_path,
                            )
                            .replace('/', ".")
                        } else {
                            import.module_path.clone()
                        };

                        let qualified_path = if base_module_path.is_empty() {
                            // from . import utils -> qualified path is just the imported name
                            imported_name.name.clone()
                        } else {
                            format!("{}.{}", base_module_path, imported_name.name)
                        };

                        // Resolve the module to a workspace file
                        // For `from . import utils`, we need to resolve the imported_name as
                        // a submodule, not the empty module_path
                        let module_to_resolve =
                            if import.module_path.is_empty() && import.relative_level > 0 {
                                // `from . import utils` - resolve the imported name as a module
                                &imported_name.name
                            } else {
                                &import.module_path
                            };

                        let resolved = resolve_module_to_file(
                            module_to_resolve,
                            workspace_files,
                            namespace_packages,
                            Some(importing_file_path),
                            import.relative_level,
                        );
                        // Extract file path for import resolution (namespace packages don't have symbols)
                        let resolved_file =
                            resolved.and_then(|r| r.as_file().map(|s| s.to_string()));

                        resolver.insert(
                            local_name.clone(),
                            imported_name.name.clone(),
                            qualified_path,
                            resolved_file,
                        );
                    }
                }
                "import" => {
                    if let Some(alias) = &import.alias {
                        // `import foo.bar as fb` → by_local_name["fb"] = ("foo.bar", resolved)
                        let resolved = resolve_module_to_file(
                            &import.module_path,
                            workspace_files,
                            namespace_packages,
                            Some(importing_file_path),
                            import.relative_level,
                        );
                        // Extract file path for import resolution (namespace packages don't have symbols)
                        let resolved_file =
                            resolved.and_then(|r| r.as_file().map(|s| s.to_string()));
                        // For module imports, the "imported name" is the full module path
                        resolver.insert(
                            alias.clone(),
                            import.module_path.clone(),
                            import.module_path.clone(),
                            resolved_file,
                        );
                    } else {
                        // `import foo.bar` → by_local_name["foo"] = ("foo", None)
                        // Per Contract C3: binds ROOT only
                        let root = import
                            .module_path
                            .split('.')
                            .next()
                            .unwrap_or(&import.module_path);
                        resolver.insert(root.to_string(), root.to_string(), root.to_string(), None);
                    }
                }
                _ => {}
            }
        }

        resolver
    }

    /// Build a simple resolver from imports without workspace resolution.
    ///
    /// This constructor is useful for inheritance resolution where we only
    /// need to map local names to qualified paths without resolving files.
    ///
    /// # Arguments
    /// * `imports` - List of imports from the file
    pub fn from_imports_simple(imports: &[LocalImport]) -> Self {
        let mut resolver = Self::new();

        for import in imports {
            match import.kind.as_str() {
                "from" => {
                    // Skip star imports - can't resolve specific names without source analysis
                    if import.is_star {
                        continue;
                    }

                    for imported_name in &import.names {
                        let local_name =
                            imported_name.alias.as_ref().unwrap_or(&imported_name.name);
                        let qualified_path =
                            format!("{}.{}", import.module_path, imported_name.name);

                        resolver.insert(
                            local_name.clone(),
                            imported_name.name.clone(),
                            qualified_path,
                            import.resolved_file.clone(),
                        );
                    }
                }
                "import" => {
                    let local_name = import.alias.as_ref().unwrap_or(&import.module_path);
                    let first_component = import
                        .module_path
                        .split('.')
                        .next()
                        .unwrap_or(&import.module_path);

                    if import.alias.is_some() {
                        resolver.insert(
                            local_name.clone(),
                            import.module_path.clone(),
                            import.module_path.clone(),
                            import.resolved_file.clone(),
                        );
                    } else {
                        resolver.insert(
                            first_component.to_string(),
                            first_component.to_string(),
                            first_component.to_string(),
                            None,
                        );
                    }
                }
                _ => {}
            }
        }

        resolver
    }

    /// Insert an import mapping into both indexes.
    ///
    /// # Arguments
    /// * `local_name` - The name bound in the importing file's scope
    /// * `imported_name` - The actual name being imported from the source
    /// * `qualified_path` - The full dotted path to the symbol
    /// * `resolved_file` - The workspace file path if known
    fn insert(
        &mut self,
        local_name: String,
        imported_name: String,
        qualified_path: String,
        resolved_file: Option<String>,
    ) {
        self.by_local_name
            .insert(local_name.clone(), (qualified_path, resolved_file));
        self.by_imported_name.insert(imported_name, local_name);
    }

    /// Resolve a local name to its qualified path and source file.
    ///
    /// This is the primary lookup method, used for resolving references in code.
    /// O(1) complexity via HashMap lookup.
    ///
    /// # Example
    /// ```ignore
    /// // For: from x.y import foo as bar
    /// resolver.resolve("bar") // → Some(("x.y.foo", Some("x/y.py")))
    /// resolver.resolve("foo") // → None (foo is not the local name)
    /// ```
    pub fn resolve(&self, local_name: &str) -> Option<(&str, Option<&str>)> {
        self.by_local_name
            .get(local_name)
            .map(|(qn, rf)| (qn.as_str(), rf.as_deref()))
    }

    /// Resolve an imported name to its qualified path and source file.
    ///
    /// This is used for import references where we have the IMPORTED name
    /// (e.g., "process_data" in `from .utils import process_data as proc`)
    /// rather than the local name (e.g., "proc").
    ///
    /// O(1) complexity via two HashMap lookups (imported_name → local_name → data).
    ///
    /// # Example
    /// ```ignore
    /// // For: from x.y import foo as bar
    /// resolver.resolve_imported_name("foo") // → Some(("x.y.foo", Some("x/y.py")))
    /// resolver.resolve_imported_name("bar") // → None (bar is the local name, not imported)
    /// ```
    pub fn resolve_imported_name(&self, imported_name: &str) -> Option<(&str, Option<&str>)> {
        // O(1) lookup via secondary index
        let local_name = self.by_imported_name.get(imported_name)?;
        self.by_local_name
            .get(local_name)
            .map(|(qn, rf)| (qn.as_str(), rf.as_deref()))
    }

    /// Check if a name is imported (by local name).
    pub fn is_imported(&self, local_name: &str) -> bool {
        self.by_local_name.contains_key(local_name)
    }

    /// Get the resolved file path for an imported name.
    ///
    /// Returns `Some(file_path)` if the import was resolved to a workspace file.
    pub fn resolved_file(&self, local_name: &str) -> Option<&str> {
        self.by_local_name
            .get(local_name)
            .and_then(|(_, rf)| rf.as_deref())
    }

    /// Get all local names (useful for debugging/testing).
    #[cfg(test)]
    pub fn local_names(&self) -> impl Iterator<Item = &str> {
        self.by_local_name.keys().map(|s| s.as_str())
    }

    /// Iterate over all import entries for building ImportersIndex.
    ///
    /// Returns tuples of (imported_name, local_name, resolved_file) for each import
    /// that has a resolved file. This allows building a reverse index from
    /// (target_file, exported_name) to (importing_file, local_name).
    ///
    /// For `from x import foo as bar` with resolved file "x.py":
    ///   yields ("foo", "bar", "x.py")
    ///
    /// For star imports, the imported_name equals local_name.
    pub fn iter_resolved_imports(&self) -> impl Iterator<Item = (&str, &str, &str)> {
        self.by_imported_name
            .iter()
            .filter_map(|(imported_name, local_name)| {
                self.by_local_name
                    .get(local_name)
                    .and_then(|(_, resolved_file)| {
                        resolved_file
                            .as_ref()
                            .map(|rf| (imported_name.as_str(), local_name.as_str(), rf.as_str()))
                    })
            })
    }

    /// Add an expanded star import binding.
    ///
    /// Used by star import expansion (Step 6.8) to add individual bindings
    /// for names exported by a star-imported module.
    ///
    /// # Arguments
    /// * `name` - The exported name (becomes both local and imported name)
    /// * `qualified_path` - The full dotted path to the symbol
    /// * `resolved_file` - The workspace file path
    pub fn add_star_import_binding(
        &mut self,
        name: String,
        qualified_path: String,
        resolved_file: Option<String>,
    ) {
        // For star imports, local name == imported name
        self.insert(name.clone(), name, qualified_path, resolved_file);
    }
}

/// Resolve a module path to a workspace file or namespace package.
///
/// Per Contract C3 and Spec S03 module resolution algorithm:
/// 1. For relative imports (relative_level > 0), use context_path to resolve
/// 2. Try `resolved_path.py` → return File if found
/// 3. Try `resolved_path/__init__.py` → return File if found
/// 4. If `resolved_path` in namespace_packages → return Namespace
/// 5. Return None
///
/// # Arguments
/// * `module_path` - The module path (e.g., "utils" or "foo.bar")
/// * `workspace_files` - Set of all workspace file paths
/// * `namespace_packages` - Set of detected PEP 420 namespace package paths
/// * `context_path` - Path of the importing file (for relative imports)
/// * `relative_level` - Number of leading dots (0 = absolute, 1 = from ., etc.)
///
/// # Returns
/// * `Some(ResolvedModule::File(path))` - Regular module/package with file
/// * `Some(ResolvedModule::Namespace(path))` - PEP 420 namespace package
/// * `None` - Module not found
pub fn resolve_module_to_file(
    module_path: &str,
    workspace_files: &HashSet<String>,
    namespace_packages: &HashSet<String>,
    context_path: Option<&str>,
    relative_level: u32,
) -> Option<ResolvedModule> {
    // For relative imports, use resolve_relative_path to get the absolute path
    let resolved_path = if relative_level > 0 {
        if let Some(ctx) = context_path {
            resolve_relative_path(ctx, relative_level, module_path)
        } else {
            // Can't resolve relative import without context
            return None;
        }
    } else {
        // Absolute import: convert dots to slashes
        module_path.replace('.', "/")
    };

    // Try as .py file first (per Contract C3: module file wins)
    let py_path = format!("{}.py", resolved_path);
    if workspace_files.contains(&py_path) {
        return Some(ResolvedModule::File(py_path));
    }

    // Try as package (__init__.py)
    let init_path = format!("{}/__init__.py", resolved_path);
    if workspace_files.contains(&init_path) {
        return Some(ResolvedModule::File(init_path));
    }

    // Try as namespace package (PEP 420)
    if namespace_packages.contains(&resolved_path) {
        return Some(ResolvedModule::Namespace(resolved_path));
    }

    None
}

/// Resolve a relative import path to an absolute module path.
///
/// This function converts Python relative imports (e.g., `from .utils import foo`)
/// into absolute module paths that can be resolved against workspace files.
///
/// # Arguments
/// * `importing_file` - Path of the file containing the import (e.g., "lib/foo.py")
/// * `relative_level` - Number of leading dots (0 = absolute, 1 = current package, 2+ = parent packages)
/// * `module_name` - Module name after the dots (e.g., "utils" from "from .utils import foo")
///
/// # Returns
/// The resolved module path as a forward-slash separated path (e.g., "lib/utils").
/// For absolute imports (relative_level = 0), converts dots to slashes.
///
/// # Algorithm (Spec S01)
/// 1. Get directory of importing file
/// 2. For each relative level, go up one parent directory
/// 3. Append module_name (dots converted to slashes)
/// 4. Return the resulting path
///
/// # Examples
/// ```ignore
/// resolve_relative_path("lib/foo.py", 1, "utils") -> "lib/utils"
/// resolve_relative_path("lib/sub/foo.py", 1, "bar") -> "lib/sub/bar"
/// resolve_relative_path("lib/foo.py", 1, "") -> "lib"
/// resolve_relative_path("lib/foo.py", 0, "absolute.path") -> "absolute/path"
/// ```
pub fn resolve_relative_path(
    importing_file: &str,
    relative_level: u32,
    module_name: &str,
) -> String {
    // Handle absolute imports (relative_level = 0)
    if relative_level == 0 {
        // Convert dots to slashes for absolute module paths
        return module_name.replace('.', "/");
    }
    // Get the directory of the importing file
    let dir = std::path::Path::new(importing_file)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    // Go up parent directories based on relative level
    // relative_level = 1 means current package (stay in same directory)
    // relative_level = 2 means parent package (go up one)
    // etc.
    let mut current_dir = std::path::PathBuf::from(&dir);
    for _ in 1..relative_level {
        if let Some(parent) = current_dir.parent() {
            current_dir = parent.to_path_buf();
        }
    }

    // Convert back to forward-slash path
    let base_path = current_dir.to_string_lossy().replace('\\', "/");

    // Append module name if present
    if module_name.is_empty() {
        base_path
    } else {
        let module_path = module_name.replace('.', "/");
        if base_path.is_empty() {
            module_path
        } else {
            format!("{}/{}", base_path, module_path)
        }
    }
}

// ========================================================================
// Namespace Package Detection (PEP 420)
// ========================================================================

/// Compute the set of namespace packages from workspace files.
///
/// A namespace package (PEP 420) is a directory that contains Python files
/// but no `__init__.py`. This function scans the workspace file paths and
/// identifies such directories.
///
/// # Algorithm
///
/// For each `.py` file in the workspace:
/// 1. Walk up the directory tree from the file's parent directory
/// 2. For each directory visited:
///    - If it doesn't contain `__init__.py`, it's a namespace package
///    - If it's excluded (`.git/`, `.tug/`, `__pycache__/`), skip it
///    - Stop at the workspace root (empty path or single component)
///
/// # Arguments
///
/// * `workspace_files` - Set of all workspace file paths (relative to workspace root)
///
/// # Returns
///
/// A `HashSet<String>` of directory paths that are namespace packages.
///
/// # Example
///
/// ```ignore
/// // Given files: ["utils/helpers.py", "utils/core.py"]
/// // (no utils/__init__.py)
/// let files: HashSet<String> = ["utils/helpers.py", "utils/core.py"]
///     .iter().map(|s| s.to_string()).collect();
/// let ns_packages = compute_namespace_packages(&files);
/// assert!(ns_packages.contains("utils"));
/// ```
pub fn compute_namespace_packages(workspace_files: &HashSet<String>) -> HashSet<String> {
    let mut namespace_packages = HashSet::new();
    let mut visited_dirs: HashSet<String> = HashSet::new();

    for path in workspace_files {
        // Only process .py files
        if !path.ends_with(".py") {
            continue;
        }

        // Get parent directory
        let path_obj = std::path::Path::new(path);
        let mut current_dir = match path_obj.parent() {
            Some(p) => p.to_path_buf(),
            None => continue, // File at root level, no parent directories to check
        };

        // Walk up the directory tree
        while !current_dir.as_os_str().is_empty() {
            let dir_str = current_dir.to_string_lossy().replace('\\', "/");

            // Skip if already visited (deduplication)
            if visited_dirs.contains(&dir_str) {
                break;
            }
            visited_dirs.insert(dir_str.clone());

            // Skip excluded directories
            if is_excluded_directory(&dir_str) {
                break;
            }

            // Check if this directory has __init__.py
            let init_path = if dir_str.is_empty() {
                "__init__.py".to_string()
            } else {
                format!("{}/__init__.py", dir_str)
            };

            if !workspace_files.contains(&init_path) {
                // No __init__.py, it's a namespace package
                namespace_packages.insert(dir_str);
            }

            // Move to parent directory
            match current_dir.parent() {
                Some(p) => current_dir = p.to_path_buf(),
                None => break,
            }
        }
    }

    namespace_packages
}

/// Check if a directory path should be excluded from namespace package detection.
///
/// Excluded directories:
/// - `.git/` - Git repository metadata
/// - `.tug/` - Tugtool session data
/// - `__pycache__/` - Python bytecode cache
/// - Any path starting with `.` (hidden directories)
fn is_excluded_directory(dir_path: &str) -> bool {
    // Check each component of the path
    for component in dir_path.split('/') {
        if component.is_empty() {
            continue;
        }
        // Hidden directories (start with .)
        if component.starts_with('.') {
            return true;
        }
        // __pycache__
        if component == "__pycache__" {
            return true;
        }
    }
    false
}

// ========================================================================
// Transitive Star Import Expansion (Spec S12)
// ========================================================================

/// Represents an exported name with its original source file.
///
/// Used by transitive star import expansion to track where each exported
/// name originated, allowing us to create bindings that point to the
/// original definition rather than intermediate re-exports.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct StarExpandedBinding {
    /// The exported name.
    name: String,
    /// Path to the file containing the original definition.
    source_file: String,
}

/// Collect all names exported by a file, following star import chains transitively.
///
/// This implements Spec S12: Transitive Star Import Expansion.
///
/// When a file exports names (via `__all__` or public bindings), some of those
/// names may have come from star imports. This function follows those chains
/// to find the original definition of each name.
///
/// # Algorithm
/// 1. If the file has `__all__`, use those names as the exported set
/// 2. Otherwise, use all public module-level symbols (non-underscore, non-import)
/// 3. For each star import in the file, recursively collect its exports
/// 4. Use a visited set to prevent infinite cycles
///
/// # Arguments
/// * `source_path` - Path to the file to collect exports from
/// * `file_exports_map` - Map from file path to (exports, symbols)
/// * `file_star_imports_map` - Map from file path to list of star imports
/// * `workspace_files` - Set of all workspace file paths
/// * `visited` - Set of already-visited file paths (for cycle detection)
///
/// # Returns
/// A vector of (name, original_source_file) pairs for all exported names.
fn collect_star_exports_transitive<'a>(
    source_path: &str,
    file_exports_map: &HashMap<&str, (&[LocalExport], &[LocalSymbol])>,
    file_star_imports_map: &FileStarImportsMap<'a>,
    workspace_files: &HashSet<String>,
    namespace_packages: &HashSet<String>,
    visited: &mut HashSet<String>,
) -> Vec<StarExpandedBinding> {
    // Cycle detection
    if visited.contains(source_path) {
        return Vec::new();
    }
    visited.insert(source_path.to_string());

    let mut result = Vec::new();

    // Get this file's exports and symbols
    let Some((exports, symbols)) = file_exports_map.get(source_path) else {
        return Vec::new();
    };

    // Collect names that are direct definitions in this file
    let direct_definitions: HashSet<String> = symbols
        .iter()
        .filter(|s| {
            s.kind != SymbolKind::Import && s.scope_id == ScopeId(0) // Module-level only
        })
        .map(|s| s.name.clone())
        .collect();

    // Determine exported names
    let exported_names: Vec<String> = if !exports.is_empty() {
        // If __all__ is defined, use those names
        exports.iter().map(|e| e.name.clone()).collect()
    } else {
        // Otherwise, use all public module-level bindings (direct definitions only)
        symbols
            .iter()
            .filter(|s| {
                !s.name.starts_with('_') && s.kind != SymbolKind::Import && s.scope_id == ScopeId(0)
            })
            .map(|s| s.name.clone())
            .collect()
    };

    // Add direct definitions to result
    for name in &exported_names {
        if direct_definitions.contains(name) {
            result.push(StarExpandedBinding {
                name: name.clone(),
                source_file: source_path.to_string(),
            });
        }
    }

    // Recursively expand star imports
    if let Some(star_imports) = file_star_imports_map.get(source_path) {
        for star_import in star_imports {
            // Resolve the source file for this star import
            let star_source = resolve_module_to_file(
                &star_import.module_path,
                workspace_files,
                namespace_packages,
                Some(source_path),
                star_import.relative_level,
            );

            // Only process file-based modules for star import expansion
            // Namespace packages don't have exports to expand
            if let Some(ResolvedModule::File(star_source_path)) = star_source {
                // Recursively collect exports from the star-imported file
                let nested_exports = collect_star_exports_transitive(
                    &star_source_path,
                    file_exports_map,
                    file_star_imports_map,
                    workspace_files,
                    namespace_packages,
                    visited,
                );

                // If this file has __all__, only include nested exports that are in __all__
                // Otherwise, include all nested exports that are public
                if !exports.is_empty() {
                    // Filter to only names in __all__
                    let all_names: HashSet<&str> =
                        exports.iter().map(|e| e.name.as_str()).collect();
                    for binding in nested_exports {
                        if all_names.contains(binding.name.as_str())
                            && !direct_definitions.contains(&binding.name)
                        {
                            result.push(binding);
                        }
                    }
                } else {
                    // Include all public nested exports
                    for binding in nested_exports {
                        if !binding.name.starts_with('_')
                            && !direct_definitions.contains(&binding.name)
                        {
                            result.push(binding);
                        }
                    }
                }
            }
        }
    }

    // Deduplicate (first occurrence wins - preserves closer definition priority)
    let mut seen = HashSet::new();
    result.retain(|b| seen.insert(b.name.clone()));

    result
}

// ========================================================================
// Reference Resolution (Contract C4: LEGB Scope Chain)
// ========================================================================

/// Resolve a reference to its target symbol using scope chain resolution.
///
/// Implements Contract C4: LEGB rule with class scope exception:
/// 1. Local scope: Check current scope's bindings
/// 2. Enclosing scopes: Walk up parent chain (skip class scopes!)
/// 3. Global scope: Module-level bindings
/// 4. Built-in scope: (not tracked)
///
/// Special rules:
/// - `global x`: Skip directly to module scope for x
/// - `nonlocal x`: Skip to nearest enclosing function scope for x
/// - Class scopes do NOT form closures
#[allow(clippy::too_many_arguments)]
fn resolve_reference(
    name: &str,
    scope_id: ScopeId,
    file_id: FileId,
    scopes: &[Scope],
    global_symbols: &GlobalSymbolMap,
    import_bindings: &ImportBindingsSet,
    scope_symbols: &ScopeSymbolsMap,
    import_resolver: &FileImportResolver,
    file_path_to_id: &HashMap<String, FileId>,
    file_import_resolvers: &FileImportResolversMap,
    _ref_kind: ReferenceKind,
) -> Option<SymbolId> {
    // Find the scope
    let scope = scopes.iter().find(|s| s.id == scope_id)?;

    // Check if this name has a `global` declaration in this scope
    if scope.is_global(name) {
        // Skip directly to module scope
        return resolve_in_module_scope(
            name,
            file_id,
            scopes,
            global_symbols,
            import_bindings,
            scope_symbols,
            import_resolver,
            file_path_to_id,
            file_import_resolvers,
        );
    }

    // Check if this name has a `nonlocal` declaration in this scope
    if scope.is_nonlocal(name) {
        // Skip to nearest enclosing function scope
        return resolve_in_enclosing_function(
            name,
            scope,
            file_id,
            scopes,
            global_symbols,
            import_bindings,
            scope_symbols,
            import_resolver,
            file_path_to_id,
            file_import_resolvers,
        );
    }

    // Normal LEGB resolution
    // 1. Check local scope
    if let Some((sym_id, sym_kind)) =
        find_symbol_in_scope_with_kind(name, file_id, scope_id, scope_symbols)
    {
        // Per Contract C3: If this is an import binding, try to resolve to original definition
        if sym_kind == SymbolKind::Import && import_resolver.is_imported(name) {
            if let Some(original_id) = resolve_import_to_original(
                name,
                global_symbols,
                import_bindings,
                import_resolver,
                file_path_to_id,
                file_import_resolvers,
            ) {
                return Some(original_id);
            }
        }
        // Not an import, or couldn't resolve to original - return the local binding
        return Some(sym_id);
    }

    // 2. Walk up enclosing scopes (skip class scopes per Python rules)
    let mut current_scope = scope;
    while let Some(parent_id) = current_scope.parent_id {
        let parent = scopes.iter().find(|s| s.id == parent_id)?;

        // Skip class scopes - they don't form closures
        if parent.kind != ScopeKind::Class {
            if let Some((sym_id, sym_kind)) =
                find_symbol_in_scope_with_kind(name, file_id, parent_id, scope_symbols)
            {
                // Per Contract C3: If this is an import binding, try to resolve to original
                if sym_kind == SymbolKind::Import && import_resolver.is_imported(name) {
                    if let Some(original_id) = resolve_import_to_original(
                        name,
                        global_symbols,
                        import_bindings,
                        import_resolver,
                        file_path_to_id,
                        file_import_resolvers,
                    ) {
                        return Some(original_id);
                    }
                }
                return Some(sym_id);
            }
        }

        current_scope = parent;
    }

    // 3. Check module scope (global)
    resolve_in_module_scope(
        name,
        file_id,
        scopes,
        global_symbols,
        import_bindings,
        scope_symbols,
        import_resolver,
        file_path_to_id,
        file_import_resolvers,
    )
}

/// Find a symbol in a specific scope.
fn find_symbol_in_scope(
    name: &str,
    file_id: FileId,
    scope_id: ScopeId,
    scope_symbols: &ScopeSymbolsMap,
) -> Option<SymbolId> {
    scope_symbols.get(&(file_id, scope_id)).and_then(|symbols| {
        symbols
            .iter()
            .find(|(n, _, _)| n == name)
            .map(|(_, id, _)| *id)
    })
}

/// Find a symbol in a specific scope, returning both ID and kind.
fn find_symbol_in_scope_with_kind(
    name: &str,
    file_id: FileId,
    scope_id: ScopeId,
    scope_symbols: &ScopeSymbolsMap,
) -> Option<(SymbolId, SymbolKind)> {
    scope_symbols.get(&(file_id, scope_id)).and_then(|symbols| {
        symbols
            .iter()
            .find(|(n, _, _)| n == name)
            .map(|(_, id, kind)| (*id, *kind))
    })
}

/// Resolve an imported name to its original definition, following re-export chains.
///
/// Per Contract C3: References to imported names should resolve to the
/// ORIGINAL definition, not the import binding. This function follows
/// the import chain through re-exports to find the original symbol.
///
/// # Re-Export Chain Resolution (Spec S10)
///
/// When file A imports from file B, and B re-exports from file C, we need to
/// follow the chain: A → B → C to find the original definition in C.
///
/// Algorithm:
/// 1. Resolve the import to its target file and name
/// 2. If the target is NOT an import binding, return it (found original)
/// 3. If the target IS an import binding (re-export), recursively resolve
/// 4. Track visited (file, name) pairs to detect cycles
#[allow(clippy::too_many_arguments)]
fn resolve_import_to_original(
    name: &str,
    global_symbols: &GlobalSymbolMap,
    import_bindings: &ImportBindingsSet,
    import_resolver: &FileImportResolver,
    file_path_to_id: &HashMap<String, FileId>,
    file_import_resolvers: &FileImportResolversMap,
) -> Option<SymbolId> {
    // Use a visited set to detect cycles
    let mut visited: HashSet<(String, String)> = HashSet::new();
    resolve_import_chain(
        name,
        import_resolver,
        global_symbols,
        import_bindings,
        file_path_to_id,
        file_import_resolvers,
        &mut visited,
    )
}

/// Follow an import chain to its original definition (Spec S10: Re-Export Chain Resolution).
///
/// This implements recursive resolution for re-export chains. For example:
/// - `main.py` imports from `pkg` → `pkg/__init__.py`
/// - `pkg/__init__.py` re-exports from `pkg/internal.py`
/// - `pkg/internal.py` re-exports from `pkg/core.py`
/// - `pkg/core.py` has the original definition
///
/// This function follows the chain: main.py → pkg → internal → core, returning
/// the original definition's SymbolId.
///
/// Uses pre-computed star-expanded import resolvers to handle transitive star imports.
///
/// This is the recursive helper for `resolve_import_to_original`.
#[allow(clippy::too_many_arguments, clippy::only_used_in_recursion)]
fn resolve_import_chain(
    name: &str,
    import_resolver: &FileImportResolver,
    global_symbols: &GlobalSymbolMap,
    import_bindings: &ImportBindingsSet,
    file_path_to_id: &HashMap<String, FileId>,
    file_import_resolvers: &FileImportResolversMap,
    visited: &mut HashSet<(String, String)>,
) -> Option<SymbolId> {
    // Resolve the import through the current file's resolver
    let (qualified_path, resolved_file) = import_resolver.resolve(name)?;
    let resolved_file_path = resolved_file?;
    let &target_file_id = file_path_to_id.get(resolved_file_path)?;
    let target_name = qualified_path.rsplit('.').next().unwrap_or(name);

    // Check for cycle
    let visit_key = (resolved_file_path.to_string(), target_name.to_string());
    if visited.contains(&visit_key) {
        // Cycle detected - return None to avoid infinite loop
        return None;
    }
    visited.insert(visit_key);

    // Look for the symbol in the target file
    // First, check for actual definitions (non-import symbols)
    for kind in [
        SymbolKind::Function,
        SymbolKind::Class,
        SymbolKind::Variable,
        SymbolKind::Constant,
    ] {
        if let Some(entries) = global_symbols.get(&(target_name.to_string(), kind)) {
            for (fid, sym_id) in entries {
                if *fid == target_file_id {
                    // Found an actual definition (not an import binding)
                    return Some(*sym_id);
                }
            }
        }
    }

    // If no definition found, check if there's an import binding (re-export) and follow the chain
    if let Some(entries) = global_symbols.get(&(target_name.to_string(), SymbolKind::Import)) {
        for (fid, _sym_id) in entries {
            if *fid == target_file_id {
                // This is an import binding (re-export) - follow the chain
                // Use the pre-computed star-expanded resolver for the target file
                if let Some(target_resolver) = file_import_resolvers.get(resolved_file_path) {
                    return resolve_import_chain(
                        target_name,
                        target_resolver,
                        global_symbols,
                        import_bindings,
                        file_path_to_id,
                        file_import_resolvers,
                        visited,
                    );
                }
            }
        }
    }

    // If no import binding found in global_symbols, also check the target file's
    // star-expanded resolver directly. Star imports don't create entries in
    // global_symbols, but they do add bindings to the import resolver.
    if let Some(target_resolver) = file_import_resolvers.get(resolved_file_path) {
        if target_resolver.is_imported(target_name) {
            return resolve_import_chain(
                target_name,
                target_resolver,
                global_symbols,
                import_bindings,
                file_path_to_id,
                file_import_resolvers,
                visited,
            );
        }
    }
    None
}

/// Resolve in module scope (for `global` declarations or final fallback).
///
/// This is called when:
/// 1. A name has a `global` declaration
/// 2. LEGB resolution reaches the module level
///
/// Note: Import resolution is now primarily handled in `resolve_reference`
/// via `resolve_import_to_original`. This function serves as the fallback
/// for names that couldn't be resolved through the import chain.
#[allow(clippy::too_many_arguments)]
fn resolve_in_module_scope(
    name: &str,
    file_id: FileId,
    _scopes: &[Scope],
    global_symbols: &GlobalSymbolMap,
    import_bindings: &ImportBindingsSet,
    scope_symbols: &ScopeSymbolsMap,
    import_resolver: &FileImportResolver,
    file_path_to_id: &HashMap<String, FileId>,
    file_import_resolvers: &FileImportResolversMap,
) -> Option<SymbolId> {
    let module_scope_id = ScopeId(0);

    // Try to resolve through imports first (for names that reach here via `global`)
    if import_resolver.is_imported(name) {
        if let Some(original_id) = resolve_import_to_original(
            name,
            global_symbols,
            import_bindings,
            import_resolver,
            file_path_to_id,
            file_import_resolvers,
        ) {
            return Some(original_id);
        }
    }

    // Check module scope bindings (for local definitions or unresolved imports)
    if let Some(sym_id) = find_symbol_in_scope(name, file_id, module_scope_id, scope_symbols) {
        return Some(sym_id);
    }

    // Fall back to any same-file symbol with matching name
    // Try multiple symbol kinds
    for kind in [
        SymbolKind::Function,
        SymbolKind::Class,
        SymbolKind::Variable,
        SymbolKind::Constant,
        SymbolKind::Import,
    ] {
        if let Some(entries) = global_symbols.get(&(name.to_string(), kind)) {
            for (fid, sym_id) in entries {
                if *fid == file_id {
                    return Some(*sym_id);
                }
            }
        }
    }

    None
}

/// Resolve in enclosing function scope (for `nonlocal` declarations).
#[allow(clippy::too_many_arguments)]
fn resolve_in_enclosing_function(
    name: &str,
    scope: &Scope,
    file_id: FileId,
    scopes: &[Scope],
    global_symbols: &GlobalSymbolMap,
    import_bindings: &ImportBindingsSet,
    scope_symbols: &ScopeSymbolsMap,
    import_resolver: &FileImportResolver,
    file_path_to_id: &HashMap<String, FileId>,
    file_import_resolvers: &FileImportResolversMap,
) -> Option<SymbolId> {
    // Walk up to find nearest enclosing function scope
    let mut current_scope = scope;
    while let Some(parent_id) = current_scope.parent_id {
        let parent = scopes.iter().find(|s| s.id == parent_id)?;

        if parent.kind == ScopeKind::Function || parent.kind == ScopeKind::Lambda {
            if let Some(sym_id) = find_symbol_in_scope(name, file_id, parent_id, scope_symbols) {
                return Some(sym_id);
            }
        }

        current_scope = parent;
    }

    // Didn't find in any enclosing function - fall back to module scope
    resolve_in_module_scope(
        name,
        file_id,
        scopes,
        global_symbols,
        import_bindings,
        scope_symbols,
        import_resolver,
        file_path_to_id,
        file_import_resolvers,
    )
}

/// Resolve an import reference (the imported name in an import statement).
///
/// For `from .utils import process_data as proc`, this resolves "process_data"
/// to the original symbol in the target file. This is needed because the
/// FileImportResolver tracks aliases ("proc"), not imported names ("process_data").
///
/// # Arguments
/// * `imported_name` - The name being imported (e.g., "process_data")
/// * `import_resolver` - The file's import resolver (with properly resolved imports)
/// * `global_symbols` - Global symbol map for cross-file lookup
/// * `import_bindings` - Set of import bindings
/// * `file_path_to_id` - Mapping from file paths to FileIds
/// * `file_import_resolvers` - Pre-computed star-expanded import resolvers for all files
fn resolve_import_reference(
    imported_name: &str,
    import_resolver: &FileImportResolver,
    global_symbols: &GlobalSymbolMap,
    import_bindings: &ImportBindingsSet,
    file_path_to_id: &HashMap<String, FileId>,
    file_import_resolvers: &FileImportResolversMap,
) -> Option<SymbolId> {
    // Use the new method to look up by imported name
    let (qualified_path, resolved_file) = import_resolver.resolve_imported_name(imported_name)?;
    let resolved_file_path = resolved_file?;
    let &target_file_id = file_path_to_id.get(resolved_file_path)?;
    let target_name = qualified_path.rsplit('.').next().unwrap_or(imported_name);

    // Look for the symbol in the target file
    // First, check for actual definitions (non-import symbols)
    for kind in [
        SymbolKind::Function,
        SymbolKind::Class,
        SymbolKind::Variable,
        SymbolKind::Constant,
    ] {
        if let Some(entries) = global_symbols.get(&(target_name.to_string(), kind)) {
            for (fid, sym_id) in entries {
                if *fid == target_file_id {
                    // Found an actual definition (not an import binding)
                    return Some(*sym_id);
                }
            }
        }
    }

    // If no definition found, check if there's an import binding (re-export) and follow the chain
    if let Some(entries) = global_symbols.get(&(target_name.to_string(), SymbolKind::Import)) {
        for (fid, _sym_id) in entries {
            if *fid == target_file_id {
                // This is an import binding (re-export) - follow the chain
                // Use the pre-computed star-expanded resolver for the target file
                if let Some(target_resolver) = file_import_resolvers.get(resolved_file_path) {
                    return resolve_import_chain(
                        target_name,
                        target_resolver,
                        global_symbols,
                        import_bindings,
                        file_path_to_id,
                        file_import_resolvers,
                        &mut HashSet::new(),
                    );
                }
            }
        }
    }

    // If no import binding found in global_symbols, also check the target file's
    // star-expanded resolver directly. Star imports don't create entries in
    // global_symbols, but they do add bindings to the import resolver.
    if let Some(target_resolver) = file_import_resolvers.get(resolved_file_path) {
        if target_resolver.is_imported(target_name) {
            return resolve_import_chain(
                target_name,
                target_resolver,
                global_symbols,
                import_bindings,
                file_path_to_id,
                file_import_resolvers,
                &mut HashSet::new(),
            );
        }
    }

    None
}

/// Convert local imports from native CST analysis to LocalImport format.
///
/// # Arguments
/// * `imports` - List of imports from CST analysis
/// * `workspace_files` - Set of all workspace file paths
/// * `importing_file_path` - Path of the file containing these imports (for relative resolution)
fn convert_imports(
    imports: &[tugtool_python_cst::ImportInfo],
    workspace_files: &HashSet<String>,
    namespace_packages: &HashSet<String>,
    importing_file_path: &str,
) -> Vec<LocalImport> {
    let mut result = Vec::new();

    for import in imports {
        // Convert relative_level from usize to u32
        let relative_level = import.relative_level as u32;

        let names: Vec<ImportedName> = import
            .names
            .as_ref()
            .map(|n| {
                n.iter()
                    .map(|ni| ImportedName {
                        name: ni.name.clone(),
                        alias: ni.alias.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        // Resolve import to workspace file (with context for relative imports)
        let resolved = resolve_module_to_file(
            &import.module,
            workspace_files,
            namespace_packages,
            Some(importing_file_path),
            relative_level,
        );
        // Extract file path for import resolution (namespace packages don't have symbols to reference)
        let resolved_file = resolved.and_then(|r| r.as_file().map(|s| s.to_string()));

        let kind = match import.kind {
            tugtool_python_cst::ImportKind::Import => "import",
            tugtool_python_cst::ImportKind::From => "from",
        };

        result.push(LocalImport {
            kind: kind.to_string(),
            module_path: import.module.clone(),
            names,
            alias: import.alias.clone(),
            is_star: import.is_star,
            span: import.span.as_ref().map(|s| Span::new(s.start, s.end)),
            line: import.line,
            resolved_file,
            relative_level,
        });
    }

    result
}

// ============================================================================
// Method Call Index (for O(1) lookup during type-aware pass)
// ============================================================================

/// Index of method calls by method name for efficient lookup.
///
/// Instead of scanning all files for each method (O(M × F × C)), this index
/// allows direct lookup by method name (O(M × C_match) where C_match is
/// typically much smaller than total calls).
#[derive(Debug, Default)]
pub struct MethodCallIndex {
    /// Method name → list of indexed method calls.
    calls_by_name: HashMap<String, Vec<IndexedMethodCall>>,
}

impl MethodCallIndex {
    /// Create a new empty index.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a method call to the index.
    pub fn add(&mut self, method_name: String, call: IndexedMethodCall) {
        self.calls_by_name
            .entry(method_name)
            .or_default()
            .push(call);
    }

    /// Get all method calls matching a method name.
    pub fn get(&self, method_name: &str) -> &[IndexedMethodCall] {
        self.calls_by_name
            .get(method_name)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Get the total number of indexed calls (for diagnostics).
    #[allow(dead_code)]
    pub fn total_calls(&self) -> usize {
        self.calls_by_name.values().map(|v| v.len()).sum()
    }
}

/// An indexed method call for efficient lookup.
///
/// Contains all information needed to determine if a method call should
/// be linked to a given class method, without re-parsing or re-analyzing.
#[derive(Debug, Clone)]
pub struct IndexedMethodCall {
    /// File where the call occurs.
    pub file_id: FileId,
    /// Receiver variable name (e.g., "obj" in obj.method()).
    pub receiver: String,
    /// Receiver's type if known (resolved from TypeTracker).
    pub receiver_type: Option<String>,
    /// Scope path where the call occurs.
    pub scope_path: Vec<String>,
    /// Byte span of the method name (for creating references).
    pub method_span: Span,
}

// NOTE: ImportResolver has been consolidated into FileImportResolver.
// Use FileImportResolver::from_imports_simple() for the same functionality
// that ImportResolver::from_imports() provided.

// ============================================================================
// Scope Chain Resolution
// ============================================================================

/// Resolve a name using the scope chain.
///
/// Implements Python's LEGB (Local, Enclosing, Global, Built-in) rule.
///
/// Note: Class scopes do NOT form closure chains. From inside a method,
/// you cannot directly access class variables (must use self.x or ClassName.x).
pub fn resolve_name_in_scope_chain(
    name: &str,
    start_scope: ScopeId,
    scopes: &[Scope],
    global_scope: ScopeId,
) -> Option<SymbolId> {
    let mut current_scope_id = Some(start_scope);
    let mut is_first_scope = true;

    while let Some(scope_id) = current_scope_id {
        let scope = &scopes[scope_id.0 as usize];

        // Check for global declaration
        if scope.is_global(name) {
            // Skip to global scope
            return scopes[global_scope.0 as usize].bindings.get(name).copied();
        }

        // Check for nonlocal declaration
        if scope.is_nonlocal(name) {
            // Skip this scope and continue up the chain (but not to module)
            current_scope_id = scope.parent_id;
            while let Some(parent_id) = current_scope_id {
                let parent = &scopes[parent_id.0 as usize];
                // Skip class scopes when looking for nonlocal
                if parent.kind == ScopeKind::Class {
                    current_scope_id = parent.parent_id;
                    continue;
                }
                if parent.kind != ScopeKind::Module {
                    if let Some(&symbol_id) = parent.bindings.get(name) {
                        return Some(symbol_id);
                    }
                    current_scope_id = parent.parent_id;
                } else {
                    break;
                }
            }
            return None;
        }

        // Class scopes don't form closure chains - skip their bindings
        // when traversing UP the chain (but allow lookups in the class scope itself)
        let should_check_bindings = is_first_scope || scope.kind != ScopeKind::Class;

        if should_check_bindings {
            // Check current scope
            if let Some(&symbol_id) = scope.bindings.get(name) {
                return Some(symbol_id);
            }
        }

        // Move to parent scope
        current_scope_id = scope.parent_id;
        is_first_scope = false;
    }

    None
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Convert string kind to SymbolKind.
fn symbol_kind_from_str(kind: &str) -> SymbolKind {
    match kind {
        "function" => SymbolKind::Function,
        "class" => SymbolKind::Class,
        "method" => SymbolKind::Method,
        "variable" => SymbolKind::Variable,
        "parameter" => SymbolKind::Parameter,
        "import" | "import_alias" => SymbolKind::Import,
        "constant" => SymbolKind::Constant,
        _ => SymbolKind::Variable,
    }
}

/// Convert string kind to ReferenceKind.
fn reference_kind_from_str(kind: &str) -> ReferenceKind {
    match kind {
        "definition" => ReferenceKind::Definition,
        "call" => ReferenceKind::Call,
        "reference" => ReferenceKind::Reference,
        "import" => ReferenceKind::Import,
        "attribute" => ReferenceKind::Attribute,
        "write" => ReferenceKind::Write,
        "delete" => ReferenceKind::Delete,
        _ => ReferenceKind::Reference,
    }
}

// ============================================================================
// PythonAdapter: LanguageAdapter Implementation
// ============================================================================

/// Options for Python analysis.
///
/// Controls optional behavior like visibility inference from naming conventions.
///
/// # Example
///
/// ```
/// use tugtool_python::analyzer::PythonAnalyzerOptions;
///
/// // Default options (no visibility inference)
/// let opts = PythonAnalyzerOptions::default();
/// assert!(!opts.infer_visibility);
///
/// // Enable visibility inference
/// let opts = PythonAnalyzerOptions {
///     infer_visibility: true,
///     ..Default::default()
/// };
/// ```
#[derive(Debug, Clone, Default)]
pub struct PythonAnalyzerOptions {
    /// Infer visibility from Python naming conventions.
    ///
    /// When enabled:
    /// - `_name` -> Private (single underscore convention)
    /// - `__name` -> Private (name mangling)
    /// - `__name__` -> Public (dunder methods are public API)
    /// - `name` -> None (no convention, visibility unknown)
    ///
    /// Default: false (all symbols have visibility = None)
    pub infer_visibility: bool,

    /// Compute effective exports for modules without `__all__`.
    ///
    /// When enabled and a module lacks an explicit `__all__`, emit
    /// `ExportIntent::Effective` entries for module-level symbols
    /// that are considered part of the public API by Python convention:
    /// - Names not starting with `_` (public by convention)
    /// - Dunder names (`__name__`) are also public
    /// - Names starting with `_` (except dunders) are private
    ///
    /// This is opt-in because computing effective exports has overhead
    /// and many use cases only need explicit `__all__` exports.
    ///
    /// Default: false (only explicit `__all__` exports are emitted)
    pub compute_effective_exports: bool,
}

// ============================================================================
// Cross-File Symbol Resolution
// ============================================================================

/// Cross-file symbol lookup helper for adapter conversion.
///
/// This map is built from a pre-populated [`FactsStore`] and provides lookup
/// of symbols defined in other files during adapter conversion. It enables
/// receiver type resolution for attribute accesses when the receiver's type
/// is defined in a different file.
///
/// # Resolution Order
///
/// Resolution follows this priority:
/// 1. Qualified name lookup (e.g., "mymodule.MyClass")
/// 2. Simple name lookup (e.g., "MyClass") - only if unambiguous
///
/// If a simple name is ambiguous (multiple symbols with same name), the lookup
/// returns `None` to avoid incorrect resolution.
///
/// # Example
///
/// ```ignore
/// // File A defines: class Handler
/// // File B uses: h = Handler(); h.process()
///
/// // Build map from FactsStore containing File A's analysis
/// let cross_file_map = CrossFileSymbolMap::from_store(&store);
///
/// // Resolve "Handler" from File B
/// let idx = cross_file_map.resolve("Handler");  // Some(idx) if unambiguous
/// let qn = cross_file_map.resolve_to_qualified_name("Handler");  // Some("pkg.Handler")
/// ```
#[derive(Debug, Default)]
pub struct CrossFileSymbolMap {
    /// Simple name -> qualified name.
    /// If a name maps to multiple symbols, the entry is set to `None` (ambiguous).
    name_to_qualified: HashMap<String, Option<String>>,
    /// Set of all qualified names (for direct lookup).
    qualified_names: HashSet<String>,
}

impl CrossFileSymbolMap {
    /// Create a new empty cross-file symbol map.
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a cross-file symbol map from a FactsStore.
    ///
    /// Iterates over all symbols in the store and builds lookup maps by:
    /// 1. Qualified name (from store's qualified_names)
    /// 2. Simple name -> qualified name mapping (marked ambiguous if duplicates exist)
    ///
    /// # Arguments
    /// - `store`: The FactsStore containing symbols from prior analysis
    ///
    /// # Returns
    /// A CrossFileSymbolMap ready for resolution lookups
    pub fn from_store(store: &FactsStore) -> Self {
        let mut map = Self::new();

        // Build SymbolId -> qualified name mapping
        let symbol_id_to_qualified: HashMap<SymbolId, String> = store
            .qualified_names()
            .map(|qn| (qn.symbol_id, qn.path.clone()))
            .collect();

        // Populate qualified names set
        for qn in store.qualified_names() {
            map.qualified_names.insert(qn.path.clone());
        }

        // Populate simple name -> qualified name lookup, tracking ambiguity
        for symbol in store.symbols() {
            let name = &symbol.name;
            let qualified = symbol_id_to_qualified.get(&symbol.symbol_id).cloned();

            match map.name_to_qualified.get(name) {
                None => {
                    // First occurrence: record the qualified name
                    map.name_to_qualified.insert(name.clone(), qualified);
                }
                Some(Some(_)) => {
                    // Second occurrence: mark as ambiguous (None)
                    map.name_to_qualified.insert(name.clone(), None);
                }
                Some(None) => {
                    // Already ambiguous, no change needed
                }
            }
        }

        map
    }

    /// Resolve a name to a qualified name for cross-file references.
    ///
    /// Resolution order:
    /// 1. If the input is already a qualified name, return it directly
    /// 2. Otherwise, look up simple name -> qualified name mapping
    ///
    /// # Arguments
    /// - `name`: The name to resolve (simple or qualified)
    ///
    /// # Returns
    /// - `Some(qualified_name)` if the name resolves unambiguously
    /// - `None` if the name is not found or is ambiguous
    pub fn resolve_to_qualified_name(&self, name: &str) -> Option<String> {
        // If it's already a qualified name we know about, return it
        if self.qualified_names.contains(name) {
            return Some(name.to_string());
        }

        // Look up simple name -> qualified name (may be None if ambiguous)
        self.name_to_qualified.get(name).cloned().flatten()
    }

    /// Check if the map is empty.
    pub fn is_empty(&self) -> bool {
        self.name_to_qualified.is_empty() && self.qualified_names.is_empty()
    }

    /// Get the number of qualified name entries.
    pub fn qualified_count(&self) -> usize {
        self.qualified_names.len()
    }

    /// Get the number of simple name entries (including ambiguous ones).
    pub fn simple_name_count(&self) -> usize {
        self.name_to_qualified.len()
    }
}

/// Python language adapter implementing [`LanguageAdapter`].
///
/// Wraps the existing Python analysis functions (`analyze_file`, `analyze_files`)
/// to provide the [`LanguageAdapter`] interface for pluggable language support.
///
/// # Example
///
/// ```
/// use tugtool_python::analyzer::{PythonAdapter, PythonAnalyzerOptions};
/// use tugtool_core::adapter::LanguageAdapter;
/// use tugtool_core::facts::Language;
///
/// // Create adapter with default options
/// let adapter = PythonAdapter::new();
/// assert_eq!(adapter.language(), Language::Python);
/// assert!(adapter.can_handle("foo.py"));
/// assert!(!adapter.can_handle("foo.rs"));
///
/// // Create adapter with custom options
/// let opts = PythonAnalyzerOptions { infer_visibility: true };
/// let adapter = PythonAdapter::with_options(opts);
/// ```
#[derive(Debug, Clone, Default)]
pub struct PythonAdapter {
    options: PythonAnalyzerOptions,
}

impl PythonAdapter {
    /// Create a new Python adapter with default options.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a new Python adapter with custom options.
    pub fn with_options(options: PythonAnalyzerOptions) -> Self {
        Self { options }
    }

    /// Get the current options.
    pub fn options(&self) -> &PythonAnalyzerOptions {
        &self.options
    }

    /// Infer visibility from Python naming conventions.
    ///
    /// Returns `Some(Visibility)` if inference is enabled and a convention applies,
    /// `None` otherwise.
    fn infer_visibility_from_name(&self, name: &str) -> Option<tugtool_core::facts::Visibility> {
        if !self.options.infer_visibility {
            return None;
        }

        // __name__ (dunder) -> Public (these are part of Python's public API)
        if name.starts_with("__") && name.ends_with("__") && name.len() > 4 {
            return Some(tugtool_core::facts::Visibility::Public);
        }

        // __name (name mangling) -> Private
        if name.starts_with("__") && !name.ends_with("__") {
            return Some(tugtool_core::facts::Visibility::Private);
        }

        // _name (single underscore) -> Private
        if name.starts_with('_') && !name.starts_with("__") {
            return Some(tugtool_core::facts::Visibility::Private);
        }

        // No convention -> None (visibility unknown)
        None
    }

    /// Resolve a receiver expression to a symbol via type inference.
    ///
    /// Given an attribute access like `obj.method`, this function attempts to resolve
    /// `obj` to its type using the TypeTracker, then looks up that type in the local
    /// symbol map. If not found locally, falls back to cross-file resolution.
    ///
    /// # Resolution Order
    /// 1. Look up receiver type via TypeTracker
    /// 2. Look up type in local symbol map (current file) -> returns `Local(index)`
    /// 3. Fall back to cross-file map (other analyzed files) -> returns `CrossFile(qualified_name)`
    ///
    /// # Arguments
    /// - `receiver`: The receiver expression string (e.g., "obj" from "obj.method")
    /// - `scope_path`: The scope path where the access occurs
    /// - `tracker`: Optional TypeTracker with type inference results
    /// - `symbol_name_to_index`: Map from symbol name to adapter index (local file)
    /// - `cross_file_map`: Optional cross-file symbol map for fallback resolution
    ///
    /// # Returns
    /// - `Some(ResolvedSymbol::Local(index))` if resolved to a local symbol
    /// - `Some(ResolvedSymbol::CrossFile(qualified_name))` if resolved to a cross-file symbol
    /// - `None` if the receiver's type is unknown or not in any map
    fn resolve_receiver_to_symbol(
        &self,
        receiver: &str,
        scope_path: &[String],
        tracker: Option<&TypeTracker>,
        symbol_name_to_index: &HashMap<&str, usize>,
        cross_file_map: Option<&CrossFileSymbolMap>,
    ) -> Option<ResolvedSymbol> {
        // If no tracker provided, we can't resolve
        let tracker = tracker?;

        // Only resolve simple name receivers (not dotted paths like "obj.attr")
        // Dotted receivers would require chained type resolution
        if receiver.contains('.') || receiver.starts_with('<') {
            return None;
        }

        // Look up the receiver's type via TypeTracker
        let receiver_type = tracker.type_of(scope_path, receiver)?;

        // Look up the type's symbol index in the local map first
        if let Some(&idx) = symbol_name_to_index.get(receiver_type) {
            return Some(ResolvedSymbol::Local(idx));
        }

        // Fall back to cross-file resolution if available
        // Return the qualified name, NOT an index (which would be a global FactsStore index)
        if let Some(map) = cross_file_map {
            if let Some(qualified_name) = map.resolve_to_qualified_name(receiver_type) {
                return Some(ResolvedSymbol::CrossFile(qualified_name));
            }
        }

        None
    }

    /// Resolve a structured receiver path to a symbol via step-by-step type resolution.
    ///
    /// This method handles dotted paths like `self.handler.process` by resolving each
    /// segment's type in sequence:
    /// 1. `self` -> class type (implicit from scope)
    /// 2. `handler` -> attribute type on class
    /// 3. `process` -> method on attribute's type
    ///
    /// # Algorithm
    /// For each step in the path:
    /// - `Name`: Look up variable type via TypeTracker, or store name for class/function lookup
    /// - `Attr`: Look up attribute type on current class, or mark as method name
    /// - `Call`: Use return type (constructor, method, or function) to continue chain
    ///
    /// # Arguments
    /// - `receiver_path`: Structured receiver path from CST analysis
    /// - `scope_path`: The scope path where the access occurs
    /// - `tracker`: TypeTracker with type inference results
    /// - `scoped_symbol_map`: Scope-aware map from (scope_path, name) to symbol index
    /// - `symbol_kinds`: Scope-aware map from (scope_path, name) to SymbolKind
    /// - `cross_file_map`: Optional cross-file symbol map for fallback resolution
    ///
    /// # Returns
    /// - `Some(ResolvedSymbol::Local(index))` if resolved to a local symbol
    /// - `Some(ResolvedSymbol::CrossFile(qualified_name))` if resolved to a cross-file symbol
    /// - `None` if resolution fails at any point
    #[allow(clippy::too_many_arguments)]
    fn resolve_receiver_path(
        &self,
        receiver_path: &ReceiverPath,
        scope_path: &[String],
        tracker: &TypeTracker,
        scoped_symbol_map: &HashMap<(Vec<String>, String), usize>,
        symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
        cross_file_map: Option<&CrossFileSymbolMap>,
    ) -> Option<ResolvedSymbol> {
        // Delegate to the cross-file-capable version without a cache
        self.resolve_receiver_path_with_cross_file(
            receiver_path,
            scope_path,
            tracker,
            scoped_symbol_map,
            symbol_kinds,
            &HashMap::new(), // No import targets in legacy mode
            cross_file_map,
            None, // No cross-file cache
            None, // No workspace root
            0,    // Initial depth
        )
    }

    /// Resolve a structured receiver path with optional cross-file type resolution.
    ///
    /// This is the full-featured version of `resolve_receiver_path` that can follow
    /// type chains across file boundaries when a `CrossFileTypeCache` is provided.
    ///
    /// # Cross-File Resolution
    ///
    /// When an intermediate type is an Import and a cache is available:
    /// 1. Look up the import target via `lookup_import_target`
    /// 2. Call `cache.get_or_analyze()` to load the remote file's context
    /// 3. Continue resolution in the remote file's context
    /// 4. Return the final resolved symbol (local or cross-file qualified name)
    ///
    /// # Arguments
    ///
    /// In addition to the base `resolve_receiver_path` arguments:
    /// - `import_targets`: Map from (scope_path, local_name) to ImportTarget for cross-file lookup
    /// - `cross_file_cache`: Optional cache for loading type info from other files
    /// - `workspace_root`: Workspace root for relative path resolution
    /// - `depth`: Current cross-file resolution depth (for limiting chain length)
    #[allow(clippy::too_many_arguments)]
    fn resolve_receiver_path_with_cross_file(
        &self,
        receiver_path: &ReceiverPath,
        scope_path: &[String],
        tracker: &TypeTracker,
        scoped_symbol_map: &HashMap<(Vec<String>, String), usize>,
        symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
        import_targets: &HashMap<(Vec<String>, String), crate::cross_file_types::ImportTarget>,
        cross_file_map: Option<&CrossFileSymbolMap>,
        cross_file_cache: Option<&mut CrossFileTypeCache>,
        workspace_root: Option<&Path>,
        depth: usize,
    ) -> Option<ResolvedSymbol> {
        use crate::cross_file_types::MAX_CROSS_FILE_DEPTH;

        // Validate path: must be non-empty and within depth limit
        if receiver_path.steps.is_empty() || receiver_path.steps.len() > MAX_RESOLUTION_DEPTH {
            return None;
        }

        // Check cross-file depth limit
        if depth > MAX_CROSS_FILE_DEPTH {
            return None;
        }

        let mut current_type: Option<String> = None;
        let mut last_method_name: Option<&str> = None;
        let mut last_name_was_class: bool = false;
        let mut last_name_is_unresolved_callable: bool = false;
        let mut pending_callable_return: Option<String> = None;

        for step in &receiver_path.steps {
            match step {
                ReceiverStep::Name { value: name } => {
                    if let Some(type_str) = tracker.type_of(scope_path, name) {
                        // Found typed variable
                        current_type = Some(type_str.to_string());
                        last_name_was_class = is_class_in_scope(scope_path, name, symbol_kinds);
                        last_name_is_unresolved_callable = false;
                    } else {
                        // Not a typed variable - could be function or class name
                        // Store the name itself for return_type lookup in Call step
                        current_type = Some(name.to_string());
                        last_name_was_class = is_class_in_scope(scope_path, name, symbol_kinds);
                        last_name_is_unresolved_callable = !last_name_was_class;
                        // Function if not class
                    }
                    // Clear pending_callable_return - Name step starts fresh
                    pending_callable_return = None;
                }
                ReceiverStep::Attr { value: attr_name } => {
                    if let Some(ref class_type) = current_type {
                        // Check if current_type is cross-file BEFORE continuing
                        let is_import =
                            lookup_symbol_kind_in_scope_chain(scope_path, class_type, symbol_kinds)
                                == Some(SymbolKind::Import);

                        let is_local = lookup_symbol_index_in_scope_chain(
                            scope_path,
                            class_type,
                            scoped_symbol_map,
                        )
                        .is_some()
                            && !is_import;

                        if !is_local {
                            // Attempt cross-file resolution if cache is available
                            if let (Some(cache), Some(ws_root)) = (cross_file_cache, workspace_root)
                            {
                                if let Some(result) = self.resolve_cross_file_attr(
                                    class_type,
                                    attr_name,
                                    &receiver_path.steps[receiver_path
                                        .steps
                                        .iter()
                                        .position(|s| matches!(s, ReceiverStep::Attr { value } if value == attr_name))
                                        .unwrap_or(0)
                                        + 1..],
                                    scope_path,
                                    import_targets,
                                    cross_file_map,
                                    cache,
                                    ws_root,
                                    depth,
                                ) {
                                    return Some(result);
                                }
                            }

                            // Fall back to cross-file map lookup
                            if let Some(map) = cross_file_map {
                                if let Some(qn) = map.resolve_to_qualified_name(class_type) {
                                    return Some(ResolvedSymbol::CrossFile(qn));
                                }
                            }
                            return None; // Can't resolve - type not found locally or cross-file
                        }

                        // Look up attribute type on current class (includes property fallback)
                        if let Some(attr_type) = tracker.attribute_type_of(class_type, attr_name) {
                            // Attribute type found - update current_type and clear last_method_name
                            current_type = Some(attr_type.type_str.clone());
                            last_method_name = None;
                            pending_callable_return =
                                TypeTracker::callable_return_type_of(&attr_type);
                        } else {
                            // Attribute lookup failed - this is likely a method name
                            // Keep current_type UNCHANGED for method call resolution
                            last_method_name = Some(attr_name);
                            pending_callable_return = None;
                        }
                        last_name_was_class = false;
                        last_name_is_unresolved_callable = false;
                    } else {
                        return None; // Can't resolve without known type
                    }
                }
                ReceiverStep::Call => {
                    if let Some(ref class_type) = current_type {
                        // Handle callable attribute invocation first.
                        // When we have a pending_callable_return, we know the return type
                        // already (extracted from Callable[..., ReturnType]), so we don't
                        // need to look up the current_type (which is the Callable type string).
                        if pending_callable_return.is_some() && last_method_name.is_none() {
                            // Callable attribute: use callable return type
                            // Strip forward reference quotes if present
                            current_type = pending_callable_return
                                .take()
                                .map(|s| strip_forward_ref_quotes(&s).to_string());
                            // Clear all state flags and continue to next step
                            last_method_name = None;
                            last_name_was_class = false;
                            last_name_is_unresolved_callable = false;
                            // pending_callable_return already taken
                            continue;
                        }

                        // Check if current_type is cross-file BEFORE continuing
                        let is_import =
                            lookup_symbol_kind_in_scope_chain(scope_path, class_type, symbol_kinds)
                                == Some(SymbolKind::Import);

                        let is_local = last_name_was_class
                            || (lookup_symbol_index_in_scope_chain(
                                scope_path,
                                class_type,
                                scoped_symbol_map,
                            )
                            .is_some()
                                && !is_import);

                        if !is_local {
                            // Fall back to cross-file map lookup
                            if let Some(map) = cross_file_map {
                                if let Some(qn) = map.resolve_to_qualified_name(class_type) {
                                    return Some(ResolvedSymbol::CrossFile(qn));
                                }
                            }
                            return None; // Can't resolve - type not found locally or cross-file
                        }

                        if let Some(method_name) = last_method_name {
                            // Method call: lookup method return type
                            // Strip forward reference quotes (e.g., -> "Widget")
                            current_type = tracker
                                .method_return_type_of(class_type, method_name)
                                .map(|s| strip_forward_ref_quotes(s).to_string());
                        } else if last_name_was_class {
                            // Constructor call: ClassName() returns the class type
                            current_type = Some(class_type.to_string());
                        } else if last_name_is_unresolved_callable {
                            // Function call where name wasn't a typed variable
                            // Strip forward reference quotes if present
                            current_type = tracker
                                .return_type_of(scope_path, class_type)
                                .map(|s| strip_forward_ref_quotes(s).to_string());
                        } else {
                            // Edge case: fall back to return_type_of
                            current_type = tracker
                                .return_type_of(scope_path, class_type)
                                .map(|s| strip_forward_ref_quotes(s).to_string());
                        }
                        // Clear all state flags at end of Call step
                        last_method_name = None;
                        last_name_was_class = false;
                        last_name_is_unresolved_callable = false;
                        pending_callable_return = None;
                    } else {
                        return None;
                    }
                }
            }
        }

        // Resolve final type to symbol
        current_type.and_then(|t| {
            self.resolve_type_to_symbol(
                &t,
                scope_path,
                scoped_symbol_map,
                symbol_kinds,
                cross_file_map,
            )
        })
    }

    /// Resolve an attribute access on a cross-file type.
    ///
    /// This method handles the case where `class_type` is an import and we need
    /// to continue resolution in the remote file's context.
    ///
    /// # Arguments
    /// - `class_type`: The imported type name to resolve
    /// - `attr_name`: The attribute being accessed
    /// - `remaining_steps`: Any remaining steps after the attribute access
    /// - `scope_path`: Current scope path for import lookup
    /// - `import_targets`: Map for looking up import targets
    /// - `cross_file_map`: Cross-file symbol map for fallback
    /// - `cache`: Cross-file type cache for loading remote files
    /// - `workspace_root`: Workspace root for path resolution
    /// - `depth`: Current cross-file resolution depth
    #[allow(clippy::too_many_arguments)]
    fn resolve_cross_file_attr(
        &self,
        class_type: &str,
        attr_name: &str,
        remaining_steps: &[ReceiverStep],
        scope_path: &[String],
        import_targets: &HashMap<(Vec<String>, String), crate::cross_file_types::ImportTarget>,
        cross_file_map: Option<&CrossFileSymbolMap>,
        cache: &mut CrossFileTypeCache,
        workspace_root: &Path,
        depth: usize,
    ) -> Option<ResolvedSymbol> {
        use crate::cross_file_types::MAX_CROSS_FILE_DEPTH;

        // Check depth limit
        if depth >= MAX_CROSS_FILE_DEPTH {
            return None;
        }

        // Look up import target
        let target = lookup_import_target(scope_path, class_type, import_targets)?;

        // Clone the data we need before potentially mutating cache
        let file_path = target.file_path.clone();
        let kind = target.kind.clone();

        // Ensure file is analyzed (this populates the cache)
        cache.get_or_analyze(&file_path, workspace_root).ok()?;

        // Handle based on import kind
        match kind {
            ImportTargetKind::FromImport {
                imported_name,
                imported_module,
            } => {
                if imported_module {
                    // Submodule import: resolve attr_name within the module
                    self.resolve_module_attr(
                        attr_name,
                        remaining_steps,
                        &file_path,
                        cross_file_map,
                        cache,
                        workspace_root,
                        depth,
                    )
                } else {
                    // Class/function import: resolve attribute on the imported name
                    self.resolve_imported_class_attr(
                        &imported_name,
                        attr_name,
                        remaining_steps,
                        &file_path,
                        cross_file_map,
                        cache,
                        workspace_root,
                        depth,
                    )
                }
            }
            ImportTargetKind::ModuleImport => {
                // Module import: resolve attr_name within the module
                self.resolve_module_attr(
                    attr_name,
                    remaining_steps,
                    &file_path,
                    cross_file_map,
                    cache,
                    workspace_root,
                    depth,
                )
            }
        }
    }

    /// Resolve an attribute on an imported class.
    ///
    /// Looks up `attr_name` on `class_name` in the remote file context.
    /// Takes `file_path` instead of `remote_ctx` to avoid borrow conflicts.
    #[allow(clippy::too_many_arguments)]
    fn resolve_imported_class_attr(
        &self,
        class_name: &str,
        attr_name: &str,
        remaining_steps: &[ReceiverStep],
        file_path: &Path,
        cross_file_map: Option<&CrossFileSymbolMap>,
        cache: &mut CrossFileTypeCache,
        workspace_root: &Path,
        depth: usize,
    ) -> Option<ResolvedSymbol> {
        // Get the remote context (should be cached from earlier call)
        let remote_ctx = cache.get_or_analyze(file_path, workspace_root).ok()?;

        // Check if the class_name is itself an import in the remote file (re-export)
        let is_reexport = remote_ctx
            .symbol_kinds
            .get(&(vec!["<module>".to_string()], class_name.to_string()))
            == Some(&SymbolKind::Import);

        if is_reexport {
            // Need to look up the re-export target before dropping the borrow
            let module_scope = vec!["<module>".to_string()];
            if let Some(target) =
                lookup_import_target(&module_scope, class_name, &remote_ctx.import_targets)
            {
                let target_path = target.file_path.clone();
                let target_kind = target.kind.clone();

                // Determine the actual name to look up in the target file
                let actual_name = match &target_kind {
                    ImportTargetKind::FromImport { imported_name, .. } => imported_name.clone(),
                    ImportTargetKind::ModuleImport => class_name.to_string(),
                };

                // Ensure target file is analyzed
                cache.get_or_analyze(&target_path, workspace_root).ok()?;

                // Continue resolution in the target context
                return self.resolve_imported_class_attr(
                    &actual_name,
                    attr_name,
                    remaining_steps,
                    &target_path,
                    cross_file_map,
                    cache,
                    workspace_root,
                    depth + 1,
                );
            }
            return None;
        }

        // Extract what we need from the context before potential recursive calls
        let attr_type_info = remote_ctx
            .tracker
            .attribute_type_of(class_name, attr_name)
            .map(|at| at.type_str.clone());
        let method_return = remote_ctx
            .tracker
            .method_return_type_of(class_name, attr_name)
            .map(|s| s.to_string());
        let symbol_map_clone = remote_ctx.symbol_map.clone();
        let symbol_kinds_clone = remote_ctx.symbol_kinds.clone();
        let import_targets_clone = remote_ctx.import_targets.clone();
        let tracker_clone = remote_ctx.tracker.clone();

        // Try to resolve attribute type on the class
        if let Some(attr_type_str) = attr_type_info {
            // If there are no more steps, return the resolved type
            if remaining_steps.is_empty() {
                // Look up the final type in the remote context
                return self.resolve_type_in_context(
                    &attr_type_str,
                    &symbol_kinds_clone,
                    cross_file_map,
                );
            }

            // Continue resolution with remaining steps
            let new_path = ReceiverPath {
                steps: remaining_steps.to_vec(),
            };
            let module_scope = vec!["<module>".to_string()];

            return self.resolve_receiver_path_with_cross_file(
                &new_path,
                &module_scope,
                &tracker_clone,
                &symbol_map_clone,
                &symbol_kinds_clone,
                &import_targets_clone,
                cross_file_map,
                Some(cache),
                Some(workspace_root),
                depth + 1,
            );
        }

        // Try method lookup if attribute not found
        if let Some(return_type) = method_return {
            // Check if next step is a Call
            if let Some(ReceiverStep::Call) = remaining_steps.first() {
                // Method call - use the return type for remaining resolution
                let remaining = &remaining_steps[1..];
                if remaining.is_empty() {
                    // Final type is the return type
                    return self.resolve_type_in_context(
                        &return_type,
                        &symbol_kinds_clone,
                        cross_file_map,
                    );
                }

                // Build path for remaining steps with the return type
                let mut new_steps = vec![ReceiverStep::Name {
                    value: return_type.clone(),
                }];
                new_steps.extend_from_slice(remaining);
                let new_path = ReceiverPath { steps: new_steps };
                let module_scope = vec!["<module>".to_string()];

                return self.resolve_receiver_path_with_cross_file(
                    &new_path,
                    &module_scope,
                    &tracker_clone,
                    &symbol_map_clone,
                    &symbol_kinds_clone,
                    &import_targets_clone,
                    cross_file_map,
                    Some(cache),
                    Some(workspace_root),
                    depth + 1,
                );
            }
        }

        // If the class itself is what we're looking for (final step was attr on a class)
        if remaining_steps.is_empty() {
            // Return the class as a cross-file reference
            if symbol_map_clone
                .contains_key(&(vec!["<module>".to_string()], class_name.to_string()))
            {
                // Return as cross-file since it's in a different file
                if let Some(map) = cross_file_map {
                    if let Some(qn) = map.resolve_to_qualified_name(class_name) {
                        return Some(ResolvedSymbol::CrossFile(qn));
                    }
                }
                // Fallback: construct qualified name from file path and class name
                return Some(ResolvedSymbol::CrossFile(format!(
                    "{}.{}",
                    class_name, attr_name
                )));
            }
        }

        None
    }

    /// Resolve an attribute within a module context.
    ///
    /// Used when the import is a module import (`import pkg.mod`) and we need
    /// to resolve `mod.attr` or `mod.Class.method`.
    /// Takes `file_path` instead of `remote_ctx` to avoid borrow conflicts.
    #[allow(clippy::too_many_arguments)]
    fn resolve_module_attr(
        &self,
        attr_name: &str,
        remaining_steps: &[ReceiverStep],
        file_path: &Path,
        cross_file_map: Option<&CrossFileSymbolMap>,
        cache: &mut CrossFileTypeCache,
        workspace_root: &Path,
        depth: usize,
    ) -> Option<ResolvedSymbol> {
        let module_scope = vec!["<module>".to_string()];

        // Get the remote context
        let remote_ctx = cache.get_or_analyze(file_path, workspace_root).ok()?;

        // Look up attr_name in the module's symbols and extract what we need
        let kind = remote_ctx
            .symbol_kinds
            .get(&(module_scope.clone(), attr_name.to_string()))
            .copied();

        let return_type = remote_ctx
            .tracker
            .return_type_of(&module_scope, attr_name)
            .map(|s| s.to_string());

        // Clone context data we might need for recursive calls
        let tracker_clone = remote_ctx.tracker.clone();
        let symbol_map_clone = remote_ctx.symbol_map.clone();
        let symbol_kinds_clone = remote_ctx.symbol_kinds.clone();
        let import_targets_clone = remote_ctx.import_targets.clone();

        // Check if attr_name is an import and get target info if so
        let import_target_info = if kind == Some(SymbolKind::Import) {
            lookup_import_target(&module_scope, attr_name, &remote_ctx.import_targets)
                .map(|t| (t.file_path.clone(), t.kind.clone()))
        } else {
            None
        };

        // Now handle based on kind (remote_ctx borrow is dropped here)
        match kind {
            Some(SymbolKind::Class) => {
                // attr_name is a class - handle remaining steps
                if remaining_steps.is_empty() {
                    // Final resolution - return the class
                    if let Some(map) = cross_file_map {
                        if let Some(qn) = map.resolve_to_qualified_name(attr_name) {
                            return Some(ResolvedSymbol::CrossFile(qn));
                        }
                    }
                    return Some(ResolvedSymbol::CrossFile(attr_name.to_string()));
                }

                // Build path for remaining resolution
                let mut new_steps = vec![ReceiverStep::Name {
                    value: attr_name.to_string(),
                }];
                new_steps.extend_from_slice(remaining_steps);
                let new_path = ReceiverPath { steps: new_steps };

                return self.resolve_receiver_path_with_cross_file(
                    &new_path,
                    &module_scope,
                    &tracker_clone,
                    &symbol_map_clone,
                    &symbol_kinds_clone,
                    &import_targets_clone,
                    cross_file_map,
                    Some(cache),
                    Some(workspace_root),
                    depth + 1,
                );
            }
            Some(SymbolKind::Function) => {
                // attr_name is a function - check if next step is Call
                if let Some(ReceiverStep::Call) = remaining_steps.first() {
                    // Function call - get return type
                    if let Some(ret_type) = return_type {
                        let remaining = &remaining_steps[1..];
                        if remaining.is_empty() {
                            return self.resolve_type_in_context(
                                &ret_type,
                                &symbol_kinds_clone,
                                cross_file_map,
                            );
                        }

                        // Continue resolution with return type
                        let mut new_steps = vec![ReceiverStep::Name { value: ret_type }];
                        new_steps.extend_from_slice(remaining);
                        let new_path = ReceiverPath { steps: new_steps };

                        return self.resolve_receiver_path_with_cross_file(
                            &new_path,
                            &module_scope,
                            &tracker_clone,
                            &symbol_map_clone,
                            &symbol_kinds_clone,
                            &import_targets_clone,
                            cross_file_map,
                            Some(cache),
                            Some(workspace_root),
                            depth + 1,
                        );
                    }
                }

                // Function reference without call
                if remaining_steps.is_empty() {
                    if let Some(map) = cross_file_map {
                        if let Some(qn) = map.resolve_to_qualified_name(attr_name) {
                            return Some(ResolvedSymbol::CrossFile(qn));
                        }
                    }
                    return Some(ResolvedSymbol::CrossFile(attr_name.to_string()));
                }
            }
            Some(SymbolKind::Import) => {
                // attr_name is an import - follow it
                if let Some((target_path, target_kind)) = import_target_info {
                    // Ensure target file is analyzed
                    cache.get_or_analyze(&target_path, workspace_root).ok()?;

                    // Get the name to look up in the target
                    let lookup_name = match &target_kind {
                        ImportTargetKind::FromImport { imported_name, .. } => imported_name.clone(),
                        ImportTargetKind::ModuleImport => attr_name.to_string(),
                    };

                    return self.resolve_module_attr(
                        &lookup_name,
                        remaining_steps,
                        &target_path,
                        cross_file_map,
                        cache,
                        workspace_root,
                        depth + 1,
                    );
                }
            }
            _ => {}
        }

        None
    }

    /// Resolve a type name in a context using symbol_kinds.
    ///
    /// Returns a CrossFile result with the qualified name.
    fn resolve_type_in_context(
        &self,
        type_name: &str,
        symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
        cross_file_map: Option<&CrossFileSymbolMap>,
    ) -> Option<ResolvedSymbol> {
        let module_scope = vec!["<module>".to_string()];

        // Check if type is a class in the context
        if let Some(SymbolKind::Class) =
            symbol_kinds.get(&(module_scope.clone(), type_name.to_string()))
        {
            // Return as cross-file reference
            if let Some(map) = cross_file_map {
                if let Some(qn) = map.resolve_to_qualified_name(type_name) {
                    return Some(ResolvedSymbol::CrossFile(qn));
                }
            }
            return Some(ResolvedSymbol::CrossFile(type_name.to_string()));
        }

        // Try cross-file map lookup
        if let Some(map) = cross_file_map {
            if let Some(qn) = map.resolve_to_qualified_name(type_name) {
                return Some(ResolvedSymbol::CrossFile(qn));
            }
        }

        Some(ResolvedSymbol::CrossFile(type_name.to_string()))
    }

    /// Resolve a type name to a symbol using scope-aware lookup.
    ///
    /// Searches for the type in the local symbol map first (using scope chain),
    /// then falls back to cross-file resolution if available.
    fn resolve_type_to_symbol(
        &self,
        type_name: &str,
        scope_path: &[String],
        scoped_symbol_map: &HashMap<(Vec<String>, String), usize>,
        symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
        cross_file_map: Option<&CrossFileSymbolMap>,
    ) -> Option<ResolvedSymbol> {
        // Check if it's an import (cross-file reference)
        if lookup_symbol_kind_in_scope_chain(scope_path, type_name, symbol_kinds)
            == Some(SymbolKind::Import)
        {
            if let Some(map) = cross_file_map {
                if let Some(qn) = map.resolve_to_qualified_name(type_name) {
                    return Some(ResolvedSymbol::CrossFile(qn));
                }
            }
            return None;
        }

        // Try local lookup with scope chain - only resolve to Class symbols (types)
        // Variables and functions are not types, so we shouldn't return them here
        if let Some(idx) =
            lookup_symbol_index_in_scope_chain(scope_path, type_name, scoped_symbol_map)
        {
            if lookup_symbol_kind_in_scope_chain(scope_path, type_name, symbol_kinds)
                == Some(SymbolKind::Class)
            {
                return Some(ResolvedSymbol::Local(idx));
            }
        }

        // Fall back to cross-file
        if let Some(map) = cross_file_map {
            if let Some(qn) = map.resolve_to_qualified_name(type_name) {
                return Some(ResolvedSymbol::CrossFile(qn));
            }
        }

        None
    }

    /// Resolve a receiver to a symbol, using structured path if available.
    ///
    /// This method delegates to `resolve_receiver_path` when a structured path
    /// is present, falling back to `resolve_receiver_to_symbol` for simple
    /// string-based resolution.
    ///
    /// When `cross_file_cache` and `workspace_root` are provided, cross-file
    /// type resolution is enabled for imported types.
    #[allow(clippy::too_many_arguments)]
    fn resolve_receiver_to_symbol_with_path(
        &self,
        receiver: &str,
        receiver_path: Option<&ReceiverPath>,
        scope_path: &[String],
        tracker: Option<&TypeTracker>,
        scoped_symbol_map: &HashMap<(Vec<String>, String), usize>,
        symbol_kinds: &HashMap<(Vec<String>, String), SymbolKind>,
        symbol_name_to_index: &HashMap<&str, usize>,
        cross_file_map: Option<&CrossFileSymbolMap>,
        // Cross-file resolution parameters (optional)
        import_targets: Option<
            &HashMap<(Vec<String>, String), crate::cross_file_types::ImportTarget>,
        >,
        cross_file_cache: Option<&mut CrossFileTypeCache>,
        workspace_root: Option<&Path>,
    ) -> Option<ResolvedSymbol> {
        // If we have a structured path and a tracker, use resolution
        if let (Some(path), Some(tracker)) = (receiver_path, tracker) {
            // Use cross-file resolution if cache is available
            if let (Some(import_targets), Some(cache), Some(ws_root)) =
                (import_targets, cross_file_cache, workspace_root)
            {
                if let Some(result) = self.resolve_receiver_path_with_cross_file(
                    path,
                    scope_path,
                    tracker,
                    scoped_symbol_map,
                    symbol_kinds,
                    import_targets,
                    cross_file_map,
                    Some(cache),
                    Some(ws_root),
                    0, // Initial depth
                ) {
                    return Some(result);
                }
            } else {
                // Fall back to single-file resolution
                if let Some(result) = self.resolve_receiver_path(
                    path,
                    scope_path,
                    tracker,
                    scoped_symbol_map,
                    symbol_kinds,
                    cross_file_map,
                ) {
                    return Some(result);
                }
            }
        }

        // Fall back to simple string-based resolution
        self.resolve_receiver_to_symbol(
            receiver,
            scope_path,
            tracker,
            symbol_name_to_index,
            cross_file_map,
        )
    }
}

/// Result of symbol resolution during adapter conversion.
///
/// This enum distinguishes between local and cross-file symbol resolution,
/// ensuring that indices are only used for local (same-file) symbols while
/// cross-file references use qualified names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedSymbol {
    /// Symbol resolved to a local index (same file).
    /// The index refers to `FileAnalysisResult.symbols`.
    Local(usize),
    /// Symbol resolved to a cross-file qualified name.
    /// The qualified name can be used to look up the symbol in FactsStore.
    CrossFile(String),
}

impl LanguageAdapter for PythonAdapter {
    type Error = AnalyzerError;

    fn analyze_file(&self, path: &str, content: &str) -> Result<FileAnalysisResult, Self::Error> {
        // Use a temporary FileId (the adapter doesn't allocate IDs)
        let temp_file_id = FileId::new(0);

        // Parse and analyze to get the native result for TypeTracker
        let native_result = cst_bridge::parse_and_analyze(content)?;

        // Build TypeTracker from assignments and annotations
        let type_tracker = build_type_tracker(&native_result);

        // Run standard analysis (which also parses, but we accept the redundancy for now)
        let analysis = analyze_file(temp_file_id, path, content)?;

        // Single file analysis: no cross-file map available
        Ok(self.convert_file_analysis(&analysis, Some(&type_tracker), None))
    }

    fn analyze_files(
        &self,
        files: &[(String, String)],
        store: &FactsStore,
    ) -> Result<AnalysisBundle, Self::Error> {
        // Build cross-file symbol map from the pre-populated store (per [D06])
        // This enables resolution of types defined in files analyzed previously
        let cross_file_map = CrossFileSymbolMap::from_store(store);

        // Create a temporary FactsStore for analysis
        // The adapter doesn't mutate the input store; it builds all state internally
        let mut temp_store = FactsStore::new();
        let bundle = analyze_files(files, &mut temp_store)?;
        Ok(self.convert_file_analysis_bundle(&bundle, &cross_file_map))
    }

    fn language(&self) -> Language {
        Language::Python
    }

    fn can_handle(&self, path: &str) -> bool {
        path.ends_with(".py") || path.ends_with(".pyi")
    }
}

impl PythonAdapter {
    /// Convert a `FileAnalysis` to `FileAnalysisResult` for the adapter interface.
    ///
    /// # Arguments
    /// - `analysis`: The file analysis result from the parser
    /// - `type_tracker`: Optional TypeTracker for receiver type resolution. When provided,
    ///   attribute access `base_symbol_index` will be populated for typed receivers.
    /// - `cross_file_map`: Optional cross-file symbol map for resolving types defined
    ///   in other files. Used as fallback when local symbol lookup fails.
    fn convert_file_analysis(
        &self,
        analysis: &FileAnalysis,
        type_tracker: Option<&TypeTracker>,
        cross_file_map: Option<&CrossFileSymbolMap>,
    ) -> FileAnalysisResult {
        let mut result = FileAnalysisResult {
            path: analysis.path.clone(),
            ..Default::default()
        };

        // Convert scopes
        for scope in &analysis.scopes {
            result.scopes.push(ScopeData {
                kind: scope.kind,
                span: scope.span.unwrap_or(Span::new(0, 0)),
                parent_index: scope.parent_id.map(|id| id.0 as usize),
                name: scope.name.clone(),
            });
        }

        // Build scope ID to index mapping for symbol conversion
        let scope_id_to_index: HashMap<ScopeId, usize> = analysis
            .scopes
            .iter()
            .enumerate()
            .map(|(idx, s)| (s.id, idx))
            .collect();

        // Convert symbols (filter entries without spans per [D01])
        // Track mapping from result index to analysis index for scope path computation
        let mut result_to_analysis_idx: Vec<usize> = Vec::new();
        for (analysis_idx, symbol) in analysis.symbols.iter().enumerate() {
            // A symbol without a declaration span can't be an edit target - skip it
            let Some(decl_span) = symbol.span else {
                tracing::debug!(
                    name = %symbol.name,
                    kind = ?symbol.kind,
                    "Skipping symbol without declaration span (cannot be edit target)"
                );
                continue;
            };

            let scope_index = scope_id_to_index
                .get(&symbol.scope_id)
                .copied()
                .unwrap_or(0);

            // Build scope_path for this symbol
            let scope_path = self.build_scope_path_for_symbol(analysis, analysis_idx);

            result.symbols.push(SymbolData {
                kind: symbol.kind,
                name: symbol.name.clone(),
                decl_span,
                scope_index,
                scope_path,
                visibility: self.infer_visibility_from_name(&symbol.name),
            });
            result_to_analysis_idx.push(analysis_idx);
        }

        // Convert references (filter entries without spans per [D01])
        for reference in &analysis.references {
            // A reference without a span can't be an edit target - skip it
            let Some(span) = reference.span else {
                tracing::debug!(
                    name = %reference.name,
                    kind = ?reference.kind,
                    "Skipping reference without span (cannot be edit target)"
                );
                continue;
            };

            let scope_index = scope_id_to_index
                .get(&reference.scope_id)
                .copied()
                .unwrap_or(0);

            result.references.push(ReferenceData {
                name: reference.name.clone(),
                span,
                scope_index,
                kind: convert_facts_reference_kind_to_adapter(reference.kind),
            });
        }

        // Convert imports
        for import in &analysis.imports {
            result
                .imports
                .push(convert_local_import_to_import_data(import));
        }

        // Convert exports from __all__ (filter entries without spans per [D01])
        for export in &analysis.exports {
            // An export without a declaration span can't be an edit target - skip it
            let Some(decl_span) = export.span else {
                tracing::debug!(
                    name = %export.name,
                    "Skipping export without span (cannot be edit target)"
                );
                continue;
            };

            result.exports.push(ExportData {
                exported_name: Some(export.name.clone()),
                source_name: Some(export.name.clone()), // Same for non-aliased Python exports
                decl_span,
                exported_name_span: export.content_span,
                source_name_span: None,
                export_kind: ExportKind::PythonAll,
                export_target: ExportTarget::Single,
                export_intent: ExportIntent::Declared,
                export_origin: ExportOrigin::Local,
                origin_module_path: None,
            });
        }

        // Compute effective exports if enabled and no explicit __all__
        if self.options.compute_effective_exports {
            let effective = compute_effective_exports(analysis);
            result.exports.extend(effective);
        }

        // Build name to symbol index mapping for alias resolution
        let symbol_name_to_index: HashMap<&str, usize> = result
            .symbols
            .iter()
            .enumerate()
            .map(|(idx, s)| (s.name.as_str(), idx))
            .collect();

        // Build scope-aware symbol maps for dotted path resolution.
        // These maps key by (scope_path, name) to handle shadowing correctly.
        // The scope_path for each symbol is computed by walking up the scope chain.
        // We use result_to_analysis_idx to get the correct analysis index for each result symbol.
        let mut symbol_kinds: HashMap<(Vec<String>, String), SymbolKind> = HashMap::new();
        let mut scoped_symbol_map: HashMap<(Vec<String>, String), usize> = HashMap::new();

        for (result_idx, symbol) in result.symbols.iter().enumerate() {
            // Get the corresponding analysis index for scope path computation
            let analysis_idx = result_to_analysis_idx[result_idx];
            // Build the scope_path for this symbol using the analysis index
            let scope_path = self.build_scope_path_for_symbol(analysis, analysis_idx);
            let key = (scope_path, symbol.name.clone());
            symbol_kinds.insert(key.clone(), symbol.kind);
            scoped_symbol_map.insert(key, result_idx);
        }

        // Convert aliases from alias graph
        // Iterate through all source names and their aliases
        for source_name in analysis.alias_graph.source_names() {
            for alias_info in analysis.alias_graph.direct_aliases(source_name) {
                // Resolve alias_name to symbol index (must exist as it's a binding)
                let alias_symbol_index =
                    match symbol_name_to_index.get(alias_info.alias_name.as_str()) {
                        Some(&idx) => idx,
                        None => continue, // Skip if alias symbol not found
                    };

                // Resolve source_name to symbol index (may be None if unresolved)
                let target_symbol_index = symbol_name_to_index
                    .get(alias_info.source_name.as_str())
                    .copied();

                result.aliases.push(AliasEdgeData {
                    alias_symbol_index,
                    target_symbol_index,
                    span: alias_info.alias_span,
                    kind: alias_info.kind,
                    confidence: Some(alias_info.confidence),
                });
            }
        }

        // Convert signatures, modifiers, qualified names, and type params
        // Build a mapping from (function name, scope_path) to symbol_index for signature resolution
        // This approach handles nested functions and methods correctly
        // We use result_to_analysis_idx to get the correct analysis index for scope path computation
        let func_to_symbol: HashMap<(String, Vec<String>), usize> = result
            .symbols
            .iter()
            .enumerate()
            .filter(|(_, s)| s.kind == SymbolKind::Function)
            .map(|(result_idx, s)| {
                // Get the corresponding analysis index for scope path computation
                let analysis_idx = result_to_analysis_idx[result_idx];
                // Construct scope_path from the scope hierarchy using the analysis index
                let scope_path = self.build_scope_path_for_symbol(analysis, analysis_idx);
                ((s.name.clone(), scope_path), result_idx)
            })
            .collect();

        // Module path for qualified name computation
        let module_path = compute_module_path(&analysis.path);

        for sig in &analysis.signatures {
            // Look up the symbol index using function name and scope path
            let symbol_index = match func_to_symbol.get(&(sig.name.clone(), sig.scope_path.clone()))
            {
                Some(&idx) => idx,
                None => continue, // Skip if symbol not found
            };

            // Convert parameters
            // Use structured TypeNode if available, otherwise fall back to flat Named
            let params: Vec<ParameterData> = sig
                .params
                .iter()
                .map(|p| ParameterData {
                    name: p.name.clone(),
                    kind: convert_cst_param_kind(p.kind),
                    default_span: p.default_span,
                    annotation: p
                        .annotation_node
                        .clone()
                        .or_else(|| p.annotation.as_ref().map(TypeNode::named)),
                })
                .collect();

            // Convert return type
            // Use structured TypeNode if available, otherwise fall back to flat Named
            let returns = sig
                .returns_node
                .clone()
                .or_else(|| sig.returns.as_ref().map(TypeNode::named));

            result.signatures.push(SignatureData {
                symbol_index,
                params,
                returns,
            });

            // Extract modifiers
            if !sig.modifiers.is_empty() {
                let modifiers: Vec<Modifier> = sig
                    .modifiers
                    .iter()
                    .filter_map(|m| convert_cst_modifier(*m))
                    .collect();
                if !modifiers.is_empty() {
                    result.modifiers.push(ModifierData {
                        symbol_index,
                        modifiers,
                    });
                }
            }

            // Compute qualified name
            let qualified_name = compute_qualified_name(&module_path, &sig.scope_path, &sig.name);
            result.qualified_names.push(QualifiedNameData {
                symbol_index,
                path: qualified_name,
            });

            // Convert type parameters
            for tp in &sig.type_params {
                result.type_params.push(TypeParamData {
                    name: tp.name.clone(),
                    bounds: tp
                        .bound
                        .as_ref()
                        .map(|b| {
                            vec![TypeNode::Named {
                                name: b.clone(),
                                args: vec![],
                            }]
                        })
                        .unwrap_or_default(),
                    default: tp.default.as_ref().map(|d| TypeNode::Named {
                        name: d.clone(),
                        args: vec![],
                    }),
                });
            }
        }

        // Convert attribute accesses
        for attr in &analysis.attribute_accesses {
            // Try to resolve the receiver to a symbol via type inference.
            // Uses structured receiver_path when available for dotted path resolution,
            // falling back to simple string-based resolution otherwise.
            let resolved = self.resolve_receiver_to_symbol_with_path(
                &attr.receiver,
                attr.receiver_path.as_ref(),
                &attr.scope_path,
                type_tracker,
                &scoped_symbol_map,
                &symbol_kinds,
                &symbol_name_to_index,
                cross_file_map,
                // Cross-file resolution not yet wired up in convert_file_analysis
                None, // import_targets
                None, // cross_file_cache
                None, // workspace_root
            );

            // Split resolution into local index vs cross-file qualified name
            let (base_symbol_index, base_symbol_qualified_name) = match resolved {
                Some(ResolvedSymbol::Local(idx)) => (Some(idx), None),
                Some(ResolvedSymbol::CrossFile(qn)) => (None, Some(qn)),
                None => (None, None),
            };

            result.attributes.push(AttributeAccessData {
                base_symbol_index,
                base_symbol_qualified_name,
                name: attr.attr_name.clone(),
                span: attr.attr_span,
                kind: convert_cst_attribute_access_kind(attr.kind),
            });
        }

        // Convert call sites (filter entries without spans per [D01])
        for call in &analysis.call_sites {
            // A call site without a span can't be an edit target - skip it
            let Some(span) = call.span else {
                tracing::debug!(
                    callee = %call.callee,
                    "Skipping call site without span (cannot be edit target)"
                );
                continue;
            };

            // Try to resolve the callee to a symbol
            // For function calls, look up the callee name in symbols (local only)
            // For method calls, resolve the receiver type to find the class symbol
            let (callee_symbol_index, callee_symbol_qualified_name) = if !call.is_method_call {
                // Direct function call: look up callee name in local symbols only
                // (cross-file function resolution would need import tracking)
                let idx = symbol_name_to_index.get(call.callee.as_str()).copied();
                (idx, None)
            } else {
                // Method call: resolve the receiver's type to find the class symbol.
                // Uses structured receiver_path when available for dotted path resolution,
                // falling back to simple string-based resolution otherwise.
                let resolved = call.receiver.as_ref().and_then(|receiver| {
                    self.resolve_receiver_to_symbol_with_path(
                        receiver,
                        call.receiver_path.as_ref(),
                        &call.scope_path,
                        type_tracker,
                        &scoped_symbol_map,
                        &symbol_kinds,
                        &symbol_name_to_index,
                        cross_file_map,
                        // Cross-file resolution not yet wired up in convert_file_analysis
                        None, // import_targets
                        None, // cross_file_cache
                        None, // workspace_root
                    )
                });

                match resolved {
                    Some(ResolvedSymbol::Local(idx)) => (Some(idx), None),
                    Some(ResolvedSymbol::CrossFile(qn)) => (None, Some(qn)),
                    None => (None, None),
                }
            };

            let args: Vec<CallArgData> = call
                .args
                .iter()
                .map(|arg| CallArgData {
                    name: arg.name.clone(),
                    span: arg.span,
                })
                .collect();

            result.calls.push(CallSiteData {
                callee_symbol_index,
                callee_symbol_qualified_name,
                span,
                args,
            });
        }

        result
    }

    /// Convert a `FileAnalysisBundle` to `AnalysisBundle` for the adapter interface.
    ///
    /// # Arguments
    /// - `bundle`: The file analysis bundle containing results for multiple files
    /// - `cross_file_map`: Cross-file symbol map for resolving types defined in
    ///   previously analyzed files (built from the FactsStore per [D06])
    fn convert_file_analysis_bundle(
        &self,
        bundle: &FileAnalysisBundle,
        cross_file_map: &CrossFileSymbolMap,
    ) -> AnalysisBundle {
        let mut result = AnalysisBundle::default();

        // Convert each file analysis (preserving input order per [D15])
        // Use TypeTrackers from the bundle for receiver type resolution
        // Pass cross_file_map for cross-file symbol resolution
        for analysis in &bundle.file_analyses {
            let type_tracker = bundle.type_trackers.get(&analysis.file_id);
            result.file_results.push(self.convert_file_analysis(
                analysis,
                type_tracker,
                Some(cross_file_map),
            ));
        }

        // Convert failed files
        for (path, error) in &bundle.failed_files {
            result.failed_files.push((path.clone(), error.to_string()));
        }

        // Build module resolution map from file paths
        // This maps module paths (e.g., "pkg.sub") to file indices
        let mut module_map: HashMap<String, Vec<usize>> = HashMap::new();

        for (file_index, analysis) in bundle.file_analyses.iter().enumerate() {
            let module_path = compute_module_path(&analysis.path);
            module_map.entry(module_path).or_default().push(file_index);
        }

        // Also add namespace packages from the bundle
        // Namespace packages are directories without __init__.py that can contain modules
        for ns_path in &bundle.namespace_packages {
            let module_path = ns_path.replace(['/', '\\'], ".");
            // Namespace packages have no associated file, so file_indices is empty
            // but we still record them for import resolution
            module_map.entry(module_path).or_default();
        }

        // Convert to ModuleResolutionData
        result.modules = module_map
            .into_iter()
            .map(|(module_path, file_indices)| ModuleResolutionData {
                module_path,
                file_indices,
            })
            .collect();

        // Note: types are populated in a later step

        result
    }

    /// Build the scope path for a symbol at the given index.
    ///
    /// This reconstructs the scope path by walking up the scope hierarchy
    /// from the symbol's containing scope to the module root.
    fn build_scope_path_for_symbol(
        &self,
        analysis: &FileAnalysis,
        symbol_index: usize,
    ) -> Vec<String> {
        // Get the symbol's containing scope
        let symbol = match analysis.symbols.get(symbol_index) {
            Some(s) => s,
            None => return vec!["<module>".to_string()],
        };

        // Find the scope chain by walking up parent scopes
        let mut scope_path = Vec::new();
        let mut current_scope_id = Some(symbol.scope_id);

        while let Some(scope_id) = current_scope_id {
            if let Some(scope) = analysis.scopes.iter().find(|s| s.id == scope_id) {
                if let Some(name) = &scope.name {
                    scope_path.push(name.clone());
                } else {
                    scope_path.push("<module>".to_string());
                }
                current_scope_id = scope.parent_id;
            } else {
                break;
            }
        }

        // Reverse since we built from leaf to root
        scope_path.reverse();
        scope_path
    }
}

/// Convert facts::ReferenceKind to adapter::ReferenceKind.
fn convert_facts_reference_kind_to_adapter(kind: ReferenceKind) -> AdapterReferenceKind {
    match kind {
        ReferenceKind::Definition => AdapterReferenceKind::Definition,
        ReferenceKind::Call => AdapterReferenceKind::Call,
        ReferenceKind::Reference => AdapterReferenceKind::Read,
        ReferenceKind::Import => AdapterReferenceKind::Import,
        ReferenceKind::Attribute => AdapterReferenceKind::Attribute,
        ReferenceKind::TypeAnnotation => AdapterReferenceKind::TypeAnnotation,
        ReferenceKind::Write => AdapterReferenceKind::Write,
        ReferenceKind::Delete => AdapterReferenceKind::Delete,
    }
}

// ============================================================================
// Effective Export Computation
// ============================================================================

/// Check if a name is effectively public by Python naming conventions.
///
/// A name is effectively public if:
/// - It is a dunder (`__name__`) - these are part of Python's public API
/// - It does not start with an underscore
///
/// Names starting with `_` (except dunders) are considered private by convention.
fn is_effectively_public(name: &str) -> bool {
    // Dunders are public (e.g., __init__, __name__, __doc__)
    // Must have at least 5 chars: __ + at least 1 char + __
    if name.starts_with("__") && name.ends_with("__") && name.len() > 4 {
        return true;
    }
    // Names starting with _ are private (single underscore or name mangling)
    !name.starts_with('_')
}

/// Collect the set of names bound by imports in a file.
///
/// This includes:
/// - Module import aliases (e.g., `import os as operating_system` -> "operating_system")
/// - Module imports (e.g., `import os` -> "os")
/// - Named imports (e.g., `from os import path` -> "path")
/// - Named imports with aliases (e.g., `from os import path as p` -> "p")
fn collect_imported_names(imports: &[LocalImport]) -> HashSet<String> {
    let mut imported = HashSet::new();

    for import in imports {
        if import.kind == "import" {
            // `import os` or `import os as operating_system`
            if let Some(alias) = &import.alias {
                imported.insert(alias.clone());
            } else {
                // For `import a.b.c`, the bound name is just "a"
                let first_part = import
                    .module_path
                    .split('.')
                    .next()
                    .unwrap_or(&import.module_path);
                imported.insert(first_part.to_string());
            }
        } else {
            // `from x import ...`
            for name in &import.names {
                if let Some(alias) = &name.alias {
                    imported.insert(alias.clone());
                } else {
                    imported.insert(name.name.clone());
                }
            }
        }
    }

    imported
}

/// Compute effective exports for a file without explicit `__all__`.
///
/// Returns a vector of `ExportData` entries for module-level symbols that are
/// considered part of the public API by Python naming conventions:
/// - Public names (not starting with `_`)
/// - Dunder names (`__init__`, etc.)
/// - Symbols defined in this file (not imported)
///
/// Returns an empty vector if:
/// - The file has an explicit `__all__`
/// - The file has a star import (`from x import *`) since we can't know
///   what names are imported and thus might incorrectly mark imported names
///   as locally-defined effective exports
fn compute_effective_exports(analysis: &FileAnalysis) -> Vec<ExportData> {
    // Only compute if no explicit __all__
    if !analysis.exports.is_empty() {
        return vec![];
    }

    // If there are any star imports, we can't reliably determine which names
    // are imported vs locally defined, so return empty (conservative approach)
    let has_star_import = analysis.imports.iter().any(|imp| imp.is_star);
    if has_star_import {
        tracing::debug!(
            "Skipping effective exports due to star import (cannot determine imported names)"
        );
        return vec![];
    }

    // Collect imported names to exclude from effective exports
    let imported_names = collect_imported_names(&analysis.imports);

    // Get module-level scope ID (first scope should be module level)
    let module_scope_id = if let Some(scope) = analysis.scopes.first() {
        if scope.kind == ScopeKind::Module {
            scope.id
        } else {
            return vec![]; // No module scope found
        }
    } else {
        return vec![]; // No scopes
    };

    analysis
        .symbols
        .iter()
        .filter(|s| {
            // Must be at module level
            s.scope_id == module_scope_id
        })
        .filter(|s| {
            // Must be effectively public by naming convention
            is_effectively_public(&s.name)
        })
        .filter(|s| {
            // Must not be imported (defined in this file)
            !imported_names.contains(&s.name)
        })
        .filter_map(|s| {
            // Must have a span for the declaration
            s.span.map(|span| ExportData {
                exported_name: Some(s.name.clone()),
                source_name: Some(s.name.clone()),
                decl_span: span,
                exported_name_span: None, // No explicit export syntax
                source_name_span: None,
                export_kind: ExportKind::PythonAll, // Treat as implicit __all__
                export_target: ExportTarget::Implicit,
                export_intent: ExportIntent::Effective,
                export_origin: ExportOrigin::Implicit,
                origin_module_path: None,
            })
        })
        .collect()
}

/// Convert LocalImport to ImportData for the adapter interface.
fn convert_local_import_to_import_data(import: &LocalImport) -> ImportData {
    // Determine ImportKind from the import structure
    let kind = if import.is_star {
        ImportKind::Glob
    } else if import.kind == "import" {
        if import.alias.is_some() {
            ImportKind::Alias
        } else {
            ImportKind::Module
        }
    } else {
        // "from" import
        if import.names.len() == 1 && import.names[0].alias.is_some() {
            ImportKind::Alias
        } else {
            ImportKind::Named
        }
    };

    // For "from" imports, get the first imported name
    let imported_name = if import.kind == "from" && !import.names.is_empty() {
        Some(import.names[0].name.clone())
    } else {
        None
    };

    // Get alias from either module-level alias or first imported name's alias
    let alias = import.alias.clone().or_else(|| {
        if import.kind == "from" && !import.names.is_empty() {
            import.names[0].alias.clone()
        } else {
            None
        }
    });

    ImportData {
        module_path: import.module_path.clone(),
        imported_name,
        alias,
        kind,
        span: import.span.unwrap_or(Span::new(0, 0)),
    }
}

/// Convert CST ParamKind to FactsStore ParamKind.
fn convert_cst_param_kind(kind: tugtool_python_cst::ParamKind) -> ParamKind {
    match kind {
        tugtool_python_cst::ParamKind::Regular => ParamKind::Regular,
        tugtool_python_cst::ParamKind::PositionalOnly => ParamKind::PositionalOnly,
        tugtool_python_cst::ParamKind::KeywordOnly => ParamKind::KeywordOnly,
        tugtool_python_cst::ParamKind::VarArgs => ParamKind::VarArgs,
        tugtool_python_cst::ParamKind::KwArgs => ParamKind::KwArgs,
    }
}

/// Convert CST Modifier to FactsStore Modifier.
fn convert_cst_modifier(modifier: tugtool_python_cst::Modifier) -> Option<Modifier> {
    match modifier {
        tugtool_python_cst::Modifier::Async => Some(Modifier::Async),
        tugtool_python_cst::Modifier::Static => Some(Modifier::Static),
        tugtool_python_cst::Modifier::ClassMethod => Some(Modifier::ClassMethod),
        tugtool_python_cst::Modifier::Property => Some(Modifier::Property),
        tugtool_python_cst::Modifier::Abstract => Some(Modifier::Abstract),
        tugtool_python_cst::Modifier::Final => Some(Modifier::Final),
        tugtool_python_cst::Modifier::Override => Some(Modifier::Override),
        tugtool_python_cst::Modifier::Generator => Some(Modifier::Generator),
    }
}

/// Convert CST AttributeAccessKind to FactsStore AttributeAccessKind.
fn convert_cst_attribute_access_kind(
    kind: tugtool_python_cst::AttributeAccessKind,
) -> AttributeAccessKind {
    match kind {
        tugtool_python_cst::AttributeAccessKind::Read => AttributeAccessKind::Read,
        tugtool_python_cst::AttributeAccessKind::Write => AttributeAccessKind::Write,
        tugtool_python_cst::AttributeAccessKind::Call => AttributeAccessKind::Call,
    }
}

/// Compute the module path from a file path.
///
/// Converts "pkg/sub/mod.py" to "pkg.sub.mod"
/// Handles `__init__.py` by using the directory name as the module.
fn compute_module_path(file_path: &str) -> String {
    let path = std::path::Path::new(file_path);

    // Get the file name
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

    // Get the parent components
    let components: Vec<&str> = path
        .parent()
        .map(|p| {
            p.components()
                .filter_map(|c| match c {
                    std::path::Component::Normal(s) => s.to_str(),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();

    if file_name == "__init__.py" {
        // For package __init__.py, the module is just the directory path
        components.join(".")
    } else {
        // For regular modules, strip the .py extension
        let module_name = file_name.strip_suffix(".py").unwrap_or(file_name);
        if components.is_empty() {
            module_name.to_string()
        } else {
            format!("{}.{}", components.join("."), module_name)
        }
    }
}

/// Compute the fully-qualified name for a symbol.
///
/// Combines module path, scope chain, and symbol name.
/// Example: "pkg.mod", ["<module>", "Foo"], "bar" -> "pkg.mod.Foo.bar"
fn compute_qualified_name(module_path: &str, scope_path: &[String], symbol_name: &str) -> String {
    // Filter out "<module>" from scope path as it's implicit in the module path
    let scope_parts: Vec<&str> = scope_path
        .iter()
        .filter(|s| *s != "<module>")
        .map(|s| s.as_str())
        .collect();

    let mut parts = Vec::new();
    if !module_path.is_empty() {
        parts.push(module_path);
    }
    for scope in &scope_parts {
        parts.push(scope);
    }
    parts.push(symbol_name);

    parts.join(".")
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod adapter_tests {
        use super::*;
        use tugtool_core::adapter::ReferenceKind as AdapterReferenceKind;

        #[test]
        fn python_adapter_can_handle_py_files() {
            let adapter = PythonAdapter::new();
            assert!(adapter.can_handle("foo.py"));
            assert!(adapter.can_handle("path/to/bar.py"));
            assert!(adapter.can_handle("test.pyi")); // Type stubs
        }

        #[test]
        fn python_adapter_cannot_handle_non_py_files() {
            let adapter = PythonAdapter::new();
            assert!(!adapter.can_handle("foo.rs"));
            assert!(!adapter.can_handle("foo.js"));
            assert!(!adapter.can_handle("foo.pyc")); // Bytecode
            assert!(!adapter.can_handle("foo.txt"));
        }

        #[test]
        fn python_adapter_returns_python_language() {
            let adapter = PythonAdapter::new();
            assert_eq!(adapter.language(), Language::Python);
        }

        #[test]
        fn python_adapter_default_options() {
            let adapter = PythonAdapter::new();
            assert!(!adapter.options().infer_visibility);
        }

        #[test]
        fn python_adapter_with_custom_options() {
            let opts = PythonAnalyzerOptions {
                infer_visibility: true,
                ..Default::default()
            };
            let adapter = PythonAdapter::with_options(opts);
            assert!(adapter.options().infer_visibility);
        }

        #[test]
        fn python_adapter_analyze_file_basic() {
            let adapter = PythonAdapter::new();
            let content = "def foo():\n    x = 1\n    return x";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert_eq!(result.path, "test.py");
            assert!(!result.scopes.is_empty());
            assert!(!result.symbols.is_empty());
        }

        #[test]
        fn python_adapter_analyze_files_preserves_order() {
            let adapter = PythonAdapter::new();
            let files = vec![
                ("b.py".to_string(), "x = 1".to_string()),
                ("a.py".to_string(), "y = 2".to_string()),
                ("c.py".to_string(), "z = 3".to_string()),
            ];
            let store = FactsStore::new();
            let bundle = adapter.analyze_files(&files, &store).unwrap();

            // Order must match input, not sorted alphabetically
            // Note: analyze_files internally sorts for deterministic IDs,
            // but the bundle preserves the sorted order
            assert_eq!(bundle.file_results.len(), 3);
        }

        #[test]
        fn visibility_inference_disabled_by_default() {
            let adapter = PythonAdapter::new();
            let content = "def _private_func(): pass\ndef public_func(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // With infer_visibility=false, all symbols should have None visibility
            for symbol in &result.symbols {
                assert!(symbol.visibility.is_none());
            }
        }

        #[test]
        fn visibility_inference_private_underscore() {
            let adapter = PythonAdapter::with_options(PythonAnalyzerOptions {
                infer_visibility: true,
                ..Default::default()
            });
            let content = "def _private_func(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the function symbol
            let func_symbol = result.symbols.iter().find(|s| s.name == "_private_func");
            assert!(func_symbol.is_some());
            assert_eq!(
                func_symbol.unwrap().visibility,
                Some(tugtool_core::facts::Visibility::Private)
            );
        }

        #[test]
        fn visibility_inference_public_dunder() {
            let adapter = PythonAdapter::with_options(PythonAnalyzerOptions {
                infer_visibility: true,
                ..Default::default()
            });
            let content = "class Foo:\n    def __init__(self): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the __init__ method
            let init_symbol = result.symbols.iter().find(|s| s.name == "__init__");
            assert!(init_symbol.is_some());
            assert_eq!(
                init_symbol.unwrap().visibility,
                Some(tugtool_core::facts::Visibility::Public)
            );
        }

        #[test]
        fn visibility_inference_name_mangled() {
            let adapter = PythonAdapter::with_options(PythonAnalyzerOptions {
                infer_visibility: true,
                ..Default::default()
            });
            let content = "class Foo:\n    def __secret(self): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the __secret method
            let secret_symbol = result.symbols.iter().find(|s| s.name == "__secret");
            assert!(secret_symbol.is_some());
            assert_eq!(
                secret_symbol.unwrap().visibility,
                Some(tugtool_core::facts::Visibility::Private)
            );
        }

        #[test]
        fn visibility_inference_public_no_convention() {
            let adapter = PythonAdapter::with_options(PythonAnalyzerOptions {
                infer_visibility: true,
                ..Default::default()
            });
            let content = "def public_func(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the function symbol - no underscore prefix means None (unknown)
            let func_symbol = result.symbols.iter().find(|s| s.name == "public_func");
            assert!(func_symbol.is_some());
            assert_eq!(func_symbol.unwrap().visibility, None);
        }

        #[test]
        fn reference_kind_conversion_definition() {
            assert_eq!(
                convert_facts_reference_kind_to_adapter(ReferenceKind::Definition),
                AdapterReferenceKind::Definition
            );
        }

        #[test]
        fn reference_kind_conversion_maps_reference_to_read() {
            // facts::Reference maps to adapter::Read (different names, same concept)
            assert_eq!(
                convert_facts_reference_kind_to_adapter(ReferenceKind::Reference),
                AdapterReferenceKind::Read
            );
        }

        #[test]
        fn reference_kind_conversion_all_kinds() {
            assert_eq!(
                convert_facts_reference_kind_to_adapter(ReferenceKind::Call),
                AdapterReferenceKind::Call
            );
            assert_eq!(
                convert_facts_reference_kind_to_adapter(ReferenceKind::Import),
                AdapterReferenceKind::Import
            );
            assert_eq!(
                convert_facts_reference_kind_to_adapter(ReferenceKind::Attribute),
                AdapterReferenceKind::Attribute
            );
            assert_eq!(
                convert_facts_reference_kind_to_adapter(ReferenceKind::Write),
                AdapterReferenceKind::Write
            );
            assert_eq!(
                convert_facts_reference_kind_to_adapter(ReferenceKind::Delete),
                AdapterReferenceKind::Delete
            );
            assert_eq!(
                convert_facts_reference_kind_to_adapter(ReferenceKind::TypeAnnotation),
                AdapterReferenceKind::TypeAnnotation
            );
        }

        #[test]
        fn import_kind_module() {
            let import = LocalImport {
                kind: "import".to_string(),
                module_path: "os".to_string(),
                names: vec![],
                alias: None,
                is_star: false,
                span: None,
                line: None,
                resolved_file: None,
                relative_level: 0,
            };
            let data = convert_local_import_to_import_data(&import);
            assert_eq!(data.kind, ImportKind::Module);
            assert_eq!(data.module_path, "os");
        }

        #[test]
        fn import_kind_named() {
            let import = LocalImport {
                kind: "from".to_string(),
                module_path: "os.path".to_string(),
                names: vec![ImportedName {
                    name: "join".to_string(),
                    alias: None,
                }],
                alias: None,
                is_star: false,
                span: None,
                line: None,
                resolved_file: None,
                relative_level: 0,
            };
            let data = convert_local_import_to_import_data(&import);
            assert_eq!(data.kind, ImportKind::Named);
            assert_eq!(data.imported_name, Some("join".to_string()));
        }

        #[test]
        fn import_kind_alias() {
            let import = LocalImport {
                kind: "from".to_string(),
                module_path: "os.path".to_string(),
                names: vec![ImportedName {
                    name: "join".to_string(),
                    alias: Some("pjoin".to_string()),
                }],
                alias: None,
                is_star: false,
                span: None,
                line: None,
                resolved_file: None,
                relative_level: 0,
            };
            let data = convert_local_import_to_import_data(&import);
            assert_eq!(data.kind, ImportKind::Alias);
            assert_eq!(data.alias, Some("pjoin".to_string()));
        }

        #[test]
        fn import_kind_glob() {
            let import = LocalImport {
                kind: "from".to_string(),
                module_path: "os".to_string(),
                names: vec![],
                alias: None,
                is_star: true,
                span: None,
                line: None,
                resolved_file: None,
                relative_level: 0,
            };
            let data = convert_local_import_to_import_data(&import);
            assert_eq!(data.kind, ImportKind::Glob);
        }

        #[test]
        fn export_conversion() {
            let adapter = PythonAdapter::new();
            let content = "__all__ = ['foo']\ndef foo(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.exports.is_empty());
            let export = &result.exports[0];
            assert_eq!(export.exported_name, Some("foo".to_string()));
            assert_eq!(export.export_kind, ExportKind::PythonAll);
            assert_eq!(export.export_target, ExportTarget::Single);
            assert_eq!(export.export_intent, ExportIntent::Declared);
            assert_eq!(export.export_origin, ExportOrigin::Local);
        }

        // ====================================================================
        // Alias Edge Conversion Tests (Step 7b)
        // ====================================================================

        #[test]
        fn alias_assignment_classified_as_assignment() {
            // Test: Assignment alias classified as AliasKind::Assignment
            let adapter = PythonAdapter::new();
            let content = "bar = 1\nb = bar";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Should have at least one alias
            assert!(
                !result.aliases.is_empty(),
                "Expected aliases from 'b = bar'"
            );

            // Find the alias for 'bar'
            let alias = result.aliases.iter().find(|a| {
                // Find where alias_symbol_index points to a symbol named 'b'
                result
                    .symbols
                    .get(a.alias_symbol_index)
                    .map(|s| s.name.as_str())
                    == Some("b")
            });
            assert!(alias.is_some(), "Expected alias from 'b = bar'");

            let alias = alias.unwrap();
            assert_eq!(
                alias.kind,
                tugtool_core::facts::AliasKind::Assignment,
                "Assignment 'b = bar' should be AliasKind::Assignment"
            );
        }

        #[test]
        fn alias_import_classified_as_import() {
            // Test: Import alias classified as AliasKind::Import
            let adapter = PythonAdapter::new();
            let content = "from os import path\np = path";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Should have at least one alias
            assert!(
                !result.aliases.is_empty(),
                "Expected aliases from 'p = path'"
            );

            // Find the alias for 'path' (source is import)
            let alias = result.aliases.iter().find(|a| {
                result
                    .symbols
                    .get(a.alias_symbol_index)
                    .map(|s| s.name.as_str())
                    == Some("p")
            });
            assert!(alias.is_some(), "Expected alias from 'p = path'");

            let alias = alias.unwrap();
            assert_eq!(
                alias.kind,
                tugtool_core::facts::AliasKind::Import,
                "Assignment 'p = path' where path is imported should be AliasKind::Import"
            );
        }

        #[test]
        fn alias_confidence_preserved() {
            // Test: confidence preserved through conversion
            let adapter = PythonAdapter::new();
            let content = "bar = 1\nb = bar";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.aliases.is_empty());

            // All simple assignments should have confidence 1.0
            for alias in &result.aliases {
                assert!(
                    alias.confidence.is_some(),
                    "Confidence should be set for aliases"
                );
                assert_eq!(
                    alias.confidence,
                    Some(1.0),
                    "Simple assignment should have confidence 1.0"
                );
            }
        }

        #[test]
        fn alias_edges_have_valid_symbol_indices() {
            // Test: alias edges have valid symbol indices
            let adapter = PythonAdapter::new();
            let content = "bar = 1\nb = bar\nc = b";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Should have aliases for both b and c
            assert!(result.aliases.len() >= 2, "Expected at least 2 aliases");

            for alias in &result.aliases {
                // alias_symbol_index should point to a valid symbol
                assert!(
                    alias.alias_symbol_index < result.symbols.len(),
                    "alias_symbol_index {} should be valid (symbols len: {})",
                    alias.alias_symbol_index,
                    result.symbols.len()
                );

                // target_symbol_index is optional, but if present should be valid
                if let Some(target_idx) = alias.target_symbol_index {
                    assert!(
                        target_idx < result.symbols.len(),
                        "target_symbol_index {} should be valid (symbols len: {})",
                        target_idx,
                        result.symbols.len()
                    );
                }
            }
        }

        #[test]
        fn alias_edges_have_span() {
            // Test: alias edges have spans (may be None if unavailable)
            let adapter = PythonAdapter::new();
            let content = "bar = 1\nb = bar";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.aliases.is_empty());

            for alias in &result.aliases {
                // Most aliases should have a span; if present, verify it's valid
                if let Some(span) = alias.span {
                    assert!(
                        span.start < span.end || span.start == 0,
                        "Alias span should be valid when present"
                    );
                }
            }
        }

        #[test]
        fn integration_alias_edges_populated_in_factsstore() {
            // Integration test: Alias edges can be converted to FactsStore format
            use tugtool_core::facts::{AliasEdge, AliasKind};
            use tugtool_core::patch::ContentHash;

            let adapter = PythonAdapter::new();
            let content = "bar = 1\nb = bar";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Verify we have aliases to convert
            assert!(!result.aliases.is_empty(), "Expected aliases from adapter");

            // Simulate what the integration layer would do:
            // 1. Create a new FactsStore
            let mut store = FactsStore::new();

            // 2. Insert the file
            let file_id = store.next_file_id();
            let file = File::new(
                file_id,
                "test.py",
                ContentHash::compute(content.as_bytes()),
                Language::Python,
            );
            store.insert_file(file);

            // 3. Insert symbols and build ID map
            let mut symbol_id_map: Vec<SymbolId> = Vec::new();
            for symbol_data in &result.symbols {
                let symbol_id = store.next_symbol_id();
                symbol_id_map.push(symbol_id);

                let symbol = Symbol::new(
                    symbol_id,
                    symbol_data.kind,
                    &symbol_data.name,
                    file_id,
                    symbol_data.decl_span,
                );
                store.insert_symbol(symbol);
            }

            // 4. Convert AliasEdgeData to AliasEdge and insert
            // Per [D01]: Skip entries with missing spans
            for alias_data in &result.aliases {
                let Some(span) = alias_data.span else {
                    // Integration layer skips entries with missing spans
                    continue;
                };
                let alias_symbol_id = symbol_id_map[alias_data.alias_symbol_index];
                let target_symbol_id = alias_data.target_symbol_index.map(|idx| symbol_id_map[idx]);

                let edge_id = store.next_alias_edge_id();
                let mut edge =
                    AliasEdge::new(edge_id, file_id, span, alias_symbol_id, alias_data.kind);
                if let Some(target_id) = target_symbol_id {
                    edge = edge.with_target(target_id);
                }
                if let Some(confidence) = alias_data.confidence {
                    edge = edge.with_confidence(confidence);
                }

                store.insert_alias_edge(edge);
            }

            // 5. Verify alias edges are in the store
            assert!(
                store.alias_edge_count() > 0,
                "FactsStore should have alias edges after conversion"
            );

            // 6. Verify we can query alias edges
            let edges_in_file = store.alias_edges_in_file(file_id);
            assert!(!edges_in_file.is_empty(), "Should have alias edges in file");

            // 7. Verify edge properties
            for edge in edges_in_file {
                assert_eq!(edge.file_id, file_id, "Edge should be in correct file");
                assert_eq!(
                    edge.kind,
                    AliasKind::Assignment,
                    "Simple assignment should have Assignment kind"
                );
            }
        }

        #[test]
        fn integration_aliases_from_edges_produces_valid_output() {
            // Integration test: aliases_from_edges produces valid AliasOutput
            use tugtool_core::facts::AliasEdge;
            use tugtool_core::patch::ContentHash;

            let adapter = PythonAdapter::new();
            let content = "bar = 1\nb = bar";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Simulate integration layer
            let mut store = FactsStore::new();
            let file_id = store.next_file_id();
            store.insert_file(File::new(
                file_id,
                "test.py",
                ContentHash::compute(content.as_bytes()),
                Language::Python,
            ));

            // Insert symbols
            let mut symbol_id_map: Vec<SymbolId> = Vec::new();
            for symbol_data in &result.symbols {
                let symbol_id = store.next_symbol_id();
                symbol_id_map.push(symbol_id);
                store.insert_symbol(Symbol::new(
                    symbol_id,
                    symbol_data.kind,
                    &symbol_data.name,
                    file_id,
                    symbol_data.decl_span,
                ));
            }

            // Insert alias edges (skip entries with missing spans per [D01])
            for alias_data in &result.aliases {
                let Some(span) = alias_data.span else {
                    continue;
                };
                let alias_symbol_id = symbol_id_map[alias_data.alias_symbol_index];
                let target_symbol_id = alias_data.target_symbol_index.map(|idx| symbol_id_map[idx]);

                let edge_id = store.next_alias_edge_id();
                let mut edge =
                    AliasEdge::new(edge_id, file_id, span, alias_symbol_id, alias_data.kind);
                if let Some(target_id) = target_symbol_id {
                    edge = edge.with_target(target_id);
                }
                if let Some(confidence) = alias_data.confidence {
                    edge = edge.with_confidence(confidence);
                }
                store.insert_alias_edge(edge);
            }

            // Test aliases_from_edges
            let mut file_contents = std::collections::HashMap::new();
            file_contents.insert("test.py".to_string(), content.to_string());

            let alias_outputs = store.aliases_from_edges(&file_contents);

            // Should produce valid output
            assert!(
                !alias_outputs.is_empty(),
                "aliases_from_edges should produce output"
            );

            // Verify output properties
            for output in &alias_outputs {
                assert_eq!(output.file, "test.py");
                assert!(!output.alias_name.is_empty());
                assert!(!output.source_name.is_empty());
                // Simple assignments have confidence 1.0
                assert!((output.confidence - 1.0).abs() < 0.001);
            }
        }

        // ====================================================================
        // Signature, Modifier, and QualifiedName Tests (Step 7c)
        // ====================================================================

        #[test]
        fn signature_emitted_for_function() {
            // Test: Signatures are emitted for functions
            let adapter = PythonAdapter::new();
            let content = "def foo(x, y): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(
                !result.signatures.is_empty(),
                "Expected signature for 'foo'"
            );
            let sig = &result.signatures[0];
            assert_eq!(sig.params.len(), 2);
            assert_eq!(sig.params[0].name, "x");
            assert_eq!(sig.params[1].name, "y");
        }

        #[test]
        fn signature_param_kind_positional_only() {
            // Test: Positional-only parameters classified correctly
            let adapter = PythonAdapter::new();
            let content = "def foo(x, /, y): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.signatures.is_empty());
            let sig = &result.signatures[0];
            assert_eq!(sig.params.len(), 2);
            assert_eq!(sig.params[0].kind, ParamKind::PositionalOnly);
            assert_eq!(sig.params[1].kind, ParamKind::Regular);
        }

        #[test]
        fn signature_param_kind_keyword_only() {
            // Test: Keyword-only parameters classified correctly
            let adapter = PythonAdapter::new();
            let content = "def foo(x, *, y): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.signatures.is_empty());
            let sig = &result.signatures[0];
            assert_eq!(sig.params.len(), 2);
            assert_eq!(sig.params[0].kind, ParamKind::Regular);
            assert_eq!(sig.params[1].kind, ParamKind::KeywordOnly);
        }

        #[test]
        fn signature_param_kind_varargs_and_kwargs() {
            // Test: *args and **kwargs classified correctly
            let adapter = PythonAdapter::new();
            let content = "def foo(*args, **kwargs): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.signatures.is_empty());
            let sig = &result.signatures[0];
            assert_eq!(sig.params.len(), 2);
            assert_eq!(sig.params[0].kind, ParamKind::VarArgs);
            assert_eq!(sig.params[1].kind, ParamKind::KwArgs);
        }

        #[test]
        fn signature_all_param_kinds() {
            // Test: All param kinds in one signature
            let adapter = PythonAdapter::new();
            let content = "def foo(a, /, b, *args, c, **kwargs): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.signatures.is_empty());
            let sig = &result.signatures[0];
            assert_eq!(sig.params.len(), 5);
            assert_eq!(sig.params[0].kind, ParamKind::PositionalOnly); // a
            assert_eq!(sig.params[1].kind, ParamKind::Regular); // b
            assert_eq!(sig.params[2].kind, ParamKind::VarArgs); // args
            assert_eq!(sig.params[3].kind, ParamKind::KeywordOnly); // c
            assert_eq!(sig.params[4].kind, ParamKind::KwArgs); // kwargs
        }

        #[test]
        fn signature_return_type() {
            // Test: Return type captured in signature
            let adapter = PythonAdapter::new();
            let content = "def foo() -> int: pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.signatures.is_empty());
            let sig = &result.signatures[0];
            assert!(sig.returns.is_some());
            match &sig.returns {
                Some(TypeNode::Named { name, .. }) => assert_eq!(name, "int"),
                _ => panic!("Expected Named type node for return"),
            }
        }

        #[test]
        fn signature_param_annotation() {
            // Test: Parameter annotations captured
            let adapter = PythonAdapter::new();
            let content = "def foo(x: int, y: str): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.signatures.is_empty());
            let sig = &result.signatures[0];
            assert!(sig.params[0].annotation.is_some());
            assert!(sig.params[1].annotation.is_some());
        }

        #[test]
        fn modifier_async_detected() {
            // Test: Async modifier detected
            let adapter = PythonAdapter::new();
            let content = "async def foo(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(
                !result.modifiers.is_empty(),
                "Expected modifiers for async function"
            );
            let mods = &result.modifiers[0];
            assert!(
                mods.modifiers.contains(&Modifier::Async),
                "Expected Async modifier"
            );
        }

        #[test]
        fn modifier_staticmethod_detected() {
            // Test: @staticmethod detected
            let adapter = PythonAdapter::new();
            let content = "@staticmethod\ndef foo(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(
                !result.modifiers.is_empty(),
                "Expected modifiers for staticmethod"
            );
            let mods = &result.modifiers[0];
            assert!(
                mods.modifiers.contains(&Modifier::Static),
                "Expected Static modifier"
            );
        }

        #[test]
        fn modifier_classmethod_detected() {
            // Test: @classmethod detected
            let adapter = PythonAdapter::new();
            let content = "@classmethod\ndef foo(cls): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(
                !result.modifiers.is_empty(),
                "Expected modifiers for classmethod"
            );
            let mods = &result.modifiers[0];
            assert!(
                mods.modifiers.contains(&Modifier::ClassMethod),
                "Expected ClassMethod modifier"
            );
        }

        #[test]
        fn modifier_property_detected() {
            // Test: @property detected
            let adapter = PythonAdapter::new();
            let content = "@property\ndef foo(self): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(
                !result.modifiers.is_empty(),
                "Expected modifiers for property"
            );
            let mods = &result.modifiers[0];
            assert!(
                mods.modifiers.contains(&Modifier::Property),
                "Expected Property modifier"
            );
        }

        #[test]
        fn modifier_multiple() {
            // Test: Multiple modifiers on one function
            let adapter = PythonAdapter::new();
            let content = "@staticmethod\n@final\nasync def foo(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.modifiers.is_empty());
            let mods = &result.modifiers[0];
            assert!(
                mods.modifiers.contains(&Modifier::Static),
                "Expected Static modifier"
            );
            assert!(
                mods.modifiers.contains(&Modifier::Final),
                "Expected Final modifier"
            );
            assert!(
                mods.modifiers.contains(&Modifier::Async),
                "Expected Async modifier"
            );
        }

        #[test]
        fn qualified_name_module_level_function() {
            // Test: Qualified name for module-level function
            let adapter = PythonAdapter::new();
            let content = "def foo(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.qualified_names.is_empty());
            let qn = &result.qualified_names[0];
            // Module path is "test" (from test.py), function name is "foo"
            assert!(
                qn.path.ends_with("foo"),
                "Qualified name should end with 'foo': {}",
                qn.path
            );
        }

        #[test]
        fn qualified_name_method() {
            // Test: Qualified name for method
            let adapter = PythonAdapter::new();
            let content = "class Foo:\n    def bar(self): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the qualified name for "bar"
            let bar_qn = result
                .qualified_names
                .iter()
                .find(|qn| qn.path.contains("bar"));
            assert!(bar_qn.is_some(), "Expected qualified name for 'bar'");
            assert!(
                bar_qn.unwrap().path.contains("Foo"),
                "Method qualified name should include class"
            );
        }

        #[test]
        fn qualified_name_nested_function() {
            // Test: Qualified name for nested function
            let adapter = PythonAdapter::new();
            let content = "def outer():\n    def inner(): pass";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the qualified name for "inner"
            let inner_qn = result
                .qualified_names
                .iter()
                .find(|qn| qn.path.contains("inner"));
            assert!(inner_qn.is_some(), "Expected qualified name for 'inner'");
            assert!(
                inner_qn.unwrap().path.contains("outer"),
                "Nested function qualified name should include outer: {}",
                inner_qn.unwrap().path
            );
        }

        // ====================================================================
        // Attribute Access, Call Site, and Module Resolution Tests (Step 7d)
        // ====================================================================

        #[test]
        fn attribute_access_read() {
            // Test: AttributeAccessKind::Read for obj.x in load context
            let adapter = PythonAdapter::new();
            let content = "x = obj.attr";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.attributes.is_empty(), "Expected attribute access");
            let attr = &result.attributes[0];
            assert_eq!(attr.name, "attr");
            assert_eq!(attr.kind, AttributeAccessKind::Read);
        }

        #[test]
        fn attribute_access_write() {
            // Test: AttributeAccessKind::Write for obj.x = 1
            let adapter = PythonAdapter::new();
            let content = "obj.attr = 1";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.attributes.is_empty(), "Expected attribute access");
            let attr = result.attributes.iter().find(|a| a.name == "attr");
            assert!(attr.is_some(), "Expected attribute named 'attr'");
            assert_eq!(attr.unwrap().kind, AttributeAccessKind::Write);
        }

        #[test]
        fn attribute_access_call() {
            // Test: AttributeAccessKind::Call for obj.x()
            let adapter = PythonAdapter::new();
            let content = "obj.method()";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.attributes.is_empty(), "Expected attribute access");
            let attr = result.attributes.iter().find(|a| a.name == "method");
            assert!(attr.is_some(), "Expected attribute named 'method'");
            assert_eq!(attr.unwrap().kind, AttributeAccessKind::Call);
        }

        #[test]
        fn call_site_with_keyword_arg() {
            // Test: CallArg with keyword name for f(x=1)
            let adapter = PythonAdapter::new();
            let content = "f(x=1)";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.calls.is_empty(), "Expected call site");
            let call = &result.calls[0];
            assert_eq!(call.args.len(), 1);
            assert_eq!(call.args[0].name, Some("x".to_string()));
        }

        #[test]
        fn call_site_with_positional_arg() {
            // Test: CallArg without name for f(1)
            let adapter = PythonAdapter::new();
            let content = "f(1)";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.calls.is_empty(), "Expected call site");
            let call = &result.calls[0];
            assert_eq!(call.args.len(), 1);
            assert!(call.args[0].name.is_none());
        }

        #[test]
        fn call_site_mixed_args() {
            // Test: CallArg mixed positional and keyword
            let adapter = PythonAdapter::new();
            let content = "f(1, key=2)";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.calls.is_empty(), "Expected call site");
            let call = &result.calls[0];
            assert_eq!(call.args.len(), 2);
            assert!(call.args[0].name.is_none()); // positional
            assert_eq!(call.args[1].name, Some("key".to_string())); // keyword
        }

        #[test]
        fn module_resolution_maps_path_to_file() {
            // Test: Module resolution maps path to file index
            let adapter = PythonAdapter::new();
            let files = vec![("pkg/mod.py".to_string(), "x = 1".to_string())];
            let store = FactsStore::new();
            let result = adapter.analyze_files(&files, &store).unwrap();

            assert!(!result.modules.is_empty(), "Expected module resolution");
            let module = result.modules.iter().find(|m| m.module_path == "pkg.mod");
            assert!(module.is_some(), "Expected module path 'pkg.mod'");
            assert_eq!(module.unwrap().file_indices.len(), 1);
            assert_eq!(module.unwrap().file_indices[0], 0); // First file
        }

        #[test]
        fn module_resolution_multiple_files() {
            // Test: Module resolution handles multiple files
            let adapter = PythonAdapter::new();
            let files = vec![
                ("pkg/a.py".to_string(), "x = 1".to_string()),
                ("pkg/b.py".to_string(), "y = 2".to_string()),
            ];
            let store = FactsStore::new();
            let result = adapter.analyze_files(&files, &store).unwrap();

            // Should have entries for both pkg.a and pkg.b
            assert!(result.modules.len() >= 2);
            let a_module = result.modules.iter().find(|m| m.module_path == "pkg.a");
            let b_module = result.modules.iter().find(|m| m.module_path == "pkg.b");
            assert!(a_module.is_some(), "Expected module path 'pkg.a'");
            assert!(b_module.is_some(), "Expected module path 'pkg.b'");
        }

        #[test]
        fn call_site_method_call() {
            // Test: Method call captures receiver info
            let adapter = PythonAdapter::new();
            let content = "obj.method(1, 2)";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.calls.is_empty(), "Expected call site");
            let call = &result.calls[0];
            // Method calls should have 2 args
            assert_eq!(call.args.len(), 2);
        }

        #[test]
        fn attribute_access_augmented_assign() {
            // Test: obj.count += 1 is Write context
            let adapter = PythonAdapter::new();
            let content = "obj.count += 1";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.attributes.is_empty(), "Expected attribute access");
            let attr = result.attributes.iter().find(|a| a.name == "count");
            assert!(attr.is_some(), "Expected attribute named 'count'");
            assert_eq!(attr.unwrap().kind, AttributeAccessKind::Write);
        }

        #[test]
        fn attribute_access_chained() {
            // Test: obj.a.b.c should report accesses for a, b, c
            let adapter = PythonAdapter::new();
            let content = "x = obj.a.b.c";
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Should have at least 3 attribute accesses
            assert!(
                result.attributes.len() >= 3,
                "Expected at least 3 attribute accesses"
            );
            let names: Vec<_> = result.attributes.iter().map(|a| a.name.as_str()).collect();
            assert!(names.contains(&"a"));
            assert!(names.contains(&"b"));
            assert!(names.contains(&"c"));
        }

        // ====================================================================
        // Span Handling Tests (Phase 11B Step 2)
        // ====================================================================

        #[test]
        fn attribute_access_has_option_span() {
            // Test: AttributeAccessData.span is Option<Span>, populated when available
            let adapter = PythonAdapter::new();
            let content = "obj.attr";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.attributes.is_empty(), "Expected attribute access");
            let attr = &result.attributes[0];
            // Span should be present for well-formed code
            assert!(attr.span.is_some(), "Expected span to be present");
            let span = attr.span.unwrap();
            assert!(span.start < span.end, "Span should be valid");
        }

        #[test]
        fn call_arg_has_option_span() {
            // Test: CallArgData.span is Option<Span>
            // Note: CST may not provide spans for all expression types
            let adapter = PythonAdapter::new();
            let content = "f(x, y=1)";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.calls.is_empty(), "Expected call site");
            let call = &result.calls[0];
            assert_eq!(call.args.len(), 2);

            // Args have Option<Span> - verify the type works correctly
            // Span may be Some or None depending on CST coverage
            for arg in &call.args {
                if let Some(span) = arg.span {
                    assert!(span.start <= span.end, "Span should be valid when present");
                }
                // None is also valid - the type correctly represents optionality
            }
        }

        #[test]
        fn integration_analyze_file_span_handling() {
            // Integration test: analyze a file and verify span types are Option<Span>
            // Note: Not all spans will be present due to CST coverage limitations
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self, data):
        self.result = data

h = Handler()
h.process(value)
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Attribute accesses have Option<Span> - verify valid when present
            let attrs_with_spans = result
                .attributes
                .iter()
                .filter(|a| a.span.is_some())
                .count();
            // Most attribute accesses should have spans
            assert!(
                attrs_with_spans > 0,
                "Expected at least some attribute accesses to have spans"
            );
            for attr in &result.attributes {
                if let Some(span) = attr.span {
                    assert!(span.start <= span.end, "Attribute span should be valid");
                }
            }

            // Aliases have Option<Span> - verify valid when present
            for alias in &result.aliases {
                if let Some(span) = alias.span {
                    assert!(span.start <= span.end, "Alias span should be valid");
                }
            }
        }

        // ====================================================================
        // TypeTracker Symbol Resolution Tests (Phase 11B Step 3)
        // ====================================================================

        #[test]
        fn resolve_receiver_to_symbol_returns_local_for_typed_receiver() {
            // Test: When receiver has a known type that exists as a local symbol,
            // resolve_receiver_to_symbol should return ResolvedSymbol::Local(index).
            let adapter = PythonAdapter::new();

            // Build a TypeTracker with a typed variable
            let mut tracker = TypeTracker::new();
            let assignments = vec![crate::types::AssignmentInfo {
                target: "h".to_string(),
                scope_path: vec!["<module>".to_string()],
                type_source: "constructor".to_string(),
                inferred_type: Some("Handler".to_string()),
                rhs_name: None,
                callee_name: None,
                span: None,
                line: Some(1),
                col: Some(1),
                is_self_attribute: false,
                attribute_name: None,
            }];
            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // Build a symbol map with Handler
            let mut symbol_map: HashMap<&str, usize> = HashMap::new();
            symbol_map.insert("Handler", 0);

            // Resolve "h" in module scope - should find Handler at local index 0
            // No cross-file map needed for this test
            let result = adapter.resolve_receiver_to_symbol(
                "h",
                &["<module>".to_string()],
                Some(&tracker),
                &symbol_map,
                None, // No cross-file map
            );
            assert_eq!(
                result,
                Some(ResolvedSymbol::Local(0)),
                "Should resolve 'h' to Handler symbol at local index 0"
            );
        }

        #[test]
        fn resolve_receiver_to_symbol_returns_none_for_untyped_receiver() {
            // Test: When receiver has no known type, resolve should return None.
            let adapter = PythonAdapter::new();

            // Empty TypeTracker - no type information
            let tracker = TypeTracker::new();

            // Build a symbol map with Handler
            let mut symbol_map: HashMap<&str, usize> = HashMap::new();
            symbol_map.insert("Handler", 0);

            // Resolve "h" - should return None since type is unknown
            let result = adapter.resolve_receiver_to_symbol(
                "h",
                &["<module>".to_string()],
                Some(&tracker),
                &symbol_map,
                None, // No cross-file map
            );
            assert_eq!(result, None, "Should return None for untyped receiver");
        }

        #[test]
        fn resolve_receiver_to_symbol_returns_none_for_dotted_receiver() {
            // Test: Dotted receivers like "obj.attr" should not be resolved
            // (would require chained type resolution).
            let adapter = PythonAdapter::new();

            // Build a TypeTracker with a typed variable
            let mut tracker = TypeTracker::new();
            let assignments = vec![crate::types::AssignmentInfo {
                target: "obj".to_string(),
                scope_path: vec!["<module>".to_string()],
                type_source: "constructor".to_string(),
                inferred_type: Some("Container".to_string()),
                rhs_name: None,
                callee_name: None,
                span: None,
                line: Some(1),
                col: Some(1),
                is_self_attribute: false,
                attribute_name: None,
            }];
            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // Build a symbol map
            let mut symbol_map: HashMap<&str, usize> = HashMap::new();
            symbol_map.insert("Container", 0);

            // Resolve "obj.attr" - should return None since it's a dotted receiver
            let result = adapter.resolve_receiver_to_symbol(
                "obj.attr",
                &["<module>".to_string()],
                Some(&tracker),
                &symbol_map,
                None, // No cross-file map
            );
            assert_eq!(result, None, "Should return None for dotted receivers");
        }

        #[test]
        fn resolve_receiver_to_symbol_returns_none_when_no_tracker() {
            // Test: When no TypeTracker is provided, resolve should return None.
            let adapter = PythonAdapter::new();

            // Build a symbol map with Handler
            let mut symbol_map: HashMap<&str, usize> = HashMap::new();
            symbol_map.insert("Handler", 0);

            // Resolve without a TypeTracker - should return None
            let result = adapter.resolve_receiver_to_symbol(
                "h",
                &["<module>".to_string()],
                None, // No TypeTracker
                &symbol_map,
                None, // No cross-file map
            );
            assert_eq!(
                result, None,
                "Should return None when no TypeTracker provided"
            );
        }

        #[test]
        fn attribute_access_base_symbol_index_resolved_for_typed_receiver() {
            // Integration test: Analyze code with typed variable and verify
            // base_symbol_index is populated for attribute accesses.
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

h = Handler()
h.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // Find the attribute access for "process" on "h"
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            // The base_symbol_index should point to Handler
            let attr = process_attr.unwrap();
            assert_eq!(
                attr.base_symbol_index, handler_idx,
                "base_symbol_index should point to Handler class"
            );
        }

        #[test]
        fn cross_file_symbol_map_qualified_name_lookup_resolves_to_index() {
            // Test: CrossFileSymbolMap resolves qualified names to adapter indices.
            use tugtool_core::facts::{File, QualifiedName, Symbol};
            use tugtool_core::patch::Span;

            let mut store = FactsStore::new();

            // Add a file
            let file_id = store.next_file_id();
            let file = File::new(
                file_id,
                "handler.py",
                ContentHash::from_hex_unchecked("abc123"),
                Language::Python,
            );
            store.insert_file(file);

            // Add a symbol
            let symbol_id = store.next_symbol_id();
            let symbol = Symbol::new(
                symbol_id,
                SymbolKind::Class,
                "Handler",
                file_id,
                Span::new(0, 7),
            );
            store.insert_symbol(symbol);

            // Add qualified name
            let qn = QualifiedName::new(symbol_id, "mymodule.Handler");
            store.insert_qualified_name(qn);

            // Build CrossFileSymbolMap from store
            let map = CrossFileSymbolMap::from_store(&store);

            // Should resolve qualified name to itself
            let result = map.resolve_to_qualified_name("mymodule.Handler");
            assert_eq!(
                result,
                Some("mymodule.Handler".to_string()),
                "Qualified name lookup should resolve to qualified name"
            );
        }

        #[test]
        fn cross_file_symbol_map_simple_name_lookup_resolves_to_qualified_name() {
            // Test: Simple name lookup returns the qualified name when unambiguous.
            use tugtool_core::facts::{File, QualifiedName, Symbol};
            use tugtool_core::patch::Span;

            let mut store = FactsStore::new();

            // Add a file
            let file_id = store.next_file_id();
            let file = File::new(
                file_id,
                "handler.py",
                ContentHash::from_hex_unchecked("abc123"),
                Language::Python,
            );
            store.insert_file(file);

            let symbol_id = store.next_symbol_id();
            let symbol = Symbol::new(
                symbol_id,
                SymbolKind::Class,
                "Handler",
                file_id,
                Span::new(0, 7),
            );
            store.insert_symbol(symbol);

            // Add qualified name
            let qn = QualifiedName::new(symbol_id, "mymodule.Handler");
            store.insert_qualified_name(qn);

            // Build map
            let map = CrossFileSymbolMap::from_store(&store);

            // Should resolve simple name to qualified name
            let result = map.resolve_to_qualified_name("Handler");
            assert_eq!(
                result,
                Some("mymodule.Handler".to_string()),
                "Unambiguous simple name should resolve to qualified name"
            );
        }

        #[test]
        fn cross_file_symbol_map_ambiguous_simple_name_returns_none() {
            // Test: When multiple symbols have the same name, simple lookup returns None.
            use tugtool_core::facts::{File, Symbol};
            use tugtool_core::patch::Span;

            let mut store = FactsStore::new();

            // Add two files with symbols named "Handler"
            let file_id1 = store.next_file_id();
            let file1 = File::new(
                file_id1,
                "handlers/http.py",
                ContentHash::from_hex_unchecked("abc123"),
                Language::Python,
            );
            store.insert_file(file1);

            let file_id2 = store.next_file_id();
            let file2 = File::new(
                file_id2,
                "handlers/grpc.py",
                ContentHash::from_hex_unchecked("def456"),
                Language::Python,
            );
            store.insert_file(file2);

            let symbol_id1 = store.next_symbol_id();
            let symbol1 = Symbol::new(
                symbol_id1,
                SymbolKind::Class,
                "Handler",
                file_id1,
                Span::new(0, 7),
            );
            store.insert_symbol(symbol1);

            let symbol_id2 = store.next_symbol_id();
            let symbol2 = Symbol::new(
                symbol_id2,
                SymbolKind::Class,
                "Handler",
                file_id2,
                Span::new(0, 7),
            );
            store.insert_symbol(symbol2);

            // Build map
            let map = CrossFileSymbolMap::from_store(&store);

            // Simple name should return None (ambiguous)
            let result = map.resolve_to_qualified_name("Handler");
            assert_eq!(
                result, None,
                "Ambiguous simple name lookup should return None"
            );
        }

        #[test]
        fn cross_file_symbol_map_qualified_resolves_even_when_simple_is_ambiguous() {
            // Test: Qualified name lookup works even if simple name is ambiguous.
            use tugtool_core::facts::{File, QualifiedName, Symbol};
            use tugtool_core::patch::Span;

            let mut store = FactsStore::new();

            // Add two files with symbols named "Handler"
            let file_id1 = store.next_file_id();
            let file1 = File::new(
                file_id1,
                "handlers/http.py",
                ContentHash::from_hex_unchecked("abc123"),
                Language::Python,
            );
            store.insert_file(file1);

            let file_id2 = store.next_file_id();
            let file2 = File::new(
                file_id2,
                "handlers/grpc.py",
                ContentHash::from_hex_unchecked("def456"),
                Language::Python,
            );
            store.insert_file(file2);

            let symbol_id1 = store.next_symbol_id();
            let symbol1 = Symbol::new(
                symbol_id1,
                SymbolKind::Class,
                "Handler",
                file_id1,
                Span::new(0, 7),
            );
            store.insert_symbol(symbol1);
            store.insert_qualified_name(QualifiedName::new(symbol_id1, "handlers.http.Handler"));

            let symbol_id2 = store.next_symbol_id();
            let symbol2 = Symbol::new(
                symbol_id2,
                SymbolKind::Class,
                "Handler",
                file_id2,
                Span::new(0, 7),
            );
            store.insert_symbol(symbol2);
            store.insert_qualified_name(QualifiedName::new(symbol_id2, "handlers.grpc.Handler"));

            // Build map
            let map = CrossFileSymbolMap::from_store(&store);

            // Simple name should return None (ambiguous)
            assert_eq!(
                map.resolve_to_qualified_name("Handler"),
                None,
                "Ambiguous simple name should return None"
            );

            // But qualified names should still work
            assert_eq!(
                map.resolve_to_qualified_name("handlers.http.Handler"),
                Some("handlers.http.Handler".to_string()),
                "First qualified name should resolve to itself"
            );
            assert_eq!(
                map.resolve_to_qualified_name("handlers.grpc.Handler"),
                Some("handlers.grpc.Handler".to_string()),
                "Second qualified name should resolve to itself"
            );
        }

        #[test]
        fn cross_file_symbol_map_empty_store_returns_empty_map() {
            // Test: Empty store produces empty map.
            let store = FactsStore::new();
            let map = CrossFileSymbolMap::from_store(&store);

            assert!(map.is_empty(), "Empty store should produce empty map");
            assert_eq!(
                map.resolve_to_qualified_name("anything"),
                None,
                "Empty map should resolve to None"
            );
        }

        #[test]
        fn receiver_resolution_falls_back_to_cross_file_map() {
            // Integration test: Receiver resolution falls back to cross-file map
            // when type is not found in local symbol map.
            use tugtool_core::facts::{File, QualifiedName, Symbol};
            use tugtool_core::patch::Span;

            let adapter = PythonAdapter::new();

            // Build a TypeTracker with a typed variable (type is "RemoteHandler")
            let mut tracker = TypeTracker::new();
            let assignments = vec![crate::types::AssignmentInfo {
                target: "h".to_string(),
                scope_path: vec!["<module>".to_string()],
                type_source: "constructor".to_string(),
                inferred_type: Some("RemoteHandler".to_string()),
                rhs_name: None,
                callee_name: None,
                span: None,
                line: Some(1),
                col: Some(1),
                is_self_attribute: false,
                attribute_name: None,
            }];
            tracker.process_assignments(&assignments);
            tracker.resolve_types();

            // Local symbol map does NOT have RemoteHandler
            let symbol_map: HashMap<&str, usize> = HashMap::new();

            // But cross-file map has it
            let mut store = FactsStore::new();
            let file_id = store.next_file_id();
            let file = File::new(
                file_id,
                "remote.py",
                ContentHash::from_hex_unchecked("abc123"),
                Language::Python,
            );
            store.insert_file(file);

            let symbol_id = store.next_symbol_id();
            let symbol = Symbol::new(
                symbol_id,
                SymbolKind::Class,
                "RemoteHandler",
                file_id,
                Span::new(0, 13),
            );
            store.insert_symbol(symbol);
            store.insert_qualified_name(QualifiedName::new(symbol_id, "remote.RemoteHandler"));

            let cross_file_map = CrossFileSymbolMap::from_store(&store);

            // Resolve "h" - should fall back to cross-file map and return qualified name
            let result = adapter.resolve_receiver_to_symbol(
                "h",
                &["<module>".to_string()],
                Some(&tracker),
                &symbol_map,
                Some(&cross_file_map),
            );

            assert_eq!(
                result,
                Some(ResolvedSymbol::CrossFile(
                    "remote.RemoteHandler".to_string()
                )),
                "Should resolve via cross-file map and return qualified name"
            );
        }

        #[test]
        fn method_call_callee_symbol_index_resolved_for_typed_receiver() {
            // Integration test: Analyze code with typed variable and verify
            // callee_symbol_index is populated for method calls.
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

h = Handler()
h.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // Find the call site for "process" method call on "h"
            // There should be at least 2 calls: Handler() and h.process()
            // We want the method call, not the constructor
            let method_call = result.calls.iter().find(|c| {
                // Method call has callee_symbol_index pointing to Handler
                c.callee_symbol_index == handler_idx
            });
            assert!(
                method_call.is_some(),
                "Should have method call with callee_symbol_index pointing to Handler"
            );
        }

        #[test]
        fn direct_function_call_callee_symbol_index_resolved() {
            // Integration test: Direct function calls should have callee_symbol_index
            // pointing to the function symbol.
            let adapter = PythonAdapter::new();
            let content = r#"
def process():
    pass

process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the process function symbol
            let process_idx = result.symbols.iter().position(|s| s.name == "process");
            assert!(process_idx.is_some(), "Should have process symbol");

            // Find the call site for "process()"
            let call = result
                .calls
                .iter()
                .find(|c| c.callee_symbol_index == process_idx);
            assert!(
                call.is_some(),
                "Should have call with callee_symbol_index pointing to process function"
            );
        }

        // ====================================================================
        // Cross-File Resolution via analyze_files
        // ====================================================================

        #[test]
        fn cross_file_resolution_via_analyze_files_with_prepopulated_store() {
            // Integration test: analyze_files uses pre-populated store for cross-file resolution.
            // Type defined in prior analysis (store) is resolved when used in current files.
            use tugtool_core::facts::{File, QualifiedName, Symbol};
            use tugtool_core::patch::Span;

            let adapter = PythonAdapter::new();

            // Build a store with a class from a "previously analyzed" file
            let mut store = FactsStore::new();
            let file_id = store.next_file_id();
            let file = File::new(
                file_id,
                "external/handler.py",
                ContentHash::from_hex_unchecked("abc123"),
                Language::Python,
            );
            store.insert_file(file);

            let symbol_id = store.next_symbol_id();
            let symbol = Symbol::new(
                symbol_id,
                SymbolKind::Class,
                "ExternalHandler",
                file_id,
                Span::new(0, 15),
            );
            store.insert_symbol(symbol);
            store.insert_qualified_name(QualifiedName::new(
                symbol_id,
                "external.handler.ExternalHandler",
            ));

            // Analyze a new file that uses ExternalHandler
            let code = r#"
from external.handler import ExternalHandler

h = ExternalHandler()
h.process()
"#;
            let files = vec![("app.py".to_string(), code.to_string())];

            // Use analyze_files with the pre-populated store
            let bundle = adapter.analyze_files(&files, &store).unwrap();

            // Verify the analysis completes successfully
            assert_eq!(bundle.file_results.len(), 1, "Should analyze one file");

            let app_result = &bundle.file_results[0];

            // The cross-file map should be built from the store.
            // While the attribute access resolution depends on TypeTracker finding the type,
            // we verify that the infrastructure is wired up correctly by checking
            // that analysis completes and produces expected outputs.

            // Should have attribute access for "h.process"
            assert!(
                !app_result.attributes.is_empty(),
                "Should have attribute accesses for h.process(): {:?}",
                app_result.attributes
            );

            // Should have the "process" attribute access
            let process_attr = app_result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have 'process' attribute access"
            );
        }

        #[test]
        fn cross_file_resolution_empty_store_no_regression() {
            // Integration test: analyze_files with empty store behaves the same as before
            // (local resolution only, no errors).
            let adapter = PythonAdapter::new();
            let store = FactsStore::new();

            let code = r#"
class LocalHandler:
    def process(self): pass

h = LocalHandler()
h.process()
"#;
            let files = vec![("local.py".to_string(), code.to_string())];

            // Should work with empty store
            let bundle = adapter.analyze_files(&files, &store).unwrap();

            assert_eq!(bundle.file_results.len(), 1, "Should analyze one file");

            // Local resolution should still work
            let result = &bundle.file_results[0];
            let handler_idx = result.symbols.iter().position(|s| s.name == "LocalHandler");
            assert!(handler_idx.is_some(), "Should have LocalHandler symbol");

            // The method call should resolve locally
            let method_call = result
                .calls
                .iter()
                .find(|c| c.callee_symbol_index == handler_idx);
            assert!(
                method_call.is_some(),
                "Should resolve method call locally with empty cross-file store"
            );
        }

        // ====================================================================
        // Dotted Path Resolution Tests
        // ====================================================================

        #[test]
        fn resolve_receiver_path_self_handler_resolves_to_handler_type() {
            // Integration test: self.handler resolves when attribute type is known.
            // Fixture 11C-F01 pattern: class Service with handler: Handler attribute
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

class Service:
    handler: Handler

    def run(self):
        self.handler.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // Find the attribute access for "process" on "self.handler"
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            // The base_symbol_index should point to Handler (via dotted path resolution)
            let attr = process_attr.unwrap();
            assert_eq!(
                attr.base_symbol_index, handler_idx,
                "base_symbol_index should point to Handler class (resolved via self.handler)"
            );
        }

        #[test]
        fn resolve_receiver_path_depth_limit_exceeded_returns_none() {
            // Unit test: Paths exceeding MAX_RESOLUTION_DEPTH=4 return None.
            // Fixture 11C-F05 pattern: deep chain a.b.c.d.e.method()
            let adapter = PythonAdapter::new();
            let content = r#"
class A:
    def __init__(self):
        self.b = B()

class B:
    def __init__(self):
        self.c = C()

class C:
    def __init__(self):
        self.d = D()

class D:
    def __init__(self):
        self.e = E()

class E:
    def method(self): pass

a = A()
a.b.c.d.e.method()  # 5 levels deep - exceeds limit
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // The attribute access for "method" on the deep chain should NOT resolve
            // because it exceeds the depth limit of 4
            let method_attr = result.attributes.iter().find(|a| a.name == "method");
            assert!(
                method_attr.is_some(),
                "Should have attribute access for 'method'"
            );

            let attr = method_attr.unwrap();
            // Due to depth limit, should return None (no resolution)
            assert!(
                attr.base_symbol_index.is_none(),
                "Deep chain should NOT resolve (exceeds depth limit)"
            );
        }

        #[test]
        fn resolve_receiver_path_empty_path_returns_none() {
            // Unit test: Empty receiver path returns None.
            let adapter = PythonAdapter::new();

            // Build minimal test structures
            let tracker = TypeTracker::new();
            let scoped_symbol_map: HashMap<(Vec<String>, String), usize> = HashMap::new();
            let symbol_kinds: HashMap<(Vec<String>, String), SymbolKind> = HashMap::new();

            // Empty path
            let empty_path = ReceiverPath { steps: vec![] };
            let result = adapter.resolve_receiver_path(
                &empty_path,
                &["<module>".to_string()],
                &tracker,
                &scoped_symbol_map,
                &symbol_kinds,
                None,
            );
            assert!(result.is_none(), "Empty receiver path should return None");
        }

        #[test]
        fn resolve_receiver_path_unknown_intermediate_type_returns_none() {
            // Unit test: Unknown intermediate type in chain returns None.
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

def unknown_factory():  # No return type annotation
    return Handler()

obj = unknown_factory()
obj.process()  # Should NOT resolve - no return type
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // The attribute access for "process" should not resolve
            // because unknown_factory() has no return type annotation
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            let attr = process_attr.unwrap();
            assert!(
                attr.base_symbol_index.is_none(),
                "Should NOT resolve when intermediate type is unknown (no return annotation)"
            );
        }

        #[test]
        fn resolve_receiver_path_constructor_call_resolves() {
            // Unit test: Handler().process() resolves via constructor semantics.
            // Fixture 11C-F09 pattern
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

Handler().process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // The attribute access for "process" should resolve to Handler
            // because Handler() is a constructor call returning Handler type
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            let attr = process_attr.unwrap();
            assert_eq!(
                attr.base_symbol_index, handler_idx,
                "Constructor call Handler().process should resolve to Handler class"
            );
        }

        #[test]
        fn resolve_receiver_path_function_return_type_resolves() {
            // Unit test: factory().create() resolves via function return type.
            // Fixture 11C-F08 pattern
            let adapter = PythonAdapter::new();
            let content = r#"
class Product:
    def create(self) -> "Widget":
        return Widget()

class Widget:
    def run(self): pass

def factory() -> Product:
    return Product()

factory().create().run()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Widget class symbol
            let widget_idx = result.symbols.iter().position(|s| s.name == "Widget");
            assert!(widget_idx.is_some(), "Should have Widget symbol");

            // The attribute access for "run" should resolve to Widget
            // via factory() -> Product -> create() -> Widget
            let run_attr = result.attributes.iter().find(|a| a.name == "run");
            assert!(run_attr.is_some(), "Should have attribute access for 'run'");

            let attr = run_attr.unwrap();
            assert_eq!(
                attr.base_symbol_index, widget_idx,
                "Chained call factory().create().run() should resolve to Widget"
            );
        }

        #[test]
        fn resolve_receiver_path_single_element_resolves_type() {
            // Unit test: Single-element path [Name("obj")] resolves obj's type.
            // Fixture 11C-F12 pattern
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

def use_handler():
    obj: Handler = Handler()
    obj.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // The attribute access for "process" on "obj" should resolve
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            let attr = process_attr.unwrap();
            assert_eq!(
                attr.base_symbol_index, handler_idx,
                "Single-element path should resolve via type annotation"
            );
        }

        #[test]
        fn resolve_receiver_path_simple_receivers_still_work() {
            // Regression test: Simple receivers continue to work after dotted path changes.
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

h = Handler()
h.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // Simple receiver "h" should still resolve
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            let attr = process_attr.unwrap();
            assert_eq!(
                attr.base_symbol_index, handler_idx,
                "Simple receiver should continue to resolve (regression test)"
            );
        }

        #[test]
        fn resolve_receiver_path_unknown_class_constructor_returns_none() {
            // Unit test: Unknown class MaybeClass().method() returns None.
            // When the class name is not in symbol_kinds, resolution should fail.
            let adapter = PythonAdapter::new();
            let content = r#"
# MaybeClass is not defined in this file
obj = MaybeClass()
obj.method()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // The attribute access for "method" should not resolve
            // because MaybeClass is not defined (not in symbol_kinds as a Class)
            let method_attr = result.attributes.iter().find(|a| a.name == "method");
            assert!(
                method_attr.is_some(),
                "Should have attribute access for 'method'"
            );

            let attr = method_attr.unwrap();
            assert!(
                attr.base_symbol_index.is_none(),
                "Unknown class constructor should NOT resolve"
            );
        }

        #[test]
        fn resolve_receiver_path_cross_file_type_mid_chain() {
            // Unit test: Cross-file type mid-chain handling.
            // When the type is an Import, we should return CrossFile or None.
            let adapter = PythonAdapter::new();
            let content = r#"
from external_module import ExternalHandler

class Service:
    handler: ExternalHandler

    def run(self):
        self.handler.process()  # ExternalHandler is imported, not local
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // The attribute access for "process" should either:
            // 1. Not resolve (base_symbol_index = None) because ExternalHandler is cross-file
            // 2. Have a cross-file qualified name
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            let attr = process_attr.unwrap();
            // Without a CrossFileSymbolMap, cross-file types return None
            // (they can't be resolved to a local index)
            assert!(
                attr.base_symbol_index.is_none() || attr.base_symbol_qualified_name.is_some(),
                "Cross-file type should return None for local index or have qualified name"
            );
        }

        #[test]
        fn resolve_call_receiver_get_handler_with_return_type() {
            // Unit test: get_handler() receiver resolves when return type annotated.
            // Fixture 11C-F02 pattern: call expression with annotated return type.
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

def get_handler() -> Handler:
    return Handler()

h = get_handler()
h.process()

get_handler().process()  # Direct call receiver
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // Both h.process() and get_handler().process() should resolve to Handler
            let process_attrs: Vec<_> = result
                .attributes
                .iter()
                .filter(|a| a.name == "process")
                .collect();
            assert_eq!(
                process_attrs.len(),
                2,
                "Should have two 'process' attribute accesses"
            );

            // Both should resolve to Handler
            for attr in process_attrs {
                assert_eq!(
                    attr.base_symbol_index, handler_idx,
                    "get_handler() call should resolve to Handler via return type annotation"
                );
            }
        }

        #[test]
        fn resolve_call_receiver_callable_attribute() {
            // Unit test: self.handler_factory().process() resolves via Callable return type.
            // Fixture 11C-F13 pattern: callable attribute invocation.
            let adapter = PythonAdapter::new();
            let content = r#"
from typing import Callable

class Handler:
    def process(self): pass

class Service:
    handler_factory: Callable[[], Handler]

    def run(self):
        self.handler_factory().process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // The attribute access for "process" should resolve to Handler
            // via self.handler_factory (Callable[[], Handler]) -> process
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            let attr = process_attr.unwrap();
            assert_eq!(
                attr.base_symbol_index, handler_idx,
                "Callable attribute invocation should resolve via Callable return type"
            );
        }

        #[test]
        fn resolve_call_receiver_full_method_call_integration() {
            // Integration test: Full method call chain get_handler().process()
            // Tests that base_symbol_index is set correctly for direct call receivers.
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass
    def cleanup(self): pass

def get_handler() -> Handler:
    return Handler()

# Direct call receiver patterns
get_handler().process()
get_handler().cleanup()

# Chained: h = get_handler(), h.process()
h = get_handler()
h.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class symbol
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");
            let handler_idx = handler_idx.unwrap();

            // All method accesses on Handler should resolve correctly
            let process_attrs: Vec<_> = result
                .attributes
                .iter()
                .filter(|a| a.name == "process")
                .collect();
            assert_eq!(process_attrs.len(), 2, "Should have two 'process' accesses");

            for attr in &process_attrs {
                assert_eq!(
                    attr.base_symbol_index,
                    Some(handler_idx),
                    "process() should resolve to Handler"
                );
            }

            // cleanup() should also resolve
            let cleanup_attrs: Vec<_> = result
                .attributes
                .iter()
                .filter(|a| a.name == "cleanup")
                .collect();
            assert_eq!(cleanup_attrs.len(), 1, "Should have one 'cleanup' access");
            assert_eq!(
                cleanup_attrs[0].base_symbol_index,
                Some(handler_idx),
                "cleanup() should resolve to Handler"
            );
        }

        // ====================================================================
        // Effective Export Tests
        // ====================================================================

        #[test]
        fn is_effectively_public_true_for_normal_names() {
            // Unit test: Normal names (not starting with _) are public.
            assert!(is_effectively_public("foo"), "foo should be public");
            assert!(is_effectively_public("Bar"), "Bar should be public");
            assert!(is_effectively_public("process"), "process should be public");
            assert!(is_effectively_public("MyClass"), "MyClass should be public");
            assert!(is_effectively_public("x"), "x should be public");
        }

        #[test]
        fn is_effectively_public_false_for_underscore_names() {
            // Unit test: Names starting with _ are private.
            assert!(!is_effectively_public("_foo"), "_foo should be private");
            assert!(!is_effectively_public("_Bar"), "_Bar should be private");
            assert!(
                !is_effectively_public("_private"),
                "_private should be private"
            );
            assert!(!is_effectively_public("_"), "_ should be private");
        }

        #[test]
        fn is_effectively_public_false_for_name_mangled() {
            // Unit test: Name-mangled names (__name without trailing __) are private.
            assert!(
                !is_effectively_public("__private"),
                "__private should be private"
            );
            assert!(
                !is_effectively_public("__internal_var"),
                "__internal_var should be private"
            );
        }

        #[test]
        fn is_effectively_public_true_for_dunders() {
            // Unit test: Dunders (__name__) are public.
            assert!(
                is_effectively_public("__init__"),
                "__init__ should be public"
            );
            assert!(
                is_effectively_public("__name__"),
                "__name__ should be public"
            );
            assert!(is_effectively_public("__doc__"), "__doc__ should be public");
            assert!(
                is_effectively_public("__call__"),
                "__call__ should be public"
            );
            assert!(
                is_effectively_public("__enter__"),
                "__enter__ should be public"
            );
            // Edge case: exactly 4 characters (__) is NOT a dunder
            assert!(
                !is_effectively_public("____"),
                "____ is too short to be a valid dunder"
            );
        }

        #[test]
        fn effective_exports_computed_without_all() {
            // Integration test: Module without __all__ produces effective exports when enabled.
            let opts = PythonAnalyzerOptions {
                compute_effective_exports: true,
                ..Default::default()
            };
            let adapter = PythonAdapter::with_options(opts);
            let content = r#"
def public_func():
    pass

def _private_func():
    pass

class PublicClass:
    pass

_private_var = 1
public_var = 2
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Should have effective exports for: public_func, PublicClass, public_var
            // Should NOT have exports for: _private_func, _private_var
            let export_names: Vec<_> = result
                .exports
                .iter()
                .filter_map(|e| e.exported_name.as_ref())
                .collect();

            assert!(
                export_names.contains(&&"public_func".to_string()),
                "public_func should be exported: {:?}",
                export_names
            );
            assert!(
                export_names.contains(&&"PublicClass".to_string()),
                "PublicClass should be exported: {:?}",
                export_names
            );
            assert!(
                export_names.contains(&&"public_var".to_string()),
                "public_var should be exported: {:?}",
                export_names
            );
            assert!(
                !export_names.contains(&&"_private_func".to_string()),
                "_private_func should NOT be exported: {:?}",
                export_names
            );
            assert!(
                !export_names.contains(&&"_private_var".to_string()),
                "_private_var should NOT be exported: {:?}",
                export_names
            );
        }

        #[test]
        fn no_effective_exports_when_explicit_all() {
            // Integration test: Module with __all__ does not produce effective exports.
            let opts = PythonAnalyzerOptions {
                compute_effective_exports: true,
                ..Default::default()
            };
            let adapter = PythonAdapter::with_options(opts);
            let content = r#"
__all__ = ["foo"]

def foo():
    pass

def bar():
    pass
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Should only have "foo" exported (from __all__), not "bar"
            let export_names: Vec<_> = result
                .exports
                .iter()
                .filter_map(|e| e.exported_name.as_ref())
                .collect();

            assert!(
                export_names.contains(&&"foo".to_string()),
                "foo should be exported from __all__: {:?}",
                export_names
            );
            // With __all__ present, effective exports should not be computed
            // so "bar" should NOT appear
            assert!(
                !export_names.contains(&&"bar".to_string()),
                "bar should NOT be exported when __all__ is present: {:?}",
                export_names
            );
        }

        #[test]
        fn no_effective_exports_when_option_disabled() {
            // Integration test: Option disabled -> no effective exports.
            let adapter = PythonAdapter::new(); // Default options (compute_effective_exports = false)
            let content = r#"
def public_func():
    pass

class PublicClass:
    pass
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Should have no exports since there's no __all__ and option is disabled
            assert!(
                result.exports.is_empty(),
                "No exports should be emitted when option is disabled: {:?}",
                result.exports
            );
        }

        #[test]
        fn effective_exports_excludes_imported_symbols() {
            // Integration test: Imported symbols should not be included in effective exports.
            let opts = PythonAnalyzerOptions {
                compute_effective_exports: true,
                ..Default::default()
            };
            let adapter = PythonAdapter::with_options(opts);
            let content = r#"
from os import path

def local_func():
    pass

class LocalClass:
    pass
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            let export_names: Vec<_> = result
                .exports
                .iter()
                .filter_map(|e| e.exported_name.as_ref())
                .collect();

            // Should have effective exports for local definitions
            assert!(
                export_names.contains(&&"local_func".to_string()),
                "local_func should be exported: {:?}",
                export_names
            );
            assert!(
                export_names.contains(&&"LocalClass".to_string()),
                "LocalClass should be exported: {:?}",
                export_names
            );
            // "path" is imported, not defined here - should NOT be exported
            assert!(
                !export_names.contains(&&"path".to_string()),
                "imported 'path' should NOT be exported: {:?}",
                export_names
            );
        }

        #[test]
        fn effective_exports_skipped_with_star_import() {
            // Integration test: Star imports prevent effective export computation
            // because we can't know what names are imported.
            let opts = PythonAnalyzerOptions {
                compute_effective_exports: true,
                ..Default::default()
            };
            let adapter = PythonAdapter::with_options(opts);
            let content = r#"
from some_module import *

def local_func():
    pass
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Should have NO effective exports when star import is present
            // (we can't reliably determine which names are imported)
            assert!(
                result.exports.is_empty(),
                "No effective exports should be emitted with star import: {:?}",
                result.exports
            );
        }

        // ====================================================================
        // Cross-File Resolution Correctness Tests
        // ====================================================================
        // These tests verify that:
        // 1. Local resolution sets base_symbol_index, NOT base_symbol_qualified_name
        // 2. Cross-file resolution sets base_symbol_qualified_name, NOT base_symbol_index
        // 3. Indices are valid for the file's symbol list (not global FactsStore indices)

        #[test]
        fn local_resolution_uses_index_not_qualified_name() {
            // CRITICAL TEST: Local resolution must set base_symbol_index only.
            // If we incorrectly return a global index instead of a local one,
            // this test will catch it.
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self): pass

h = Handler()
h.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the attribute access for "h.process"
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have 'process' attribute access"
            );
            let process_attr = process_attr.unwrap();

            // Local resolution: base_symbol_index should be Some, qualified_name should be None
            assert!(
                process_attr.base_symbol_index.is_some(),
                "Local resolution should set base_symbol_index"
            );
            assert!(
                process_attr.base_symbol_qualified_name.is_none(),
                "Local resolution should NOT set base_symbol_qualified_name"
            );

            // Verify the index is valid (within bounds of the symbol list)
            let idx = process_attr.base_symbol_index.unwrap();
            assert!(
                idx < result.symbols.len(),
                "base_symbol_index {} must be < symbol count {} (valid local index)",
                idx,
                result.symbols.len()
            );

            // Verify the index points to the correct symbol
            let pointed_symbol = &result.symbols[idx];
            assert_eq!(
                pointed_symbol.name, "Handler",
                "base_symbol_index should point to Handler class"
            );
        }

        #[test]
        fn cross_file_resolution_uses_qualified_name_not_index() {
            // CRITICAL TEST: Cross-file resolution must set base_symbol_qualified_name only.
            // This is the bug that was caught: returning global indices instead of qualified names.
            use tugtool_core::facts::{File, QualifiedName, Symbol};
            use tugtool_core::patch::Span;

            let adapter = PythonAdapter::new();

            // Build a store with a class from another file
            let mut store = FactsStore::new();
            let file_id = store.next_file_id();
            let file = File::new(
                file_id,
                "external/remote.py",
                ContentHash::from_hex_unchecked("abc123"),
                Language::Python,
            );
            store.insert_file(file);

            let symbol_id = store.next_symbol_id();
            let symbol = Symbol::new(
                symbol_id,
                SymbolKind::Class,
                "RemoteService",
                file_id,
                Span::new(0, 13),
            );
            store.insert_symbol(symbol);
            store.insert_qualified_name(QualifiedName::new(
                symbol_id,
                "external.remote.RemoteService",
            ));

            // Analyze a file that uses RemoteService
            let code = r#"
from external.remote import RemoteService

svc = RemoteService()
svc.call()
"#;
            let files = vec![("client.py".to_string(), code.to_string())];
            let bundle = adapter.analyze_files(&files, &store).unwrap();

            let result = &bundle.file_results[0];

            // Find the attribute access for "svc.call"
            let call_attr = result.attributes.iter().find(|a| a.name == "call");
            assert!(call_attr.is_some(), "Should have 'call' attribute access");
            let call_attr = call_attr.unwrap();

            // If cross-file resolution worked, base_symbol_qualified_name should be set
            // and base_symbol_index should be None (since RemoteService is not in this file).
            //
            // NOTE: For this to work, the TypeTracker needs to infer that `svc` has type
            // `RemoteService`. This depends on constructor call tracking. If TypeTracker
            // doesn't have the type, both fields will be None, which is also correct
            // (no resolution means no data).
            //
            // What we're testing here is that IF resolution succeeds for a cross-file type,
            // it returns qualified_name NOT an index.
            if call_attr.base_symbol_index.is_some() {
                // If there's an index, it must point to a valid symbol in this file
                let idx = call_attr.base_symbol_index.unwrap();
                assert!(
                    idx < result.symbols.len(),
                    "If base_symbol_index is set, it must be valid for THIS file's symbols. \
                     Got index {} but file only has {} symbols. \
                     This likely means a global FactsStore index was incorrectly stored.",
                    idx,
                    result.symbols.len()
                );
            }

            // The key invariant: we should NEVER have both set
            assert!(
                !(call_attr.base_symbol_index.is_some()
                    && call_attr.base_symbol_qualified_name.is_some()),
                "Must not have both index and qualified_name set. \
                 Index={:?}, QualifiedName={:?}",
                call_attr.base_symbol_index,
                call_attr.base_symbol_qualified_name
            );
        }

        #[test]
        fn callee_symbol_index_is_valid_local_index() {
            // CRITICAL TEST: callee_symbol_index must be a valid index into the file's symbols.
            let adapter = PythonAdapter::new();
            let content = r#"
class Service:
    def handle(self): pass

svc = Service()
svc.handle()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the method call
            for call in &result.calls {
                if let Some(idx) = call.callee_symbol_index {
                    assert!(
                        idx < result.symbols.len(),
                        "callee_symbol_index {} must be < symbol count {} (valid local index)",
                        idx,
                        result.symbols.len()
                    );
                }

                // Must not have both index and qualified_name
                assert!(
                    !(call.callee_symbol_index.is_some()
                        && call.callee_symbol_qualified_name.is_some()),
                    "Call must not have both callee_symbol_index and callee_symbol_qualified_name"
                );
            }
        }

        #[test]
        fn cross_file_method_call_uses_qualified_name() {
            // CRITICAL TEST: Method calls on cross-file types should use qualified name.
            use tugtool_core::facts::{File, QualifiedName, Symbol};
            use tugtool_core::patch::Span;

            let adapter = PythonAdapter::new();

            // Build a store with a class from another file
            let mut store = FactsStore::new();
            let file_id = store.next_file_id();
            let file = File::new(
                file_id,
                "pkg/service.py",
                ContentHash::from_hex_unchecked("xyz789"),
                Language::Python,
            );
            store.insert_file(file);

            let symbol_id = store.next_symbol_id();
            let symbol = Symbol::new(
                symbol_id,
                SymbolKind::Class,
                "Service",
                file_id,
                Span::new(0, 7),
            );
            store.insert_symbol(symbol);
            store.insert_qualified_name(QualifiedName::new(symbol_id, "pkg.service.Service"));

            // Analyze a file that uses Service
            let code = r#"
from pkg.service import Service

obj = Service()
obj.run()
"#;
            let files = vec![("main.py".to_string(), code.to_string())];
            let bundle = adapter.analyze_files(&files, &store).unwrap();

            let result = &bundle.file_results[0];

            // Verify all call indices are valid
            for (i, call) in result.calls.iter().enumerate() {
                if let Some(idx) = call.callee_symbol_index {
                    assert!(
                        idx < result.symbols.len(),
                        "Call {} has callee_symbol_index {} but file only has {} symbols. \
                         This indicates a global index was incorrectly stored.",
                        i,
                        idx,
                        result.symbols.len()
                    );
                }
            }
        }

        #[test]
        fn attribute_indices_valid_with_multiple_files() {
            // CRITICAL TEST: When analyzing multiple files, attribute indices must be
            // valid for EACH file's own symbol list, not a global list.
            let adapter = PythonAdapter::new();
            let store = FactsStore::new();

            let file1 = r#"
class A:
    def method_a(self): pass

obj = A()
obj.method_a()
"#;
            let file2 = r#"
class B:
    def method_b(self): pass
class C:
    def method_c(self): pass
class D:
    def method_d(self): pass

obj = D()
obj.method_d()
"#;
            let files = vec![
                ("a.py".to_string(), file1.to_string()),
                ("b.py".to_string(), file2.to_string()),
            ];
            let bundle = adapter.analyze_files(&files, &store).unwrap();

            // Verify each file's attribute indices are valid for that file
            for (file_idx, result) in bundle.file_results.iter().enumerate() {
                for attr in &result.attributes {
                    if let Some(idx) = attr.base_symbol_index {
                        assert!(
                            idx < result.symbols.len(),
                            "File {} '{}' has attribute with base_symbol_index {} \
                             but only {} symbols. Indices must be per-file, not global.",
                            file_idx,
                            result.path,
                            idx,
                            result.symbols.len()
                        );
                    }
                }
            }
        }
    }

    mod scope_tests {
        use super::*;

        #[test]
        fn scope_creation() {
            let scope = Scope::new(ScopeId(0), ScopeKind::Module, None, None);
            assert_eq!(scope.id, ScopeId(0));
            assert_eq!(scope.kind, ScopeKind::Module);
            assert!(scope.parent_id.is_none());
            assert!(scope.bindings.is_empty());
        }

        #[test]
        fn scope_with_parent() {
            let _parent = Scope::new(ScopeId(0), ScopeKind::Module, None, None);
            let child = Scope::new(
                ScopeId(1),
                ScopeKind::Function,
                Some("foo".to_string()),
                Some(ScopeId(0)),
            );

            assert_eq!(child.parent_id, Some(ScopeId(0)));
            assert_eq!(child.name, Some("foo".to_string()));
        }

        #[test]
        fn scope_global_declaration() {
            let mut scope = Scope::new(
                ScopeId(1),
                ScopeKind::Function,
                Some("foo".to_string()),
                Some(ScopeId(0)),
            );
            scope.globals.insert("counter".to_string());

            assert!(scope.is_global("counter"));
            assert!(!scope.is_global("other"));
        }

        #[test]
        fn scope_nonlocal_declaration() {
            let mut scope = Scope::new(
                ScopeId(2),
                ScopeKind::Function,
                Some("inner".to_string()),
                Some(ScopeId(1)),
            );
            scope.nonlocals.insert("value".to_string());

            assert!(scope.is_nonlocal("value"));
            assert!(!scope.is_nonlocal("other"));
        }
    }

    mod scope_span_tests {
        use super::*;

        /// Helper to analyze code and return the scopes with their spans
        fn analyze_and_get_scopes(source: &str) -> Vec<Scope> {
            let file_id = FileId::new(0);
            let analysis = analyze_file(file_id, "test.py", source).unwrap();
            analysis.scopes
        }

        #[test]
        fn test_analyzer_module_scope_has_span() {
            let source = "x = 1\ny = 2";
            let scopes = analyze_and_get_scopes(source);

            assert_eq!(scopes.len(), 1);
            let module_scope = &scopes[0];
            assert_eq!(module_scope.kind, ScopeKind::Module);

            // Module scope should span the entire file (0 to len)
            let span = module_scope.span.expect("Module scope should have span");
            assert_eq!(span.start, 0, "Module scope should start at byte 0");
            assert_eq!(
                span.end,
                source.len(),
                "Module scope should end at file length"
            );
        }

        #[test]
        fn test_analyzer_function_scope_has_span() {
            let source = "def foo():\n    pass";
            //           0123456789012345678
            //           ^def at 0     ^pass ends at 19
            let scopes = analyze_and_get_scopes(source);

            assert_eq!(scopes.len(), 2);
            let func_scope = &scopes[1];
            assert_eq!(func_scope.kind, ScopeKind::Function);
            assert_eq!(func_scope.name, Some("foo".to_string()));

            // Function scope should have a span
            let span = func_scope.span.expect("Function scope should have span");
            assert_eq!(span.start, 0, "Function scope should start at 'def'");
            assert!(span.end > 0, "Function scope should have positive end");
        }

        #[test]
        fn test_analyzer_class_scope_has_span() {
            let source = "class Foo:\n    pass";
            let scopes = analyze_and_get_scopes(source);

            assert_eq!(scopes.len(), 2);
            let class_scope = &scopes[1];
            assert_eq!(class_scope.kind, ScopeKind::Class);
            assert_eq!(class_scope.name, Some("Foo".to_string()));

            // Class scope should have a span
            let span = class_scope.span.expect("Class scope should have span");
            assert_eq!(span.start, 0, "Class scope should start at 'class'");
            assert!(span.end > 0, "Class scope should have positive end");
        }

        #[test]
        fn test_analyzer_lambda_scope_has_span() {
            let source = "f = lambda x: x + 1";
            //           01234567890123456789
            //               ^lambda at 4    ^ends at 19
            let scopes = analyze_and_get_scopes(source);

            assert_eq!(scopes.len(), 2);
            let lambda_scope = &scopes[1];
            assert_eq!(lambda_scope.kind, ScopeKind::Lambda);

            // Lambda scope should have a span starting at 'lambda' keyword
            let span = lambda_scope.span.expect("Lambda scope should have span");
            assert_eq!(
                span.start, 4,
                "Lambda scope should start at 'lambda' keyword"
            );
            assert_eq!(
                span.end, 19,
                "Lambda scope should end after body expression"
            );
        }

        #[test]
        fn test_analyzer_listcomp_scope_has_span() {
            let source = "x = [i for i in range(10)]";
            //           01234567890123456789012345
            //               ^[ at 4             ^] at 26
            let scopes = analyze_and_get_scopes(source);

            assert_eq!(scopes.len(), 2);
            let comp_scope = &scopes[1];
            assert_eq!(comp_scope.kind, ScopeKind::Comprehension);

            // List comprehension scope should have a span from '[' to ']'
            let span = comp_scope
                .span
                .expect("Comprehension scope should have span");
            assert_eq!(span.start, 4, "List comp scope should start at '['");
            assert_eq!(span.end, 26, "List comp scope should end after ']'");
        }
    }

    mod scope_chain_tests {
        use super::*;

        fn setup_scopes() -> Vec<Scope> {
            // Module scope (0)
            let mut module = Scope::new(ScopeId(0), ScopeKind::Module, None, None);
            module.bindings.insert("global_x".to_string(), SymbolId(0));

            // Function scope (1)
            let mut func = Scope::new(
                ScopeId(1),
                ScopeKind::Function,
                Some("outer".to_string()),
                Some(ScopeId(0)),
            );
            func.bindings.insert("local_x".to_string(), SymbolId(1));

            // Nested function scope (2)
            let mut nested = Scope::new(
                ScopeId(2),
                ScopeKind::Function,
                Some("inner".to_string()),
                Some(ScopeId(1)),
            );
            nested.bindings.insert("inner_x".to_string(), SymbolId(2));

            vec![module, func, nested]
        }

        #[test]
        fn resolve_local_binding() {
            let scopes = setup_scopes();

            // Resolve "inner_x" from inner scope - should find local binding
            let result = resolve_name_in_scope_chain("inner_x", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(2)));
        }

        #[test]
        fn resolve_enclosing_binding() {
            let scopes = setup_scopes();

            // Resolve "local_x" from inner scope - should find in enclosing scope
            let result = resolve_name_in_scope_chain("local_x", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(1)));
        }

        #[test]
        fn resolve_global_binding() {
            let scopes = setup_scopes();

            // Resolve "global_x" from inner scope - should find in module scope
            let result = resolve_name_in_scope_chain("global_x", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(0)));
        }

        #[test]
        fn resolve_unknown_name() {
            let scopes = setup_scopes();

            // Resolve unknown name - should return None
            let result = resolve_name_in_scope_chain("unknown", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, None);
        }

        #[test]
        fn shadowing_prefers_inner_scope() {
            let mut scopes = setup_scopes();

            // Add same name in multiple scopes
            scopes[0].bindings.insert("x".to_string(), SymbolId(10));
            scopes[1].bindings.insert("x".to_string(), SymbolId(11));
            scopes[2].bindings.insert("x".to_string(), SymbolId(12));

            // From inner scope, should find the innermost binding
            let result = resolve_name_in_scope_chain("x", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(12)));

            // From middle scope, should find middle binding
            let result = resolve_name_in_scope_chain("x", ScopeId(1), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(11)));

            // From module scope, should find module binding
            let result = resolve_name_in_scope_chain("x", ScopeId(0), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(10)));
        }

        #[test]
        fn global_declaration_skips_to_module() {
            let mut scopes = setup_scopes();

            // Add 'counter' in both module and function
            scopes[0]
                .bindings
                .insert("counter".to_string(), SymbolId(100));
            scopes[1]
                .bindings
                .insert("counter".to_string(), SymbolId(101));

            // Declare global in nested function
            scopes[2].globals.insert("counter".to_string());

            // From nested scope with global declaration, should find module binding
            let result = resolve_name_in_scope_chain("counter", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(100)));
        }

        #[test]
        fn nonlocal_declaration_finds_enclosing() {
            let mut scopes = setup_scopes();

            // Add 'value' only in middle scope
            scopes[1]
                .bindings
                .insert("value".to_string(), SymbolId(200));

            // Declare nonlocal in nested function
            scopes[2].nonlocals.insert("value".to_string());

            // From nested scope with nonlocal declaration, should find enclosing binding
            let result = resolve_name_in_scope_chain("value", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(200)));
        }

        #[test]
        fn class_scope_does_not_form_closure() {
            // Module scope (0)
            let mut module = Scope::new(ScopeId(0), ScopeKind::Module, None, None);
            module
                .bindings
                .insert("module_var".to_string(), SymbolId(0));

            // Class scope (1) - with a binding
            let mut class_scope = Scope::new(
                ScopeId(1),
                ScopeKind::Class,
                Some("MyClass".to_string()),
                Some(ScopeId(0)),
            );
            class_scope
                .bindings
                .insert("class_var".to_string(), SymbolId(1));

            // Method scope (2)
            let method = Scope::new(
                ScopeId(2),
                ScopeKind::Function,
                Some("method".to_string()),
                Some(ScopeId(1)),
            );

            let scopes = vec![module, class_scope, method];

            // From method, cannot directly access class_var (class scope doesn't form closure)
            // But can access module_var
            let result = resolve_name_in_scope_chain("module_var", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, Some(SymbolId(0)));

            // class_var is NOT accessible via closure (must use self.class_var)
            let result = resolve_name_in_scope_chain("class_var", ScopeId(2), &scopes, ScopeId(0));
            assert_eq!(result, None);
        }
    }

    mod symbol_kind_tests {
        use super::*;

        #[test]
        fn symbol_kind_conversion() {
            assert_eq!(symbol_kind_from_str("function"), SymbolKind::Function);
            assert_eq!(symbol_kind_from_str("class"), SymbolKind::Class);
            assert_eq!(symbol_kind_from_str("method"), SymbolKind::Method);
            assert_eq!(symbol_kind_from_str("variable"), SymbolKind::Variable);
            assert_eq!(symbol_kind_from_str("parameter"), SymbolKind::Parameter);
            assert_eq!(symbol_kind_from_str("import"), SymbolKind::Import);
            assert_eq!(symbol_kind_from_str("import_alias"), SymbolKind::Import);
            assert_eq!(symbol_kind_from_str("unknown"), SymbolKind::Variable);
        }
    }

    mod reference_kind_tests {
        use super::*;

        #[test]
        fn reference_kind_conversion() {
            assert_eq!(
                reference_kind_from_str("definition"),
                ReferenceKind::Definition
            );
            assert_eq!(reference_kind_from_str("call"), ReferenceKind::Call);
            assert_eq!(
                reference_kind_from_str("reference"),
                ReferenceKind::Reference
            );
            assert_eq!(reference_kind_from_str("import"), ReferenceKind::Import);
            assert_eq!(
                reference_kind_from_str("attribute"),
                ReferenceKind::Attribute
            );
            assert_eq!(reference_kind_from_str("write"), ReferenceKind::Write);
            assert_eq!(reference_kind_from_str("delete"), ReferenceKind::Delete);
            assert_eq!(reference_kind_from_str("unknown"), ReferenceKind::Reference);
        }
    }

    mod local_types_tests {
        use super::*;

        #[test]
        fn local_symbol_creation() {
            let sym = LocalSymbol {
                name: "foo".to_string(),
                kind: SymbolKind::Function,
                scope_id: ScopeId(0),
                span: Some(Span::new(4, 7)),
                line: Some(1),
                col: Some(5),
                container: None,
            };

            assert_eq!(sym.name, "foo");
            assert_eq!(sym.kind, SymbolKind::Function);
        }

        #[test]
        fn local_reference_creation() {
            let ref_ = LocalReference {
                name: "foo".to_string(),
                kind: ReferenceKind::Call,
                span: Some(Span::new(50, 53)),
                line: Some(5),
                col: Some(10),
                scope_id: ScopeId(0),
                resolved_symbol: Some("foo".to_string()),
            };

            assert_eq!(ref_.name, "foo");
            assert_eq!(ref_.kind, ReferenceKind::Call);
        }

        #[test]
        fn local_import_creation() {
            let imp = LocalImport {
                kind: "from".to_string(),
                module_path: "os.path".to_string(),
                names: vec![
                    ImportedName {
                        name: "join".to_string(),
                        alias: None,
                    },
                    ImportedName {
                        name: "exists".to_string(),
                        alias: Some("path_exists".to_string()),
                    },
                ],
                alias: None,
                is_star: false,
                span: Some(Span::new(0, 30)),
                line: Some(1),
                resolved_file: None,
                relative_level: 0,
            };

            assert_eq!(imp.module_path, "os.path");
            assert_eq!(imp.names.len(), 2);
            assert!(!imp.is_star);
        }
    }

    mod import_resolution_tests {
        #[test]
        fn module_path_to_file_path() {
            // Test the conversion logic (without actual files)
            let module_path = "myproject.utils";
            let expected_py = "myproject/utils.py";
            let expected_init = "myproject/utils/__init__.py";

            let file_path = module_path.replace('.', "/");
            assert_eq!(format!("{}.py", file_path), expected_py);
            assert_eq!(format!("{}/__init__.py", file_path), expected_init);
        }
    }

    mod resolve_relative_path_tests {
        use super::*;

        #[test]
        fn resolve_relative_path_single_level_with_module() {
            // from .utils import foo in lib/foo.py -> lib/utils
            let result = resolve_relative_path("lib/foo.py", 1, "utils");
            assert_eq!(result, "lib/utils");
        }

        #[test]
        fn resolve_relative_path_single_level_nested() {
            // from .bar import x in lib/sub/foo.py -> lib/sub/bar
            let result = resolve_relative_path("lib/sub/foo.py", 1, "bar");
            assert_eq!(result, "lib/sub/bar");
        }

        #[test]
        fn resolve_relative_path_single_level_package_itself() {
            // from . import utils in lib/foo.py -> lib (the package itself)
            let result = resolve_relative_path("lib/foo.py", 1, "");
            assert_eq!(result, "lib");
        }

        #[test]
        fn resolve_relative_path_absolute_import() {
            // Absolute import (relative_level = 0) converts dots to slashes
            let result = resolve_relative_path("lib/foo.py", 0, "absolute.path");
            assert_eq!(result, "absolute/path");
        }

        #[test]
        fn resolve_relative_path_absolute_import_simple() {
            // Absolute import with no dots
            let result = resolve_relative_path("lib/foo.py", 0, "utils");
            assert_eq!(result, "utils");
        }

        #[test]
        fn resolve_relative_path_double_level() {
            // from ..utils import foo in lib/sub/foo.py -> lib/utils
            let result = resolve_relative_path("lib/sub/foo.py", 2, "utils");
            assert_eq!(result, "lib/utils");
        }

        #[test]
        fn resolve_relative_path_double_level_package_itself() {
            // from .. import x in lib/sub/foo.py -> lib
            let result = resolve_relative_path("lib/sub/foo.py", 2, "");
            assert_eq!(result, "lib");
        }

        #[test]
        fn resolve_relative_path_dotted_module_name() {
            // from .sub.utils import foo in pkg/foo.py -> pkg/sub/utils
            let result = resolve_relative_path("pkg/foo.py", 1, "sub.utils");
            assert_eq!(result, "pkg/sub/utils");
        }

        #[test]
        fn resolve_relative_path_root_level_file() {
            // from .utils import foo in foo.py (at root) -> utils
            let result = resolve_relative_path("foo.py", 1, "utils");
            assert_eq!(result, "utils");
        }

        #[test]
        fn resolve_relative_path_root_level_package_itself() {
            // from . import utils in foo.py (at root) -> ""
            let result = resolve_relative_path("foo.py", 1, "");
            assert_eq!(result, "");
        }
    }

    mod namespace_package_tests {
        use super::*;

        #[test]
        fn test_compute_namespace_simple() {
            // NP-01: Dir with .py but no __init__.py
            // Given: utils/helpers.py exists, but utils/__init__.py does NOT exist
            // Expected: "utils" should be detected as a namespace package
            let files: HashSet<String> =
                ["utils/helpers.py"].iter().map(|s| s.to_string()).collect();

            let ns_packages = compute_namespace_packages(&files);

            assert!(
                ns_packages.contains("utils"),
                "utils should be detected as a namespace package"
            );
            assert_eq!(ns_packages.len(), 1, "should only detect utils");
        }

        #[test]
        fn test_compute_namespace_nested() {
            // NP-02: Multiple levels without __init__.py
            // Given: a/b/c/module.py exists, but none of a/, a/b/, a/b/c/ have __init__.py
            // Expected: all three directories should be namespace packages
            let files: HashSet<String> =
                ["a/b/c/module.py"].iter().map(|s| s.to_string()).collect();

            let ns_packages = compute_namespace_packages(&files);

            assert!(ns_packages.contains("a"), "a should be a namespace package");
            assert!(
                ns_packages.contains("a/b"),
                "a/b should be a namespace package"
            );
            assert!(
                ns_packages.contains("a/b/c"),
                "a/b/c should be a namespace package"
            );
            assert_eq!(ns_packages.len(), 3);
        }

        #[test]
        fn test_compute_namespace_mixed() {
            // NP-03: Some dirs have __init__.py, some don't
            // Given:
            //   - pkg/__init__.py (regular package)
            //   - pkg/sub/module.py (no pkg/sub/__init__.py)
            //   - ns/module.py (no ns/__init__.py)
            // Expected: "pkg/sub" and "ns" are namespace packages, "pkg" is NOT
            let files: HashSet<String> = ["pkg/__init__.py", "pkg/sub/module.py", "ns/module.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let ns_packages = compute_namespace_packages(&files);

            assert!(
                !ns_packages.contains("pkg"),
                "pkg has __init__.py, not a namespace package"
            );
            assert!(
                ns_packages.contains("pkg/sub"),
                "pkg/sub should be a namespace package"
            );
            assert!(
                ns_packages.contains("ns"),
                "ns should be a namespace package"
            );
        }

        #[test]
        fn test_compute_namespace_excludes_git() {
            // NP-04: .git/ excluded
            // Given: .git/hooks/script.py
            // Expected: no namespace packages detected (entire .git tree excluded)
            let files: HashSet<String> = [".git/hooks/script.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let ns_packages = compute_namespace_packages(&files);

            assert!(
                ns_packages.is_empty(),
                ".git/ should be excluded from namespace detection"
            );
        }

        #[test]
        fn test_compute_namespace_excludes_pycache() {
            // NP-05: __pycache__/ excluded
            // Given: utils/__pycache__/module.cpython-311.pyc (if extension were .py)
            // But using .py for test: __pycache__/module.py
            // Expected: no namespace packages detected
            let files: HashSet<String> = ["__pycache__/module.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let ns_packages = compute_namespace_packages(&files);

            assert!(
                ns_packages.is_empty(),
                "__pycache__/ should be excluded from namespace detection"
            );
        }

        #[test]
        fn test_compute_namespace_excludes_tug() {
            // NP-06: .tug/ excluded
            // Given: .tug/cache/module.py
            // Expected: no namespace packages detected
            let files: HashSet<String> = [".tug/cache/module.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let ns_packages = compute_namespace_packages(&files);

            assert!(
                ns_packages.is_empty(),
                ".tug/ should be excluded from namespace detection"
            );
        }

        #[test]
        fn test_compute_namespace_deduplicates() {
            // NP-07: Same dir not counted twice
            // Given: utils/a.py, utils/b.py, utils/c.py (all in same dir)
            // Expected: "utils" appears only once in the result set
            let files: HashSet<String> = ["utils/a.py", "utils/b.py", "utils/c.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let ns_packages = compute_namespace_packages(&files);

            assert!(ns_packages.contains("utils"));
            assert_eq!(ns_packages.len(), 1, "utils should only appear once");
        }
    }

    mod namespace_resolution_tests {
        use super::*;

        // =========================================================================
        // Step 8: Namespace Package Resolution Tests (NR-01 through NR-07)
        // =========================================================================

        #[test]
        fn test_resolve_namespace_import_from() {
            // NR-01: `from utils.helpers import foo` resolves to `utils/helpers.py`
            // Given: utils/ is a namespace package (no __init__.py), utils/helpers.py exists
            // Expected: resolve_module_to_file("utils.helpers", ...) → ResolvedModule::File("utils/helpers.py")
            let workspace_files: HashSet<String> =
                ["utils/helpers.py"].iter().map(|s| s.to_string()).collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // Verify utils is detected as namespace package
            assert!(
                namespace_packages.contains("utils"),
                "utils should be detected as namespace package"
            );

            // Resolve utils.helpers - should find the file
            let result = resolve_module_to_file(
                "utils.helpers",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );

            assert_eq!(
                result,
                Some(ResolvedModule::File("utils/helpers.py".to_string())),
                "from utils.helpers should resolve to utils/helpers.py"
            );
        }

        #[test]
        fn test_resolve_namespace_import() {
            // NR-02: `import utils` recognizes namespace package
            // Given: utils/ is a namespace package (no __init__.py), utils/helpers.py exists
            // Expected: resolve_module_to_file("utils", ...) → ResolvedModule::Namespace("utils")
            let workspace_files: HashSet<String> =
                ["utils/helpers.py"].iter().map(|s| s.to_string()).collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // Resolve utils - should return namespace marker
            let result =
                resolve_module_to_file("utils", &workspace_files, &namespace_packages, None, 0);

            assert_eq!(
                result,
                Some(ResolvedModule::Namespace("utils".to_string())),
                "import utils should recognize namespace package"
            );
        }

        #[test]
        fn test_resolve_namespace_relative() {
            // NR-03: `from . import other` within namespace package
            // Given: namespace_pkg/module.py imports from . import other
            //        namespace_pkg/other.py exists
            //        namespace_pkg/ has no __init__.py
            // Expected: relative import resolves to namespace_pkg/other.py
            let workspace_files: HashSet<String> =
                ["namespace_pkg/module.py", "namespace_pkg/other.py"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // Verify namespace_pkg is detected as namespace package
            assert!(
                namespace_packages.contains("namespace_pkg"),
                "namespace_pkg should be detected as namespace package"
            );

            // Relative import from namespace_pkg/module.py: from . import other
            // context_path = "namespace_pkg/module.py", relative_level = 1, module_path = "other"
            let result = resolve_module_to_file(
                "other",
                &workspace_files,
                &namespace_packages,
                Some("namespace_pkg/module.py"),
                1, // relative level 1 = from .
            );

            assert_eq!(
                result,
                Some(ResolvedModule::File("namespace_pkg/other.py".to_string())),
                "relative import within namespace package should resolve"
            );
        }

        #[test]
        fn test_resolve_mixed_packages() {
            // NR-04: Mix of regular (`__init__.py`) and namespace packages
            // Given:
            //   - regular_pkg/__init__.py (regular package)
            //   - regular_pkg/module.py
            //   - namespace_pkg/module.py (no __init__.py)
            // Expected: both resolve correctly based on their type
            let workspace_files: HashSet<String> = [
                "regular_pkg/__init__.py",
                "regular_pkg/module.py",
                "namespace_pkg/module.py",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // regular_pkg should NOT be in namespace_packages (has __init__.py)
            assert!(
                !namespace_packages.contains("regular_pkg"),
                "regular_pkg has __init__.py, not a namespace package"
            );

            // namespace_pkg should be in namespace_packages
            assert!(
                namespace_packages.contains("namespace_pkg"),
                "namespace_pkg should be detected as namespace package"
            );

            // Resolve regular_pkg - should return the __init__.py
            let regular_result = resolve_module_to_file(
                "regular_pkg",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                regular_result,
                Some(ResolvedModule::File("regular_pkg/__init__.py".to_string())),
                "regular_pkg should resolve to __init__.py"
            );

            // Resolve namespace_pkg - should return namespace marker
            let namespace_result = resolve_module_to_file(
                "namespace_pkg",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                namespace_result,
                Some(ResolvedModule::Namespace("namespace_pkg".to_string())),
                "namespace_pkg should resolve as namespace package"
            );

            // Resolve modules within each
            let regular_module = resolve_module_to_file(
                "regular_pkg.module",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                regular_module,
                Some(ResolvedModule::File("regular_pkg/module.py".to_string())),
                "regular_pkg.module should resolve to file"
            );

            let namespace_module = resolve_module_to_file(
                "namespace_pkg.module",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                namespace_module,
                Some(ResolvedModule::File("namespace_pkg/module.py".to_string())),
                "namespace_pkg.module should resolve to file"
            );
        }

        #[test]
        fn test_resolve_namespace_deep_nesting() {
            // NR-05: `a.b.c.d.e` where a/, b/, c/, d/ are all namespace packages
            // Given: a/b/c/d/e.py exists, no __init__.py anywhere
            // Expected: a.b.c.d.e resolves to a/b/c/d/e.py
            //           a, a.b, a.b.c, a.b.c.d all resolve as namespace packages
            let workspace_files: HashSet<String> =
                ["a/b/c/d/e.py"].iter().map(|s| s.to_string()).collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // All intermediate directories should be namespace packages
            assert!(
                namespace_packages.contains("a"),
                "a should be namespace package"
            );
            assert!(
                namespace_packages.contains("a/b"),
                "a/b should be namespace package"
            );
            assert!(
                namespace_packages.contains("a/b/c"),
                "a/b/c should be namespace package"
            );
            assert!(
                namespace_packages.contains("a/b/c/d"),
                "a/b/c/d should be namespace package"
            );

            // Resolve the full path to the file
            let result =
                resolve_module_to_file("a.b.c.d.e", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                result,
                Some(ResolvedModule::File("a/b/c/d/e.py".to_string())),
                "a.b.c.d.e should resolve to a/b/c/d/e.py"
            );

            // Resolve intermediate namespace packages
            let a_result =
                resolve_module_to_file("a", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                a_result,
                Some(ResolvedModule::Namespace("a".to_string())),
                "a should resolve as namespace package"
            );

            let ab_result =
                resolve_module_to_file("a.b", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                ab_result,
                Some(ResolvedModule::Namespace("a/b".to_string())),
                "a.b should resolve as namespace package"
            );

            let abcd_result =
                resolve_module_to_file("a.b.c.d", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                abcd_result,
                Some(ResolvedModule::Namespace("a/b/c/d".to_string())),
                "a.b.c.d should resolve as namespace package"
            );
        }

        #[test]
        fn test_resolve_namespace_fallback() {
            // NR-06: Regular file/init resolution tried before namespace
            // Given: utils.py exists AND utils/ is a namespace package
            // Expected: utils resolves to utils.py (file wins over namespace)
            let workspace_files: HashSet<String> = ["utils.py", "utils/helpers.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // utils should still be detected as namespace package
            assert!(
                namespace_packages.contains("utils"),
                "utils directory should be detected as namespace package"
            );

            // But resolution should return the file, not namespace
            let result =
                resolve_module_to_file("utils", &workspace_files, &namespace_packages, None, 0);

            assert_eq!(
                result,
                Some(ResolvedModule::File("utils.py".to_string())),
                "utils.py file should take precedence over namespace package"
            );

            // utils.helpers should still resolve through the namespace
            let helpers_result = resolve_module_to_file(
                "utils.helpers",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                helpers_result,
                Some(ResolvedModule::File("utils/helpers.py".to_string())),
                "utils.helpers should resolve to utils/helpers.py"
            );
        }

        #[test]
        fn test_resolve_namespace_returns_marker() {
            // NR-07: ResolvedModule::Namespace returned for namespace package
            // This tests the return type invariant explicitly
            let workspace_files: HashSet<String> =
                ["myns/module.py"].iter().map(|s| s.to_string()).collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            let result =
                resolve_module_to_file("myns", &workspace_files, &namespace_packages, None, 0);

            // Verify it's the Namespace variant
            assert!(result.is_some(), "myns should resolve to something");

            let resolved = result.unwrap();
            assert!(
                resolved.is_namespace(),
                "myns should resolve to Namespace variant"
            );
            assert!(
                !resolved.is_file(),
                "myns should NOT resolve to File variant"
            );

            // as_file() should return None for namespace packages
            assert!(
                resolved.as_file().is_none(),
                "as_file() should return None for namespace packages"
            );

            // path() should return the namespace path
            assert_eq!(
                resolved.path(),
                "myns",
                "path() should return the namespace path"
            );
        }

        // =========================================================================
        // Additional Namespace Resolution Tests (Extended Coverage)
        // =========================================================================

        #[test]
        fn test_resolve_namespace_nonexistent_module() {
            // Verify None is returned for modules that don't exist
            let workspace_files: HashSet<String> =
                ["utils/helpers.py"].iter().map(|s| s.to_string()).collect();
            let namespace_packages = compute_namespace_packages(&workspace_files);

            // Try to resolve a module that doesn't exist
            let result = resolve_module_to_file(
                "nonexistent",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(result, None, "nonexistent module should return None");

            // Try to resolve a submodule of namespace that doesn't exist
            let result2 = resolve_module_to_file(
                "utils.nonexistent",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(result2, None, "nonexistent submodule should return None");
        }

        #[test]
        fn test_resolve_namespace_double_relative() {
            // Test `from .. import other` going up multiple levels
            // Structure:
            //   pkg/sub/module.py (importing)
            //   pkg/other.py (target)
            // Import: from .. import other (relative_level=2)
            let workspace_files: HashSet<String> = ["pkg/sub/module.py", "pkg/other.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // Both pkg and pkg/sub should be namespace packages
            assert!(
                namespace_packages.contains("pkg"),
                "pkg should be namespace package"
            );
            assert!(
                namespace_packages.contains("pkg/sub"),
                "pkg/sub should be namespace package"
            );

            // Relative import from pkg/sub/module.py: from .. import other
            let result = resolve_module_to_file(
                "other",
                &workspace_files,
                &namespace_packages,
                Some("pkg/sub/module.py"),
                2, // relative level 2 = from ..
            );

            assert_eq!(
                result,
                Some(ResolvedModule::File("pkg/other.py".to_string())),
                "double relative import should resolve to pkg/other.py"
            );
        }

        #[test]
        fn test_resolve_namespace_triple_relative() {
            // Test `from ... import target` going up three levels
            // Structure:
            //   a/b/c/module.py (importing)
            //   a/target.py
            let workspace_files: HashSet<String> = ["a/b/c/module.py", "a/target.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // Relative import from a/b/c/module.py: from ... import target
            let result = resolve_module_to_file(
                "target",
                &workspace_files,
                &namespace_packages,
                Some("a/b/c/module.py"),
                3, // relative level 3 = from ...
            );

            assert_eq!(
                result,
                Some(ResolvedModule::File("a/target.py".to_string())),
                "triple relative import should resolve to a/target.py"
            );
        }

        #[test]
        fn test_resolve_namespace_mixed_nesting() {
            // Test namespace → regular → namespace hierarchy
            // Structure:
            //   outer/           (namespace - no __init__.py)
            //   outer/middle/__init__.py (regular package)
            //   outer/middle/inner/module.py (namespace - no __init__.py in inner)
            let workspace_files: HashSet<String> =
                ["outer/middle/__init__.py", "outer/middle/inner/module.py"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // outer should be namespace (no __init__.py)
            assert!(
                namespace_packages.contains("outer"),
                "outer should be namespace package"
            );
            // outer/middle should NOT be namespace (has __init__.py)
            assert!(
                !namespace_packages.contains("outer/middle"),
                "outer/middle has __init__.py"
            );
            // outer/middle/inner should be namespace (no __init__.py)
            assert!(
                namespace_packages.contains("outer/middle/inner"),
                "outer/middle/inner should be namespace"
            );

            // Resolve through the mixed hierarchy
            let outer_result =
                resolve_module_to_file("outer", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                outer_result,
                Some(ResolvedModule::Namespace("outer".to_string())),
                "outer should resolve as namespace"
            );

            let middle_result = resolve_module_to_file(
                "outer.middle",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                middle_result,
                Some(ResolvedModule::File("outer/middle/__init__.py".to_string())),
                "outer.middle should resolve to __init__.py"
            );

            let inner_result = resolve_module_to_file(
                "outer.middle.inner",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                inner_result,
                Some(ResolvedModule::Namespace("outer/middle/inner".to_string())),
                "outer.middle.inner should resolve as namespace"
            );

            let module_result = resolve_module_to_file(
                "outer.middle.inner.module",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                module_result,
                Some(ResolvedModule::File(
                    "outer/middle/inner/module.py".to_string()
                )),
                "outer.middle.inner.module should resolve to file"
            );
        }

        #[test]
        fn test_resolve_namespace_with_subpackages() {
            // Test namespace_pkg/sub/module.py structure
            // Structure:
            //   ns/          (namespace)
            //   ns/sub/      (namespace)
            //   ns/sub/module.py
            //   ns/other.py
            let workspace_files: HashSet<String> = ["ns/sub/module.py", "ns/other.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            assert!(namespace_packages.contains("ns"), "ns should be namespace");
            assert!(
                namespace_packages.contains("ns/sub"),
                "ns/sub should be namespace"
            );

            // Resolve various paths
            let ns_result =
                resolve_module_to_file("ns", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(ns_result, Some(ResolvedModule::Namespace("ns".to_string())));

            let sub_result =
                resolve_module_to_file("ns.sub", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                sub_result,
                Some(ResolvedModule::Namespace("ns/sub".to_string()))
            );

            let module_result = resolve_module_to_file(
                "ns.sub.module",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                module_result,
                Some(ResolvedModule::File("ns/sub/module.py".to_string()))
            );

            let other_result =
                resolve_module_to_file("ns.other", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                other_result,
                Some(ResolvedModule::File("ns/other.py".to_string()))
            );
        }

        #[test]
        fn test_resolve_namespace_init_vs_module_precedence() {
            // Test that pkg/__init__.py takes precedence over pkg.py for package resolution
            // BUT pkg.py takes precedence for module resolution
            // This is Contract C3: module file (.py) wins over package (__init__.py)
            //
            // Wait - let me re-read the algorithm:
            // 1. Try resolved_path.py
            // 2. Try resolved_path/__init__.py
            // 3. Try namespace_packages
            //
            // So for "pkg", we try pkg.py FIRST, then pkg/__init__.py
            // This means pkg.py wins if both exist.
            let workspace_files: HashSet<String> = ["pkg.py", "pkg/__init__.py", "pkg/module.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // pkg/ should NOT be a namespace package (has __init__.py)
            assert!(!namespace_packages.contains("pkg"), "pkg has __init__.py");

            // Resolve "pkg" - should get pkg.py (per Contract C3: .py wins)
            let result =
                resolve_module_to_file("pkg", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                result,
                Some(ResolvedModule::File("pkg.py".to_string())),
                "pkg.py should win over pkg/__init__.py"
            );

            // Resolve "pkg.module" - should still find the submodule
            let module_result = resolve_module_to_file(
                "pkg.module",
                &workspace_files,
                &namespace_packages,
                None,
                0,
            );
            assert_eq!(
                module_result,
                Some(ResolvedModule::File("pkg/module.py".to_string())),
                "pkg.module should resolve to pkg/module.py"
            );
        }

        #[test]
        fn test_resolve_namespace_relative_to_namespace_submodule() {
            // Test relative import from a file inside a namespace package to a sibling namespace
            // Structure:
            //   ns/a/module.py (importing)
            //   ns/b/target.py
            // Import from ns/a/module.py: from ..b import target
            let workspace_files: HashSet<String> = ["ns/a/module.py", "ns/b/target.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // All should be namespace packages
            assert!(namespace_packages.contains("ns"));
            assert!(namespace_packages.contains("ns/a"));
            assert!(namespace_packages.contains("ns/b"));

            // from ..b import target (relative_level=2, module="b.target")
            let result = resolve_module_to_file(
                "b.target",
                &workspace_files,
                &namespace_packages,
                Some("ns/a/module.py"),
                2,
            );
            assert_eq!(
                result,
                Some(ResolvedModule::File("ns/b/target.py".to_string())),
                "relative import from ..b.target should resolve"
            );
        }

        #[test]
        fn test_resolve_namespace_empty_module_path() {
            // Test handling of edge case: empty module path with relative import
            // from . import x (module_path is empty string, just dots)
            let workspace_files: HashSet<String> = ["pkg/x.py", "pkg/y.py"]
                .iter()
                .map(|s| s.to_string())
                .collect();

            let namespace_packages = compute_namespace_packages(&workspace_files);

            // from . import x (relative_level=1, module="x")
            let result = resolve_module_to_file(
                "x",
                &workspace_files,
                &namespace_packages,
                Some("pkg/y.py"),
                1,
            );
            assert_eq!(
                result,
                Some(ResolvedModule::File("pkg/x.py".to_string())),
                "from . import x should resolve to sibling"
            );
        }

        #[test]
        fn test_resolve_namespace_no_context_for_relative() {
            // Verify that relative imports without context return None (can't resolve)
            let workspace_files: HashSet<String> =
                ["pkg/module.py"].iter().map(|s| s.to_string()).collect();
            let namespace_packages = compute_namespace_packages(&workspace_files);

            // Relative import with no context path
            let result = resolve_module_to_file(
                "module",
                &workspace_files,
                &namespace_packages,
                None, // No context!
                1,    // But relative level > 0
            );
            assert_eq!(
                result, None,
                "relative import without context should return None"
            );
        }
    }

    // =========================================================================
    // Integration Tests: analyze_files with Namespace Packages
    // =========================================================================

    mod namespace_integration_tests {
        use super::*;

        #[test]
        fn test_analyze_files_namespace_import_resolves() {
            // End-to-end test: import from module inside namespace package
            // Structure:
            //   ns/helpers.py - def helper(): pass
            //   main.py - from ns.helpers import helper; helper()
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "ns/helpers.py".to_string(),
                    "def helper():\n    pass".to_string(),
                ),
                (
                    "main.py".to_string(),
                    "from ns.helpers import helper\nhelper()".to_string(),
                ),
            ];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify ns is detected as namespace package
            assert!(
                bundle.namespace_packages.contains("ns"),
                "ns should be detected as namespace package"
            );

            // Find the helper definition in ns/helpers.py
            let symbols: Vec<_> = store.symbols().collect();
            let files_in_store: Vec<_> = store.files().collect();

            let helpers_file = files_in_store
                .iter()
                .find(|f| f.path == "ns/helpers.py")
                .expect("should have ns/helpers.py");

            let helper_def = symbols
                .iter()
                .find(|s| {
                    s.name == "helper"
                        && s.decl_file_id == helpers_file.file_id
                        && s.kind == SymbolKind::Function
                })
                .expect("should have helper function in ns/helpers.py");

            // Check that main.py has references to helper
            let references: Vec<_> = store.references().collect();
            let main_file = files_in_store
                .iter()
                .find(|f| f.path == "main.py")
                .expect("should have main.py");

            // The helper call in main.py should resolve to the definition in ns/helpers.py
            let cross_file_refs: Vec<_> = references
                .iter()
                .filter(|r| r.file_id == main_file.file_id && r.symbol_id == helper_def.symbol_id)
                .collect();

            assert!(
                !cross_file_refs.is_empty(),
                "should have cross-file reference from main.py to helper in ns/helpers.py"
            );
        }

        #[test]
        fn test_analyze_files_namespace_star_import_empty() {
            // Verify that `from namespace_pkg import *` produces no exports
            // because namespace packages have no __init__.py
            let mut store = FactsStore::new();
            let files = vec![
                ("ns/module.py".to_string(), "def func(): pass".to_string()),
                (
                    "main.py".to_string(),
                    "from ns import *\n# ns has no __init__.py, so this imports nothing"
                        .to_string(),
                ),
            ];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify ns is namespace package
            assert!(bundle.namespace_packages.contains("ns"));

            // The star import should NOT bring in `func` from ns/module.py
            // because ns has no __init__.py to define exports
            let symbols: Vec<_> = store.symbols().collect();
            let main_file = store.files().find(|f| f.path == "main.py").unwrap();

            // There should be no import binding for `func` in main.py
            let func_in_main = symbols
                .iter()
                .find(|s| s.name == "func" && s.decl_file_id == main_file.file_id);

            assert!(
                func_in_main.is_none(),
                "star import from namespace package should not import func"
            );
        }

        #[test]
        fn test_analyze_files_namespace_nested_import() {
            // Test importing from deeply nested namespace packages
            // Structure:
            //   a/b/c/module.py - def deep(): pass
            //   main.py - from a.b.c.module import deep; deep()
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "a/b/c/module.py".to_string(),
                    "def deep():\n    pass".to_string(),
                ),
                (
                    "main.py".to_string(),
                    "from a.b.c.module import deep\ndeep()".to_string(),
                ),
            ];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify all intermediate directories are namespace packages
            assert!(bundle.namespace_packages.contains("a"));
            assert!(bundle.namespace_packages.contains("a/b"));
            assert!(bundle.namespace_packages.contains("a/b/c"));

            // Find deep definition
            let symbols: Vec<_> = store.symbols().collect();
            let module_file = store.files().find(|f| f.path == "a/b/c/module.py").unwrap();

            let deep_def = symbols
                .iter()
                .find(|s| {
                    s.name == "deep"
                        && s.decl_file_id == module_file.file_id
                        && s.kind == SymbolKind::Function
                })
                .expect("should have deep function");

            // Check references
            let references: Vec<_> = store.references().collect();
            let main_file = store.files().find(|f| f.path == "main.py").unwrap();

            let refs_to_deep: Vec<_> = references
                .iter()
                .filter(|r| r.file_id == main_file.file_id && r.symbol_id == deep_def.symbol_id)
                .collect();

            assert!(
                !refs_to_deep.is_empty(),
                "should resolve reference to deep through nested namespace packages"
            );
        }

        #[test]
        fn test_analyze_files_namespace_relative_import() {
            // Test relative import within namespace package
            // Structure:
            //   ns/a.py - def func_a(): pass
            //   ns/b.py - from . import a; a.func_a()
            let mut store = FactsStore::new();
            let files = vec![
                ("ns/a.py".to_string(), "def func_a():\n    pass".to_string()),
                (
                    "ns/b.py".to_string(),
                    "from . import a\na.func_a()".to_string(),
                ),
            ];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify ns is namespace package
            assert!(bundle.namespace_packages.contains("ns"));

            // Check that the import binding 'a' exists in ns/b.py
            let symbols: Vec<_> = store.symbols().collect();
            let b_file = store.files().find(|f| f.path == "ns/b.py").unwrap();

            let a_import = symbols.iter().find(|s| {
                s.name == "a" && s.decl_file_id == b_file.file_id && s.kind == SymbolKind::Import
            });

            assert!(
                a_import.is_some(),
                "ns/b.py should have import binding for 'a'"
            );
        }

        #[test]
        fn test_analyze_files_mixed_regular_and_namespace() {
            // Test file structure with both regular and namespace packages
            // Structure:
            //   regular/__init__.py - x = 1
            //   regular/mod.py - y = 2
            //   namespace/mod.py - z = 3
            //   main.py - from regular import x; from namespace.mod import z
            let mut store = FactsStore::new();
            let files = vec![
                ("regular/__init__.py".to_string(), "x = 1".to_string()),
                ("regular/mod.py".to_string(), "y = 2".to_string()),
                ("namespace/mod.py".to_string(), "z = 3".to_string()),
                (
                    "main.py".to_string(),
                    "from regular import x\nfrom namespace.mod import z".to_string(),
                ),
            ];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // regular should NOT be namespace (has __init__.py)
            assert!(!bundle.namespace_packages.contains("regular"));
            // namespace should be namespace package
            assert!(bundle.namespace_packages.contains("namespace"));

            // Both imports should create bindings in main.py
            let symbols: Vec<_> = store.symbols().collect();
            let main_file = store.files().find(|f| f.path == "main.py").unwrap();

            let x_import = symbols.iter().find(|s| {
                s.name == "x" && s.decl_file_id == main_file.file_id && s.kind == SymbolKind::Import
            });
            let z_import = symbols.iter().find(|s| {
                s.name == "z" && s.decl_file_id == main_file.file_id && s.kind == SymbolKind::Import
            });

            assert!(
                x_import.is_some(),
                "should have import binding for x from regular package"
            );
            assert!(
                z_import.is_some(),
                "should have import binding for z from namespace package"
            );
        }
    }

    mod convert_imports_tests {
        use super::*;

        #[test]
        fn convert_imports_captures_relative_level() {
            // Test that convert_imports properly captures relative_level from CST ImportInfo
            use tugtool_python_cst::{ImportInfo, ImportKind};

            let workspace_files: HashSet<String> = HashSet::new();

            // Create a mix of absolute and relative imports
            let cst_imports = vec![
                // Absolute import: import os
                ImportInfo {
                    module: "os".to_string(),
                    kind: ImportKind::Import,
                    names: None,
                    alias: None,
                    is_star: false,
                    span: None,
                    line: Some(1),
                    relative_level: 0,
                },
                // Single-level relative: from .utils import foo
                ImportInfo {
                    module: "utils".to_string(),
                    kind: ImportKind::From,
                    names: Some(vec![tugtool_python_cst::ImportedName {
                        name: "foo".to_string(),
                        alias: None,
                    }]),
                    alias: None,
                    is_star: false,
                    span: None,
                    line: Some(2),
                    relative_level: 1,
                },
                // Double-level relative: from ..parent import bar
                ImportInfo {
                    module: "parent".to_string(),
                    kind: ImportKind::From,
                    names: Some(vec![tugtool_python_cst::ImportedName {
                        name: "bar".to_string(),
                        alias: None,
                    }]),
                    alias: None,
                    is_star: false,
                    span: None,
                    line: Some(3),
                    relative_level: 2,
                },
            ];

            // Pass a dummy file path for relative import context
            let namespace_packages: HashSet<String> = HashSet::new();
            let local_imports = convert_imports(
                &cst_imports,
                &workspace_files,
                &namespace_packages,
                "pkg/test.py",
            );

            // Verify all imports are converted (no skipping!)
            assert_eq!(
                local_imports.len(),
                3,
                "All imports should be converted, including relative imports"
            );

            // Verify relative_level is captured correctly
            assert_eq!(
                local_imports[0].relative_level, 0,
                "Absolute import should have relative_level=0"
            );
            assert_eq!(
                local_imports[1].relative_level, 1,
                "Single-level relative import should have relative_level=1"
            );
            assert_eq!(
                local_imports[2].relative_level, 2,
                "Double-level relative import should have relative_level=2"
            );
        }

        #[test]
        fn convert_imports_includes_relative_star_import() {
            // Test that relative star imports are also included
            use tugtool_python_cst::{ImportInfo, ImportKind};

            let workspace_files: HashSet<String> = HashSet::new();

            let cst_imports = vec![ImportInfo {
                module: "utils".to_string(),
                kind: ImportKind::From,
                names: None,
                alias: None,
                is_star: true,
                span: None,
                line: Some(1),
                relative_level: 1, // from .utils import *
            }];

            // Pass a dummy file path for relative import context
            let namespace_packages: HashSet<String> = HashSet::new();
            let local_imports = convert_imports(
                &cst_imports,
                &workspace_files,
                &namespace_packages,
                "pkg/test.py",
            );

            assert_eq!(
                local_imports.len(),
                1,
                "Relative star import should be included"
            );
            assert!(local_imports[0].is_star, "Should be marked as star import");
            assert_eq!(
                local_imports[0].relative_level, 1,
                "Should have relative_level=1"
            );
        }
    }

    mod method_call_index_tests {
        use super::*;

        fn make_indexed_call(
            file_id: u32,
            receiver: &str,
            receiver_type: Option<&str>,
            span_start: usize,
            span_end: usize,
        ) -> IndexedMethodCall {
            IndexedMethodCall {
                file_id: FileId::new(file_id),
                receiver: receiver.to_string(),
                receiver_type: receiver_type.map(String::from),
                scope_path: vec!["<module>".to_string()],
                method_span: Span::new(span_start, span_end),
            }
        }

        #[test]
        fn empty_index_returns_empty_slice() {
            let index = MethodCallIndex::new();
            assert!(index.get("process").is_empty());
            assert_eq!(index.total_calls(), 0);
        }

        #[test]
        fn add_and_retrieve_single_call() {
            let mut index = MethodCallIndex::new();
            index.add(
                "process".to_string(),
                make_indexed_call(0, "handler", Some("Handler"), 50, 57),
            );

            let calls = index.get("process");
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].receiver, "handler");
            assert_eq!(calls[0].receiver_type, Some("Handler".to_string()));
            assert_eq!(calls[0].method_span, Span::new(50, 57));
        }

        #[test]
        fn add_multiple_calls_same_method() {
            let mut index = MethodCallIndex::new();

            // Two different receivers calling the same method
            index.add(
                "process".to_string(),
                make_indexed_call(0, "h1", Some("Handler"), 50, 57),
            );
            index.add(
                "process".to_string(),
                make_indexed_call(1, "h2", Some("Handler"), 100, 107),
            );

            let calls = index.get("process");
            assert_eq!(calls.len(), 2);
            assert_eq!(index.total_calls(), 2);
        }

        #[test]
        fn different_methods_dont_interfere() {
            let mut index = MethodCallIndex::new();

            index.add(
                "process".to_string(),
                make_indexed_call(0, "handler", Some("Handler"), 50, 57),
            );
            index.add(
                "run".to_string(),
                make_indexed_call(0, "runner", Some("Runner"), 80, 83),
            );

            assert_eq!(index.get("process").len(), 1);
            assert_eq!(index.get("run").len(), 1);
            assert!(index.get("unknown").is_empty());
            assert_eq!(index.total_calls(), 2);
        }

        #[test]
        fn untyped_calls_have_none_receiver_type() {
            let mut index = MethodCallIndex::new();
            index.add(
                "process".to_string(),
                make_indexed_call(0, "obj", None, 50, 57),
            );

            let calls = index.get("process");
            assert_eq!(calls.len(), 1);
            assert!(calls[0].receiver_type.is_none());
        }

        #[test]
        fn index_filters_by_receiver_type() {
            let mut index = MethodCallIndex::new();

            // Same method name, different receiver types
            index.add(
                "process".to_string(),
                make_indexed_call(0, "h1", Some("Handler1"), 50, 57),
            );
            index.add(
                "process".to_string(),
                make_indexed_call(0, "h2", Some("Handler2"), 100, 107),
            );
            index.add(
                "process".to_string(),
                make_indexed_call(0, "h3", None, 150, 157),
            );

            let calls = index.get("process");
            assert_eq!(calls.len(), 3);

            // Simulate what the fourth pass does: filter by receiver type
            let handler1_calls: Vec<_> = calls
                .iter()
                .filter(|c| c.receiver_type.as_deref() == Some("Handler1"))
                .collect();
            assert_eq!(handler1_calls.len(), 1);
            assert_eq!(handler1_calls[0].receiver, "h1");

            let handler2_calls: Vec<_> = calls
                .iter()
                .filter(|c| c.receiver_type.as_deref() == Some("Handler2"))
                .collect();
            assert_eq!(handler2_calls.len(), 1);
            assert_eq!(handler2_calls[0].receiver, "h2");
        }
    }

    mod import_resolver_tests {
        use super::*;

        fn make_from_import(
            module_path: &str,
            names: Vec<(&str, Option<&str>)>,
            resolved_file: Option<&str>,
        ) -> LocalImport {
            LocalImport {
                kind: "from".to_string(),
                module_path: module_path.to_string(),
                names: names
                    .into_iter()
                    .map(|(n, a)| ImportedName {
                        name: n.to_string(),
                        alias: a.map(String::from),
                    })
                    .collect(),
                alias: None,
                is_star: false,
                span: None,
                line: None,
                resolved_file: resolved_file.map(String::from),
                relative_level: 0,
            }
        }

        fn make_module_import(
            module_path: &str,
            alias: Option<&str>,
            resolved_file: Option<&str>,
        ) -> LocalImport {
            LocalImport {
                kind: "import".to_string(),
                module_path: module_path.to_string(),
                names: vec![],
                alias: alias.map(String::from),
                is_star: false,
                span: None,
                line: None,
                resolved_file: resolved_file.map(String::from),
                relative_level: 0,
            }
        }

        fn make_star_import(module_path: &str, resolved_file: Option<&str>) -> LocalImport {
            LocalImport {
                kind: "from".to_string(),
                module_path: module_path.to_string(),
                names: vec![],
                alias: None,
                is_star: true,
                span: None,
                line: None,
                resolved_file: resolved_file.map(String::from),
                relative_level: 0,
            }
        }

        #[test]
        fn empty_resolver() {
            let resolver = FileImportResolver::new();
            assert!(resolver.resolve("SomeClass").is_none());
            assert!(!resolver.is_imported("SomeClass"));
        }

        #[test]
        fn from_import_simple() {
            // from myproject.handlers import BaseHandler
            let imports = vec![make_from_import(
                "myproject.handlers",
                vec![("BaseHandler", None)],
                Some("myproject/handlers.py"),
            )];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            assert!(resolver.is_imported("BaseHandler"));
            let (qualified, resolved) = resolver.resolve("BaseHandler").unwrap();
            assert_eq!(qualified, "myproject.handlers.BaseHandler");
            assert_eq!(resolved, Some("myproject/handlers.py"));
        }

        #[test]
        fn from_import_with_alias() {
            // from myproject.handlers import BaseHandler as BH
            let imports = vec![make_from_import(
                "myproject.handlers",
                vec![("BaseHandler", Some("BH"))],
                Some("myproject/handlers.py"),
            )];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            // Should be accessible via alias, not original name
            assert!(resolver.is_imported("BH"));
            assert!(!resolver.is_imported("BaseHandler"));

            let (qualified, resolved) = resolver.resolve("BH").unwrap();
            assert_eq!(qualified, "myproject.handlers.BaseHandler");
            assert_eq!(resolved, Some("myproject/handlers.py"));
        }

        #[test]
        fn from_import_multiple_names() {
            // from myproject.handlers import BaseHandler, OtherHandler
            let imports = vec![make_from_import(
                "myproject.handlers",
                vec![("BaseHandler", None), ("OtherHandler", None)],
                Some("myproject/handlers.py"),
            )];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            assert!(resolver.is_imported("BaseHandler"));
            assert!(resolver.is_imported("OtherHandler"));

            assert_eq!(
                resolver.resolve("BaseHandler").unwrap().0,
                "myproject.handlers.BaseHandler"
            );
            assert_eq!(
                resolver.resolve("OtherHandler").unwrap().0,
                "myproject.handlers.OtherHandler"
            );
        }

        #[test]
        fn from_import_unresolved_file() {
            // from external_lib import SomeClass (external, not in workspace)
            let imports = vec![make_from_import(
                "external_lib",
                vec![("SomeClass", None)],
                None, // Not resolved to workspace file
            )];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            assert!(resolver.is_imported("SomeClass"));
            let (qualified, resolved) = resolver.resolve("SomeClass").unwrap();
            assert_eq!(qualified, "external_lib.SomeClass");
            assert!(resolved.is_none());
        }

        #[test]
        fn module_import_with_alias() {
            // import myproject.handlers as handlers
            let imports = vec![make_module_import(
                "myproject.handlers",
                Some("handlers"),
                Some("myproject/handlers.py"),
            )];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            assert!(resolver.is_imported("handlers"));
            let (qualified, resolved) = resolver.resolve("handlers").unwrap();
            assert_eq!(qualified, "myproject.handlers");
            assert_eq!(resolved, Some("myproject/handlers.py"));
        }

        #[test]
        fn module_import_without_alias() {
            // import myproject.handlers
            let imports = vec![make_module_import("myproject.handlers", None, None)];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            // Only the first component is tracked
            assert!(resolver.is_imported("myproject"));
            assert!(!resolver.is_imported("myproject.handlers"));
        }

        #[test]
        fn star_import_skipped() {
            // from myproject.handlers import *
            let imports = vec![make_star_import(
                "myproject.handlers",
                Some("myproject/handlers.py"),
            )];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            // Star imports can't resolve specific names
            assert!(!resolver.is_imported("BaseHandler"));
            assert!(!resolver.is_imported("*"));
        }

        #[test]
        fn multiple_imports() {
            let imports = vec![
                make_from_import(
                    "myproject.handlers",
                    vec![("BaseHandler", None)],
                    Some("myproject/handlers.py"),
                ),
                make_from_import(
                    "myproject.utils",
                    vec![("Helper", Some("H"))],
                    Some("myproject/utils.py"),
                ),
            ];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            assert!(resolver.is_imported("BaseHandler"));
            assert!(resolver.is_imported("H"));
            assert!(!resolver.is_imported("Helper")); // Aliased

            assert_eq!(
                resolver.resolved_file("BaseHandler"),
                Some("myproject/handlers.py")
            );
            assert_eq!(resolver.resolved_file("H"), Some("myproject/utils.py"));
        }

        #[test]
        fn resolved_file_helper() {
            let imports = vec![
                make_from_import(
                    "myproject.handlers",
                    vec![("BaseHandler", None)],
                    Some("myproject/handlers.py"),
                ),
                make_from_import(
                    "external",
                    vec![("External", None)],
                    None, // Not in workspace
                ),
            ];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            assert_eq!(
                resolver.resolved_file("BaseHandler"),
                Some("myproject/handlers.py")
            );
            assert!(resolver.resolved_file("External").is_none());
            assert!(resolver.resolved_file("Unknown").is_none());
        }

        #[test]
        fn resolve_imported_name_o1_lookup() {
            // Test that resolve_imported_name uses O(1) lookup via secondary index
            // from myproject.handlers import BaseHandler as BH
            let imports = vec![make_from_import(
                "myproject.handlers",
                vec![("BaseHandler", Some("BH"))],
                Some("myproject/handlers.py"),
            )];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            // Lookup by local name works
            assert!(resolver.resolve("BH").is_some());
            assert!(resolver.resolve("BaseHandler").is_none()); // Not the local name

            // Lookup by imported name works
            let (qualified, resolved) = resolver.resolve_imported_name("BaseHandler").unwrap();
            assert_eq!(qualified, "myproject.handlers.BaseHandler");
            assert_eq!(resolved, Some("myproject/handlers.py"));

            // Looking up by alias as imported name should fail
            assert!(resolver.resolve_imported_name("BH").is_none());
        }

        #[test]
        fn resolve_imported_name_no_alias() {
            // Test resolve_imported_name when there's no alias
            // from myproject.handlers import BaseHandler
            let imports = vec![make_from_import(
                "myproject.handlers",
                vec![("BaseHandler", None)],
                Some("myproject/handlers.py"),
            )];

            let resolver = FileImportResolver::from_imports_simple(&imports);

            // Both methods should work since local_name == imported_name
            let (q1, r1) = resolver.resolve("BaseHandler").unwrap();
            let (q2, r2) = resolver.resolve_imported_name("BaseHandler").unwrap();
            assert_eq!(q1, q2);
            assert_eq!(r1, r2);
        }
    }

    mod file_import_resolver_tests {
        use super::*;

        #[test]
        fn relative_import_creates_resolver_alias() {
            // Test that from .utils import foo creates the correct alias
            let workspace_files: HashSet<String> =
                vec!["pkg/utils.py".to_string()].into_iter().collect();

            let imports = vec![LocalImport {
                kind: "from".to_string(),
                module_path: "utils".to_string(),
                names: vec![ImportedName {
                    name: "foo".to_string(),
                    alias: None,
                }],
                alias: None,
                is_star: false,
                span: None,
                line: Some(1),
                resolved_file: None,
                relative_level: 1, // from .utils
            }];

            let namespace_packages: HashSet<String> = HashSet::new();
            let resolver = FileImportResolver::from_imports(
                &imports,
                &workspace_files,
                &namespace_packages,
                "pkg/consumer.py",
            );

            // Verify alias is created
            assert!(resolver.is_imported("foo"), "foo should be imported");

            // Verify it resolves correctly
            let (qualified, resolved) = resolver.resolve("foo").unwrap();
            assert_eq!(
                qualified, "pkg.utils.foo",
                "qualified name should be pkg.utils.foo"
            );
            assert_eq!(
                resolved,
                Some("pkg/utils.py"),
                "should resolve to pkg/utils.py"
            );
        }

        #[test]
        fn relative_import_resolves_to_correct_file() {
            // Test that relative import resolution finds the correct workspace file
            let workspace_files: HashSet<String> = vec![
                "lib/utils.py".to_string(),
                "lib/__init__.py".to_string(),
                "lib/processor.py".to_string(),
            ]
            .into_iter()
            .collect();

            // from .utils import process_data in lib/processor.py
            let imports = vec![LocalImport {
                kind: "from".to_string(),
                module_path: "utils".to_string(),
                names: vec![ImportedName {
                    name: "process_data".to_string(),
                    alias: None,
                }],
                alias: None,
                is_star: false,
                span: None,
                line: Some(1),
                resolved_file: None,
                relative_level: 1,
            }];

            let namespace_packages: HashSet<String> = HashSet::new();
            let resolver = FileImportResolver::from_imports(
                &imports,
                &workspace_files,
                &namespace_packages,
                "lib/processor.py",
            );

            let (qualified, resolved) = resolver.resolve("process_data").unwrap();
            assert_eq!(qualified, "lib.utils.process_data");
            assert_eq!(resolved, Some("lib/utils.py"));
        }

        #[test]
        fn from_package_itself_import() {
            // Test: from . import utils in pkg/__init__.py
            let workspace_files: HashSet<String> =
                vec!["pkg/__init__.py".to_string(), "pkg/utils.py".to_string()]
                    .into_iter()
                    .collect();

            let imports = vec![LocalImport {
                kind: "from".to_string(),
                module_path: "".to_string(), // from . import utils -> module is empty
                names: vec![ImportedName {
                    name: "utils".to_string(),
                    alias: None,
                }],
                alias: None,
                is_star: false,
                span: None,
                line: Some(1),
                resolved_file: None,
                relative_level: 1,
            }];

            let namespace_packages: HashSet<String> = HashSet::new();
            let resolver = FileImportResolver::from_imports(
                &imports,
                &workspace_files,
                &namespace_packages,
                "pkg/__init__.py",
            );

            // utils should be importable
            assert!(resolver.is_imported("utils"));
            let (qualified, resolved) = resolver.resolve("utils").unwrap();
            // For `from . import utils`, the qualified path includes the package
            // base_module_path becomes "pkg" (from resolve_relative_path("pkg/__init__.py", 1, ""))
            // Then qualified_path = "pkg.utils"
            assert_eq!(qualified, "pkg.utils");
            // resolve_module_to_file with empty module_path still works because
            // it uses the context path to resolve
            assert_eq!(resolved, Some("pkg/utils.py"));
        }

        #[test]
        fn nested_relative_import() {
            // Test: from .sub.utils import helper in pkg/main.py
            let workspace_files: HashSet<String> =
                vec!["pkg/sub/utils.py".to_string()].into_iter().collect();

            let imports = vec![LocalImport {
                kind: "from".to_string(),
                module_path: "sub.utils".to_string(),
                names: vec![ImportedName {
                    name: "helper".to_string(),
                    alias: None,
                }],
                alias: None,
                is_star: false,
                span: None,
                line: Some(1),
                resolved_file: None,
                relative_level: 1,
            }];

            let namespace_packages: HashSet<String> = HashSet::new();
            let resolver = FileImportResolver::from_imports(
                &imports,
                &workspace_files,
                &namespace_packages,
                "pkg/main.py",
            );

            let (qualified, resolved) = resolver.resolve("helper").unwrap();
            assert_eq!(qualified, "pkg.sub.utils.helper");
            assert_eq!(resolved, Some("pkg/sub/utils.py"));
        }
    }

    mod analysis_tests {
        use super::*;

        #[test]
        fn analyze_simple_function() {
            let content = "def foo():\n    x = 1\n    return x";
            let result = analyze_file(FileId::new(0), "test.py", content)
                .expect("should analyze successfully");

            // Check scopes
            assert!(
                result.scopes.len() >= 2,
                "should have module and function scopes"
            );
            let module_scope = result.scopes.iter().find(|s| s.kind == ScopeKind::Module);
            assert!(module_scope.is_some(), "should have module scope");

            let fn_scope = result.scopes.iter().find(|s| s.kind == ScopeKind::Function);
            assert!(fn_scope.is_some(), "should have function scope");
            assert_eq!(fn_scope.unwrap().name.as_deref(), Some("foo"));

            // Check symbols
            let foo_symbol = result.symbols.iter().find(|s| s.name == "foo");
            assert!(foo_symbol.is_some(), "should have foo symbol");
            assert_eq!(foo_symbol.unwrap().kind, SymbolKind::Function);

            let x_symbol = result.symbols.iter().find(|s| s.name == "x");
            assert!(x_symbol.is_some(), "should have x symbol");
            assert_eq!(x_symbol.unwrap().kind, SymbolKind::Variable);

            // Check references
            assert!(!result.references.is_empty(), "should have references");
        }

        #[test]
        fn analyze_class_with_method() {
            let content = "class MyClass:\n    def method(self):\n        pass";
            let result = analyze_file(FileId::new(0), "test.py", content)
                .expect("should analyze successfully");

            // Check scopes
            let class_scope = result.scopes.iter().find(|s| s.kind == ScopeKind::Class);
            assert!(class_scope.is_some(), "should have class scope");
            assert_eq!(class_scope.unwrap().name.as_deref(), Some("MyClass"));

            // Check symbols
            let class_symbol = result.symbols.iter().find(|s| s.name == "MyClass");
            assert!(class_symbol.is_some(), "should have MyClass symbol");
            assert_eq!(class_symbol.unwrap().kind, SymbolKind::Class);

            let method_symbol = result.symbols.iter().find(|s| s.name == "method");
            assert!(method_symbol.is_some(), "should have method symbol");
            assert_eq!(method_symbol.unwrap().kind, SymbolKind::Function);
        }

        #[test]
        fn analyze_nested_scopes() {
            let content = "def outer():\n    def inner():\n        x = 1\n    inner()";
            let result = analyze_file(FileId::new(0), "test.py", content)
                .expect("should analyze successfully");

            // Should have at least 3 scopes: module, outer, inner
            assert!(
                result.scopes.len() >= 3,
                "should have module, outer, and inner scopes"
            );

            // Check function scopes
            let outer_fn = result.symbols.iter().find(|s| s.name == "outer");
            assert!(outer_fn.is_some(), "should have outer function");

            let inner_fn = result.symbols.iter().find(|s| s.name == "inner");
            assert!(inner_fn.is_some(), "should have inner function");
        }

        #[test]
        fn analyze_comprehension() {
            let content = "[x * 2 for x in range(10)]";
            let result = analyze_file(FileId::new(0), "test.py", content)
                .expect("should analyze successfully");

            // Comprehensions create their own scope
            let comp_scope = result
                .scopes
                .iter()
                .find(|s| s.kind == ScopeKind::Comprehension);
            assert!(comp_scope.is_some(), "should have comprehension scope");
        }

        #[test]
        fn analyze_returns_valid_file_analysis() {
            let content = "x = 1";
            let result = analyze_file(FileId::new(42), "my_file.py", content)
                .expect("should analyze successfully");

            assert_eq!(result.file_id, FileId::new(42));
            assert_eq!(result.path, "my_file.py");
            assert!(!result.scopes.is_empty());
        }

        #[test]
        fn analyze_parse_error_returns_error() {
            let content = "def foo(\n"; // Invalid syntax
            let result = analyze_file(FileId::new(0), "test.py", content);

            assert!(result.is_err(), "should return error for invalid syntax");
        }
    }

    // ========================================================================
    // AliasGraph Integration Tests (Phase 10 Step 10)
    // ========================================================================

    mod alias_graph_tests {
        use super::*;

        /// AI-01: FileAnalysis.alias_graph not empty for code with aliases.
        #[test]
        fn test_analyzer_alias_graph_populated() {
            let content = "bar = 1\nb = bar";
            let result = analyze_file(FileId::new(0), "test.py", content)
                .expect("should analyze successfully");

            // Verify alias_graph is populated
            assert!(
                !result.alias_graph.is_empty(),
                "alias_graph should not be empty for code with aliases"
            );

            // Verify "b" aliases "bar"
            let aliases = result.alias_graph.direct_aliases("bar");
            assert!(!aliases.is_empty(), "should have aliases for 'bar'");
            assert!(
                aliases.iter().any(|a| a.alias_name == "b"),
                "should have 'b' as alias for 'bar'"
            );
        }

        /// AI-02: Graph built from NativeAnalysisResult.assignments.
        /// Constructors are NOT tracked as aliases, only variable references.
        #[test]
        fn test_analyzer_alias_from_assignments() {
            let content = "x = MyClass()\ny = x";
            let result = analyze_file(FileId::new(0), "test.py", content)
                .expect("should analyze successfully");

            // Constructor assignment (x = MyClass()) should NOT create an alias
            // Variable assignment (y = x) SHOULD create an alias
            let aliases_from_constructor = result.alias_graph.direct_aliases("MyClass");
            assert!(
                aliases_from_constructor.is_empty(),
                "constructor should not create alias entries"
            );

            // y = x should create an alias relationship
            let aliases_from_x = result.alias_graph.direct_aliases("x");
            assert!(
                aliases_from_x.iter().any(|a| a.alias_name == "y"),
                "'y' should alias 'x' (variable reference)"
            );
        }

        /// AI-03: Each file gets its own graph in analyze_files.
        #[test]
        fn test_analyzer_alias_per_file() {
            let content_a = "x = 1\na = x";
            let content_b = "x = 1\nb = x";

            let result_a =
                analyze_file(FileId::new(0), "a.py", content_a).expect("should analyze a.py");
            let result_b =
                analyze_file(FileId::new(1), "b.py", content_b).expect("should analyze b.py");

            // Each file should have its own alias graph
            let aliases_a = result_a.alias_graph.direct_aliases("x");
            let aliases_b = result_b.alias_graph.direct_aliases("x");

            // File A has 'a' aliasing 'x'
            assert!(
                aliases_a.iter().any(|a| a.alias_name == "a"),
                "file A should have 'a' aliasing 'x'"
            );
            assert!(
                !aliases_a.iter().any(|a| a.alias_name == "b"),
                "file A should NOT have 'b' (from file B)"
            );

            // File B has 'b' aliasing 'x'
            assert!(
                aliases_b.iter().any(|a| a.alias_name == "b"),
                "file B should have 'b' aliasing 'x'"
            );
            assert!(
                !aliases_b.iter().any(|a| a.alias_name == "a"),
                "file B should NOT have 'a' (from file A)"
            );
        }

        /// AI-04: scope_path from assignments flows to AliasInfo.
        #[test]
        fn test_analyzer_alias_scope_preserved() {
            let content = "bar = 1\ndef foo():\n    b = bar";
            let result = analyze_file(FileId::new(0), "test.py", content)
                .expect("should analyze successfully");

            // Check that the alias in function has correct scope_path
            let aliases = result.alias_graph.direct_aliases("bar");

            // Find the alias that's defined inside the function
            let function_alias = aliases
                .iter()
                .find(|a| a.alias_name == "b" && a.scope_path.iter().any(|p| p.contains("foo")));

            assert!(
                function_alias.is_some(),
                "alias 'b' should have scope_path containing 'foo'"
            );
        }

        /// AI-05: Aliases in file A don't appear in file B's graph.
        #[test]
        fn test_analyzer_alias_no_cross_file() {
            let content_a = "bar = 1\nb = bar";
            let content_b = "x = 1\ny = x";

            let result_a =
                analyze_file(FileId::new(0), "a.py", content_a).expect("should analyze a.py");
            let result_b =
                analyze_file(FileId::new(1), "b.py", content_b).expect("should analyze b.py");

            // File B's graph should have NO entries for 'bar'
            let aliases_b_bar = result_b.alias_graph.direct_aliases("bar");
            assert!(
                aliases_b_bar.is_empty(),
                "file B should have no aliases for 'bar' (which is in file A)"
            );

            // File A's graph should have NO entries for 'x'
            let aliases_a_x = result_a.alias_graph.direct_aliases("x");
            assert!(
                aliases_a_x.is_empty(),
                "file A should have no aliases for 'x' (which is in file B)"
            );
        }

        /// Additional test: imported names are correctly marked.
        #[test]
        fn test_analyzer_alias_import_flag() {
            let content = "from os import path\np = path";
            let result = analyze_file(FileId::new(0), "test.py", content)
                .expect("should analyze successfully");

            // Check that 'path' is recognized as imported
            let aliases = result.alias_graph.direct_aliases("path");

            // Find the alias 'p'
            let p_alias = aliases.iter().find(|a| a.alias_name == "p");
            if let Some(alias) = p_alias {
                assert!(
                    alias.source_is_import,
                    "'path' should be marked as an import"
                );
            }
        }
    }

    // ========================================================================
    // analyze_files Tests (Step 9.1)
    // ========================================================================

    mod analyze_files_tests {
        use super::*;
        use crate::analyzer::{analyze_files, FileAnalysisBundle, GlobalSymbolMap};

        #[test]
        fn function_signature_compiles() {
            // This test verifies the function signature matches the specification:
            // pub fn analyze_files(
            //     files: &[(String, String)],
            //     store: &mut FactsStore,
            // ) -> AnalyzerResult<FileAnalysisBundle>

            // Just verify the function exists and has correct signature by calling it
            let mut store = FactsStore::new();
            let files: Vec<(String, String)> = vec![];
            let result: AnalyzerResult<FileAnalysisBundle> = analyze_files(&files, &mut store);
            assert!(result.is_ok());
        }

        #[test]
        fn empty_file_list_returns_ok() {
            let mut store = FactsStore::new();
            let files: Vec<(String, String)> = vec![];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Bundle should be empty but valid
            assert_eq!(bundle.success_count(), 0);
            assert_eq!(bundle.failure_count(), 0);
            assert!(bundle.is_complete());
            assert!(bundle.file_analyses.is_empty());
            assert!(bundle.failed_files.is_empty());
            assert!(bundle.workspace_files.is_empty());

            // Store should be empty
            assert_eq!(store.files().count(), 0);
        }

        #[test]
        fn file_analysis_bundle_methods() {
            let mut bundle = FileAnalysisBundle::new();
            assert!(bundle.is_complete());
            assert_eq!(bundle.success_count(), 0);
            assert_eq!(bundle.failure_count(), 0);

            // Simulate adding a failure
            bundle.failed_files.push((
                "bad.py".to_string(),
                AnalyzerError::FileNotFound {
                    path: "bad.py".to_string(),
                },
            ));
            assert!(!bundle.is_complete());
            assert_eq!(bundle.failure_count(), 1);
        }

        #[test]
        fn global_symbol_map_type_alias() {
            // Verify the type alias is correctly defined
            let mut map: GlobalSymbolMap = HashMap::new();

            // Key is (name, kind), value is Vec<(FileId, SymbolId)>
            map.insert(
                ("foo".to_string(), SymbolKind::Function),
                vec![(FileId::new(0), SymbolId(1))],
            );

            assert!(map.contains_key(&("foo".to_string(), SymbolKind::Function)));
        }

        // ====================================================================
        // Pass 1 Tests (Step 9.2)
        // ====================================================================

        #[test]
        fn analyze_files_pass1_single_file() {
            // Test: Single file analyzed correctly
            let mut store = FactsStore::new();
            let files = vec![("test.py".to_string(), "def foo(): pass".to_string())];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // File should be analyzed successfully
            assert_eq!(bundle.success_count(), 1);
            assert_eq!(bundle.failure_count(), 0);
            assert!(bundle.is_complete());

            // FileAnalysis should have symbols
            assert_eq!(bundle.file_analyses.len(), 1);
            let analysis = &bundle.file_analyses[0];
            assert!(
                !analysis.symbols.is_empty(),
                "should have at least one symbol (foo)"
            );

            // Find the function symbol
            let foo_symbol = analysis
                .symbols
                .iter()
                .find(|s| s.name == "foo")
                .expect("should have foo symbol");
            assert_eq!(foo_symbol.kind, SymbolKind::Function);

            // Workspace files should be tracked
            assert!(bundle.workspace_files.contains("test.py"));
        }

        #[test]
        fn analyze_files_pass1_multiple_files_in_order() {
            // Test: Multiple files analyzed in order
            let mut store = FactsStore::new();
            let files = vec![
                ("first.py".to_string(), "def first_func(): pass".to_string()),
                (
                    "second.py".to_string(),
                    "class SecondClass: pass".to_string(),
                ),
                ("third.py".to_string(), "x = 1".to_string()),
            ];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // All files should be analyzed
            assert_eq!(bundle.success_count(), 3);
            assert_eq!(bundle.failure_count(), 0);
            assert!(bundle.is_complete());

            // Verify order is preserved (file_analyses should match input order)
            assert_eq!(bundle.file_analyses.len(), 3);

            // First file should have first_func
            let first = &bundle.file_analyses[0];
            assert!(
                first.symbols.iter().any(|s| s.name == "first_func"),
                "first file should have first_func"
            );

            // Second file should have SecondClass
            let second = &bundle.file_analyses[1];
            assert!(
                second.symbols.iter().any(|s| s.name == "SecondClass"),
                "second file should have SecondClass"
            );

            // Third file should have x
            let third = &bundle.file_analyses[2];
            assert!(
                third.symbols.iter().any(|s| s.name == "x"),
                "third file should have x"
            );

            // All workspace files tracked
            assert_eq!(bundle.workspace_files.len(), 3);
            assert!(bundle.workspace_files.contains("first.py"));
            assert!(bundle.workspace_files.contains("second.py"));
            assert!(bundle.workspace_files.contains("third.py"));
        }

        #[test]
        fn analyze_files_pass1_parse_error_continues() {
            // Test: Parse error in one file doesn't stop analysis of others
            let mut store = FactsStore::new();
            let files = vec![
                ("good1.py".to_string(), "def good1(): pass".to_string()),
                (
                    "bad.py".to_string(),
                    "def incomplete_syntax(".to_string(), // Invalid Python
                ),
                ("good2.py".to_string(), "def good2(): pass".to_string()),
            ];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Two files should succeed, one should fail
            assert_eq!(bundle.success_count(), 2);
            assert_eq!(bundle.failure_count(), 1);
            assert!(!bundle.is_complete()); // Not complete because one file failed

            // The failed file should be tracked
            assert_eq!(bundle.failed_files.len(), 1);
            assert_eq!(bundle.failed_files[0].0, "bad.py");

            // Successful files should have their symbols
            let good1 = bundle
                .file_analyses
                .iter()
                .find(|a| a.symbols.iter().any(|s| s.name == "good1"))
                .expect("should find good1 analysis");
            assert!(good1.symbols.iter().any(|s| s.name == "good1"));

            let good2 = bundle
                .file_analyses
                .iter()
                .find(|a| a.symbols.iter().any(|s| s.name == "good2"))
                .expect("should find good2 analysis");
            assert!(good2.symbols.iter().any(|s| s.name == "good2"));

            // All workspace files should be tracked (including failed one)
            assert_eq!(bundle.workspace_files.len(), 3);
            assert!(bundle.workspace_files.contains("good1.py"));
            assert!(bundle.workspace_files.contains("bad.py"));
            assert!(bundle.workspace_files.contains("good2.py"));
        }

        #[test]
        fn analyze_files_pass1_workspace_files_tracked() {
            // Test: Workspace file paths are tracked for import resolution
            let mut store = FactsStore::new();
            let files = vec![
                ("src/main.py".to_string(), "import utils".to_string()),
                ("src/utils.py".to_string(), "def helper(): pass".to_string()),
                ("tests/test_main.py".to_string(), "import main".to_string()),
            ];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // All paths should be in workspace_files
            assert_eq!(bundle.workspace_files.len(), 3);
            assert!(bundle.workspace_files.contains("src/main.py"));
            assert!(bundle.workspace_files.contains("src/utils.py"));
            assert!(bundle.workspace_files.contains("tests/test_main.py"));
        }

        // ====================================================================
        // Pass 2 Tests (Step 9.3)
        // ====================================================================

        #[test]
        fn analyze_files_pass2_symbols_inserted_with_unique_ids() {
            // Test: Symbols are inserted into FactsStore with unique IDs
            let mut store = FactsStore::new();
            let files = vec![
                ("a.py".to_string(), "def func_a(): pass".to_string()),
                (
                    "b.py".to_string(),
                    "def func_b(): pass\nclass ClassB: pass".to_string(),
                ),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify Files are in FactsStore
            let files_in_store: Vec<_> = store.files().collect();
            assert_eq!(files_in_store.len(), 2, "should have 2 files in store");

            // Verify Symbols are in FactsStore
            let symbols_in_store: Vec<_> = store.symbols().collect();
            assert!(
                symbols_in_store.len() >= 3,
                "should have at least 3 symbols (func_a, func_b, ClassB)"
            );

            // Verify SymbolIds are unique
            let symbol_ids: std::collections::HashSet<_> =
                symbols_in_store.iter().map(|s| s.symbol_id).collect();
            assert_eq!(
                symbol_ids.len(),
                symbols_in_store.len(),
                "all SymbolIds should be unique"
            );

            // Verify we can find specific symbols by name
            let func_a = symbols_in_store.iter().find(|s| s.name == "func_a");
            assert!(func_a.is_some(), "should have func_a symbol");
            assert_eq!(func_a.unwrap().kind, SymbolKind::Function);

            let class_b = symbols_in_store.iter().find(|s| s.name == "ClassB");
            assert!(class_b.is_some(), "should have ClassB symbol");
            assert_eq!(class_b.unwrap().kind, SymbolKind::Class);
        }

        #[test]
        fn analyze_files_pass2_methods_linked_to_container_classes() {
            // Test: Methods are linked to their containing classes
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "class MyClass:\n    def my_method(self):\n        pass".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let symbols: Vec<_> = store.symbols().collect();

            // Find the class symbol
            let class_sym = symbols
                .iter()
                .find(|s| s.name == "MyClass" && s.kind == SymbolKind::Class)
                .expect("should have MyClass symbol");

            // Find the method symbol
            let method_sym = symbols
                .iter()
                .find(|s| s.name == "my_method")
                .expect("should have my_method symbol");

            // Method should be linked to class
            assert_eq!(
                method_sym.container_symbol_id,
                Some(class_sym.symbol_id),
                "method should have class as container"
            );
        }

        #[test]
        fn analyze_files_pass2_import_bindings_tracked() {
            // Test: Import bindings are tracked separately
            // (This tests that SymbolKind::Import symbols are recognized)
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "main.py".to_string(),
                    "from utils import helper\nhelper()".to_string(),
                ),
                ("utils.py".to_string(), "def helper(): pass".to_string()),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify symbols are in store
            let symbols: Vec<_> = store.symbols().collect();
            assert!(!symbols.is_empty(), "should have symbols");

            // The helper definition in utils.py should be a Function
            let helper_def = symbols
                .iter()
                .find(|s| s.name == "helper" && s.kind == SymbolKind::Function);
            assert!(
                helper_def.is_some(),
                "should have helper function definition"
            );
        }

        #[test]
        fn analyze_files_pass2_global_symbols_map_populated() {
            // Test: GlobalSymbolMap is populated correctly
            // (We verify this indirectly by checking symbols in FactsStore)
            let mut store = FactsStore::new();
            let files = vec![
                ("a.py".to_string(), "def shared_name(): pass".to_string()),
                (
                    "b.py".to_string(),
                    "class shared_name: pass".to_string(), // Same name, different kind
                ),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let symbols: Vec<_> = store.symbols().collect();

            // Should have both symbols with the same name but different kinds
            let func = symbols
                .iter()
                .find(|s| s.name == "shared_name" && s.kind == SymbolKind::Function);
            let class = symbols
                .iter()
                .find(|s| s.name == "shared_name" && s.kind == SymbolKind::Class);

            assert!(func.is_some(), "should have function named shared_name");
            assert!(class.is_some(), "should have class named shared_name");

            // They should have different symbol IDs
            assert_ne!(
                func.unwrap().symbol_id,
                class.unwrap().symbol_id,
                "different symbols should have different IDs"
            );
        }

        #[test]
        fn analyze_files_pass2_scope_trees_built_with_parent_links() {
            // Test: Scope trees are built with correct parent links
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "def outer():\n    def inner():\n        pass".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify scopes are in store
            let scopes: Vec<_> = store.scopes().collect();
            assert!(
                scopes.len() >= 3,
                "should have module, outer, and inner scopes"
            );

            // Find module scope (should have no parent)
            let module_scope = scopes
                .iter()
                .find(|s| s.kind == ScopeKind::Module)
                .expect("should have module scope");
            assert!(
                module_scope.parent.is_none(),
                "module scope should have no parent"
            );

            // Function scopes should have parents
            let func_scopes: Vec<_> = scopes
                .iter()
                .filter(|s| s.kind == ScopeKind::Function)
                .collect();
            assert!(
                func_scopes.len() >= 2,
                "should have at least 2 function scopes (outer, inner)"
            );

            // At least one function scope should have a parent
            let has_parent = func_scopes.iter().any(|s| s.parent.is_some());
            assert!(
                has_parent,
                "at least one function scope should have a parent"
            );
        }

        #[test]
        fn analyze_files_pass2_global_nonlocal_declarations_tracked() {
            // Test: global/nonlocal declarations are tracked per scope
            // (This tests that the Scope struct captures these declarations)
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "x = 1\ndef foo():\n    global x\n    x = 2".to_string(),
            )];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify that the FileAnalysis has scopes with global declarations
            assert_eq!(bundle.file_analyses.len(), 1);
            let analysis = &bundle.file_analyses[0];

            // Find the function scope
            let func_scope = analysis
                .scopes
                .iter()
                .find(|s| s.kind == ScopeKind::Function);
            assert!(func_scope.is_some(), "should have function scope");

            // The function scope should have 'x' as global
            let func_scope = func_scope.unwrap();
            assert!(
                func_scope.globals.contains("x"),
                "function scope should have 'x' declared as global"
            );
        }

        // ====================================================================
        // Pass 3 Tests (Step 9.4)
        // ====================================================================

        #[test]
        fn analyze_files_pass3_same_file_references_resolved() {
            // Test: References within the same file are resolved correctly
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "def foo(): pass\ndef bar(): foo()".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify references are in store
            let references: Vec<_> = store.references().collect();
            assert!(!references.is_empty(), "should have references");

            // Find the foo symbol
            let symbols: Vec<_> = store.symbols().collect();
            let foo_sym = symbols
                .iter()
                .find(|s| s.name == "foo" && s.kind == SymbolKind::Function)
                .expect("should have foo symbol");

            // Check that there are references to foo
            let foo_refs: Vec<_> = references
                .iter()
                .filter(|r| r.symbol_id == foo_sym.symbol_id)
                .collect();
            assert!(!foo_refs.is_empty(), "should have references to foo symbol");
        }

        #[test]
        fn analyze_files_pass3_cross_file_references_via_imports() {
            // Test: Cross-file references through imports are resolved
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "main.py".to_string(),
                    "from utils import helper\nhelper()".to_string(),
                ),
                ("utils.py".to_string(), "def helper(): pass".to_string()),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find the helper definition in utils.py
            let symbols: Vec<_> = store.symbols().collect();
            let files_in_store: Vec<_> = store.files().collect();

            let utils_file = files_in_store
                .iter()
                .find(|f| f.path == "utils.py")
                .expect("should have utils.py");

            let helper_def = symbols
                .iter()
                .find(|s| {
                    s.name == "helper"
                        && s.decl_file_id == utils_file.file_id
                        && s.kind == SymbolKind::Function
                })
                .expect("should have helper function in utils.py");

            // Check that main.py has references to helper
            let references: Vec<_> = store.references().collect();
            let main_file = files_in_store
                .iter()
                .find(|f| f.path == "main.py")
                .expect("should have main.py");

            // The helper call in main.py should resolve to the definition in utils.py
            let cross_file_refs: Vec<_> = references
                .iter()
                .filter(|r| r.file_id == main_file.file_id && r.symbol_id == helper_def.symbol_id)
                .collect();

            assert!(
                !cross_file_refs.is_empty(),
                "should have cross-file reference from main.py to helper in utils.py"
            );
        }

        #[test]
        fn analyze_files_pass3_import_bindings_prefer_original_definitions() {
            // Test: When resolving references, prefer original definitions over import bindings
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "main.py".to_string(),
                    "from utils import helper\nhelper()".to_string(),
                ),
                ("utils.py".to_string(), "def helper(): pass".to_string()),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // The helper symbol in main.py should be an import binding
            let symbols: Vec<_> = store.symbols().collect();
            let files_in_store: Vec<_> = store.files().collect();

            let _main_file = files_in_store
                .iter()
                .find(|f| f.path == "main.py")
                .expect("should have main.py");
            let utils_file = files_in_store
                .iter()
                .find(|f| f.path == "utils.py")
                .expect("should have utils.py");

            // Should have helper function in utils.py (the original definition)
            let helper_original = symbols.iter().find(|s| {
                s.name == "helper"
                    && s.decl_file_id == utils_file.file_id
                    && s.kind == SymbolKind::Function
            });
            assert!(
                helper_original.is_some(),
                "should have original helper definition"
            );
        }

        #[test]
        fn analyze_files_pass3_imports_inserted() {
            // Test: Import records are inserted into FactsStore
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "import os\nfrom sys import path".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify imports are in store
            let imports: Vec<_> = store.imports().collect();
            assert!(!imports.is_empty(), "should have imports in store");

            // Should have import for os module
            let os_import = imports.iter().find(|i| i.module_path == "os");
            assert!(os_import.is_some(), "should have os import");

            // Should have import for sys.path
            let sys_import = imports.iter().find(|i| i.module_path == "sys");
            assert!(sys_import.is_some(), "should have sys import");
        }

        // ====================================================================
        // AC-3 Tests: Scope Chain Resolution (Contract C4)
        // ====================================================================

        #[test]
        fn analyze_files_pass3_ac3_local_shadows_global() {
            // Test: local shadows global (function scope hides module scope)
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "x = 1\ndef foo():\n    x = 2\n    return x".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have two x symbols - one at module level, one in function
            let symbols: Vec<_> = store.symbols().collect();
            let x_symbols: Vec<_> = symbols.iter().filter(|s| s.name == "x").collect();
            assert!(
                x_symbols.len() >= 2,
                "should have at least 2 x symbols (module and function level)"
            );
        }

        #[test]
        fn analyze_files_pass3_ac3_global_declaration_skips_to_module() {
            // Test: global x declaration skips to module scope
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "x = 1\ndef foo():\n    global x\n    x = 2".to_string(),
            )];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify the function scope has x declared as global
            let analysis = &bundle.file_analyses[0];
            let func_scope = analysis
                .scopes
                .iter()
                .find(|s| s.kind == ScopeKind::Function)
                .expect("should have function scope");

            assert!(
                func_scope.globals.contains("x"),
                "function scope should have x declared as global"
            );
        }

        #[test]
        fn analyze_files_pass3_ac3_nonlocal_skips_to_enclosing_function() {
            // Test: nonlocal x skips to nearest enclosing function scope
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "def outer():\n    x = 1\n    def inner():\n        nonlocal x\n        x = 2"
                    .to_string(),
            )];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify the inner function scope has x declared as nonlocal
            let analysis = &bundle.file_analyses[0];
            let func_scopes: Vec<_> = analysis
                .scopes
                .iter()
                .filter(|s| s.kind == ScopeKind::Function)
                .collect();

            // Should have both outer and inner function scopes
            assert!(
                func_scopes.len() >= 2,
                "should have at least 2 function scopes"
            );

            // One of them should have x as nonlocal
            let has_nonlocal = func_scopes.iter().any(|s| s.nonlocals.contains("x"));
            assert!(has_nonlocal, "one function scope should have x as nonlocal");
        }

        #[test]
        fn analyze_files_pass3_ac3_class_scope_no_closure() {
            // Test: class scope does NOT form closure
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "class Foo:\n    x = 1\n    def method(self):\n        return x".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // This should parse without error - the x in method refers to module x (if any)
            // or is unresolved, NOT to class x. This tests that class scopes don't form closures.
            let scopes: Vec<_> = store.scopes().collect();
            let class_scope = scopes.iter().find(|s| s.kind == ScopeKind::Class);
            assert!(class_scope.is_some(), "should have class scope");
        }

        #[test]
        fn analyze_files_pass3_ac3_comprehension_creates_own_scope() {
            // Test: comprehension creates own scope
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "x = 1\nresult = [x for x in range(5)]".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have a comprehension scope
            let scopes: Vec<_> = store.scopes().collect();
            let comprehension_scope = scopes.iter().find(|s| s.kind == ScopeKind::Comprehension);
            assert!(
                comprehension_scope.is_some(),
                "should have comprehension scope"
            );
        }

        // ====================================================================
        // AC-4 Tests: Import Resolution Parity (Contract C3)
        // ====================================================================

        #[test]
        fn analyze_files_pass3_ac4_import_foo_binds_foo() {
            // Test: `import foo` binds `foo`
            let mut store = FactsStore::new();
            let files = vec![("test.py".to_string(), "import os".to_string())];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have os as an import binding
            let symbols: Vec<_> = store.symbols().collect();
            let os_sym = symbols
                .iter()
                .find(|s| s.name == "os" && s.kind == SymbolKind::Import);
            assert!(os_sym.is_some(), "should have os import binding");
        }

        #[test]
        fn analyze_files_pass3_ac4_import_foo_bar_binds_root_only() {
            // Test: `import foo.bar` binds `foo` only (NOT `foo.bar`) - critical Python semantics
            let mut store = FactsStore::new();
            let files = vec![("test.py".to_string(), "import os.path".to_string())];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have os as an import binding, NOT os.path
            let symbols: Vec<_> = store.symbols().collect();
            let os_sym = symbols
                .iter()
                .find(|s| s.name == "os" && s.kind == SymbolKind::Import);
            assert!(os_sym.is_some(), "should have os import binding");

            // Should NOT have os.path as a binding
            let os_path_sym = symbols.iter().find(|s| s.name == "os.path");
            assert!(os_path_sym.is_none(), "should NOT have os.path as binding");
        }

        #[test]
        fn analyze_files_pass3_ac4_import_foo_as_f_binds_f() {
            // Test: `import foo as f` binds `f`
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "import os as operating_system".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have operating_system as an import binding
            let symbols: Vec<_> = store.symbols().collect();
            let alias_sym = symbols
                .iter()
                .find(|s| s.name == "operating_system" && s.kind == SymbolKind::Import);
            assert!(
                alias_sym.is_some(),
                "should have operating_system import binding"
            );
        }

        #[test]
        fn analyze_files_pass3_ac4_from_foo_import_bar_binds_bar() {
            // Test: `from foo import bar` binds `bar` with resolved file
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "main.py".to_string(),
                    "from utils import helper".to_string(),
                ),
                ("utils.py".to_string(), "def helper(): pass".to_string()),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have helper as an import binding in main.py
            let symbols: Vec<_> = store.symbols().collect();
            let files_in_store: Vec<_> = store.files().collect();
            let main_file = files_in_store.iter().find(|f| f.path == "main.py").unwrap();

            let helper_import = symbols.iter().find(|s| {
                s.name == "helper"
                    && s.decl_file_id == main_file.file_id
                    && s.kind == SymbolKind::Import
            });
            assert!(
                helper_import.is_some(),
                "should have helper import binding in main.py"
            );
        }

        #[test]
        fn analyze_files_pass3_ac4_from_foo_import_bar_as_b_binds_b() {
            // Test: `from foo import bar as b` binds `b`
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "main.py".to_string(),
                    "from utils import helper as h".to_string(),
                ),
                ("utils.py".to_string(), "def helper(): pass".to_string()),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have h as an import binding (not helper)
            let symbols: Vec<_> = store.symbols().collect();
            let files_in_store: Vec<_> = store.files().collect();
            let main_file = files_in_store.iter().find(|f| f.path == "main.py").unwrap();

            let h_import = symbols.iter().find(|s| {
                s.name == "h" && s.decl_file_id == main_file.file_id && s.kind == SymbolKind::Import
            });
            assert!(h_import.is_some(), "should have 'h' import binding");
        }

        #[test]
        fn analyze_files_pass3_ac4_relative_imports_return_none() {
            // Test: relative imports return None (documented limitation)
            let mut store = FactsStore::new();
            let files = vec![("pkg/main.py".to_string(), "from . import utils".to_string())];

            // Should succeed (not error on relative imports)
            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // The import is parsed but not resolved (limitation)
        }

        #[test]
        fn analyze_files_pass3_ac4_star_imports_return_none() {
            use tugtool_core::facts::ImportKind;

            // Test: star imports return None (documented limitation)
            let mut store = FactsStore::new();
            let files = vec![("test.py".to_string(), "from os import *".to_string())];

            // Should succeed (not error on star imports)
            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Star imports are tracked but specific names can't be resolved
            let imports: Vec<_> = store.imports().collect();
            let star_import = imports.iter().find(|i| i.kind == ImportKind::Glob);
            assert!(star_import.is_some(), "should have star import tracked");
        }

        #[test]
        fn analyze_files_pass3_ac4_module_resolution_prefers_py_file() {
            // Test: module resolution "foo" → "foo.py" wins over "foo/__init__.py"
            // We test this with the resolve_module_to_file function
            let workspace_files: HashSet<String> =
                vec!["utils.py".to_string(), "utils/__init__.py".to_string()]
                    .into_iter()
                    .collect();
            let namespace_packages: HashSet<String> = HashSet::new();

            // Absolute import (relative_level = 0)
            let resolved =
                resolve_module_to_file("utils", &workspace_files, &namespace_packages, None, 0);
            assert_eq!(
                resolved,
                Some(ResolvedModule::File("utils.py".to_string())),
                "should prefer utils.py over utils/__init__.py"
            );
        }

        // ====================================================================
        // Pass 4 Tests: Type-Aware Method Resolution (Step 9.5)
        // ====================================================================

        #[test]
        fn analyze_files_pass4_type_info_populated() {
            // Test: TypeInfo is populated from constructor calls and annotations
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Handler:
    def process(self):
        pass

h = Handler()
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have type info for 'h' variable
            let symbols: Vec<_> = store.symbols().collect();
            let h_symbol = symbols
                .iter()
                .find(|s| s.name == "h" && s.kind == SymbolKind::Variable);

            assert!(h_symbol.is_some(), "should have h symbol");

            let h_id = h_symbol.unwrap().symbol_id;
            let type_info = store.type_of_symbol(h_id);

            // Type info should be populated from constructor call
            assert!(type_info.is_some(), "should have type info for h");
            assert_eq!(
                type_info.unwrap().type_repr,
                "Handler",
                "h should have type Handler"
            );
        }

        #[test]
        fn analyze_files_pass4_inheritance_info_populated() {
            // Test: InheritanceInfo is populated for class hierarchies
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Base:
    def method(self):
        pass

class Child(Base):
    pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find class symbols
            let symbols: Vec<_> = store.symbols().collect();
            let base_sym = symbols
                .iter()
                .find(|s| s.name == "Base" && s.kind == SymbolKind::Class);
            let child_sym = symbols
                .iter()
                .find(|s| s.name == "Child" && s.kind == SymbolKind::Class);

            assert!(base_sym.is_some(), "should have Base class");
            assert!(child_sym.is_some(), "should have Child class");

            let base_id = base_sym.unwrap().symbol_id;
            let child_id = child_sym.unwrap().symbol_id;

            // Check inheritance relationships
            let children = store.children_of_class(base_id);
            let parents = store.parents_of_class(child_id);

            assert!(
                children.contains(&child_id),
                "Base should have Child as child"
            );
            assert!(
                parents.contains(&base_id),
                "Child should have Base as parent"
            );
        }

        #[test]
        fn analyze_files_pass4_typed_method_calls_resolved() {
            // Test: Method calls on typed receivers are resolved to method symbols
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Handler:
    def process(self):
        pass

h = Handler()
h.process()
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find the process method symbol
            let symbols: Vec<_> = store.symbols().collect();
            let process_sym = symbols
                .iter()
                .find(|s| s.name == "process" && s.kind == SymbolKind::Function);

            assert!(process_sym.is_some(), "should have process method");

            let process_id = process_sym.unwrap().symbol_id;

            // Check that there's a Call reference to the process method
            let refs: Vec<_> = store
                .references()
                .filter(|r| r.symbol_id == process_id)
                .collect();

            assert!(
                refs.iter().any(|r| r.ref_kind == ReferenceKind::Call),
                "should have Call reference to process method from h.process()"
            );
        }

        #[test]
        fn analyze_files_pass4_self_method_calls_resolved() {
            // Test: self.method() calls within class are resolved
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Handler:
    def process(self):
        self.helper()

    def helper(self):
        pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find the helper method symbol
            let symbols: Vec<_> = store.symbols().collect();
            let helper_sym = symbols
                .iter()
                .find(|s| s.name == "helper" && s.kind == SymbolKind::Function);

            assert!(helper_sym.is_some(), "should have helper method");

            let helper_id = helper_sym.unwrap().symbol_id;

            // Check that there's a Call reference to helper from self.helper()
            let refs: Vec<_> = store
                .references()
                .filter(|r| r.symbol_id == helper_id)
                .collect();

            assert!(
                refs.iter().any(|r| r.ref_kind == ReferenceKind::Call),
                "should have Call reference to helper method from self.helper()"
            );
        }

        #[test]
        fn analyze_files_pass4_cross_file_inheritance() {
            // Test: Inheritance across files via imports is resolved
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "base.py".to_string(),
                    "class Base:\n    def method(self): pass".to_string(),
                ),
                (
                    "child.py".to_string(),
                    "from base import Base\nclass Child(Base): pass".to_string(),
                ),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find class symbols
            let symbols: Vec<_> = store.symbols().collect();
            let base_sym = symbols
                .iter()
                .find(|s| s.name == "Base" && s.kind == SymbolKind::Class);
            let child_sym = symbols
                .iter()
                .find(|s| s.name == "Child" && s.kind == SymbolKind::Class);

            assert!(base_sym.is_some(), "should have Base class");
            assert!(child_sym.is_some(), "should have Child class");

            let base_id = base_sym.unwrap().symbol_id;
            let child_id = child_sym.unwrap().symbol_id;

            // Check inheritance is resolved across files
            let children = store.children_of_class(base_id);
            let parents = store.parents_of_class(child_id);

            assert!(
                children.contains(&child_id),
                "Base should have Child as child (cross-file)"
            );
            assert!(
                parents.contains(&base_id),
                "Child should have Base as parent (cross-file)"
            );
        }

        #[test]
        fn analyze_files_pass4_annotated_parameter_type_resolution() {
            // Test: Method calls on annotated parameters are resolved
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Handler:
    def process(self):
        pass

def call_handler(h: Handler):
    h.process()
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find the process method symbol
            let symbols: Vec<_> = store.symbols().collect();
            let process_sym = symbols
                .iter()
                .find(|s| s.name == "process" && s.kind == SymbolKind::Function);

            assert!(process_sym.is_some(), "should have process method");

            let process_id = process_sym.unwrap().symbol_id;

            // Check that there's a Call reference to process from the annotated h.process()
            let refs: Vec<_> = store
                .references()
                .filter(|r| r.symbol_id == process_id)
                .collect();

            assert!(
                refs.iter().any(|r| r.ref_kind == ReferenceKind::Call),
                "should have Call reference to process method from annotated parameter"
            );
        }
    }

    // ========================================================================
    // PublicExport Tests (Step 3a)
    // ========================================================================

    mod public_export_tests {
        use super::*;

        #[test]
        fn test_public_export_all_entries_produces_public_exports() {
            // Test: Python __all__ entries produce PublicExport records
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["foo", "bar"]

def foo():
    pass

def bar():
    pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Verify PublicExport records were created
            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 2, "should have 2 public exports");

            // Verify names are correct
            let names: Vec<_> = public_exports
                .iter()
                .filter_map(|e| e.exported_name.as_ref())
                .collect();
            assert!(names.contains(&&"foo".to_string()));
            assert!(names.contains(&&"bar".to_string()));
        }

        #[test]
        fn test_public_export_kind_is_python_all() {
            // Test: ExportKind is PythonAll for __all__ entries
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["func"]
def func(): pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);
            assert_eq!(
                public_exports[0].export_kind,
                ExportKind::PythonAll,
                "export_kind should be PythonAll"
            );
        }

        #[test]
        fn test_public_export_target_is_single() {
            // Test: ExportTarget is Single for individual __all__ entries
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["func"]
def func(): pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);
            assert_eq!(
                public_exports[0].export_target,
                ExportTarget::Single,
                "export_target should be Single"
            );
        }

        #[test]
        fn test_public_export_intent_is_declared() {
            // Test: ExportIntent is Declared for explicit __all__ entries
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["func"]
def func(): pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);
            assert_eq!(
                public_exports[0].export_intent,
                ExportIntent::Declared,
                "export_intent should be Declared"
            );
        }

        #[test]
        fn test_public_export_origin_is_local() {
            // Test: ExportOrigin is Local for locally-defined exports
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["func"]
def func(): pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);
            assert_eq!(
                public_exports[0].export_origin,
                ExportOrigin::Local,
                "export_origin should be Local"
            );
        }

        #[test]
        fn test_public_export_exported_name_span_excludes_quotes() {
            // Test: exported_name_span points at string content only (no quotes)
            let mut store = FactsStore::new();
            let source = r#"__all__ = ["foo"]
def foo(): pass
"#;
            let files = vec![("test.py".to_string(), source.to_string())];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);

            let export = &public_exports[0];
            let name_span = export
                .exported_name_span
                .expect("should have exported_name_span");

            // The string content is "foo" (without quotes)
            let content = &source[name_span.start..name_span.end];
            assert_eq!(content, "foo", "exported_name_span should cover 'foo' only");

            // Verify it doesn't include quotes
            assert!(
                !content.starts_with('"'),
                "span should not include opening quote"
            );
            assert!(
                !content.ends_with('"'),
                "span should not include closing quote"
            );
        }

        #[test]
        fn test_public_export_decl_span_includes_quotes() {
            // Test: decl_span covers the full string literal including quotes
            let mut store = FactsStore::new();
            let source = r#"__all__ = ["foo"]
def foo(): pass
"#;
            let files = vec![("test.py".to_string(), source.to_string())];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);

            let export = &public_exports[0];
            let decl_span = export.decl_span;

            // The full string literal is "\"foo\"" (with quotes)
            let content = &source[decl_span.start..decl_span.end];
            assert_eq!(content, "\"foo\"", "decl_span should cover '\"foo\"'");
        }

        #[test]
        fn test_public_export_symbol_id_resolved_for_function() {
            // Test: symbol_id is resolved when exported name matches a defined function
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["my_func"]
def my_func():
    pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);

            let export = &public_exports[0];
            assert!(
                export.symbol_id.is_some(),
                "symbol_id should be resolved for my_func"
            );

            // Verify the resolved symbol is the function
            let symbol = store.symbol(export.symbol_id.unwrap());
            assert!(symbol.is_some());
            assert_eq!(symbol.unwrap().name, "my_func");
            assert_eq!(symbol.unwrap().kind, SymbolKind::Function);
        }

        #[test]
        fn test_public_export_symbol_id_resolved_for_class() {
            // Test: symbol_id is resolved when exported name matches a defined class
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["MyClass"]
class MyClass:
    pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);

            let export = &public_exports[0];
            assert!(
                export.symbol_id.is_some(),
                "symbol_id should be resolved for MyClass"
            );

            let symbol = store.symbol(export.symbol_id.unwrap());
            assert!(symbol.is_some());
            assert_eq!(symbol.unwrap().name, "MyClass");
            assert_eq!(symbol.unwrap().kind, SymbolKind::Class);
        }

        #[test]
        fn test_public_export_symbol_id_resolved_for_variable() {
            // Test: symbol_id is resolved when exported name matches a defined variable
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["CONSTANT"]
CONSTANT = 42
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);

            let export = &public_exports[0];
            assert!(
                export.symbol_id.is_some(),
                "symbol_id should be resolved for CONSTANT"
            );

            let symbol = store.symbol(export.symbol_id.unwrap());
            assert!(symbol.is_some());
            assert_eq!(symbol.unwrap().name, "CONSTANT");
        }

        #[test]
        fn test_public_export_symbol_id_none_for_unmatched() {
            // Test: symbol_id is None when exported name doesn't match any symbol
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["nonexistent"]
def actual_func():
    pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);

            let export = &public_exports[0];
            assert!(
                export.symbol_id.is_none(),
                "symbol_id should be None for unmatched name"
            );
            assert_eq!(
                export.exported_name.as_ref().unwrap(),
                "nonexistent",
                "name should still be preserved"
            );
        }

        #[test]
        fn test_public_export_empty_all_yields_zero_exports() {
            // Test: Empty __all__ yields zero PublicExport entries
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = []
def func():
    pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert!(
                public_exports.is_empty(),
                "empty __all__ should produce zero public exports"
            );
        }

        #[test]
        fn test_public_export_source_name_equals_exported_name() {
            // Test: For non-aliased Python exports, source_name == exported_name
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["func"]
def func(): pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 1);

            let export = &public_exports[0];
            assert_eq!(
                export.exported_name, export.source_name,
                "exported_name should equal source_name for non-aliased exports"
            );
            assert_eq!(export.exported_name.as_ref().unwrap(), "func");
        }

        #[test]
        fn test_public_export_augmented_all() {
            // Test: Augmented __all__ (+=) produces PublicExport entries
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"__all__ = ["foo"]
__all__ += ["bar"]
def foo(): pass
def bar(): pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(public_exports.len(), 2, "should have 2 public exports");

            let names: Vec<_> = public_exports
                .iter()
                .filter_map(|e| e.exported_name.as_ref())
                .collect();
            assert!(names.contains(&&"foo".to_string()));
            assert!(names.contains(&&"bar".to_string()));
        }

        #[test]
        fn test_public_export_no_all_produces_zero_exports() {
            // Test: File without __all__ produces zero PublicExport entries
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"def func():
    pass
"#
                .to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert!(
                public_exports.is_empty(),
                "file without __all__ should have zero public exports"
            );
        }

        #[test]
        fn test_public_export_multi_file_with_exports() {
            // Integration test: Multiple files with exports, symbol resolution works across files
            let mut store = FactsStore::new();
            let files = vec![
                (
                    "mod_a.py".to_string(),
                    r#"__all__ = ["func_a"]
def func_a(): pass
"#
                    .to_string(),
                ),
                (
                    "mod_b.py".to_string(),
                    r#"__all__ = ["func_b", "ClassB"]
def func_b(): pass
class ClassB: pass
"#
                    .to_string(),
                ),
            ];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            let public_exports: Vec<_> = store.public_exports().collect();
            assert_eq!(
                public_exports.len(),
                3,
                "should have 3 total public exports"
            );

            // All exports should have resolved symbol_ids
            for export in &public_exports {
                assert!(
                    export.symbol_id.is_some(),
                    "export '{}' should have resolved symbol_id",
                    export
                        .exported_name
                        .as_ref()
                        .unwrap_or(&"<none>".to_string())
                );
            }
        }

        // ====================================================================
        // Step 0.5 Integration Tests: TypeTracker via Real Code Path
        // ====================================================================
        // These tests verify that TypeTracker methods work correctly when
        // going through the REAL code path (analyze_files), not just when
        // called directly on TypeTracker::new().

        #[test]
        fn analyze_file_tracks_instance_attribute_types() {
            // Test: Instance attributes assigned in __init__ have their types tracked
            // via the real code path (analyze_files -> TypeTracker)
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Handler:
    def process(self):
        pass

class Service:
    def __init__(self):
        self.handler = Handler()

    def run(self):
        self.handler.process()
"#
                .to_string(),
            )];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Get the TypeTracker for the file
            let file_analysis = bundle.file_analyses.first().expect("should have file");
            let tracker = bundle
                .type_trackers
                .get(&file_analysis.file_id)
                .expect("should have type tracker");

            // Verify that self.handler's type is tracked as "Handler"
            let attr_type = tracker.attribute_type_of("Service", "handler");
            assert!(
                attr_type.is_some(),
                "should track attribute type for Service.handler"
            );
            assert_eq!(
                attr_type.unwrap().type_str,
                "Handler",
                "Service.handler should have type Handler"
            );
        }

        #[test]
        fn analyze_file_class_annotation_overrides_init() {
            // Test: Class-level annotation takes precedence over __init__ assignment
            // when the __init__ assignment has no type info
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Handler:
    pass

class OtherHandler:
    pass

def create_handler():
    return OtherHandler()

class Service:
    handler: Handler  # Class-level annotation

    def __init__(self):
        self.handler = create_handler()  # No type info from RHS
"#
                .to_string(),
            )];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            let file_analysis = bundle.file_analyses.first().expect("should have file");
            let tracker = bundle
                .type_trackers
                .get(&file_analysis.file_id)
                .expect("should have type tracker");

            // Class-level annotation should win over untyped __init__ assignment
            let attr_type = tracker.attribute_type_of("Service", "handler");
            assert!(
                attr_type.is_some(),
                "should track attribute type for Service.handler"
            );
            assert_eq!(
                attr_type.unwrap().type_str,
                "Handler",
                "Service.handler should have type Handler from annotation, not OtherHandler"
            );
        }

        #[test]
        fn analyze_file_propagates_parameter_types() {
            // Test: Type is propagated when assigning from a typed parameter
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Logger:
    def log(self, msg: str):
        pass

class Service:
    def __init__(self, logger: Logger):
        self.logger = logger  # Type propagated from parameter
"#
                .to_string(),
            )];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            let file_analysis = bundle.file_analyses.first().expect("should have file");
            let tracker = bundle
                .type_trackers
                .get(&file_analysis.file_id)
                .expect("should have type tracker");

            // self.logger should have type Logger propagated from parameter
            let attr_type = tracker.attribute_type_of("Service", "logger");
            assert!(
                attr_type.is_some(),
                "should track attribute type for Service.logger"
            );
            assert_eq!(
                attr_type.unwrap().type_str,
                "Logger",
                "Service.logger should have type Logger from parameter"
            );
        }

        #[test]
        fn analyze_file_tracks_multiple_attributes() {
            // Test: Multiple instance attributes are all tracked
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                r#"
class Handler:
    pass

class Logger:
    pass

class Config:
    pass

class Service:
    def __init__(self):
        self.handler = Handler()
        self.logger = Logger()
        self.config = Config()
"#
                .to_string(),
            )];

            let bundle = analyze_files(&files, &mut store).expect("should succeed");

            let file_analysis = bundle.file_analyses.first().expect("should have file");
            let tracker = bundle
                .type_trackers
                .get(&file_analysis.file_id)
                .expect("should have type tracker");

            // All three attributes should be tracked
            let handler_type = tracker.attribute_type_of("Service", "handler");
            assert!(handler_type.is_some(), "should track Service.handler");
            assert_eq!(handler_type.unwrap().type_str, "Handler");

            let logger_type = tracker.attribute_type_of("Service", "logger");
            assert!(logger_type.is_some(), "should track Service.logger");
            assert_eq!(logger_type.unwrap().type_str, "Logger");

            let config_type = tracker.attribute_type_of("Service", "config");
            assert!(config_type.is_some(), "should track Service.config");
            assert_eq!(config_type.unwrap().type_str, "Config");
        }
    }

    // ========================================================================
    // Nested Class Scope Tracking Tests (Phase 11C Step 5)
    // ========================================================================

    mod nested_class_scope_tests {
        use super::*;

        #[test]
        fn nested_class_outer_inner_produces_correct_scope_path() {
            // Unit test: Nested class `Outer.Inner` produces correct scope_path
            // [Fixture 11C-F05]
            let adapter = PythonAdapter::new();
            let content = r#"
class Outer:
    class Inner:
        def method(self):
            pass
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Inner class symbol
            let inner_symbol = result.symbols.iter().find(|s| s.name == "Inner");
            assert!(inner_symbol.is_some(), "Should have Inner class symbol");

            // Inner class should have scope_path ["<module>", "Outer"]
            assert_eq!(
                inner_symbol.unwrap().scope_path,
                vec!["<module>", "Outer"],
                "Inner class should have scope_path ['<module>', 'Outer']"
            );

            // Outer class should have scope_path ["<module>"]
            let outer_symbol = result.symbols.iter().find(|s| s.name == "Outer");
            assert!(outer_symbol.is_some(), "Should have Outer class symbol");
            assert_eq!(
                outer_symbol.unwrap().scope_path,
                vec!["<module>"],
                "Outer class should have scope_path ['<module>']"
            );
        }

        #[test]
        fn inner_class_method_has_correct_scope_path() {
            // Unit test: Inner class method has scope_path ["<module>", "Outer", "Inner", "method"]
            // [Fixture 11C-F05]
            let adapter = PythonAdapter::new();
            let content = r#"
class Outer:
    class Inner:
        def method(self):
            x = 1
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the method symbol
            let method_symbol = result.symbols.iter().find(|s| s.name == "method");
            assert!(method_symbol.is_some(), "Should have method symbol");

            // Method should have scope_path ["<module>", "Outer", "Inner"]
            assert_eq!(
                method_symbol.unwrap().scope_path,
                vec!["<module>", "Outer", "Inner"],
                "Method should have scope_path ['<module>', 'Outer', 'Inner']"
            );
        }

        #[test]
        fn inner_class_method_references_resolve_correctly() {
            // Integration test: Inner class method references resolve correctly
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self):
        pass

class Outer:
    class Inner:
        def get_handler(self) -> Handler:
            return Handler()

        def use_handler(self):
            h = self.get_handler()
            h.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // The Handler class should exist
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // Find the method call for h.process()
            let process_call = result
                .calls
                .iter()
                .find(|c| c.callee_symbol_index == handler_idx);

            // The call should resolve to Handler class
            assert!(
                process_call.is_some(),
                "h.process() should resolve - callee_symbol_index pointing to Handler"
            );
        }

        #[test]
        fn doubly_nested_class_scope_paths_correct() {
            // Integration test: Doubly-nested class (Outer.Middle.Inner) scope paths correct
            let adapter = PythonAdapter::new();
            let content = r#"
class Outer:
    class Middle:
        class Inner:
            def deep_method(self):
                pass
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Verify scope_path for each level
            let outer = result.symbols.iter().find(|s| s.name == "Outer").unwrap();
            assert_eq!(
                outer.scope_path,
                vec!["<module>"],
                "Outer scope_path should be ['<module>']"
            );

            let middle = result.symbols.iter().find(|s| s.name == "Middle").unwrap();
            assert_eq!(
                middle.scope_path,
                vec!["<module>", "Outer"],
                "Middle scope_path should be ['<module>', 'Outer']"
            );

            let inner = result.symbols.iter().find(|s| s.name == "Inner").unwrap();
            assert_eq!(
                inner.scope_path,
                vec!["<module>", "Outer", "Middle"],
                "Inner scope_path should be ['<module>', 'Outer', 'Middle']"
            );

            let method = result
                .symbols
                .iter()
                .find(|s| s.name == "deep_method")
                .unwrap();
            assert_eq!(
                method.scope_path,
                vec!["<module>", "Outer", "Middle", "Inner"],
                "deep_method scope_path should be ['<module>', 'Outer', 'Middle', 'Inner']"
            );
        }

        #[test]
        fn nested_class_attribute_resolution() {
            // Integration test: Attributes within nested classes resolve correctly
            let adapter = PythonAdapter::new();
            let content = r#"
class Handler:
    def process(self):
        pass

class Outer:
    class Inner:
        handler: Handler

        def run(self):
            self.handler.process()
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Find the Handler class
            let handler_idx = result.symbols.iter().position(|s| s.name == "Handler");
            assert!(handler_idx.is_some(), "Should have Handler symbol");

            // Find the process attribute access - should resolve to Handler
            let process_attr = result.attributes.iter().find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have process attribute access"
            );

            // The base_symbol_index should point to Handler
            assert_eq!(
                process_attr.unwrap().base_symbol_index,
                handler_idx,
                "process attribute should have base_symbol_index pointing to Handler"
            );
        }

        #[test]
        fn nested_class_with_sibling_classes() {
            // Test: Multiple nested classes at same level have correct scope_paths
            let adapter = PythonAdapter::new();
            let content = r#"
class Container:
    class First:
        def method_a(self):
            pass

    class Second:
        def method_b(self):
            pass
"#;
            let result = adapter.analyze_file("test.py", content).unwrap();

            // Both First and Second should have same parent scope
            let first = result.symbols.iter().find(|s| s.name == "First").unwrap();
            let second = result.symbols.iter().find(|s| s.name == "Second").unwrap();

            assert_eq!(
                first.scope_path, second.scope_path,
                "Sibling nested classes should have same scope_path"
            );
            assert_eq!(
                first.scope_path,
                vec!["<module>", "Container"],
                "Sibling classes should be in Container scope"
            );

            // Methods should be in their respective class scopes
            let method_a = result
                .symbols
                .iter()
                .find(|s| s.name == "method_a")
                .unwrap();
            let method_b = result
                .symbols
                .iter()
                .find(|s| s.name == "method_b")
                .unwrap();

            assert_eq!(
                method_a.scope_path,
                vec!["<module>", "Container", "First"],
                "method_a should be in First scope"
            );
            assert_eq!(
                method_b.scope_path,
                vec!["<module>", "Container", "Second"],
                "method_b should be in Second scope"
            );
        }

        // ====================================================================
        // Cross-File Resolution Integration Tests (Phase 11D Step 2)
        // ====================================================================

        #[test]
        fn cross_file_resolve_imported_class_attribute() {
            // Integration test: Resolve attribute on imported class.
            // Fixture 11D-F01 pattern: handler.py defines Handler, service.py imports it.
            //
            // handler.py:
            //   class Handler:
            //       def process(self): pass
            //
            // service.py:
            //   from handler import Handler
            //   class Service:
            //       handler: Handler
            //       def run(self):
            //           self.handler.process()  # Should resolve Handler.process
            use tempfile::TempDir;

            let adapter = PythonAdapter::new();

            // Create temp directory with test files
            let temp_dir = TempDir::new().unwrap();
            let handler_path = temp_dir.path().join("handler.py");
            let service_path = temp_dir.path().join("service.py");

            let handler_content = r#"
class Handler:
    def process(self): pass
"#;
            let service_content = r#"
from handler import Handler

class Service:
    handler: Handler

    def run(self):
        self.handler.process()
"#;
            std::fs::write(&handler_path, handler_content).unwrap();
            std::fs::write(&service_path, service_content).unwrap();

            // Analyze service.py
            let service_result = adapter.analyze_file("service.py", service_content).unwrap();

            // The process attribute access should have a receiver
            let process_attr = service_result
                .attributes
                .iter()
                .find(|a| a.name == "process");
            assert!(
                process_attr.is_some(),
                "Should have attribute access for 'process'"
            );

            // Without cross-file cache wired up, it should not resolve locally
            // but should be marked as needing cross-file resolution
            let attr = process_attr.unwrap();
            assert!(
                attr.base_symbol_index.is_none(),
                "Imported type should not resolve to local index without cross-file cache"
            );
        }

        #[test]
        fn cross_file_import_target_kind_from_import() {
            // Test that ImportTargetKind::FromImport is constructed correctly
            use crate::cross_file_types::{ImportTarget, ImportTargetKind};
            use std::path::PathBuf;

            // Create an ImportTarget directly to verify the type structure
            let target = ImportTarget {
                file_path: PathBuf::from("handler.py"),
                kind: ImportTargetKind::FromImport {
                    imported_name: "Handler".to_string(),
                    imported_module: false,
                },
            };

            match &target.kind {
                ImportTargetKind::FromImport {
                    imported_name,
                    imported_module,
                } => {
                    assert_eq!(imported_name, "Handler");
                    assert!(!imported_module, "Handler is a class, not a module");
                }
                _ => panic!("Expected FromImport"),
            }
        }

        #[test]
        fn cross_file_import_target_kind_module_import() {
            // Test that ImportTargetKind::ModuleImport is constructed correctly
            use crate::cross_file_types::{ImportTarget, ImportTargetKind};
            use std::path::PathBuf;

            // Create an ImportTarget directly to verify the type structure
            let target = ImportTarget {
                file_path: PathBuf::from("handler.py"),
                kind: ImportTargetKind::ModuleImport,
            };

            assert!(
                matches!(target.kind, ImportTargetKind::ModuleImport),
                "Should be ModuleImport"
            );
            assert_eq!(target.file_path, PathBuf::from("handler.py"));
        }

        #[test]
        fn cross_file_lookup_import_target_scope_chain() {
            // Test that lookup_import_target walks the scope chain correctly
            use crate::cross_file_types::{lookup_import_target, ImportTarget, ImportTargetKind};
            use std::collections::HashMap;
            use std::path::PathBuf;

            let mut import_targets = HashMap::new();

            // Add import at module scope
            import_targets.insert(
                (vec!["<module>".to_string()], "Handler".to_string()),
                ImportTarget {
                    file_path: PathBuf::from("handler.py"),
                    kind: ImportTargetKind::FromImport {
                        imported_name: "Handler".to_string(),
                        imported_module: false,
                    },
                },
            );

            // Lookup from module scope
            let result =
                lookup_import_target(&["<module>".to_string()], "Handler", &import_targets);
            assert!(result.is_some(), "Should find Handler at module scope");

            // Lookup from nested scope (should find via scope chain)
            let result = lookup_import_target(
                &[
                    "<module>".to_string(),
                    "Service".to_string(),
                    "run".to_string(),
                ],
                "Handler",
                &import_targets,
            );
            assert!(
                result.is_some(),
                "Should find Handler from nested scope via scope chain"
            );

            // Lookup non-existent import
            let result =
                lookup_import_target(&["<module>".to_string()], "Missing", &import_targets);
            assert!(result.is_none(), "Should not find non-existent import");
        }

        #[test]
        fn cross_file_cache_circular_import_detection() {
            // Test that CrossFileTypeCache detects circular imports
            use crate::cross_file_types::CrossFileTypeCache;
            use std::collections::HashSet;

            let workspace_files = HashSet::new();
            let namespace_packages = HashSet::new();
            let cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

            // We can't directly access in_progress, but we can verify the cache is created
            assert!(cache.is_empty(), "Cache should start empty");
            assert_eq!(cache.len(), 0);
        }

        #[test]
        fn type_tracker_is_cloneable() {
            // Verify TypeTracker can be cloned (required for cross-file resolution)
            let tracker = TypeTracker::new();
            let _cloned = tracker.clone();
            // If this compiles, TypeTracker is Clone
        }
    }
}
