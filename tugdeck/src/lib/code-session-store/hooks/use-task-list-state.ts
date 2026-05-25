/**
 * `useTaskListState` — derive the current task list ([D100]) from a
 * `CodeSessionStore` snapshot.
 *
 * Walks every committed turn's `messages` filtered to `tool_use`, then
 * the in-flight turn's `activeTurn.messages` (same filter), feeding the
 * concatenated stream into {@link reduceTaskListState}. The two are
 * disjoint by `tool_use_id` (each turn carries its own ids), so
 * concatenation is safe and order-preserving for the reducer's
 * `TaskCreate` → `TaskUpdate` pairing.
 *
 * Under [D07] the in-flight tool calls live on the snapshot directly
 * (`activeTurn.messages`) — the previous implementation subscribed to
 * a PropertyStore path that mirrored them as JSON. Reading from the
 * snapshot eliminates the parallel storage and keeps the substrate the
 * single source of truth.
 *
 * Returns a stable {@link TaskListState}. Re-derives only when one of
 * the inputs (`transcript` / `activeTurn.messages`) changes identity.
 *
 * Laws: [L02] external state through `useSyncExternalStore`.
 *
 * @module lib/code-session-store/hooks/use-task-list-state
 */

import { useMemo, useSyncExternalStore } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import {
  reduceTaskListState,
  type TaskListState,
} from "@/lib/code-session-store/select-task-list";
import type {
  ToolUseMessage,
  TurnEntry,
} from "@/lib/code-session-store/types";

/**
 * Walk every committed turn's `tool_use` Messages in turn-order, then
 * the in-flight turn's `tool_use` Messages. The two are disjoint by
 * `tool_use_id`, so concatenation is safe and the order matches the
 * event stream — required for {@link reduceTaskListState}'s
 * order-sensitive fold (`TaskCreate` must land before any `TaskUpdate`
 * it pairs with).
 */
function* iterateAllTaskCalls(
  transcript: ReadonlyArray<TurnEntry>,
  inflight: ReadonlyArray<TurnEntry["messages"][number]>,
): IterableIterator<ToolUseMessage> {
  for (const turn of transcript) {
    for (const m of turn.messages) {
      if (m.kind === "tool_use") yield m;
    }
  }
  for (const m of inflight) {
    if (m.kind === "tool_use") yield m;
  }
}

/**
 * Subscribe to the session and return the current {@link TaskListState}
 * assembled from every committed Task* call plus the in-flight turn's
 * live ones. Re-derives only when one of the inputs changes identity.
 */
export function useTaskListState(
  codeSessionStore: CodeSessionStore,
): TaskListState {
  const snapshot = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  const inflightMessages = snapshot.activeTurn?.messages ?? [];

  return useMemo<TaskListState>(
    () =>
      reduceTaskListState(iterateAllTaskCalls(snapshot.transcript, inflightMessages)),
    [snapshot.transcript, inflightMessages],
  );
}
