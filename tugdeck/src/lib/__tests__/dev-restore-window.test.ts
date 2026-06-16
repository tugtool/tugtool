/**
 * dev-restore-window — pure-logic tests for faithful-restore window math
 * ([recency P05], #step-6).
 */

import { describe, expect, test } from "bun:test";

import {
  anchorDepthFromEnd,
  anchorRowIndexInWindow,
  resolveRestoreWindow,
} from "../dev-restore-window";

const N = 25; // default window, in TURNS

describe("anchorDepthFromEnd", () => {
  test("rows from the anchor to the bottom", () => {
    expect(anchorDepthFromEnd(250, 100)).toBe(150);
    expect(anchorDepthFromEnd(50, 30)).toBe(20);
  });
  test("clamps at 0 (anchor at/after the end)", () => {
    expect(anchorDepthFromEnd(50, 50)).toBe(0);
    expect(anchorDepthFromEnd(50, 60)).toBe(0);
  });
});

describe("resolveRestoreWindow (turns)", () => {
  test("no saved anchor → default window turns", () => {
    expect(resolveRestoreWindow(undefined, N)).toBe(N);
  });
  test("anchor within the default window → default (no extra load)", () => {
    // depthFromEnd is rows; ≤ N turns is guaranteed covered (≥1 row/turn).
    expect(resolveRestoreWindow(20, N)).toBe(N);
    expect(resolveRestoreWindow(N, N)).toBe(N);
  });
  test("anchor parked above the window → request that many turns (covers it)", () => {
    // 150 rows deep → request 150 turns, which loads ≥ 150 rows (R02 over-approx).
    expect(resolveRestoreWindow(150, N)).toBe(150);
  });
});

describe("anchorRowIndexInWindow (rows — unchanged by the turn window)", () => {
  test("invariant round-trip: save depth, reload, relocate within loaded rows", () => {
    // Saved: 250 rows, anchor at row 100 → depth 150 rows.
    const depth = anchorDepthFromEnd(250, 100);
    // The turn window is sized to cover it (150 turns); at load time that
    // yields some number of rows ≥ 150. Say the deep load rendered 150 rows
    // (the anchor was the oldest loaded) — the anchor lands at row 0.
    const loadedRows = 150;
    expect(anchorRowIndexInWindow(loadedRows, depth)).toBe(0);
  });

  test("common case: anchor within the default window keeps its position", () => {
    // Saved: 250 rows, anchor at row 230 → depth 20.
    const depth = anchorDepthFromEnd(250, 230); // 20
    // The default N-turn window rendered, say, 50 rows; the anchor sits 30
    // rows from the top.
    expect(anchorRowIndexInWindow(50, depth)).toBe(30);
  });

  test("clamps when the window loaded fewer rows than the depth", () => {
    expect(anchorRowIndexInWindow(40, 150)).toBe(0);
  });

  test("clamps to the last row when depth is zero", () => {
    expect(anchorRowIndexInWindow(50, 0)).toBe(49);
  });
});
