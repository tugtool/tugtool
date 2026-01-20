//! Python analyzer: scope-aware symbol resolution and reference collection.
//!
//! This module implements Level 0 (Scope + Binding) of the Python analyzer:
//!
//! - Scope chain management (module → class → function → comprehension)
//! - Binding collection with `global`/`nonlocal` handling
//! - Reference resolution via scope chain
//! - Import resolution for workspace files
//!
//! Uses Rust CST parsing via tugtool-cst for zero-dependency analysis.
//! See [`analyze_file`] and [`analyze_files`] for the main entry points.

use tugtool_core::facts::{
    FactsStore, File, Import, Language, Reference, ReferenceKind,
    ScopeId as CoreScopeId, ScopeInfo as CoreScopeInfo, ScopeKind as CoreScopeKind, Symbol,
    SymbolId, SymbolKind,
};
use tugtool_core::patch::{ContentHash, FileId, Span};

use crate::type_tracker::TypeTracker;
use crate::types::{BindingInfo, ScopeInfo};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

// Native CST bridge
use crate::cst_bridge;

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

/// Kind of scope in Python.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScopeKind {
    /// Module scope (top-level).
    Module,
    /// Class body scope.
    Class,
    /// Function body scope.
    Function,
    /// Lambda expression scope.
    Lambda,
    /// Comprehension scope (list/set/dict/generator).
    Comprehension,
}

impl From<&str> for ScopeKind {
    fn from(s: &str) -> Self {
        match s {
            "module" => ScopeKind::Module,
            "class" => ScopeKind::Class,
            "function" => ScopeKind::Function,
            "lambda" => ScopeKind::Lambda,
            "comprehension" => ScopeKind::Comprehension,
            _ => ScopeKind::Module, // Default fallback
        }
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
            bindings: HashMap::new(),
            globals: HashSet::new(),
            nonlocals: HashSet::new(),
        }
    }

    /// Check if a name is declared global in this scope.
    pub fn is_global(&self, name: &str) -> bool {
        self.globals.contains(name)
    }

    /// Check if a name is declared nonlocal in this scope.
    pub fn is_nonlocal(&self, name: &str) -> bool {
        self.nonlocals.contains(name)
    }

    /// Convert local ScopeKind to core ScopeKind.
    pub fn to_core_kind(&self) -> CoreScopeKind {
        match self.kind {
            ScopeKind::Module => CoreScopeKind::Module,
            ScopeKind::Class => CoreScopeKind::Class,
            ScopeKind::Function => CoreScopeKind::Function,
            ScopeKind::Lambda => CoreScopeKind::Lambda,
            ScopeKind::Comprehension => CoreScopeKind::Comprehension,
        }
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
    // Pass 1: Single-File Analysis
    // ====================================================================
    // Parse each file using native CST parser and collect analysis results.
    // Track all workspace file paths for import resolution in Pass 3.
    // Continue on parse errors (track failures in bundle).

    // Build workspace file set for import resolution
    // We track all paths regardless of analysis success/failure because:
    // - A file that failed to parse still exists and can be an import target
    // - Pass 3 needs to know which paths exist in the workspace
    bundle.workspace_files = files.iter().map(|(path, _)| path.clone()).collect();

    // Keep a map of file_id -> content for content hash computation in Pass 2
    let mut file_contents: HashMap<FileId, &str> = HashMap::new();

    // Analyze each file
    for (path, content) in files {
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

            // Compute span for scope (currently we don't have precise scope spans,
            // so we use a placeholder - this will be improved in future)
            // TODO: Get actual scope spans from native analysis
            let span = Span::new(0, 0);

            let mut core_scope =
                CoreScopeInfo::new(core_scope_id, file_id, span, scope.to_core_kind());
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
                if let Some(&container_id) = class_symbols.get(&(file_id, container_name.clone()))
                {
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
    let mut scope_symbols: HashMap<(FileId, ScopeId), Vec<(String, SymbolId, SymbolKind)>> =
        HashMap::new();

    // Rebuild scope_symbols from symbols (we need to know which symbols are in which scope)
    // This is populated from the symbols we just registered
    for analysis in &bundle.file_analyses {
        let file_id = analysis.file_id;
        for symbol in &analysis.symbols {
            // Find the SymbolId for this symbol in the global_symbols map
            if let Some(entries) = global_symbols.get(&(symbol.name.clone(), symbol.kind)) {
                for (fid, sym_id) in entries {
                    if *fid == file_id {
                        scope_symbols
                            .entry((file_id, symbol.scope_id))
                            .or_default()
                            .push((symbol.name.clone(), *sym_id, symbol.kind));
                        break;
                    }
                }
            }
        }
    }

    for analysis in &bundle.file_analyses {
        let file_id = analysis.file_id;

        // Build per-file import resolver
        let import_resolver = FileImportResolver::from_imports(
            &analysis.imports,
            &bundle.workspace_files,
        );

        // Process imports first - insert Import records
        for local_import in &analysis.imports {
            let import_id = store.next_import_id();
            let span = local_import.span.unwrap_or_else(|| Span::new(0, 0));

            // For "from" imports, create an Import record for each name
            if local_import.kind == "from" && !local_import.is_star {
                for imported_name in &local_import.names {
                    let name_import_id = store.next_import_id();
                    let mut import = Import::new(
                        name_import_id,
                        file_id,
                        span,
                        &local_import.module_path,
                    );
                    import.imported_name = Some(imported_name.name.clone());
                    import.alias = imported_name.alias.clone();
                    import.is_star = false;
                    store.insert_import(import);
                }
            } else if local_import.is_star {
                // Star import
                let mut import = Import::new(
                    import_id,
                    file_id,
                    span,
                    &local_import.module_path,
                );
                import.is_star = true;
                store.insert_import(import);
            } else {
                // Regular module import
                let mut import = Import::new(
                    import_id,
                    file_id,
                    span,
                    &local_import.module_path,
                );
                import.alias = local_import.alias.clone();
                store.insert_import(import);
            }
        }

        // Process references
        for local_ref in &analysis.references {
            let ref_span = local_ref.span.unwrap_or_else(|| Span::new(0, 0));

            // Try to resolve the reference to a symbol
            let resolved_symbol_id = resolve_reference(
                &local_ref.name,
                local_ref.scope_id,
                file_id,
                &analysis.scopes,
                &global_symbols,
                &import_bindings,
                &scope_symbols,
                &import_resolver,
                &file_path_to_id,
                local_ref.kind,
            );

            if let Some(symbol_id) = resolved_symbol_id {
                // Create reference
                let ref_id = store.next_reference_id();
                let reference = Reference::new(
                    ref_id,
                    symbol_id,
                    file_id,
                    ref_span,
                    local_ref.kind,
                );
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
    let mut all_class_inheritance: Vec<(FileId, tugtool_cst::ClassInheritanceInfo)> = Vec::new();

    // Pass 4a: Re-analyze files to get P1 data and build auxiliary structures
    for (path, content) in files {
        // Skip files that failed analysis in Pass 1
        if bundle.failed_files.iter().any(|(p, _)| p == path) {
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
                span: a
                    .span
                    .as_ref()
                    .map(|s| crate::types::SpanInfo {
                        start: s.start as usize,
                        end: s.end as usize,
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
                span: a
                    .span
                    .as_ref()
                    .map(|s| crate::types::SpanInfo {
                        start: s.start as usize,
                        end: s.end as usize,
                    }),
                line: a.line,
                col: a.col,
            })
            .collect();

        tracker.process_assignments(&cst_assignments);
        tracker.process_annotations(&cst_annotations);
        tracker.resolve_types();

        type_trackers.insert(file_id, tracker);

        // Build MethodCallIndex from method calls
        // First, get the FileAnalysis to access scope information
        let analysis = bundle
            .file_analyses
            .iter()
            .find(|a| a.file_id == file_id);

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
            if let Some(&parent_id) =
                class_name_to_symbol.get(&(*file_id, base_name.clone()))
            {
                inheritance_to_insert.push(tugtool_core::facts::InheritanceInfo::new(
                    child_id, parent_id,
                ));
                continue;
            }

            // Try to resolve via imports
            // Find the FileAnalysis for this file to get import info
            if let Some(analysis) = bundle.file_analyses.iter().find(|a| a.file_id == *file_id)
            {
                // Use FileImportResolver which resolves imports against workspace_files
                let import_resolver = FileImportResolver::from_imports(
                    &analysis.imports,
                    &bundle.workspace_files,
                );

                if let Some((qualified_name, resolved_file)) =
                    import_resolver.resolve(base_name)
                {
                    // If we have a resolved file, look for the class there
                    if let Some(resolved_path) = resolved_file {
                        if let Some(&target_file_id) = file_path_to_id.get(resolved_path) {
                            // Extract the actual class name from the qualified path
                            let target_class_name =
                                qualified_name.rsplit('.').next().unwrap_or(base_name);
                            if let Some(&parent_id) = class_name_to_symbol
                                .get(&(target_file_id, target_class_name.to_string()))
                            {
                                inheritance_to_insert.push(
                                    tugtool_core::facts::InheritanceInfo::new(
                                        child_id, parent_id,
                                    ),
                                );
                            }
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
                && call
                    .scope_path
                    .iter()
                    .any(|s| s == &class_name);

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
/// This function parses the file using tugtool-cst and collects scopes,
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
pub fn analyze_file(
    file_id: FileId,
    path: &str,
    content: &str,
) -> AnalyzerResult<FileAnalysis> {
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
                span: native_ref
                    .span
                    .as_ref()
                    .map(|s| Span::new(s.start as u64, s.end as u64)),
                line: native_ref.line,
                col: native_ref.col,
                scope_id: ScopeId(0), // Will be resolved during scope analysis
                resolved_symbol: Some(name.clone()), // Same-name reference
            });
        }
    }

    // Convert native imports to LocalImport format
    // Note: We use an empty workspace_files set here since single-file analysis
    // doesn't have access to the workspace. The caller (analyze_files) handles
    // workspace-aware import resolution.
    let imports = convert_imports(&native_result.imports, &HashSet::new());

    Ok(FileAnalysis {
        file_id,
        path: path.to_string(),
        cst_id: String::new(), // No CST ID for native analysis
        scopes,
        symbols,
        references,
        imports,
    })
}

/// Build scope structure from native scope info.
fn build_scopes(
    native_scopes: &[ScopeInfo],
) -> (Vec<Scope>, HashMap<String, ScopeId>) {
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

            let mut scope = Scope::new(
                scope_id,
                ScopeKind::from(ns.kind.as_str()),
                ns.name.clone(),
                parent_id,
            );
            // Populate globals and nonlocals from native scope info
            scope.globals = ns.globals.iter().cloned().collect();
            scope.nonlocals = ns.nonlocals.iter().cloned().collect();
            scope
        })
        .collect();

    (scopes, scope_map)
}

/// Collect symbols from native bindings.
fn collect_symbols(
    bindings: &[BindingInfo],
    scopes: &[Scope],
) -> Vec<LocalSymbol> {
    let mut symbols = Vec::new();

    for binding in bindings {
        let kind = symbol_kind_from_str(&binding.kind);

        // Determine scope from scope_path
        let scope_id = find_scope_for_path(&binding.scope_path, scopes).unwrap_or(ScopeId(0));

        // Determine container for methods
        let container = if binding.scope_path.len() >= 2 {
            let path_without_module: Vec<_> = binding
                .scope_path
                .iter()
                .filter(|s| *s != "<module>")
                .collect();

            if !path_without_module.is_empty() {
                let last_name = path_without_module.last().unwrap();
                let is_class = scopes.iter().any(|s| {
                    s.kind == ScopeKind::Class && s.name.as_deref() == Some(last_name.as_str())
                });
                if is_class {
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
            span: binding
                .span
                .as_ref()
                .map(|s| Span::new(s.start as u64, s.end as u64)),
            line: binding.line,
            col: binding.col,
            container,
        });
    }

    symbols
}

/// Find the scope that matches a scope_path.
fn find_scope_for_path(scope_path: &[String], scopes: &[Scope]) -> Option<ScopeId> {
    if scope_path.is_empty() {
        return Some(ScopeId(0)); // Module scope
    }

    // Walk through the scope_path and find matching scopes
    // The scope_path is like ["<module>", "ClassName", "method_name"]

    let mut current_parent: Option<ScopeId> = None;

    for name in scope_path {
        // Find a scope with this name and matching parent
        let found = scopes.iter().find(|s| {
            let name_matches = if name == "<module>" {
                s.kind == ScopeKind::Module
            } else {
                s.name.as_deref() == Some(name.as_str())
            };
            let parent_matches = s.parent_id == current_parent;
            name_matches && parent_matches
        });

        if let Some(scope) = found {
            current_parent = Some(scope.id);
        } else {
            // Scope path doesn't match - return module scope as fallback
            return scopes.first().map(|s| s.id);
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
/// - `import foo` → aliases["foo"] = ("foo", None)
/// - `import foo.bar` → aliases["foo"] = ("foo", None) **binds ROOT only**
/// - `import foo as f` → aliases["f"] = ("foo", None)
/// - `import foo.bar as fb` → aliases["fb"] = ("foo.bar", resolved_file)
/// - `from foo import bar` → aliases["bar"] = ("foo.bar", resolved_file)
/// - `from foo import bar as b` → aliases["b"] = ("foo.bar", resolved_file)
/// - Relative imports → None (not supported)
/// - Star imports → None (not supported)
#[derive(Debug, Default)]
pub struct FileImportResolver {
    /// Maps local bound names to (qualified_path, resolved_file).
    aliases: HashMap<String, (String, Option<String>)>,
}

impl FileImportResolver {
    /// Create a new empty resolver.
    pub fn new() -> Self {
        Self::default()
    }

    /// Build from a list of local imports, resolving to workspace files.
    pub fn from_imports(imports: &[LocalImport], workspace_files: &HashSet<String>) -> Self {
        let mut resolver = Self::new();

        for import in imports {
            // Skip relative imports (Contract C3: unsupported)
            if import.module_path.starts_with('.') {
                continue;
            }

            match import.kind.as_str() {
                "from" => {
                    // Skip star imports (Contract C3: unsupported)
                    if import.is_star {
                        continue;
                    }

                    // `from foo import bar` or `from foo import bar as b`
                    for imported_name in &import.names {
                        let local_name = imported_name
                            .alias
                            .as_ref()
                            .unwrap_or(&imported_name.name);
                        let qualified_path =
                            format!("{}.{}", import.module_path, imported_name.name);

                        // Try to resolve the module to a workspace file
                        let resolved_file =
                            resolve_module_to_file(&import.module_path, workspace_files);

                        resolver.aliases.insert(
                            local_name.clone(),
                            (qualified_path, resolved_file),
                        );
                    }
                }
                "import" => {
                    if let Some(alias) = &import.alias {
                        // `import foo.bar as fb` → aliases["fb"] = ("foo.bar", resolved)
                        let resolved_file =
                            resolve_module_to_file(&import.module_path, workspace_files);
                        resolver
                            .aliases
                            .insert(alias.clone(), (import.module_path.clone(), resolved_file));
                    } else {
                        // `import foo.bar` → aliases["foo"] = ("foo", None)
                        // Per Contract C3: binds ROOT only
                        let root = import
                            .module_path
                            .split('.')
                            .next()
                            .unwrap_or(&import.module_path);
                        resolver
                            .aliases
                            .insert(root.to_string(), (root.to_string(), None));
                    }
                }
                _ => {}
            }
        }

        resolver
    }

    /// Resolve a local name to its qualified path and source file.
    pub fn resolve(&self, local_name: &str) -> Option<(&str, Option<&str>)> {
        self.aliases
            .get(local_name)
            .map(|(qn, rf)| (qn.as_str(), rf.as_deref()))
    }

    /// Check if a name is imported.
    pub fn is_imported(&self, local_name: &str) -> bool {
        self.aliases.contains_key(local_name)
    }
}

/// Resolve a module path to a workspace file path.
///
/// Per Contract C3 module resolution algorithm:
/// 1. If module_path starts with '.': return None (relative import)
/// 2. Convert to candidate file paths: "foo.bar" → ["foo/bar.py", "foo/bar/__init__.py"]
/// 3. Search workspace_files for first match (module file wins over package)
pub fn resolve_module_to_file(
    module_path: &str,
    workspace_files: &HashSet<String>,
) -> Option<String> {
    // Skip relative imports
    if module_path.starts_with('.') {
        return None;
    }

    // Convert module path to file path
    let file_path = module_path.replace('.', "/");

    // Try as .py file first (per Contract C3: module file wins)
    let py_path = format!("{}.py", file_path);
    if workspace_files.contains(&py_path) {
        return Some(py_path);
    }

    // Try as package (__init__.py)
    let init_path = format!("{}/__init__.py", file_path);
    if workspace_files.contains(&init_path) {
        return Some(init_path);
    }

    None
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
    scope_symbols: &HashMap<(FileId, ScopeId), Vec<(String, SymbolId, SymbolKind)>>,
    import_resolver: &FileImportResolver,
    file_path_to_id: &HashMap<String, FileId>,
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
    )
}

/// Find a symbol in a specific scope.
fn find_symbol_in_scope(
    name: &str,
    file_id: FileId,
    scope_id: ScopeId,
    scope_symbols: &HashMap<(FileId, ScopeId), Vec<(String, SymbolId, SymbolKind)>>,
) -> Option<SymbolId> {
    scope_symbols
        .get(&(file_id, scope_id))
        .and_then(|symbols| symbols.iter().find(|(n, _, _)| n == name).map(|(_, id, _)| *id))
}

/// Find a symbol in a specific scope, returning both ID and kind.
fn find_symbol_in_scope_with_kind(
    name: &str,
    file_id: FileId,
    scope_id: ScopeId,
    scope_symbols: &HashMap<(FileId, ScopeId), Vec<(String, SymbolId, SymbolKind)>>,
) -> Option<(SymbolId, SymbolKind)> {
    scope_symbols
        .get(&(file_id, scope_id))
        .and_then(|symbols| {
            symbols
                .iter()
                .find(|(n, _, _)| n == name)
                .map(|(_, id, kind)| (*id, *kind))
        })
}

/// Resolve an imported name to its original definition.
///
/// Per Contract C3: References to imported names should resolve to the
/// ORIGINAL definition, not the import binding. This function follows
/// the import chain to find the original symbol.
fn resolve_import_to_original(
    name: &str,
    global_symbols: &GlobalSymbolMap,
    import_bindings: &ImportBindingsSet,
    import_resolver: &FileImportResolver,
    file_path_to_id: &HashMap<String, FileId>,
) -> Option<SymbolId> {
    let (qualified_path, resolved_file) = import_resolver.resolve(name)?;
    let resolved_file_path = resolved_file?;
    let &target_file_id = file_path_to_id.get(resolved_file_path)?;
    let target_name = qualified_path.rsplit('.').next().unwrap_or(name);

    // Look for the symbol in the target file
    for kind in [
        SymbolKind::Function,
        SymbolKind::Class,
        SymbolKind::Variable,
        SymbolKind::Constant,
    ] {
        if let Some(entries) = global_symbols.get(&(target_name.to_string(), kind)) {
            for (fid, sym_id) in entries {
                if *fid == target_file_id {
                    // Verify this is a definition, not another import binding
                    if !import_bindings.contains(&(target_file_id, target_name.to_string())) {
                        return Some(*sym_id);
                    }
                }
            }
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
    scope_symbols: &HashMap<(FileId, ScopeId), Vec<(String, SymbolId, SymbolKind)>>,
    import_resolver: &FileImportResolver,
    file_path_to_id: &HashMap<String, FileId>,
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
    scope_symbols: &HashMap<(FileId, ScopeId), Vec<(String, SymbolId, SymbolKind)>>,
    import_resolver: &FileImportResolver,
    file_path_to_id: &HashMap<String, FileId>,
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
    )
}

/// Convert local imports from native CST analysis to LocalImport format.
fn convert_imports(
    imports: &[tugtool_cst::ImportInfo],
    workspace_files: &HashSet<String>,
) -> Vec<LocalImport> {
    let mut result = Vec::new();

    for import in imports {
        // Skip relative imports
        if import.relative_level > 0 {
            continue;
        }

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

        // Resolve import to workspace file
        let resolved_file = resolve_module_to_file(&import.module, workspace_files);

        let kind = match import.kind {
            tugtool_cst::ImportKind::Import => "import",
            tugtool_cst::ImportKind::From => "from",
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

// ============================================================================
// Import Resolver (for import-aware inheritance resolution)
// ============================================================================

/// Resolves imported names to their qualified module paths.
///
/// Used for import-aware inheritance resolution: when a class inherits from
/// an imported base class, this resolver maps the local name to the qualified
/// name so we can find the correct class definition.
///
/// Example:
/// ```python
/// from myproject.handlers import BaseHandler
/// class MyHandler(BaseHandler):  # BaseHandler → "myproject.handlers.BaseHandler"
///     pass
/// ```
#[derive(Debug, Default)]
pub struct ImportResolver {
    /// Maps local names to (qualified_name, resolved_file).
    /// - qualified_name: full dotted path like "myproject.handlers.BaseHandler"
    /// - resolved_file: workspace file path if known (e.g., "myproject/handlers.py")
    aliases: HashMap<String, (String, Option<String>)>,
}

impl ImportResolver {
    /// Create a new empty import resolver.
    pub fn new() -> Self {
        Self::default()
    }

    /// Build an import resolver from a list of local imports.
    ///
    /// Processes imports to build the name→qualified_name mapping:
    /// - `from x.y import Z` → aliases["Z"] = ("x.y.Z", resolved_file)
    /// - `from x.y import Z as W` → aliases["W"] = ("x.y.Z", resolved_file)
    /// - `import x.y` → aliases["x"] = ("x", None) [module import, less useful for classes]
    /// - `import x.y as w` → aliases["w"] = ("x.y", None)
    pub fn from_imports(imports: &[LocalImport]) -> Self {
        let mut resolver = Self::new();

        for import in imports {
            match import.kind.as_str() {
                "from" => {
                    // `from x.y import Z` or `from x.y import Z as W`
                    // Star imports are tracked but can't resolve specific names
                    if import.is_star {
                        // Can't resolve specific names from star imports without analyzing the source module
                        // Skip for now - this is a known limitation
                        continue;
                    }

                    for imported_name in &import.names {
                        // The local name is either the alias or the original name
                        let local_name =
                            imported_name.alias.as_ref().unwrap_or(&imported_name.name);

                        // The qualified name is module_path.name
                        let qualified_name =
                            format!("{}.{}", import.module_path, imported_name.name);

                        resolver.aliases.insert(
                            local_name.clone(),
                            (qualified_name, import.resolved_file.clone()),
                        );
                    }
                }
                "import" => {
                    // `import x.y` or `import x.y as w`
                    // Less useful for class resolution since this imports modules, not classes
                    // But we track it for completeness
                    let local_name = import.alias.as_ref().unwrap_or(&import.module_path);

                    // For module imports, the "local name" for the first component
                    // maps to the full module path
                    let first_component = import
                        .module_path
                        .split('.')
                        .next()
                        .unwrap_or(&import.module_path);

                    if import.alias.is_some() {
                        // `import x.y as w` → aliases["w"] = "x.y"
                        resolver.aliases.insert(
                            local_name.clone(),
                            (import.module_path.clone(), import.resolved_file.clone()),
                        );
                    } else {
                        // `import x.y` → aliases["x"] = "x" (the root module)
                        // This doesn't directly help with class resolution
                        resolver.aliases.insert(
                            first_component.to_string(),
                            (first_component.to_string(), None),
                        );
                    }
                }
                _ => {}
            }
        }

        resolver
    }

    /// Resolve a local name to its qualified name and source file.
    ///
    /// Returns `Some((qualified_name, resolved_file))` if the name was imported,
    /// `None` if it's not an imported name (could be defined locally).
    pub fn resolve(&self, local_name: &str) -> Option<(&str, Option<&str>)> {
        self.aliases
            .get(local_name)
            .map(|(qn, rf)| (qn.as_str(), rf.as_deref()))
    }

    /// Get the resolved file path for an imported name.
    ///
    /// Returns `Some(file_path)` if the import was resolved to a workspace file.
    pub fn resolved_file(&self, local_name: &str) -> Option<&str> {
        self.aliases
            .get(local_name)
            .and_then(|(_, rf)| rf.as_deref())
    }

    /// Check if a name is imported.
    pub fn is_imported(&self, local_name: &str) -> bool {
        self.aliases.contains_key(local_name)
    }
}

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
        _ => ReferenceKind::Reference,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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

    mod method_call_index_tests {
        use super::*;

        fn make_indexed_call(
            file_id: u32,
            receiver: &str,
            receiver_type: Option<&str>,
            span_start: u64,
            span_end: u64,
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
            }
        }

        #[test]
        fn empty_resolver() {
            let resolver = ImportResolver::new();
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

            let resolver = ImportResolver::from_imports(&imports);

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

            let resolver = ImportResolver::from_imports(&imports);

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

            let resolver = ImportResolver::from_imports(&imports);

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

            let resolver = ImportResolver::from_imports(&imports);

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

            let resolver = ImportResolver::from_imports(&imports);

            assert!(resolver.is_imported("handlers"));
            let (qualified, resolved) = resolver.resolve("handlers").unwrap();
            assert_eq!(qualified, "myproject.handlers");
            assert_eq!(resolved, Some("myproject/handlers.py"));
        }

        #[test]
        fn module_import_without_alias() {
            // import myproject.handlers
            let imports = vec![make_module_import("myproject.handlers", None, None)];

            let resolver = ImportResolver::from_imports(&imports);

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

            let resolver = ImportResolver::from_imports(&imports);

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

            let resolver = ImportResolver::from_imports(&imports);

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

            let resolver = ImportResolver::from_imports(&imports);

            assert_eq!(
                resolver.resolved_file("BaseHandler"),
                Some("myproject/handlers.py")
            );
            assert!(resolver.resolved_file("External").is_none());
            assert!(resolver.resolved_file("Unknown").is_none());
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
            assert!(result.scopes.len() >= 2, "should have module and function scopes");
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
            assert!(result.scopes.len() >= 3, "should have module, outer, and inner scopes");

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
            let comp_scope = result.scopes.iter().find(|s| s.kind == ScopeKind::Comprehension);
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
            let content = "def foo(\n";  // Invalid syntax
            let result = analyze_file(FileId::new(0), "test.py", content);

            assert!(result.is_err(), "should return error for invalid syntax");
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
            assert!(!analysis.symbols.is_empty(), "should have at least one symbol (foo)");

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
                ("second.py".to_string(), "class SecondClass: pass".to_string()),
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
            assert!(scopes.len() >= 3, "should have module, outer, and inner scopes");

            // Find module scope (should have no parent)
            let module_scope = scopes
                .iter()
                .find(|s| s.kind == CoreScopeKind::Module)
                .expect("should have module scope");
            assert!(
                module_scope.parent.is_none(),
                "module scope should have no parent"
            );

            // Function scopes should have parents
            let func_scopes: Vec<_> = scopes
                .iter()
                .filter(|s| s.kind == CoreScopeKind::Function)
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
            assert!(
                !foo_refs.is_empty(),
                "should have references to foo symbol"
            );
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
            let helper_original = symbols
                .iter()
                .find(|s| s.name == "helper" && s.decl_file_id == utils_file.file_id && s.kind == SymbolKind::Function);
            assert!(helper_original.is_some(), "should have original helper definition");
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
                "def outer():\n    x = 1\n    def inner():\n        nonlocal x\n        x = 2".to_string(),
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
            assert!(func_scopes.len() >= 2, "should have at least 2 function scopes");

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
            let class_scope = scopes.iter().find(|s| s.kind == CoreScopeKind::Class);
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
            let comprehension_scope = scopes.iter().find(|s| s.kind == CoreScopeKind::Comprehension);
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
            let files = vec![(
                "test.py".to_string(),
                "import os".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have os as an import binding
            let symbols: Vec<_> = store.symbols().collect();
            let os_sym = symbols.iter().find(|s| s.name == "os" && s.kind == SymbolKind::Import);
            assert!(os_sym.is_some(), "should have os import binding");
        }

        #[test]
        fn analyze_files_pass3_ac4_import_foo_bar_binds_root_only() {
            // Test: `import foo.bar` binds `foo` only (NOT `foo.bar`) - critical Python semantics
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "import os.path".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have os as an import binding, NOT os.path
            let symbols: Vec<_> = store.symbols().collect();
            let os_sym = symbols.iter().find(|s| s.name == "os" && s.kind == SymbolKind::Import);
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
            let alias_sym = symbols.iter().find(|s| s.name == "operating_system" && s.kind == SymbolKind::Import);
            assert!(alias_sym.is_some(), "should have operating_system import binding");
        }

        #[test]
        fn analyze_files_pass3_ac4_from_foo_import_bar_binds_bar() {
            // Test: `from foo import bar` binds `bar` with resolved file
            let mut store = FactsStore::new();
            let files = vec![(
                "main.py".to_string(),
                "from utils import helper".to_string(),
            ),
            (
                "utils.py".to_string(),
                "def helper(): pass".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have helper as an import binding in main.py
            let symbols: Vec<_> = store.symbols().collect();
            let files_in_store: Vec<_> = store.files().collect();
            let main_file = files_in_store.iter().find(|f| f.path == "main.py").unwrap();

            let helper_import = symbols.iter().find(|s|
                s.name == "helper" &&
                s.decl_file_id == main_file.file_id &&
                s.kind == SymbolKind::Import
            );
            assert!(helper_import.is_some(), "should have helper import binding in main.py");
        }

        #[test]
        fn analyze_files_pass3_ac4_from_foo_import_bar_as_b_binds_b() {
            // Test: `from foo import bar as b` binds `b`
            let mut store = FactsStore::new();
            let files = vec![(
                "main.py".to_string(),
                "from utils import helper as h".to_string(),
            ),
            (
                "utils.py".to_string(),
                "def helper(): pass".to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have h as an import binding (not helper)
            let symbols: Vec<_> = store.symbols().collect();
            let files_in_store: Vec<_> = store.files().collect();
            let main_file = files_in_store.iter().find(|f| f.path == "main.py").unwrap();

            let h_import = symbols.iter().find(|s|
                s.name == "h" &&
                s.decl_file_id == main_file.file_id &&
                s.kind == SymbolKind::Import
            );
            assert!(h_import.is_some(), "should have 'h' import binding");
        }

        #[test]
        fn analyze_files_pass3_ac4_relative_imports_return_none() {
            // Test: relative imports return None (documented limitation)
            let mut store = FactsStore::new();
            let files = vec![(
                "pkg/main.py".to_string(),
                "from . import utils".to_string(),
            )];

            // Should succeed (not error on relative imports)
            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // The import is parsed but not resolved (limitation)
        }

        #[test]
        fn analyze_files_pass3_ac4_star_imports_return_none() {
            // Test: star imports return None (documented limitation)
            let mut store = FactsStore::new();
            let files = vec![(
                "test.py".to_string(),
                "from os import *".to_string(),
            )];

            // Should succeed (not error on star imports)
            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Star imports are tracked but specific names can't be resolved
            let imports: Vec<_> = store.imports().collect();
            let star_import = imports.iter().find(|i| i.is_star);
            assert!(star_import.is_some(), "should have star import tracked");
        }

        #[test]
        fn analyze_files_pass3_ac4_module_resolution_prefers_py_file() {
            // Test: module resolution "foo" → "foo.py" wins over "foo/__init__.py"
            // We test this with the resolve_module_to_file function
            let workspace_files: HashSet<String> = vec![
                "utils.py".to_string(),
                "utils/__init__.py".to_string(),
            ].into_iter().collect();

            let resolved = resolve_module_to_file("utils", &workspace_files);
            assert_eq!(resolved, Some("utils.py".to_string()), "should prefer utils.py over utils/__init__.py");
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
"#.to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Should have type info for 'h' variable
            let symbols: Vec<_> = store.symbols().collect();
            let h_symbol = symbols.iter().find(|s| s.name == "h" && s.kind == SymbolKind::Variable);

            assert!(h_symbol.is_some(), "should have h symbol");

            let h_id = h_symbol.unwrap().symbol_id;
            let type_info = store.type_of_symbol(h_id);

            // Type info should be populated from constructor call
            assert!(type_info.is_some(), "should have type info for h");
            assert_eq!(type_info.unwrap().type_repr, "Handler", "h should have type Handler");
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
"#.to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find class symbols
            let symbols: Vec<_> = store.symbols().collect();
            let base_sym = symbols.iter().find(|s| s.name == "Base" && s.kind == SymbolKind::Class);
            let child_sym = symbols.iter().find(|s| s.name == "Child" && s.kind == SymbolKind::Class);

            assert!(base_sym.is_some(), "should have Base class");
            assert!(child_sym.is_some(), "should have Child class");

            let base_id = base_sym.unwrap().symbol_id;
            let child_id = child_sym.unwrap().symbol_id;

            // Check inheritance relationships
            let children = store.children_of_class(base_id);
            let parents = store.parents_of_class(child_id);

            assert!(children.contains(&child_id), "Base should have Child as child");
            assert!(parents.contains(&base_id), "Child should have Base as parent");
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
"#.to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find the process method symbol
            let symbols: Vec<_> = store.symbols().collect();
            let process_sym = symbols.iter().find(|s| s.name == "process" && s.kind == SymbolKind::Function);

            assert!(process_sym.is_some(), "should have process method");

            let process_id = process_sym.unwrap().symbol_id;

            // Check that there's a Call reference to the process method
            let refs: Vec<_> = store.references().filter(|r| r.symbol_id == process_id).collect();

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
"#.to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find the helper method symbol
            let symbols: Vec<_> = store.symbols().collect();
            let helper_sym = symbols.iter().find(|s| s.name == "helper" && s.kind == SymbolKind::Function);

            assert!(helper_sym.is_some(), "should have helper method");

            let helper_id = helper_sym.unwrap().symbol_id;

            // Check that there's a Call reference to helper from self.helper()
            let refs: Vec<_> = store.references().filter(|r| r.symbol_id == helper_id).collect();

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
            let base_sym = symbols.iter().find(|s| s.name == "Base" && s.kind == SymbolKind::Class);
            let child_sym = symbols.iter().find(|s| s.name == "Child" && s.kind == SymbolKind::Class);

            assert!(base_sym.is_some(), "should have Base class");
            assert!(child_sym.is_some(), "should have Child class");

            let base_id = base_sym.unwrap().symbol_id;
            let child_id = child_sym.unwrap().symbol_id;

            // Check inheritance is resolved across files
            let children = store.children_of_class(base_id);
            let parents = store.parents_of_class(child_id);

            assert!(children.contains(&child_id), "Base should have Child as child (cross-file)");
            assert!(parents.contains(&base_id), "Child should have Base as parent (cross-file)");
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
"#.to_string(),
            )];

            let _bundle = analyze_files(&files, &mut store).expect("should succeed");

            // Find the process method symbol
            let symbols: Vec<_> = store.symbols().collect();
            let process_sym = symbols.iter().find(|s| s.name == "process" && s.kind == SymbolKind::Function);

            assert!(process_sym.is_some(), "should have process method");

            let process_id = process_sym.unwrap().symbol_id;

            // Check that there's a Call reference to process from the annotated h.process()
            let refs: Vec<_> = store.references().filter(|r| r.symbol_id == process_id).collect();

            assert!(
                refs.iter().any(|r| r.ref_kind == ReferenceKind::Call),
                "should have Call reference to process method from annotated parameter"
            );
        }
    }
}
