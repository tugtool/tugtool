/**
 * tug-progress-wave — unit tests for the pure helpers used by the
 * three-bar wave glyph.
 *
 * The component's render path (TugAnimator group chain, mid-cycle
 * toggle behavior) is exercised downstream via HMR + the gallery
 * card per the no-fake-DOM testing convention.
 */

import { describe, expect, test } from "bun:test";

import {
  barScales,
  gapForBarWidth,
  staticScale,
} from "../tug-progress-wave";

describe("barScales — per-bar (rest, peak) pair", () => {
  test("middle bar (index 1) shrinks: rest=1, peak=0.5", () => {
    expect(barScales(1)).toEqual({ restScale: 1, peakScale: 0.5 });
  });

  test("left bar (index 0) grows: rest=0.5, peak=1", () => {
    expect(barScales(0)).toEqual({ restScale: 0.5, peakScale: 1 });
  });

  test("right bar (index 2) grows: rest=0.5, peak=1", () => {
    expect(barScales(2)).toEqual({ restScale: 0.5, peakScale: 1 });
  });
});

describe("staticScale — pose for non-running states", () => {
  test.each([
    ["paused", 0, 0.5],
    ["paused", 1, 1],
    ["paused", 2, 0.5],
    ["stopped", 0, 0.5],
    ["stopped", 1, 1],
    ["stopped", 2, 0.5],
    ["aborted", 0, 0.5],
    ["aborted", 1, 1],
    ["aborted", 2, 0.5],
  ] as const)(
    "%s state at index %d → %f",
    (state, index, expected) => {
      expect(staticScale(index, state)).toBe(expected);
    },
  );

  test("completed state lifts every bar to peak (1.0)", () => {
    expect(staticScale(0, "completed")).toBe(1);
    expect(staticScale(1, "completed")).toBe(1);
    expect(staticScale(2, "completed")).toBe(1);
  });
});

describe("gapForBarWidth", () => {
  test("returns 80% of bar width", () => {
    expect(gapForBarWidth(10)).toBeCloseTo(8);
    expect(gapForBarWidth(5)).toBeCloseTo(4);
    expect(gapForBarWidth(0)).toBe(0);
  });

  test("scales linearly with bar width", () => {
    const a = gapForBarWidth(4);
    const b = gapForBarWidth(8);
    expect(b).toBeCloseTo(a * 2);
  });
});
