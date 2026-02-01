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

use std::collections::HashSet;
use std::io;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use tugtool_core::facts::{FactsStore, SymbolId, SymbolKind};
use tugtool_core::output::Location;
use tugtool_core::patch::{FileId, Span};
use tugtool_core::text::byte_offset_to_position_str;

use crate::analyzer::analyze_files;
use crate::cst_bridge;
use crate::files::FileError;
use crate::lookup::{find_symbol_at_location, LookupError};
use crate::validation::{validate_python_identifier, ValidationError};

use tugtool_python_cst::visitor::EditPrimitive;

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

    // Get function file content for line/col computation
    let function_file = store
        .file(function_symbol.decl_file_id)
        .ok_or_else(|| RenameParamError::AnalyzerError {
            message: "function file not found".to_string(),
        })?;
    let function_content = read_file(workspace_root, &function_file.path)?;

    // Get parameter file content
    let param_file = store
        .file(symbol.decl_file_id)
        .ok_or_else(|| RenameParamError::AnalyzerError {
            message: "parameter file not found".to_string(),
        })?;
    let param_content = read_file(workspace_root, &param_file.path)?;

    // Build parameter info
    let (param_line, param_col) =
        byte_offset_to_position_str(&param_content, symbol.decl_span.start);
    let param_info = ParamInfo {
        name: symbol.name.clone(),
        kind: "regular".to_string(), // TODO: get from signature
        location: Location {
            file: param_file.path.clone(),
            line: param_line,
            col: param_col,
            byte_start: Some(symbol.decl_span.start),
            byte_end: Some(symbol.decl_span.end),
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
    edits.push(ParamEdit {
        file_id: symbol.decl_file_id,
        span: symbol.decl_span,
        kind: ParamEditKind::Definition,
    });

    // Collect references
    for reference in store.refs_of_symbol(symbol.symbol_id) {
        let ref_file = store.file(reference.file_id).ok_or_else(|| {
            RenameParamError::AnalyzerError {
                message: "reference file not found".to_string(),
            }
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

/// Rename a parameter in a single file (simplified API for testing).
///
/// This function performs a single-file rename of a parameter:
/// 1. Find the parameter at the given location
/// 2. Rename it in the signature and body
/// 3. Note: Call site keyword args are NOT updated (single-file operation)
///
/// For full multi-file rename including call sites, use the CLI command.
///
/// # Arguments
///
/// * `content` - The Python source code
/// * `old_name` - The parameter name to rename
/// * `new_name` - The new parameter name
///
/// # Returns
///
/// The transformed source code with the parameter renamed.
pub fn rename_param_in_file(
    content: &str,
    old_name: &str,
    new_name: &str,
) -> RenameParamResult<String> {
    // Parse and analyze the file
    let analysis = cst_bridge::parse_and_analyze(content)?;

    // Collect all edit primitives for the renames
    let mut edits: Vec<EditPrimitive> = Vec::new();
    let mut seen_spans: HashSet<(usize, usize)> = HashSet::new();

    // Find bindings that are parameters with the target name
    for binding in &analysis.bindings {
        if binding.name == old_name && binding.kind == "parameter" {
            if let Some(ref span_info) = binding.span {
                let span = Span::new(span_info.start, span_info.end);
                if seen_spans.insert((span.start, span.end)) {
                    edits.push(EditPrimitive::Replace {
                        span,
                        new_text: new_name.to_string(),
                    });
                }
            }
        }
    }

    // Find references to the parameter
    for (name, refs) in &analysis.references {
        if name == old_name {
            for ref_info in refs {
                if let Some(ref span_info) = ref_info.span {
                    let span = Span::new(span_info.start, span_info.end);
                    if seen_spans.insert((span.start, span.end)) {
                        edits.push(EditPrimitive::Replace {
                            span,
                            new_text: new_name.to_string(),
                        });
                    }
                }
            }
        }
    }

    // Apply all renames using BatchSpanEditor via the bridge
    let result = cst_bridge::apply_batch_edits(content, edits)?;

    Ok(result)
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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rename_param_in_file_simple() {
        let source = r#"def greet(name):
    return f"Hello, {name}"
"#;
        let result = rename_param_in_file(source, "name", "recipient").unwrap();
        let expected = r#"def greet(recipient):
    return f"Hello, {recipient}"
"#;
        assert_eq!(result, expected);
    }

    #[test]
    fn test_rename_param_in_file_with_default() {
        let source = r#"def greet(name, greeting="Hello"):
    return f"{greeting}, {name}"
"#;
        let result = rename_param_in_file(source, "name", "recipient").unwrap();
        assert!(result.contains("def greet(recipient, greeting="));
        assert!(result.contains("{recipient}"));
    }

    #[test]
    fn test_rename_param_in_file_multiple_references() {
        let source = r#"def process(data):
    print(data)
    transformed = data.upper()
    return data
"#;
        let result = rename_param_in_file(source, "data", "input_value").unwrap();
        assert!(result.contains("def process(input_value)"));
        assert!(result.contains("print(input_value)"));
        assert!(result.contains("input_value.upper()"));
        assert!(result.contains("return input_value"));
    }

    #[test]
    fn test_rename_param_preserves_other_params() {
        let source = r#"def func(a, b, c):
    return a + b + c
"#;
        let result = rename_param_in_file(source, "b", "middle").unwrap();
        assert!(result.contains("def func(a, middle, c)"));
        assert!(result.contains("return a + middle + c"));
    }
}
