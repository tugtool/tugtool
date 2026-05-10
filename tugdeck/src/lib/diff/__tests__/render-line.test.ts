/**
 * Tests for `render-line.ts` and its companion
 * `syntax-tokens-from-shiki.ts`.
 *
 * The merge function is pure, so these are plain unit tests over
 * input/output pairs. Together they cover:
 *
 *  - Shiki HTML round-trip: parse → tokens → reconstruct text.
 *  - Word-range derivation from `WordDiffSegment[]` (per side).
 *  - Merge: every combination of (syntax | no-syntax) ×
 *    (word-range | no-word-range), plus the interesting case where a
 *    word range crosses syntax-token boundaries (double-decorated
 *    spans).
 *
 * No happy-dom needed — this is straight TypeScript.
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
  decodeHtmlEntities,
  parseShikiLineHtml,
  type SyntaxToken,
} from "../syntax-tokens-from-shiki";

// ---------------------------------------------------------------------------
// syntax-tokens-from-shiki
// ---------------------------------------------------------------------------

describe("decodeHtmlEntities", () => {
  test("decodes the standard quintet", () => {
    expect(decodeHtmlEntities("&lt;tag&gt;")).toBe("<tag>");
    expect(decodeHtmlEntities("a &amp; b")).toBe("a & b");
    expect(decodeHtmlEntities("&quot;hi&quot;")).toBe('"hi"');
    expect(decodeHtmlEntities("it&#39;s")).toBe("it's");
    expect(decodeHtmlEntities("it&apos;s")).toBe("it's");
  });

  test("does not double-decode '&amp;lt;'", () => {
    // After one pass: `&lt;` (we want literal "&lt;" preserved as
    // text — this matches Shiki's expectation that `&amp;lt;` in
    // source becomes "&lt;" rendered).
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
  });
});

describe("parseShikiLineHtml", () => {
  test("plain Shiki line with three styled tokens", () => {
    const html =
      '<span class="line">' +
      '<span style="color:#79B8FF">const</span>' +
      '<span style="color:#E1E4E8"> x </span>' +
      '<span style="color:#F97583">=</span>' +
      "</span>";
    const tokens = parseShikiLineHtml(html);
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toEqual({ start: 0, end: 5, style: "color:#79B8FF" });
    expect(tokens[1]).toEqual({ start: 5, end: 8, style: "color:#E1E4E8" });
    expect(tokens[2]).toEqual({ start: 8, end: 9, style: "color:#F97583" });
  });

  test("inner-only HTML (no wrapping <span class=\"line\">) parses identically", () => {
    const inner =
      '<span style="color:#79B8FF">const</span>' +
      '<span style="color:#E1E4E8"> x</span>';
    const tokens = parseShikiLineHtml(inner);
    expect(tokens).toHaveLength(2);
    expect(tokens[0].end).toBe(5);
    expect(tokens[1].end).toBe(7);
  });

  test("HTML entities in token content map to original character offsets", () => {
    // Shiki encodes `<` as `&lt;` etc. The reconstructed text must
    // align with the original source line so word-level offsets work.
    const html =
      '<span style="color:#79B8FF">if</span>' +
      '<span style="color:#E1E4E8"> (a &lt; b)</span>';
    const tokens = parseShikiLineHtml(html);
    expect(tokens).toHaveLength(2);
    // " (a < b)" is 8 chars, not 11 (the encoded "&lt;" form).
    expect(tokens[1]).toEqual({ start: 2, end: 10, style: "color:#E1E4E8" });
  });

  test("empty / non-Shiki HTML yields no tokens", () => {
    expect(parseShikiLineHtml("")).toEqual([]);
    expect(parseShikiLineHtml("<span class=\"line\"></span>")).toEqual([]);
    expect(parseShikiLineHtml("just plain text")).toEqual([]);
  });

  test("token text reconstructs the original line", () => {
    const html =
      '<span style="color:#79B8FF">const</span>' +
      '<span style="color:#E1E4E8"> x = </span>' +
      '<span style="color:#79B8FF">1</span>';
    const tokens = parseShikiLineHtml(html);
    // Reconstruct: end of last token == total length of "const x = 1".
    expect(tokens[tokens.length - 1].end).toBe("const x = 1".length);
  });
});

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
      { text: "hello world", style: "", className: null },
    ]);
  });

  test("empty arrays behave like null", () => {
    expect(renderLineSegments("hi", [], [])).toEqual([
      { text: "hi", style: "", className: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// renderLineSegments — syntax only
// ---------------------------------------------------------------------------

describe("renderLineSegments — syntax tokens only", () => {
  test("each token becomes its own segment with the Shiki style", () => {
    const text = "const x";
    const tokens: SyntaxToken[] = [
      { start: 0, end: 5, style: "color:#79B8FF" },
      { start: 5, end: 7, style: "color:#E1E4E8" },
    ];
    const segments = renderLineSegments(text, tokens, null);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      text: "const",
      style: "color:#79B8FF",
      className: null,
    });
    expect(segments[1]).toEqual({
      text: " x",
      style: "color:#E1E4E8",
      className: null,
    });
  });

  test("text outside any syntax token still gets a plain-style segment", () => {
    const text = "abcdef";
    const tokens: SyntaxToken[] = [{ start: 2, end: 4, style: "color:#abc" }];
    const segments = renderLineSegments(text, tokens, null);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ text: "ab", style: "", className: null });
    expect(segments[1]).toEqual({
      text: "cd",
      style: "color:#abc",
      className: null,
    });
    expect(segments[2]).toEqual({ text: "ef", style: "", className: null });
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
      {
        text: "let",
        style: "",
        className: "tugx-diff-word-remove",
      },
      { text: " x = 1", style: "", className: null },
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
    expect(segments[0].className).toBe("tugx-diff-word-remove");
    expect(segments[1].className).toBeNull();
    expect(segments[2].className).toBe("tugx-diff-word-remove");
  });
});

// ---------------------------------------------------------------------------
// renderLineSegments — the merge case (Shiki + word-level)
// ---------------------------------------------------------------------------

describe("renderLineSegments — merge: word range crosses syntax boundary", () => {
  test("a word range spanning two syntax tokens yields double-decorated segments at the overlap", () => {
    // Text:        "let x = 1"
    // Syntax:      "let"      "color:#blue"   (0..3)
    //              " x = "    "color:#text"   (3..8)
    //              "1"        "color:#num"    (8..9)
    // Word range:  "let " is changed (covers token #1 entirely
    //              + the leading space of token #2).
    const text = "let x = 1";
    const tokens: SyntaxToken[] = [
      { start: 0, end: 3, style: "color:#blue" },
      { start: 3, end: 8, style: "color:#text" },
      { start: 8, end: 9, style: "color:#num" },
    ];
    const ranges: WordRange[] = [
      { start: 0, end: 4, className: "tugx-diff-word-remove" },
    ];
    const segments = renderLineSegments(text, tokens, ranges);
    // Boundaries: {0, 3, 4, 8, 9} → segments (0..3)(3..4)(4..8)(8..9).
    expect(segments).toEqual([
      // "let" — fully inside token #1 AND fully inside word range.
      {
        text: "let",
        style: "color:#blue",
        className: "tugx-diff-word-remove",
      },
      // " " — inside token #2 AND inside word range.
      {
        text: " ",
        style: "color:#text",
        className: "tugx-diff-word-remove",
      },
      // "x = " — inside token #2 only.
      { text: "x = ", style: "color:#text", className: null },
      // "1" — token #3.
      { text: "1", style: "color:#num", className: null },
    ]);
  });

  test("a word range fully inside a single syntax token still merges cleanly", () => {
    const text = "println";
    const tokens: SyntaxToken[] = [{ start: 0, end: 7, style: "color:#abc" }];
    const ranges: WordRange[] = [
      { start: 3, end: 4, className: "tugx-diff-word-add" },
    ];
    const segments = renderLineSegments(text, tokens, ranges);
    expect(segments).toEqual([
      { text: "pri", style: "color:#abc", className: null },
      {
        text: "n",
        style: "color:#abc",
        className: "tugx-diff-word-add",
      },
      { text: "tln", style: "color:#abc", className: null },
    ]);
  });

  test("multi-token word change spanning syntax boundaries (real-world example)", () => {
    // Bash-ish: `echo $foo` → `printf $bar`. Token boundaries:
    //   "echo"       (0..4)  keyword
    //   " "          (4..5)  whitespace
    //   "$foo"       (5..9)  variable
    // Word change covers `echo` → `printf` AND `foo` → `bar`.
    // For the "remove" side ("echo $foo"), word ranges:
    //   [0..4] "echo"
    //   [6..9] "foo"  (after the "$")
    const text = "echo $foo";
    const tokens: SyntaxToken[] = [
      { start: 0, end: 4, style: "color:#kw" },
      { start: 4, end: 5, style: "color:#ws" },
      { start: 5, end: 9, style: "color:#var" },
    ];
    const ranges: WordRange[] = [
      { start: 0, end: 4, className: "tugx-diff-word-remove" },
      { start: 6, end: 9, className: "tugx-diff-word-remove" },
    ];
    const segments = renderLineSegments(text, tokens, ranges);
    // Expected boundary positions: {0, 4, 5, 6, 9}.
    expect(segments.map((s) => s.text)).toEqual([
      "echo", // 0..4: token #1 + range #1
      " ",    // 4..5: token #2, no range
      "$",    // 5..6: token #3, no range
      "foo",  // 6..9: token #3 + range #2
    ]);
    // Both decorations on the changed regions:
    expect(segments[0].style).toBe("color:#kw");
    expect(segments[0].className).toBe("tugx-diff-word-remove");
    expect(segments[3].style).toBe("color:#var");
    expect(segments[3].className).toBe("tugx-diff-word-remove");
    // No overlay on the unchanged parts:
    expect(segments[1].className).toBeNull();
    expect(segments[2].className).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renderLineSegments — invariants
// ---------------------------------------------------------------------------

describe("renderLineSegments — invariants", () => {
  test("concatenating segment text reconstructs the original line, always", () => {
    const text = "function foo(): boolean { return true; }";
    const tokens: SyntaxToken[] = [
      { start: 0, end: 8, style: "color:#kw" },
      { start: 9, end: 12, style: "color:#fn" },
      { start: 16, end: 23, style: "color:#ty" },
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
    const tokens: SyntaxToken[] = [{ start: 1, end: 1, style: "color:#x" }];
    const ranges: WordRange[] = [
      { start: 0, end: 0, className: "tugx-diff-word-add" },
    ];
    const segments: RenderedSegment[] = renderLineSegments(text, tokens, ranges);
    for (const s of segments) {
      expect(s.text.length).toBeGreaterThan(0);
    }
  });
});
