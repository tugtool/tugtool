/**
 * select-work.test.ts — pure-logic coverage for the unified WORK
 * projection, merged pose truth-table, and cell label.
 *
 * The merge preserves each source's semantics ([P02]): the checklist
 * contribution keeps [D100]'s idle demotion; jobs and goals never
 * idle-demote ([D102]'s divergence); a failed job holds the `aborted`
 * pose only when nothing is live.
 */

import { describe, expect, test } from "bun:test";

import type { GoalState } from "@/lib/code-session-store/select-goal";
import { countJobs, type JobItem } from "@/lib/code-session-store/select-jobs";
import type { TaskItem } from "@/lib/code-session-store/select-task-list";
import {
  composeWorkSummary,
  selectWorkItems,
  workCellLabel,
  workCellPose,
} from "@/lib/code-session-store/select-work";

function job(overrides: Partial<JobItem> & { jobId: string }): JobItem {
  return {
    source: "claude",
    kind: "bash",
    toolUseId: overrides.jobId,
    description: `job ${overrides.jobId}`,
    status: "running",
    startedAtMs: 1000,
    endedAtMs: null,
    ...overrides,
  } as JobItem;
}

function task(id: string, status: TaskItem["status"]): TaskItem {
  return { taskId: id, subject: `task ${id}`, status };
}

function goal(status: GoalState["status"] = "active"): GoalState {
  return {
    condition: "tests pass",
    status,
    turnsEvaluated: 2,
    latestReason: "one failing",
    setAtMs: 1000,
    cycleTurnKey: "t1",
  };
}

describe("selectWorkItems", () => {
  test("groups: active goal + running jobs, scheduled, checklist, finished, ended goal", () => {
    const items = selectWorkItems(
      [task("t1", "pending")],
      [
        job({ jobId: "r1" }),
        job({ jobId: "s1", kind: "wakeup", status: "scheduled" }),
        job({ jobId: "f1", status: "completed", endedAtMs: 2000 }),
      ],
      goal(),
    );
    expect(items.map((i) => [i.kind, i.group])).toEqual([
      ["goal", "active"],
      ["bash", "active"],
      ["wakeup", "scheduled"],
      ["task", "checklist"],
      ["bash", "finished"],
    ]);
  });

  test("actions per kind: stop / stop-loop / cancel / clear-goal", () => {
    const items = selectWorkItems(
      [],
      [
        job({ jobId: "r1" }),
        job({ jobId: "w1", kind: "wakeup", status: "scheduled" }),
        job({ jobId: "c1", kind: "cron", status: "scheduled" }),
      ],
      goal(),
    );
    const byKey = new Map(items.map((i) => [i.key, i.actions]));
    expect(byKey.get("goal")).toEqual(["clear-goal"]);
    expect(byKey.get("r1")).toEqual(["stop"]);
    expect(byKey.get("w1")).toEqual(["stop-loop"]);
    expect(byKey.get("c1")).toEqual(["cancel"]);
  });

  test("an achieved goal projects into finished with no actions", () => {
    const items = selectWorkItems([], [], goal("achieved"));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "goal", group: "finished", actions: [] });
  });

  test("empty everything projects nothing", () => {
    expect(selectWorkItems([], [], null)).toEqual([]);
  });
});

describe("workCellPose — merged truth table", () => {
  const noTasks = { hasTasks: false, allTasksComplete: false, isIdle: true };

  test("an active goal is running regardless of idle", () => {
    expect(workCellPose([], goal(), noTasks)).toBe("running");
  });

  test("a running job beats idle demotion", () => {
    expect(workCellPose([job({ jobId: "r1" })], null, noTasks)).toBe("running");
  });

  test("a pending scheduled row pulses", () => {
    expect(
      workCellPose([job({ jobId: "w1", kind: "wakeup", status: "scheduled" })], null, noTasks),
    ).toBe("running");
  });

  test("a failed job holds aborted when nothing is live", () => {
    expect(
      workCellPose([job({ jobId: "f1", status: "failed", endedAtMs: 2 })], null, noTasks),
    ).toBe("aborted");
  });

  test("checklist keeps [D100] idle demotion", () => {
    const tasks = { hasTasks: true, allTasksComplete: false, isIdle: true };
    expect(workCellPose([], null, tasks)).toBe("stopped");
    expect(workCellPose([], null, { ...tasks, isIdle: false })).toBe("running");
    expect(
      workCellPose([], null, { hasTasks: true, allTasksComplete: true, isIdle: true }),
    ).toBe("completed");
  });

  test("empty surface reads quiet", () => {
    expect(workCellPose([], null, noTasks)).toBe("stopped");
  });
});

describe("workCellLabel + composeWorkSummary", () => {
  test("label precedence: goal, jobs fraction, scheduled count, tasks, None", () => {
    const tc = { completed: 1, total: 3 };
    const empty = countJobs([]);
    const withJobs = countJobs([
      job({ jobId: "r1" }),
      job({ jobId: "f1", status: "completed", endedAtMs: 2 }),
    ]);
    const scheduledOnly = countJobs([
      job({ jobId: "w1", kind: "wakeup", status: "scheduled" }),
    ]);
    expect(workCellLabel(tc, withJobs, goal())).toBe("goal");
    expect(workCellLabel(tc, withJobs, null)).toBe("1/2");
    expect(workCellLabel(tc, scheduledOnly, null)).toBe("1");
    expect(workCellLabel(tc, empty, null)).toBe("1/3");
    expect(workCellLabel({ completed: 0, total: 0 }, empty, null)).toBe("None");
  });

  test("summary reads sections in popover order with zero-bucket drop", () => {
    const counts = countJobs([
      job({ jobId: "r1" }),
      job({ jobId: "w1", kind: "wakeup", status: "scheduled" }),
      job({ jobId: "f1", status: "completed", endedAtMs: 2 }),
    ]);
    expect(composeWorkSummary({ completed: 1, total: 3 }, counts, goal())).toBe(
      "goal active, 1 running, 1 scheduled, 1/3 tasks, 1 finished",
    );
    expect(composeWorkSummary({ completed: 0, total: 0 }, countJobs([]), null)).toBe(
      "No work",
    );
  });
});
