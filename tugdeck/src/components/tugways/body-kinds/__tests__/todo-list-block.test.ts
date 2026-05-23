/**
 * Pure-logic tests for `TodoListBlock`'s display helpers — counts /
 * progress / summary / copy-text — over the {@link TaskItem} shape
 * produced by `reduceTaskListState` ([D100]).
 *
 * The visible composition (header chrome, embedded mode, hover
 * highlight, in-progress spinner animation, per-row description
 * tooltip) is HMR-vetted per the project's testing policy. The
 * narrow / reducer surface is pinned in
 * `lib/code-session-store/__tests__/select-task-list.test.ts` — these
 * tests cover only the helpers that turn a `TaskItem[]` into a
 * display string.
 */

import { describe, expect, test } from "bun:test";

import {
  composeTaskCopyText,
  composeTaskSummary,
  countTasks,
  taskProgressFraction,
  type TaskItem,
} from "../todo-list-block";

describe("countTasks", () => {
  test("empty list → all zeros", () => {
    expect(countTasks([])).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
    });
  });

  test("tallies a mixed list correctly", () => {
    const tasks: TaskItem[] = [
      { taskId: "1", subject: "a", status: "pending" },
      { taskId: "2", subject: "b", status: "in_progress" },
      { taskId: "3", subject: "c", status: "completed" },
      { taskId: "4", subject: "d", status: "completed" },
      { taskId: "5", subject: "e", status: "pending" },
    ];
    expect(countTasks(tasks)).toEqual({
      total: 5,
      pending: 2,
      inProgress: 1,
      completed: 2,
    });
  });

  test("an unknown status counts toward total but no bucket", () => {
    // `narrowTaskCreateInput` (in select-task-list) would never
    // produce such a row, but `countTasks` is pure; if a caller
    // hand-builds the array (tests, future producers), the sum stays
    // honest — the bar never lies.
    const tasks = [
      {
        taskId: "1",
        subject: "x",
        status: "weird" as unknown as TaskItem["status"],
      },
      { taskId: "2", subject: "y", status: "completed" as const },
    ];
    const counts = countTasks(tasks);
    expect(counts.total).toBe(2);
    expect(
      counts.pending + counts.inProgress + counts.completed,
    ).toBeLessThanOrEqual(counts.total);
    expect(counts.completed).toBe(1);
  });
});

describe("composeTaskSummary", () => {
  test("empty list → empty string", () => {
    expect(
      composeTaskSummary({ total: 0, pending: 0, inProgress: 0, completed: 0 }),
    ).toBe("");
  });

  test("all three buckets join with commas in done-progress-pending order", () => {
    expect(
      composeTaskSummary({ total: 6, pending: 2, inProgress: 1, completed: 3 }),
    ).toBe("3 done, 1 in progress, 2 pending");
  });

  test("drops zero buckets", () => {
    expect(
      composeTaskSummary({ total: 3, pending: 0, inProgress: 0, completed: 3 }),
    ).toBe("3 done");
    expect(
      composeTaskSummary({ total: 2, pending: 2, inProgress: 0, completed: 0 }),
    ).toBe("2 pending");
    expect(
      composeTaskSummary({ total: 3, pending: 2, inProgress: 1, completed: 0 }),
    ).toBe("1 in progress, 2 pending");
  });
});

describe("taskProgressFraction", () => {
  test("0 on empty", () => {
    expect(
      taskProgressFraction({ total: 0, pending: 0, inProgress: 0, completed: 0 }),
    ).toBe(0);
  });

  test("completed / total — in-progress does not count as partial credit", () => {
    expect(
      taskProgressFraction({ total: 4, pending: 1, inProgress: 1, completed: 2 }),
    ).toBe(0.5);
    // Same total + completed share, different in-progress count: the
    // fraction is unchanged. In-progress is not partial credit.
    expect(
      taskProgressFraction({ total: 4, pending: 0, inProgress: 2, completed: 2 }),
    ).toBe(0.5);
  });

  test("all completed → 1", () => {
    expect(
      taskProgressFraction({ total: 3, pending: 0, inProgress: 0, completed: 3 }),
    ).toBe(1);
  });
});

describe("composeTaskCopyText", () => {
  test("plain-text glyphs by status", () => {
    expect(
      composeTaskCopyText([
        { taskId: "1", subject: "a", status: "pending" },
        { taskId: "2", subject: "b", status: "in_progress" },
        { taskId: "3", subject: "c", status: "completed" },
      ]),
    ).toBe("[ ] a\n[~] b\n[x] c");
  });

  test("in_progress prefers activeForm when present", () => {
    expect(
      composeTaskCopyText([
        {
          taskId: "1",
          subject: "Run tests",
          activeForm: "Running tests",
          status: "in_progress",
        },
      ]),
    ).toBe("[~] Running tests");
  });

  test("in_progress falls back to subject when activeForm is absent", () => {
    expect(
      composeTaskCopyText([
        { taskId: "1", subject: "Run tests", status: "in_progress" },
      ]),
    ).toBe("[~] Run tests");
  });

  test("empty list → empty string", () => {
    expect(composeTaskCopyText([])).toBe("");
  });
});
