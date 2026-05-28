/**
 * Pure-logic tests for `WebSearchToolBlock`'s wire-narrowing helpers,
 * markdown result parsing, and dispatch routing.
 *
 * The wrapper itself is decoration over composition (`ToolBlockChrome`
 * + per-result `TugLink` rows + a `TugMarkdownBlock` fallback) — its
 * behaviour *is* the exported pure helpers:
 *
 *  - `narrowWebSearchInput` — defensive narrowing of the wire `input`.
 *  - `parseSearchResults` — markdown text → per-result entries.
 *  - `composeResultCountLabel` — header `{N} results` badge text.
 *  - The dispatch routes `WebSearch` (any casing) to the real
 *    `WebSearchToolBlock` (via `BESPOKE_FACTORY_BY_NAME`).
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  WebSearchToolBlock,
  composeResultCountLabel,
  narrowWebSearchInput,
  parseSearchResults,
} from "../web-search-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../dev-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowWebSearchInput
// ---------------------------------------------------------------------------

describe("narrowWebSearchInput", () => {
  test("keeps the wire fields when well-typed", () => {
    expect(
      narrowWebSearchInput({
        query: "react 19 release notes",
        allowed_domains: ["react.dev"],
        blocked_domains: ["spam.example"],
      }),
    ).toEqual({
      query: "react 19 release notes",
      allowed_domains: ["react.dev"],
      blocked_domains: ["spam.example"],
    });
  });

  test("drops empty / mistyped entries from the domain arrays", () => {
    expect(
      narrowWebSearchInput({
        query: "x",
        allowed_domains: ["ok.dev", "", 42, null],
        blocked_domains: [],
      }),
    ).toEqual({
      query: "x",
      allowed_domains: ["ok.dev"],
      // Empty-after-filtering arrays collapse to undefined so the
      // body doesn't render an empty `blocked_domains:` row.
      blocked_domains: undefined,
    });
  });

  test("tolerates non-objects", () => {
    expect(narrowWebSearchInput(null)).toEqual({});
    expect(narrowWebSearchInput("nope")).toEqual({});
    expect(narrowWebSearchInput(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// parseSearchResults
// ---------------------------------------------------------------------------

describe("parseSearchResults", () => {
  test("parses the dominant `- [Title](url) — snippet` per-line shape", () => {
    const text = [
      "- [React 19 Release](https://react.dev/blog/2024/04/25/react-19) — Notes on actions, server components, and more.",
      "- [What's new in React 19](https://example.com/react-19) — Quick summary of the new features.",
    ].join("\n");
    expect(parseSearchResults(text)).toEqual([
      {
        title: "React 19 Release",
        url: "https://react.dev/blog/2024/04/25/react-19",
        snippet: "Notes on actions, server components, and more.",
      },
      {
        title: "What's new in React 19",
        url: "https://example.com/react-19",
        snippet: "Quick summary of the new features.",
      },
    ]);
  });

  test("parses numbered lists with snippets on following lines", () => {
    const text = [
      "1. [React Conf 2024](https://react.dev/conf)",
      "   Talks from the conference, including React 19.",
      "2. [Release Notes](https://github.com/facebook/react/releases)",
      "   GitHub release page.",
    ].join("\n");
    expect(parseSearchResults(text)).toEqual([
      {
        title: "React Conf 2024",
        url: "https://react.dev/conf",
        snippet: "Talks from the conference, including React 19.",
      },
      {
        title: "Release Notes",
        url: "https://github.com/facebook/react/releases",
        snippet: "GitHub release page.",
      },
    ]);
  });

  test("returns empty when no markdown link matches", () => {
    expect(parseSearchResults("No results found.")).toEqual([]);
    expect(parseSearchResults("")).toEqual([]);
    expect(parseSearchResults(undefined)).toEqual([]);
  });

  test("drops continuation lines that look like sibling list items", () => {
    // A sibling list item with no recognised link should NOT bleed
    // into the previous entry's snippet — it would corrupt the
    // reading. The parser leaves it on the cutting-room floor.
    const text = [
      "- [Real](https://r.example) — first snippet.",
      "- malformed sibling without a link",
    ].join("\n");
    expect(parseSearchResults(text)).toEqual([
      {
        title: "Real",
        url: "https://r.example",
        snippet: "first snippet.",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// composeResultCountLabel
// ---------------------------------------------------------------------------

describe("composeResultCountLabel", () => {
  test("pluralizes", () => {
    expect(composeResultCountLabel(0)).toBeUndefined();
    expect(composeResultCountLabel(1)).toBe("1 result");
    expect(composeResultCountLabel(12)).toBe("12 results");
    expect(composeResultCountLabel(1000)).toBe("1,000 results");
  });
});

// ---------------------------------------------------------------------------
// Dispatch routing — WebSearch → WebSearchToolBlock
// ---------------------------------------------------------------------------

describe("WebSearch dispatch routing", () => {
  test("BESPOKE_FACTORY_BY_NAME maps websearch to WebSearchToolBlock", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("websearch")).toBe(WebSearchToolBlock);
  });
});
