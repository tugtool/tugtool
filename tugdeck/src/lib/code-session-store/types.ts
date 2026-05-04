/**
 * Public types for `CodeSessionStore` — the per-Tide-card L02 store that
 * owns Claude Code turn state.
 *
 * [D03] three-identifier model
 * [D04] transcript + streaming
 * [D10] `inflightUserMessage` mirror — the snapshot exposes the
 *       reducer's `pendingUserMessage` as `inflightUserMessage` so the
 *       transcript's in-flight `user` row enters React via
 *       `useSyncExternalStore` without card-level shadow state ([L02]).
 * [D11] effect-list reducer
 */

import type { AtomSegment } from "../tug-atom-img";

/**
 * Discrete phases of the Claude Code turn state machine. Terminal
 * outcomes (`success` / `interrupted`) live on `TurnEntry.result`
 * rather than the phase — a completed turn always returns to `idle`
 * once its entry is committed, so there is no `complete` or
 * `interrupted` phase.
 *
 * `replaying` is the phase for the JSONL replay window bracketed by
 * `replay_started` / `replay_complete`. While `replaying`,
 * `canSubmit` and `canInterrupt` are both `false` and the live-frame
 * handlers drop their inputs (replay events flow through dedicated
 * handlers; the bracket guarantees ordering).
 */
export type CodeSessionPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
  | "replaying"
  | "errored";

/**
 * Health of the WebSocket transport, orthogonal to `phase`. The
 * reducer treats `transportState` as a separate axis ([D01]) so a
 * card that is idle but offline can still gate submit on the wire,
 * and so reconnect doesn't have to invent a "transport_lost" phase
 * that contaminates the turn-lifecycle vocabulary.
 *
 * - `online`     — wire is up; submit is allowed (subject to phase).
 * - `offline`    — wire is down. The user cannot submit.
 *                  Set on `transport_close` for every phase ([D06]).
 * - `restoring`  — wire is back up but the per-card binding has not
 *                  yet been re-acked by the supervisor. Set on
 *                  `transport_open`; cleared by `transport_settled`
 *                  once `cardSessionBindingStore` confirms the bind.
 */
export type TransportState = "online" | "offline" | "restoring";

/**
 * Per-tool-call state tracked inside the reducer's toolCallMap and committed
 * into `TurnEntry.toolCalls` in insertion order ([Q02]).
 */
export interface ToolCallState {
  toolUseId: string;
  toolName: string;
  input: unknown;
  status: "pending" | "done" | "error";
  result: unknown | null;
  structuredResult: unknown | null;
}

/**
 * Immutable transcript entry appended once per completed turn.
 * `result === "interrupted"` covers both user-initiated stop
 * (`turn_complete(error)`) and any preserved-text interrupt path.
 */
export interface TurnEntry {
  msgId: string;
  userMessage: {
    text: string;
    attachments: ReadonlyArray<unknown>;
    /**
     * Wall-clock millisecond timestamp captured when `send()` was
     * dispatched. Distinct from `endedAt` — the user-visible
     * "submitted at" time. The transcript's user row reads this for
     * its timestamp display while the turn's code row reads
     * `endedAt`, so the row identifier line can post the moment the
     * user hits submit instead of waiting for the assistant's reply.
     */
    submitAt: number;
  };
  thinking: string;
  assistant: string;
  toolCalls: ReadonlyArray<ToolCallState>;
  result: "success" | "interrupted";
  endedAt: number;
}

/**
 * Decoded `control_request_forward` event from CODE_OUTPUT. Surfaced on the
 * snapshot via `pendingApproval` or `pendingQuestion` while the store is in
 * `awaiting_approval`. The shape is intentionally loose — downstream UI
 * code interprets the fields per the stream-json contract.
 *
 * `decision_reason` and `permission_suggestions` are explicit optional
 * fields because T3.4.b's permission prompt will read them directly;
 * everything else still passes through via the indexed signature for
 * forward-compat.
 */
export interface ControlRequestForward {
  request_id: string;
  is_question: boolean;
  tool_name?: string;
  input?: unknown;
  question?: string;
  options?: ReadonlyArray<unknown>;
  decision_reason?: string;
  permission_suggestions?: ReadonlyArray<unknown>;
  [key: string]: unknown;
}

/**
 * Telemetry snapshot captured from `cost_update` frames. Everything past
 * `totalCostUsd` is nullable because the reducer only accepts numeric
 * payloads and real fixtures may omit individual fields. `usage` and
 * `modelUsage` stay `unknown` on purpose so renderers can reach into
 * the live wire shape without the store gatekeeping forward-compat
 * fields.
 */
export interface CostSnapshot {
  totalCostUsd: number;
  numTurns: number | null;
  durationMs: number | null;
  durationApiMs: number | null;
  usage: unknown | null;
  modelUsage: unknown | null;
}

/**
 * Public snapshot returned by `CodeSessionStore.getSnapshot()`. Stable
 * reference between dispatches that produce no change — callers can use
 * `useSyncExternalStore` without tearing ([D11]).
 */
export interface CodeSessionSnapshot {
  phase: CodeSessionPhase;
  transportState: TransportState;

  tugSessionId: string;
  displayLabel: string;

  activeMsgId: string | null;
  canSubmit: boolean;
  canInterrupt: boolean;
  pendingApproval: ControlRequestForward | null;
  pendingQuestion: ControlRequestForward | null;
  queuedSends: number;

  transcript: ReadonlyArray<TurnEntry>;

  /**
   * The in-flight user message — set the moment `send()` is dispatched
   * and cleared exactly when the matching `TurnEntry` is committed to
   * `transcript` (`turn_complete(success)`) or the turn is interrupted
   * (`turn_complete(error)` / `interrupted`). Mirrors the reducer's
   * `pendingUserMessage`; the field name change to `inflightUserMessage`
   * matches the `inflight.*` streaming-path naming so the in-flight
   * vocabulary is consistent at the snapshot surface.
   *
   * Drives the in-flight `user` row in the Tide card transcript: the
   * `TideTranscriptDataSource` (Step 10) reports `transcript.length * 2
   * + (inflightUserMessage ? 2 : 0)` items, with the last two indices
   * representing the in-flight pair when the field is non-null.
   *
   * The reference is shared with the reducer's `pendingUserMessage`,
   * so identity is stable across snapshot rebuilds while the same
   * pending message is in flight — `useSyncExternalStore` consumers
   * downstream get the `Object.is` stability they need ([D10]).
   */
  inflightUserMessage: {
    text: string;
    atoms: ReadonlyArray<AtomSegment>;
    /**
     * Wall-clock millisecond timestamp captured when `send()` was
     * dispatched. Drives the in-flight user row's timestamp display so
     * the row can post the submit time the moment the user submits,
     * without waiting for the matching `TurnEntry` to commit.
     */
    submitAt: number;
  } | null;

  streamingPaths: {
    readonly assistant: "inflight.assistant";
    readonly thinking: "inflight.thinking";
    readonly tools: "inflight.tools";
  };

  lastCost: CostSnapshot | null;
  lastError: {
    cause:
      | "session_state_errored"
      | "transport_closed"
      | "wire_error"
      | "session_unknown"
      | "session_not_owned"
      | "resume_failed";
    message: string;
    at: number;
  } | null;

  /**
   * Outcome of the most recent JSONL replay window. `null` until the
   * first `replay_complete` lands; populated on every
   * `replay_complete` thereafter — including the success path
   * (`kind: "success"`, empty `message`) so telemetry / dev-surface
   * readers can distinguish a clean replay from each error variant by
   * `kind` alone.
   *
   * The `TideRestoring` placeholder reads this for the timeout-state
   * copy (`kind === "replay_timeout"`); cleared back to `null` on the
   * next `replay_started` so the field always reflects the most
   * recent window's outcome rather than accumulating history.
   */
  lastReplayResult: LastReplayResult | null;

  /**
   * True from the moment a resume binding is acknowledged via
   * `CodeSessionStore.notifyResumeBindingLanded()` until the *first
   * of*: `phase` becomes `"replaying"`, `lastReplayResult` lands,
   * `transportState` changes away from `"online"`, or
   * `REPLAY_PREFLIGHT_TIMEOUT_MS` elapses. Drives the cold-boot
   * preflight banner copy that bridges the wait between binding
   * rehydrate and the first `replay_started` event.
   */
  replayPreflightActive: boolean;

  /**
   * True after `REPLAY_SOFT_BUDGET_MS` while `phase === "replaying"`
   * without leaving the phase. Reset when phase leaves replaying
   * (or on the next `replay_started`). Drives count-aware banner
   * copy per [D10] — the banner can promote from generic
   * "Loading conversation…" to "Loading conversation… (N turns)"
   * once the user has been waiting long enough that progress detail
   * is reassuring rather than noisy.
   */
  replaySoftBudgetElapsed: boolean;

  /**
   * True for `REPLAY_TIMEOUT_DWELL_MS` after `phase` transitions out
   * of `"replaying"` while `lastReplayResult.kind === "replay_timeout"`.
   * Drives the timeout-state banner copy. The dwell exists so the
   * timeout reason has a moment to register with the user before
   * the banner dismisses.
   */
  replayTimeoutDwellActive: boolean;
}

/**
 * Result of the most recent JSONL replay window. Each `kind` value
 * matches the wire-side `replay_complete.error.kind` enum exactly,
 * plus a `"success"` value that the wire never sets (it is inferred
 * client-side when `replay_complete` arrives without an `error`
 * payload).
 */
export interface LastReplayResult {
  kind:
    | "success"
    | "jsonl_missing"
    | "jsonl_unreadable"
    | "jsonl_malformed"
    | "replay_timeout";
  /** Human-readable detail; empty string on the success path. */
  message: string;
  /** Number of turns committed during this replay window. */
  count: number;
  /** `Date.now()` at the moment `replay_complete` landed. */
  at: number;
}

/**
 * Stable constant embedded in every snapshot's `streamingPaths` field.
 * Referenced by consumers that thread the path strings through props.
 */
export const STREAMING_PATHS = {
  assistant: "inflight.assistant",
  thinking: "inflight.thinking",
  tools: "inflight.tools",
} as const;
