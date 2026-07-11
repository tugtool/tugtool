/**
 * WORK — the unified Z2 view-model over the session's trackable work.
 *
 * One cell replaces TASKS + JOBS ([P02]/[P03] of
 * `roadmap/slash-command-plan.md`): the surface unifies, the storage does
 * not. The task list stays a derived turn-scoped fold
 * (`select-task-list.ts`), the jobs ledger stays session-lifetime state
 * (`select-jobs.ts`), the goal stays its own snapshot field
 * (`select-goal.ts`); everything here is pure projection over those
 * sources — no new persistence.
 *
 * Vocabulary guard: this is the FOURTH work-shaped noun in the deck —
 * `Task*` tool calls (checklist), `task_*` wire frames (jobs), scheduled
 * work, and now goals. `WorkItem` is the deliberately distinct umbrella
 * term; nothing on the wire spells "work".
 */

import type { GoalState } from "./select-goal";
import { goalIsActive } from "./select-goal";
import type { JobCounts, JobItem } from "./select-jobs";
import { isTerminalJobStatus, jobsCellPose } from "./select-jobs";
import type { TaskItem } from "./select-task-list";

/**
 * How long a completed item keeps contributing to the WORK cell's
 * count after it finishes. The count holds the recently-finished work
 * for this window rather than snapping to "None" the instant the last
 * item completes, then quietly settles. Five minutes.
 */
export const WORK_LINGER_MS = 300_000;

/** Every kind of trackable work the WORK surface knows. */
export type WorkKind =
  | "task"
  | "bash"
  | "agent"
  | "monitor"
  | "unknown"
  | "wakeup"
  | "cron"
  | "remote"
  | "goal";

/** Popover grouping. */
export type WorkGroup = "active" | "scheduled" | "checklist" | "finished";

/** The action a row can offer (wired to store methods by the popover). */
export type WorkAction = "stop" | "cancel" | "stop-loop" | "clear-goal";

/**
 * One row of the unified surface — a pure projection of a task, a job,
 * or the goal (Spec S02 of the plan).
 */
export interface WorkItem {
  /** Stable per-source id: taskId / jobId / `"goal"`. */
  readonly key: string;
  readonly kind: WorkKind;
  readonly group: WorkGroup;
  readonly label: string;
  /** Source-native status, untranslated. */
  readonly status: string;
  /** Evaluator reason / activeForm / schedule label — kind-specific. */
  readonly detail: string | null;
  readonly actions: readonly WorkAction[];
}

function jobGroup(job: JobItem): WorkGroup {
  if (job.status === "running") return "active";
  if (job.status === "scheduled") return "scheduled";
  return "finished";
}

function jobActions(job: JobItem): readonly WorkAction[] {
  if (job.status === "running") return ["stop"];
  if (job.status === "scheduled") {
    if (job.kind === "cron") return ["cancel"];
    // A remote (claude.ai) routine has no local cancel — RemoteTrigger
    // exposes no delete action — so it offers no row action.
    if (job.kind === "remote") return [];
    return ["stop-loop"];
  }
  return [];
}

/**
 * Project the three sources into the unified row list, grouped
 * active → scheduled → checklist → finished (the popover's section
 * order). Within a group, source order is preserved.
 */
export function selectWorkItems(
  tasks: readonly TaskItem[],
  jobs: readonly JobItem[],
  goal: GoalState | null,
): readonly WorkItem[] {
  const items: WorkItem[] = [];
  if (goal !== null && goal.status === "active") {
    items.push({
      key: "goal",
      kind: "goal",
      group: "active",
      label: goal.condition,
      status: "active",
      detail: goal.latestReason,
      actions: ["clear-goal"],
    });
  }
  for (const group of ["active", "scheduled", "finished"] as const) {
    for (const job of jobs) {
      if (jobGroup(job) !== group) continue;
      items.push({
        key: job.jobId,
        kind: job.kind,
        group,
        label: job.description,
        status: job.status,
        detail: job.scheduleLabel ?? null,
        actions: jobActions(job),
      });
    }
    if (group === "scheduled") {
      // Checklist sits between scheduled and finished: pending work
      // reads before history.
      for (const task of tasks) {
        items.push({
          key: task.taskId,
          kind: "task",
          group: "checklist",
          label: task.subject,
          status: task.status,
          detail: task.description ?? null,
          actions: [],
        });
      }
    }
  }
  if (goal !== null && goal.status !== "active") {
    items.push({
      key: "goal",
      kind: "goal",
      group: "finished",
      label: goal.condition,
      status: goal.status,
      detail: goal.latestReason,
      actions: [],
    });
  }
  return items;
}

/** Inputs the merged cell pose needs from the checklist side. */
export interface WorkChecklistPose {
  readonly hasTasks: boolean;
  readonly allTasksComplete: boolean;
  /** Session idle — demotes an in-progress CHECKLIST (only) to quiet. */
  readonly isIdle: boolean;
}

/**
 * The WORK cell's indicator pose — the merged grammar (Spec S03):
 *
 *  1. any running job, pending scheduled row, or ACTIVE GOAL → `running`
 *     (jobs/goals never idle-demote — [D102]'s divergence, preserved
 *     for the merged cell's live half);
 *  2. else any failed job → `aborted` (holds until cleared, [D102] —
 *     NOT linger-gated: a failure nags red until the user clears it);
 *  3. else checklist semantics WITH [D100]'s idle demotion: in-flight
 *     and session active → `running`; otherwise → `stopped`.
 *
 * The "done" (green `completed`) outcome is gated on `recentlyCompleted`
 * so the dot agrees with the lingered label: a just-finished batch reads
 * `completed`, but once the linger window elapses the settled work reads
 * quiet (`stopped`) rather than a green dot beside "None".
 */
export function workCellPose(
  jobs: readonly JobItem[],
  goal: GoalState | null,
  checklist: WorkChecklistPose,
  recentlyCompleted: boolean,
): "stopped" | "running" | "completed" | "aborted" {
  if (goalIsActive(goal)) return "running";
  const jobsPose = jobsCellPose(jobs);
  if (jobsPose === "running" || jobsPose === "aborted") return jobsPose;
  if (checklist.hasTasks) {
    if (checklist.allTasksComplete) {
      return recentlyCompleted ? "completed" : "stopped";
    }
    return checklist.isIdle ? "stopped" : "running";
  }
  // No checklist: an all-terminal ledger reads `completed` only while a
  // finish is recent; otherwise it (and an empty surface) read quiet.
  if (jobsPose === "completed" && !recentlyCompleted) return "stopped";
  return jobsPose;
}

/**
 * The count of work items still active across every category:
 * incomplete tasks (pending + in_progress), running jobs, scheduled
 * rows (wakeup / cron / remote), and one active goal. Terminal jobs and
 * completed tasks are history — they do not count as active. This is
 * the single honest number the cell reports across all categories at
 * once, replacing the former single-category cascade.
 */
export function workActiveCount(
  taskCounts: { completed: number; total: number },
  jobCounts: JobCounts,
  goal: GoalState | null,
): number {
  const incompleteTasks = taskCounts.total - taskCounts.completed;
  const goalActive = goalIsActive(goal) ? 1 : 0;
  return incompleteTasks + jobCounts.running + jobCounts.scheduled + goalActive;
}

/** Format a work count for the cell — the number, or "None" at zero. */
export function formatWorkCount(count: number): string {
  return count === 0 ? "None" : String(count);
}

/**
 * The cell's label from the pure active count (no linger). The renderer
 * shows the *lingered* {@link workDisplayCount} via {@link formatWorkCount};
 * this helper is the active-only reading the unit tests pin.
 */
export function workCellLabel(
  taskCounts: { completed: number; total: number },
  jobCounts: JobCounts,
  goal: GoalState | null,
): string {
  return formatWorkCount(workActiveCount(taskCounts, jobCounts, goal));
}

/**
 * How many items finished within `lingerMs` of `nowMs` — completed
 * tasks (by `completedAtMs`) plus terminal jobs (by `endedAtMs`). Items
 * with no completion timestamp (a resumed fold, an in-flight row) never
 * count as recent. Drives the WORK cell's linger: while nothing is
 * active, this is what the cell displays instead of snapping to "None".
 */
export function countRecentlyDone(
  tasks: readonly TaskItem[],
  jobs: readonly JobItem[],
  nowMs: number,
  lingerMs: number,
): number {
  let n = 0;
  for (const t of tasks) {
    if (
      t.status === "completed" &&
      t.completedAtMs !== undefined &&
      nowMs - t.completedAtMs < lingerMs
    ) {
      n += 1;
    }
  }
  for (const j of jobs) {
    if (
      isTerminalJobStatus(j.status) &&
      j.endedAtMs !== null &&
      nowMs - j.endedAtMs < lingerMs
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * The number the cell shows: the live active count while any work is
 * active, else the recently-finished count (the linger). Active work
 * never inflates by history — the linger only softens the drop to zero.
 */
export function workDisplayCount(
  activeCount: number,
  recentlyDone: number,
): number {
  return activeCount > 0 ? activeCount : recentlyDone;
}

/**
 * The earliest future moment a lingering item ages out of the window
 * (`completion + lingerMs`), or `null` when nothing is currently
 * lingering. The renderer schedules one bounded timeout at this instant
 * to recompute the count once — no per-second ticker (the WORK area is
 * deliberately tick-free). Only completions still inside the window are
 * considered, so the returned time is always `> nowMs`.
 */
export function nextLingerExpiryMs(
  tasks: readonly TaskItem[],
  jobs: readonly JobItem[],
  nowMs: number,
  lingerMs: number,
): number | null {
  let earliest: number | null = null;
  const consider = (completionMs: number): void => {
    const expiry = completionMs + lingerMs;
    if (expiry > nowMs && (earliest === null || expiry < earliest)) {
      earliest = expiry;
    }
  };
  for (const t of tasks) {
    if (t.status === "completed" && t.completedAtMs !== undefined) {
      consider(t.completedAtMs);
    }
  }
  for (const j of jobs) {
    if (isTerminalJobStatus(j.status) && j.endedAtMs !== null) {
      consider(j.endedAtMs);
    }
  }
  return earliest;
}

/**
 * Accessible summary of everything the cell folds together —
 * zero-bucket drop, reading order matches the popover's sections.
 */
export function composeWorkSummary(
  taskCounts: { completed: number; total: number },
  jobCounts: JobCounts,
  goal: GoalState | null,
): string {
  const parts: string[] = [];
  if (goalIsActive(goal)) parts.push("goal active");
  const executing = jobCounts.running;
  if (executing > 0) parts.push(`${executing} running`);
  if (jobCounts.scheduled > 0) parts.push(`${jobCounts.scheduled} scheduled`);
  if (taskCounts.total > 0) {
    parts.push(`${taskCounts.completed}/${taskCounts.total} tasks`);
  }
  if (jobCounts.finished > 0) parts.push(`${jobCounts.finished} finished`);
  return parts.length === 0 ? "No work" : parts.join(", ");
}
