//! JSON filter schema parsing and conversion.
//!
//! This module implements JSON-based filter specification for programmatic filtering.
//! It provides a structured alternative to the expression syntax that's easier to
//! generate from tools and APIs.
//!
//! ## Schema
//!
//! ```json
//! {
//!   "all": [ <filter>, ... ],
//!   "any": [ <filter>, ... ],
//!   "not": <filter>,
//!   "predicates": [
//!     { "key": "path", "op": "glob", "value": "src/**" },
//!     { "key": "ext", "op": "eq", "value": "py" }
//!   ]
//! }
//! ```
//!
//! - `all` and `any` support nested filters for complex logic
//! - `predicates` are combined with AND
//! - Only one top-level key is allowed per filter object

use serde::Deserialize;
use thiserror::Error;

use super::expr::FilterExpr;
use super::predicate::{FilterPredicate, PredicateKey, PredicateOp};

/// Error type for JSON filter parsing.
#[derive(Debug, Error)]
pub enum JsonFilterError {
    /// JSON parse error.
    #[error("invalid JSON: {0}")]
    ParseError(String),

    /// Invalid filter structure.
    #[error("invalid filter: {message}")]
    InvalidFilter { message: String },

    /// Unknown predicate key.
    #[error("unknown predicate key: {key}")]
    UnknownKey { key: String },

    /// Unknown operator.
    #[error("unknown operator: {op}")]
    UnknownOperator { op: String },

    /// Missing required field.
    #[error("missing required field: {field}")]
    MissingField { field: String },
}

/// A predicate in JSON format with string-typed fields for serde.
#[derive(Debug, Clone, Deserialize)]
pub struct JsonPredicate {
    /// The predicate key (e.g., "path", "ext", "size").
    pub key: String,
    /// The operator (e.g., "glob", "eq", "gt").
    pub op: String,
    /// The value to compare against.
    pub value: String,
}

impl JsonPredicate {
    /// Convert to a FilterPredicate.
    fn to_filter_predicate(&self) -> Result<FilterPredicate, JsonFilterError> {
        let key = PredicateKey::parse(&self.key).ok_or_else(|| JsonFilterError::UnknownKey {
            key: self.key.clone(),
        })?;

        let op = parse_json_operator(&self.op)?;

        Ok(FilterPredicate::new(key, op, &self.value))
    }
}

/// A filter in JSON format supporting combinators.
///
/// Only one of the fields should be set. If multiple are set, the first
/// one found (in order: all, any, not, predicates) is used.
#[derive(Debug, Clone, Deserialize)]
pub struct JsonFilter {
    /// Conjunction: all filters must match.
    #[serde(default)]
    pub all: Option<Vec<JsonFilter>>,

    /// Disjunction: any filter must match.
    #[serde(default)]
    pub any: Option<Vec<JsonFilter>>,

    /// Negation: the filter must not match.
    #[serde(default)]
    pub not: Option<Box<JsonFilter>>,

    /// List of predicates combined with AND.
    #[serde(default)]
    pub predicates: Option<Vec<JsonPredicate>>,
}

impl JsonFilter {
    /// Convert to a FilterExpr.
    fn to_filter_expr(&self) -> Result<FilterExpr, JsonFilterError> {
        // Check which field is set (in priority order)
        if let Some(ref filters) = self.all {
            if filters.is_empty() {
                return Err(JsonFilterError::InvalidFilter {
                    message: "empty 'all' array".to_string(),
                });
            }
            let exprs: Result<Vec<_>, _> =
                filters.iter().map(|f| f.to_filter_expr()).collect();
            return Ok(FilterExpr::And(exprs?));
        }

        if let Some(ref filters) = self.any {
            if filters.is_empty() {
                return Err(JsonFilterError::InvalidFilter {
                    message: "empty 'any' array".to_string(),
                });
            }
            let exprs: Result<Vec<_>, _> =
                filters.iter().map(|f| f.to_filter_expr()).collect();
            return Ok(FilterExpr::Or(exprs?));
        }

        if let Some(ref filter) = self.not {
            let expr = filter.to_filter_expr()?;
            return Ok(FilterExpr::Not(Box::new(expr)));
        }

        if let Some(ref predicates) = self.predicates {
            if predicates.is_empty() {
                return Err(JsonFilterError::InvalidFilter {
                    message: "empty 'predicates' array".to_string(),
                });
            }
            let exprs: Result<Vec<_>, _> = predicates
                .iter()
                .map(|p| p.to_filter_predicate().map(FilterExpr::Pred))
                .collect();
            let exprs = exprs?;
            // Single predicate doesn't need And wrapper
            if exprs.len() == 1 {
                return Ok(exprs.into_iter().next().unwrap());
            }
            return Ok(FilterExpr::And(exprs));
        }

        Err(JsonFilterError::InvalidFilter {
            message: "filter must have at least one of: all, any, not, predicates".to_string(),
        })
    }
}

/// Parse a JSON operator string to PredicateOp.
fn parse_json_operator(op: &str) -> Result<PredicateOp, JsonFilterError> {
    match op.to_lowercase().as_str() {
        "glob" | ":" => Ok(PredicateOp::Glob),
        "eq" | "=" => Ok(PredicateOp::Eq),
        "neq" | "!=" => Ok(PredicateOp::Neq),
        "gt" | ">" => Ok(PredicateOp::Gt),
        "gte" | ">=" => Ok(PredicateOp::Gte),
        "lt" | "<" => Ok(PredicateOp::Lt),
        "lte" | "<=" => Ok(PredicateOp::Lte),
        "match" | "~" => Ok(PredicateOp::Match),
        _ => Err(JsonFilterError::UnknownOperator { op: op.to_string() }),
    }
}

/// Parse a JSON filter string into a FilterExpr.
///
/// # Arguments
///
/// * `input` - JSON string containing the filter specification
///
/// # Returns
///
/// * `Ok(FilterExpr)` - Successfully parsed filter expression
/// * `Err(JsonFilterError)` - Parse or validation error
///
/// # Examples
///
/// ```
/// use tugtool_core::filter::parse_filter_json;
///
/// // Simple predicate
/// let expr = parse_filter_json(r#"{"predicates":[{"key":"ext","op":"eq","value":"py"}]}"#).unwrap();
///
/// // Complex filter with combinators
/// let expr = parse_filter_json(r#"{
///   "all": [
///     {"predicates":[{"key":"ext","op":"eq","value":"py"}]},
///     {"predicates":[{"key":"path","op":"glob","value":"src/**"}]}
///   ]
/// }"#).unwrap();
/// ```
pub fn parse_filter_json(input: &str) -> Result<FilterExpr, JsonFilterError> {
    let json_filter: JsonFilter =
        serde_json::from_str(input).map_err(|e| JsonFilterError::ParseError(e.to_string()))?;

    json_filter.to_filter_expr()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    // =========================================================================
    // Simple Predicate Tests
    // =========================================================================

    #[test]
    fn test_parse_json_simple_predicate() {
        let json = r#"{"predicates":[{"key":"ext","op":"eq","value":"py"}]}"#;
        let expr = parse_filter_json(json).unwrap();

        match expr {
            FilterExpr::Pred(pred) => {
                assert_eq!(pred.key, PredicateKey::Ext);
                assert_eq!(pred.op, PredicateOp::Eq);
                assert_eq!(pred.value, "py");
            }
            _ => panic!("expected Pred, got {:?}", expr),
        }
    }

    // =========================================================================
    // All Combinator Tests
    // =========================================================================

    #[test]
    fn test_parse_json_all_combinator() {
        let json = r#"{
            "all": [
                {"predicates":[{"key":"ext","op":"eq","value":"py"}]},
                {"predicates":[{"key":"path","op":"glob","value":"src/**"}]}
            ]
        }"#;
        let expr = parse_filter_json(json).unwrap();

        match expr {
            FilterExpr::And(exprs) => {
                assert_eq!(exprs.len(), 2);
            }
            _ => panic!("expected And, got {:?}", expr),
        }
    }

    // =========================================================================
    // Any Combinator Tests
    // =========================================================================

    #[test]
    fn test_parse_json_any_combinator() {
        let json = r#"{
            "any": [
                {"predicates":[{"key":"ext","op":"eq","value":"py"}]},
                {"predicates":[{"key":"ext","op":"eq","value":"pyi"}]}
            ]
        }"#;
        let expr = parse_filter_json(json).unwrap();

        match expr {
            FilterExpr::Or(exprs) => {
                assert_eq!(exprs.len(), 2);
            }
            _ => panic!("expected Or, got {:?}", expr),
        }
    }

    // =========================================================================
    // Not Combinator Tests
    // =========================================================================

    #[test]
    fn test_parse_json_not_combinator() {
        let json = r#"{
            "not": {"predicates":[{"key":"name","op":"glob","value":"*_test.py"}]}
        }"#;
        let expr = parse_filter_json(json).unwrap();

        match expr {
            FilterExpr::Not(inner) => match *inner {
                FilterExpr::Pred(pred) => {
                    assert_eq!(pred.key, PredicateKey::Name);
                    assert_eq!(pred.op, PredicateOp::Glob);
                }
                _ => panic!("expected Pred inside Not"),
            },
            _ => panic!("expected Not, got {:?}", expr),
        }
    }

    // =========================================================================
    // Nested Combinator Tests
    // =========================================================================

    #[test]
    fn test_parse_json_nested_all_any() {
        let json = r#"{
            "all": [
                {
                    "any": [
                        {"predicates":[{"key":"ext","op":"eq","value":"py"}]},
                        {"predicates":[{"key":"ext","op":"eq","value":"pyi"}]}
                    ]
                },
                {"predicates":[{"key":"path","op":"glob","value":"src/**"}]}
            ]
        }"#;
        let expr = parse_filter_json(json).unwrap();

        match expr {
            FilterExpr::And(exprs) => {
                assert_eq!(exprs.len(), 2);
                match &exprs[0] {
                    FilterExpr::Or(inner) => assert_eq!(inner.len(), 2),
                    _ => panic!("expected Or as first element"),
                }
            }
            _ => panic!("expected And, got {:?}", expr),
        }
    }

    // =========================================================================
    // Predicates List Tests
    // =========================================================================

    #[test]
    fn test_parse_json_predicates_list() {
        let json = r#"{
            "predicates": [
                {"key":"ext","op":"eq","value":"py"},
                {"key":"path","op":"glob","value":"src/**"}
            ]
        }"#;
        let expr = parse_filter_json(json).unwrap();

        match expr {
            FilterExpr::And(exprs) => {
                assert_eq!(exprs.len(), 2);
                // Both should be Pred
                for e in exprs {
                    match e {
                        FilterExpr::Pred(_) => {}
                        _ => panic!("expected Pred elements"),
                    }
                }
            }
            _ => panic!("expected And for multiple predicates"),
        }
    }

    // =========================================================================
    // Error Cases
    // =========================================================================

    #[test]
    fn test_parse_json_invalid_missing_key() {
        let json = r#"{"predicates":[{"op":"eq","value":"py"}]}"#;
        let result = parse_filter_json(json);
        assert!(result.is_err());
        // serde will fail to deserialize without key
        match result {
            Err(JsonFilterError::ParseError(_)) => {}
            _ => panic!("expected ParseError"),
        }
    }

    #[test]
    fn test_parse_json_invalid_unknown_operator() {
        let json = r#"{"predicates":[{"key":"ext","op":"invalid","value":"py"}]}"#;
        let result = parse_filter_json(json);
        match result {
            Err(JsonFilterError::UnknownOperator { op }) => {
                assert_eq!(op, "invalid");
            }
            _ => panic!("expected UnknownOperator, got {:?}", result),
        }
    }

    #[test]
    fn test_parse_json_empty_all_error() {
        let json = r#"{"all":[]}"#;
        let result = parse_filter_json(json);
        match result {
            Err(JsonFilterError::InvalidFilter { message }) => {
                assert!(message.contains("empty"));
            }
            _ => panic!("expected InvalidFilter, got {:?}", result),
        }
    }

    // =========================================================================
    // Parity Test
    // =========================================================================

    #[test]
    fn test_json_to_expr_parity() {
        use crate::filter::parse_filter_expr;

        // Same filter in both formats: ext:py and path:src/**
        let expr_str = "ext:py and path:src/**";
        let json_str = r#"{
            "all": [
                {"predicates":[{"key":"ext","op":"glob","value":"py"}]},
                {"predicates":[{"key":"path","op":"glob","value":"src/**"}]}
            ]
        }"#;

        let expr_from_str = parse_filter_expr(expr_str).unwrap();
        let expr_from_json = parse_filter_json(json_str).unwrap();

        // Both should match the same files
        let test_path = Path::new("src/main.py");
        let result_str = expr_from_str.evaluate(test_path, None, None, None).unwrap();
        let result_json = expr_from_json
            .evaluate(test_path, None, None, None)
            .unwrap();

        assert_eq!(result_str, result_json);
        assert!(result_str); // Should match

        // Test non-matching path
        let test_path = Path::new("tests/test_main.py");
        let result_str = expr_from_str.evaluate(test_path, None, None, None).unwrap();
        let result_json = expr_from_json
            .evaluate(test_path, None, None, None)
            .unwrap();

        assert_eq!(result_str, result_json);
        assert!(!result_str); // Should not match (wrong path)
    }
}
