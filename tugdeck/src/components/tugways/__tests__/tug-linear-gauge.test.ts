/**
 * Pure-logic tests for the `TugLinearGauge` geometry + threshold
 * helpers. Exercises the three exported helpers — `clampToDomain`,
 * `computeFillRatio`, `effectiveFillRole` — across the contracts
 * documented in the component module:
 *
 *   - domain validation rejects `max <= min`
 *   - out-of-range values clamp at the bounds
 *   - fill ratio is `(clamped - min) / (max - min)`, in `[0, 1]`
 *   - role derivation honors `danger` > `caution` > `baseRole`
 *
 * No DOM rendering — these are the geometry primitives the visual
 * layer rides on. The component itself is HMR-vetted (per the plan's
 * gallery card checkpoint); the math is the only thing worth pinning
 * in a unit test.
 */

import { describe, it, expect } from "bun:test";

import {
  clampToDomain,
  computeFillRatio,
  effectiveFillRole,
} from "@/components/tugways/tug-linear-gauge";

describe("TugLinearGauge — clampToDomain", () => {
  it("returns the value unchanged when it sits inside the domain", () => {
    expect(clampToDomain(50, 0, 100)).toBe(50);
    expect(clampToDomain(0, 0, 100)).toBe(0);
    expect(clampToDomain(100, 0, 100)).toBe(100);
  });

  it("clamps values below min to min", () => {
    expect(clampToDomain(-10, 0, 100)).toBe(0);
    expect(clampToDomain(-Infinity, -5, 5)).toBe(-5);
  });

  it("clamps values above max to max", () => {
    expect(clampToDomain(150, 0, 100)).toBe(100);
    expect(clampToDomain(Infinity, -5, 5)).toBe(5);
  });

  it("handles negative domains", () => {
    expect(clampToDomain(-7, -10, -5)).toBe(-7);
    expect(clampToDomain(-12, -10, -5)).toBe(-10);
    expect(clampToDomain(-3, -10, -5)).toBe(-5);
  });
});

describe("TugLinearGauge — computeFillRatio", () => {
  it("maps the midpoint to 0.5", () => {
    expect(computeFillRatio(50, 0, 100)).toBe(0.5);
  });

  it("returns 0 at min and 1 at max", () => {
    expect(computeFillRatio(0, 0, 100)).toBe(0);
    expect(computeFillRatio(100, 0, 100)).toBe(1);
  });

  it("clamps before computing the ratio", () => {
    expect(computeFillRatio(-10, 0, 100)).toBe(0);
    expect(computeFillRatio(150, 0, 100)).toBe(1);
  });

  it("handles a token-window-shaped domain", () => {
    // 32,500 / 200,000 → 0.1625 (the [#step-20-3] example value).
    expect(computeFillRatio(32_500, 0, 200_000)).toBeCloseTo(0.1625, 6);
  });

  it("handles a negative-anchored domain", () => {
    expect(computeFillRatio(-5, -10, 0)).toBe(0.5);
    expect(computeFillRatio(-10, -10, 0)).toBe(0);
    expect(computeFillRatio(0, -10, 0)).toBe(1);
  });

  it("throws when max equals min", () => {
    expect(() => computeFillRatio(50, 100, 100)).toThrow(
      /max .* must be strictly greater than min/,
    );
  });

  it("throws when max is less than min", () => {
    expect(() => computeFillRatio(50, 100, 0)).toThrow(
      /max .* must be strictly greater than min/,
    );
  });
});

describe("TugLinearGauge — effectiveFillRole", () => {
  it("returns baseRole when no thresholds are configured", () => {
    expect(effectiveFillRole(0.5, "default", undefined)).toBe("default");
    expect(effectiveFillRole(0.95, "info", undefined)).toBe("info");
    expect(effectiveFillRole(0.99, "success", undefined)).toBe("success");
  });

  it("returns baseRole when value is below both thresholds", () => {
    expect(
      effectiveFillRole(0.5, "default", { caution: 0.75, danger: 0.9 }),
    ).toBe("default");
    expect(
      effectiveFillRole(0.7, "info", { caution: 0.75, danger: 0.9 }),
    ).toBe("info");
  });

  it("returns caution when value crosses the caution threshold", () => {
    expect(
      effectiveFillRole(0.75, "default", { caution: 0.75, danger: 0.9 }),
    ).toBe("caution");
    expect(
      effectiveFillRole(0.85, "default", { caution: 0.75, danger: 0.9 }),
    ).toBe("caution");
  });

  it("returns danger when value crosses the danger threshold", () => {
    expect(
      effectiveFillRole(0.9, "default", { caution: 0.75, danger: 0.9 }),
    ).toBe("danger");
    expect(
      effectiveFillRole(0.99, "default", { caution: 0.75, danger: 0.9 }),
    ).toBe("danger");
  });

  it("treats danger as a strict superset of caution", () => {
    // Even though the value technically also exceeds caution, the
    // danger band wins.
    expect(
      effectiveFillRole(0.95, "default", { caution: 0.5, danger: 0.9 }),
    ).toBe("danger");
  });

  it("honors a caution-only configuration", () => {
    expect(
      effectiveFillRole(0.6, "info", { caution: 0.5 }),
    ).toBe("caution");
    expect(
      effectiveFillRole(0.95, "info", { caution: 0.5 }),
    ).toBe("caution");
  });

  it("honors a danger-only configuration", () => {
    expect(
      effectiveFillRole(0.6, "info", { danger: 0.9 }),
    ).toBe("info");
    expect(
      effectiveFillRole(0.95, "info", { danger: 0.9 }),
    ).toBe("danger");
  });

  it("treats threshold-at-zero as 'always promote'", () => {
    expect(
      effectiveFillRole(0.0, "default", { danger: 0 }),
    ).toBe("danger");
  });

  it("treats threshold-at-one as 'only at saturation'", () => {
    expect(
      effectiveFillRole(0.99, "default", { danger: 1 }),
    ).toBe("default");
    expect(
      effectiveFillRole(1.0, "default", { danger: 1 }),
    ).toBe("danger");
  });
});
