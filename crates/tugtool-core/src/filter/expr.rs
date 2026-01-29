//! Filter expression parser and evaluator.
//!
//! This module implements the filter expression language for compound file filtering.
//! Expressions combine predicates with boolean operators (`and`, `or`, `not`) and
//! support parentheses for grouping.
//!
//! ## Grammar
//!
//! ```text
//! <expr>       := <term> (("and" | "or") <term>)*
//! <term>       := ["not"] <factor>
//! <factor>     := <predicate> | "(" <expr> ")"
//! <predicate>  := key ":" value | key "~" regex | key comparator value
//! ```
//!
//! ## Examples
//!
//! ```text
//! ext:py                              # Simple predicate
//! ext:py and path:src/**              # Conjunction
//! ext:py or ext:pyi                   # Disjunction
//! not name:*_test.py                  # Negation
//! (ext:py or ext:pyi) and path:src/** # Grouping
//! size>10k                            # Comparison
//! contains:"TODO"                     # Quoted value
//! ```

use std::fs::Metadata;
use std::path::Path;

use thiserror::Error;
use winnow::ascii::multispace0;
use winnow::combinator::{alt, delimited, opt, preceded, repeat};
use winnow::error::{ErrMode, ParserError};
use winnow::prelude::*;
use winnow::token::{take_till, take_while};
use winnow::ModalResult;

use super::predicate::{
    ContentAccess, FilterPredicate, GitState, PredicateError, PredicateKey, PredicateOp,
};

/// Error type for expression parsing and evaluation.
#[derive(Debug, Error)]
pub enum ExprError {
    /// Invalid expression syntax.
    #[error("invalid expression '{input}': {message}")]
    InvalidExpression { input: String, message: String },

    /// Predicate evaluation error.
    #[error(transparent)]
    PredicateError(#[from] PredicateError),
}

/// A filter expression combining predicates with boolean operators.
#[derive(Debug, Clone)]
pub enum FilterExpr {
    /// Conjunction of expressions (all must match).
    And(Vec<FilterExpr>),
    /// Disjunction of expressions (any must match).
    Or(Vec<FilterExpr>),
    /// Negation of an expression.
    Not(Box<FilterExpr>),
    /// A single predicate.
    Pred(FilterPredicate),
}

impl FilterExpr {
    /// Evaluate this expression against a file.
    ///
    /// # Arguments
    ///
    /// * `path` - Path to the file (relative to workspace root)
    /// * `metadata` - Optional file metadata for size checks
    /// * `git_state` - Optional git state for git predicates
    /// * `content` - Optional file content for content predicates
    ///
    /// # Returns
    ///
    /// * `Ok(true)` - The expression matches
    /// * `Ok(false)` - The expression does not match
    /// * `Err(ExprError)` - Evaluation error
    pub fn evaluate(
        &self,
        path: &Path,
        metadata: Option<&Metadata>,
        git_state: Option<&GitState>,
        content: Option<&str>,
    ) -> Result<bool, ExprError> {
        let content_access = match content {
            Some(value) => ContentAccess::Available(value),
            None => ContentAccess::Disabled,
        };

        let result =
            self.evaluate_with_content_access(path, metadata, git_state, content_access)?;

        Ok(result.unwrap_or(false))
    }

    /// Evaluate this expression with explicit content access semantics.
    ///
    /// Returns `Ok(None)` when content is unavailable and the expression depends on it.
    pub(crate) fn evaluate_with_content_access(
        &self,
        path: &Path,
        metadata: Option<&Metadata>,
        git_state: Option<&GitState>,
        content: ContentAccess<'_>,
    ) -> Result<Option<bool>, ExprError> {
        match self {
            FilterExpr::And(exprs) => {
                let mut saw_unknown = false;
                for expr in exprs {
                    match expr.evaluate_with_content_access(path, metadata, git_state, content)? {
                        Some(true) => {}
                        Some(false) => return Ok(Some(false)),
                        None => saw_unknown = true,
                    }
                }
                Ok(if saw_unknown { None } else { Some(true) })
            }
            FilterExpr::Or(exprs) => {
                let mut saw_unknown = false;
                for expr in exprs {
                    match expr.evaluate_with_content_access(path, metadata, git_state, content)? {
                        Some(true) => return Ok(Some(true)),
                        Some(false) => {}
                        None => saw_unknown = true,
                    }
                }
                Ok(if saw_unknown { None } else { Some(false) })
            }
            FilterExpr::Not(expr) => Ok(expr
                .evaluate_with_content_access(path, metadata, git_state, content)?
                .map(|value| !value)),
            FilterExpr::Pred(pred) => pred
                .evaluate_with_content_access(path, metadata, git_state, content)
                .map_err(ExprError::from),
        }
    }

    /// Returns true if any predicate in this expression requires content access.
    pub fn requires_content(&self) -> bool {
        match self {
            FilterExpr::And(exprs) | FilterExpr::Or(exprs) => {
                exprs.iter().any(|e| e.requires_content())
            }
            FilterExpr::Not(expr) => expr.requires_content(),
            FilterExpr::Pred(pred) => pred.requires_content(),
        }
    }

    /// Returns true if any predicate in this expression requires metadata.
    pub fn requires_metadata(&self) -> bool {
        match self {
            FilterExpr::And(exprs) | FilterExpr::Or(exprs) => {
                exprs.iter().any(|e| e.requires_metadata())
            }
            FilterExpr::Not(expr) => expr.requires_metadata(),
            FilterExpr::Pred(pred) => pred.requires_metadata(),
        }
    }

    /// Returns true if any predicate in this expression requires git state.
    pub fn requires_git(&self) -> bool {
        match self {
            FilterExpr::And(exprs) | FilterExpr::Or(exprs) => {
                exprs.iter().any(|e| e.requires_git())
            }
            FilterExpr::Not(expr) => expr.requires_git(),
            FilterExpr::Pred(pred) => pred.requires_git(),
        }
    }
}

/// Parse a filter expression from a string.
///
/// # Examples
///
/// ```
/// use tugtool_core::filter::parse_filter_expr;
///
/// // Simple predicate
/// let expr = parse_filter_expr("ext:py").unwrap();
///
/// // Compound expression
/// let expr = parse_filter_expr("ext:py and path:src/**").unwrap();
///
/// // Negation
/// let expr = parse_filter_expr("not name:*_test.py").unwrap();
///
/// // Grouping
/// let expr = parse_filter_expr("(ext:py or ext:pyi) and path:src/**").unwrap();
/// ```
pub fn parse_filter_expr(input: &str) -> Result<FilterExpr, ExprError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(ExprError::InvalidExpression {
            input: input.to_string(),
            message: "empty expression".to_string(),
        });
    }

    parse_expr
        .parse(input)
        .map_err(|e| ExprError::InvalidExpression {
            input: input.to_string(),
            message: format!("{:?}", e),
        })
}

// ============================================================================
// Parser implementation using winnow
// ============================================================================

/// Parse the top-level expression (handles 'or' at lowest precedence).
fn parse_expr(input: &mut &str) -> ModalResult<FilterExpr> {
    let first = parse_and_expr(input)?;

    let rest: Vec<FilterExpr> = repeat(
        0..,
        preceded((multispace0, parse_or_keyword, multispace0), parse_and_expr),
    )
    .parse_next(input)?;

    if rest.is_empty() {
        Ok(first)
    } else {
        let mut all = vec![first];
        all.extend(rest);
        Ok(FilterExpr::Or(all))
    }
}

/// Parse an 'and' expression (higher precedence than 'or').
fn parse_and_expr(input: &mut &str) -> ModalResult<FilterExpr> {
    let first = parse_term(input)?;

    let rest: Vec<FilterExpr> = repeat(
        0..,
        preceded((multispace0, parse_and_keyword, multispace0), parse_term),
    )
    .parse_next(input)?;

    if rest.is_empty() {
        Ok(first)
    } else {
        let mut all = vec![first];
        all.extend(rest);
        Ok(FilterExpr::And(all))
    }
}

/// Parse a term (handles 'not' prefix).
fn parse_term(input: &mut &str) -> ModalResult<FilterExpr> {
    let _ = multispace0.parse_next(input)?;

    // Check for 'not' keyword
    let negated = opt((parse_not_keyword, multispace0))
        .parse_next(input)?
        .is_some();

    let factor = parse_factor(input)?;

    if negated {
        Ok(FilterExpr::Not(Box::new(factor)))
    } else {
        Ok(factor)
    }
}

/// Parse a factor (predicate or parenthesized expression).
fn parse_factor(input: &mut &str) -> ModalResult<FilterExpr> {
    let _ = multispace0.parse_next(input)?;

    alt((
        delimited(('(', multispace0), parse_expr, (multispace0, ')')),
        parse_predicate.map(FilterExpr::Pred),
    ))
    .parse_next(input)
}

/// Parse a predicate (key:value, key~regex, key>value, etc.).
fn parse_predicate(input: &mut &str) -> ModalResult<FilterPredicate> {
    let _ = multispace0.parse_next(input)?;

    // Parse the key
    let key_str: &str =
        take_while(1.., |c: char| c.is_alphanumeric() || c == '_').parse_next(input)?;

    let key = PredicateKey::parse(key_str).ok_or_else(|| ErrMode::from_input(input))?;

    // Parse the operator
    let op = parse_operator(input)?;

    // Parse the value
    let value = parse_value(input)?;

    Ok(FilterPredicate::new(key, op, value))
}

/// Parse an operator.
fn parse_operator(input: &mut &str) -> ModalResult<PredicateOp> {
    alt((
        ">=".map(|_| PredicateOp::Gte),
        "<=".map(|_| PredicateOp::Lte),
        "!=".map(|_| PredicateOp::Neq),
        ">".map(|_| PredicateOp::Gt),
        "<".map(|_| PredicateOp::Lt),
        "=".map(|_| PredicateOp::Eq),
        ":".map(|_| PredicateOp::Glob),
        "~".map(|_| PredicateOp::Match),
    ))
    .parse_next(input)
}

/// Parse a value (quoted or unquoted).
fn parse_value(input: &mut &str) -> ModalResult<String> {
    alt((parse_double_quoted, parse_single_quoted, parse_unquoted)).parse_next(input)
}

/// Parse a double-quoted string.
fn parse_double_quoted(input: &mut &str) -> ModalResult<String> {
    delimited('"', take_till(0.., |c| c == '"'), '"')
        .map(|s: &str| s.to_string())
        .parse_next(input)
}

/// Parse a single-quoted string.
fn parse_single_quoted(input: &mut &str) -> ModalResult<String> {
    delimited('\'', take_till(0.., |c| c == '\''), '\'')
        .map(|s: &str| s.to_string())
        .parse_next(input)
}

/// Parse an unquoted value (stops at whitespace or special chars).
fn parse_unquoted(input: &mut &str) -> ModalResult<String> {
    take_while(1.., |c: char| !c.is_whitespace() && c != ')' && c != '(')
        .map(|s: &str| s.to_string())
        .parse_next(input)
}

/// Parse the 'and' keyword (case-insensitive).
fn parse_and_keyword(input: &mut &str) -> ModalResult<()> {
    let checkpoint = *input;
    let word: &str = take_while(1.., |c: char| c.is_alphabetic()).parse_next(input)?;

    if word.eq_ignore_ascii_case("and") {
        Ok(())
    } else {
        *input = checkpoint;
        Err(ErrMode::from_input(input))
    }
}

/// Parse the 'or' keyword (case-insensitive).
fn parse_or_keyword(input: &mut &str) -> ModalResult<()> {
    let checkpoint = *input;
    let word: &str = take_while(1.., |c: char| c.is_alphabetic()).parse_next(input)?;

    if word.eq_ignore_ascii_case("or") {
        Ok(())
    } else {
        *input = checkpoint;
        Err(ErrMode::from_input(input))
    }
}

/// Parse the 'not' keyword (case-insensitive).
fn parse_not_keyword(input: &mut &str) -> ModalResult<()> {
    let checkpoint = *input;
    let word: &str = take_while(1.., |c: char| c.is_alphabetic()).parse_next(input)?;

    if word.eq_ignore_ascii_case("not") {
        // Must be followed by whitespace or '(' to avoid matching "nothing"
        if input.is_empty() || input.starts_with(char::is_whitespace) || input.starts_with('(') {
            Ok(())
        } else {
            *input = checkpoint;
            Err(ErrMode::from_input(input))
        }
    } else {
        *input = checkpoint;
        Err(ErrMode::from_input(input))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // =========================================================================
    // Parse Tests
    // =========================================================================

    #[test]
    fn test_parse_simple_predicate() {
        let expr = parse_filter_expr("ext:py").unwrap();
        match expr {
            FilterExpr::Pred(pred) => {
                assert_eq!(pred.key, PredicateKey::Ext);
                assert_eq!(pred.op, PredicateOp::Glob);
                assert_eq!(pred.value, "py");
            }
            _ => panic!("Expected Pred variant"),
        }
    }

    #[test]
    fn test_parse_predicate_with_colon() {
        let expr = parse_filter_expr("path:src/**").unwrap();
        match expr {
            FilterExpr::Pred(pred) => {
                assert_eq!(pred.key, PredicateKey::Path);
                assert_eq!(pred.op, PredicateOp::Glob);
                assert_eq!(pred.value, "src/**");
            }
            _ => panic!("Expected Pred variant"),
        }
    }

    #[test]
    fn test_parse_predicate_with_comparison() {
        let expr = parse_filter_expr("size>10k").unwrap();
        match expr {
            FilterExpr::Pred(pred) => {
                assert_eq!(pred.key, PredicateKey::Size);
                assert_eq!(pred.op, PredicateOp::Gt);
                assert_eq!(pred.value, "10k");
            }
            _ => panic!("Expected Pred variant"),
        }
    }

    #[test]
    fn test_parse_and_expression() {
        let expr = parse_filter_expr("ext:py and path:src/**").unwrap();
        match expr {
            FilterExpr::And(exprs) => {
                assert_eq!(exprs.len(), 2);
            }
            _ => panic!("Expected And variant"),
        }
    }

    #[test]
    fn test_parse_or_expression() {
        let expr = parse_filter_expr("ext:py or ext:pyi").unwrap();
        match expr {
            FilterExpr::Or(exprs) => {
                assert_eq!(exprs.len(), 2);
            }
            _ => panic!("Expected Or variant"),
        }
    }

    #[test]
    fn test_parse_not_expression() {
        let expr = parse_filter_expr("not name:*_test.py").unwrap();
        match expr {
            FilterExpr::Not(inner) => match *inner {
                FilterExpr::Pred(pred) => {
                    assert_eq!(pred.key, PredicateKey::Name);
                    assert_eq!(pred.value, "*_test.py");
                }
                _ => panic!("Expected Pred inside Not"),
            },
            _ => panic!("Expected Not variant"),
        }
    }

    #[test]
    fn test_parse_nested_parentheses() {
        let expr = parse_filter_expr("(ext:py or ext:pyi) and path:src/**").unwrap();
        match expr {
            FilterExpr::And(exprs) => {
                assert_eq!(exprs.len(), 2);
                match &exprs[0] {
                    FilterExpr::Or(or_exprs) => {
                        assert_eq!(or_exprs.len(), 2);
                    }
                    _ => panic!("Expected Or as first element"),
                }
            }
            _ => panic!("Expected And variant"),
        }
    }

    #[test]
    fn test_parse_case_insensitive_and() {
        let expr = parse_filter_expr("ext:py AND path:src/**").unwrap();
        match expr {
            FilterExpr::And(exprs) => {
                assert_eq!(exprs.len(), 2);
            }
            _ => panic!("Expected And variant"),
        }
    }

    #[test]
    fn test_parse_case_insensitive_or() {
        let expr = parse_filter_expr("ext:py OR ext:pyi").unwrap();
        match expr {
            FilterExpr::Or(exprs) => {
                assert_eq!(exprs.len(), 2);
            }
            _ => panic!("Expected Or variant"),
        }
    }

    #[test]
    fn test_parse_quoted_value() {
        let expr = parse_filter_expr("contains:\"hello world\"").unwrap();
        match expr {
            FilterExpr::Pred(pred) => {
                assert_eq!(pred.key, PredicateKey::Contains);
                assert_eq!(pred.value, "hello world");
            }
            _ => panic!("Expected Pred variant"),
        }
    }

    #[test]
    fn test_parse_invalid_syntax_error() {
        let result = parse_filter_expr("");
        assert!(result.is_err());
        match result.unwrap_err() {
            ExprError::InvalidExpression { input, message } => {
                assert_eq!(input, "");
                assert!(message.contains("empty"));
            }
            _ => panic!("Expected InvalidExpression"),
        }
    }

    // =========================================================================
    // Evaluate Tests
    // =========================================================================

    #[test]
    fn test_evaluate_and_both_true() {
        let expr = parse_filter_expr("ext:py and path:src/**").unwrap();
        let result = expr
            .evaluate(Path::new("src/main.py"), None, None, None)
            .unwrap();
        assert!(result);
    }

    #[test]
    fn test_evaluate_and_one_false() {
        let expr = parse_filter_expr("ext:py and path:src/**").unwrap();
        let result = expr
            .evaluate(Path::new("tests/test_main.py"), None, None, None)
            .unwrap();
        assert!(!result);
    }

    #[test]
    fn test_evaluate_or_one_true() {
        let expr = parse_filter_expr("ext:py or ext:rs").unwrap();
        let result = expr
            .evaluate(Path::new("src/main.py"), None, None, None)
            .unwrap();
        assert!(result);
    }

    #[test]
    fn test_evaluate_not_inverts() {
        let expr = parse_filter_expr("not ext:py").unwrap();
        // .py file should NOT match
        let result = expr
            .evaluate(Path::new("src/main.py"), None, None, None)
            .unwrap();
        assert!(!result);

        // .rs file SHOULD match (not a .py file)
        let result = expr
            .evaluate(Path::new("src/main.rs"), None, None, None)
            .unwrap();
        assert!(result);
    }
}
