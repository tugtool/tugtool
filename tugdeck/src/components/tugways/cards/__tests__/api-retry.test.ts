/**
 * Unit tests for the pure `api-retry` presentation helpers —
 * `classifyApiRetry` (category → label + severity taxonomy) and
 * `formatRetryCountdown` (deadline → countdown string).
 */

import { describe, it, expect } from "bun:test";

import {
  classifyApiRetry,
  formatRetryCountdown,
} from "@/components/tugways/cards/api-retry";

describe("classifyApiRetry — category taxonomy", () => {
  it("maps transient categories to caution-grade severity", () => {
    expect(classifyApiRetry("rate_limit", 429)).toEqual({
      label: "Rate limited",
      severity: "transient",
    });
    expect(classifyApiRetry("overloaded", 529)).toEqual({
      label: "Servers overloaded",
      severity: "transient",
    });
    expect(classifyApiRetry("timeout", null)).toEqual({
      label: "Request timed out",
      severity: "transient",
    });
    expect(classifyApiRetry("api_error", 500)).toEqual({
      label: "Server error",
      severity: "transient",
    });
  });

  it("maps likely-fatal categories to fatal severity", () => {
    expect(classifyApiRetry("authentication_failed", 401)).toEqual({
      label: "Authentication failed",
      severity: "likely-fatal",
    });
    expect(classifyApiRetry("billing_error", 402)).toEqual({
      label: "Billing problem",
      severity: "likely-fatal",
    });
    expect(classifyApiRetry("permission_error", 403)).toEqual({
      label: "Permission denied",
      severity: "likely-fatal",
    });
  });

  it("falls back to Server error/transient for an unknown 5xx", () => {
    expect(classifyApiRetry("something_new", 503)).toEqual({
      label: "Server error",
      severity: "transient",
    });
  });

  it("falls back to API error/transient for an unrecognized non-5xx", () => {
    expect(classifyApiRetry("mystery", null)).toEqual({
      label: "API error",
      severity: "transient",
    });
    expect(classifyApiRetry("mystery", 418)).toEqual({
      label: "API error",
      severity: "transient",
    });
  });
});

describe("formatRetryCountdown", () => {
  it("rounds up remaining time to whole seconds", () => {
    expect(formatRetryCountdown(10_000, 1_500)).toBe("9s");
    expect(formatRetryCountdown(10_000, 9_001)).toBe("1s");
    expect(formatRetryCountdown(10_000, 10_000 - 1)).toBe("1s");
  });

  it("shows 'now' once the deadline has passed", () => {
    expect(formatRetryCountdown(10_000, 10_000)).toBe("now");
    expect(formatRetryCountdown(10_000, 12_000)).toBe("now");
  });
});
