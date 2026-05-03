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
    // Exactly one observer per list-view instance.
    expect(CapturingResizeObserver.instances.length).toBe(1);
    const observer = CapturingResizeObserver.instances[0];
    // Each rendered cell should be observed.
    expect(observer.observed.size).toBeGreaterThan(0);
    // Every observed element carries the cell-index attribute.
    for (const el of observer.observed) {
      expect(el.getAttribute("data-tug-list-cell-index")).not.toBeNull();
    }
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
    // have actual height 50 each; index 3's offset should be 150
    // (3 × 50), not 300 (3 × 100).
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

    // scrollToIndex(3): offset = measured 0..2 (3*50) = 150, not 300.
    act(() => {
      handleRef.current?.scrollToIndex(3);
    });
    expect(root.scrollTop).toBe(150);
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
