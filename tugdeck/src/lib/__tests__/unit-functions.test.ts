/**
 * unit-functions.test.ts — the timing-curve catalogue and its CSS form.
 *
 * A timing curve is only correct if it starts at 0, ends at 1, and bends the
 * way its name says. These are the properties every consumer depends on
 * without ever checking them, so they are checked here once.
 */

import { describe, expect, test } from "bun:test";

import {
  cssEasing,
  dampedSpring,
  easeOut,
  easeOutBack,
  easeOutCubic,
  easeInEaseOut,
  linear,
  unitCurve,
  type UnitFunction,
} from "@/lib/unit-functions";

/** Every curve in the catalogue that is meant to land exactly on its ends. */
const ANCHORED: ReadonlyArray<[string, UnitFunction]> = [
  ["linear", linear],
  ["easeOut", easeOut],
  ["easeOutCubic", easeOutCubic],
  ["easeInEaseOut", easeInEaseOut],
  ["easeOutBack", easeOutBack],
  ["dampedSpring", dampedSpring()],
];

describe("the curves start at 0 and end at 1", () => {
  for (const [name, fn] of ANCHORED) {
    test(name, () => {
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    });
  }
});

describe("unitCurve — one family, three shapes", () => {
  test("an exponent of 1 is the identity, whatever the ease factor", () => {
    for (const f of [0.1, 0.5, 0.9]) {
      expect(unitCurve(0.25, 1, f)).toBeCloseTo(0.25, 6);
      expect(unitCurve(0.75, 1, f)).toBeCloseTo(0.75, 6);
    }
  });

  test("an ease factor near 0 leads (ease-out), near 1 it trails (ease-in)", () => {
    // Halfway through, an ease-out is already past halfway and an ease-in is
    // not yet there. That is the whole difference between the two.
    expect(unitCurve(0.5, 4, 1e-6)).toBeGreaterThan(0.5);
    expect(unitCurve(0.5, 4, 1 - 1e-6)).toBeLessThan(0.5);
  });

  test("an ease factor of 0.5 is symmetric about the middle", () => {
    for (const t of [0.1, 0.25, 0.4]) {
      expect(unitCurve(t, 4, 0.5)).toBeCloseTo(1 - unitCurve(1 - t, 4, 0.5), 9);
    }
  });

  test("the exponent is floored at 1 and the ease factor is clamped", () => {
    expect(unitCurve(0.4, 0, 0.5)).toBeCloseTo(0.4, 6);
    expect(Number.isFinite(unitCurve(0.4, 4, 0))).toBe(true);
    expect(Number.isFinite(unitCurve(0.4, 4, 1))).toBe(true);
  });
});

describe("easeOutBack overshoots", () => {
  test("it runs past 1 and comes back", () => {
    const peak = Math.max(
      ...Array.from({ length: 99 }, (_, i) => easeOutBack((i + 1) / 100)),
    );
    expect(peak).toBeGreaterThan(1);
    expect(easeOutBack(1)).toBeCloseTo(1, 9);
  });
});

describe("dampedSpring", () => {
  // Critically damped means exactly this: it never goes past its target. A
  // spring that overshoots is a different spring, and the deck's arrangement
  // would read as bouncing into place rather than arriving.
  test("never overshoots at any stiffness", () => {
    for (const stiffness of [3, 8, 16, 40]) {
      const fn = dampedSpring(stiffness);
      for (let i = 0; i <= 200; i += 1) {
        expect(fn(i / 200)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  test("it only ever moves forward", () => {
    const fn = dampedSpring();
    let previous = 0;
    for (let i = 1; i <= 200; i += 1) {
      const value = fn(i / 200);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = value;
    }
  });

  test("more stiffness arrives sooner", () => {
    expect(dampedSpring(16)(0.3)).toBeGreaterThan(dampedSpring(4)(0.3));
  });
});

describe("cssEasing", () => {
  test("emits a linear() whose ends are exactly 0 and 1", () => {
    const easing = cssEasing(dampedSpring(), 8);
    expect(easing.startsWith("linear(0, ")).toBe(true);
    expect(easing.endsWith(", 1)")).toBe(true);
  });

  test("a linear curve samples to evenly spaced stops", () => {
    expect(cssEasing(linear, 4)).toBe("linear(0, 0.25, 0.5, 0.75, 1)");
  });

  test("sample count sets the stop count", () => {
    for (const samples of [2, 8, 32]) {
      expect(cssEasing(easeOutCubic, samples).split(",").length).toBe(
        samples + 1,
      );
    }
  });

  // The sampled easing is a chord-wise approximation, so its error is bounded
  // by how far the curve bends between two stops. At the default it is small
  // enough that no frame lands visibly off its place.
  test("the default sampling tracks the real curve closely", () => {
    const fn = dampedSpring();
    const stops = cssEasing(fn)
      .slice("linear(".length, -1)
      .split(", ")
      .map(Number);
    const steps = stops.length - 1;
    for (let i = 0; i < steps; i += 1) {
      const midpoint = (stops[i]! + stops[i + 1]!) / 2;
      expect(Math.abs(midpoint - fn((i + 0.5) / steps))).toBeLessThan(0.002);
    }
  });
});
