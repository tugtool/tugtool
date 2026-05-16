/**
 * Pure-logic tests for the telemetry-renderer formatters. The
 * renderer components themselves render React nodes and are
 * exercised through the real-app harness; here we pin the
 * deterministic value-formatting helpers so future tuning can
 * change them deliberately.
 */

import { describe, expect, it } from "bun:test";

import {
  formatDurationMs,
  formatTokens,
  formatUsd,
} from "@/components/tugways/cards/tide-card-telemetry-renderers";

describe("formatTokens", () => {
  it("returns an integer string under 1k", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(999)).toBe("999");
  });

  it("collapses thousands to one decimal `Nk`", () => {
    expect(formatTokens(1_000)).toBe("1.0k");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(999_999)).toBe("1000.0k");
  });

  it("collapses millions to two decimals `N.NNM`", () => {
    expect(formatTokens(1_000_000)).toBe("1.00M");
    expect(formatTokens(1_234_567)).toBe("1.23M");
  });

  it("guards against NaN / negatives", () => {
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(formatTokens(-1)).toBe("0");
  });
});

describe("formatDurationMs", () => {
  it("renders sub-second as `Nms`", () => {
    expect(formatDurationMs(0)).toBe("0ms");
    expect(formatDurationMs(250)).toBe("250ms");
  });

  it("renders sub-10s as `N.Ds`", () => {
    expect(formatDurationMs(1_000)).toBe("1.0s");
    expect(formatDurationMs(2_500)).toBe("2.5s");
    expect(formatDurationMs(9_900)).toBe("9.9s");
  });

  it("renders 10s..1m as whole seconds", () => {
    expect(formatDurationMs(10_000)).toBe("10s");
    expect(formatDurationMs(59_499)).toBe("59s");
  });

  it("renders minutes as `Nm SSs` with zero-padded seconds", () => {
    expect(formatDurationMs(60_000)).toBe("1m 00s");
    expect(formatDurationMs(125_500)).toBe("2m 05s");
  });

  it("renders hours as `Nh MMm` with zero-padded minutes", () => {
    expect(formatDurationMs(3_600_000)).toBe("1h 00m");
    expect(formatDurationMs(3_660_000)).toBe("1h 01m");
    expect(formatDurationMs(7_320_000)).toBe("2h 02m");
  });

  it("guards against NaN / negatives", () => {
    expect(formatDurationMs(Number.NaN)).toBe("0s");
    expect(formatDurationMs(-1)).toBe("0s");
  });
});

describe("formatUsd", () => {
  it("renders sub-dollar with 4 decimals", () => {
    expect(formatUsd(0)).toBe("$0.0000");
    expect(formatUsd(0.0012)).toBe("$0.0012");
    expect(formatUsd(0.9999)).toBe("$0.9999");
  });

  it("renders ≥ $1 with 2 decimals", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12.345)).toBe("$12.35");
  });

  it("guards against NaN / negatives", () => {
    expect(formatUsd(Number.NaN)).toBe("$0");
    expect(formatUsd(-1)).toBe("$0");
  });
});
