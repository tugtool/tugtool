/**
 * Line-shape enforcement — PASS suppression, single-line, length clip.
 */

import { describe, expect, test } from "bun:test";

import { MAX_LINE_CHARS, shapeLine } from "../line-shape";

describe("shapeLine", () => {
  test("PASS, empty, and whitespace produce nothing", () => {
    expect(shapeLine("PASS")).toBeNull();
    expect(shapeLine("")).toBeNull();
    expect(shapeLine("   \n  ")).toBeNull();
    expect(shapeLine(null)).toBeNull();
    expect(shapeLine(undefined)).toBeNull();
  });

  test("a clean line passes through trimmed", () => {
    expect(shapeLine("  Tests green — wiring the cell next.  ")).toBe(
      "Tests green — wiring the cell next.",
    );
  });

  test("a multi-line overrun keeps its first non-empty line", () => {
    expect(shapeLine("\n\nFirst real line.\nSecond line.")).toBe("First real line.");
  });

  test("an over-length line clips to the cap with an ellipsis", () => {
    const long = "x".repeat(200);
    const shaped = shapeLine(long)!;
    expect(shaped.length).toBe(MAX_LINE_CHARS);
    expect(shaped.endsWith("…")).toBe(true);
  });

  test("a line exactly at the cap is untouched", () => {
    const exact = "y".repeat(MAX_LINE_CHARS);
    expect(shapeLine(exact)).toBe(exact);
  });
});
