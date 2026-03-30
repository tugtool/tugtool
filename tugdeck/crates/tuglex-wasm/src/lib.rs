//! tuglex-wasm — Markdown lexer and parser via pulldown-cmark, compiled to WASM.
//!
//! Two entry points:
//!   - `lex_blocks(text)` → JSON array of block boundaries, types, byte offsets
//!   - `parse_to_html(text)` → HTML string for a markdown fragment

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// A single block-level token with type, byte offsets, and optional metadata.
#[derive(Serialize)]
pub struct Block {
    /// Block type: "heading", "paragraph", "code", "list", "blockquote", "table", "hr", "html"
    #[serde(rename = "type")]
    pub block_type: &'static str,
    /// Byte offset of block start in the source text.
    pub start: usize,
    /// Byte offset of block end in the source text.
    pub end: usize,
    /// Heading depth (1-6), only set for headings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<u8>,
    /// Number of list items, only set for lists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_count: Option<usize>,
    /// Number of table rows (excluding header), only set for tables.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_count: Option<usize>,
}

/// Lex markdown text into block-level tokens. Returns JSON array of Block objects.
#[wasm_bindgen]
pub fn lex_blocks(text: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(text, opts);
    let mut blocks: Vec<Block> = Vec::new();

    // Track the current top-level block.
    let mut block_start: Option<usize> = None;
    let mut block_type: &str = "";
    let mut depth: u8 = 0;
    let mut nesting: usize = 0;
    let mut item_count: usize = 0;
    let mut row_count: usize = 0;

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(ref tag) => {
                if nesting == 0 {
                    // Top-level block start.
                    block_start = Some(range.start);
                    item_count = 0;
                    row_count = 0;
                    block_type = match tag {
                        Tag::Heading { level, .. } => {
                            depth = *level as u8;
                            "heading"
                        }
                        Tag::Paragraph => "paragraph",
                        Tag::CodeBlock(_) => "code",
                        Tag::BlockQuote(_) => "blockquote",
                        Tag::List(_) => "list",
                        Tag::Table(_) => "table",
                        Tag::HtmlBlock => "html",
                        _ => "other",
                    };
                }
                // Count list items and table rows at depth 1.
                if nesting == 1 {
                    match tag {
                        Tag::Item => item_count += 1,
                        Tag::TableRow => row_count += 1,
                        _ => {}
                    }
                }
                nesting += 1;
            }
            Event::End(ref tag_end) => {
                nesting = nesting.saturating_sub(1);
                if nesting == 0 {
                    if let Some(start) = block_start.take() {
                        let mut block = Block {
                            block_type,
                            start,
                            end: range.end,
                            depth: None,
                            item_count: None,
                            row_count: None,
                        };
                        match tag_end {
                            TagEnd::Heading(_) => block.depth = Some(depth),
                            TagEnd::List(_) => block.item_count = Some(item_count),
                            TagEnd::Table => block.row_count = Some(row_count),
                            _ => {}
                        }
                        blocks.push(block);
                    }
                }
            }
            Event::Rule => {
                blocks.push(Block {
                    block_type: "hr",
                    start: range.start,
                    end: range.end,
                    depth: None,
                    item_count: None,
                    row_count: None,
                });
            }
            _ => {}
        }
    }

    serde_json::to_string(&blocks).unwrap_or_else(|_| "[]".to_string())
}

/// Parse a markdown fragment to HTML. Takes raw markdown text, returns HTML string.
#[wasm_bindgen]
pub fn parse_to_html(text: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(text, opts);
    let mut html = String::with_capacity(text.len() * 2);
    pulldown_cmark::html::push_html(&mut html, parser);
    html
}

/// Lex and parse in one call: returns JSON with blocks array and html array.
/// Each html entry corresponds to the block at the same index.
#[wasm_bindgen]
pub fn lex_and_parse(text: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(text, opts);
    let mut blocks: Vec<Block> = Vec::new();

    let mut block_start: Option<usize> = None;
    let mut block_type: &str = "";
    let mut depth: u8 = 0;
    let mut nesting: usize = 0;
    let mut item_count: usize = 0;
    let mut row_count: usize = 0;

    for (event, range) in parser.into_offset_iter() {
        match event {
            Event::Start(ref tag) => {
                if nesting == 0 {
                    block_start = Some(range.start);
                    item_count = 0;
                    row_count = 0;
                    block_type = match tag {
                        Tag::Heading { level, .. } => {
                            depth = *level as u8;
                            "heading"
                        }
                        Tag::Paragraph => "paragraph",
                        Tag::CodeBlock(_) => "code",
                        Tag::BlockQuote(_) => "blockquote",
                        Tag::List(_) => "list",
                        Tag::Table(_) => "table",
                        Tag::HtmlBlock => "html",
                        _ => "other",
                    };
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
            Event::End(ref tag_end) => {
                nesting = nesting.saturating_sub(1);
                if nesting == 0 {
                    if let Some(start) = block_start.take() {
                        let mut block = Block {
                            block_type,
                            start,
                            end: range.end,
                            depth: None,
                            item_count: None,
                            row_count: None,
                        };
                        match tag_end {
                            TagEnd::Heading(_) => block.depth = Some(depth),
                            TagEnd::List(_) => block.item_count = Some(item_count),
                            TagEnd::Table => block.row_count = Some(row_count),
                            _ => {}
                        }
                        blocks.push(block);
                    }
                }
            }
            Event::Rule => {
                blocks.push(Block {
                    block_type: "hr",
                    start: range.start,
                    end: range.end,
                    depth: None,
                    item_count: None,
                    row_count: None,
                });
            }
            _ => {}
        }
    }

    // Now parse each block's raw text to HTML.
    let htmls: Vec<String> = blocks
        .iter()
        .map(|b| {
            let raw = &text[b.start..b.end];
            let block_parser = Parser::new_ext(raw, opts);
            let mut html = String::with_capacity(raw.len() * 2);
            pulldown_cmark::html::push_html(&mut html, block_parser);
            html
        })
        .collect();

    // Return combined result.
    let result = serde_json::json!({
        "blocks": blocks,
        "html": htmls,
    });
    result.to_string()
}
