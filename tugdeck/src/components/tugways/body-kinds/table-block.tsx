/**
 * `TableBlock` — Layer-1 body kind for a rich, sortable table with a
 * sticky header.
 *
 * Per [Spec S02] and [#bk-conformance] items 3–7, `TableBlock` is a
 * body kind with header / scrolling chrome:
 *
 *  - **Sticky `<thead>` within the table's own scroll region.** Note
 *    the conformance note: the body-kind identity-header pin
 *    telescopes via `--tugx-pin-stack-top`; the table's `<thead>`
 *    sticks inside the table's overflow-x scroll region. They can
 *    coexist and operate at different scopes.
 *  - **Sortable columns.** Each header cell is a button; clicking
 *    cycles `null → asc → desc → null`. Sorting is by string
 *    comparison with locale-aware numeric collation so "10" sorts
 *    after "2" rather than before.
 *  - **Cell overflow.** Cells truncate via the standard `text-overflow:
 *    ellipsis` recipe; the truncated cell wraps the value in a
 *    `TugTooltip` (gated on actual clipping via `truncated`) so the
 *    full value is one hover away.
 *  - **Optional row striping** for legibility, on by default; pass
 *    `striped={false}` to disable.
 *
 * Markdown promotion ([D07]): the `largeTableTransformer` walks
 * markdown blocks and promotes a `<table>` block to `tug-table` type
 * when it exceeds the threshold (rows > 10 OR columns > 5). A small
 * table stays as a plain GFM table.
 *
 * Conformance ([#bk-conformance]):
 *  - **Item 3** — sticky `<thead>` inside the table's scroll region;
 *    distinct from the identity-header pin (the wrapper's chrome pin
 *    sits *above* the table's own scroll).
 *  - **Item 4** — `embedded={true}` suppresses the standalone frame
 *    and portals the affordance cluster into the host's actions slot.
 *  - **Item 5** — Copy / Fold use the shared `affordances/` library.
 *  - **Item 6** — owns `--tugx-tabrich-*`; composes `--tugx-block-*`.
 *  - **Item 7** — sort + fold + scroll restore via [A9].
 *
 * Laws:
 *  - [L02] only the [A9] preservation hook reads external state.
 *  - [L06] visible state via DOM attributes — sort direction lives in
 *    React state because it drives row re-ordering (logical state),
 *    not appearance.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="table-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns `--tugx-tabrich-*` slot
 *    family; consumes `--tugx-block-*` for the shared scaffold.
 *
 * @module components/tugways/body-kinds/table-block
 */

import "./table-block.css";

import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { TugTooltip } from "@/components/tugways/tug-tooltip";
import { useChromeActionsTarget } from "@/components/tugways/cards/tool-blocks/tool-block-chrome";

import {
  BlockActionsCluster,
  BlockCopyButton,
  BlockFoldCue,
  useBlockFoldState,
} from "./affordances";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured table-view data — the body's render input.
 *
 * The header row is the column names; each subsequent row is a flat
 * array of cell values. Cell values are strings — callers that want
 * to render JSX or formatted numbers can pre-format upstream.
 */
export interface TableData {
  headers: readonly string[];
  rows: ReadonlyArray<readonly string[]>;
}

/**
 * Default thresholds for `largeTableTransformer`'s promotion check.
 * A markdown table with more than `rowsThreshold` rows OR more than
 * `colsThreshold` columns gets promoted to a rich TableBlock; smaller
 * tables stay as plain GFM tables. Tuned to match audit guidance:
 * 10-row / 5-column is the threshold where a vanilla table starts
 * to feel cramped and the sticky-header + sort affordances pay off.
 */
export const DEFAULT_LARGE_TABLE_ROWS = 10;
export const DEFAULT_LARGE_TABLE_COLS = 5;

export interface TableBlockProps {
  /** The table data to render. */
  data: TableData;

  /**
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolBlockChrome`). When `true` the
   * standalone frame is dropped and the actions cluster portals into
   * the host chrome's actions slot.
   *
   * @default false
   */
  embedded?: boolean;

  /**
   * Optional identity label shown in the standalone header. Ignored
   * in `embedded` mode (the host owns identity there).
   */
  label?: string;

  /**
   * Row striping. On by default — alternating row backgrounds help
   * the eye scan wide tables. Pass `false` for compact tables where
   * the visual texture isn't helpful.
   *
   * @default true
   */
  striped?: boolean;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;

  /**
   * Opt-in key for the [A9] Component State Preservation Protocol.
   * When set, `TableBlock` persists its sort direction and fold flag
   * into `bag.components` so a Developer > Reload restores them.
   */
  componentStatePreservationKey?: string;
}

// ---------------------------------------------------------------------------
// Sort helpers — exported because tests pin them
// ---------------------------------------------------------------------------

export type SortDirection = "asc" | "desc";

/** One sort step — a column index plus the direction. */
export interface SortState {
  columnIndex: number;
  direction: SortDirection;
}

/**
 * Locale-aware collator with `numeric: true` so `"10"` sorts after
 * `"2"` rather than before (default string sort treats them
 * lexically). Module-level so we pay the construction cost once.
 */
const COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Pure: sort `rows` by `columnIndex` in `direction`. Stable sort:
 * rows with equal cell values maintain their original order. Returns
 * a new array; does not mutate `rows`.
 */
export function sortRows(
  rows: ReadonlyArray<readonly string[]>,
  sort: SortState | null,
): ReadonlyArray<readonly string[]> {
  if (sort === null) return rows;
  // Stable sort via `(value, originalIndex)` pairs.
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const aVal = a.row[sort.columnIndex] ?? "";
    const bVal = b.row[sort.columnIndex] ?? "";
    const cmp = COLLATOR.compare(aVal, bVal);
    if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
    // Equal — fall back to original index for stability.
    return a.index - b.index;
  });
  return indexed.map((entry) => entry.row);
}

/**
 * Pure: cycle the sort state through `null → asc → desc → null` for
 * the given column. Clicking a different column resets to `asc`.
 */
export function nextSortState(
  current: SortState | null,
  columnIndex: number,
): SortState | null {
  if (current === null || current.columnIndex !== columnIndex) {
    return { columnIndex, direction: "asc" };
  }
  if (current.direction === "asc") return { columnIndex, direction: "desc" };
  return null;
}

/**
 * Serialize the table to a copy-friendly TSV (tab-separated values).
 * Tab over comma so cell values that contain commas — paths, file
 * descriptions, prose — don't need escaping. Exported for tests.
 */
export function composeTableTSV(data: TableData): string {
  const lines: string[] = [];
  lines.push(data.headers.join("\t"));
  for (const row of data.rows) lines.push(row.join("\t"));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DATA_SLOT_ROOT = "table-body";
const DATA_SLOT_HEADER = "table-header";

export const TableBlock: React.FC<TableBlockProps> = ({
  data,
  embedded = false,
  label,
  striped = true,
  className,
  componentStatePreservationKey,
}) => {
  const [sort, setSort] = React.useState<SortState | null>(null);
  const { collapsed, setCollapsed } = useBlockFoldState({
    defaultCollapsed: false,
    componentStatePreservationKey,
  });

  const sortedRows = React.useMemo(
    () => sortRows(data.rows, sort),
    [data.rows, sort],
  );

  const onHeaderClick = React.useCallback(
    (columnIndex: number) => {
      setSort((prev) => nextSortState(prev, columnIndex));
    },
    [],
  );

  const tsv = React.useMemo(() => composeTableTSV(data), [data]);
  const collapsedLabel = `${data.rows.length.toLocaleString()} ${
    data.rows.length === 1 ? "row" : "rows"
  }`;

  // Actions cluster — Copy + Fold. Body kinds with chrome portal
  // their cluster into the host's actions slot when `embedded={true}`.
  const actionsTarget = useChromeActionsTarget();
  const cluster = (
    <BlockActionsCluster data-slot="table-actions">
      <BlockCopyButton
        getText={() => tsv}
        disabled={data.rows.length === 0}
        aria-label="Copy table as TSV"
      />
      <BlockFoldCue
        collapsed={collapsed}
        onToggle={setCollapsed}
        collapsedLabel={collapsedLabel}
        expandedLabel="Collapse"
        ariaLabelCollapse="Collapse table"
        ariaLabelExpand="Expand table"
        data-slot="table-fold-cue"
      />
    </BlockActionsCluster>
  );

  const table = (
    <div
      className="tugx-tabrich-scroll"
      data-slot="table-scroll"
      data-folded={collapsed ? "true" : undefined}
    >
      {collapsed ? null : (
        <table
          className={cn(
            "tugx-tabrich-table",
            striped ? "tugx-tabrich-table--striped" : null,
          )}
        >
          <thead className="tugx-tabrich-thead">
            <tr>
              {data.headers.map((header, idx) => {
                const isActive = sort?.columnIndex === idx;
                const direction = isActive ? sort.direction : null;
                return (
                  <th
                    key={idx}
                    scope="col"
                    className="tugx-tabrich-th"
                    aria-sort={
                      direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    <button
                      type="button"
                      className="tugx-tabrich-th-button"
                      onClick={() => onHeaderClick(idx)}
                      aria-label={`Sort by ${header}`}
                    >
                      <span className="tugx-tabrich-th-label">{header}</span>
                      <span
                        className="tugx-tabrich-th-sort"
                        aria-hidden="true"
                      >
                        {direction === "asc" ? (
                          <ChevronUp size={12} />
                        ) : direction === "desc" ? (
                          <ChevronDown size={12} />
                        ) : null}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIdx) => (
              <tr key={rowIdx} className="tugx-tabrich-tr">
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx} className="tugx-tabrich-td">
                    <TugTooltip content={cell} side="top" truncated>
                      <span className="tugx-tabrich-td-content">{cell}</span>
                    </TugTooltip>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  if (embedded) {
    // Embedded: drop the standalone frame + header, portal the
    // actions cluster into the chrome's actions slot if available.
    return (
      <>
        <div
          data-slot={DATA_SLOT_ROOT}
          data-embedded="true"
          className={cn("tugx-tabrich", "tugx-tabrich--embedded", className)}
        >
          {table}
        </div>
        {actionsTarget !== null
          ? createPortal(cluster, actionsTarget)
          : null}
      </>
    );
  }

  return (
    <div
      data-slot={DATA_SLOT_ROOT}
      className={cn("tugx-tabrich", className)}
    >
      <div className="tugx-tabrich-header" data-slot={DATA_SLOT_HEADER}>
        {label !== undefined ? (
          <span className="tugx-tabrich-label">{label}</span>
        ) : null}
        <span
          className="tugx-tabrich-count"
          data-slot="table-row-count"
        >
          {collapsedLabel}
        </span>
        {cluster}
      </div>
      {table}
    </div>
  );
};
