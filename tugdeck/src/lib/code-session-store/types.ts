/**
 * Public types for `CodeSessionStore` — the per-Tide-card L02 store that
 * owns Claude Code turn state.
 *
 * [D03] three-identifier model
 * [D04] transcript + streaming
 * [D11] effect-list reducer
 */

/**
 * Discrete phases of the Claude Code turn state machine. Terminal
 * outcomes (`success` / `interrupted`) live on `TurnEntry.result`
 * rather than the phase — a completed turn always returns to `idle`
 * once its entry is committed, so there is no `complete` or
 * `interrupted` phase.
 */
export type CodeSessionPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
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
  userMessage: { text: string; attachments: ReadonlyArray<unknown> };
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
