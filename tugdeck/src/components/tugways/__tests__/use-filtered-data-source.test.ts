/**
 * `useFilteredDataSource` — unit tests for the filter-decorator
 * primitive's projection logic.
 *
 * Tests target the `FilteredDataSource` class directly (exported
 * `@internal` from `use-filtered-data-source.ts`). The class is the
 * implementation; the hook is a thin glue layer around it. Pure-
 * logic tests here pin the projection contract without spinning up a
 * React render — that's per the project's preference for keeping
 * test surfaces narrow and fast.
 *
 * The hook's glue (useRef caching, Object.is token comparison,
 * useLayoutEffect notify) is straightforward by inspection;
 * regressions in the glue surface immediately at the consumer (the
 * picker, the gallery filter card) and are caught manually.
 *
 * Coverage:
 *
 *  - Constructor projection (empty / all-pass / no-pass / partial).
 *  - `idForIndex` / `kindForIndex` / `roleForIndex` routing through
 *    `baseIndexFor`.
 *  - `roleForIndex` default of `"cell"` when the base omits the
 *    method.
 *  - Lazy base subscription: attach on first listener, detach on
 *    last.
 *  - Base-tick propagation: a tick on the base triggers recompute
 *    and notifies the wrapper's listeners.
 *  - Promotion / demotion under base mutation.
 *  - Version identity stability under no change; identity change on
 *    every recompute.
 *  - `baseIndexFor` correctness across base reorder.
 *  - `setBase` detaches old, attaches new, recomputes against new.
 *  - `setLatestPredicate` does NOT trigger a recompute on its own.
 */

import { describe, expect, test } from "bun:test";

import { FilteredDataSource } from "../use-filtered-data-source";
import type {
  TugListViewCellRole,
  TugListViewDataSource,
} from "../tug-list-view";

// ---------------------------------------------------------------------------
// Synthetic data sources
// ---------------------------------------------------------------------------

/**
 * Plain-shape data source — implements the contract without
 * `roleForIndex`. Items carry a numeric `value` so predicates can
 * filter by simple comparisons.
 */
interface SynItem {
  readonly id: string;
  readonly kind: string;
  readonly value: number;
}

class SynDataSource implements TugListViewDataSource {
  private items: SynItem[];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(items: ReadonlyArray<SynItem>) {
    this.items = [...items];
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

  itemAt(index: number): SynItem {
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

  /** Public count for tests that pin lazy attach/detach behavior. */
  listenerCount(): number {
    return this.listeners.size;
  }

  /** Test mutator — replaces items wholesale, ticks, fires. */
  _setItemsForTest(next: ReadonlyArray<SynItem>): void {
    this.items = [...next];
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

/**
 * Role-bearing data source — implements `roleForIndex`. Used to
 * verify the wrapper routes role queries through the base.
 */
interface RoledSynItem extends SynItem {
  readonly role: TugListViewCellRole;
}

class RoledSynDataSource implements TugListViewDataSource {
  private readonly items: ReadonlyArray<RoledSynItem>;
  private readonly listeners = new Set<() => void>();

  constructor(items: ReadonlyArray<RoledSynItem>) {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItems(values: ReadonlyArray<number>): SynItem[] {
  return values.map((v, i) => ({
    id: `id-${i}-v${v}`,
    kind: "row",
    value: v,
  }));
}

const PASS_ALL = (): boolean => true;
const PASS_NONE = (): boolean => false;
const VALUE_GT_5 = (i: number, base: TugListViewDataSource): boolean =>
  (base as SynDataSource).itemAt(i).value > 5;

// ---------------------------------------------------------------------------
// Constructor projection
// ---------------------------------------------------------------------------

describe("FilteredDataSource — constructor projection", () => {
  test("empty base yields a zero-item wrapper", () => {
    const base = new SynDataSource([]);
    const filtered = new FilteredDataSource(base, PASS_ALL);
    expect(filtered.numberOfItems()).toBe(0);
  });

  test("all-pass predicate yields wrapper count equal to base count", () => {
    const base = new SynDataSource(makeItems([1, 2, 3, 4, 5]));
    const filtered = new FilteredDataSource(base, PASS_ALL);
    expect(filtered.numberOfItems()).toBe(5);
    expect(filtered.baseIndexFor(0)).toBe(0);
    expect(filtered.baseIndexFor(4)).toBe(4);
  });

  test("no-pass predicate yields a zero-item wrapper", () => {
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, PASS_NONE);
    expect(filtered.numberOfItems()).toBe(0);
  });

  test("partial predicate projects only matching base indices", () => {
    // values: [1, 7, 2, 9, 3, 6]; predicate: value > 5
    // matching base indices: [1, 3, 5]
    const base = new SynDataSource(makeItems([1, 7, 2, 9, 3, 6]));
    const filtered = new FilteredDataSource(base, VALUE_GT_5);
    expect(filtered.numberOfItems()).toBe(3);
    expect(filtered.baseIndexFor(0)).toBe(1);
    expect(filtered.baseIndexFor(1)).toBe(3);
    expect(filtered.baseIndexFor(2)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// idForIndex / kindForIndex / roleForIndex routing
// ---------------------------------------------------------------------------

describe("FilteredDataSource — accessor routing", () => {
  test("idForIndex / kindForIndex return base values at the projected index", () => {
    // Build items so id and kind are distinguishable.
    const items: SynItem[] = [
      { id: "a", kind: "row",   value: 1 },
      { id: "b", kind: "tall",  value: 7 },
      { id: "c", kind: "row",   value: 2 },
      { id: "d", kind: "tall",  value: 9 },
    ];
    const base = new SynDataSource(items);
    const filtered = new FilteredDataSource(base, VALUE_GT_5);
    // Filtered: base indices [1, 3] → ids "b", "d"
    expect(filtered.numberOfItems()).toBe(2);
    expect(filtered.idForIndex(0)).toBe("b");
    expect(filtered.idForIndex(1)).toBe("d");
    expect(filtered.kindForIndex(0)).toBe("tall");
    expect(filtered.kindForIndex(1)).toBe("tall");
  });

  test("roleForIndex routes through the base when implemented", () => {
    const items: ReadonlyArray<RoledSynItem> = [
      { id: "h", kind: "section-label", value: 0, role: "header" },
      { id: "c1", kind: "list-item",    value: 1, role: "cell" },
      { id: "c2", kind: "list-item",    value: 2, role: "cell" },
      { id: "f", kind: "section-action", value: 0, role: "footer" },
    ];
    const base = new RoledSynDataSource(items);
    // Predicate that keeps everything — preserves base index alignment.
    const filtered = new FilteredDataSource(base, PASS_ALL);
    expect(filtered.roleForIndex(0)).toBe("header");
    expect(filtered.roleForIndex(1)).toBe("cell");
    expect(filtered.roleForIndex(2)).toBe("cell");
    expect(filtered.roleForIndex(3)).toBe("footer");
  });

  test("roleForIndex defaults to 'cell' when the base omits roleForIndex", () => {
    // SynDataSource has no `roleForIndex` method — verifies the
    // wrapper's `?? "cell"` fallback per the contract.
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, PASS_ALL);
    for (let i = 0; i < filtered.numberOfItems(); i += 1) {
      expect(filtered.roleForIndex(i)).toBe("cell");
    }
  });
});

// ---------------------------------------------------------------------------
// Subscription lifecycle
// ---------------------------------------------------------------------------

describe("FilteredDataSource — subscription lifecycle", () => {
  test("first subscribe attaches to base; last unsubscribe detaches", () => {
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, PASS_ALL);

    expect(base.listenerCount()).toBe(0);

    const unsubA = filtered.subscribe(() => {});
    expect(base.listenerCount()).toBe(1);

    // Second listener — does NOT re-attach to base.
    const unsubB = filtered.subscribe(() => {});
    expect(base.listenerCount()).toBe(1);

    unsubA();
    expect(base.listenerCount()).toBe(1); // still B is attached

    unsubB();
    expect(base.listenerCount()).toBe(0); // last out — detached
  });

  test("re-subscribe after full detach re-attaches", () => {
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, PASS_ALL);

    const unsub1 = filtered.subscribe(() => {});
    unsub1();
    expect(base.listenerCount()).toBe(0);

    const unsub2 = filtered.subscribe(() => {});
    expect(base.listenerCount()).toBe(1);
    unsub2();
  });

  test("attaching after a base mutation re-projects against current state", () => {
    // Mutation while detached — the wrapper's projection is stale
    // until something triggers a recompute. Attaching is one such
    // trigger.
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, VALUE_GT_5);
    expect(filtered.numberOfItems()).toBe(0); // none > 5

    // Mutate while no listeners attached.
    base._setItemsForTest(makeItems([7, 8, 9, 1]));

    // Wrapper's projection is still stale (no listener fired).
    // Verify by checking — the wrapper's baseIndices reflects the
    // pre-mutation state.
    expect(filtered.numberOfItems()).toBe(0);

    // Attach — recomputes against current base.
    let ticks = 0;
    filtered.subscribe(() => {
      ticks += 1;
    });

    // After attach, the projection is fresh.
    expect(filtered.numberOfItems()).toBe(3);
    // Listener has not fired yet (attach itself doesn't notify).
    expect(ticks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Base-tick propagation
// ---------------------------------------------------------------------------

describe("FilteredDataSource — base-tick propagation", () => {
  test("a base tick triggers recompute and notifies wrapper listeners", () => {
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, VALUE_GT_5);

    let ticks = 0;
    filtered.subscribe(() => {
      ticks += 1;
    });

    expect(filtered.numberOfItems()).toBe(0);

    // Mutate base — tick fires; wrapper recomputes; listener fires.
    base._setItemsForTest(makeItems([1, 7, 9]));
    expect(ticks).toBe(1);
    expect(filtered.numberOfItems()).toBe(2);
    expect(filtered.baseIndexFor(0)).toBe(1);
    expect(filtered.baseIndexFor(1)).toBe(2);
  });

  test("base mutation that promotes a previously-filtered item", () => {
    // Item at index 2 has value 3 (filtered out by value > 5). Replace
    // it with value 7 — it should appear in the projection.
    const base = new SynDataSource(makeItems([7, 8, 3]));
    const filtered = new FilteredDataSource(base, VALUE_GT_5);

    let ticks = 0;
    filtered.subscribe(() => {
      ticks += 1;
    });

    expect(filtered.numberOfItems()).toBe(2);
    expect(filtered.baseIndexFor(0)).toBe(0);
    expect(filtered.baseIndexFor(1)).toBe(1);

    base._setItemsForTest(makeItems([7, 8, 7]));
    expect(ticks).toBe(1);
    expect(filtered.numberOfItems()).toBe(3);
    expect(filtered.baseIndexFor(2)).toBe(2);
  });

  test("base mutation that drops a previously-projected item", () => {
    const base = new SynDataSource(makeItems([7, 8, 9]));
    const filtered = new FilteredDataSource(base, VALUE_GT_5);

    let ticks = 0;
    filtered.subscribe(() => {
      ticks += 1;
    });

    expect(filtered.numberOfItems()).toBe(3);

    // Demote the middle item.
    base._setItemsForTest(makeItems([7, 1, 9]));
    expect(ticks).toBe(1);
    expect(filtered.numberOfItems()).toBe(2);
    expect(filtered.baseIndexFor(0)).toBe(0);
    expect(filtered.baseIndexFor(1)).toBe(2);
  });

  test("multiple subscribers each receive a tick on a single base mutation", () => {
    const base = new SynDataSource(makeItems([7]));
    const filtered = new FilteredDataSource(base, VALUE_GT_5);

    let aTicks = 0;
    let bTicks = 0;
    filtered.subscribe(() => {
      aTicks += 1;
    });
    filtered.subscribe(() => {
      bTicks += 1;
    });

    base._setItemsForTest(makeItems([7, 8]));

    expect(aTicks).toBe(1);
    expect(bTicks).toBe(1);
  });

  test("unsubscribed listener does NOT fire on subsequent base ticks", () => {
    const base = new SynDataSource(makeItems([7]));
    const filtered = new FilteredDataSource(base, VALUE_GT_5);

    let ticks = 0;
    const unsub = filtered.subscribe(() => {
      ticks += 1;
    });

    base._setItemsForTest(makeItems([7, 8]));
    expect(ticks).toBe(1);

    unsub();
    base._setItemsForTest(makeItems([7, 8, 9]));
    expect(ticks).toBe(1); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Version semantics
// ---------------------------------------------------------------------------

describe("FilteredDataSource — version semantics", () => {
  test("getVersion is reference-stable when no recompute fires", () => {
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, PASS_ALL);
    const v1 = filtered.getVersion();
    const v2 = filtered.getVersion();
    expect(Object.is(v1, v2)).toBe(true);
  });

  test("getVersion identity changes on each recompute", () => {
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, PASS_ALL);
    filtered.subscribe(() => {});

    const v1 = filtered.getVersion();
    base._setItemsForTest(makeItems([1, 2, 3, 4]));
    const v2 = filtered.getVersion();
    expect(Object.is(v1, v2)).toBe(false);

    base._setItemsForTest(makeItems([1, 2]));
    const v3 = filtered.getVersion();
    expect(Object.is(v2, v3)).toBe(false);
  });

  test("an explicit recompute() call advances the version", () => {
    const base = new SynDataSource(makeItems([1, 2, 3]));
    const filtered = new FilteredDataSource(base, PASS_ALL);
    const v1 = filtered.getVersion();
    filtered.recompute();
    const v2 = filtered.getVersion();
    expect(Object.is(v1, v2)).toBe(false);
  });

  test("setLatestPredicate does NOT advance the version on its own", () => {
    // The hook calls setLatestPredicate on every render to capture
    // fresh closure scope; that should NOT trigger a recompute by
    // itself. Recompute is gated on filterToken identity change.
    const base = new SynDataSource(makeItems([1, 7]));
    const filtered = new FilteredDataSource(base, PASS_ALL);
    const v1 = filtered.getVersion();

    filtered.setLatestPredicate(VALUE_GT_5);
    const v2 = filtered.getVersion();
    expect(Object.is(v1, v2)).toBe(true);

    // numberOfItems unchanged — the swap didn't recompute.
    expect(filtered.numberOfItems()).toBe(2);

    // After an explicit recompute, the new predicate is in effect.
    filtered.recompute();
    expect(filtered.numberOfItems()).toBe(1);
    expect(filtered.baseIndexFor(0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// baseIndexFor across reorder
// ---------------------------------------------------------------------------

describe("FilteredDataSource — baseIndexFor across base mutation", () => {
  test("baseIndexFor returns the CURRENT base index after reorder", () => {
    const base = new SynDataSource([
      { id: "a", kind: "row", value: 7 },
      { id: "b", kind: "row", value: 1 },
      { id: "c", kind: "row", value: 9 },
    ]);
    const filtered = new FilteredDataSource(base, VALUE_GT_5);
    filtered.subscribe(() => {});
    // Initial: filtered → base indices [0, 2] (ids "a", "c")
    expect(filtered.idForIndex(0)).toBe("a");
    expect(filtered.idForIndex(1)).toBe("c");

    // Reorder so "c" is first, "a" is last.
    base._setItemsForTest([
      { id: "c", kind: "row", value: 9 },
      { id: "b", kind: "row", value: 1 },
      { id: "a", kind: "row", value: 7 },
    ]);

    // After reorder: filtered → base indices [0, 2] (ids "c", "a")
    expect(filtered.numberOfItems()).toBe(2);
    expect(filtered.baseIndexFor(0)).toBe(0);
    expect(filtered.baseIndexFor(1)).toBe(2);
    expect(filtered.idForIndex(0)).toBe("c");
    expect(filtered.idForIndex(1)).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// setBase
// ---------------------------------------------------------------------------

describe("FilteredDataSource — setBase", () => {
  test("setBase swaps the underlying source and recomputes", () => {
    const base1 = new SynDataSource(makeItems([1, 7]));
    const base2 = new SynDataSource(makeItems([8, 9, 1, 7]));
    const filtered = new FilteredDataSource(base1, VALUE_GT_5);

    expect(filtered.numberOfItems()).toBe(1);
    expect(filtered.baseIndexFor(0)).toBe(1); // value 7

    filtered.setBase(base2);

    // After swap: filter against base2 → base indices [0, 1, 3]
    expect(filtered.numberOfItems()).toBe(3);
    expect(filtered.baseIndexFor(0)).toBe(0);
    expect(filtered.baseIndexFor(1)).toBe(1);
    expect(filtered.baseIndexFor(2)).toBe(3);
  });

  test("setBase to the same instance is a no-op", () => {
    const base = new SynDataSource(makeItems([1, 7]));
    const filtered = new FilteredDataSource(base, VALUE_GT_5);
    const v1 = filtered.getVersion();
    filtered.setBase(base);
    const v2 = filtered.getVersion();
    expect(Object.is(v1, v2)).toBe(true);
  });

  test("setBase detaches from old and attaches to new", () => {
    const base1 = new SynDataSource(makeItems([7]));
    const base2 = new SynDataSource(makeItems([8]));
    const filtered = new FilteredDataSource(base1, VALUE_GT_5);

    let ticks = 0;
    filtered.subscribe(() => {
      ticks += 1;
    });

    expect(base1.listenerCount()).toBe(1);
    expect(base2.listenerCount()).toBe(0);

    filtered.setBase(base2);

    expect(base1.listenerCount()).toBe(0);
    expect(base2.listenerCount()).toBe(1);

    // Mutating base1 should NOT tick the wrapper (it's no longer
    // attached); mutating base2 should.
    base1._setItemsForTest(makeItems([7, 9]));
    expect(ticks).toBe(0);

    base2._setItemsForTest(makeItems([8, 9]));
    expect(ticks).toBe(1);
  });

  test("setBase before any subscribe leaves both bases unsubscribed", () => {
    // Lazy attach: with no subscribers, neither base should be
    // subscribed before or after setBase.
    const base1 = new SynDataSource(makeItems([7]));
    const base2 = new SynDataSource(makeItems([8]));
    const filtered = new FilteredDataSource(base1, VALUE_GT_5);

    expect(base1.listenerCount()).toBe(0);
    filtered.setBase(base2);
    expect(base1.listenerCount()).toBe(0);
    expect(base2.listenerCount()).toBe(0);

    // After subscribe, the new base attaches.
    filtered.subscribe(() => {});
    expect(base2.listenerCount()).toBe(1);
  });
});
