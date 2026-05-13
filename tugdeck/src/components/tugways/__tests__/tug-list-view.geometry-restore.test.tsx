/**
 * TugListView — Phase E.9 geometry-restore behavior.
 *
 * Pins the mount-in-saved-state contract for variable-height
 * virtualized lists. When the saved bag carries `meta.cellHeights`,
 * the component:
 *
 *   1. Hydrates the live `HeightIndex` from the array before first
 *      paint, so the anchor-resolve math reads exact heights instead
 *      of estimates.
 *   2. Stashes `meta.anchor` into `restoreAnchorRef` synchronously at
 *      mount, so the companion apply effect lands the right
 *      `scrollTop` on the FIRST commit.
 *   3. Renders each cell with inline `min-height` from the hydrated
 *      array, so async sub-content fills its destined slot without
 *      shifting siblings.
 *
 * These tests target the React/DOM seam — they're happy-dom-safe
 * (component markup + hooks, no focus/selection/event-ordering).
 */

import "../../../__tests__/setup-rtl";

import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import {
  CardComponentStatePreservationContext,
  type CardComponentStatePreservationContextValue,
  type SavedRegionScroll,
} from "../use-component-state-preservation";
import { ComponentStatePreservationRegistry } from "../component-state-preservation-registry";

import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
} from "../tug-list-view";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface Item {
  readonly id: string;
}

class FixedDataSource implements TugListViewDataSource {
  constructor(private readonly count: number) {}
  numberOfItems(): number {
    return this.count;
  }
  idForIndex(index: number): string {
    return `item-${index}`;
  }
  kindForIndex(_index: number): string {
    return "row";
  }
  subscribe(_listener: () => void): () => void {
    return () => undefined;
  }
  getVersion(): unknown {
    return 0;
  }
}

const RowCell: TugListViewCellRenderer<FixedDataSource> = ({
  index,
}: TugListViewCellProps<FixedDataSource>) => (
  <div data-testid={`row-${index}`}>row {index}</div>
);

const CELL_RENDERERS = { row: RowCell };

// ---------------------------------------------------------------------------
// Context helper — render TugListView inside a saved-state context with a
// fabricated region-scroll bag.
// ---------------------------------------------------------------------------

function makeContextValue(
  savedRegionScroll: Record<string, SavedRegionScroll> | undefined,
): CardComponentStatePreservationContextValue {
  return {
    registry: new ComponentStatePreservationRegistry(),
    prefix: "",
    treePath: [],
    getSavedComponentState: () => undefined,
    getSavedRegionScroll: (key: string) =>
      savedRegionScroll ? savedRegionScroll[key] : undefined,
    subscribe: () => () => {},
  };
}

afterEach(() => {
  cleanup();
});

describe("TugListView — Phase E.9 mount-in-saved-state geometry hydration", () => {
  test("with no saved region scroll, cells render without inline min-height", () => {
    const ds = new FixedDataSource(3);
    const { container } = render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue(undefined)}
      >
        <TugListView<FixedDataSource>
          dataSource={ds}
          cellRenderers={CELL_RENDERERS}
          scrollKey="transcript"
        />
      </CardComponentStatePreservationContext.Provider>,
    );
    const cells = container.querySelectorAll<HTMLDivElement>(
      "[data-tug-list-cell-index]",
    );
    for (const cell of cells) {
      expect(cell.style.minHeight).toBe("");
    }
  });

  test("with saved cellHeights, every rendered cell carries the corresponding min-height", () => {
    const ds = new FixedDataSource(4);
    const saved: Record<string, SavedRegionScroll> = {
      transcript: {
        x: 0,
        y: 0,
        meta: {
          // Pretend cells were measured at 100, 80, 120, 60 pixels.
          cellHeights: [100, 80, 120, 60],
          anchor: { index: 0, offset: 0 },
        },
      },
    };
    const { container } = render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue(saved)}
      >
        <TugListView<FixedDataSource>
          dataSource={ds}
          cellRenderers={CELL_RENDERERS}
          scrollKey="transcript"
        />
      </CardComponentStatePreservationContext.Provider>,
    );
    const cells = container.querySelectorAll<HTMLDivElement>(
      "[data-tug-list-cell-index]",
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const index = Number(cell.getAttribute("data-tug-list-cell-index"));
      const expectedHeight = [100, 80, 120, 60][index];
      expect(cell.style.minHeight).toBe(`${expectedHeight}px`);
    }
  });

  test("a zero entry in cellHeights leaves the corresponding cell without a min-height lock", () => {
    const ds = new FixedDataSource(3);
    const saved: Record<string, SavedRegionScroll> = {
      transcript: {
        x: 0,
        y: 0,
        meta: {
          // Index 1 was unmeasured at save time (e.g., never scrolled
          // into view). The hydrated array carries 0 there; the
          // cell wrapper renders without a min-height lock so the
          // cell's natural height drives layout.
          cellHeights: [50, 0, 90],
        },
      },
    };
    const { container } = render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue(saved)}
      >
        <TugListView<FixedDataSource>
          dataSource={ds}
          cellRenderers={CELL_RENDERERS}
          scrollKey="transcript"
        />
      </CardComponentStatePreservationContext.Provider>,
    );
    const cells = container.querySelectorAll<HTMLDivElement>(
      "[data-tug-list-cell-index]",
    );
    const byIndex = new Map<number, HTMLDivElement>();
    for (const cell of cells) {
      byIndex.set(Number(cell.getAttribute("data-tug-list-cell-index")), cell);
    }
    expect(byIndex.get(0)?.style.minHeight).toBe("50px");
    expect(byIndex.get(1)?.style.minHeight).toBe("");
    expect(byIndex.get(2)?.style.minHeight).toBe("90px");
  });

  test("malformed meta (not an object) leaves cells unlocked", () => {
    const ds = new FixedDataSource(3);
    const saved: Record<string, SavedRegionScroll> = {
      transcript: {
        x: 0,
        y: 0,
        // Schema corruption — old payload, unknown shape, etc.
        // Hydration ignores it; cells render unlocked.
        meta: "garbage",
      },
    };
    const { container } = render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue(saved)}
      >
        <TugListView<FixedDataSource>
          dataSource={ds}
          cellRenderers={CELL_RENDERERS}
          scrollKey="transcript"
        />
      </CardComponentStatePreservationContext.Provider>,
    );
    const cells = container.querySelectorAll<HTMLDivElement>(
      "[data-tug-list-cell-index]",
    );
    for (const cell of cells) {
      expect(cell.style.minHeight).toBe("");
    }
  });

  test("undefined scrollKey skips hydration entirely (no saved-state lookup)", () => {
    const ds = new FixedDataSource(2);
    // A saved entry exists in the bag under SOME key, but the
    // TugListView opts out of the region-scroll axis by omitting
    // `scrollKey`. The hydration effect runs but immediately
    // bails because `useSavedRegionScroll(undefined)` returns
    // `undefined`.
    const saved: Record<string, SavedRegionScroll> = {
      "other-key": {
        x: 0,
        y: 0,
        meta: { cellHeights: [99, 99] },
      },
    };
    const { container } = render(
      <CardComponentStatePreservationContext.Provider
        value={makeContextValue(saved)}
      >
        <TugListView<FixedDataSource>
          dataSource={ds}
          cellRenderers={CELL_RENDERERS}
        />
      </CardComponentStatePreservationContext.Provider>,
    );
    const cells = container.querySelectorAll<HTMLDivElement>(
      "[data-tug-list-cell-index]",
    );
    for (const cell of cells) {
      expect(cell.style.minHeight).toBe("");
    }
  });
});
