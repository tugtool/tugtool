/**
 * `useWorkState` — the unified WORK row list for a `CodeSessionStore`.
 *
 * Projects the three sources (turn-scoped task list, session-lifetime
 * jobs ledger, the `/goal`) into `WorkItem[]` via `selectWorkItems`.
 * The sources keep their own semantics ([P02] of
 * `roadmap/slash-command-plan.md` — the surface unifies, the storage
 * does not); the memo keys on the three source references, which are
 * each `Object.is`-stable across quiescent snapshot rebuilds.
 *
 * Laws: [L02] external state through `useSyncExternalStore` (via the
 * underlying hooks).
 *
 * @module lib/code-session-store/hooks/use-work-state
 */

import { useMemo } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import { selectWorkItems, type WorkItem } from "@/lib/code-session-store/select-work";
import { useGoalState } from "./use-goal-state";
import { useJobsState } from "./use-jobs-state";
import { useTaskListState } from "./use-task-list-state";

/** Subscribe to the store and return the projected work rows. */
export function useWorkState(store: CodeSessionStore): readonly WorkItem[] {
  const tasks = useTaskListState(store).tasks;
  const jobs = useJobsState(store);
  const goal = useGoalState(store);
  return useMemo(() => selectWorkItems(tasks, jobs, goal), [tasks, jobs, goal]);
}
