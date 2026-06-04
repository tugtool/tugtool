/**
 * GalleryListViewFocus — focus-engine proof for `TugListView`.
 *
 * Demonstrates that focus participation is declared **at the point of usage**:
 * `TugListView` imports nothing from the focus engine; the surface (this card)
 * calls `useFocusable` itself and hands the binding down through the list's dumb
 * passthrough props (`containerRef` / `containerTabIndex` / `rowsFocusable`).
 *
 * Two shapes of the "ring on the focused component, selection on the row" model:
 *
 *  - **Container stop**: the surface registers the list's scroll container as one
 *    engine Tab stop (`useFocusable` → `containerRef`); the ring paints on the
 *    container ([P05]) and cell wrappers drop out of the Tab order
 *    (`rowsFocusable={false}`). Used for surfaces where the list itself is the
 *    keyboard target (read-only listings, a transcript). Tab lands one stop on
 *    the container; Arrow/Page scroll natively — no row cursor.
 *
 *  - **Input-subordinate**: the list contributes ZERO Tab stops
 *    (`containerTabIndex={-1}` + `rowsFocusable={false}`, no registration),
 *    deferring the key view + ring to an external owner (a filter input). The
 *    list shows selection on the row.
 *
 * Synthetic fixed data; the point is the focus/tabIndex contract, not content.
 *
 * Laws:
 *  - [L02] data source enters React via `useSyncExternalStore` (TugListView's
 *    contract; this source is a trivial constant store).
 *  - [L19] gallery-card authoring; registered in `gallery-registrations.tsx`.
 */

import "./gallery.css";

import React from "react";

import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import { useFocusable } from "@/components/tugways/use-focusable";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// A trivial fixed data source — N single-line rows, one cell kind.
class FocusDemoDataSource implements TugListViewDataSource {
  constructor(private readonly labels: readonly string[]) {}
  numberOfItems(): number {
    return this.labels.length;
  }
  idForIndex(index: number): string {
    return `focus-row-${index}`;
  }
  kindForIndex(): string {
    return "row";
  }
  subscribe(): () => void {
    // Constant source — never ticks.
    return () => {};
  }
  getVersion(): unknown {
    return this.labels;
  }
  labelAt(index: number): string {
    return this.labels[index] ?? "";
  }
}

const ROWS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];

function FocusRowCell({
  index,
  dataSource,
}: TugListViewCellProps<FocusDemoDataSource>): React.ReactElement {
  return (
    <div style={{ padding: "8px 12px", fontSize: "0.875rem" }}>
      {dataSource.labelAt(index)}
    </div>
  );
}

const CELL_RENDERERS = { row: FocusRowCell };

export function GalleryListViewFocus(): React.ReactElement {
  const containerSource = React.useMemo(() => new FocusDemoDataSource(ROWS), []);
  const subordinateSource = React.useMemo(() => new FocusDemoDataSource(ROWS), []);

  // The surface declares the container-stop list's participation in the Tab
  // walk — it registers the focusable and hands the ref to the list. The list
  // itself knows nothing about the focus engine.
  const containerStopId = React.useId();
  const { focusableRef } = useFocusable({
    id: containerStopId,
    group: "gallery-listview-focus",
    order: 0,
    register: true,
  });

  return (
    <div className="cg-content" data-testid="gallery-list-view-focus">
      {/* ---- Container stop (ring on the component) ---- */}
      <div className="cg-section" data-testid="lv-focus-container-demo">
        <TugLabel className="cg-section-title" data-testid="lv-focus-container-title">
          Container stop — ring on the list
        </TugLabel>
        <div style={{ height: "180px" }}>
          <TugListView<FocusDemoDataSource>
            dataSource={containerSource}
            cellRenderers={CELL_RENDERERS}
            inline
            scrollKey="lv-focus-container"
            containerRef={focusableRef}
            containerTabIndex={0}
            rowsFocusable={false}
          />
        </div>
      </div>

      <TugSeparator />

      {/* ---- Input-subordinate (list contributes no stop) ---- */}
      <div className="cg-section" data-testid="lv-focus-subordinate-demo">
        <TugLabel className="cg-section-title" data-testid="lv-focus-subordinate-title">
          Input-subordinate — list adds no Tab stop
        </TugLabel>
        <div style={{ height: "180px" }}>
          <TugListView<FocusDemoDataSource>
            dataSource={subordinateSource}
            cellRenderers={CELL_RENDERERS}
            inline
            scrollKey="lv-focus-subordinate"
            selectionRequired
            containerTabIndex={-1}
            rowsFocusable={false}
          />
        </div>
      </div>
    </div>
  );
}
