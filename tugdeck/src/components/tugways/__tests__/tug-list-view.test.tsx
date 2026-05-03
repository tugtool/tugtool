/**
 * TugListView — Step 2 type-contract tests.
 *
 * Step 2 ships the public API surface as types plus a no-op stub
 * component. The tests here verify:
 *   1. A synthetic data source satisfies the `TugListViewDataSource`
 *      contract.
 *   2. A `TugListViewDelegate` accepts the documented members.
 *   3. The cell-renderer type accepts a properly-typed component, and
 *      `cellRenderers: Record<string, TugListViewCellRenderer>` accepts
 *      a kind→renderer map.
 *   4. The component mounts with the right DOM shape (the [L23]
 *      `data-tug-scroll-key` attribute reflects the `scrollKey` prop;
 *      the `tabindex="0"` and `data-slot` markers are present).
 *   5. The imperative handle exposes the documented methods (no-ops in
 *      this step; behavior arrives in Step 6).
 *
 * No windowing, height-index, or SmartScroll behavior is asserted here —
 * those land in Steps 3–6 with their own test suites.
 *
 * Laws: [L02] data-source contract is the entry point; the stub does
 * not yet subscribe (Step 3). [L19] file-pair + `data-slot` verified.
 * [L23] `data-tug-scroll-key` verified.
 */

import "../../../__tests__/setup-rtl";

import React from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

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
  private readonly items: ReadonlyArray<DemoItem>;
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

  // Test hook — bumps version + notifies listeners. Not part of the
  // public TugListViewDataSource contract; specific to this synthetic
  // adapter.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

describe("TugListView (Step 2 — type contract)", () => {
  test("DemoDataSource satisfies the TugListViewDataSource contract", () => {
    // Compile-time: DemoDataSource implements TugListViewDataSource.
    // Runtime: shape sanity — every member is present and behaves.
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

    // getVersion is `Object.is`-stable across calls when no change has
    // landed. The synthetic adapter uses an incrementing number for
    // simplicity; the contract accepts any reference whose identity
    // changes only on real updates.
    const v1 = ds.getVersion();
    const v2 = ds.getVersion();
    expect(Object.is(v1, v2)).toBe(true);

    // Subscribe + tick → listener fires; getVersion identity changes.
    let ticks = 0;
    const unsub = ds.subscribe(() => {
      ticks += 1;
    });
    ds._tickForTest();
    expect(ticks).toBe(1);
    expect(Object.is(v1, ds.getVersion())).toBe(false);
    unsub();
    ds._tickForTest();
    expect(ticks).toBe(1); // unsubscribed
  });

  test("TugListViewDelegate accepts every documented optional member", () => {
    // Compile-time: every member is optional and may be omitted.
    const empty: TugListViewDelegate = {};
    expect(empty).toEqual({});

    // Compile-time: every member, when supplied, has the documented signature.
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
    // Compile-time: the typed cellRenderers map is accepted as a prop.
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
    // Identity check on the typed shape — props is well-formed.
    expect(props.cellRenderers).toBe(cellRenderers);
    expect(props.dataSource).toBe(ds);
  });

  test("stub component mounts with the documented DOM shape", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={{ header: HeaderCell, row: RowCell }}
      />,
    );
    const root = container.querySelector('[data-slot="tug-list-view"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-tug-scroll-key")).toBe("tug-list-view");
    expect(root?.getAttribute("tabindex")).toBe("0");
    expect(root?.classList.contains("tug-list-view")).toBe(true);
    // Step 2 stub renders no cells; the children should be empty.
    expect(root?.children.length).toBe(0);
  });

  test("scrollKey prop overrides the data-tug-scroll-key default", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={{ header: HeaderCell, row: RowCell }}
        scrollKey="demo-scroll-key"
      />,
    );
    const root = container.querySelector('[data-slot="tug-list-view"]');
    expect(root?.getAttribute("data-tug-scroll-key")).toBe("demo-scroll-key");
  });

  test("className prop is appended without replacing the base class", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
    ]);
    const { container } = render(
      <TugListView<DemoDataSource>
        dataSource={ds}
        cellRenderers={{ header: HeaderCell, row: RowCell }}
        className="demo-extra"
      />,
    );
    const root = container.querySelector('[data-slot="tug-list-view"]');
    expect(root?.classList.contains("tug-list-view")).toBe(true);
    expect(root?.classList.contains("demo-extra")).toBe(true);
  });

  test("imperative handle exposes the documented methods (no-ops in Step 2)", () => {
    const ds = new DemoDataSource([
      { id: "a", kind: "header", label: "Alpha" },
      { id: "b", kind: "row", label: "Beta" },
    ]);
    const handleRef = React.createRef<TugListViewHandle>();
    render(
      <TugListView<DemoDataSource>
        ref={handleRef}
        dataSource={ds}
        cellRenderers={{ header: HeaderCell, row: RowCell }}
      />,
    );
    expect(handleRef.current).not.toBeNull();
    // scrollToIndex returns void; calling it is a no-op in Step 2.
    expect(() => handleRef.current?.scrollToIndex(0)).not.toThrow();
    expect(() =>
      handleRef.current?.scrollToIndex(1, { block: "center", animated: false }),
    ).not.toThrow();
    // getElementForIndex always returns null in the stub.
    expect(handleRef.current?.getElementForIndex(0)).toBeNull();
    expect(handleRef.current?.getElementForIndex(99)).toBeNull();
  });
});
