/**
 * Pure-logic test for the scheduled-wakeup helpers. `formatWakeSchedule`
 * reads the row's *requested* delay (not a live clock) and renders a
 * coarse, approximate label — the harness fires on its own jittered
 * minute-boundary schedule, so a ticking per-second countdown would be
 * false precision.
 */

import { describe, expect, it } from "bun:test";

import {
  formatWakeSchedule,
  scheduledCancelEnabled,
  wakeBadgeText,
} from "@/components/tugways/cards/session-card-telemetry-popovers";
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

describe("formatWakeSchedule", () => {
  it("renders an approximate minute label from the requested delay — no false precision", () => {
    expect(formatWakeSchedule(60_000)).toBe("fires in ~1m");
    expect(formatWakeSchedule(300_000)).toBe("fires in ~5m");
    // Sub-minute rounds up to ~1m (the harness fires at the next minute
    // boundary anyway); 90s rounds to ~2m.
    expect(formatWakeSchedule(5_000)).toBe("fires in ~1m");
    expect(formatWakeSchedule(90_000)).toBe("fires in ~2m");
  });

  it("switches to an hour label past 60 minutes", () => {
    expect(formatWakeSchedule(3_600_000)).toBe("fires in ~1h");
    expect(formatWakeSchedule(2 * 3_600_000)).toBe("fires in ~2h");
  });
});
