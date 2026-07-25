/**
 * filter-highlight.test.tsx — pure coverage for the two filter-mark renderers.
 *
 * No render, no DOM: each helper returns either a bare string or a fragment of
 * string / `<mark>` fragments, and the tests read that element tree as data.
 * What matters is the contract every filtered list depends on — an unfiltered
 * row renders the identical string, a matched row splits at exact offsets, and
 * the segments always reassemble into the original text.
 *
 * `renderFilterHighlightSpans` carries the harder contract: text that ALREADY
 * carries styling (a syntax-highlighted commit body) must keep every tone AND
 * gain the marks, including for a match that straddles two runs.
 */

import { describe, expect, test } from "bun:test";
import React from "react";

import {
  renderFilterHighlight,
  renderFilterHighlightSpans,
  type FilterHighlightSpan,
} from "../filter-highlight";

/** The fragment's children as a flat array. */
function segments(node: React.ReactNode): React.ReactNode[] {
  const element = node as React.ReactElement<{ children: React.ReactNode[] }>;
  return element.props.children;
}

/** Every segment flattened back to text — must equal the input string. */
function flatten(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  return segments(node)
    .map((part) =>
      typeof part === "string"
        ? part
        : ((part as React.ReactElement<{ children: string }>).props.children),
    )
    .join("");
}

/** The text of each `<mark>` segment, in order. */
function marks(node: React.ReactNode): string[] {
  if (typeof node === "string") return [];
  return segments(node)
    .filter((part) => typeof part !== "string")
    .map((part) => (part as React.ReactElement<{ children: string }>).props.children);
}

describe("renderFilterHighlight", () => {
  test("an empty query returns the identical string, not a fragment", () => {
    const text = "session-ledger-store";
    expect(renderFilterHighlight(text, "")).toBe(text);
    expect(renderFilterHighlight(text, "   ")).toBe(text);
  });

  test("a query that matches nothing in this string returns the string", () => {
    const text = "session-ledger-store";
    expect(renderFilterHighlight(text, "nope")).toBe(text);
  });

  test("a match splits into leading text, the mark, and trailing text", () => {
    const node = renderFilterHighlight("session-ledger-store", "ledger");
    expect(segments(node)).toHaveLength(3);
    expect(marks(node)).toEqual(["ledger"]);
    expect(flatten(node)).toBe("session-ledger-store");
  });

  test("a match at the head emits no empty leading segment", () => {
    const node = renderFilterHighlight("session-ledger", "session");
    expect(segments(node)).toHaveLength(2);
    expect(marks(node)).toEqual(["session"]);
  });

  test("a match at the tail emits no empty trailing segment", () => {
    const node = renderFilterHighlight("session-ledger", "ledger");
    expect(segments(node)).toHaveLength(2);
    expect(marks(node)).toEqual(["ledger"]);
  });

  test("two terms paint two marks in document order", () => {
    const node = renderFilterHighlight("session-ledger-store", "store session");
    expect(marks(node)).toEqual(["session", "store"]);
    expect(flatten(node)).toBe("session-ledger-store");
  });

  test("merged ranges paint one mark, never two abutting", () => {
    const node = renderFilterHighlight("session-ledger-store", "session -ledger");
    expect(marks(node)).toEqual(["session-ledger"]);
  });

  test("a subsequence match paints each contiguous run", () => {
    const node = renderFilterHighlight("session-ledger-store", "sesldg");
    expect(marks(node).join("")).toBe("sesldg");
    expect(flatten(node)).toBe("session-ledger-store");
  });

  test("marks carry the shared filter paint class", () => {
    const node = renderFilterHighlight("session-ledger", "ledger");
    const mark = segments(node).find(
      (part) => typeof part !== "string",
    ) as React.ReactElement<{ className: string }>;
    expect(mark.props.className).toBe("tug-filter-mark");
  });
});

// ---------------------------------------------------------------------------
// renderFilterHighlightSpans — marks nested inside existing styled runs.
// ---------------------------------------------------------------------------

/** Walk the whole tree and collect every leaf string, in document order. */
function allText(node: React.ReactNode): string {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(allText).join("");
  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  return allText(element.props.children);
}

/** `[markText, enclosingClassName]` for every mark, in document order. */
function markedRuns(node: React.ReactNode, enclosing = ""): Array<[string, string]> {
  if (node === null || node === undefined || typeof node === "string") return [];
  if (Array.isArray(node)) return node.flatMap((child) => markedRuns(child, enclosing));
  const element = node as React.ReactElement<{
    className?: string;
    children?: React.ReactNode;
  }>;
  const className = element.props.className ?? "";
  if (className === "tug-filter-mark") {
    return [[allText(element.props.children), enclosing]];
  }
  return markedRuns(
    element.props.children,
    className === "" ? enclosing : className,
  );
}

describe("renderFilterHighlightSpans", () => {
  /** `render only \`.text-card--loading\`` — plain prose, then inline code. */
  const LINE = "render only `.text-card--loading`";
  const SPANS: FilterHighlightSpan[] = [
    { text: "render only ", className: "" },
    { text: "`.text-card--loading`", className: "tug-syntax-code" },
  ];

  test("an empty query renders the runs untouched", () => {
    const node = renderFilterHighlightSpans(SPANS, LINE, "");
    expect(allText(node)).toBe(LINE);
    expect(markedRuns(node)).toEqual([]);
  });

  test("a match inside a styled run keeps that run's class", () => {
    // The defect this pins: a filter term inside a commit message's inline
    // code used to paint nothing at all, because the styled path had no
    // highlight seam.
    const node = renderFilterHighlightSpans(SPANS, LINE, "text-card");
    expect(allText(node)).toBe(LINE);
    expect(markedRuns(node)).toEqual([["text-card", "tug-syntax-code"]]);
  });

  test("a match in the unstyled run marks without inventing a wrapper class", () => {
    const node = renderFilterHighlightSpans(SPANS, LINE, "render");
    expect(markedRuns(node)).toEqual([["render", ""]]);
    expect(allText(node)).toBe(LINE);
  });

  test("a match straddling two runs is marked in BOTH, each keeping its tone", () => {
    // A run boundary in the middle of the matched word — the case a
    // one-string renderer cannot express at all.
    const straddle: FilterHighlightSpan[] = [
      { text: "swap ", className: "" },
      { text: "meta", className: "" },
      { text: "data", className: "tug-syntax-strong" },
    ];
    const node = renderFilterHighlightSpans(straddle, "swap metadata", "metadata");
    const runs = markedRuns(node);
    expect(runs.map(([text]) => text).join("")).toBe("metadata");
    expect(runs.map(([, cls]) => cls)).toEqual(["", "tug-syntax-strong"]);
    // Nothing is lost or duplicated by the split.
    expect(allText(node)).toBe("swap metadata");
  });

  test("two terms in two different runs each mark in place", () => {
    const node = renderFilterHighlightSpans(SPANS, LINE, "render loading");
    expect(markedRuns(node)).toEqual([
      ["render", ""],
      ["loading", "tug-syntax-code"],
    ]);
    expect(allText(node)).toBe(LINE);
  });

  test("a query matching nothing in the line leaves the runs alone", () => {
    const node = renderFilterHighlightSpans(SPANS, LINE, "zzqqxx");
    expect(markedRuns(node)).toEqual([]);
    expect(allText(node)).toBe(LINE);
  });

  test("an empty run neither breaks the walk nor shifts the offsets", () => {
    const spans: FilterHighlightSpan[] = [
      { text: "", className: "tug-syntax-meta" },
      { text: "alpha ", className: "" },
      { text: "beta", className: "tug-syntax-strong" },
    ];
    const node = renderFilterHighlightSpans(spans, "alpha beta", "beta");
    expect(markedRuns(node)).toEqual([["beta", "tug-syntax-strong"]]);
    expect(allText(node)).toBe("alpha beta");
  });

  test("no runs at all renders nothing rather than throwing", () => {
    expect(allText(renderFilterHighlightSpans([], "", "beta"))).toBe("");
  });
});
