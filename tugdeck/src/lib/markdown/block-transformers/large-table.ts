/**
 * `largeTableTransformer` — marks markdown `<table>` blocks that
 * exceed the size threshold (rows > 10 OR columns > 5) for promotion
 * to the rich `TableBlock` body kind.
 *
 * Per [D07]: small markdown tables stay as plain GFM HTML tables —
 * the browser's native table layout is good enough at small scale,
 * and adding sticky-header / sort chrome to a 3-row table is visual
 * noise. The rich `TableBlock` pays for itself when the table is
 * long enough to scroll OR wide enough to overflow the column count
 * the eye can scan at a glance.
 *
 * The transformer rewrites a promoted block's `type` to `tug-table`
 * and stamps a `data-tugx-large-table="true"` attribute on the
 * `<table>` root so a post-render walker can find it. The HTML body
 * itself stays the same — the plain table still renders correctly
 * as a fallback before any mount-mechanism enhances it.
 *
 * The body-kind mount mechanism (mounting React `TableBlock` into
 * the marked container) is a follow-on: the React primitive is
 * shipped in this step and consumable directly by other paths
 * (tool blocks, gallery cards), but the markdown auto-mount bridge
 * is deferred to a future step. The transformer's `tug-table` type
 * is the contract that mount mechanism keys on.
 *
 * Population history: stubbed in #step-3 as a no-op pass-through;
 * populated in #step-28 alongside the `TableBlock` body kind.
 */

import type { BlockTransformer } from "./index";
import {
  DEFAULT_LARGE_TABLE_COLS,
  DEFAULT_LARGE_TABLE_ROWS,
} from "@/components/tugways/body-kinds/table-block";

/**
 * Match a `<table>` opening tag (with optional attributes). Tolerant
 * of whitespace; case-insensitive.
 */
const TABLE_OPEN_RE = /^\s*<table(\s[^>]*)?>/i;

/**
 * Count the rows in a sanitized table HTML body — `<tr>` tags
 * inside `<tbody>` or directly in the table. Tolerant of either
 * placement (pulldown-cmark emits explicit `<tbody>`; some other
 * producers don't).
 *
 * Pure and exported for unit tests.
 */
export function countTableRows(html: string): number {
  const matches = html.match(/<tr\b/gi);
  if (matches === null) return 0;
  // Subtract 1 for the `<thead>` row pulldown-cmark always emits;
  // the threshold check is about *data* rows, not the header row.
  return Math.max(0, matches.length - 1);
}

/**
 * Count the columns in a sanitized table HTML body — `<th>` tags
 * inside the first `<thead>` row. Pure and exported for unit tests.
 */
export function countTableColumns(html: string): number {
  // Extract the `<thead>` section if present, fall back to the
  // first `<tr>` group otherwise.
  const headerSection = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  const scope = headerSection !== null ? headerSection[1] : html;
  const firstRow = scope.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (firstRow === null) return 0;
  const cells = firstRow[1].match(/<th\b/gi);
  return cells === null ? 0 : cells.length;
}

/**
 * Decide whether a sanitized table HTML block exceeds the promotion
 * threshold. Pure; exported for unit tests.
 */
export function isLargeTable(
  html: string,
  rowsThreshold: number = DEFAULT_LARGE_TABLE_ROWS,
  colsThreshold: number = DEFAULT_LARGE_TABLE_COLS,
): boolean {
  const rows = countTableRows(html);
  if (rows > rowsThreshold) return true;
  const cols = countTableColumns(html);
  return cols > colsThreshold;
}

/**
 * Stamp `data-tugx-large-table="true"` on the `<table>` root so a
 * mount mechanism can find it. Returns the rewritten HTML, or the
 * original when the open tag couldn't be matched (defensive — drift
 * shouldn't ever crash the renderer).
 *
 * Pure and exported for unit tests.
 */
export function markLargeTable(html: string): string {
  const openMatch = html.match(TABLE_OPEN_RE);
  if (openMatch === null) return html;
  // Replace the open tag with one that carries the marker attribute.
  // The existing attribute string (if any) is preserved verbatim;
  // we only inject the data-attr before the closing `>`.
  const existing = openMatch[1] ?? "";
  const replacement = `<table${existing} data-tugx-large-table="true">`;
  return html.replace(TABLE_OPEN_RE, replacement);
}

export const largeTableTransformer: BlockTransformer = {
  name: "large-table",
  transform(block) {
    if (block.type !== "table") return [block];
    if (!isLargeTable(block.html)) return [block];
    return [
      {
        ...block,
        type: "tug-table",
        html: markLargeTable(block.html),
      },
    ];
  },
};
