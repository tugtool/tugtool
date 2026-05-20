/**
 * list-view-page-navigation — pure-function tests.
 *
 * Pins the entry-pager selection: PageDown steps to the next entry
 * (even one already in view), PageUp snaps-to-current then steps, and
 * the top / bottom / empty edges. `cellTops` are viewport-relative.
 * No React, no DOM — just the function.
 */

import { describe, expect, test } from "bun:test";

import { computePageNavigation } from "../list-view-page-navigation";

describe("computePageNavigation — PageDown", () => {
  test("from the top, steps to the next entry (not the first overflowing one)", () => {
    // Four entries, viewport at the absolute top: entry 0 sits just
    // below the top edge behind the breathing-room pseudo-element,
    // entries 1–3 follow. Two of them are fully in view — PageDown
    // must still go to entry 1, not skip to a later one.
    expect(
      computePageNavigation({ direction: "down", cellTops: [12, 122, 232, 342] }),
    ).toEqual({ kind: "cell", index: 1 });
  });

  test("steps one entry on from the current top entry", () => {
    // entry 1 is flush at the top.
    expect(
      computePageNavigation({ direction: "down", cellTops: [-122, 0, 110, 220] }),
    ).toEqual({ kind: "cell", index: 2 });
  });

  test("steps on from a mid-entry viewport", () => {
    // entry 2 straddles the top edge (top −30) — it is the current
    // entry, so PageDown advances to entry 3.
    expect(
      computePageNavigation({ direction: "down", cellTops: [-250, -130, -30, 90] }),
    ).toEqual({ kind: "cell", index: 3 });
  });

  test("returns 'bottom' when already on the last entry", () => {
    expect(
      computePageNavigation({ direction: "down", cellTops: [-330, -220, -110, 0] }),
    ).toEqual({ kind: "bottom" });
  });

  test("returns 'bottom' from mid-way through a tall last entry", () => {
    expect(
      computePageNavigation({ direction: "down", cellTops: [-600, -490, -380, -200] }),
    ).toEqual({ kind: "bottom" });
  });
});

describe("computePageNavigation — PageUp", () => {
  test("snaps the current entry's top up when the viewport is mid-entry", () => {
    // entry 2 straddles the top edge — PageUp snaps it flush.
    expect(
      computePageNavigation({ direction: "up", cellTops: [-250, -130, -30, 90] }),
    ).toEqual({ kind: "cell", index: 2 });
  });

  test("steps to the previous entry when the current entry is flush", () => {
    expect(
      computePageNavigation({ direction: "up", cellTops: [-220, -110, 0, 110] }),
    ).toEqual({ kind: "cell", index: 1 });
  });

  test("treats a sub-pixel offset from the top as flush", () => {
    // entry 2's top at −1px steps to entry 1, not a snap-to-2.
    expect(
      computePageNavigation({ direction: "up", cellTops: [-221, -111, -1, 109] }),
    ).toEqual({ kind: "cell", index: 1 });
  });

  test("is a no-op at the absolute top (breathing room above entry 0)", () => {
    expect(
      computePageNavigation({ direction: "up", cellTops: [12, 122, 232, 342] }),
    ).toEqual({ kind: "none" });
  });

  test("is a no-op with entry 0 flush at the top", () => {
    expect(
      computePageNavigation({ direction: "up", cellTops: [0, 110, 220, 330] }),
    ).toEqual({ kind: "none" });
  });
});

describe("computePageNavigation — single tall entry", () => {
  test("PageUp snaps to the entry's own top from mid-entry", () => {
    expect(
      computePageNavigation({ direction: "up", cellTops: [-300] }),
    ).toEqual({ kind: "cell", index: 0 });
  });

  test("PageUp is a no-op at the entry's top", () => {
    expect(
      computePageNavigation({ direction: "up", cellTops: [0] }),
    ).toEqual({ kind: "none" });
  });

  test("PageDown jumps to the bottom (the entry is the last entry)", () => {
    expect(
      computePageNavigation({ direction: "down", cellTops: [0] }),
    ).toEqual({ kind: "bottom" });
  });
});

describe("computePageNavigation — empty list", () => {
  test("is a no-op in both directions", () => {
    expect(
      computePageNavigation({ direction: "up", cellTops: [] }),
    ).toEqual({ kind: "none" });
    expect(
      computePageNavigation({ direction: "down", cellTops: [] }),
    ).toEqual({ kind: "none" });
  });
});
