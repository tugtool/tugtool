import { describe, expect, it } from "bun:test";

import { DEFAULT_FIND_OPTIONS, DevFindSession } from "../dev-find-session";
import type { SegmentedFindMatch } from "../transcript-search";

const m = (row: number, start: number): SegmentedFindMatch => ({
  row,
  start,
  end: start + 1,
  segment: 0,
  segmentKind: "dom",
});

describe("DevFindSession", () => {
  it("starts empty with no active match", () => {
    const s = new DevFindSession();
    const snap = s.getSnapshot();
    expect(snap.query).toBe("");
    expect(snap.matches).toEqual([]);
    expect(snap.activeIndex).toBe(-1);
    expect(snap.options).toEqual(DEFAULT_FIND_OPTIONS);
  });

  it("notifies subscribers and replaces the snapshot on change", () => {
    const s = new DevFindSession();
    let ticks = 0;
    const unsub = s.subscribe(() => ticks++);
    const before = s.getSnapshot();
    s.setQuery("hi");
    expect(ticks).toBe(1);
    expect(s.getSnapshot()).not.toBe(before);
    expect(s.getSnapshot().query).toBe("hi");
    s.setQuery("hi");
    expect(ticks).toBe(1);
    unsub();
    s.setQuery("bye");
    expect(ticks).toBe(1);
  });

  it("sets the active index to the first match on setMatches", () => {
    const s = new DevFindSession();
    s.setMatches([m(0, 0), m(1, 3)]);
    expect(s.getSnapshot().activeIndex).toBe(0);
  });

  it("preserves the active match by identity across a recompute", () => {
    const s = new DevFindSession();
    s.setMatches([m(0, 0), m(1, 3), m(2, 5)]);
    s.next();
    expect(s.getSnapshot().activeIndex).toBe(1);
    s.setMatches([m(1, 3), m(2, 5)]);
    expect(s.getSnapshot().activeIndex).toBe(0);
    expect(s.getSnapshot().matches[0]).toEqual(m(1, 3));
  });

  it("clamps to -1 when the recompute empties the set", () => {
    const s = new DevFindSession();
    s.setMatches([m(0, 0)]);
    s.setMatches([]);
    expect(s.getSnapshot().activeIndex).toBe(-1);
  });

  it("cycles next/previous and flags wrapped exactly at each crossing", () => {
    const s = new DevFindSession();
    s.setMatches([m(0, 0), m(0, 2), m(0, 4)]);
    expect(s.getSnapshot().wrapped).toBe(false);
    s.next();
    expect(s.getSnapshot().activeIndex).toBe(1);
    expect(s.getSnapshot().wrapped).toBe(false);
    s.next();
    expect(s.getSnapshot().activeIndex).toBe(2);
    s.next();
    expect(s.getSnapshot().activeIndex).toBe(0);
    expect(s.getSnapshot().wrapped).toBe(true);
    s.previous();
    expect(s.getSnapshot().activeIndex).toBe(2);
    expect(s.getSnapshot().wrapped).toBe(true);
    s.previous();
    expect(s.getSnapshot().activeIndex).toBe(1);
    expect(s.getSnapshot().wrapped).toBe(false);
  });

  it("records wrap direction: +1 for Next past the end, -1 for Previous past the start", () => {
    const s = new DevFindSession();
    s.setMatches([m(0, 0), m(0, 2)]);
    expect(s.getSnapshot().wrapDirection).toBe(0);
    s.next(); // 0 -> 1, no wrap
    expect(s.getSnapshot().wrapDirection).toBe(0);
    s.next(); // 1 -> 0, wrap forward
    expect(s.getSnapshot().wrapped).toBe(true);
    expect(s.getSnapshot().wrapDirection).toBe(1);
    s.previous(); // 0 -> 1, wrap backward
    expect(s.getSnapshot().wrapped).toBe(true);
    expect(s.getSnapshot().wrapDirection).toBe(-1);
    s.previous(); // 1 -> 0, no wrap
    expect(s.getSnapshot().wrapDirection).toBe(0);
  });

  it("increments wrapSeq on every wrap, including consecutive ones", () => {
    const s = new DevFindSession();
    s.setMatches([m(0, 0), m(0, 2)]); // 2 matches — bouncing first<->last wraps each step
    expect(s.getSnapshot().wrapSeq).toBe(0);
    s.next(); // 0 -> 1, no wrap
    expect(s.getSnapshot().wrapSeq).toBe(0);
    s.next(); // 1 -> 0, wrap (forward)
    expect(s.getSnapshot().wrapSeq).toBe(1);
    s.previous(); // 0 -> 1, wrap (backward) — consecutive wrap
    expect(s.getSnapshot().wrapSeq).toBe(2);
    s.next(); // 1 -> 0, wrap (forward) — consecutive wrap
    expect(s.getSnapshot().wrapSeq).toBe(3);
  });

  it("no-ops next/previous with no matches", () => {
    const s = new DevFindSession();
    let ticks = 0;
    s.subscribe(() => ticks++);
    s.next();
    s.previous();
    expect(ticks).toBe(0);
    expect(s.getSnapshot().activeIndex).toBe(-1);
  });

  it("clears query and matches", () => {
    const s = new DevFindSession();
    s.setQuery("x");
    s.setMatches([m(0, 0)]);
    s.clear();
    const snap = s.getSnapshot();
    expect(snap.query).toBe("");
    expect(snap.matches).toEqual([]);
    expect(snap.activeIndex).toBe(-1);
  });

  it("setQuery and setOptions clear the transient wrapped flag", () => {
    const s = new DevFindSession();
    s.setMatches([m(0, 0), m(0, 2)]);
    s.next();
    s.next();
    expect(s.getSnapshot().wrapped).toBe(true);
    s.setQuery("z");
    expect(s.getSnapshot().wrapped).toBe(false);
  });
});
