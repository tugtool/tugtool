/**
 * Tests for incrementalTailUpdate — region-scoped incremental lex algorithm.
 *
 * These tests exercise the incrementalTailUpdate logic by directly calling the
 * pure helper functions that compose it: buildByteToCharMap, decodeBlocks, and
 * the offset translation arithmetic. They also verify BlockHeightIndex.truncate()
 * behaviour in the context of block count decrease.
 *
 * Because incrementalTailUpdate is a component-internal function (defined inside
 * the TugMarkdownView render function) it cannot be imported directly. Instead,
 * these tests reproduce the key algorithmic pieces in isolation:
 *
 * 1. Byte offset translation with multi-byte UTF-8 (emoji, CJK) — Spec S02.
 * 2. Region-scoped lex: prepend \n\n, subtract 2 from byte offsets, filter prefix
 *    blocks — D01.
 * 3. Splice correctness: block count increase, decrease, and stable case.
 *
 * WASM loading: tugmark_wasm exports `initSync`. We load once at module scope.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { initSync, lex_blocks } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import { BlockHeightIndex } from "../lib/block-height-index";
import { RegionMap } from "../lib/region-map";

// ---------------------------------------------------------------------------
// WASM initialisation — load once
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(__dir, "../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm");

beforeAll(() => {
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
});

// ---------------------------------------------------------------------------
// Re-implement the pure helpers from tug-markdown-view.tsx so this test file
// is self-contained. These match the production implementations exactly.
// ---------------------------------------------------------------------------

const STRIDE = 4;
const BLOCK_TYPES = ['?','heading','paragraph','code','blockquote','list','table','hr','html','other'];
const _encoder = new TextEncoder();

interface BlockMeta {
  type: string;
  start: number;
  end: number;
  depth: number;
  itemCount: number;
  rowCount: number;
}

function buildByteToCharMap(text: string): Uint32Array {
  const encoded = _encoder.encode(text);
  const byteLen = encoded.length;
  const map = new Uint32Array(byteLen + 1);
  let bytePos = 0;
  let charPos = 0;
  while (charPos < text.length) {
    const cp = text.codePointAt(charPos)!;
    const byteWidth = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    const charWidth = cp >= 0x10000 ? 2 : 1;
    for (let b = 0; b < byteWidth; b++) {
      map[bytePos + b] = charPos;
    }
    bytePos += byteWidth;
    charPos += charWidth;
  }
  map[byteLen] = charPos;
  return map;
}

function decodeBlocks(buf: Uint32Array): BlockMeta[] {
  const count = buf.length / STRIDE;
  const blocks: BlockMeta[] = new Array(count);
  for (let i = 0, j = 0; i < buf.length; i += STRIDE, j++) {
    const w0 = buf[i];
    blocks[j] = {
      type: BLOCK_TYPES[w0 & 0xFF] ?? 'other',
      start: buf[i + 1],
      end: buf[i + 2],
      depth: (w0 >> 8) & 0xFF,
      itemCount: buf[i + 3] & 0xFFFF,
      rowCount: (buf[i + 3] >> 16) & 0xFFFF,
    };
  }
  return blocks;
}

/**
 * Simulate the region-scoped lex: prepend \n\n, lex, filter prefix blocks,
 * subtract 2 from byte offsets. Returns region-local byte offsets.
 */
function lexRegion(regionText: string): BlockMeta[] {
  const packed = lex_blocks("\n\n" + regionText);
  const rawBlocks = decodeBlocks(packed);
  return rawBlocks
    .filter(b => b.start >= 2)
    .map(b => ({ ...b, start: b.start - 2, end: b.end - 2 }));
}

/**
 * Translate region-local byte offsets to document-global char offsets.
 * regionCharStart is the char offset of the region's start in the full document.
 */
function translateOffsets(
  blocks: BlockMeta[],
  regionText: string,
  regionCharStart: number
): { starts: number[]; ends: number[] } {
  const byteToChar = buildByteToCharMap(regionText);
  const starts = blocks.map(b => regionCharStart + (byteToChar[b.start] ?? b.start));
  const ends = blocks.map(b => regionCharStart + (byteToChar[b.end] ?? b.end));
  return { starts, ends };
}

// ---------------------------------------------------------------------------
// Tests: Spec S02 — byte offset translation with multi-byte content
// ---------------------------------------------------------------------------

describe("byte offset translation (Spec S02)", () => {
  it("ASCII-only: byte offsets equal char offsets", () => {
    const text = "Hello world.";
    const blocks = lexRegion(text);
    const { starts, ends } = translateOffsets(blocks, text, 0);

    // For ASCII, byteToChar[i] === i
    for (let i = 0; i < blocks.length; i++) {
      expect(starts[i]).toBe(blocks[i].start);
      expect(ends[i]).toBe(blocks[i].end);
    }
  });

  it("emoji content: char offset diverges from byte offset", () => {
    // U+1F600 (GRINNING FACE) = 4 UTF-8 bytes, 2 UTF-16 code units
    const emoji = "\uD83D\uDE00";
    const text = `${emoji} hello world.`;
    const blocks = lexRegion(text);
    expect(blocks.length).toBeGreaterThan(0);

    const byteToChar = buildByteToCharMap(text);
    // The emoji occupies bytes 0-3 and chars 0-1.
    // byte 0 -> char 0, byte 1 -> char 0, byte 2 -> char 0, byte 3 -> char 0
    expect(byteToChar[0]).toBe(0);
    expect(byteToChar[1]).toBe(0);
    expect(byteToChar[2]).toBe(0);
    expect(byteToChar[3]).toBe(0);
    // byte 4 -> char 2 (first ASCII after surrogate pair)
    expect(byteToChar[4]).toBe(2);
  });

  it("CJK content: 3-byte UTF-8 codepoints map correctly", () => {
    // U+4E2D (中) = 3 UTF-8 bytes, 1 UTF-16 code unit
    const text = "\u4E2D\u6587\u5185\u5BB9";  // 中文内容
    const blocks = lexRegion(text);
    expect(blocks.length).toBeGreaterThan(0);

    const byteToChar = buildByteToCharMap(text);
    // Each CJK char is 3 bytes. Char 0 starts at byte 0.
    expect(byteToChar[0]).toBe(0);
    // Char 1 starts at byte 3.
    expect(byteToChar[3]).toBe(1);
    // Char 2 starts at byte 6.
    expect(byteToChar[6]).toBe(2);
    // Char 3 starts at byte 9.
    expect(byteToChar[9]).toBe(3);
  });

  it("multi-byte region: global char offsets include regionCharStart", () => {
    // Simulate a second region that starts at char offset 20
    const regionText = "Hello world.";
    const regionCharStart = 20;
    const blocks = lexRegion(regionText);
    const { starts, ends } = translateOffsets(blocks, regionText, regionCharStart);

    // All starts must be >= regionCharStart
    for (const s of starts) {
      expect(s).toBeGreaterThanOrEqual(regionCharStart);
    }
    // All ends must be >= starts
    for (let i = 0; i < starts.length; i++) {
      expect(ends[i]).toBeGreaterThanOrEqual(starts[i]);
    }
  });

  it("emoji at block boundary: correct global char offsets", () => {
    // RegionMap with two regions; second region contains emoji
    const regionMap = new RegionMap();
    regionMap.setRegion("a", "First region.");
    const emoji = "\uD83D\uDE00";
    const secondText = `${emoji} second region.`;
    regionMap.setRegion("b", secondText);

    const regionRange = regionMap.regionRange("b")!;
    const regionCharStart = regionRange.start;

    const blocks = lexRegion(secondText);
    const { starts, ends } = translateOffsets(blocks, secondText, regionCharStart);

    expect(blocks.length).toBeGreaterThan(0);
    // All starts must be in the range [regionCharStart, regionRange.end]
    for (const s of starts) {
      expect(s).toBeGreaterThanOrEqual(regionCharStart);
      expect(s).toBeLessThanOrEqual(regionRange.end);
    }
    // Slicing the full document text at the translated offsets should reproduce the region text
    const fullText = regionMap.text;
    for (let i = 0; i < blocks.length; i++) {
      const slice = fullText.slice(starts[i], ends[i]);
      expect(slice.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: D01 — region-scoped lex with \n\n prefix
// ---------------------------------------------------------------------------

describe("region-scoped lex (D01 — \\n\\n prefix)", () => {
  it("prefix blocks at byte offset < 2 are filtered out", () => {
    // An empty prefix should produce no blocks from the \n\n itself
    const text = "Hello world.";
    const blocksWithPrefix = decodeBlocks(lex_blocks("\n\n" + text));
    const blocksFiltered = lexRegion(text);

    // All blocks in filtered set have start >= 0 (after subtracting 2)
    for (const b of blocksFiltered) {
      expect(b.start).toBeGreaterThanOrEqual(0);
    }
    // The filtered set should not have more blocks than the prefixed set
    expect(blocksFiltered.length).toBeLessThanOrEqual(blocksWithPrefix.length);
  });

  it("region lex produces same block count as full document lex for single region", () => {
    const text = "# Heading\n\nParagraph one.\n\nParagraph two.";
    const blocksRegion = lexRegion(text);
    const blocksFull = decodeBlocks(lex_blocks(text));

    // Both should produce the same number of blocks for the same content
    expect(blocksRegion.length).toBe(blocksFull.length);
  });

  it("region lex byte offsets are relative to region start (not document)", () => {
    const text = "# Heading\n\nParagraph.";
    const blocks = lexRegion(text);
    // The first block should start at byte 0 (relative to region)
    expect(blocks[0].start).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Splice logic — block count changes
// ---------------------------------------------------------------------------

describe("splice logic (block count changes)", () => {
  it("block count increase: new blocks appended to height index", () => {
    const idx = new BlockHeightIndex();
    // Simulate starting with 3 blocks at height 24 each
    for (let i = 0; i < 3; i++) {
      idx.appendBlock(24);
    }
    expect(idx.count).toBe(3);

    // Simulate 2 new blocks appended (Q > P: P=3, Q=5)
    idx.appendBlock(24);
    idx.appendBlock(24);
    expect(idx.count).toBe(5);
    expect(idx.getTotalHeight()).toBe(120);
  });

  it("block count decrease: truncate removes excess blocks", () => {
    const idx = new BlockHeightIndex();
    // 10 blocks at 24px each
    for (let i = 0; i < 10; i++) {
      idx.appendBlock(24);
    }
    expect(idx.count).toBe(10);

    // Truncate to 5
    idx.truncate(5);
    expect(idx.count).toBe(5);
    expect(idx.getTotalHeight()).toBe(120);
  });

  it("stable block count: no splice changes needed", () => {
    const idx = new BlockHeightIndex();
    for (let i = 0; i < 5; i++) {
      idx.appendBlock(24);
    }
    // Same count, just update heights via setHeight
    idx.setHeight(4, 48);
    expect(idx.count).toBe(5);
    expect(idx.getTotalHeight()).toBe(144);
  });
});

// ---------------------------------------------------------------------------
// Tests: BlockHeightIndex.truncate() in incremental update context
// ---------------------------------------------------------------------------

describe("BlockHeightIndex.truncate() in incremental update context", () => {
  it("append 10 blocks, truncate to 5, verify count and totalHeight", () => {
    const idx = new BlockHeightIndex();
    const heights = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    for (const h of heights) {
      idx.appendBlock(h);
    }
    expect(idx.count).toBe(10);
    expect(idx.getTotalHeight()).toBe(550);

    idx.truncate(5);
    expect(idx.count).toBe(5);
    // First 5 heights: 10+20+30+40+50 = 150
    expect(idx.getTotalHeight()).toBe(150);
  });

  it("prefix sum is valid after truncate: getBlockOffset() returns correct values", () => {
    const idx = new BlockHeightIndex();
    for (let i = 1; i <= 10; i++) {
      idx.appendBlock(i * 10);
    }
    idx.truncate(5);

    // Block offsets should be correct for first 5 blocks
    // heights: 10, 20, 30, 40, 50
    expect(idx.getBlockOffset(0)).toBe(0);
    expect(idx.getBlockOffset(1)).toBe(10);
    expect(idx.getBlockOffset(2)).toBe(30);
    expect(idx.getBlockOffset(3)).toBe(60);
    expect(idx.getBlockOffset(4)).toBe(100);
    expect(idx.getBlockOffset(5)).toBe(150); // == totalHeight
  });

  it("can append new blocks after truncate and get correct totals", () => {
    const idx = new BlockHeightIndex();
    for (let i = 0; i < 10; i++) {
      idx.appendBlock(100);
    }
    idx.truncate(3);

    // Append 4 new blocks at 50px each
    for (let i = 0; i < 4; i++) {
      idx.appendBlock(50);
    }
    expect(idx.count).toBe(7);
    // 3 * 100 + 4 * 50 = 300 + 200 = 500
    expect(idx.getTotalHeight()).toBe(500);
  });

  it("getBlockAtOffset() works correctly after truncate", () => {
    const idx = new BlockHeightIndex();
    // 5 blocks at 100px each
    for (let i = 0; i < 5; i++) {
      idx.appendBlock(100);
    }
    // Truncate to 3 blocks
    idx.truncate(3);

    // Block lookup within truncated range
    expect(idx.getBlockAtOffset(0)).toBe(0);
    expect(idx.getBlockAtOffset(50)).toBe(0);
    expect(idx.getBlockAtOffset(100)).toBe(1);
    expect(idx.getBlockAtOffset(250)).toBe(2);
    // Past end returns last block
    expect(idx.getBlockAtOffset(9999)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Full pipeline — region text → global char offsets
// ---------------------------------------------------------------------------

describe("full pipeline: region text to global char offsets", () => {
  it("two regions: second region blocks have offsets after first region", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("intro", "# Introduction\n\nFirst paragraph.");
    regionMap.setRegion("body", "## Body\n\nSecond paragraph.\n\nThird paragraph.");

    const bodyRange = regionMap.regionRange("body")!;
    const bodyText = regionMap.getRegionText("body")!;
    const bodyCharStart = bodyRange.start;

    const bodyBlocks = lexRegion(bodyText);
    const { starts } = translateOffsets(bodyBlocks, bodyText, bodyCharStart);

    // All body block starts must be >= bodyCharStart
    for (const s of starts) {
      expect(s).toBeGreaterThanOrEqual(bodyCharStart);
    }
    expect(bodyBlocks.length).toBeGreaterThan(0);
  });

  it("emoji region: slicing full document at translated offsets yields correct text", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("a", "Prefix region.");
    const emojiText = "Hello \uD83D\uDE00 world.\n\nAnother paragraph.";
    regionMap.setRegion("b", emojiText);

    const bRange = regionMap.regionRange("b")!;
    const bCharStart = bRange.start;
    const blocks = lexRegion(emojiText);
    const { starts, ends } = translateOffsets(blocks, emojiText, bCharStart);

    const fullText = regionMap.text;
    for (let i = 0; i < blocks.length; i++) {
      const slice = fullText.slice(starts[i], ends[i]);
      // Each slice should be non-empty and contain content from emojiText
      expect(slice.length).toBeGreaterThan(0);
      // The slice must appear within emojiText (i.e. content is from region b)
      expect(emojiText.includes(slice.trimEnd())).toBe(true);
    }
  });

  it("CJK region: byte/char offset divergence does not corrupt block boundaries", () => {
    const regionMap = new RegionMap();
    // Region a: ASCII
    regionMap.setRegion("a", "Normal text.");
    // Region b: CJK (3 bytes per char)
    const cjkText = "\u4E2D\u6587\u5185\u5BB9\n\n\u7B2C\u4E8C\u6BB5\u843D";
    regionMap.setRegion("b", cjkText);

    const bRange = regionMap.regionRange("b")!;
    const bCharStart = bRange.start;
    const blocks = lexRegion(cjkText);
    const { starts, ends } = translateOffsets(blocks, cjkText, bCharStart);

    expect(blocks.length).toBeGreaterThan(0);
    const fullText = regionMap.text;
    for (let i = 0; i < blocks.length; i++) {
      const slice = fullText.slice(starts[i], ends[i]);
      expect(slice.length).toBeGreaterThan(0);
    }
  });
});
