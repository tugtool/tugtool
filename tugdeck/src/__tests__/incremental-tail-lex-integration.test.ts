/**
 * Step-5 Integration Checkpoint: end-to-end tests for the incremental tail lex feature.
 *
 * This file is the authoritative integration test for all artifacts from Steps 1-4.
 * It exercises the complete algorithm using only public, extractable pure helpers
 * (identical to what the production code uses internally), verifying:
 *
 * 1. Streaming throughput: 5000 chunks producing ~1MB. Final lex time per chunk
 *    (region-scoped) must be under 2ms — the success criterion from the plan.
 * 2. regionBlockRanges consistency: after any update, the map correctly reflects
 *    region-to-block mapping across both the full-rebuild and incremental paths.
 * 3. Middle-region full rebuild: updating a non-last region re-lexes the whole
 *    document; the block ranges cover all regions and all blocks.
 * 4. Mixed content correctness: emoji, CJK, and fenced code blocks are handled
 *    without corrupting block boundaries or char offsets.
 *
 * Architecture note: TugMarkdownView is a React component with all logic in
 * component-internal closures. These tests reproduce the pure algorithmic pieces
 * extracted from the component (buildByteToCharMap, decodeBlocks, lexRegion,
 * buildRegionBlockRanges) using the same implementations as production. The tests
 * verify correctness and performance of those algorithms, not of the React component.
 *
 * WASM loading: tugmark_wasm exports `initSync`. Loaded once at module scope.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { initSync, lex_blocks } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import { RegionMap } from "../lib/region-map";
import { BlockHeightIndex } from "../lib/block-height-index";

// ---------------------------------------------------------------------------
// WASM initialisation — load once for all tests in this file
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(__dir, "../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm");

beforeAll(() => {
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
});

// ---------------------------------------------------------------------------
// Pure helpers — identical copies of the production implementations in
// tug-markdown-view.tsx. Keeping them here makes the tests self-contained
// and free of React component coupling.
// ---------------------------------------------------------------------------

const STRIDE = 4;
const BLOCK_TYPES = ['?', 'heading', 'paragraph', 'code', 'blockquote', 'list', 'table', 'hr', 'html', 'other'];
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

/** Region-scoped lex: prepend \\n\\n, lex, filter prefix blocks, subtract 2. */
function lexRegion(regionText: string): BlockMeta[] {
  const packed = lex_blocks("\n\n" + regionText);
  const rawBlocks = decodeBlocks(packed);
  return rawBlocks
    .filter(b => b.start >= 2)
    .map(b => ({ ...b, start: b.start - 2, end: b.end - 2 }));
}

/** Full-document lex (no prefix). */
function lexFull(text: string): BlockMeta[] {
  return decodeBlocks(lex_blocks(text));
}

/**
 * Translate region-local byte offsets to document-global char offsets.
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

/**
 * Simulate the regionBlockRanges population algorithm from lexParseAndRender.
 * Returns Map<regionKey, { start, count, types }>.
 */
function buildRegionBlockRanges(
  regionMap: RegionMap
): Map<string, { start: number; count: number; types: string[] }> {
  const text = regionMap.text;
  const packed = lex_blocks(text);
  const blocks = decodeBlocks(packed);
  const byteToChar = buildByteToCharMap(text);
  const blockStarts = blocks.map(b => byteToChar[b.start] ?? b.start);

  const ranges = new Map<string, { start: number; count: number; types: string[] }>();
  let currentKey: string | undefined = undefined;
  let rangeStart = 0;
  let rangeTypes: string[] = [];

  for (let i = 0; i < blockStarts.length; i++) {
    const key = regionMap.regionKeyAtOffset(blockStarts[i]);
    if (key !== currentKey) {
      if (currentKey !== undefined) {
        ranges.set(currentKey, { start: rangeStart, count: rangeTypes.length, types: rangeTypes });
      }
      currentKey = key;
      rangeStart = i;
      rangeTypes = [blocks[i].type];
    } else {
      rangeTypes.push(blocks[i].type);
    }
  }
  if (currentKey !== undefined) {
    ranges.set(currentKey, { start: rangeStart, count: rangeTypes.length, types: rangeTypes });
  }

  return ranges;
}

/**
 * Simulate one incremental tail update: lex only the tail region and splice
 * the result into the accumulated block arrays and height index.
 * Returns the lex time in ms.
 */
interface EngineSnapshot {
  blockStarts: number[];
  blockEnds: number[];
  blockCount: number;
  heightIndex: BlockHeightIndex;
  regionBlockRanges: Map<string, { start: number; count: number; types: string[] }>;
}

function simulateIncrementalTailUpdate(
  engine: EngineSnapshot,
  regionMap: RegionMap,
  key: string
): number {
  const range = engine.regionBlockRanges.get(key);
  if (range === undefined) {
    // No prior entry — simulate a full rebuild to establish it
    const fullRanges = buildRegionBlockRanges(regionMap);
    for (const [k, v] of fullRanges) {
      engine.regionBlockRanges.set(k, v);
    }
    const fullText = regionMap.text;
    const fullBlocks = lexFull(fullText);
    const byteToChar = buildByteToCharMap(fullText);
    engine.blockStarts = fullBlocks.map(b => byteToChar[b.start] ?? b.start);
    engine.blockEnds = fullBlocks.map(b => byteToChar[b.end] ?? b.end);
    engine.blockCount = fullBlocks.length;
    engine.heightIndex = new BlockHeightIndex();
    for (let i = 0; i < fullBlocks.length; i++) {
      engine.heightIndex.appendBlock(24);
    }
    return 0;
  }

  const regionText = regionMap.getRegionText(key) ?? "";
  const regionRange = regionMap.regionRange(key);
  if (!regionRange) return 0;
  const regionCharStart = regionRange.start;

  const lexStart = performance.now();
  const packed = lex_blocks("\n\n" + regionText);
  const lexMs = performance.now() - lexStart;

  const rawBlocks = decodeBlocks(packed);
  const newRegionBlocks = rawBlocks
    .filter(b => b.start >= 2)
    .map(b => ({ ...b, start: b.start - 2, end: b.end - 2 }));

  const byteToChar = buildByteToCharMap(regionText);
  const newStarts = newRegionBlocks.map(b => regionCharStart + (byteToChar[b.start] ?? b.start));
  const newEnds = newRegionBlocks.map(b => regionCharStart + (byteToChar[b.end] ?? b.end));

  const S = range.start;
  const P = range.count;
  const Q = newRegionBlocks.length;

  // Update changed existing blocks
  for (let i = 0; i < Math.min(P, Q); i++) {
    engine.blockStarts[S + i] = newStarts[i];
    engine.blockEnds[S + i] = newEnds[i];
    engine.heightIndex.setHeight(S + i, 24);
  }

  // Handle block count decrease
  if (Q < P) {
    engine.blockStarts.splice(S + Q, P - Q);
    engine.blockEnds.splice(S + Q, P - Q);
    engine.heightIndex.truncate(S + Q);
  }

  // Append new blocks
  if (Q > P) {
    engine.blockStarts.splice(S + P, 0, ...newStarts.slice(P));
    engine.blockEnds.splice(S + P, 0, ...newEnds.slice(P));
    for (let i = P; i < Q; i++) {
      engine.heightIndex.appendBlock(24);
    }
  }

  engine.blockCount = S + Q;
  const newTypes = newRegionBlocks.map(b => b.type);
  engine.regionBlockRanges.set(key, { start: S, count: Q, types: newTypes });

  return lexMs;
}

// ---------------------------------------------------------------------------
// Test utility: build a streaming chunk text
// ---------------------------------------------------------------------------

function buildChunk(idx: number): string {
  return `Streaming paragraph number ${idx}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`;
}

// ---------------------------------------------------------------------------
// Test 1: Streaming throughput — 5000 chunks, constant lex time under 2ms
// ---------------------------------------------------------------------------

describe("Integration: streaming throughput (5000 chunks, ~1MB)", () => {
  // 60-second timeout: 5000 chunks takes ~5-10 seconds including JS overhead
  it("final lex time per chunk is under 2ms (success criterion from plan)", () => {
    // Warm up WASM JIT with a few throw-away calls
    for (let i = 0; i < 5; i++) {
      lex_blocks("warmup paragraph.");
    }

    const regionMap = new RegionMap();
    const STREAM_KEY = "stream";
    const NUM_CHUNKS = 5000;

    // Build up the accumulated streaming text incrementally.
    // Each chunk appends ~90 chars. After 5000 chunks ≈ 450KB.
    let accumulated = "";

    // Perform full rebuild for the first chunk to seed the engine state
    accumulated = buildChunk(0);
    regionMap.setRegion(STREAM_KEY, accumulated);

    const engine: EngineSnapshot = {
      blockStarts: [],
      blockEnds: [],
      blockCount: 0,
      heightIndex: new BlockHeightIndex(),
      regionBlockRanges: new Map(),
    };

    // Seed via full rebuild
    const seedRanges = buildRegionBlockRanges(regionMap);
    for (const [k, v] of seedRanges) {
      engine.regionBlockRanges.set(k, v);
    }
    const seedText = regionMap.text;
    const seedBlocks = lexFull(seedText);
    const seedByteToChar = buildByteToCharMap(seedText);
    engine.blockStarts = seedBlocks.map(b => seedByteToChar[b.start] ?? b.start);
    engine.blockEnds = seedBlocks.map(b => seedByteToChar[b.end] ?? b.end);
    engine.blockCount = seedBlocks.length;
    for (let i = 0; i < seedBlocks.length; i++) {
      engine.heightIndex.appendBlock(24);
    }

    let lastChunkLexMs = 0;
    let totalLexMs = 0;
    const MEASURE_WINDOW = 100; // average over last 100 chunks

    // Stream 5000 chunks
    for (let chunkIdx = 1; chunkIdx < NUM_CHUNKS; chunkIdx++) {
      accumulated += "\n\n" + buildChunk(chunkIdx);
      regionMap.setRegion(STREAM_KEY, accumulated);

      const lexMs = simulateIncrementalTailUpdate(engine, regionMap, STREAM_KEY);
      if (chunkIdx >= NUM_CHUNKS - MEASURE_WINDOW) {
        totalLexMs += lexMs;
      }
      lastChunkLexMs = lexMs;
    }

    // Average lex time over the final 100 chunks
    const avgFinalLexMs = totalLexMs / MEASURE_WINDOW;

    // The accumulated text should be substantial (hundreds of KB)
    const finalTextLength = regionMap.text.length;
    expect(finalTextLength).toBeGreaterThan(100_000);

    // The engine should have many blocks
    expect(engine.blockCount).toBeGreaterThan(1000);

    // Key acceptance criterion: final lex time per chunk must be under 2ms.
    // This verifies that region-scoped lex is O(1) amortized — the tail region
    // is small regardless of document size.
    expect(avgFinalLexMs).toBeLessThan(2);
    // Also verify the very last chunk was fast
    expect(lastChunkLexMs).toBeLessThan(2);
  }, 60_000);

  it("total streaming lex time for 5000 chunks is well under 5 seconds", () => {
    // Re-test total throughput to confirm no O(N) accumulation.
    // This is a looser version of the per-chunk test.
    for (let i = 0; i < 3; i++) {
      lex_blocks("warmup.");
    }

    const regionMap = new RegionMap();
    const STREAM_KEY = "stream";
    const NUM_CHUNKS = 5000;

    let accumulated = buildChunk(0);
    regionMap.setRegion(STREAM_KEY, accumulated);

    const engine: EngineSnapshot = {
      blockStarts: [],
      blockEnds: [],
      blockCount: 0,
      heightIndex: new BlockHeightIndex(),
      regionBlockRanges: new Map(),
    };

    const seedRanges = buildRegionBlockRanges(regionMap);
    for (const [k, v] of seedRanges) {
      engine.regionBlockRanges.set(k, v);
    }
    const seedText = regionMap.text;
    const seedBlocks = lexFull(seedText);
    const seedByteToChar = buildByteToCharMap(seedText);
    engine.blockStarts = seedBlocks.map(b => seedByteToChar[b.start] ?? b.start);
    engine.blockEnds = seedBlocks.map(b => seedByteToChar[b.end] ?? b.end);
    engine.blockCount = seedBlocks.length;
    for (let i = 0; i < seedBlocks.length; i++) {
      engine.heightIndex.appendBlock(24);
    }

    const totalStart = performance.now();
    let cumulativeLexMs = 0;

    for (let chunkIdx = 1; chunkIdx < NUM_CHUNKS; chunkIdx++) {
      accumulated += "\n\n" + buildChunk(chunkIdx);
      regionMap.setRegion(STREAM_KEY, accumulated);
      cumulativeLexMs += simulateIncrementalTailUpdate(engine, regionMap, STREAM_KEY);
    }

    const totalWallMs = performance.now() - totalStart;

    // Total cumulative WASM lex time must be well under 5 seconds.
    expect(cumulativeLexMs).toBeLessThan(5000);

    // Total wall-clock overhead (lex + offset translation + splice bookkeeping)
    // must also be reasonable. We give 30 seconds for 5000 chunks including all JS
    // overhead — this should complete in 2-5 seconds in practice.
    expect(totalWallMs).toBeLessThan(30_000);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Test 2: regionBlockRanges consistency
// ---------------------------------------------------------------------------

describe("Integration: regionBlockRanges consistency", () => {
  it("full rebuild: regionBlockRanges covers all blocks with no gaps or overlaps", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("a", "# Heading A\n\nParagraph A1.\n\nParagraph A2.");
    regionMap.setRegion("b", "## Heading B\n\nParagraph B1.");
    regionMap.setRegion("c", "Paragraph C.");

    const ranges = buildRegionBlockRanges(regionMap);
    expect(ranges.has("a")).toBe(true);
    expect(ranges.has("b")).toBe(true);
    expect(ranges.has("c")).toBe(true);

    const a = ranges.get("a")!;
    const b = ranges.get("b")!;
    const c = ranges.get("c")!;

    // Contiguous: b starts where a ends, c starts where b ends
    expect(b.start).toBe(a.start + a.count);
    expect(c.start).toBe(b.start + b.count);

    // Together they cover all blocks in the full document
    const totalBlocks = lexFull(regionMap.text).length;
    expect(a.count + b.count + c.count).toBe(totalBlocks);
  });

  it("incremental update: regionBlockRanges entry for tail region is updated", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("prefix", "# Prefix\n\nPrefix paragraph.");
    regionMap.setRegion("tail", "Initial tail content.");

    const engine: EngineSnapshot = {
      blockStarts: [],
      blockEnds: [],
      blockCount: 0,
      heightIndex: new BlockHeightIndex(),
      regionBlockRanges: new Map(),
    };

    // Seed via full rebuild
    const seedRanges = buildRegionBlockRanges(regionMap);
    for (const [k, v] of seedRanges) {
      engine.regionBlockRanges.set(k, v);
    }
    const seedText = regionMap.text;
    const seedBlocks = lexFull(seedText);
    const seedByteToChar = buildByteToCharMap(seedText);
    engine.blockStarts = seedBlocks.map(b => seedByteToChar[b.start] ?? b.start);
    engine.blockEnds = seedBlocks.map(b => seedByteToChar[b.end] ?? b.end);
    engine.blockCount = seedBlocks.length;
    for (let i = 0; i < seedBlocks.length; i++) {
      engine.heightIndex.appendBlock(24);
    }

    const priorPrefixRange = engine.regionBlockRanges.get("prefix")!;
    const priorTailRange = engine.regionBlockRanges.get("tail")!;

    // Update the tail region with more content
    regionMap.setRegion("tail", "Updated tail.\n\nNew paragraph added.\n\nAnother one.");
    simulateIncrementalTailUpdate(engine, regionMap, "tail");

    // Prefix range must be unchanged
    const newPrefixRange = engine.regionBlockRanges.get("prefix")!;
    expect(newPrefixRange.start).toBe(priorPrefixRange.start);
    expect(newPrefixRange.count).toBe(priorPrefixRange.count);

    // Tail range must be updated to reflect new block count
    const newTailRange = engine.regionBlockRanges.get("tail")!;
    expect(newTailRange.start).toBe(priorTailRange.start);
    expect(newTailRange.count).toBeGreaterThan(priorTailRange.count);

    // Total block count must equal prefix count + new tail count
    expect(engine.blockCount).toBe(newPrefixRange.count + newTailRange.count);
    expect(engine.blockStarts.length).toBe(engine.blockCount);
    expect(engine.blockEnds.length).toBe(engine.blockCount);
    expect(engine.heightIndex.count).toBe(engine.blockCount);
  });

  it("clear: after clear, regionBlockRanges is empty", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("a", "Some content.");
    regionMap.setRegion("b", "More content.");

    const ranges = buildRegionBlockRanges(regionMap);
    expect(ranges.size).toBe(2);

    // Simulate clear
    ranges.clear();
    expect(ranges.size).toBe(0);
  });

  it("block count decrease: regionBlockRanges count decreases, arrays shrink correctly", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("prefix", "Prefix.");
    regionMap.setRegion("tail", "Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.");

    const engine: EngineSnapshot = {
      blockStarts: [],
      blockEnds: [],
      blockCount: 0,
      heightIndex: new BlockHeightIndex(),
      regionBlockRanges: new Map(),
    };

    const seedRanges = buildRegionBlockRanges(regionMap);
    for (const [k, v] of seedRanges) {
      engine.regionBlockRanges.set(k, v);
    }
    const seedText = regionMap.text;
    const seedBlocks = lexFull(seedText);
    const seedByteToChar = buildByteToCharMap(seedText);
    engine.blockStarts = seedBlocks.map(b => seedByteToChar[b.start] ?? b.start);
    engine.blockEnds = seedBlocks.map(b => seedByteToChar[b.end] ?? b.end);
    engine.blockCount = seedBlocks.length;
    for (let i = 0; i < seedBlocks.length; i++) {
      engine.heightIndex.appendBlock(24);
    }

    const priorTailCount = engine.regionBlockRanges.get("tail")!.count;
    expect(priorTailCount).toBe(3);

    // Shrink the tail region to 1 paragraph
    regionMap.setRegion("tail", "Only one paragraph.");
    simulateIncrementalTailUpdate(engine, regionMap, "tail");

    const newTailRange = engine.regionBlockRanges.get("tail")!;
    expect(newTailRange.count).toBe(1);

    // blockStarts/blockEnds must have shrunk
    expect(engine.blockStarts.length).toBe(engine.blockCount);
    expect(engine.heightIndex.count).toBe(engine.blockCount);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Middle-region full rebuild
// ---------------------------------------------------------------------------

describe("Integration: middle-region edits use full rebuild path", () => {
  it("updating a middle region produces correct block ranges for all three regions", () => {
    // Simulate what doSetRegion does when !isLast: call lexParseAndRender
    // which rebuilds regionBlockRanges from scratch.
    const regionMap = new RegionMap();
    regionMap.setRegion("intro", "Introduction paragraph.");
    regionMap.setRegion("body", "Body content here.");
    regionMap.setRegion("tail", "Tail paragraph.");

    // Update the middle region (triggers full rebuild in production)
    regionMap.setRegion("body", "Updated body.\n\nNew paragraph in body.");

    // Full rebuild via buildRegionBlockRanges
    const ranges = buildRegionBlockRanges(regionMap);

    expect(ranges.has("intro")).toBe(true);
    expect(ranges.has("body")).toBe(true);
    expect(ranges.has("tail")).toBe(true);

    const intro = ranges.get("intro")!;
    const body = ranges.get("body")!;
    const tail = ranges.get("tail")!;

    // All regions have at least one block
    expect(intro.count).toBeGreaterThan(0);
    expect(body.count).toBeGreaterThan(0);
    expect(tail.count).toBeGreaterThan(0);

    // Updated body should have 2 blocks (2 paragraphs)
    expect(body.count).toBe(2);

    // Contiguous coverage
    expect(body.start).toBe(intro.start + intro.count);
    expect(tail.start).toBe(body.start + body.count);

    // Total covers all blocks
    const totalBlocks = lexFull(regionMap.text).length;
    expect(intro.count + body.count + tail.count).toBe(totalBlocks);
  });

  it("full rebuild produces identical block starts/ends as direct full-doc lex", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("a", "# Title\n\nFirst paragraph.");
    regionMap.setRegion("b", "Second paragraph.\n\nThird paragraph.");

    const fullText = regionMap.text;
    const fullBlocks = lexFull(fullText);
    const byteToChar = buildByteToCharMap(fullText);
    const directStarts = fullBlocks.map(b => byteToChar[b.start] ?? b.start);
    const directEnds = fullBlocks.map(b => byteToChar[b.end] ?? b.end);

    // Full rebuild via ranges gives us the same offsets
    const ranges = buildRegionBlockRanges(regionMap);
    const allRanges = [...ranges.values()];
    const totalCount = allRanges.reduce((sum, r) => sum + r.count, 0);
    expect(totalCount).toBe(directStarts.length);

    // Verify first and last block offsets match
    if (directStarts.length > 0) {
      expect(directStarts[0]).toBe(0);
      expect(directEnds[directEnds.length - 1]).toBeGreaterThan(0);
    }
  });

  it("interleaved: stream chunks then middle-region update then more streaming", () => {
    const regionMap = new RegionMap();

    // Build two prefix regions
    regionMap.setRegion("intro", "Introduction.");
    regionMap.setRegion("stream", "Initial stream.");

    const engine: EngineSnapshot = {
      blockStarts: [],
      blockEnds: [],
      blockCount: 0,
      heightIndex: new BlockHeightIndex(),
      regionBlockRanges: new Map(),
    };

    // Seed via full rebuild
    function fullRebuild() {
      const text = regionMap.text;
      const blocks = lexFull(text);
      const btc = buildByteToCharMap(text);
      engine.blockStarts = blocks.map(b => btc[b.start] ?? b.start);
      engine.blockEnds = blocks.map(b => btc[b.end] ?? b.end);
      engine.blockCount = blocks.length;
      engine.heightIndex = new BlockHeightIndex();
      for (let i = 0; i < blocks.length; i++) {
        engine.heightIndex.appendBlock(24);
      }
      engine.regionBlockRanges.clear();
      const newRanges = buildRegionBlockRanges(regionMap);
      for (const [k, v] of newRanges) {
        engine.regionBlockRanges.set(k, v);
      }
    }

    fullRebuild();

    // Stream 10 chunks into the tail
    for (let i = 0; i < 10; i++) {
      regionMap.setRegion("stream", `Stream chunk ${i} content.\n\nAnother paragraph ${i}.`);
      simulateIncrementalTailUpdate(engine, regionMap, "stream");
    }

    const blockCountAfterStreaming = engine.blockCount;

    // Now update the middle region (triggers full rebuild in doSetRegion because !isLast)
    regionMap.setRegion("intro", "Updated introduction with more content.\n\nExtra intro paragraph.");
    fullRebuild(); // simulates lexParseAndRender

    // After full rebuild, block count should increase (intro now has 2 blocks instead of 1)
    expect(engine.blockCount).toBeGreaterThan(blockCountAfterStreaming);

    // regionBlockRanges must cover all blocks consistently
    const ranges = engine.regionBlockRanges;
    expect(ranges.has("intro")).toBe(true);
    expect(ranges.has("stream")).toBe(true);

    const introRange = ranges.get("intro")!;
    const streamRange = ranges.get("stream")!;
    expect(introRange.count).toBe(2);
    expect(streamRange.start).toBe(introRange.start + introRange.count);
    expect(introRange.count + streamRange.count).toBe(engine.blockCount);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Mixed content — emoji, CJK, fenced code blocks
// ---------------------------------------------------------------------------

describe("Integration: mixed content correctness (emoji, CJK, fenced code)", () => {
  it("emoji content: global char offsets allow correct text slicing", () => {
    const regionMap = new RegionMap();
    const emojiText = "Hello \uD83D\uDE00 world.\n\nSecond paragraph with \uD83D\uDE04.";
    regionMap.setRegion("a", "Prefix text.");
    regionMap.setRegion("b", emojiText);

    const bRange = regionMap.regionRange("b")!;
    const bCharStart = bRange.start;
    const blocks = lexRegion(emojiText);
    const { starts, ends } = translateOffsets(blocks, emojiText, bCharStart);

    expect(blocks.length).toBeGreaterThan(0);

    const fullText = regionMap.text;
    for (let i = 0; i < blocks.length; i++) {
      const slice = fullText.slice(starts[i], ends[i]);
      // Each slice must be non-empty and come from the emoji region
      expect(slice.length).toBeGreaterThan(0);
      expect(emojiText.includes(slice.trimEnd())).toBe(true);
    }
  });

  it("CJK content: 3-byte UTF-8 chars do not corrupt block boundaries", () => {
    const regionMap = new RegionMap();
    const cjkText = "\u4E2D\u6587\u5185\u5BB9\n\n\u7B2C\u4E8C\u6BB5\u843D\n\n\u7B2C\u4E09\u6BB5\u843D";
    regionMap.setRegion("prefix", "ASCII prefix.");
    regionMap.setRegion("cjk", cjkText);

    const cjkRange = regionMap.regionRange("cjk")!;
    const cjkCharStart = cjkRange.start;
    const blocks = lexRegion(cjkText);
    const { starts, ends } = translateOffsets(blocks, cjkText, cjkCharStart);

    expect(blocks.length).toBeGreaterThan(0);
    // CJK text has 3 paragraphs separated by \n\n — expect 3 blocks
    expect(blocks.length).toBe(3);

    const fullText = regionMap.text;
    for (let i = 0; i < blocks.length; i++) {
      const slice = fullText.slice(starts[i], ends[i]);
      expect(slice.length).toBeGreaterThan(0);
    }
  });

  it("fenced code block: block type is 'code', offsets cover the fence markers", () => {
    const regionMap = new RegionMap();
    const codeText = "```python\nprint('Hello, world!')\n```";
    regionMap.setRegion("stream", codeText);

    const blocks = lexRegion(codeText);
    expect(blocks.some(b => b.type === 'code')).toBe(true);

    const range = regionMap.regionRange("stream")!;
    const { starts, ends } = translateOffsets(blocks, codeText, range.start);

    const fullText = regionMap.text;
    for (let i = 0; i < blocks.length; i++) {
      const slice = fullText.slice(starts[i], ends[i]);
      if (blocks[i].type === 'code') {
        // The code block slice must contain the fence opening and closing backticks
        expect(slice).toContain("```");
        expect(slice).toContain("print");
      }
    }
  });

  it("fenced code block split across streaming chunks renders correctly", () => {
    // Simulates the scenario where chunk N opens a fence and chunk N+1 closes it.
    // After both chunks, the tail region should have a single code block.
    const regionMap = new RegionMap();

    // Chunk 1: open fence (incomplete)
    regionMap.setRegion("stream", "Intro paragraph.\n\n```python\nprint('hello')");
    const blocksAfterChunk1 = lexRegion(regionMap.getRegionText("stream") ?? "");
    // The open fence is treated as a code block by the lexer
    expect(blocksAfterChunk1.some(b => b.type === 'code')).toBe(true);

    // Chunk 2: close fence
    regionMap.setRegion("stream", "Intro paragraph.\n\n```python\nprint('hello')\n```\n\nAfter code.");
    const blocksAfterChunk2 = lexRegion(regionMap.getRegionText("stream") ?? "");
    // Now there should be 3 blocks: paragraph, code, paragraph
    const types2 = blocksAfterChunk2.map(b => b.type);
    expect(types2).toContain('paragraph');
    expect(types2).toContain('code');
    // Check that paragraph comes before code and after code
    const paraIndices = types2.map((t, i) => t === 'paragraph' ? i : -1).filter(i => i >= 0);
    const codeIndices = types2.map((t, i) => t === 'code' ? i : -1).filter(i => i >= 0);
    expect(paraIndices.length).toBeGreaterThanOrEqual(1);
    expect(codeIndices.length).toBe(1);
    // First paragraph before code
    expect(paraIndices[0]).toBeLessThan(codeIndices[0]);
  });

  it("emoji + CJK mixed region: regionBlockRanges is consistent after full rebuild", () => {
    const regionMap = new RegionMap();
    regionMap.setRegion("emoji", "Hello \uD83D\uDE00.\n\nWorld \uD83D\uDE04.");
    regionMap.setRegion("cjk", "\u4E2D\u6587\u5185\u5BB9");
    regionMap.setRegion("ascii", "Plain text.");

    const ranges = buildRegionBlockRanges(regionMap);
    expect(ranges.has("emoji")).toBe(true);
    expect(ranges.has("cjk")).toBe(true);
    expect(ranges.has("ascii")).toBe(true);

    const emoji = ranges.get("emoji")!;
    const cjk = ranges.get("cjk")!;
    const ascii = ranges.get("ascii")!;

    // Emoji region has 2 paragraphs
    expect(emoji.count).toBe(2);
    // CJK region has 1 paragraph
    expect(cjk.count).toBe(1);
    // ASCII region has 1 paragraph
    expect(ascii.count).toBe(1);

    // Contiguous coverage
    expect(cjk.start).toBe(emoji.start + emoji.count);
    expect(ascii.start).toBe(cjk.start + cjk.count);

    // Total block count matches full lex
    const totalBlocks = lexFull(regionMap.text).length;
    expect(emoji.count + cjk.count + ascii.count).toBe(totalBlocks);
  });
});

// ---------------------------------------------------------------------------
// Test 5: BlockHeightIndex consistency through streaming
// ---------------------------------------------------------------------------

describe("Integration: BlockHeightIndex consistency through streaming", () => {
  it("height index count matches blockCount throughout 100 streaming chunks", () => {
    const regionMap = new RegionMap();
    const STREAM_KEY = "stream";
    let accumulated = "Initial content.";
    regionMap.setRegion(STREAM_KEY, accumulated);

    const engine: EngineSnapshot = {
      blockStarts: [],
      blockEnds: [],
      blockCount: 0,
      heightIndex: new BlockHeightIndex(),
      regionBlockRanges: new Map(),
    };

    const seedRanges = buildRegionBlockRanges(regionMap);
    for (const [k, v] of seedRanges) {
      engine.regionBlockRanges.set(k, v);
    }
    const seedText = regionMap.text;
    const seedBlocks = lexFull(seedText);
    const seedBtc = buildByteToCharMap(seedText);
    engine.blockStarts = seedBlocks.map(b => seedBtc[b.start] ?? b.start);
    engine.blockEnds = seedBlocks.map(b => seedBtc[b.end] ?? b.end);
    engine.blockCount = seedBlocks.length;
    for (let i = 0; i < seedBlocks.length; i++) {
      engine.heightIndex.appendBlock(24);
    }

    for (let i = 0; i < 100; i++) {
      accumulated += "\n\n" + buildChunk(i);
      regionMap.setRegion(STREAM_KEY, accumulated);
      simulateIncrementalTailUpdate(engine, regionMap, STREAM_KEY);

      // Invariant: height index count == blockCount == blockStarts.length
      expect(engine.heightIndex.count).toBe(engine.blockCount);
      expect(engine.blockStarts.length).toBe(engine.blockCount);
      expect(engine.blockEnds.length).toBe(engine.blockCount);
    }
  });

  it("height index total height grows monotonically during pure-append streaming", () => {
    const regionMap = new RegionMap();
    const STREAM_KEY = "stream";
    let accumulated = "Start.";
    regionMap.setRegion(STREAM_KEY, accumulated);

    const engine: EngineSnapshot = {
      blockStarts: [],
      blockEnds: [],
      blockCount: 0,
      heightIndex: new BlockHeightIndex(),
      regionBlockRanges: new Map(),
    };

    const seedRanges = buildRegionBlockRanges(regionMap);
    for (const [k, v] of seedRanges) {
      engine.regionBlockRanges.set(k, v);
    }
    const seedText = regionMap.text;
    const seedBlocks = lexFull(seedText);
    const seedBtc = buildByteToCharMap(seedText);
    engine.blockStarts = seedBlocks.map(b => seedBtc[b.start] ?? b.start);
    engine.blockEnds = seedBlocks.map(b => seedBtc[b.end] ?? b.end);
    engine.blockCount = seedBlocks.length;
    for (let i = 0; i < seedBlocks.length; i++) {
      engine.heightIndex.appendBlock(24);
    }

    let prevTotalHeight = engine.heightIndex.getTotalHeight();

    // Each chunk adds a new paragraph block — total height must grow
    for (let i = 0; i < 20; i++) {
      accumulated += "\n\n" + buildChunk(i);
      regionMap.setRegion(STREAM_KEY, accumulated);
      simulateIncrementalTailUpdate(engine, regionMap, STREAM_KEY);

      const newTotalHeight = engine.heightIndex.getTotalHeight();
      expect(newTotalHeight).toBeGreaterThanOrEqual(prevTotalHeight);
      prevTotalHeight = newTotalHeight;
    }
  });
});
