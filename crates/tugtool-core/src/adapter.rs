//! Language adapter trait and intermediate data types.
//!
//! This module defines the [`LanguageAdapter`] trait for pluggable language support,
//! along with the intermediate data types used to pass analysis results from
//! language-specific analyzers to the [`FactsStore`].
//!
//! # Architecture
//!
//! Language adapters produce analysis results using index-based references (not IDs).
//! The integration layer (CLI or caller) is responsible for:
//! 1. Calling `adapter.analyze_files()` to get adapter data types
//! 2. Converting adapter data types to FactsStore types (allocating IDs)
//! 3. Inserting into FactsStore via `insert_*()` methods
//!
//! # ID Ownership
//!
//! - **Adapters do NOT allocate IDs** (FileId, SymbolId, ScopeId, etc.)
//! - Adapters use local indices (`usize`) for cross-references within a file:
//!   - `scope_index`: Index into `FileAnalysisResult.scopes`
//!   - `symbol_index`: Index into `FileAnalysisResult.symbols`
//!   - `file_index`: Index into `AnalysisBundle.file_results`
//! - FactsStore owns all ID generation via `next_*_id()` methods
//!
//! # Cross-File Resolution
//!
//! The `store` parameter in `analyze_files` is **read-only context**. For single-pass
//! analysis, it is typically empty. Adapters build all cross-file state internally
//! (e.g., Python's multi-pass resolution). Future incremental analysis may pass
//! a pre-populated store for context.
//!
//! # Deterministic Ordering
//!
//! `AnalysisBundle.file_results` **must preserve input order** as passed to the
//! adapter. All index-based references depend on this ordering. If a caller needs
//! sorted output, it should sort the input file list before calling the adapter.
//!
//! # Usage Pattern
//!
//! The typical workflow for using a language adapter:
//!
//! 1. **Check file type**: Use `can_handle()` to determine if the adapter supports a file
//! 2. **Analyze files**: Call `analyze_files()` with source content
//! 3. **Convert to FactsStore**: The integration layer allocates IDs and inserts data
//!
//! ## Example: Integration Layer
//!
//! ```
//! use tugtool_core::adapter::{FileAnalysisResult, AnalysisBundle, SymbolData, ReferenceKind};
//! use tugtool_core::facts::{FactsStore, File, Language, ScopeKind, SymbolKind};
//! use tugtool_core::patch::{Span, ContentHash};
//!
//! // Integration layer receives adapter output and populates FactsStore
//! fn populate_facts_store(bundle: &AnalysisBundle, store: &mut FactsStore) {
//!     for (_file_index, file_result) in bundle.file_results.iter().enumerate() {
//!         // 1. Create and register file
//!         let file_id = store.next_file_id();
//!         let content_hash = ContentHash::compute(b"");  // Compute hash from content
//!         let file = File::new(
//!             file_id,
//!             &file_result.path,
//!             content_hash,
//!             Language::Python,
//!         );
//!         store.insert_file(file);
//!
//!         // 2. Build index mapping: adapter index -> FactsStore ID
//!         let mut symbol_id_map = Vec::new();
//!
//!         // 3. Insert symbols (allocate IDs via store.next_symbol_id())
//!         for _symbol_data in &file_result.symbols {
//!             let symbol_id = store.next_symbol_id();
//!             symbol_id_map.push(symbol_id);
//!
//!             // Convert SymbolData to facts::Symbol using allocated IDs
//!             // ... (actual conversion would go here)
//!         }
//!
//!         // 4. Insert references, resolving symbol indices to IDs
//!         // ... (reference insertion would go here)
//!     }
//! }
//!
//! // Example usage
//! let bundle = AnalysisBundle::default();
//! let mut store = FactsStore::new();
//! populate_facts_store(&bundle, &mut store);
//! ```
//!
//! ## Example: Creating Analysis Data
//!
//! ```
//! use tugtool_core::adapter::{
//!     FileAnalysisResult, ScopeData, SymbolData, ReferenceData, ReferenceKind
//! };
//! use tugtool_core::facts::{ScopeKind, SymbolKind};
//! use tugtool_core::patch::Span;
//!
//! // Create a simple file analysis result
//! let mut result = FileAnalysisResult::default();
//! result.path = "example.py".to_string();
//!
//! // Add module scope (always index 0)
//! result.scopes.push(ScopeData {
//!     kind: ScopeKind::Module,
//!     span: Span::new(0, 100),
//!     parent_index: None,
//!     name: None,
//! });
//!
//! // Add a function symbol
//! result.symbols.push(SymbolData {
//!     kind: SymbolKind::Function,
//!     name: "process".to_string(),
//!     decl_span: Span::new(10, 17),
//!     scope_index: 0,  // in module scope
//!     visibility: None,
//! });
//!
//! // Add a reference to the function
//! result.references.push(ReferenceData {
//!     name: "process".to_string(),
//!     span: Span::new(50, 57),
//!     scope_index: 0,
//!     kind: ReferenceKind::Call,
//! });
//!
//! assert_eq!(result.scopes.len(), 1);
//! assert_eq!(result.symbols.len(), 1);
//! assert_eq!(result.references.len(), 1);
//! ```

use crate::facts::{
    AliasKind, AttributeAccessKind, ExportIntent, ExportKind, ExportOrigin, ExportTarget,
    FactsStore, ImportKind, Language, Modifier, ParamKind, ScopeKind, SymbolKind, TypeNode,
    TypeSource, Visibility,
};
use crate::patch::Span;

// ============================================================================
// Reference Kind (Adapter)
// ============================================================================

/// Reference kind for adapter output.
///
/// This enum mirrors `facts::ReferenceKind` but is defined separately to keep
/// adapters independent of FactsStore internals. The integration layer maps
/// between them using the following rules:
///
/// | Adapter `ReferenceKind` | FactsStore `ReferenceKind` |
/// |-------------------------|----------------------------|
/// | `Definition`            | `Definition`               |
/// | `Read`                  | `Reference`                |
/// | `Write`                 | `Write`                    |
/// | `Call`                  | `Call`                     |
/// | `Import`                | `Import`                   |
/// | `Attribute`             | `Attribute`                |
/// | `TypeAnnotation`        | `TypeAnnotation`           |
/// | `Delete`                | `Delete`                   |
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReferenceKind {
    /// The definition site itself.
    Definition,
    /// A simple name reference (read).
    Read,
    /// Assignment target (write).
    Write,
    /// A call to a function/method.
    Call,
    /// An import statement.
    Import,
    /// Attribute access (obj.attr).
    Attribute,
    /// Type annotation reference.
    TypeAnnotation,
    /// Delete expression (e.g., Python `del`).
    Delete,
}

// ============================================================================
// Single-File Analysis Data Types
// ============================================================================

/// Scope information from single-file analysis.
///
/// Represents a lexical scope (module, function, class, etc.) within a file.
/// Parent scopes are referenced by index into the same file's scope list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeData {
    /// Scope kind (Module, Function, Class, etc.)
    pub kind: ScopeKind,
    /// Byte span of the entire scope.
    pub span: Span,
    /// Parent scope index in the file's scope list (None for module scope).
    pub parent_index: Option<usize>,
    /// Name of the scope (function name, class name, None for module).
    pub name: Option<String>,
}

/// Symbol information from single-file analysis.
///
/// Represents a definition (function, class, variable, etc.) within a file.
/// The containing scope is referenced by index into the file's scope list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SymbolData {
    /// Symbol kind (Variable, Function, Class, etc.)
    pub kind: SymbolKind,
    /// Symbol name.
    pub name: String,
    /// Declaration span.
    pub decl_span: Span,
    /// Index of containing scope in the file's scope list.
    pub scope_index: usize,
    /// Inferred visibility (if applicable).
    pub visibility: Option<Visibility>,
}

/// Reference information from single-file analysis.
///
/// Represents a usage of a symbol (read, write, call, etc.) within a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceData {
    /// Name being referenced.
    pub name: String,
    /// Byte span of the reference.
    pub span: Span,
    /// Index of containing scope in the file's scope list.
    pub scope_index: usize,
    /// Kind of reference (read, write, call, etc.)
    pub kind: ReferenceKind,
}

/// Attribute access from single-file analysis.
///
/// Represents attribute reads, writes, or calls (e.g., `obj.attr`, `obj.method()`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttributeAccessData {
    /// Index of base symbol in the file's symbol list (if resolved).
    pub base_symbol_index: Option<usize>,
    /// Attribute name.
    pub name: String,
    /// Byte span of the attribute name.
    pub span: Span,
    /// Attribute access kind.
    pub kind: AttributeAccessKind,
}

/// Call argument from single-file analysis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallArgData {
    /// Argument name for keyword args, None for positional.
    pub name: Option<String>,
    /// Byte span of the argument expression.
    pub span: Span,
}

/// Call site from single-file analysis.
///
/// Represents a function/method call with its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallSiteData {
    /// Index of callee symbol in the file's symbol list (if resolved).
    pub callee_symbol_index: Option<usize>,
    /// Byte span of the call expression.
    pub span: Span,
    /// Call arguments.
    pub args: Vec<CallArgData>,
}

/// Alias edge from single-file analysis.
///
/// Represents an alias relationship between two symbols (e.g., `b = a`).
#[derive(Debug, Clone, PartialEq)]
pub struct AliasEdgeData {
    /// Index of alias symbol in the file's symbol list.
    pub alias_symbol_index: usize,
    /// Index of target symbol in the file's symbol list (if resolved).
    pub target_symbol_index: Option<usize>,
    /// Byte span of the aliasing expression.
    pub span: Span,
    /// Alias kind.
    pub kind: AliasKind,
    /// Confidence score (0.0-1.0), if available.
    pub confidence: Option<f32>,
}

/// Qualified name from single-file analysis.
///
/// Stores the fully-qualified name for a symbol (e.g., `pkg.module.ClassName.method`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QualifiedNameData {
    /// Index of symbol in the file's symbol list.
    pub symbol_index: usize,
    /// Fully-qualified name.
    pub path: String,
}

/// Parameter from single-file analysis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParameterData {
    /// Parameter name.
    pub name: String,
    /// Parameter kind (Regular, VarArgs, KwArgs, etc.)
    pub kind: ParamKind,
    /// Byte span of default value (if present).
    pub default_span: Option<Span>,
    /// Type annotation (if present).
    pub annotation: Option<TypeNode>,
}

/// Signature from single-file analysis.
///
/// Represents a function/method signature with parameters and return type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignatureData {
    /// Index of symbol in the file's symbol list.
    pub symbol_index: usize,
    /// Parameters.
    pub params: Vec<ParameterData>,
    /// Optional return type.
    pub returns: Option<TypeNode>,
}

/// Type parameter from single-file analysis.
///
/// Represents a generic type parameter (e.g., `T` in `def foo[T](x: T) -> T`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeParamData {
    /// Type parameter name.
    pub name: String,
    /// Type bounds (e.g., `T: Bound`).
    pub bounds: Vec<TypeNode>,
    /// Default type (if present).
    pub default: Option<TypeNode>,
}

/// Modifiers from single-file analysis.
///
/// Associates semantic modifiers (async, static, property, etc.) with a symbol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModifierData {
    /// Index of symbol in the file's symbol list.
    pub symbol_index: usize,
    /// Modifiers applied to the symbol.
    pub modifiers: Vec<Modifier>,
}

/// Import information from single-file analysis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportData {
    /// The module path being imported (e.g., "os.path").
    pub module_path: String,
    /// Imported name (None for `import module`).
    pub imported_name: Option<String>,
    /// Local alias (e.g., `as alias`).
    pub alias: Option<String>,
    /// Import kind classification.
    pub kind: ImportKind,
    /// Byte span of the import statement.
    pub span: Span,
}

/// Export information from single-file analysis.
///
/// Represents a public export declaration (e.g., Python `__all__`, Rust `pub use`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportData {
    /// Exported name (None for glob exports).
    pub exported_name: Option<String>,
    /// Source name (None for glob exports or implicit).
    pub source_name: Option<String>,
    /// Span of the export declaration.
    pub decl_span: Span,
    /// Span of exported name (alias or `__all__` string content).
    pub exported_name_span: Option<Span>,
    /// Span of source/original name.
    pub source_name_span: Option<Span>,
    /// Export mechanism.
    pub export_kind: ExportKind,
    /// Export target classification.
    pub export_target: ExportTarget,
    /// Declared vs effective export.
    pub export_intent: ExportIntent,
    /// Origin classification.
    pub export_origin: ExportOrigin,
    /// Origin module path (optional, for re-export chains).
    pub origin_module_path: Option<String>,
}

// ============================================================================
// Multi-File Analysis Data Types
// ============================================================================

/// Type information from analysis.
///
/// Collected at the bundle level rather than per-file because type resolution
/// may require cross-file context.
///
/// # Index Semantics
///
/// - `file_index`: Index into `AnalysisBundle.file_results` array
/// - `symbol_index`: Index into `FileAnalysisResult.symbols` for that file
///
/// The integration layer uses these indices to resolve actual IDs after
/// allocating FileId/SymbolId for each entry.
///
/// # Invalid Index Handling
///
/// If `file_index` or `symbol_index` is out of bounds during integration:
/// - Log a warning with the invalid index and type_repr for debugging
/// - Skip the TypeInfoData entry (do not insert into FactsStore)
/// - Continue processing remaining entries
///
/// This graceful degradation ensures partial analysis results are still usable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeInfoData {
    /// Index into `AnalysisBundle.file_results` for the file containing this symbol.
    pub file_index: usize,
    /// Index into that file's `symbols` array for the symbol this type applies to.
    pub symbol_index: usize,
    /// String representation of the type.
    pub type_repr: String,
    /// Source of type information.
    pub source: TypeSource,
    /// Optional structured type representation.
    pub structured: Option<TypeNode>,
}

/// Module resolution info from analysis.
///
/// Maps a module path (e.g., "pkg.sub") to the file indices that implement it.
/// Supports namespace packages where multiple directories contribute to a module.
///
/// # Invalid Index Handling
///
/// If any `file_indices` entry is out of bounds during integration:
/// - Log a warning with the module_path and invalid index
/// - Drop the invalid index and continue
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModuleResolutionData {
    /// Module path (e.g., "pkg.sub").
    pub module_path: String,
    /// File indices that implement this module.
    pub file_indices: Vec<usize>,
}

// ============================================================================
// Analysis Results
// ============================================================================

/// Result of single-file analysis.
///
/// Contains all analysis data for a single source file. Cross-references use
/// indices into the vectors in this struct.
///
/// # No FileId
///
/// Adapters do not allocate IDs. The integration layer assigns FileId after
/// receiving results. Use the index into `AnalysisBundle.file_results` as the
/// file identifier within adapter data.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct FileAnalysisResult {
    /// Path to the analyzed file (used for ID allocation and error reporting).
    pub path: String,
    /// Scopes in this file.
    pub scopes: Vec<ScopeData>,
    /// Symbols (definitions) in this file.
    pub symbols: Vec<SymbolData>,
    /// References (usages) in this file.
    pub references: Vec<ReferenceData>,
    /// Attribute accesses in this file.
    pub attributes: Vec<AttributeAccessData>,
    /// Call sites in this file.
    pub calls: Vec<CallSiteData>,
    /// Alias edges in this file.
    pub aliases: Vec<AliasEdgeData>,
    /// Qualified names for symbols in this file.
    pub qualified_names: Vec<QualifiedNameData>,
    /// Signatures for functions/methods in this file.
    pub signatures: Vec<SignatureData>,
    /// Type parameters for generic functions/classes in this file.
    pub type_params: Vec<TypeParamData>,
    /// Modifiers for symbols in this file.
    pub modifiers: Vec<ModifierData>,
    /// Imports in this file.
    pub imports: Vec<ImportData>,
    /// Exports in this file.
    pub exports: Vec<ExportData>,
}

/// Bundle of multi-file analysis results.
///
/// Contains analysis results for all files plus cross-file data like module
/// resolution and type information.
///
/// # Ordering
///
/// `file_results` **must preserve the input order** passed to the adapter.
/// All index-based references depend on this ordering. If a caller reorders
/// `file_results`, it must remap all index-based references.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AnalysisBundle {
    /// Analysis results for each file, in input order.
    pub file_results: Vec<FileAnalysisResult>,
    /// Files that failed analysis with error messages.
    pub failed_files: Vec<(String, String)>,
    /// Module resolution map across files.
    pub modules: Vec<ModuleResolutionData>,
    /// Type information collected across all files.
    ///
    /// Stored at bundle level because type resolution may require cross-file
    /// context. The integration layer converts these to `TypeInfo` entries
    /// in `FactsStore`.
    pub types: Vec<TypeInfoData>,
}

// ============================================================================
// Language Adapter Trait
// ============================================================================

/// Trait for language-specific analysis adapters.
///
/// Each supported language implements this trait to provide:
/// - Single-file analysis (scopes, symbols, references)
/// - Multi-file analysis with cross-file resolution
/// - Symbol lookup at positions
/// - Export collection
///
/// # ID Ownership
///
/// Adapters do NOT allocate any IDs (FileId, SymbolId, etc.). All cross-references
/// within adapter data use indices:
/// - `scope_index`: Index into `FileAnalysisResult.scopes`
/// - `symbol_index`: Index into `FileAnalysisResult.symbols`
/// - `file_index`: Index into `AnalysisBundle.file_results`
///
/// The integration layer allocates IDs and converts adapter data to FactsStore types.
///
/// # FactsStore Usage
///
/// The `store` parameter is read-only context. For Phase 11, it is typically empty.
/// Adapters must not assume it contains prior data. They should build all cross-file
/// state internally (e.g., Python's multi-pass resolution).
///
/// # Ordering
///
/// `file_results` preserves the input order passed to the adapter. If a caller
/// reorders `file_results`, it must remap all index-based references.
///
/// # Example Implementation
///
/// ```ignore
/// use tugtool_core::adapter::{LanguageAdapter, FileAnalysisResult, AnalysisBundle};
/// use tugtool_core::facts::{FactsStore, Language};
///
/// pub struct PythonAdapter;
///
/// impl LanguageAdapter for PythonAdapter {
///     type Error = std::io::Error;
///
///     fn analyze_file(&self, path: &str, content: &str)
///         -> Result<FileAnalysisResult, Self::Error>
///     {
///         // Parse Python source and extract facts
///         let mut result = FileAnalysisResult::default();
///         result.path = path.to_string();
///         // ... populate scopes, symbols, references, etc.
///         Ok(result)
///     }
///
///     fn analyze_files(&self, files: &[(String, String)], _store: &FactsStore)
///         -> Result<AnalysisBundle, Self::Error>
///     {
///         let mut bundle = AnalysisBundle::default();
///         for (path, content) in files {
///             match self.analyze_file(path, content) {
///                 Ok(result) => bundle.file_results.push(result),
///                 Err(e) => bundle.failed_files.push((path.clone(), e.to_string())),
///             }
///         }
///         // ... perform cross-file resolution, build module map
///         Ok(bundle)
///     }
///
///     fn language(&self) -> Language {
///         Language::Python
///     }
///
///     fn can_handle(&self, path: &str) -> bool {
///         path.ends_with(".py")
///     }
/// }
/// ```
pub trait LanguageAdapter {
    /// The error type for this adapter.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Analyze a single file and return local analysis results.
    ///
    /// This method analyzes a file in isolation, without cross-file context.
    /// Use `analyze_files` for multi-file analysis with resolution.
    ///
    /// # Arguments
    ///
    /// * `path` - Path to the file (for error messages and result tracking)
    /// * `content` - Source code content
    ///
    /// # Returns
    ///
    /// Analysis results with scopes, symbols, references, and other facts.
    /// Cross-references use indices into the result vectors.
    fn analyze_file(&self, path: &str, content: &str) -> Result<FileAnalysisResult, Self::Error>;

    /// Analyze multiple files with cross-file resolution.
    ///
    /// This method performs full analysis with cross-file name resolution,
    /// type inference, and alias tracking. The `store` parameter is read-only
    /// context (typically empty for fresh analysis).
    ///
    /// # Arguments
    ///
    /// * `files` - List of (path, content) pairs to analyze
    /// * `store` - Read-only FactsStore for context (typically empty)
    ///
    /// # Returns
    ///
    /// Analysis bundle with per-file results and cross-file data.
    /// `file_results` preserves the input order.
    fn analyze_files(
        &self,
        files: &[(String, String)],
        store: &FactsStore,
    ) -> Result<AnalysisBundle, Self::Error>;

    /// Get the language this adapter supports.
    fn language(&self) -> Language;

    /// Check if this adapter can handle a file.
    ///
    /// Typically checks the file extension, but may also examine content
    /// for shebangs or other markers.
    fn can_handle(&self, path: &str) -> bool;
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_reference_kind_has_all_variants() {
        // Verify all adapter ReferenceKind variants exist
        let kinds = [
            ReferenceKind::Definition,
            ReferenceKind::Read,
            ReferenceKind::Write,
            ReferenceKind::Call,
            ReferenceKind::Import,
            ReferenceKind::Attribute,
            ReferenceKind::TypeAnnotation,
            ReferenceKind::Delete,
        ];
        assert_eq!(kinds.len(), 8);
    }

    #[test]
    fn file_analysis_result_default_is_empty() {
        let result = FileAnalysisResult::default();
        assert!(result.path.is_empty());
        assert!(result.scopes.is_empty());
        assert!(result.symbols.is_empty());
        assert!(result.references.is_empty());
        assert!(result.attributes.is_empty());
        assert!(result.calls.is_empty());
        assert!(result.aliases.is_empty());
        assert!(result.qualified_names.is_empty());
        assert!(result.signatures.is_empty());
        assert!(result.type_params.is_empty());
        assert!(result.modifiers.is_empty());
        assert!(result.imports.is_empty());
        assert!(result.exports.is_empty());
    }

    #[test]
    fn analysis_bundle_default_is_empty() {
        let bundle = AnalysisBundle::default();
        assert!(bundle.file_results.is_empty());
        assert!(bundle.failed_files.is_empty());
        assert!(bundle.modules.is_empty());
        assert!(bundle.types.is_empty());
    }

    #[test]
    fn scope_data_can_be_constructed() {
        let scope = ScopeData {
            kind: ScopeKind::Function,
            span: Span::new(0, 100),
            parent_index: Some(0),
            name: Some("my_function".to_string()),
        };
        assert_eq!(scope.kind, ScopeKind::Function);
        assert_eq!(scope.name, Some("my_function".to_string()));
    }

    #[test]
    fn symbol_data_can_be_constructed() {
        let symbol = SymbolData {
            kind: SymbolKind::Function,
            name: "foo".to_string(),
            decl_span: Span::new(10, 20),
            scope_index: 0,
            visibility: Some(Visibility::Public),
        };
        assert_eq!(symbol.name, "foo");
        assert_eq!(symbol.visibility, Some(Visibility::Public));
    }

    #[test]
    fn reference_data_can_be_constructed() {
        let reference = ReferenceData {
            name: "foo".to_string(),
            span: Span::new(50, 53),
            scope_index: 1,
            kind: ReferenceKind::Call,
        };
        assert_eq!(reference.kind, ReferenceKind::Call);
    }

    #[test]
    fn import_data_can_be_constructed() {
        let import = ImportData {
            module_path: "os.path".to_string(),
            imported_name: Some("join".to_string()),
            alias: Some("pjoin".to_string()),
            kind: ImportKind::Alias,
            span: Span::new(0, 30),
        };
        assert_eq!(import.kind, ImportKind::Alias);
        assert_eq!(import.alias, Some("pjoin".to_string()));
    }

    #[test]
    fn export_data_can_be_constructed() {
        let export = ExportData {
            exported_name: Some("Foo".to_string()),
            source_name: Some("Foo".to_string()),
            decl_span: Span::new(100, 110),
            exported_name_span: Some(Span::new(101, 104)),
            source_name_span: Some(Span::new(101, 104)),
            export_kind: ExportKind::PythonAll,
            export_target: ExportTarget::Single,
            export_intent: ExportIntent::Declared,
            export_origin: ExportOrigin::Local,
            origin_module_path: None,
        };
        assert_eq!(export.export_kind, ExportKind::PythonAll);
        assert_eq!(export.export_target, ExportTarget::Single);
    }

    #[test]
    fn type_info_data_can_be_constructed() {
        let type_info = TypeInfoData {
            file_index: 0,
            symbol_index: 5,
            type_repr: "List[int]".to_string(),
            source: TypeSource::Annotated,
            structured: Some(TypeNode::Named {
                name: "List".to_string(),
                args: vec![TypeNode::Named {
                    name: "int".to_string(),
                    args: vec![],
                }],
            }),
        };
        assert_eq!(type_info.type_repr, "List[int]");
        assert!(type_info.structured.is_some());
    }

    #[test]
    fn module_resolution_data_can_be_constructed() {
        let resolution = ModuleResolutionData {
            module_path: "pkg.sub".to_string(),
            file_indices: vec![0, 2],
        };
        assert_eq!(resolution.file_indices.len(), 2);
    }

    #[test]
    fn alias_edge_data_can_be_constructed() {
        let alias = AliasEdgeData {
            alias_symbol_index: 3,
            target_symbol_index: Some(1),
            span: Span::new(20, 30),
            kind: AliasKind::Assignment,
            confidence: Some(0.95),
        };
        assert_eq!(alias.kind, AliasKind::Assignment);
        assert_eq!(alias.confidence, Some(0.95));
    }

    #[test]
    fn signature_data_can_be_constructed() {
        let sig = SignatureData {
            symbol_index: 2,
            params: vec![ParameterData {
                name: "x".to_string(),
                kind: ParamKind::Regular,
                default_span: None,
                annotation: Some(TypeNode::Named {
                    name: "int".to_string(),
                    args: vec![],
                }),
            }],
            returns: Some(TypeNode::Named {
                name: "str".to_string(),
                args: vec![],
            }),
        };
        assert_eq!(sig.params.len(), 1);
        assert!(sig.returns.is_some());
    }

    #[test]
    fn call_site_data_can_be_constructed() {
        let call = CallSiteData {
            callee_symbol_index: Some(5),
            span: Span::new(100, 120),
            args: vec![
                CallArgData {
                    name: None,
                    span: Span::new(105, 108),
                },
                CallArgData {
                    name: Some("key".to_string()),
                    span: Span::new(110, 118),
                },
            ],
        };
        assert_eq!(call.args.len(), 2);
        assert_eq!(call.args[1].name, Some("key".to_string()));
    }

    #[test]
    fn attribute_access_data_can_be_constructed() {
        let attr = AttributeAccessData {
            base_symbol_index: Some(0),
            name: "method".to_string(),
            span: Span::new(50, 56),
            kind: AttributeAccessKind::Call,
        };
        assert_eq!(attr.kind, AttributeAccessKind::Call);
    }

    #[test]
    fn qualified_name_data_can_be_constructed() {
        let qn = QualifiedNameData {
            symbol_index: 3,
            path: "pkg.module.ClassName.method".to_string(),
        };
        assert!(qn.path.contains("ClassName"));
    }

    #[test]
    fn modifier_data_can_be_constructed() {
        let mods = ModifierData {
            symbol_index: 1,
            modifiers: vec![Modifier::Async, Modifier::Static],
        };
        assert_eq!(mods.modifiers.len(), 2);
    }

    #[test]
    fn type_param_data_can_be_constructed() {
        let tp = TypeParamData {
            name: "T".to_string(),
            bounds: vec![TypeNode::Named {
                name: "Comparable".to_string(),
                args: vec![],
            }],
            default: None,
        };
        assert_eq!(tp.name, "T");
        assert_eq!(tp.bounds.len(), 1);
    }

    // Test that the trait compiles correctly by defining a mock implementation
    struct MockAdapter;

    impl LanguageAdapter for MockAdapter {
        type Error = std::io::Error;

        fn analyze_file(
            &self,
            path: &str,
            _content: &str,
        ) -> Result<FileAnalysisResult, Self::Error> {
            let mut result = FileAnalysisResult::default();
            result.path = path.to_string();
            Ok(result)
        }

        fn analyze_files(
            &self,
            files: &[(String, String)],
            _store: &FactsStore,
        ) -> Result<AnalysisBundle, Self::Error> {
            let mut bundle = AnalysisBundle::default();
            for (path, content) in files {
                match self.analyze_file(path, content) {
                    Ok(result) => bundle.file_results.push(result),
                    Err(e) => bundle.failed_files.push((path.clone(), e.to_string())),
                }
            }
            Ok(bundle)
        }

        fn language(&self) -> Language {
            Language::Python
        }

        fn can_handle(&self, path: &str) -> bool {
            path.ends_with(".py")
        }
    }

    #[test]
    fn mock_adapter_can_handle_py_files() {
        let adapter = MockAdapter;
        assert!(adapter.can_handle("test.py"));
        assert!(!adapter.can_handle("test.rs"));
    }

    #[test]
    fn mock_adapter_language_is_python() {
        let adapter = MockAdapter;
        assert_eq!(adapter.language(), Language::Python);
    }

    #[test]
    fn mock_adapter_analyze_file_sets_path() {
        let adapter = MockAdapter;
        let result = adapter.analyze_file("test.py", "x = 1").unwrap();
        assert_eq!(result.path, "test.py");
    }

    #[test]
    fn file_results_preserves_input_order() {
        // Per [D15]: file_results must preserve input order
        let adapter = MockAdapter;
        let files = vec![
            ("b.py".to_string(), "x = 1".to_string()),
            ("a.py".to_string(), "y = 2".to_string()),
            ("c.py".to_string(), "z = 3".to_string()),
        ];
        let store = FactsStore::new();
        let bundle = adapter.analyze_files(&files, &store).unwrap();

        // Order must match input, not sorted alphabetically
        assert_eq!(bundle.file_results[0].path, "b.py");
        assert_eq!(bundle.file_results[1].path, "a.py");
        assert_eq!(bundle.file_results[2].path, "c.py");
    }
}
