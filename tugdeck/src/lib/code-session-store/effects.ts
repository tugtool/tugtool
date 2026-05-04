/**
 * Effect discriminated union per.
 *
 * The reducer in `reducer.ts` is a pure `(state, event) => { state, effects }`
 * function; the class wrapper in `code-session-store.ts` processes the
 * returned `effects[]` in order after each dispatch. Keeping effects
 * first-class makes every side effect grep-able and testable without a
 * live store.
 *
 * [D11] effect-list reducer
 */

import type { InboundMessage } from "@/protocol";
import type { CodeSessionEvent } from "./events";
import type { TurnEntry } from "./types";

/** Stable path keys for the in-flight streaming document (). */
export type InflightPath =
  | "inflight.assistant"
  | "inflight.thinking"
  | "inflight.tools";

export interface WriteInflightEffect {
  kind: "write-inflight";
  path: InflightPath;
  value: string;
}

export interface ClearInflightEffect {
  kind: "clear-inflight";
}

export interface SendFrameEffect {
  kind: "send-frame";
  msg: InboundMessage;
}

export interface AppendTranscriptEffect {
  kind: "append-transcript";
  entry: TurnEntry;
}

/**
 * Schedule a named timer that dispatches `fire` on expiry. The store's
 * dispatch loop tracks pending timers in a `Map<string, TimerHandle>`;
 * a second `schedule_timer` with the same `name` cancels the prior
 * timer first so re-entry produces no leaks. On expiry the timer
 * removes itself from the map and dispatches `fire` back into the
 * reducer. The reducer is pure — only the store wrapper sees real
 * `setTimeout` calls.
 *
 * The three names used today are `"preflight"` (cleared by the first
 * of `replay_started` / `replay_complete` / `transport_close` /
 * 12s tick), `"soft_budget"` (cleared by `replay_started` /
 * `replay_complete`), and `"timeout_dwell"` (cleared by the dwell
 * tick itself or by `replay_started` opening the next window).
 */
export interface ScheduleTimerEffect {
  kind: "schedule_timer";
  name: string;
  ms: number;
  fire: CodeSessionEvent;
}

/**
 * Cancel a named timer scheduled via `schedule_timer`. Idempotent: a
 * `cancel_timer` for an unknown name is a no-op.
 */
export interface CancelTimerEffect {
  kind: "cancel_timer";
  name: string;
}

export type Effect =
  | WriteInflightEffect
  | ClearInflightEffect
  | SendFrameEffect
  | AppendTranscriptEffect
  | ScheduleTimerEffect
  | CancelTimerEffect;

export function isWriteInflight(e: Effect): e is WriteInflightEffect {
  return e.kind === "write-inflight";
}

export function isClearInflight(e: Effect): e is ClearInflightEffect {
  return e.kind === "clear-inflight";
}

export function isSendFrame(e: Effect): e is SendFrameEffect {
  return e.kind === "send-frame";
}

export function isAppendTranscript(e: Effect): e is AppendTranscriptEffect {
  return e.kind === "append-transcript";
}

export function isScheduleTimer(e: Effect): e is ScheduleTimerEffect {
  return e.kind === "schedule_timer";
}

export function isCancelTimer(e: Effect): e is CancelTimerEffect {
  return e.kind === "cancel_timer";
}
