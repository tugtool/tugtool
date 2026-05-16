/**
 * Pure reducer for `TugDevLogStore`. No side effects, no DOM, no
 * tugbank — the class wrapper drives persistence on top of this
 * reducer and (separately) microtask-batches incoming appends.
 *
 * Reference stability: when an event produces no observable state
 * change, the reducer returns the SAME state reference so
 * `useSyncExternalStore` consumers don't observe spurious notifications.
 *
 * @module lib/tug-dev-log-store/reducer
 */

import {
  ALL_TUG_DEV_LOG_LEVELS,
  DEFAULT_DEV_LOG_MAX_ENTRIES,
  DEFAULT_DEV_LOG_NEWEST_FIRST,
  MIN_DEV_LOG_MAX_ENTRIES,
  createDefaultFilters,
  type TugDevLogEntry,
  type TugDevLogFilters,
  type TugDevLogLevel,
  type TugDevLogSnapshot,
} from "./types";

/**
 * Reducer-internal state. Kept distinct from the public snapshot so
 * future internal fields (e.g. a per-entry seen-id index) can be
 * added without leaking through `getSnapshot`.
 */
export interface TugDevLogState {
  entries: readonly TugDevLogEntry[];
  filters: TugDevLogFilters;
  maxEntries: number;
  newestFirst: boolean;
  version: number;
}

export type TugDevLogEvent =
  | { type: "append_batch"; entries: readonly TugDevLogEntry[] }
  | { type: "clear" }
  | {
      /**
       * Partial-merge filter update. Unspecified keys keep the prior
       * value (so a level-only update doesn't drop source/text and a
       * text-only update doesn't drop level/source).
       */
      type: "set_filters";
      levels?: ReadonlySet<TugDevLogLevel>;
      source?: string | null;
      text?: string;
    }
  | { type: "set_max_entries"; maxEntries: number }
  | { type: "set_newest_first"; newestFirst: boolean }
  | {
      /**
       * Apply hydrated values from tugbank. Each field is optional —
       * a missing key keeps the existing in-state value. Invalid
       * values are silently rejected and the existing value is kept.
       *
       * Free-text is intentionally absent: it is in-memory only.
       */
      type: "hydrate";
      levels?: ReadonlySet<TugDevLogLevel>;
      source?: string | null;
      maxEntries?: number;
      newestFirst?: boolean;
    };

export function createInitialState(): TugDevLogState {
  return {
    entries: [],
    filters: createDefaultFilters(),
    maxEntries: DEFAULT_DEV_LOG_MAX_ENTRIES,
    newestFirst: DEFAULT_DEV_LOG_NEWEST_FIRST,
    version: 0,
  };
}

/**
 * Trim the buffer to `maxEntries` (FIFO, oldest off the front).
 * Returns the same array reference when no trimming is needed so
 * callers can compare references.
 */
function applyCap(
  entries: readonly TugDevLogEntry[],
  maxEntries: number,
): readonly TugDevLogEntry[] {
  if (entries.length <= maxEntries) return entries;
  // Avoid `Array.prototype.slice` round-trip allocations when the
  // overflow is small relative to the buffer.
  return entries.slice(entries.length - maxEntries);
}

function clampMaxEntries(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DEV_LOG_MAX_ENTRIES;
  const i = Math.floor(n);
  return i < MIN_DEV_LOG_MAX_ENTRIES ? MIN_DEV_LOG_MAX_ENTRIES : i;
}

function levelsEqual(
  a: ReadonlySet<TugDevLogLevel>,
  b: ReadonlySet<TugDevLogLevel>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

/**
 * Pure reducer. Returns the same state reference when the event
 * produces no observable change.
 */
export function reduce(
  state: TugDevLogState,
  event: TugDevLogEvent,
): TugDevLogState {
  switch (event.type) {
    case "append_batch": {
      if (event.entries.length === 0) return state;
      const combined = state.entries.concat(event.entries);
      const capped = applyCap(combined, state.maxEntries);
      return {
        ...state,
        entries: capped,
        version: state.version + 1,
      };
    }

    case "clear": {
      if (state.entries.length === 0) return state;
      return {
        ...state,
        entries: [],
        version: state.version + 1,
      };
    }

    case "set_filters": {
      const prev = state.filters;
      let next = prev;
      if (event.levels !== undefined && !levelsEqual(prev.levels, event.levels)) {
        next = next === prev ? { ...prev } : next;
        next.levels = event.levels;
      }
      if (event.source !== undefined && event.source !== prev.source) {
        next = next === prev ? { ...prev } : next;
        next.source = event.source;
      }
      if (event.text !== undefined && event.text !== prev.text) {
        next = next === prev ? { ...prev } : next;
        next.text = event.text;
      }
      if (next === prev) return state;
      return { ...state, filters: next, version: state.version + 1 };
    }

    case "set_max_entries": {
      const clamped = clampMaxEntries(event.maxEntries);
      if (clamped === state.maxEntries) {
        // Cap unchanged; check if the existing buffer already fits.
        return state;
      }
      const capped = applyCap(state.entries, clamped);
      return {
        ...state,
        entries: capped,
        maxEntries: clamped,
        version: state.version + 1,
      };
    }

    case "set_newest_first": {
      if (state.newestFirst === event.newestFirst) return state;
      return {
        ...state,
        newestFirst: event.newestFirst,
        version: state.version + 1,
      };
    }

    case "hydrate": {
      let next = state;
      if (
        event.levels !== undefined &&
        !levelsEqual(state.filters.levels, event.levels)
      ) {
        next = next === state ? { ...state, filters: { ...state.filters } } : next;
        next.filters = { ...next.filters, levels: event.levels };
      }
      if (
        event.source !== undefined &&
        event.source !== state.filters.source
      ) {
        next = next === state ? { ...state, filters: { ...state.filters } } : next;
        next.filters = { ...next.filters, source: event.source };
      }
      if (event.maxEntries !== undefined) {
        const clamped = clampMaxEntries(event.maxEntries);
        if (clamped !== state.maxEntries) {
          next = next === state ? { ...state } : next;
          next.maxEntries = clamped;
          next.entries = applyCap(next.entries, clamped);
        }
      }
      if (
        event.newestFirst !== undefined &&
        event.newestFirst !== state.newestFirst
      ) {
        next = next === state ? { ...state } : next;
        next.newestFirst = event.newestFirst;
      }
      if (next === state) return state;
      return { ...next, version: state.version + 1 };
    }

    default:
      return state;
  }
}

/**
 * Project the reducer state into the public snapshot. Returns the
 * same reference when the input reference is unchanged so
 * `useSyncExternalStore` consumers stay quiescent.
 */
export function toSnapshot(state: TugDevLogState): TugDevLogSnapshot {
  return state;
}

// Re-exported for callers that want to validate levels without
// reaching into types.ts directly.
export { ALL_TUG_DEV_LOG_LEVELS, DEFAULT_DEV_LOG_MAX_ENTRIES };
