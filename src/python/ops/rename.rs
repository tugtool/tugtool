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

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tempfile::TempDir;
use thiserror::Error;

use crate::diff::generate_unified_diff;
use crate::facts::{FactsStore, ReferenceKind};
use crate::output::{Location, ReferenceInfo, SymbolInfo};
use crate::patch::{FileId, MaterializedPatch, OutputEdit, Span};
use crate::python::analyzer::PythonAdapter;
use crate::python::dynamic::{collect_dynamic_warnings, DynamicMode, DynamicWarning};
use crate::python::files::{read_file, FileError};
use crate::python::lookup::{find_symbol_at_location, symbol_to_info, LookupError};
use crate::python::ops::PythonOpContext;
use crate::python::validation::{validate_python_identifier, ValidationError};
use crate::python::verification::{
    run_verification, VerificationError, VerificationMode, VerificationResult, VerificationStatus,
};
use crate::python::worker::{spawn_worker, WorkerError};
use crate::session::Session;
use crate::text::byte_offset_to_position_str;
use crate::util::{generate_snapshot_id, generate_undo_token};

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

// Note: Location, Symbol, and Reference are now imported from crate::output
// per the 26.0.7 JSON Output Schema specification (Type consolidation Option A).
// The types were migrated to provide a single source of truth for output types.

// Helper function symbol_to_info is now in crate::python::lookup

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
                                let sp =
                                    crate::patch::Span::new(span.start as u64, span.end as u64);
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
            let (line, col) = crate::text::byte_offset_to_position_str(&content, span.start);
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
        use crate::text::position_to_byte_offset_str;

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
        use crate::python::test_helpers::require_python_with_libcst;
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
}
