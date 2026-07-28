/**
 * list-view-striping.test.ts — `resolveRowStriping` pure-resolution tests.
 */

import { describe, expect, test } from "bun:test";

import {
  resolveRowStriping,
  type TugListViewStripeStrength,
} from "../list-view-striping";

const STRENGTHS: TugListViewStripeStrength[] = [
  "faint",
  "subtle",
  "medium",
  "strong",
];

describe("resolveRowStriping", () => {
  test("omitted and \"none\" both mean no striping", () => {
    expect(resolveRowStriping(undefined)).toBeNull();
    expect(resolveRowStriping("none")).toBeNull();
  });

  test("a strength name resolves to a foreground wash at that alpha", () => {
    const subtle = resolveRowStriping("subtle");
    expect(subtle).not.toBeNull();
    expect(subtle!.color).toContain("color-mix");
    expect(subtle!.color).toContain("--tugx-list-view-stripe-tint");
    expect(subtle!.color).toContain("4%");
  });

  test("the strengths are a strictly increasing scale", () => {
    const alphas = STRENGTHS.map((s) => {
      const resolved = resolveRowStriping(s);
      const match = /(\d+(?:\.\d+)?)%/.exec(resolved!.color);
      return Number(match![1]);
    });
    for (let i = 1; i < alphas.length; i += 1) {
      expect(alphas[i]).toBeGreaterThan(alphas[i - 1]!);
    }
  });

  test("the object form defaults to subtle and honors an explicit strength", () => {
    expect(resolveRowStriping({})!.color).toBe(resolveRowStriping("subtle")!.color);
    expect(resolveRowStriping({ strength: "strong" })!.color).toBe(
      resolveRowStriping("strong")!.color,
    );
  });

  test("a numeric strength is the wash alpha as a percent", () => {
    expect(resolveRowStriping({ strength: 4 })!.color).toBe(
      resolveRowStriping("subtle")!.color,
    );
    expect(resolveRowStriping({ strength: 5.5 })!.color).toContain("5.5%");
  });

  test("an explicit color overrides the strength scale outright", () => {
    const resolved = resolveRowStriping({
      strength: "strong",
      color: "var(--tug7-surface-global-primary-normal-content-rest)",
    });
    expect(resolved!.color).toBe(
      "var(--tug7-surface-global-primary-normal-content-rest)",
    );
  });
});
