/**
 * Tests for the `largeTableTransformer` — promotes markdown `<table>`
 * blocks that exceed the size threshold to a `tug-table` type with
 * the `data-tugx-large-table="true"` marker attribute.
 *
 *  - Small tables (≤ row + col thresholds) stay as plain `table`
 *    blocks (pass-through).
 *  - Large tables (rows > 10 OR columns > 5) promote to `tug-table`
 *    with the marker attribute stamped on the `<table>` root.
 *  - Non-table blocks pass through unchanged.
 */

import { describe, expect, test } from "bun:test";

import {
  countTableColumns,
  countTableRows,
  isLargeTable,
  largeTableTransformer,
  markLargeTable,
} from "../block-transformers/large-table";
import type { SanitizedMarkdownBlock } from "../parse-markdown-to-sanitized-blocks";

const NOOP_CTX = { isComplete: true, index: 0 };

function tableHtml(headers: string[], rows: string[][]): string {
  const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function tableBlock(html: string): SanitizedMarkdownBlock {
  return {
    type: "table",
    html,
    startChar: 0,
    endChar: html.length,
    depth: 0,
    itemCount: 0,
    rowCount: 0,
    contentHash: 0n,
  };
}

// ---------------------------------------------------------------------------
// countTableRows / countTableColumns
// ---------------------------------------------------------------------------

describe("countTableRows", () => {
  test("counts data rows, excluding the header row", () => {
    const html = tableHtml(
      ["a", "b"],
      [["1", "2"], ["3", "4"], ["5", "6"]],
    );
    expect(countTableRows(html)).toBe(3);
  });

  test("returns 0 when no `<tr>` is present", () => {
    expect(countTableRows("<table></table>")).toBe(0);
  });
});

describe("countTableColumns", () => {
  test("counts header cells in the first `<thead>` row", () => {
    const html = tableHtml(["a", "b", "c", "d"], [["1", "2", "3", "4"]]);
    expect(countTableColumns(html)).toBe(4);
  });

  test("returns 0 when no `<th>` is present", () => {
    expect(countTableColumns("<table><tbody></tbody></table>")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isLargeTable
// ---------------------------------------------------------------------------

describe("isLargeTable", () => {
  test("small table (3 rows × 2 cols) is not large", () => {
    const html = tableHtml(["a", "b"], [["1", "2"], ["3", "4"], ["5", "6"]]);
    expect(isLargeTable(html)).toBe(false);
  });

  test("rows > 10 triggers promotion", () => {
    const rows = Array.from({ length: 11 }, (_, i) => [String(i), "x"]);
    const html = tableHtml(["a", "b"], rows);
    expect(isLargeTable(html)).toBe(true);
  });

  test("cols > 5 triggers promotion", () => {
    const html = tableHtml(
      ["a", "b", "c", "d", "e", "f"],
      [["1", "2", "3", "4", "5", "6"]],
    );
    expect(isLargeTable(html)).toBe(true);
  });

  test("custom thresholds override the defaults", () => {
    const html = tableHtml(["a", "b"], [["1", "2"], ["3", "4"], ["5", "6"]]);
    expect(isLargeTable(html, 2, 5)).toBe(true);
    expect(isLargeTable(html, 100, 100)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markLargeTable
// ---------------------------------------------------------------------------

describe("markLargeTable", () => {
  test("stamps the data attribute on the `<table>` root", () => {
    const html = tableHtml(["a"], [["1"]]);
    expect(markLargeTable(html)).toContain(
      'data-tugx-large-table="true"',
    );
  });

  test("preserves pre-existing table attributes verbatim", () => {
    const html = '<table class="foo"><thead></thead></table>';
    const out = markLargeTable(html);
    expect(out).toContain('class="foo"');
    expect(out).toContain('data-tugx-large-table="true"');
  });

  test("returns input unchanged when no `<table>` open tag matches", () => {
    expect(markLargeTable("<p>not a table</p>")).toBe("<p>not a table</p>");
  });
});

// ---------------------------------------------------------------------------
// largeTableTransformer
// ---------------------------------------------------------------------------

describe("largeTableTransformer", () => {
  test("promotes a large table to tug-table with the marker attribute", () => {
    const rows = Array.from({ length: 11 }, (_, i) => [String(i), "x"]);
    const block = tableBlock(tableHtml(["a", "b"], rows));
    const out = largeTableTransformer.transform(block, NOOP_CTX);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe("tug-table");
    expect(out[0].html).toContain('data-tugx-large-table="true"');
  });

  test("leaves a small table as plain GFM table", () => {
    const block = tableBlock(
      tableHtml(["a", "b"], [["1", "2"], ["3", "4"]]),
    );
    const out = largeTableTransformer.transform(block, NOOP_CTX);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe("table");
    expect(out[0].html).not.toContain('data-tugx-large-table');
  });

  test("passes non-table blocks through unchanged", () => {
    const block: SanitizedMarkdownBlock = {
      type: "paragraph",
      html: "<p>hi</p>",
      startChar: 0,
      endChar: 9,
      depth: 0,
      itemCount: 0,
      rowCount: 0,
      contentHash: 0n,
    };
    expect(largeTableTransformer.transform(block, NOOP_CTX)).toEqual([block]);
  });
});
