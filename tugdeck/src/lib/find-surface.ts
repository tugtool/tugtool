/**
 * `FindSurface` — the engine-agnostic contract behind the shared find UI.
 *
 * Two find engines exist by necessity: the Dev transcript counts matches
 * from a store→text index and paints mounted DOM (a virtualized custom list),
 * while document surfaces (the Text card, embedded file bodies) delegate to
 * CodeMirror's own search (CM6 virtualizes its DOM). Both drive the same UI
 * vocabulary — the Case/Word/Grep cluster and the width-stabilized "N of M"
 * chip — through this interface, so the next find surface is an
 * implementation, not a rebuild.
 *
 * The shape is [L02]-compatible: `subscribe`/`getSnapshot` plug straight into
 * `useSyncExternalStore`, and implementations must return an
 * `Object.is`-stable snapshot between changes.
 *
 * @module lib/find-surface
 */

import type { FindOptions } from "@/lib/transcript-search";
import type { DevFindSession } from "@/lib/dev-find-session";

/** What the shared cluster renders — one immutable snapshot per change. */
export interface FindSurfaceSnapshot {
  /** The active option toggles. */
  options: FindOptions;
  /** Total matches for the live query (possibly capped — see `capped`). */
  count: number;
  /** 0-based ordinal of the active match, or `null` when none is active. */
  activeOrdinal: number | null;
  /**
   * True when `count` hit the engine's enumeration cap — the chip renders
   * `N+` so a capped total never reads as exact.
   */
  capped: boolean;
  /** True when a non-empty query is live (drives the "No results" face). */
  hasQuery: boolean;
}

/** The engine-agnostic surface the shared find UI drives. */
export interface FindSurface {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FindSurfaceSnapshot;
  /** Apply new option toggles (the engine re-runs its search). */
  setOptions(next: FindOptions): void;
}

/**
 * Adapt a {@link DevFindSession} to the {@link FindSurface} contract.
 * `onSetOptions` is the write path (typically `session.setOptions` plus the
 * tugbank persist). The returned surface caches its snapshot per underlying
 * session state, preserving `Object.is` stability for
 * `useSyncExternalStore`.
 */
export function devFindSurface(
  session: DevFindSession,
  onSetOptions: (next: FindOptions) => void,
): FindSurface {
  let lastState: ReturnType<DevFindSession["getSnapshot"]> | null = null;
  let lastSnapshot: FindSurfaceSnapshot | null = null;
  return {
    subscribe: session.subscribe,
    getSnapshot: (): FindSurfaceSnapshot => {
      const state = session.getSnapshot();
      if (lastSnapshot !== null && state === lastState) return lastSnapshot;
      lastState = state;
      lastSnapshot = {
        options: state.options,
        count: state.matches.length,
        activeOrdinal: state.activeIndex >= 0 ? state.activeIndex : null,
        capped: false,
        hasQuery: state.query.length > 0,
      };
      return lastSnapshot;
    },
    setOptions: onSetOptions,
  };
}
