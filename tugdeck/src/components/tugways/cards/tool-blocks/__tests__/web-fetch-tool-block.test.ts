/**
 * Pure-logic tests for `WebFetchToolBlock`'s wire-narrowing helpers
 * and cache-hit detection, plus the dispatch routing check.
 *
 * The wrapper itself is decoration over composition (`ToolBlockChrome`
 * + `TugMarkdownBlock` / `MiddleEllipsisPath`) — its behaviour *is*
 * the exported pure helpers:
 *
 *  - `narrowWebFetchInput` — defensive narrowing of the wire `input`.
 *  - `detectCacheHit` / `stripCacheHitPrefix` — header `cached` chip
 *    and body prefix stripping.
 *  - The dispatch routes `WebFetch` (any casing) to the real
 *    `WebFetchToolBlock` (via `BESPOKE_FACTORY_BY_NAME`).
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  WebFetchToolBlock,
  detectCacheHit,
  narrowWebFetchInput,
  stripCacheHitPrefix,
} from "../web-fetch-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../dev-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowWebFetchInput
// ---------------------------------------------------------------------------

describe("narrowWebFetchInput", () => {
  test("keeps the wire fields when well-typed", () => {
    expect(
      narrowWebFetchInput({
        url: "https://anthropic.com",
        prompt: "Summarize the homepage",
      }),
    ).toEqual({
      url: "https://anthropic.com",
      prompt: "Summarize the homepage",
    });
  });

  test("drops mistyped fields and tolerates non-objects", () => {
    expect(narrowWebFetchInput({ url: 42, prompt: ["bad"] })).toEqual({
      url: undefined,
      prompt: undefined,
    });
    expect(narrowWebFetchInput(null)).toEqual({});
    expect(narrowWebFetchInput("nope")).toEqual({});
    expect(narrowWebFetchInput(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// detectCacheHit / stripCacheHitPrefix
// ---------------------------------------------------------------------------

describe("detectCacheHit", () => {
  test("returns true when the result begins with the cache prefix", () => {
    expect(detectCacheHit("[Cached] Anthropic is …")).toBe(true);
    expect(detectCacheHit("   [Cached] still cached")).toBe(true);
  });

  test("returns false for a fresh result", () => {
    expect(detectCacheHit("Anthropic is …")).toBe(false);
    expect(detectCacheHit("[Note] not the cache prefix")).toBe(false);
  });

  test("returns false when undefined or empty", () => {
    expect(detectCacheHit(undefined)).toBe(false);
    expect(detectCacheHit("")).toBe(false);
  });
});

describe("stripCacheHitPrefix", () => {
  test("strips the prefix and surrounding whitespace from a cached result", () => {
    expect(stripCacheHitPrefix("[Cached] result body")).toBe("result body");
    expect(stripCacheHitPrefix("  [Cached]   indented result")).toBe(
      "indented result",
    );
  });

  test("returns the input unchanged when no prefix is present", () => {
    expect(stripCacheHitPrefix("fresh result body")).toBe("fresh result body");
  });

  test("collapses undefined to empty string", () => {
    expect(stripCacheHitPrefix(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Dispatch routing — WebFetch → WebFetchToolBlock
// ---------------------------------------------------------------------------

describe("WebFetch dispatch routing", () => {
  test("BESPOKE_FACTORY_BY_NAME maps webfetch to WebFetchToolBlock", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("webfetch")).toBe(WebFetchToolBlock);
  });
});
