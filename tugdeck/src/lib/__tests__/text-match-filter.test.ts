/**
 * `text-match` list-filter helpers — unit tests.
 *
 * Pure-logic tests over `filterQueryMatch` (membership: every term, any
 * field) and `filterHighlightRanges` (merged paint ranges over one rendered
 * string). No React, no DOM.
 */

import { describe, expect, test } from "bun:test";

import {
  filterAndRank,
  filterHighlightRanges,
  filterMatchScore,
  filterQueryMatch,
} from "../text-match";

/** A realistic long session prompt — the field that made the picker useless. */
const LONG_PROMPT =
  "Please refactor the transcript entry component so the commit receipt block lines up with the rest of the card chrome";

describe("filterQueryMatch — membership", () => {
  test("an empty query matches everything", () => {
    expect(filterQueryMatch("", ["anything"])).toBe(true);
    expect(filterQueryMatch("", [])).toBe(true);
    expect(filterQueryMatch("", [null, undefined])).toBe(true);
  });

  test("an all-whitespace query matches everything", () => {
    expect(filterQueryMatch("   \t ", ["anything"])).toBe(true);
  });

  test("a single term matches on a substring", () => {
    expect(filterQueryMatch("ledger", ["session-ledger-store"])).toBe(true);
    expect(filterQueryMatch("ledger", ["session-picker"])).toBe(false);
  });

  test("matching is subsequence-tolerant", () => {
    expect(filterQueryMatch("sesldg", ["session-ledger-store"])).toBe(true);
    expect(filterQueryMatch("gldses", ["session-ledger-store"])).toBe(false);
  });

  test("terms AND together and may land in different fields", () => {
    expect(filterQueryMatch("tug ledger", ["tugtool", "ledger-store"])).toBe(true);
    expect(filterQueryMatch("tug ledger", ["tugtool"])).toBe(false);
    expect(filterQueryMatch("tug ledger", ["tug-ledger"])).toBe(true);
  });

  test("null, undefined, and empty fields are skipped", () => {
    expect(filterQueryMatch("tug", [null, undefined, "", "tugtool"])).toBe(true);
    expect(filterQueryMatch("tug", [null, undefined, ""])).toBe(false);
  });

  test("case folds both ways", () => {
    expect(filterQueryMatch("TUG", ["tugtool"])).toBe(true);
    expect(filterQueryMatch("tug", ["TUGTOOL"])).toBe(true);
  });

  test("a scattered subsequence over a long field is NOT a match", () => {
    // Every letter of "scarp" appears in order somewhere in the prompt, spread
    // across 25 characters. Counting that as a hit is what made a 900-row
    // picker filter to 900 rows.
    expect(filterQueryMatch("scarp", [LONG_PROMPT])).toBe(false);
    // A word that is really in there still matches.
    expect(filterQueryMatch("receipt", [LONG_PROMPT])).toBe(true);
  });

  test("a compact subsequence still matches — the acronym case", () => {
    expect(filterQueryMatch("sesldg", ["session-ledger-store"])).toBe(true);
    expect(filterQueryMatch("pm", ["permissions"])).toBe(true);
    expect(filterQueryMatch("tugflt", ["tug-filter-field"])).toBe(true);
  });
});

describe("filterMatchScore — ranking signal", () => {
  test("no query scores every row alike", () => {
    expect(filterMatchScore("", ["anything"])).toBe(0);
    expect(filterMatchScore("  ", ["anything"])).toBe(0);
  });

  test("a non-match scores null", () => {
    expect(filterMatchScore("nope", ["session-ledger"])).toBeNull();
  });

  test("a better match scores higher, tier by tier", () => {
    const exact = filterMatchScore("ledger", ["ledger"])!;
    const prefix = filterMatchScore("ledger", ["ledger-store"])!;
    const wordPrefix = filterMatchScore("ledger", ["session-ledger-store"])!;
    const substring = filterMatchScore("edger", ["session-ledger-store"])!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordPrefix);
    expect(wordPrefix).toBeGreaterThan(substring);
  });

  test("a term scores its BEST field", () => {
    const best = filterMatchScore("tug", ["tug"])!;
    expect(filterMatchScore("tug", ["a tug of war", "tug"])).toBe(best);
  });

  test("multi-term scores sum, and one failing term fails the row", () => {
    const a = filterMatchScore("tug", ["tugtool"])!;
    const b = filterMatchScore("ledger", ["ledger-store"])!;
    expect(filterMatchScore("tug ledger", ["tugtool", "ledger-store"])).toBe(a + b);
    expect(filterMatchScore("tug absent", ["tugtool", "ledger-store"])).toBeNull();
  });
});

describe("filterAndRank", () => {
  const titles = [
    "session-ledger-store",
    "ledger",
    "the ledger of record",
    "unrelated",
  ];
  const rank = (query: string): string[] => [
    ...filterAndRank(titles, query, (t) => [t]),
  ];

  test("an empty query returns the input untouched, same reference", () => {
    expect(filterAndRank(titles, "", (t) => [t])).toBe(titles);
    expect(filterAndRank(titles, "   ", (t) => [t])).toBe(titles);
  });

  test("drops non-matches and leads with the best match", () => {
    const ranked = rank("ledger");
    expect(ranked).not.toContain("unrelated");
    expect(ranked[0]).toBe("ledger"); // exact beats word-prefix and substring
    expect(ranked).toHaveLength(3);
  });

  test("equal-quality rows keep their native order (stable)", () => {
    // Same tier, same target length, same match position → identical scores,
    // so nothing may reorder them.
    const items = ["alpha ledger", "gamma ledger", "delta ledger"];
    expect([...filterAndRank(items, "ledger", (t) => [t])]).toEqual(items);
  });

  test("a shorter target outranks a longer one at the same tier", () => {
    // The match-ratio bonus: `ledger` is more of `beta ledger` than of
    // `alpha ledger`, so it reads as the stronger hit.
    expect([
      ...filterAndRank(["alpha ledger", "beta ledger"], "ledger", (t) => [t]),
    ]).toEqual(["beta ledger", "alpha ledger"]);
  });

  test("ranks on the fields the caller supplies", () => {
    const rows = [
      { name: "alpha", note: "ledger" },
      { name: "ledger", note: "alpha" },
    ];
    const ranked = [...filterAndRank(rows, "ledger", (r) => [r.name])];
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.name).toBe("ledger");
  });
});

describe("filterHighlightRanges — paint ranges", () => {
  test("an empty query paints nothing", () => {
    expect(filterHighlightRanges("", "session-ledger-store")).toEqual([]);
    expect(filterHighlightRanges("  ", "session-ledger-store")).toEqual([]);
  });

  test("an empty text paints nothing", () => {
    expect(filterHighlightRanges("tug", "")).toEqual([]);
  });

  test("a single term paints its span", () => {
    expect(filterHighlightRanges("ledger", "session-ledger-store")).toEqual([
      [8, 14],
    ]);
  });

  test("a non-matching term paints nothing", () => {
    expect(filterHighlightRanges("nope", "session-ledger-store")).toEqual([]);
  });

  test("two terms paint two spans, ordered by start", () => {
    expect(filterHighlightRanges("store session", "session-ledger-store")).toEqual([
      [0, 7],
      [15, 20],
    ]);
  });

  test("overlapping term ranges merge into one span", () => {
    expect(filterHighlightRanges("ledge edger", "session-ledger-store")).toEqual([
      [8, 14],
    ]);
  });

  test("adjacent term ranges merge into one span", () => {
    expect(filterHighlightRanges("session -ledger", "session-ledger-store")).toEqual([
      [0, 14],
    ]);
  });

  test("only the terms that match this string contribute", () => {
    // "tame" matches nothing in the title; "ledger" does.
    expect(filterHighlightRanges("ledger tame", "session-ledger-store")).toEqual([
      [8, 14],
    ]);
  });

  test("ranges index the string passed in, not any source field", () => {
    const displayed = "session-ledger-store…";
    const [range] = filterHighlightRanges("store", displayed);
    expect(displayed.slice(range![0], range![1])).toBe("store");
  });
});
