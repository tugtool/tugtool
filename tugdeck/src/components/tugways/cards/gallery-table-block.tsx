/**
 * gallery-table-block.tsx — visual fixture for the rich `TableBlock`
 * shipped in [#step-28].
 *
 * Variants:
 *  1. **Small table (standalone)** — 5 rows × 4 columns; the
 *    standalone frame + header + Copy/Fold cluster sit above; sort
 *    works; striping on by default.
 *  2. **Large table (sortable, sticky `<thead>`)** — 50 rows × 6
 *    columns; the sticky `<thead>` pins inside the scroll region.
 *  3. **No striping** — `striped={false}`; visually flat for compact
 *    table reading.
 *  4. **Empty rows** — header-only table; Copy is disabled.
 *
 * @module components/tugways/cards/gallery-table-block
 */

import React from "react";

import { TableBlock, type TableData } from "@/components/tugways/body-kinds/table-block";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SMALL: TableData = {
  headers: ["name", "type", "bundle size", "notes"],
  rows: [
    ["esbuild", "bundler", "12 MB", "very fast Go-based bundler"],
    ["webpack", "bundler", "8 MB", "longstanding standard"],
    ["rollup", "bundler", "3 MB", "library-first, tree-shaking native"],
    ["vite", "bundler+dev-server", "10 MB", "uses esbuild for dev, rollup for prod"],
    ["parcel", "bundler", "5 MB", "zero-config story"],
  ],
};

const LARGE: TableData = {
  headers: ["id", "name", "owner", "stars", "language", "updated"],
  rows: Array.from({ length: 50 }, (_, i) => [
    String(i + 1).padStart(4, "0"),
    `repo-${i + 1}`,
    i % 3 === 0 ? "alice" : i % 3 === 1 ? "bob" : "carol",
    String(Math.floor(Math.random() * 99999)),
    i % 4 === 0
      ? "typescript"
      : i % 4 === 1
        ? "rust"
        : i % 4 === 2
          ? "python"
          : "go",
    `2026-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, "0")}`,
  ]),
};

const EMPTY: TableData = {
  headers: ["column-a", "column-b", "column-c"],
  rows: [],
};

// ---------------------------------------------------------------------------
// GalleryTableBlock
// ---------------------------------------------------------------------------

export function GalleryTableBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-table-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Small table — standalone frame + Copy/Fold cluster; sortable
          columns (click a header)
        </TugLabel>
        <TableBlock data={SMALL} label="bundlers" />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Large table — 50 rows; scroll inside the body; the `&lt;thead&gt;`
          is sticky within the scroll region
        </TugLabel>
        <TableBlock data={LARGE} label="repositories" />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Small table — no striping (striped=false for compact reading)
        </TugLabel>
        <TableBlock data={SMALL} label="bundlers (no stripes)" striped={false} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Empty — header-only (no rows); Copy is disabled
        </TugLabel>
        <TableBlock data={EMPTY} label="empty" />
      </div>
    </div>
  );
}
