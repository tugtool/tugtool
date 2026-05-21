/**
 * `useLifecycleState` — subscribes a tide-card component to its
 * `CodeSessionStore` and projects the Step 20.5.A matrix-row lifecycle
 * snapshot. Every zone that coordinates on lifecycle (Z5's submit
 * button, the transcript-replay paint gate, Z2 / Z4) reads this one
 * hook so the matrix has a single executable source of truth.
 *
 * Composition:
 *   1. `useSyncExternalStore` on the `CodeSessionStore` — the [L02]
 *      boundary for external state.
 *   2. The caller's `TideLifecycleUiState` (UI-local presentation
 *      flags the reducer does not track — [DT08]). A card with no
 *      drill-down producer yet (pre-Step 20.5.E) omits it and gets the
 *      stable default.
 *   3. `deriveLifecycleSnapshot(storeSnapshot, uiState, previous)` —
 *      the pure matrix projection, threaded with the previous result
 *      from a per-card `useRef` so [DT09] reference stability holds
 *      per card (a module-level cache would thrash when two cards
 *      stream at once).
 *
 * Conformance:
 *   - [L02] — `useSyncExternalStore` is the only external-state
 *     subscription; `lifecycle-state.ts` itself is pure.
 *   - [DT08] / [DT09] — see `lifecycle-state.ts`.
 *
 * The hook's React glue (`useSyncExternalStore` + the `useRef` render
 * cache) is left to real-app / integration coverage per the project's
 * no-fake-DOM rule; the pure `deriveLifecycleSnapshot` it wraps is
 * unit-tested exhaustively in `__tests__/lifecycle-state.test.ts`.
 *
 * @module lib/code-session-store/hooks/use-lifecycle-state
 */

import { useRef, useSyncExternalStore } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";

import {
  deriveLifecycleSnapshot,
  type TideLifecycleSnapshot,
  type TideLifecycleUiState,
} from "../lifecycle-state";

/**
 * Stable default UI state — a card whose drill-down producer has not
 * landed yet (the producer is Step 20.5.E) passes no `uiState`. The
 * same reference every render keeps `deriveLifecycleSnapshot`'s
 * [DT09] equality check from seeing a spurious input change.
 */
const DEFAULT_UI_STATE: TideLifecycleUiState = { drilldownOpen: false };

/**
 * Subscribe to `store` and return the current matrix-row lifecycle
 * snapshot. The returned reference is stable ([DT09]) across renders
 * that change no matrix-relevant signal — a streaming `assistant_delta`
 * re-runs the hook but yields the same snapshot object, so zones that
 * only consume lifecycle do not re-render.
 */
export function useLifecycleState(
  store: CodeSessionStore,
  uiState: TideLifecycleUiState = DEFAULT_UI_STATE,
): TideLifecycleSnapshot {
  const storeSnapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  );
  // Per-component (= per-card) memo of the last stable snapshot,
  // threaded into `deriveLifecycleSnapshot` as `previous`. Writing a
  // ref during render is sound here: the value is a pure function of
  // the render's inputs, so a double-invoked render recomputes the
  // identical result.
  const previousRef = useRef<TideLifecycleSnapshot | undefined>(undefined);
  const snapshot = deriveLifecycleSnapshot(
    storeSnapshot,
    uiState,
    previousRef.current,
  );
  previousRef.current = snapshot;
  return snapshot;
}
