/**
 * GalleryListViewFocus — focus-engine proof for `TugListView` (the listbox model).
 *
 * `TugListView` is one **item-container** stop ([P01]/[P03]): a surface authors
 * it into a `focusGroup` and the list owns the rest — Tab lands the ring on the
 * scroll container, a movement cursor (`data-key-cursor`) traverses the rows
 * under the arrows, Space **selects** the cursor row (`data-selected`), and Enter
 * **descends** into a row whose content holds a focusable (Escape ascends).
 *
 * Two shapes of the "ring on the component, cursor / selection on the row" model:
 *
 *  - **Container stop** (`focusGroup`): the list registers its scroll container
 *    as one engine stop; the ring paints on it ([P05]) and cell wrappers drop out
 *    of the Tab order. Each row here carries an inner focusable button, so Enter
 *    descends onto it and Escape ascends back to the cursor.
 *
 *  - **Input-subordinate** (`keyboardSubordinate`): the list contributes ZERO Tab
 *    stops, deferring the key view + ring to an external owner (a filter input).
 *    Selection still lives on the row.
 *
 * Synthetic fixed data; the point is the focus / tabIndex contract, not content.
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

// Container-stop row: a label plus a focusable "Open" button. The list wraps the
// cell in the row's focus mode, so this button registers into it and becomes the
// descend target — Enter on the cursor row lands the key view here.
function DescendRowCell({
  index,
  dataSource,
}: TugListViewCellProps<FocusDemoDataSource>): React.ReactElement {
  const innerId = React.useId();
  const { focusableRef } = useFocusable({
    id: innerId,
    group: `lv-focus-row-${index}`,
    order: 0,
    register: true,
  });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        fontSize: "0.875rem",
      }}
    >
      <span>{dataSource.labelAt(index)}</span>
      <button
        ref={focusableRef as (el: HTMLButtonElement | null) => void}
        type="button"
        tabIndex={-1}
        data-testid={`lv-focus-row-btn-${index}`}
        style={{ fontSize: "0.75rem", padding: "2px 8px" }}
      >
        Open
      </button>
    </div>
  );
}

// Subordinate row: a plain label (no descend target).
function PlainRowCell({
  index,
  dataSource,
}: TugListViewCellProps<FocusDemoDataSource>): React.ReactElement {
  return (
    <div style={{ padding: "8px 12px", fontSize: "0.875rem" }}>
      {dataSource.labelAt(index)}
    </div>
  );
}

const CONTAINER_CELL_RENDERERS = { row: DescendRowCell };
const SUBORDINATE_CELL_RENDERERS = { row: PlainRowCell };

export function GalleryListViewFocus(): React.ReactElement {
  const containerSource = React.useMemo(() => new FocusDemoDataSource(ROWS), []);
  const subordinateSource = React.useMemo(() => new FocusDemoDataSource(ROWS), []);

  return (
    <div className="cg-content" data-testid="gallery-list-view-focus">
      {/* ---- Container stop — ring on the list, cursor + descend ---- */}
      <div className="cg-section" data-testid="lv-focus-container-demo">
        <TugLabel className="cg-section-title" data-testid="lv-focus-container-title">
          Container stop — ring on the list, arrows move the cursor
        </TugLabel>
        <div style={{ height: "180px" }}>
          <TugListView<FocusDemoDataSource>
            dataSource={containerSource}
            cellRenderers={CONTAINER_CELL_RENDERERS}
            inline
            scrollKey="lv-focus-container"
            focusGroup="gallery-listview-focus"
            focusOrder={0}
          />
        </div>
      </div>

      <TugSeparator />

      {/* ---- Input-subordinate — list contributes no Tab stop ---- */}
      <div className="cg-section" data-testid="lv-focus-subordinate-demo">
        <TugLabel className="cg-section-title" data-testid="lv-focus-subordinate-title">
          Input-subordinate — list adds no Tab stop
        </TugLabel>
        <div style={{ height: "180px" }}>
          <TugListView<FocusDemoDataSource>
            dataSource={subordinateSource}
            cellRenderers={SUBORDINATE_CELL_RENDERERS}
            inline
            scrollKey="lv-focus-subordinate"
            selectionRequired
            keyboardSubordinate
          />
        </div>
      </div>
    </div>
  );
}
