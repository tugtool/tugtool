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
import { jobsCellPose } from "./select-jobs";
import type { TaskItem } from "./select-task-list";

/** Every kind of trackable work the WORK surface knows. */
export type WorkKind =
  | "task"
  | "bash"
  | "agent"
  | "monitor"
  | "unknown"
  | "wakeup"
  | "cron"
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
    return job.kind === "cron" ? ["cancel"] : ["stop-loop"];
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
 *  2. else any failed job → `aborted` (holds until cleared, [D102]);
 *  3. else checklist semantics WITH [D100]'s idle demotion: all done →
 *     `completed`; in-flight and session active → `running`; otherwise →
 *     `stopped`.
 */
export function workCellPose(
  jobs: readonly JobItem[],
  goal: GoalState | null,
  checklist: WorkChecklistPose,
): "stopped" | "running" | "completed" | "aborted" {
  if (goalIsActive(goal)) return "running";
  const jobsPose = jobsCellPose(jobs);
  if (jobsPose === "running" || jobsPose === "aborted") return jobsPose;
  if (checklist.hasTasks) {
    if (checklist.allTasksComplete) return "completed";
    return checklist.isIdle ? "stopped" : "running";
  }
  // No checklist: an all-terminal ledger keeps the jobs pose
  // (`completed`), an empty surface reads quiet.
  return jobsPose;
}

/**
 * The cell's label — one compact reading, live work first:
 * an active goal dominates ("goal"), then the jobs fraction, then a
 * bare scheduled count, then the checklist fraction, then "None". The
 * popover carries the full picture; the cell is a headline.
 */
export function workCellLabel(
  taskCounts: { completed: number; total: number },
  jobCounts: JobCounts,
  goal: GoalState | null,
): string {
  if (goalIsActive(goal)) return "goal";
  if (jobCounts.total > 0) return `${jobCounts.finished}/${jobCounts.total}`;
  if (jobCounts.scheduled > 0) return `${jobCounts.scheduled}`;
  if (taskCounts.total > 0) return `${taskCounts.completed}/${taskCounts.total}`;
  return "None";
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
