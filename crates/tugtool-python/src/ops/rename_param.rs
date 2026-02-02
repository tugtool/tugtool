//! Python rename_param operation.
//!
//! This module implements parameter renaming for Python functions:
//!
//! 1. Find parameter at the given location
//! 2. Validate it's a parameter symbol (not a variable, function, etc.)
//! 3. Find the containing function
//! 4. Collect all references to the parameter within the function body
//! 5. Find call sites to the function and their keyword arguments
//! 6. Generate edits for:
//!    - Parameter definition in the function signature
//!    - References within the function body
//!    - Keyword argument names at call sites
//! 7. Apply edits and verify syntax
//!
//! See [`analyze_param`] and [`rename_param`] for the main entry points.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;

use serde::{Deserialize, Serialize};
use tempfile::TempDir;
use thiserror::Error;

use tugtool_core::facts::{FactsStore, ParamKind, SymbolId, SymbolKind};
use tugtool_core::output::Location;
use tugtool_core::patch::{FileId, MaterializedPatch, OutputEdit, Span};
use tugtool_core::text::byte_offset_to_position_str;
use tugtool_core::util::{generate_snapshot_id, generate_undo_token};

use crate::analyzer::analyze_files;
use crate::files::FileError;
use crate::lookup::{find_symbol_at_location, LookupError};
use crate::stubs::{StringAnnotationParser, StubDiscovery, StubDiscoveryOptions};
use crate::validation::{validate_python_identifier, ValidationError};
use crate::verification::{
    run_verification, VerificationError, VerificationMode, VerificationResult, VerificationStatus,
};

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during rename-param operations.
#[derive(Debug, Error)]
pub enum RenameParamError {
    /// Symbol at location is not a parameter.
    #[error("symbol at location is not a parameter (found {found})")]
    NotAParameter { found: String },

    /// Cannot rename positional-only parameter (Python 3.8+ `/` syntax).
    /// Positional-only parameters cannot be used as keyword arguments.
    #[error("cannot rename positional-only parameter '{name}' - keyword args not allowed")]
    PositionalOnlyParameter { name: String },

    /// Cannot rename *args parameter.
    #[error("cannot rename *args parameter '{name}'")]
    VarArgsParameter { name: String },

    /// Cannot rename **kwargs parameter.
    #[error("cannot rename **kwargs parameter '{name}'")]
    KwArgsParameter { name: String },

    /// Containing function not found.
    #[error("cannot find containing function for parameter '{name}'")]
    ContainingFunctionNotFound { name: String },

    /// Invalid new name (syntax error).
    #[error("invalid name: {0}")]
    InvalidName(#[from] ValidationError),

    /// New name conflicts with existing parameter.
    #[error("new name '{new_name}' conflicts with existing parameter")]
    NameConflict { new_name: String },

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

    /// Analysis failed for some files.
    #[error("cannot perform rename: {count} file(s) failed analysis: {}", files.join(", "))]
    AnalysisFailed { count: usize, files: Vec<String> },

    /// CST error.
    #[error("CST error: {0}")]
    Cst(#[from] crate::cst_bridge::CstBridgeError),

    /// Verification failed.
    #[error("verification failed ({status:?}): {output}")]
    VerificationFailed {
        status: VerificationStatus,
        output: String,
    },

    /// Stub parse error.
    #[error("stub parse error: {0}")]
    StubError(#[from] crate::stubs::StubError),
}

impl From<VerificationError> for RenameParamError {
    fn from(e: VerificationError) -> Self {
        match e {
            VerificationError::Failed { status, output } => {
                RenameParamError::VerificationFailed { status, output }
            }
            VerificationError::Io(e) => RenameParamError::Io(e),
        }
    }
}

/// Result type for rename-param operations.
pub type RenameParamResult<T> = Result<T, RenameParamError>;

// ============================================================================
// Analysis Types
// ============================================================================

/// Information about a parameter rename impact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamImpactAnalysis {
    /// The parameter being renamed.
    pub parameter: ParamInfo,
    /// The function containing the parameter.
    pub function: FunctionInfo,
    /// References to the parameter within the function body.
    pub body_references: Vec<ReferenceLocation>,
    /// Call sites that use this parameter as a keyword argument.
    pub keyword_arg_usages: Vec<KeywordArgUsage>,
    /// Total number of edits that will be made.
    pub total_edits: usize,
    /// Files that will be affected.
    pub files_affected: Vec<String>,
}

/// Information about the parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamInfo {
    /// Parameter name.
    pub name: String,
    /// Parameter kind (regular, keyword_only, positional_only, etc.).
    pub kind: String,
    /// Location of the parameter definition.
    pub location: Location,
}

/// Information about the containing function.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionInfo {
    /// Function name.
    pub name: String,
    /// Function location.
    pub location: Location,
    /// Whether this is a method (inside a class).
    pub is_method: bool,
}

/// A reference location within the function body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceLocation {
    /// File path.
    pub file: String,
    /// Line number (1-based).
    pub line: u32,
    /// Column number (1-based).
    pub col: u32,
}

/// A keyword argument usage at a call site.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordArgUsage {
    /// File path.
    pub file: String,
    /// Line number (1-based).
    pub line: u32,
    /// Column number (1-based).
    pub col: u32,
    /// The full call expression (for context).
    pub call_context: Option<String>,
}

// ============================================================================
// Output Types
// ============================================================================

/// Rename parameter result (after running the operation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameParamOutput {
    /// Status.
    pub status: String,
    /// Schema version.
    pub schema_version: String,
    /// Snapshot ID.
    pub snapshot_id: String,
    /// Patch information (uses shared types from patch.rs).
    pub patch: MaterializedPatch,
    /// Summary.
    pub summary: RenameParamSummary,
    /// Verification result.
    pub verification: VerificationResult,
    /// Undo token.
    pub undo_token: String,
    /// Whether changes were applied (present when --apply used).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied: Option<bool>,
    /// Files that were modified (present when --apply used).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_written: Option<Vec<String>>,
}

/// Rename parameter summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameParamSummary {
    /// Number of files changed.
    pub files_changed: usize,
    /// Number of edits.
    pub edits_count: usize,
    /// Bytes added.
    pub bytes_added: i64,
    /// Bytes removed.
    pub bytes_removed: i64,
    /// Number of body references renamed.
    pub body_references: usize,
    /// Number of keyword arguments renamed.
    pub keyword_args: usize,
}

// ============================================================================
// Internal Types
// ============================================================================

/// Internal representation of an edit to be applied.
#[derive(Debug, Clone)]
#[allow(dead_code)] // Used for debugging and future expansion
struct ParamEdit {
    /// File ID.
    file_id: FileId,
    /// Byte span to replace.
    span: Span,
    /// Edit kind (for debugging/logging).
    kind: ParamEditKind,
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)] // Used for debugging and future expansion
enum ParamEditKind {
    /// Parameter definition in function signature.
    Definition,
    /// Reference in function body.
    BodyReference,
    /// Keyword argument at call site.
    KeywordArg,
}

// ============================================================================
// Public API
// ============================================================================

/// Analyze the impact of renaming a parameter.
///
/// This function finds the parameter at the given location, validates it can be
/// renamed, and collects all the locations that would be affected by the rename.
///
/// # Arguments
///
/// * `workspace_root` - Root directory of the workspace
/// * `files` - List of (relative_path, content) tuples
/// * `location` - Location of the parameter to rename
/// * `new_name` - New name for the parameter
///
/// # Returns
///
/// Impact analysis showing all locations that will be edited.
pub fn analyze_param(
    workspace_root: &std::path::Path,
    files: &[(String, String)],
    location: &Location,
    new_name: &str,
) -> RenameParamResult<ParamImpactAnalysis> {
    use crate::files::read_file;

    // Validate new name
    validate_python_identifier(new_name)?;

    // Build FactsStore via native 4-pass analysis
    let mut store = FactsStore::new();
    let bundle = analyze_files(files, &mut store).map_err(|e| RenameParamError::AnalyzerError {
        message: e.to_string(),
    })?;

    // Contract C7: Strict policy - fail if any files failed analysis
    if !bundle.is_complete() {
        return Err(RenameParamError::AnalysisFailed {
            count: bundle.failed_files.len(),
            files: bundle.failed_files.iter().map(|(p, _)| p.clone()).collect(),
        });
    }

    // Find symbol at location
    let symbol = find_symbol_at_location(&store, location, files)?;

    // Validate it's a parameter
    if symbol.kind != SymbolKind::Parameter {
        return Err(RenameParamError::NotAParameter {
            found: format!("{:?}", symbol.kind),
        });
    }

    // Find the containing function
    let function_symbol = find_containing_function(&store, symbol.symbol_id)?;

    // Look up parameter kind and name_span from signature
    let (param_kind, param_name_span) =
        lookup_param_in_signature(&store, function_symbol.symbol_id, &symbol.name)
            .unwrap_or((ParamKind::Regular, None)); // Fallback for edge cases

    // Validate parameter can be renamed
    match param_kind {
        ParamKind::PositionalOnly => {
            return Err(RenameParamError::PositionalOnlyParameter {
                name: symbol.name.clone(),
            });
        }
        ParamKind::VarArgs => {
            return Err(RenameParamError::VarArgsParameter {
                name: symbol.name.clone(),
            });
        }
        ParamKind::KwArgs => {
            return Err(RenameParamError::KwArgsParameter {
                name: symbol.name.clone(),
            });
        }
        ParamKind::Regular | ParamKind::KeywordOnly => {
            // These can be renamed
        }
        _ => {
            // Handle #[non_exhaustive] future variants - allow by default
        }
    }

    // Get function file content for line/col computation
    let function_file = store.file(function_symbol.decl_file_id).ok_or_else(|| {
        RenameParamError::AnalyzerError {
            message: "function file not found".to_string(),
        }
    })?;
    let function_content = read_file(workspace_root, &function_file.path)?;

    // Get parameter file content
    let param_file =
        store
            .file(symbol.decl_file_id)
            .ok_or_else(|| RenameParamError::AnalyzerError {
                message: "parameter file not found".to_string(),
            })?;
    let param_content = read_file(workspace_root, &param_file.path)?;

    // Build parameter info
    // Use name_span from signature if available (more precise for the definition)
    let definition_span = param_name_span.unwrap_or(symbol.decl_span);
    let (param_line, param_col) =
        byte_offset_to_position_str(&param_content, definition_span.start);
    let param_info = ParamInfo {
        name: symbol.name.clone(),
        kind: param_kind_to_string(param_kind).to_string(),
        location: Location {
            file: param_file.path.clone(),
            line: param_line,
            col: param_col,
            byte_start: Some(definition_span.start),
            byte_end: Some(definition_span.end),
        },
    };

    // Build function info
    let (func_line, func_col) =
        byte_offset_to_position_str(&function_content, function_symbol.decl_span.start);
    let function_info = FunctionInfo {
        name: function_symbol.name.clone(),
        location: Location {
            file: function_file.path.clone(),
            line: func_line,
            col: func_col,
            byte_start: Some(function_symbol.decl_span.start),
            byte_end: Some(function_symbol.decl_span.end),
        },
        is_method: function_symbol.container_symbol_id.is_some(),
    };

    // Collect references to the parameter within the function body
    let mut body_references = Vec::new();
    let mut edits: Vec<ParamEdit> = Vec::new();

    // Add the parameter definition itself
    // Use name_span from signature if available (more precise)
    edits.push(ParamEdit {
        file_id: symbol.decl_file_id,
        span: definition_span,
        kind: ParamEditKind::Definition,
    });

    // Collect references
    for reference in store.refs_of_symbol(symbol.symbol_id) {
        let ref_file =
            store
                .file(reference.file_id)
                .ok_or_else(|| RenameParamError::AnalyzerError {
                    message: "reference file not found".to_string(),
                })?;
        let ref_content = read_file(workspace_root, &ref_file.path)?;
        let (ref_line, ref_col) = byte_offset_to_position_str(&ref_content, reference.span.start);

        body_references.push(ReferenceLocation {
            file: ref_file.path.clone(),
            line: ref_line,
            col: ref_col,
        });

        edits.push(ParamEdit {
            file_id: reference.file_id,
            span: reference.span,
            kind: ParamEditKind::BodyReference,
        });
    }

    // Find call sites to the function and collect keyword argument usages
    let mut keyword_arg_usages = Vec::new();
    let call_sites = store.call_sites_to_callee(function_symbol.symbol_id);

    for call_site in call_sites {
        for arg in &call_site.args {
            if arg.name.as_deref() == Some(&symbol.name) {
                if let Some(kw_span) = arg.keyword_name_span {
                    let call_file = store.file(call_site.file_id).ok_or_else(|| {
                        RenameParamError::AnalyzerError {
                            message: "call site file not found".to_string(),
                        }
                    })?;
                    let call_content = read_file(workspace_root, &call_file.path)?;
                    let (call_line, call_col) =
                        byte_offset_to_position_str(&call_content, kw_span.start);

                    keyword_arg_usages.push(KeywordArgUsage {
                        file: call_file.path.clone(),
                        line: call_line,
                        col: call_col,
                        call_context: None, // TODO: extract call context
                    });

                    edits.push(ParamEdit {
                        file_id: call_site.file_id,
                        span: kw_span,
                        kind: ParamEditKind::KeywordArg,
                    });
                }
            }
        }
    }

    // Collect affected files
    let mut files_affected: HashSet<String> = HashSet::new();
    for edit in &edits {
        if let Some(file) = store.file(edit.file_id) {
            files_affected.insert(file.path.clone());
        }
    }

    Ok(ParamImpactAnalysis {
        parameter: param_info,
        function: function_info,
        body_references,
        keyword_arg_usages,
        total_edits: edits.len(),
        files_affected: files_affected.into_iter().collect(),
    })
}

/// Perform a parameter rename operation.
///
/// This function renames a function parameter across:
/// - The parameter definition in the function signature
/// - References within the function body
/// - Keyword argument names at all call sites
/// - Parameter names in .pyi stub files (per D08)
///
/// # Arguments
///
/// * `workspace_root` - Root directory of the workspace
/// * `files` - List of (relative_path, content) tuples
/// * `location` - Location of the parameter to rename
/// * `new_name` - New name for the parameter
/// * `python_path` - Path to Python interpreter (for verification)
/// * `verify_mode` - Verification mode to use
/// * `apply` - Whether to apply changes to the real workspace
///
/// # Returns
///
/// The rename result with patch, verification, and summary.
pub fn rename_param(
    workspace_root: &std::path::Path,
    files: &[(String, String)],
    location: &Location,
    new_name: &str,
    python_path: &std::path::Path,
    verify_mode: VerificationMode,
    apply: bool,
) -> RenameParamResult<RenameParamOutput> {
    use tugtool_core::diff::generate_unified_diff;

    // Validate new name
    validate_python_identifier(new_name)?;

    // Build FactsStore via native 4-pass analysis
    let mut store = FactsStore::new();
    let bundle = analyze_files(files, &mut store).map_err(|e| RenameParamError::AnalyzerError {
        message: e.to_string(),
    })?;

    // Contract C7: Strict policy - fail if any files failed analysis
    if !bundle.is_complete() {
        return Err(RenameParamError::AnalysisFailed {
            count: bundle.failed_files.len(),
            files: bundle.failed_files.iter().map(|(p, _)| p.clone()).collect(),
        });
    }

    // Find symbol at location
    let symbol = find_symbol_at_location(&store, location, files)?;

    // Validate it's a parameter
    if symbol.kind != SymbolKind::Parameter {
        return Err(RenameParamError::NotAParameter {
            found: format!("{:?}", symbol.kind),
        });
    }

    let old_name = &symbol.name;

    // Find the containing function
    let function_symbol = find_containing_function(&store, symbol.symbol_id)?;

    // Look up parameter kind and name_span from signature
    let (param_kind, param_name_span) =
        lookup_param_in_signature(&store, function_symbol.symbol_id, old_name)
            .unwrap_or((ParamKind::Regular, None));

    // Validate parameter can be renamed
    match param_kind {
        ParamKind::PositionalOnly => {
            return Err(RenameParamError::PositionalOnlyParameter {
                name: old_name.clone(),
            });
        }
        ParamKind::VarArgs => {
            return Err(RenameParamError::VarArgsParameter {
                name: old_name.clone(),
            });
        }
        ParamKind::KwArgs => {
            return Err(RenameParamError::KwArgsParameter {
                name: old_name.clone(),
            });
        }
        ParamKind::Regular | ParamKind::KeywordOnly => {
            // These can be renamed
        }
        _ => {
            // Handle #[non_exhaustive] future variants - allow by default
        }
    }

    // Check for name conflict with existing parameter
    if let Some(signature) = store.signature(function_symbol.symbol_id) {
        if signature.params.iter().any(|p| p.name == new_name) {
            return Err(RenameParamError::NameConflict {
                new_name: new_name.to_string(),
            });
        }
    }

    // Build a map from file path to content
    let file_contents: HashMap<String, &str> = files
        .iter()
        .map(|(path, content)| (path.clone(), content.as_str()))
        .collect();

    // Collect all edits: (file_path, span, new_text)
    let mut edits_by_file: HashMap<String, Vec<(Span, String)>> = HashMap::new();
    let mut body_reference_count = 0;
    let mut keyword_arg_count = 0;

    // 1. Parameter definition in signature
    let param_file =
        store
            .file(symbol.decl_file_id)
            .ok_or_else(|| RenameParamError::AnalyzerError {
                message: "parameter file not found".to_string(),
            })?;
    let definition_span = param_name_span.unwrap_or(symbol.decl_span);
    edits_by_file
        .entry(param_file.path.clone())
        .or_default()
        .push((definition_span, new_name.to_string()));

    // 2. References within the function body
    for reference in store.refs_of_symbol(symbol.symbol_id) {
        let ref_file =
            store
                .file(reference.file_id)
                .ok_or_else(|| RenameParamError::AnalyzerError {
                    message: "reference file not found".to_string(),
                })?;

        // Verify the text at the span matches old_name
        if let Some(content) = file_contents.get(&ref_file.path) {
            let start = reference.span.start;
            let end = reference.span.end;
            if end <= content.len() {
                let text_at_span = &content[start..end];
                if text_at_span == old_name {
                    edits_by_file
                        .entry(ref_file.path.clone())
                        .or_default()
                        .push((reference.span, new_name.to_string()));
                    body_reference_count += 1;
                }
            }
        }
    }

    // 3. Keyword argument names at call sites
    let call_sites = store.call_sites_to_callee(function_symbol.symbol_id);
    for call_site in call_sites {
        for arg in &call_site.args {
            if arg.name.as_deref() == Some(old_name) {
                if let Some(kw_span) = arg.keyword_name_span {
                    let call_file = store.file(call_site.file_id).ok_or_else(|| {
                        RenameParamError::AnalyzerError {
                            message: "call site file not found".to_string(),
                        }
                    })?;

                    // Verify the text at the span matches old_name
                    if let Some(content) = file_contents.get(&call_file.path) {
                        let start = kw_span.start;
                        let end = kw_span.end;
                        if end <= content.len() {
                            let text_at_span = &content[start..end];
                            if text_at_span == old_name {
                                edits_by_file
                                    .entry(call_file.path.clone())
                                    .or_default()
                                    .push((kw_span, new_name.to_string()));
                                keyword_arg_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Check for .pyi stub files and update parameter names (per D08)
    let stub_discovery = StubDiscovery::new(StubDiscoveryOptions {
        workspace_root: workspace_root.to_path_buf(),
        ..Default::default()
    });

    // Find stub for the function's file
    let function_file = store.file(function_symbol.decl_file_id).ok_or_else(|| {
        RenameParamError::AnalyzerError {
            message: "function file not found".to_string(),
        }
    })?;
    let function_file_path = workspace_root.join(&function_file.path);

    if let Some(stub_info) = stub_discovery.find_stub_for(&function_file_path) {
        // Read and parse the stub file
        let stub_content =
            fs::read_to_string(&stub_info.stub_path).map_err(RenameParamError::Io)?;

        // Parse stub to find parameter locations
        // Look for the function signature in the stub and find the parameter span
        if let Ok(stub_edits) =
            find_param_in_stub(&stub_content, &function_symbol.name, old_name, new_name)
        {
            let stub_rel_path = stub_info
                .stub_path
                .strip_prefix(workspace_root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| stub_info.stub_path.to_string_lossy().to_string());

            for (span, replacement) in stub_edits {
                edits_by_file
                    .entry(stub_rel_path.clone())
                    .or_default()
                    .push((span, replacement));
            }
        }
    }

    // 5. Check for string annotations referencing the parameter
    // (Parameters in string annotations are rare but possible in forward references)
    for file_analysis in &bundle.file_analyses {
        for annotation in &file_analysis.cst_annotations {
            // Only process string annotations with a span
            if annotation.annotation_kind != tugtool_python_cst::AnnotationKind::String {
                continue;
            }
            let annotation_span = match &annotation.annotation_span {
                Some(span) => span,
                None => continue,
            };

            if let Some(content) = file_contents.get(&file_analysis.path) {
                let start = annotation_span.start;
                let end = annotation_span.end;
                if end <= content.len() {
                    let annotation_text = &content[start..end];

                    if let Ok(contains) =
                        StringAnnotationParser::contains_name(annotation_text, old_name)
                    {
                        if contains {
                            if let Ok(renamed_annotation) =
                                StringAnnotationParser::rename(annotation_text, old_name, new_name)
                            {
                                if renamed_annotation != annotation_text {
                                    let file_edits = edits_by_file
                                        .entry(file_analysis.path.clone())
                                        .or_default();
                                    if !file_edits
                                        .iter()
                                        .any(|(s, _)| s.start == start && s.end == end)
                                    {
                                        file_edits
                                            .push((Span::new(start, end), renamed_annotation));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
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
        if src.exists() {
            fs::copy(&src, &dst)?;
        }
    }

    // Also copy stub files if they exist
    for path in edits_by_file.keys() {
        if path.ends_with(".pyi") {
            let src = workspace_root.join(path);
            let dst = sandbox.path().join(path);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent)?;
            }
            if src.exists() && !dst.exists() {
                fs::copy(&src, &dst)?;
            }
        }
    }

    // Apply edits in sandbox
    let mut edit_infos = Vec::new();
    let mut total_bytes_added: i64 = 0;
    let mut total_bytes_removed: i64 = 0;

    for (path, edits) in &edits_by_file {
        let file_path = sandbox.path().join(path);

        // Read content from sandbox or from original file_contents
        let content = if file_path.exists() {
            fs::read_to_string(&file_path)?
        } else if let Some(c) = file_contents.get(path) {
            c.to_string()
        } else {
            continue;
        };

        // Deduplicate edits by span
        let mut seen_spans: HashSet<(usize, usize)> = HashSet::new();
        let mut unique_edits: Vec<_> = edits
            .iter()
            .filter(|(span, _)| seen_spans.insert((span.start, span.end)))
            .collect();

        // Sort edits by span start in reverse order
        unique_edits.sort_by(|a, b| b.0.start.cmp(&a.0.start));

        let mut new_content = content.clone();
        for (span, replacement) in &unique_edits {
            let start = span.start;
            let end = span.end;
            if end <= content.len() {
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
        }

        // Ensure parent directory exists
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&file_path, &new_content)?;
    }

    // Sort edit_infos by file then span start
    edit_infos.sort_by(|a, b| a.file.cmp(&b.file).then(a.span.start.cmp(&b.span.start)));

    // Run verification
    let verification = run_verification(python_path, sandbox.path(), verify_mode)?;

    if verification.status == VerificationStatus::Failed {
        return Err(RenameParamError::VerificationFailed {
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

            // Read current content
            let content = if file_path.exists() {
                fs::read_to_string(&file_path)?
            } else if let Some(c) = file_contents.get(path) {
                c.to_string()
            } else {
                continue;
            };

            // Deduplicate and sort edits
            let mut seen_spans: HashSet<(usize, usize)> = HashSet::new();
            let mut unique_edits: Vec<_> = edits
                .iter()
                .filter(|(span, _)| seen_spans.insert((span.start, span.end)))
                .collect();
            unique_edits.sort_by(|a, b| b.0.start.cmp(&a.0.start));

            let mut new_content = content.clone();
            for (span, replacement) in &unique_edits {
                let start = span.start;
                let end = span.end;
                if end <= content.len() {
                    new_content = format!(
                        "{}{}{}",
                        &new_content[..start],
                        replacement,
                        &new_content[end..]
                    );
                }
            }

            // Ensure parent directory exists
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent)?;
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

    Ok(RenameParamOutput {
        status: "ok".to_string(),
        schema_version: "1".to_string(),
        snapshot_id,
        patch: MaterializedPatch {
            unified_diff,
            edits: edit_infos,
        },
        summary: RenameParamSummary {
            files_changed: edits_by_file.len(),
            edits_count: edits_by_file.values().map(|e| e.len()).sum(),
            bytes_added: total_bytes_added,
            bytes_removed: total_bytes_removed,
            body_references: body_reference_count,
            keyword_args: keyword_arg_count,
        },
        verification,
        undo_token,
        applied: if apply { Some(true) } else { None },
        files_written,
    })
}

/// Find parameter spans in a stub file that need to be renamed.
///
/// This function parses the stub content looking for the function signature
/// and finds the parameter that needs to be renamed.
fn find_param_in_stub(
    stub_content: &str,
    function_name: &str,
    old_param_name: &str,
    new_param_name: &str,
) -> RenameParamResult<Vec<(Span, String)>> {
    use tugtool_python_cst::{parse_module_with_positions, StubSymbols};

    let parsed = parse_module_with_positions(stub_content, None).map_err(|e| {
        RenameParamError::AnalyzerError {
            message: format!("failed to parse stub: {}", e),
        }
    })?;

    let stub_symbols = StubSymbols::collect(&parsed.module, &parsed.positions);

    let mut edits = Vec::new();

    // Look for the function in stub symbols
    for func in &stub_symbols.functions {
        if func.name == function_name {
            // Find the parameter
            for param in &func.params {
                if param.name == old_param_name {
                    if let Some(name_span) = param.name_span {
                        edits.push((name_span, new_param_name.to_string()));
                    }
                }
            }
        }
    }

    // Also check methods inside classes
    for class in &stub_symbols.classes {
        for method in &class.methods {
            if method.name == function_name {
                for param in &method.params {
                    if param.name == old_param_name {
                        if let Some(name_span) = param.name_span {
                            edits.push((name_span, new_param_name.to_string()));
                        }
                    }
                }
            }
        }
    }

    Ok(edits)
}

// ============================================================================
// Internal Functions
// ============================================================================

/// Find the function symbol that contains a parameter.
///
/// Parameters are always scoped to their containing function. This function
/// uses scope-based lookup to find the function scope containing the parameter,
/// then finds the function symbol within that scope.
fn find_containing_function(
    store: &FactsStore,
    param_symbol_id: SymbolId,
) -> RenameParamResult<tugtool_core::facts::Symbol> {
    let param = store
        .symbol(param_symbol_id)
        .ok_or_else(|| RenameParamError::AnalyzerError {
            message: "parameter symbol not found".to_string(),
        })?;

    // Use scope_at_position to find the scope containing the parameter
    // This returns the innermost scope (which should be the function scope)
    let scope = store
        .scope_at_position(param.decl_file_id, param.decl_span.start)
        .ok_or_else(|| RenameParamError::ContainingFunctionNotFound {
            name: param.name.clone(),
        })?;

    // The scope should be a Function or Class scope (for methods)
    // Find the function/method symbol whose decl_span is within this scope
    for symbol in store.symbols_in_file(param.decl_file_id) {
        if (symbol.kind == SymbolKind::Function || symbol.kind == SymbolKind::Method)
            && scope.span.start <= symbol.decl_span.start
            && symbol.decl_span.end <= scope.span.end
        {
            return Ok(symbol.clone());
        }
    }

    Err(RenameParamError::ContainingFunctionNotFound {
        name: param.name.clone(),
    })
}

/// Look up parameter kind and name_span from the function's signature.
///
/// Returns (param_kind, name_span) if found.
fn lookup_param_in_signature(
    store: &FactsStore,
    function_symbol_id: SymbolId,
    param_name: &str,
) -> Option<(ParamKind, Option<Span>)> {
    let signature = store.signature(function_symbol_id)?;
    let param = signature.params.iter().find(|p| p.name == param_name)?;
    Some((param.kind, param.name_span))
}

/// Convert ParamKind to a consistent snake_case string for JSON output.
fn param_kind_to_string(kind: ParamKind) -> &'static str {
    match kind {
        ParamKind::Regular => "regular",
        ParamKind::PositionalOnly => "positional_only",
        ParamKind::KeywordOnly => "keyword_only",
        ParamKind::VarArgs => "var_args",
        ParamKind::KwArgs => "kw_args",
        _ => "unknown", // Handle #[non_exhaustive] future variants
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tempfile::TempDir;

    /// Create a temporary workspace with the given files.
    fn create_temp_workspace(files: &[(&str, &str)]) -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let workspace = temp_dir.path().to_path_buf();
        for (path, content) in files {
            let file_path = workspace.join(path);
            if let Some(parent) = file_path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&file_path, content).unwrap();
        }
        (temp_dir, workspace)
    }

    // ========================================================================
    // Unit tests for param_kind_to_string
    // ========================================================================

    #[test]
    fn test_param_kind_to_string_regular() {
        assert_eq!(param_kind_to_string(ParamKind::Regular), "regular");
    }

    #[test]
    fn test_param_kind_to_string_positional_only() {
        assert_eq!(
            param_kind_to_string(ParamKind::PositionalOnly),
            "positional_only"
        );
    }

    #[test]
    fn test_param_kind_to_string_keyword_only() {
        assert_eq!(param_kind_to_string(ParamKind::KeywordOnly), "keyword_only");
    }

    #[test]
    fn test_param_kind_to_string_var_args() {
        assert_eq!(param_kind_to_string(ParamKind::VarArgs), "var_args");
    }

    #[test]
    fn test_param_kind_to_string_kw_args() {
        assert_eq!(param_kind_to_string(ParamKind::KwArgs), "kw_args");
    }

    // ========================================================================
    // Tests for regular parameter renaming (should succeed)
    // ========================================================================

    #[test]
    fn test_rename_param_regular_succeeds() {
        let code = r#"def greet(name):
    return f"Hello, {name}"
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 11, // 'name' parameter
            byte_start: None,
            byte_end: None,
        };

        let result = analyze_param(&workspace, &files, &location, "person");
        assert!(result.is_ok(), "rename regular param should succeed");

        let analysis = result.unwrap();
        assert_eq!(analysis.parameter.kind, "regular");
        assert_eq!(analysis.parameter.name, "name");
    }

    #[test]
    fn test_rename_param_keyword_only_succeeds() {
        let code = r#"def greet(*, name):
    return f"Hello, {name}"
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 14, // 'name' keyword-only parameter
            byte_start: None,
            byte_end: None,
        };

        let result = analyze_param(&workspace, &files, &location, "person");
        assert!(result.is_ok(), "rename keyword-only param should succeed");

        let analysis = result.unwrap();
        assert_eq!(analysis.parameter.kind, "keyword_only");
    }

    // ========================================================================
    // Tests for non-renamable parameters (should fail)
    // ========================================================================

    #[test]
    fn test_rename_param_positional_only_fails() {
        let code = r#"def greet(name, /):
    return f"Hello, {name}"
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 11, // 'name' positional-only parameter
            byte_start: None,
            byte_end: None,
        };

        let result = analyze_param(&workspace, &files, &location, "person");
        assert!(result.is_err());
        let err = result.unwrap_err();
        match err {
            RenameParamError::PositionalOnlyParameter { name } => {
                assert_eq!(name, "name");
            }
            other => panic!("expected PositionalOnlyParameter error, got {:?}", other),
        }
    }

    #[test]
    fn test_rename_param_varargs_fails() {
        let code = r#"def greet(*args):
    return ", ".join(args)
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 12, // 'args' varargs parameter
            byte_start: None,
            byte_end: None,
        };

        let result = analyze_param(&workspace, &files, &location, "names");
        assert!(result.is_err());
        let err = result.unwrap_err();
        match err {
            RenameParamError::VarArgsParameter { name } => {
                assert_eq!(name, "args");
            }
            other => panic!("expected VarArgsParameter error, got {:?}", other),
        }
    }

    #[test]
    fn test_rename_param_kwargs_fails() {
        let code = r#"def greet(**kwargs):
    return kwargs.get("name", "World")
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 14, // 'kwargs' kwargs parameter
            byte_start: None,
            byte_end: None,
        };

        let result = analyze_param(&workspace, &files, &location, "options");
        assert!(result.is_err());
        let err = result.unwrap_err();
        match err {
            RenameParamError::KwArgsParameter { name } => {
                assert_eq!(name, "kwargs");
            }
            other => panic!("expected KwArgsParameter error, got {:?}", other),
        }
    }

    // ========================================================================
    // Tests for JSON output format
    // ========================================================================

    #[test]
    fn test_rename_param_kind_in_output() {
        // Test all valid kinds show up correctly in output
        let code = r#"def mixed(a, b, /, c, *, d, **e):
    return a + b + c + d
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];

        // Test 'c' - regular parameter (at column 20)
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 20, // 'c' regular parameter
            byte_start: None,
            byte_end: None,
        };
        let result = analyze_param(&workspace, &files, &location, "c_new");
        assert!(result.is_ok(), "should find 'c'");
        let analysis = result.unwrap();
        assert_eq!(analysis.parameter.kind, "regular");

        // Test 'd' - keyword-only parameter (at column 26)
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 26, // 'd' keyword-only parameter
            byte_start: None,
            byte_end: None,
        };
        let result = analyze_param(&workspace, &files, &location, "d_new");
        assert!(result.is_ok(), "should find 'd'");
        let analysis = result.unwrap();
        assert_eq!(analysis.parameter.kind, "keyword_only");
    }

    // ========================================================================
    // Integration tests - complex signatures
    // ========================================================================

    #[test]
    fn test_analyze_param_complex_signature() {
        // Complex signature with all param kinds
        let code = r#"def process(pos1, pos2, /, regular, *args, kwonly, **kwargs):
    pass
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];

        // Test regular param 'regular' (starts at column 28)
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 28, // 'regular' parameter
            byte_start: None,
            byte_end: None,
        };
        let result = analyze_param(&workspace, &files, &location, "item");
        assert!(result.is_ok());
        assert_eq!(result.unwrap().parameter.kind, "regular");

        // Test kwonly param 'kwonly' (starts at column 44)
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 44, // 'kwonly' parameter
            byte_start: None,
            byte_end: None,
        };
        let result = analyze_param(&workspace, &files, &location, "kw");
        assert!(result.is_ok());
        assert_eq!(result.unwrap().parameter.kind, "keyword_only");
    }

    #[test]
    fn test_rename_param_mixed_signature() {
        // Test that renaming one valid param in a mixed signature works
        let code = r#"def func(x, /, y, *, z):
    return x + y + z

result = func(1, 2, z=3)
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];

        // Rename 'y' (regular) - should succeed (at column 16)
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 16, // 'y' regular parameter
            byte_start: None,
            byte_end: None,
        };
        let result = analyze_param(&workspace, &files, &location, "y_new");
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert_eq!(analysis.parameter.kind, "regular");
        assert_eq!(analysis.parameter.name, "y");

        // Rename 'z' (keyword-only) - should succeed (at column 22)
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 22, // 'z' keyword-only parameter
            byte_start: None,
            byte_end: None,
        };
        let result = analyze_param(&workspace, &files, &location, "z_new");
        assert!(result.is_ok());
        let analysis = result.unwrap();
        assert_eq!(analysis.parameter.kind, "keyword_only");
        assert_eq!(analysis.parameter.name, "z");

        // Rename 'x' (positional-only) - should fail (at column 10)
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 10, // 'x' positional-only parameter
            byte_start: None,
            byte_end: None,
        };
        let result = analyze_param(&workspace, &files, &location, "x_new");
        assert!(matches!(
            result,
            Err(RenameParamError::PositionalOnlyParameter { .. })
        ));
    }

    // ========================================================================
    // Error message tests
    // ========================================================================

    #[test]
    fn test_error_message_positional_only() {
        let err = RenameParamError::PositionalOnlyParameter {
            name: "x".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("positional-only"));
        assert!(msg.contains("keyword args not allowed"));
        assert!(msg.contains("'x'"));
    }

    #[test]
    fn test_error_message_varargs() {
        let err = RenameParamError::VarArgsParameter {
            name: "args".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("*args"));
        assert!(msg.contains("'args'"));
    }

    #[test]
    fn test_error_message_kwargs() {
        let err = RenameParamError::KwArgsParameter {
            name: "kwargs".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("**kwargs"));
        assert!(msg.contains("'kwargs'"));
    }

    // ========================================================================
    // Integration tests for rename_param (actual rename execution)
    // ========================================================================

    #[test]
    fn test_rename_param_basic() {
        // Test basic parameter rename with body references
        let code = r#"def greet(name):
    message = f"Hello, {name}"
    return message

result = greet(name="World")
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 11, // 'name' parameter
            byte_start: None,
            byte_end: None,
        };

        // Use a mock python path for verification
        let python_path = PathBuf::from("/usr/bin/python3");
        let result = rename_param(
            &workspace,
            &files,
            &location,
            "recipient",
            &python_path,
            VerificationMode::None, // Skip verification for test
            false,                  // Don't apply
        );

        assert!(result.is_ok(), "rename_param should succeed: {:?}", result);
        let output = result.unwrap();

        // Check that edits were generated
        assert!(output.summary.edits_count > 0, "should have edits");
        assert!(
            output.summary.body_references > 0,
            "should have body references"
        );
        assert!(output.summary.keyword_args > 0, "should have keyword args");

        // Check that the diff contains the renames
        let diff = &output.patch.unified_diff;
        assert!(diff.contains("recipient"), "diff should contain new name");
    }

    #[test]
    fn test_rename_param_keyword_only() {
        // Test keyword-only parameter rename
        let code = r#"def process(*, config):
    return config.get("value")

result = process(config={"value": 42})
"#;
        let (_temp, workspace) = create_temp_workspace(&[("main.py", code)]);
        let files = vec![("main.py".to_string(), code.to_string())];
        // "def process(*, config):" - 'config' starts at column 16 (1-indexed)
        let location = Location {
            file: "main.py".to_string(),
            line: 1,
            col: 16, // 'config' keyword-only parameter
            byte_start: None,
            byte_end: None,
        };

        let python_path = PathBuf::from("/usr/bin/python3");
        let result = rename_param(
            &workspace,
            &files,
            &location,
            "settings",
            &python_path,
            VerificationMode::None,
            false,
        );

        assert!(
            result.is_ok(),
            "rename keyword-only param should succeed: {:?}",
            result
        );
        let output = result.unwrap();

        // Check that keyword arg at call site was renamed
        assert!(
            output.summary.keyword_args > 0,
            "should rename keyword arg at call site"
        );
    }

    #[test]
    fn test_rename_param_updates_stub() {
        // Test that .pyi stub files are updated
        let code = r#"def process(data):
    return data
"#;
        let stub = r#"def process(data: dict) -> dict: ...
"#;
        let (_temp, workspace) =
            create_temp_workspace(&[("module.py", code), ("module.pyi", stub)]);
        let files = vec![("module.py".to_string(), code.to_string())];
        let location = Location {
            file: "module.py".to_string(),
            line: 1,
            col: 13, // 'data' parameter
            byte_start: None,
            byte_end: None,
        };

        let python_path = PathBuf::from("/usr/bin/python3");
        let result = rename_param(
            &workspace,
            &files,
            &location,
            "items",
            &python_path,
            VerificationMode::None,
            false,
        );

        assert!(
            result.is_ok(),
            "rename_param with stub should succeed: {:?}",
            result
        );
        let output = result.unwrap();

        // Check that stub file was included in edits
        let has_stub_edit = output.patch.edits.iter().any(|e| e.file.ends_with(".pyi"));
        assert!(has_stub_edit, "should have edit in .pyi stub file");
    }
}
