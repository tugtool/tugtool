/**
 * Pure-logic tests for `TaskInlineToolBlock`'s exported helpers —
 * `deriveTaskInlineKind`, `composeCreatedLabel`,
 * `composeUpdatedLabel`, `resolveUpdateSubject`, and the unified
 * `composeMarkerText` switch. Plus the dispatch registration pins
 * for both `taskcreate` and `taskupdate`, which both point at the
 * same wrapper.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests. The visible
 * tone treatment (`emphasis="calm"` for the steady-state row /
 * `role="danger"` + `emphasis="normal"` for an errored event) is
 * implementation-encoded in the React branch — not separately
 * extractable as a pure helper, so it isn't pinned here.
 * `composeMarkerText` is the pure surface that drives every
 * non-error row's visible string; tests pin every branch.
 *
 * @module components/tugways/cards/tool-blocks/__tests__/task-inline-tool-block
 */

import { describe, expect, test } from "bun:test";

import {
  TaskInlineToolBlock,
  composeCreatedLabel,
  composeMarkerText,
  composeUpdatedLabel,
  deriveTaskInlineKind,
  resolveUpdateSubject,
} from "../task-inline-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../tide-assistant-renderer-dispatch";
import type { TaskItem } from "@/lib/code-session-store/select-task-list";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TASKS: readonly TaskItem[] = Object.freeze([
  { taskId: "1", subject: "Write the spec", status: "completed" },
  { taskId: "2", subject: "Land the wrapper", status: "in_progress" },
  { taskId: "3", subject: "Ship the gallery", status: "pending" },
]);

// ---------------------------------------------------------------------------
// deriveTaskInlineKind
// ---------------------------------------------------------------------------

describe("deriveTaskInlineKind", () => {
  test("`TaskCreate` → create", () => {
    expect(deriveTaskInlineKind("TaskCreate")).toBe("create");
  });

  test("`TaskUpdate` → update", () => {
    expect(deriveTaskInlineKind("TaskUpdate")).toBe("update");
  });

  test("case-insensitive", () => {
    expect(deriveTaskInlineKind("taskcreate")).toBe("create");
    expect(deriveTaskInlineKind("TASKUPDATE")).toBe("update");
  });

  test("returns null for an unrecognised name", () => {
    expect(deriveTaskInlineKind("Task")).toBeNull();
    expect(deriveTaskInlineKind("TaskList")).toBeNull();
    expect(deriveTaskInlineKind("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeCreatedLabel
// ---------------------------------------------------------------------------

describe("composeCreatedLabel", () => {
  test("formats as `Created: <subject>`", () => {
    expect(composeCreatedLabel("Write the spec")).toBe("Created: Write the spec");
  });

  test("preserves the subject verbatim (no trimming, no truncation)", () => {
    expect(composeCreatedLabel("  spaced  ")).toBe("Created:   spaced  ");
  });
});

// ---------------------------------------------------------------------------
// composeUpdatedLabel
// ---------------------------------------------------------------------------

describe("composeUpdatedLabel", () => {
  test("in_progress → `Started: <subject>`", () => {
    expect(composeUpdatedLabel("in_progress", "Write the spec")).toBe(
      "Started: Write the spec",
    );
  });

  test("completed → `Completed: <subject>`", () => {
    expect(composeUpdatedLabel("completed", "Write the spec")).toBe(
      "Completed: Write the spec",
    );
  });

  test("pending → `Reset: <subject>` (rare revert)", () => {
    expect(composeUpdatedLabel("pending", "Write the spec")).toBe(
      "Reset: Write the spec",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveUpdateSubject
// ---------------------------------------------------------------------------

describe("resolveUpdateSubject", () => {
  test("returns the matched task's subject when the id is present", () => {
    expect(resolveUpdateSubject("2", TASKS)).toBe("Land the wrapper");
  });

  test("falls back to `Task #<id>` when the id is unknown", () => {
    expect(resolveUpdateSubject("99", TASKS)).toBe("Task #99");
  });

  test("falls back even when the task list is empty", () => {
    expect(resolveUpdateSubject("1", [])).toBe("Task #1");
  });
});

// ---------------------------------------------------------------------------
// composeMarkerText
// ---------------------------------------------------------------------------

describe("composeMarkerText", () => {
  test("create + ready + valid input → `Created: <subject>`", () => {
    expect(
      composeMarkerText({
        kind: "create",
        input: { subject: "Write the spec" },
        status: "ready",
        tasks: TASKS,
      }),
    ).toBe("Created: Write the spec");
  });

  test("create + streaming → `Creating…`", () => {
    expect(
      composeMarkerText({
        kind: "create",
        input: {},
        status: "streaming",
        tasks: TASKS,
      }),
    ).toBe("Creating…");
  });

  test("create + ready + invalid input → falls back to `Creating…`", () => {
    expect(
      composeMarkerText({
        kind: "create",
        input: { not_subject: 42 },
        status: "ready",
        tasks: TASKS,
      }),
    ).toBe("Creating…");
  });

  test("update + ready + in_progress on known id → `Started: <subject>`", () => {
    expect(
      composeMarkerText({
        kind: "update",
        input: { taskId: "2", status: "in_progress" },
        status: "ready",
        tasks: TASKS,
      }),
    ).toBe("Started: Land the wrapper");
  });

  test("update + ready + completed on known id → `Completed: <subject>`", () => {
    expect(
      composeMarkerText({
        kind: "update",
        input: { taskId: "1", status: "completed" },
        status: "ready",
        tasks: TASKS,
      }),
    ).toBe("Completed: Write the spec");
  });

  test("update + ready + unknown id → `<Verb>: Task #<id>`", () => {
    expect(
      composeMarkerText({
        kind: "update",
        input: { taskId: "99", status: "completed" },
        status: "ready",
        tasks: TASKS,
      }),
    ).toBe("Completed: Task #99");
  });

  test("update + streaming → `Updating…`", () => {
    expect(
      composeMarkerText({
        kind: "update",
        input: { taskId: "2" }, // status missing → partial input
        status: "streaming",
        tasks: TASKS,
      }),
    ).toBe("Updating…");
  });

  test("update + ready + invalid input → falls back to `Updating…`", () => {
    expect(
      composeMarkerText({
        kind: "update",
        input: { taskId: 99, status: "bogus" },
        status: "ready",
        tasks: TASKS,
      }),
    ).toBe("Updating…");
  });

  test("null kind → generic placeholder (defensive)", () => {
    expect(
      composeMarkerText({
        kind: null,
        input: {},
        status: "ready",
        tasks: TASKS,
      }),
    ).toBe("Task event");
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration — both `taskcreate` AND `taskupdate` map to
// the SAME `TaskInlineToolBlock` factory (no aliasing — two
// canonical wire names sharing one wrapper, per [#step-24-3-5]).
// ---------------------------------------------------------------------------

describe("dispatch registration", () => {
  test("`taskcreate` maps to the bespoke wrapper", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("taskcreate")).toBe(TaskInlineToolBlock);
  });

  test("`taskupdate` maps to the bespoke wrapper (same factory)", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("taskupdate")).toBe(TaskInlineToolBlock);
  });

  test("both names share the same factory reference", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("taskcreate")).toBe(
      BESPOKE_FACTORY_BY_NAME.get("taskupdate"),
    );
  });
});
