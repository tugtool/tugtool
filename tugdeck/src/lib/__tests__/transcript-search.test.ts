import { describe, expect, it } from "bun:test";

import {
  DEFAULT_MATCH_LIMIT,
  compileQuery,
  search,
  type FindOptions,
} from "../transcript-search";

const PLAIN: FindOptions = { caseSensitive: false, wholeWord: false, grep: false };
const opts = (over: Partial<FindOptions>): FindOptions => ({ ...PLAIN, ...over });

describe("transcript-search / search", () => {
  it("returns [] for an empty query", () => {
    expect(search(["hello world"], "", PLAIN)).toEqual([]);
  });

  it("finds a plain substring, case-insensitive by default", () => {
    const rows = ["The Cat sat", "no match here"];
    expect(search(rows, "cat", PLAIN)).toEqual([{ row: 0, start: 4, end: 7 }]);
  });

  it("honors case sensitivity", () => {
    const rows = ["Cat cat CAT"];
    expect(search(rows, "cat", opts({ caseSensitive: true }))).toEqual([
      { row: 0, start: 4, end: 7 },
    ]);
    expect(search(rows, "cat", PLAIN)).toEqual([
      { row: 0, start: 0, end: 3 },
      { row: 0, start: 4, end: 7 },
      { row: 0, start: 8, end: 11 },
    ]);
  });

  it("honors whole-word boundaries", () => {
    const rows = ["cat category scatter cat"];
    expect(search(rows, "cat", opts({ wholeWord: true }))).toEqual([
      { row: 0, start: 0, end: 3 },
      { row: 0, start: 21, end: 24 },
    ]);
  });

  it("treats the query as a regex under grep", () => {
    const rows = ["a1 b2 c3", "zz"];
    expect(search(rows, "[a-z][0-9]", opts({ grep: true }))).toEqual([
      { row: 0, start: 0, end: 2 },
      { row: 0, start: 3, end: 5 },
      { row: 0, start: 6, end: 8 },
    ]);
  });

  it("composes grep + whole-word + case", () => {
    const rows = ["Foo FOObar foo"];
    expect(search(rows, "foo", opts({ grep: true, wholeWord: true }))).toEqual([
      { row: 0, start: 0, end: 3 },
      { row: 0, start: 11, end: 14 },
    ]);
  });

  it("orders matches across rows in flat-row order", () => {
    const rows = ["x x", "", "x"];
    expect(search(rows, "x", PLAIN)).toEqual([
      { row: 0, start: 0, end: 1 },
      { row: 0, start: 2, end: 3 },
      { row: 2, start: 0, end: 1 },
    ]);
  });

  it("returns [] for an invalid grep pattern (no throw)", () => {
    expect(search(["anything"], "(unclosed", opts({ grep: true }))).toEqual([]);
  });

  it("skips zero-width matches without spinning", () => {
    const rows = ["baa b"];
    expect(search(rows, "a*", opts({ grep: true }))).toEqual([
      { row: 0, start: 1, end: 3 },
    ]);
  });

  it("caps the result at the limit", () => {
    expect(search(["aaaaaa"], "a", PLAIN, 3)).toHaveLength(3);
    expect(DEFAULT_MATCH_LIMIT).toBeGreaterThan(0);
  });
});

describe("transcript-search / compileQuery", () => {
  it("returns null for an empty query and invalid grep", () => {
    expect(compileQuery("", PLAIN)).toBeNull();
    expect(compileQuery("(", opts({ grep: true }))).toBeNull();
  });

  it("escapes regex metacharacters when not in grep mode", () => {
    const re = compileQuery("a.b", PLAIN);
    expect(re).not.toBeNull();
    expect(re!.test("axb")).toBe(false);
    expect(re!.test("a.b")).toBe(true);
  });
});
