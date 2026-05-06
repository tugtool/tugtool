/**
 * findLineStart unit tests — pure-logic coverage for the helper that
 * seeds `setSelectionRange` in `handleDeleteToLineStart` per [DM03].
 *
 * Pure string math (no DOM, no React, no events), so this is exactly
 * the kind of helper happy-dom is fine for: no focus, no event
 * ordering across React renders.
 */

import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import { findLineStart } from "@/components/tugways/use-text-input-responder";

describe("findLineStart", () => {
  it("returns 0 when the value contains no newlines (single-line <input>)", () => {
    expect(findLineStart("hello world", 6)).toBe(0);
    expect(findLineStart("hello world", 0)).toBe(0);
    expect(findLineStart("hello world", 11)).toBe(0);
  });

  it("returns 0 for the first line of a multi-line value", () => {
    const value = "first\nsecond\nthird";
    expect(findLineStart(value, 0)).toBe(0);
    expect(findLineStart(value, 3)).toBe(0);
    expect(findLineStart(value, 5)).toBe(0); // caret right at the \n
  });

  it("returns the index immediately after the last \\n at-or-before the caret", () => {
    const value = "first\nsecond\nthird";
    // After "first\n" (index 6) is the start of "second".
    expect(findLineStart(value, 6)).toBe(6);
    // Caret in the middle of "second".
    expect(findLineStart(value, 9)).toBe(6);
    // Caret at the second \n (index 12) — line containing it is "second".
    expect(findLineStart(value, 12)).toBe(6);
    // After the second \n — start of "third" is 13.
    expect(findLineStart(value, 13)).toBe(13);
    expect(findLineStart(value, 16)).toBe(13);
  });

  it("clamps caret values that fall outside the value range", () => {
    const value = "abc\ndef";
    expect(findLineStart(value, -5)).toBe(0);
    expect(findLineStart(value, 100)).toBe(4);
  });

  it("returns 0 for an empty value", () => {
    expect(findLineStart("", 0)).toBe(0);
    expect(findLineStart("", 3)).toBe(0);
  });

  it("handles consecutive newlines (blank lines)", () => {
    const value = "a\n\nb";
    // Caret at the empty line (index 2) — line starts at 2.
    expect(findLineStart(value, 2)).toBe(2);
    // Caret at "b" (index 3) — line starts at 3.
    expect(findLineStart(value, 3)).toBe(3);
  });
});
