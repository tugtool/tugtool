/**
 * The guard on the one rule: a breathing glyph claims work is executing
 * right now, so `running` is reachable only from a status that means
 * exactly that.
 *
 * These are exhaustive over each status enum on purpose. Adding a status
 * without deciding its liveness is how "pending" crept into `running` at
 * four independent call sites; a missing case here fails the build rather
 * than quietly breathing on a settled deck.
 */

import { describe, expect, it } from "bun:test";

import {
  goalRowState,
  jobRowState,
  taskRowState,
} from "../indicator-liveness";
import { sessionSessionPhaseVisual } from "../session-phase-visual";
import type { SessionPhaseKey } from "../session-phase-visual";
import { toolCallPhaseVisual } from "../tool-call-phase-visual";
import type { ToolCallPhase } from "../tool-call-phase-visual";
import { jobsCellPose } from "../select-jobs";
import type { JobItem, JobStatus } from "../select-jobs";
import type { GoalState } from "../select-goal";
import type { TaskStatus } from "../select-task-list";

const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
];

const JOB_STATUSES: readonly JobStatus[] = [
  "running",
  "scheduled",
  "completed",
  "failed",
  "stopped",
];

const SESSION_PHASE_KEYS: readonly SessionPhaseKey[] = [
  "offline",
  "restoring",
  "interrupting",
  "idle",
  "background",
  "submitting",
  "awaiting_first_token",
  "streaming",
  "tool_work",
  "awaiting_approval",
  "replaying",
  "waking",
  "errored",
];

const TOOL_CALL_PHASES: readonly ToolCallPhase[] = [
  "idle",
  "in_flight",
  "awaiting",
  "success",
  "error",
  "interrupted",
];

/**
 * The session phases during which the runtime is actually executing.
 * Everything else — idle, blocked on the user, dead — must not breathe.
 */
const EXECUTING_SESSION_PHASES: ReadonlySet<string> = new Set([
  "restoring",
  "interrupting",
  // A backgrounded agent runs after its launching turn commits. The turn
  // is over; the work is not. That is executing, so it breathes.
  "background",
  "submitting",
  "awaiting_first_token",
  "streaming",
  "tool_work",
  "replaying",
  "waking",
]);

function goal(status: GoalState["status"]): GoalState {
  return {
    condition: "the tests pass",
    status,
    turnsEvaluated: 0,
    latestReason: null,
    setAtMs: null,
    cycleTurnKey: null,
  };
}

function job(status: JobStatus): JobItem {
  return { id: `job-${status}`, status } as unknown as JobItem;
}

describe("the liveness rule — only executing work breathes", () => {
  it("lets no task status breathe while the session is idle", () => {
    for (const status of TASK_STATUSES) {
      expect(taskRowState(status, true)).not.toBe("running");
    }
  });

  it("breathes for a working session's in-progress task, and only that one", () => {
    for (const status of TASK_STATUSES) {
      const live = taskRowState(status, false) === "running";
      expect(live).toBe(status === "in_progress");
    }
  });

  it("breathes for a running job, and only a running job", () => {
    for (const status of JOB_STATUSES) {
      expect(jobRowState(status) === "running").toBe(status === "running");
    }
  });

  it("never breathes for a goal — a goal is a standing condition, not work", () => {
    for (const status of ["active", "achieved", "cleared"] as const) {
      expect(goalRowState(goal(status))).not.toBe("running");
    }
  });

  it("breathes for exactly the session phases that are executing", () => {
    for (const key of SESSION_PHASE_KEYS) {
      const live = sessionSessionPhaseVisual(key).state === "running";
      expect([key, live]).toEqual([key, EXECUTING_SESSION_PHASES.has(key)]);
    }
  });

  it("breathes for exactly the tool-call phase that is executing", () => {
    for (const phase of TOOL_CALL_PHASES) {
      const live = toolCallPhaseVisual(phase).state === "running";
      expect([phase, live]).toEqual([phase, phase === "in_flight"]);
    }
  });

  it("breathes the WORK/JOBS cell only when a job is actually running", () => {
    expect(jobsCellPose([job("running")])).toBe("running");
    expect(jobsCellPose([job("scheduled")])).toBe("stopped");
    expect(jobsCellPose([job("scheduled"), job("running")])).toBe("running");
  });
});

describe("blocked-on-a-human is `paused`, not motion and not idle", () => {
  it("holds the session's awaiting-approval dot at the substantial pose", () => {
    expect(sessionSessionPhaseVisual("awaiting_approval")).toEqual({
      role: "caution",
      state: "paused",
    });
  });

  it("holds a dialog-blocked tool call at the same pose", () => {
    expect(toolCallPhaseVisual("awaiting")).toEqual({
      role: "caution",
      state: "paused",
    });
  });

  it("keeps `paused` distinct from the quiet states", () => {
    // `paused` must never collapse into `stopped`: the two say different
    // things (waiting on you vs. nothing to wait for) and the presence
    // ladder draws them at different sizes.
    expect(sessionSessionPhaseVisual("awaiting_approval").state).not.toBe(
      sessionSessionPhaseVisual("idle").state,
    );
  });
});

describe("waiting on a clock reads as stopped, never as motion", () => {
  it("does not breathe for a scheduled wakeup", () => {
    expect(jobRowState("scheduled")).toBe("stopped");
  });

  it("still lets a failure nag past a scheduled row", () => {
    expect(jobsCellPose([job("scheduled"), job("failed")])).toBe("aborted");
  });
});
