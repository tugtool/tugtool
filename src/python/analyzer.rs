//! Python analyzer: scope-aware symbol resolution and reference collection.
//!
//! This module implements Level 0 (Scope + Binding) of the Python analyzer:
//!
//! - Scope chain management (module → class → function → comprehension)
//! - Binding collection with `global`/`nonlocal` handling
//! - Reference resolution via scope chain
//! - Import resolution for workspace files
//!
//! The analyzer uses the LibCST worker for parsing and CST operations.

use crate::facts::{
    FactsStore, File, Import, InheritanceInfo, Language, Reference, ReferenceKind, Symbol,
    SymbolId, SymbolKind,
};
use crate::patch::{ContentHash, FileId, Span};
use crate::python::type_tracker::{analyze_types_from_analysis, populate_type_info};
use crate::python::worker::{BindingInfo, ImportInfo, ScopeInfo, WorkerHandle};
use crate::text::position_to_byte_offset_str;
use std::collections::{HashMap, HashSet};
use thiserror::Error;

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during Python analysis.
#[derive(Debug, Error)]
pub enum AnalyzerError {
    /// Worker communication error.
    #[error("worker error: {0}")]
    Worker(#[from] crate::python::worker::WorkerError),

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
    /// CST ID from worker (for rewriting).
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
// Python Analyzer
// ============================================================================

/// Python analyzer that uses LibCST worker for parsing.
pub struct PythonAnalyzer<'a> {
    /// Worker handle for CST operations.
    worker: &'a mut WorkerHandle,
    /// Known Python files in workspace (path → exists).
    workspace_files: HashMap<String, bool>,
}

impl<'a> PythonAnalyzer<'a> {
    /// Create a new Python analyzer.
    ///
    /// The `workspace_root` parameter is currently unused but kept for API compatibility
    /// and potential future use in relative import resolution.
    pub fn new(worker: &'a mut WorkerHandle, _workspace_root: impl Into<String>) -> Self {
        PythonAnalyzer {
            worker,
            workspace_files: HashMap::new(),
        }
    }

    /// Register workspace files for import resolution.
    pub fn register_workspace_files(&mut self, files: impl IntoIterator<Item = impl Into<String>>) {
        for file in files {
            let path = file.into();
            self.workspace_files.insert(path, true);
        }
    }

    /// Analyze a single Python file.
    pub fn analyze_file(
        &mut self,
        file_id: FileId,
        path: &str,
        content: &str,
    ) -> AnalyzerResult<FileAnalysis> {
        // Parse the file
        let parse_response = self.worker.parse(path, content)?;
        let cst_id = parse_response.cst_id;

        // Get scopes from worker
        let worker_scopes = self.worker.get_scopes(&cst_id)?;

        // Build scope structure (scope_map not currently used after build)
        let (scopes, _scope_map) = self.build_scopes(&worker_scopes);

        // Get bindings from worker
        let worker_bindings = self.worker.get_bindings(&cst_id)?;

        // Convert bindings to local symbols
        let symbols = self.collect_symbols(&worker_bindings, &scopes);

        // Get imports from worker
        let worker_imports = self.worker.get_imports(&cst_id)?;

        // Convert imports to local imports and resolve
        let imports = self.collect_imports(&worker_imports);

        // Get all references in a single pass
        let all_refs = self.worker.get_references(&cst_id)?;

        let mut references = Vec::new();
        for (name, worker_refs) in all_refs {
            for worker_ref in worker_refs {
                references.push(LocalReference {
                    name: name.clone(),
                    kind: reference_kind_from_str(&worker_ref.kind),
                    span: worker_ref
                        .span
                        .as_ref()
                        .map(|s| Span::new(s.start as u64, s.end as u64)),
                    line: worker_ref.line,
                    col: worker_ref.col,
                    scope_id: ScopeId(0), // Will be resolved during scope analysis
                    resolved_symbol: Some(name.clone()), // Same-name reference
                });
            }
        }

        Ok(FileAnalysis {
            file_id,
            path: path.to_string(),
            cst_id,
            scopes,
            symbols,
            references,
            imports,
        })
    }

    /// Build scope structure from worker scopes.
    ///
    /// This uses a two-pass approach to handle scopes that may appear out of order
    /// (e.g., child before parent). While LibCST typically returns scopes in
    /// depth-first order (parents before children), this two-pass approach is more
    /// robust and handles any ordering.
    ///
    /// Pass 1: Assign ScopeIds to all scopes
    /// Pass 2: Link parent references using the complete scope_map
    fn build_scopes(&self, worker_scopes: &[ScopeInfo]) -> (Vec<Scope>, HashMap<String, ScopeId>) {
        let mut scope_map = HashMap::new();

        // Pass 1: Assign ScopeIds to all scopes
        for (idx, ws) in worker_scopes.iter().enumerate() {
            let scope_id = ScopeId::new(idx as u32);
            scope_map.insert(ws.id.clone(), scope_id);
        }

        // Pass 2: Create scopes with parent references (now all IDs are known)
        let scopes: Vec<Scope> = worker_scopes
            .iter()
            .enumerate()
            .map(|(idx, ws)| {
                let scope_id = ScopeId::new(idx as u32);
                let parent_id = ws.parent.as_ref().and_then(|p| scope_map.get(p).copied());

                Scope::new(
                    scope_id,
                    ScopeKind::from(ws.kind.as_str()),
                    ws.name.clone(),
                    parent_id,
                )
            })
            .collect();

        (scopes, scope_map)
    }

    /// Collect symbols from worker bindings.
    fn collect_symbols(&self, bindings: &[BindingInfo], scopes: &[Scope]) -> Vec<LocalSymbol> {
        let mut symbols = Vec::new();

        for binding in bindings {
            let kind = symbol_kind_from_str(&binding.kind);

            // Determine scope from scope_path by matching names in the scope tree
            let scope_id = self
                .find_scope_for_path(&binding.scope_path, scopes)
                .unwrap_or(ScopeId(0));

            // Determine container for methods
            // The container is the class that immediately contains this symbol
            let container = if binding.scope_path.len() >= 2 {
                // Look for the last class in the scope_path before the symbol
                // Skip "<module>" and find the containing class
                let path_without_module: Vec<_> = binding
                    .scope_path
                    .iter()
                    .filter(|s| *s != "<module>")
                    .collect();

                if !path_without_module.is_empty() {
                    // Check if the last element corresponds to a class scope
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
    ///
    /// The scope_path is like ["<module>", "ClassName", "method_name"] which
    /// represents the nesting of scopes where a symbol is defined.
    fn find_scope_for_path(&self, scope_path: &[String], scopes: &[Scope]) -> Option<ScopeId> {
        if scope_path.is_empty() {
            return Some(ScopeId(0)); // Module scope
        }

        // Start from module scope and walk down the path
        let mut current_scope_id = ScopeId(0);

        for (i, path_element) in scope_path.iter().enumerate() {
            if path_element == "<module>" {
                // Skip the module marker, we already start at module scope
                continue;
            }

            // Find a scope with this name that has current_scope_id as parent
            let found = scopes.iter().find(|s| {
                s.parent_id == Some(current_scope_id) && s.name.as_deref() == Some(path_element)
            });

            if let Some(scope) = found {
                current_scope_id = scope.id;
            } else {
                // Path element not found - if this is the last element, return parent
                // (the symbol is defined in the current scope, not a new nested one)
                if i == scope_path.len() - 1 {
                    return Some(current_scope_id);
                }
                // Otherwise, path doesn't match scope structure - return what we have
                return Some(current_scope_id);
            }
        }

        Some(current_scope_id)
    }

    /// Collect and resolve imports.
    fn collect_imports(&self, worker_imports: &[ImportInfo]) -> Vec<LocalImport> {
        let mut imports = Vec::new();

        for wi in worker_imports {
            let names: Vec<ImportedName> = wi
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

            // Try to resolve the import to a workspace file
            let resolved_file = self.resolve_import_to_file(&wi.module);

            imports.push(LocalImport {
                kind: wi.kind.clone(),
                module_path: wi.module.clone(),
                names,
                alias: wi.alias.clone(),
                is_star: wi.is_star,
                span: wi
                    .span
                    .as_ref()
                    .map(|s| Span::new(s.start as u64, s.end as u64)),
                line: wi.line,
                resolved_file,
            });
        }

        imports
    }

    /// Resolve a module path to a workspace file.
    ///
    /// # Limitations
    ///
    /// Relative imports (e.g., `from . import foo` or `from ..utils import bar`) are
    /// not currently resolved. This would require tracking the importing file's
    /// location and resolving the relative path from there. See the cross-file rename
    /// tests for cases that require this functionality.
    ///
    /// # TODO(relative-imports)
    ///
    /// Implement relative import resolution:
    /// 1. Pass the importing file's path as an additional parameter
    /// 2. For `.`, resolve relative to the importing file's directory
    /// 3. For `..`, resolve relative to the parent directory
    /// 4. Handle `__init__.py` package semantics correctly
    fn resolve_import_to_file(&self, module_path: &str) -> Option<String> {
        // TODO(relative-imports): Relative imports are not yet supported.
        // They require the importing file's location to resolve correctly.
        // For example, `from . import foo` in `pkg/sub/mod.py` should resolve
        // to `pkg/sub/foo.py`, but we don't track the importing file here.
        if module_path.starts_with('.') {
            return None;
        }

        // Convert module path to file path
        // "myproject.utils" → "myproject/utils.py" or "myproject/utils/__init__.py"
        let file_path = module_path.replace('.', "/");

        // Try as .py file
        let py_path = format!("{}.py", file_path);
        if self.workspace_files.contains_key(&py_path) {
            return Some(py_path);
        }

        // Try as package (__init__.py)
        let init_path = format!("{}/__init__.py", file_path);
        if self.workspace_files.contains_key(&init_path) {
            return Some(init_path);
        }

        None
    }

    /// Resolve a symbol at a specific location.
    pub fn resolve_symbol_at(
        &mut self,
        path: &str,
        line: u32,
        col: u32,
        content: &str,
    ) -> AnalyzerResult<Option<LocalSymbol>> {
        // Parse and analyze the file
        let file_id = FileId::new(0);
        let analysis = self.analyze_file(file_id, path, content)?;

        // Find symbol at the given location
        for symbol in &analysis.symbols {
            if let (Some(sym_line), Some(sym_col)) = (symbol.line, symbol.col) {
                if sym_line == line && sym_col == col {
                    return Ok(Some(symbol.clone()));
                }
            }
        }

        Ok(None)
    }
}

// ============================================================================
// Python Adapter (FactsStore Integration)
// ============================================================================

/// Adapter that populates a FactsStore from Python file analysis.
pub struct PythonAdapter {
    /// Workspace root path.
    workspace_root: String,
}

impl PythonAdapter {
    /// Create a new Python adapter.
    pub fn new(workspace_root: impl Into<String>) -> Self {
        PythonAdapter {
            workspace_root: workspace_root.into(),
        }
    }

    /// Analyze multiple files and populate the FactsStore.
    pub fn analyze_files(
        &self,
        worker: &mut WorkerHandle,
        files: &[(String, String)], // (path, content) pairs
        store: &mut FactsStore,
    ) -> AnalyzerResult<()> {
        let mut analyzer = PythonAnalyzer::new(worker, &self.workspace_root);

        // Register all workspace files for import resolution
        analyzer.register_workspace_files(files.iter().map(|(p, _)| p.clone()));

        // Symbol name → (file_id, SymbolId) mapping for cross-file reference resolution
        let mut global_symbols: HashMap<String, Vec<(FileId, SymbolId)>> = HashMap::new();

        // Track which (file_id, name) pairs are import bindings (not definitions).
        // When resolving references, we prefer original definitions over import bindings.
        let mut import_bindings: HashSet<(FileId, String)> = HashSet::new();

        // First pass: analyze all files and collect symbols
        let mut file_analyses = Vec::new();

        for (path, content) in files {
            let file_id = store.next_file_id();
            let content_hash = ContentHash::compute(content.as_bytes());

            // Insert file into store
            let file = File::new(file_id, path.clone(), content_hash, Language::Python);
            store.insert_file(file);

            // Analyze the file
            let analysis = analyzer.analyze_file(file_id, path, content)?;
            file_analyses.push(analysis);
        }

        // Second pass: insert symbols into store
        for analysis in &file_analyses {
            for local_sym in &analysis.symbols {
                let symbol_id = store.next_symbol_id();
                let span = local_sym.span.unwrap_or(Span::new(0, 0));

                let mut symbol = Symbol::new(
                    symbol_id,
                    local_sym.kind,
                    &local_sym.name,
                    analysis.file_id,
                    span,
                );

                // Set container if this is a method
                if let Some(ref container_name) = local_sym.container {
                    // Find the container symbol in this file
                    if let Some(container_symbols) = global_symbols.get(container_name) {
                        for (file_id, container_id) in container_symbols {
                            if *file_id == analysis.file_id {
                                symbol = symbol.with_container(*container_id);
                                break;
                            }
                        }
                    }
                }

                store.insert_symbol(symbol);

                // Track for cross-file resolution
                global_symbols
                    .entry(local_sym.name.clone())
                    .or_default()
                    .push((analysis.file_id, symbol_id));

                // Track import bindings separately
                if local_sym.kind == SymbolKind::Import {
                    import_bindings.insert((analysis.file_id, local_sym.name.clone()));
                }
            }
        }

        // Third pass: insert references and imports
        for analysis in &file_analyses {
            // Insert references
            for local_ref in &analysis.references {
                // Find the symbol being referenced
                if let Some(ref resolved_name) = local_ref.resolved_symbol {
                    if let Some(symbol_entries) = global_symbols.get(resolved_name) {
                        // Resolve the symbol, preferring definitions over import bindings.
                        //
                        // When a name is imported (e.g., `from utils import calculate_sum`),
                        // both the original definition and the import binding are in symbol_entries.
                        // References to the imported name should link to the ORIGINAL definition,
                        // not the local import binding, so cross-file renames work correctly.
                        let symbol_id = {
                            // Check if same-file symbol is an import binding
                            let same_file_is_import = import_bindings
                                .contains(&(analysis.file_id, resolved_name.clone()));

                            if same_file_is_import {
                                // Prefer cross-file original (non-import) over local import binding
                                symbol_entries
                                    .iter()
                                    .find(|(fid, _)| *fid != analysis.file_id)
                                    .or_else(|| symbol_entries.first())
                                    .map(|(_, sid)| *sid)
                            } else {
                                // Normal case: prefer same-file symbol
                                symbol_entries
                                    .iter()
                                    .find(|(fid, _)| *fid == analysis.file_id)
                                    .or_else(|| symbol_entries.first())
                                    .map(|(_, sid)| *sid)
                            }
                        };

                        if let Some(symbol_id) = symbol_id {
                            let span = local_ref.span.unwrap_or(Span::new(0, 0));

                            // Check if the symbol is a method (has a container)
                            let is_method = store
                                .symbol(symbol_id)
                                .map(|sym| sym.container_symbol_id.is_some())
                                .unwrap_or(false);

                            if is_method {
                                // For methods, handle carefully to avoid name collision issues:
                                //
                                // 1. For Definition references: only create if span matches
                                //    the symbol's decl_span. This prevents Handler2.process
                                //    definition from being linked to Handler1.process.
                                //
                                // 2. For Attribute references (obj.method() calls): skip and
                                //    let the type-aware fourth pass handle them with receiver
                                //    type disambiguation.
                                //
                                // 3. For Call references (direct calls): same as Attribute.
                                //
                                // This ensures renaming Handler1.process only affects
                                // Handler1.process definition and typed calls, not other
                                // methods with the same name.

                                match local_ref.kind {
                                    ReferenceKind::Definition => {
                                        // Only create if span matches the symbol's decl_span
                                        if let Some(sym) = store.symbol(symbol_id) {
                                            if span != sym.decl_span {
                                                // This is a definition of a DIFFERENT method
                                                // with the same name - skip it
                                                continue;
                                            }
                                        }
                                    }
                                    ReferenceKind::Attribute | ReferenceKind::Call => {
                                        // Skip - let fourth pass handle with type info
                                        continue;
                                    }
                                    _ => {
                                        // Other kinds (Reference, Import, etc.) - allow
                                    }
                                }
                            }

                            let ref_id = store.next_reference_id();
                            let reference = Reference::new(
                                ref_id,
                                symbol_id,
                                analysis.file_id,
                                span,
                                local_ref.kind,
                            );
                            store.insert_reference(reference);
                        }
                    }
                }
            }

            // Insert imports and create references for imported names
            for local_import in &analysis.imports {
                let import_id = store.next_import_id();
                let span = local_import.span.unwrap_or(Span::new(0, 0));

                let mut import =
                    Import::new(import_id, analysis.file_id, span, &local_import.module_path);

                if local_import.is_star {
                    import = import.with_star();
                } else if !local_import.names.is_empty() {
                    // For `from ... import name`, record the first name
                    let first_name = &local_import.names[0];
                    import = import.with_imported_name(&first_name.name);
                    if let Some(ref alias) = first_name.alias {
                        import = import.with_alias(alias);
                    }
                    // Note: References for imported names are created via the regular
                    // reference resolution above, which correctly links them to the
                    // original symbol definitions for cross-file rename tracking.
                } else if let Some(ref alias) = local_import.alias {
                    // For `import ... as alias`
                    import = import.with_alias(alias);
                }

                store.insert_import(import);
            }
        }

        // Fourth pass: type-aware method resolution (per Step 5 type inference)
        //
        // This pass integrates the TypeTracker to:
        // 1. Populate TypeInfo in the FactsStore for all typed variables
        // 2. Resolve method calls on typed receivers to the correct class method
        //
        // For method calls like `obj.method()` where `obj` has a known type,
        // this creates correctly-linked references to `ClassName.method` instead
        // of relying on name-based matching which can be incorrect when multiple
        // classes define methods with the same name.
        //
        // OPTIMIZATION: Uses MethodCallIndex for O(M × C_match) instead of O(M × F × C)
        // by building an index of all method calls once, then looking up by method name.

        // Build MethodCallIndex and cache TypeTrackers in a single pass over all files.
        // This avoids repeated get_analysis() and analyze_types_from_analysis() calls.
        let mut method_call_index = MethodCallIndex::new();

        for analysis in &file_analyses {
            // Get combined analysis to access type data (assignments, annotations, method_calls)
            let combined = analyzer.worker.get_analysis(&analysis.cst_id)?;

            // Build TypeTracker from assignments and annotations
            let tracker = analyze_types_from_analysis(&combined.assignments, &combined.annotations);

            // Populate TypeInfo in FactsStore for all typed variables
            populate_type_info(&tracker, store, analysis.file_id);

            // Build method call index with resolved receiver types
            for method_call in &combined.method_calls {
                // Get the receiver's type from the TypeTracker
                let receiver_type = tracker.type_of(&method_call.scope_path, &method_call.receiver);

                // Get method span
                let method_span = match &method_call.method_span {
                    Some(s) => Span::new(s.start as u64, s.end as u64),
                    None => continue,
                };

                // Add to index
                method_call_index.add(
                    method_call.method.clone(),
                    IndexedMethodCall {
                        file_id: analysis.file_id,
                        receiver: method_call.receiver.clone(),
                        receiver_type: receiver_type.map(String::from),
                        scope_path: method_call.scope_path.clone(),
                        method_span,
                    },
                );
            }

            // Populate inheritance hierarchy from class_inheritance data
            //
            // For each class with base classes, create InheritanceInfo entries
            // to enable method override tracking during rename.
            //
            // Uses ImportResolver for import-aware resolution: if a base class is
            // imported from another file, we prefer the class from that file over
            // a same-named class in the current file.

            // Build import resolver for this file
            let import_resolver = ImportResolver::from_imports(&analysis.imports);

            for class_info in &combined.class_inheritance {
                // Find the child class symbol in this file
                let child_symbols: Vec<_> = store
                    .symbols_named(&class_info.name)
                    .iter()
                    .filter(|s| s.decl_file_id == analysis.file_id && s.kind == SymbolKind::Class)
                    .map(|s| s.symbol_id)
                    .collect();

                let child_id = match child_symbols.first() {
                    Some(id) => *id,
                    None => continue,
                };

                // For each base class, try to resolve it and create inheritance link
                for base_name in &class_info.bases {
                    // First, try import-aware resolution
                    let base_id = if let Some(resolved_file) =
                        import_resolver.resolved_file(base_name)
                    {
                        // Base class was imported from a specific file - prefer that file
                        let target_file_id = store.file_by_path(resolved_file).map(|f| f.file_id);

                        let base_symbols: Vec<_> = store
                            .symbols_named(base_name)
                            .iter()
                            .filter(|s| s.kind == SymbolKind::Class)
                            .map(|s| (s.symbol_id, s.decl_file_id))
                            .collect();

                        // Prefer the class from the resolved import file
                        if let Some(target_fid) = target_file_id {
                            base_symbols
                                .iter()
                                .find(|(_, fid)| *fid == target_fid)
                                .or_else(|| base_symbols.first())
                                .map(|(id, _)| *id)
                        } else {
                            // Import resolved to a file not in workspace - fall back to heuristic
                            base_symbols
                                .iter()
                                .find(|(_, fid)| *fid == analysis.file_id)
                                .or_else(|| base_symbols.first())
                                .map(|(id, _)| *id)
                        }
                    } else {
                        // Not an imported name - use same-file-first heuristic
                        let base_symbols: Vec<_> = store
                            .symbols_named(base_name)
                            .iter()
                            .filter(|s| s.kind == SymbolKind::Class)
                            .map(|s| (s.symbol_id, s.decl_file_id))
                            .collect();

                        base_symbols
                            .iter()
                            .find(|(_, fid)| *fid == analysis.file_id)
                            .or_else(|| base_symbols.first())
                            .map(|(id, _)| *id)
                    };

                    if let Some(parent_id) = base_id {
                        store.insert_inheritance(InheritanceInfo::new(child_id, parent_id));
                    }
                }
            }
        }

        // Collect existing reference spans to avoid duplicates
        // Key: (file_id, span_start, span_end) for quick lookup
        let mut existing_ref_spans: HashSet<(FileId, u64, u64)> = HashSet::new();
        for analysis in &file_analyses {
            for r in store.refs_in_file(analysis.file_id) {
                existing_ref_spans.insert((r.file_id, r.span.start, r.span.end));
            }
        }

        // Collect type-aware method call references using indexed lookup
        // Complexity: O(M × C_match) instead of O(M × F × C)
        let mut typed_method_refs: Vec<(SymbolId, FileId, Span)> = Vec::new();

        for analysis in &file_analyses {
            // Get symbols defined in this file (cloned to avoid borrow issues)
            let file_symbols: Vec<_> = store
                .symbols_in_file(analysis.file_id)
                .into_iter()
                .map(|s| (s.symbol_id, s.kind, s.name.clone(), s.container_symbol_id))
                .collect();

            for (symbol_id, kind, symbol_name, container_opt) in file_symbols {
                // Only process methods/functions with a container (class methods)
                if kind != SymbolKind::Method && kind != SymbolKind::Function {
                    continue;
                }
                let container_id = match container_opt {
                    Some(id) => id,
                    None => continue,
                };

                // Get the container class name
                let container_name = match store.symbol(container_id) {
                    Some(c) => c.name.clone(),
                    None => continue,
                };

                // Use indexed lookup instead of nested file iteration
                // O(C_match) instead of O(F × C)
                for indexed_call in method_call_index.get(&symbol_name) {
                    // Check if the receiver type matches the container class
                    let type_matches = indexed_call.receiver_type.as_ref() == Some(&container_name);

                    if type_matches {
                        let key = (
                            indexed_call.file_id,
                            indexed_call.method_span.start,
                            indexed_call.method_span.end,
                        );
                        if !existing_ref_spans.contains(&key) {
                            typed_method_refs.push((
                                symbol_id,
                                indexed_call.file_id,
                                indexed_call.method_span,
                            ));
                            // Mark as added to prevent duplicates within this pass
                            existing_ref_spans.insert(key);
                        }
                    }
                }
            }
        }

        // Insert all collected type-aware method references
        for (symbol_id, file_id, span) in typed_method_refs {
            let ref_id = store.next_reference_id();
            let reference = Reference::new(ref_id, symbol_id, file_id, span, ReferenceKind::Call);
            store.insert_reference(reference);
        }

        Ok(())
    }

    /// Find all references to a symbol across the workspace.
    pub fn find_references<'a>(
        &self,
        store: &'a FactsStore,
        symbol_id: SymbolId,
    ) -> Vec<&'a Reference> {
        store.refs_of_symbol(symbol_id)
    }

    /// Find all methods that override the given method in descendant classes.
    ///
    /// When renaming a base class method, all override methods in child classes
    /// must also be renamed to maintain the inheritance contract.
    ///
    /// Returns the SymbolIds of override methods (not including the original).
    pub fn find_override_methods(
        &self,
        store: &FactsStore,
        method_symbol: &Symbol,
    ) -> Vec<SymbolId> {
        let mut overrides = Vec::new();

        // Get the container class (the method's parent)
        let class_id = match method_symbol.container_symbol_id {
            Some(id) => id,
            None => return overrides, // Not a method
        };

        // Collect all descendant classes using BFS
        let mut descendant_classes = Vec::new();
        let mut queue = vec![class_id];

        while let Some(current_class) = queue.pop() {
            for child_id in store.children_of_class(current_class) {
                if !descendant_classes.contains(&child_id) {
                    descendant_classes.push(child_id);
                    queue.push(child_id);
                }
            }
        }

        // Find methods with the same name in descendant classes
        let method_name = &method_symbol.name;
        for descendant_id in descendant_classes {
            let candidate_methods = store.symbols_named(method_name);
            for method in candidate_methods {
                if method.container_symbol_id == Some(descendant_id)
                    && (method.kind == SymbolKind::Method || method.kind == SymbolKind::Function)
                {
                    overrides.push(method.symbol_id);
                }
            }
        }

        overrides
    }

    /// Resolve a symbol at a location.
    ///
    /// The `content` parameter is the file content, needed to convert line/col to byte offset.
    pub fn resolve_symbol_at_location<'a>(
        &self,
        store: &'a FactsStore,
        path: &str,
        line: u32,
        col: u32,
        content: &str,
    ) -> Option<&'a Symbol> {
        // Find the file
        let file = store.file_by_path(path)?;

        // Convert line/col to byte offset
        let byte_offset = position_to_byte_offset_str(content, line, col);

        // Find symbols in this file
        let symbols = store.symbols_in_file(file.file_id);

        // Find symbols whose span contains the byte offset
        let mut matching_symbols: Vec<_> = symbols
            .into_iter()
            .filter(|s| s.decl_span.start <= byte_offset && byte_offset < s.decl_span.end)
            .collect();

        // If no direct match, check references at this location
        if matching_symbols.is_empty() {
            let refs = store.refs_in_file(file.file_id);
            for reference in refs {
                if reference.span.start <= byte_offset && byte_offset < reference.span.end {
                    if let Some(symbol) = store.symbol(reference.symbol_id) {
                        return Some(symbol);
                    }
                }
            }
            return None;
        }

        // Return the first matching symbol (prefer smallest span if multiple)
        matching_symbols.sort_by_key(|s| s.decl_span.end - s.decl_span.start);
        matching_symbols.into_iter().next()
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

    // Integration tests that require the worker are in a separate module
    // to allow skipping when Python/libcst are not available
    #[cfg(test)]
    mod integration_tests {
        use super::*;
        use crate::python::test_helpers::require_python_with_libcst;
        use crate::python::worker::spawn_worker;
        use tempfile::TempDir;

        #[test]
        fn analyze_simple_file() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();
            let mut analyzer = PythonAnalyzer::new(&mut worker, temp.path().to_str().unwrap());

            let content = r#"
def foo():
    pass

x = 1
foo()
"#;

            let result = analyzer.analyze_file(FileId::new(0), "test.py", content);
            assert!(result.is_ok(), "Analysis failed: {:?}", result.err());

            let analysis = result.unwrap();
            assert!(!analysis.symbols.is_empty());
            assert!(analysis
                .symbols
                .iter()
                .any(|s| s.name == "foo" && s.kind == SymbolKind::Function));
            assert!(analysis
                .symbols
                .iter()
                .any(|s| s.name == "x" && s.kind == SymbolKind::Variable));
        }

        #[test]
        fn analyze_class_with_method() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();
            let mut analyzer = PythonAnalyzer::new(&mut worker, temp.path().to_str().unwrap());

            let content = r#"
class MyClass:
    def my_method(self):
        pass
"#;

            let result = analyzer.analyze_file(FileId::new(0), "test.py", content);
            assert!(result.is_ok());

            let analysis = result.unwrap();
            assert!(analysis
                .symbols
                .iter()
                .any(|s| s.name == "MyClass" && s.kind == SymbolKind::Class));
            assert!(analysis
                .symbols
                .iter()
                .any(|s| s.name == "my_method" && s.kind == SymbolKind::Function));
        }

        #[test]
        fn analyze_imports() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();
            let mut analyzer = PythonAnalyzer::new(&mut worker, temp.path().to_str().unwrap());

            let content = r#"
import os
from os.path import join, exists as path_exists
from typing import *
"#;

            let result = analyzer.analyze_file(FileId::new(0), "test.py", content);
            assert!(result.is_ok());

            let analysis = result.unwrap();
            assert!(!analysis.imports.is_empty());

            // Check import os
            assert!(analysis
                .imports
                .iter()
                .any(|i| i.module_path == "os" && i.kind == "import"));

            // Check from os.path import ...
            assert!(analysis
                .imports
                .iter()
                .any(|i| i.module_path == "os.path" && i.kind == "from"));

            // Check star import
            assert!(analysis.imports.iter().any(|i| i.is_star));
        }

        #[test]
        fn adapter_populates_facts_store() {
            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();
            let adapter = PythonAdapter::new(temp.path().to_str().unwrap());

            let files = vec![
                ("main.py".to_string(), "def main():\n    pass\n".to_string()),
                (
                    "utils.py".to_string(),
                    "def helper():\n    pass\n".to_string(),
                ),
            ];

            let mut store = FactsStore::new();
            let result = adapter.analyze_files(&mut worker, &files, &mut store);

            assert!(result.is_ok(), "Adapter failed: {:?}", result.err());
            assert_eq!(store.file_count(), 2);
            assert!(store.symbol_count() >= 2);

            // Check files are in store
            assert!(store.file_by_path("main.py").is_some());
            assert!(store.file_by_path("utils.py").is_some());

            // Check symbols exist
            let main_symbols = store.symbols_named("main");
            assert!(!main_symbols.is_empty());

            let helper_symbols = store.symbols_named("helper");
            assert!(!helper_symbols.is_empty());
        }

        #[test]
        fn libcst_rewrite_preserves_formatting() {
            use crate::python::worker::{RewriteRequest, SpanInfo};

            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            // Source with specific formatting: indentation, comments, trailing whitespace
            let content = r#"def foo():    # comment here
    """Docstring for foo."""
    x = 1  # inline comment
    return x

class MyClass:
    def foo(self):  # method
        pass
"#;

            // Parse the content
            let parse_result = worker.parse("test.py", content).unwrap();

            // Find the span of the first "foo" (at "def foo")
            // "def foo" - foo starts at byte 4 (after "def ")
            let rewrites = vec![RewriteRequest {
                span: SpanInfo { start: 4, end: 7 },
                new_name: "bar".to_string(),
            }];

            let new_content = worker
                .rewrite_batch(&parse_result.cst_id, &rewrites)
                .unwrap();

            // The change should ONLY affect the identifier "foo" -> "bar"
            // All other formatting (comments, indentation, docstring) should be preserved
            let expected = r#"def bar():    # comment here
    """Docstring for foo."""
    x = 1  # inline comment
    return x

class MyClass:
    def foo(self):  # method
        pass
"#;

            assert_eq!(new_content, expected);

            // Verify formatting preservation characteristics:
            // 1. Comment "# comment here" is preserved
            assert!(new_content.contains("# comment here"));
            // 2. Docstring is preserved
            assert!(new_content.contains("\"\"\"Docstring for foo.\"\"\""));
            // 3. Inline comment is preserved
            assert!(new_content.contains("# inline comment"));
            // 4. Indentation is preserved (4 spaces)
            assert!(new_content.contains("    \"\"\"Docstring"));
            // 5. The class method "foo" was NOT changed (different span)
            assert!(new_content.contains("def foo(self)"));
        }

        #[test]
        fn libcst_rewrite_batch_multiple_names() {
            use crate::python::worker::{RewriteRequest, SpanInfo};

            let python = require_python_with_libcst();
            let temp = TempDir::new().unwrap();
            std::fs::create_dir_all(temp.path().join("python")).unwrap();
            std::fs::create_dir_all(temp.path().join("workers")).unwrap();

            let mut worker = spawn_worker(&python, temp.path()).unwrap();

            // Source with multiple references to same name
            let content = "def foo():\n    pass\n\nfoo()\nfoo()\n";
            //                 ^4-7                ^21-24 ^27-30

            let parse_result = worker.parse("test.py", content).unwrap();

            // Rewrite all occurrences of "foo"
            let rewrites = vec![
                RewriteRequest {
                    span: SpanInfo { start: 4, end: 7 }, // def foo
                    new_name: "bar".to_string(),
                },
                RewriteRequest {
                    span: SpanInfo { start: 21, end: 24 }, // first foo()
                    new_name: "bar".to_string(),
                },
                RewriteRequest {
                    span: SpanInfo { start: 27, end: 30 }, // second foo()
                    new_name: "bar".to_string(),
                },
            ];

            let new_content = worker
                .rewrite_batch(&parse_result.cst_id, &rewrites)
                .unwrap();

            // All "foo" should now be "bar"
            assert!(!new_content.contains("foo"));
            assert_eq!(new_content.matches("bar").count(), 3);
            assert_eq!(new_content, "def bar():\n    pass\n\nbar()\nbar()\n");
        }
    }
}
