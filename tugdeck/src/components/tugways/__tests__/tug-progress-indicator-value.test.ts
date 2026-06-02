/**
 * Pure-logic coverage for `defaultProgressValueLabel` — the percentage
 * formatter behind `TugProgressIndicator`'s `showValue` readout.
 */

import { describe, expect, test } from "bun:test";

import { defaultProgressValueLabel } from "@/components/tugways/tug-progress-indicator";

describe("defaultProgressValueLabel", () => {
  test("formats a fraction of the default max (1) as a whole percent", () => {
    expect(defaultProgressValueLabel(0, 1)).toBe("0%");
    expect(defaultProgressValueLabel(0.42, 1)).toBe("42%");
    expect(defaultProgressValueLabel(1, 1)).toBe("100%");
  });

  test("rounds to the nearest whole percent", () => {
    expect(defaultProgressValueLabel(0.426, 1)).toBe("43%");
    expect(defaultProgressValueLabel(0.424, 1)).toBe("42%");
  });

  test("honors a non-1 max", () => {
    expect(defaultProgressValueLabel(25, 50)).toBe("50%");
    expect(defaultProgressValueLabel(200, 200)).toBe("100%");
  });

  test("is safe when max is 0 (no division by zero)", () => {
    expect(defaultProgressValueLabel(0, 0)).toBe("0%");
  });
});
