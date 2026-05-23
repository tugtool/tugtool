/**
 * `TideCardPinnedTodo` — the pinned `Z2A` renderer for the active
 * task list ([D100]).
 *
 * Reads the assembled state through `useSyncExternalStore` ([L02])
 * by combining two sources:
 *
 *   1. `codeSessionStore`'s public snapshot — provides committed
 *      `transcript[].toolCalls[]` and the in-flight turn's
 *      `inflightUserMessage.turnKey` (when a turn is active).
 *   2. `codeSessionStore.streamingDocument`'s
 *      `turn.${turnKey}.tools` path — provides the in-flight turn's
 *      live `ToolCallState[]`, written by the reducer on every
 *      `tool_use` / `tool_result` so `Z2A` updates as `TaskCreate` /
 *      `TaskUpdate` events land rather than waiting for the turn to
 *      commit.
 *
 * The two streams are disjoint by `tool_use_id` (each turn carries
 * its own ids), so concatenation in transcript-then-inflight order
 * is safe and order-preserving for {@link reduceTaskListState}.
 *
 * Visibility follows the [D100] active rule encoded in
 * {@link taskListIsActive}: the renderer returns `null` (slot
 * collapses to zero height via `:empty`, [L06]) unless the assembled
 * list has at least one non-completed item. There is no React state
 * for visibility — purely a render-time predicate.
 *
 * Composition: a standalone `TodoListBlock` (no `embedded` mode)
 * with no header label or summary chrome — the `Z2A` strip is a
 * compact pin, not a framed body. The per-row `description` tooltip
 * is the only secondary affordance.
 *
 * @module components/tugways/cards/tide-card-pinned-todo
 */

import "./tide-card-pinned-todo.css";

import React, { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import { TodoListBlock } from "@/components/tugways/body-kinds/todo-list-block";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { PropertyStore } from "@/components/tugways/property-store";
import {
  reduceTaskListState,
  taskListIsActive,
  type TaskListState,
} from "@/lib/code-session-store/select-task-list";
import type { ToolCallState } from "@/lib/code-session-store/types";

// ---------------------------------------------------------------------------
// In-flight tool-calls hook — reads the streaming-document path
// ---------------------------------------------------------------------------

const EMPTY_TOOL_CALLS: readonly ToolCallState[] = Object.freeze([]);
const NO_PATH_SENTINEL = "<no-inflight-turn>";

/**
 * Subscribe to the in-flight turn's serialized tool-calls path and
 * return the parsed `ToolCallState[]` snapshot. When `path` is
 * `null` (no in-flight turn) the subscription is a no-op and the
 * snapshot is a stable empty array — the hook still runs on every
 * render so React's hook-order rule holds.
 *
 * Caches by serialized-JSON identity so quiescent calls return the
 * same reference (satisfies the [L02] / `useSyncExternalStore`
 * contract that identical store data yields `Object.is`-identical
 * snapshots).
 */
function useInflightTaskCalls(
  store: PropertyStore,
  path: string | null,
): readonly ToolCallState[] {
  const lastSerializedRef = useRef<string | null>(null);
  const lastParsedRef = useRef<readonly ToolCallState[]>(EMPTY_TOOL_CALLS);

  const subscribe = useCallback(
    (listener: () => void) => {
      if (path === null) return () => {};
      return store.observe(path, listener);
    },
    [store, path],
  );

  const getSnapshot = useCallback((): readonly ToolCallState[] => {
    if (path === null) {
      lastSerializedRef.current = NO_PATH_SENTINEL;
      lastParsedRef.current = EMPTY_TOOL_CALLS;
      return EMPTY_TOOL_CALLS;
    }
    const raw = store.get(path);
    const serialized = typeof raw === "string" ? raw : "[]";
    if (serialized === lastSerializedRef.current) {
      return lastParsedRef.current;
    }
    let parsed: readonly ToolCallState[];
    try {
      const candidate = JSON.parse(serialized) as unknown;
      parsed = Array.isArray(candidate)
        ? (candidate as readonly ToolCallState[])
        : EMPTY_TOOL_CALLS;
    } catch {
      parsed = EMPTY_TOOL_CALLS;
    }
    lastSerializedRef.current = serialized;
    lastParsedRef.current = parsed;
    return parsed;
  }, [store, path]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface TideCardPinnedTodoProps {
  codeSessionStore: CodeSessionStore;
  className?: string;
}

export const TideCardPinnedTodo: React.FC<TideCardPinnedTodoProps> = ({
  codeSessionStore,
  className,
}) => {
  const snapshot = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );

  const turnKey = snapshot.inflightUserMessage?.turnKey ?? null;
  const inflightPath = turnKey === null ? null : `turn.${turnKey}.tools`;
  const inflightCalls = useInflightTaskCalls(
    codeSessionStore.streamingDocument,
    inflightPath,
  );

  const state = useMemo<TaskListState>(() => {
    return reduceTaskListState(iterateAllTaskCalls(snapshot.transcript, inflightCalls));
  }, [snapshot.transcript, inflightCalls]);

  if (!taskListIsActive(state)) return null;

  const cls =
    className === undefined
      ? "tide-card-pinned-todo"
      : `tide-card-pinned-todo ${className}`;

  return (
    <div className={cls} data-slot="tide-card-pinned-todo">
      <TodoListBlock data={state} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Composition: transcript + inflight, in event-stream order
// ---------------------------------------------------------------------------

/**
 * Walk every committed turn's `toolCalls[]` in turn-order, then the
 * in-flight turn's live `ToolCallState[]`. The two are disjoint by
 * `tool_use_id`, so concatenation is safe and the order matches the
 * event stream — required for {@link reduceTaskListState}'s
 * order-sensitive fold (`TaskCreate` must land before any
 * `TaskUpdate` it pairs with).
 */
function* iterateAllTaskCalls(
  transcript: ReadonlyArray<{ toolCalls: ReadonlyArray<ToolCallState> }>,
  inflight: readonly ToolCallState[],
): IterableIterator<ToolCallState> {
  for (const turn of transcript) {
    for (const call of turn.toolCalls) {
      yield call;
    }
  }
  for (const call of inflight) {
    yield call;
  }
}
