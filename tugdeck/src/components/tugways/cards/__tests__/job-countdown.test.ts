/**
 * Pure-logic test for the scheduled-wakeup countdown formatter. The
 * `JobCountdownValue` component wires this to the shared 1Hz tick and
 * renders through the real-app harness; here we pin the deterministic
 * format, including the elapsed-but-not-yet-flipped "firing…" case.
 */

import { describe, expect, it } from "bun:test";

import {
  formatWakeCountdown,
  scheduledCancelEnabled,
  wakeBadgeText,
} from "@/components/tugways/cards/dev-card-telemetry-popovers";
import { STALE_THRESHOLD_MS } from "@/lib/code-session-store/select-scheduled-work";
import type { JobItem } from "@/lib/code-session-store/select-jobs";

function job(over: Partial<JobItem> & { jobId: string }): JobItem {
  return {
    source: "claude",
    kind: "wakeup",
    toolUseId: `toolu_${over.jobId}`,
    description: "",
    status: "scheduled",
    startedAtMs: 0,
    endedAtMs: null,
    ...over,
  };
}

describe("scheduledCancelEnabled", () => {
  it("enables Cancel only for a scheduled cron — wakeups (lone or loop) stay disabled", () => {
    expect(scheduledCancelEnabled(job({ jobId: "c", kind: "cron" }))).toBe(true);
    expect(scheduledCancelEnabled(job({ jobId: "w", kind: "wakeup" }))).toBe(false);
    // A terminal cron is not cancellable either.
    expect(
      scheduledCancelEnabled(
        job({ jobId: "c", kind: "cron", status: "stopped", endedAtMs: 1 }),
      ),
    ).toBe(false);
  });
});

describe("wakeBadgeText", () => {
  it("marks a wakeup that completed past the threshold as 'fired late'", () => {
    expect(
      wakeBadgeText(
        job({
          jobId: "w",
          status: "completed",
          firesAtMs: 1_000,
          endedAtMs: 1_000 + STALE_THRESHOLD_MS + 1,
        }),
      ),
    ).toBe("fired late");
    // On-time completion gets no badge.
    expect(
      wakeBadgeText(
        job({ jobId: "w", status: "completed", firesAtMs: 1_000, endedAtMs: 1_500 }),
      ),
    ).toBeNull();
  });

  it("marks a stopped-while-pending wakeup as 'never fired'", () => {
    expect(
      wakeBadgeText(job({ jobId: "w", status: "stopped", firesAtMs: 1_000, endedAtMs: 9_000 })),
    ).toBe("never fired");
  });

  it("never badges a cron or a still-scheduled row", () => {
    expect(wakeBadgeText(job({ jobId: "c", kind: "cron", status: "completed", endedAtMs: 9 }))).toBeNull();
    expect(wakeBadgeText(job({ jobId: "w", status: "scheduled", firesAtMs: 1_000 }))).toBeNull();
  });
});

describe("formatWakeCountdown", () => {
  it("counts down while the target is in the future", () => {
    expect(formatWakeCountdown(60_000, 0)).toBe("fires in 1m 00s");
    expect(formatWakeCountdown(52_000, 0)).toBe("fires in 52s");
  });

  it("reads 'firing…' at and past the target (status flips out-of-band)", () => {
    expect(formatWakeCountdown(1_000, 1_000)).toBe("firing…");
    expect(formatWakeCountdown(1_000, 5_000)).toBe("firing…");
  });
});
