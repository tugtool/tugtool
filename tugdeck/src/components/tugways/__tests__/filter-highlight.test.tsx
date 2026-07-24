/**
 * filter-highlight.test.tsx — pure coverage for `renderFilterHighlight`.
 *
 * No render, no DOM: the helper returns either the bare string or a fragment
 * of string / `<mark>` fragments, and the tests read that element tree as
 * data. What matters is the contract every filtered list depends on — an
 * unfiltered row renders the identical string, a matched row splits at exact
 * offsets, and the segments always reassemble into the original text.
 */

import { describe, expect, test } from "bun:test";
import React from "react";

import { renderFilterHighlight } from "../filter-highlight";

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
