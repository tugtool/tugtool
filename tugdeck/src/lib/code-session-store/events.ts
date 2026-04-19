/**
 * Decoded event union consumed by the `CodeSessionStore` reducer.
 *
 * Step 3 populates the core stream-json types driving the basic turn
 * round-trip plus the internal `send` action; later steps add
 * `thinking_text` (Step 4), tool events (Step 5),
 * `control_request_forward` / `cost_update` / respond actions (Step 6),
 * `interrupt` (Step 7), and `session_state_errored` / `transport_close`
 * (Step 8). The Step 1 `__noop__` placeholder is gone — every event now
 * carries a real type.
 */

import type { AtomSegment } from "../tug-atom-img";
import type { ControlRequestForward } from "./types";

/** Internal `send` action injected by `CodeSessionStore.send`. */
export interface SendActionEvent {
  type: "send";
  text: string;
  atoms: AtomSegment[];
}

/** `session_init` frame — carries Claude's `session_id` (for `--resume`). */
export interface SessionInitEvent {
  type: "session_init";
  session_id?: string;
  tug_session_id?: string;
  [key: string]: unknown;
}

/** Decoded assistant_text partial or terminal frame. */
export interface AssistantTextEvent {
  type: "assistant_text";
  msg_id: string;
  text: string;
  is_partial: boolean;
  rev?: number;
  seq?: number;
  tug_session_id?: string;
  [key: string]: unknown;
}

/** Decoded thinking_text partial or terminal frame. */
export interface ThinkingTextEvent {
  type: "thinking_text";
  msg_id: string;
  text: string;
  is_partial: boolean;
  rev?: number;
  seq?: number;
  tug_session_id?: string;
  [key: string]: unknown;
}

/**
 * `tool_use` — Claude opens or updates a tool call. The first event
 * for a logical call arrives with `input: {}`; a second `tool_use` with
 * the same `tool_use_id` carries the filled-in input.
 */
export interface ToolUseEvent {
  type: "tool_use";
  msg_id?: string;
  tool_use_id: string;
  tool_name: string;
  input: unknown;
  seq?: number;
  tug_session_id?: string;
  [key: string]: unknown;
}

/**
 * `tool_result` — terminates a logical call. `is_error: true` routes
 * the entry to `status: "error"`; otherwise `status: "done"`. The
 * transition `tool_work → streaming` fires only when every entry in
 * `toolCallMap` is terminal.
 */
export interface ToolResultEvent {
  type: "tool_result";
  tool_use_id: string;
  output?: unknown;
  is_error?: boolean;
  tug_session_id?: string;
  [key: string]: unknown;
}

/**
 * `tool_use_structured` — structured result for a prior `tool_result`.
 * Populates `structuredResult` on the matching map entry without
 * changing its terminal status.
 */
export interface ToolUseStructuredEvent {
  type: "tool_use_structured";
  tool_use_id: string;
  tool_name?: string;
  structured_result?: unknown;
  tug_session_id?: string;
  [key: string]: unknown;
}

/** `turn_complete` — closes the active turn with success or error. */
export interface TurnCompleteEvent {
  type: "turn_complete";
  msg_id: string;
  result: "success" | "error";
  tug_session_id?: string;
  [key: string]: unknown;
}

/**
 * `system_metadata` — per [D09], `SessionMetadataStore` owns this feed.
 * The reducer sees the event only to explicitly drop it (so its
 * presence on CODE_OUTPUT stays grep-friendly).
 */
export interface SystemMetadataEvent {
  type: "system_metadata";
  [key: string]: unknown;
}

/**
 * `control_request_forward` — Claude forwards a permission prompt
 * (`is_question: false`) or an `AskUserQuestion` prompt (`is_question:
 * true`). The reducer stashes the previous phase and transitions to
 * `awaiting_approval`; `respondApproval` / `respondQuestion` restore it.
 * The extra fields beyond `type` are preserved on `pendingApproval` /
 * `pendingQuestion` so UI code can read `tool_name`, `options`, etc.
 */
export type ControlRequestForwardEvent = {
  type: "control_request_forward";
} & ControlRequestForward;

/**
 * Internal action injected by `CodeSessionStore.respondApproval`. Not
 * a wire event — never decoded from a frame.
 */
export interface RespondApprovalActionEvent {
  type: "respond_approval";
  request_id: string;
  decision: "allow" | "deny";
  updatedInput?: unknown;
  message?: string;
}

/**
 * Internal action injected by `CodeSessionStore.respondQuestion`. Not
 * a wire event — never decoded from a frame.
 */
export interface RespondQuestionActionEvent {
  type: "respond_question";
  request_id: string;
  answers: Record<string, unknown>;
}

/**
 * Internal action injected by `CodeSessionStore.interrupt`. Not a wire
 * event — never decoded from a frame. The reducer emits an `interrupt`
 * SendFrame effect and clears `queuedSends` per [D05].
 */
export interface InterruptActionEvent {
  type: "interrupt_action";
}

/**
 * `cost_update` — telemetry frame carrying cumulative dollar cost and
 * per-turn/session accounting. Surfaced through the snapshot's
 * `lastCost` field with no phase transition; `cost_update` can land in
 * any phase. Live fixtures also emit `usage` and `modelUsage` trees
 * with token breakdowns — the reducer passes those through as
 * `unknown` for renderers that want them.
 */
export interface CostUpdateEvent {
  type: "cost_update";
  total_cost_usd: number;
  num_turns?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  usage?: unknown;
  modelUsage?: unknown;
  tug_session_id?: string;
  [key: string]: unknown;
}

/**
 * `error` — a wire-level error frame distinct from SESSION_STATE
 * errored and from transport close. Listed in the outbound event table
 * (roadmap/tide.md) but never captured in v2.1.105 fixtures, so tests
 * exercise it via synthetic dispatch. Routes to the `errored` phase
 * with cause `wire_error`.
 */
export interface WireErrorEvent {
  type: "error";
  message?: string;
  recoverable?: boolean;
  tug_session_id?: string;
  [key: string]: unknown;
}

/**
 * Internal event mapped from a `SESSION_STATE { state: "errored" }`
 * frame. The store's `frameToEvent` extracts the `detail` field from
 * the wire payload; the reducer rolls it into `state.lastError.message`.
 * Only the `"errored"` state maps to an event — all other states
 * (`pending`, `spawning`, `closed`, …) are dropped in `frameToEvent`.
 */
export interface SessionStateErroredEvent {
  type: "session_state_errored";
  detail?: string;
}

/**
 * Internal event injected when `TugConnection.onClose` fires. Not a
 * wire event — the store subscribes to the connection's close callback
 * at construction and dispatches this action per [Spec S04].
 */
export interface TransportCloseEvent {
  type: "transport_close";
}

/**
 * Internal event mapped from a CONTROL frame of shape
 * `{ type: "error", detail: "session_unknown", tug_session_id }`.
 * Supervisor emits this when a CODE_INPUT arrives for a session it
 * doesn't know about (orphan dispatcher) — the classic "stale
 * session_id after server reconnect" failure mode. The frame carries
 * `tug_session_id`, so the per-card filter routes it cleanly via the
 * normal session-match path.
 */
export interface SessionUnknownEvent {
  type: "session_unknown";
  detail?: string;
}

/**
 * Internal event mapped from a CONTROL frame of shape
 * `{ type: "error", detail: "session_not_owned" }`. Router's P5 authz
 * check emits this when a client sends CODE_INPUT for a session that
 * another client owns — or, more commonly, a session this client
 * never registered via `spawn_session`. The wire frame currently
 * carries NO `tug_session_id` field (see `router.rs`: the rejection
 * handler sends just `{type, detail}`), so the per-card filter
 * relaxes for CONTROL error frames and the reducer uses a phase gate
 * — only stores in a waiting-for-response phase accept the routing —
 * to self-route in the multi-card single-client case.
 */
export interface SessionNotOwnedEvent {
  type: "session_not_owned";
  detail?: string;
}

/**
 * Emitted by tugcode when a `--session-mode resume` spawn fails and falls
 * back to a fresh spawn. Forwarded by tugcast on the CODE_OUTPUT feed as
 * a normal stream-json message; `CodeSessionStore`'s `acceptFrame` maps
 * it to this event and the reducer rolls it into `lastError` with cause
 * `"resume_failed"`. Roadmap step 4.5.
 *
 * The store does *not* change phase on this event — the fallback already
 * produced a usable fresh session, so the card is in the idle "ready to
 * submit" state. `lastError` surfaces the notice; the next successful
 * turn clears it per the existing reducer convention.
 */
export interface ResumeFailedEvent {
  type: "resume_failed";
  /** Machine-readable category (e.g. `"exit"`, `"timeout"`). */
  reason?: string;
  /** The id tugcode attempted to resume. */
  stale_session_id?: string;
}

/** Discriminated union of events the reducer accepts. */
export type CodeSessionEvent =
  | SendActionEvent
  | SessionInitEvent
  | AssistantTextEvent
  | ThinkingTextEvent
  | ToolUseEvent
  | ToolResultEvent
  | ToolUseStructuredEvent
  | TurnCompleteEvent
  | SystemMetadataEvent
  | ControlRequestForwardEvent
  | RespondApprovalActionEvent
  | RespondQuestionActionEvent
  | InterruptActionEvent
  | CostUpdateEvent
  | WireErrorEvent
  | SessionStateErroredEvent
  | SessionUnknownEvent
  | SessionNotOwnedEvent
  | TransportCloseEvent
  | ResumeFailedEvent;
