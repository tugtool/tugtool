/**
 * session-load-control-bar-state — the pure state behind the permanent Z0
 * strip in the dev transcript ([recency P09]).
 *
 * The strip is a **permanent fixture** at the top of the transcript — it
 * never mounts/unmounts, so the transcript never hops when it would once
 * have appeared or disappeared. It carries one of two contents:
 *
 *   - **loading** — a cold restore or a load-previous is in flight (plus a
 *     brief dwell tail after the last progress tick), shown as a
 *     determinate progress bar over a modal (inert + scrimmed) region.
 *   - **metadata** — the steady state: "Session created <datetime>" on the
 *     left, "Turns displayed X of Y" + a "Load N more" / "All loaded"
 *     status on the right.
 *
 * {@link deriveControlBarState} is the trivial mode selector (loading wins
 * over metadata). {@link deriveLoadStatus} is the pure turns math for the
 * metadata row's right side. Neither holds React/DOM.
 *
 * @module components/tugways/cards/session-load-control-bar-state
 */

/** Which load is in flight (drives progress source). */
export type ControlBarLoadKind = "restore" | "previous";

/** The strip's resolved content mode. The strip is always visible, so
 *  there is no "hidden" — the metadata row is the resting content. */
export type ControlBarState = { kind: "metadata" } | { kind: "loading" };

export interface ControlBarInputs {
  /** Progress is displayed: a load is in flight, or the host is within the
   *  dwell tail that holds the bar a beat past the final progress tick. */
  loadingDisplay: boolean;
}

/**
 * Resolve the strip's content mode. Loading (a restore / load-previous, or
 * its dwell tail) takes the strip; otherwise it shows the metadata row.
 */
export function deriveControlBarState(input: ControlBarInputs): ControlBarState {
  return input.loadingDisplay ? { kind: "loading" } : { kind: "metadata" };
}

/** The metadata row's right-side status, derived from the loaded window. */
export interface LoadStatus {
  /** X — turns currently displayed (the loaded slice). */
  displayed: number;
  /** Y — the whole session's committed turn count. */
  total: number;
  /** Whether older turns remain to page in. */
  hasOlder: boolean;
  /** The fixed-step "Load N more" count, clamped to what remains (`0`
   *  when nothing remains). */
  loadStep: number;
}

/**
 * Pure turns math for the metadata row. `firstLoadedTurnIndex` /
 * `totalTurns` are `null` on a full (non-windowed) replay — there, the
 * whole session is loaded, so displayed == total and nothing is older.
 * `step` is the fixed page size (clamped to the older count).
 */
export function deriveLoadStatus(input: {
  transcriptLength: number;
  firstLoadedTurnIndex: number | null;
  totalTurns: number | null;
  step: number;
}): LoadStatus {
  const displayed = input.transcriptLength;
  const total = input.totalTurns ?? displayed;
  const earlier = input.firstLoadedTurnIndex ?? 0;
  const hasOlder = earlier > 0;
  return {
    displayed,
    total,
    hasOlder,
    loadStep: Math.max(0, Math.min(input.step, earlier)),
  };
}
