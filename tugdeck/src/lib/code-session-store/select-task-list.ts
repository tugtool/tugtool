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
 *   - `TaskUpdate` — flips one task's `status` by `taskId`.
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

import type { ToolCallState } from "./types";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/** Lifecycle of one task per Claude Code's vocabulary. */
export type TaskStatus = "pending" | "in_progress" | "completed";

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

/** Narrowed `tool_use.input` for a `TaskUpdate` call. */
export interface TaskUpdateInput {
  taskId: string;
  status: TaskStatus;
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
 * {@link TaskUpdateInput}. Defensive: returns `undefined` when
 * `taskId` is not a string or `status` is not a known
 * {@link TaskStatus}.
 */
export function narrowTaskUpdateInput(
  value: unknown,
): TaskUpdateInput | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const taskId = typeof v.taskId === "string" ? v.taskId : undefined;
  const status = narrowTaskStatus(v.status);
  if (taskId === undefined || status === undefined) return undefined;
  return { taskId, status };
}

function narrowTaskStatus(value: unknown): TaskStatus | undefined {
  if (value === "pending" || value === "in_progress" || value === "completed") {
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
const EMPTY_STATE: TaskListState = Object.freeze({ tasks: EMPTY_TASKS });

/**
 * Fold an in-order iterable of `ToolCallState` into the current
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
 * with the in-flight turn's streaming `ToolCallState[]` in that
 * order; concatenation is safe because the in-flight turn carries
 * `tool_use_id`s disjoint from every committed turn.
 *
 * The reducer is pure and order-preserving — it does not sort,
 * dedupe, or rebalance — so a future windowing optimisation (e.g.
 * checkpoint + replay-since) substitutes cleanly. Returns a frozen
 * empty {@link TaskListState} when no Task* events are present.
 */
export function reduceTaskListState(
  toolCalls: Iterable<ToolCallState>,
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
      tasks.push(item);
    } else if (lower === "taskupdate") {
      const input = narrowTaskUpdateInput(call.input);
      if (input === undefined) continue;
      if (tasks === null) continue;
      const index = tasks.findIndex((t) => t.taskId === input.taskId);
      if (index === -1) continue;
      tasks[index] = { ...tasks[index], status: input.status };
    }
  }
  if (tasks === null) return EMPTY_STATE;
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
