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

/** Logical channel a streaming write targets. The processor combines
 *  this with the turn's React-key (`turnKey`) to form the final
 *  PropertyStore path: `turn.${turnKey}.${channel}`. Per-turn paths
 *  mean a committed cell can keep observing its own path forever
 *  without being polluted by the next turn's writes — the foundation
 *  that lets the unified streaming-cell renderer stay mounted across
 *  the inflight → committed transition without scroll-jump
 *  regressions.
 */
export type StreamChannel = "assistant" | "thinking" | "tools";

export interface WriteInflightEffect {
  kind: "write-inflight";
  /** Turn-stable React-key seed; combines with `channel` into the
   *  per-turn PropertyStore path. */
  turnKey: string;
  channel: StreamChannel;
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

/**
 * Persist a per-turn telemetry block via the tugcast SessionLedger.
 * Emitted by `handleTurnComplete` on the LIVE path only — replayed
 * turns arrive with `event.telemetry` already inlined, and the
 * reducer doesn't re-persist them (the persisted row already exists,
 * which is how the inline made it onto the wire in the first place).
 *
 * The store wrapper looks up `tugSessionId` from its own state and
 * builds the `record_turn_telemetry` CONTROL frame via
 * `encodeRecordTurnTelemetry`. The effect carries the
 * tug_session_id-independent payload so the reducer stays pure.
 *
 * Fire-and-forget: no ack frame is awaited. The row's reason for
 * existing is to survive the next reload, not the next render — see
 * plan `#step-20-3-3` / `#step-20-3-4`.
 */
export interface RecordTelemetryEffect {
  kind: "record-telemetry";
  msgId: string;
  telemetry: import("./telemetry").TurnTelemetry;
  endedAt: number;
}

/**
 * Persist a `/context`-style breakdown frame via the tugcast
 * SessionLedger. Emitted by `handleContextBreakdown` on every frame
 * the reducer consumes — both live frames from tugcode and the
 * bind-time attach the supervisor re-emits from the persisted row
 * (the latter writes the same bytes back, which is idempotent).
 *
 * The store wrapper builds the `record_context_breakdown` CONTROL
 * frame via `encodeRecordContextBreakdown`, threading the store's
 * own `tugSessionId`. Fire-and-forget: no ack frame is awaited.
 *
 * `payload` carries the wire-frame shape the supervisor stores
 * verbatim. `capturedAt` is `Date.now()` at the moment the reducer
 * built the effect — used by the ledger row's `captured_at` column.
 */
export interface RecordContextBreakdownEffect {
  kind: "record-context-breakdown";
  payload: import("./types").ContextBreakdownSnapshot;
  capturedAt: number;
}

export type Effect =
  | WriteInflightEffect
  | ClearInflightEffect
  | SendFrameEffect
  | AppendTranscriptEffect
  | ScheduleTimerEffect
  | CancelTimerEffect
  | RecordTelemetryEffect
  | RecordContextBreakdownEffect;

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

export function isRecordTelemetry(e: Effect): e is RecordTelemetryEffect {
  return e.kind === "record-telemetry";
}

export function isRecordContextBreakdown(
  e: Effect,
): e is RecordContextBreakdownEffect {
  return e.kind === "record-context-breakdown";
}
