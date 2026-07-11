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
  countRecentlyDone,
  nextLingerExpiryMs,
  selectWorkItems,
  workActiveCount,
  workCellLabel,
  workCellPose,
  workDisplayCount,
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

  test("a remote scheduled row is grouped scheduled with no actions", () => {
    const items = selectWorkItems(
      [],
      [job({ jobId: "rtn", kind: "remote", status: "scheduled", firesAtMs: null })],
      null,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "remote", group: "scheduled", actions: [] });
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
    expect(workCellPose([], goal(), noTasks, false)).toBe("running");
  });

  test("a running job beats idle demotion", () => {
    expect(workCellPose([job({ jobId: "r1" })], null, noTasks, false)).toBe("running");
  });

  test("a pending scheduled row pulses", () => {
    expect(
      workCellPose([job({ jobId: "w1", kind: "wakeup", status: "scheduled" })], null, noTasks, false),
    ).toBe("running");
  });

  test("a failed job holds aborted, not linger-gated", () => {
    expect(
      workCellPose([job({ jobId: "f1", status: "failed", endedAtMs: 2 })], null, noTasks, false),
    ).toBe("aborted");
  });

  test("checklist keeps [D100] idle demotion", () => {
    const tasks = { hasTasks: true, allTasksComplete: false, isIdle: true };
    expect(workCellPose([], null, tasks, false)).toBe("stopped");
    expect(workCellPose([], null, { ...tasks, isIdle: false }, false)).toBe("running");
  });

  test("all-complete checklist: completed while recent, quiet once settled", () => {
    const done = { hasTasks: true, allTasksComplete: true, isIdle: true };
    expect(workCellPose([], null, done, true)).toBe("completed");
    expect(workCellPose([], null, done, false)).toBe("stopped");
  });

  test("all-terminal ledger: completed while recent, quiet once settled", () => {
    const finished = [job({ jobId: "f1", status: "completed", endedAtMs: 2 })];
    expect(workCellPose(finished, null, noTasks, true)).toBe("completed");
    expect(workCellPose(finished, null, noTasks, false)).toBe("stopped");
  });

  test("empty surface reads quiet", () => {
    expect(workCellPose([], null, noTasks, false)).toBe("stopped");
  });
});

describe("linger — countRecentlyDone / workDisplayCount / nextLingerExpiryMs", () => {
  const NOW = 1_000_000;
  const L = 300_000;
  const doneTask = (id: string, completedAtMs: number | undefined): TaskItem => ({
    taskId: id,
    subject: `task ${id}`,
    status: "completed",
    ...(completedAtMs !== undefined ? { completedAtMs } : {}),
  });

  test("counts tasks + jobs finished within the window, drops aged-out", () => {
    const tasks = [
      doneTask("recent", NOW - 60_000), // 1 min ago → counts
      doneTask("old", NOW - L - 1), // just past window → excluded
      doneTask("nostamp", undefined), // no timestamp → excluded
    ];
    const jobs = [
      job({ jobId: "jr", status: "completed", endedAtMs: NOW - 10_000 }), // counts
      job({ jobId: "jo", status: "completed", endedAtMs: NOW - L - 5 }), // excluded
    ];
    expect(countRecentlyDone(tasks, jobs, NOW, L)).toBe(2);
  });

  test("workDisplayCount: active count wins, else recently-done", () => {
    expect(workDisplayCount(3, 5)).toBe(3);
    expect(workDisplayCount(0, 5)).toBe(5);
    expect(workDisplayCount(0, 0)).toBe(0);
  });

  test("nextLingerExpiryMs: earliest future expiry, else null", () => {
    const tasks = [doneTask("a", NOW - 60_000), doneTask("b", NOW - 120_000)];
    // earliest completion (b, older) ages out first.
    expect(nextLingerExpiryMs(tasks, [], NOW, L)).toBe(NOW - 120_000 + L);
    // nothing lingering → null.
    expect(nextLingerExpiryMs([doneTask("c", NOW - L - 1)], [], NOW, L)).toBe(null);
    expect(nextLingerExpiryMs([], [], NOW, L)).toBe(null);
  });
});

describe("workActiveCount", () => {
  const empty = countJobs([]);

  test("tasks-only: incomplete tasks count, completed do not", () => {
    expect(workActiveCount({ completed: 1, total: 3 }, empty, null)).toBe(2);
    expect(workActiveCount({ completed: 3, total: 3 }, empty, null)).toBe(0);
  });

  test("jobs-only: running + scheduled, terminal excluded", () => {
    const counts = countJobs([
      job({ jobId: "r1" }),
      job({ jobId: "w1", kind: "wakeup", status: "scheduled" }),
      job({ jobId: "f1", status: "completed", endedAtMs: 2 }),
    ]);
    expect(workActiveCount({ completed: 0, total: 0 }, counts, null)).toBe(2);
  });

  test("goal-only adds one", () => {
    expect(workActiveCount({ completed: 0, total: 0 }, empty, goal())).toBe(1);
    expect(
      workActiveCount({ completed: 0, total: 0 }, empty, goal("achieved")),
    ).toBe(0);
  });

  test("all-together sums every category, not just the top one", () => {
    const counts = countJobs([
      job({ jobId: "r1" }),
      job({ jobId: "w1", kind: "wakeup", status: "scheduled" }),
      job({ jobId: "f1", status: "completed", endedAtMs: 2 }),
    ]);
    // 1 incomplete task + 1 running + 1 scheduled + 1 active goal = 4.
    expect(workActiveCount({ completed: 2, total: 3 }, counts, goal())).toBe(4);
  });
});

describe("workCellLabel + composeWorkSummary", () => {
  test("label is the aggregate active count, or None when zero", () => {
    const empty = countJobs([]);
    const withJobs = countJobs([
      job({ jobId: "r1" }),
      job({ jobId: "f1", status: "completed", endedAtMs: 2 }),
    ]);
    const scheduledOnly = countJobs([
      job({ jobId: "w1", kind: "wakeup", status: "scheduled" }),
    ]);
    // active goal (1) + 1 running + 2 incomplete tasks = 4.
    expect(workCellLabel({ completed: 1, total: 3 }, withJobs, goal())).toBe("4");
    // 1 running + 2 incomplete tasks = 3.
    expect(workCellLabel({ completed: 1, total: 3 }, withJobs, null)).toBe("3");
    // 1 scheduled + 2 incomplete tasks = 3.
    expect(workCellLabel({ completed: 1, total: 3 }, scheduledOnly, null)).toBe("3");
    // 2 incomplete tasks only.
    expect(workCellLabel({ completed: 1, total: 3 }, empty, null)).toBe("2");
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
