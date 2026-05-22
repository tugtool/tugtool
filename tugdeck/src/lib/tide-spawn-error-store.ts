/**
 * tide-spawn-error-store — per-card spawn-rejection store.
 *
 * When tugcast rejects a `spawn_session` (e.g. the project directory
 * no longer exists), the router echoes a `spawn_session_error` CONTROL
 * frame carrying the originating `card_id`. The unbound Tide card has
 * no `CodeSessionStore` yet — the session never came up — so the
 * failure has no per-session store to land in. It lands here instead,
 * keyed by `card_id`, and `TideProjectPicker` surfaces it through a
 * `<TugPaneBanner>`.
 *
 * Subscribable per-card so the already-mounted picker re-renders when
 * the asynchronous rejection arrives. Picker reads enter React via
 * `useSyncExternalStore` only — [L02].
 *
 * In-memory, module-scoped, single source of truth across the tab.
 *
 * @module lib/tide-spawn-error-store
 */

import { useCallback, useSyncExternalStore } from "react";

/** A rejected `spawn_session`, as surfaced to the card's banner. */
export interface SpawnError {
  /**
   * Wire reason code from `ControlError::InvalidProjectDir` /
   * `CapExceeded` — e.g. `does_not_exist`, `permission_denied`,
   * `not_a_directory`, `spawn_rate_limited`. Mapped to human copy by
   * `spawnErrorMessage`.
   */
  reason: string;
}

class TideSpawnErrorStore {
  private errors = new Map<string, SpawnError>();
  private listeners = new Map<string, Set<() => void>>();

  /** Record a spawn rejection for `cardId` and wake its subscribers. */
  set(cardId: string, error: SpawnError): void {
    this.errors.set(cardId, error);
    this.notify(cardId);
  }

  /** Drop the recorded rejection for `cardId` (e.g. on retry). */
  clear(cardId: string): void {
    if (!this.errors.delete(cardId)) return;
    this.notify(cardId);
  }

  /**
   * Current rejection for `cardId`, or `null`. Referentially stable
   * between mutations — safe as a `useSyncExternalStore` snapshot.
   */
  get(cardId: string): SpawnError | null {
    return this.errors.get(cardId) ?? null;
  }

  subscribe(cardId: string, listener: () => void): () => void {
    let set = this.listeners.get(cardId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(cardId, set);
    }
    set.add(listener);
    return () => {
      const s = this.listeners.get(cardId);
      if (s === undefined) return;
      s.delete(listener);
      if (s.size === 0) this.listeners.delete(cardId);
    };
  }

  private notify(cardId: string): void {
    const set = this.listeners.get(cardId);
    if (set === undefined) return;
    for (const listener of [...set]) listener();
  }
}

export const tideSpawnErrorStore = new TideSpawnErrorStore();

/**
 * Map a wire reason code to human-readable banner copy. Unknown codes
 * fall through to a generic line so a new backend reason still surfaces
 * something legible rather than a raw token.
 */
export function spawnErrorMessage(reason: string): string {
  switch (reason) {
    case "does_not_exist":
      return "The project directory no longer exists.";
    case "not_a_directory":
      return "That path is not a directory.";
    case "permission_denied":
      return "Permission denied for the project directory.";
    case "missing_project_dir":
      return "No project directory was provided.";
    case "metadata_error":
      return "The project directory could not be read.";
    case "concurrent_session_cap_exceeded":
    case "spawn_rate_limited":
      return "Too many sessions are starting at once. Try again in a moment.";
    default:
      return "The session could not be started.";
  }
}

/**
 * Subscribe a component to the spawn-error for `cardId`. Returns the
 * current {@link SpawnError} or `null`.
 */
export function useSpawnError(cardId: string): SpawnError | null {
  const subscribe = useCallback(
    (listener: () => void) => tideSpawnErrorStore.subscribe(cardId, listener),
    [cardId],
  );
  const getSnapshot = useCallback(
    () => tideSpawnErrorStore.get(cardId),
    [cardId],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
