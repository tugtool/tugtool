/**
 * Pure-logic tests for `select-task-list` — wire narrowing,
 * `tool_result.content` parse, and the {@link reduceTaskListState}
 * reducer that backs the [D100] pinned `Z2A` renderer.
 *
 * Fixture inputs follow the wire shape observed in the Step 24.1
 * spike capture
 * (`tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.150-spike/test-task-tools-c-calculator-raw.jsonl`)
 * — `TaskCreate` with `{ subject, description?, activeForm? }` plus a
 * `"Task #N created successfully: …"` string `tool_result.content`,
 * `TaskUpdate` with `{ taskId, status }`.
 */

import { describe, expect, test } from "bun:test";

import {
  narrowTaskCreateInput,
  narrowTaskUpdateInput,
  parseTaskCreateResultId,
  reduceTaskListState,
  taskListIsActive,
  type TaskListState,
} from "../select-task-list";
import type { ToolUseMessage } from "../types";

// ---------------------------------------------------------------------------
// Fixture helpers — produce ToolUseMessage shapes the reducer accepts
// ---------------------------------------------------------------------------

function createCall(
  toolUseId: string,
  input: Record<string, unknown>,
  resultId?: number,
  overrides?: Partial<ToolUseMessage>,
): ToolUseMessage {
  return {
    kind: "tool_use",
    messageKey: `fixture-${toolUseId}`,
    createdAt: 0,
    toolUseId,
    toolName: "TaskCreate",
    input,
    status: "done",
    result:
      resultId === undefined
        ? null
        : `Task #${resultId} created successfully: ${String(input.subject ?? "")}`,
    structuredResult: null,
    toolWallMs: null,
    ...overrides,
  };
}

function updateCall(
  toolUseId: string,
  input: Record<string, unknown>,
  overrides?: Partial<ToolUseMessage>,
): ToolUseMessage {
  return {
    kind: "tool_use",
    messageKey: `fixture-${toolUseId}`,
    createdAt: 0,
    toolUseId,
    toolName: "TaskUpdate",
    input,
    status: "done",
    result: `Updated task #${String(input.taskId ?? "")} status`,
    structuredResult: null,
    toolWallMs: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// narrowTaskCreateInput
// ---------------------------------------------------------------------------

describe("narrowTaskCreateInput", () => {
  test("accepts a well-formed payload", () => {
    expect(
      narrowTaskCreateInput({
        subject: "Write calc.c source",
        description: "Implement command-line calculator in C",
        activeForm: "Writing calc.c source",
      }),
    ).toEqual({
      subject: "Write calc.c source",
      description: "Implement command-line calculator in C",
      activeForm: "Writing calc.c source",
    });
  });

  test("description and activeForm are optional", () => {
    expect(narrowTaskCreateInput({ subject: "Just a subject" })).toEqual({
      subject: "Just a subject",
      description: undefined,
      activeForm: undefined,
    });
  });

  test("returns undefined when subject is missing or wrong type", () => {
    expect(narrowTaskCreateInput({})).toBeUndefined();
    expect(narrowTaskCreateInput({ subject: 42 })).toBeUndefined();
    expect(narrowTaskCreateInput({ subject: null })).toBeUndefined();
  });

  test("returns undefined for non-object inputs", () => {
    expect(narrowTaskCreateInput(null)).toBeUndefined();
    expect(narrowTaskCreateInput(undefined)).toBeUndefined();
    expect(narrowTaskCreateInput("string")).toBeUndefined();
    expect(narrowTaskCreateInput(42)).toBeUndefined();
  });

  test("drops non-string description / activeForm silently", () => {
    expect(
      narrowTaskCreateInput({
        subject: "S",
        description: 99,
        activeForm: true,
      }),
    ).toEqual({ subject: "S", description: undefined, activeForm: undefined });
  });
});

// ---------------------------------------------------------------------------
// narrowTaskUpdateInput
// ---------------------------------------------------------------------------

describe("narrowTaskUpdateInput", () => {
  test("accepts all known status values", () => {
    expect(narrowTaskUpdateInput({ taskId: "1", status: "pending" })).toEqual({
      taskId: "1",
      status: "pending",
    });
    expect(narrowTaskUpdateInput({ taskId: "2", status: "in_progress" })).toEqual({
      taskId: "2",
      status: "in_progress",
    });
    expect(narrowTaskUpdateInput({ taskId: "3", status: "completed" })).toEqual({
      taskId: "3",
      status: "completed",
    });
  });

  test("returns undefined when taskId or status is missing / wrong shape", () => {
    expect(narrowTaskUpdateInput({ status: "completed" })).toBeUndefined();
    expect(narrowTaskUpdateInput({ taskId: "1" })).toBeUndefined();
    expect(narrowTaskUpdateInput({ taskId: 1, status: "completed" })).toBeUndefined();
    expect(narrowTaskUpdateInput({ taskId: "1", status: "unknown" })).toBeUndefined();
  });

  test("returns undefined for non-object inputs", () => {
    expect(narrowTaskUpdateInput(null)).toBeUndefined();
    expect(narrowTaskUpdateInput("string")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseTaskCreateResultId
// ---------------------------------------------------------------------------

describe("parseTaskCreateResultId", () => {
  test("extracts a multi-digit id from the standard echo", () => {
    expect(parseTaskCreateResultId("Task #1 created successfully: Foo")).toBe("1");
    expect(
      parseTaskCreateResultId("Task #42 created successfully: Long subject string"),
    ).toBe("42");
  });

  test("returns undefined when the result is missing or off-pattern", () => {
    expect(parseTaskCreateResultId(null)).toBeUndefined();
    expect(parseTaskCreateResultId(undefined)).toBeUndefined();
    expect(parseTaskCreateResultId("")).toBeUndefined();
    expect(parseTaskCreateResultId("created Task #5")).toBeUndefined();
    expect(parseTaskCreateResultId({ text: "Task #1 …" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reduceTaskListState — the main reducer
// ---------------------------------------------------------------------------

describe("reduceTaskListState", () => {
  test("empty iterable → empty state", () => {
    const out = reduceTaskListState([]);
    expect(out.tasks).toEqual([]);
  });

  test("non-Task* calls are ignored", () => {
    const out = reduceTaskListState([
      {
        kind: "tool_use",
        messageKey: "x-msg",
        createdAt: 0,
        toolUseId: "x",
        toolName: "Bash",
        input: { command: "ls" },
        status: "done",
        result: "files",
        structuredResult: null,
        toolWallMs: null,
      },
      {
        kind: "tool_use",
        messageKey: "y-msg",
        createdAt: 0,
        toolUseId: "y",
        toolName: "Write",
        input: { path: "/tmp/x" },
        status: "done",
        result: null,
        structuredResult: null,
        toolWallMs: null,
      },
    ]);
    expect(out.tasks).toEqual([]);
  });

  test("TaskCreate without subject is dropped", () => {
    const out = reduceTaskListState([
      createCall("c1", { description: "no subject here" }, 1),
    ]);
    expect(out.tasks).toEqual([]);
  });

  test("non-terminal Task* calls are skipped (no id binding yet)", () => {
    const out = reduceTaskListState([
      createCall(
        "c1",
        { subject: "Pending create" },
        1,
        { status: "pending", result: null },
      ),
      updateCall("u1", { taskId: "1", status: "completed" }),
    ]);
    // The create is pending → skipped. The update finds no matching task.
    expect(out.tasks).toEqual([]);
  });

  test("errored Task* calls are skipped", () => {
    const out = reduceTaskListState([
      createCall(
        "c1",
        { subject: "Errored create" },
        1,
        { status: "error", result: null },
      ),
    ]);
    expect(out.tasks).toEqual([]);
  });

  test("one TaskCreate → one pending task with parsed id", () => {
    const out = reduceTaskListState([
      createCall(
        "c1",
        {
          subject: "Write calc.c source",
          description: "Implement command-line calculator in C",
          activeForm: "Writing calc.c source",
        },
        1,
      ),
    ]);
    expect(out.tasks).toEqual([
      {
        taskId: "1",
        subject: "Write calc.c source",
        description: "Implement command-line calculator in C",
        activeForm: "Writing calc.c source",
        status: "pending",
      },
    ]);
  });

  test("TaskCreate with off-pattern result falls back to monotonic count", () => {
    const out = reduceTaskListState([
      createCall("c1", { subject: "A" }, undefined, { result: "weird response" }),
      createCall("c2", { subject: "B" }, undefined, { result: null }),
    ]);
    expect(out.tasks.map((t) => t.taskId)).toEqual(["1", "2"]);
  });

  test("TaskUpdate flips status by taskId", () => {
    const out = reduceTaskListState([
      createCall("c1", { subject: "A" }, 1),
      createCall("c2", { subject: "B" }, 2),
      updateCall("u1", { taskId: "1", status: "in_progress" }),
      updateCall("u2", { taskId: "1", status: "completed" }),
      updateCall("u3", { taskId: "2", status: "in_progress" }),
    ]);
    expect(out.tasks).toEqual([
      {
        taskId: "1",
        subject: "A",
        description: undefined,
        activeForm: undefined,
        status: "completed",
      },
      {
        taskId: "2",
        subject: "B",
        description: undefined,
        activeForm: undefined,
        status: "in_progress",
      },
    ]);
  });

  test("TaskUpdate for an unknown taskId is silently dropped", () => {
    const out = reduceTaskListState([
      createCall("c1", { subject: "A" }, 1),
      updateCall("u1", { taskId: "99", status: "completed" }),
    ]);
    expect(out.tasks).toEqual([
      {
        taskId: "1",
        subject: "A",
        description: undefined,
        activeForm: undefined,
        status: "pending",
      },
    ]);
  });

  test("order is preserved across multiple creates and updates", () => {
    const out = reduceTaskListState([
      createCall("c1", { subject: "A" }, 1),
      createCall("c2", { subject: "B" }, 2),
      createCall("c3", { subject: "C" }, 3),
      updateCall("u1", { taskId: "2", status: "in_progress" }),
      updateCall("u2", { taskId: "1", status: "completed" }),
    ]);
    expect(out.tasks.map((t) => t.subject)).toEqual(["A", "B", "C"]);
  });

  test("reference-stable empty state across multiple invocations", () => {
    expect(reduceTaskListState([])).toBe(reduceTaskListState([]));
  });

  test("tool-name match is case-insensitive (matches dispatch convention)", () => {
    const out = reduceTaskListState([
      {
        kind: "tool_use",
        messageKey: "c1-msg",
        createdAt: 0,
        toolUseId: "c1",
        toolName: "TASKCREATE",
        input: { subject: "Upper" },
        status: "done",
        result: "Task #1 created successfully: Upper",
        structuredResult: null,
        toolWallMs: null,
      },
      {
        kind: "tool_use",
        messageKey: "u1-msg",
        createdAt: 0,
        toolUseId: "u1",
        toolName: "taskupdate",
        input: { taskId: "1", status: "completed" },
        status: "done",
        result: "Updated task #1 status",
        structuredResult: null,
        toolWallMs: null,
      },
    ]);
    expect(out.tasks).toEqual([
      {
        taskId: "1",
        subject: "Upper",
        description: undefined,
        activeForm: undefined,
        status: "completed",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// taskListIsActive — the [D100] visibility gate
// ---------------------------------------------------------------------------

describe("taskListIsActive", () => {
  test("empty list → inactive", () => {
    const state: TaskListState = { tasks: [] };
    expect(taskListIsActive(state)).toBe(false);
  });

  test("all-completed list → inactive", () => {
    const state: TaskListState = {
      tasks: [
        { taskId: "1", subject: "A", status: "completed" },
        { taskId: "2", subject: "B", status: "completed" },
      ],
    };
    expect(taskListIsActive(state)).toBe(false);
  });

  test("at least one non-completed item → active", () => {
    const state: TaskListState = {
      tasks: [
        { taskId: "1", subject: "A", status: "completed" },
        { taskId: "2", subject: "B", status: "in_progress" },
      ],
    };
    expect(taskListIsActive(state)).toBe(true);
  });

  test("a single pending item → active", () => {
    const state: TaskListState = {
      tasks: [{ taskId: "1", subject: "A", status: "pending" }],
    };
    expect(taskListIsActive(state)).toBe(true);
  });
});
