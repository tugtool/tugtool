/**
 * Tests for the regionBlockRanges population algorithm introduced in step-1.
 *
 * Verifies that after running the lex-then-populate loop (the same logic used
 * inside lexParseAndRender), the resulting Map<string, { start, count }>:
 *
 *   - Contains an entry for every region key that produced at least one block.
 *   - Has start/count values that are consistent with the total block count.
 *   - Does not overlap: adjacent region entries are contiguous.
 *   - Correctly handles a single region.
 *   - Correctly handles multiple regions in insertion order.
 *
 * WASM loading: tugmark_wasm exports `initSync` which accepts a BufferSource.
 * Bun supports `readFileSync` on .wasm files. We load the binary once at module
 * scope so it is shared across all tests in this file.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { initSync, lex_blocks } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
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
// is self-contained.  These match the production implementations exactly.
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
 * Run the regionBlockRanges population algorithm — the same logic as in
 * lexParseAndRender — and return the resulting map.
 */
function buildRegionBlockRanges(
  regionMap: RegionMap
): Map<string, { start: number; count: number }> {
  const text = regionMap.text;
  const packed = lex_blocks(text);
  const blocks = decodeBlocks(packed);
  const byteToChar = buildByteToCharMap(text);
  const blockStarts = blocks.map(b => byteToChar[b.start] ?? b.start);

  const ranges = new Map<string, { start: number; count: number }>();
  let currentKey: string | undefined = undefined;
  let rangeStart = 0;
  let rangeCount = 0;

  for (let i = 0; i < blockStarts.length; i++) {
    const key = regionMap.regionKeyAtOffset(blockStarts[i]);
    if (key !== currentKey) {
      if (currentKey !== undefined) {
        ranges.set(currentKey, { start: rangeStart, count: rangeCount });
      }
      currentKey = key;
      rangeStart = i;
      rangeCount = 1;
    } else {
      rangeCount++;
    }
  }
  if (currentKey !== undefined) {
    ranges.set(currentKey, { start: rangeStart, count: rangeCount });
  }

  return ranges;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("regionBlockRanges population", () => {
  it("single region: produces one entry with start=0 and count=block count", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("a", "# Hello\n\nParagraph one.\n\nParagraph two.");

    const ranges = buildRegionBlockRanges(regionMap);

    expect(ranges.has("a")).toBe(true);
    const entry = ranges.get("a")!;
    expect(entry.start).toBe(0);

    // Independently count blocks via WASM to verify count matches
    const packed = lex_blocks(regionMap.text);
    const totalBlocks = packed.length / STRIDE;
    expect(entry.count).toBe(totalBlocks);
  });

  it("two regions: entries are contiguous and cover all blocks", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("intro", "# Introduction\n\nFirst paragraph.");
    regionMap.setRegion("body", "## Body\n\nSecond paragraph.\n\nThird paragraph.");

    const ranges = buildRegionBlockRanges(regionMap);

    expect(ranges.has("intro")).toBe(true);
    expect(ranges.has("body")).toBe(true);

    const intro = ranges.get("intro")!;
    const body = ranges.get("body")!;

    // intro starts at block 0
    expect(intro.start).toBe(0);
    // body starts immediately after intro ends
    expect(body.start).toBe(intro.start + intro.count);
    // together they cover all blocks
    const packed = lex_blocks(regionMap.text);
    const totalBlocks = packed.length / STRIDE;
    expect(intro.count + body.count).toBe(totalBlocks);
  });

  it("three regions: all entries present with correct start offsets", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("r1", "Paragraph A.");
    regionMap.setRegion("r2", "Paragraph B.\n\nParagraph C.");
    regionMap.setRegion("r3", "Paragraph D.");

    const ranges = buildRegionBlockRanges(regionMap);

    expect(ranges.has("r1")).toBe(true);
    expect(ranges.has("r2")).toBe(true);
    expect(ranges.has("r3")).toBe(true);

    const r1 = ranges.get("r1")!;
    const r2 = ranges.get("r2")!;
    const r3 = ranges.get("r3")!;

    // Verify contiguous ordering
    expect(r1.start).toBe(0);
    expect(r2.start).toBe(r1.start + r1.count);
    expect(r3.start).toBe(r2.start + r2.count);
    // All counts are positive
    expect(r1.count).toBeGreaterThan(0);
    expect(r2.count).toBeGreaterThan(0);
    expect(r3.count).toBeGreaterThan(0);
    // r2 has two paragraphs so its count should be 2
    expect(r2.count).toBe(2);
  });

  it("multi-byte content: emoji in region text produces correct start/count", () => {
    const regionMap = new RegionMap();
    // emoji is 4 UTF-8 bytes but 2 UTF-16 code units — byte/char offset diverge
    regionMap.setRegion("emoji", "Hello \uD83D\uDE00 world.");
    regionMap.setRegion("plain", "Normal text here.");

    const ranges = buildRegionBlockRanges(regionMap);

    expect(ranges.has("emoji")).toBe(true);
    expect(ranges.has("plain")).toBe(true);

    const emoji = ranges.get("emoji")!;
    const plain = ranges.get("plain")!;

    expect(emoji.start).toBe(0);
    expect(emoji.count).toBeGreaterThan(0);
    expect(plain.start).toBe(emoji.start + emoji.count);
    expect(plain.count).toBeGreaterThan(0);
  });

  it("empty map: produces no entries and does not throw", () => {
    const regionMap = new RegionMap();

    expect(() => buildRegionBlockRanges(regionMap)).not.toThrow();
    const ranges = buildRegionBlockRanges(regionMap);
    expect(ranges.size).toBe(0);
  });
});
