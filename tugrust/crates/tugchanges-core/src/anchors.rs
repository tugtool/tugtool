//! The evidence an edit records about *what it added*, in the shape the diff
//! will show it.
//!
//! An anchor is compared against a hunk's added (`+`) lines, so it is built
//! from the lines an edit adds — `new_string`'s lines minus `old_string`'s,
//! by multiset — and not from the replacement text as a whole. An `Edit`
//! carries unchanged context lines for uniqueness; those lines appear in the
//! diff as context, so recording them would put text in the anchor that no
//! hunk's added text can ever contain.
//!
//! # The derivation under-approximates, on purpose
//!
//! Multiset subtraction is not a diff: a line that also appears in
//! `old_string` is dropped from the anchor even when git would render one
//! occurrence of it as added. That is the safe direction. A line recorded as
//! added that git renders as context makes the anchor unmatchable; a line
//! dropped from the anchor only thins the evidence, and the matcher needs
//! just one surviving line to place the edit.
//!
//! # Distinctiveness is length *and* alphanumeric
//!
//! Only distinctive lines contribute hashes, because a line the anchor shares
//! with a co-owner's hunk claims that hunk — the expensive, invisible error.
//! A length floor alone is not enough: `});` is exactly three bytes and
//! appears thousands of times in this codebase, as do `};`, `))`, and `---`.
//! Requiring at least one alphanumeric character excludes all of them while
//! keeping genuinely short real lines like `id,` and `use std::fmt;`.
//!
//! Producer and matcher live in one crate ([`crate::contention`] reads what
//! this module writes) so the two cannot drift apart, and so tests on either
//! side can build fixtures through the production constructor.

use std::collections::HashMap;

use crate::hunks::content_hash;

/// Bytes of an anchor's added-line text kept as the `added_head` excerpt.
/// Long enough to be distinctive against a file's other insertions, short
/// enough that a large edit does not put its body in the ledger.
pub const SPAN_HEAD_CAP: usize = 200;

/// Line hashes one anchor records. Past it the anchor is already ample
/// evidence: an edit that places on none of its first 32 distinctive lines
/// will not place on its 33rd, and every extra hash costs bytes on every
/// span row of every event.
pub const ANCHOR_LINE_HASH_CAP: usize = 32;

/// Trimmed bytes a line needs before it can contribute a hash — half of the
/// distinctiveness rule; the alphanumeric requirement is the other half.
pub const ANCHOR_MIN_LINE_BYTES: usize = 3;

/// Truncate `text` to at most [`SPAN_HEAD_CAP`] bytes on a character
/// boundary — a byte-sliced excerpt of multi-byte text would not be a
/// string at all.
pub fn head_excerpt(text: &str) -> &str {
    if text.len() <= SPAN_HEAD_CAP {
        return text;
    }
    let mut end = SPAN_HEAD_CAP;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Whether a line is distinctive enough to stand as evidence: at least
/// [`ANCHOR_MIN_LINE_BYTES`] trimmed bytes *and* at least one alphanumeric
/// character.
pub fn line_is_distinctive(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.len() >= ANCHOR_MIN_LINE_BYTES && trimmed.chars().any(char::is_alphanumeric)
}

/// The lines `new` has that `old` does not, by multiset — each line of `new`
/// is emitted unless `old` still has an unspent occurrence of it.
///
/// Order follows `new`. An empty `old` (an insert) yields every line.
pub fn edit_added_lines(old: &str, new: &str) -> Vec<String> {
    let mut budget: HashMap<&str, usize> = HashMap::new();
    for line in old.lines() {
        *budget.entry(line).or_insert(0) += 1;
    }
    let mut added = Vec::new();
    for line in new.lines() {
        match budget.get_mut(line) {
            Some(count) if *count > 0 => *count -= 1,
            _ => added.push(line.to_owned()),
        }
    }
    added
}

/// The anchor body one edit records: the hashes of its distinctive added
/// lines, how many lines it added in all, and a capped excerpt of those
/// lines' text.
///
/// `added_lines` is diagnostic — the count *before* the distinctiveness
/// filter and the cap, so a reader can tell "added nothing" from "added only
/// punctuation". `added_head` is a matcher input, not a comment: it is what
/// the containment fallback probes with when no line hash lands.
pub fn edit_anchor(old: Option<&str>, new: &str) -> serde_json::Value {
    let added = edit_added_lines(old.unwrap_or(""), new);
    let line_hashes: Vec<String> = added
        .iter()
        .filter(|line| line_is_distinctive(line))
        .take(ANCHOR_LINE_HASH_CAP)
        .map(|line| content_hash(line))
        .collect();
    let joined = added.join("\n");
    serde_json::json!({
        "line_hashes": line_hashes,
        "added_lines": added.len(),
        "added_head": head_excerpt(&joined),
    })
}

/// Whether an `added_head` read back from a span may have lost its last line
/// to the cap.
///
/// The writer knows this exactly (it holds the untruncated join); a reader
/// holds only the excerpt, so it infers. [`head_excerpt`] cuts at
/// [`SPAN_HEAD_CAP`] and then walks back at most three bytes to a character
/// boundary, so anything shorter than that window is whole. A head that
/// happens to end in the window is treated as severed, which costs one probe
/// — the cheap direction.
pub fn head_was_truncated(added_head: &str) -> bool {
    added_head.len() + 3 >= SPAN_HEAD_CAP
}

/// The lines of an `added_head` usable as containment probes: whole lines
/// only (a severed tail is dropped when the head may have been truncated),
/// and distinctive ones only, by the same rule the hashes obey.
pub fn containment_probes(added_head: &str, truncated: bool) -> Vec<&str> {
    let mut lines: Vec<&str> = added_head.split('\n').collect();
    if truncated {
        lines.pop();
    }
    lines
        .into_iter()
        .filter(|line| line_is_distinctive(line))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hashes(value: &serde_json::Value) -> Vec<String> {
        value["line_hashes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn context_lines_never_reach_the_anchor() {
        // The field failure this module exists to end: an Edit carrying one
        // unchanged line for uniqueness and changing one other.
        let old = "            glyphPosition=\"both\"\n            size={12}";
        let new = "            glyphPosition=\"both\"\n            size={14}";
        let anchor = edit_anchor(Some(old), new);
        assert_eq!(hashes(&anchor), vec![content_hash("            size={14}")]);
        assert_eq!(anchor["added_lines"], 1);
        assert_eq!(anchor["added_head"], "            size={14}");
    }

    #[test]
    fn an_import_list_reduces_to_its_added_lines() {
        let old = "  getLayoutRole,\n  isSidebarCard,\n  _resetForTest,";
        let new = "  getLayoutRole,\n  isSidebarCard,\n  getGreedRank,\n  DEFAULT_GREED_RANK,\n  _resetForTest,";
        let anchor = edit_anchor(Some(old), new);
        assert_eq!(
            hashes(&anchor),
            vec![
                content_hash("  getGreedRank,"),
                content_hash("  DEFAULT_GREED_RANK,"),
            ]
        );
    }

    #[test]
    fn subtraction_respects_multiplicity() {
        let added = edit_added_lines("dup\ndup", "dup\ndup\ndup");
        assert_eq!(added, vec!["dup".to_owned()]);
    }

    #[test]
    fn an_insert_records_every_line() {
        let anchor = edit_anchor(None, "alpha one\nbravo two");
        assert_eq!(
            hashes(&anchor),
            vec![content_hash("alpha one"), content_hash("bravo two")]
        );
    }

    #[test]
    fn punctuation_only_lines_are_indistinctive() {
        // `});` is exactly ANCHOR_MIN_LINE_BYTES bytes: a length floor alone
        // would admit it, and it appears thousands of times in this codebase.
        assert!(!line_is_distinctive("});"));
        assert!(!line_is_distinctive("};"));
        assert!(!line_is_distinctive("))"));
        assert!(!line_is_distinctive("---"));
        assert!(!line_is_distinctive("    }"));
        assert!(!line_is_distinctive(""));

        let anchor = edit_anchor(None, "    });\n};\n\n    }");
        assert!(hashes(&anchor).is_empty());
        assert_eq!(anchor["added_lines"], 4);
    }

    #[test]
    fn short_but_real_lines_survive() {
        assert!(line_is_distinctive("id,"));
        assert!(line_is_distinctive("use std::fmt;"));
        let anchor = edit_anchor(None, "id,\nuse std::fmt;");
        assert_eq!(hashes(&anchor).len(), 2);
    }

    #[test]
    fn line_hashes_are_capped_but_the_count_is_not() {
        let new: String = (0..ANCHOR_LINE_HASH_CAP + 10)
            .map(|n| format!("distinct line {n}\n"))
            .collect();
        let anchor = edit_anchor(None, &new);
        assert_eq!(hashes(&anchor).len(), ANCHOR_LINE_HASH_CAP);
        assert_eq!(anchor["added_lines"], ANCHOR_LINE_HASH_CAP + 10);
    }

    #[test]
    fn a_head_excerpt_never_splits_a_character() {
        let text = "é".repeat(SPAN_HEAD_CAP);
        let head = head_excerpt(&text);
        assert!(head.len() <= SPAN_HEAD_CAP);
        assert_eq!(head.chars().count(), SPAN_HEAD_CAP / 2);
    }

    #[test]
    fn probes_drop_a_severed_tail_only_when_truncated() {
        let head = "alpha one\nbravo two\ncharlie thr";
        assert_eq!(
            containment_probes(head, false),
            vec!["alpha one", "bravo two", "charlie thr"]
        );
        assert_eq!(
            containment_probes(head, true),
            vec!["alpha one", "bravo two"]
        );
    }

    #[test]
    fn probes_obey_the_distinctiveness_rule() {
        assert_eq!(
            containment_probes("});\nreal line\n};", false),
            vec!["real line"]
        );
    }

    #[test]
    fn truncation_is_inferred_from_the_heads_length() {
        let long: String = (0..40).map(|n| format!("distinct line {n}\n")).collect();
        let anchor = edit_anchor(None, &long);
        let head = anchor["added_head"].as_str().unwrap();
        assert!(head_was_truncated(head));
        assert!(!head_was_truncated("short"));
    }
}
