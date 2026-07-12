/**
 * dev-find-session — the per-prompt-entry store behind the Dev card's Find
 * route.
 *
 * `DevFindSession` holds everything the Find UI reads: the query, the option
 * toggles, the ordered match set, the active index, and a transient `wrapped`
 * flag recording whether the last navigation crossed an end. It is an external
 * store surfaced through `useSyncExternalStore` ([L02]) — `subscribe` /
 * `getSnapshot` are stable, pre-bound references and the snapshot object is
 * replaced on every mutation, so it is `Object.is`-stable between changes.
 *
 * The match set is computed elsewhere (the transcript index runs
 * `transcript-search.search` and hands the result to {@link setMatches}); the
 * session owns the *state*, not the search. This keeps the store pure — no
 * React, no DOM, no transcript coupling — so navigation and wrap semantics are
 * unit-testable on their own.
 *
 * @module lib/dev-find-session
 */

import type { FindMatch, FindOptions } from "./transcript-search";

/** Immutable snapshot handed to `useSyncExternalStore` consumers. */
export interface FindState {
  /** The live query text (mirrored from the prompt editor while in Find). */
  query: string;
  /** The active option toggles. */
  options: FindOptions;
  /** The ordered, non-overlapping match set. */
  matches: readonly FindMatch[];
  /** Index of the active match in `matches`, or `-1` when there are none. */
  activeIndex: number;
  /** Whether the most recent `next`/`previous` wrapped past an end. */
  wrapped: boolean;
  /**
   * Direction of the most recent wrap: `1` when Next crossed the end
   * (bottom → top), `-1` when Previous crossed the start (top → bottom), `0`
   * when the last navigation did not wrap. The wrap indicator reads this to
   * choose its rotate-cw / rotate-ccw glyph.
   */
  wrapDirection: 1 | -1 | 0;
  /**
   * Monotonic wrap counter — incremented on every navigation that wraps,
   * never reset. The wrap indicator fires on each increment, so it triggers
   * even for CONSECUTIVE wraps (e.g. bouncing between the first and last of two
   * matches, where every step wraps) — which a `wrapped` boolean rising edge
   * would miss because the flag never falls back to `false` between them.
   */
  wrapSeq: number;
}

/** The default option set for a fresh session (all toggles off). */
export const DEFAULT_FIND_OPTIONS: FindOptions = {
  caseSensitive: false,
  wholeWord: false,
  grep: false,
};

export class DevFindSession {
  private state: FindState;
  private readonly listeners = new Set<() => void>();

  constructor(initialOptions: FindOptions = DEFAULT_FIND_OPTIONS) {
    this.state = {
      query: "",
      options: initialOptions,
      matches: [],
      activeIndex: -1,
      wrapped: false,
      wrapDirection: 0,
      wrapSeq: 0,
    };
  }

  // ── Store surface ([L02]) ──────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FindState => this.state;

  // ── Mutation ───────────────────────────────────────────────────────────

  /** Update the query text. Clears the transient `wrapped` flag. */
  setQuery(query: string): void {
    if (query === this.state.query) return;
    this.state = { ...this.state, query, wrapped: false, wrapDirection: 0 };
    this.emit();
  }

  /** Update the option toggles. Clears the transient `wrapped` flag. */
  setOptions(options: FindOptions): void {
    this.state = { ...this.state, options, wrapped: false, wrapDirection: 0 };
    this.emit();
  }

  /**
   * Replace the match set (recomputed externally from the transcript index).
   * The active match is preserved by (row, start) identity when it still
   * exists in the new set — so a windowing re-run or an unrelated edit doesn't
   * jump the user off their match — otherwise the active index clamps to the
   * first match (or `-1` when empty).
   */
  setMatches(matches: readonly FindMatch[]): void {
    let activeIndex: number;
    if (matches.length === 0) {
      activeIndex = -1;
    } else {
      const prev = this.state.matches[this.state.activeIndex];
      const preserved =
        prev !== undefined
          ? matches.findIndex((m) => m.row === prev.row && m.start === prev.start)
          : -1;
      activeIndex = preserved >= 0 ? preserved : 0;
    }
    this.state = {
      ...this.state,
      matches,
      activeIndex,
      wrapped: false,
      wrapDirection: 0,
    };
    this.emit();
  }

  /** Advance the active match forward, wrapping past the last to the first. */
  next(): void {
    this.step(1);
  }

  /** Advance the active match backward, wrapping past the first to the last. */
  previous(): void {
    this.step(-1);
  }

  /** Clear query + matches (e.g. on leaving the Find route). */
  clear(): void {
    this.state = {
      ...this.state,
      query: "",
      matches: [],
      activeIndex: -1,
      wrapped: false,
      wrapDirection: 0,
    };
    this.emit();
  }

  private step(direction: 1 | -1): void {
    const n = this.state.matches.length;
    if (n === 0) return;
    const raw = this.state.activeIndex + direction;
    const wrapped = raw < 0 || raw >= n;
    const activeIndex = ((raw % n) + n) % n;
    this.state = {
      ...this.state,
      activeIndex,
      wrapped,
      wrapDirection: wrapped ? direction : 0,
      wrapSeq: wrapped ? this.state.wrapSeq + 1 : this.state.wrapSeq,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (err) {
        console.error("DevFindSession listener threw:", err);
      }
    }
  }
}
