//! Python rename_symbol operation.
//!
//! This module implements the rename_symbol refactoring for Python:
//!
//! 1. Resolve target to SymbolId (from path:line:col or symbol name)
//! 2. Collect all references via analyzer
//! 3. Generate PatchSet with one edit per reference
//! 4. Apply in SandboxCopy mode
//! 5. Verify with `python -m compileall`
//!
//! Per Table T05, v1 covers:
//! - Local variables (scope chain lookup)
//! - Functions/classes at module level (binding + import tracking)
//! - Method calls via self.method() (syntactic pattern)
//!
//! # Backends
//!
//! The rename operation supports two backends:
//!
//! - **Native CST** (`native-cst` feature, default): Uses tugtool-cst for pure Rust
//!   reference collection and transformation with zero Python dependencies.
//! - **Python Worker** (`python-worker` feature): Uses LibCST via Python subprocess
//!   for analysis and transformation.
//!
//! When the `native-cst` feature is enabled, use [`native::run_native`] and
//! [`native::analyze_impact_native`] for zero-dependency operations. The
//! [`PythonRenameOp`] struct provides the Python worker-based implementation.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tempfile::TempDir;
use thiserror::Error;

use tugtool_core::diff::generate_unified_diff;
use tugtool_core::facts::{FactsStore, ReferenceKind};
use tugtool_core::output::{Location, ReferenceInfo, SymbolInfo};
use tugtool_core::patch::{FileId, MaterializedPatch, OutputEdit, Span};
use tugtool_core::session::Session;
use tugtool_core::text::byte_offset_to_position_str;
use tugtool_core::util::{generate_snapshot_id, generate_undo_token};

use crate::analyzer::PythonAdapter;
use crate::dynamic::{collect_dynamic_warnings, DynamicMode, DynamicWarning};
use crate::files::{read_file, FileError};
use crate::lookup::{find_symbol_at_location, symbol_to_info, LookupError};
use crate::ops::PythonOpContext;
use crate::validation::{validate_python_identifier, ValidationError};
use crate::verification::{
    run_verification, VerificationError, VerificationMode, VerificationResult, VerificationStatus,
};
use crate::worker::{spawn_worker, WorkerError};

// Native CST bridge for feature-gated rename
#[cfg(feature = "native-cst")]
use crate::cst_bridge;

// Native analyze_files for multi-file analysis
#[cfg(feature = "native-cst")]
use crate::analyzer::analyze_files;

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during rename operations.
#[derive(Debug, Error)]
pub enum RenameError {
    /// Symbol not found at the given location.
    #[error("no symbol found at {file}:{line}:{col}")]
    SymbolNotFound { file: String, line: u32, col: u32 },

    /// Multiple symbols match at the location.
    #[error("ambiguous symbol, candidates: {}", candidates.join(", "))]
    AmbiguousSymbol { candidates: Vec<String> },

    /// Invalid new name (syntax error).
    #[error("invalid name: {0}")]
    InvalidName(#[from] ValidationError),

    /// Verification failed.
    #[error("verification failed ({status:?}): {output}")]
    VerificationFailed {
        status: VerificationStatus,
        output: String,
    },

    /// Worker error.
    #[error("worker error: {0}")]
    Worker(#[from] WorkerError),

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] io::Error),

    /// File error.
    #[error("file error: {0}")]
    File(#[from] FileError),

    /// Lookup error.
    #[error("{0}")]
    Lookup(#[from] LookupError),

    /// Analyzer error.
    #[error("analyzer error: {message}")]
    AnalyzerError { message: String },

    /// Analysis failed for some files (strict policy - cannot rename).
    #[error("cannot perform rename: {count} file(s) failed analysis: {}", files.join(", "))]
    AnalysisFailed { count: usize, files: Vec<String> },

    /// Native CST error.
    #[cfg(feature = "native-cst")]
    #[error("native CST error: {0}")]
    NativeCst(#[from] crate::cst_bridge::CstBridgeError),
}

impl From<VerificationError> for RenameError {
    fn from(e: VerificationError) -> Self {
        match e {
            VerificationError::Failed { status, output } => {
                RenameError::VerificationFailed { status, output }
            }
            VerificationError::Io(e) => RenameError::Io(e),
        }
    }
}

/// Result type for rename operations.
pub type RenameResult<T> = Result<T, RenameError>;

// ============================================================================
// Types
// ============================================================================

// Note: Location, Symbol, and Reference are now imported from tugtool_core::output
// per the 26.0.7 JSON Output Schema specification (Type consolidation Option A).
// The types were migrated to provide a single source of truth for output types.

// Helper function symbol_to_info is now in crate::lookup

/// Impact analysis result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactAnalysis {
    /// Status.
    pub status: String,
    /// Schema version.
    pub schema_version: String,
    /// Snapshot ID.
    pub snapshot_id: String,
    /// Target symbol (uses output::SymbolInfo per 26.0.7 spec).
    pub symbol: SymbolInfo,
    /// All references (uses output::ReferenceInfo per 26.0.7 spec).
    pub references: Vec<ReferenceInfo>,
    /// Impact summary.
    pub impact: ImpactSummary,
    /// Warnings (structured per Spec S11).
    pub warnings: Vec<DynamicWarning>,
}

/// Impact summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImpactSummary {
    /// Number of files affected.
    pub files_affected: usize,
    /// Number of references.
    pub references_count: usize,
    /// Estimated number of edits.
    pub edits_estimated: usize,
}

/// Rename result (after running the operation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameOutput {
    /// Status.
    pub status: String,
    /// Schema version.
    pub schema_version: String,
    /// Snapshot ID.
    pub snapshot_id: String,
    /// Patch information (uses shared types from patch.rs).
    pub patch: MaterializedPatch,
    /// Summary.
    pub summary: RenameSummary,
    /// Verification result.
    pub verification: VerificationResult,
    /// Warnings (structured per Spec S11).
    pub warnings: Vec<DynamicWarning>,
    /// Undo token.
    pub undo_token: String,
    /// Whether changes were applied (present when --apply used).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied: Option<bool>,
    /// Files that were modified (present when --apply used).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_written: Option<Vec<String>>,
}

/// Rename summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameSummary {
    /// Number of files changed.
    pub files_changed: usize,
    /// Number of edits.
    pub edits_count: usize,
    /// Bytes added.
    pub bytes_added: i64,
    /// Bytes removed.
    pub bytes_removed: i64,
}

// ============================================================================
// Rename Operation
// ============================================================================

/// Python rename operation.
///
/// Uses `PythonOpContext` for shared configuration and utilities.
pub struct PythonRenameOp {
    /// Shared operation context.
    ctx: PythonOpContext,
}

impl PythonRenameOp {
    /// Create a new rename operation.
    pub fn new(
        workspace_root: impl Into<PathBuf>,
        python_path: impl Into<PathBuf>,
        session_dir: impl Into<PathBuf>,
    ) -> Self {
        PythonRenameOp {
            ctx: PythonOpContext::new(workspace_root, python_path, session_dir),
        }
    }

    /// Create a rename operation using a Session.
    ///
    /// This integrates with the Step 2 Session infrastructure, extracting
    /// the workspace root and session directory from the Session.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let session = Session::open(workspace_path, SessionOptions::default())?;
    /// let python = which::which("python3")?;
    /// let op = PythonRenameOp::with_session(&session, python);
    /// ```
    pub fn with_session(session: &Session, python_path: impl Into<PathBuf>) -> Self {
        PythonRenameOp {
            ctx: PythonOpContext::from_session(session, python_path),
        }
    }

    /// Create a rename operation from an existing context.
    pub fn with_context(ctx: PythonOpContext) -> Self {
        PythonRenameOp { ctx }
    }

    /// Analyze the impact of renaming a symbol.
    pub fn analyze_impact(
        &self,
        location: &Location,
        new_name: &str,
    ) -> RenameResult<ImpactAnalysis> {
        // Validate new name
        validate_python_identifier(new_name)?;

        // Spawn worker
        let mut worker = spawn_worker(&self.ctx.python_path, &self.ctx.session_dir)?;

        // Collect Python files in workspace
        let files = self.ctx.collect_python_files()?;

        // Build FactsStore via analyzer
        let adapter = PythonAdapter::new(self.ctx.workspace_root.to_string_lossy());
        let mut store = FactsStore::new();
        adapter
            .analyze_files(&mut worker, &files, &mut store)
            .map_err(|e| RenameError::AnalyzerError {
                message: e.to_string(),
            })?;

        // Find symbol at location
        let symbol = find_symbol_at_location(&store, location, &files)?;

        // Collect all edits needed: (file_id, span, kind)
        // This includes:
        // 1. The target symbol's definition
        // 2. All references to the target symbol
        // 3. Override method definitions (in child classes)
        // 4. All references to override methods
        let mut all_edits: Vec<(FileId, Span, ReferenceKind)> = Vec::new();

        // Add the target symbol's definition
        all_edits.push((
            symbol.decl_file_id,
            symbol.decl_span,
            ReferenceKind::Definition,
        ));

        // Add references to the target symbol
        for reference in store.refs_of_symbol(symbol.symbol_id) {
            all_edits.push((reference.file_id, reference.span, reference.ref_kind));
        }

        // For methods, also collect override methods and their references
        // When renaming a base class method, child class overrides must be renamed too
        let override_ids = adapter.find_override_methods(&store, &symbol);
        for override_id in &override_ids {
            // Add the override method's definition
            if let Some(override_sym) = store.symbol(*override_id) {
                all_edits.push((
                    override_sym.decl_file_id,
                    override_sym.decl_span,
                    ReferenceKind::Definition,
                ));
            }
            // Add all references to the override method
            for reference in store.refs_of_symbol(*override_id) {
                all_edits.push((reference.file_id, reference.span, reference.ref_kind));
            }
        }

        // For methods in inheritance hierarchies, also include untyped method calls
        // that match the method name. This handles cases like:
        //   for handler in handlers:
        //       handler.process_request(...)  # handler has unknown type
        // When the method is part of an inheritance tree, we conservatively include
        // all calls with matching method name where receiver type is unknown.
        if !override_ids.is_empty() {
            // This is a base class method with overrides - include untyped calls
            let method_name = &symbol.name;
            for (path, content) in &files {
                // Get file analysis with method calls
                let parse_resp =
                    worker
                        .parse(path, content)
                        .map_err(|e| RenameError::AnalyzerError {
                            message: e.to_string(),
                        })?;
                let combined = worker.get_analysis(&parse_resp.cst_id).map_err(|e| {
                    RenameError::AnalyzerError {
                        message: e.to_string(),
                    }
                })?;

                // For each method call with matching name, check if we should include it
                for method_call in &combined.method_calls {
                    if &method_call.method == method_name {
                        // Check if this span is already included
                        if let Some(ref span) = method_call.method_span {
                            let file = store.file_by_path(path);
                            if let Some(f) = file {
                                let file_id = f.file_id;
                                let sp = tugtool_core::patch::Span::new(
                                    span.start as u64,
                                    span.end as u64,
                                );
                                // Only add if not already present (untyped call)
                                let key = (file_id, sp.start, sp.end);
                                if !all_edits
                                    .iter()
                                    .any(|(fid, s, _)| (*fid, s.start, s.end) == key)
                                {
                                    all_edits.push((file_id, sp, ReferenceKind::Call));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Deduplicate edits by (file_id, span)
        let mut seen_spans: HashSet<(FileId, u64, u64)> = HashSet::new();
        all_edits.retain(|(file_id, span, _)| seen_spans.insert((*file_id, span.start, span.end)));

        // Build reference info
        let mut references = Vec::new();
        let mut files_affected = std::collections::HashSet::new();

        for (file_id, span, kind) in &all_edits {
            let file = store
                .file(*file_id)
                .ok_or_else(|| RenameError::AnalyzerError {
                    message: format!("file not found: {:?}", file_id),
                })?;
            files_affected.insert(&file.path);

            // Get file content and build reference info
            let content = read_file(&self.ctx.workspace_root, &file.path)?;
            let (line, col) = tugtool_core::text::byte_offset_to_position_str(&content, span.start);
            references.push(ReferenceInfo {
                location: Location {
                    file: file.path.clone(),
                    line,
                    col,
                    byte_start: Some(span.start),
                    byte_end: Some(span.end),
                },
                kind: format!("{:?}", kind).to_lowercase(),
            });
        }

        // Build symbol info
        let decl_file =
            store
                .file(symbol.decl_file_id)
                .ok_or_else(|| RenameError::AnalyzerError {
                    message: "declaration file not found".to_string(),
                })?;
        let decl_content = read_file(&self.ctx.workspace_root, &decl_file.path)?;
        let symbol_info = symbol_to_info(&symbol, decl_file, &decl_content);

        // Collect dynamic pattern warnings (preserved as structured per Spec S11)
        let file_paths: Vec<PathBuf> = files.iter().map(|(p, _)| PathBuf::from(p)).collect();
        let warnings =
            collect_dynamic_warnings(&mut worker, &file_paths, &symbol.name, DynamicMode::Safe)?;

        // Generate snapshot ID
        let snapshot_id = generate_snapshot_id();

        Ok(ImpactAnalysis {
            status: "ok".to_string(),
            schema_version: "1".to_string(),
            snapshot_id,
            symbol: symbol_info,
            references,
            impact: ImpactSummary {
                files_affected: files_affected.len(),
                references_count: all_edits.len(),
                edits_estimated: all_edits.len(),
            },
            warnings,
        })
    }

    /// Run the rename operation.
    pub fn run(
        &self,
        location: &Location,
        new_name: &str,
        verify_mode: VerificationMode,
        apply: bool,
    ) -> RenameResult<RenameOutput> {
        // Validate new name
        validate_python_identifier(new_name)?;

        // Spawn worker
        let mut worker = spawn_worker(&self.ctx.python_path, &self.ctx.session_dir)?;

        // Collect Python files in workspace
        let files = self.ctx.collect_python_files()?;

        // Build FactsStore via analyzer
        let adapter = PythonAdapter::new(self.ctx.workspace_root.to_string_lossy());
        let mut store = FactsStore::new();
        adapter
            .analyze_files(&mut worker, &files, &mut store)
            .map_err(|e| RenameError::AnalyzerError {
                message: e.to_string(),
            })?;

        // Find symbol at location
        let symbol = find_symbol_at_location(&store, location, &files)?;
        let old_name = symbol.name.clone();

        // Collect all edits needed: (file_id, span)
        // This includes the target symbol, its references, override methods, and their references
        let mut all_edits: Vec<(FileId, Span)> = Vec::new();

        // Add the target symbol's definition
        all_edits.push((symbol.decl_file_id, symbol.decl_span));

        // Add references to the target symbol
        for reference in store.refs_of_symbol(symbol.symbol_id) {
            all_edits.push((reference.file_id, reference.span));
        }

        // For methods, also collect override methods and their references
        let override_ids = adapter.find_override_methods(&store, &symbol);
        for override_id in &override_ids {
            // Add the override method's definition
            if let Some(override_sym) = store.symbol(*override_id) {
                all_edits.push((override_sym.decl_file_id, override_sym.decl_span));
            }
            // Add all references to the override method
            for reference in store.refs_of_symbol(*override_id) {
                all_edits.push((reference.file_id, reference.span));
            }
        }

        // For methods in inheritance hierarchies, also include untyped method calls
        if !override_ids.is_empty() {
            let method_name = &symbol.name;
            for (path, content) in &files {
                let parse_resp =
                    worker
                        .parse(path, content)
                        .map_err(|e| RenameError::AnalyzerError {
                            message: e.to_string(),
                        })?;
                let combined = worker.get_analysis(&parse_resp.cst_id).map_err(|e| {
                    RenameError::AnalyzerError {
                        message: e.to_string(),
                    }
                })?;

                for method_call in &combined.method_calls {
                    if &method_call.method == method_name {
                        if let Some(ref span) = method_call.method_span {
                            let file = store.file_by_path(path);
                            if let Some(f) = file {
                                let file_id = f.file_id;
                                let sp = Span::new(span.start as u64, span.end as u64);
                                let key = (file_id, sp.start, sp.end);
                                if !all_edits
                                    .iter()
                                    .any(|(fid, s)| (*fid, s.start, s.end) == key)
                                {
                                    all_edits.push((file_id, sp));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Deduplicate edits by (file_id, span)
        let mut seen_spans: HashSet<(FileId, u64, u64)> = HashSet::new();
        all_edits.retain(|(file_id, span)| seen_spans.insert((*file_id, span.start, span.end)));

        // Generate edits by file
        let mut edits_by_file: HashMap<String, Vec<(Span, &str)>> = HashMap::new();
        for (file_id, span) in &all_edits {
            let file = store
                .file(*file_id)
                .ok_or_else(|| RenameError::AnalyzerError {
                    message: "file not found".to_string(),
                })?;
            edits_by_file
                .entry(file.path.clone())
                .or_default()
                .push((*span, new_name));
        }

        // Create sandbox
        let sandbox = TempDir::new()?;

        // Copy files to sandbox
        for (path, _) in &files {
            let src = self.ctx.workspace_root.join(path);
            let dst = sandbox.path().join(path);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src, &dst)?;
        }

        // Apply edits in sandbox
        let mut edit_infos = Vec::new();
        let mut total_bytes_added: i64 = 0;
        let mut total_bytes_removed: i64 = 0;

        for (path, edits) in &edits_by_file {
            let file_path = sandbox.path().join(path);
            let content = fs::read_to_string(&file_path)?;

            // Sort edits by span start in reverse order
            let mut sorted_edits: Vec<_> = edits.iter().collect();
            sorted_edits.sort_by(|a, b| b.0.start.cmp(&a.0.start));

            let mut new_content = content.clone();
            for (span, replacement) in &sorted_edits {
                let start = span.start as usize;
                let end = span.end as usize;
                let old_text = &content[start..end];
                let (line, col) = byte_offset_to_position_str(&content, span.start);

                edit_infos.push(OutputEdit {
                    file: path.clone(),
                    span: Span::new(span.start, span.end),
                    old_text: old_text.to_string(),
                    new_text: replacement.to_string(),
                    line,
                    col,
                });

                total_bytes_removed += (span.end - span.start) as i64;
                total_bytes_added += replacement.len() as i64;

                new_content = format!(
                    "{}{}{}",
                    &new_content[..start],
                    replacement,
                    &new_content[end..]
                );
            }

            fs::write(&file_path, &new_content)?;
        }

        // Sort edit_infos by file then span start
        edit_infos.sort_by(|a, b| a.file.cmp(&b.file).then(a.span.start.cmp(&b.span.start)));

        // Run verification
        let verification = run_verification(&self.ctx.python_path, sandbox.path(), verify_mode)?;

        if verification.status == VerificationStatus::Failed {
            return Err(RenameError::VerificationFailed {
                status: verification.status,
                output: verification
                    .checks
                    .iter()
                    .filter(|c| c.status == VerificationStatus::Failed)
                    .filter_map(|c| c.output.clone())
                    .collect::<Vec<_>>()
                    .join("\n"),
            });
        }

        // Apply to real workspace if requested
        let files_written = if apply {
            let mut written = Vec::new();
            for (path, edits) in &edits_by_file {
                let file_path = self.ctx.workspace_root.join(path);
                let content = fs::read_to_string(&file_path)?;

                let mut sorted_edits: Vec<_> = edits.iter().collect();
                sorted_edits.sort_by(|a, b| b.0.start.cmp(&a.0.start));

                let mut new_content = content.clone();
                for (span, replacement) in &sorted_edits {
                    let start = span.start as usize;
                    let end = span.end as usize;
                    new_content = format!(
                        "{}{}{}",
                        &new_content[..start],
                        replacement,
                        &new_content[end..]
                    );
                }

                fs::write(&file_path, &new_content)?;
                written.push(path.clone());
            }
            Some(written)
        } else {
            None
        };

        // Generate unified diff
        let unified_diff = generate_unified_diff(&edit_infos);

        // Collect dynamic pattern warnings (preserved as structured per Spec S11)
        let file_paths: Vec<PathBuf> = files.iter().map(|(p, _)| PathBuf::from(p)).collect();
        let warnings =
            collect_dynamic_warnings(&mut worker, &file_paths, &old_name, DynamicMode::Safe)?;

        // Generate snapshot and undo token
        let snapshot_id = generate_snapshot_id();
        let undo_token = generate_undo_token();

        Ok(RenameOutput {
            status: "ok".to_string(),
            schema_version: "1".to_string(),
            snapshot_id,
            patch: MaterializedPatch {
                edits: edit_infos.clone(),
                unified_diff,
            },
            summary: RenameSummary {
                files_changed: edits_by_file.len(),
                edits_count: edit_infos.len(),
                bytes_added: total_bytes_added,
                bytes_removed: total_bytes_removed,
            },
            verification,
            warnings,
            undo_token,
            applied: if apply { Some(true) } else { None },
            files_written,
        })
    }

    /// Access the context for snapshot and file operations.
    ///
    /// Use this to access workspace methods:
    /// - `ctx().collect_files_from_snapshot(&snapshot)`
    /// - `ctx().create_python_snapshot()`
    pub fn ctx(&self) -> &PythonOpContext {
        &self.ctx
    }
}

// ============================================================================
// Native CST Implementation
// ============================================================================

/// Native CST rename implementation.
///
/// This module provides zero-Python-dependency rename operations when the `native-cst`
/// feature is enabled. It uses `tugtool-cst` for reference collection and transformation.
#[cfg(feature = "native-cst")]
pub mod native {
    use super::*;

    /// Apply a single-file rename operation using native CST.
    ///
    /// This function performs a simplified rename operation on a single file:
    /// 1. Parse and analyze the file using native CST
    /// 2. Find all references to the target name
    /// 3. Apply renames using the native RenameTransformer
    ///
    /// # Arguments
    ///
    /// * `content` - The Python source code
    /// * `old_name` - The name to rename from
    /// * `new_name` - The name to rename to
    ///
    /// # Returns
    ///
    /// The transformed source code with all renames applied, or an error.
    ///
    /// # Example
    ///
    /// ```ignore
    /// use tugtool_python::ops::rename::native::rename_in_file;
    ///
    /// let content = "def foo():\n    return foo";
    /// let result = rename_in_file(content, "foo", "bar")?;
    /// assert_eq!(result, "def bar():\n    return bar");
    /// ```
    pub fn rename_in_file(content: &str, old_name: &str, new_name: &str) -> RenameResult<String> {
        // Parse and analyze the file
        let analysis = cst_bridge::parse_and_analyze(content)?;

        // Collect all spans where the name appears
        let mut rewrites: Vec<(Span, String)> = Vec::new();

        // Check bindings for the target name
        for binding in &analysis.bindings {
            if binding.name == old_name {
                if let Some(ref span_info) = binding.span {
                    let span = Span::new(span_info.start as u64, span_info.end as u64);
                    rewrites.push((span, new_name.to_string()));
                }
            }
        }

        // Check references for the target name
        for (name, refs) in &analysis.references {
            if name == old_name {
                for ref_info in refs {
                    if let Some(ref span_info) = ref_info.span {
                        let span = Span::new(span_info.start as u64, span_info.end as u64);
                        // Avoid duplicates
                        if !rewrites.iter().any(|(s, _)| s.start == span.start && s.end == span.end) {
                            rewrites.push((span, new_name.to_string()));
                        }
                    }
                }
            }
        }

        // Apply all renames using the native transformer
        let result = cst_bridge::rewrite_batch(content, &rewrites)?;

        Ok(result)
    }

    /// Collect rename edits for a single file using native CST analysis.
    ///
    /// This function analyzes a file and returns the edits needed to rename
    /// a symbol, without actually applying them.
    ///
    /// # Arguments
    ///
    /// * `content` - The Python source code
    /// * `old_name` - The name to find references for
    /// * `new_name` - The name to rename to (used for edit generation)
    ///
    /// # Returns
    ///
    /// A vector of edits (file path placeholder, span, old_text, new_text, line, col).
    pub fn collect_rename_edits(
        content: &str,
        old_name: &str,
        new_name: &str,
    ) -> RenameResult<Vec<NativeRenameEdit>> {
        // Parse and analyze the file
        let analysis = cst_bridge::parse_and_analyze(content)?;

        let mut edits: Vec<NativeRenameEdit> = Vec::new();
        let mut seen_spans: HashSet<(u64, u64)> = HashSet::new();

        // Collect edits from bindings
        for binding in &analysis.bindings {
            if binding.name == old_name {
                if let Some(ref span_info) = binding.span {
                    let span = Span::new(span_info.start as u64, span_info.end as u64);
                    let key = (span.start, span.end);
                    if seen_spans.insert(key) {
                        let (line, col) = byte_offset_to_position_str(content, span.start);
                        let old_text = content
                            .get(span.start as usize..span.end as usize)
                            .unwrap_or(old_name)
                            .to_string();
                        edits.push(NativeRenameEdit {
                            span,
                            old_text,
                            new_text: new_name.to_string(),
                            line,
                            col,
                        });
                    }
                }
            }
        }

        // Collect edits from references
        for (name, refs) in &analysis.references {
            if name == old_name {
                for ref_info in refs {
                    if let Some(ref span_info) = ref_info.span {
                        let span = Span::new(span_info.start as u64, span_info.end as u64);
                        let key = (span.start, span.end);
                        if seen_spans.insert(key) {
                            let (line, col) = byte_offset_to_position_str(content, span.start);
                            let old_text = content
                                .get(span.start as usize..span.end as usize)
                                .unwrap_or(old_name)
                                .to_string();
                            edits.push(NativeRenameEdit {
                                span,
                                old_text,
                                new_text: new_name.to_string(),
                                line,
                                col,
                            });
                        }
                    }
                }
            }
        }

        // Sort by span start for consistent ordering
        edits.sort_by_key(|e| e.span.start);

        Ok(edits)
    }

    /// A rename edit collected by native CST analysis.
    #[derive(Debug, Clone)]
    pub struct NativeRenameEdit {
        /// The byte span to replace.
        pub span: Span,
        /// The original text at the span.
        pub old_text: String,
        /// The new text to replace with.
        pub new_text: String,
        /// The line number (1-based).
        pub line: u32,
        /// The column number (1-based).
        pub col: u32,
    }

    /// Apply batch renames to source code using native CST transformer.
    ///
    /// This is a thin wrapper around `cst_bridge::rewrite_batch` for use
    /// in the rename operation.
    ///
    /// # Arguments
    ///
    /// * `source` - The original Python source code
    /// * `rewrites` - List of (span, new_name) tuples specifying renames
    ///
    /// # Returns
    ///
    /// The transformed source code with all renames applied.
    pub fn apply_renames(source: &str, rewrites: &[(Span, String)]) -> RenameResult<String> {
        let result = cst_bridge::rewrite_batch(source, rewrites)?;
        Ok(result)
    }

    // ========================================================================
    // Multi-File Native Rename (using analyze_files 4-pass pipeline)
    // ========================================================================

    /// Analyze the impact of renaming a symbol using native CST analysis.
    ///
    /// This function uses the native 4-pass `analyze_files` pipeline to build
    /// a fully-populated FactsStore with cross-file references, inheritance
    /// hierarchies, and type-aware method resolution.
    ///
    /// # Arguments
    ///
    /// * `workspace_root` - The workspace root directory
    /// * `files` - List of (path, content) tuples for all Python files
    /// * `location` - The location of the symbol to rename
    /// * `new_name` - The proposed new name
    ///
    /// # Returns
    ///
    /// Impact analysis including symbol info, all references, and warnings.
    ///
    /// # Errors
    ///
    /// Returns `AnalysisFailed` if any files fail to parse (Contract C7 strict policy).
    pub fn analyze_impact_native(
        workspace_root: &std::path::Path,
        files: &[(String, String)],
        location: &Location,
        new_name: &str,
    ) -> RenameResult<ImpactAnalysis> {
        use crate::lookup::{find_symbol_at_location, symbol_to_info};
        use crate::files::read_file;
        use tugtool_core::facts::ReferenceKind;

        // Validate new name
        validate_python_identifier(new_name)?;

        // Build FactsStore via native 4-pass analysis
        let mut store = FactsStore::new();
        let bundle = analyze_files(files, &mut store).map_err(|e| RenameError::AnalyzerError {
            message: e.to_string(),
        })?;

        // Contract C7: Strict policy - fail if any files failed analysis
        if !bundle.is_complete() {
            return Err(RenameError::AnalysisFailed {
                count: bundle.failed_files.len(),
                files: bundle.failed_files.iter().map(|(p, _)| p.clone()).collect(),
            });
        }

        // Find symbol at location
        let symbol = find_symbol_at_location(&store, location, files)?;

        // Collect all edits needed: (file_id, span, kind)
        let mut all_edits: Vec<(FileId, Span, ReferenceKind)> = Vec::new();

        // Add the target symbol's definition
        all_edits.push((
            symbol.decl_file_id,
            symbol.decl_span,
            ReferenceKind::Definition,
        ));

        // Add references to the target symbol
        for reference in store.refs_of_symbol(symbol.symbol_id) {
            all_edits.push((reference.file_id, reference.span, reference.ref_kind));
        }

        // For methods, collect override methods and their references
        let override_ids = find_override_methods_native(&store, &symbol);
        for override_id in &override_ids {
            if let Some(override_sym) = store.symbol(*override_id) {
                all_edits.push((
                    override_sym.decl_file_id,
                    override_sym.decl_span,
                    ReferenceKind::Definition,
                ));
            }
            for reference in store.refs_of_symbol(*override_id) {
                all_edits.push((reference.file_id, reference.span, reference.ref_kind));
            }
        }

        // Deduplicate edits by (file_id, span)
        let mut seen_spans: HashSet<(FileId, u64, u64)> = HashSet::new();
        all_edits.retain(|(file_id, span, _)| seen_spans.insert((*file_id, span.start, span.end)));

        // Build reference info
        let mut references = Vec::new();
        let mut files_affected = std::collections::HashSet::new();

        for (file_id, span, kind) in &all_edits {
            let file = store
                .file(*file_id)
                .ok_or_else(|| RenameError::AnalyzerError {
                    message: format!("file not found: {:?}", file_id),
                })?;
            files_affected.insert(&file.path);

            let content = read_file(workspace_root, &file.path)?;
            let (line, col) = tugtool_core::text::byte_offset_to_position_str(&content, span.start);
            references.push(ReferenceInfo {
                location: Location {
                    file: file.path.clone(),
                    line,
                    col,
                    byte_start: Some(span.start),
                    byte_end: Some(span.end),
                },
                kind: format!("{:?}", kind).to_lowercase(),
            });
        }

        // Build symbol info
        let decl_file =
            store
                .file(symbol.decl_file_id)
                .ok_or_else(|| RenameError::AnalyzerError {
                    message: "declaration file not found".to_string(),
                })?;
        let decl_content = read_file(workspace_root, &decl_file.path)?;
        let symbol_info = symbol_to_info(&symbol, decl_file, &decl_content);

        // Generate snapshot ID
        let snapshot_id = generate_snapshot_id();

        Ok(ImpactAnalysis {
            status: "ok".to_string(),
            schema_version: "1".to_string(),
            snapshot_id,
            symbol: symbol_info,
            references,
            impact: ImpactSummary {
                files_affected: files_affected.len(),
                references_count: all_edits.len(),
                edits_estimated: all_edits.len(),
            },
            warnings: Vec::new(), // Dynamic warnings not yet supported in native mode
        })
    }

    /// Run a rename operation using native CST analysis.
    ///
    /// This function performs a full multi-file rename using the native 4-pass
    /// `analyze_files` pipeline:
    ///
    /// 1. Analyze all files to build FactsStore with cross-file resolution
    /// 2. Find the target symbol at the specified location
    /// 3. Collect all references including override methods
    /// 4. Apply edits in a sandbox and verify
    /// 5. Optionally apply changes to the real workspace
    ///
    /// # Arguments
    ///
    /// * `workspace_root` - The workspace root directory
    /// * `files` - List of (path, content) tuples for all Python files
    /// * `location` - The location of the symbol to rename
    /// * `new_name` - The new name for the symbol
    /// * `python_path` - Path to Python interpreter (for verification)
    /// * `verify_mode` - Verification mode to use
    /// * `apply` - Whether to apply changes to the real workspace
    ///
    /// # Returns
    ///
    /// The rename result with patch, verification, and summary.
    ///
    /// # Errors
    ///
    /// Returns `AnalysisFailed` if any files fail to parse (Contract C7 strict policy).
    pub fn run_native(
        workspace_root: &std::path::Path,
        files: &[(String, String)],
        location: &Location,
        new_name: &str,
        python_path: &std::path::Path,
        verify_mode: VerificationMode,
        apply: bool,
    ) -> RenameResult<RenameOutput> {
        use crate::lookup::find_symbol_at_location;
        use tugtool_core::diff::generate_unified_diff;

        // Validate new name
        validate_python_identifier(new_name)?;

        // Build FactsStore via native 4-pass analysis
        let mut store = FactsStore::new();
        let bundle = analyze_files(files, &mut store).map_err(|e| RenameError::AnalyzerError {
            message: e.to_string(),
        })?;

        // Contract C7: Strict policy - fail if any files failed analysis
        if !bundle.is_complete() {
            return Err(RenameError::AnalysisFailed {
                count: bundle.failed_files.len(),
                files: bundle.failed_files.iter().map(|(p, _)| p.clone()).collect(),
            });
        }

        // Find symbol at location
        let symbol = find_symbol_at_location(&store, location, files)?;

        // Collect all edits needed: (file_id, span)
        let mut all_edits: Vec<(FileId, Span)> = Vec::new();

        // Add the target symbol's definition
        all_edits.push((symbol.decl_file_id, symbol.decl_span));

        // Add references to the target symbol
        for reference in store.refs_of_symbol(symbol.symbol_id) {
            all_edits.push((reference.file_id, reference.span));
        }

        // For methods, collect override methods and their references
        let override_ids = find_override_methods_native(&store, &symbol);
        for override_id in &override_ids {
            if let Some(override_sym) = store.symbol(*override_id) {
                all_edits.push((override_sym.decl_file_id, override_sym.decl_span));
            }
            for reference in store.refs_of_symbol(*override_id) {
                all_edits.push((reference.file_id, reference.span));
            }
        }

        // Deduplicate edits by (file_id, span)
        let mut seen_spans: HashSet<(FileId, u64, u64)> = HashSet::new();
        all_edits.retain(|(file_id, span)| seen_spans.insert((*file_id, span.start, span.end)));

        // Generate edits by file
        let mut edits_by_file: HashMap<String, Vec<(Span, &str)>> = HashMap::new();
        for (file_id, span) in &all_edits {
            let file = store
                .file(*file_id)
                .ok_or_else(|| RenameError::AnalyzerError {
                    message: "file not found".to_string(),
                })?;
            edits_by_file
                .entry(file.path.clone())
                .or_default()
                .push((*span, new_name));
        }

        // Create sandbox
        let sandbox = TempDir::new()?;

        // Copy files to sandbox
        for (path, _) in files {
            let src = workspace_root.join(path);
            let dst = sandbox.path().join(path);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src, &dst)?;
        }

        // Apply edits in sandbox
        let mut edit_infos = Vec::new();
        let mut total_bytes_added: i64 = 0;
        let mut total_bytes_removed: i64 = 0;

        for (path, edits) in &edits_by_file {
            let file_path = sandbox.path().join(path);
            let content = fs::read_to_string(&file_path)?;

            // Sort edits by span start in reverse order
            let mut sorted_edits: Vec<_> = edits.iter().collect();
            sorted_edits.sort_by(|a, b| b.0.start.cmp(&a.0.start));

            let mut new_content = content.clone();
            for (span, replacement) in &sorted_edits {
                let start = span.start as usize;
                let end = span.end as usize;
                let old_text = &content[start..end];
                let (line, col) = byte_offset_to_position_str(&content, span.start);

                edit_infos.push(OutputEdit {
                    file: path.clone(),
                    span: Span::new(span.start, span.end),
                    old_text: old_text.to_string(),
                    new_text: replacement.to_string(),
                    line,
                    col,
                });

                total_bytes_removed += (span.end - span.start) as i64;
                total_bytes_added += replacement.len() as i64;

                new_content = format!(
                    "{}{}{}",
                    &new_content[..start],
                    replacement,
                    &new_content[end..]
                );
            }

            fs::write(&file_path, &new_content)?;
        }

        // Sort edit_infos by file then span start
        edit_infos.sort_by(|a, b| a.file.cmp(&b.file).then(a.span.start.cmp(&b.span.start)));

        // Run verification
        let verification = run_verification(python_path, sandbox.path(), verify_mode)?;

        if verification.status == VerificationStatus::Failed {
            return Err(RenameError::VerificationFailed {
                status: verification.status,
                output: verification
                    .checks
                    .iter()
                    .filter(|c| c.status == VerificationStatus::Failed)
                    .filter_map(|c| c.output.clone())
                    .collect::<Vec<_>>()
                    .join("\n"),
            });
        }

        // Apply to real workspace if requested
        let files_written = if apply {
            let mut written = Vec::new();
            for (path, edits) in &edits_by_file {
                let file_path = workspace_root.join(path);
                let content = fs::read_to_string(&file_path)?;

                let mut sorted_edits: Vec<_> = edits.iter().collect();
                sorted_edits.sort_by(|a, b| b.0.start.cmp(&a.0.start));

                let mut new_content = content.clone();
                for (span, replacement) in &sorted_edits {
                    let start = span.start as usize;
                    let end = span.end as usize;
                    new_content = format!(
                        "{}{}{}",
                        &new_content[..start],
                        replacement,
                        &new_content[end..]
                    );
                }

                fs::write(&file_path, &new_content)?;
                written.push(path.clone());
            }
            Some(written)
        } else {
            None
        };

        // Generate unified diff
        let unified_diff = generate_unified_diff(&edit_infos);

        // Generate snapshot and undo token
        let snapshot_id = generate_snapshot_id();
        let undo_token = generate_undo_token();

        Ok(RenameOutput {
            status: "ok".to_string(),
            schema_version: "1".to_string(),
            snapshot_id,
            patch: MaterializedPatch {
                edits: edit_infos.clone(),
                unified_diff,
            },
            summary: RenameSummary {
                files_changed: edits_by_file.len(),
                edits_count: edit_infos.len(),
                bytes_added: total_bytes_added,
                bytes_removed: total_bytes_removed,
            },
            verification,
            warnings: Vec::new(), // Dynamic warnings not yet supported in native mode
            undo_token,
            applied: if apply { Some(true) } else { None },
            files_written,
        })
    }

    /// Find override methods for a symbol in the FactsStore.
    ///
    /// This is a native implementation that doesn't require PythonAdapter.
    fn find_override_methods_native(
        store: &FactsStore,
        method_symbol: &tugtool_core::facts::Symbol,
    ) -> Vec<tugtool_core::facts::SymbolId> {
        use tugtool_core::facts::SymbolKind;

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
}

#[cfg(feature = "native-cst")]
pub use native::{
    analyze_impact_native, apply_renames, collect_rename_edits, rename_in_file, run_native,
    NativeRenameEdit,
};

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod location_tests {
        use super::*;

        #[test]
        fn parse_location_valid() {
            let loc = Location::parse("src/utils.py:42:5").unwrap();
            assert_eq!(loc.file, "src/utils.py");
            assert_eq!(loc.line, 42);
            assert_eq!(loc.col, 5);
        }

        #[test]
        fn parse_location_with_colons_in_path() {
            // On Windows, paths can have colons
            let loc = Location::parse("C:/Users/foo/src/utils.py:10:3");
            // This should fail since we use rsplitn(3, ':')
            // which would give ["3", "10", "C:/Users/foo/src/utils.py"]
            assert!(loc.is_some());
            let loc = loc.unwrap();
            assert_eq!(loc.file, "C:/Users/foo/src/utils.py");
        }

        #[test]
        fn parse_location_invalid() {
            assert!(Location::parse("src/utils.py").is_none());
            assert!(Location::parse("src/utils.py:42").is_none());
            assert!(Location::parse("src/utils.py:abc:5").is_none());
        }
    }

    mod conversion_tests {
        use super::*;
        use tugtool_core::text::position_to_byte_offset_str;

        #[test]
        fn line_col_to_offset_simple() {
            let content = "line1\nline2\nline3\n";
            assert_eq!(position_to_byte_offset_str(content, 1, 1), 0); // 'l' of line1
            assert_eq!(position_to_byte_offset_str(content, 1, 5), 4); // '1' of line1
            assert_eq!(position_to_byte_offset_str(content, 2, 1), 6); // 'l' of line2
            assert_eq!(position_to_byte_offset_str(content, 3, 1), 12); // 'l' of line3
        }

        #[test]
        fn offset_to_line_col_simple() {
            let content = "line1\nline2\nline3\n";
            assert_eq!(byte_offset_to_position_str(content, 0), (1, 1)); // 'l' of line1
            assert_eq!(byte_offset_to_position_str(content, 4), (1, 5)); // '1' of line1
            assert_eq!(byte_offset_to_position_str(content, 6), (2, 1)); // 'l' of line2
            assert_eq!(byte_offset_to_position_str(content, 12), (3, 1)); // 'l' of line3
        }

        #[test]
        fn roundtrip_conversion() {
            let content = "def foo():\n    pass\n";
            for line in 1..=2u32 {
                for col in 1..=10u32 {
                    let offset = position_to_byte_offset_str(content, line, col);
                    if (offset as usize) < content.len() {
                        let (l, _c) = byte_offset_to_position_str(content, offset);
                        // Note: roundtrip may differ due to col clamping
                        assert!(l <= line);
                    }
                }
            }
        }
    }

    // Integration tests require Python/libcst
    #[cfg(test)]
    mod integration_tests {
        use super::*;
        use crate::test_helpers::require_python_with_libcst;
        use tempfile::TempDir;

        #[test]
        fn rename_resolves_correct_symbol() {
            let python = require_python_with_libcst();
            let workspace = TempDir::new().unwrap();
            let session = TempDir::new().unwrap();

            // Create test file
            let test_file = workspace.path().join("test.py");
            fs::write(&test_file, "def foo():\n    pass\n\nfoo()\n").unwrap();

            // Create session dirs
            fs::create_dir_all(session.path().join("python")).unwrap();
            fs::create_dir_all(session.path().join("workers")).unwrap();

            let op = PythonRenameOp::new(workspace.path(), &python, session.path());

            // Analyze impact at the definition (line 1, col 5 = "foo")
            let result = op.analyze_impact(&Location::new("test.py", 1, 5), "bar");

            assert!(result.is_ok(), "analyze_impact failed: {:?}", result.err());

            let analysis = result.unwrap();
            assert_eq!(analysis.symbol.name, "foo");
            assert_eq!(analysis.symbol.kind, "function");
            assert!(analysis.references.len() >= 2); // def + call
        }

        #[test]
        fn rename_generates_correct_patchset() {
            let python = require_python_with_libcst();
            let workspace = TempDir::new().unwrap();
            let session = TempDir::new().unwrap();

            // Create test file
            let test_file = workspace.path().join("test.py");
            fs::write(&test_file, "def foo():\n    pass\n\nfoo()\n").unwrap();

            // Create session dirs
            fs::create_dir_all(session.path().join("python")).unwrap();
            fs::create_dir_all(session.path().join("workers")).unwrap();

            let op = PythonRenameOp::new(workspace.path(), &python, session.path());

            // Run rename without apply
            let result = op.run(
                &Location::new("test.py", 1, 5),
                "bar",
                VerificationMode::Syntax,
                false,
            );

            assert!(result.is_ok(), "run failed: {:?}", result.err());

            let rename_result = result.unwrap();
            assert_eq!(rename_result.status, "ok");
            assert!(rename_result.patch.edits.len() >= 2); // def + call

            // Original file should be unchanged
            let content = fs::read_to_string(&test_file).unwrap();
            assert!(content.contains("def foo()"));
            assert!(content.contains("foo()"));
        }

        #[test]
        fn rename_end_to_end_with_apply() {
            let python = require_python_with_libcst();
            let workspace = TempDir::new().unwrap();
            let session = TempDir::new().unwrap();

            // Create test file
            let test_file = workspace.path().join("test.py");
            fs::write(
                &test_file,
                "def process_data():\n    pass\n\nprocess_data()\n",
            )
            .unwrap();

            // Create session dirs
            fs::create_dir_all(session.path().join("python")).unwrap();
            fs::create_dir_all(session.path().join("workers")).unwrap();

            let op = PythonRenameOp::new(workspace.path(), &python, session.path());

            // Run rename WITH apply
            let result = op.run(
                &Location::new("test.py", 1, 5),
                "transform_data",
                VerificationMode::Syntax,
                true,
            );

            assert!(result.is_ok(), "run failed: {:?}", result.err());

            let rename_result = result.unwrap();
            assert_eq!(rename_result.status, "ok");
            assert_eq!(
                rename_result.verification.status,
                VerificationStatus::Passed
            );

            // File should be changed
            let content = fs::read_to_string(&test_file).unwrap();
            assert!(content.contains("def transform_data()"));
            assert!(content.contains("transform_data()"));
            assert!(!content.contains("process_data"));
        }
    }

    // Native CST rename tests
    #[cfg(feature = "native-cst")]
    mod native_rename_tests {
        use super::*;

        #[test]
        fn native_rename_simple_function() {
            let content = "def foo():\n    pass\n\nfoo()\n";
            let result = native::rename_in_file(content, "foo", "bar").expect("rename should succeed");
            assert!(result.contains("def bar()"), "function definition not renamed");
            assert!(result.contains("bar()"), "function call not renamed");
            assert!(!result.contains("foo"), "old name still present");
        }

        #[test]
        fn native_rename_variable() {
            let content = "x = 1\ny = x + 2\nprint(x)\n";
            let result = native::rename_in_file(content, "x", "value").expect("rename should succeed");
            assert!(result.contains("value = 1"), "assignment not renamed");
            assert!(result.contains("y = value + 2"), "reference not renamed");
            assert!(result.contains("print(value)"), "function arg not renamed");
            assert!(!result.contains(" x"), "old name still present");
        }

        #[test]
        fn native_rename_class() {
            let content = "class MyClass:\n    pass\n\nobj = MyClass()\n";
            let result = native::rename_in_file(content, "MyClass", "NewClass").expect("rename should succeed");
            assert!(result.contains("class NewClass:"), "class definition not renamed");
            assert!(result.contains("NewClass()"), "instantiation not renamed");
            assert!(!result.contains("MyClass"), "old name still present");
        }

        #[test]
        fn native_rename_preserves_formatting() {
            let content = "def foo():\n    # Comment\n    return 42\n\nresult = foo()\n";
            let result = native::rename_in_file(content, "foo", "bar").expect("rename should succeed");
            assert!(result.contains("# Comment"), "comment should be preserved");
            assert!(result.contains("return 42"), "return statement should be preserved");
            assert!(result.contains("result = bar()"), "variable and call should be renamed");
        }

        #[test]
        fn native_rename_no_match() {
            let content = "def foo():\n    pass\n";
            let result = native::rename_in_file(content, "nonexistent", "something").expect("rename should succeed");
            assert_eq!(result, content, "content should be unchanged when no matches");
        }

        #[test]
        fn native_collect_edits_simple() {
            let content = "def foo():\n    return foo";
            let edits = native::collect_rename_edits(content, "foo", "bar").expect("should collect edits");
            assert!(!edits.is_empty(), "should find at least one edit");

            // Verify edit locations
            for edit in &edits {
                assert_eq!(edit.old_text, "foo", "old text should be foo");
                assert_eq!(edit.new_text, "bar", "new text should be bar");
                assert!(edit.line >= 1, "line should be 1-based");
                assert!(edit.col >= 1, "col should be 1-based");
            }
        }

        #[test]
        fn native_apply_renames_multiple() {
            let content = "x = 1\ny = x";
            let rewrites = vec![
                (Span::new(0, 1), "a".to_string()),
                (Span::new(10, 11), "a".to_string()),
            ];
            let result = native::apply_renames(content, &rewrites).expect("apply should succeed");
            assert_eq!(result, "a = 1\ny = a");
        }

        #[test]
        fn native_rename_nested_function() {
            let content = r#"def outer():
    def inner():
        pass
    inner()

outer()
"#;
            // Rename outer function
            let result = native::rename_in_file(content, "outer", "wrapper").expect("rename should succeed");
            assert!(result.contains("def wrapper():"), "outer function should be renamed");
            assert!(result.contains("wrapper()"), "outer call should be renamed");
            assert!(result.contains("def inner():"), "inner function should be unchanged");
        }

        #[test]
        fn native_rename_parameter() {
            let content = "def greet(name):\n    return f\"Hello, {name}!\"\n";
            let result = native::rename_in_file(content, "name", "person").expect("rename should succeed");
            assert!(result.contains("def greet(person):"), "parameter should be renamed");
            // Note: f-string interpolation may or may not be renamed depending on reference collector
        }
    }

    // Multi-file native rename integration tests
    #[cfg(feature = "native-cst")]
    mod native_multifile_tests {
        use super::*;
        use crate::test_helpers::require_python_with_libcst;
        use tempfile::TempDir;

        /// Test: Rename function updates imports in other files
        #[test]
        fn native_rename_cross_file_import() {
            let python = require_python_with_libcst();
            let workspace = TempDir::new().unwrap();

            // Create module with function to rename
            let utils_content = "def helper():\n    return 42\n";
            let utils_path = workspace.path().join("utils.py");
            fs::write(&utils_path, utils_content).unwrap();

            // Create file that imports and uses the function
            let main_content = "from utils import helper\n\nresult = helper()\n";
            let main_path = workspace.path().join("main.py");
            fs::write(&main_path, main_content).unwrap();

            // Collect files
            let files: Vec<(String, String)> = vec![
                ("utils.py".to_string(), utils_content.to_string()),
                ("main.py".to_string(), main_content.to_string()),
            ];

            // Run native rename on the function definition
            let result = native::run_native(
                workspace.path(),
                &files,
                &Location::new("utils.py", 1, 5), // 'helper' in def helper():
                "utility_func",
                &python,
                VerificationMode::Syntax,
                true,
            );

            assert!(result.is_ok(), "run_native failed: {:?}", result.err());

            // Verify both files were updated
            let utils_updated = fs::read_to_string(&utils_path).unwrap();
            assert!(
                utils_updated.contains("def utility_func():"),
                "Function definition should be renamed"
            );

            let main_updated = fs::read_to_string(&main_path).unwrap();
            assert!(
                main_updated.contains("from utils import utility_func"),
                "Import should be renamed"
            );
            assert!(
                main_updated.contains("result = utility_func()"),
                "Usage should be renamed"
            );
        }

        /// Test: Rename base class method updates overrides in child classes
        #[test]
        fn native_rename_method_with_override() {
            let python = require_python_with_libcst();
            let workspace = TempDir::new().unwrap();

            let content = r#"class Base:
    def process(self):
        pass

class Child(Base):
    def process(self):  # override
        super().process()

def use_it(obj: Base):
    obj.process()
"#;
            let test_path = workspace.path().join("test.py");
            fs::write(&test_path, content).unwrap();

            let files: Vec<(String, String)> = vec![("test.py".to_string(), content.to_string())];

            // Run native rename on the base method
            let result = native::run_native(
                workspace.path(),
                &files,
                &Location::new("test.py", 2, 9), // 'process' in Base.process
                "handle",
                &python,
                VerificationMode::Syntax,
                true,
            );

            assert!(result.is_ok(), "run_native failed: {:?}", result.err());

            let updated = fs::read_to_string(&test_path).unwrap();

            // Both base and override should be renamed
            assert!(
                updated.contains("def handle(self):"),
                "Base method should be renamed"
            );
            // Count occurrences of "def handle"
            let handle_count = updated.matches("def handle(self):").count();
            assert_eq!(
                handle_count, 2,
                "Both base and override should have 'def handle': got {}",
                handle_count
            );

            // super().process() call should also be renamed
            assert!(
                updated.contains("super().handle()"),
                "super() call should be renamed"
            );

            // Usage should be renamed
            assert!(
                updated.contains("obj.handle()"),
                "Method call should be renamed"
            );
        }

        /// Test: Rename with typed receiver resolves correctly
        #[test]
        fn native_rename_typed_method_call() {
            let python = require_python_with_libcst();
            let workspace = TempDir::new().unwrap();

            let content = r#"class Handler:
    def process_request(self, data):
        return data

def main():
    h = Handler()
    h.process_request("test")
"#;
            let test_path = workspace.path().join("test.py");
            fs::write(&test_path, content).unwrap();

            let files: Vec<(String, String)> = vec![("test.py".to_string(), content.to_string())];

            // Run native rename on the method definition
            let result = native::run_native(
                workspace.path(),
                &files,
                &Location::new("test.py", 2, 9), // 'process_request' in def process_request
                "handle_request",
                &python,
                VerificationMode::Syntax,
                true,
            );

            assert!(result.is_ok(), "run_native failed: {:?}", result.err());

            let updated = fs::read_to_string(&test_path).unwrap();

            // Method definition should be renamed
            assert!(
                updated.contains("def handle_request(self, data):"),
                "Method definition should be renamed"
            );

            // Method call should be renamed (type-aware resolution)
            assert!(
                updated.contains("h.handle_request("),
                "Method call should be renamed"
            );
        }

        /// Test: Analysis fails if any file has parse errors (Contract C7)
        #[test]
        fn native_rename_fails_on_parse_error() {
            let workspace = TempDir::new().unwrap();

            // Create valid file
            let valid_content = "def foo():\n    pass\n";
            let valid_path = workspace.path().join("valid.py");
            fs::write(&valid_path, valid_content).unwrap();

            // Create file with syntax error
            let invalid_content = "def broken(\n";  // missing closing paren and body
            let invalid_path = workspace.path().join("invalid.py");
            fs::write(&invalid_path, invalid_content).unwrap();

            let files: Vec<(String, String)> = vec![
                ("valid.py".to_string(), valid_content.to_string()),
                ("invalid.py".to_string(), invalid_content.to_string()),
            ];

            // Impact analysis should fail due to strict policy
            let result = native::analyze_impact_native(
                workspace.path(),
                &files,
                &Location::new("valid.py", 1, 5),
                "bar",
            );

            assert!(result.is_err(), "Should fail when files have parse errors");

            match result.unwrap_err() {
                RenameError::AnalysisFailed { count, files } => {
                    assert_eq!(count, 1, "Should report 1 failed file");
                    assert!(
                        files.contains(&"invalid.py".to_string()),
                        "Should include the invalid file"
                    );
                }
                e => panic!("Expected AnalysisFailed error, got: {:?}", e),
            }
        }

        /// Test: analyze_impact_native returns correct references
        #[test]
        fn native_analyze_impact_cross_file() {
            let workspace = TempDir::new().unwrap();

            // Create module with function
            let utils_content = "def helper():\n    return 42\n";
            let utils_path = workspace.path().join("utils.py");
            fs::write(&utils_path, utils_content).unwrap();

            // Create file that imports and uses it
            let main_content = "from utils import helper\n\nresult = helper()\n";
            let main_path = workspace.path().join("main.py");
            fs::write(&main_path, main_content).unwrap();

            let files: Vec<(String, String)> = vec![
                ("utils.py".to_string(), utils_content.to_string()),
                ("main.py".to_string(), main_content.to_string()),
            ];

            let result = native::analyze_impact_native(
                workspace.path(),
                &files,
                &Location::new("utils.py", 1, 5),
                "new_name",
            );

            assert!(result.is_ok(), "analyze_impact_native failed: {:?}", result.err());

            let analysis = result.unwrap();
            assert_eq!(analysis.symbol.name, "helper");
            assert_eq!(analysis.symbol.kind, "function");

            // Should include references from both files:
            // - Definition in utils.py
            // - Import in main.py
            // - Call in main.py
            assert!(
                analysis.references.len() >= 2,
                "Should have at least 2 references (def + import), got {}",
                analysis.references.len()
            );

            // Verify we have references in both files
            let utils_refs: Vec<_> = analysis
                .references
                .iter()
                .filter(|r| r.location.file == "utils.py")
                .collect();
            let main_refs: Vec<_> = analysis
                .references
                .iter()
                .filter(|r| r.location.file == "main.py")
                .collect();

            assert!(
                !utils_refs.is_empty(),
                "Should have references in utils.py"
            );
            assert!(
                !main_refs.is_empty(),
                "Should have references in main.py"
            );
        }
    }
}
