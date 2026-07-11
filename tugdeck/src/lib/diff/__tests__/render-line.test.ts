/**
 * Tests for `render-line.ts` (the syntax + word-level merge) and
 * `syntax-tokens-from-lezer.ts` (per-line hunk-side tokenization).
 *
 * The merge function is pure, so most of these are plain unit tests over
 * input/output pairs. Together they cover:
 *
 *  - Word-range derivation from `WordDiffSegment[]` (per side).
 *  - Merge: every combination of (syntax | no-syntax) ×
 *    (word-range | no-word-range), plus the interesting case where a
 *    word range crosses syntax-token boundaries (double-decorated
 *    spans carrying both class names).
 *  - `tokenizeHunkSide`: the real Lezer grammar over a small hunk side.
 */

import dmp from "diff-match-patch";
import { describe, expect, test } from "bun:test";

import { wordLevelDiffSync } from "../parse-unified-diff";
import {
  renderLineSegments,
  wordRangesForSide,
  type RenderedSegment,
  type WordRange,
} from "../render-line";
import {
  tokenizeHunkSide,
  type SyntaxToken,
} from "../syntax-tokens-from-lezer";

// ---------------------------------------------------------------------------
// wordRangesForSide
// ---------------------------------------------------------------------------

describe("wordRangesForSide", () => {
  test("typescript identifier change yields opposite-side ranges", () => {
    // `let` → `var` — both 3 chars.
    const segments = wordLevelDiffSync("let x = 1", "var x = 1", dmp);
    const removeRanges = wordRangesForSide(segments, "remove");
    const addRanges = wordRangesForSide(segments, "add");

    expect(removeRanges).toHaveLength(1);
    expect(removeRanges[0]).toEqual({
      start: 0,
      end: 3,
      className: "tugx-diff-word-remove",
    });
    expect(addRanges).toHaveLength(1);
    expect(addRanges[0]).toEqual({
      start: 0,
      end: 3,
      className: "tugx-diff-word-add",
    });
  });

  test("equal segments are not surfaced as ranges", () => {
    const segments = wordLevelDiffSync("hello", "hello world", dmp);
    const addRanges = wordRangesForSide(segments, "add");
    // The `equal` chunk "hello" must NOT appear in addRanges; only
    // the inserted " world" suffix should.
    expect(addRanges).toHaveLength(1);
    expect(addRanges[0].className).toBe("tugx-diff-word-add");
    expect(addRanges[0].end - addRanges[0].start).toBe(" world".length);
  });

  test("identical inputs yield no ranges on either side", () => {
    const segments = wordLevelDiffSync("same", "same", dmp);
    expect(wordRangesForSide(segments, "remove")).toEqual([]);
    expect(wordRangesForSide(segments, "add")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderLineSegments — empty / fallback cases
// ---------------------------------------------------------------------------

describe("renderLineSegments — degenerate cases", () => {
  test("empty text → empty segments", () => {
    expect(renderLineSegments("", null, null)).toEqual([]);
  });

  test("no syntax, no word ranges → one plain segment for the whole line", () => {
    const segments = renderLineSegments("hello world", null, null);
    expect(segments).toEqual([
      { text: "hello world", syntaxClassName: "", wordClassName: null },
    ]);
  });

  test("empty arrays behave like null", () => {
    expect(renderLineSegments("hi", [], [])).toEqual([
      { text: "hi", syntaxClassName: "", wordClassName: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// renderLineSegments — syntax only
// ---------------------------------------------------------------------------

describe("renderLineSegments — syntax tokens only", () => {
  test("each token becomes its own segment with the syntax class", () => {
    const text = "const x";
    const tokens: SyntaxToken[] = [
      { start: 0, end: 5, className: "tok-kw" },
      { start: 5, end: 7, className: "tok-var" },
    ];
    const segments = renderLineSegments(text, tokens, null);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      text: "const",
      syntaxClassName: "tok-kw",
      wordClassName: null,
    });
    expect(segments[1]).toEqual({
      text: " x",
      syntaxClassName: "tok-var",
      wordClassName: null,
    });
  });

  test("text outside any syntax token still gets a plain segment", () => {
    const text = "abcdef";
    const tokens: SyntaxToken[] = [{ start: 2, end: 4, className: "tok-x" }];
    const segments = renderLineSegments(text, tokens, null);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ text: "ab", syntaxClassName: "", wordClassName: null });
    expect(segments[1]).toEqual({
      text: "cd",
      syntaxClassName: "tok-x",
      wordClassName: null,
    });
    expect(segments[2]).toEqual({ text: "ef", syntaxClassName: "", wordClassName: null });
  });
});

// ---------------------------------------------------------------------------
// renderLineSegments — word-ranges only
// ---------------------------------------------------------------------------

describe("renderLineSegments — word ranges only", () => {
  test("a single change range becomes a class-bearing segment", () => {
    const text = "let x = 1";
    const ranges: WordRange[] = [
      { start: 0, end: 3, className: "tugx-diff-word-remove" },
    ];
    const segments = renderLineSegments(text, null, ranges);
    expect(segments).toEqual([
      { text: "let", syntaxClassName: "", wordClassName: "tugx-diff-word-remove" },
      { text: " x = 1", syntaxClassName: "", wordClassName: null },
    ]);
  });

  test("multiple disjoint ranges each get their own segment", () => {
    const text = "AAA BBB CCC";
    const ranges: WordRange[] = [
      { start: 0, end: 3, className: "tugx-diff-word-remove" },
      { start: 8, end: 11, className: "tugx-diff-word-remove" },
    ];
    const segments = renderLineSegments(text, null, ranges);
    expect(segments).toHaveLength(3);
    expect(segments[0].wordClassName).toBe("tugx-diff-word-remove");
    expect(segments[1].wordClassName).toBeNull();
    expect(segments[2].wordClassName).toBe("tugx-diff-word-remove");
  });
});

// ---------------------------------------------------------------------------
// renderLineSegments — the merge case (syntax + word-level)
// ---------------------------------------------------------------------------

describe("renderLineSegments — merge: word range crosses syntax boundary", () => {
  test("a word range spanning two syntax tokens yields double-decorated segments at the overlap", () => {
    const text = "let x = 1";
    const tokens: SyntaxToken[] = [
      { start: 0, end: 3, className: "tok-kw" },
      { start: 3, end: 8, className: "tok-text" },
      { start: 8, end: 9, className: "tok-num" },
    ];
    const ranges: WordRange[] = [
      { start: 0, end: 4, className: "tugx-diff-word-remove" },
    ];
    const segments = renderLineSegments(text, tokens, ranges);
    // Boundaries: {0, 3, 4, 8, 9} → segments (0..3)(3..4)(4..8)(8..9).
    expect(segments).toEqual([
      { text: "let", syntaxClassName: "tok-kw", wordClassName: "tugx-diff-word-remove" },
      { text: " ", syntaxClassName: "tok-text", wordClassName: "tugx-diff-word-remove" },
      { text: "x = ", syntaxClassName: "tok-text", wordClassName: null },
      { text: "1", syntaxClassName: "tok-num", wordClassName: null },
    ]);
  });

  test("a word range fully inside a single syntax token still merges cleanly", () => {
    const text = "println";
    const tokens: SyntaxToken[] = [{ start: 0, end: 7, className: "tok-x" }];
    const ranges: WordRange[] = [
      { start: 3, end: 4, className: "tugx-diff-word-add" },
    ];
    const segments = renderLineSegments(text, tokens, ranges);
    expect(segments).toEqual([
      { text: "pri", syntaxClassName: "tok-x", wordClassName: null },
      { text: "n", syntaxClassName: "tok-x", wordClassName: "tugx-diff-word-add" },
      { text: "tln", syntaxClassName: "tok-x", wordClassName: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// renderLineSegments — invariants
// ---------------------------------------------------------------------------

describe("renderLineSegments — invariants", () => {
  test("concatenating segment text reconstructs the original line, always", () => {
    const text = "function foo(): boolean { return true; }";
    const tokens: SyntaxToken[] = [
      { start: 0, end: 8, className: "tok-kw" },
      { start: 9, end: 12, className: "tok-fn" },
      { start: 16, end: 23, className: "tok-ty" },
    ];
    const ranges: WordRange[] = [
      { start: 9, end: 12, className: "tugx-diff-word-add" },
      { start: 33, end: 37, className: "tugx-diff-word-add" },
    ];
    const segments = renderLineSegments(text, tokens, ranges);
    expect(segments.map((s) => s.text).join("")).toBe(text);
  });

  test("no segment is empty", () => {
    const text = "abc";
    const tokens: SyntaxToken[] = [{ start: 1, end: 1, className: "tok-x" }];
    const ranges: WordRange[] = [
      { start: 0, end: 0, className: "tugx-diff-word-add" },
    ];
    const segments: RenderedSegment[] = renderLineSegments(text, tokens, ranges);
    for (const s of segments) {
      expect(s.text.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// tokenizeHunkSide — real Lezer grammar
// ---------------------------------------------------------------------------

describe("tokenizeHunkSide", () => {
  test("tokenizes a side's lines aligned 1:1 (keyword lines get runs)", async () => {
    const perLine = await tokenizeHunkSide(["const x = 1", "return x"], "ts");
    expect(perLine.length).toBe(2);
    // Line 0's `const` keyword carries a run.
    expect(perLine[0].some((t) => t.start === 0 && t.end === 5)).toBe(true);
    // Line 1's `return` keyword carries a run.
    expect(perLine[1].some((t) => t.start === 0 && t.end === 6)).toBe(true);
  });

  test("a side closing a block comment it never opened stays comment-scoped (grammar seed)", async () => {
    // Without a seed, ` done */` would mis-parse as code; the seed
    // restores the open-comment state so the first line reads as comment.
    const perLine = await tokenizeHunkSide([" still comment", " done */", "code()"], "ts");
    expect(perLine.length).toBe(3);
    expect(perLine[0].length).toBeGreaterThan(0);
  });

  test("empty side and unknown extension degrade gracefully", async () => {
    expect(await tokenizeHunkSide([], "ts")).toEqual([]);
    const plain = await tokenizeHunkSide(["a", "b"], "nope");
    expect(plain).toEqual([[], []]);
  });
});
