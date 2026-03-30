//! tugmark-wasm — Markdown lexer and parser via pulldown-cmark, compiled to WASM.
//!
//! # API
//!
//! - [`lex_blocks`] — lex markdown into packed binary block metadata (4 × u32 per block)
//! - [`parse_to_html`] — parse markdown to an HTML string

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
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
    opts
}

/// Lex markdown into packed binary block metadata.
/// Returns Vec<u32> — 4 words per block. JS receives a Uint32Array.
#[wasm_bindgen]
pub fn lex_blocks(text: &str) -> Vec<u32> {
    let parser = Parser::new_ext(text, parser_options());
    let mut buf: Vec<u32> = Vec::with_capacity(256 * 4);

    let mut block_start: Option<usize> = None;
    let mut block_type: u8 = 0;
    let mut depth: u8 = 0;
    let mut nesting: usize = 0;
    let mut item_count: u16 = 0;
    let mut row_count: u16 = 0;

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
                            BLOCK_HEADING
                        }
                        Tag::Paragraph => BLOCK_PARAGRAPH,
                        Tag::CodeBlock(_) => BLOCK_CODE,
                        Tag::BlockQuote(_) => BLOCK_BLOCKQUOTE,
                        Tag::List(_) => BLOCK_LIST,
                        Tag::Table(_) => BLOCK_TABLE,
                        Tag::HtmlBlock => BLOCK_HTML,
                        _ => BLOCK_OTHER,
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
                        let d = match tag_end {
                            TagEnd::Heading(_) => depth,
                            _ => 0,
                        };
                        let (ic, rc) = match tag_end {
                            TagEnd::List(_) => (item_count, 0),
                            TagEnd::Table => (0, row_count),
                            _ => (0, 0),
                        };
                        buf.push((block_type as u32) | ((d as u32) << 8));
                        buf.push(start as u32);
                        buf.push(range.end as u32);
                        buf.push((ic as u32) | ((rc as u32) << 16));
                    }
                }
            }
            Event::Rule => {
                buf.push(BLOCK_HR as u32);
                buf.push(range.start as u32);
                buf.push(range.end as u32);
                buf.push(0);
            }
            _ => {}
        }
    }

    buf
}

/// Parse a markdown fragment to HTML.
#[wasm_bindgen]
pub fn parse_to_html(text: &str) -> String {
    let parser = Parser::new_ext(text, parser_options());
    let mut html = String::with_capacity(text.len() * 2);
    pulldown_cmark::html::push_html(&mut html, parser);
    html
}

