// Copyright (c) Meta Platforms, Inc. and affiliates.
// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! A Python parser and Concrete Syntax Tree (CST) library.
//!
//! This crate provides a complete Python parser that produces a Concrete Syntax Tree,
//! preserving all whitespace and formatting for round-trip code generation.
//!
//! # Overview
//!
//! - **Parsing**: Parse Python source code into a CST with [`parse_module`] or
//!   [`parse_module_with_options`] for version-aware parsing.
//! - **Code Generation**: Convert CST back to source with the [`Codegen`] trait.
//! - **Version Awareness**: Use [`PythonVersion`] and [`ParseOptions`] to target
//!   specific Python versions (validation deferred to future work).
//!
//! # Quick Start
//!
//! ```
//! use tugtool_python_cst::{parse_module, Codegen, CodegenState};
//!
//! let source = "def hello(): print('world')";
//! let module = parse_module(source, None).expect("parse error");
//!
//! // Round-trip: convert back to source
//! let mut state = CodegenState::default();
//! module.codegen(&mut state);
//! assert_eq!(state.to_string(), source);
//! ```
//!
//! # Version-Aware Parsing
//!
//! ```
//! use tugtool_python_cst::{parse_module_with_options, ParseOptions, PythonVersion};
//!
//! // Parse targeting Python 3.10 (enables match statement analysis)
//! let options = ParseOptions::new(PythonVersion::V3_10);
//! let source = "match x:\n    case 1: pass";
//! let module = parse_module_with_options(source, options).expect("parse error");
//! ```
//!
//! # Note on Version Validation
//!
//! Currently, version validation is **deferred**: all syntax that the grammar
//! supports will be accepted regardless of the specified [`PythonVersion`].
//! The version is threaded through the API to enable future version-specific
//! validation and analysis without API changes.

use std::cmp::{max, min};

// ============================================================================
// Public modules and re-exports
// ============================================================================

/// Python version abstraction for version-aware parsing.
pub mod version;
pub use version::{ParseOptions, PythonVersion};

/// Visitor and transformer infrastructure for CST traversal.
pub mod visitor;
// P0 visitor exports
pub use visitor::{
    BindingCollector, BindingInfo, BindingKind, ExportCollector, ExportInfo, ExportKind,
    ReferenceCollector, ReferenceInfo, ReferenceKind, RenameError, RenameRequest, RenameResult,
    RenameTransformer, ScopeCollector, ScopeInfo, ScopeKind, Transform, Transformer, VisitResult,
    Visitor,
};
// P1 visitor exports
pub use visitor::{
    extract_receiver_path, AnnotationCollector, AnnotationInfo, AnnotationKind,
    AnnotationSourceKind, AssignmentInfo, AttributeAccessCollector, AttributeAccessInfo,
    AttributeAccessKind, CallArgInfo, CallSiteCollector, CallSiteInfo, ClassInheritanceInfo,
    ImportCollector, ImportInfo, ImportKind, ImportedName, InheritanceCollector, IsInstanceCheck,
    IsInstanceCollector, MethodCallCollector, MethodCallInfo, Modifier, ParamInfo, ParamKind,
    ReceiverPath, ReceiverStep, SignatureCollector, SignatureInfo, TypeInferenceCollector,
    TypeParamInfo, TypeSource,
};
// P2 visitor exports
pub use visitor::{DynamicPatternDetector, DynamicPatternInfo, DynamicPatternKind};
// Re-export walk functions for CST traversal
pub use visitor::{
    walk_annotation, walk_arg, walk_as_name, walk_assert, walk_assign, walk_assign_target,
    walk_attribute, walk_aug_assign, walk_await, walk_binary_operation, walk_boolean_operation,
    walk_break, walk_call, walk_class_def, walk_comp_for, walk_comp_if, walk_comparison,
    walk_concatenated_string, walk_continue, walk_decorator, walk_del, walk_dict, walk_dict_comp,
    walk_dict_element, walk_element, walk_ellipsis, walk_except_handler, walk_except_star_handler,
    walk_expression, walk_finally, walk_float, walk_for, walk_formatted_string,
    walk_formatted_string_content, walk_formatted_string_expression, walk_formatted_string_text,
    walk_function_def, walk_generator_exp, walk_global, walk_if, walk_if_exp, walk_imaginary,
    walk_import, walk_import_alias, walk_import_from, walk_index, walk_integer, walk_lambda,
    walk_list, walk_list_comp, walk_match, walk_match_as, walk_match_case, walk_match_class,
    walk_match_list, walk_match_mapping, walk_match_mapping_element, walk_match_or,
    walk_match_pattern, walk_match_sequence, walk_match_sequence_element, walk_match_singleton,
    walk_match_star, walk_match_tuple, walk_match_value, walk_module, walk_name, walk_named_expr,
    walk_nonlocal, walk_param, walk_param_star, walk_parameters, walk_pass, walk_raise,
    walk_return, walk_set, walk_set_comp, walk_simple_statement_line, walk_simple_string,
    walk_slice, walk_small_statement, walk_starred_dict_element, walk_starred_element,
    walk_statement, walk_subscript, walk_suite, walk_templated_string_text, walk_try,
    walk_try_star, walk_tuple, walk_type_alias, walk_type_param, walk_type_parameters,
    walk_type_var, walk_type_var_tuple, walk_unary_operation, walk_while, walk_with,
    walk_with_item, walk_yield,
};

/// Tokenizer for Python source code.
pub mod tokenizer;
use nodes::Inflate;
pub use tokenizer::whitespace_parser::Config;
use tokenizer::{whitespace_parser, TokConfig, Token, TokenIterator};

mod inflate_ctx;
pub use inflate_ctx::{InflateCtx, NodePosition, PositionTable};

mod nodes;
use nodes::deflated::Module as DeflatedModule;

// Re-export all node types for CST construction and traversal
pub use nodes::*;

mod parser;
use parser::TokVec;

// Re-export parser error types
pub use parser::{ParserError, Result};

// ============================================================================
// Parsing functions
// ============================================================================

/// Tokenizes Python source code into a sequence of tokens.
///
/// This is a low-level function. Most users should use [`parse_module`] instead.
///
/// # Errors
///
/// Returns a [`ParserError::TokenizerError`] if the source contains invalid tokens.
///
/// # Example
///
/// ```
/// use tugtool_python_cst::tokenize;
///
/// let tokens = tokenize("x = 1").expect("tokenize error");
/// assert!(!tokens.is_empty());
/// ```
pub fn tokenize(text: &str) -> Result<Vec<Token>> {
    let iter = TokenIterator::new(
        text,
        &TokConfig {
            async_hacks: false,
            split_ftstring: true,
        },
    );

    iter.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|err| ParserError::TokenizerError(err, text))
}

/// Parses a Python module with the specified options.
///
/// This is the primary parsing API that accepts [`ParseOptions`] for version-aware
/// parsing. For simple cases, use [`parse_module`] instead.
///
/// # Arguments
///
/// * `module_text` - The Python source code to parse.
/// * `options` - Parsing options including target [`PythonVersion`] and encoding.
///
/// # Returns
///
/// A [`Module`] CST node on success, or a [`ParserError`] on failure.
///
/// # Note on Version Validation
///
/// Currently, the `version` in [`ParseOptions`] does not affect parsing behavior.
/// All syntax that the grammar supports will be accepted. Version-specific
/// validation is deferred to future work.
///
/// # Example
///
/// ```
/// use tugtool_python_cst::{parse_module_with_options, ParseOptions, PythonVersion};
///
/// let options = ParseOptions::new(PythonVersion::V3_10);
/// let module = parse_module_with_options("x = 1", options).expect("parse error");
/// ```
pub fn parse_module_with_options<'a>(
    mut module_text: &'a str,
    options: ParseOptions,
) -> Result<'a, Module<'a>> {
    // Strip UTF-8 BOM
    if let Some(stripped) = module_text.strip_prefix('\u{feff}') {
        module_text = stripped;
    }
    let tokens = tokenize(module_text)?;
    let conf = whitespace_parser::Config::new(module_text, &tokens);
    let mut ctx = InflateCtx::new(conf);
    let tokvec = tokens.into();
    let m = parse_tokens_without_whitespace(&tokvec, module_text, options.encoding_str())?;
    Ok(m.inflate(&mut ctx)?)
}

/// Parses a Python module using permissive mode.
///
/// This is a convenience wrapper around [`parse_module_with_options`] that uses
/// [`PythonVersion::Permissive`], accepting all syntax the grammar supports.
///
/// # Arguments
///
/// * `module_text` - The Python source code to parse.
/// * `encoding` - Optional encoding hint (e.g., `"utf-8"`).
///
/// # Returns
///
/// A [`Module`] CST node on success, or a [`ParserError`] on failure.
///
/// # Example
///
/// ```
/// use tugtool_python_cst::parse_module;
///
/// let module = parse_module("x = 1", None).expect("parse error");
/// ```
pub fn parse_module<'a>(module_text: &'a str, encoding: Option<&str>) -> Result<'a, Module<'a>> {
    let options = match encoding {
        Some(enc) => ParseOptions::default().with_encoding(enc),
        None => ParseOptions::default(),
    };
    parse_module_with_options(module_text, options)
}

// ============================================================================
// Position-aware parsing
// ============================================================================

/// Parse result that includes position information.
///
/// This struct is returned by [`parse_module_with_positions`] and provides:
/// - The parsed [`Module`] CST
/// - A [`PositionTable`] mapping [`NodeId`]s to their source positions
/// - A count of tracked nodes (nodes that received a [`NodeId`])
///
/// # Position Data
///
/// The [`PositionTable`] stores [`NodePosition`] records for tracked nodes,
/// each containing optional spans:
/// - **ident_span**: The identifier text span (for rename operations)
/// - **lexical_span**: The scope extent, excluding decorators (for containment queries)
/// - **def_span**: The complete definition, including decorators (for extraction)
///
/// # Tracked Nodes
///
/// Not all CST nodes receive position tracking. The tracked node types are:
/// - `Name` - identifiers (records `ident_span`)
/// - `FunctionDef` - function definitions (records `lexical_span`, `def_span`)
/// - `ClassDef` - class definitions (records `lexical_span`, `def_span`)
/// - `Param` - function parameters
/// - `Decorator` - decorators
/// - `Integer`, `Float`, `SimpleString` - literals
///
/// # Example
///
/// ```
/// use tugtool_python_cst::parse_module_with_positions;
///
/// let source = "def foo(): pass";
/// let parsed = parse_module_with_positions(source, None).expect("parse error");
///
/// // Access the parsed module
/// let module = &parsed.module;
///
/// // Access position data via PositionTable
/// let positions = &parsed.positions;
///
/// // Get count of nodes with assigned NodeIds
/// let count = parsed.tracked_node_count;
/// ```
#[derive(Debug)]
pub struct ParsedModule<'a> {
    /// The parsed CST module.
    pub module: Module<'a>,

    /// Position table mapping NodeIds to their source positions.
    ///
    /// Use this to look up spans for tracked nodes:
    /// ```ignore
    /// if let Some(pos) = positions.get(&node.node_id.unwrap()) {
    ///     if let Some(ident_span) = pos.ident_span {
    ///         // Use the identifier span
    ///     }
    /// }
    /// ```
    pub positions: PositionTable,

    /// The count of nodes that received NodeIds during inflation.
    ///
    /// This is a subset of all nodes - only tracked node types receive IDs.
    /// The value matches `ctx.ids.count()` after inflation completes.
    pub tracked_node_count: u32,
}

/// Parses a Python module with position tracking enabled.
///
/// This function parses source code and captures position information for
/// tracked nodes. Use this when you need accurate byte spans for operations
/// like rename, scope analysis, or code extraction.
///
/// # Arguments
///
/// * `module_text` - The Python source code to parse.
/// * `encoding` - Optional encoding hint (e.g., `"utf-8"`).
///
/// # Returns
///
/// A [`ParsedModule`] containing the CST and position data on success,
/// or a [`ParserError`] on failure.
///
/// # Position Tracking
///
/// Position tracking is performed during inflation. The [`PositionTable`]
/// stores spans derived directly from tokenizer positions, providing accurate
/// byte offsets without relying on string search.
///
/// # Example
///
/// ```
/// use tugtool_python_cst::parse_module_with_positions;
///
/// let source = "def foo(): pass";
/// let parsed = parse_module_with_positions(source, None).expect("parse error");
///
/// // Access the module
/// assert!(!parsed.module.body.is_empty());
///
/// // Check that positions were captured
/// assert!(!parsed.positions.is_empty());
///
/// // Iterate over captured positions
/// for (node_id, pos) in parsed.positions.iter() {
///     if let Some(lexical) = pos.lexical_span {
///         println!("Node {:?}: lexical span {}..{}", node_id, lexical.start, lexical.end);
///     }
///     if let Some(ident) = pos.ident_span {
///         println!("Node {:?}: ident span {}..{}", node_id, ident.start, ident.end);
///     }
/// }
/// ```
///
/// # Comparison with [`parse_module`]
///
/// - [`parse_module`]: Faster, no position tracking overhead. Use when you
///   don't need position data.
/// - [`parse_module_with_positions`]: Captures positions during inflation.
///   Use when you need accurate spans for refactoring operations.
pub fn parse_module_with_positions<'a>(
    mut module_text: &'a str,
    encoding: Option<&str>,
) -> Result<'a, ParsedModule<'a>> {
    // Strip UTF-8 BOM
    if let Some(stripped) = module_text.strip_prefix('\u{feff}') {
        module_text = stripped;
    }

    let tokens = tokenize(module_text)?;
    let ws_config = whitespace_parser::Config::new(module_text, &tokens);
    let mut ctx = InflateCtx::with_positions(ws_config);

    let tokvec: TokVec = tokens.into();
    let encoding_str = encoding;
    let deflated_module = parse_tokens_without_whitespace(&tokvec, module_text, encoding_str)?;
    let module = deflated_module.inflate(&mut ctx)?;

    Ok(ParsedModule {
        module,
        positions: ctx
            .positions
            .expect("InflateCtx::with_positions should set positions"),
        tracked_node_count: ctx.ids.count(),
    })
}

/// Parses tokens into a deflated module without whitespace inflation.
///
/// This is a low-level function used internally. Most users should use
/// [`parse_module`] or [`parse_module_with_options`] instead.
pub fn parse_tokens_without_whitespace<'r, 'a>(
    tokens: &'r TokVec<'a>,
    module_text: &'a str,
    encoding: Option<&str>,
) -> Result<'a, DeflatedModule<'r, 'a>> {
    let m = parser::python::file(tokens, module_text, encoding)
        .map_err(|err| ParserError::ParserError(err, module_text))?;
    Ok(m)
}

/// Parses a single Python statement.
///
/// # Example
///
/// ```
/// use tugtool_python_cst::parse_statement;
///
/// let stmt = parse_statement("x = 1").expect("parse error");
/// ```
pub fn parse_statement(text: &str) -> Result<Statement> {
    let tokens = tokenize(text)?;
    let conf = whitespace_parser::Config::new(text, &tokens);
    let mut ctx = InflateCtx::new(conf);
    let tokvec = tokens.into();
    let stm = parser::python::statement_input(&tokvec, text)
        .map_err(|err| ParserError::ParserError(err, text))?;
    Ok(stm.inflate(&mut ctx)?)
}

/// Parses a single Python expression.
///
/// # Example
///
/// ```
/// use tugtool_python_cst::parse_expression;
///
/// let expr = parse_expression("1 + 2").expect("parse error");
/// ```
pub fn parse_expression(text: &str) -> Result<Expression> {
    let tokens = tokenize(text)?;
    let conf = whitespace_parser::Config::new(text, &tokens);
    let mut ctx = InflateCtx::new(conf);
    let tokvec = tokens.into();
    let expr = parser::python::expression_input(&tokvec, text)
        .map_err(|err| ParserError::ParserError(err, text))?;
    Ok(expr.inflate(&mut ctx)?)
}

// ============================================================================
// Error formatting
// ============================================================================

/// Returns the byte offset of the beginning of line `n` (1-indexed).
fn bol_offset(source: &str, n: i32) -> usize {
    if n <= 1 {
        return 0;
    }
    source
        .match_indices('\n')
        .nth((n - 2) as usize)
        .map(|(index, _)| index + 1)
        .unwrap_or_else(|| source.len())
}

/// Formats a parser error into a human-readable string with source context.
///
/// This function produces a nicely formatted error message with the relevant
/// source code snippet and error location highlighted.
///
/// # Arguments
///
/// * `err` - The parser error to format.
/// * `label` - A label for the error (e.g., file name).
///
/// # Example
///
/// ```
/// use tugtool_python_cst::{parse_module, prettify_error};
///
/// let result = parse_module("def", None);
/// if let Err(e) = result {
///     let formatted = prettify_error(e, "example.py");
///     println!("{}", formatted);
/// }
/// ```
pub fn prettify_error<'a>(err: ParserError<'a>, label: &str) -> std::string::String {
    match err {
        ParserError::ParserError(e, module_text) => {
            use annotate_snippets::{Level, Renderer, Snippet};

            let loc = e.location;
            let context = 1;
            let line_start = max(
                1,
                loc.start_pos
                    .line
                    .checked_sub(context as usize)
                    .unwrap_or(1),
            );
            let start_offset = bol_offset(module_text, loc.start_pos.line as i32 - context);
            let end_offset = bol_offset(module_text, loc.end_pos.line as i32 + context + 1);
            let source = &module_text[start_offset..end_offset];
            let start = loc.start_pos.offset - start_offset;
            let end = loc.end_pos.offset - start_offset;
            let end = if start == end {
                min(end + 1, end_offset - start_offset + 1)
            } else {
                end
            };
            Renderer::styled()
                .render(
                    Level::Error.title(label).snippet(
                        Snippet::source(source)
                            .line_start(line_start)
                            .fold(false)
                            .annotations(vec![Level::Error.span(start..end).label(&format!(
                                "expected {} {} -> {}",
                                e.expected, loc.start_pos, loc.end_pos
                            ))]),
                    ),
                )
                .to_string()
        }
        e => format!("Parse error for {}: {}", label, e),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use tokenizer::TokError;

    #[test]
    fn test_simple() {
        let n = parse_module("1_", None);
        assert_eq!(
            n.err().unwrap(),
            ParserError::TokenizerError(TokError::BadDecimal, "1_")
        );
    }

    #[test]
    fn test_bare_minimum_funcdef() {
        parse_module("def f(): ...", None).expect("parse error");
    }

    #[test]
    fn test_funcdef_params() {
        parse_module("def g(a, b): ...", None).expect("parse error");
    }

    #[test]
    fn test_single_statement_with_no_newline() {
        for src in &[
            "(\n \\\n)",
            "(\n  \\\n)",
            "(\n    '''\n''')",
            "del _",
            "if _:\n    '''\n)'''",
            "if _:\n    ('''\n''')",
            "if _:\n     '''\n  '''",
            "if _:\n        '''\n    ''' ",
        ] {
            parse_module(src, None).unwrap_or_else(|e| panic!("'{}' doesn't parse: {}", src, e));
        }
    }

    #[test]
    fn bol_offset_first_line() {
        assert_eq!(0, bol_offset("hello", 1));
        assert_eq!(0, bol_offset("hello", 0));
        assert_eq!(0, bol_offset("hello\nhello", 1));
        assert_eq!(0, bol_offset("hello\nhello", 0));
    }

    #[test]
    fn bol_offset_second_line() {
        assert_eq!(5, bol_offset("hello", 2));
        assert_eq!(6, bol_offset("hello\nhello", 2));
        assert_eq!(6, bol_offset("hello\nhello\nhello", 2));
    }

    #[test]
    fn bol_offset_last_line() {
        assert_eq!(5, bol_offset("hello", 3));
        assert_eq!(11, bol_offset("hello\nhello", 3));
        assert_eq!(12, bol_offset("hello\nhello\nhello", 3));
    }

    #[test]
    fn test_tstring_basic() {
        assert!(
            parse_module("t'hello'", None).is_ok(),
            "Failed to parse t'hello'"
        );
        assert!(
            parse_module("t'{hello}'", None).is_ok(),
            "Failed to parse t'{{hello}}'"
        );
        assert!(
            parse_module("t'{hello:r}'", None).is_ok(),
            "Failed to parse t'{{hello:r}}'"
        );
        assert!(
            parse_module("f'line1\\n{hello:r}\\nline2'", None).is_ok(),
            "Failed to parse t'line1\\n{{hello:r}}\\nline2'"
        );
    }

    #[test]
    fn test_parse_module_with_options() {
        // Test that parse_module_with_options accepts version parameter
        let options = ParseOptions::new(PythonVersion::V3_10);
        let module = parse_module_with_options("x = 1", options).expect("parse error");

        // Verify round-trip
        let mut state = CodegenState::default();
        module.codegen(&mut state);
        assert_eq!(state.to_string(), "x = 1");
    }

    #[test]
    fn test_version_independent_parsing() {
        // Same code should parse identically regardless of version (for now)
        let source = "x = 1\ny = 2";

        let module_permissive =
            parse_module_with_options(source, ParseOptions::default()).expect("parse error");
        let module_v38 = parse_module_with_options(source, ParseOptions::new(PythonVersion::V3_8))
            .expect("parse error");
        let module_v312 =
            parse_module_with_options(source, ParseOptions::new(PythonVersion::V3_12))
                .expect("parse error");

        // All should produce the same codegen output
        let mut state1 = CodegenState::default();
        let mut state2 = CodegenState::default();
        let mut state3 = CodegenState::default();

        module_permissive.codegen(&mut state1);
        module_v38.codegen(&mut state2);
        module_v312.codegen(&mut state3);

        assert_eq!(state1.to_string(), state2.to_string());
        assert_eq!(state2.to_string(), state3.to_string());
        assert_eq!(state1.to_string(), source);
    }

    // ========================================================================
    // NodeId tests - verify that parsed nodes have populated node_id fields
    // ========================================================================

    #[test]
    fn test_parsed_name_has_node_id() {
        // Parse code that contains a Name node (variable assignment)
        let module = parse_module("x = 1", None).expect("parse error");

        // The module's body should contain a simple statement with Assign
        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                // The target of the assignment is an AssignTarget containing a Name
                if let AssignTargetExpression::Name(name) = &assign.targets[0].target {
                    // Verify the Name node has a populated node_id
                    assert!(
                        name.node_id.is_some(),
                        "Parsed Name node should have Some(NodeId), got None"
                    );
                } else {
                    panic!("Expected Name target in assignment");
                }
            } else {
                panic!("Expected Assign statement");
            }
        } else {
            panic!("Expected SimpleStatementLine");
        }
    }

    #[test]
    fn test_parsed_function_def_has_node_id() {
        // Parse code that contains a FunctionDef
        let module = parse_module("def foo(): pass", None).expect("parse error");

        // The module's body should contain a compound statement with FunctionDef
        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::FunctionDef(func_def) = compound {
                // Verify the FunctionDef node has a populated node_id
                assert!(
                    func_def.node_id.is_some(),
                    "Parsed FunctionDef node should have Some(NodeId), got None"
                );

                // Verify the function's Name also has a node_id
                assert!(
                    func_def.name.node_id.is_some(),
                    "FunctionDef's name should have Some(NodeId), got None"
                );

                // Verify IDs are different (distinct nodes)
                assert_ne!(
                    func_def.node_id.unwrap(),
                    func_def.name.node_id.unwrap(),
                    "FunctionDef and its name should have distinct NodeIds"
                );
            } else {
                panic!("Expected FunctionDef compound statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_parsed_class_def_has_node_id() {
        // Parse code that contains a ClassDef
        let module = parse_module("class Foo: pass", None).expect("parse error");

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::ClassDef(class_def) = compound {
                // Verify the ClassDef node has a populated node_id
                assert!(
                    class_def.node_id.is_some(),
                    "Parsed ClassDef node should have Some(NodeId), got None"
                );

                // Verify the class's Name also has a node_id
                assert!(
                    class_def.name.node_id.is_some(),
                    "ClassDef's name should have Some(NodeId), got None"
                );
            } else {
                panic!("Expected ClassDef compound statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_parsed_param_has_node_id() {
        // Parse code that contains function parameters
        let module = parse_module("def foo(x, y): pass", None).expect("parse error");

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::FunctionDef(func_def) = compound {
                // Check the first parameter
                let param = &func_def.params.params[0];
                assert!(
                    param.node_id.is_some(),
                    "Parsed Param node should have Some(NodeId), got None"
                );

                // Check the parameter's name
                assert!(
                    param.name.node_id.is_some(),
                    "Param's name should have Some(NodeId), got None"
                );

                // Second parameter should also have distinct IDs
                let param2 = &func_def.params.params[1];
                assert!(
                    param2.node_id.is_some(),
                    "Second Param node should have Some(NodeId)"
                );
                assert_ne!(
                    param.node_id.unwrap(),
                    param2.node_id.unwrap(),
                    "Different parameters should have distinct NodeIds"
                );
            } else {
                panic!("Expected FunctionDef");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_parsed_decorator_has_node_id() {
        // Parse code with a decorator
        let module = parse_module("@decorator\ndef foo(): pass", None).expect("parse error");

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::FunctionDef(func_def) = compound {
                assert!(
                    !func_def.decorators.is_empty(),
                    "Function should have decorator"
                );
                let decorator = &func_def.decorators[0];
                assert!(
                    decorator.node_id.is_some(),
                    "Parsed Decorator node should have Some(NodeId), got None"
                );
            } else {
                panic!("Expected FunctionDef");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_parsed_integer_has_node_id() {
        // Parse code with an integer literal
        let module = parse_module("x = 42", None).expect("parse error");

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                if let Expression::Integer(integer) = &assign.value {
                    assert!(
                        integer.node_id.is_some(),
                        "Parsed Integer node should have Some(NodeId), got None"
                    );
                } else {
                    panic!("Expected Integer expression");
                }
            } else {
                panic!("Expected Assign");
            }
        } else {
            panic!("Expected SimpleStatementLine");
        }
    }

    #[test]
    fn test_parsed_float_has_node_id() {
        // Parse code with a float literal
        let module = parse_module("x = 3.14", None).expect("parse error");

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                if let Expression::Float(float) = &assign.value {
                    assert!(
                        float.node_id.is_some(),
                        "Parsed Float node should have Some(NodeId), got None"
                    );
                } else {
                    panic!("Expected Float expression");
                }
            } else {
                panic!("Expected Assign");
            }
        } else {
            panic!("Expected SimpleStatementLine");
        }
    }

    #[test]
    fn test_parsed_simple_string_has_node_id() {
        // Parse code with a string literal
        let module = parse_module(r#"x = "hello""#, None).expect("parse error");

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                if let Expression::SimpleString(string) = &assign.value {
                    assert!(
                        string.node_id.is_some(),
                        "Parsed SimpleString node should have Some(NodeId), got None"
                    );
                } else {
                    panic!("Expected SimpleString expression, got {:?}", assign.value);
                }
            } else {
                panic!("Expected Assign");
            }
        } else {
            panic!("Expected SimpleStatementLine");
        }
    }

    #[test]
    fn test_all_tracked_node_types_have_node_id() {
        // Separate tests for each tracked node type, easier to maintain and debug

        // Test FunctionDef, Decorator, Param, and Names in function context
        let func_source = "@dec\ndef f(x): pass";
        let module = parse_module(func_source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &module.body[0] {
            assert!(func.node_id.is_some(), "FunctionDef missing node_id");
            assert!(
                func.name.node_id.is_some(),
                "FunctionDef name missing node_id"
            );

            assert!(!func.decorators.is_empty(), "Expected decorator");
            assert!(
                func.decorators[0].node_id.is_some(),
                "Decorator missing node_id"
            );

            assert!(!func.params.params.is_empty(), "Expected param");
            assert!(
                func.params.params[0].node_id.is_some(),
                "Param missing node_id"
            );
            assert!(
                func.params.params[0].name.node_id.is_some(),
                "Param name missing node_id"
            );
        } else {
            panic!("Expected FunctionDef");
        }

        // Test ClassDef
        let class_source = "class C: pass";
        let module = parse_module(class_source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::ClassDef(class)) = &module.body[0] {
            assert!(class.node_id.is_some(), "ClassDef missing node_id");
            assert!(
                class.name.node_id.is_some(),
                "ClassDef name missing node_id"
            );
        } else {
            panic!("Expected ClassDef");
        }

        // Test literals at module level (easier to parse)
        let int_source = "x = 42";
        let module = parse_module(int_source, None).expect("parse error");

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                // Check target name
                if let AssignTargetExpression::Name(name) = &assign.targets[0].target {
                    assert!(name.node_id.is_some(), "Name missing node_id");
                }
                // Check value
                if let Expression::Integer(i) = &assign.value {
                    assert!(i.node_id.is_some(), "Integer missing node_id");
                } else {
                    panic!("Expected Integer");
                }
            }
        }

        let float_source = "x = 3.14";
        let module = parse_module(float_source, None).expect("parse error");

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                if let Expression::Float(f) = &assign.value {
                    assert!(f.node_id.is_some(), "Float missing node_id");
                } else {
                    panic!("Expected Float");
                }
            }
        }

        let str_source = r#"x = "hello""#;
        let module = parse_module(str_source, None).expect("parse error");

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                if let Expression::SimpleString(s) = &assign.value {
                    assert!(s.node_id.is_some(), "SimpleString missing node_id");
                } else {
                    panic!("Expected SimpleString, got {:?}", assign.value);
                }
            }
        }
    }

    // ========================================================================
    // Step 4 Tests: Span Collection
    // ========================================================================

    /// Helper function to parse source with position tracking enabled.
    fn parse_with_positions(source: &str) -> (Module, PositionTable) {
        let tokens = tokenize(source).expect("tokenize error");
        let conf = whitespace_parser::Config::new(source, &tokens);
        let mut ctx = InflateCtx::with_positions(conf);
        let tokvec: TokVec = tokens.into();
        let m = parse_tokens_without_whitespace(&tokvec, source, None).expect("parse error");
        let module = m.inflate(&mut ctx).expect("inflate error");
        let positions = ctx.positions.expect("positions should be enabled");
        (module, positions)
    }

    #[test]
    fn test_function_def_lexical_span_starts_at_def_not_decorator() {
        // With decorator: lexical span should start at 'def', NOT at '@'
        let source = "@dec\ndef foo():\n    pass\n";
        //            0123 4567890123456789012345
        //                  ^def starts at byte 5
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &module.body[0] {
            let node_id = func.node_id.expect("FunctionDef should have node_id");
            let pos = positions
                .get(&node_id)
                .expect("FunctionDef should have position");

            let lexical_span = pos.lexical_span.expect("Should have lexical_span");
            // 'def' starts at byte 5 (after "@dec\n")
            assert_eq!(
                lexical_span.start, 5,
                "lexical_span should start at 'def', not '@'"
            );
        } else {
            panic!("Expected FunctionDef");
        }
    }

    #[test]
    fn test_function_def_def_span_starts_at_first_decorator() {
        // With decorator: def_span should start at '@', the first decorator
        let source = "@dec\ndef foo():\n    pass\n";
        //            ^@ at byte 0
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &module.body[0] {
            let node_id = func.node_id.expect("FunctionDef should have node_id");
            let pos = positions
                .get(&node_id)
                .expect("FunctionDef should have position");

            let def_span = pos.def_span.expect("Should have def_span");
            // '@' starts at byte 0
            assert_eq!(
                def_span.start, 0,
                "def_span should start at first decorator '@'"
            );
        } else {
            panic!("Expected FunctionDef");
        }
    }

    #[test]
    fn test_undecorated_function_lexical_equals_def_start() {
        // Without decorator: lexical_span.start should equal def_span.start
        let source = "def foo():\n    pass\n";
        //            ^def at byte 0
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &module.body[0] {
            let node_id = func.node_id.expect("FunctionDef should have node_id");
            let pos = positions
                .get(&node_id)
                .expect("FunctionDef should have position");

            let lexical_span = pos.lexical_span.expect("Should have lexical_span");
            let def_span = pos.def_span.expect("Should have def_span");

            assert_eq!(
                lexical_span.start, def_span.start,
                "For undecorated function, lexical_span.start should equal def_span.start"
            );
            assert_eq!(lexical_span.start, 0, "Both should start at byte 0");
        } else {
            panic!("Expected FunctionDef");
        }
    }

    #[test]
    fn test_nested_functions_have_distinct_spans() {
        let source = "def outer():\n    def inner():\n        pass\n";
        //            0         1         2         3         4
        //            0123456789012345678901234567890123456789012345
        //            ^outer: def at 0
        //                        ^inner: def at 17
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(CompoundStatement::FunctionDef(outer)) = &module.body[0] {
            let outer_id = outer.node_id.expect("outer should have node_id");
            let outer_pos = positions
                .get(&outer_id)
                .expect("outer should have position");
            let outer_lexical = outer_pos
                .lexical_span
                .expect("outer should have lexical_span");

            // Find inner function in outer's body
            if let Suite::IndentedBlock(block) = &outer.body {
                if let Statement::Compound(CompoundStatement::FunctionDef(inner)) = &block.body[0] {
                    let inner_id = inner.node_id.expect("inner should have node_id");
                    let inner_pos = positions
                        .get(&inner_id)
                        .expect("inner should have position");
                    let inner_lexical = inner_pos
                        .lexical_span
                        .expect("inner should have lexical_span");

                    // Inner function's span should be contained within outer's span
                    assert!(
                        inner_lexical.start >= outer_lexical.start,
                        "inner start {} should be >= outer start {}",
                        inner_lexical.start,
                        outer_lexical.start
                    );
                    assert!(
                        inner_lexical.end <= outer_lexical.end,
                        "inner end {} should be <= outer end {}",
                        inner_lexical.end,
                        outer_lexical.end
                    );

                    // They should have different starts
                    assert_ne!(
                        inner_lexical.start, outer_lexical.start,
                        "inner and outer should have different start positions"
                    );
                } else {
                    panic!("Expected inner FunctionDef");
                }
            } else {
                panic!("Expected IndentedBlock");
            }
        } else {
            panic!("Expected outer FunctionDef");
        }
    }

    #[test]
    fn test_class_def_with_decorators() {
        let source = "@decorator\nclass Foo:\n    pass\n";
        //            0         1         2         3
        //            0123456789012345678901234567890123
        //            ^@ at 0    ^class at 11
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(CompoundStatement::ClassDef(class)) = &module.body[0] {
            let node_id = class.node_id.expect("ClassDef should have node_id");
            let pos = positions
                .get(&node_id)
                .expect("ClassDef should have position");

            let lexical_span = pos.lexical_span.expect("Should have lexical_span");
            let def_span = pos.def_span.expect("Should have def_span");

            // def_span starts at '@', lexical_span starts at 'class'
            assert_eq!(def_span.start, 0, "def_span should start at decorator '@'");
            assert_eq!(
                lexical_span.start, 11,
                "lexical_span should start at 'class'"
            );
            assert!(
                def_span.start < lexical_span.start,
                "def_span should start before lexical_span for decorated class"
            );
        } else {
            panic!("Expected ClassDef");
        }
    }

    #[test]
    fn test_single_line_function_has_correct_scope_end() {
        // Single-line function: `def f(): pass` (SimpleStatementSuite)
        let source = "def f(): pass\n";
        //            0         1
        //            01234567890123
        //                     ^newline at 13
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &module.body[0] {
            let node_id = func.node_id.expect("FunctionDef should have node_id");
            let pos = positions
                .get(&node_id)
                .expect("FunctionDef should have position");

            let lexical_span = pos.lexical_span.expect("Should have lexical_span");
            // Scope should end at end of newline (byte 14, which is len of source)
            assert_eq!(
                lexical_span.end, 14,
                "scope_end should be at end of newline token"
            );
            assert_eq!(lexical_span.start, 0, "scope should start at 'def'");
        } else {
            panic!("Expected FunctionDef");
        }
    }

    #[test]
    fn test_name_node_has_ident_span() {
        let source = "foo = 1";
        //            0123456
        //            ^foo: bytes 0-3
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                if let AssignTargetExpression::Name(name) = &assign.targets[0].target {
                    let node_id = name.node_id.expect("Name should have node_id");
                    let pos = positions.get(&node_id).expect("Name should have position");

                    let ident_span = pos.ident_span.expect("Name should have ident_span");
                    assert_eq!(ident_span.start, 0, "ident_span should start at 0");
                    assert_eq!(ident_span.end, 3, "ident_span should end at 3 (exclusive)");

                    // Extract the text and verify it matches
                    let ident_text = &source[ident_span.start..ident_span.end];
                    assert_eq!(ident_text, "foo", "ident_span should cover 'foo'");
                } else {
                    panic!("Expected Name");
                }
            }
        }
    }

    #[test]
    fn test_function_name_has_ident_span() {
        let source = "def my_func(): pass\n";
        //            01234567890123456789
        //                ^my_func: bytes 4-11
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &module.body[0] {
            // Function's name is a Name node which has its own node_id
            let name_id = func.name.node_id.expect("Name should have node_id");
            let name_pos = positions.get(&name_id).expect("Name should have position");

            let ident_span = name_pos.ident_span.expect("Name should have ident_span");
            let ident_text = &source[ident_span.start..ident_span.end];
            assert_eq!(ident_text, "my_func", "ident_span should cover 'my_func'");
        } else {
            panic!("Expected FunctionDef");
        }
    }

    #[test]
    fn test_async_function_lexical_span_starts_at_async() {
        let source = "async def foo(): pass\n";
        //            0         1         2
        //            0123456789012345678901
        //            ^async at 0
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &module.body[0] {
            let node_id = func.node_id.expect("FunctionDef should have node_id");
            let pos = positions
                .get(&node_id)
                .expect("FunctionDef should have position");

            let lexical_span = pos.lexical_span.expect("Should have lexical_span");
            // Async function's lexical span should start at 'async', not 'def'
            assert_eq!(
                lexical_span.start, 0,
                "lexical_span should start at 'async'"
            );
        } else {
            panic!("Expected FunctionDef");
        }
    }

    // ========================================================================
    // Step 5 Tests: parse_module_with_positions API
    // ========================================================================

    #[test]
    fn test_parse_module_with_positions_basic_returns_positions() {
        // Test that parse_module_with_positions returns a ParsedModule with positions
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, None).expect("parse error");

        // Should have a valid module
        assert!(!parsed.module.body.is_empty(), "Module should have body");

        // Should have positions for tracked nodes
        assert!(
            !parsed.positions.is_empty(),
            "PositionTable should not be empty"
        );

        // Should have tracked some nodes
        assert!(
            parsed.tracked_node_count > 0,
            "tracked_node_count should be > 0"
        );
    }

    #[test]
    fn test_original_parse_module_still_works_unchanged() {
        // Verify that parse_module still works without position tracking
        let source = "def foo():\n    return 42\n";

        // parse_module should work
        let module = parse_module(source, None).expect("parse_module should succeed");

        // Round-trip should work
        let mut state = CodegenState::default();
        module.codegen(&mut state);
        assert_eq!(
            state.to_string(),
            source,
            "Round-trip should preserve source"
        );

        // FunctionDef should still have node_id (inflation still assigns IDs)
        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &module.body[0] {
            assert!(
                func.node_id.is_some(),
                "FunctionDef should have node_id even without position tracking"
            );
        } else {
            panic!("Expected FunctionDef");
        }
    }

    #[test]
    fn test_parse_module_with_positions_accurate_for_known_input() {
        // Test that positions are accurate for a specific, known input
        let source = "foo = bar";
        //            012345678
        //            ^foo: 0-3
        //                  ^bar: 6-9

        let parsed = parse_module_with_positions(source, None).expect("parse error");

        if let Statement::Simple(simple) = &parsed.module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                // Check target 'foo'
                if let AssignTargetExpression::Name(target_name) = &assign.targets[0].target {
                    let target_id = target_name.node_id.expect("target should have node_id");
                    let target_pos = parsed
                        .positions
                        .get(&target_id)
                        .expect("target should have position");
                    let target_span = target_pos
                        .ident_span
                        .expect("target should have ident_span");

                    // Verify exact positions
                    assert_eq!(target_span.start, 0, "foo should start at byte 0");
                    assert_eq!(target_span.end, 3, "foo should end at byte 3");
                    assert_eq!(&source[target_span.start..target_span.end], "foo");
                } else {
                    panic!("Expected Name target");
                }

                // Check value 'bar'
                if let Expression::Name(value_name) = &assign.value {
                    let value_id = value_name.node_id.expect("value should have node_id");
                    let value_pos = parsed
                        .positions
                        .get(&value_id)
                        .expect("value should have position");
                    let value_span = value_pos.ident_span.expect("value should have ident_span");

                    // Verify exact positions
                    assert_eq!(value_span.start, 6, "bar should start at byte 6");
                    assert_eq!(value_span.end, 9, "bar should end at byte 9");
                    assert_eq!(&source[value_span.start..value_span.end], "bar");
                } else {
                    panic!("Expected Name value");
                }
            }
        }
    }

    #[test]
    fn test_tracked_node_count_matches_number_of_tracked_nodes() {
        // Test that tracked_node_count correctly reflects the number of tracked nodes
        let source = "def foo(x): pass\n";
        //            Tracked nodes: FunctionDef, Name(foo), Param, Name(x), plus other Names

        let parsed = parse_module_with_positions(source, None).expect("parse error");

        // The tracked_node_count should match the number of nodes that received NodeIds
        // We can verify this by checking that node_ids are sequential and maximal
        let count = parsed.tracked_node_count;
        assert!(count > 0, "Should have tracked nodes");

        // Count should be reasonable for this small input
        // Expected: FunctionDef, Name(foo), Param, Name(x), Name(pass - in statement context)
        // The exact count depends on implementation, but should be > 3 (at minimum: FunctionDef, Name(foo), Param, Name(x))
        assert!(
            count >= 4,
            "Should have at least 4 tracked nodes for 'def foo(x): pass', got {}",
            count
        );

        // Verify that the highest NodeId assigned is count - 1 (0-indexed)
        // This ensures IDs are sequential
        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &parsed.module.body[0] {
            let func_id = func.node_id.expect("FunctionDef should have node_id");
            assert!(
                func_id.as_u32() < count,
                "FunctionDef's NodeId {} should be < tracked_node_count {}",
                func_id.as_u32(),
                count
            );

            let name_id = func.name.node_id.expect("Name should have node_id");
            assert!(
                name_id.as_u32() < count,
                "Name's NodeId {} should be < tracked_node_count {}",
                name_id.as_u32(),
                count
            );
        }
    }

    #[test]
    fn test_parse_module_with_positions_with_encoding() {
        // Test that encoding parameter works
        let source = "x = 1";
        let parsed = parse_module_with_positions(source, Some("utf-8")).expect("parse error");

        assert!(
            !parsed.module.body.is_empty(),
            "Module should have body with encoding"
        );
    }

    #[test]
    fn test_parse_module_with_positions_strips_bom() {
        // Test that UTF-8 BOM is stripped
        let source_with_bom = "\u{feff}x = 1";

        let parsed = parse_module_with_positions(source_with_bom, None).expect("parse error");
        assert!(
            !parsed.module.body.is_empty(),
            "Module should parse with BOM"
        );

        // Position data should be relative to after BOM
        // BOM is 3 bytes, so 'x' should be at position 0 in the stripped source
        // But the function strips BOM, so positions are relative to the stripped source
        if let Statement::Simple(simple) = &parsed.module.body[0] {
            if let SmallStatement::Assign(assign) = &simple.body[0] {
                if let AssignTargetExpression::Name(name) = &assign.targets[0].target {
                    let node_id = name.node_id.expect("Name should have node_id");
                    let pos = parsed
                        .positions
                        .get(&node_id)
                        .expect("Name should have position");
                    let span = pos.ident_span.expect("Name should have ident_span");

                    // Position should be 0 (relative to stripped source)
                    assert_eq!(
                        span.start, 0,
                        "Position should be relative to stripped source"
                    );
                }
            }
        }
    }

    // ========================================================================
    // Step 5C Tests: Compound Statement node_id
    // ========================================================================

    #[test]
    fn test_for_has_node_id() {
        // Test that For statement has node_id after parsing
        let source = "for x in items:\n    pass\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::For(for_stmt)) = &module.body[0] {
            assert!(
                for_stmt.node_id.is_some(),
                "Parsed For statement should have Some(NodeId), got None"
            );
        } else {
            panic!("Expected For compound statement");
        }
    }

    #[test]
    fn test_while_has_node_id() {
        // Test that While statement has node_id after parsing
        let source = "while True:\n    pass\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::While(while_stmt)) = &module.body[0] {
            assert!(
                while_stmt.node_id.is_some(),
                "Parsed While statement should have Some(NodeId), got None"
            );
        } else {
            panic!("Expected While compound statement");
        }
    }

    #[test]
    fn test_try_has_node_id() {
        // Test that Try statement has node_id after parsing
        let source = "try:\n    pass\nexcept:\n    pass\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::Try(try_stmt)) = &module.body[0] {
            assert!(
                try_stmt.node_id.is_some(),
                "Parsed Try statement should have Some(NodeId), got None"
            );
        } else {
            panic!("Expected Try compound statement");
        }
    }

    #[test]
    fn test_try_star_has_node_id() {
        // Test that TryStar statement has node_id after parsing
        // TryStar uses except* syntax (Python 3.11+)
        let source = "try:\n    pass\nexcept* Exception:\n    pass\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::TryStar(try_star_stmt)) = &module.body[0] {
            assert!(
                try_star_stmt.node_id.is_some(),
                "Parsed TryStar statement should have Some(NodeId), got None"
            );
        } else {
            panic!("Expected TryStar compound statement");
        }
    }

    #[test]
    fn test_with_has_node_id() {
        // Test that With statement has node_id after parsing
        let source = "with open('file') as f:\n    pass\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::With(with_stmt)) = &module.body[0] {
            assert!(
                with_stmt.node_id.is_some(),
                "Parsed With statement should have Some(NodeId), got None"
            );
        } else {
            panic!("Expected With compound statement");
        }
    }

    #[test]
    fn test_match_has_node_id() {
        // Test that Match statement has node_id after parsing
        // Match statement (Python 3.10+)
        let source = "match x:\n    case 1:\n        pass\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::Match(match_stmt)) = &module.body[0] {
            assert!(
                match_stmt.node_id.is_some(),
                "Parsed Match statement should have Some(NodeId), got None"
            );
        } else {
            panic!("Expected Match compound statement");
        }
    }

    // Step 0.2.0.1 Tests: Pass/Break/Continue token field tests
    //
    // These tests verify that Pass, Break, Continue parse correctly after adding the `tok` field.
    // The `tok` field is internal to the deflated struct (filtered from inflated by #[cst_node] macro),
    // so we verify correctness indirectly by checking:
    // 1. Parsing succeeds (tok is captured in grammar)
    // 2. node_id is assigned (inflation completed successfully)
    // 3. Codegen roundtrip works (struct is properly constructed)

    #[test]
    fn test_pass_has_token() {
        // Verify Pass parses correctly with the new tok field.
        // The tok field captures the "pass" keyword token in the deflated struct,
        // enabling span recording in Step 0.2.0.11.
        let source = "pass\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Simple(simple_line) = &module.body[0] {
            if let SmallStatement::Pass(pass_stmt) = &simple_line.body[0] {
                assert!(
                    pass_stmt.node_id.is_some(),
                    "Parsed Pass statement should have Some(NodeId), got None"
                );
            } else {
                panic!("Expected Pass statement, got {:?}", simple_line.body[0]);
            }
        } else {
            panic!("Expected Simple statement");
        }

        // Also verify codegen roundtrip
        let mut state = Default::default();
        module.codegen(&mut state);
        assert_eq!(state.to_string(), source);
    }

    #[test]
    fn test_break_has_token() {
        // Verify Break parses correctly with the new tok field.
        // The tok field captures the "break" keyword token in the deflated struct.
        let source = "while True:\n    break\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::While(while_stmt)) = &module.body[0] {
            if let Suite::IndentedBlock(block) = &while_stmt.body {
                if let Statement::Simple(simple_line) = &block.body[0] {
                    if let SmallStatement::Break(break_stmt) = &simple_line.body[0] {
                        assert!(
                            break_stmt.node_id.is_some(),
                            "Parsed Break statement should have Some(NodeId), got None"
                        );
                    } else {
                        panic!("Expected Break statement");
                    }
                } else {
                    panic!("Expected Simple statement in while body");
                }
            } else {
                panic!("Expected IndentedBlock");
            }
        } else {
            panic!("Expected While compound statement");
        }

        // Verify roundtrip
        let mut state = Default::default();
        module.codegen(&mut state);
        assert_eq!(state.to_string(), source);
    }

    #[test]
    fn test_continue_has_token() {
        // Verify Continue parses correctly with the new tok field.
        // The tok field captures the "continue" keyword token in the deflated struct.
        let source = "while True:\n    continue\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::While(while_stmt)) = &module.body[0] {
            if let Suite::IndentedBlock(block) = &while_stmt.body {
                if let Statement::Simple(simple_line) = &block.body[0] {
                    if let SmallStatement::Continue(continue_stmt) = &simple_line.body[0] {
                        assert!(
                            continue_stmt.node_id.is_some(),
                            "Parsed Continue statement should have Some(NodeId), got None"
                        );
                    } else {
                        panic!("Expected Continue statement");
                    }
                } else {
                    panic!("Expected Simple statement in while body");
                }
            } else {
                panic!("Expected IndentedBlock");
            }
        } else {
            panic!("Expected While compound statement");
        }

        // Verify roundtrip
        let mut state = Default::default();
        module.codegen(&mut state);
        assert_eq!(state.to_string(), source);
    }

    #[test]
    fn test_pass_with_semicolon() {
        // Verify Pass with semicolon parses correctly.
        // The tok field captures only the "pass" keyword, separate from the semicolon.
        // (Span boundary verification will be done in Step 0.2.0.11 when span recording is added.)
        let source = "pass;\n";
        let module = parse_module(source, None).expect("parse error");

        if let Statement::Simple(simple_line) = &module.body[0] {
            if let SmallStatement::Pass(pass_stmt) = &simple_line.body[0] {
                assert!(
                    pass_stmt.node_id.is_some(),
                    "Parsed Pass statement should have Some(NodeId)"
                );
                assert!(
                    pass_stmt.semicolon.is_some(),
                    "Pass statement should have semicolon"
                );
            } else {
                panic!("Expected Pass statement");
            }
        } else {
            panic!("Expected Simple statement");
        }

        // Verify roundtrip preserves semicolon
        let mut state = Default::default();
        module.codegen(&mut state);
        assert_eq!(state.to_string(), source);
    }

    // ========================================================================
    // Step 0.2.0.3 Tests: Literal Span Recording
    // ========================================================================
    //
    // These tests verify that literal expression nodes (Ellipsis, Integer,
    // Float, Imaginary) correctly record their ident_span during inflation.

    #[test]
    fn test_ellipsis_literal_span_recorded() {
        let source = "...\n";
        //            0123
        //            ^ellipsis: bytes 0-3
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Ellipsis(ellipsis) = &expr.value {
                    let node_id = ellipsis.node_id.expect("Ellipsis should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Ellipsis should have position");
                    let span = pos.ident_span.expect("Ellipsis should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 3, "ident_span should end at 3");
                    assert_eq!(&source[span.start..span.end], "...");
                } else {
                    panic!("Expected Ellipsis expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_integer_literal_span_recorded() {
        let source = "42\n";
        //            012
        //            ^integer: bytes 0-2
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Integer(integer) = &expr.value {
                    let node_id = integer.node_id.expect("Integer should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Integer should have position");
                    let span = pos.ident_span.expect("Integer should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 2, "ident_span should end at 2");
                    assert_eq!(&source[span.start..span.end], "42");
                } else {
                    panic!("Expected Integer expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_float_literal_span_recorded() {
        let source = "3.14\n";
        //            01234
        //            ^float: bytes 0-4
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Float(float) = &expr.value {
                    let node_id = float.node_id.expect("Float should have node_id");
                    let pos = positions.get(&node_id).expect("Float should have position");
                    let span = pos.ident_span.expect("Float should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 4, "ident_span should end at 4");
                    assert_eq!(&source[span.start..span.end], "3.14");
                } else {
                    panic!("Expected Float expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_imaginary_literal_span_recorded() {
        let source = "2j\n";
        //            012
        //            ^imaginary: bytes 0-2
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Imaginary(imaginary) = &expr.value {
                    let node_id = imaginary.node_id.expect("Imaginary should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Imaginary should have position");
                    let span = pos.ident_span.expect("Imaginary should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 2, "ident_span should end at 2");
                    assert_eq!(&source[span.start..span.end], "2j");
                } else {
                    panic!("Expected Imaginary expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_integer_with_parens_literal_span() {
        // Per the plan, the span should cover just the integer token, not parentheses
        // (parentheses are in lpar/rpar, not the literal token)
        let source = "(42)\n";
        //            01234
        //             ^integer token: bytes 1-3
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Integer(integer) = &expr.value {
                    let node_id = integer.node_id.expect("Integer should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Integer should have position");
                    let span = pos.ident_span.expect("Integer should have ident_span");

                    // Span covers the integer token itself, not the parens
                    assert_eq!(span.start, 1, "ident_span should start at 1 (after '(')");
                    assert_eq!(span.end, 3, "ident_span should end at 3 (before ')')");
                    assert_eq!(&source[span.start..span.end], "42");
                } else {
                    panic!("Expected Integer expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_name_literal_span_recorded() {
        // Regression test: Name spans are already implemented, verify they still work
        let source = "foo\n";
        //            0123
        //            ^name: bytes 0-3
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Name(name) = &expr.value {
                    let node_id = name.node_id.expect("Name should have node_id");
                    let pos = positions.get(&node_id).expect("Name should have position");
                    let span = pos.ident_span.expect("Name should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 3, "ident_span should end at 3");
                    assert_eq!(&source[span.start..span.end], "foo");
                } else {
                    panic!("Expected Name expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_string_literal_span_recorded() {
        // Regression test: SimpleString spans are already implemented, verify they still work
        let source = "\"hello\"\n";
        //            01234567
        //            ^string: bytes 0-7
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::SimpleString(string) = &expr.value {
                    let node_id = string.node_id.expect("SimpleString should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("SimpleString should have position");
                    let span = pos.ident_span.expect("SimpleString should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 7, "ident_span should end at 7");
                    assert_eq!(&source[span.start..span.end], "\"hello\"");
                } else {
                    panic!("Expected SimpleString expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    // ========================================================================
    // Step 0.2.0.4 Tests: Container Span Recording
    // ========================================================================
    //
    // These tests verify that container expression nodes (List, Set, Dict)
    // correctly record their ident_span from bracket tokens during inflation.

    #[test]
    fn test_list_container_span_recorded() {
        let source = "[1, 2, 3]\n";
        //            0123456789
        //            ^list: bytes 0-9
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::List(list) = &expr.value {
                    let node_id = list.node_id.expect("List should have node_id");
                    let pos = positions.get(&node_id).expect("List should have position");
                    let span = pos.ident_span.expect("List should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 9, "ident_span should end at 9");
                    assert_eq!(&source[span.start..span.end], "[1, 2, 3]");
                } else {
                    panic!("Expected List expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_empty_list_container_span_recorded() {
        let source = "[]\n";
        //            012
        //            ^list: bytes 0-2
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::List(list) = &expr.value {
                    let node_id = list.node_id.expect("List should have node_id");
                    let pos = positions.get(&node_id).expect("List should have position");
                    let span = pos.ident_span.expect("List should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 2, "ident_span should end at 2");
                    assert_eq!(&source[span.start..span.end], "[]");
                } else {
                    panic!("Expected List expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_set_container_span_recorded() {
        let source = "{1, 2}\n";
        //            0123456
        //            ^set: bytes 0-6
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Set(set) = &expr.value {
                    let node_id = set.node_id.expect("Set should have node_id");
                    let pos = positions.get(&node_id).expect("Set should have position");
                    let span = pos.ident_span.expect("Set should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 6, "ident_span should end at 6");
                    assert_eq!(&source[span.start..span.end], "{1, 2}");
                } else {
                    panic!("Expected Set expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_dict_container_span_recorded() {
        let source = "{\"a\": 1}\n";
        //            012345678
        //            ^dict: bytes 0-8
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Dict(dict) = &expr.value {
                    let node_id = dict.node_id.expect("Dict should have node_id");
                    let pos = positions.get(&node_id).expect("Dict should have position");
                    let span = pos.ident_span.expect("Dict should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 8, "ident_span should end at 8");
                    assert_eq!(&source[span.start..span.end], "{\"a\": 1}");
                } else {
                    panic!("Expected Dict expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_empty_dict_container_span_recorded() {
        let source = "{}\n";
        //            012
        //            ^dict: bytes 0-2
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Dict(dict) = &expr.value {
                    let node_id = dict.node_id.expect("Dict should have node_id");
                    let pos = positions.get(&node_id).expect("Dict should have position");
                    let span = pos.ident_span.expect("Dict should have ident_span");

                    assert_eq!(span.start, 0, "ident_span should start at 0");
                    assert_eq!(span.end, 2, "ident_span should end at 2");
                    assert_eq!(&source[span.start..span.end], "{}");
                } else {
                    panic!("Expected Dict expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_nested_list_container_span() {
        let source = "[[1, 2], [3, 4]]\n";
        //            0         1
        //            0123456789012345 6
        //            ^outer: bytes 0-16 (exclusive)
        //             ^inner1: bytes 1-7
        //                      ^inner2: bytes 9-15
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::List(outer_list) = &expr.value {
                    // Verify outer list span
                    let outer_id = outer_list.node_id.expect("Outer list should have node_id");
                    let outer_pos = positions
                        .get(&outer_id)
                        .expect("Outer list should have position");
                    let outer_span = outer_pos
                        .ident_span
                        .expect("Outer list should have ident_span");

                    assert_eq!(outer_span.start, 0, "outer list should start at 0");
                    assert_eq!(outer_span.end, 16, "outer list should end at 16");
                    assert_eq!(&source[outer_span.start..outer_span.end], "[[1, 2], [3, 4]]");

                    // Verify inner lists
                    if let Element::Simple { value, .. } = &outer_list.elements[0] {
                        if let Expression::List(inner1) = value {
                            let inner1_id =
                                inner1.node_id.expect("Inner list 1 should have node_id");
                            let inner1_pos = positions
                                .get(&inner1_id)
                                .expect("Inner list 1 should have position");
                            let inner1_span = inner1_pos
                                .ident_span
                                .expect("Inner list 1 should have ident_span");

                            assert_eq!(inner1_span.start, 1, "inner list 1 should start at 1");
                            assert_eq!(inner1_span.end, 7, "inner list 1 should end at 7");
                            assert_eq!(&source[inner1_span.start..inner1_span.end], "[1, 2]");
                        } else {
                            panic!("Expected inner List expression");
                        }
                    } else {
                        panic!("Expected Simple element");
                    }

                    if let Element::Simple { value, .. } = &outer_list.elements[1] {
                        if let Expression::List(inner2) = value {
                            let inner2_id =
                                inner2.node_id.expect("Inner list 2 should have node_id");
                            let inner2_pos = positions
                                .get(&inner2_id)
                                .expect("Inner list 2 should have position");
                            let inner2_span = inner2_pos
                                .ident_span
                                .expect("Inner list 2 should have ident_span");

                            assert_eq!(inner2_span.start, 9, "inner list 2 should start at 9");
                            assert_eq!(inner2_span.end, 15, "inner list 2 should end at 15");
                            assert_eq!(&source[inner2_span.start..inner2_span.end], "[3, 4]");
                        } else {
                            panic!("Expected inner List expression");
                        }
                    } else {
                        panic!("Expected Simple element");
                    }
                } else {
                    panic!("Expected outer List expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    // ========================================================================
    // Step 0.2.0.5 Tests: Composite Expression Spans (Operations)
    // ========================================================================

    #[test]
    fn test_binary_operation_span_recorded() {
        let source = "a + b\n";
        //            012345
        //            ^binary: bytes 0-5
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::BinaryOperation(binop) = &expr.value {
                    let node_id = binop.node_id.expect("BinaryOperation should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("BinaryOperation should have position");
                    let span = pos
                        .ident_span
                        .expect("BinaryOperation should have ident_span");

                    assert_eq!(span.start, 0, "binary op should start at 0");
                    assert_eq!(span.end, 5, "binary op should end at 5");
                    assert_eq!(&source[span.start..span.end], "a + b");
                } else {
                    panic!("Expected BinaryOperation expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_binary_operation_span_nested() {
        // Due to operator precedence, this parses as: a + (b * c)
        let source = "a + b * c\n";
        //            0123456789
        //            ^outer binop: bytes 0-9
        //                ^inner binop: bytes 4-9
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::BinaryOperation(outer_binop) = &expr.value {
                    // Verify outer binop span (a + b * c)
                    let outer_id = outer_binop
                        .node_id
                        .expect("Outer BinaryOperation should have node_id");
                    let outer_pos = positions
                        .get(&outer_id)
                        .expect("Outer BinaryOperation should have position");
                    let outer_span = outer_pos
                        .ident_span
                        .expect("Outer BinaryOperation should have ident_span");

                    assert_eq!(outer_span.start, 0, "outer binop should start at 0");
                    assert_eq!(outer_span.end, 9, "outer binop should end at 9");
                    assert_eq!(&source[outer_span.start..outer_span.end], "a + b * c");

                    // Verify inner binop span (b * c)
                    if let Expression::BinaryOperation(inner_binop) = outer_binop.right.as_ref() {
                        let inner_id = inner_binop
                            .node_id
                            .expect("Inner BinaryOperation should have node_id");
                        let inner_pos = positions
                            .get(&inner_id)
                            .expect("Inner BinaryOperation should have position");
                        let inner_span = inner_pos
                            .ident_span
                            .expect("Inner BinaryOperation should have ident_span");

                        assert_eq!(inner_span.start, 4, "inner binop should start at 4");
                        assert_eq!(inner_span.end, 9, "inner binop should end at 9");
                        assert_eq!(&source[inner_span.start..inner_span.end], "b * c");
                    } else {
                        panic!("Expected inner BinaryOperation in right operand");
                    }
                } else {
                    panic!("Expected BinaryOperation expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_unary_operation_span_recorded() {
        let source = "-x\n";
        //            012
        //            ^unary: bytes 0-2
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::UnaryOperation(unop) = &expr.value {
                    let node_id = unop.node_id.expect("UnaryOperation should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("UnaryOperation should have position");
                    let span = pos
                        .ident_span
                        .expect("UnaryOperation should have ident_span");

                    assert_eq!(span.start, 0, "unary op should start at 0");
                    assert_eq!(span.end, 2, "unary op should end at 2");
                    assert_eq!(&source[span.start..span.end], "-x");
                } else {
                    panic!("Expected UnaryOperation expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_unary_not_operation_span_recorded() {
        let source = "not x\n";
        //            012345
        //            ^unary: bytes 0-5
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::UnaryOperation(unop) = &expr.value {
                    let node_id = unop.node_id.expect("UnaryOperation should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("UnaryOperation should have position");
                    let span = pos
                        .ident_span
                        .expect("UnaryOperation should have ident_span");

                    assert_eq!(span.start, 0, "not op should start at 0");
                    assert_eq!(span.end, 5, "not op should end at 5");
                    assert_eq!(&source[span.start..span.end], "not x");
                } else {
                    panic!("Expected UnaryOperation expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_boolean_operation_span_recorded() {
        let source = "a and b\n";
        //            01234567
        //            ^boolean: bytes 0-7
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::BooleanOperation(boolop) = &expr.value {
                    let node_id = boolop.node_id.expect("BooleanOperation should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("BooleanOperation should have position");
                    let span = pos
                        .ident_span
                        .expect("BooleanOperation should have ident_span");

                    assert_eq!(span.start, 0, "boolean op should start at 0");
                    assert_eq!(span.end, 7, "boolean op should end at 7");
                    assert_eq!(&source[span.start..span.end], "a and b");
                } else {
                    panic!("Expected BooleanOperation expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_boolean_operation_span_chain() {
        // Due to operator precedence, this parses as: (a and b) or c
        let source = "a and b or c\n";
        //            0         1
        //            0123456789012
        //            ^outer boolop: bytes 0-12
        //            ^inner boolop: bytes 0-7
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::BooleanOperation(outer_boolop) = &expr.value {
                    // Verify outer boolop span (a and b or c)
                    let outer_id = outer_boolop
                        .node_id
                        .expect("Outer BooleanOperation should have node_id");
                    let outer_pos = positions
                        .get(&outer_id)
                        .expect("Outer BooleanOperation should have position");
                    let outer_span = outer_pos
                        .ident_span
                        .expect("Outer BooleanOperation should have ident_span");

                    assert_eq!(outer_span.start, 0, "outer boolop should start at 0");
                    assert_eq!(outer_span.end, 12, "outer boolop should end at 12");
                    assert_eq!(&source[outer_span.start..outer_span.end], "a and b or c");

                    // Verify inner boolop span (a and b)
                    if let Expression::BooleanOperation(inner_boolop) = outer_boolop.left.as_ref() {
                        let inner_id = inner_boolop
                            .node_id
                            .expect("Inner BooleanOperation should have node_id");
                        let inner_pos = positions
                            .get(&inner_id)
                            .expect("Inner BooleanOperation should have position");
                        let inner_span = inner_pos
                            .ident_span
                            .expect("Inner BooleanOperation should have ident_span");

                        assert_eq!(inner_span.start, 0, "inner boolop should start at 0");
                        assert_eq!(inner_span.end, 7, "inner boolop should end at 7");
                        assert_eq!(&source[inner_span.start..inner_span.end], "a and b");
                    } else {
                        panic!("Expected inner BooleanOperation in left operand");
                    }
                } else {
                    panic!("Expected BooleanOperation expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_comparison_operation_span_recorded() {
        let source = "a < b\n";
        //            012345
        //            ^comparison: bytes 0-5
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Comparison(cmp) = &expr.value {
                    let node_id = cmp.node_id.expect("Comparison should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Comparison should have position");
                    let span = pos.ident_span.expect("Comparison should have ident_span");

                    assert_eq!(span.start, 0, "comparison should start at 0");
                    assert_eq!(span.end, 5, "comparison should end at 5");
                    assert_eq!(&source[span.start..span.end], "a < b");
                } else {
                    panic!("Expected Comparison expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_comparison_chain_operation_span() {
        let source = "a < b < c\n";
        //            0123456789
        //            ^comparison: bytes 0-9
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Comparison(cmp) = &expr.value {
                    let node_id = cmp.node_id.expect("Comparison should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Comparison should have position");
                    let span = pos.ident_span.expect("Comparison should have ident_span");

                    assert_eq!(span.start, 0, "comparison chain should start at 0");
                    assert_eq!(span.end, 9, "comparison chain should end at 9");
                    assert_eq!(&source[span.start..span.end], "a < b < c");

                    // Verify the comparison has two comparators in the chain
                    assert_eq!(
                        cmp.comparisons.len(),
                        2,
                        "comparison chain should have 2 comparators"
                    );
                } else {
                    panic!("Expected Comparison expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    // ========================================================================
    // Step 0.2.0.6 Tests: Call/Attribute/Subscript Spans
    // ========================================================================

    #[test]
    fn test_call_attr_subscript_span_call_recorded() {
        let source = "foo(x, y)\n";
        //            0123456789
        //            ^call: bytes 0-9
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Call(call) = &expr.value {
                    let node_id = call.node_id.expect("Call should have node_id");
                    let pos = positions.get(&node_id).expect("Call should have position");
                    let span = pos.ident_span.expect("Call should have ident_span");

                    assert_eq!(span.start, 0, "call should start at 0");
                    assert_eq!(span.end, 9, "call should end at 9");
                    assert_eq!(&source[span.start..span.end], "foo(x, y)");
                } else {
                    panic!("Expected Call expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_call_attr_subscript_span_call_no_args() {
        let source = "foo()\n";
        //            012345
        //            ^call: bytes 0-5
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Call(call) = &expr.value {
                    let node_id = call.node_id.expect("Call should have node_id");
                    let pos = positions.get(&node_id).expect("Call should have position");
                    let span = pos.ident_span.expect("Call should have ident_span");

                    assert_eq!(span.start, 0, "call should start at 0");
                    assert_eq!(span.end, 5, "call should end at 5");
                    assert_eq!(&source[span.start..span.end], "foo()");
                } else {
                    panic!("Expected Call expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_call_attr_subscript_span_attribute_recorded() {
        let source = "obj.attr\n";
        //            012345678
        //            ^attribute: bytes 0-8
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Attribute(attr) = &expr.value {
                    let node_id = attr.node_id.expect("Attribute should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Attribute should have position");
                    let span = pos.ident_span.expect("Attribute should have ident_span");

                    assert_eq!(span.start, 0, "attribute should start at 0");
                    assert_eq!(span.end, 8, "attribute should end at 8");
                    assert_eq!(&source[span.start..span.end], "obj.attr");
                } else {
                    panic!("Expected Attribute expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_call_attr_subscript_span_chained_attribute() {
        let source = "a.b.c\n";
        //            012345
        //            ^outer attr (a.b.c): bytes 0-5
        //            ^inner attr (a.b): bytes 0-3
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                // a.b.c parses as (a.b).c - outer is Attribute with value Attribute
                if let Expression::Attribute(outer_attr) = &expr.value {
                    // Verify outer attribute span (a.b.c)
                    let outer_id = outer_attr
                        .node_id
                        .expect("Outer Attribute should have node_id");
                    let outer_pos = positions
                        .get(&outer_id)
                        .expect("Outer Attribute should have position");
                    let outer_span = outer_pos
                        .ident_span
                        .expect("Outer Attribute should have ident_span");

                    assert_eq!(outer_span.start, 0, "outer attr should start at 0");
                    assert_eq!(outer_span.end, 5, "outer attr should end at 5");
                    assert_eq!(&source[outer_span.start..outer_span.end], "a.b.c");

                    // Verify inner attribute span (a.b)
                    if let Expression::Attribute(inner_attr) = outer_attr.value.as_ref() {
                        let inner_id = inner_attr
                            .node_id
                            .expect("Inner Attribute should have node_id");
                        let inner_pos = positions
                            .get(&inner_id)
                            .expect("Inner Attribute should have position");
                        let inner_span = inner_pos
                            .ident_span
                            .expect("Inner Attribute should have ident_span");

                        assert_eq!(inner_span.start, 0, "inner attr should start at 0");
                        assert_eq!(inner_span.end, 3, "inner attr should end at 3");
                        assert_eq!(&source[inner_span.start..inner_span.end], "a.b");
                    } else {
                        panic!("Expected inner Attribute expression");
                    }
                } else {
                    panic!("Expected Attribute expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_call_attr_subscript_span_subscript_recorded() {
        let source = "obj[key]\n";
        //            012345678
        //            ^subscript: bytes 0-8
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Subscript(subscript) = &expr.value {
                    let node_id = subscript.node_id.expect("Subscript should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Subscript should have position");
                    let span = pos.ident_span.expect("Subscript should have ident_span");

                    assert_eq!(span.start, 0, "subscript should start at 0");
                    assert_eq!(span.end, 8, "subscript should end at 8");
                    assert_eq!(&source[span.start..span.end], "obj[key]");
                } else {
                    panic!("Expected Subscript expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_call_attr_subscript_span_subscript_with_slice() {
        let source = "obj[1:2]\n";
        //            012345678
        //            ^subscript: bytes 0-8
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Subscript(subscript) = &expr.value {
                    let node_id = subscript.node_id.expect("Subscript should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("Subscript should have position");
                    let span = pos.ident_span.expect("Subscript should have ident_span");

                    assert_eq!(span.start, 0, "subscript should start at 0");
                    assert_eq!(span.end, 8, "subscript should end at 8");
                    assert_eq!(&source[span.start..span.end], "obj[1:2]");
                } else {
                    panic!("Expected Subscript expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_call_attr_subscript_span_method_call() {
        let source = "obj.method(arg)\n";
        //            0         1
        //            0123456789012345
        //            ^call: bytes 0-15
        //            ^attr: bytes 0-10
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                // obj.method(arg) parses as Call with func = Attribute
                if let Expression::Call(call) = &expr.value {
                    let call_id = call.node_id.expect("Call should have node_id");
                    let call_pos = positions.get(&call_id).expect("Call should have position");
                    let call_span = call_pos.ident_span.expect("Call should have ident_span");

                    assert_eq!(call_span.start, 0, "call should start at 0");
                    assert_eq!(call_span.end, 15, "call should end at 15");
                    assert_eq!(&source[call_span.start..call_span.end], "obj.method(arg)");

                    // Verify the inner attribute span (obj.method)
                    if let Expression::Attribute(attr) = call.func.as_ref() {
                        let attr_id = attr.node_id.expect("Attribute should have node_id");
                        let attr_pos = positions
                            .get(&attr_id)
                            .expect("Attribute should have position");
                        let attr_span = attr_pos
                            .ident_span
                            .expect("Attribute should have ident_span");

                        assert_eq!(attr_span.start, 0, "attr should start at 0");
                        assert_eq!(attr_span.end, 10, "attr should end at 10");
                        assert_eq!(&source[attr_span.start..attr_span.end], "obj.method");
                    } else {
                        panic!("Expected Attribute as call func");
                    }
                } else {
                    panic!("Expected Call expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_call_attr_subscript_span_nested_call() {
        let source = "f(g(x))\n";
        //            01234567
        //            ^outer call: bytes 0-7
        //              ^inner call: bytes 2-6
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Call(outer_call) = &expr.value {
                    // Verify outer call span f(g(x))
                    let outer_id = outer_call.node_id.expect("Outer Call should have node_id");
                    let outer_pos = positions
                        .get(&outer_id)
                        .expect("Outer Call should have position");
                    let outer_span = outer_pos
                        .ident_span
                        .expect("Outer Call should have ident_span");

                    assert_eq!(outer_span.start, 0, "outer call should start at 0");
                    assert_eq!(outer_span.end, 7, "outer call should end at 7");
                    assert_eq!(&source[outer_span.start..outer_span.end], "f(g(x))");

                    // Verify inner call span g(x)
                    if let Some(arg) = outer_call.args.first() {
                        if let Expression::Call(inner_call) = &arg.value {
                            let inner_id =
                                inner_call.node_id.expect("Inner Call should have node_id");
                            let inner_pos = positions
                                .get(&inner_id)
                                .expect("Inner Call should have position");
                            let inner_span = inner_pos
                                .ident_span
                                .expect("Inner Call should have ident_span");

                            assert_eq!(inner_span.start, 2, "inner call should start at 2");
                            assert_eq!(inner_span.end, 6, "inner call should end at 6");
                            assert_eq!(&source[inner_span.start..inner_span.end], "g(x)");
                        } else {
                            panic!("Expected inner Call expression");
                        }
                    } else {
                        panic!("Expected outer call to have args");
                    }
                } else {
                    panic!("Expected Call expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    // ========================================================================
    // Step 0.2.0.7 Tests: Other Expression Spans
    // ========================================================================
    //
    // These tests verify that other expression types (IfExp, Yield, Await,
    // NamedExpr, StarredElement, Tuple, Slice) correctly record their spans.

    #[test]
    fn test_other_expr_span_if_exp_recorded() {
        let source = "x if cond else y\n";
        //            0         1
        //            0123456789012345678
        //            ^ifexp: bytes 0-16
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::IfExp(if_exp) = &expr.value {
                    let node_id = if_exp.node_id.expect("IfExp should have node_id");
                    let pos = positions.get(&node_id).expect("IfExp should have position");
                    let span = pos.ident_span.expect("IfExp should have ident_span");

                    assert_eq!(span.start, 0, "ifexp should start at 0");
                    assert_eq!(span.end, 16, "ifexp should end at 16");
                    assert_eq!(&source[span.start..span.end], "x if cond else y");
                } else {
                    panic!("Expected IfExp expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_other_expr_span_yield_recorded() {
        // yield must be in a function
        let source = "def f():\n    yield x\n";
        //            0         1         2
        //            0123456789012345678901
        //                         ^yield: bytes 13-20
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::FunctionDef(func) = compound {
                if let Suite::IndentedBlock(block) = &func.body {
                    if let Statement::Simple(simple) = &block.body[0] {
                        if let SmallStatement::Expr(expr) = &simple.body[0] {
                            if let Expression::Yield(yield_expr) = &expr.value {
                                let node_id =
                                    yield_expr.node_id.expect("Yield should have node_id");
                                let pos =
                                    positions.get(&node_id).expect("Yield should have position");
                                let span = pos.ident_span.expect("Yield should have ident_span");

                                assert_eq!(span.start, 13, "yield should start at 13");
                                assert_eq!(span.end, 20, "yield should end at 20");
                                assert_eq!(&source[span.start..span.end], "yield x");
                            } else {
                                panic!("Expected Yield expression");
                            }
                        } else {
                            panic!("Expected Expr statement");
                        }
                    } else {
                        panic!("Expected Simple statement");
                    }
                } else {
                    panic!("Expected IndentedBlock suite");
                }
            } else {
                panic!("Expected FunctionDef");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_other_expr_span_yield_no_value() {
        // yield with no value
        let source = "def f():\n    yield\n";
        //            0         1         2
        //            012345678901234567890
        //                         ^yield: bytes 13-18
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::FunctionDef(func) = compound {
                if let Suite::IndentedBlock(block) = &func.body {
                    if let Statement::Simple(simple) = &block.body[0] {
                        if let SmallStatement::Expr(expr) = &simple.body[0] {
                            if let Expression::Yield(yield_expr) = &expr.value {
                                let node_id =
                                    yield_expr.node_id.expect("Yield should have node_id");
                                let pos =
                                    positions.get(&node_id).expect("Yield should have position");
                                let span = pos.ident_span.expect("Yield should have ident_span");

                                assert_eq!(span.start, 13, "yield should start at 13");
                                assert_eq!(span.end, 18, "yield should end at 18");
                                assert_eq!(&source[span.start..span.end], "yield");
                            } else {
                                panic!("Expected Yield expression");
                            }
                        } else {
                            panic!("Expected Expr statement");
                        }
                    } else {
                        panic!("Expected Simple statement");
                    }
                } else {
                    panic!("Expected IndentedBlock suite");
                }
            } else {
                panic!("Expected FunctionDef");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_other_expr_span_await_recorded() {
        // await must be in an async function
        let source = "async def f():\n    await foo()\n";
        //            0         1         2         3
        //            0123456789012345678901234567890
        //                                ^await: bytes 19-30
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::FunctionDef(func) = compound {
                if let Suite::IndentedBlock(block) = &func.body {
                    if let Statement::Simple(simple) = &block.body[0] {
                        if let SmallStatement::Expr(expr) = &simple.body[0] {
                            if let Expression::Await(await_expr) = &expr.value {
                                let node_id =
                                    await_expr.node_id.expect("Await should have node_id");
                                let pos =
                                    positions.get(&node_id).expect("Await should have position");
                                let span = pos.ident_span.expect("Await should have ident_span");

                                assert_eq!(span.start, 19, "await should start at 19");
                                assert_eq!(span.end, 30, "await should end at 30");
                                assert_eq!(&source[span.start..span.end], "await foo()");
                            } else {
                                panic!("Expected Await expression");
                            }
                        } else {
                            panic!("Expected Expr statement");
                        }
                    } else {
                        panic!("Expected Simple statement");
                    }
                } else {
                    panic!("Expected IndentedBlock suite");
                }
            } else {
                panic!("Expected FunctionDef");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_other_expr_span_named_expr_recorded() {
        // Named expression (walrus operator)
        let source = "(x := 42)\n";
        //            0123456789
        //             ^named_expr: bytes 1-8 (inside parens)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::NamedExpr(named_expr) = &expr.value {
                    let node_id = named_expr.node_id.expect("NamedExpr should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("NamedExpr should have position");
                    let span = pos.ident_span.expect("NamedExpr should have ident_span");

                    assert_eq!(span.start, 1, "named_expr should start at 1");
                    assert_eq!(span.end, 8, "named_expr should end at 8");
                    assert_eq!(&source[span.start..span.end], "x := 42");
                } else {
                    panic!("Expected NamedExpr expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_other_expr_span_starred_element() {
        // Starred element in a list
        let source = "[*items]\n";
        //            012345678
        //             ^starred: bytes 1-7
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::List(list) = &expr.value {
                    if let Some(Element::Starred(starred)) = list.elements.first() {
                        let node_id = starred.node_id.expect("StarredElement should have node_id");
                        let pos = positions
                            .get(&node_id)
                            .expect("StarredElement should have position");
                        let span = pos
                            .ident_span
                            .expect("StarredElement should have ident_span");

                        assert_eq!(span.start, 1, "starred should start at 1");
                        assert_eq!(span.end, 7, "starred should end at 7");
                        assert_eq!(&source[span.start..span.end], "*items");
                    } else {
                        panic!("Expected StarredElement in list");
                    }
                } else {
                    panic!("Expected List expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_other_expr_span_tuple_recorded() {
        // Tuple with parentheses
        let source = "(1, 2)\n";
        //            0123456
        //            ^tuple: bytes 0-6 (includes parens)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Tuple(tuple) = &expr.value {
                    let node_id = tuple.node_id.expect("Tuple should have node_id");
                    let pos = positions.get(&node_id).expect("Tuple should have position");
                    let span = pos.ident_span.expect("Tuple should have ident_span");

                    assert_eq!(span.start, 0, "tuple should start at 0");
                    assert_eq!(span.end, 6, "tuple should end at 6");
                    assert_eq!(&source[span.start..span.end], "(1, 2)");
                } else {
                    panic!("Expected Tuple expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_other_expr_span_tuple_no_parens() {
        // Tuple without parentheses
        let source = "1, 2\n";
        //            01234
        //            ^tuple: bytes 0-4
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Tuple(tuple) = &expr.value {
                    let node_id = tuple.node_id.expect("Tuple should have node_id");
                    let pos = positions.get(&node_id).expect("Tuple should have position");
                    let span = pos.ident_span.expect("Tuple should have ident_span");

                    assert_eq!(span.start, 0, "tuple should start at 0");
                    assert_eq!(span.end, 4, "tuple should end at 4");
                    assert_eq!(&source[span.start..span.end], "1, 2");
                } else {
                    panic!("Expected Tuple expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_other_expr_span_slice_recorded() {
        // Slice within a subscript
        let source = "a[1:2:3]\n";
        //            012345678
        //              ^slice: bytes 2-7 (1:2:3)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Subscript(subscript) = &expr.value {
                    // Get the slice from the subscript
                    if let Some(SubscriptElement {
                        slice: BaseSlice::Slice(slice),
                        ..
                    }) = subscript.slice.first()
                    {
                        let node_id = slice.node_id.expect("Slice should have node_id");
                        let pos = positions.get(&node_id).expect("Slice should have position");
                        let span = pos.ident_span.expect("Slice should have ident_span");

                        assert_eq!(span.start, 2, "slice should start at 2");
                        assert_eq!(span.end, 7, "slice should end at 7");
                        assert_eq!(&source[span.start..span.end], "1:2:3");
                    } else {
                        panic!("Expected Slice in subscript");
                    }
                } else {
                    panic!("Expected Subscript expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_other_expr_span_slice_partial() {
        // Slice with only lower and first colon
        let source = "a[1:]\n";
        //            012345
        //              ^slice: bytes 2-4 (1:)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::Subscript(subscript) = &expr.value {
                    if let Some(SubscriptElement {
                        slice: BaseSlice::Slice(slice),
                        ..
                    }) = subscript.slice.first()
                    {
                        let node_id = slice.node_id.expect("Slice should have node_id");
                        let pos = positions.get(&node_id).expect("Slice should have position");
                        let span = pos.ident_span.expect("Slice should have ident_span");

                        assert_eq!(span.start, 2, "slice should start at 2");
                        assert_eq!(span.end, 4, "slice should end at 4");
                        assert_eq!(&source[span.start..span.end], "1:");
                    } else {
                        panic!("Expected Slice in subscript");
                    }
                } else {
                    panic!("Expected Subscript expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    // ========================================================================
    // Step 0.2.0.8 Tests: String Type Spans
    // ========================================================================
    //
    // These tests verify that string expression types (ConcatenatedString,
    // FormattedString, TemplatedString) correctly record their spans using
    // the start_tok and end_tok fields that capture the full string extent.

    #[test]
    fn test_string_span_concatenated_string() {
        // Concatenated string: two adjacent string literals
        let source = "\"a\" \"b\"\n";
        //            01234567
        //            ^concat: bytes 0-7
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::ConcatenatedString(concat) = &expr.value {
                    let node_id = concat
                        .node_id
                        .expect("ConcatenatedString should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("ConcatenatedString should have position");
                    let span = pos
                        .ident_span
                        .expect("ConcatenatedString should have ident_span");

                    assert_eq!(span.start, 0, "concat should start at 0");
                    assert_eq!(span.end, 7, "concat should end at 7");
                    assert_eq!(&source[span.start..span.end], "\"a\" \"b\"");
                } else {
                    panic!("Expected ConcatenatedString expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_string_span_formatted_string() {
        // Formatted string (f-string) with embedded expression
        // Span should cover the ENTIRE f-string from f" to closing "
        let source = "f\"hello {name}\"\n";
        //            0         1
        //            0123456789012345
        //            ^fstring: bytes 0-15
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::FormattedString(fstring) = &expr.value {
                    let node_id = fstring
                        .node_id
                        .expect("FormattedString should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("FormattedString should have position");
                    let span = pos
                        .ident_span
                        .expect("FormattedString should have ident_span");

                    // Span covers entire f-string including f" prefix and closing "
                    assert_eq!(span.start, 0, "fstring should start at 0");
                    assert_eq!(span.end, 15, "fstring should end at 15");
                    assert_eq!(&source[span.start..span.end], "f\"hello {name}\"");
                } else {
                    panic!("Expected FormattedString expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_string_span_formatted_string_nested() {
        // Nested f-string: f"outer {f'inner {x}'}"
        // Each FormattedString gets its own span covering the entire string
        let source = "f\"outer {f'inner {x}'}\"\n";
        //            0         1         2
        //            01234567890123456789012345
        //            ^outer: bytes 0-23
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::FormattedString(outer) = &expr.value {
                    let outer_id = outer
                        .node_id
                        .expect("Outer FormattedString should have node_id");
                    let outer_pos = positions
                        .get(&outer_id)
                        .expect("Outer FormattedString should have position");
                    let outer_span = outer_pos
                        .ident_span
                        .expect("Outer FormattedString should have ident_span");

                    // Outer f-string covers entire string from f" to closing "
                    assert_eq!(outer_span.start, 0, "outer fstring should start at 0");
                    assert_eq!(outer_span.end, 23, "outer fstring should end at 23");
                    assert_eq!(
                        &source[outer_span.start..outer_span.end],
                        "f\"outer {f'inner {x}'}\""
                    );
                } else {
                    panic!("Expected FormattedString expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_string_span_multiline_string() {
        // Triple-quoted multiline string - this is a SimpleString
        let source = "\"\"\"line1\nline2\"\"\"\n";
        //            0         1         2
        //            012345678901234567890
        //            ^simple string: bytes 0-17
        let (module, positions) = parse_with_positions(source);

        if let Statement::Simple(simple) = &module.body[0] {
            if let SmallStatement::Expr(expr) = &simple.body[0] {
                if let Expression::SimpleString(ss) = &expr.value {
                    let node_id = ss.node_id.expect("SimpleString should have node_id");
                    let pos = positions
                        .get(&node_id)
                        .expect("SimpleString should have position");
                    let span = pos.ident_span.expect("SimpleString should have ident_span");

                    assert_eq!(span.start, 0, "multiline string should start at 0");
                    assert_eq!(span.end, 17, "multiline string should end at 17");
                    assert_eq!(
                        &source[span.start..span.end],
                        "\"\"\"line1\nline2\"\"\""
                    );
                } else {
                    panic!("Expected SimpleString expression");
                }
            } else {
                panic!("Expected Expr statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    // =========================================================================
    // Step 0.2.0.9: Scope Statement Spans
    // =========================================================================

    #[test]
    fn test_scope_stmt_span_for_recorded() {
        let source = "for x in xs:\n    pass\n";
        //            0         1         2
        //            0123456789012345678901 2
        //            ^for: bytes 0-22 (dedent at 22, after final newline)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::For(for_stmt) = compound {
                let node_id = for_stmt.node_id.expect("For should have node_id");
                let pos = positions.get(&node_id).expect("For should have position");
                let span = pos.lexical_span.expect("For should have lexical_span");

                assert_eq!(span.start, 0, "for should start at 0");
                assert_eq!(span.end, 22, "for should end at 22 (dedent)");
            } else {
                panic!("Expected For statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_scope_stmt_span_async_for() {
        let source = "async for x in xs:\n    pass\n";
        //            0         1         2         3
        //            0123456789012345678901234567 8
        //            ^async for: bytes 0-28 (dedent at 28)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::For(for_stmt) = compound {
                let node_id = for_stmt.node_id.expect("For should have node_id");
                let pos = positions.get(&node_id).expect("For should have position");
                let span = pos.lexical_span.expect("For should have lexical_span");

                // Should start at 'async', not 'for'
                assert_eq!(span.start, 0, "async for should start at 0");
                assert_eq!(span.end, 28, "async for should end at 28");
                assert_eq!(&source[span.start..6], "async ");
            } else {
                panic!("Expected For statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_scope_stmt_span_while_recorded() {
        let source = "while cond:\n    pass\n";
        //            0         1         2
        //            01234567890123456789012
        //            ^while: bytes 0-21
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::While(while_stmt) = compound {
                let node_id = while_stmt.node_id.expect("While should have node_id");
                let pos = positions.get(&node_id).expect("While should have position");
                let span = pos.lexical_span.expect("While should have lexical_span");

                assert_eq!(span.start, 0, "while should start at 0");
                assert_eq!(span.end, 21, "while should end at 21");
            } else {
                panic!("Expected While statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_scope_stmt_span_with_recorded() {
        let source = "with ctx:\n    pass\n";
        //            0         1
        //            0123456789012345678 9
        //            ^with: bytes 0-19
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::With(with_stmt) = compound {
                let node_id = with_stmt.node_id.expect("With should have node_id");
                let pos = positions.get(&node_id).expect("With should have position");
                let span = pos.lexical_span.expect("With should have lexical_span");

                assert_eq!(span.start, 0, "with should start at 0");
                assert_eq!(span.end, 19, "with should end at 19");
            } else {
                panic!("Expected With statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_scope_stmt_span_async_with() {
        let source = "async with ctx:\n    pass\n";
        //            0         1         2
        //            012345678901234567890123456
        //            ^async with: bytes 0-25
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::With(with_stmt) = compound {
                let node_id = with_stmt.node_id.expect("With should have node_id");
                let pos = positions.get(&node_id).expect("With should have position");
                let span = pos.lexical_span.expect("With should have lexical_span");

                // Should start at 'async', not 'with'
                assert_eq!(span.start, 0, "async with should start at 0");
                assert_eq!(span.end, 25, "async with should end at 25");
                assert_eq!(&source[span.start..6], "async ");
            } else {
                panic!("Expected With statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_scope_stmt_span_try_recorded() {
        let source = "try:\n    pass\nexcept:\n    pass\n";
        //            0         1         2         3
        //            0123456789012345678901234567890 1
        //            ^try: bytes 0-31 (ends at except body dedent)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::Try(try_stmt) = compound {
                let node_id = try_stmt.node_id.expect("Try should have node_id");
                let pos = positions.get(&node_id).expect("Try should have position");
                let span = pos.lexical_span.expect("Try should have lexical_span");

                assert_eq!(span.start, 0, "try should start at 0");
                assert_eq!(span.end, 31, "try should end at 31");
            } else {
                panic!("Expected Try statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_scope_stmt_span_try_with_finally() {
        let source = "try:\n    pass\nfinally:\n    pass\n";
        //            0         1         2         3
        //            012345678901234567890123456789012
        //            ^try: bytes 0-32 (ends at finally body dedent)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::Try(try_stmt) = compound {
                let node_id = try_stmt.node_id.expect("Try should have node_id");
                let pos = positions.get(&node_id).expect("Try should have position");
                let span = pos.lexical_span.expect("Try should have lexical_span");

                assert_eq!(span.start, 0, "try should start at 0");
                // Span should extend to the finally body's dedent
                assert_eq!(span.end, 32, "try should end at 32 (finally end)");
            } else {
                panic!("Expected Try statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_scope_stmt_span_match_recorded() {
        let source = "match x:\n    case 1:\n        pass\n";
        //            0         1         2         3
        //            01234567890123456789012345678901234
        //            ^match: bytes 0-34
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::Match(match_stmt) = compound {
                let node_id = match_stmt.node_id.expect("Match should have node_id");
                let pos = positions.get(&node_id).expect("Match should have position");
                let span = pos.lexical_span.expect("Match should have lexical_span");

                assert_eq!(span.start, 0, "match should start at 0");
                assert_eq!(span.end, 34, "match should end at 34");
            } else {
                panic!("Expected Match statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    // ========================================================================
    // Step 0.2.0.10 Tests: Branch Statement Span Recording
    // ========================================================================

    #[test]
    fn test_branch_stmt_span_else_recorded() {
        let source = "if cond:\n    pass\nelse:\n    pass\n";
        //            0         1         2         3
        //            0123456789012345678901234567890123
        //                              ^else: bytes 18-33 (dedent at 33)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::If(if_stmt) = compound {
                if let Some(orelse) = &if_stmt.orelse {
                    if let OrElse::Else(else_clause) = orelse.as_ref() {
                        let node_id = else_clause.node_id.expect("Else should have node_id");
                        let pos = positions.get(&node_id).expect("Else should have position");
                        let span = pos.branch_span.expect("Else should have branch_span");

                        assert_eq!(span.start, 18, "else should start at 18");
                        assert_eq!(span.end, 33, "else should end at 33 (dedent)");
                    } else {
                        panic!("Expected Else clause, got Elif");
                    }
                } else {
                    panic!("Expected orelse clause");
                }
            } else {
                panic!("Expected If statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_branch_stmt_span_except_recorded() {
        let source = "try:\n    pass\nexcept E:\n    pass\n";
        //            0         1         2         3
        //            01234567890123456789012345678901234
        //                        ^except: bytes 14-33 (dedent at 33)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::Try(try_stmt) = compound {
                let handler = &try_stmt.handlers[0];
                let node_id = handler.node_id.expect("ExceptHandler should have node_id");
                let pos = positions.get(&node_id).expect("ExceptHandler should have position");
                let span = pos.branch_span.expect("ExceptHandler should have branch_span");

                assert_eq!(span.start, 14, "except should start at 14");
                assert_eq!(span.end, 33, "except should end at 33 (dedent)");
            } else {
                panic!("Expected Try statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_branch_stmt_span_except_star() {
        let source = "try:\n    pass\nexcept* E:\n    pass\n";
        //            0         1         2         3
        //            012345678901234567890123456789012345
        //                        ^except*: bytes 14-34 (dedent at 34)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::TryStar(try_star) = compound {
                let handler = &try_star.handlers[0];
                let node_id = handler.node_id.expect("ExceptStarHandler should have node_id");
                let pos = positions
                    .get(&node_id)
                    .expect("ExceptStarHandler should have position");
                let span = pos
                    .branch_span
                    .expect("ExceptStarHandler should have branch_span");

                assert_eq!(span.start, 14, "except* should start at 14");
                assert_eq!(span.end, 34, "except* should end at 34 (dedent)");
            } else {
                panic!("Expected TryStar statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_branch_stmt_span_finally_recorded() {
        let source = "try:\n    pass\nfinally:\n    pass\n";
        //            0         1         2         3
        //            0123456789012345678901234567890123
        //                        ^finally: bytes 14-32 (dedent at 32)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::Try(try_stmt) = compound {
                if let Some(finally_clause) = &try_stmt.finalbody {
                    let node_id = finally_clause.node_id.expect("Finally should have node_id");
                    let pos = positions.get(&node_id).expect("Finally should have position");
                    let span = pos.branch_span.expect("Finally should have branch_span");

                    assert_eq!(span.start, 14, "finally should start at 14");
                    assert_eq!(span.end, 32, "finally should end at 32 (dedent)");
                } else {
                    panic!("Expected finalbody clause");
                }
            } else {
                panic!("Expected Try statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_branch_stmt_span_match_case_recorded() {
        let source = "match x:\n    case 1:\n        pass\n";
        //            0         1         2         3
        //            0123456789012345678901234567890123 4
        //                       ^case: bytes 13-34 (dedent at 34)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::Match(match_stmt) = compound {
                let case_clause = &match_stmt.cases[0];
                let node_id = case_clause.node_id.expect("MatchCase should have node_id");
                let pos = positions.get(&node_id).expect("MatchCase should have position");
                let span = pos.branch_span.expect("MatchCase should have branch_span");

                assert_eq!(span.start, 13, "case should start at 13");
                assert_eq!(span.end, 34, "case should end at 34 (dedent)");
            } else {
                panic!("Expected Match statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }

    #[test]
    fn test_branch_stmt_span_multiple_except_handlers() {
        let source = "try:\n    pass\nexcept A:\n    pass\nexcept B:\n    pass\n";
        //            0         1         2         3         4         5
        //            01234567890123456789012345678901234567890123456789012
        //                        ^except A: bytes 14-33
        //                                         ^except B: bytes 33-52 (dedent at 52)
        let (module, positions) = parse_with_positions(source);

        if let Statement::Compound(compound) = &module.body[0] {
            if let CompoundStatement::Try(try_stmt) = compound {
                // First handler (except A)
                let handler1 = &try_stmt.handlers[0];
                let node_id1 = handler1.node_id.expect("First ExceptHandler should have node_id");
                let pos1 = positions
                    .get(&node_id1)
                    .expect("First ExceptHandler should have position");
                let span1 = pos1
                    .branch_span
                    .expect("First ExceptHandler should have branch_span");

                assert_eq!(span1.start, 14, "first except should start at 14");
                assert_eq!(span1.end, 33, "first except should end at 33");

                // Second handler (except B)
                let handler2 = &try_stmt.handlers[1];
                let node_id2 = handler2.node_id.expect("Second ExceptHandler should have node_id");
                let pos2 = positions
                    .get(&node_id2)
                    .expect("Second ExceptHandler should have position");
                let span2 = pos2
                    .branch_span
                    .expect("Second ExceptHandler should have branch_span");

                assert_eq!(span2.start, 33, "second except should start at 33");
                assert_eq!(span2.end, 52, "second except should end at 52 (dedent)");
            } else {
                panic!("Expected Try statement");
            }
        } else {
            panic!("Expected Compound statement");
        }
    }
}

// ============================================================================
// Deflated State Tests
// ============================================================================
//
// These tests verify functionality that operates on deflated structs before
// inflation. The deflated structs contain TokenRef fields with position
// information that is filtered out during inflation.
//
// Key insight: parse_tokens_without_whitespace returns DeflatedModule,
// giving us direct access to deflated state for verification.

#[cfg(test)]
mod deflated_tests {
    use super::*;
    use crate::nodes::deflated::{CompoundStatement, SmallStatement, Statement, Suite};
    use crate::nodes::statement::deflated_suite_end_pos;

    // ========================================================================
    // Step 0.2.0.1 Tests: Token Field Capture Verification
    // ========================================================================
    //
    // These tests verify that Pass, Break, Continue tok fields correctly
    // capture the keyword token with accurate position information.

    #[test]
    fn test_pass_tok_captures_keyword_position() {
        let source = "pass\n";
        //            01234
        //            ^pass: start=0, end=4

        let tokens = tokenize(source).expect("tokenize error");
        let tokvec: TokVec = tokens.into();
        let deflated =
            parse_tokens_without_whitespace(&tokvec, source, None).expect("parse error");

        if let Statement::Simple(simple) = &deflated.body[0] {
            if let SmallStatement::Pass(pass) = &simple.body[0] {
                assert_eq!(
                    pass.tok.start_pos.byte_idx(),
                    0,
                    "pass tok should start at byte 0"
                );
                assert_eq!(
                    pass.tok.end_pos.byte_idx(),
                    4,
                    "pass tok should end at byte 4"
                );
                assert_eq!(pass.tok.string, "pass", "tok.string should be 'pass'");
            } else {
                panic!("Expected Pass statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_pass_tok_with_semicolon_is_separate() {
        let source = "pass;\n";
        //            012345
        //            ^pass: start=0, end=4 (semicolon is separate)

        let tokens = tokenize(source).expect("tokenize error");
        let tokvec: TokVec = tokens.into();
        let deflated =
            parse_tokens_without_whitespace(&tokvec, source, None).expect("parse error");

        if let Statement::Simple(simple) = &deflated.body[0] {
            if let SmallStatement::Pass(pass) = &simple.body[0] {
                // tok should only cover "pass", not the semicolon
                assert_eq!(
                    pass.tok.start_pos.byte_idx(),
                    0,
                    "pass tok should start at byte 0"
                );
                assert_eq!(
                    pass.tok.end_pos.byte_idx(),
                    4,
                    "pass tok should end at byte 4 (before semicolon)"
                );
                assert!(pass.semicolon.is_some(), "semicolon should be present");
            } else {
                panic!("Expected Pass statement");
            }
        } else {
            panic!("Expected Simple statement");
        }
    }

    #[test]
    fn test_break_tok_captures_keyword_position() {
        let source = "while True:\n    break\n";
        //            0         1         2
        //            0123456789012345678901
        //                            ^break: start=16, end=21

        let tokens = tokenize(source).expect("tokenize error");
        let tokvec: TokVec = tokens.into();
        let deflated =
            parse_tokens_without_whitespace(&tokvec, source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::While(while_stmt)) = &deflated.body[0] {
            if let Suite::IndentedBlock(block) = &while_stmt.body {
                if let Statement::Simple(simple) = &block.body[0] {
                    if let SmallStatement::Break(break_stmt) = &simple.body[0] {
                        assert_eq!(
                            break_stmt.tok.start_pos.byte_idx(),
                            16,
                            "break tok should start at byte 16"
                        );
                        assert_eq!(
                            break_stmt.tok.end_pos.byte_idx(),
                            21,
                            "break tok should end at byte 21"
                        );
                        assert_eq!(break_stmt.tok.string, "break", "tok.string should be 'break'");
                    } else {
                        panic!("Expected Break statement");
                    }
                } else {
                    panic!("Expected Simple statement in while body");
                }
            } else {
                panic!("Expected IndentedBlock");
            }
        } else {
            panic!("Expected While compound statement");
        }
    }

    #[test]
    fn test_continue_tok_captures_keyword_position() {
        let source = "for x in y:\n    continue\n";
        //            0         1         2
        //            0123456789012345678901234
        //                            ^continue: start=16, end=24

        let tokens = tokenize(source).expect("tokenize error");
        let tokvec: TokVec = tokens.into();
        let deflated =
            parse_tokens_without_whitespace(&tokvec, source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::For(for_stmt)) = &deflated.body[0] {
            if let Suite::IndentedBlock(block) = &for_stmt.body {
                if let Statement::Simple(simple) = &block.body[0] {
                    if let SmallStatement::Continue(continue_stmt) = &simple.body[0] {
                        assert_eq!(
                            continue_stmt.tok.start_pos.byte_idx(),
                            16,
                            "continue tok should start at byte 16"
                        );
                        assert_eq!(
                            continue_stmt.tok.end_pos.byte_idx(),
                            24,
                            "continue tok should end at byte 24"
                        );
                        assert_eq!(
                            continue_stmt.tok.string, "continue",
                            "tok.string should be 'continue'"
                        );
                    } else {
                        panic!("Expected Continue statement");
                    }
                } else {
                    panic!("Expected Simple statement in for body");
                }
            } else {
                panic!("Expected IndentedBlock");
            }
        } else {
            panic!("Expected For compound statement");
        }
    }

    // ========================================================================
    // Step 0.2.0.2 Tests: Suite End Position Helper
    // ========================================================================
    //
    // These tests verify that deflated_suite_end_pos correctly computes
    // the byte end position for both IndentedBlock and SimpleStatementSuite.

    #[test]
    fn test_suite_end_pos_indented_block() {
        let source = "def f():\n    pass\n";
        //            0         1
        //            012345678901234567
        //                             ^newline at 17, dedent follows

        let tokens = tokenize(source).expect("tokenize error");
        let tokvec: TokVec = tokens.into();
        let deflated =
            parse_tokens_without_whitespace(&tokvec, source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &deflated.body[0] {
            if let Suite::IndentedBlock(block) = &func.body {
                let end_pos = deflated_suite_end_pos(&func.body);

                // For IndentedBlock, end_pos should be dedent_tok.start_pos
                // The dedent token appears at the end of the indented content
                assert_eq!(
                    end_pos,
                    block.dedent_tok.start_pos.byte_idx(),
                    "suite end_pos should match dedent_tok.start_pos"
                );

                // Verify the position is at or after the content
                assert!(
                    end_pos >= 17,
                    "suite end_pos {} should be >= 17 (end of 'pass\\n')",
                    end_pos
                );
            } else {
                panic!("Expected IndentedBlock");
            }
        } else {
            panic!("Expected FunctionDef");
        }
    }

    #[test]
    fn test_suite_end_pos_simple_statement_suite() {
        let source = "def f(): pass\n";
        //            0         1
        //            01234567890123
        //                         ^newline at 13, ends at 14

        let tokens = tokenize(source).expect("tokenize error");
        let tokvec: TokVec = tokens.into();
        let deflated =
            parse_tokens_without_whitespace(&tokvec, source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::FunctionDef(func)) = &deflated.body[0] {
            if let Suite::SimpleStatementSuite(suite) = &func.body {
                let end_pos = deflated_suite_end_pos(&func.body);

                // For SimpleStatementSuite, end_pos should be newline_tok.end_pos
                assert_eq!(
                    end_pos,
                    suite.newline_tok.end_pos.byte_idx(),
                    "suite end_pos should match newline_tok.end_pos"
                );

                // The newline ends at byte 14 (source length)
                assert_eq!(end_pos, 14, "suite end_pos should be 14 (after newline)");
            } else {
                panic!("Expected SimpleStatementSuite");
            }
        } else {
            panic!("Expected FunctionDef");
        }
    }

    #[test]
    fn test_suite_end_pos_nested_functions() {
        // Verify inner function body ends before outer function body
        let source = "def outer():\n    def inner():\n        pass\n    x = 1\n";
        //            0         1         2         3         4         5
        //            012345678901234567890123456789012345678901234567890123

        let tokens = tokenize(source).expect("tokenize error");
        let tokvec: TokVec = tokens.into();
        let deflated =
            parse_tokens_without_whitespace(&tokvec, source, None).expect("parse error");

        if let Statement::Compound(CompoundStatement::FunctionDef(outer)) = &deflated.body[0] {
            if let Suite::IndentedBlock(outer_block) = &outer.body {
                let outer_end = deflated_suite_end_pos(&outer.body);

                // Find inner function
                if let Statement::Compound(CompoundStatement::FunctionDef(inner)) =
                    &outer_block.body[0]
                {
                    let inner_end = deflated_suite_end_pos(&inner.body);

                    // Inner function body should end before outer function body
                    assert!(
                        inner_end < outer_end,
                        "inner end {} should be < outer end {}",
                        inner_end,
                        outer_end
                    );
                } else {
                    panic!("Expected inner FunctionDef");
                }
            } else {
                panic!("Expected outer IndentedBlock");
            }
        } else {
            panic!("Expected outer FunctionDef");
        }
    }
}
