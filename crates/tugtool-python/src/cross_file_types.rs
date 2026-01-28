//! Cross-file type resolution cache and utilities.
//!
//! This module provides infrastructure for resolving types across file boundaries,
//! enabling method call resolution when intermediate types are defined in other files.
//!
//! # Architecture
//!
//! The [`CrossFileTypeCache`] maintains a bounded cache of [`FileTypeContext`] structs,
//! each containing the type information needed for resolution in a single file.
//! Files are analyzed on-demand when their types are first referenced.
//!
//! # Key Concepts
//!
//! - **On-demand analysis**: Files are only analyzed when needed, not upfront
//! - **Cycle detection**: Circular import chains are detected and gracefully handled
//! - **FIFO eviction**: Cache size is bounded to prevent unbounded memory growth
//! - **Scope-aware lookup**: Import targets are looked up using scope-chain semantics
//!
//! # Example
//!
//! ```ignore
//! use tugtool_python::cross_file_types::{CrossFileTypeCache, FileTypeContext};
//!
//! let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);
//! let ctx = cache.get_or_analyze(file_path, workspace_root)?;
//! let attr_type = ctx.tracker.attribute_type_of("Handler", "process");
//! ```
//!
//! # Limitations
//!
//! - Maximum cross-file chain depth is bounded by [`MAX_CROSS_FILE_DEPTH`]
//! - Function-level imports are not tracked (only module-level)
//! - External packages (outside workspace) are not resolved

use std::collections::{HashMap, HashSet, VecDeque};
use std::io;
use std::path::{Path, PathBuf};

use thiserror::Error;
use tugtool_core::facts::SymbolKind;

use crate::analyzer::{resolve_module_to_file, FileAnalysis, ResolvedModule};
use crate::cst_bridge;
use crate::type_tracker::TypeTracker;

// Re-export ClassInheritanceInfo from CST for use in FileTypeContext
pub use tugtool_python_cst::ClassInheritanceInfo;

// ============================================================================
// Constants
// ============================================================================

/// Maximum depth for cross-file type resolution chains.
///
/// This limits how many files deep we follow type chains to prevent
/// performance degradation and infinite loops in complex import graphs.
/// A depth of 3 covers most practical cases (e.g., consumer -> handler -> base).
pub const MAX_CROSS_FILE_DEPTH: usize = 3;

/// Default maximum cache size (number of files).
const DEFAULT_MAX_CACHE_SIZE: usize = 100;

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during cross-file type resolution.
#[derive(Debug, Error)]
pub enum TypeResolutionError {
    /// Circular import detected during resolution.
    #[error("circular import detected: {0}")]
    CircularImport(PathBuf),

    /// File not found in workspace.
    #[error("file not found: {0}")]
    FileNotFound(PathBuf),

    /// IO error reading file.
    #[error("IO error: {0}")]
    Io(#[from] io::Error),

    /// Parse error in target file.
    #[error("parse error in {path}: {message}")]
    ParseError { path: PathBuf, message: String },

    /// Maximum resolution depth exceeded.
    #[error("maximum cross-file resolution depth ({0}) exceeded")]
    DepthExceeded(usize),
}

/// Result type for type resolution operations.
pub type TypeResolutionResult<T> = Result<T, TypeResolutionError>;

// ============================================================================
// Import Target Types
// ============================================================================

/// Information about an import target for cross-file resolution.
///
/// This struct captures where an imported name comes from and how it was imported,
/// enabling correct resolution when following type chains across files.
#[derive(Debug, Clone)]
pub struct ImportTarget {
    /// Path to the file containing the imported symbol.
    pub file_path: PathBuf,
    /// Kind of import (from-import vs module-import).
    pub kind: ImportTargetKind,
}

/// The kind of import target and associated metadata.
///
/// Distinguishes between `from mod import Name` and `import mod.sub` patterns,
/// which require different resolution strategies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportTargetKind {
    /// `from mod import Name [as Alias]` - imports a specific name from a module.
    FromImport {
        /// The original name being imported (e.g., "Handler" in `from mod import Handler as H`).
        imported_name: String,
        /// Whether this imports a submodule rather than a class/function.
        /// True for patterns like `from pkg import mod` where `mod` is a module.
        imported_module: bool,
    },
    /// `import mod.sub [as Alias]` - imports a module by its path.
    ModuleImport,
}

// ============================================================================
// Class Hierarchy Info
// ============================================================================

/// Class hierarchy information for MRO computation.
///
/// This is the cross-file version of class inheritance info, containing
/// the data needed to compute Method Resolution Order.
#[derive(Debug, Clone)]
pub struct ClassHierarchyInfo {
    /// Simple name of the class.
    pub name: String,
    /// Base class names (may be qualified or simple).
    pub bases: Vec<String>,
    /// Computed MRO (if already calculated).
    pub mro: Option<Vec<String>>,
}

// ============================================================================
// File Type Context
// ============================================================================

/// Bundle of per-file context needed for cross-file type resolution.
///
/// This struct contains all the information extracted from a single file
/// that is needed when resolving types across file boundaries.
#[derive(Debug)]
pub struct FileTypeContext {
    /// Type information for this file.
    pub tracker: TypeTracker,
    /// Symbol kind lookup by (scope_path, name).
    pub symbol_kinds: HashMap<(Vec<String>, String), SymbolKind>,
    /// Symbol index lookup by (scope_path, name).
    pub symbol_map: HashMap<(Vec<String>, String), usize>,
    /// Import targets: (scope_path, local_name) -> ImportTarget.
    pub import_targets: HashMap<(Vec<String>, String), ImportTarget>,
    /// Class hierarchy info for MRO computation.
    pub class_hierarchies: HashMap<String, ClassHierarchyInfo>,
}

// ============================================================================
// Cross-File Type Cache
// ============================================================================

/// Cache for cross-file type information.
///
/// This cache stores [`FileTypeContext`] instances for files that have been
/// analyzed during cross-file resolution. It enables efficient lookup
/// of types defined in other files without re-parsing.
///
/// # Features
///
/// - **On-demand loading**: Files are analyzed only when first accessed
/// - **FIFO eviction**: Bounded cache size with first-in-first-out eviction
/// - **Cycle detection**: Prevents infinite loops on circular imports
///
/// # Example
///
/// ```ignore
/// let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);
///
/// // First access analyzes the file
/// let ctx = cache.get_or_analyze(path, workspace_root)?;
///
/// // Subsequent accesses use cached data
/// let ctx2 = cache.get_or_analyze(path, workspace_root)?;
/// ```
pub struct CrossFileTypeCache {
    /// Map from file path to analyzed type context.
    contexts: HashMap<PathBuf, FileTypeContext>,

    /// Files currently being analyzed (for cycle detection).
    in_progress: HashSet<PathBuf>,

    /// Maximum cache size (number of files).
    max_size: usize,

    /// FIFO tracking for cache eviction (insertion order).
    access_order: VecDeque<PathBuf>,

    /// Workspace file set for import resolution (Pass 3 contract).
    workspace_files: HashSet<String>,

    /// Namespace packages detected in the workspace (PEP 420).
    namespace_packages: HashSet<String>,
}

impl CrossFileTypeCache {
    /// Create a new cache with workspace context.
    ///
    /// # Arguments
    ///
    /// * `workspace_files` - Set of all Python file paths in the workspace
    /// * `namespace_packages` - Set of namespace package paths (PEP 420)
    pub fn new(workspace_files: HashSet<String>, namespace_packages: HashSet<String>) -> Self {
        Self {
            contexts: HashMap::new(),
            in_progress: HashSet::new(),
            max_size: DEFAULT_MAX_CACHE_SIZE,
            access_order: VecDeque::new(),
            workspace_files,
            namespace_packages,
        }
    }

    /// Create a new cache with custom size limit.
    pub fn with_max_size(
        workspace_files: HashSet<String>,
        namespace_packages: HashSet<String>,
        max_size: usize,
    ) -> Self {
        Self {
            contexts: HashMap::new(),
            in_progress: HashSet::new(),
            max_size,
            access_order: VecDeque::new(),
            workspace_files,
            namespace_packages,
        }
    }

    /// Get or analyze a file's type information.
    ///
    /// If the file is already cached, returns the cached context.
    /// Otherwise, analyzes the file and caches the result.
    ///
    /// Uses FIFO eviction (not LRU) for O(1) cache operations.
    /// For a type resolution cache, FIFO is acceptable since all cached
    /// files are likely to be accessed with similar frequency.
    ///
    /// # Arguments
    ///
    /// * `file_path` - Path to the Python file to analyze
    /// * `workspace_root` - Root directory of the workspace (for relative path resolution)
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The file is part of a circular import chain (`CircularImport`)
    /// - The file cannot be read (`Io`)
    /// - The file cannot be parsed (`ParseError`)
    pub fn get_or_analyze(
        &mut self,
        file_path: &Path,
        workspace_root: &Path,
    ) -> TypeResolutionResult<&FileTypeContext> {
        let path_key = file_path.to_path_buf();

        // Fast path: check if already cached
        if self.contexts.contains_key(&path_key) {
            // FIFO eviction: don't update access_order on hit (O(1))
            return Ok(self.contexts.get(&path_key).unwrap());
        }

        // Check for cycles
        if self.in_progress.contains(&path_key) {
            return Err(TypeResolutionError::CircularImport(path_key));
        }

        // Mark as in progress
        self.in_progress.insert(path_key.clone());

        // Analyze the file
        let result = self.analyze_file(&path_key, workspace_root);

        // Always remove from in_progress, even on error
        self.in_progress.remove(&path_key);

        // Handle analysis result
        let ctx = result?;

        // Cache eviction if needed (FIFO: evict oldest inserted)
        if self.contexts.len() >= self.max_size {
            self.evict_oldest();
        }

        // Store in cache
        self.access_order.push_back(path_key.clone());
        self.contexts.insert(path_key.clone(), ctx);

        // Safe: we just inserted, so the key exists
        Ok(self.contexts.get(&path_key).unwrap())
    }

    /// Check if a file is currently cached.
    pub fn is_cached(&self, file_path: &Path) -> bool {
        self.contexts.contains_key(file_path)
    }

    /// Get the number of cached files.
    pub fn len(&self) -> usize {
        self.contexts.len()
    }

    /// Check if the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.contexts.is_empty()
    }

    /// Clear the cache.
    pub fn clear(&mut self) {
        self.contexts.clear();
        self.access_order.clear();
        self.in_progress.clear();
    }

    /// Get a reference to the workspace files set.
    pub fn workspace_files(&self) -> &HashSet<String> {
        &self.workspace_files
    }

    /// Get a reference to the namespace packages set.
    pub fn namespace_packages(&self) -> &HashSet<String> {
        &self.namespace_packages
    }

    // ========================================================================
    // Internal Methods
    // ========================================================================

    /// Evict the oldest inserted entry (FIFO eviction).
    fn evict_oldest(&mut self) {
        if let Some(oldest) = self.access_order.pop_front() {
            self.contexts.remove(&oldest);
        }
    }

    /// Analyze a file and build its FileTypeContext.
    fn analyze_file(
        &self,
        file_path: &Path,
        workspace_root: &Path,
    ) -> TypeResolutionResult<FileTypeContext> {
        // Read the file
        let source = std::fs::read_to_string(file_path)?;

        // Parse and analyze using CST bridge
        let analysis = cst_bridge::parse_and_analyze(&source).map_err(|e| {
            TypeResolutionError::ParseError {
                path: file_path.to_path_buf(),
                message: e.to_string(),
            }
        })?;

        // Convert to FileAnalysis for helper functions
        // We need to create a minimal FileAnalysis-like structure
        let file_path_str = file_path
            .strip_prefix(workspace_root)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        // Build symbol kinds map
        let symbol_kinds = build_symbol_kinds_from_cst(&analysis);

        // Build symbol map
        let symbol_map = build_symbol_map_from_cst(&analysis);

        // Build import targets
        let import_targets = build_import_targets_from_cst(
            &analysis,
            &self.workspace_files,
            &self.namespace_packages,
            &file_path_str,
        );

        // Build class hierarchies
        let class_hierarchies = build_class_hierarchies_from_cst(&analysis);

        // Build TypeTracker
        let mut tracker = TypeTracker::new();
        tracker.process_assignments(&convert_assignments(&analysis.assignments));
        tracker.process_annotations(&convert_annotations(&analysis.annotations));
        tracker.process_signatures(&analysis.signatures);

        Ok(FileTypeContext {
            tracker,
            symbol_kinds,
            symbol_map,
            import_targets,
            class_hierarchies,
        })
    }
}

// ============================================================================
// Helper Functions for Building Context
// ============================================================================

/// Build symbol kinds map from CST analysis result.
fn build_symbol_kinds_from_cst(
    analysis: &cst_bridge::NativeAnalysisResult,
) -> HashMap<(Vec<String>, String), SymbolKind> {
    let mut map = HashMap::new();

    for binding in &analysis.bindings {
        let kind = match binding.kind.as_str() {
            "class" => SymbolKind::Class,
            "function" => SymbolKind::Function,
            "import" => SymbolKind::Import,
            "parameter" => SymbolKind::Parameter,
            "variable" => SymbolKind::Variable,
            _ => SymbolKind::Variable,
        };
        let key = (binding.scope_path.clone(), binding.name.clone());
        map.insert(key, kind);
    }

    map
}

/// Build symbol index map from CST analysis result.
fn build_symbol_map_from_cst(
    analysis: &cst_bridge::NativeAnalysisResult,
) -> HashMap<(Vec<String>, String), usize> {
    let mut map = HashMap::new();

    for (index, binding) in analysis.bindings.iter().enumerate() {
        let key = (binding.scope_path.clone(), binding.name.clone());
        map.insert(key, index);
    }

    map
}

/// Build import targets map from CST analysis result.
///
/// This function creates a scope-aware map of import targets for cross-file resolution.
/// For Phase 11D, imports are tracked at module scope only.
fn build_import_targets_from_cst(
    analysis: &cst_bridge::NativeAnalysisResult,
    workspace_files: &HashSet<String>,
    namespace_packages: &HashSet<String>,
    importing_file_path: &str,
) -> HashMap<(Vec<String>, String), ImportTarget> {
    let mut import_targets = HashMap::new();
    let module_scope = vec!["<module>".to_string()];

    for import in &analysis.imports {
        // Only process resolved imports (those in workspace)
        let resolved_file = match get_resolved_file(import, workspace_files, namespace_packages) {
            Some(path) => path,
            None => continue,
        };

        match import.kind {
            tugtool_python_cst::ImportKind::From => {
                // from mod import Name [as Alias], Name2 [as Alias2], ...
                // names is Option<Vec<ImportedName>> for from imports
                if let Some(ref names) = import.names {
                    for imported_name in names {
                        let mut file_path = PathBuf::from(&resolved_file);
                        let mut imported_module = false;

                        // Detect submodule imports: from pkg import mod
                        // Check if `module_path.name` resolves to a file
                        let submodule_path = format!("{}.{}", import.module, imported_name.name);
                        if let Some(ResolvedModule::File(member_file)) = resolve_module_to_file(
                            &submodule_path,
                            workspace_files,
                            namespace_packages,
                            Some(importing_file_path),
                            import.relative_level as u32,
                        ) {
                            imported_module = true;
                            file_path = PathBuf::from(member_file);
                        }

                        let local_name = imported_name
                            .alias
                            .as_ref()
                            .unwrap_or(&imported_name.name)
                            .clone();

                        let key = (module_scope.clone(), local_name);
                        let target = ImportTarget {
                            file_path,
                            kind: ImportTargetKind::FromImport {
                                imported_name: imported_name.name.clone(),
                                imported_module,
                            },
                        };
                        import_targets.insert(key, target);
                    }
                }
            }
            tugtool_python_cst::ImportKind::Import => {
                // import mod.sub [as Alias]
                let file_path = PathBuf::from(&resolved_file);
                let local_name = import
                    .alias
                    .clone()
                    .unwrap_or_else(|| import.module.split('.').next().unwrap_or("").to_string());

                let key = (module_scope.clone(), local_name);
                let target = ImportTarget {
                    file_path,
                    kind: ImportTargetKind::ModuleImport,
                };
                import_targets.insert(key, target);
            }
        }
    }

    import_targets
}

/// Get the resolved file path for an import.
fn get_resolved_file(
    import: &tugtool_python_cst::ImportInfo,
    workspace_files: &HashSet<String>,
    namespace_packages: &HashSet<String>,
) -> Option<String> {
    // Try to resolve the module path to a file
    // Note: We don't have context_path for relative imports here,
    // so we only handle absolute imports in this helper
    let resolved = resolve_module_to_file(
        &import.module,
        workspace_files,
        namespace_packages,
        None,
        import.relative_level as u32,
    )?;

    match resolved {
        ResolvedModule::File(path) => Some(path),
        ResolvedModule::Namespace(_) => None, // Namespace packages don't have a single file
    }
}

/// Build class hierarchies map from CST analysis result.
fn build_class_hierarchies_from_cst(
    analysis: &cst_bridge::NativeAnalysisResult,
) -> HashMap<String, ClassHierarchyInfo> {
    let mut map = HashMap::new();

    for class_info in &analysis.class_inheritance {
        let hierarchy = ClassHierarchyInfo {
            name: class_info.name.clone(),
            bases: class_info.bases.clone(),
            mro: None, // Computed lazily
        };
        map.insert(class_info.name.clone(), hierarchy);
    }

    map
}

/// Convert CST assignments to analyzer assignments format.
fn convert_assignments(
    cst_assignments: &[tugtool_python_cst::AssignmentInfo],
) -> Vec<crate::types::AssignmentInfo> {
    cst_assignments
        .iter()
        .map(|a| crate::types::AssignmentInfo {
            target: a.target.clone(),
            scope_path: a.scope_path.clone(),
            type_source: a.type_source.to_string(),
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
        .collect()
}

/// Convert CST annotations to analyzer annotations format.
fn convert_annotations(
    cst_annotations: &[tugtool_python_cst::AnnotationInfo],
) -> Vec<crate::types::AnnotationInfo> {
    cst_annotations
        .iter()
        .map(|a| crate::types::AnnotationInfo {
            name: a.name.clone(),
            type_str: a.type_str.clone(),
            annotation_kind: a.annotation_kind.as_str().to_string(),
            source_kind: a.source_kind.as_str().to_string(),
            scope_path: a.scope_path.clone(),
            span: a.span.as_ref().map(|s| crate::types::SpanInfo {
                start: s.start,
                end: s.end,
            }),
            line: a.line,
            col: a.col,
            type_node: a.type_node.clone(),
        })
        .collect()
}

// ============================================================================
// Scope-Aware Import Lookup
// ============================================================================

/// Look up an import target by walking the scope chain.
///
/// This uses the same pattern as `lookup_symbol_kind_in_scope_chain` in analyzer.rs,
/// walking outward from the most specific scope to find the nearest matching import.
///
/// For Phase 11D, imports are recorded at module scope only, so this will typically
/// resolve at `["<module>"]`.
///
/// # Arguments
///
/// * `scope_path` - Current scope path to start the search from
/// * `name` - Name to look up
/// * `import_targets` - Map of import targets keyed by (scope_path, name)
///
/// # Returns
///
/// The import target if found, or None if the name is not an import.
pub fn lookup_import_target<'a>(
    scope_path: &[String],
    name: &str,
    import_targets: &'a HashMap<(Vec<String>, String), ImportTarget>,
) -> Option<&'a ImportTarget> {
    // Walk from most specific scope to least specific
    let mut current_scope = scope_path.to_vec();
    loop {
        if let Some(target) = import_targets.get(&(current_scope.clone(), name.to_string())) {
            return Some(target);
        }
        if current_scope.is_empty() {
            break;
        }
        current_scope.pop();
    }

    // Finally check module scope explicitly
    import_targets.get(&(vec!["<module>".to_string()], name.to_string()))
}

// ============================================================================
// Public Helper Functions
// ============================================================================

/// Build symbol kinds map from a FileAnalysis.
///
/// This is used when integrating with the analyzer's FileAnalysis structure.
pub fn build_symbol_kinds(analysis: &FileAnalysis) -> HashMap<(Vec<String>, String), SymbolKind> {
    // Build scope_map once for O(1) lookups (not per-symbol!)
    let scope_map = build_scope_map_index(&analysis.scopes);
    let mut map = HashMap::new();

    for symbol in &analysis.symbols {
        let scope_path = build_scope_path_with_index(symbol.scope_id, &scope_map);
        let key = (scope_path, symbol.name.clone());
        map.insert(key, symbol.kind);
    }

    map
}

/// Build symbol index map from a FileAnalysis.
pub fn build_symbol_map(analysis: &FileAnalysis) -> HashMap<(Vec<String>, String), usize> {
    // Build scope_map once for O(1) lookups (not per-symbol!)
    let scope_map = build_scope_map_index(&analysis.scopes);
    let mut map = HashMap::new();

    for (index, symbol) in analysis.symbols.iter().enumerate() {
        let scope_path = build_scope_path_with_index(symbol.scope_id, &scope_map);
        let key = (scope_path, symbol.name.clone());
        map.insert(key, index);
    }

    map
}

/// Build a scope ID -> Scope lookup map (O(n) once, not per-symbol).
fn build_scope_map_index(
    scopes: &[crate::analyzer::Scope],
) -> HashMap<crate::analyzer::ScopeId, &crate::analyzer::Scope> {
    scopes.iter().map(|s| (s.id, s)).collect()
}

/// Build scope path using a pre-built scope map (O(depth) per call).
///
/// Returns a Vec like `["<module>", "ClassName", "method_name"]`.
fn build_scope_path_with_index(
    scope_id: crate::analyzer::ScopeId,
    scope_map: &HashMap<crate::analyzer::ScopeId, &crate::analyzer::Scope>,
) -> Vec<String> {
    use tugtool_core::facts::ScopeKind;

    let mut path = Vec::new();
    let mut current_id = Some(scope_id);

    while let Some(id) = current_id {
        if let Some(scope) = scope_map.get(&id) {
            let name = match scope.kind {
                ScopeKind::Module => "<module>".to_string(),
                ScopeKind::Class | ScopeKind::Function => {
                    scope.name.clone().unwrap_or_else(|| "<anonymous>".to_string())
                }
                ScopeKind::Comprehension | ScopeKind::Lambda => {
                    // Skip anonymous scopes in path
                    current_id = scope.parent_id;
                    continue;
                }
                _ => {
                    // Handle any other scope kinds by skipping
                    current_id = scope.parent_id;
                    continue;
                }
            };
            path.push(name);
            current_id = scope.parent_id;
        } else {
            break;
        }
    }

    path.reverse();
    if path.is_empty() {
        path.push("<module>".to_string());
    }
    path
}

/// Build import targets map from a FileAnalysis.
///
/// This creates the scope-aware import targets map used for cross-file resolution.
pub fn build_import_targets(
    analysis: &FileAnalysis,
    workspace_files: &HashSet<String>,
    namespace_packages: &HashSet<String>,
    importing_file_path: &str,
) -> HashMap<(Vec<String>, String), ImportTarget> {
    let mut import_targets = HashMap::new();
    let module_scope = vec!["<module>".to_string()];

    for import in &analysis.imports {
        // Only process resolved imports
        let resolved_file = match &import.resolved_file {
            Some(path) => path.clone(),
            None => continue,
        };

        if import.kind == "from" {
            // from mod import Name [as Alias], ...
            for imported_name in &import.names {
                let mut file_path = PathBuf::from(&resolved_file);
                let mut imported_module = false;

                // Detect submodule imports: from pkg import mod
                let submodule_path = format!("{}.{}", import.module_path, imported_name.name);
                if let Some(ResolvedModule::File(member_file)) = resolve_module_to_file(
                    &submodule_path,
                    workspace_files,
                    namespace_packages,
                    Some(importing_file_path),
                    import.relative_level,
                ) {
                    imported_module = true;
                    file_path = PathBuf::from(member_file);
                }

                let local_name = imported_name
                    .alias
                    .as_ref()
                    .unwrap_or(&imported_name.name)
                    .clone();

                let key = (module_scope.clone(), local_name);
                let target = ImportTarget {
                    file_path,
                    kind: ImportTargetKind::FromImport {
                        imported_name: imported_name.name.clone(),
                        imported_module,
                    },
                };
                import_targets.insert(key, target);
            }
        } else {
            // import mod.sub [as Alias]
            let file_path = PathBuf::from(&resolved_file);
            let local_name = import
                .alias
                .clone()
                .unwrap_or_else(|| import.module_path.split('.').next().unwrap_or("").to_string());

            let key = (module_scope.clone(), local_name);
            let target = ImportTarget {
                file_path,
                kind: ImportTargetKind::ModuleImport,
            };
            import_targets.insert(key, target);
        }
    }

    import_targets
}

/// Build class hierarchies map from a FileAnalysis.
///
/// Note: This requires FileAnalysis to include class_hierarchies field,
/// which is wired in Step 4. For now, this returns an empty map.
pub fn build_class_hierarchies(
    _analysis: &FileAnalysis,
) -> HashMap<String, ClassHierarchyInfo> {
    // TODO: Wire class_hierarchies from FileAnalysis in Step 4
    // For now, return empty map as FileAnalysis doesn't have class_hierarchies yet
    HashMap::new()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_workspace() -> (HashSet<String>, HashSet<String>) {
        let workspace_files: HashSet<String> = [
            "handler.py",
            "service.py",
            "pkg/__init__.py",
            "pkg/worker.py",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        let namespace_packages = HashSet::new();
        (workspace_files, namespace_packages)
    }

    #[test]
    fn test_cache_creation() {
        let (workspace_files, namespace_packages) = create_test_workspace();
        let cache = CrossFileTypeCache::new(workspace_files.clone(), namespace_packages.clone());

        assert!(cache.is_empty());
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.workspace_files(), &workspace_files);
        assert_eq!(cache.namespace_packages(), &namespace_packages);
    }

    #[test]
    fn test_cache_with_custom_size() {
        let (workspace_files, namespace_packages) = create_test_workspace();
        let cache =
            CrossFileTypeCache::with_max_size(workspace_files, namespace_packages, 10);

        assert_eq!(cache.max_size, 10);
    }

    #[test]
    fn test_circular_import_detection() {
        let (workspace_files, namespace_packages) = create_test_workspace();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Simulate a file being "in progress"
        let test_path = PathBuf::from("test.py");
        cache.in_progress.insert(test_path.clone());

        // Attempting to analyze the same file should error
        let result = cache.get_or_analyze(&test_path, Path::new("."));
        assert!(matches!(result, Err(TypeResolutionError::CircularImport(_))));
    }

    #[test]
    fn test_fifo_eviction() {
        let (workspace_files, namespace_packages) = create_test_workspace();
        let mut cache = CrossFileTypeCache::with_max_size(workspace_files, namespace_packages, 2);

        // Manually insert contexts to test FIFO eviction
        let ctx1 = FileTypeContext {
            tracker: TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: HashMap::new(),
        };
        let ctx2 = FileTypeContext {
            tracker: TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: HashMap::new(),
        };
        let ctx3 = FileTypeContext {
            tracker: TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: HashMap::new(),
        };

        let path1 = PathBuf::from("file1.py");
        let path2 = PathBuf::from("file2.py");
        let path3 = PathBuf::from("file3.py");

        cache.contexts.insert(path1.clone(), ctx1);
        cache.access_order.push_back(path1.clone());

        cache.contexts.insert(path2.clone(), ctx2);
        cache.access_order.push_back(path2.clone());

        // Cache is now at max size (2)
        assert_eq!(cache.len(), 2);

        // Evict oldest and add new
        cache.evict_oldest();
        cache.contexts.insert(path3.clone(), ctx3);
        cache.access_order.push_back(path3.clone());

        // path1 should be evicted
        assert!(!cache.is_cached(&path1));
        assert!(cache.is_cached(&path2));
        assert!(cache.is_cached(&path3));
    }

    #[test]
    fn test_lookup_import_target_module_scope() {
        let mut import_targets = HashMap::new();

        let target = ImportTarget {
            file_path: PathBuf::from("handler.py"),
            kind: ImportTargetKind::FromImport {
                imported_name: "Handler".to_string(),
                imported_module: false,
            },
        };

        import_targets.insert(
            (vec!["<module>".to_string()], "Handler".to_string()),
            target,
        );

        // Look up from module scope
        let result = lookup_import_target(&["<module>".to_string()], "Handler", &import_targets);
        assert!(result.is_some());

        // Look up from nested scope (should fall back to module scope)
        let result = lookup_import_target(
            &["<module>".to_string(), "Service".to_string()],
            "Handler",
            &import_targets,
        );
        assert!(result.is_some());

        // Look up non-existent name
        let result = lookup_import_target(&["<module>".to_string()], "Missing", &import_targets);
        assert!(result.is_none());
    }

    #[test]
    fn test_lookup_import_target_scope_chain() {
        let mut import_targets = HashMap::new();

        // Module-level import
        let module_target = ImportTarget {
            file_path: PathBuf::from("module_handler.py"),
            kind: ImportTargetKind::FromImport {
                imported_name: "Handler".to_string(),
                imported_module: false,
            },
        };
        import_targets.insert(
            (vec!["<module>".to_string()], "Handler".to_string()),
            module_target,
        );

        // Look up from module scope - should find module-level
        let result = lookup_import_target(&["<module>".to_string()], "Handler", &import_targets);
        assert!(result.is_some());
        assert_eq!(
            result.unwrap().file_path,
            PathBuf::from("module_handler.py")
        );

        // For Phase 11D, function-level imports are not tracked,
        // so a nested scope lookup will find the module-level import
        let result = lookup_import_target(
            &[
                "<module>".to_string(),
                "Service".to_string(),
                "method".to_string(),
            ],
            "Handler",
            &import_targets,
        );
        assert!(result.is_some());
        assert_eq!(
            result.unwrap().file_path,
            PathBuf::from("module_handler.py")
        );
    }

    #[test]
    fn test_import_kind_module_import() {
        let mut import_targets = HashMap::new();

        let target = ImportTarget {
            file_path: PathBuf::from("pkg/mod.py"),
            kind: ImportTargetKind::ModuleImport,
        };
        import_targets.insert((vec!["<module>".to_string()], "mod".to_string()), target);

        let result = lookup_import_target(&["<module>".to_string()], "mod", &import_targets);
        assert!(result.is_some());
        assert!(matches!(result.unwrap().kind, ImportTargetKind::ModuleImport));
    }

    #[test]
    fn test_import_kind_submodule_from_import() {
        let mut import_targets = HashMap::new();

        let target = ImportTarget {
            file_path: PathBuf::from("pkg/mod.py"),
            kind: ImportTargetKind::FromImport {
                imported_name: "mod".to_string(),
                imported_module: true, // This is a submodule import
            },
        };
        import_targets.insert((vec!["<module>".to_string()], "mod".to_string()), target);

        let result = lookup_import_target(&["<module>".to_string()], "mod", &import_targets);
        assert!(result.is_some());

        match &result.unwrap().kind {
            ImportTargetKind::FromImport {
                imported_name,
                imported_module,
            } => {
                assert_eq!(imported_name, "mod");
                assert!(*imported_module);
            }
            _ => panic!("expected FromImport"),
        }
    }

    #[test]
    fn test_cache_clear() {
        let (workspace_files, namespace_packages) = create_test_workspace();
        let mut cache = CrossFileTypeCache::new(workspace_files, namespace_packages);

        // Add some contexts
        let ctx = FileTypeContext {
            tracker: TypeTracker::new(),
            symbol_kinds: HashMap::new(),
            symbol_map: HashMap::new(),
            import_targets: HashMap::new(),
            class_hierarchies: HashMap::new(),
        };
        cache.contexts.insert(PathBuf::from("test.py"), ctx);
        cache.access_order.push_back(PathBuf::from("test.py"));

        assert!(!cache.is_empty());

        cache.clear();

        assert!(cache.is_empty());
        assert!(cache.access_order.is_empty());
    }
}
