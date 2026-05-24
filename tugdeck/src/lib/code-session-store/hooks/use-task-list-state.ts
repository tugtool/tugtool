/**
 * `useTaskListState` — derive the current task list ([D100]) from a
 * `CodeSessionStore` snapshot plus the in-flight turn's streaming
 * tool-calls path.
 *
 * Combines two store subscriptions (both required for live state):
 *
 *   1. The public snapshot (`subscribe` + `getSnapshot`) — provides
 *      committed `transcript[].toolCalls[]` and the in-flight turn's
 *      `inflightUserMessage.turnKey` (when a turn is active).
 *   2. The `streamingDocument`'s `turn.${turnKey}.tools` path —
 *      provides the in-flight turn's live `ToolCallState[]`, written
 *      by the reducer on every `tool_use` / `tool_result` so the
 *      derived list updates as `TaskCreate` / `TaskUpdate` events
 *      land rather than waiting for the turn to commit.
 *
 * Both streams flow through {@link reduceTaskListState} in
 * transcript-then-inflight order; the two are disjoint by
 * `tool_use_id` (each turn carries its own ids), so concatenation is
 * safe and order-preserving for the reducer's `TaskCreate` →
 * `TaskUpdate` pairing.
 *
 * Returns a stable {@link TaskListState}. When `getSnapshot`
 * dependencies change identity, the in-flight subscription
 * re-establishes; consumers that need `Object.is`-stable derived
 * values use `useMemo` against the returned `state`.
 *
 * Laws: [L02] external state through `useSyncExternalStore`.
 *
 * @module lib/code-session-store/hooks/use-task-list-state
 */

import {
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type { PropertyStore } from "@/components/tugways/property-store";
import {
  reduceTaskListState,
  type TaskListState,
} from "@/lib/code-session-store/select-task-list";
import type { ToolCallState, TurnEntry } from "@/lib/code-session-store/types";

const EMPTY_TOOL_CALLS: readonly ToolCallState[] = Object.freeze([]);
const NO_PATH_SENTINEL = "<no-inflight-turn>";

/**
 * Subscribe to a streaming-document tool-calls path and return the
 * parsed `ToolCallState[]` snapshot. When `path` is `null` (no
 * in-flight turn) the subscription is a no-op and the snapshot is a
 * stable empty array. The hook is called every render so React's
 * hook-order rule holds.
 *
 * Caches by serialized-JSON identity so quiescent calls return the
 * same reference (the [L02] / `useSyncExternalStore` contract that
 * identical store data yields `Object.is`-identical snapshots).
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

/**
 * Walk every committed turn's `toolCalls[]` in turn-order, then the
 * in-flight turn's live `ToolCallState[]`. The two are disjoint by
 * `tool_use_id`, so concatenation is safe and the order matches the
 * event stream — required for {@link reduceTaskListState}'s
 * order-sensitive fold (`TaskCreate` must land before any
 * `TaskUpdate` it pairs with).
 */
function* iterateAllTaskCalls(
  transcript: ReadonlyArray<TurnEntry>,
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

  const turnKey = snapshot.inflightUserMessage?.turnKey ?? null;
  const inflightPath = turnKey === null ? null : `turn.${turnKey}.tools`;
  const inflightCalls = useInflightTaskCalls(
    codeSessionStore.streamingDocument,
    inflightPath,
  );

  return useMemo<TaskListState>(
    () => reduceTaskListState(iterateAllTaskCalls(snapshot.transcript, inflightCalls)),
    [snapshot.transcript, inflightCalls],
  );
}
