/**
 * rate-limit.test.ts — pure-logic coverage for the Z4B rate-limit chip
 * helpers ([#step-3]).
 *
 * No store, no DOM — the chip mount/unmount and the direct-DOM countdown
 * tick are covered by the real-app test (at0095); this pins the visibility
 * predicate, severity mapping, and countdown formatter, mirroring
 * `model-label.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { RateLimitInfo } from "@/protocol";
import {
  formatResetCountdown,
  isRateLimitChipVisible,
  isRateLimitExhausted,
  rateLimitContent,
  rateLimitSeverity,
  RATE_LIMIT_NEAR_RESET_MS,
} from "@/lib/rate-limit";

/** A base `allowed` quota whose reset is far in the future. */
function info(overrides: Partial<RateLimitInfo> = {}): RateLimitInfo {
  return {
    status: "allowed",
    resetsAt: 2_000_000_000,
    rateLimitType: "five_hour",
    overageStatus: "accepted",
    isUsingOverage: false,
    ...overrides,
  };
}

// A fixed "now" in ms, well before the base `resetsAt` above.
const NOW_MS = 1_900_000_000 * 1000;

describe("isRateLimitChipVisible", () => {
  test("null quota is never visible", () => {
    expect(isRateLimitChipVisible(null, NOW_MS)).toBe(false);
  });

  test("allowed with a far reset is hidden", () => {
    // ~100M seconds out — well beyond the 60-min window.
    expect(isRateLimitChipVisible(info(), NOW_MS)).toBe(false);
  });

  test("allowed with a reset inside the 60-min window is visible", () => {
    const resetsAt = Math.floor(NOW_MS / 1000) + 30 * 60; // 30 min out
    expect(isRateLimitChipVisible(info({ resetsAt }), NOW_MS)).toBe(true);
  });

  test("the 60-min boundary is inclusive (<= window is visible)", () => {
    const resetsAt = Math.floor((NOW_MS + RATE_LIMIT_NEAR_RESET_MS) / 1000);
    expect(isRateLimitChipVisible(info({ resetsAt }), NOW_MS)).toBe(true);
  });

  test("a non-allowed status is always visible regardless of reset", () => {
    expect(
      isRateLimitChipVisible(info({ status: "warning" }), NOW_MS),
    ).toBe(true);
    expect(
      isRateLimitChipVisible(info({ status: "exceeded" }), NOW_MS),
    ).toBe(true);
  });
});

describe("rateLimitSeverity", () => {
  test("allowed + no overage is at rest", () => {
    expect(rateLimitSeverity(info())).toBe("rest");
  });

  test("warning escalates to caution", () => {
    expect(rateLimitSeverity(info({ status: "warning" }))).toBe("caution");
  });

  test("consuming overage escalates to caution even when allowed", () => {
    expect(rateLimitSeverity(info({ isUsingOverage: true }))).toBe("caution");
  });

  test("an exhausted window is danger", () => {
    expect(rateLimitSeverity(info({ status: "exceeded" }))).toBe("danger");
  });

  test("rejected overage is danger", () => {
    expect(
      rateLimitSeverity(info({ status: "warning", overageStatus: "rejected" })),
    ).toBe("danger");
  });
});

describe("isRateLimitExhausted", () => {
  test("allowed and warning are not exhausted", () => {
    expect(isRateLimitExhausted(info())).toBe(false);
    expect(isRateLimitExhausted(info({ status: "warning" }))).toBe(false);
  });

  test("any other status is exhausted", () => {
    expect(isRateLimitExhausted(info({ status: "exceeded" }))).toBe(true);
    expect(isRateLimitExhausted(info({ status: "blocked" }))).toBe(true);
  });
});

describe("formatResetCountdown", () => {
  const now = 1_000_000 * 1000; // 1,000,000 s in ms

  test("more than an hour out shows Xh Ym", () => {
    expect(formatResetCountdown(1_000_000 + 5 * 3600 + 23 * 60, now)).toBe(
      "5h 23m",
    );
  });

  test("less than an hour out shows Ym", () => {
    expect(formatResetCountdown(1_000_000 + 59 * 60, now)).toBe("59m");
  });

  test("under a minute shows <1m", () => {
    expect(formatResetCountdown(1_000_000 + 30, now)).toBe("<1m");
  });

  test("a passed reset shows now", () => {
    expect(formatResetCountdown(1_000_000, now)).toBe("now");
    expect(formatResetCountdown(1_000_000 - 100, now)).toBe("now");
  });

  test("an exact hour shows Xh 0m", () => {
    expect(formatResetCountdown(1_000_000 + 2 * 3600, now)).toBe("2h 0m");
  });
});

describe("rateLimitContent", () => {
  const now = 1_000_000 * 1000;

  test("a live window shows the countdown", () => {
    expect(
      rateLimitContent(
        info({ status: "warning", resetsAt: 1_000_000 + 42 * 60 }),
        now,
      ),
    ).toBe("42m");
  });

  test("an exhausted window shows the static Rate-limited face", () => {
    expect(
      rateLimitContent(info({ status: "exceeded", resetsAt: 1_000_000 + 42 * 60 }), now),
    ).toBe("Rate-limited");
  });
});
