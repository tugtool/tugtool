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
 * **Turn-scoped visibility.** The wire never emits a "clear" frame for
 * the task list (verified against the v2.1.150 fixtures and live
 * session 45208c42 — each user prompt's `promptId` owns its own Task*
 * events, with no reset signal between prompts). The clearing the
 * user observes in Claude Code's TUI is a view convention: the visible
 * task list belongs to the current/latest turn. This hook implements
 * the same convention by gating on the **latest turn**'s Task* event
 * presence:
 *
 *   - If the latest turn (in-flight if `activeTurn !== null`, else the
 *     most-recent committed `TurnEntry`) has no Task* tool_use
 *     messages, the hook returns the empty state.
 *   - Otherwise it folds every Task* event across the whole transcript
 *     so `TaskUpdate`s pair correctly with `TaskCreate`s that may live
 *     in earlier turns.
 *
 * This mirrors the reducer's established lingering-then-resetting
 * pattern for per-turn state (e.g. the pause-interval arrays at
 * `reducer.ts:535`): state lingers through the brief idle gap after a
 * turn completes (so the finished batch is still visible until the
 * user moves on), then clears the moment the next `handleSend` opens
 * a fresh activeTurn that has no Task* activity.
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
  EMPTY_TASK_LIST_STATE,
  reduceTaskListState,
  type TaskListState,
} from "@/lib/code-session-store/select-task-list";
import type { Message, ToolUseMessage, TurnEntry } from "@/lib/code-session-store/types";

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
  inflight: ReadonlyArray<Message>,
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
 * True if any message in `messages` is a terminal Task* `tool_use`
 * (TaskCreate or TaskUpdate, case-insensitive — matching the
 * reducer's dispatch convention). In-flight (non-`done`) Task* calls
 * still count: the popover should reveal a new batch as soon as
 * Claude streams its first `TaskCreate` in the new turn, even before
 * the matching `tool_result` lands.
 *
 * Exported for unit tests so the turn-boundary rule is pin-able.
 */
export function hasTaskEvent(messages: ReadonlyArray<Message>): boolean {
  for (const m of messages) {
    if (m.kind !== "tool_use") continue;
    const lower = m.toolName.toLowerCase();
    if (lower === "taskcreate" || lower === "taskupdate") return true;
  }
  return false;
}

/**
 * The "latest turn" — the in-flight turn's messages if a turn is
 * active, otherwise the most-recent committed turn's messages, or
 * `null` if the session has no turns yet. This is the turn whose
 * Task* presence gates the visible task list (see module docstring).
 *
 * Exported for unit tests.
 */
export function selectLatestTurnMessages(
  transcript: ReadonlyArray<TurnEntry>,
  inflightMessages: ReadonlyArray<Message> | null,
): ReadonlyArray<Message> | null {
  if (inflightMessages !== null) return inflightMessages;
  if (transcript.length === 0) return null;
  return transcript[transcript.length - 1].messages;
}

/**
 * Subscribe to the session and return the current {@link TaskListState}
 * assembled from every committed Task* call plus the in-flight turn's
 * live ones. Returns the empty state when the latest turn has no
 * Task* activity (see module docstring). Re-derives only when one of
 * the inputs changes identity.
 */
export function useTaskListState(
  codeSessionStore: CodeSessionStore,
): TaskListState {
  const snapshot = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  const inflightMessages = snapshot.activeTurn?.messages ?? null;

  return useMemo<TaskListState>(() => {
    const latest = selectLatestTurnMessages(snapshot.transcript, inflightMessages);
    if (latest === null || !hasTaskEvent(latest)) return EMPTY_TASK_LIST_STATE;
    return reduceTaskListState(
      iterateAllTaskCalls(snapshot.transcript, inflightMessages ?? []),
    );
  }, [snapshot.transcript, inflightMessages]);
}
