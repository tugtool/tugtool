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
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

import { SmartScroll } from "@/lib/smart-scroll";

import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewCellRole,
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
    // Use 20 items + a deep scroll so cell 0 is OUT of the rendered
    // window when `scrollToIndex(-5)` is called. The clamped index 0
    // then routes through the unrendered branch (`SmartScroll.scrollTo`)
    // which writes a real `scrollTop`. Rendered targets go through
    // `scrollIntoView`, which happy-dom does not implement, so we
    // can't observe them via a `scrollTop` assertion.
    const items: DemoItem[] = Array.from({ length: 20 }, (_, i) => ({
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
    setViewportHeight(root, 80);
    setScrollTop(root, 400);
    // Trigger re-window so cell 0 is no longer in the rendered map.
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });
    expect(handleRef.current?.getElementForIndex(0)).toBeNull();

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

// ---------------------------------------------------------------------------
// Step 4 — variable heights via ResizeObserver + height index
// ---------------------------------------------------------------------------
//
// happy-dom doesn't ship `ResizeObserver`; tugdeck's setup-rtl.ts
// installs a no-op stub. Tests in this section install a capturing
// variant per the existing `tug-text-editor-completion-overlay.test.tsx`
// precedent (the "CapturingResizeObserver" pattern documented in the
// plan's Step 4 test-environment note).
//
// The variant exposes a synchronous `fire(entries)` method that
// invokes the captured callback exactly as a real `ResizeObserver`
// would deliver entries. Tests that need to control rAF coalescing
// also override `requestAnimationFrame` to capture queued callbacks
// and drive them manually.

type CapturedEntry = { target: Element; height: number };

class CapturingResizeObserver {
  static instances: CapturingResizeObserver[] = [];

  readonly cb: ResizeObserverCallback;
  readonly observed = new Set<Element>();

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    CapturingResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }
  unobserve(target: Element): void {
    this.observed.delete(target);
  }
  disconnect(): void {
    this.observed.clear();
  }

  /** Synchronously invoke the captured callback with synthetic entries. */
  fire(entries: CapturedEntry[]): void {
    const synthetic: ResizeObserverEntry[] = entries.map(
      (e) =>
        ({
          target: e.target,
          contentRect: {
            x: 0,
            y: 0,
            width: 0,
            height: e.height,
            top: 0,
            left: 0,
            right: 0,
            bottom: e.height,
            toJSON: () => ({}),
          } as DOMRectReadOnly,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        }) as unknown as ResizeObserverEntry,
    );
    this.cb(synthetic, this as unknown as ResizeObserver);
  }
}

describe("TugListView (Step 4 — ResizeObserver + HeightIndex)", () => {
  let originalRO: typeof globalThis.ResizeObserver;
  let originalRAF: typeof globalThis.requestAnimationFrame;
  let originalCancelRAF: typeof globalThis.cancelAnimationFrame;
  let queuedRafCallbacks: FrameRequestCallback[];
  let rafCallCount: number;

  beforeEach(() => {
    CapturingResizeObserver.instances = [];
    originalRO = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      CapturingResizeObserver;

    queuedRafCallbacks = [];
    rafCallCount = 0;
    originalRAF = globalThis.requestAnimationFrame;
    originalCancelRAF = globalThis.cancelAnimationFrame;
    (globalThis as unknown as {
      requestAnimationFrame: (cb: FrameRequestCallback) => number;
    }).requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallCount += 1;
      queuedRafCallbacks.push(cb);
      return queuedRafCallbacks.length;
    };
    (globalThis as unknown as {
      cancelAnimationFrame: (id: number) => void;
    }).cancelAnimationFrame = () => undefined;
  });

  afterEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      originalRO;
    (globalThis as unknown as {
      requestAnimationFrame: typeof globalThis.requestAnimationFrame;
    }).requestAnimationFrame = originalRAF;
    (globalThis as unknown as {
      cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
    }).cancelAnimationFrame = originalCancelRAF;
  });

  /** Drain queued rAF callbacks (FIFO). */
  function flushRaf(): void {
    while (queuedRafCallbacks.length > 0) {
      const cb = queuedRafCallbacks.shift();
      cb?.(performance.now());
    }
  }

  test("ResizeObserver instance is created on mount and observes rendered cells", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    // Two observers per list-view instance, in source order:
    //   instances[0] — cell observer (created in the [dataSource]
    //                  layout effect; observes every rendered cell
    //                  wrapper).
    //   instances[1] — scroll-container observer (created in the
    //                  no-deps layout effect; watches the scroll
    //                  container itself so card resize triggers a
    //                  re-window).
    expect(CapturingResizeObserver.instances.length).toBe(2);
    const cellObserver = CapturingResizeObserver.instances[0];
    const containerObserver = CapturingResizeObserver.instances[1];
    // Cell observer watches every rendered cell.
    expect(cellObserver.observed.size).toBeGreaterThan(0);
    for (const el of cellObserver.observed) {
      expect(el.getAttribute("data-tug-list-cell-index")).not.toBeNull();
    }
    // Container observer watches exactly the scroll container.
    expect(containerObserver.observed.size).toBe(1);
    const observed = Array.from(containerObserver.observed)[0];
    expect(observed.getAttribute("data-slot")).toBe("tug-list-view");
  });

  test("measured heights replace estimates: scrollToIndex offset reflects measurement", () => {
    // 10 items, default estimate 100. After cell 0 measures at 50,
    // the offset for any later index should drop accordingly.
    // (Spacer heights only change if the measured cell is OUTSIDE the
    // rendered window — for cells inside the window, the height-index
    // change manifests through subsequent offset queries, which is
    // what we assert here.)
    const items: DemoItem[] = Array.from({ length: 10 }, (_, i) => ({
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
        delegate={{ estimatedHeightForKind: () => 100 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setScrollTop(root, 0);

    // Pre-measurement: scrollToIndex(5) uses estimates → offset = 500.
    act(() => {
      handleRef.current?.scrollToIndex(5);
    });
    const offsetBefore = root.scrollTop;
    expect(offsetBefore).toBe(500);

    // Fire measurements for cells 0..2 at 50px each.
    const observer = CapturingResizeObserver.instances[0];
    const cells = Array.from(
      container.querySelectorAll(".tug-list-view-cell"),
    ) as HTMLElement[];
    setScrollTop(root, 0);
    act(() => {
      observer.fire([
        { target: cells[0], height: 50 },
        { target: cells[1], height: 50 },
        { target: cells[2], height: 50 },
      ]);
      flushRaf();
    });

    // Post-measurement: scrollToIndex(5) sums measured 0..2 + estimated
    // 3..4 = 3*50 + 2*100 = 350. The offset reflects the new heights.
    act(() => {
      handleRef.current?.scrollToIndex(5);
    });
    expect(root.scrollTop).toBe(350);
    expect(root.scrollTop).not.toBe(offsetBefore);
  });

  test("rapid sequential fires coalesce into one rAF flush", () => {
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
    const observer = CapturingResizeObserver.instances[0];
    const cells = Array.from(
      container.querySelectorAll(".tug-list-view-cell"),
    ) as HTMLElement[];

    const beforeRafCalls = rafCallCount;
    // Fire several callbacks in rapid succession (no rAF flushes in
    // between). Each fire updates the height index but only the
    // first one schedules a rAF; subsequent fires see the queued id
    // and skip scheduling.
    act(() => {
      observer.fire([{ target: cells[0], height: 80 }]);
      observer.fire([{ target: cells[1], height: 90 }]);
      observer.fire([{ target: cells[2], height: 100 }]);
    });
    expect(rafCallCount - beforeRafCalls).toBe(1);

    // Drain the rAF — clears the pending flush, and the next fire
    // schedules a fresh rAF.
    act(() => flushRaf());

    act(() => {
      observer.fire([{ target: cells[0], height: 110 }]);
    });
    expect(rafCallCount - beforeRafCalls).toBe(2);
  });

  test("no-op resize updates (within 0.5px) do not schedule a rAF", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
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
    const observer = CapturingResizeObserver.instances[0];
    const cell0 = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement;

    // First fire establishes the measured height.
    act(() => {
      observer.fire([{ target: cell0, height: 80 }]);
      flushRaf();
    });
    const beforeRafCalls = rafCallCount;

    // Second fire with the same height — should be a no-op (no rAF
    // scheduled, no rerender).
    act(() => {
      observer.fire([{ target: cell0, height: 80 }]);
    });
    expect(rafCallCount).toBe(beforeRafCalls);

    // Sub-pixel change (under 0.5px) — also no-op.
    act(() => {
      observer.fire([{ target: cell0, height: 80.3 }]);
    });
    expect(rafCallCount).toBe(beforeRafCalls);
  });

  test("entries for cells outside the current item range are dropped silently", () => {
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
    const observer = CapturingResizeObserver.instances[0];
    const someCell = container.querySelector(
      ".tug-list-view-cell",
    ) as HTMLElement;

    // Synthesize a stale entry by spoofing data-tug-list-cell-index
    // to an out-of-range value. (In real usage this happens when a
    // cell unmounts after a data-source shrink but the entry was
    // already queued by the browser.)
    const ghost = document.createElement("div");
    ghost.setAttribute("data-tug-list-cell-index", "99");
    expect(() => {
      act(() => {
        observer.fire([
          { target: someCell, height: 80 },
          { target: ghost, height: 50 },
        ]);
        flushRaf();
      });
    }).not.toThrow();
  });

  test("scrollToIndex uses measured heights when available", () => {
    // 10 items, default estimate 100. After measurement, items 0..2
    // have actual height 50 each; index 9's offset should be
    // (3 × 50) + (6 × 100) = 750, not (9 × 100) = 900. Index 9 is
    // outside the initial rendered window (overscan = 3 from index
    // 0), so the call routes through the unrendered branch
    // (`SmartScroll.scrollTo`) and writes an observable `scrollTop`.
    const items: DemoItem[] = Array.from({ length: 10 }, (_, i) => ({
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
        delegate={{ estimatedHeightForKind: () => 100 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const observer = CapturingResizeObserver.instances[0];
    const cells = Array.from(
      container.querySelectorAll(".tug-list-view-cell"),
    ) as HTMLElement[];
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setScrollTop(root, 0);

    // Measure cells 0, 1, 2 at 50px each (smaller than the 100px
    // estimate). Cells 3+ remain unmeasured.
    act(() => {
      observer.fire([
        { target: cells[0], height: 50 },
        { target: cells[1], height: 50 },
        { target: cells[2], height: 50 },
      ]);
      flushRaf();
    });

    // scrollToIndex(9): unrendered target. Estimated offset =
    // measured 0..2 (3 × 50) + estimated 3..8 (6 × 100) = 750.
    act(() => {
      handleRef.current?.scrollToIndex(9);
    });
    expect(root.scrollTop).toBe(750);
  });

  test("steady-state re-renders do not churn the cell observer (stable ref callbacks)", () => {
    // Regression pin for the per-cell ref-callback identity bug:
    // every render used to create a fresh `ref={(el) => ...}` arrow,
    // which fired the old ref with `null` and the new with the
    // element on every commit — causing N unobserves + N observes
    // per re-render across the visible cells. The fix is a stable
    // per-index callback registry; this test asserts a re-render
    // that doesn't change the rendered set produces zero new
    // unobserve calls beyond the initial mount.
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(CapturingResizeObserver.instances.length).toBe(2);
    const cellObserver = CapturingResizeObserver.instances[0];

    // Wrap unobserve to count calls — ref churn would call it once
    // per visible cell on every re-render.
    let unobserveCallsAfterMount = 0;
    const originalUnobserve = cellObserver.unobserve.bind(cellObserver);
    cellObserver.unobserve = (target: Element): void => {
      unobserveCallsAfterMount += 1;
      originalUnobserve(target);
    };

    // Force a steady-state re-render via a no-op data-source tick.
    // The rendered set is unchanged; ref callbacks should reuse
    // their cached identity, so React fires no detach/reattach
    // cycle and `unobserve` is never called.
    act(() => {
      ds._tickForTest();
    });
    act(() => {
      ds._tickForTest();
    });

    expect(unobserveCallsAfterMount).toBe(0);
  });

  test("container resize triggers a re-window via the scroll-container observer", () => {
    // Grow the rendered viewport via the container observer (rather
    // than dispatching a scroll event). Without an observer on the
    // scroll container itself, a card resize would leave the bottom
    // spacer too tall — the rendered window stays at the previous
    // viewport's count even though more cells should fit.
    const items: DemoItem[] = Array.from({ length: 30 }, (_, i) => ({
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
    expect(CapturingResizeObserver.instances.length).toBe(2);
    const containerObserver = CapturingResizeObserver.instances[1];

    const renderedBefore = container.querySelectorAll(
      ".tug-list-view-cell",
    ).length;

    // Grow the container's viewport. Real browsers fire the
    // ResizeObserver after layout; happy-dom doesn't, so the test
    // does it manually by setting `clientHeight` and firing the
    // captured observer with a synthetic entry.
    setViewportHeight(root, 400);
    setScrollTop(root, 0);
    act(() => {
      containerObserver.fire([{ target: root, height: 400 }]);
    });

    const renderedAfter = container.querySelectorAll(
      ".tug-list-view-cell",
    ).length;
    expect(renderedAfter).toBeGreaterThan(renderedBefore);
  });

  test("disconnect on unmount: subsequent fires don't throw", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const { container, unmount } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const observer = CapturingResizeObserver.instances[0];
    const cells = Array.from(
      container.querySelectorAll(".tug-list-view-cell"),
    ) as HTMLElement[];
    expect(observer.observed.size).toBeGreaterThan(0);

    unmount();
    // After unmount the observer is disconnected; firing a stale
    // entry shouldn't throw or update any React state.
    expect(() => {
      observer.fire([{ target: cells[0], height: 99 }]);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Step 5 — Cell reuse contract + delegate lifecycle
// ---------------------------------------------------------------------------
//
// The list view fires three lifecycle callbacks on the consumer-supplied
// delegate:
//
//  - `willDisplay(index)` for each index that just entered the rendered
//    window on this commit.
//  - `didEndDisplaying(index)` for each index that just left the
//    rendered window on this commit.
//  - `onSelect(index)` when the cell wrapper at `index` is clicked.
//
// Order pinned by the implementation: `willDisplay` fires before
// `didEndDisplaying` for any given commit; both fire in numeric-
// ascending order. The tests below validate each callback in
// isolation, plus the order pin and a few edge cases.

interface LifecycleSpy {
  delegate: TugListViewDelegate;
  willDisplay: number[];
  didEndDisplaying: number[];
  onSelect: number[];
  /** Combined call log: "will:N" / "end:N" / "sel:N" in fire order. */
  log: string[];
}

function makeLifecycleSpy(
  extra?: Pick<TugListViewDelegate, "estimatedHeightForKind">,
): LifecycleSpy {
  const spy: LifecycleSpy = {
    delegate: {} as TugListViewDelegate,
    willDisplay: [],
    didEndDisplaying: [],
    onSelect: [],
    log: [],
  };
  spy.delegate = {
    ...(extra ?? {}),
    willDisplay: (i: number) => {
      spy.willDisplay.push(i);
      spy.log.push(`will:${i}`);
    },
    didEndDisplaying: (i: number) => {
      spy.didEndDisplaying.push(i);
      spy.log.push(`end:${i}`);
    },
    onSelect: (i: number) => {
      spy.onSelect.push(i);
      spy.log.push(`sel:${i}`);
    },
  };
  return spy;
}

function renderedIndices(container: HTMLElement | ParentNode): number[] {
  return Array.from(container.querySelectorAll(".tug-list-view-cell"))
    .map((el) =>
      Number.parseInt(
        el.getAttribute("data-tug-list-cell-index") ?? "-1",
        10,
      ),
    )
    .filter((n) => n >= 0)
    .sort((a, b) => a - b);
}

describe("TugListView (Step 5 — delegate lifecycle)", () => {
  test("willDisplay fires for every index in the initial rendered window", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const spy = makeLifecycleSpy({ estimatedHeightForKind: () => 40 });
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={spy.delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );

    const rendered = renderedIndices(container);
    expect(rendered.length).toBeGreaterThan(0);
    // Every rendered index appears in willDisplay exactly once. (The
    // mount-tick may produce two commits, but the rendered set on the
    // second commit equals the first, so the diff is empty.)
    expect(spy.willDisplay.slice().sort((a, b) => a - b)).toEqual(rendered);
    expect(spy.willDisplay.length).toBe(rendered.length);
    expect(spy.didEndDisplaying).toEqual([]);
  });

  test("didEndDisplaying fires for every index that leaves on data-source shrink", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const spy = makeLifecycleSpy({ estimatedHeightForKind: () => 40 });
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={spy.delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );

    const renderedBefore = renderedIndices(container);
    spy.willDisplay = [];
    spy.didEndDisplaying = [];
    spy.log = [];

    // Shrink to 2 items. Indices ≥ 2 must fire didEndDisplaying.
    act(() => {
      ds._setItemsForTest([
        { id: "id-0", kind: "row", label: "Row 0" },
        { id: "id-1", kind: "row", label: "Row 1" },
      ]);
    });

    const renderedAfter = renderedIndices(container);
    const left = renderedBefore.filter((i) => !renderedAfter.includes(i));
    const entered = renderedAfter.filter((i) => !renderedBefore.includes(i));
    expect(spy.didEndDisplaying.slice().sort((a, b) => a - b)).toEqual(
      left.slice().sort((a, b) => a - b),
    );
    expect(spy.willDisplay.slice().sort((a, b) => a - b)).toEqual(
      entered.slice().sort((a, b) => a - b),
    );
  });

  test("scrolling fires didEndDisplaying for cells leaving the viewport and willDisplay for cells entering", () => {
    const items: DemoItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const spy = makeLifecycleSpy({ estimatedHeightForKind: () => 40 });
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={spy.delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;

    const renderedBefore = renderedIndices(container);
    spy.willDisplay = [];
    spy.didEndDisplaying = [];
    spy.log = [];

    // Scroll deep into the list — items 5..14 should be visible
    // (rows at offsets 200..560 with viewport [200, 360]); with
    // overscan 3, rendered range becomes [2, 14).
    setViewportHeight(root, 160);
    setScrollTop(root, 200);
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });

    const renderedAfter = renderedIndices(container);
    const left = renderedBefore.filter((i) => !renderedAfter.includes(i));
    const entered = renderedAfter.filter((i) => !renderedBefore.includes(i));

    expect(left.length).toBeGreaterThan(0);
    expect(entered.length).toBeGreaterThan(0);
    expect(spy.didEndDisplaying.slice().sort((a, b) => a - b)).toEqual(
      left.slice().sort((a, b) => a - b),
    );
    expect(spy.willDisplay.slice().sort((a, b) => a - b)).toEqual(
      entered.slice().sort((a, b) => a - b),
    );
  });

  test("[order pin] willDisplay fires before didEndDisplaying when both happen on the same commit", () => {
    // Set up a viewport offset so the initial render covers a
    // narrow band of cells, then scroll far enough that the new
    // window has no overlap with the old. Both `entered` and `left`
    // are non-empty; the log order pins the contract.
    const items: DemoItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const spy = makeLifecycleSpy({ estimatedHeightForKind: () => 40 });
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={spy.delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;

    spy.willDisplay = [];
    spy.didEndDisplaying = [];
    spy.log = [];

    // Force a window jump that has both leaves and enters.
    setViewportHeight(root, 80);
    setScrollTop(root, 800);
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });

    expect(spy.willDisplay.length).toBeGreaterThan(0);
    expect(spy.didEndDisplaying.length).toBeGreaterThan(0);

    // Every "will:" log entry precedes every "end:" log entry.
    const firstEnd = spy.log.findIndex((s) => s.startsWith("end:"));
    const lastWill = spy.log
      .map((s, i) => (s.startsWith("will:") ? i : -1))
      .filter((i) => i !== -1)
      .pop()!;
    expect(firstEnd).toBeGreaterThan(lastWill);
  });

  test("willDisplay and didEndDisplaying lists are emitted in numeric-ascending order", () => {
    const items: DemoItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const spy = makeLifecycleSpy({ estimatedHeightForKind: () => 40 });
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={spy.delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;

    spy.willDisplay = [];
    spy.didEndDisplaying = [];
    spy.log = [];

    setViewportHeight(root, 80);
    setScrollTop(root, 600);
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });

    // Each list is monotonically non-decreasing.
    for (let i = 1; i < spy.willDisplay.length; i += 1) {
      expect(spy.willDisplay[i]).toBeGreaterThan(spy.willDisplay[i - 1]);
    }
    for (let i = 1; i < spy.didEndDisplaying.length; i += 1) {
      expect(spy.didEndDisplaying[i]).toBeGreaterThan(
        spy.didEndDisplaying[i - 1],
      );
    }
  });

  test("steady-state rerenders (data-source tick that doesn't change the rendered set) fire no lifecycle callbacks", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const spy = makeLifecycleSpy({ estimatedHeightForKind: () => 40 });
    render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={spy.delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );

    spy.willDisplay = [];
    spy.didEndDisplaying = [];
    spy.log = [];

    // Tick without changing items. Same rendered set → empty diff.
    act(() => {
      ds._tickForTest();
    });

    expect(spy.willDisplay).toEqual([]);
    expect(spy.didEndDisplaying).toEqual([]);
  });

  test("onSelect fires on cell click with the clicked index", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const spy = makeLifecycleSpy({ estimatedHeightForKind: () => 40 });
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={spy.delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );

    const cell2 = container.querySelector(
      '[data-tug-list-cell-index="2"]',
    ) as HTMLElement | null;
    expect(cell2).not.toBeNull();
    act(() => {
      cell2?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(spy.onSelect).toEqual([2]);
  });

  test("onSelect does nothing when delegate omits onSelect (no throw)", () => {
    const items: DemoItem[] = Array.from({ length: 3 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const delegate: TugListViewDelegate = {
      estimatedHeightForKind: () => 40,
      // willDisplay / didEndDisplaying / onSelect intentionally omitted.
    };
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const cell0 = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    expect(cell0).not.toBeNull();
    expect(() => {
      act(() => {
        cell0?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }).not.toThrow();
  });

  test("no delegate at all is a no-op (no throw on mount, scroll, click)", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;

    expect(() => {
      setViewportHeight(root, 80);
      setScrollTop(root, 100);
      act(() => {
        root.dispatchEvent(new Event("scroll"));
      });
      const cell0 = container.querySelector(
        '[data-tug-list-cell-index="0"]',
      ) as HTMLElement | null;
      act(() => {
        cell0?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }).not.toThrow();
  });

  test("delegate identity changes mid-life don't refire lifecycle for the steady-state window", () => {
    // A consumer that recreates its delegate object on each render
    // shouldn't see spurious willDisplay/didEndDisplaying fires.
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    let willCount = 0;
    let endCount = 0;
    function makeDelegate(): TugListViewDelegate {
      return {
        estimatedHeightForKind: () => 40,
        willDisplay: () => {
          willCount += 1;
        },
        didEndDisplaying: () => {
          endCount += 1;
        },
      };
    }

    function Host(): React.ReactElement {
      // New delegate identity on every render of Host.
      const delegate = makeDelegate();
      return (
        <TugListView<DemoDataSource>
          dataSource={ds}
          delegate={delegate}
          cellRenderers={CELL_RENDERERS}
        />
      );
    }

    const { rerender } = render(<Host />);
    const willAfterMount = willCount;
    const endAfterMount = endCount;

    // Force a parent rerender → fresh delegate identity, same data,
    // same window. Diff is empty; counts must not advance.
    rerender(<Host />);
    expect(willCount).toBe(willAfterMount);
    expect(endCount).toBe(endAfterMount);
  });

  test("click on a kind without a registered renderer still fires onSelect", () => {
    // The empty-placeholder branch (Step 3) also wires onClick. A
    // consumer relying on selection through unregistered kinds would
    // be unusual, but the wrapper's click contract should be uniform
    // regardless of which render branch produced it.
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
    ]);
    const spy = makeLifecycleSpy({ estimatedHeightForKind: () => 40 });
    // Register only the row renderer — header has no entry.
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={spy.delegate}
        cellRenderers={{ row: RowCell }}
      />,
    );
    const cell0 = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    expect(cell0).not.toBeNull();
    act(() => {
      cell0?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(spy.onSelect).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// Step 6 — SmartScroll integration: auto-follow-bottom + scrollToIndex
// ---------------------------------------------------------------------------
//
// `TugListView` instantiates a `SmartScroll` against its scroll
// container and routes every programmatic scroll-position write
// through it. happy-dom's `scrollIntoView` is a no-op, so the rendered
// branch of `scrollToIndex` is verified by spying on the SmartScroll
// prototype rather than by reading `scrollTop`. The unrendered branch
// is verified by reading `scrollTop` directly (SmartScroll's
// `scrollTo` writes the property synchronously).
//
// `pinToBottom` is also spied on the prototype so the auto-follow tests
// can assert the call was/wasn't made on growth / scroll-up
// independent of any scrollTop read.

describe("TugListView (Step 6 — SmartScroll integration)", () => {
  let originalRO: typeof globalThis.ResizeObserver;
  let originalRAF: typeof globalThis.requestAnimationFrame;
  let originalCancelRAF: typeof globalThis.cancelAnimationFrame;
  let queuedRafCallbacks: FrameRequestCallback[];

  let originalPinToBottom: SmartScroll["pinToBottom"];
  let originalScrollTo: SmartScroll["scrollTo"];
  let originalScrollToElement: SmartScroll["scrollToElement"];

  let pinToBottomCallCount: number;
  let scrollToCalls: Array<{ top?: number; animated?: boolean }>;
  let scrollToElementCallCount: number;

  beforeEach(() => {
    CapturingResizeObserver.instances = [];
    originalRO = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      CapturingResizeObserver;

    queuedRafCallbacks = [];
    originalRAF = globalThis.requestAnimationFrame;
    originalCancelRAF = globalThis.cancelAnimationFrame;
    (globalThis as unknown as {
      requestAnimationFrame: (cb: FrameRequestCallback) => number;
    }).requestAnimationFrame = (cb: FrameRequestCallback) => {
      queuedRafCallbacks.push(cb);
      return queuedRafCallbacks.length;
    };
    (globalThis as unknown as {
      cancelAnimationFrame: (id: number) => void;
    }).cancelAnimationFrame = () => undefined;

    pinToBottomCallCount = 0;
    scrollToCalls = [];
    scrollToElementCallCount = 0;
    originalPinToBottom = SmartScroll.prototype.pinToBottom;
    originalScrollTo = SmartScroll.prototype.scrollTo;
    originalScrollToElement = SmartScroll.prototype.scrollToElement;
    SmartScroll.prototype.pinToBottom = function () {
      pinToBottomCallCount += 1;
      originalPinToBottom.call(this);
    };
    SmartScroll.prototype.scrollTo = function (opts) {
      scrollToCalls.push({ ...opts });
      originalScrollTo.call(this, opts);
    };
    SmartScroll.prototype.scrollToElement = function (el, opts) {
      scrollToElementCallCount += 1;
      originalScrollToElement.call(this, el, opts);
    };
  });

  afterEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      originalRO;
    (globalThis as unknown as {
      requestAnimationFrame: typeof globalThis.requestAnimationFrame;
    }).requestAnimationFrame = originalRAF;
    (globalThis as unknown as {
      cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
    }).cancelAnimationFrame = originalCancelRAF;

    SmartScroll.prototype.pinToBottom = originalPinToBottom;
    SmartScroll.prototype.scrollTo = originalScrollTo;
    SmartScroll.prototype.scrollToElement = originalScrollToElement;
  });

  /** Drain queued rAF callbacks (FIFO). */
  function flushRaf(): void {
    while (queuedRafCallbacks.length > 0) {
      const cb = queuedRafCallbacks.shift();
      cb?.(performance.now());
    }
  }

  test("followBottom defaults to false — no auto-pin on mount", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    expect(pinToBottomCallCount).toBe(0);
  });

  test("followBottom=true pins on mount", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
        followBottom
      />,
    );
    expect(pinToBottomCallCount).toBeGreaterThan(0);
  });

  test("followBottom=true: data-source append pins again", () => {
    const items: DemoItem[] = Array.from({ length: 3 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
        followBottom
      />,
    );
    const callsAfterMount = pinToBottomCallCount;

    act(() => {
      ds._setItemsForTest([
        ...items,
        { id: "id-3", kind: "row" as const, label: "Row 3" },
      ]);
    });

    // At least one additional pin from the growth.
    expect(pinToBottomCallCount).toBeGreaterThan(callsAfterMount);
  });

  test("followBottom=false: data-source append does NOT pin", () => {
    const items: DemoItem[] = Array.from({ length: 3 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );

    act(() => {
      ds._setItemsForTest([
        ...items,
        { id: "id-3", kind: "row" as const, label: "Row 3" },
      ]);
    });

    expect(pinToBottomCallCount).toBe(0);
  });

  test("scroll-up disengages auto-follow: subsequent growth does not pin", () => {
    const items: DemoItem[] = Array.from({ length: 3 }, (_, i) => ({
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
        followBottom
      />,
    );
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    const callsAfterMount = pinToBottomCallCount;

    // Simulate keyboard scroll-up — SmartScroll's keydown handler
    // disengages followBottom for `PageUp` / `Home` / `ArrowUp`.
    act(() => {
      root.dispatchEvent(
        new KeyboardEvent("keydown", { code: "PageUp", bubbles: true }),
      );
    });

    act(() => {
      ds._setItemsForTest([
        ...items,
        { id: "id-3", kind: "row" as const, label: "Row 3" },
      ]);
    });

    // The growth came after disengagement; no additional pin.
    expect(pinToBottomCallCount).toBe(callsAfterMount);
  });

  test("scrollToIndex(rendered_index) routes through SmartScroll.scrollToElement", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const handleRef = React.createRef<TugListViewHandle>();
    render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    // Index 1 is rendered (overscan covers 0..3). scrollToIndex must
    // route through scrollToElement.
    expect(handleRef.current?.getElementForIndex(1)).not.toBeNull();
    const beforeElCalls = scrollToElementCallCount;
    const beforeToCalls = scrollToCalls.length;

    act(() => {
      handleRef.current?.scrollToIndex(1);
    });

    expect(scrollToElementCallCount).toBe(beforeElCalls + 1);
    // No `scrollTo` write — exact rect path.
    expect(scrollToCalls.length).toBe(beforeToCalls);
  });

  test("scrollToIndex(unrendered_index) two-pass: estimated jump then measured correction", () => {
    // Setup: 10 items, estimate 100. Render mounts cells 0..3 with
    // overscan; observer fires for those at 50 each. heightIndex now
    // has cells 0..3 measured at 50.
    const items: DemoItem[] = Array.from({ length: 10 }, (_, i) => ({
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
        delegate={{ estimatedHeightForKind: () => 100 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const observer = CapturingResizeObserver.instances[0];
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    const initialCells = Array.from(
      container.querySelectorAll(".tug-list-view-cell"),
    ) as HTMLElement[];
    setScrollTop(root, 0);

    act(() => {
      observer.fire(
        initialCells.slice(0, 4).map((el) => ({ target: el, height: 50 })),
      );
      flushRaf();
    });

    // scrollToIndex(9) — pass 1: offset = measured 0..3 (4×50) +
    // estimated 4..8 (5×100) = 700. Pass-2 hasn't fired yet — no
    // measurements for cells around index 9 exist.
    const callsBefore = scrollToCalls.length;
    act(() => {
      handleRef.current?.scrollToIndex(9);
    });
    expect(scrollToCalls.length).toBe(callsBefore + 1);
    expect(scrollToCalls[scrollToCalls.length - 1]?.top).toBe(700);
    expect(root.scrollTop).toBe(700);

    // Trigger a re-window so the target row mounts. SmartScroll's
    // scrollTo writes scrollTop directly; happy-dom doesn't fire a
    // synthetic scroll event, so we dispatch one manually.
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });

    // Cell 9 should now be in the rendered window.
    const cellsAfterScroll = Array.from(
      container.querySelectorAll(".tug-list-view-cell"),
    ) as HTMLElement[];
    const cell9 = cellsAfterScroll.find(
      (el) => el.getAttribute("data-tug-list-cell-index") === "9",
    );
    expect(cell9).toBeDefined();

    // Fire ResizeObserver for the rendered cells around index 9.
    // After the rAF flush, the post-commit correction effect
    // recomputes offsetForIndex(9) using the new measurements.
    // The rendered window after the pass-1 jump is [6..9] (overscan
    // 3 from firstVisibleIndex 9); cells 4 and 5 stay unmeasured.
    const cellsToMeasure = cellsAfterScroll.filter((el) => {
      const i = Number.parseInt(
        el.getAttribute("data-tug-list-cell-index") ?? "-1",
        10,
      );
      return i >= 6 && i <= 9;
    });
    act(() => {
      observer.fire(
        cellsToMeasure.map((el) => ({ target: el, height: 50 })),
      );
      flushRaf();
    });

    // offsetForIndex(9) = measured 0..3 (4×50) + estimated 4..5 (2×100)
    // + measured 6..8 (3×50) = 200 + 200 + 150 = 550.
    // Differs from estimated 700 by 150 (>4) → corrective scrollTo.
    const lastCall = scrollToCalls[scrollToCalls.length - 1];
    expect(lastCall?.top).toBe(550);
    expect(root.scrollTop).toBe(550);
  });

  test("scrollToIndex no-correction case: estimated matches measured to within threshold", () => {
    // All cells uniformly at 100 — measurements match the estimate
    // exactly. After scrollToIndex(9) and a follow-up ResizeObserver
    // flush, the post-commit correction recomputes offsetForIndex(9)
    // = same value, sub-threshold drift, no second scrollTo.
    const items: DemoItem[] = Array.from({ length: 10 }, (_, i) => ({
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
        delegate={{ estimatedHeightForKind: () => 100 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const observer = CapturingResizeObserver.instances[0];
    const root = container.querySelector(
      '[data-slot="tug-list-view"]',
    ) as HTMLElement;
    setScrollTop(root, 0);

    const beforeCalls = scrollToCalls.length;
    act(() => {
      handleRef.current?.scrollToIndex(9);
    });
    expect(scrollToCalls.length).toBe(beforeCalls + 1);
    expect(scrollToCalls[scrollToCalls.length - 1]?.top).toBe(900);

    // Trigger re-window; cell 9 mounts.
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });
    const cell9 = container.querySelector(
      '[data-tug-list-cell-index="9"]',
    ) as HTMLElement | null;
    expect(cell9).not.toBeNull();

    // Measure cell 9 at the same height as the estimate. Offset is
    // unchanged; correction skipped.
    act(() => {
      observer.fire([{ target: cell9!, height: 100 }]);
      flushRaf();
    });

    expect(scrollToCalls.length).toBe(beforeCalls + 1);
  });

  test("scrollToIndex(NaN) is a no-op: no scroll write", () => {
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const handleRef = React.createRef<TugListViewHandle>();
    render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const beforeCalls = scrollToCalls.length;
    const beforeElCalls = scrollToElementCallCount;

    act(() => {
      handleRef.current?.scrollToIndex(Number.NaN);
    });

    expect(scrollToCalls.length).toBe(beforeCalls);
    expect(scrollToElementCallCount).toBe(beforeElCalls);
  });

  test("scrollToIndex on empty data source is a no-op: no scroll write", () => {
    const ds = new DemoDataSource([]);
    const handleRef = React.createRef<TugListViewHandle>();
    render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        delegate={{ estimatedHeightForKind: () => 40 }}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const beforeCalls = scrollToCalls.length;
    const beforeElCalls = scrollToElementCallCount;

    act(() => {
      handleRef.current?.scrollToIndex(0);
    });

    expect(scrollToCalls.length).toBe(beforeCalls);
    expect(scrollToElementCallCount).toBe(beforeElCalls);
  });

  test("scrollToIndex(-1) clamps to 0", () => {
    // Use 20 items + a deep scroll so cell 0 is unrendered when
    // scrollToIndex(-1) is called; the clamped index 0 then writes a
    // real scrollTop via the unrendered branch.
    const items: DemoItem[] = Array.from({ length: 20 }, (_, i) => ({
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
    setViewportHeight(root, 80);
    setScrollTop(root, 400);
    act(() => {
      root.dispatchEvent(new Event("scroll"));
    });

    act(() => {
      handleRef.current?.scrollToIndex(-1);
    });
    expect(root.scrollTop).toBe(0);
  });

  test("scrollToIndex(numberOfItems) clamps to last item", () => {
    const items: DemoItem[] = Array.from({ length: 10 }, (_, i) => ({
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

    // numberOfItems = 10 → clamped to 9. Cell 9 is unrendered (initial
    // window covers 0..3 with overscan). Offset = 9 × 40 = 360.
    act(() => {
      handleRef.current?.scrollToIndex(10);
    });
    expect(root.scrollTop).toBe(360);
  });
});

// ---------------------------------------------------------------------------
// Step 8.5 — keyboard activation, ARIA roles, scrollToIndex default block,
// focusable-child guard.
// ---------------------------------------------------------------------------
//
// Cells are now `tabIndex={0}` and `role="listitem"`; the scroll
// container is `role="list"`. Keyboard activation routes Enter and
// Space on a focused cell to `delegate.onSelect`. SmartScroll's
// keydown handler ignores keys originating from editable
// descendants (verified at the SmartScroll layer; pinned end-to-end
// here via a list view containing an `<input>` cell). The
// imperative `scrollToIndex` default `block` changed from
// `"nearest"` to `"start"`.

describe("TugListView (Step 8.5 — keyboard activation + ARIA + block default)", () => {
  test("scroll container carries role='list'", () => {
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
    expect(root?.getAttribute("role")).toBe("list");
  });

  test("each cell wrapper carries role='listitem' and tabIndex=0", () => {
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
    const cells = container.querySelectorAll(".tug-list-view-cell");
    expect(cells.length).toBe(2);
    for (const cell of cells) {
      expect(cell.getAttribute("role")).toBe("listitem");
      expect(cell.getAttribute("tabindex")).toBe("0");
    }
  });

  test("getElementForIndex returns a role='listitem' element", () => {
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
    const el = handleRef.current?.getElementForIndex(0);
    expect(el?.getAttribute("role")).toBe("listitem");
  });

  test("Enter on a focused cell fires delegate.onSelect(index)", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const cell1 = container.querySelector(
      '[data-tug-list-cell-index="1"]',
    ) as HTMLElement | null;
    expect(cell1).not.toBeNull();

    act(() => {
      cell1?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onSelectCalls).toEqual([1]);
  });

  test("Space on a focused cell fires delegate.onSelect(index)", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const cell0 = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    act(() => {
      cell0?.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
    });
    expect(onSelectCalls).toEqual([0]);
  });

  test("other keys (e.g. ArrowUp, Tab) do NOT fire delegate.onSelect", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const cell0 = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    for (const key of ["ArrowUp", "ArrowDown", "Tab", "Escape", "a"]) {
      act(() => {
        cell0?.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
    }
    expect(onSelectCalls).toEqual([]);
  });

  test("keydown on an interactive child does NOT fire onSelect (event.target guard)", () => {
    // A cell renderer with a focusable child (button, input). When
    // the child receives the keydown, `event.target` is the child
    // and `event.currentTarget` is the cell wrapper — the guard
    // skips the wrapper's handler so onSelect doesn't double-fire
    // alongside the child's own activation behavior.
    interface EditableItem {
      readonly id: string;
      readonly kind: "editable";
    }
    class EditableDataSource implements TugListViewDataSource {
      private items: EditableItem[];
      private readonly listeners = new Set<() => void>();
      constructor(items: EditableItem[]) {
        this.items = items;
      }
      numberOfItems(): number {
        return this.items.length;
      }
      idForIndex(i: number): string {
        return this.items[i].id;
      }
      kindForIndex(i: number): string {
        return this.items[i].kind;
      }
      subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }
      getVersion(): unknown {
        return 0;
      }
    }
    const EditableCell: TugListViewCellRenderer<EditableDataSource> = () => (
      <input data-testid="cell-input" />
    );

    const ds = new EditableDataSource([{ id: "x", kind: "editable" }]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<EditableDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={{ editable: EditableCell }}
      />,
    );
    const input = container.querySelector(
      '[data-testid="cell-input"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    act(() => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onSelectCalls).toEqual([]);
  });

  test("scrollToIndex(rendered) defaults to block:'start' (was 'nearest')", () => {
    // Spy on SmartScroll.prototype.scrollToElement to capture the
    // options arg. The rendered branch is exercised by indexing a
    // cell that's in the initial overscan window.
    const items: DemoItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      kind: "row" as const,
      label: `Row ${i}`,
    }));
    const ds = new DemoDataSource(items);
    const handleRef = React.createRef<TugListViewHandle>();

    const captured: Array<{ block?: ScrollLogicalPosition; animated?: boolean }> = [];
    const original = SmartScroll.prototype.scrollToElement;
    SmartScroll.prototype.scrollToElement = function (el, opts) {
      captured.push({ ...opts });
      original.call(this, el, opts);
    };

    try {
      render(
        <TugListView<DemoDataSource>
          ref={handleRef}
          dataSource={ds}
          delegate={{ estimatedHeightForKind: () => 40 }}
          cellRenderers={CELL_RENDERERS}
        />,
      );
      act(() => {
        handleRef.current?.scrollToIndex(1);
      });
      expect(captured.length).toBe(1);
      expect(captured[0].block).toBe("start");

      // Explicit `block` still wins.
      captured.length = 0;
      act(() => {
        handleRef.current?.scrollToIndex(2, { block: "nearest" });
      });
      expect(captured[0].block).toBe("nearest");
    } finally {
      SmartScroll.prototype.scrollToElement = original;
    }
  });

  test("ArrowUp keydown inside a cell's <input> does NOT disengage followBottom", () => {
    // Pin the SmartScroll-side editable-target gate end-to-end. A
    // list view with `followBottom` and a cell containing an
    // `<input>` that receives an ArrowUp keydown: the gate keeps
    // SmartScroll's `_isFollowingBottom` engaged, so a subsequent
    // data-source growth still triggers a `pinToBottom` call.
    interface EditableItem {
      readonly id: string;
      readonly kind: "editable";
    }
    class EditableDataSource implements TugListViewDataSource {
      private items: EditableItem[];
      private readonly listeners = new Set<() => void>();
      private version = 0;
      constructor(items: EditableItem[]) {
        this.items = items;
      }
      numberOfItems(): number {
        return this.items.length;
      }
      idForIndex(i: number): string {
        return this.items[i].id;
      }
      kindForIndex(i: number): string {
        return this.items[i].kind;
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
      _appendForTest(item: EditableItem): void {
        this.items = [...this.items, item];
        this.version += 1;
        for (const l of this.listeners) l();
      }
    }
    const EditableCell: TugListViewCellRenderer<EditableDataSource> = () => (
      <input data-testid="cell-input" />
    );

    let pinCount = 0;
    const originalPin = SmartScroll.prototype.pinToBottom;
    SmartScroll.prototype.pinToBottom = function () {
      pinCount += 1;
      originalPin.call(this);
    };

    try {
      const ds = new EditableDataSource([{ id: "a", kind: "editable" }]);
      const { container } = render(
        <TugListView<EditableDataSource>
          dataSource={ds}
          cellRenderers={{ editable: EditableCell }}
          followBottom
        />,
      );
      const input = container.querySelector(
        '[data-testid="cell-input"]',
      ) as HTMLInputElement | null;
      expect(input).not.toBeNull();

      // ArrowUp inside the input would have entered SmartScroll's
      // dragging phase + disengaged followBottom before the gate.
      act(() => {
        input?.dispatchEvent(
          new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true }),
        );
      });

      const pinsBeforeGrow = pinCount;
      act(() => {
        ds._appendForTest({ id: "b", kind: "editable" });
      });
      // The list view's growth-pin gate runs after each commit; if
      // `followBottom` survived the ArrowUp, the new item triggers
      // a fresh pinToBottom call.
      expect(pinCount).toBeGreaterThan(pinsBeforeGrow);
    } finally {
      SmartScroll.prototype.pinToBottom = originalPin;
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 0 — Row roles (header / footer / cell)
// ---------------------------------------------------------------------------
//
// `TugListViewDataSource` accepts an optional `roleForIndex(index)` method
// that classifies each item as `"cell"` (default), `"header"`, or
// `"footer"`. The list view:
//
//   - Sets `data-list-cell-role` on the cell wrapper for non-default roles.
//     Default-role wrappers omit the attribute, preserving the prior DOM.
//   - Sets `tabIndex={-1}` on header / footer wrappers so they are not in
//     the tab order; default-role wrappers keep `tabIndex={0}`.
//   - Short-circuits `delegate.onSelect` dispatch on click and Space/Enter
//     keydown for non-default roles. The cell renderer can still attach
//     its own `onClick` for action-bearing headers/footers.
//   - Re-reads `roleForIndex` at click/keydown time so a role transition
//     between render and click is reflected (no stale closure).
//
// All-cell data sources (every existing consumer pre-Phase-0) continue
// to behave identically — the default fallback at every read point is
// `"cell"`. The drift-prevention test at the bottom of this block pins
// that.

interface RoledItem {
  readonly id: string;
  readonly kind: string;
  readonly role: TugListViewCellRole;
  readonly label: string;
}

class RoledDataSource implements TugListViewDataSource {
  private items: ReadonlyArray<RoledItem>;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(items: ReadonlyArray<RoledItem>) {
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

  roleForIndex(index: number): TugListViewCellRole {
    return this.items[index].role;
  }

  rowAt(index: number): RoledItem {
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

  _setItemsForTest(next: ReadonlyArray<RoledItem>): void {
    this.items = next;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

const RoledLabelCell: TugListViewCellRenderer<RoledDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<RoledDataSource>) => (
  <div data-testid={`roled-${dataSource.rowAt(index).role}`}>
    {dataSource.rowAt(index).label}
  </div>
);

const ROLED_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<RoledDataSource>
> = {
  "header-recents": RoledLabelCell,
  "path-recent": RoledLabelCell,
  "session-new": RoledLabelCell,
  "session-resume": RoledLabelCell,
  "forget-all": RoledLabelCell,
  "loading": RoledLabelCell,
};

describe("TugListView (Phase 0 — row roles)", () => {
  test("default role is 'cell' — data sources without roleForIndex are unaffected", () => {
    // Drift check: a data source that does not implement
    // `roleForIndex` continues to produce default-shape cells. The
    // wrapper has `tabIndex=0`, no `data-list-cell-role` attribute,
    // and a click fires `onSelect` exactly as before.
    const ds = new DemoDataSource([
      { id: "a", kind: "row", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={CELL_RENDERERS}
      />,
    );
    const cells = container.querySelectorAll(".tug-list-view-cell");
    expect(cells.length).toBe(2);
    for (const cell of cells) {
      expect(cell.getAttribute("tabindex")).toBe("0");
      expect(cell.hasAttribute("data-list-cell-role")).toBe(false);
    }

    const cell0 = cells[0] as HTMLElement;
    act(() => {
      cell0.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectCalls).toEqual([0]);
  });

  test("'header' cells set data-list-cell-role='header' and tabIndex=-1", () => {
    const ds = new RoledDataSource([
      { id: "h-r", kind: "header-recents", role: "header", label: "Recents" },
      { id: "p-1", kind: "path-recent", role: "cell", label: "/Users/Ken/foo" },
      { id: "p-2", kind: "path-recent", role: "cell", label: "/Users/Ken/bar" },
    ]);
    const { container } = render(
      <TugListView<RoledDataSource>
        dataSource={ds}
        cellRenderers={ROLED_CELL_RENDERERS}
      />,
    );
    const headerCell = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    expect(headerCell).not.toBeNull();
    expect(headerCell?.getAttribute("data-list-cell-role")).toBe("header");
    expect(headerCell?.getAttribute("tabindex")).toBe("-1");

    // Adjacent default-role cells are unaffected.
    const dataCell = container.querySelector(
      '[data-tug-list-cell-index="1"]',
    ) as HTMLElement | null;
    expect(dataCell).not.toBeNull();
    expect(dataCell?.hasAttribute("data-list-cell-role")).toBe(false);
    expect(dataCell?.getAttribute("tabindex")).toBe("0");
  });

  test("'footer' cells set data-list-cell-role='footer' and tabIndex=-1", () => {
    const ds = new RoledDataSource([
      { id: "s-n", kind: "session-new", role: "cell", label: "Start fresh" },
      { id: "f-a", kind: "forget-all", role: "footer", label: "Forget all" },
    ]);
    const { container } = render(
      <TugListView<RoledDataSource>
        dataSource={ds}
        cellRenderers={ROLED_CELL_RENDERERS}
      />,
    );
    const footerCell = container.querySelector(
      '[data-tug-list-cell-index="1"]',
    ) as HTMLElement | null;
    expect(footerCell).not.toBeNull();
    expect(footerCell?.getAttribute("data-list-cell-role")).toBe("footer");
    expect(footerCell?.getAttribute("tabindex")).toBe("-1");
  });

  test("clicking a 'header' cell does NOT fire delegate.onSelect", () => {
    const ds = new RoledDataSource([
      { id: "h-r", kind: "header-recents", role: "header", label: "Recents" },
      { id: "p-1", kind: "path-recent", role: "cell", label: "/Users/Ken/foo" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<RoledDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={ROLED_CELL_RENDERERS}
      />,
    );
    const headerCell = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    expect(headerCell).not.toBeNull();
    act(() => {
      headerCell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectCalls).toEqual([]);

    // The default-role neighbor still fires onSelect — the gate is
    // per-cell, not per-list.
    const dataCell = container.querySelector(
      '[data-tug-list-cell-index="1"]',
    ) as HTMLElement | null;
    act(() => {
      dataCell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectCalls).toEqual([1]);
  });

  test("clicking a 'footer' cell does NOT fire delegate.onSelect", () => {
    const ds = new RoledDataSource([
      { id: "s-n", kind: "session-new", role: "cell", label: "Start fresh" },
      { id: "f-a", kind: "forget-all", role: "footer", label: "Forget all" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<RoledDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={ROLED_CELL_RENDERERS}
      />,
    );
    const footerCell = container.querySelector(
      '[data-tug-list-cell-index="1"]',
    ) as HTMLElement | null;
    act(() => {
      footerCell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectCalls).toEqual([]);
  });

  test("Enter / Space on a 'header' cell does NOT fire delegate.onSelect", () => {
    const ds = new RoledDataSource([
      { id: "h-r", kind: "header-recents", role: "header", label: "Recents" },
      { id: "p-1", kind: "path-recent", role: "cell", label: "/Users/Ken/foo" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<RoledDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={ROLED_CELL_RENDERERS}
      />,
    );
    const headerCell = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    expect(headerCell).not.toBeNull();
    for (const key of ["Enter", " "]) {
      act(() => {
        headerCell?.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
    }
    expect(onSelectCalls).toEqual([]);
  });

  test("Enter / Space on a 'footer' cell does NOT fire delegate.onSelect", () => {
    const ds = new RoledDataSource([
      { id: "s-n", kind: "session-new", role: "cell", label: "Start fresh" },
      { id: "f-a", kind: "forget-all", role: "footer", label: "Forget all" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<RoledDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={ROLED_CELL_RENDERERS}
      />,
    );
    const footerCell = container.querySelector(
      '[data-tug-list-cell-index="1"]',
    ) as HTMLElement | null;
    for (const key of ["Enter", " "]) {
      act(() => {
        footerCell?.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
    }
    expect(onSelectCalls).toEqual([]);
  });

  test("mixed list with header + cells + footer dispatches onSelect only on cells", () => {
    // End-to-end picker-shaped enumeration: header-recents, three
    // selectable cells, header-sessions, two more selectable cells,
    // a footer. Click each in order and confirm onSelect fires only
    // for the five non-default rows.
    const ds = new RoledDataSource([
      { id: "h-r", kind: "header-recents", role: "header", label: "Recents" },
      { id: "p-1", kind: "path-recent", role: "cell", label: "/Users/Ken/foo" },
      { id: "p-2", kind: "path-recent", role: "cell", label: "/Users/Ken/bar" },
      { id: "p-3", kind: "path-recent", role: "cell", label: "/Users/Ken/baz" },
      { id: "h-s", kind: "header-recents", role: "header", label: "Sessions" },
      { id: "s-n", kind: "session-new", role: "cell", label: "Start fresh" },
      { id: "s-r-1", kind: "session-resume", role: "cell", label: "first" },
      { id: "f-a", kind: "forget-all", role: "footer", label: "Forget all" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    // `inline` so every cell mounts under happy-dom's zero-clientHeight
    // viewport; the windowed path with viewport=0 would mount only the
    // first overscan cells. Inline matches the picker's usage anyway.
    const { container } = render(
      <TugListView<RoledDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={ROLED_CELL_RENDERERS}
        inline
      />,
    );

    for (let i = 0; i < ds.numberOfItems(); i += 1) {
      const cell = container.querySelector(
        `[data-tug-list-cell-index="${i}"]`,
      ) as HTMLElement | null;
      expect(cell).not.toBeNull();
      act(() => {
        cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(onSelectCalls).toEqual([1, 2, 3, 5, 6]);
  });

  test("role transition is reflected on the next render", () => {
    // A data source ticks and changes role for an existing index. The
    // cell at that index re-renders with the new wrapper attributes
    // and the click gate updates accordingly.
    const ds = new RoledDataSource([
      { id: "x", kind: "session-new", role: "cell", label: "Start fresh" },
    ]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const { container } = render(
      <TugListView<RoledDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={ROLED_CELL_RENDERERS}
      />,
    );
    const cellBefore = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    expect(cellBefore?.hasAttribute("data-list-cell-role")).toBe(false);
    expect(cellBefore?.getAttribute("tabindex")).toBe("0");

    act(() => {
      ds._setItemsForTest([
        { id: "x", kind: "header-recents", role: "header", label: "Recents" },
      ]);
    });

    const cellAfter = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    expect(cellAfter?.getAttribute("data-list-cell-role")).toBe("header");
    expect(cellAfter?.getAttribute("tabindex")).toBe("-1");

    // The cached click callback re-reads role at call time, so a click
    // after the transition does NOT fire onSelect.
    act(() => {
      cellAfter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectCalls).toEqual([]);
  });

  test("data source returning undefined from roleForIndex falls back to 'cell'", () => {
    // Defensive fallback: a data source whose `roleForIndex` returns
    // `undefined` for some indices is treated as the default role.
    // This shape comes up when a consumer's typed data source has an
    // optional internal classifier and an early exit.
    interface PartialItem {
      readonly id: string;
      readonly kind: string;
    }
    class PartialDataSource implements TugListViewDataSource {
      private items: PartialItem[];
      private readonly listeners = new Set<() => void>();
      constructor(items: PartialItem[]) {
        this.items = items;
      }
      numberOfItems(): number {
        return this.items.length;
      }
      idForIndex(i: number): string {
        return this.items[i].id;
      }
      kindForIndex(i: number): string {
        return this.items[i].kind;
      }
      roleForIndex(_i: number): TugListViewCellRole {
        // Simulates a partial classifier — production code wouldn't
        // return undefined from a typed signature, but a `?? "cell"`
        // fallback is the contract documented in the JSDoc.
        return undefined as unknown as TugListViewCellRole;
      }
      subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }
      getVersion(): unknown {
        return 0;
      }
    }

    const ds = new PartialDataSource([{ id: "a", kind: "row" }]);
    const onSelectCalls: number[] = [];
    const delegate: TugListViewDelegate = {
      onSelect: (i) => {
        onSelectCalls.push(i);
      },
    };
    const RowOnly: TugListViewCellRenderer<PartialDataSource> = () => (
      <div data-testid="row-only" />
    );
    const { container } = render(
      <TugListView<PartialDataSource>
        dataSource={ds}
        delegate={delegate}
        cellRenderers={{ row: RowOnly }}
      />,
    );
    const cell = container.querySelector(
      '[data-tug-list-cell-index="0"]',
    ) as HTMLElement | null;
    expect(cell?.hasAttribute("data-list-cell-role")).toBe(false);
    expect(cell?.getAttribute("tabindex")).toBe("0");
    act(() => {
      cell?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectCalls).toEqual([0]);
  });

  test("transcript-shaped data source (no roleForIndex) is unaffected", () => {
    // Drift-prevention: pin that the existing TideTranscriptDataSource
    // shape — no `roleForIndex` method at all — produces default-cell
    // wrappers exactly as in the v1 contract. This test mirrors the
    // shape of `tide-transcript-data-source.ts` (typed adapter, no
    // role method) without depending on the live tide module.
    interface TranscriptItem {
      readonly id: string;
      readonly kind: "user" | "code-committed";
    }
    class TranscriptShapedDataSource implements TugListViewDataSource {
      private readonly items: TranscriptItem[];
      private readonly listeners = new Set<() => void>();
      constructor(items: TranscriptItem[]) {
        this.items = items;
      }
      numberOfItems(): number {
        return this.items.length;
      }
      idForIndex(i: number): string {
        return this.items[i].id;
      }
      kindForIndex(i: number): string {
        return this.items[i].kind;
      }
      // NB: no `roleForIndex` — matches the existing transcript shape.
      subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }
      getVersion(): unknown {
        return 0;
      }
    }
    const ds = new TranscriptShapedDataSource([
      { id: "u-1", kind: "user" },
      { id: "c-1", kind: "code-committed" },
    ]);
    const Renderer: TugListViewCellRenderer<TranscriptShapedDataSource> = () => (
      <div />
    );
    const { container } = render(
      <TugListView<TranscriptShapedDataSource>
        dataSource={ds}
        cellRenderers={{ user: Renderer, "code-committed": Renderer }}
      />,
    );
    const cells = container.querySelectorAll(".tug-list-view-cell");
    expect(cells.length).toBe(2);
    for (const cell of cells) {
      expect(cell.getAttribute("tabindex")).toBe("0");
      expect(cell.hasAttribute("data-list-cell-role")).toBe(false);
    }
  });
});
