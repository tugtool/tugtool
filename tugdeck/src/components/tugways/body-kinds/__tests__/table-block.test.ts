/**
 * Pure-logic tests for `TableBlock`'s exported helpers — sort
 * cycling, locale-aware row sorting, TSV serialization.
 *
 * The component itself is decoration over composition (`<table>` with
 * the affordances library, the chrome actions portal, the
 * `useBlockFoldState` hook) — its visible behaviour *is* the
 * exported pure helpers plus standard composition. The helpers below
 * pin the load-bearing logic exhaustively:
 *
 *  - `sortRows` — stable, locale-aware row sort.
 *  - `nextSortState` — cycles `null → asc → desc → null` per column.
 *  - `composeTableTSV` — copy-to-clipboard serialization.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  composeTableTSV,
  nextSortState,
  sortRows,
  type SortState,
  type TableData,
} from "../table-block";

// ---------------------------------------------------------------------------
// sortRows
// ---------------------------------------------------------------------------

describe("sortRows", () => {
  const ROWS: ReadonlyArray<readonly string[]> = [
    ["alpha", "10", "x"],
    ["bravo", "2", "y"],
    ["charlie", "100", "z"],
  ];

  test("returns the input unchanged when sort is null", () => {
    expect(sortRows(ROWS, null)).toEqual(ROWS);
  });

  test("sorts ascending by string column", () => {
    const sort: SortState = { columnIndex: 0, direction: "asc" };
    expect(sortRows(ROWS, sort)).toEqual([
      ["alpha", "10", "x"],
      ["bravo", "2", "y"],
      ["charlie", "100", "z"],
    ]);
  });

  test("sorts descending by string column", () => {
    const sort: SortState = { columnIndex: 0, direction: "desc" };
    expect(sortRows(ROWS, sort)).toEqual([
      ["charlie", "100", "z"],
      ["bravo", "2", "y"],
      ["alpha", "10", "x"],
    ]);
  });

  test("locale-aware numeric collation: 2 < 10 < 100", () => {
    const sort: SortState = { columnIndex: 1, direction: "asc" };
    expect(sortRows(ROWS, sort)).toEqual([
      ["bravo", "2", "y"],
      ["alpha", "10", "x"],
      ["charlie", "100", "z"],
    ]);
  });

  test("stable sort: rows with equal sort-column values keep original order", () => {
    const rows: ReadonlyArray<readonly string[]> = [
      ["a", "1"],
      ["b", "1"],
      ["c", "2"],
    ];
    const sort: SortState = { columnIndex: 1, direction: "asc" };
    expect(sortRows(rows, sort)).toEqual([
      ["a", "1"],
      ["b", "1"],
      ["c", "2"],
    ]);
  });

  test("tolerates short rows by treating missing cells as empty strings", () => {
    const rows: ReadonlyArray<readonly string[]> = [
      ["a", "z"],
      ["b"],
      ["c", "y"],
    ];
    const sort: SortState = { columnIndex: 1, direction: "asc" };
    // Empty string sorts before non-empty entries.
    expect(sortRows(rows, sort)).toEqual([
      ["b"],
      ["c", "y"],
      ["a", "z"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// nextSortState
// ---------------------------------------------------------------------------

describe("nextSortState", () => {
  test("null → asc on first click of a column", () => {
    expect(nextSortState(null, 2)).toEqual({
      columnIndex: 2,
      direction: "asc",
    });
  });

  test("asc → desc on second click of the same column", () => {
    expect(
      nextSortState({ columnIndex: 1, direction: "asc" }, 1),
    ).toEqual({ columnIndex: 1, direction: "desc" });
  });

  test("desc → null on third click of the same column", () => {
    expect(
      nextSortState({ columnIndex: 1, direction: "desc" }, 1),
    ).toBeNull();
  });

  test("clicking a different column resets to asc", () => {
    expect(
      nextSortState({ columnIndex: 0, direction: "desc" }, 2),
    ).toEqual({ columnIndex: 2, direction: "asc" });
  });
});

// ---------------------------------------------------------------------------
// composeTableTSV
// ---------------------------------------------------------------------------

describe("composeTableTSV", () => {
  test("serializes headers + rows as tab-separated lines", () => {
    const data: TableData = {
      headers: ["name", "size"],
      rows: [
        ["alpha.ts", "1024"],
        ["beta.ts", "512"],
      ],
    };
    expect(composeTableTSV(data)).toBe(
      "name\tsize\nalpha.ts\t1024\nbeta.ts\t512",
    );
  });

  test("emits only the header row when there are no data rows", () => {
    expect(
      composeTableTSV({ headers: ["a", "b"], rows: [] }),
    ).toBe("a\tb");
  });
});
