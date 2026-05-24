/**
 * Pure-logic coverage for `enhance-table` ([#step-28]).
 *
 * The Tier 0 wrapper-creation and Tier 1 attachment helpers live in
 * `enhance-table.ts` and require a real DOM at runtime — they're
 * validated visually (HMR + real-app prompts), not via fake-DOM
 * render tests (project policy: no jsdom / happy-dom).
 *
 * This file pins the *pure* helpers — the sort-cycle state machine
 * and the locale-aware comparator — that determine whether clicking
 * a header reorders rows correctly. They are framework-free, DOM-
 * free, and the only thing standing between "renders a sortable
 * table" and "renders a usable sortable table."
 */

import { describe, expect, test } from "bun:test";

import { compareCells, nextSort, type SortState } from "../enhance-table";

describe("nextSort — sort-cycle state machine", () => {
  test("clicking a different column resets to asc on that column", () => {
    const current: SortState = { column: 0, direction: "asc" };
    expect(nextSort(current, 2)).toEqual({ column: 2, direction: "asc" });
  });

  test("clicking a different column when desc on prior column also resets to asc", () => {
    const current: SortState = { column: 1, direction: "desc" };
    expect(nextSort(current, 3)).toEqual({ column: 3, direction: "asc" });
  });

  test("clicking an unsorted column starts the cycle at asc", () => {
    const unsorted: SortState = { column: null, direction: null };
    expect(nextSort(unsorted, 0)).toEqual({ column: 0, direction: "asc" });
  });

  test("clicking the same column asc advances to desc", () => {
    const current: SortState = { column: 2, direction: "asc" };
    expect(nextSort(current, 2)).toEqual({ column: 2, direction: "desc" });
  });

  test("clicking the same column desc returns to unsorted", () => {
    const current: SortState = { column: 2, direction: "desc" };
    expect(nextSort(current, 2)).toEqual({ column: null, direction: null });
  });

  test("full cycle on one column: null → asc → desc → null", () => {
    let state: SortState = { column: null, direction: null };
    state = nextSort(state, 0);
    expect(state).toEqual({ column: 0, direction: "asc" });
    state = nextSort(state, 0);
    expect(state).toEqual({ column: 0, direction: "desc" });
    state = nextSort(state, 0);
    expect(state).toEqual({ column: null, direction: null });
  });

  test("switching columns mid-cycle is also asc-first on the new column", () => {
    let state: SortState = { column: null, direction: null };
    state = nextSort(state, 0); // {0, asc}
    state = nextSort(state, 0); // {0, desc}
    state = nextSort(state, 1); // jump to column 1
    expect(state).toEqual({ column: 1, direction: "asc" });
  });
});

describe("compareCells — locale-aware numeric collation", () => {
  test("numeric option means '10' sorts after '2', not before", () => {
    expect(compareCells("10", "2", "asc")).toBeGreaterThan(0);
    expect(compareCells("2", "10", "asc")).toBeLessThan(0);
  });

  test("descending direction flips the sign", () => {
    expect(compareCells("10", "2", "desc")).toBeLessThan(0);
    expect(compareCells("2", "10", "desc")).toBeGreaterThan(0);
  });

  test("equal strings compare 0 in both directions (stable tie)", () => {
    expect(compareCells("alpha", "alpha", "asc")).toBe(0);
    expect(compareCells("alpha", "alpha", "desc")).toBe(0);
  });

  test("empty strings sort before non-empty in ascending", () => {
    expect(compareCells("", "anything", "asc")).toBeLessThan(0);
    expect(compareCells("anything", "", "asc")).toBeGreaterThan(0);
  });

  test("case-insensitive base sensitivity treats 'Apple' = 'apple' as a tie", () => {
    expect(compareCells("Apple", "apple", "asc")).toBe(0);
  });

  test("alphabetic ordering — 'a' < 'b' ascending, reverse descending", () => {
    expect(compareCells("apple", "banana", "asc")).toBeLessThan(0);
    expect(compareCells("apple", "banana", "desc")).toBeGreaterThan(0);
  });

  test("mixed alphanumeric — numeric-aware sort runs through embedded numbers", () => {
    expect(compareCells("file2.txt", "file10.txt", "asc")).toBeLessThan(0);
    expect(compareCells("file10.txt", "file2.txt", "asc")).toBeGreaterThan(0);
  });

  test("a small population list sorts numerically, not lexicographically", () => {
    const rows = [
      { rank: "1", country: "China",   pop: "1411" },
      { rank: "2", country: "India",   pop: "1393" },
      { rank: "3", country: "USA",     pop: "331" },
      { rank: "4", country: "Indonesia", pop: "273" },
    ];
    const asc = [...rows].sort((a, b) => compareCells(a.pop, b.pop, "asc"));
    expect(asc.map((r) => r.country)).toEqual([
      "Indonesia", // 273
      "USA",       // 331
      "India",     // 1393
      "China",     // 1411
    ]);
    const desc = [...rows].sort((a, b) => compareCells(a.pop, b.pop, "desc"));
    expect(desc.map((r) => r.country)).toEqual([
      "China",
      "India",
      "USA",
      "Indonesia",
    ]);
  });

  test("Array.prototype.sort is stable: ties preserve insertion order", () => {
    const rows = [
      { tag: "alpha-1", group: "A" },
      { tag: "alpha-2", group: "A" },
      { tag: "alpha-3", group: "A" },
    ];
    const sorted = [...rows].sort((a, b) =>
      compareCells(a.group, b.group, "asc"),
    );
    expect(sorted.map((r) => r.tag)).toEqual([
      "alpha-1",
      "alpha-2",
      "alpha-3",
    ]);
  });
});
