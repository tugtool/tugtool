/**
 * Pure-logic tests for `SearchResultBlock`'s exported helpers.
 *
 * `SearchResultBlock` is decoration over composition (`TugListView` in
 * `inline` mode + file-header / match cell renderers) — its behaviour
 * *is* these pure helpers:
 *
 *  - `splitMatchSegments` — the match-line highlight: clamps, drops
 *    empties, sorts, and merges raw `spans` into a gap-free run list.
 *  - `buildSearchRows` — the flattening of grouped files into the
 *    `TugListView` row sequence, honouring the collapsed set.
 *  - `totalMatchCount` / `composeFileCountLabel` /
 *    `composeMatchCountLabel` / `composeSearchTruncationLabel` — the
 *    standalone-header annotations.
 *  - `composeSearchResultText` — the Copy affordance's serialization.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions.
 */

import { describe, expect, test } from "bun:test";

import {
  buildSearchRows,
  composeFileCountLabel,
  composeMatchCountLabel,
  composeSearchResultText,
  composeSearchTruncationLabel,
  splitMatchSegments,
  totalMatchCount,
  type SearchResultData,
  type SearchResultFile,
} from "../search-result-block";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FILES: SearchResultFile[] = [
  {
    path: "src/alpha.ts",
    matches: [
      {
        line: 12,
        text: "const useStore = createStore();",
        spans: [[6, 14]],
        before: [{ line: 11, text: "// store wiring" }],
        after: [{ line: 13, text: "export { useStore };" }],
      },
      {
        line: 40,
        text: "useStore.subscribe(listener);",
        spans: [[0, 8]],
      },
    ],
  },
  {
    path: "src/beta.ts",
    matches: [
      {
        line: 5,
        text: "import { useStore } from './alpha';",
        spans: [[9, 17]],
      },
    ],
  },
];

const DATA: SearchResultData = { files: FILES };

// ---------------------------------------------------------------------------
// totalMatchCount / count labels
// ---------------------------------------------------------------------------

describe("totalMatchCount", () => {
  test("sums matches across every file", () => {
    expect(totalMatchCount(DATA)).toBe(3);
  });

  test("an empty result has zero matches", () => {
    expect(totalMatchCount({ files: [] })).toBe(0);
  });
});

describe("composeFileCountLabel / composeMatchCountLabel", () => {
  test("pluralize on the count", () => {
    expect(composeFileCountLabel(0)).toBe("0 files");
    expect(composeFileCountLabel(1)).toBe("1 file");
    expect(composeFileCountLabel(3)).toBe("3 files");
    expect(composeMatchCountLabel(0)).toBe("0 matches");
    expect(composeMatchCountLabel(1)).toBe("1 match");
    expect(composeMatchCountLabel(12)).toBe("12 matches");
  });
});

describe("composeSearchTruncationLabel", () => {
  test("undefined truncatedAt yields no label", () => {
    expect(composeSearchTruncationLabel(undefined)).toBeUndefined();
  });

  test("a truncatedAt total composes the indicator", () => {
    expect(composeSearchTruncationLabel(50)).toBe("truncated at 50 files");
  });
});

// ---------------------------------------------------------------------------
// splitMatchSegments
// ---------------------------------------------------------------------------

describe("splitMatchSegments", () => {
  test("a single mid-line span splits into plain / hit / plain", () => {
    expect(splitMatchSegments("const useStore = x;", [[6, 14]])).toEqual([
      { text: "const ", hit: false },
      { text: "useStore", hit: true },
      { text: " = x;", hit: false },
    ]);
  });

  test("a span at index 0 emits no leading plain run", () => {
    expect(splitMatchSegments("useStore()", [[0, 8]])).toEqual([
      { text: "useStore", hit: true },
      { text: "()", hit: false },
    ]);
  });

  test("a span reaching the end emits no trailing plain run", () => {
    expect(splitMatchSegments("xx match", [[3, 8]])).toEqual([
      { text: "xx ", hit: false },
      { text: "match", hit: true },
    ]);
  });

  test("no spans yields a single plain run", () => {
    expect(splitMatchSegments("plain line", [])).toEqual([
      { text: "plain line", hit: false },
    ]);
  });

  test("an empty line with no spans yields no runs at all", () => {
    expect(splitMatchSegments("", [])).toEqual([]);
  });

  test("unsorted spans are sorted before splitting", () => {
    expect(splitMatchSegments("abcdef", [[4, 6], [0, 2]])).toEqual([
      { text: "ab", hit: true },
      { text: "cd", hit: false },
      { text: "ef", hit: true },
    ]);
  });

  test("overlapping and adjacent spans are merged", () => {
    // [1,3] and [2,5] overlap → [1,5]; [5,7] is adjacent → merges in.
    expect(splitMatchSegments("0123456789", [[1, 3], [2, 5], [5, 7]])).toEqual([
      { text: "0", hit: false },
      { text: "123456", hit: true },
      { text: "789", hit: false },
    ]);
  });

  test("out-of-range spans are clamped to the line length", () => {
    // start past the end is dropped; end past the end clamps.
    expect(splitMatchSegments("abc", [[1, 99], [50, 60]])).toEqual([
      { text: "a", hit: false },
      { text: "bc", hit: true },
    ]);
  });

  test("zero-width and inverted spans are dropped", () => {
    expect(splitMatchSegments("abc", [[1, 1], [3, 2]])).toEqual([
      { text: "abc", hit: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildSearchRows
// ---------------------------------------------------------------------------

describe("buildSearchRows", () => {
  test("with nothing collapsed, every file header is followed by its matches", () => {
    const rows = buildSearchRows(FILES, new Set());
    // 2 file headers + 3 match rows.
    expect(rows.map((r) => r.kind)).toEqual([
      "file",
      "match",
      "match",
      "file",
      "match",
    ]);
    const firstHeader = rows[0];
    if (firstHeader.kind !== "file") throw new Error("unreachable");
    expect(firstHeader.path).toBe("src/alpha.ts");
    expect(firstHeader.matchCount).toBe(2);
    expect(firstHeader.collapsed).toBe(false);
  });

  test("a collapsed file contributes only its header row", () => {
    const rows = buildSearchRows(FILES, new Set(["src/alpha.ts"]));
    expect(rows.map((r) => r.kind)).toEqual(["file", "file", "match"]);
    const collapsedHeader = rows[0];
    if (collapsedHeader.kind !== "file") throw new Error("unreachable");
    expect(collapsedHeader.collapsed).toBe(true);
    // The match count is still reported on a collapsed header.
    expect(collapsedHeader.matchCount).toBe(2);
  });

  test("row ids are stable per position and distinct across rows", () => {
    const rows = buildSearchRows(FILES, new Set());
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Re-running with the same input yields the same ids.
    expect(buildSearchRows(FILES, new Set()).map((r) => r.id)).toEqual(ids);
  });

  test("empty file list yields no rows", () => {
    expect(buildSearchRows([], new Set())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// composeSearchResultText
// ---------------------------------------------------------------------------

describe("composeSearchResultText", () => {
  test("serializes each file path with its matched lines indented", () => {
    expect(composeSearchResultText(DATA)).toBe(
      [
        "src/alpha.ts",
        "  12: const useStore = createStore();",
        "  40: useStore.subscribe(listener);",
        "src/beta.ts",
        "  5: import { useStore } from './alpha';",
      ].join("\n"),
    );
  });

  test("an empty result serializes to the empty string", () => {
    expect(composeSearchResultText({ files: [] })).toBe("");
  });
});
