// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Python extract-constant operation.
//!
//! This module implements extracting a literal expression into a module-level constant:
//!
//! 1. Parse the source and build a position index
//! 2. Find the literal expression at the given location
//! 3. Validate it's a supported literal type (int, float, string, bool, None)
//! 4. Find the insertion point (after imports, before first definition)
//! 5. Generate or validate the constant name (warn if not UPPER_SNAKE_CASE)
//! 6. Check for name conflicts with existing module-level names
//! 7. Create edits:
//!    - Insert constant assignment at module level
//!    - Replace literal with constant reference
//! 8. Apply edits and verify syntax
//!
//! See [`extract_constant`] for the main entry point.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tempfile::TempDir;
use thiserror::Error;

use tugtool_core::diff::generate_unified_diff;
use tugtool_core::facts::FactsStore;
use tugtool_core::patch::{FileId, MaterializedPatch, OutputEdit, Span};
use tugtool_core::types::Location;
use tugtool_core::util::{generate_snapshot_id, generate_undo_token};
use tugtool_python_cst::parse_module_with_positions;
use tugtool_python_cst::visitor::{
    BatchEditOptions, BatchSpanEditor, EditPrimitive, NodeKind, PositionIndex,
};

use crate::analyzer::analyze_files;
use crate::files::FileError;
use crate::layers::expression::ExpressionBoundaryDetector;
use crate::validation::{validate_python_identifier, ValidationError};
use crate::verification::{
    run_verification, VerificationError, VerificationMode, VerificationResult, VerificationStatus,
};

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during extract-constant operations.
#[derive(Debug, Error)]
pub enum ExtractConstantError {
    /// No literal found at the given location.
    #[error("no literal expression found at {location}")]
    NoLiteralFound { location: String },

    /// Expression is not a literal type.
    #[error("expression at {location} is not a supported literal type (found {found})")]
    NotALiteral { location: String, found: String },

    /// Invalid constant name.
    #[error("invalid constant name: {0}")]
    InvalidName(#[from] ValidationError),

    /// Name conflicts with existing module-level name.
    #[error("name '{name}' already exists at module level")]
    NameConflict { name: String },

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] io::Error),

    /// File error.
    #[error("file error: {0}")]
    File(#[from] FileError),

    /// Parse error.
    #[error("parse error: {message}")]
    ParseError { message: String },

    /// Analyzer error.
    #[error("analyzer error: {message}")]
    AnalyzerError { message: String },

    /// Analysis failed for some files.
    #[error("cannot perform extract: {count} file(s) failed analysis: {}", files.join(", "))]
    AnalysisFailed { count: usize, files: Vec<String> },

    /// Verification failed.
    #[error("verification failed ({status:?}): {output}")]
    VerificationFailed {
        status: VerificationStatus,
        output: String,
    },

    /// File not found in workspace.
    #[error("file not found: {path}")]
    FileNotFound { path: String },

    /// Edit error.
    #[error("edit error: {message}")]
    EditError { message: String },
}

impl From<VerificationError> for ExtractConstantError {
    fn from(e: VerificationError) -> Self {
        match e {
            VerificationError::Failed { status, output } => {
                ExtractConstantError::VerificationFailed { status, output }
            }
            VerificationError::Io(e) => ExtractConstantError::Io(e),
        }
    }
}

/// Result type for extract-constant operations.
pub type ExtractConstantResult<T> = Result<T, ExtractConstantError>;

// ============================================================================
// Output Types
// ============================================================================

/// Extract constant result (after running the operation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractConstantOutput {
    /// Status.
    pub status: String,
    /// Schema version.
    pub schema_version: String,
    /// Snapshot ID.
    pub snapshot_id: String,
    /// Patch information (uses shared types from patch.rs).
    pub patch: MaterializedPatch,
    /// Summary.
    pub summary: ExtractConstantSummary,
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
    /// Warnings (e.g., name not UPPER_SNAKE_CASE).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub warnings: Vec<String>,
}

/// Extract constant summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractConstantSummary {
    /// The generated or provided constant name.
    pub constant_name: String,
    /// The extracted literal text.
    pub literal: String,
    /// The literal type (e.g., "Integer", "String").
    pub literal_type: String,
    /// File where extraction occurred.
    pub file: String,
    /// Line where constant assignment was inserted.
    pub insertion_line: u32,
    /// Line where literal was replaced.
    pub replacement_line: u32,
    /// Number of edits (always 2: insert + replace).
    pub edits_count: usize,
    /// Bytes added.
    pub bytes_added: i64,
    /// Bytes removed.
    pub bytes_removed: i64,
}

// ============================================================================
// Analysis Output
// ============================================================================

/// Analysis result for extract-constant (preview without applying).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractConstantAnalysis {
    /// Status.
    pub status: String,
    /// Schema version.
    pub schema_version: String,
    /// The literal that would be extracted.
    pub literal: LiteralAnalysis,
    /// Suggested constant name.
    pub suggested_name: String,
    /// Insertion point information.
    pub insertion_point: ConstantInsertionPoint,
    /// Warnings (e.g., name not UPPER_SNAKE_CASE).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub warnings: Vec<String>,
}

/// Information about the literal to be extracted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiteralAnalysis {
    /// The literal text.
    pub text: String,
    /// The literal kind (e.g., "Integer", "Float", "String").
    pub kind: String,
    /// File containing the literal.
    pub file: String,
    /// Start line (1-based).
    pub start_line: u32,
    /// Start column (1-based).
    pub start_col: u32,
    /// End line (1-based).
    pub end_line: u32,
    /// End column (1-based).
    pub end_col: u32,
}

/// Information about where the constant will be inserted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstantInsertionPoint {
    /// Line number (1-based).
    pub line: u32,
    /// Description of placement (e.g., "after imports", "at module start").
    pub placement: String,
}

// ============================================================================
// Literal Type Detection
// ============================================================================

/// Supported literal types for extraction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiteralType {
    Integer,
    Float,
    String,
    Bytes,
    Boolean,
    None,
}

impl LiteralType {
    /// Check if a NodeKind represents a supported literal type.
    pub fn from_node_kind(kind: NodeKind) -> Option<Self> {
        match kind {
            NodeKind::Integer => Some(LiteralType::Integer),
            NodeKind::Float => Some(LiteralType::Float),
            NodeKind::String | NodeKind::ConcatenatedString => Some(LiteralType::String),
            // Note: Bytes literals use NodeKind::String in the CST,
            // we detect them by checking the text starts with 'b' or 'B'
            NodeKind::Name => None, // Could be True/False/None - need text check
            _ => None,
        }
    }

    /// Check if literal text represents True, False, or None.
    pub fn from_name_text(text: &str) -> Option<Self> {
        match text {
            "True" | "False" => Some(LiteralType::Boolean),
            "None" => Some(LiteralType::None),
            _ => None,
        }
    }

    /// Display name for the literal type.
    pub fn as_str(&self) -> &'static str {
        match self {
            LiteralType::Integer => "Integer",
            LiteralType::Float => "Float",
            LiteralType::String => "String",
            LiteralType::Bytes => "Bytes",
            LiteralType::Boolean => "Boolean",
            LiteralType::None => "None",
        }
    }
}

// ============================================================================
// Name Validation
// ============================================================================

/// Check if a name follows UPPER_SNAKE_CASE convention.
fn is_upper_snake_case(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }

    // Allow leading underscore(s) for "private" constants
    let name = name.trim_start_matches('_');
    if name.is_empty() {
        return false;
    }

    // Check that all characters are uppercase, digits, or underscores
    // and that we don't start with a digit
    let first_char = name.chars().next().unwrap();
    if first_char.is_ascii_digit() {
        return false;
    }

    name.chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Generate a suggested constant name from the literal.
fn suggest_constant_name(literal_text: &str, literal_type: LiteralType) -> String {
    match literal_type {
        LiteralType::Integer | LiteralType::Float => {
            // For numeric literals, suggest a generic name
            "VALUE".to_string()
        }
        LiteralType::String | LiteralType::Bytes => {
            // Try to derive a name from the string content
            // Extract the string content (remove quotes)
            let content = literal_text
                .trim_start_matches(['b', 'B', 'r', 'R'])
                .trim_start_matches(['"', '\''])
                .trim_end_matches(['"', '\'']);

            if content.is_empty() {
                "EMPTY_STRING".to_string()
            } else {
                // Take first word and uppercase it
                let first_word: String = content
                    .chars()
                    .take(20)
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if first_word.is_empty() {
                    "STRING_VALUE".to_string()
                } else {
                    first_word.to_uppercase()
                }
            }
        }
        LiteralType::Boolean => {
            if literal_text == "True" {
                "IS_ENABLED".to_string()
            } else {
                "IS_DISABLED".to_string()
            }
        }
        LiteralType::None => "DEFAULT_VALUE".to_string(),
    }
}

// ============================================================================
// Insertion Point Detection
// ============================================================================

/// Find the insertion point for a module-level constant.
///
/// Rules:
/// 1. After all imports (including TYPE_CHECKING blocks)
/// 2. Before the first class or function definition
/// 3. If constants already exist, add after them (preserve grouping)
fn find_constant_insertion_point(
    content: &str,
    index: &PositionIndex,
    store: &FactsStore,
    file_id: FileId,
) -> (usize, String) {
    // Get all imports in the file
    let imports = store.imports_in_file_vec(file_id);

    // Find the end of the last import
    let mut last_import_end: Option<usize> = None;
    for import in imports {
        let end = import.span.end;
        if last_import_end.is_none() || end > last_import_end.unwrap() {
            last_import_end = Some(end);
        }
    }

    // Find the first function or class definition
    let mut first_def_start: Option<usize> = None;
    for symbol in store.symbols_in_file(file_id) {
        // Check if it's a function or class at module level
        if symbol.kind == tugtool_core::facts::SymbolKind::Function
            || symbol.kind == tugtool_core::facts::SymbolKind::Class
        {
            // Only consider module-level definitions (no container = top-level)
            if symbol.container_symbol_id.is_none() {
                let start = symbol.decl_span.start;
                if first_def_start.is_none() || start < first_def_start.unwrap() {
                    first_def_start = Some(start);
                }
            }
        }
    }

    // Also check for existing module-level constants (simple assignments at top level)
    // We'll look for assignments that appear after imports but before first def
    let mut last_constant_end: Option<usize> = None;
    for symbol in store.symbols_in_file(file_id) {
        if symbol.kind == tugtool_core::facts::SymbolKind::Variable
            && symbol.container_symbol_id.is_none()
        {
            let start = symbol.decl_span.start;
            let end = symbol.decl_span.end;

            // Check if this is after imports and before first def
            let after_imports = last_import_end.is_none_or(|ie| start > ie);
            let before_first_def = first_def_start.is_none_or(|fd| start < fd);

            if after_imports && before_first_def {
                // Check if the name looks like a constant (UPPER_SNAKE_CASE)
                if is_upper_snake_case(&symbol.name) {
                    if last_constant_end.is_none() || end > last_constant_end.unwrap() {
                        last_constant_end = Some(end);
                    }
                }
            }
        }
    }

    // Determine insertion point and placement description
    let (insert_pos, placement) = if let Some(const_end) = last_constant_end {
        // Insert after existing constants
        let pos = find_line_end(content, const_end);
        (pos, "after existing constants")
    } else if let Some(import_end) = last_import_end {
        // Insert after imports
        let pos = find_line_end(content, import_end);
        (pos, "after imports")
    } else if let Some(def_start) = first_def_start {
        // Insert before first definition
        // Find the start of the line
        let line_start = content[..def_start]
            .rfind('\n')
            .map(|i| i + 1)
            .unwrap_or(0);
        (line_start, "before first definition")
    } else {
        // Empty module or only has docstring - insert at beginning
        // Skip any leading docstring
        let pos = skip_docstring(content, index);
        (pos, "at module start")
    };

    (insert_pos, placement.to_string())
}

/// Find the end of the line (position after newline).
fn find_line_end(content: &str, pos: usize) -> usize {
    content[pos..]
        .find('\n')
        .map(|i| pos + i + 1)
        .unwrap_or(content.len())
}

/// Skip any leading docstring in the module.
fn skip_docstring(content: &str, index: &PositionIndex) -> usize {
    // Find the first expression - if it's a string at position 0, it's a docstring
    if let Some(expr_info) = index.find_expression_at(0) {
        if matches!(
            expr_info.kind,
            NodeKind::String | NodeKind::ConcatenatedString
        ) {
            // Skip past the docstring
            return find_line_end(content, expr_info.span.end);
        }
    }
    0
}

// ============================================================================
// Main Implementation
// ============================================================================

/// Analyze an extract-constant operation (preview without applying).
///
/// Returns information about the literal and where the constant would be inserted.
///
/// # Arguments
///
/// * `files` - List of (path, content) pairs for files to analyze
/// * `location` - Location of the literal to extract
/// * `name` - Optional constant name (will suggest one if not provided)
pub fn analyze_extract_constant(
    files: &[(String, String)],
    location: &Location,
    name: Option<&str>,
) -> ExtractConstantResult<ExtractConstantAnalysis> {
    // Find the file
    let (file_path, content) =
        files
            .iter()
            .find(|(p, _)| p == &location.file)
            .ok_or_else(|| ExtractConstantError::FileNotFound {
                path: location.file.clone(),
            })?;

    // Parse the file with position tracking
    let parsed = parse_module_with_positions(content, None).map_err(|e| {
        ExtractConstantError::ParseError {
            message: e.to_string(),
        }
    })?;

    // Build position index
    let index = PositionIndex::build(&parsed.module, &parsed.positions, content);

    // Calculate byte offset from line:col
    let offset = location_to_offset(content, location)?;

    // Find expression at location
    let detector = ExpressionBoundaryDetector::new(&index);
    let expr_boundary =
        detector
            .find_at(offset)
            .ok_or_else(|| ExtractConstantError::NoLiteralFound {
                location: format!("{}:{}:{}", location.file, location.line, location.col),
            })?;

    // Extract literal text
    let literal_text = &content[expr_boundary.span.start..expr_boundary.span.end];

    // Check if it's a supported literal type
    let literal_type = if let Some(lt) = LiteralType::from_node_kind(expr_boundary.kind) {
        // Check if it's a bytes literal (starts with b/B)
        if lt == LiteralType::String
            && (literal_text.starts_with('b') || literal_text.starts_with('B'))
        {
            LiteralType::Bytes
        } else {
            lt
        }
    } else if expr_boundary.kind == NodeKind::Name {
        // Check for True/False/None
        LiteralType::from_name_text(literal_text).ok_or_else(|| {
            ExtractConstantError::NotALiteral {
                location: format!("{}:{}:{}", location.file, location.line, location.col),
                found: format!("{:?}", expr_boundary.kind),
            }
        })?
    } else {
        return Err(ExtractConstantError::NotALiteral {
            location: format!("{}:{}:{}", location.file, location.line, location.col),
            found: format!("{:?}", expr_boundary.kind),
        });
    };

    // Run analysis to get facts
    let mut store = FactsStore::new();
    let _ = analyze_files(files, &mut store);
    let file_id = FileId::new(0);

    // Generate or validate name
    let mut warnings = Vec::new();
    let const_name = if let Some(n) = name {
        validate_python_identifier(n)?;
        if !is_upper_snake_case(n) {
            warnings.push(format!(
                "constant name '{}' does not follow UPPER_SNAKE_CASE convention",
                n
            ));
        }
        n.to_string()
    } else {
        suggest_constant_name(literal_text, literal_type)
    };

    // Check for name conflicts
    for symbol in store.symbols_in_file(file_id) {
        if symbol.name == const_name && symbol.container_symbol_id.is_none() {
            return Err(ExtractConstantError::NameConflict { name: const_name });
        }
    }

    // Find insertion point
    let (insert_pos, placement) = find_constant_insertion_point(content, &index, &store, file_id);

    // Calculate line numbers
    let (start_line, start_col) = offset_to_line_col(content, expr_boundary.span.start);
    let (end_line, end_col) = offset_to_line_col(content, expr_boundary.span.end);
    let (insert_line, _) = offset_to_line_col(content, insert_pos);

    Ok(ExtractConstantAnalysis {
        status: "ok".to_string(),
        schema_version: "1".to_string(),
        literal: LiteralAnalysis {
            text: literal_text.to_string(),
            kind: literal_type.as_str().to_string(),
            file: file_path.clone(),
            start_line,
            start_col,
            end_line,
            end_col,
        },
        suggested_name: const_name,
        insertion_point: ConstantInsertionPoint {
            line: insert_line,
            placement,
        },
        warnings,
    })
}

/// Execute an extract-constant operation.
///
/// # Arguments
///
/// * `workspace_root` - Workspace root directory
/// * `files` - List of (path, content) pairs for files to analyze
/// * `location` - Location of the literal to extract
/// * `name` - Constant name (required)
/// * `python_path` - Path to Python interpreter (for verification)
/// * `verify_mode` - Verification mode to use
/// * `apply` - Whether to apply changes to the real workspace
///
/// # Returns
///
/// The extract result with patch, verification, and summary.
pub fn extract_constant(
    workspace_root: &Path,
    files: &[(String, String)],
    location: &Location,
    name: &str,
    python_path: &Path,
    verify_mode: VerificationMode,
    apply: bool,
) -> ExtractConstantResult<ExtractConstantOutput> {
    // Validate name
    validate_python_identifier(name)?;

    // Collect warnings
    let mut warnings = Vec::new();
    if !is_upper_snake_case(name) {
        warnings.push(format!(
            "constant name '{}' does not follow UPPER_SNAKE_CASE convention",
            name
        ));
    }

    // Find the file
    let (file_path, content) =
        files
            .iter()
            .find(|(p, _)| p == &location.file)
            .ok_or_else(|| ExtractConstantError::FileNotFound {
                path: location.file.clone(),
            })?;

    // Parse the file with position tracking
    let parsed = parse_module_with_positions(content, None).map_err(|e| {
        ExtractConstantError::ParseError {
            message: e.to_string(),
        }
    })?;

    // Build position index
    let index = PositionIndex::build(&parsed.module, &parsed.positions, content);

    // Calculate byte offset from line:col
    let offset = location_to_offset(content, location)?;

    // Find expression at location
    let detector = ExpressionBoundaryDetector::new(&index);
    let expr_boundary =
        detector
            .find_at(offset)
            .ok_or_else(|| ExtractConstantError::NoLiteralFound {
                location: format!("{}:{}:{}", location.file, location.line, location.col),
            })?;

    // Extract literal text
    let literal_text = &content[expr_boundary.span.start..expr_boundary.span.end];

    // Check if it's a supported literal type
    let literal_type = if let Some(lt) = LiteralType::from_node_kind(expr_boundary.kind) {
        // Check if it's a bytes literal (starts with b/B)
        if lt == LiteralType::String
            && (literal_text.starts_with('b') || literal_text.starts_with('B'))
        {
            LiteralType::Bytes
        } else {
            lt
        }
    } else if expr_boundary.kind == NodeKind::Name {
        // Check for True/False/None
        LiteralType::from_name_text(literal_text).ok_or_else(|| {
            ExtractConstantError::NotALiteral {
                location: format!("{}:{}:{}", location.file, location.line, location.col),
                found: format!("{:?}", expr_boundary.kind),
            }
        })?
    } else {
        return Err(ExtractConstantError::NotALiteral {
            location: format!("{}:{}:{}", location.file, location.line, location.col),
            found: format!("{:?}", expr_boundary.kind),
        });
    };

    // Run analysis to get facts
    let mut store = FactsStore::new();
    let _ = analyze_files(files, &mut store);
    let file_id = FileId::new(0);

    // Check for name conflicts
    for symbol in store.symbols_in_file(file_id) {
        if symbol.name == name && symbol.container_symbol_id.is_none() {
            return Err(ExtractConstantError::NameConflict {
                name: name.to_string(),
            });
        }
    }

    // Find insertion point
    let (insert_pos, _placement) = find_constant_insertion_point(content, &index, &store, file_id);

    // Create the constant assignment
    let assignment = format!("{} = {}\n", name, literal_text);

    // Build edits using BatchSpanEditor
    let options = BatchEditOptions {
        auto_indent: false,
        allow_adjacent: true,
        allow_empty: false,
    };

    let mut editor = BatchSpanEditor::with_options(content, options);

    // 1. Insert constant at module level
    editor.add(EditPrimitive::InsertAt {
        position: insert_pos,
        text: assignment.clone(),
    });

    // 2. Replace literal with constant reference
    editor.add(EditPrimitive::Replace {
        span: expr_boundary.span,
        new_text: name.to_string(),
    });

    // Apply edits
    let new_content = editor
        .apply()
        .map_err(|e| ExtractConstantError::EditError {
            message: e.to_string(),
        })?;

    // Calculate bytes changed
    let old_len = content.len() as i64;
    let new_len = new_content.len() as i64;
    let bytes_added = if new_len > old_len {
        new_len - old_len
    } else {
        0
    };
    let bytes_removed = if old_len > new_len {
        old_len - new_len
    } else {
        0
    };

    // Build edits map for verification
    let mut edits_by_file: HashMap<String, String> = HashMap::new();
    edits_by_file.insert(file_path.clone(), new_content.clone());

    // Create temp directory for verification
    let temp_dir = TempDir::new()?;

    // Copy all files to temp, applying our edits
    for (path, original_content) in files {
        let temp_path = temp_dir.path().join(path);
        if let Some(parent) = temp_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content_to_write = edits_by_file.get(path).unwrap_or(original_content);
        fs::write(&temp_path, content_to_write)?;
    }

    // Run verification
    let verification = run_verification(python_path, temp_dir.path(), verify_mode)?;

    // Check verification status
    if verification.status == VerificationStatus::Failed {
        // Extract output from checks if any
        let output = verification
            .checks
            .iter()
            .filter_map(|c| c.output.as_ref())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(ExtractConstantError::VerificationFailed {
            status: verification.status,
            output,
        });
    }

    // Build edit info for output
    let (insert_line, _) = offset_to_line_col(content, insert_pos);
    let (replace_line, replace_col) = offset_to_line_col(content, expr_boundary.span.start);

    let edit_infos = vec![
        OutputEdit {
            file: file_path.clone(),
            span: Span::new(insert_pos, insert_pos), // Zero-width for insertion
            old_text: String::new(),
            new_text: assignment.clone(),
            line: insert_line,
            col: 1,
        },
        OutputEdit {
            file: file_path.clone(),
            span: expr_boundary.span,
            old_text: literal_text.to_string(),
            new_text: name.to_string(),
            line: replace_line,
            col: replace_col,
        },
    ];

    // Apply changes to workspace if requested
    let files_written = if apply {
        let mut written = Vec::new();
        for (path, new_content) in &edits_by_file {
            let file_path = workspace_root.join(path);
            fs::write(&file_path, new_content)?;
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

    Ok(ExtractConstantOutput {
        status: "ok".to_string(),
        schema_version: "1".to_string(),
        snapshot_id,
        patch: MaterializedPatch {
            unified_diff,
            edits: edit_infos,
        },
        summary: ExtractConstantSummary {
            constant_name: name.to_string(),
            literal: literal_text.to_string(),
            literal_type: literal_type.as_str().to_string(),
            file: file_path.clone(),
            insertion_line: insert_line,
            replacement_line: replace_line,
            edits_count: 2,
            bytes_added,
            bytes_removed,
        },
        verification,
        undo_token,
        applied: if apply { Some(true) } else { None },
        files_written,
        warnings,
    })
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Convert a Location (file:line:col) to a byte offset.
fn location_to_offset(content: &str, location: &Location) -> ExtractConstantResult<usize> {
    let mut offset = 0;
    let mut current_line = 1u32;

    for line in content.lines() {
        if current_line == location.line {
            // Found the line, add column offset
            // Column is 1-based, so subtract 1
            let col_offset = (location.col.saturating_sub(1)) as usize;
            return Ok(offset + col_offset.min(line.len()));
        }
        offset += line.len() + 1; // +1 for newline
        current_line += 1;
    }

    // If we're past the last line, return end of content
    Ok(content.len())
}

/// Convert a byte offset to (line, col) (1-based).
fn offset_to_line_col(content: &str, offset: usize) -> (u32, u32) {
    let mut line = 1u32;
    let mut col = 1u32;
    let mut current_offset = 0;

    for ch in content.chars() {
        if current_offset >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
        current_offset += ch.len_utf8();
    }

    (line, col)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_location(file: &str, line: u32, col: u32) -> Location {
        Location {
            file: file.to_string(),
            line,
            col,
            byte_start: None,
            byte_end: None,
        }
    }

    // ------------------------------------------------------------------------
    // Name validation tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_is_upper_snake_case() {
        assert!(is_upper_snake_case("TAX_RATE"));
        assert!(is_upper_snake_case("MAX_VALUE"));
        assert!(is_upper_snake_case("X"));
        assert!(is_upper_snake_case("VALUE1"));
        assert!(is_upper_snake_case("_PRIVATE_CONST"));
        assert!(is_upper_snake_case("__DUNDER"));

        assert!(!is_upper_snake_case("taxRate"));
        assert!(!is_upper_snake_case("tax_rate"));
        assert!(!is_upper_snake_case("TaxRate"));
        assert!(!is_upper_snake_case("1VALUE"));
        assert!(!is_upper_snake_case(""));
    }

    #[test]
    fn test_suggest_constant_name() {
        assert_eq!(
            suggest_constant_name("42", LiteralType::Integer),
            "VALUE"
        );
        assert_eq!(
            suggest_constant_name("3.14", LiteralType::Float),
            "VALUE"
        );
        assert_eq!(
            suggest_constant_name("\"hello\"", LiteralType::String),
            "HELLO"
        );
        assert_eq!(
            suggest_constant_name("\"\"", LiteralType::String),
            "EMPTY_STRING"
        );
        assert_eq!(
            suggest_constant_name("True", LiteralType::Boolean),
            "IS_ENABLED"
        );
        assert_eq!(
            suggest_constant_name("None", LiteralType::None),
            "DEFAULT_VALUE"
        );
    }

    // ------------------------------------------------------------------------
    // Basic extraction tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_extract_constant_number() {
        let source = r#"def calculate_tax(price):
    return price * 0.08
"#;
        let files = vec![("test.py".to_string(), source.to_string())];

        // Extract "0.08" at position of the literal
        let location = make_location("test.py", 2, 20);
        let analysis = analyze_extract_constant(&files, &location, Some("TAX_RATE"))
            .expect("analysis should succeed");

        assert_eq!(analysis.status, "ok");
        assert_eq!(analysis.suggested_name, "TAX_RATE");
        assert_eq!(analysis.literal.kind, "Float");
        assert!(analysis.warnings.is_empty());
    }

    #[test]
    fn test_extract_constant_string() {
        let source = r#"def greet():
    return "Hello, World!"
"#;
        let files = vec![("test.py".to_string(), source.to_string())];

        // Extract the string literal
        let location = make_location("test.py", 2, 12);
        let analysis = analyze_extract_constant(&files, &location, Some("GREETING"))
            .expect("analysis should succeed");

        assert_eq!(analysis.status, "ok");
        assert_eq!(analysis.suggested_name, "GREETING");
        assert_eq!(analysis.literal.kind, "String");
    }

    #[test]
    fn test_extract_constant_placement() {
        let source = r#"import os
from sys import path

def main():
    x = 42
"#;
        let files = vec![("test.py".to_string(), source.to_string())];

        // Extract "42"
        let location = make_location("test.py", 5, 9);
        let analysis = analyze_extract_constant(&files, &location, Some("MAGIC_NUMBER"))
            .expect("analysis should succeed");

        assert_eq!(analysis.status, "ok");
        // Should be placed after imports
        assert!(analysis.insertion_point.placement.contains("import"));
    }

    #[test]
    fn test_extract_constant_name_warning() {
        let source = "x = 42\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        // Use lowercase name (should warn)
        let location = make_location("test.py", 1, 5);
        let analysis = analyze_extract_constant(&files, &location, Some("magic_number"))
            .expect("analysis should succeed");

        assert_eq!(analysis.warnings.len(), 1);
        assert!(analysis.warnings[0].contains("UPPER_SNAKE_CASE"));
    }

    #[test]
    fn test_extract_constant_reject_non_literal() {
        let source = "x = foo()\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        // Try to extract function call (not a literal)
        let location = make_location("test.py", 1, 5);
        let result = analyze_extract_constant(&files, &location, Some("VALUE"));

        assert!(result.is_err());
        if let Err(ExtractConstantError::NotALiteral { .. }) = result {
            // Expected
        } else {
            panic!("Expected NotALiteral error");
        }
    }

    #[test]
    fn test_extract_constant_boolean() {
        let source = "enabled = True\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        let location = make_location("test.py", 1, 11);
        let analysis = analyze_extract_constant(&files, &location, Some("IS_ENABLED"))
            .expect("analysis should succeed");

        assert_eq!(analysis.literal.kind, "Boolean");
        assert_eq!(analysis.literal.text, "True");
    }

    #[test]
    fn test_extract_constant_none() {
        let source = "default = None\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        let location = make_location("test.py", 1, 11);
        let analysis = analyze_extract_constant(&files, &location, Some("DEFAULT_VALUE"))
            .expect("analysis should succeed");

        assert_eq!(analysis.literal.kind, "None");
        assert_eq!(analysis.literal.text, "None");
    }

    #[test]
    fn test_extract_constant_integer() {
        let source = "x = 42\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        let location = make_location("test.py", 1, 5);
        let analysis = analyze_extract_constant(&files, &location, Some("MAGIC_NUMBER"))
            .expect("analysis should succeed");

        assert_eq!(analysis.literal.kind, "Integer");
        assert_eq!(analysis.literal.text, "42");
    }
}
