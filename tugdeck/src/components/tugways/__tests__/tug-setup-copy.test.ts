/**
 * Pure-logic coverage for TugSetup's subscription copy ([D105]). The signed-in
 * step's subscription line can only be exercised live for whatever tier the
 * golden-run test account happens to hold, so the per-tier wording is pinned
 * here instead — covering the nodes a VM run can't reach without an account of
 * each tier.
 */

import { describe, expect, test } from "bun:test";

import { subscriptionLabel, pendingOpenStepCopy } from "../tug-setup-copy";

describe("subscriptionLabel", () => {
  test("maps each known tier to its formal label (no trailing period)", () => {
    expect(subscriptionLabel("max")).toBe("Claude Max plan");
    expect(subscriptionLabel("pro")).toBe("Claude Pro plan");
    expect(subscriptionLabel("team")).toBe("Claude Team plan");
    expect(subscriptionLabel("enterprise")).toBe("Claude Enterprise plan");
    expect(subscriptionLabel("free")).toBe("Claude Free plan");
  });

  test("is case- and whitespace-insensitive on the wire value", () => {
    expect(subscriptionLabel("MAX")).toBe("Claude Max plan");
    expect(subscriptionLabel("  Pro  ")).toBe("Claude Pro plan");
  });

  test("omits the line when the tier is unknown/empty", () => {
    expect(subscriptionLabel(null)).toBeUndefined();
    expect(subscriptionLabel(undefined)).toBeUndefined();
    expect(subscriptionLabel("")).toBeUndefined();
    expect(subscriptionLabel("   ")).toBeUndefined();
  });

  test("title-cases an unrecognized tier rather than leaking it raw", () => {
    expect(subscriptionLabel("startup")).toBe("Claude Startup plan");
    // Never a bare lowercase token or a trailing period.
    expect(subscriptionLabel("scale")).toBe("Claude Scale plan");
  });
});

describe("pendingOpenStepCopy", () => {
  test("zero cards → first-run wording, no detail", () => {
    expect(pendingOpenStepCopy(0)).toEqual({
      label: "Start a Claude Code session",
    });
  });

  test("cards open → 'Continue working' preview with a pluralized count", () => {
    expect(pendingOpenStepCopy(1)).toEqual({
      label: "Continue working",
      detail: "You'll return to your 1 open card.",
    });
    expect(pendingOpenStepCopy(3)).toEqual({
      label: "Continue working",
      detail: "You'll return to your 3 open cards.",
    });
  });
});
