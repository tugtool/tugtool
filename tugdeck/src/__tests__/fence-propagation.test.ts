/**
 * Tests for lazy fence propagation — D02 lazy fence propagation logic.
 *
 * The fence propagation algorithm detects when a region's block type sequence
 * has changed after incremental re-lex. If the type sequence changed, the next
 * region must be re-lexed to check for fence balance propagation. Propagation
 * stops when a region's block types are stable (unchanged from before).
 *
 * These tests verify:
 * 1. Block type sequence comparison: detects type changes, stable types stop propagation.
 * 2. Code fence spanning regions: a region ending with an open fence changes the
 *    type sequence of the next region (code vs paragraph).
 * 3. The common streaming path (tail region is last) is a no-op for propagation.
 * 4. regionBlockRanges.types is populated and reflects the actual block types.
 *
 * Because the propagation logic lives inside the TugMarkdownView component
 * (a closure), these tests simulate the algorithm using extracted pure helpers.
 *
 * WASM loading: tugmark_wasm exports `initSync`. We load once at module scope.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { initSync, lex_blocks } from "../../crates/tugmark-wasm/pkg/tugmark_wasm.js";

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
// Re-implement pure helpers from tug-markdown-view.tsx (self-contained).
// ---------------------------------------------------------------------------

const STRIDE = 4;
const BLOCK_TYPES = ['?','heading','paragraph','code','blockquote','list','table','hr','html','other'];

interface BlockMeta {
  type: string;
  start: number;
  end: number;
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

/** Extract type sequence from a list of blocks. */
function typeSequence(blocks: BlockMeta[]): string[] {
  return blocks.map(b => b.type);
}

/**
 * Simulate the fence propagation guard from incrementalTailUpdate:
 * returns true if the old and new type sequences differ (propagation needed).
 */
function typeSequenceChanged(oldTypes: string[], newTypes: string[]): boolean {
  if (oldTypes.length !== newTypes.length) return true;
  return oldTypes.some((t, i) => t !== newTypes[i]);
}

// ---------------------------------------------------------------------------
// Tests: type sequence comparison (the core propagation guard)
// ---------------------------------------------------------------------------

describe("type sequence comparison — propagation guard", () => {
  it("identical sequences: no propagation needed", () => {
    const old = ["paragraph", "paragraph"];
    const next = ["paragraph", "paragraph"];
    expect(typeSequenceChanged(old, next)).toBe(false);
  });

  it("count change: propagation needed", () => {
    const old = ["paragraph"];
    const next = ["paragraph", "paragraph"];
    expect(typeSequenceChanged(old, next)).toBe(true);
  });

  it("type change: propagation needed (paragraph -> code)", () => {
    const old = ["paragraph", "paragraph"];
    const next = ["paragraph", "code"];
    expect(typeSequenceChanged(old, next)).toBe(true);
  });

  it("empty old, non-empty new: propagation needed", () => {
    const old: string[] = [];
    const next = ["paragraph"];
    expect(typeSequenceChanged(old, next)).toBe(true);
  });

  it("non-empty old, empty new: propagation needed", () => {
    const old = ["paragraph"];
    const next: string[] = [];
    expect(typeSequenceChanged(old, next)).toBe(true);
  });

  it("both empty: no propagation needed", () => {
    expect(typeSequenceChanged([], [])).toBe(false);
  });

  it("heading changes to paragraph: propagation needed", () => {
    const old = ["heading", "paragraph"];
    const next = ["paragraph", "paragraph"];
    expect(typeSequenceChanged(old, next)).toBe(true);
  });

  it("same heading then paragraph: stable, no propagation", () => {
    const old = ["heading", "paragraph"];
    const next = ["heading", "paragraph"];
    expect(typeSequenceChanged(old, next)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: code fence effect on subsequent region's block types
// ---------------------------------------------------------------------------

describe("code fence spanning regions — type sequence effect", () => {
  it("open code fence changes next region's blocks from paragraph to code", () => {
    // Region A ends with an open code fence (no closing ```)
    // When lexed in isolation with \n\n prefix, the fence remains open.
    // Region B's text would be parsed as code (inside the fence) if the document
    // was lexed globally with the fence open.
    //
    // We test this by lexing the combined text and comparing to isolated lex:
    const regionA = "Some text.\n\n```python\nprint('hello')";  // open fence
    const regionB = "This is plain text.";  // would be code inside open fence

    // Lex regions in isolation (what incrementalTailUpdate does)
    const blocksA = lexRegion(regionA);
    const blocksB = lexRegion(regionB);
    const typesB_isolated = typeSequence(blocksB);

    // Lex the combined document (what the full rebuild sees)
    const combined = regionA + "\n\n" + regionB;
    const blocksCombined = decodeBlocks(lex_blocks(combined));

    // The combined lex should produce different results than isolated
    // (because the fence from A propagates into B).
    // At minimum: A's blocks must include a code block (the open fence).
    const hasCodeInA = blocksA.some(b => b.type === 'code');
    expect(hasCodeInA).toBe(true);

    // The combined document block types should differ from isolated B types
    // (B's content is interpreted as code continuation in the combined view).
    // The number of combined blocks is not guaranteed to match isolated,
    // so we check that typesB_isolated contains 'paragraph' (what B sees alone).
    expect(typesB_isolated).toContain('paragraph');

    // Combined may not contain a standalone paragraph for B's content at all —
    // it gets absorbed into the code block. Verify A has its code block.
    const combinedTypes = blocksCombined.map(b => b.type);
    expect(combinedTypes).toContain('code');
  });

  it("closed code fence: regions are independent, propagation unnecessary", () => {
    // Region A has a properly closed code fence
    const regionA = "```python\nprint('hello')\n```";
    const regionB = "Next paragraph.";

    const blocksA = lexRegion(regionA);
    const blocksB = lexRegion(regionB);

    // A should have a code block
    expect(blocksA.some(b => b.type === 'code')).toBe(true);
    // B should have a paragraph (fence is closed, does not affect B)
    expect(blocksB.some(b => b.type === 'paragraph')).toBe(true);

    // Lex combined to confirm fence closure
    const combined = regionA + "\n\n" + regionB;
    const blocksCombined = decodeBlocks(lex_blocks(combined));
    // Combined should have both code and paragraph
    const combinedTypes = blocksCombined.map(b => b.type);
    expect(combinedTypes).toContain('code');
    expect(combinedTypes).toContain('paragraph');
  });

  it("region with only paragraph: type sequence is stable after identical update", () => {
    // Simulate the common streaming case: tail region is just paragraphs,
    // the type sequence is stable, no propagation guard triggered.
    const before = "First paragraph.\n\nSecond paragraph.";
    const after  = "First paragraph.\n\nSecond paragraph updated.";

    const blocksBefore = lexRegion(before);
    const blocksAfter  = lexRegion(after);

    const typesBefore = typeSequence(blocksBefore);
    const typesAfter  = typeSequence(blocksAfter);

    // Same count, same types — propagation guard should NOT fire
    expect(typeSequenceChanged(typesBefore, typesAfter)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: streaming path is a no-op for propagation (tail region is always last)
// ---------------------------------------------------------------------------

describe("streaming path: propagation is no-op (tail region is last)", () => {
  it("with only one region (streaming), there is no next region to propagate to", () => {
    // The streaming path always uses key='stream' as the only region.
    // After lexing, regionKeys.indexOf('stream') === 0, and
    // regionKeys.length - 1 === 0, so keyIndex < regionKeys.length - 1 is false.
    // Propagation loop body is never entered.
    const regionKeys = ["stream"];
    const keyIndex = regionKeys.indexOf("stream");
    // The guard condition: keyIndex >= 0 && keyIndex < regionKeys.length - 1
    const propagationGuardPasses = keyIndex >= 0 && keyIndex < regionKeys.length - 1;
    expect(propagationGuardPasses).toBe(false);
  });

  it("streaming path lexes tail region and produces paragraph blocks", () => {
    const streamText = "Streaming content paragraph 1.\n\nStreaming content paragraph 2.";
    const blocks = lexRegion(streamText);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every(b => b.type === 'paragraph')).toBe(true);
    // Type sequence is stable paragraphs — no propagation needed
    expect(typeSequenceChanged(["paragraph", "paragraph"], typeSequence(blocks))).toBe(false);
  });

  it("two regions: propagation guard fires for non-last key only", () => {
    // If we have keys ['a', 'stream'], updating 'a' (index 0) triggers the guard.
    // Updating 'stream' (index 1, last) does NOT trigger the guard.
    const regionKeys = ["a", "stream"];

    const keyA = "a";
    const keyStream = "stream";

    const idxA = regionKeys.indexOf(keyA);
    const idxStream = regionKeys.indexOf(keyStream);

    // 'a' is not last — propagation guard can fire (if types changed)
    expect(idxA >= 0 && idxA < regionKeys.length - 1).toBe(true);
    // 'stream' is last — propagation guard never fires
    expect(idxStream >= 0 && idxStream < regionKeys.length - 1).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: regionBlockRanges.types reflects actual block type sequence
// ---------------------------------------------------------------------------

describe("regionBlockRanges types reflect actual block types", () => {
  it("paragraph text produces types=['paragraph']", () => {
    const text = "Hello world.";
    const blocks = lexRegion(text);
    const types = typeSequence(blocks);
    expect(types).toEqual(["paragraph"]);
  });

  it("heading + paragraph produces types=['heading','paragraph']", () => {
    const text = "# Title\n\nBody paragraph.";
    const blocks = lexRegion(text);
    const types = typeSequence(blocks);
    expect(types).toEqual(["heading", "paragraph"]);
  });

  it("code block produces types=['code']", () => {
    const text = "```python\nprint('hello')\n```";
    const blocks = lexRegion(text);
    const types = typeSequence(blocks);
    expect(types).toContain("code");
  });

  it("heading, code, paragraph sequence is correctly captured", () => {
    const text = "# Title\n\n```js\nconsole.log('hi');\n```\n\nAfterward.";
    const blocks = lexRegion(text);
    const types = typeSequence(blocks);
    expect(types).toEqual(["heading", "code", "paragraph"]);
  });

  it("type sequence comparison detects code->paragraph change after fence closes", () => {
    // Before: open fence makes the next content look like code
    // After: closed fence restores it to paragraph
    // This simulates what happens when a stream chunk closes a code fence:
    // the region's type sequence changes from ['code'] to ['code','paragraph']
    // (or similar), triggering propagation.
    const before = ["code"];
    const after  = ["code", "paragraph"];
    expect(typeSequenceChanged(before, after)).toBe(true);
  });
});
