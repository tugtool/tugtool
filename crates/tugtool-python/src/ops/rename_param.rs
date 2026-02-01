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

use tugtool_core::facts::{FactsStore, ParamKind, SymbolId, SymbolKind};
use tugtool_core::output::Location;
use tugtool_core::patch::{FileId, Span};
use tugtool_core::text::byte_offset_to_position_str;

use crate::analyzer::analyze_files;
use crate::files::FileError;
use crate::lookup::{find_symbol_at_location, LookupError};
use crate::validation::{validate_python_identifier, ValidationError};

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
}
