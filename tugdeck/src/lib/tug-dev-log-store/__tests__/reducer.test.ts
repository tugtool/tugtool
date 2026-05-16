/**
 * Pure-logic tests for the `TugDevLogStore` reducer. Covers
 * append_batch / clear / set_filters partial-merge / set_max_entries /
 * hydrate — including the "no-op events return same state reference"
 * contract required by `useSyncExternalStore` for quiescent
 * subscribers.
 */

import { describe, it, expect } from "bun:test";

import {
  createInitialState,
  reduce,
  type TugDevLogState,
} from "@/lib/tug-dev-log-store/reducer";
import {
  ALL_TUG_DEV_LOG_LEVELS,
  DEFAULT_DEV_LOG_MAX_ENTRIES,
  type TugDevLogEntry,
} from "@/lib/tug-dev-log-store/types";

function entry(
  id: number,
  level: "debug" | "info" | "warn" | "error" = "info",
  source = "test",
  message = "hello",
): TugDevLogEntry {
  return { id, timestamp: 1_000 + id, level, source, message };
}

function fresh(): TugDevLogState {
  return createInitialState();
}

describe("TugDevLogStore reducer — append_batch", () => {
  it("adds entries in order", () => {
    const next = reduce(fresh(), {
      type: "append_batch",
      entries: [entry(1), entry(2), entry(3)],
    });
    expect(next.entries.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("empty batch is a no-op (same-ref)", () => {
    const s = fresh();
    expect(reduce(s, { type: "append_batch", entries: [] })).toBe(s);
  });

  it("drops oldest when reaching maxEntries (FIFO)", () => {
    let s: TugDevLogState = { ...fresh(), maxEntries: 3 };
    s = reduce(s, {
      type: "append_batch",
      entries: [entry(1), entry(2), entry(3)],
    });
    s = reduce(s, { type: "append_batch", entries: [entry(4), entry(5)] });
    expect(s.entries.map((e) => e.id)).toEqual([3, 4, 5]);
  });

  it("bumps version on append", () => {
    const s = fresh();
    const next = reduce(s, { type: "append_batch", entries: [entry(1)] });
    expect(next.version).toBe(s.version + 1);
  });
});

describe("TugDevLogStore reducer — clear", () => {
  it("empties buffer; preserves filters + cap", () => {
    let s = reduce(fresh(), {
      type: "append_batch",
      entries: [entry(1), entry(2)],
    });
    const beforeFilters = s.filters;
    const beforeCap = s.maxEntries;
    s = reduce(s, { type: "clear" });
    expect(s.entries.length).toBe(0);
    expect(s.filters).toBe(beforeFilters);
    expect(s.maxEntries).toBe(beforeCap);
  });

  it("idempotent when already empty (same-ref)", () => {
    const s = fresh();
    expect(reduce(s, { type: "clear" })).toBe(s);
  });
});

describe("TugDevLogStore reducer — set_filters partial-merge", () => {
  it("level-only update keeps source + text", () => {
    let s = reduce(fresh(), {
      type: "set_filters",
      source: "code-session-store",
      text: "boom",
    });
    s = reduce(s, {
      type: "set_filters",
      levels: new Set(["warn", "error"]),
    });
    expect(s.filters.source).toBe("code-session-store");
    expect(s.filters.text).toBe("boom");
    expect(Array.from(s.filters.levels).sort()).toEqual(["error", "warn"]);
  });

  it("text-only update keeps level + source", () => {
    let s = reduce(fresh(), {
      type: "set_filters",
      levels: new Set(["error"]),
      source: "x",
    });
    s = reduce(s, { type: "set_filters", text: "hi" });
    expect(Array.from(s.filters.levels)).toEqual(["error"]);
    expect(s.filters.source).toBe("x");
    expect(s.filters.text).toBe("hi");
  });

  it("no-op set_filters returns same ref", () => {
    const s = fresh();
    expect(
      reduce(s, { type: "set_filters", text: "" }),
    ).toBe(s);
  });

  it("levels with same membership (different Set instance) is a no-op", () => {
    const s = fresh();
    const sameMembership = new Set(ALL_TUG_DEV_LOG_LEVELS);
    expect(
      reduce(s, { type: "set_filters", levels: sameMembership }),
    ).toBe(s);
  });
});

describe("TugDevLogStore reducer — set_max_entries", () => {
  it("smaller cap truncates oldest", () => {
    let s = reduce(fresh(), {
      type: "append_batch",
      entries: [entry(1), entry(2), entry(3), entry(4)],
    });
    s = reduce(s, { type: "set_max_entries", maxEntries: 2 });
    expect(s.entries.map((e) => e.id)).toEqual([3, 4]);
    expect(s.maxEntries).toBe(2);
  });

  it("larger cap keeps existing entries", () => {
    let s = reduce(fresh(), {
      type: "append_batch",
      entries: [entry(1), entry(2)],
    });
    s = reduce(s, { type: "set_max_entries", maxEntries: 100 });
    expect(s.entries.map((e) => e.id)).toEqual([1, 2]);
    expect(s.maxEntries).toBe(100);
  });

  it("non-finite falls back to default", () => {
    const s = fresh();
    const next = reduce(s, { type: "set_max_entries", maxEntries: NaN });
    expect(next).toBe(s); // already at default, no-op
  });

  it("same cap is a no-op (same-ref)", () => {
    const s = fresh();
    expect(
      reduce(s, { type: "set_max_entries", maxEntries: DEFAULT_DEV_LOG_MAX_ENTRIES }),
    ).toBe(s);
  });
});

describe("TugDevLogStore reducer — hydrate", () => {
  it("missing fields keep existing values (same-ref)", () => {
    const s = fresh();
    expect(reduce(s, { type: "hydrate" })).toBe(s);
  });

  it("applies levels + source + maxEntries", () => {
    const next = reduce(fresh(), {
      type: "hydrate",
      levels: new Set(["error"]),
      source: "x",
      maxEntries: 200,
    });
    expect(Array.from(next.filters.levels)).toEqual(["error"]);
    expect(next.filters.source).toBe("x");
    expect(next.maxEntries).toBe(200);
  });

  it("hydrate with same values returns same ref", () => {
    const s = fresh();
    const next = reduce(s, {
      type: "hydrate",
      levels: new Set(ALL_TUG_DEV_LOG_LEVELS),
      source: null,
      maxEntries: DEFAULT_DEV_LOG_MAX_ENTRIES,
    });
    expect(next).toBe(s);
  });

  it("shrinks buffer when hydrated cap is smaller", () => {
    let s = reduce(fresh(), {
      type: "append_batch",
      entries: [entry(1), entry(2), entry(3)],
    });
    s = reduce(s, { type: "hydrate", maxEntries: 1 });
    expect(s.entries.map((e) => e.id)).toEqual([3]);
  });
});
