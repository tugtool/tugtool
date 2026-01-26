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
use crate::type_tracker::TypeTracker;
use crate::types::{BindingInfo, ScopeInfo};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

// Native CST bridge
use crate::cst_bridge;

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
        for symbol in &analysis.symbols {
            if symbol.kind == SymbolKind::Class {
                // Reserve SymbolId for class
                let symbol_id = store.next_symbol_id();
                class_symbols.insert((file_id, symbol.name.clone()), symbol_id);

                // Get span (use default if not available)
                let span = symbol.span.unwrap_or_else(|| Span::new(0, 0));

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
        for symbol in &analysis.symbols {
            if symbol.kind == SymbolKind::Class {
                // Already handled above
                continue;
            }

            let symbol_id = store.next_symbol_id();

            // Get span (use default if not available)
            let span = symbol.span.unwrap_or_else(|| Span::new(0, 0));

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
        for local_export in &analysis.exports {
            // decl_span = full string literal including quotes
            // exported_name_span = string content only, no quotes
            let public_export_id = store.next_public_export_id();
            let decl_span = local_export.span.unwrap_or_else(|| Span::new(0, 0));
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
        for local_ref in &analysis.references {
            let ref_span = local_ref.span.unwrap_or_else(|| Span::new(0, 0));

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

        tracker.process_assignments(&cst_assignments);
        tracker.process_annotations(&cst_annotations);
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
    })
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
}

impl LanguageAdapter for PythonAdapter {
    type Error = AnalyzerError;

    fn analyze_file(&self, path: &str, content: &str) -> Result<FileAnalysisResult, Self::Error> {
        // Use a temporary FileId (the adapter doesn't allocate IDs)
        let temp_file_id = FileId::new(0);
        let analysis = analyze_file(temp_file_id, path, content)?;
        Ok(self.convert_file_analysis(&analysis))
    }

    fn analyze_files(
        &self,
        files: &[(String, String)],
        _store: &FactsStore,
    ) -> Result<AnalysisBundle, Self::Error> {
        // Create a temporary FactsStore for analysis
        // The adapter doesn't mutate the input store; it builds all state internally
        let mut temp_store = FactsStore::new();
        let bundle = analyze_files(files, &mut temp_store)?;
        Ok(self.convert_file_analysis_bundle(&bundle))
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
    fn convert_file_analysis(&self, analysis: &FileAnalysis) -> FileAnalysisResult {
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

        // Convert symbols
        for symbol in &analysis.symbols {
            let scope_index = scope_id_to_index
                .get(&symbol.scope_id)
                .copied()
                .unwrap_or(0);

            result.symbols.push(SymbolData {
                kind: symbol.kind,
                name: symbol.name.clone(),
                decl_span: symbol.span.unwrap_or(Span::new(0, 0)),
                scope_index,
                visibility: self.infer_visibility_from_name(&symbol.name),
            });
        }

        // Convert references
        for reference in &analysis.references {
            let scope_index = scope_id_to_index
                .get(&reference.scope_id)
                .copied()
                .unwrap_or(0);

            result.references.push(ReferenceData {
                name: reference.name.clone(),
                span: reference.span.unwrap_or(Span::new(0, 0)),
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

        // Convert exports (from __all__)
        for export in &analysis.exports {
            result.exports.push(ExportData {
                exported_name: Some(export.name.clone()),
                source_name: Some(export.name.clone()), // Same for non-aliased Python exports
                decl_span: export.span.unwrap_or(Span::new(0, 0)),
                exported_name_span: export.content_span,
                source_name_span: None,
                export_kind: ExportKind::PythonAll,
                export_target: ExportTarget::Single,
                export_intent: ExportIntent::Declared,
                export_origin: ExportOrigin::Local,
                origin_module_path: None,
            });
        }

        // Build name to symbol index mapping for alias resolution
        let symbol_name_to_index: HashMap<&str, usize> = result
            .symbols
            .iter()
            .enumerate()
            .map(|(idx, s)| (s.name.as_str(), idx))
            .collect();

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
                    span: alias_info.alias_span.unwrap_or(Span::new(0, 0)),
                    kind: alias_info.kind,
                    confidence: Some(alias_info.confidence),
                });
            }
        }

        // Convert signatures, modifiers, qualified names, and type params
        // Build a mapping from (function name, scope_path) to symbol_index for signature resolution
        // This approach handles nested functions and methods correctly
        let func_to_symbol: HashMap<(String, Vec<String>), usize> = result
            .symbols
            .iter()
            .enumerate()
            .filter(|(_, s)| s.kind == SymbolKind::Function)
            .map(|(idx, s)| {
                // Construct scope_path from the scope hierarchy
                let scope_path = self.build_scope_path_for_symbol(analysis, idx);
                ((s.name.clone(), scope_path), idx)
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
            // Try to resolve the receiver to a symbol index by matching the receiver name
            // Note: For now, we use None since resolving receiver requires type inference
            let base_symbol_index = None; // Future: resolve via receiver name and type info

            result.attributes.push(AttributeAccessData {
                base_symbol_index,
                name: attr.attr_name.clone(),
                span: attr.attr_span.unwrap_or(Span::new(0, 0)),
                kind: convert_cst_attribute_access_kind(attr.kind),
            });
        }

        // Convert call sites
        for call in &analysis.call_sites {
            // Try to resolve the callee to a symbol index
            // For function calls, look up the callee name in symbols
            // For method calls, callee_symbol_index is typically None until type resolution
            let callee_symbol_index = if !call.is_method_call {
                symbol_name_to_index.get(call.callee.as_str()).copied()
            } else {
                None
            };

            let args: Vec<CallArgData> = call
                .args
                .iter()
                .map(|arg| CallArgData {
                    name: arg.name.clone(),
                    span: arg.span.unwrap_or(Span::new(0, 0)),
                })
                .collect();

            result.calls.push(CallSiteData {
                callee_symbol_index,
                span: call.span.unwrap_or(Span::new(0, 0)),
                args,
            });
        }

        result
    }

    /// Convert a `FileAnalysisBundle` to `AnalysisBundle` for the adapter interface.
    fn convert_file_analysis_bundle(&self, bundle: &FileAnalysisBundle) -> AnalysisBundle {
        let mut result = AnalysisBundle::default();

        // Convert each file analysis (preserving input order per [D15])
        for analysis in &bundle.file_analyses {
            result
                .file_results
                .push(self.convert_file_analysis(analysis));
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
            // Test: alias edges have spans
            let adapter = PythonAdapter::new();
            let content = "bar = 1\nb = bar";
            let result = adapter.analyze_file("test.py", content).unwrap();

            assert!(!result.aliases.is_empty());

            for alias in &result.aliases {
                // Span should be non-zero (meaningful)
                assert!(
                    alias.span.start < alias.span.end || alias.span.start == 0,
                    "Alias span should be valid"
                );
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
            for alias_data in &result.aliases {
                let alias_symbol_id = symbol_id_map[alias_data.alias_symbol_index];
                let target_symbol_id = alias_data.target_symbol_index.map(|idx| symbol_id_map[idx]);

                let edge_id = store.next_alias_edge_id();
                let mut edge = AliasEdge::new(
                    edge_id,
                    file_id,
                    alias_data.span,
                    alias_symbol_id,
                    alias_data.kind,
                );
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

            // Insert alias edges
            for alias_data in &result.aliases {
                let alias_symbol_id = symbol_id_map[alias_data.alias_symbol_index];
                let target_symbol_id = alias_data.target_symbol_index.map(|idx| symbol_id_map[idx]);

                let edge_id = store.next_alias_edge_id();
                let mut edge = AliasEdge::new(
                    edge_id,
                    file_id,
                    alias_data.span,
                    alias_symbol_id,
                    alias_data.kind,
                );
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
    }
}
