// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! ExportCollector visitor for Python `__all__` export extraction.
//!
//! This module provides an [`ExportCollector`] visitor that traverses a CST and
//! collects string literals from `__all__` assignments, enabling rename operations
//! to update export lists along with symbol definitions.
//!
//! # What is an Export?
//!
//! In Python, `__all__` is a module-level list that defines the public API.
//! String literals in `__all__` are references to symbols that should be updated
//! when those symbols are renamed:
//!
//! ```python
//! __all__ = ["Date", "Time", "DateTime"]  # Simple assignment
//! __all__: list[str] = ["Date"]           # Annotated assignment
//! __all__ += ["Duration"]                  # Augmented assignment
//! ```
//!
//! # Span Extraction
//!
//! For string literals in `__all__`, we need two spans:
//! - **Full span**: Includes quotes (e.g., `"Date"`) - for context
//! - **Content span**: Just the text (e.g., `Date`) - for replacement
//!
//! Since `SimpleString.value` includes quotes (e.g., `"Date"` or `'Date'`),
//! the content span is computed by stripping the quote characters.
//!
//! # Usage
//!
//! ```ignore
//! use tugtool_python_cst::{parse_module_with_positions, ExportCollector, ExportInfo, ExportKind};
//!
//! let source = "__all__ = [\"foo\", \"bar\"]";
//! let parsed = parse_module_with_positions(source, None)?;
//!
//! let exports = ExportCollector::collect(&parsed.module, &parsed.positions);
//! for export in &exports {
//!     println!("{}: {:?}", export.name, export.span);
//! }
//! ```

use super::dispatch::walk_module;
use super::traits::{VisitResult, Visitor};
use crate::inflate_ctx::PositionTable;
use crate::nodes::{
    AnnAssign, Assign, AssignTargetExpression, AugAssign, Element, Expression, Module, Span,
};

/// The kind of export in Python.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ExportKind {
    /// A string literal in an `__all__` list.
    AllList,
}

impl ExportKind {
    /// Returns the string representation used in output.
    pub fn as_str(&self) -> &'static str {
        match self {
            ExportKind::AllList => "all_list",
        }
    }
}

impl std::fmt::Display for ExportKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Information about a single export string literal.
///
/// Each export represents a string in `__all__` that may need to be renamed
/// when the corresponding symbol is renamed.
#[derive(Debug, Clone)]
pub struct ExportInfo {
    /// The exported symbol name (string content without quotes).
    pub name: String,
    /// The kind of export.
    pub kind: ExportKind,
    /// Source span for the entire string literal including quotes (byte offsets).
    pub span: Option<Span>,
    /// Source span for just the string content excluding quotes (byte offsets).
    /// This is the span to use for text replacement.
    pub content_span: Option<Span>,
}

impl ExportInfo {
    /// Create a new ExportInfo.
    fn new(name: String, kind: ExportKind) -> Self {
        Self {
            name,
            kind,
            span: None,
            content_span: None,
        }
    }

    /// Set the span for this export.
    fn with_span(mut self, span: Option<Span>) -> Self {
        self.span = span;
        self
    }

    /// Set the content span for this export.
    fn with_content_span(mut self, content_span: Option<Span>) -> Self {
        self.content_span = content_span;
        self
    }
}

/// A visitor that collects `__all__` export string literals from a Python CST.
///
/// ExportCollector traverses the CST and identifies string literals in:
/// - `__all__ = [...]` simple assignments
/// - `__all__: list[str] = [...]` annotated assignments
/// - `__all__ += [...]` augmented assignments
///
/// # Example
///
/// ```ignore
/// let parsed = parse_module_with_positions(source, None)?;
/// let exports = ExportCollector::collect(&parsed.module, &parsed.positions);
/// let date_exports = exports.iter().filter(|e| e.name == "Date");
/// ```
pub struct ExportCollector<'a, 'pos> {
    /// Reference to source code for content extraction.
    source: &'a str,
    /// Reference to position table for span lookups (currently unused but kept for consistency).
    #[allow(dead_code)]
    positions: Option<&'pos PositionTable>,
    /// Collected exports.
    exports: Vec<ExportInfo>,
    /// Search position for finding string literals in source.
    /// This is updated as we traverse `__all__` assignments to ensure
    /// we find the correct occurrence of duplicate strings.
    search_from: usize,
}

impl<'a, 'pos> ExportCollector<'a, 'pos> {
    /// Create a new ExportCollector without position tracking.
    ///
    /// Exports will be collected but spans may be derived from string values.
    pub fn new(source: &'a str) -> Self {
        Self {
            source,
            positions: None,
            exports: Vec::new(),
            search_from: 0,
        }
    }

    /// Create a new ExportCollector with position tracking.
    ///
    /// Exports will include spans from the source and PositionTable.
    pub fn with_positions(source: &'a str, positions: &'pos PositionTable) -> Self {
        Self {
            source,
            positions: Some(positions),
            exports: Vec::new(),
            search_from: 0,
        }
    }

    /// Collect exports from a parsed module with position information.
    ///
    /// This is the preferred method for collecting exports with accurate spans.
    ///
    /// # Arguments
    ///
    /// * `module` - The parsed CST module
    /// * `positions` - Position table from `parse_module_with_positions`
    /// * `source` - The original source code
    ///
    /// # Example
    ///
    /// ```ignore
    /// let parsed = parse_module_with_positions(source, None)?;
    /// let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);
    /// ```
    pub fn collect(
        module: &Module<'_>,
        positions: &'pos PositionTable,
        source: &'a str,
    ) -> Vec<ExportInfo> {
        let mut collector = ExportCollector::with_positions(source, positions);
        walk_module(&mut collector, module);
        collector.exports
    }

    /// Get the collected exports, consuming the collector.
    pub fn into_exports(self) -> Vec<ExportInfo> {
        self.exports
    }

    /// Check if a target is `__all__`.
    fn is_all_target(target: &AssignTargetExpression<'_>) -> bool {
        match target {
            AssignTargetExpression::Name(name) => name.value == "__all__",
            _ => false,
        }
    }

    /// Extract string literals from an expression (List, Tuple, or Set).
    fn extract_strings_from_value(&mut self, value: &Expression<'_>) {
        match value {
            Expression::List(list) => {
                for element in &list.elements {
                    self.extract_string_from_element(element);
                }
            }
            Expression::Tuple(tuple) => {
                for element in &tuple.elements {
                    self.extract_string_from_element(element);
                }
            }
            Expression::Set(set) => {
                for element in &set.elements {
                    self.extract_string_from_element(element);
                }
            }
            // Concatenated expressions, binary operations (for `[...] + [...]`), etc.
            // are not handled - we only extract from direct list/tuple/set literals
            _ => {}
        }
    }

    /// Extract a string literal from a collection element.
    fn extract_string_from_element(&mut self, element: &Element<'_>) {
        match element {
            Element::Simple { value, .. } => {
                self.extract_string_literal(value);
            }
            Element::Starred(_) => {
                // Starred elements (e.g., `*other_exports`) are not string literals
            }
        }
    }

    /// Extract a string literal from an expression and add it to exports.
    fn extract_string_literal(&mut self, expr: &Expression<'_>) {
        match expr {
            Expression::SimpleString(s) => {
                // SimpleString.value includes quotes, e.g., '"foo"' or "'foo'"
                // We need to extract just the content
                if let Some((name, full_span, content_span)) = self.parse_simple_string(s.value) {
                    let export = ExportInfo::new(name, ExportKind::AllList)
                        .with_span(Some(full_span))
                        .with_content_span(Some(content_span));
                    self.exports.push(export);
                }
            }
            Expression::ConcatenatedString(_cs) => {
                // For concatenated strings like "foo" "bar", we skip them.
                // They're rare in `__all__` lists and would result in invalid
                // symbol names anyway (e.g., "foobar" from "foo" "bar").
                // We only handle single string literals.
            }
            _ => {
                // Non-string expressions (variables, function calls, etc.) are ignored
            }
        }
    }

    /// Parse a simple string value and compute spans.
    ///
    /// SimpleString.value includes quotes, e.g., `"foo"` or `'foo'` or `"""foo"""`.
    /// Returns (content, full_span, content_span) if valid.
    fn parse_simple_string(&mut self, value: &str) -> Option<(String, Span, Span)> {
        // Find the string in the source to get accurate positions
        // This is a fallback - ideally we'd use position table, but SimpleString
        // doesn't record its span in the position table currently.

        // Handle different quote styles
        let (prefix_len, suffix_len) = if value.starts_with("\"\"\"") || value.starts_with("'''") {
            (3, 3) // Triple-quoted
        } else if value.starts_with('"') || value.starts_with('\'') {
            (1, 1) // Single-quoted
        } else if value.starts_with("r\"")
            || value.starts_with("r'")
            || value.starts_with("b\"")
            || value.starts_with("b'")
            || value.starts_with("f\"")
            || value.starts_with("f'")
        {
            (2, 1) // Prefix + quote
        } else if value.starts_with("r\"\"\"")
            || value.starts_with("r'''")
            || value.starts_with("b\"\"\"")
            || value.starts_with("b'''")
        {
            (4, 3) // Prefix + triple quote
        } else {
            return None; // Unknown format
        };

        // Extract the content between quotes
        if value.len() < prefix_len + suffix_len {
            return None;
        }
        let content = &value[prefix_len..value.len() - suffix_len];

        // Find this exact string in the source to get byte positions
        // We search for the full string value (including quotes)
        // Search from search_from position to find the correct occurrence
        // This is important when the same string literal appears multiple times
        // (e.g., in docstrings before __all__)
        if let Some(offset) = self.source[self.search_from..].find(value) {
            let start = self.search_from + offset;
            let full_span = Span {
                start: start as u64,
                end: (start + value.len()) as u64,
            };
            let content_span = Span {
                start: (start + prefix_len) as u64,
                end: (start + value.len() - suffix_len) as u64,
            };
            // Update search_from for next string in this list
            self.search_from = start + 1;
            Some((content.to_string(), full_span, content_span))
        } else {
            // String not found in source (shouldn't happen for valid AST)
            // Return spans as 0,0 - they won't be usable but we still capture the name
            Some((
                content.to_string(),
                Span { start: 0, end: 0 },
                Span { start: 0, end: 0 },
            ))
        }
    }
}

impl<'a, 'b, 'pos> Visitor<'b> for ExportCollector<'a, 'pos> {
    fn visit_assign(&mut self, node: &Assign<'b>) -> VisitResult {
        // Check if any target is `__all__`
        for target in &node.targets {
            if Self::is_all_target(&target.target) {
                // Find the position of this `__all__` in the source, starting from search_from
                // This ensures we find the correct occurrence when there are multiple
                if let Some(all_pos) = self.source[self.search_from..].find("__all__") {
                    self.search_from += all_pos;
                }
                self.extract_strings_from_value(&node.value);
                break;
            }
        }
        // Don't descend into children - we've handled the assignment value
        VisitResult::SkipChildren
    }

    fn visit_ann_assign(&mut self, node: &AnnAssign<'b>) -> VisitResult {
        // Check if target is `__all__`
        if Self::is_all_target(&node.target) {
            // Find the position of this `__all__` in the source
            if let Some(all_pos) = self.source[self.search_from..].find("__all__") {
                self.search_from += all_pos;
            }
            if let Some(ref value) = node.value {
                self.extract_strings_from_value(value);
            }
        }
        // Don't descend into children
        VisitResult::SkipChildren
    }

    fn visit_aug_assign(&mut self, node: &AugAssign<'b>) -> VisitResult {
        // Check if target is `__all__` (for __all__ += [...])
        if Self::is_all_target(&node.target) {
            // Find the position of this `__all__` in the source
            if let Some(all_pos) = self.source[self.search_from..].find("__all__") {
                self.search_from += all_pos;
            }
            self.extract_strings_from_value(&node.value);
        }
        // Don't descend into children
        VisitResult::SkipChildren
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_module_with_positions;

    #[test]
    fn test_export_simple_all_list() {
        let source = r#"__all__ = ["foo", "bar", "baz"]"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 3);
        assert_eq!(exports[0].name, "foo");
        assert_eq!(exports[1].name, "bar");
        assert_eq!(exports[2].name, "baz");

        for export in &exports {
            assert_eq!(export.kind, ExportKind::AllList);
            assert!(export.span.is_some());
            assert!(export.content_span.is_some());
        }
    }

    #[test]
    fn test_export_annotated_all() {
        let source = r#"__all__: list[str] = ["Date", "Time"]"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 2);
        assert_eq!(exports[0].name, "Date");
        assert_eq!(exports[1].name, "Time");
    }

    #[test]
    fn test_export_augmented_all() {
        let source = r#"__all__ += ["Duration", "Period"]"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 2);
        assert_eq!(exports[0].name, "Duration");
        assert_eq!(exports[1].name, "Period");
    }

    #[test]
    fn test_export_single_quotes() {
        let source = "__all__ = ['foo', 'bar']";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 2);
        assert_eq!(exports[0].name, "foo");
        assert_eq!(exports[1].name, "bar");
    }

    #[test]
    fn test_export_empty_all() {
        let source = "__all__ = []";
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 0);
    }

    #[test]
    fn test_export_tuple_syntax() {
        let source = r#"__all__ = ("foo", "bar")"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 2);
        assert_eq!(exports[0].name, "foo");
        assert_eq!(exports[1].name, "bar");
    }

    #[test]
    fn test_export_non_string_ignored() {
        // Non-string elements should be ignored
        let source = r#"__all__ = ["foo", some_var, "bar"]"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        // Only string literals are collected
        assert_eq!(exports.len(), 2);
        assert_eq!(exports[0].name, "foo");
        assert_eq!(exports[1].name, "bar");
    }

    #[test]
    fn test_export_not_all_variable() {
        // Assignments to other variables should be ignored
        let source = r#"other = ["foo", "bar"]"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 0);
    }

    #[test]
    fn test_export_span_content() {
        let source = r#"__all__ = ["Date"]"#;
        //             0123456789012345678
        //             __all__ = ["Date"]
        //                       ^[ at 10
        //                        ^"Date": 11-17
        //                         ^Date: 12-16
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 1);
        assert_eq!(exports[0].name, "Date");

        let span = exports[0].span.expect("Should have span");
        assert_eq!(span.start, 11, "Full span should start at byte 11");
        assert_eq!(span.end, 17, "Full span should end at byte 17");

        let content_span = exports[0].content_span.expect("Should have content span");
        assert_eq!(
            content_span.start, 12,
            "Content span should start at byte 12"
        );
        assert_eq!(content_span.end, 16, "Content span should end at byte 16");

        // Verify the span content
        let span_text = &source[span.start as usize..span.end as usize];
        assert_eq!(span_text, "\"Date\"");

        let content_text = &source[content_span.start as usize..content_span.end as usize];
        assert_eq!(content_text, "Date");
    }

    #[test]
    fn test_export_multiple_all_assignments() {
        // Multiple __all__ assignments should all be collected
        let source = r#"__all__ = ["foo"]
__all__ += ["bar"]"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 2);
        assert_eq!(exports[0].name, "foo");
        assert_eq!(exports[1].name, "bar");
    }

    #[test]
    fn test_export_with_other_code() {
        let source = r#"
from typing import List

__all__ = ["Date", "Time"]

class Date:
    pass

class Time:
    pass
"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        assert_eq!(exports.len(), 2);
        assert_eq!(exports[0].name, "Date");
        assert_eq!(exports[1].name, "Time");
    }

    #[test]
    fn test_export_all_as_attribute_ignored() {
        // __all__ as an attribute access should be ignored
        let source = r#"module.__all__ = ["foo"]"#;
        let parsed = parse_module_with_positions(source, None).unwrap();
        let exports = ExportCollector::collect(&parsed.module, &parsed.positions, source);

        // Attribute assignment is not our target
        assert_eq!(exports.len(), 0);
    }

    #[test]
    fn test_export_kind_display() {
        assert_eq!(ExportKind::AllList.as_str(), "all_list");
        assert_eq!(format!("{}", ExportKind::AllList), "all_list");
    }
}
