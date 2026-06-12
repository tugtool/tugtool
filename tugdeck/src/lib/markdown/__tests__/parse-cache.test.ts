/**
 * Render-once parse-cache tests.
 *
 * Pure-logic coverage of the cache contract: text-validated lookups,
 * scope isolation, explicit invalidation (by identity and by turn
 * prefix), session-scope clear, and the parse-economy counter
 * integration. The golden equivalence leg (cached blocks ≡ direct
 * parse output) runs against the real WASM parser, mirroring the
 * init pattern of the parse tests.
 *
 * The live-append scenario pins the [P04] economics: a transcript of
 * finalized rows re-rendering alongside one streaming tail pays
 * parses only for the tail — every finalized row is a cache hit.
 */

import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { initSync } from "../../../../crates/tugmark-wasm/pkg/tugmark_wasm.js";

import {
  cachedParseCount,
  clearCachedParses,
  getCachedParse,
  invalidateCachedParse,
  invalidateCachedParsesByPrefix,
  putCachedParse,
} from "../parse-cache";
import {
  resetRowParseCounters,
  snapshotRowParseCounters,
} from "../parse-counters";
import { parseMarkdownToSanitizedBlocks } from "../parse-markdown-to-sanitized-blocks";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPath = join(
  __dir,
  "../../../../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm",
);

beforeAll(() => {
  initSync({ module: readFileSync(wasmPath) });
});

afterEach(() => {
  resetRowParseCounters();
});

const ID = (turn: string, msg: string) => `turn.${turn}.message.${msg}.text`;

describe("parse-cache — contract", () => {
  test("miss on empty scope; hit returns the exact stored blocks", () => {
    const scope = {};
    expect(getCachedParse(scope, ID("a", "m1"), "hello")).toBeNull();

    const blocks = parseMarkdownToSanitizedBlocks("hello **world**");
    putCachedParse(scope, ID("a", "m1"), "hello **world**", blocks);

    const hit = getCachedParse(scope, ID("a", "m1"), "hello **world**");
    expect(hit).toBe(blocks);
  });

  test("text validity: a changed text misses (streaming rows self-invalidate)", () => {
    const scope = {};
    const blocks = parseMarkdownToSanitizedBlocks("partial");
    putCachedParse(scope, ID("a", "m1"), "partial", blocks);

    expect(getCachedParse(scope, ID("a", "m1"), "partial more")).toBeNull();
    // The original text still hits — validity is per-lookup, not a
    // destructive check.
    expect(getCachedParse(scope, ID("a", "m1"), "partial")).toBe(blocks);
  });

  test("scopes are isolated", () => {
    const scopeA = {};
    const scopeB = {};
    const blocks = parseMarkdownToSanitizedBlocks("scoped");
    putCachedParse(scopeA, ID("a", "m1"), "scoped", blocks);

    expect(getCachedParse(scopeB, ID("a", "m1"), "scoped")).toBeNull();
  });

  test("invalidation drops exactly the named identity", () => {
    const scope = {};
    const b1 = parseMarkdownToSanitizedBlocks("one");
    const b2 = parseMarkdownToSanitizedBlocks("two");
    putCachedParse(scope, ID("a", "m1"), "one", b1);
    putCachedParse(scope, ID("a", "m2"), "two", b2);

    invalidateCachedParse(scope, ID("a", "m1"));
    expect(getCachedParse(scope, ID("a", "m1"), "one")).toBeNull();
    expect(getCachedParse(scope, ID("a", "m2"), "two")).toBe(b2);
  });

  test("prefix invalidation drops a whole turn, leaves siblings", () => {
    const scope = {};
    const b1 = parseMarkdownToSanitizedBlocks("one");
    const b2 = parseMarkdownToSanitizedBlocks("two");
    const b3 = parseMarkdownToSanitizedBlocks("three");
    putCachedParse(scope, ID("gone", "m1"), "one", b1);
    putCachedParse(scope, ID("gone", "m2"), "two", b2);
    putCachedParse(scope, ID("kept", "m1"), "three", b3);

    invalidateCachedParsesByPrefix(scope, "turn.gone.");
    expect(cachedParseCount(scope)).toBe(1);
    expect(getCachedParse(scope, ID("kept", "m1"), "three")).toBe(b3);
  });

  test("clear drops the whole scope", () => {
    const scope = {};
    putCachedParse(scope, ID("a", "m1"), "x", parseMarkdownToSanitizedBlocks("x"));
    clearCachedParses(scope);
    expect(cachedParseCount(scope)).toBe(0);
    expect(getCachedParse(scope, ID("a", "m1"), "x")).toBeNull();
  });

  test("hits increment the cacheHits counter; misses do not", () => {
    const scope = {};
    const blocks = parseMarkdownToSanitizedBlocks("counted");
    putCachedParse(scope, ID("a", "m1"), "counted", blocks);

    getCachedParse(scope, ID("a", "m1"), "counted");
    getCachedParse(scope, ID("a", "m1"), "counted");
    getCachedParse(scope, ID("a", "m1"), "stale-text");

    const snap = snapshotRowParseCounters();
    expect(snap.cacheHits).toBe(2);
  });
});

describe("parse-cache — golden equivalence", () => {
  test("cached blocks are the direct parse's blocks; re-parse is deep-equal", () => {
    const scope = {};
    const text = "# Title\n\nBody with **bold**.\n\n```ts\nconst x = 1;\n```\n";
    const parsed = parseMarkdownToSanitizedBlocks(text);
    putCachedParse(scope, ID("a", "m1"), text, parsed);

    // The cache serves the SAME array the parse produced — the shared
    // DOM-apply path (`renderIncrementalFromBlocks`) therefore cannot
    // diverge between cached and uncached renders.
    expect(getCachedParse(scope, ID("a", "m1"), text)).toBe(parsed);

    // And the parse itself is deterministic: a fresh parse of the same
    // text yields deep-equal blocks (html, type, contentHash).
    const reparsed = parseMarkdownToSanitizedBlocks(text);
    expect(reparsed.length).toBe(parsed.length);
    for (let i = 0; i < parsed.length; i++) {
      expect(reparsed[i].html).toBe(parsed[i].html);
      expect(reparsed[i].type).toBe(parsed[i].type);
      expect(reparsed[i].contentHash).toBe(parsed[i].contentHash);
    }
  });
});

describe("parse-cache — live-append economics ([P04])", () => {
  test("a 200-row transcript re-render parses only the streaming tail", () => {
    const scope = {};
    // 200 finalized rows, parsed once each (the replay / commit pass).
    const texts: string[] = [];
    for (let n = 0; n < 200; n++) {
      const text = `finalized row ${n} with some **content**`;
      texts.push(text);
      putCachedParse(scope, ID(`t${n}`, "m1"), text, parseMarkdownToSanitizedBlocks(text));
    }
    resetRowParseCounters();

    // A live delta re-render pass: every finalized row looks up its
    // (unchanged) text — all hits; the streaming tail's text changed —
    // one miss, one fresh parse.
    let parses = 0;
    for (let n = 0; n < 200; n++) {
      const hit = getCachedParse(scope, ID(`t${n}`, "m1"), texts[n]);
      expect(hit).not.toBeNull();
    }
    const tailText = "streaming tail, new delta";
    if (getCachedParse(scope, ID("tail", "m1"), tailText) === null) {
      parses += 1;
      putCachedParse(scope, ID("tail", "m1"), tailText, parseMarkdownToSanitizedBlocks(tailText));
    }

    const snap = snapshotRowParseCounters();
    expect(snap.cacheHits).toBe(200);
    expect(parses).toBe(1);
  });
});
