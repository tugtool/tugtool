/**
 * Live-activity derivation — the single "what is happening right now"
 * line that keeps the transcript from going mute while the agent works.
 *
 * The transcript only renders committed turn content, so a session that
 * is busy BETWEEN visible output — a foreground tool grinding, the loop
 * idle while background jobs run, a retry backing off — looks dead. The
 * only prior sign of life was the pulse bar. {@link selectLiveActivity}
 * is the pure read that fixes that: it folds the four wire-signal
 * classes the user cares about into one compact descriptor a foot-of-
 * transcript line (and the pulse) can render.
 *
 * It is a PURE function of the public {@link CodeSessionSnapshot} — no
 * store wiring, no time source — so it is trivially testable and safe to
 * call inside `useSyncExternalStore`'s `getSnapshot` selector ([L02]).
 *
 * Priority (most urgent wins; one line, one thing):
 *   1. retrying        — `apiRetry` in flight (recovery; the user must
 *                        know a stall is a retry, not a hang)
 *   2. interrupting    — the user's stop is mid-round-trip
 *   3. waking          — resuming from a deferred/background completion
 *   4. tool            — a foreground tool call is pending
 *   5. thinking        — an active turn with no pending tool (model is
 *                        generating)
 *   6. background      — the foreground loop is idle but jobs run (THE
 *                        muteness case: nothing visible, work ongoing)
 *   7. idle            — nothing of interest
 *
 * Foreground beats background, but a foreground line annotates a
 * concurrent background count (`+N bg`) so neither is lost.
 *
 * @module lib/code-session-store/select-live-activity
 */

import type { CodeSessionSnapshot } from "./types";
import type { JobItem } from "./select-jobs";

/** Coarse activity class — drives the line's icon / tint. */
export type LiveActivityKind =
  | "idle"
  | "thinking"
  | "tool"
  | "background"
  | "waking"
  | "retrying"
  | "interrupting";

export interface LiveActivity {
  /**
   * Whether anything worth showing is happening. `false` only for the
   * `idle` kind; the consumer hides (or dims to a resting state) when
   * this is false.
   */
  active: boolean;
  kind: LiveActivityKind;
  /** Compact one-line label, e.g. `"Running Bash"`, `"2 jobs · agent: Read"`. */
  label: string;
  /** Optional trailing detail (e.g. `"+1 bg"`); the line may append it muted. */
  detail?: string;
}

const IDLE: LiveActivity = Object.freeze({
  active: false,
  kind: "idle",
  label: "Idle",
});

/** Running (non-terminal, non-scheduled) jobs, newest first. */
function runningJobs(jobs: ReadonlyArray<JobItem>): JobItem[] {
  return jobs
    .filter((j) => j.status === "running")
    .sort((a, b) => b.startedAtMs - a.startedAtMs);
}

/** The in-flight foreground tool call, if any (last still-pending one). */
function pendingForegroundTool(
  snapshot: CodeSessionSnapshot,
): string | undefined {
  const turn = snapshot.activeTurn;
  if (turn === null) return undefined;
  for (let i = turn.messages.length - 1; i >= 0; i--) {
    const m = turn.messages[i]!;
    if (m.kind === "tool_use" && m.status === "pending") {
      return m.toolName;
    }
  }
  return undefined;
}

/**
 * Phrase a running-jobs summary: `"agent: Read"` for one job carrying
 * progress, `"3 jobs · agent: Read"` for several. Falls back to the job
 * kind / description when no `task_progress` tick has landed yet.
 */
function backgroundLabel(running: JobItem[]): string {
  const newest = running[0]!;
  const tool = newest.progress?.lastToolName;
  const lead = tool ? `${newest.kind}: ${tool}` : describeJob(newest);
  if (running.length === 1) return lead;
  return `${running.length} jobs · ${lead}`;
}

/** A single job's fallback phrasing when it has no progress tick yet. */
function describeJob(job: JobItem): string {
  const desc = job.description.replace(/\s+/g, " ").trim();
  if (desc.length > 0) return `${job.kind}: ${desc}`;
  return `${job.kind} running`;
}

/**
 * Derive the current live-activity descriptor from a session snapshot.
 * See the module doc for the priority ladder.
 */
export function selectLiveActivity(
  snapshot: CodeSessionSnapshot,
): LiveActivity {
  const running = runningJobs(snapshot.jobs);
  const bgSuffix =
    running.length > 0 ? `+${running.length} bg` : undefined;

  // 1. Retry — a stall the user must read as recovery, not a hang.
  if (snapshot.apiRetry !== null) {
    const attempt = snapshot.apiRetry.attempt;
    return {
      active: true,
      kind: "retrying",
      label: attempt > 0 ? `Retrying (attempt ${attempt})` : "Retrying",
      ...(bgSuffix !== undefined ? { detail: bgSuffix } : {}),
    };
  }

  // 2. Interrupt round-trip in flight.
  if (snapshot.interruptInFlight) {
    return {
      active: true,
      kind: "interrupting",
      label: "Stopping…",
      ...(bgSuffix !== undefined ? { detail: bgSuffix } : {}),
    };
  }

  // 3. Waking — resuming from a deferred / background completion.
  if (snapshot.phase === "waking") {
    return {
      active: true,
      kind: "waking",
      label: "Resuming…",
      ...(bgSuffix !== undefined ? { detail: bgSuffix } : {}),
    };
  }

  // 4. Foreground tool call pending.
  const tool = pendingForegroundTool(snapshot);
  if (tool !== undefined) {
    return {
      active: true,
      kind: "tool",
      label: `Running ${tool}`,
      ...(bgSuffix !== undefined ? { detail: bgSuffix } : {}),
    };
  }

  // 5. Active turn, no pending tool — the model is generating.
  if (snapshot.activeTurn !== null) {
    return {
      active: true,
      kind: "thinking",
      label: "Thinking…",
      ...(bgSuffix !== undefined ? { detail: bgSuffix } : {}),
    };
  }

  // 6. Foreground idle, but background work is live — the muteness case.
  if (running.length > 0) {
    return {
      active: true,
      kind: "background",
      label: backgroundLabel(running),
    };
  }

  // 7. Nothing of interest.
  return IDLE;
}
