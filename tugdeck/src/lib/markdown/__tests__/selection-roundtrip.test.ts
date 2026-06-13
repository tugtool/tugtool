/**
 * Round-trip tests for COPY's markdown reconstruction (Risk R02): a
 * stitched per-block selection must re-parse to the same block
 * structure it was sliced from. This exercises the pure slice + stitch
 * arithmetic composed with the real WASM parser — the DOM walk that
 * feeds it source spans is covered by the `range-to-blocks` app-test
 * ([Q02] pure/DOM split), not here.
 */

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "bun:test";

import { initSync } from "../../../../crates/tugmark-wasm/pkg/tugmark_wasm.js";

import { parseMarkdownToSanitizedBlocks } from "../parse-markdown-to-sanitized-blocks";
import {
  sliceBlockRange,
  type SourceSpan,
  stitchSelectionMarkdown,
} from "../selection-to-markdown";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(
  __dir,
  "../../../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm",
);

beforeAll(() => {
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
});

/** Source spans of the blocks at `indexes`, as the DOM walk would yield them. */
function spansFor(source: string, indexes: number[]): SourceSpan[] {
  const blocks = parseMarkdownToSanitizedBlocks(source);
  return indexes.map((i) => ({
    start: blocks[i].startChar,
    end: blocks[i].endChar,
  }));
}

/** Block-type sequence of a parsed source. */
function typesOf(source: string): string[] {
  return parseMarkdownToSanitizedBlocks(source).map((b) => b.type);
}

const CORPUS = [
  "# Title",
  "",
  "A paragraph with `inline code` in it.",
  "",
  "- first",
  "- second",
  "- third",
  "",
  "```ts",
  "const x = 1;",
  "// a ``` lookalike inside",
  "```",
  "",
  "Closing paragraph.",
].join("\n");

describe("selection round-trip — block-level slice re-parses identically", () => {
  test("a single paragraph (with inline code) round-trips", () => {
    const slice = sliceBlockRange(CORPUS, spansFor(CORPUS, [1]));
    expect(slice).toContain("`inline code`");
    expect(typesOf(slice)).toEqual(["paragraph"]);
  });

  test("a list block round-trips as one list", () => {
    const slice = sliceBlockRange(CORPUS, spansFor(CORPUS, [2]));
    expect(typesOf(slice)).toEqual(["list"]);
  });

  test("a fenced code block round-trips verbatim (inner fence preserved)", () => {
    const slice = sliceBlockRange(CORPUS, spansFor(CORPUS, [3]));
    expect(slice).toContain("const x = 1;");
    expect(slice).toContain("// a ``` lookalike inside");
    expect(typesOf(slice)).toEqual(["code"]);
  });

  test("a contiguous run (heading→paragraph→list) re-parses to that run", () => {
    const slice = sliceBlockRange(CORPUS, spansFor(CORPUS, [0, 1, 2]));
    expect(typesOf(slice)).toEqual(["heading", "paragraph", "list"]);
  });

  test("the whole document round-trips to its full block structure", () => {
    const all = parseMarkdownToSanitizedBlocks(CORPUS).map((_, i) => i);
    const slice = sliceBlockRange(CORPUS, spansFor(CORPUS, all));
    expect(typesOf(slice)).toEqual(typesOf(CORPUS));
  });
});

describe("selection round-trip — prose→tool→prose stitch", () => {
  test("stitched tool section + prose re-parses with tool + Response headings", () => {
    const proseA = sliceBlockRange(CORPUS, spansFor(CORPUS, [1]));
    const proseB = sliceBlockRange(CORPUS, spansFor(CORPUS, [2]));
    const toolSection = ["## Tool: Bash", "", "Output:", "```", "ok", "```"].join(
      "\n",
    );

    const stitched = stitchSelectionMarkdown([toolSection], [proseA, proseB]);
    const blocks = parseMarkdownToSanitizedBlocks(stitched);
    const headings = blocks
      .filter((b) => b.type === "heading")
      .map((b) => b.html);

    // Tool section heading + the single `## Response` body delimiter.
    expect(headings.some((h) => /Tool: Bash/.test(h))).toBe(true);
    expect(headings.some((h) => /Response/.test(h))).toBe(true);
    // The tool output's fenced block survives as a code block.
    expect(blocks.some((b) => b.type === "code")).toBe(true);
    // Both prose chunks are present, in order.
    const idxA = stitched.indexOf("inline code");
    const idxB = stitched.indexOf("first");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
  });

  test("prose-only stitch carries no Response heading", () => {
    const proseA = sliceBlockRange(CORPUS, spansFor(CORPUS, [1]));
    const stitched = stitchSelectionMarkdown([], [proseA]);
    expect(stitched).not.toContain("## Response");
    expect(typesOf(stitched)).toEqual(["paragraph"]);
  });
});
