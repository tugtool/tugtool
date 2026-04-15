/**
 * Decoded event union consumed by the `CodeSessionStore` reducer.
 *
 * Step 3 populates the core stream-json types driving the basic turn
 * round-trip plus the internal `send` action; later steps add
 * `thinking_text` (Step 4), tool events (Step 5),
 * `control_request_forward` (Step 6), `interrupt` (Step 7), and
 * `session_state_errored` / `transport_close` (Step 8). The Step 1
 * `__noop__` placeholder is gone — every event now carries a real type.
 */

import type { AtomSegment } from "../tug-atom-img";

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
 * Placeholder for Step 8's `SESSION_STATE { state: "errored", ... }`
 * frame. Declared now so the reducer's default case stays exhaustive
 * when Step 8 lands.
 */
export interface SessionStateErroredEvent {
  type: "session_state_errored";
  detail?: string;
}

/** Placeholder for Step 8's transport-close synthetic event. */
export interface TransportCloseEvent {
  type: "transport_close";
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
  | SessionStateErroredEvent
  | TransportCloseEvent;
