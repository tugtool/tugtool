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
//!   **the whole source line** — char offsets, not byte offsets, so a line
//!   with multi-byte text highlights the run the user actually matched.
//!
//! `preview` carries only the *windows* of the line worth showing (see
//! [`LinePreview`]), and each window records the column it starts at. That
//! is what keeps the two conventions compatible: a span is located against
//! the line, and the window it falls in subtracts its own origin to paint
//! it. Offsets never shift, so the same `columns` that drive the highlight
//! drive the editor's reveal into the real file.
//!
//! `path` is relative to the run's `root` here and in the ledger. Joining
//! the root back on is the frontend's job, because a row's path must be
//! absolute to be clickable.

use serde::{Deserialize, Deserializer, Serialize};

/// A half-open `[start, end)` run of chars within a line's text.
///
/// Serializes as a two-element array, so a `TextRef`'s `columns` land on
/// the wire as `[[start, end], …]`.
pub type ColumnSpan = (u32, u32);

/// One window of a matched line: some text, and the column it starts at.
///
/// `col` is a 0-based char offset into the whole source line, which is what
/// lets a span expressed in line coordinates find its place inside a window
/// that begins hundreds of chars in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewSegment {
    /// 0-based char offset of `text` within the source line.
    pub col: u32,
    /// The window's text.
    pub text: String,
}

/// What a result row shows of its matched line.
///
/// A search over real trees hits minified JavaScript and `.jsonl` fixtures,
/// where one "line" is the whole file. Carrying that line whole cost three
/// things at once: an unreadable transcript row, a ledger blob, and — via
/// the block's Share gesture — a turn's worth of context. So the producer
/// keeps only what a reader can use: a window around each match, merged
/// where windows touch, with `line_len` recording what the line actually
/// was so the view can mark the elisions at both ends.
///
/// Segments are ascending, non-overlapping, and never adjacent (touching
/// windows merge). A short line yields exactly one segment at `col: 0`
/// holding the whole line — the same thing a reader saw before any of this
/// existed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LinePreview {
    /// Char length of the whole source line.
    pub line_len: u32,
    /// The windows kept, ascending by `col`.
    pub segments: Vec<PreviewSegment>,
    /// Matches on this line that no kept window covers, because the row hit
    /// its excerpt budget. Zero for every line that is not pathological.
    #[serde(default)]
    pub elided_matches: u32,
}

impl LinePreview {
    /// The whole line as a single window — what a line short enough to show
    /// entire produces, and what the un-excerpted path asks for.
    pub fn whole(line: &str) -> Self {
        let line_len = line.chars().count() as u32;
        Self {
            line_len,
            segments: if line.is_empty() {
                Vec::new()
            } else {
                vec![PreviewSegment {
                    col: 0,
                    text: line.to_string(),
                }]
            },
            elided_matches: 0,
        }
    }
}

/// Reads both the windowed shape and a bare string.
///
/// A bare string is what `refs.db` rows written before windowing existed
/// hold, and the ledger keeps one run per session indefinitely. Reading
/// them as a single full-width window costs one match arm and saves a
/// migration.
impl<'de> Deserialize<'de> for LinePreview {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Windowed {
            line_len: u32,
            segments: Vec<PreviewSegment>,
            #[serde(default)]
            elided_matches: u32,
        }

        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Wire {
            Windowed(Windowed),
            Whole(String),
        }

        Ok(match Wire::deserialize(deserializer)? {
            Wire::Windowed(w) => Self {
                line_len: w.line_len,
                segments: w.segments,
                elided_matches: w.elided_matches,
            },
            Wire::Whole(text) => Self::whole(&text),
        })
    }
}

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
    /// Hit spans, in whole-line char coordinates; empty for a filename
    /// match. Every span falls inside one of `preview`'s segments.
    #[serde(default)]
    pub columns: Vec<ColumnSpan>,
    /// What to show of the matched line; `None` for a filename match.
    #[serde(default)]
    pub preview: Option<LinePreview>,
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

    /// A content reference: a line, the spans hit on it, and what to show
    /// of it.
    pub fn content(
        index: u32,
        path: impl Into<String>,
        line: u32,
        columns: Vec<ColumnSpan>,
        preview: LinePreview,
    ) -> Self {
        Self {
            index,
            path: path.into(),
            line: Some(line),
            columns,
            preview: Some(preview),
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
        let json = serde_json::to_value(TextRef::content(
            7,
            "a.ts",
            12,
            vec![(3, 6), (9, 12)],
            LinePreview::whole("let foo"),
        ))
        .unwrap();
        assert_eq!(json["line"], 12);
        assert_eq!(json["columns"], serde_json::json!([[3, 6], [9, 12]]));
        assert_eq!(json["preview"]["line_len"], 7);
        assert_eq!(
            json["preview"]["segments"],
            serde_json::json!([{"col": 0, "text": "let foo"}])
        );
    }

    #[test]
    fn refs_round_trip_through_json() {
        let rows = vec![
            TextRef::filename(1, "README.md"),
            TextRef::content(
                2,
                "src/lib.rs",
                40,
                vec![(0, 3)],
                LinePreview::whole("pub fn go() {}"),
            ),
        ];
        let encoded = serde_json::to_string(&rows).unwrap();
        let decoded: Vec<TextRef> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, rows);
    }

    #[test]
    fn a_bare_string_preview_reads_as_one_full_width_window() {
        // The shape `refs.db` holds for any run recorded before windowing.
        let decoded: TextRef = serde_json::from_value(serde_json::json!({
            "index": 1,
            "path": "a.ts",
            "line": 3,
            "columns": [[4, 7]],
            "preview": "let foo = 2;",
        }))
        .unwrap();
        let preview = decoded.preview.expect("preview");
        assert_eq!(preview.line_len, 12);
        assert_eq!(
            preview.segments,
            vec![PreviewSegment {
                col: 0,
                text: "let foo = 2;".into()
            }]
        );
        assert_eq!(preview.elided_matches, 0);
    }

    #[test]
    fn an_empty_line_previews_as_no_windows_rather_than_an_empty_one() {
        assert_eq!(LinePreview::whole("").segments, Vec::new());
    }
}
