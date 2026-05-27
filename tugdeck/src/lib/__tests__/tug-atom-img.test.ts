/**
 * Pure-logic tests for the `tug-atom-img` exports that don't depend on
 * the DOM. The full chip-builder (`buildAtomSVGDataUri`) is
 * DOM-dependent (it reads theme tokens via `getComputedStyle(document.body)`)
 * and is exercised through the real-app manual smoke; this file pins
 * the two pure pieces that the assistant-side tool-block path chips
 * rely on:
 *
 *   1. {@link formatAtomLabel} — basename extraction. The tool-block
 *      side calls this with mode `"filename"` to derive the chip's
 *      label from the full path. The behaviour for absolute, relative,
 *      and edge-case paths is pinned here so a future refactor can't
 *      silently regress the chip's displayed label.
 *
 *   2. {@link composeAtomChipImgProps} — the null-on-empty-path
 *      defensive branch. The non-null branch transitively calls
 *      `buildAtomSVGDataUri` and is DOM-bound; tests there live in
 *      the real-app smoke. This file pins just the early-return so
 *      callers can rely on the `null` contract.
 */

import { describe, expect, test } from "bun:test";

import {
  composeAtomChipImgProps,
  formatAtomLabel,
} from "../tug-atom-img";

describe("formatAtomLabel — `filename` mode (basename extraction)", () => {
  test("absolute path: returns the last component", () => {
    expect(formatAtomLabel("/repo/src/main.ts", "filename")).toBe("main.ts");
  });

  test("relative path: returns the last component", () => {
    expect(formatAtomLabel("src/components/foo.tsx", "filename")).toBe(
      "foo.tsx",
    );
  });

  test("bare filename (no slash): returns the input as-is", () => {
    expect(formatAtomLabel("main.ts", "filename")).toBe("main.ts");
  });

  test("path ending in slash returns empty (last component after trailing slash)", () => {
    // The transcript / tool-block side never passes a directory path
    // — the tool inputs are always file paths — but pin the deterministic
    // behaviour of `lastIndexOf('/')` so a future regression to a
    // non-empty fallback would be observable.
    expect(formatAtomLabel("src/", "filename")).toBe("");
  });

  test("nested basename keeps its extension", () => {
    expect(
      formatAtomLabel("/Users/kocienda/notebooks/exploration.ipynb", "filename"),
    ).toBe("exploration.ipynb");
  });

  test("http URL: returns the trailing component (after query strip)", () => {
    expect(
      formatAtomLabel("https://example.com/api/v2/users?id=42", "filename"),
    ).toBe("users");
  });

  test("https URL ending in slash (homepage): returns the full URL fallback", () => {
    // The `filename` branch falls back to the full value when the
    // post-strip basename is empty (a homepage URL).
    expect(formatAtomLabel("https://example.com/", "filename")).toBe(
      "https://example.com/",
    );
  });
});

describe("composeAtomChipImgProps — null-on-empty-path defensive branch", () => {
  test("empty string returns null", () => {
    expect(composeAtomChipImgProps("file", "")).toBeNull();
  });

  // Note: the non-empty branch transitively calls `buildAtomSVGDataUri`
  // which reads theme tokens via `getComputedStyle(document.body)`. In
  // a pure-logic Bun test environment `document` is undefined, so we
  // can't exercise the happy path here. The real-app manual smoke
  // covers it (Step 7 checkpoint).
});
