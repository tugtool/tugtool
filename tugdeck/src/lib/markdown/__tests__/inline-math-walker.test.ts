/**
 * `findInlineMathRanges` — pure-logic finder for unfenced `$...$`
 * and `$$...$$` math in prose.
 *
 * The DOM-mutating walker is HMR-vetted (no fake-DOM tests per
 * project policy); the pure range finder is exhaustively unit-tested
 * here. The walker's mutation logic is a thin loop over the finder's
 * output, so pinning the finder pins the walker's behaviour modulo
 * the DOM-splice boilerplate.
 */

import { describe, expect, test } from "bun:test";

import { findInlineMathRanges } from "../block-transformers/inline-math-walker";

describe("findInlineMathRanges — display mode ($$...$$)", () => {
  test("matches a basic display expression", () => {
    const ranges = findInlineMathRanges("$$E=mc^2$$");
    expect(ranges.length).toBe(1);
    expect(ranges[0]).toMatchObject({
      start: 0,
      end: 10,
      displayMode: true,
      source: "E=mc^2",
    });
  });

  test("matches a display expression embedded in prose", () => {
    const text = "before $$x + y$$ after";
    const ranges = findInlineMathRanges(text);
    expect(ranges.length).toBe(1);
    expect(ranges[0].displayMode).toBe(true);
    expect(ranges[0].source).toBe("x + y");
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe("$$x + y$$");
  });

  test("matches a display expression spanning newlines", () => {
    const ranges = findInlineMathRanges("$$\nE = mc^2\n$$");
    expect(ranges.length).toBe(1);
    expect(ranges[0].displayMode).toBe(true);
    expect(ranges[0].source).toBe("\nE = mc^2\n");
  });

  test("decodes \\$ inside the body", () => {
    const ranges = findInlineMathRanges("$$cost = \\$50$$");
    expect(ranges.length).toBe(1);
    expect(ranges[0].source).toBe("cost = $50");
  });

  test("drops an unclosed display opener", () => {
    expect(findInlineMathRanges("$$no end here")).toEqual([]);
  });
});

describe("findInlineMathRanges — inline mode ($...$)", () => {
  test("matches a basic inline expression", () => {
    const ranges = findInlineMathRanges("$E=mc^2$");
    expect(ranges.length).toBe(1);
    expect(ranges[0]).toMatchObject({
      start: 0,
      end: 8,
      displayMode: false,
      source: "E=mc^2",
    });
  });

  test("matches an inline expression embedded in prose", () => {
    const text = "Einstein said $E=mc^2$ once.";
    const ranges = findInlineMathRanges(text);
    expect(ranges.length).toBe(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe("$E=mc^2$");
  });

  test("matches multiple inline expressions in order", () => {
    const text = "$a$ and $b$ and $c$";
    const ranges = findInlineMathRanges(text);
    expect(ranges.length).toBe(3);
    expect(ranges.map((r) => r.source)).toEqual(["a", "b", "c"]);
  });

  test("rejects opener followed by a space (prose disambiguation)", () => {
    // ` $5 and $10 ` would otherwise mis-match — the opener is followed
    // by a digit which is fine, but if the opener is followed by a
    // space we treat it as prose, not math.
    const ranges = findInlineMathRanges("she paid $ 50 dollars$");
    expect(ranges).toEqual([]);
  });

  test("rejects closer preceded by a space", () => {
    // `$ ... $` with whitespace before the closer fails the closer
    // predicate; treat as prose.
    const ranges = findInlineMathRanges("$x $");
    expect(ranges).toEqual([]);
  });

  test("rejects closer followed by a digit (currency disambiguation)", () => {
    // The classic `$5 and $10` case — the second `$` is followed by
    // a digit, so it cannot close the range opened by the first.
    const ranges = findInlineMathRanges("$5 and $10");
    expect(ranges).toEqual([]);
  });

  test("an inline `$` followed by `$` is treated as a display opener at the next scan", () => {
    // Two inline expressions can sit adjacent: `$a$ and $b$`. Once
    // `$a$` is consumed, scanning resumes at the next char.
    const ranges = findInlineMathRanges("$a$ and $b$");
    expect(ranges.length).toBe(2);
    expect(ranges.map((r) => r.source)).toEqual(["a", "b"]);
  });

  test("preserves \\$ inside an inline match", () => {
    const ranges = findInlineMathRanges("$cost = \\$50$");
    expect(ranges.length).toBe(1);
    expect(ranges[0].source).toBe("cost = $50");
  });

  test("drops an unclosed inline opener", () => {
    expect(findInlineMathRanges("$dangling")).toEqual([]);
  });
});

describe("findInlineMathRanges — escape preservation", () => {
  test("literal \\$ in prose does not open a range", () => {
    const ranges = findInlineMathRanges("backslash-dollar \\$ in prose");
    expect(ranges).toEqual([]);
  });

  test("\\$ before an otherwise-valid opener is skipped", () => {
    const ranges = findInlineMathRanges("\\$ but then $x$ is real");
    expect(ranges.length).toBe(1);
    expect(ranges[0].source).toBe("x");
  });

  test("\\$ inside content prevents an early close", () => {
    // The escaped `\$` should NOT close the range; the `$` two
    // characters later is the real closer.
    const ranges = findInlineMathRanges("$a\\$b$");
    expect(ranges.length).toBe(1);
    expect(ranges[0].source).toBe("a$b");
  });
});

describe("findInlineMathRanges — mixed and edge cases", () => {
  test("display then inline in the same text", () => {
    const text = "$$x + y$$ then $a$";
    const ranges = findInlineMathRanges(text);
    expect(ranges.length).toBe(2);
    expect(ranges[0].displayMode).toBe(true);
    expect(ranges[1].displayMode).toBe(false);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe("$$x + y$$");
    expect(text.slice(ranges[1].start, ranges[1].end)).toBe("$a$");
  });

  test("empty input returns no ranges", () => {
    expect(findInlineMathRanges("")).toEqual([]);
  });

  test("text with no $ returns no ranges (fast path)", () => {
    expect(findInlineMathRanges("just plain prose")).toEqual([]);
  });

  test("ranges are non-overlapping and in source order", () => {
    const text = "$a$ then $$b$$ then $c$";
    const ranges = findInlineMathRanges(text);
    expect(ranges.length).toBe(3);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].start).toBeGreaterThanOrEqual(ranges[i - 1].end);
    }
  });
});
