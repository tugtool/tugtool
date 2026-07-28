/**
 * Task-list state derivation — wire narrowing and a pure reducer that
 * folds the `claude` ≥ `v2.1.148` `TaskCreate` / `TaskUpdate` event
 * stream into a current task list ([D100]).
 *
 * Anthropic's `claude` switched from `TodoWrite` (single call carrying
 * the whole canonical list) to a per-item CRUD family between
 * `v2.1.112` and `v2.1.148`:
 *
 *   - `TaskCreate` — creates one task; the server assigns a monotonic
 *     `taskId` and echoes it in `tool_result.content` as
 *     `"Task #N created successfully: <subject>"`.
 *   - `TaskUpdate` — mutates one task by `taskId`: its `status`, its
 *     text fields (`subject` / `description` / `activeForm`), or both.
 *     `status: "deleted"` is not a fourth lifecycle state — it removes
 *     the task from the list outright.
 *
 * The pinned `Z2A` renderer ([D100]) reads the assembled state from
 * {@link reduceTaskListState} and treats the slot as *active* when
 * {@link taskListIsActive} returns true (non-empty + at least one
 * non-completed item). The reducer is a pure function — it never
 * touches React state or the DOM — so it composes cleanly with
 * `useSyncExternalStore` ([L02]) at the renderer.
 *
 * @module lib/code-session-store/select-task-list
 */

import type { ToolUseMessage } from "./types";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/** Lifecycle of one task per Claude Code's vocabulary. */
export type TaskStatus = "pending" | "in_progress" | "completed";

/**
 * The `status` vocabulary a `TaskUpdate` may carry on the wire. It is
 * the lifecycle plus `"deleted"`, which is a *removal instruction*
 * rather than a state a task can rest in — no {@link TaskItem} ever
 * holds it, which is why {@link TaskStatus} stays three-valued.
 */
export type TaskWireStatus = TaskStatus | "deleted";

/**
 * One task — the assembled state of one `TaskCreate` + any subsequent
 * `TaskUpdate` calls referencing its `taskId`.
 *
 * `taskId` is the server-assigned monotonic id parsed from the
 * matching `TaskCreate` `tool_result.content` (e.g. `"Task #3 created
 * successfully: …"`), falling back to monotonic count for the
 * defensive parse-miss path.
 */
export interface TaskItem {
  taskId: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  /**
   * Wall-clock ms the task last became `completed`, taken from the
   * completing `TaskUpdate` message's `createdAt` (+ its `toolWallMs`).
   * `undefined` while pending / in_progress, and cleared if the task is
   * reopened. Feeds the WORK cell's completion linger; `undefined` reads
   * as "not recently completed" (e.g. a resumed fold with no timing).
   */
  completedAtMs?: number;
}

/** Assembled task list — the reducer's output. */
export interface TaskListState {
  tasks: readonly TaskItem[];
}

/** Narrowed `tool_use.input` for a `TaskCreate` call. */
export interface TaskCreateInput {
  subject: string;
  description?: string;
  activeForm?: string;
}

/**
 * Narrowed `tool_use.input` for a `TaskUpdate` call.
 *
 * Every field but `taskId` is optional: `TaskUpdate` is a partial
 * mutation, and a call may carry a status, an edited text field, or
 * both. The narrowing keeps only the fields this side renders —
 * `owner`, `metadata`, and the blocks/blockedBy edges are accepted on
 * the wire but have no surface here.
 */
export interface TaskUpdateInput {
  taskId: string;
  status?: TaskWireStatus;
  subject?: string;
  description?: string;
  activeForm?: string;
}

// ---------------------------------------------------------------------------
// Wire narrowing (pure)
// ---------------------------------------------------------------------------

/**
 * Narrow a `TaskCreate` call's `tool_use.input` into a typed
 * {@link TaskCreateInput}. Defensive: returns `undefined` when the
 * required `subject` is missing or the value is not an object.
 */
export function narrowTaskCreateInput(
  value: unknown,
): TaskCreateInput | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.subject !== "string") return undefined;
  const description = typeof v.description === "string" ? v.description : undefined;
  const activeForm = typeof v.activeForm === "string" ? v.activeForm : undefined;
  return { subject: v.subject, description, activeForm };
}

/**
 * Narrow a `TaskUpdate` call's `tool_use.input` into a typed
 * {@link TaskUpdateInput}.
 *
 * Defensive in two directions, and the difference matters:
 *
 *  - No `taskId` string → `undefined`. There is nothing to address.
 *  - A `status` that is present but unrecognised → `undefined`. A
 *    status word this side has never seen carries semantics we would
 *    be guessing at, so the call is skipped rather than applied
 *    partially.
 *  - No `status` at all → **accepted**, provided the call carries at
 *    least one text field to apply. A rename or a description edit is
 *    a legitimate `TaskUpdate` with no lifecycle change, and dropping
 *    it would leave the list showing stale text.
 */
export function narrowTaskUpdateInput(
  value: unknown,
): TaskUpdateInput | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.taskId !== "string") return undefined;
  if (v.status !== undefined && narrowTaskWireStatus(v.status) === undefined) {
    return undefined;
  }
  const status = narrowTaskWireStatus(v.status);
  const subject = typeof v.subject === "string" ? v.subject : undefined;
  const description = typeof v.description === "string" ? v.description : undefined;
  const activeForm = typeof v.activeForm === "string" ? v.activeForm : undefined;
  if (
    status === undefined &&
    subject === undefined &&
    description === undefined &&
    activeForm === undefined
  ) {
    return undefined;
  }
  return { taskId: v.taskId, status, subject, description, activeForm };
}

function narrowTaskWireStatus(value: unknown): TaskWireStatus | undefined {
  if (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "deleted"
  ) {
    return value;
  }
  return undefined;
}

/**
 * Extract the server-assigned `taskId` from a `TaskCreate` call's
 * `tool_result.content`. The echo pattern is fixed by Anthropic:
 * `"Task #<N> created successfully: <subject>"`. Returns the captured
 * `<N>` as a string-encoded integer (matching the `TaskUpdate.taskId`
 * vocabulary), or `undefined` when the pattern doesn't match — the
 * caller may then fall back to a monotonic count.
 */
export function parseTaskCreateResultId(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  const match = /^Task #(\d+) created successfully:/.exec(result);
  return match === null ? undefined : match[1];
}

// ---------------------------------------------------------------------------
// Reducer (pure)
// ---------------------------------------------------------------------------

const EMPTY_TASKS: readonly TaskItem[] = Object.freeze([]);

/**
 * Reference-stable empty `TaskListState`. Returned by
 * {@link reduceTaskListState} when no tasks have been created, and by
 * `useTaskListState` when the current turn has no Task* activity.
 * Exported so consumers can compare with `Object.is` (or `===`) for
 * the "no tasks" branch without rebuilding their own sentinel.
 */
export const EMPTY_TASK_LIST_STATE: TaskListState = Object.freeze({ tasks: EMPTY_TASKS });
const EMPTY_STATE = EMPTY_TASK_LIST_STATE;

/**
 * Fold an in-order iterable of `ToolUseMessage` into the current
 * {@link TaskListState}, processing `TaskCreate` (append) and
 * `TaskUpdate` (mutate-by-id) events while ignoring everything else.
 *
 * Only terminal (`status: "done"`) Task* calls fold:
 *
 *  - An in-flight `TaskCreate` whose `tool_result` has not landed has
 *    no `taskId` to bind subsequent `TaskUpdate`s to — folding it
 *    would either drop the bind or invent an id that may collide
 *    with the real one once it arrives. Skipping until terminal
 *    keeps the id space coherent.
 *  - An errored Task* call did not change the server-side list, so
 *    folding it would diverge from the assistant's view.
 *
 * `taskId` falls back to a monotonic count of the create iteration
 * when the `tool_result.content` echo does not match the expected
 * pattern — defense against an Anthropic format change so the
 * reducer still produces a usable list rather than swallowing every
 * create.
 *
 * The expected caller is `selectTaskList` (this file's hook
 * companion) which composes the committed `transcript[].toolCalls[]`
 * with the in-flight turn's streaming `ToolUseMessage[]` in that
 * order; concatenation is safe because the in-flight turn carries
 * `tool_use_id`s disjoint from every committed turn.
 *
 * The reducer is order-preserving within a batch — it does not sort,
 * dedupe, or rebalance. Across batches it applies ONE boundary rule:
 * a `TaskCreate` arriving over a fully-completed list supersedes that
 * list (see the inline note), so the assembled state is always the
 * CURRENT batch rather than the session's accumulated history. A
 * `TaskUpdate` whose target was superseded is skipped by the existing
 * find-miss path. Returns a frozen empty {@link TaskListState} when
 * no Task* events are present.
 */
export function reduceTaskListState(
  toolCalls: Iterable<ToolUseMessage>,
): TaskListState {
  let tasks: TaskItem[] | null = null;
  let createCount = 0;
  for (const call of toolCalls) {
    if (call.status !== "done") continue;
    const lower = call.toolName.toLowerCase();
    if (lower === "taskcreate") {
      const input = narrowTaskCreateInput(call.input);
      if (input === undefined) continue;
      createCount += 1;
      const taskId = parseTaskCreateResultId(call.result) ?? String(createCount);
      const item: TaskItem = {
        taskId,
        subject: input.subject,
        description: input.description,
        activeForm: input.activeForm,
        status: "pending",
      };
      if (tasks === null) tasks = [];
      // Batch boundary: a `TaskCreate` arriving over a non-empty,
      // FULLY-COMPLETED list starts a fresh batch — the finished work
      // is superseded, not accumulated. Without this, a long session
      // (and a fortiori a replayed one, which folds the entire
      // history in one pass) buffers every completed batch ever and
      // the popup overflows with struck-through rows. An unfinished
      // list keeps accepting creates — additions to the working set.
      if (tasks.length > 0 && tasks.every((t) => t.status === "completed")) {
        tasks = [];
      }
      tasks.push(item);
    } else if (lower === "taskupdate") {
      const input = narrowTaskUpdateInput(call.input);
      if (input === undefined) continue;
      if (tasks === null) continue;
      const index = tasks.findIndex((t) => t.taskId === input.taskId);
      if (index === -1) continue;
      // `deleted` is a removal, not a state: the task leaves the list
      // entirely. Splicing (rather than flagging) is what keeps every
      // downstream consumer honest for free — `countTasks`, the
      // progress fraction, the copy text, and the active-list rule all
      // read straight off `tasks`, so a task that is gone is gone
      // everywhere without any of them learning a fourth status.
      if (input.status === "deleted") {
        tasks.splice(index, 1);
        continue;
      }
      const prev = tasks[index];
      const status = input.status ?? prev.status;
      const completedAtMs =
        status === "completed"
          ? // A text-only edit must not restamp an already-completed
            // task's linger clock, so the previous stamp wins when this
            // call didn't itself complete the task.
            (prev.completedAtMs ?? call.createdAt + (call.toolWallMs ?? 0))
          : undefined;
      tasks[index] = {
        ...prev,
        subject: input.subject ?? prev.subject,
        description: input.description ?? prev.description,
        activeForm: input.activeForm ?? prev.activeForm,
        status,
        completedAtMs,
      };
    }
  }
  // An emptied list reads as "no tasks", identical to never having had
  // any — including by reference, so consumers comparing against
  // `EMPTY_TASK_LIST_STATE` with `Object.is` see the empty branch after
  // the last task is deleted.
  if (tasks === null || tasks.length === 0) return EMPTY_STATE;
  return { tasks };
}

/**
 * The [D100] active-list visibility rule: the pinned `Z2A` slot is
 * visible iff the assembled list is non-empty AND has at least one
 * non-completed item. An all-completed list is "done work" and
 * collapses the slot until a fresh `TaskCreate` re-activates it.
 */
export function taskListIsActive(state: TaskListState): boolean {
  if (state.tasks.length === 0) return false;
  return state.tasks.some((t) => t.status !== "completed");
}
