/**
 * token-telemetry-diagnostic.ts — DEV-only instrumentation for the
 * per-turn token-math investigation.
 *
 * The Z1B asst-half token count and the Z2 `Context` rollup were
 * observed to disagree, and a first-turn "hello" reported an
 * impossible count. The cause is unconfirmed token semantics —
 * whether `cost_update.usage` is per-turn or cumulative, and how a
 * turn's context contribution decomposes across input / output /
 * cache / tool-result tokens. Rather than theorize, this module logs
 * the raw wire frames and the reducer's derived numbers to the
 * dev-panel log so the correct math can be read off real sessions.
 *
 * Logged under dev-log source `token-telemetry`:
 *   - every raw `cost_update` frame — `usage` verbatim;
 *   - every raw `context_breakdown` frame — per-category totals;
 *   - per committed turn — the `costAtSubmit` / `lastCost` raw usage
 *     snapshots side by side with the reducer's computed `TurnCost`
 *     and the current context rollup.
 *
 * Investigation scaffolding — to be removed once the token contract
 * is settled. No-op outside `import.meta.env.DEV`.
 *
 * @module lib/code-session-store/token-telemetry-diagnostic
 */

import { tugDevLogStore } from "../tug-dev-log-store/tug-dev-log-store";
import { isAppendTranscript, type Effect } from "./effects";
import type { CodeSessionEvent } from "./events";
import type { CodeSessionState } from "./reducer";
import type { ContextBreakdownSnapshot } from "./types";

/** Dev-log source tag — filter the dev panel by this to isolate the trace. */
const SOURCE = "token-telemetry";

/** Sum the per-category token counts of a context-breakdown snapshot. */
function sumContextBreakdown(snap: ContextBreakdownSnapshot | null): number {
  if (snap === null) return 0;
  let total = 0;
  for (const c of snap.categories) total += c.tokens;
  return total;
}

/**
 * Log the token-relevant slice of one reducer dispatch. Called from
 * `CodeSessionStore.dispatch` after the reduce; reads only — never
 * mutates state. No-op in production builds.
 */
export function logTokenTelemetry(
  event: CodeSessionEvent,
  prev: CodeSessionState,
  next: CodeSessionState,
  effects: ReadonlyArray<Effect>,
): void {
  if (import.meta.env?.DEV !== true) return;

  if (event.type === "cost_update") {
    tugDevLogStore.debug(SOURCE, "raw cost_update frame", {
      total_cost_usd: event.total_cost_usd,
      num_turns: event.num_turns,
      usage: event.usage,
    });
    return;
  }

  if (event.type === "context_breakdown") {
    const byId: Record<string, number> = {};
    let total = 0;
    const cats = Array.isArray(event.categories) ? event.categories : [];
    for (const c of cats) {
      if (c === null || typeof c !== "object") continue;
      const id = (c as { id?: unknown }).id;
      const tokens = (c as { tokens?: unknown }).tokens;
      if (typeof id === "string" && typeof tokens === "number") {
        byId[id] = tokens;
        total += tokens;
      }
    }
    tugDevLogStore.debug(SOURCE, "raw context_breakdown frame", {
      context_max: event.context_max,
      categoriesTotal: total,
      categories: byId,
    });
    return;
  }

  if (event.type === "turn_complete") {
    // Only log a turn that actually committed — an aborted-cycle
    // `turn_complete` produces no append-transcript effect.
    const committed = effects.find(isAppendTranscript);
    if (committed === undefined) return;
    const entry = committed.entry;
    tugDevLogStore.info(
      SOURCE,
      `turn committed — token math [${entry.turnKey}]`,
      {
        // The two raw `cost_update.usage` snapshots the reducer's
        // `extractTurnCost` differences: `costAtSubmit` (before this
        // turn) and `lastCost` (after it).
        raw_costAtSubmit_usage: prev.costAtSubmit?.usage ?? null,
        raw_lastCost_usage: prev.lastCost?.usage ?? null,
        // What `extractTurnCost` produced and froze onto the entry —
        // the number Z1B currently renders.
        computed_TurnCost: entry.cost,
        // Cumulative context rollup at this point — what the Z2
        // `Context` cell + popover show.
        contextRollup: sumContextBreakdown(next.lastContextBreakdown),
      },
    );
  }
}
