/**
 * `text-match` — unit tests for the shared text-matching utility.
 *
 * Pure-logic tests, no React render. The matcher is a small pure
 * function and these tests pin its contract: empty/non-empty
 * combinations, case-insensitivity, leftmost-occurrence behavior,
 * and the offset coordinate system.
 */

import { describe, expect, test } from "bun:test";

import { caseInsensitiveSubstring } from "../text-match";

describe("caseInsensitiveSubstring — empty inputs", () => {
  test("empty query matches anything with empty match ranges", () => {
    const result = caseInsensitiveSubstring("", "anything");
    expect(result).not.toBeNull();
    expect(result?.matches).toEqual([]);
  });

  test("empty query matches an empty target with empty match ranges", () => {
    const result = caseInsensitiveSubstring("", "");
    expect(result).not.toBeNull();
    expect(result?.matches).toEqual([]);
  });

  test("non-empty query against an empty target returns null", () => {
    expect(caseInsensitiveSubstring("anything", "")).toBeNull();
  });
});

describe("caseInsensitiveSubstring — exact-case matches", () => {
  test("exact-case substring at start of target", () => {
    const result = caseInsensitiveSubstring("tug", "tugtool");
    expect(result).toEqual({ matches: [[0, 3]] });
  });

  test("exact-case substring in middle of target", () => {
    const result = caseInsensitiveSubstring("tug", "/Users/Ken/projects/tugtool");
    expect(result).toEqual({ matches: [[20, 23]] });
  });

  test("exact-case substring at end of target", () => {
    const result = caseInsensitiveSubstring("tool", "tugtool");
    expect(result).toEqual({ matches: [[3, 7]] });
  });

  test("query equal to target produces a full-span match", () => {
    const target = "/Users/Ken/projects/tugtool";
    const result = caseInsensitiveSubstring(target, target);
    expect(result).toEqual({ matches: [[0, target.length]] });
  });
});

describe("caseInsensitiveSubstring — case-insensitive matches", () => {
  test("uppercase query against lowercase target", () => {
    const result = caseInsensitiveSubstring("TUG", "tugtool");
    expect(result).toEqual({ matches: [[0, 3]] });
  });

  test("lowercase query against uppercase target", () => {
    const result = caseInsensitiveSubstring("tug", "TUGTOOL");
    expect(result).toEqual({ matches: [[0, 3]] });
  });

  test("mixed-case query against mixed-case target", () => {
    const result = caseInsensitiveSubstring("tug", "/Users/Ken/projects/Tugtool");
    expect(result).toEqual({ matches: [[20, 23]] });
  });

  test("accented Latin folds to its base letter", () => {
    // "É" lowercases to "é" via Unicode default case folding —
    // matching the Rust scorer's `fold_case` behavior on ASCII +
    // accented Latin.
    const result = caseInsensitiveSubstring("é", "Café");
    expect(result).toEqual({ matches: [[3, 4]] });
  });
});

describe("caseInsensitiveSubstring — non-matching", () => {
  test("query not present returns null", () => {
    expect(caseInsensitiveSubstring("nope", "tugtool")).toBeNull();
  });

  test("query longer than target returns null", () => {
    expect(caseInsensitiveSubstring("very-long-query-string", "tug")).toBeNull();
  });

  test("partial overlap that does not form a substring returns null", () => {
    // "tug" + "tool" both appear but no continuous "tugool" span.
    expect(caseInsensitiveSubstring("tugool", "tugtool")).toBeNull();
  });
});

describe("caseInsensitiveSubstring — multiple occurrences", () => {
  test("returns leftmost occurrence only", () => {
    // "ab" appears at index 0 and index 4. Result anchors to
    // leftmost — the contract is deterministic, leftmost wins.
    const result = caseInsensitiveSubstring("ab", "ab--ab");
    expect(result).toEqual({ matches: [[0, 2]] });
  });

  test("leftmost-occurrence rule respects case-insensitivity", () => {
    // Lowercased "ab" appears at index 0 (uppercase "AB") and
    // index 4 (lowercase "ab"). Leftmost wins.
    const result = caseInsensitiveSubstring("ab", "AB--ab");
    expect(result).toEqual({ matches: [[0, 2]] });
  });

  test("path-shaped target with overlapping prefixes", () => {
    // Picker-flavored case: substring matches the project name only.
    const result = caseInsensitiveSubstring(
      "tugtool",
      "/Users/Ken/projects/tugtool",
    );
    expect(result).toEqual({ matches: [[20, 27]] });
  });
});

describe("caseInsensitiveSubstring — return shape", () => {
  test("MatchResult has no `score` for substring matches", () => {
    // The substring matcher does not surface a ranking signal;
    // `score` stays absent. A future fuzzy matcher populates it.
    const result = caseInsensitiveSubstring("tug", "tugtool");
    expect(result).not.toBeNull();
    expect(result?.score).toBeUndefined();
  });

  test("matches array is iterable as half-open ranges", () => {
    // Pin the documented contract: each entry is `[start, end)`.
    // `target.slice(start, end)` returns the matched span.
    const target = "/Users/Ken/projects/tugtool";
    const result = caseInsensitiveSubstring("tug", target);
    expect(result).not.toBeNull();
    const [start, end] = result!.matches[0];
    expect(target.slice(start, end)).toBe("tug");
  });
});
