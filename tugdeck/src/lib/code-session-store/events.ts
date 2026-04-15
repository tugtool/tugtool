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
  | TurnCompleteEvent
  | SystemMetadataEvent
  | SessionStateErroredEvent
  | TransportCloseEvent;
