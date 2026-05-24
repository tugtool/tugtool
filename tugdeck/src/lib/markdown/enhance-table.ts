/**
 * `enhanceTable` — DOM-walks a markdown block container after its
 * `innerHTML` is set, finds every `<table data-tugx-large-table="true">`
 * the `largeTableTransformer` marked, parses its headers + rows out
 * of the DOM, and replaces it with a React-mounted `<TableBlock>`
 * (sortable columns, sticky `<thead>`, cell-overflow tooltips,
 * Copy-as-TSV, fold cue).
 *
 * Sibling of `enhanceFencedCode`, `enhanceImg`, `enhanceMath`, and
 * `enhanceMermaid`. Same call site (`render-incremental.ts`), same
 * idempotency contract (a `data-tugx-table-enhanced="true"` flag on
 * the mount-point), same "fire after `innerHTML` write" timing.
 *
 * Distinct from the other enhancers in one important way: this
 * enhancer mounts a real React tree via `ReactDOM.createRoot`,
 * because `TableBlock` is a stateful React component (sort state,
 * fold state, [A9] preservation) and re-deriving its behaviour
 * imperatively would duplicate a non-trivial primitive. The other
 * enhancers write SVG / HTML directly because their components
 * (mermaid diagrams, KaTeX math, lazy-loaded images) have no React
 * state.
 *
 * # Root lifecycle
 *
 * `createRoot(container)` holds an internal reference to `container`,
 * so when the markdown reconciler wipes a block's `innerHTML` for an
 * incremental update, the mount-points inside vanish from the DOM
 * but the React roots that owned them stay alive — a memory leak
 * that grows with each table re-render. React 19 also warns in dev
 * about "You called ReactDOM.createRoot() and forgot to call
 * root.unmount() before the element was removed from the document."
 *
 * The fix is bookkeeping at this layer: every root + mount-point pair
 * lives in a module-level `Set`. Before each enhance pass, we sweep
 * the set and `root.unmount()` any whose `mountPoint.isConnected`
 * is `false`. The sweep cost is O(roots-in-flight); a Tide session
 * with a handful of tables on screen pays nothing measurable.
 *
 * Markdown wipes always run synchronously before the next enhance
 * pass, so a sweep at the head of `enhanceTable` is correctly timed:
 * any roots whose containers got wiped by the just-completed
 * `innerHTML` write are guaranteed disconnected.
 *
 * Laws: [L06] appearance via DOM / CSS / React render, not via
 *       app-level React state writes for visuals. The TableBlock
 *       itself owns its sort + fold state as local component state,
 *       which is correct (logical state, not appearance state).
 *
 * @module lib/markdown/enhance-table
 */

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  TableBlock,
  type TableData,
} from "@/components/tugways/body-kinds/table-block";
import { TugTooltipProvider } from "@/components/tugways/tug-tooltip";

const TABLE_SELECTOR =
  'table[data-tugx-large-table="true"]:not([data-tugx-table-enhanced])';

const ENHANCED_ATTR = "data-tugx-table-enhanced";

/**
 * Active root registry — every root we create lives here until its
 * mount-point gets disconnected. Module-level so a Tide session's
 * many block re-renders all share the same sweep loop.
 */
const ACTIVE_ROOTS: Set<{ root: Root; mountPoint: HTMLElement }> = new Set();

/**
 * Walk every `<th>` cell in the first row of the table's `<thead>`
 * and return its text content. Returns an empty array when the table
 * has no `<thead>` or the head row carries no cells.
 *
 * Exported for unit tests.
 */
export function parseTableHeaders(table: HTMLTableElement): string[] {
  const thead = table.querySelector("thead");
  if (thead === null) return [];
  const firstRow = thead.querySelector("tr");
  if (firstRow === null) return [];
  const cells = firstRow.querySelectorAll("th, td");
  const out: string[] = [];
  for (const cell of cells) {
    out.push((cell.textContent ?? "").trim());
  }
  return out;
}

/**
 * Walk every `<tr>` row in the table's `<tbody>` (or in the table
 * directly when no `<tbody>` is present) and return each row's cell
 * text contents as a flat string array. Skips rows that contain no
 * `<td>` cells (e.g. a header row that's not inside `<thead>`).
 *
 * Exported for unit tests.
 */
export function parseTableRows(table: HTMLTableElement): string[][] {
  const tbody = table.querySelector("tbody") ?? table;
  const rows = tbody.querySelectorAll("tr");
  const out: string[][] = [];
  for (const row of rows) {
    const cells = row.querySelectorAll("td");
    if (cells.length === 0) continue;
    const rowCells: string[] = [];
    for (const cell of cells) {
      rowCells.push((cell.textContent ?? "").trim());
    }
    out.push(rowCells);
  }
  return out;
}

/**
 * Parse the headers + rows out of a DOM `<table>` into the
 * `TableData` shape the React `TableBlock` consumes. Pure over the
 * DOM input; exported for unit tests.
 */
export function parseTableData(table: HTMLTableElement): TableData {
  return {
    headers: parseTableHeaders(table),
    rows: parseTableRows(table),
  };
}

/**
 * Sweep the active-roots registry, unmounting any entry whose
 * mount-point has been disconnected from the document. Called at the
 * head of every `enhanceTable` pass so the previous tick's wiped
 * tables release their React roots before we create new ones.
 *
 * Exported for tests.
 */
export function sweepStaleRoots(): void {
  for (const entry of ACTIVE_ROOTS) {
    if (!entry.mountPoint.isConnected) {
      entry.root.unmount();
      ACTIVE_ROOTS.delete(entry);
    }
  }
}

/**
 * Test-only: unmount every active root and clear the registry. Used
 * by unit tests that need a hermetic start. Production code never
 * calls this.
 */
export function _resetActiveRootsForTests(): void {
  for (const entry of ACTIVE_ROOTS) {
    entry.root.unmount();
  }
  ACTIVE_ROOTS.clear();
}

/**
 * Walk every unmarked `<table data-tugx-large-table="true">` in
 * `container`, replace it with a React-mounted `<TableBlock>`, and
 * record the new root for later cleanup.
 *
 * Idempotent: tables already carrying `data-tugx-table-enhanced`
 * are skipped, so a re-walk during an incremental update doesn't
 * double-mount.
 */
export function enhanceTable(container: HTMLElement): void {
  sweepStaleRoots();

  const tables = container.querySelectorAll<HTMLTableElement>(TABLE_SELECTOR);
  for (const table of tables) {
    const data = parseTableData(table);
    if (data.headers.length === 0 && data.rows.length === 0) {
      // No usable table content — leave the original `<table>` in
      // place rather than blowing it away with an empty mount.
      table.setAttribute(ENHANCED_ATTR, "true");
      continue;
    }

    const mountPoint = document.createElement("div");
    mountPoint.setAttribute(ENHANCED_ATTR, "true");
    mountPoint.setAttribute("data-slot", "tugx-md-table-mount");
    mountPoint.className = "tugx-md-table-mount";

    const parent = table.parentNode;
    if (parent === null) continue;
    parent.replaceChild(mountPoint, table);

    // The mounted React tree is independent of the app's main root,
    // so any provider the rendered subtree expects must be wrapped
    // here. `TugTooltip` (used per-cell for overflow tooltips) calls
    // into Radix's `Tooltip.Provider`; without the wrapper it throws
    // `Tooltip must be used within TooltipProvider`. Theme tokens
    // flow through CSS variables on the DOM ancestor chain, so
    // TugThemeProvider isn't needed in this isolated root.
    const root = createRoot(mountPoint);
    root.render(
      createElement(
        TugTooltipProvider,
        null,
        createElement(TableBlock, { data }),
      ),
    );
    ACTIVE_ROOTS.add({ root, mountPoint });
  }
}
