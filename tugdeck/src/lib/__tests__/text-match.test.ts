/**
 * `text-match` — unit tests for the shared text-matching utility.
 *
 * Pure-logic tests, no React render. The matcher is a small pure
 * function and these tests pin its contract: empty/non-empty
 * combinations, case-insensitivity, leftmost-occurrence behavior,
 * and the offset coordinate system.
 */

import { describe, expect, test } from "bun:test";

import { caseInsensitiveSubstring, scoreMatch } from "../text-match";

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

// ---------------------------------------------------------------------------
// scoreMatch — ranked fzf-lite matcher
// ---------------------------------------------------------------------------

/** Score of a known-good match; throws if it didn't match, so tests read cleanly. */
function scoreOf(query: string, target: string): number {
  const result = scoreMatch(query, target);
  expect(result).not.toBeNull();
  expect(result?.score).toBeDefined();
  return result!.score!;
}

describe("scoreMatch — empty inputs", () => {
  test("empty query matches anything with no ranges and no score", () => {
    const result = scoreMatch("", "permissions");
    expect(result).toEqual({ matches: [] });
    expect(result?.score).toBeUndefined();
  });

  test("non-empty query against an empty target returns null", () => {
    expect(scoreMatch("permi", "")).toBeNull();
  });
});

describe("scoreMatch — tier ordering", () => {
  test("exact > prefix > word-boundary > substring > subsequence", () => {
    // One query, five targets each landing in a distinct tier.
    const exact = scoreOf("permi", "permi");
    const prefix = scoreOf("permi", "permissions");
    const wordBoundary = scoreOf("permi", "fewer-permi-prompts");
    const substring = scoreOf("permi", "supermild");
    const subsequence = scoreOf("pmi", "permissions");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordBoundary);
    expect(wordBoundary).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
  });

  test("the regression: prefix outranks word-boundary across two real commands", () => {
    // `/permi` — `permissions` (prefix) must beat `fewer-permission-prompts`
    // (word-boundary), the bug this matcher fixes.
    expect(scoreOf("permi", "permissions")).toBeGreaterThan(
      scoreOf("permi", "fewer-permission-prompts"),
    );
  });
});

describe("scoreMatch — within-tier tiebreak", () => {
  test("shorter target wins among prefix matches", () => {
    expect(scoreOf("per", "perms")).toBeGreaterThan(
      scoreOf("per", "permissions-and-more"),
    );
  });

  test("earlier substring position wins", () => {
    // Boundary-free targets so both land in the substring tier; the only
    // signal separating them is how early `mi` appears.
    expect(scoreOf("mi", "axmitail")).toBeGreaterThan(
      scoreOf("mi", "axxxxxxxxmitail"),
    );
  });
});

describe("scoreMatch — match ranges", () => {
  test("prefix match highlights the leading span", () => {
    expect(scoreMatch("permi", "permissions")?.matches).toEqual([[0, 5]]);
  });

  test("word-boundary match highlights at the boundary", () => {
    // `permi` lands on the `permission` word start (index 6).
    expect(scoreMatch("permi", "fewer-permission-prompts")?.matches).toEqual([
      [6, 11],
    ]);
  });

  test("subsequence match merges contiguous runs into ranges", () => {
    // `pm` → `p`(0) + `m`(3) in `permissions`: two singleton ranges.
    expect(scoreMatch("pm", "permissions")?.matches).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  test("ranges are half-open and slice back the matched chars", () => {
    const target = "fewer-permission-prompts";
    const result = scoreMatch("permi", target);
    const [start, end] = result!.matches[0]!;
    expect(target.slice(start, end)).toBe("permi");
  });
});

describe("scoreMatch — non-matching", () => {
  test("out-of-order chars are not a subsequence", () => {
    expect(scoreMatch("imrep", "permissions")).toBeNull();
  });

  test("a char absent from the target returns null", () => {
    expect(scoreMatch("xyz", "permissions")).toBeNull();
  });
});

describe("scoreMatch — case-insensitivity", () => {
  test("uppercase query matches lowercase target as a prefix", () => {
    const result = scoreMatch("PERMI", "permissions");
    expect(result?.matches).toEqual([[0, 5]]);
  });
});
