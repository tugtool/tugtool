//! tugmark-wasm — Markdown lexer and parser via pulldown-cmark, compiled to WASM.
//!
//! # API
//!
//! - [`lex_blocks`] — lex markdown into packed binary block metadata (4 × u32 per block)
//! - [`lex_block_hashes`] — FNV-1a 64-bit content hash per block (2 × u32 per block;
//!   block ordering matches [`lex_blocks`] exactly)
//! - [`parse_to_html`] — parse a single fragment to an HTML string (no cross-block linking)
//! - [`parse_blocks_to_html`] — parse a whole document in one pass and emit per-block HTML
//!   so cross-block features (notably footnote ref ↔ definition linking) work correctly.

use pulldown_cmark::{Event, Options, Parser, Tag};
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Block type encoding (u8)
// ---------------------------------------------------------------------------

const BLOCK_HEADING: u8 = 1;
const BLOCK_PARAGRAPH: u8 = 2;
const BLOCK_CODE: u8 = 3;
const BLOCK_BLOCKQUOTE: u8 = 4;
const BLOCK_LIST: u8 = 5;
const BLOCK_TABLE: u8 = 6;
const BLOCK_HR: u8 = 7;
const BLOCK_HTML: u8 = 8;
const BLOCK_OTHER: u8 = 9;

// ---------------------------------------------------------------------------
// Packed binary: 4 u32 words per block (16 bytes)
//
// Word 0: type:u8 | depth:u8<<8
// Word 1: start:u32 (byte offset)
// Word 2: end:u32 (byte offset)
// Word 3: item_count:u16 | row_count:u16<<16
// ---------------------------------------------------------------------------

fn parser_options() -> Options {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_SMART_PUNCTUATION);
    opts
}

// ---------------------------------------------------------------------------
// Canonical top-level block iteration
//
// Both `lex_blocks` (block metadata) and `collect_block_hashes` (content
// hashes) need to walk pulldown-cmark and split events into top-level
// blocks the same way. `for_each_top_level_block` is the single
// canonical implementation of that walk — all other block-aware
// functions in this module consume it via callback, so the
// boundary-detection state machine lives in exactly one place. If
// pulldown-cmark ever changes how it emits events, the fix lands here
// and every consumer updates with it.
//
// Block kinds are split from `tag` rather than read at End so the
// callback receives discriminator + level/counts in one struct,
// computed once during Start. The match on `tag_end` that the prior
// inline lex_blocks performed (TagEnd::Heading / TagEnd::List /
// TagEnd::Table) is equivalent: pulldown-cmark always pairs Start and
// End tags of the same variant, so reading the discriminator at Start
// gives the same information at strictly less cost.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
enum TopLevelBlockKind {
    Heading,
    Paragraph,
    Code,
    BlockQuote,
    List,
    Table,
    Html,
    Other,
}

#[derive(Clone, Copy, Debug)]
struct TopLevelBlock {
    /// UTF-8 byte offset of the block's first character in the source.
    start: usize,
    /// UTF-8 byte offset one past the block's last character.
    end: usize,
    /// Outer-tag discriminator. `None` indicates `Event::Rule` (a
    /// horizontal-rule block has no `Tag` to discriminate on).
    kind: Option<TopLevelBlockKind>,
    /// Heading level (1..6) when `kind == Some(Heading)`; 0 otherwise.
    depth: u8,
    /// `Tag::Item` count among direct children of the outer container
    /// when `kind == Some(List)`; 0 otherwise.
    item_count: u16,
    /// `Tag::TableRow` count among direct children of the outer
    /// container when `kind == Some(Table)`; 0 otherwise.
    row_count: u16,
}

fn for_each_top_level_block<F: FnMut(&TopLevelBlock)>(text: &str, mut on_block: F) {
    let parser = Parser::new_ext(text, parser_options());

    let mut block_start: Option<usize> = None;
    let mut nesting: usize = 0;
    let mut kind: Option<TopLevelBlockKind> = None;
    let mut depth: u8 = 0;
    let mut item_count: u16 = 0;
    let mut row_count: u16 = 0;

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(ref tag) => {
                if nesting == 0 {
                    block_start = Some(range.start);
                    depth = 0;
                    item_count = 0;
                    row_count = 0;
                    kind = Some(match tag {
                        Tag::Heading { level, .. } => {
                            depth = *level as u8;
                            TopLevelBlockKind::Heading
                        }
                        Tag::Paragraph => TopLevelBlockKind::Paragraph,
                        Tag::CodeBlock(_) => TopLevelBlockKind::Code,
                        Tag::BlockQuote(_) => TopLevelBlockKind::BlockQuote,
                        Tag::List(_) => TopLevelBlockKind::List,
                        Tag::Table(_) => TopLevelBlockKind::Table,
                        Tag::HtmlBlock => TopLevelBlockKind::Html,
                        _ => TopLevelBlockKind::Other,
                    });
                }
                if nesting == 1 {
                    match tag {
                        Tag::Item => item_count += 1,
                        Tag::TableRow => row_count += 1,
                        _ => {}
                    }
                }
                nesting += 1;
            }
            Event::End(_) => {
                nesting = nesting.saturating_sub(1);
                if nesting == 0 {
                    if let Some(start) = block_start.take() {
                        let current_kind = kind.take();
                        // `depth` / `item_count` / `row_count` are
                        // only meaningful for their respective kinds.
                        // Gate them so callers see the same zero
                        // defaults the prior inline walkers emitted
                        // for non-matching kinds.
                        let block = TopLevelBlock {
                            start,
                            end: range.end,
                            kind: current_kind,
                            depth: match current_kind {
                                Some(TopLevelBlockKind::Heading) => depth,
                                _ => 0,
                            },
                            item_count: match current_kind {
                                Some(TopLevelBlockKind::List) => item_count,
                                _ => 0,
                            },
                            row_count: match current_kind {
                                Some(TopLevelBlockKind::Table) => row_count,
                                _ => 0,
                            },
                        };
                        on_block(&block);
                    }
                }
            }
            Event::Rule => {
                let block = TopLevelBlock {
                    start: range.start,
                    end: range.end,
                    kind: None,
                    depth: 0,
                    item_count: 0,
                    row_count: 0,
                };
                on_block(&block);
            }
            _ => {}
        }
    }
}

/// Translate a [`TopLevelBlock`]'s kind into the `u8` block-type tag
/// the packed `lex_blocks` output uses. Pure mapping; lives here so
/// both the wasm-bindgen surface and any future Rust consumer share
/// the canonical encoding.
fn block_kind_tag(kind: Option<TopLevelBlockKind>) -> u8 {
    match kind {
        Some(TopLevelBlockKind::Heading) => BLOCK_HEADING,
        Some(TopLevelBlockKind::Paragraph) => BLOCK_PARAGRAPH,
        Some(TopLevelBlockKind::Code) => BLOCK_CODE,
        Some(TopLevelBlockKind::BlockQuote) => BLOCK_BLOCKQUOTE,
        Some(TopLevelBlockKind::List) => BLOCK_LIST,
        Some(TopLevelBlockKind::Table) => BLOCK_TABLE,
        Some(TopLevelBlockKind::Html) => BLOCK_HTML,
        Some(TopLevelBlockKind::Other) => BLOCK_OTHER,
        // `None` corresponds to `Event::Rule` — a stand-alone block
        // with no Tag.
        None => BLOCK_HR,
    }
}

/// Lex markdown into packed binary block metadata.
/// Returns Vec<u32> — 4 words per block. JS receives a Uint32Array.
#[wasm_bindgen]
pub fn lex_blocks(text: &str) -> Vec<u32> {
    let mut buf: Vec<u32> = Vec::with_capacity(256 * 4);
    for_each_top_level_block(text, |block| {
        let type_tag = block_kind_tag(block.kind);
        buf.push((type_tag as u32) | ((block.depth as u32) << 8));
        buf.push(block.start as u32);
        buf.push(block.end as u32);
        buf.push((block.item_count as u32) | ((block.row_count as u32) << 16));
    });
    buf
}

/// Parse a markdown fragment to HTML.
///
/// Suitable for re-parsing a single block during incremental updates.
/// Cross-block features (e.g. footnote reference → definition linking,
/// reference-style links spanning blocks) require the whole document
/// to be visible during parsing — for that, prefer
/// [`parse_blocks_to_html`].
#[wasm_bindgen]
pub fn parse_to_html(text: &str) -> String {
    let parser = Parser::new_ext(text, parser_options());
    let mut html = String::with_capacity(text.len() * 2);
    pulldown_cmark::html::push_html(&mut html, parser);
    html
}

/// Parse a whole markdown document in a single pulldown-cmark pass and
/// emit one HTML string per top-level block, preserving cross-block
/// features like footnote ref ↔ definition linking and reference-style
/// links.
///
/// Block boundaries are computed inline by tracking nesting depth: a
/// `Tag::Start(_)` at `nesting == 0` opens a new block, the matching
/// `Tag::End(_)` at `nesting == 1 → 0` closes it; `Event::Rule` emits a
/// stand-alone block. The block sequence here matches [`lex_blocks`]'s
/// in count and order — both walk the same parser with the same options
/// and bucket events into the same top-level groups — so callers can
/// zip the two outputs together.
#[wasm_bindgen]
pub fn parse_blocks_to_html(text: &str) -> Box<[JsValue]> {
    let parser = Parser::new_ext(text, parser_options());

    let mut blocks: Vec<Vec<Event>> = Vec::with_capacity(64);
    let mut current: Vec<Event> = Vec::with_capacity(64);
    let mut nesting: usize = 0;

    for event in parser {
        match &event {
            Event::Start(_) => {
                if nesting == 0 {
                    current.clear();
                }
                nesting += 1;
                current.push(event);
            }
            Event::End(_) => {
                nesting = nesting.saturating_sub(1);
                current.push(event);
                if nesting == 0 {
                    blocks.push(std::mem::take(&mut current));
                }
            }
            Event::Rule => {
                if nesting == 0 {
                    blocks.push(vec![event]);
                } else {
                    current.push(event);
                }
            }
            _ => {
                current.push(event);
            }
        }
    }

    blocks
        .into_iter()
        .map(|events| {
            let mut html = String::new();
            pulldown_cmark::html::push_html(&mut html, events.into_iter());
            JsValue::from_str(&html)
        })
        .collect::<Vec<_>>()
        .into_boxed_slice()
}

// ---------------------------------------------------------------------------
// FNV-1a 64-bit content hashing
//
// Per-block content hashes drive the streaming markdown reconciler:
// the TS side compares new vs. previous hash arrays, identifies the
// longest stable prefix, and skips DOM mutations for blocks whose
// source range hasn't changed across renders. Hashing the *source
// byte range* (not the rendered HTML) is correct because pulldown-cmark
// is deterministic — same source range, same parser options, same
// HTML output. Cheap to compute during the existing block walk: one
// FNV-1a pass over the bytes between the block's `start` and `end`
// offsets that `lex_blocks` already produces.
//
// Returned as 2 × u32 per block (low half first, then high half) so
// the boundary across WASM is a plain `Vec<u32>` like `lex_blocks`,
// avoiding the BigInt64Array marshalling cost. Block ordering matches
// `lex_blocks` exactly — both functions walk the same parser with the
// same options and apply the same nesting-depth bucketing.
// ---------------------------------------------------------------------------

/// FNV-1a 64-bit hash of a byte slice. The hash is initialised with
/// the standard FNV offset basis and folded byte-by-byte using XOR
/// + `wrapping_mul` against the FNV prime; integer wraparound is
///   part of the algorithm's contract, not a defect.
fn fnv1a64(bytes: &[u8]) -> u64 {
    const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = FNV_OFFSET;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// Produce one FNV-1a 64-bit hash per top-level block, computed over
/// the block's source byte range. Output: `Vec<u32>` with 2 words
/// per block (low half, then high half). Shares the canonical block
/// walker with [`lex_blocks`] via [`for_each_top_level_block`], so
/// the two functions cannot drift in block-bucketing behaviour.
///
/// Pure helper — no `#[wasm_bindgen]`, normally testable via
/// `cargo test`. The public WASM surface lives in [`lex_block_hashes`].
fn collect_block_hashes(text: &str) -> Vec<u32> {
    let bytes = text.as_bytes();
    let mut buf: Vec<u32> = Vec::with_capacity(64);
    for_each_top_level_block(text, |block| {
        let h = fnv1a64(&bytes[block.start..block.end]);
        buf.push(h as u32);
        buf.push((h >> 32) as u32);
    });
    buf
}

/// Compute a per-block FNV-1a 64-bit content hash for every top-level
/// block in `text`. Returns `Vec<u32>` with 2 words per block (low,
/// high). Block ordering matches [`lex_blocks`] — the two functions
/// can be zipped on index without further coordination.
///
/// Consumed by the streaming markdown reconciler ([Step 18.8]) to
/// detect which blocks changed across renders so DOM mutations stay
/// minimal and the browser's per-element scroll anchors survive.
#[wasm_bindgen]
pub fn lex_block_hashes(text: &str) -> Vec<u32> {
    collect_block_hashes(text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// FNV-1a 64-bit reference values from the FNV specification's
    /// test vectors (see http://www.isthe.com/chongo/tech/comp/fnv/).
    /// Pinning known constants protects against an accidental change
    /// to the offset basis or the prime.
    #[test]
    fn fnv1a_known_values() {
        assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(fnv1a64(b"foobar"), 0x8594_4171_f739_67e8);
    }

    #[test]
    fn block_hashes_are_deterministic() {
        let text = "# Heading\n\nFirst paragraph.\n\nSecond paragraph.";
        let h1 = collect_block_hashes(text);
        let h2 = collect_block_hashes(text);
        assert_eq!(h1, h2);
    }

    #[test]
    fn block_hashes_diverge_on_content_change() {
        let h_before = collect_block_hashes("# Heading A");
        let h_after = collect_block_hashes("# Heading B");
        assert_eq!(h_before.len(), 2); // one block, two u32s
        assert_eq!(h_after.len(), 2);
        assert_ne!(h_before, h_after);
    }

    #[test]
    fn block_hash_count_matches_lex_blocks() {
        let text = "# H1\n\nPara 1\n\nPara 2\n\n- item 1\n- item 2\n\n```\ncode\n```\n";
        let lex_words = lex_blocks(text);
        let hash_words = collect_block_hashes(text);
        // lex_blocks emits 4 u32 per block; collect_block_hashes emits 2.
        // The two MUST agree on block count or the reconciler can't
        // zip them safely.
        let lex_blocks_count = lex_words.len() / 4;
        let hash_blocks_count = hash_words.len() / 2;
        assert_eq!(lex_blocks_count, hash_blocks_count);
        assert!(lex_blocks_count >= 4);
    }

    #[test]
    fn lex_blocks_and_collect_block_hashes_agree_on_per_block_byte_ranges() {
        // Both functions now consume `for_each_top_level_block`, so
        // their per-block (start, end) must agree by construction.
        // This test pins the cross-check: hash each block's source
        // range independently using `lex_blocks`'s reported offsets,
        // and confirm it matches `collect_block_hashes`'s output
        // at the same index. If anyone ever rewrites one walker
        // without the other, this test catches the divergence.
        let text =
            "# Heading\n\nFirst paragraph.\n\n- item 1\n- item 2\n\n---\n\n```rust\nfn main() {}\n```\n";
        let lex_words = lex_blocks(text);
        let hash_words = collect_block_hashes(text);
        let bytes = text.as_bytes();
        let block_count = lex_words.len() / 4;
        assert_eq!(block_count, hash_words.len() / 2);
        assert!(block_count >= 5); // heading, paragraph, list, hr, code
        for i in 0..block_count {
            let start = lex_words[i * 4 + 1] as usize;
            let end = lex_words[i * 4 + 2] as usize;
            let expected = fnv1a64(&bytes[start..end]);
            let expected_lo = expected as u32;
            let expected_hi = (expected >> 32) as u32;
            assert_eq!(
                hash_words[i * 2],
                expected_lo,
                "block {i}: lo mismatch (start={start}, end={end})"
            );
            assert_eq!(
                hash_words[i * 2 + 1],
                expected_hi,
                "block {i}: hi mismatch (start={start}, end={end})"
            );
        }
    }

    #[test]
    fn appending_a_block_preserves_leading_block_hashes() {
        // Streaming case: text grows by appending a new block. The
        // hashes for blocks already complete in the prior render must
        // be byte-identical so the reconciler classifies them as
        // stable and skips DOM mutation. This test is the load-bearing
        // contract for the whole #step-18-8 fix.
        let prior = "# Heading\n\nFirst paragraph.\n";
        let later = "# Heading\n\nFirst paragraph.\n\nSecond paragraph.\n";
        let h_prior = collect_block_hashes(prior);
        let h_later = collect_block_hashes(later);
        assert!(h_later.len() > h_prior.len());
        assert_eq!(&h_later[..h_prior.len()], &h_prior[..]);
    }

    #[test]
    fn appending_a_list_item_preserves_other_block_hashes() {
        // Within a list, a new `- item` line completes the list
        // differently — the whole list block changes. But blocks
        // BEFORE the list (heading, intro paragraph) must still hash
        // identically.
        let prior = "# Title\n\nIntro paragraph.\n\n- alpha\n- beta\n";
        let later = "# Title\n\nIntro paragraph.\n\n- alpha\n- beta\n- gamma\n";
        let h_prior = collect_block_hashes(prior);
        let h_later = collect_block_hashes(later);
        // First two blocks (heading + intro) → 4 u32s identical.
        assert_eq!(h_prior.len(), 6);
        assert_eq!(h_later.len(), 6);
        assert_eq!(&h_prior[..4], &h_later[..4]);
        // List block diverges (more items).
        assert_ne!(&h_prior[4..6], &h_later[4..6]);
    }

    #[test]
    fn whitespace_only_change_changes_the_hash() {
        // Two source ranges that differ only in trailing whitespace
        // hash differently — the byte slice carries that whitespace,
        // and the parser's offset range covers it.
        let h_a = collect_block_hashes("Para.");
        let h_b = collect_block_hashes("Para.\n");
        assert_ne!(h_a, h_b);
    }

    #[test]
    fn empty_input_produces_no_blocks() {
        assert_eq!(collect_block_hashes(""), Vec::<u32>::new());
        assert_eq!(collect_block_hashes("\n\n\n"), Vec::<u32>::new());
    }

    #[test]
    fn horizontal_rule_produces_a_hashed_block() {
        // `Event::Rule` is the one-shot block-emit path that doesn't
        // go through Start/End — make sure the hash logic catches it.
        let h = collect_block_hashes("---\n");
        assert_eq!(h.len(), 2);
        // And the hash should differ from a paragraph of the same text.
        let h_para = collect_block_hashes("body\n");
        assert_ne!(h, h_para);
    }
}

