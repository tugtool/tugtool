// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Batch edit infrastructure for applying multiple span-based edits atomically.
//!
//! This module provides [`BatchSpanEditor`] which generalizes the rename-only
//! [`RenameTransformer`](super::RenameTransformer) to support all edit primitive types:
//! Replace, InsertBefore, InsertAfter, Delete, and InsertAt.
//!
//! # Edit Primitives
//!
//! | Primitive | Description | Span Semantics |
//! |-----------|-------------|----------------|
//! | `Replace(span, text)` | Replace content at span with new text | `span.start..span.end` becomes `text` |
//! | `InsertBefore(span, text)` | Insert text immediately before span | Insert at `span.start` |
//! | `InsertAfter(span, text)` | Insert text immediately after span | Insert at `span.end` |
//! | `Delete(span)` | Remove content at span | Equivalent to `Replace(span, "")` |
//! | `InsertAt(position, text)` | Insert at absolute position | Zero-width span at position |
//!
//! # Example
//!
//! ```
//! use tugtool_python_cst::visitor::{BatchSpanEditor, EditPrimitive};
//! use tugtool_core::patch::Span;
//!
//! let source = "def foo():\n    return 1\n";
//!
//! let mut editor = BatchSpanEditor::new(source);
//! editor.add(EditPrimitive::Replace {
//!     span: Span::new(4, 7),
//!     new_text: "bar".to_string(),
//! });
//!
//! let result = editor.apply().unwrap();
//! assert_eq!(result, "def bar():\n    return 1\n");
//! ```

use std::cmp::Ordering;

use tugtool_core::patch::Span;

/// An atomic edit operation on source text.
///
/// Edit primitives are collected and applied in reverse position order
/// to preserve span validity as text lengths change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditPrimitive {
    /// Replace content at span with new text.
    /// Equivalent to delete + insert at span.start.
    Replace {
        span: Span,
        new_text: String,
    },

    /// Insert text immediately before the given span.
    /// The insertion point is `span.start`. The span itself identifies
    /// context (e.g., a statement) for indentation detection.
    InsertBefore {
        anchor_span: Span,
        text: String,
    },

    /// Insert text immediately after the given span.
    /// The insertion point is `span.end`.
    InsertAfter {
        anchor_span: Span,
        text: String,
    },

    /// Delete content at span. Equivalent to `Replace { span, new_text: "" }`.
    Delete {
        span: Span,
    },

    /// Insert text at an absolute byte position.
    /// Use when no anchor span is available (e.g., inserting at file start).
    InsertAt {
        position: usize,
        text: String,
    },
}

impl EditPrimitive {
    /// Returns the effective span this edit operates on.
    /// For InsertAt, returns a zero-width span at the position.
    pub fn effective_span(&self) -> Span {
        match self {
            EditPrimitive::Replace { span, .. } => *span,
            EditPrimitive::InsertBefore { anchor_span, .. } => *anchor_span,
            EditPrimitive::InsertAfter { anchor_span, .. } => *anchor_span,
            EditPrimitive::Delete { span } => *span,
            EditPrimitive::InsertAt { position, .. } => Span::new(*position, *position),
        }
    }

    /// Returns the insertion point (byte offset where new text begins).
    pub fn insertion_point(&self) -> usize {
        match self {
            EditPrimitive::Replace { span, .. } => span.start,
            EditPrimitive::InsertBefore { anchor_span, .. } => anchor_span.start,
            EditPrimitive::InsertAfter { anchor_span, .. } => anchor_span.end,
            EditPrimitive::Delete { span } => span.start,
            EditPrimitive::InsertAt { position, .. } => *position,
        }
    }

    /// Returns true if this is an insertion (InsertBefore, InsertAfter, InsertAt).
    pub fn is_insertion(&self) -> bool {
        matches!(
            self,
            EditPrimitive::InsertBefore { .. }
                | EditPrimitive::InsertAfter { .. }
                | EditPrimitive::InsertAt { .. }
        )
    }
}

/// Error type for batch edit operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BatchEditError {
    /// Two edits have overlapping spans.
    OverlappingEdits {
        edit1_span: Span,
        edit2_span: Span,
    },

    /// An edit span extends beyond source length.
    SpanOutOfBounds {
        span: Span,
        source_len: usize,
    },

    /// No edits to apply.
    EmptyEdits,

    /// Indentation detection failed (no reference line found).
    IndentationDetectionFailed {
        position: usize,
    },
}

impl std::fmt::Display for BatchEditError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BatchEditError::OverlappingEdits { edit1_span, edit2_span } => {
                write!(
                    f,
                    "overlapping edits: ({}, {}) and ({}, {})",
                    edit1_span.start, edit1_span.end, edit2_span.start, edit2_span.end
                )
            }
            BatchEditError::SpanOutOfBounds { span, source_len } => {
                write!(
                    f,
                    "span ({}, {}) is out of bounds for source of length {}",
                    span.start, span.end, source_len
                )
            }
            BatchEditError::EmptyEdits => {
                write!(f, "no edits to apply")
            }
            BatchEditError::IndentationDetectionFailed { position } => {
                write!(f, "failed to detect indentation at position {}", position)
            }
        }
    }
}

impl std::error::Error for BatchEditError {}

/// Result type for batch edit operations.
pub type BatchEditResult<T> = Result<T, BatchEditError>;

/// Options for controlling edit application behavior.
#[derive(Debug, Clone)]
pub struct BatchEditOptions {
    /// If true, InsertBefore/InsertAfter will auto-detect and apply
    /// indentation matching the surrounding context.
    /// Default: true
    pub auto_indent: bool,

    /// If true, adjacent edits (one ends where another starts) are allowed.
    /// Default: true
    pub allow_adjacent: bool,

    /// If true, empty edit list returns original source instead of error.
    /// Default: false
    pub allow_empty: bool,
}

impl Default for BatchEditOptions {
    fn default() -> Self {
        Self {
            auto_indent: true,
            allow_adjacent: true,
            allow_empty: false,
        }
    }
}

/// Information about indentation at a position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndentInfo {
    /// The actual indentation string (spaces/tabs)
    pub indent_str: String,
    /// The visual width (assuming 4-space tabs)
    pub visual_width: usize,
    /// Whether the indent uses tabs
    pub uses_tabs: bool,
}

impl Default for IndentInfo {
    fn default() -> Self {
        Self {
            indent_str: String::new(),
            visual_width: 0,
            uses_tabs: false,
        }
    }
}

/// A batch editor that collects edit primitives and applies them atomically.
///
/// # Design Notes
///
/// BatchSpanEditor generalizes the existing `RenameTransformer` to support
/// all edit primitive types, not just Replace. The key differences:
///
/// 1. **Multiple edit types**: Replace, InsertBefore, InsertAfter, Delete, InsertAt
/// 2. **Indentation handling**: InsertBefore/InsertAfter can auto-detect indentation
/// 3. **Options**: Configurable behavior via `BatchEditOptions`
///
/// # Example
///
/// ```
/// use tugtool_python_cst::visitor::{BatchSpanEditor, EditPrimitive};
/// use tugtool_core::patch::Span;
///
/// let source = "def foo():\n    return 1\n";
/// //                       ^             ^
/// //                       11            24
/// // "    return 1\n" is at positions 11-24 (includes indentation)
///
/// let mut editor = BatchSpanEditor::new(source);
/// editor.add(EditPrimitive::Replace {
///     span: Span::new(4, 7),
///     new_text: "bar".to_string(),
/// });
/// editor.add(EditPrimitive::InsertBefore {
///     anchor_span: Span::new(11, 24),  // "    return 1\n" - whole line
///     text: "x = 42\n".to_string(),
/// });
///
/// let result = editor.apply().unwrap();
/// assert_eq!(result, "def bar():\n    x = 42\n    return 1\n");
/// ```
pub struct BatchSpanEditor<'src> {
    source: &'src str,
    edits: Vec<EditPrimitive>,
    options: BatchEditOptions,
}

impl<'src> BatchSpanEditor<'src> {
    /// Create a new BatchSpanEditor for the given source.
    pub fn new(source: &'src str) -> Self {
        Self {
            source,
            edits: Vec::new(),
            options: BatchEditOptions::default(),
        }
    }

    /// Create a new BatchSpanEditor with custom options.
    pub fn with_options(source: &'src str, options: BatchEditOptions) -> Self {
        Self {
            source,
            edits: Vec::new(),
            options,
        }
    }

    /// Add an edit primitive to the batch.
    pub fn add(&mut self, edit: EditPrimitive) {
        self.edits.push(edit);
    }

    /// Add multiple edit primitives.
    pub fn add_all(&mut self, edits: impl IntoIterator<Item = EditPrimitive>) {
        self.edits.extend(edits);
    }

    /// Returns the number of edits currently queued.
    pub fn len(&self) -> usize {
        self.edits.len()
    }

    /// Returns true if no edits are queued.
    pub fn is_empty(&self) -> bool {
        self.edits.is_empty()
    }

    /// Apply all queued edits and return the transformed source.
    ///
    /// Edits are applied in reverse position order to preserve span validity.
    /// Overlapping edits cause an error.
    ///
    /// # Errors
    ///
    /// - `BatchEditError::OverlappingEdits` if any two edits overlap
    /// - `BatchEditError::SpanOutOfBounds` if any span exceeds source length
    /// - `BatchEditError::EmptyEdits` if no edits and `allow_empty` is false
    pub fn apply(mut self) -> BatchEditResult<String> {
        // 1. Handle empty case
        if self.edits.is_empty() {
            return if self.options.allow_empty {
                Ok(self.source.to_string())
            } else {
                Err(BatchEditError::EmptyEdits)
            };
        }

        let source_len = self.source.len();

        // 2. Validate all spans are in bounds
        for edit in &self.edits {
            let span = self.effective_span_for_bounds_check(edit);
            if span.end > source_len {
                return Err(BatchEditError::SpanOutOfBounds { span, source_len });
            }
        }

        // 3. Sort edits by effective position in DESCENDING order
        //    For equal positions, deletion-type edits come BEFORE insertions
        //    (so insertions happen at the original position, not shifted position)
        self.edits.sort_by(|a, b| {
            let pos_a = a.insertion_point();
            let pos_b = b.insertion_point();
            match pos_b.cmp(&pos_a) {
                Ordering::Equal => {
                    // Deletions before insertions at same position
                    match (a.is_insertion(), b.is_insertion()) {
                        (false, true) => Ordering::Less,
                        (true, false) => Ordering::Greater,
                        _ => Ordering::Equal,
                    }
                }
                other => other,
            }
        });

        // 4. Check for overlapping spans (after sorting)
        for i in 1..self.edits.len() {
            let span_prev = self.effective_span_for_overlap_check(&self.edits[i - 1]);
            let span_curr = self.effective_span_for_overlap_check(&self.edits[i]);

            // After descending sort: prev.start >= curr.start
            // Check if curr overlaps with prev
            if spans_overlap_for_edits(&span_prev, &span_curr, self.options.allow_adjacent) {
                return Err(BatchEditError::OverlappingEdits {
                    edit1_span: span_curr,
                    edit2_span: span_prev,
                });
            }
        }

        // 5. Apply edits in reverse order
        let mut result = self.source.to_string();
        for edit in &self.edits {
            result = self.apply_single_edit(&result, edit);
        }

        Ok(result)
    }

    /// Apply edits without validation (for internal use when pre-validated).
    ///
    /// # Safety (not unsafe, but requires care)
    ///
    /// Caller must ensure:
    /// - All spans are within bounds
    /// - No overlapping edits
    pub fn apply_unchecked(mut self) -> String {
        if self.edits.is_empty() {
            return self.source.to_string();
        }

        // Sort edits by position descending
        self.edits.sort_by(|a, b| {
            let pos_a = a.insertion_point();
            let pos_b = b.insertion_point();
            match pos_b.cmp(&pos_a) {
                Ordering::Equal => match (a.is_insertion(), b.is_insertion()) {
                    (false, true) => Ordering::Less,
                    (true, false) => Ordering::Greater,
                    _ => Ordering::Equal,
                },
                other => other,
            }
        });

        let mut result = self.source.to_string();
        for edit in &self.edits {
            result = self.apply_single_edit(&result, edit);
        }

        result
    }

    /// Validate edits without applying them.
    ///
    /// Returns `Ok(())` if edits are valid, or the first error encountered.
    pub fn validate(&self) -> BatchEditResult<()> {
        // Check empty
        if self.edits.is_empty() && !self.options.allow_empty {
            return Err(BatchEditError::EmptyEdits);
        }

        let source_len = self.source.len();

        // Check bounds
        for edit in &self.edits {
            let span = self.effective_span_for_bounds_check(edit);
            if span.end > source_len {
                return Err(BatchEditError::SpanOutOfBounds { span, source_len });
            }
        }

        // Check overlaps
        let mut sorted_edits = self.edits.clone();
        sorted_edits.sort_by(|a, b| {
            let pos_a = a.insertion_point();
            let pos_b = b.insertion_point();
            pos_b.cmp(&pos_a)
        });

        for i in 1..sorted_edits.len() {
            let span_prev = self.effective_span_for_overlap_check(&sorted_edits[i - 1]);
            let span_curr = self.effective_span_for_overlap_check(&sorted_edits[i]);

            if spans_overlap_for_edits(&span_prev, &span_curr, self.options.allow_adjacent) {
                return Err(BatchEditError::OverlappingEdits {
                    edit1_span: span_curr,
                    edit2_span: span_prev,
                });
            }
        }

        Ok(())
    }

    /// Check for overlapping edits and return all conflicts.
    ///
    /// Unlike `validate()`, this returns all overlaps, not just the first.
    pub fn find_overlaps(&self) -> Vec<(Span, Span)> {
        let mut overlaps = Vec::new();

        let mut sorted_edits = self.edits.clone();
        sorted_edits.sort_by(|a, b| {
            let pos_a = a.insertion_point();
            let pos_b = b.insertion_point();
            pos_b.cmp(&pos_a)
        });

        for i in 1..sorted_edits.len() {
            let span_prev = self.effective_span_for_overlap_check(&sorted_edits[i - 1]);
            let span_curr = self.effective_span_for_overlap_check(&sorted_edits[i]);

            if spans_overlap_for_edits(&span_prev, &span_curr, self.options.allow_adjacent) {
                overlaps.push((span_curr, span_prev));
            }
        }

        overlaps
    }

    /// Get the effective span for bounds checking.
    /// For Replace/Delete, this is the actual span.
    /// For InsertBefore, this is the anchor span.
    /// For InsertAfter, this is the anchor span.
    /// For InsertAt, this is a zero-width span at the position.
    fn effective_span_for_bounds_check(&self, edit: &EditPrimitive) -> Span {
        match edit {
            EditPrimitive::Replace { span, .. } => *span,
            EditPrimitive::InsertBefore { anchor_span, .. } => *anchor_span,
            EditPrimitive::InsertAfter { anchor_span, .. } => *anchor_span,
            EditPrimitive::Delete { span } => *span,
            EditPrimitive::InsertAt { position, .. } => Span::new(*position, *position),
        }
    }

    /// Get the effective span for overlap checking.
    /// For Replace/Delete, this is the actual span being modified.
    /// For InsertBefore/InsertAfter/InsertAt, this is a zero-width span at insertion point.
    fn effective_span_for_overlap_check(&self, edit: &EditPrimitive) -> Span {
        match edit {
            EditPrimitive::Replace { span, .. } => *span,
            EditPrimitive::Delete { span } => *span,
            // Insertions have zero-width "spans" at their insertion point
            EditPrimitive::InsertBefore { anchor_span, .. } => {
                Span::new(anchor_span.start, anchor_span.start)
            }
            EditPrimitive::InsertAfter { anchor_span, .. } => {
                Span::new(anchor_span.end, anchor_span.end)
            }
            EditPrimitive::InsertAt { position, .. } => Span::new(*position, *position),
        }
    }

    /// Apply a single edit to the source.
    fn apply_single_edit(&self, source: &str, edit: &EditPrimitive) -> String {
        match edit {
            EditPrimitive::Replace { span, new_text } => {
                format!(
                    "{}{}{}",
                    &source[..span.start],
                    new_text,
                    &source[span.end..]
                )
            }
            EditPrimitive::Delete { span } => {
                format!("{}{}", &source[..span.start], &source[span.end..])
            }
            EditPrimitive::InsertAt { position, text } => {
                format!(
                    "{}{}{}",
                    &source[..*position],
                    text,
                    &source[*position..]
                )
            }
            EditPrimitive::InsertBefore { anchor_span, text } => {
                let position = anchor_span.start;
                let text = if self.options.auto_indent {
                    let indent = detect_indentation(source, position);
                    // For InsertBefore, we prepend indent to ALL lines including the first
                    apply_indentation_to_all_lines(text, indent)
                } else {
                    text.clone()
                };
                format!(
                    "{}{}{}",
                    &source[..position],
                    text,
                    &source[position..]
                )
            }
            EditPrimitive::InsertAfter { anchor_span, text } => {
                let position = anchor_span.end;
                let text = if self.options.auto_indent {
                    let indent = detect_indentation(source, position);
                    apply_indentation(text, indent)
                } else {
                    text.clone()
                };
                format!(
                    "{}{}{}",
                    &source[..position],
                    text,
                    &source[position..]
                )
            }
        }
    }
}

/// Detect the indentation at a given byte position.
///
/// Returns the indentation string (spaces/tabs) of the line containing `position`.
/// If the line is empty or position is at line start, looks at surrounding lines.
///
/// # Algorithm
///
/// 1. Find the line containing `position`
/// 2. Extract leading whitespace from that line
/// 3. If line is empty, check the previous non-empty line
/// 4. If no reference found, return empty string
pub fn detect_indentation(source: &str, position: usize) -> &str {
    if source.is_empty() || position > source.len() {
        return "";
    }

    // 1. Find line start
    let line_start = source[..position]
        .rfind('\n')
        .map(|i| i + 1)
        .unwrap_or(0);

    // 2. Find line end
    let line_end = source[position..]
        .find('\n')
        .map(|i| position + i)
        .unwrap_or(source.len());

    let line = &source[line_start..line_end];

    // 3. Extract leading whitespace
    let indent_end = line
        .char_indices()
        .find(|(_, c)| !c.is_whitespace())
        .map(|(i, _)| i)
        .unwrap_or(line.len());

    if indent_end > 0 {
        return &source[line_start..line_start + indent_end];
    }

    // 4. Line is empty or all whitespace - check previous line
    if line_start > 0 {
        let prev_line_end = line_start - 1;
        let prev_line_start = source[..prev_line_end]
            .rfind('\n')
            .map(|i| i + 1)
            .unwrap_or(0);

        let prev_line = &source[prev_line_start..prev_line_end];
        let prev_indent_end = prev_line
            .char_indices()
            .find(|(_, c)| !c.is_whitespace())
            .map(|(i, _)| i)
            .unwrap_or(0);

        if prev_indent_end > 0 {
            return &source[prev_line_start..prev_line_start + prev_indent_end];
        }
    }

    // 5. No reference indentation found
    ""
}

/// Detect the indentation level (number of spaces/tabs) at a position.
///
/// Useful for computing relative indentation (e.g., one level deeper).
pub fn detect_indentation_level(source: &str, position: usize) -> IndentInfo {
    let indent_str = detect_indentation(source, position);

    let uses_tabs = indent_str.contains('\t');
    let visual_width = indent_str
        .chars()
        .map(|c| if c == '\t' { 4 } else { 1 })
        .sum();

    IndentInfo {
        indent_str: indent_str.to_string(),
        visual_width,
        uses_tabs,
    }
}

/// Apply indentation to a multi-line text block.
///
/// Each line in `text` (after the first) is prefixed with `indent`.
/// Handles both `\n` and `\r\n` line endings.
///
/// Use this for `InsertAfter` operations where the first line continues
/// after existing content.
pub fn apply_indentation(text: &str, indent: &str) -> String {
    if indent.is_empty() || !text.contains('\n') {
        return text.to_string();
    }

    let mut result = String::with_capacity(text.len() + indent.len() * text.matches('\n').count());
    let mut first_line = true;

    for line in text.split_inclusive('\n') {
        if first_line {
            result.push_str(line);
            first_line = false;
        } else {
            // Only add indent if line isn't just a newline
            if line.trim().is_empty() {
                result.push_str(line);
            } else {
                result.push_str(indent);
                result.push_str(line);
            }
        }
    }

    // Handle text that doesn't end with newline
    if !text.ends_with('\n') {
        // Nothing more to do - the last "line" was already added
    }

    result
}

/// Apply indentation to ALL lines in a text block, including the first.
///
/// Each line in `text` is prefixed with `indent`.
/// Use this for `InsertBefore` operations where the entire block needs indentation.
fn apply_indentation_to_all_lines(text: &str, indent: &str) -> String {
    if indent.is_empty() {
        return text.to_string();
    }

    let line_count = text.matches('\n').count() + if text.ends_with('\n') { 0 } else { 1 };
    let mut result = String::with_capacity(text.len() + indent.len() * line_count);

    for line in text.split_inclusive('\n') {
        // Only add indent if line isn't just a newline
        if line.trim().is_empty() {
            result.push_str(line);
        } else {
            result.push_str(indent);
            result.push_str(line);
        }
    }

    result
}

/// Check if two spans overlap, with optional adjacent span handling.
///
/// Two spans overlap if they share any byte positions.
/// When `allow_adjacent` is true (default), adjacent spans (one ends where
/// another starts) do NOT overlap.
fn spans_overlap_for_edits(a: &Span, b: &Span, allow_adjacent: bool) -> bool {
    if allow_adjacent {
        // Adjacent spans (a.end == b.start or b.end == a.start) are OK
        a.start < b.end && b.start < a.end
    } else {
        // Adjacent spans are NOT OK
        a.start <= b.end && b.start <= a.end && !(a.is_empty() && b.is_empty())
    }
}

/// Check if two spans overlap.
///
/// Re-exported helper for consistency with `rename.rs`.
pub fn spans_overlap(a: &Span, b: &Span) -> bool {
    a.start < b.end && b.start < a.end
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // EditPrimitive Tests
    // ========================================================================

    #[test]
    fn test_edit_primitive_effective_span() {
        let replace = EditPrimitive::Replace {
            span: Span::new(5, 10),
            new_text: "foo".to_string(),
        };
        assert_eq!(replace.effective_span(), Span::new(5, 10));

        let insert_before = EditPrimitive::InsertBefore {
            anchor_span: Span::new(5, 10),
            text: "foo".to_string(),
        };
        assert_eq!(insert_before.effective_span(), Span::new(5, 10));

        let insert_after = EditPrimitive::InsertAfter {
            anchor_span: Span::new(5, 10),
            text: "foo".to_string(),
        };
        assert_eq!(insert_after.effective_span(), Span::new(5, 10));

        let delete = EditPrimitive::Delete {
            span: Span::new(5, 10),
        };
        assert_eq!(delete.effective_span(), Span::new(5, 10));

        let insert_at = EditPrimitive::InsertAt {
            position: 7,
            text: "foo".to_string(),
        };
        assert_eq!(insert_at.effective_span(), Span::new(7, 7));
    }

    #[test]
    fn test_edit_primitive_insertion_point() {
        let replace = EditPrimitive::Replace {
            span: Span::new(5, 10),
            new_text: "foo".to_string(),
        };
        assert_eq!(replace.insertion_point(), 5);

        let insert_before = EditPrimitive::InsertBefore {
            anchor_span: Span::new(5, 10),
            text: "foo".to_string(),
        };
        assert_eq!(insert_before.insertion_point(), 5);

        let insert_after = EditPrimitive::InsertAfter {
            anchor_span: Span::new(5, 10),
            text: "foo".to_string(),
        };
        assert_eq!(insert_after.insertion_point(), 10);

        let delete = EditPrimitive::Delete {
            span: Span::new(5, 10),
        };
        assert_eq!(delete.insertion_point(), 5);

        let insert_at = EditPrimitive::InsertAt {
            position: 7,
            text: "foo".to_string(),
        };
        assert_eq!(insert_at.insertion_point(), 7);
    }

    #[test]
    fn test_edit_primitive_is_insertion() {
        assert!(!EditPrimitive::Replace {
            span: Span::new(0, 5),
            new_text: "x".to_string()
        }
        .is_insertion());
        assert!(!EditPrimitive::Delete {
            span: Span::new(0, 5)
        }
        .is_insertion());
        assert!(EditPrimitive::InsertBefore {
            anchor_span: Span::new(0, 5),
            text: "x".to_string()
        }
        .is_insertion());
        assert!(EditPrimitive::InsertAfter {
            anchor_span: Span::new(0, 5),
            text: "x".to_string()
        }
        .is_insertion());
        assert!(EditPrimitive::InsertAt {
            position: 5,
            text: "x".to_string()
        }
        .is_insertion());
    }

    // ========================================================================
    // Replace Tests
    // ========================================================================

    #[test]
    fn test_replace_single_span() {
        let source = "def foo():\n    pass";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(4, 7),
            new_text: "bar".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "def bar():\n    pass");
    }

    #[test]
    fn test_replace_multiple_spans() {
        let source = "def foo():\n    return foo";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(4, 7),
            new_text: "bar".to_string(),
        });
        editor.add(EditPrimitive::Replace {
            span: Span::new(22, 25),
            new_text: "bar".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "def bar():\n    return bar");
    }

    #[test]
    fn test_replace_empty_span() {
        // Empty span (zero-width) is effectively an insertion
        let source = "hello world";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(5, 5),
            new_text: " beautiful".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "hello beautiful world");
    }

    // ========================================================================
    // InsertBefore Tests
    // ========================================================================

    #[test]
    fn test_insert_before_statement() {
        let source = "def foo():\n    return 1\n";
        //                          ^             ^
        //                          11            24
        //                 "    return 1\n" = positions 11-24
        let options = BatchEditOptions {
            auto_indent: true,
            ..Default::default()
        };
        let mut editor = BatchSpanEditor::with_options(source, options);
        editor.add(EditPrimitive::InsertBefore {
            anchor_span: Span::new(11, 24), // "    return 1\n" - whole line including indent
            text: "x = 42\n".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "def foo():\n    x = 42\n    return 1\n");
    }

    #[test]
    fn test_insert_before_no_auto_indent() {
        let source = "def foo():\n    return 1\n";
        let options = BatchEditOptions {
            auto_indent: false,
            ..Default::default()
        };
        let mut editor = BatchSpanEditor::with_options(source, options);
        editor.add(EditPrimitive::InsertBefore {
            anchor_span: Span::new(11, 24), // "    return 1\n"
            text: "x = 42\n".to_string(),
        });
        let result = editor.apply().unwrap();
        // Without auto-indent, no indentation is added to the inserted text
        assert_eq!(result, "def foo():\nx = 42\n    return 1\n");
    }

    // ========================================================================
    // InsertAfter Tests
    // ========================================================================

    #[test]
    fn test_insert_after_expression() {
        let source = "x = 1";
        let options = BatchEditOptions {
            auto_indent: false,
            ..Default::default()
        };
        let mut editor = BatchSpanEditor::with_options(source, options);
        editor.add(EditPrimitive::InsertAfter {
            anchor_span: Span::new(0, 5), // "x = 1"
            text: "\ny = 2".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "x = 1\ny = 2");
    }

    // ========================================================================
    // InsertAt Tests
    // ========================================================================

    #[test]
    fn test_insert_at_position() {
        let source = "hello world";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::InsertAt {
            position: 6,
            text: "beautiful ".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "hello beautiful world");
    }

    #[test]
    fn test_insert_at_file_start() {
        let source = "existing content";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::InsertAt {
            position: 0,
            text: "# Header\n".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "# Header\nexisting content");
    }

    #[test]
    fn test_insert_at_file_end() {
        let source = "existing content";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::InsertAt {
            position: source.len(),
            text: "\n# Footer".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "existing content\n# Footer");
    }

    // ========================================================================
    // Delete Tests
    // ========================================================================

    #[test]
    fn test_delete_span() {
        let source = "hello beautiful world";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Delete {
            span: Span::new(5, 15), // " beautiful"
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_delete_with_newline() {
        let source = "x = 1\nunused = 2\ny = 3\n";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Delete {
            span: Span::new(6, 17), // "unused = 2\n"
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "x = 1\ny = 3\n");
    }

    // ========================================================================
    // Multiple Edit Tests
    // ========================================================================

    #[test]
    fn test_multiple_edits_non_overlapping() {
        let source = "a = foo\nb = bar\nc = baz\n";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(4, 7),
            new_text: "FOO".to_string(),
        });
        editor.add(EditPrimitive::Replace {
            span: Span::new(12, 15),
            new_text: "BAR".to_string(),
        });
        editor.add(EditPrimitive::Replace {
            span: Span::new(20, 23),
            new_text: "BAZ".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "a = FOO\nb = BAR\nc = BAZ\n");
    }

    // ========================================================================
    // Error Case Tests
    // ========================================================================

    #[test]
    fn test_overlapping_edits_rejected() {
        let source = "hello world";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(0, 7), // "hello w"
            new_text: "hi".to_string(),
        });
        editor.add(EditPrimitive::Replace {
            span: Span::new(5, 11), // " world" - overlaps!
            new_text: "there".to_string(),
        });
        let result = editor.apply();
        assert!(matches!(result, Err(BatchEditError::OverlappingEdits { .. })));
    }

    #[test]
    fn test_adjacent_edits_allowed() {
        let source = "hello world";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(0, 5), // "hello"
            new_text: "hi".to_string(),
        });
        editor.add(EditPrimitive::Replace {
            span: Span::new(5, 11), // " world" - adjacent, not overlapping
            new_text: " there".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "hi there");
    }

    #[test]
    fn test_adjacent_edits_rejected_when_disabled() {
        let source = "hello world";
        let options = BatchEditOptions {
            allow_adjacent: false,
            ..Default::default()
        };
        let mut editor = BatchSpanEditor::with_options(source, options);
        editor.add(EditPrimitive::Replace {
            span: Span::new(0, 5), // "hello"
            new_text: "hi".to_string(),
        });
        editor.add(EditPrimitive::Replace {
            span: Span::new(5, 11), // " world" - adjacent
            new_text: " there".to_string(),
        });
        let result = editor.apply();
        assert!(matches!(result, Err(BatchEditError::OverlappingEdits { .. })));
    }

    #[test]
    fn test_empty_edits_error() {
        let source = "hello world";
        let editor = BatchSpanEditor::new(source);
        let result = editor.apply();
        assert!(matches!(result, Err(BatchEditError::EmptyEdits)));
    }

    #[test]
    fn test_empty_edits_allowed() {
        let source = "hello world";
        let options = BatchEditOptions {
            allow_empty: true,
            ..Default::default()
        };
        let editor = BatchSpanEditor::with_options(source, options);
        let result = editor.apply().unwrap();
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_span_out_of_bounds_error() {
        let source = "short";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(0, 100), // way beyond source length
            new_text: "x".to_string(),
        });
        let result = editor.apply();
        assert!(matches!(result, Err(BatchEditError::SpanOutOfBounds { .. })));
    }

    // ========================================================================
    // Validation Tests
    // ========================================================================

    #[test]
    fn test_validate_without_applying() {
        let source = "hello world";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(0, 5),
            new_text: "hi".to_string(),
        });
        assert!(editor.validate().is_ok());
    }

    #[test]
    fn test_find_all_overlaps() {
        let source = "hello world";
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(0, 7),
            new_text: "a".to_string(),
        });
        editor.add(EditPrimitive::Replace {
            span: Span::new(5, 11),
            new_text: "b".to_string(),
        });
        let overlaps = editor.find_overlaps();
        assert_eq!(overlaps.len(), 1);
    }

    // ========================================================================
    // Unicode Tests
    // ========================================================================

    #[test]
    fn test_unicode_multibyte_spans() {
        let source = "def héllo():";
        //              ^   ^
        //              4   10 (byte offsets, 'é' is 2 bytes)
        let mut editor = BatchSpanEditor::new(source);
        editor.add(EditPrimitive::Replace {
            span: Span::new(4, 10), // "héllo"
            new_text: "world".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "def world():");
    }

    // ========================================================================
    // Indentation Tests
    // ========================================================================

    #[test]
    fn test_indentation_detection_spaces() {
        let source = "def foo():\n    x = 1\n    y = 2\n";
        let indent = detect_indentation(source, 15); // in "x = 1"
        assert_eq!(indent, "    ");
    }

    #[test]
    fn test_indentation_detection_tabs() {
        let source = "def foo():\n\tx = 1\n\ty = 2\n";
        let indent = detect_indentation(source, 13); // in "x = 1"
        assert_eq!(indent, "\t");
    }

    #[test]
    fn test_indentation_detection_mixed() {
        let source = "def foo():\n  \tx = 1\n";
        let indent = detect_indentation(source, 15); // in "x = 1"
        assert_eq!(indent, "  \t");
    }

    #[test]
    fn test_indentation_detection_empty_line() {
        // When position is on empty line, should check previous line
        let source = "def foo():\n    x = 1\n\n    y = 2\n";
        let indent = detect_indentation(source, 22); // empty line
        assert_eq!(indent, "    ");
    }

    #[test]
    fn test_indentation_preservation_insert_before() {
        let source = "def foo():\n    x = 1\n";
        //                          ^         ^
        //                          11        21
        //                  "    x = 1\n" = positions 11-21
        let options = BatchEditOptions {
            auto_indent: true,
            ..Default::default()
        };
        let mut editor = BatchSpanEditor::with_options(source, options);
        editor.add(EditPrimitive::InsertBefore {
            anchor_span: Span::new(11, 21), // "    x = 1\n" - the whole line including indent
            text: "y = 2\n".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "def foo():\n    y = 2\n    x = 1\n");
    }

    #[test]
    fn test_indentation_preservation_insert_after() {
        let source = "def foo():\n    x = 1";
        let options = BatchEditOptions {
            auto_indent: true,
            ..Default::default()
        };
        let mut editor = BatchSpanEditor::with_options(source, options);
        editor.add(EditPrimitive::InsertAfter {
            anchor_span: Span::new(15, 20), // "x = 1"
            text: "\ny = 2".to_string(),
        });
        let result = editor.apply().unwrap();
        assert_eq!(result, "def foo():\n    x = 1\n    y = 2");
    }

    #[test]
    fn test_apply_indentation_multiline() {
        let text = "if cond:\n    print('a')\n    print('b')\n";
        let result = apply_indentation(text, "    ");
        assert_eq!(
            result,
            "if cond:\n        print('a')\n        print('b')\n"
        );
    }

    // ========================================================================
    // IndentInfo Tests
    // ========================================================================

    #[test]
    fn test_detect_indentation_level_spaces() {
        let source = "def foo():\n    x = 1\n";
        let info = detect_indentation_level(source, 15);
        assert_eq!(info.indent_str, "    ");
        assert_eq!(info.visual_width, 4);
        assert!(!info.uses_tabs);
    }

    #[test]
    fn test_detect_indentation_level_tabs() {
        let source = "def foo():\n\tx = 1\n";
        let info = detect_indentation_level(source, 13);
        assert_eq!(info.indent_str, "\t");
        assert_eq!(info.visual_width, 4);
        assert!(info.uses_tabs);
    }
}
