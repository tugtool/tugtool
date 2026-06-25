/**
 * Pure-logic tests for the scheduled-work helpers in
 * `select-scheduled-work.ts`. Input/result fixtures mirror the captured
 * tool-call reality at
 * `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`
 * `v2.1.150-spike/` (ScheduleWakeup + CronCreate).
 */

import { describe, test, expect } from "bun:test";

import type { JobItem } from "../select-jobs";
import {
  REAP_GRACE_MS,
  STALE_THRESHOLD_MS,
  flipEarliestElapsedScheduled,
  isWakeLate,
  narrowCronCreateInput,
  narrowCronDeleteInput,
  narrowScheduleWakeupInput,
  parseCronCreateResultId,
  reapElapsedScheduled,
  scheduledRowFromCron,
  scheduledRowFromWakeup,
  stopScheduledRow,
} from "../select-scheduled-work";

// Captured tool-call shapes (v2.1.150-spike).
const WAKEUP_INPUT = {
  delaySeconds: 60,
  reason: "PROBE_SW",
  prompt: "Use ScheduleWakeup to wake yourself in 60 seconds …",
};
const CRON_INPUT = {
  cron: "53 19 24 5 *",
  prompt: "Report 'SWEEP_CRON fired'",
  recurring: false,
};
const CRON_RESULT =
  "Scheduled one-shot task 3ea6c934 (53 19 24 5 *). Session-only (not" +
  " written to disk, dies when Claude exits). It will fire once then" +
  " auto-delete.";

function scheduled(over: Partial<JobItem> & { jobId: string }): JobItem {
  return {
    source: "claude",
    kind: "wakeup",
    toolUseId: `toolu_${over.jobId}`,
    description: "",
    status: "scheduled",
    startedAtMs: 1_000,
    endedAtMs: null,
    firesAtMs: 10_000,
    ...over,
  };
}

describe("narrowing", () => {
  test("narrowScheduleWakeupInput accepts the captured shape, drops a non-numeric delay", () => {
    expect(narrowScheduleWakeupInput(WAKEUP_INPUT)).toEqual({
      delaySeconds: 60,
      reason: "PROBE_SW",
      prompt: WAKEUP_INPUT.prompt,
    });
    expect(narrowScheduleWakeupInput({ delaySeconds: "soon" })).toBeUndefined();
    expect(narrowScheduleWakeupInput(null)).toBeUndefined();
  });

  test("narrowCronCreateInput requires a non-empty cron", () => {
    expect(narrowCronCreateInput(CRON_INPUT)).toEqual({
      cron: "53 19 24 5 *",
      prompt: "Report 'SWEEP_CRON fired'",
      recurring: false,
    });
    expect(narrowCronCreateInput({ cron: "" })).toBeUndefined();
    expect(narrowCronCreateInput({ prompt: "x" })).toBeUndefined();
  });

  test("narrowCronDeleteInput accepts the plausible id spellings", () => {
    expect(narrowCronDeleteInput({ cronId: "abc" })).toEqual({ cronId: "abc" });
    expect(narrowCronDeleteInput({ id: "abc" })).toEqual({ cronId: "abc" });
    expect(narrowCronDeleteInput({ task_id: "abc" })).toEqual({ cronId: "abc" });
    expect(narrowCronDeleteInput({})).toBeUndefined();
  });

  test("parseCronCreateResultId extracts the harness id, undefined on miss", () => {
    expect(parseCronCreateResultId(CRON_RESULT)).toBe("3ea6c934");
    expect(
      parseCronCreateResultId("Scheduled recurring task ff12 (* * * * *). …"),
    ).toBe("ff12");
    expect(parseCronCreateResultId("no id here")).toBeUndefined();
    expect(parseCronCreateResultId(42)).toBeUndefined();
  });
});

describe("row construction", () => {
  test("scheduledRowFromWakeup keys by tool_use_id and stamps firesAtMs", () => {
    const row = scheduledRowFromWakeup(
      "toolu_abc",
      narrowScheduleWakeupInput(WAKEUP_INPUT)!,
      5_000,
    );
    expect(row).toMatchObject({
      jobId: "toolu_abc",
      toolUseId: "toolu_abc",
      kind: "wakeup",
      status: "scheduled",
      description: "PROBE_SW",
      startedAtMs: 5_000,
      firesAtMs: 65_000,
    });
  });

  test("scheduledRowFromWakeup falls back reason→prompt→default", () => {
    expect(
      scheduledRowFromWakeup("t", { delaySeconds: 1, prompt: "p" }, 0).description,
    ).toBe("p");
    expect(
      scheduledRowFromWakeup("t", { delaySeconds: 1 }, 0).description,
    ).toBe("Scheduled wakeup");
  });

  test("scheduledRowFromCron uses the parsed id, label, and null firesAtMs", () => {
    const row = scheduledRowFromCron(
      "toolu_x",
      narrowCronCreateInput(CRON_INPUT)!,
      CRON_RESULT,
      5_000,
    );
    expect(row).toMatchObject({
      jobId: "3ea6c934",
      toolUseId: "toolu_x",
      kind: "cron",
      status: "scheduled",
      description: "Report 'SWEEP_CRON fired'",
      scheduleLabel: "53 19 24 5 *",
      firesAtMs: null,
    });
  });

  test("scheduledRowFromCron falls back to tool_use_id when the echo has no id", () => {
    const row = scheduledRowFromCron(
      "toolu_x",
      narrowCronCreateInput(CRON_INPUT)!,
      "no id",
      0,
    );
    expect(row.jobId).toBe("toolu_x");
  });
});

describe("flipEarliestElapsedScheduled", () => {
  test("flips the earliest elapsed one-shot, leaves later + not-yet-elapsed alone", () => {
    const jobs = [
      scheduled({ jobId: "late", firesAtMs: 200 }),
      scheduled({ jobId: "early", firesAtMs: 100 }),
      scheduled({ jobId: "future", firesAtMs: 10_000 }),
    ];
    const next = flipEarliestElapsedScheduled(jobs, 1_000, 1_000);
    expect(next.find((j) => j.jobId === "early")).toMatchObject({
      status: "completed",
      endedAtMs: 1_000,
    });
    expect(next.find((j) => j.jobId === "late")!.status).toBe("scheduled");
    expect(next.find((j) => j.jobId === "future")!.status).toBe("scheduled");
  });

  test("falls back to the earliest scheduled cron when no one-shot is elapsed", () => {
    const jobs = [
      scheduled({ jobId: "future", firesAtMs: 10_000 }),
      scheduled({ jobId: "cron", kind: "cron", firesAtMs: null }),
    ];
    const next = flipEarliestElapsedScheduled(jobs, 1_000, 1_000);
    expect(next.find((j) => j.jobId === "cron")!.status).toBe("completed");
  });

  test("no-op (same reference) when nothing is elapsed or scheduled", () => {
    const jobs = [scheduled({ jobId: "future", firesAtMs: 10_000 })];
    expect(flipEarliestElapsedScheduled(jobs, 1_000, 1_000)).toBe(jobs);
    expect(flipEarliestElapsedScheduled([], 1_000, 1_000)).toEqual([]);
  });
});

describe("reapElapsedScheduled", () => {
  test("stops a one-shot only after REAP_GRACE_MS past firesAtMs", () => {
    const jobs = [scheduled({ jobId: "w", firesAtMs: 1_000 })];
    // Just past fire, well inside grace → untouched (same reference).
    expect(reapElapsedScheduled(jobs, 1_000 + STALE_THRESHOLD_MS)).toBe(jobs);
    const reaped = reapElapsedScheduled(jobs, 1_000 + REAP_GRACE_MS + 1);
    expect(reaped[0]).toMatchObject({ status: "stopped", endedAtMs: 1_000 + REAP_GRACE_MS + 1 });
  });

  test("never reaps a cron (no firesAtMs)", () => {
    const jobs = [scheduled({ jobId: "c", kind: "cron", firesAtMs: null })];
    expect(reapElapsedScheduled(jobs, 9_999_999_999)).toBe(jobs);
  });
});

describe("stopScheduledRow", () => {
  test("stops a matching scheduled row; no-ops on unknown id or terminal row", () => {
    const jobs = [
      scheduled({ jobId: "cron-1", kind: "cron", firesAtMs: null }),
      scheduled({ jobId: "done", status: "completed", endedAtMs: 5 }),
    ];
    const next = stopScheduledRow(jobs, "cron-1", 9_000);
    expect(next[0]).toMatchObject({ status: "stopped", endedAtMs: 9_000 });
    // Unknown id and already-terminal row → same reference.
    expect(stopScheduledRow(jobs, "nope", 9_000)).toBe(jobs);
    expect(stopScheduledRow(jobs, "done", 9_000)).toBe(jobs);
  });
});

describe("isWakeLate", () => {
  test("true only past the stale threshold, on a completed wakeup", () => {
    expect(isWakeLate(1_000, 1_000 + STALE_THRESHOLD_MS + 1)).toBe(true);
    expect(isWakeLate(1_000, 1_000 + STALE_THRESHOLD_MS)).toBe(false);
    expect(isWakeLate(null, 999_999)).toBe(false); // cron
    expect(isWakeLate(1_000, null)).toBe(false); // still scheduled
  });

  test("REAP_GRACE_MS is comfortably larger than STALE_THRESHOLD_MS", () => {
    expect(REAP_GRACE_MS).toBeGreaterThan(STALE_THRESHOLD_MS);
  });
});
