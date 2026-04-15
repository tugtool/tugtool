/**
 * Public types for `CodeSessionStore` — the per-Tide-card L02 store that
 * owns Claude Code turn state. See Spec S02 in tugplan-code-session-store.md.
 *
 * [D03] three-identifier model
 * [D04] transcript + streaming
 * [D11] effect-list reducer
 */

/** Discrete phases of the Claude Code turn state machine. */
export type CodeSessionPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
  | "complete"
  | "interrupted"
  | "errored";

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
 */
export interface ControlRequestForward {
  request_id: string;
  is_question: boolean;
  tool_name?: string;
  input?: unknown;
  question?: string;
  options?: ReadonlyArray<unknown>;
  [key: string]: unknown;
}

/**
 * Public snapshot returned by `CodeSessionStore.getSnapshot()`. Stable
 * reference between dispatches that produce no change — callers can use
 * `useSyncExternalStore` without tearing ([D11]).
 */
export interface CodeSessionSnapshot {
  phase: CodeSessionPhase;

  tugSessionId: string;
  claudeSessionId: string | null;
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

  lastCostUsd: number | null;
  lastError: {
    cause: "session_state_errored" | "transport_closed";
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
