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

const N = 50; // default window

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

describe("resolveRestoreWindow", () => {
  test("no saved anchor → default window", () => {
    expect(resolveRestoreWindow(undefined, N)).toBe(N);
  });
  test("anchor within the default window → default (no extra load)", () => {
    expect(resolveRestoreWindow(20, N)).toBe(N);
    expect(resolveRestoreWindow(N, N)).toBe(N);
  });
  test("anchor parked above the window → load deep enough to reach it", () => {
    expect(resolveRestoreWindow(150, N)).toBe(150);
  });
});

describe("anchorRowIndexInWindow", () => {
  test("invariant round-trip: save depth, reload, relocate", () => {
    // Saved: 250 rows, anchor at row 100 → depth 150.
    const depth = anchorDepthFromEnd(250, 100);
    // Reload sizes the window to include it (150) and loads exactly that.
    const window = resolveRestoreWindow(depth, N); // 150
    // The anchor lands at row 0 of the deep window.
    expect(anchorRowIndexInWindow(window, depth)).toBe(0);
  });

  test("common case: anchor within the default window keeps its position", () => {
    // Saved: 250 rows, anchor at row 230 → depth 20 (within N=50).
    const depth = anchorDepthFromEnd(250, 230); // 20
    const window = resolveRestoreWindow(depth, N); // 50 (default)
    // Reload loads 50 rows; the anchor sits 30 rows from the top.
    expect(anchorRowIndexInWindow(50, depth)).toBe(30);
  });

  test("clamps when the window loaded fewer rows than the depth", () => {
    expect(anchorRowIndexInWindow(40, 150)).toBe(0);
  });

  test("clamps to the last row when depth is zero", () => {
    expect(anchorRowIndexInWindow(50, 0)).toBe(49);
  });
});
