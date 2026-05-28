/**
 * Pure-logic tests for `TaskMgmtToolBlock`'s wire-narrowing + verb /
 * header / args / tail composition helpers, plus the dispatch alias
 * machinery that routes all four wire names
 * (`TaskList`/`TaskGet`/`TaskOutput`/`TaskStop`) to the same canonical
 * `taskmgmt` registry entry via `TOOL_ALIASES`.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 *
 * @module components/tugways/cards/tool-blocks/__tests__/task-mgmt-tool-block
 */

import { describe, expect, test } from "bun:test";

import {
  TASK_OUTPUT_TAIL_LINE_COUNT,
  TaskMgmtToolBlock,
  composeTaskMgmtArgsLabel,
  composeTaskMgmtCollapsedLabel,
  composeTaskMgmtToolName,
  composeTaskOutputTail,
  deriveTaskMgmtVerb,
  narrowTaskMgmtInput,
} from "../task-mgmt-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../dev-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowTaskMgmtInput
// ---------------------------------------------------------------------------

describe("narrowTaskMgmtInput", () => {
  test("keeps camelCase `taskId`", () => {
    expect(narrowTaskMgmtInput({ taskId: "abc123" })).toEqual({
      taskId: "abc123",
      block: undefined,
      timeout: undefined,
    });
  });

  test("accepts snake_case `task_id` and normalises into `taskId`", () => {
    expect(
      narrowTaskMgmtInput({ task_id: "abc123", block: true, timeout: 30000 }),
    ).toEqual({
      taskId: "abc123",
      block: true,
      timeout: 30000,
    });
  });

  test("accepts legacy `shell_id` as id fallback", () => {
    expect(narrowTaskMgmtInput({ shell_id: "shell-99" })).toEqual({
      taskId: "shell-99",
      block: undefined,
      timeout: undefined,
    });
  });

  test("prefers `taskId` over `task_id` over `shell_id`", () => {
    expect(
      narrowTaskMgmtInput({
        taskId: "primary",
        task_id: "secondary",
        shell_id: "legacy",
      }),
    ).toEqual({
      taskId: "primary",
      block: undefined,
      timeout: undefined,
    });
    expect(
      narrowTaskMgmtInput({
        task_id: "secondary",
        shell_id: "legacy",
      }),
    ).toEqual({
      taskId: "secondary",
      block: undefined,
      timeout: undefined,
    });
  });

  test("returns {} for non-object input", () => {
    expect(narrowTaskMgmtInput(null)).toEqual({});
    expect(narrowTaskMgmtInput([])).toEqual({});
    expect(narrowTaskMgmtInput("string")).toEqual({});
    expect(narrowTaskMgmtInput(42)).toEqual({});
  });

  test("drops mistyped fields silently", () => {
    expect(
      narrowTaskMgmtInput({
        taskId: 12,
        block: "yes",
        timeout: "30000",
      }),
    ).toEqual({
      taskId: undefined,
      block: undefined,
      timeout: undefined,
    });
  });

  test("treats empty-string id as absent (id is load-bearing for header)", () => {
    expect(narrowTaskMgmtInput({ taskId: "", task_id: "real" })).toEqual({
      taskId: "real",
      block: undefined,
      timeout: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// deriveTaskMgmtVerb
// ---------------------------------------------------------------------------

describe("deriveTaskMgmtVerb", () => {
  test("`TaskList` → list", () => {
    expect(deriveTaskMgmtVerb("TaskList")).toBe("list");
  });

  test("`TaskGet` → get", () => {
    expect(deriveTaskMgmtVerb("TaskGet")).toBe("get");
  });

  test("`TaskOutput` → output", () => {
    expect(deriveTaskMgmtVerb("TaskOutput")).toBe("output");
  });

  test("`TaskStop` → stop", () => {
    expect(deriveTaskMgmtVerb("TaskStop")).toBe("stop");
  });

  test("case-insensitive", () => {
    expect(deriveTaskMgmtVerb("tasklist")).toBe("list");
    expect(deriveTaskMgmtVerb("TASKGET")).toBe("get");
    expect(deriveTaskMgmtVerb("Taskoutput")).toBe("output");
  });

  test("tolerates underscore / hyphen separators", () => {
    expect(deriveTaskMgmtVerb("task_list")).toBe("list");
    expect(deriveTaskMgmtVerb("task-output")).toBe("output");
  });

  test("returns null for an unrecognised tool name", () => {
    expect(deriveTaskMgmtVerb("Task")).toBeNull();
    expect(deriveTaskMgmtVerb("TaskCreate")).toBeNull();
    expect(deriveTaskMgmtVerb("TaskUpdate")).toBeNull();
    expect(deriveTaskMgmtVerb("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeTaskMgmtToolName
// ---------------------------------------------------------------------------

describe("composeTaskMgmtToolName", () => {
  test("includes the `Background Task ·` prefix for [D100] disambiguation", () => {
    expect(composeTaskMgmtToolName("list")).toBe("Background Task · list");
    expect(composeTaskMgmtToolName("get")).toBe("Background Task · get");
    expect(composeTaskMgmtToolName("output")).toBe("Background Task · output");
    expect(composeTaskMgmtToolName("stop")).toBe("Background Task · stop");
  });

  test("null verb → bare `Background Task`", () => {
    expect(composeTaskMgmtToolName(null)).toBe("Background Task");
  });
});

// ---------------------------------------------------------------------------
// composeTaskMgmtArgsLabel
// ---------------------------------------------------------------------------

describe("composeTaskMgmtArgsLabel", () => {
  test("emits `#<id>` when an id is present", () => {
    expect(composeTaskMgmtArgsLabel("get", { taskId: "abc123" })).toEqual({
      label: "#abc123",
    });
    expect(composeTaskMgmtArgsLabel("output", { taskId: "x" })).toEqual({
      label: "#x",
    });
    expect(composeTaskMgmtArgsLabel("stop", { taskId: "shell-1" })).toEqual({
      label: "#shell-1",
    });
  });

  test("returns undefined for `list` even when an id is somehow present", () => {
    expect(composeTaskMgmtArgsLabel("list", { taskId: "abc" })).toBeUndefined();
    expect(composeTaskMgmtArgsLabel("list", {})).toBeUndefined();
  });

  test("returns undefined when no id has arrived yet", () => {
    expect(composeTaskMgmtArgsLabel("get", {})).toBeUndefined();
    expect(composeTaskMgmtArgsLabel("output", {})).toBeUndefined();
    expect(composeTaskMgmtArgsLabel("stop", {})).toBeUndefined();
  });

  test("returns undefined for null verb (defensive)", () => {
    expect(composeTaskMgmtArgsLabel(null, { taskId: "abc" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeTaskMgmtCollapsedLabel
// ---------------------------------------------------------------------------

describe("composeTaskMgmtCollapsedLabel", () => {
  test("per-verb nouns hint at what's behind the fold cue", () => {
    expect(composeTaskMgmtCollapsedLabel("list")).toBe("result");
    expect(composeTaskMgmtCollapsedLabel("get")).toBe("details");
    expect(composeTaskMgmtCollapsedLabel("output")).toBe("output");
    expect(composeTaskMgmtCollapsedLabel("stop")).toBe("status");
  });

  test("null verb → generic `details`", () => {
    expect(composeTaskMgmtCollapsedLabel(null)).toBe("details");
  });
});

// ---------------------------------------------------------------------------
// composeTaskOutputTail
// ---------------------------------------------------------------------------

describe("composeTaskOutputTail", () => {
  test("returns null for undefined / empty output", () => {
    expect(composeTaskOutputTail(undefined)).toBeNull();
    expect(composeTaskOutputTail("")).toBeNull();
  });

  test("emits the whole output as tail when ≤ tailCount lines", () => {
    expect(composeTaskOutputTail("a\nb\nc")).toEqual({
      head: "",
      tail: "a\nb\nc",
      droppedLineCount: 0,
    });
  });

  test("splits head + tail when output exceeds tailCount", () => {
    expect(composeTaskOutputTail("a\nb\nc\nd\ne", 3)).toEqual({
      head: "a\nb",
      tail: "c\nd\ne",
      droppedLineCount: 2,
    });
  });

  test("treats a trailing newline as terminator, not a content line", () => {
    expect(composeTaskOutputTail("a\nb\nc\n")).toEqual({
      head: "",
      tail: "a\nb\nc\n",
      droppedLineCount: 0,
    });
  });

  test("uses the default TASK_OUTPUT_TAIL_LINE_COUNT when no override is passed", () => {
    const output = Array.from(
      { length: TASK_OUTPUT_TAIL_LINE_COUNT + 2 },
      (_, i) => `l${i}`,
    ).join("\n");
    const result = composeTaskOutputTail(output);
    expect(result).not.toBeNull();
    expect(result?.droppedLineCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TASK_OUTPUT_TAIL_LINE_COUNT — pin the default and the deliberate
// match against `MonitorToolBlock`'s `TAIL_LINE_COUNT`.
// ---------------------------------------------------------------------------

describe("TASK_OUTPUT_TAIL_LINE_COUNT", () => {
  test("3-line tail by default — matches MonitorToolBlock's tail size", () => {
    expect(TASK_OUTPUT_TAIL_LINE_COUNT).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration — the canonical `taskmgmt` name maps to
// `TaskMgmtToolBlock` in the frozen `BESPOKE_FACTORY_BY_NAME` lookup.
// The alias map (`tasklist` / `taskget` / `taskoutput` / `taskstop` →
// `taskmgmt`) lives in the dispatch and is exercised at runtime;
// calling `resolveToolBlock` here would race with the dispatch test's
// `beforeEach` (see `skill-tool-block.test.ts` for the rationale). The
// full alias-resolution path is verified by the policy governance
// test's v2.1.148 coverage check, which mirrors `TOOL_ALIASES` locally.
// ---------------------------------------------------------------------------

describe("dispatch registration", () => {
  test("`taskmgmt` maps to the bespoke wrapper in the immutable lookup", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("taskmgmt")).toBe(TaskMgmtToolBlock);
  });

  test("the four wire names are NOT directly registered (they resolve via alias)", () => {
    // Sanity: the aliases live in `TOOL_ALIASES`, NOT in
    // `BESPOKE_FACTORY_BY_NAME`. If any of these showed up here,
    // someone accidentally double-registered.
    expect(BESPOKE_FACTORY_BY_NAME.has("tasklist")).toBe(false);
    expect(BESPOKE_FACTORY_BY_NAME.has("taskget")).toBe(false);
    expect(BESPOKE_FACTORY_BY_NAME.has("taskoutput")).toBe(false);
    expect(BESPOKE_FACTORY_BY_NAME.has("taskstop")).toBe(false);
  });
});
