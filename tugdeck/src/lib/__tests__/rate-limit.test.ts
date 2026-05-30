/**
 * rate-limit.test.ts — pure-logic coverage for the app-level rate-limit
 * banner helpers ([#step-3.5]).
 *
 * No store, no DOM — the banner mount/dedup is covered by the real-app test;
 * this pins the trigger policy and the countdown formatter, mirroring
 * `model-label.test.ts`.
 *
 * The `status` enum is the one confirmed from the CLI v2.1.158 schema:
 * `allowed` | `allowed_warning` | `rejected`. The benign default every
 * captured payload carries is `status: "allowed"`, `overageStatus:
 * "rejected"` (org-overage-off) — which must NOT escalate.
 */

import { describe, expect, test } from "bun:test";
import type { RateLimitInfo } from "@/protocol";
import { formatResetCountdown, rateLimitBannerState } from "@/lib/rate-limit";

/** The benign default: allowed quota, overage org-disabled. */
function info(overrides: Partial<RateLimitInfo> = {}): RateLimitInfo {
  return {
    status: "allowed",
    resetsAt: 2_000_000_000,
    rateLimitType: "five_hour",
    overageStatus: "rejected",
    isUsingOverage: false,
    ...overrides,
  };
}

describe("rateLimitBannerState", () => {
  test("null quota is ok (no banner)", () => {
    expect(rateLimitBannerState(null)).toBe("ok");
  });

  test("the benign default is ok — overageStatus:rejected must not escalate", () => {
    // The exact payload that previously lit a red chip on a healthy session.
    expect(rateLimitBannerState(info())).toBe("ok");
  });

  test("allowed_warning is approaching", () => {
    expect(rateLimitBannerState(info({ status: "allowed_warning" }))).toBe(
      "approaching",
    );
  });

  test("rejected is limited", () => {
    expect(rateLimitBannerState(info({ status: "rejected" }))).toBe("limited");
  });

  test("overage close (isUsingOverage + overageStatus allowed_warning) is approaching", () => {
    expect(
      rateLimitBannerState(
        info({ isUsingOverage: true, overageStatus: "allowed_warning" }),
      ),
    ).toBe("approaching");
  });

  test("overage rejected alone (not using overage) stays ok", () => {
    expect(
      rateLimitBannerState(info({ isUsingOverage: false, overageStatus: "rejected" })),
    ).toBe("ok");
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
