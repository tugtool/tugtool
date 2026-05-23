/**
 * Pure-logic tests for `TodoListBlock`'s wire-narrowing and
 * count / progress / copy-text helpers.
 *
 * The visible composition (header chrome, embedded mode, hover
 * highlight, in-progress spinner animation) is HMR-vetted per the
 * project's testing policy — these tests pin the exported helpers
 * `TodoWriteToolBlock` and `TodoListBlock` consume:
 *
 *  - `narrowTodoListData` — defensive narrowing of the `unknown`
 *    wire props (drops malformed entries, unknown statuses).
 *  - `countTodos` — per-status tallies, sum constraint
 *    (`pending + inProgress + completed <= total`).
 *  - `composeTodoSummary` — header summary string, zero-bucket
 *    drop, plural-agnostic formatting.
 *  - `todoProgressFraction` — `completed / total`, 0 on empty.
 *  - `composeTodoCopyText` — plain-text Copy payload, status
 *    glyphs, in_progress activeForm preference.
 */

import { describe, expect, test } from "bun:test";

import {
  composeTodoCopyText,
  composeTodoSummary,
  countTodos,
  narrowTodoListData,
  todoProgressFraction,
  type TodoItem,
} from "../todo-list-block";

describe("countTodos", () => {
  test("empty list → all zeros", () => {
    expect(countTodos([])).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
    });
  });

  test("tallies a mixed list correctly", () => {
    const todos: TodoItem[] = [
      { content: "a", status: "pending" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "completed" },
      { content: "d", status: "completed" },
      { content: "e", status: "pending" },
    ];
    expect(countTodos(todos)).toEqual({
      total: 5,
      pending: 2,
      inProgress: 1,
      completed: 2,
    });
  });

  test("an unknown status counts toward total but no bucket", () => {
    // narrowTodoListData would drop this entry, but countTodos is a
    // pure function; if a caller hand-builds the array (e.g. tests,
    // future producers), the sum stays honest — the bar doesn't lie.
    const todos = [
      { content: "x", status: "weird" as unknown as TodoItem["status"] },
      { content: "y", status: "completed" as const },
    ];
    const counts = countTodos(todos);
    expect(counts.total).toBe(2);
    expect(counts.pending + counts.inProgress + counts.completed).toBeLessThanOrEqual(
      counts.total,
    );
    expect(counts.completed).toBe(1);
  });
});

describe("composeTodoSummary", () => {
  test("empty list → empty string", () => {
    expect(composeTodoSummary({ total: 0, pending: 0, inProgress: 0, completed: 0 })).toBe(
      "",
    );
  });

  test("all three buckets join with commas in done-progress-pending order", () => {
    expect(
      composeTodoSummary({ total: 6, pending: 2, inProgress: 1, completed: 3 }),
    ).toBe("3 done, 1 in progress, 2 pending");
  });

  test("drops zero buckets", () => {
    expect(
      composeTodoSummary({ total: 3, pending: 0, inProgress: 0, completed: 3 }),
    ).toBe("3 done");
    expect(
      composeTodoSummary({ total: 2, pending: 2, inProgress: 0, completed: 0 }),
    ).toBe("2 pending");
    expect(
      composeTodoSummary({ total: 3, pending: 2, inProgress: 1, completed: 0 }),
    ).toBe("1 in progress, 2 pending");
  });
});

describe("todoProgressFraction", () => {
  test("0 on empty", () => {
    expect(
      todoProgressFraction({ total: 0, pending: 0, inProgress: 0, completed: 0 }),
    ).toBe(0);
  });

  test("completed / total — in-progress does not count as partial credit", () => {
    expect(
      todoProgressFraction({ total: 4, pending: 1, inProgress: 1, completed: 2 }),
    ).toBe(0.5);
    // Same total + completed share, different in-progress count: the
    // fraction is unchanged. In-progress is not partial credit.
    expect(
      todoProgressFraction({ total: 4, pending: 0, inProgress: 2, completed: 2 }),
    ).toBe(0.5);
  });

  test("all completed → 1", () => {
    expect(
      todoProgressFraction({ total: 3, pending: 0, inProgress: 0, completed: 3 }),
    ).toBe(1);
  });
});

describe("narrowTodoListData", () => {
  test("accepts a well-formed wire payload", () => {
    const out = narrowTodoListData({
      todos: [
        { content: "a", status: "pending" },
        { content: "b", status: "in_progress", activeForm: "Doing b" },
        { content: "c", status: "completed" },
      ],
    });
    expect(out).toEqual({
      todos: [
        { content: "a", status: "pending", activeForm: undefined },
        { content: "b", status: "in_progress", activeForm: "Doing b" },
        { content: "c", status: "completed", activeForm: undefined },
      ],
    });
  });

  test("returns undefined for non-object input", () => {
    expect(narrowTodoListData(null)).toBeUndefined();
    expect(narrowTodoListData(undefined)).toBeUndefined();
    expect(narrowTodoListData("")).toBeUndefined();
    expect(narrowTodoListData(42)).toBeUndefined();
  });

  test("returns undefined when todos is missing or not an array", () => {
    expect(narrowTodoListData({})).toBeUndefined();
    expect(narrowTodoListData({ todos: null })).toBeUndefined();
    expect(narrowTodoListData({ todos: "not an array" })).toBeUndefined();
  });

  test("drops malformed entries silently", () => {
    const out = narrowTodoListData({
      todos: [
        { content: "ok", status: "pending" },
        null,
        { content: "no status" },
        { status: "completed" }, // missing content
        { content: "bad-status", status: "unknown" },
        { content: "ok2", status: "in_progress" },
      ],
    });
    expect(out?.todos).toEqual([
      { content: "ok", status: "pending", activeForm: undefined },
      { content: "ok2", status: "in_progress", activeForm: undefined },
    ]);
  });

  test("empty todos array round-trips", () => {
    expect(narrowTodoListData({ todos: [] })).toEqual({ todos: [] });
  });
});

describe("composeTodoCopyText", () => {
  test("plain-text glyphs by status", () => {
    expect(
      composeTodoCopyText([
        { content: "a", status: "pending" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "completed" },
      ]),
    ).toBe("[ ] a\n[~] b\n[x] c");
  });

  test("in_progress prefers activeForm when present", () => {
    expect(
      composeTodoCopyText([
        { content: "Run tests", status: "in_progress", activeForm: "Running tests" },
      ]),
    ).toBe("[~] Running tests");
  });

  test("in_progress falls back to content when activeForm is absent", () => {
    expect(
      composeTodoCopyText([{ content: "Run tests", status: "in_progress" }]),
    ).toBe("[~] Run tests");
  });

  test("empty list → empty string", () => {
    expect(composeTodoCopyText([])).toBe("");
  });
});
