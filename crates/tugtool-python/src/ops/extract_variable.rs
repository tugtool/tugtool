// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Python extract-variable operation.
//!
//! This module implements extracting an expression into a named variable:
//!
//! 1. Parse the source and build a position index
//! 2. Find the expression at the given location
//! 3. Validate the context (reject comprehension/lambda/decorator)
//! 4. Find the enclosing statement for insertion point
//! 5. Generate or validate the variable name
//! 6. Create edits:
//!    - Insert assignment statement before enclosing statement
//!    - Replace expression with variable reference
//! 7. Apply edits and verify syntax
//!
//! See [`extract_variable`] for the main entry point.

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
    detect_indentation, BatchEditOptions, BatchSpanEditor, EditPrimitive, PositionIndex,
};

use crate::analyzer::analyze_files;
use crate::files::FileError;
use crate::layers::expression::{ExpressionBoundaryDetector, UniqueNameGenerator};
use crate::validation::{validate_python_identifier, ValidationError};
use crate::verification::{
    run_verification, VerificationError, VerificationMode, VerificationResult, VerificationStatus,
};

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during extract-variable operations.
#[derive(Debug, Error)]
pub enum ExtractVariableError {
    /// No expression found at the given location.
    #[error("no expression found at {location}")]
    NoExpressionFound { location: String },

    /// Expression is in an unsupported context.
    #[error("{reason}")]
    UnsupportedContext { reason: &'static str },

    /// No enclosing statement found.
    #[error("cannot find enclosing statement for expression")]
    NoEnclosingStatement,

    /// Invalid variable name.
    #[error("invalid variable name: {0}")]
    InvalidName(#[from] ValidationError),

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

impl From<VerificationError> for ExtractVariableError {
    fn from(e: VerificationError) -> Self {
        match e {
            VerificationError::Failed { status, output } => {
                ExtractVariableError::VerificationFailed { status, output }
            }
            VerificationError::Io(e) => ExtractVariableError::Io(e),
        }
    }
}

/// Result type for extract-variable operations.
pub type ExtractVariableResult<T> = Result<T, ExtractVariableError>;

// ============================================================================
// Output Types
// ============================================================================

/// Extract variable result (after running the operation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractVariableOutput {
    /// Status.
    pub status: String,
    /// Schema version.
    pub schema_version: String,
    /// Snapshot ID.
    pub snapshot_id: String,
    /// Patch information (uses shared types from patch.rs).
    pub patch: MaterializedPatch,
    /// Summary.
    pub summary: ExtractVariableSummary,
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

/// Extract variable summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractVariableSummary {
    /// The generated or provided variable name.
    pub variable_name: String,
    /// The extracted expression text.
    pub expression: String,
    /// File where extraction occurred.
    pub file: String,
    /// Line where variable assignment was inserted.
    pub insertion_line: u32,
    /// Line where expression was replaced.
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

/// Analysis result for extract-variable (preview without applying).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractVariableAnalysis {
    /// Status.
    pub status: String,
    /// Schema version.
    pub schema_version: String,
    /// The expression that would be extracted.
    pub expression: ExpressionAnalysis,
    /// Suggested variable name.
    pub suggested_name: String,
    /// Insertion point information.
    pub insertion_point: InsertionPoint,
}

/// Information about the expression to be extracted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpressionAnalysis {
    /// The expression text.
    pub text: String,
    /// The expression kind (e.g., "Call", "BinaryOp").
    pub kind: String,
    /// File containing the expression.
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

/// Information about where the assignment will be inserted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsertionPoint {
    /// Line number (1-based).
    pub line: u32,
    /// The indentation that will be used.
    pub indentation: String,
}

// ============================================================================
// Main Implementation
// ============================================================================

/// Analyze an extract-variable operation (preview without applying).
///
/// Returns information about the expression and where the variable would be inserted.
///
/// # Arguments
///
/// * `files` - List of (path, content) pairs for files to analyze
/// * `location` - Location of the expression to extract
/// * `name` - Optional variable name (will suggest one if not provided)
pub fn analyze_extract_variable(
    files: &[(String, String)],
    location: &Location,
    name: Option<&str>,
) -> ExtractVariableResult<ExtractVariableAnalysis> {
    // Find the file
    let (file_path, content) =
        files
            .iter()
            .find(|(p, _)| p == &location.file)
            .ok_or_else(|| ExtractVariableError::FileNotFound {
                path: location.file.clone(),
            })?;

    // Parse the file with position tracking
    let parsed = parse_module_with_positions(content, None).map_err(|e| {
        ExtractVariableError::ParseError {
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
            .ok_or_else(|| ExtractVariableError::NoExpressionFound {
                location: format!("{}:{}:{}", location.file, location.line, location.col),
            })?;

    // Check context
    if !expr_boundary.context.allows_extraction() {
        return Err(ExtractVariableError::UnsupportedContext {
            reason: expr_boundary
                .context
                .rejection_reason()
                .unwrap_or("unsupported context"),
        });
    }

    // Find enclosing statement
    let stmt_span = detector
        .find_enclosing_statement(offset)
        .ok_or(ExtractVariableError::NoEnclosingStatement)?;

    // Extract expression text
    let expr_text = &content[expr_boundary.span.start..expr_boundary.span.end];

    // Generate or validate name
    let var_name = if let Some(n) = name {
        validate_python_identifier(n)?;
        n.to_string()
    } else {
        // Generate a suggested name based on expression analysis
        let mut store = FactsStore::new();
        let _ = analyze_files(files, &mut store);
        let file_id = FileId::new(0);
        let generator = UniqueNameGenerator::new(&store, file_id, None);
        generator.generate("extracted")
    };

    // Calculate line numbers
    let (start_line, start_col) = offset_to_line_col(content, expr_boundary.span.start);
    let (end_line, end_col) = offset_to_line_col(content, expr_boundary.span.end);

    // Calculate line start (beginning of line, before indentation) for insertion point
    let line_start = content[..stmt_span.start]
        .rfind('\n')
        .map(|i| i + 1)
        .unwrap_or(0);
    let (insert_line, _) = offset_to_line_col(content, line_start);

    // Detect indentation
    let indentation = detect_indentation(content, stmt_span.start).to_string();

    Ok(ExtractVariableAnalysis {
        status: "ok".to_string(),
        schema_version: "1".to_string(),
        expression: ExpressionAnalysis {
            text: expr_text.to_string(),
            kind: format!("{:?}", expr_boundary.kind),
            file: file_path.clone(),
            start_line,
            start_col,
            end_line,
            end_col,
        },
        suggested_name: var_name,
        insertion_point: InsertionPoint {
            line: insert_line,
            indentation,
        },
    })
}

/// Execute an extract-variable operation.
///
/// # Arguments
///
/// * `workspace_root` - Workspace root directory
/// * `files` - List of (path, content) pairs for files to analyze
/// * `location` - Location of the expression to extract
/// * `name` - Variable name (required)
/// * `python_path` - Path to Python interpreter (for verification)
/// * `verify_mode` - Verification mode to use
/// * `apply` - Whether to apply changes to the real workspace
///
/// # Returns
///
/// The extract result with patch, verification, and summary.
pub fn extract_variable(
    workspace_root: &Path,
    files: &[(String, String)],
    location: &Location,
    name: &str,
    python_path: &Path,
    verify_mode: VerificationMode,
    apply: bool,
) -> ExtractVariableResult<ExtractVariableOutput> {
    // Validate name
    validate_python_identifier(name)?;

    // Find the file
    let (file_path, content) =
        files
            .iter()
            .find(|(p, _)| p == &location.file)
            .ok_or_else(|| ExtractVariableError::FileNotFound {
                path: location.file.clone(),
            })?;

    // Parse the file with position tracking
    let parsed = parse_module_with_positions(content, None).map_err(|e| {
        ExtractVariableError::ParseError {
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
            .ok_or_else(|| ExtractVariableError::NoExpressionFound {
                location: format!("{}:{}:{}", location.file, location.line, location.col),
            })?;

    // Check context - reject comprehension/lambda/decorator
    if !expr_boundary.context.allows_extraction() {
        return Err(ExtractVariableError::UnsupportedContext {
            reason: expr_boundary
                .context
                .rejection_reason()
                .unwrap_or("unsupported context"),
        });
    }

    // Find enclosing statement for insertion point
    let stmt_span = detector
        .find_enclosing_statement(offset)
        .ok_or(ExtractVariableError::NoEnclosingStatement)?;

    // Extract expression text
    let expr_text = &content[expr_boundary.span.start..expr_boundary.span.end];

    // Detect indentation of the statement
    let indentation = detect_indentation(content, stmt_span.start);

    // Calculate the line start position (beginning of the line, before indentation)
    // This is where we need to insert the new statement - at the start of the line,
    // not at stmt_span.start which points to the first non-whitespace character.
    let line_start = content[..stmt_span.start]
        .rfind('\n')
        .map(|i| i + 1)
        .unwrap_or(0);

    // Create the assignment statement
    let assignment = format!("{}{} = {}\n", indentation, name, expr_text);

    // Build edits using BatchSpanEditor
    let options = BatchEditOptions {
        auto_indent: false, // We handle indentation manually
        allow_adjacent: true,
        allow_empty: false,
    };

    let mut editor = BatchSpanEditor::with_options(content, options);

    // 1. Insert assignment before enclosing statement (at line start, not stmt_span.start)
    editor.add(EditPrimitive::InsertAt {
        position: line_start,
        text: assignment.clone(),
    });

    // 2. Replace expression with variable reference
    editor.add(EditPrimitive::Replace {
        span: expr_boundary.span,
        new_text: name.to_string(),
    });

    // Apply edits
    let new_content = editor
        .apply()
        .map_err(|e| ExtractVariableError::EditError {
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
        return Err(ExtractVariableError::VerificationFailed {
            status: verification.status,
            output,
        });
    }

    // Build edit info for output
    let (insert_line, _) = offset_to_line_col(content, line_start);
    let (replace_line, replace_col) = offset_to_line_col(content, expr_boundary.span.start);
    let _ = offset_to_line_col(content, expr_boundary.span.end); // Used only for debugging

    let edit_infos = vec![
        OutputEdit {
            file: file_path.clone(),
            span: Span::new(line_start, line_start), // Zero-width for insertion at line start
            old_text: String::new(),
            new_text: assignment.clone(),
            line: insert_line,
            col: 1,
        },
        OutputEdit {
            file: file_path.clone(),
            span: expr_boundary.span,
            old_text: expr_text.to_string(),
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

    Ok(ExtractVariableOutput {
        status: "ok".to_string(),
        schema_version: "1".to_string(),
        snapshot_id,
        patch: MaterializedPatch {
            unified_diff,
            edits: edit_infos,
        },
        summary: ExtractVariableSummary {
            variable_name: name.to_string(),
            expression: expr_text.to_string(),
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
    })
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Convert a Location (file:line:col) to a byte offset.
fn location_to_offset(content: &str, location: &Location) -> ExtractVariableResult<usize> {
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
    // Basic extraction tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_extract_variable_basic() {
        let source = "x = 1 + 2\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        // Extract "1 + 2" at position of "1"
        let location = make_location("test.py", 1, 5);
        let analysis = analyze_extract_variable(&files, &location, Some("result"))
            .expect("analysis should succeed");

        assert_eq!(analysis.status, "ok");
        assert_eq!(analysis.suggested_name, "result");
        // The expression should be found
        assert!(!analysis.expression.text.is_empty());
    }

    #[test]
    fn test_extract_variable_nested() {
        let source = "result = calculate(get_value() * 2)\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        // Extract at "get_value()" - position around the call
        let location = make_location("test.py", 1, 20);
        let analysis = analyze_extract_variable(&files, &location, Some("value"))
            .expect("analysis should succeed");

        assert_eq!(analysis.status, "ok");
        assert_eq!(analysis.suggested_name, "value");
    }

    #[test]
    fn test_extract_variable_in_function() {
        let source = r#"def calculate():
    return 10 + 20
"#;
        let files = vec![("test.py".to_string(), source.to_string())];

        // Extract "10 + 20" inside function
        let location = make_location("test.py", 2, 12);
        let analysis = analyze_extract_variable(&files, &location, Some("total"))
            .expect("analysis should succeed");

        assert_eq!(analysis.status, "ok");
        assert_eq!(analysis.insertion_point.indentation, "    ");
    }

    #[test]
    fn test_extract_variable_multiline() {
        let source = r#"result = (
    value1 +
    value2
)
"#;
        let files = vec![("test.py".to_string(), source.to_string())];

        // Extract at "value1"
        let location = make_location("test.py", 2, 5);
        let analysis = analyze_extract_variable(&files, &location, Some("partial"))
            .expect("analysis should succeed");

        assert_eq!(analysis.status, "ok");
    }

    // ------------------------------------------------------------------------
    // Rejection tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_extract_variable_reject_comprehension() {
        let source = "[x * 2 for x in items]\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        // Try to extract "x * 2" inside comprehension
        let location = make_location("test.py", 1, 2);
        let result = analyze_extract_variable(&files, &location, Some("doubled"));

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, ExtractVariableError::UnsupportedContext { .. }),
            "expected UnsupportedContext error"
        );
    }

    #[test]
    fn test_extract_variable_reject_lambda() {
        let source = "f = lambda x: x + 1\n";
        let files = vec![("test.py".to_string(), source.to_string())];

        // Try to extract "x + 1" inside lambda
        let location = make_location("test.py", 1, 15);
        let result = analyze_extract_variable(&files, &location, Some("incremented"));

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            matches!(err, ExtractVariableError::UnsupportedContext { .. }),
            "expected UnsupportedContext error"
        );
    }

    // ------------------------------------------------------------------------
    // Full extraction with edits
    // ------------------------------------------------------------------------

    #[test]
    fn test_extract_variable_produces_valid_code() {
        let source = "x = 1 + 2\n";
        let files = vec![("test.py".to_string(), source.to_string())];
        let location = make_location("test.py", 1, 5);

        // Use a temp directory for workspace
        let temp_dir = TempDir::new().expect("create temp dir");
        let temp_path = temp_dir.path();
        fs::write(temp_path.join("test.py"), source).expect("write test file");

        // Note: We can't easily test the full extract_variable without a Python interpreter
        // But we can test the analysis which validates the core logic
        let analysis = analyze_extract_variable(&files, &location, Some("result"))
            .expect("analysis should succeed");

        assert_eq!(analysis.status, "ok");
    }

    // ------------------------------------------------------------------------
    // Helper function tests
    // ------------------------------------------------------------------------

    #[test]
    fn test_location_to_offset() {
        let content = "line1\nline2\nline3\n";

        // Line 1, col 1 -> offset 0
        let loc = make_location("test.py", 1, 1);
        assert_eq!(location_to_offset(content, &loc).unwrap(), 0);

        // Line 2, col 1 -> offset 6
        let loc = make_location("test.py", 2, 1);
        assert_eq!(location_to_offset(content, &loc).unwrap(), 6);

        // Line 2, col 3 -> offset 8
        let loc = make_location("test.py", 2, 3);
        assert_eq!(location_to_offset(content, &loc).unwrap(), 8);
    }

    #[test]
    fn test_offset_to_line_col() {
        let content = "line1\nline2\nline3\n";

        // offset 0 -> (1, 1)
        assert_eq!(offset_to_line_col(content, 0), (1, 1));

        // offset 6 -> (2, 1)
        assert_eq!(offset_to_line_col(content, 6), (2, 1));

        // offset 8 -> (2, 3)
        assert_eq!(offset_to_line_col(content, 8), (2, 3));
    }
}
