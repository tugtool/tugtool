/**
 * Unit tests for the pure `api-retry` classifier — `classifyApiRetry`
 * (category + nullable HTTP status → label + severity taxonomy).
 */

import { describe, it, expect } from "bun:test";

import { classifyApiRetry } from "@/components/tugways/cards/api-retry";

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

  it("names a no-status network failure rather than the bare generic", () => {
    // Real shapes lifted from the on-disk JSONL audit — all arrive with no
    // HTTP status and previously rendered the alarming bare "API error".
    for (const error of [
      "ECONNRESET",
      "FailedToOpenSocket",
      "Connection error.",
      "Request timed out.",
      "socket hang up",
    ]) {
      expect(classifyApiRetry(error, null)).toEqual({
        label: "Connection lost",
        severity: "transient",
      });
    }
  });

  it("does not mistake a status-bearing failure for a network error", () => {
    // A 5xx wins even if its category string mentions a connection.
    expect(classifyApiRetry("connection reset upstream", 503)).toEqual({
      label: "Server error",
      severity: "transient",
    });
  });

  it("falls back to API error/transient for a non-network unknown", () => {
    expect(classifyApiRetry("mystery", null)).toEqual({
      label: "API error",
      severity: "transient",
    });
    expect(classifyApiRetry("mystery", 418)).toEqual({
      label: "API error",
      severity: "transient",
    });
  });

  it("never throws on an empty or odd error string", () => {
    expect(() => classifyApiRetry("", null)).not.toThrow();
    expect(classifyApiRetry("", null).label).toBe("API error");
  });
});
