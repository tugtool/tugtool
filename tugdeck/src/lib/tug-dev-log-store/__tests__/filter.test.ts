/**
 * Pure-logic tests for the filter helpers (`filterEntries`,
 * `extractSources`, `stringifyDataForSearch`).
 */

import { describe, it, expect } from "bun:test";

import {
  extractSources,
  filterEntries,
  stringifyDataForSearch,
} from "@/lib/tug-dev-log-store/filter";
import {
  ALL_TUG_DEV_LOG_LEVELS,
  type TugDevLogEntry,
  type TugDevLogFilters,
  type TugDevLogLevel,
} from "@/lib/tug-dev-log-store/types";

function makeEntry(
  id: number,
  level: TugDevLogLevel,
  source: string,
  message: string,
  data?: unknown,
): TugDevLogEntry {
  const e: TugDevLogEntry = { id, timestamp: 1000 + id, level, source, message };
  if (data !== undefined) e.data = data;
  return e;
}

function makeFilters(p: Partial<TugDevLogFilters> = {}): TugDevLogFilters {
  return {
    levels: p.levels ?? ALL_TUG_DEV_LOG_LEVELS,
    source: p.source ?? null,
    text: p.text ?? "",
  };
}

describe("filterEntries — levels", () => {
  const buf: TugDevLogEntry[] = [
    makeEntry(1, "debug", "a", "d"),
    makeEntry(2, "info", "a", "i"),
    makeEntry(3, "warn", "a", "w"),
    makeEntry(4, "error", "a", "e"),
  ];

  it("excludes entries whose level is not in the set", () => {
    const out = filterEntries(
      buf,
      makeFilters({ levels: new Set(["warn", "error"]) }),
    );
    expect(out.map((e) => e.id)).toEqual([3, 4]);
  });

  it("empty levels excludes everything", () => {
    const out = filterEntries(buf, makeFilters({ levels: new Set() }));
    expect(out).toHaveLength(0);
  });

  it("full set is a passthrough — same reference", () => {
    const out = filterEntries(buf, makeFilters());
    expect(out).toBe(buf);
  });
});

describe("filterEntries — source", () => {
  const buf: TugDevLogEntry[] = [
    makeEntry(1, "info", "a", "ma"),
    makeEntry(2, "info", "b", "mb"),
    makeEntry(3, "info", "a", "ma2"),
  ];

  it("null source means 'all'", () => {
    expect(filterEntries(buf, makeFilters()).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("specific source returns only matching", () => {
    expect(
      filterEntries(buf, makeFilters({ source: "a" })).map((e) => e.id),
    ).toEqual([1, 3]);
  });

  it("source not present in buffer yields empty list (not error)", () => {
    expect(filterEntries(buf, makeFilters({ source: "nope" })).length).toBe(0);
  });
});

describe("filterEntries — text (case-insensitive against message AND data)", () => {
  const buf: TugDevLogEntry[] = [
    makeEntry(1, "info", "x", "hello WORLD"),
    makeEntry(2, "info", "x", "another", { tag: "MATCHME" }),
    makeEntry(3, "info", "x", "boring", { tag: "skip" }),
  ];

  it("matches against message case-insensitively", () => {
    expect(
      filterEntries(buf, makeFilters({ text: "world" })).map((e) => e.id),
    ).toEqual([1]);
  });

  it("matches against stringified data when message misses", () => {
    expect(
      filterEntries(buf, makeFilters({ text: "matchme" })).map((e) => e.id),
    ).toEqual([2]);
  });

  it("empty text is a passthrough", () => {
    expect(filterEntries(buf, makeFilters({ text: "" })).map((e) => e.id)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("filterEntries — combined intersection", () => {
  const buf: TugDevLogEntry[] = [
    makeEntry(1, "info", "a", "hello"),
    makeEntry(2, "warn", "a", "hello"),
    makeEntry(3, "warn", "b", "hello"),
    makeEntry(4, "warn", "a", "world"),
  ];

  it("level AND source AND text all apply", () => {
    const out = filterEntries(
      buf,
      makeFilters({
        levels: new Set(["warn"]),
        source: "a",
        text: "hello",
      }),
    );
    expect(out.map((e) => e.id)).toEqual([2]);
  });
});

describe("extractSources", () => {
  it("returns distinct values in first-seen order", () => {
    const buf: TugDevLogEntry[] = [
      makeEntry(1, "info", "alpha", "x"),
      makeEntry(2, "info", "beta", "x"),
      makeEntry(3, "info", "alpha", "x"),
      makeEntry(4, "info", "gamma", "x"),
      makeEntry(5, "info", "beta", "x"),
    ];
    expect(extractSources(buf)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("empty buffer returns the same empty reference twice", () => {
    expect(extractSources([])).toBe(extractSources([]));
  });
});

describe("stringifyDataForSearch — WeakMap cache", () => {
  it("returns the same string for the same entry reference", () => {
    const e = makeEntry(1, "info", "x", "msg", { a: 1, b: [2, 3] });
    const s1 = stringifyDataForSearch(e);
    const s2 = stringifyDataForSearch(e);
    expect(s1).toBe(s2);
    expect(s1).toBe(JSON.stringify({ a: 1, b: [2, 3] }));
  });

  it("returns empty string for entries without data", () => {
    const e = makeEntry(1, "info", "x", "msg");
    expect(stringifyDataForSearch(e)).toBe("");
  });

  it("survives unserializable data without throwing", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const e = makeEntry(1, "info", "x", "m", cyclic);
    expect(stringifyDataForSearch(e)).toBe("");
  });
});
