/**
 * session-phase-visual.ts — Map a CodeSession's (phase, transport,
 * interrupt) triple onto the {@link TugProgressIndicator} `phase` /
 * `phaseLabels` / `phaseVisual` API.
 *
 * The session-phase model has three orthogonal axes — `phase`,
 * `transportState`, `interruptInFlight` — but a UI indicator only
 * needs one identifier per render. {@link sessionSessionPhaseKey}
 * flattens the triple into a stable string key; {@link
 * SESSION_PHASE_LABELS} maps every key to its human-readable
 * title (used for the indicator's visible label and tooltip); and
 * {@link sessionSessionPhaseVisual} maps every key to a partial
 * `{ role, state }` for the indicator's visual treatment.
 *
 * Transport health dominates phase: an offline wire reads as
 * `aborted/danger` regardless of the reducer's phase; a restoring
 * wire reads as `running/caution`. An in-flight interrupt promotes
 * the indicator to `running/caution` so the user sees that the stop
 * request has not been lost between request and ack. Otherwise the
 * phase enum drives the visual.
 *
 * Migrated from the legacy `TugStateIndicator` — the visual
 * vocabulary is preserved; the API shape is reshaped to the unified
 * indicator's phase axis.
 */

import type {
  TugProgressIndicatorPhaseVisual,
} from "@/components/tugways/tug-progress-indicator";
import type { CodeSessionPhase, TransportState } from "./types";

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/**
 * The three-axis CodeSession indicator state. Same shape as the
 * legacy `TugStateIndicatorState`; renamed here to avoid implying any
 * coupling to a particular indicator component.
 */
export interface SessionPhaseInput {
  readonly phase: CodeSessionPhase;
  readonly transportState: TransportState;
  readonly interruptInFlight: boolean;
}

// ---------------------------------------------------------------------------
// Phase key
// ---------------------------------------------------------------------------

export type SessionPhaseKey =
  | "offline"
  | "restoring"
  | "interrupting"
  | CodeSessionPhase;

/**
 * Flatten the (phase, transportState, interruptInFlight) triple into
 * a single stable string. Transport degradations and the interrupt
 * flag take precedence over the reducer's phase; otherwise the phase
 * enum is the key.
 */
export function sessionSessionPhaseKey(input: SessionPhaseInput): SessionPhaseKey {
  if (input.transportState === "offline") return "offline";
  if (input.transportState === "restoring") return "restoring";
  if (input.interruptInFlight) return "interrupting";
  return input.phase;
}

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------

/**
 * Phase key → visible label. Drives both the indicator's inline label
 * (when shown) and its tooltip body. The full map is also the
 * width-stabilize set for indicators that opt into
 * `labelAlign="center"`.
 *
 * `waking` shares "Streaming" with `streaming` — the wake path is
 * indistinguishable to the user from a normal stream; the distinction
 * is internal lifecycle bookkeeping.
 */
export const SESSION_PHASE_LABELS: Record<SessionPhaseKey, string> = {
  offline: "Disconnected",
  restoring: "Reconnecting",
  interrupting: "Interrupting",
  idle: "Idle",
  submitting: "Sending",
  awaiting_first_token: "Waiting",
  streaming: "Streaming",
  tool_work: "Working",
  awaiting_approval: "Awaiting",
  replaying: "Restoring",
  waking: "Streaming",
  errored: "Error",
};

// ---------------------------------------------------------------------------
// Visual mapping
// ---------------------------------------------------------------------------

/**
 * Map a phase key onto the indicator's `{ role, state }`. The
 * caller passes this as `phaseVisual` to TugProgressIndicator.
 * Mapping:
 *
 *  - `offline`, `errored`        → `{ role: danger,  state: aborted }`
 *  - `restoring`, `interrupting` → `{ role: caution, state: running }`
 *  - `awaiting_approval`         → `{ role: caution, state: paused }`
 *  - active stream phases        → `{ role: action,  state: running }`
 *  - `idle`                      → `{ role: inherit, state: stopped }`
 *
 * `action` (blue) is the canonical "work in flight" tone across the
 * design system. `success` is reserved for the "done" reading
 * (`state: completed`) — paired together they give a clear
 * blue-while-running → green-when-finished story.
 */
export function sessionSessionPhaseVisual(phaseKey: string): TugProgressIndicatorPhaseVisual {
  switch (phaseKey as SessionPhaseKey) {
    case "offline":
    case "errored":
      return { role: "danger", state: "aborted" };
    case "restoring":
    case "interrupting":
      return { role: "caution", state: "running" };
    case "awaiting_approval":
      // `paused`, not `running`: the session is blocked on the user and
      // nothing is executing, so the glyph holds a still, full-size,
      // caution-tinted pose rather than breathing indefinitely on behalf
      // of work that is not happening. See `indicator-liveness`.
      return { role: "caution", state: "paused" };
    case "submitting":
    case "awaiting_first_token":
    case "streaming":
    case "tool_work":
    case "replaying":
    case "waking":
      return { role: "action", state: "running" };
    case "idle":
    default:
      return { role: "inherit", state: "stopped" };
  }
}
