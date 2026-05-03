/**
 * TugListView — type contract + Step 3 component behavior.
 *
 * Three groups of tests:
 *   1. Type contract ([Step 2]): `TugListViewDataSource`, `Delegate`,
 *      `cellRenderers`, `Props` shapes accept their documented inputs.
 *   2. Component behavior ([Step 3]): DOM shape, cell dispatch by
 *      kind, React keys via `idForIndex`, imperative handle.
 *   3. Edge cases ([Step 3]): empty / single-item / out-of-range
 *      indices / data-source shrink mid-render.
 *
 * Step 3 ships fixed-height single-kind windowing. The windowing math
 * itself is unit-tested in `internal/__tests__/list-view-window.test.ts`;
 * here we verify the React component composes the math correctly into
 * the documented DOM shape and reacts to data-source / scroll updates.
 *
 * Laws asserted: [L02] data-source ticks drive rerenders via
 * `useSyncExternalStore`. [L19] file-pair + `data-slot` shape.
 * [L23] `data-tug-scroll-key` reflects `scrollKey` prop.
 */

import "../../../__tests__/setup-rtl";

import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
  type TugListViewDelegate,
  type TugListViewHandle,
  type TugListViewProps,
} from "../tug-list-view";

// ---------------------------------------------------------------------------
// Synthetic data source (typed shape)
// ---------------------------------------------------------------------------

interface DemoItem {
  readonly id: string;
  readonly kind: "header" | "row";
  readonly label: string;
}

class DemoDataSource implements TugListViewDataSource {
  private items: ReadonlyArray<DemoItem>;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(items: ReadonlyArray<DemoItem>) {
    this.items = items;
  }

  numberOfItems(): number {
    return this.items.length;
  }

  idForIndex(index: number): string {
    return this.items[index].id;
  }

  kindForIndex(index: number): string {
    return this.items[index].kind;
  }

  rowAt(index: number): DemoItem {
    return this.items[index];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): unknown {
    return this.version;
  }

  // Test hooks — not part of the public contract.
  _setItemsForTest(next: ReadonlyArray<DemoItem>): void {
    this.items = next;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  _tickForTest(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

// ---------------------------------------------------------------------------
// Cell renderers (typed by the synthetic adapter)
// ---------------------------------------------------------------------------

const HeaderCell: TugListViewCellRenderer<DemoDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<DemoDataSource>) => (
  <div data-testid="demo-header">{`H:${dataSource.rowAt(index).label}`}</div>
);

const RowCell: TugListViewCellRenderer<DemoDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<DemoDataSource>) => (
  <div data-testid="demo-row">{`R:${dataSource.rowAt(index).label}`}</div>
);

const CELL_RENDERERS: Record<string, TugListViewCellRenderer<DemoDataSource>> = {
  header: HeaderCell,
  row: RowCell,
};

// Helpers for happy-dom geometry overrides — happy-dom returns 0 for
// `clientHeight` and doesn't auto-track `scrollTop`. The pattern is
// borrowed from `card-host-region-scroll.test.ts` and friends.
function setViewportHeight(el: HTMLElement, height: number): void {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => height,
  });
}

function setScrollTop(el: HTMLElement, top: number): void {
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    writable: true,
    value: top,
  });
}

// ---------------------------------------------------------------------------
// Type-contract tests (Step 2)
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

describe("TugListView (Step 2 — type contract)", () => {
  test("DemoDataSource satisfies the TugListViewDataSource contract", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
      { id: "c", kind: "row", label: "Gamma" },
    ]);
    expect(ds.numberOfItems()).toBe(3);
    expect(ds.idForIndex(0)).toBe("a");
    expect(ds.idForIndex(2)).toBe("c");
    expect(ds.kindForIndex(0)).toBe("header");
    expect(ds.kindForIndex(1)).toBe("row");

    const v1 = ds.getVersion();
    const v2 = ds.getVersion();
    expect(Object.is(v1, v2)).toBe(true);

    let ticks = 0;
    const unsub = ds.subscribe(() => {
      ticks += 1;
    });
    ds._tickForTest();
    expect(ticks).toBe(1);
    expect(Object.is(v1, ds.getVersion())).toBe(false);
    unsub();
    ds._tickForTest();
    expect(ticks).toBe(1);
  });

  test("TugListViewDelegate accepts every documented optional member", () => {
    const empty: TugListViewDelegate = {};
    expect(empty).toEqual({});

    const withAll: TugListViewDelegate = {
      estimatedHeightForKind: (kind) => (kind === "header" ? 32 : 60),
      willDisplay: (_index) => undefined,
      didEndDisplaying: (_index) => undefined,
      onSelect: (_index) => undefined,
    };
    expect(withAll.estimatedHeightForKind?.("header")).toBe(32);
    expect(withAll.estimatedHeightForKind?.("row")).toBe(60);
  });

  test("cellRenderers accepts a Record<string, TugListViewCellRenderer<DS>>", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
    ]);
    const cellRenderers: Record<
      string,
      TugListViewCellRenderer<DemoDataSource>
    > = {
      header: HeaderCell,
      row: RowCell,
    };
    const props: TugListViewProps<DemoDataSource> = {
      dataSource: ds,
      cellRenderers,
    };
    expect(props.cellRenderers).toBe(cellRenderers);
    expect(props.dataSource).toBe(ds);
  });
});

// ---------------------------------------------------------------------------
// Component behavior tests (Step 3)
// ---------------------------------------------------------------------------

describe("TugListView (Step 3 — DOM shape + dispatch)", () => {
  test("renders the documented DOM shape with top spacer, window, bottom spacer", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector('[data-slot="tug-list-view"]');
    expect(root).not.toBeNull();

    const topSpacer = root?.querySelector(".tug-list-view-spacer--top");
    const windowEl = root?.querySelector(".tug-list-view-window");
    const bottomSpacer = root?.querySelector(".tug-list-view-spacer--bottom");
    expect(topSpacer).not.toBeNull();
    expect(windowEl).not.toBeNull();
    expect(bottomSpacer).not.toBeNull();
  });

  test("dispatches each rendered cell through cellRenderers[kindForIndex(i)]", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
      { id: "c", kind: "row", label: "Gamma" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(container.querySelectorAll('[data-testid="demo-header"]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid="demo-row"]').length).toBe(2);
    expect(container.querySelector('[data-testid="demo-header"]')?.textContent).toBe(
      "H:Alpha",
    );
  });

  test("cell wrapper carries data-tug-list-cell-index and data-tug-list-cell-kind", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const cells = container.querySelectorAll(".tug-list-view-cell");
    expect(cells.length).toBe(2);
    expect(cells[0].getAttribute("data-tug-list-cell-index")).toBe("0");
    expect(cells[0].getAttribute("data-tug-list-cell-kind")).toBe("header");
    expect(cells[1].getAttribute("data-tug-list-cell-index")).toBe("1");
    expect(cells[1].getAttribute("data-tug-list-cell-kind")).toBe("row");
  });

  test("React keys via idForIndex — data-source mutation reorders cells correctly", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(container.querySelectorAll('[data-testid="demo-row"]').length).toBe(2);
    expect(
      Array.from(container.querySelectorAll('[data-testid="demo-row"]')).map(
        (el) => el.textContent,
      ),
    ).toEqual(["R:Alpha", "R:Beta"]);

    // Insert a new item at the front. React reconciler should keep
    // existing components for "a" and "b" mounted; "c" is fresh.
    act(() => {
      ds._setItemsForTest([
        { id: "c", kind: "row", label: "Gamma" },
        { id: "a", kind: "row", label: "Alpha" },
        { id: "b", kind: "row", label: "Beta" },
      ]);
    });
    const labels = Array.from(
      container.querySelectorAll('[data-testid="demo-row"]'),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["R:Gamma", "R:Alpha", "R:Beta"]);
  });

  test("[L23] scrollKey prop drives data-tug-scroll-key", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
        scrollKey="demo-scroll-key"
      />,
    );
    const root = container.querySelector('[data-slot="tug-list-view"]');
    expect(root?.getAttribute("data-tug-scroll-key")).toBe("demo-scroll-key");
  });

  test("scrollKey defaults to tug-list-view when prop is omitted", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector('[data-slot="tug-list-view"]');
    expect(root?.getAttribute("data-tug-scroll-key")).toBe("tug-list-view");
  });

  test("className prop is appended to tug-list-view base class", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
        className="demo-extra"
      />,
    );
    const root = container.querySelector('[data-slot="tug-list-view"]');
    expect(root?.classList.contains("tug-list-view")).toBe(true);
    expect(root?.classList.contains("demo-extra")).toBe(true);
  });

  test("data-source tick triggers a rerender", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(container.querySelectorAll('[data-testid="demo-row"]').length).toBe(1);

    act(() => {
      ds._setItemsForTest([
        { id: "a", kind: "row", label: "Alpha" },
        { id: "b", kind: "row", label: "Beta" },
        { id: "c", kind: "row", label: "Gamma" },
      ]);
    });
    expect(container.querySelectorAll('[data-testid="demo-row"]').length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Imperative handle tests (Step 3)
// ---------------------------------------------------------------------------

describe("TugListView (Step 3 — imperative handle)", () => {
  test("getElementForIndex returns the rendered cell element", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
    ]);
    const handleRef = React.createRef<TugListViewHandle>();
    render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const el0 = handleRef.current?.getElementForIndex(0);
    const el1 = handleRef.current?.getElementForIndex(1);
    expect(el0).not.toBeNull();
    expect(el1).not.toBeNull();
    expect(el0?.getAttribute("data-tug-list-cell-index")).toBe("0");
    expect(el1?.getAttribute("data-tug-list-cell-index")).toBe("1");
  });

  test("getElementForIndex returns null for out-of-range indices", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const handleRef = React.createRef<TugListViewHandle>();
    render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(handleRef.current?.getElementForIndex(-1)).toBeNull();
    expect(handleRef.current?.getElementForIndex(99)).toBeNull();
  });

  test("scrollToIndex writes scrollTop to the cumulative offset", () => {
    // 20 rows, fixed height 40. scrollToIndex(5) → scrollTop=200.
    const items: DemoItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const delegate: TugListViewDelegate = {
      estimatedHeightForKind: () => 40,
    };
    const handleRef = React.createRef<TugListViewHandle>();
    const { container } = render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        delegate={delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setScrollTop(root, 0);

    act(() => {
      handleRef.current?.scrollToIndex(5);
    });
    expect(root.scrollTop).toBe(5 * 40);
  });

  test("scrollToIndex clamps negative indices to 0", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const handleRef = React.createRef<TugListViewHandle>();
    const { container } = render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setScrollTop(root, 80);

    act(() => {
      handleRef.current?.scrollToIndex(-5);
    });
    expect(root.scrollTop).toBe(0);
  });

  test("scrollToIndex clamps indices >= numberOfItems to last item", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const handleRef = React.createRef<TugListViewHandle>();
    const { container } = render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setScrollTop(root, 0);

    act(() => {
      // index 99 clamps to 4 (last); offset = 4*40 = 160.
      handleRef.current?.scrollToIndex(99);
    });
    expect(root.scrollTop).toBe(160);
  });

  test("scrollToIndex(NaN) is a no-op", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const handleRef = React.createRef<TugListViewHandle>();
    const { container } = render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setScrollTop(root, 42);

    act(() => {
      handleRef.current?.scrollToIndex(Number.NaN);
    });
    expect(root.scrollTop).toBe(42);
  });

  test("scrollToIndex on an empty data source is a no-op", () => {
    const ds = new DemoDataSource([]);
    const handleRef = React.createRef<TugListViewHandle>();
    const { container } = render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setScrollTop(root, 7);

    act(() => {
      handleRef.current?.scrollToIndex(0);
    });
    expect(root.scrollTop).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Edge cases (Step 3)
// ---------------------------------------------------------------------------

describe("TugListView (Step 3 — edges)", () => {
  test("empty data source renders no cells; spacer heights are zero", () => {
    const ds = new DemoDataSource([]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(
      container.querySelectorAll(".tug-list-view-cell").length,
    ).toBe(0);
    const topSpacer = container.querySelector(
      ".tug-list-view-spacer--top",
    ) as HTMLElement;
    const bottomSpacer = container.querySelector(
      ".tug-list-view-spacer--bottom",
    ) as HTMLElement;
    expect(topSpacer.style.height).toBe("0px");
    expect(bottomSpacer.style.height).toBe("0px");
  });

  test("single-item data source renders the single cell with zero spacers", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(
      container.querySelectorAll(".tug-list-view-cell").length,
    ).toBe(1);
    const topSpacer = container.querySelector(
      ".tug-list-view-spacer--top",
    ) as HTMLElement;
    const bottomSpacer = container.querySelector(
      ".tug-list-view-spacer--bottom",
    ) as HTMLElement;
    expect(topSpacer.style.height).toBe("0px");
    expect(bottomSpacer.style.height).toBe("0px");
  });

  test("data-source shrink mid-render does not throw or render ghost cells", () => {
    const items: DemoItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(
      container.querySelectorAll(".tug-list-view-cell").length,
    ).toBeGreaterThan(0);

    // Shrink to 2 items. Re-window must complete without error and no
    // cell wrapper should reference an index >= 2.
    act(() => {
      ds._setItemsForTest([
        { id: "id-0", kind: "row", label: "Row 0" },
        { id: "id-1", kind: "row", label: "Row 1" },
      ]);
    });
    const cells = container.querySelectorAll(".tug-list-view-cell");
    expect(cells.length).toBe(2);
    cells.forEach((cell) => {
      const idx = Number.parseInt(
        cell.getAttribute("data-tug-list-cell-index") ?? "",
        10,
      );
      expect(idx).toBeLessThan(2);
    });
  });

  test("kind without a registered renderer renders an empty wrapper and warns", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
    ]);
    // Register only the row renderer — header has no entry.
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={{ row: RowCell }}
      />,
    );
    const cells = container.querySelectorAll(".tug-list-view-cell");
    expect(cells.length).toBe(1);
    expect(cells[0].children.length).toBe(0);
    // We don't assert on console.warn here; the cell still renders an
    // empty placeholder so windowing math stays consistent.
  });

  test("rerender after viewport recompute populates spacer heights", () => {
    // With 20 items at fixed estimated height 40 and the default
    // viewportHeight of 0, the post-mount tick + scroll-listener
    // wiring will produce a window of overscan-only cells. Spacer
    // heights should sum to total - rendered height.
    const items: DemoItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const topSpacer = container.querySelector(
      ".tug-list-view-spacer--top",
    ) as HTMLElement;
    const bottomSpacer = container.querySelector(
      ".tug-list-view-spacer--bottom",
    ) as HTMLElement;
    const renderedCount = container.querySelectorAll(".tug-list-view-cell").length;
    // total = 20*40 = 800. renderedCount * 40 + spacers should sum to 800.
    const topPx = Number.parseInt(topSpacer.style.height || "0", 10);
    const bottomPx = Number.parseInt(bottomSpacer.style.height || "0", 10);
    expect(topPx + renderedCount * 40 + bottomPx).toBe(800);
  });

  test("[L23] data-tug-scroll-key with explicit scrollKey carries through to the rendered DOM", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
        scrollKey="step-3-scroll-key"
      />,
    );
    const root = container.querySelector('[data-slot="tug-list-view"]');
    expect(root?.getAttribute("data-tug-scroll-key")).toBe("step-3-scroll-key");
  });

  test("scrollEvent triggers a re-window", () => {
    const items: DemoItem[] = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setViewportHeight(root, 100);
    setScrollTop(root, 200);
    // Dispatching the scroll event triggers our listener; the next
    // render reads the now-overridden scrollTop / clientHeight.
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });
    // Items at offsets 200, 240, 280 are visible (top in [200, 300]),
    // with overscan 3 → [2, 11). First rendered index has data-tug-list-cell-index >= 2.
    const cells = container.querySelectorAll(".tug-list-view-cell");
    const firstIdx = Number.parseInt(
      cells[0]?.getAttribute("data-tug-list-cell-index") ?? "-1",
      10,
    );
    expect(firstIdx).toBeGreaterThanOrEqual(2);
    // The window should not start at 0 anymore.
    expect(firstIdx).toBeGreaterThan(0);
  });
});
