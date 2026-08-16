//! `TextRef` — one numbered file reference.
//!
//! The single result shape both refs ops produce. A filename match carries
//! a path alone; a content match carries the 1-based line it hit, the
//! column spans of the hits on that line, and the full text of the line.
//!
//! Two conventions the whole chain depends on:
//!
//! - `line` is **1-based**, matching every consumer downstream (the block's
//!   match row, the editor's reveal, the annotator's `data-line`).
//! - `columns` are **0-based, half-open `[start, end)` char offsets** into
//!   `preview` — char offsets, not byte offsets, so a line with multi-byte
//!   text highlights the run the user actually matched. This is exactly the
//!   span shape the result block consumes, so the wire feeds the renderer
//!   with no adaptation in between.
//!
//! `path` is relative to the run's `root` here and in the ledger. Joining
//! the root back on is the frontend's job, because a row's path must be
//! absolute to be clickable.

use serde::{Deserialize, Serialize};

/// A half-open `[start, end)` run of chars within a line's text.
///
/// Serializes as a two-element array, so a `TextRef`'s `columns` land on
/// the wire as `[[start, end], …]`.
pub type ColumnSpan = (u32, u32);

/// A numbered file reference: what one result row is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextRef {
    /// 1-based position in the run's ref list — the number `/ref N` takes.
    pub index: u32,
    /// Path relative to the run's root, forward slashes.
    pub path: String,
    /// 1-based line number; `None` for a filename match.
    #[serde(default)]
    pub line: Option<u32>,
    /// Hit spans within `preview`; empty for a filename match.
    #[serde(default)]
    pub columns: Vec<ColumnSpan>,
    /// The full, untruncated text of the matched line; `None` for a
    /// filename match. Untruncated because `columns` index into it — a
    /// pre-shortened line would make every offset lie.
    #[serde(default)]
    pub preview: Option<String>,
}

impl TextRef {
    /// A filename reference: path only.
    pub fn filename(index: u32, path: impl Into<String>) -> Self {
        Self {
            index,
            path: path.into(),
            line: None,
            columns: Vec::new(),
            preview: None,
        }
    }

    /// A content reference: a line, the spans hit on it, and its text.
    pub fn content(
        index: u32,
        path: impl Into<String>,
        line: u32,
        columns: Vec<ColumnSpan>,
        preview: impl Into<String>,
    ) -> Self {
        Self {
            index,
            path: path.into(),
            line: Some(line),
            columns,
            preview: Some(preview.into()),
        }
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filename_ref_serializes_with_null_line_and_empty_columns() {
        let json = serde_json::to_value(TextRef::filename(1, "src/main.rs")).unwrap();
        assert_eq!(json["index"], 1);
        assert_eq!(json["path"], "src/main.rs");
        assert!(json["line"].is_null());
        assert_eq!(json["columns"].as_array().unwrap().len(), 0);
        assert!(json["preview"].is_null());
    }

    #[test]
    fn content_ref_serializes_columns_as_pairs() {
        let json =
            serde_json::to_value(TextRef::content(7, "a.ts", 12, vec![(3, 6), (9, 12)], "let foo"))
                .unwrap();
        assert_eq!(json["line"], 12);
        assert_eq!(json["columns"], serde_json::json!([[3, 6], [9, 12]]));
        assert_eq!(json["preview"], "let foo");
    }

    #[test]
    fn refs_round_trip_through_json() {
        let rows = vec![
            TextRef::filename(1, "README.md"),
            TextRef::content(2, "src/lib.rs", 40, vec![(0, 3)], "pub fn go() {}"),
        ];
        let encoded = serde_json::to_string(&rows).unwrap();
        let decoded: Vec<TextRef> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, rows);
    }
}
