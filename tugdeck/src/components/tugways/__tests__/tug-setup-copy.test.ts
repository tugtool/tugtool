/**
 * Pure-logic coverage for TugSetup's subscription copy ([D105]). The signed-in
 * step's subscription line can only be exercised live for whatever tier the
 * golden-run test account happens to hold, so the per-tier wording is pinned
 * here instead — covering the nodes a VM run can't reach without an account of
 * each tier.
 */

import { describe, expect, test } from "bun:test";

import {
  subscriptionLabel,
  pendingOpenStepCopy,
  formatModelSize,
  localAiOfferDetail,
  localAiProgressValue,
} from "../tug-setup-copy";

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

describe("formatModelSize", () => {
  test("reports gigabytes at one decimal place", () => {
    expect(formatModelSize(2_315_155_948)).toBe("2.3 GB");
    expect(formatModelSize(1_000_000_000)).toBe("1.0 GB");
  });

  test("drops the decimal once the number is large enough not to need it", () => {
    expect(formatModelSize(12_400_000_000)).toBe("12 GB");
  });

  test("nothing received yet is a real zero, not a missing size", () => {
    expect(formatModelSize(0)).toBe("0.0 GB");
  });

  test("a size we don't have reads as a dash", () => {
    expect(formatModelSize(Number.NaN)).toBe("—");
    expect(formatModelSize(-1)).toBe("—");
  });
});

describe("localAiOfferDetail", () => {
  test("names the model, its cost in disk, and what it's for", () => {
    expect(
      localAiOfferDetail("Ternary Bonsai 8B", 2_315_155_948, "Runs offline."),
    ).toBe("Ternary Bonsai 8B • 2.3 GB download. Runs offline.");
  });

  test("a note-less entry ends after the size, with no dangling period", () => {
    expect(localAiOfferDetail("Ternary Bonsai 8B", 2_315_155_948)).toBe(
      "Ternary Bonsai 8B • 2.3 GB download",
    );
    expect(localAiOfferDetail("Ternary Bonsai 8B", 2_315_155_948, "  ")).toBe(
      "Ternary Bonsai 8B • 2.3 GB download",
    );
  });
});

describe("localAiProgressValue", () => {
  test("reads as received-of-total, with no words the bar already says", () => {
    expect(localAiProgressValue(1_200_000_000, 2_315_155_948)).toBe(
      "1.2 GB of 2.3 GB",
    );
  });

  test("falls back to a bare line before the total is known", () => {
    expect(localAiProgressValue(0, 0)).toBe("Downloading…");
  });
});
