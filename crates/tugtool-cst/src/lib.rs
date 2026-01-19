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
//! use tugtool_cst::{parse_module, Codegen, CodegenState};
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
//! use tugtool_cst::{parse_module_with_options, ParseOptions, PythonVersion};
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
pub use visitor::{Transform, Transformer, VisitResult, Visitor};

/// Tokenizer for Python source code.
pub mod tokenizer;
pub use tokenizer::whitespace_parser::Config;
use tokenizer::{whitespace_parser, TokConfig, Token, TokenIterator};

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
/// use tugtool_cst::tokenize;
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
/// use tugtool_cst::{parse_module_with_options, ParseOptions, PythonVersion};
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
    let tokvec = tokens.into();
    let m = parse_tokens_without_whitespace(&tokvec, module_text, options.encoding_str())?;
    Ok(m.inflate(&conf)?)
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
/// use tugtool_cst::parse_module;
///
/// let module = parse_module("x = 1", None).expect("parse error");
/// ```
pub fn parse_module<'a>(
    module_text: &'a str,
    encoding: Option<&str>,
) -> Result<'a, Module<'a>> {
    let options = match encoding {
        Some(enc) => ParseOptions::default().with_encoding(enc),
        None => ParseOptions::default(),
    };
    parse_module_with_options(module_text, options)
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
/// use tugtool_cst::parse_statement;
///
/// let stmt = parse_statement("x = 1").expect("parse error");
/// ```
pub fn parse_statement(text: &str) -> Result<Statement> {
    let tokens = tokenize(text)?;
    let conf = whitespace_parser::Config::new(text, &tokens);
    let tokvec = tokens.into();
    let stm = parser::python::statement_input(&tokvec, text)
        .map_err(|err| ParserError::ParserError(err, text))?;
    Ok(stm.inflate(&conf)?)
}

/// Parses a single Python expression.
///
/// # Example
///
/// ```
/// use tugtool_cst::parse_expression;
///
/// let expr = parse_expression("1 + 2").expect("parse error");
/// ```
pub fn parse_expression(text: &str) -> Result<Expression> {
    let tokens = tokenize(text)?;
    let conf = whitespace_parser::Config::new(text, &tokens);
    let tokvec = tokens.into();
    let expr = parser::python::expression_input(&tokvec, text)
        .map_err(|err| ParserError::ParserError(err, text))?;
    Ok(expr.inflate(&conf)?)
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
/// use tugtool_cst::{parse_module, prettify_error};
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
        let module_v38 =
            parse_module_with_options(source, ParseOptions::new(PythonVersion::V3_8))
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
}
