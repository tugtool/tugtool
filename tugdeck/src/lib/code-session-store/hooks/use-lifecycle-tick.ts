/**
 * `useLifecycleTick` — a 1Hz heartbeat that runs ONLY while a turn is
 * in flight. Returns a `tickAt: number` value that consumers fold
 * through the telemetry `liveTurn*` helpers to drive ticking textual
 * readouts (assistant response time, etc.) without polling the
 * reducer or animating with rAF.
 *
 * Why `setInterval` and not `requestAnimationFrame`: textual readouts
 * refresh at human-perceptible intervals (~1Hz). rAF would tick at
 * 60Hz and waste budget on identical text, violating the spirit of
 * [L13] (rAF is for animation, not for clocks). `setInterval` is the
 * right primitive here.
 *
 * Lifecycle: the interval is registered only while `phase` is
 * non-terminal (anything other than `idle` / `errored`). The hook
 * returns a stable `tickAt = 0` when no turn is in flight — consumers
 * read `tickAt` only when they're already rendering live readouts, so
 * the zero value is benign. When the phase transitions back to a
 * terminal value, the interval clears: zero idle CPU cost.
 *
 * Conformance:
 *   - [L02]: `phase` enters React via the existing
 *     `useSyncExternalStore` on the snapshot — this hook does not
 *     subscribe to external state directly; the caller passes `phase`.
 *   - [L13]: `setInterval`, not rAF — textual clock, not animation.
 *   - Pure-logic time math lives in `telemetry.ts`; this hook owns
 *     only the timer.
 *
 * @module lib/code-session-store/hooks/use-lifecycle-tick
 */

import { useEffect, useState } from "react";

import type { CodeSessionPhase } from "../types";

const DEFAULT_INTERVAL_MS = 1000;

/**
 * A `CodeSessionPhase` is "non-terminal" while a turn is in flight.
 * The interval ticks only across these phases. Exported for direct
 * pure-logic testing — the hook's React lifecycle is left to
 * higher-level (app-test) coverage per the project's no-fake-DOM rule.
 */
export function isLivePhase(phase: CodeSessionPhase): boolean {
  return phase !== "idle" && phase !== "errored";
}

/**
 * 1Hz (by default) tick value that updates only while `phase` is
 * non-terminal. Returns `0` while no turn is in flight, so a
 * consumer that calls `liveTurnActiveMs(state, tickAt)` outside an
 * in-flight turn sees the static (post-commit) data path naturally
 * via the helper's `pendingUserMessage === null` short-circuit.
 *
 * `alsoWhile` extends the live window past the turn lifecycle: a
 * caller whose readout must keep ticking between turns (the TIME
 * cell while a background agent launched by the last turn is still
 * running) passes `true` and the heartbeat stays alive even in a
 * terminal phase. Default `false` preserves the turn-bounded
 * behavior.
 *
 * `intervalMs` is configurable for tests; production callers should
 * leave it at the default 1000ms.
 */
export function useLifecycleTick(
  phase: CodeSessionPhase,
  intervalMs: number = DEFAULT_INTERVAL_MS,
  alsoWhile: boolean = false,
): number {
  const live = isLivePhase(phase) || alsoWhile;
  const [tickAt, setTickAt] = useState<number>(() => (live ? Date.now() : 0));

  useEffect(() => {
    if (!live) {
      // Don't read time in the dormant branch — the caller doesn't
      // need a fresh value, and reading would force a render every
      // time the phase flips back to idle.
      setTickAt(0);
      return undefined;
    }
    // Seed an immediate tick so a freshly-entered live phase shows a
    // current readout without waiting `intervalMs` for the first
    // animation frame.
    setTickAt(Date.now());
    const id = setInterval(() => {
      setTickAt(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [live, intervalMs]);

  return tickAt;
}
