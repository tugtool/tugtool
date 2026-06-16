/**
 * dev-restore-window — pure-logic tests for faithful-restore window math
 * ([recency P05]/[P06], #step-6).
 *
 * The transcript anchor depth is a **turn** count, so `resolveRestoreWindow`
 * is a plain `max` of two turn quantities — no row↔turn bridging. The row
 * helpers (`anchorDepthFromEnd`, `anchorRowIndexInWindow`) serve genuinely
 * rowful, non-windowed lists and are exercised separately below.
 */

import { describe, expect, test } from "bun:test";

import {
  anchorDepthFromEnd,
  anchorRowIndexInWindow,
  resolveRestoreWindow,
} from "../dev-restore-window";

const N = 25; // default window, in TURNS

describe("resolveRestoreWindow (turns — clean max)", () => {
  test("no saved anchor → default window turns", () => {
    expect(resolveRestoreWindow(undefined, N)).toBe(N);
  });

  test("anchor within the default window → default (no extra load)", () => {
    // Both args are turns; a depth ≤ N is already covered by the default.
    expect(resolveRestoreWindow(1, N)).toBe(N);
    expect(resolveRestoreWindow(20, N)).toBe(N);
    expect(resolveRestoreWindow(N, N)).toBe(N);
  });

  test("anchor parked above the window → request exactly that many turns", () => {
    // 150 turns deep → request 150 turns. No over-approximation: the anchor
    // speaks the same unit, so the window reaches the anchored turn exactly.
    expect(resolveRestoreWindow(150, N)).toBe(150);
    expect(resolveRestoreWindow(N + 1, N)).toBe(N + 1);
  });
});

describe("anchorDepthFromEnd (rows — non-turn lists)", () => {
  test("rows from the anchor to the bottom", () => {
    expect(anchorDepthFromEnd(250, 100)).toBe(150);
    expect(anchorDepthFromEnd(50, 30)).toBe(20);
  });
  test("clamps at 0 (anchor at/after the end)", () => {
    expect(anchorDepthFromEnd(50, 50)).toBe(0);
    expect(anchorDepthFromEnd(50, 60)).toBe(0);
  });
});

describe("anchorRowIndexInWindow (rows — non-turn lists)", () => {
  test("invariant round-trip: save depth, reload, relocate within loaded rows", () => {
    // Saved: 250 rows, anchor at row 100 → depth 150 rows.
    const depth = anchorDepthFromEnd(250, 100);
    // A non-windowed list reloads its full set; relocate the anchor by depth.
    expect(anchorRowIndexInWindow(250, depth)).toBe(100);
  });

  test("common case: anchor keeps its position across a same-size reload", () => {
    const depth = anchorDepthFromEnd(250, 230); // 20
    expect(anchorRowIndexInWindow(250, depth)).toBe(230);
  });

  test("clamps when the window loaded fewer rows than the depth", () => {
    expect(anchorRowIndexInWindow(40, 150)).toBe(0);
  });

  test("clamps to the last row when depth is zero", () => {
    expect(anchorRowIndexInWindow(50, 0)).toBe(49);
  });
});
