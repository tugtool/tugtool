/**
 * Tugcast Binary Protocol v1
 *
 * Wire format per frame:
 * ```
 * [1 byte FeedId][1 byte flags][4 bytes payload length (BE u32)][payload]
 * ```
 *
 * - FeedId: open u8 namespace — known feeds have named constants,
 *   unknown values pass through without error (opaque routing).
 * - Flags: bit 0 = frame kind (0 = data, 1 = control/meta).
 *   Bits 1–7 are reserved; receivers ignore unknown flags.
 * - Length: big-endian u32, max MAX_PAYLOAD_SIZE.
 */

/** Feed identifiers for different data streams (open u8 namespace) */
export const FeedId = {
  // Terminal
  TERMINAL_OUTPUT: 0x00,
  TERMINAL_INPUT: 0x01,
  TERMINAL_RESIZE: 0x02,
  // Snapshot feeds
  FILESYSTEM: 0x10,
  FILETREE: 0x11,
  FILETREE_QUERY: 0x12,
  GIT: 0x20,
  // Stats
  STATS: 0x30,
  STATS_PROCESS_INFO: 0x31,
  STATS_TOKEN_USAGE: 0x32,
  STATS_BUILD_STATUS: 0x33,
  // Code (Claude Code bridge)
  CODE_OUTPUT: 0x40,
  CODE_INPUT: 0x41,
  // Defaults / Session
  DEFAULTS: 0x50,
  SESSION_METADATA: 0x51,
  SESSION_STATE: 0x52,
  // Shell (reserved for Phase T2+)
  SHELL_OUTPUT: 0x60,
  SHELL_INPUT: 0x61,
  // TugFeed (reserved for Phase T3+)
  TUG_FEED: 0x70,
  // Router-internal
  CONTROL: 0xc0,
  HEARTBEAT: 0xff,
} as const;

export type FeedIdValue = (typeof FeedId)[keyof typeof FeedId];

/**
 * Legacy numeric alias for `FeedId.SESSION_STATE`. Duplicates the entry
 * in [`FeedId`] and exists only to satisfy the plan's requirement for a
 * named top-level protocol constant. Prefer `FeedId.SESSION_STATE` in new
 * code.
 */
export const FEED_ID_SESSION_STATE = FeedId.SESSION_STATE;

/** CONTROL action names routed to `AgentSupervisor::handle_control`. */
export const CONTROL_ACTION_SPAWN_SESSION = "spawn_session";
export const CONTROL_ACTION_CLOSE_SESSION = "close_session";
export const CONTROL_ACTION_RESET_SESSION = "reset_session";

/** Frame flags */
export const FrameFlags = {
  /** Normal data frame */
  DATA: 0x00,
  /** Control/meta frame about this feed */
  CONTROL: 0x01,
} as const;

export type FrameFlagsValue = (typeof FrameFlags)[keyof typeof FrameFlags];

/** Kind bit mask */
const KIND_BIT = 0x01;

/** Frame header size in bytes (1 FeedId + 1 flags + 4 length) */
export const HEADER_SIZE = 6;

/** Maximum payload size in bytes (16 MB) */
export const MAX_PAYLOAD_SIZE = 16 * 1024 * 1024;

/** A WebSocket frame containing a feed ID, flags, and payload */
export interface Frame {
  feedId: FeedIdValue;
  flags: number;
  payload: Uint8Array;
}

/**
 * Encode a frame into wire format bytes
 *
 * Returns an ArrayBuffer ready for WebSocket transmission.
 */
export function encodeFrame(frame: Frame): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_SIZE + frame.payload.length);
  const view = new DataView(buffer);

  view.setUint8(0, frame.feedId);
  view.setUint8(1, frame.flags);
  view.setUint32(2, frame.payload.length, false);

  new Uint8Array(buffer, HEADER_SIZE).set(frame.payload);

  return buffer;
}

/**
 * Decode a frame from wire format bytes
 *
 * @throws Error if the frame is incomplete or invalid
 */
export function decodeFrame(data: ArrayBuffer): Frame {
  const view = new DataView(data);

  if (data.byteLength < HEADER_SIZE) {
    throw new Error(
      `incomplete frame: need ${HEADER_SIZE} bytes, have ${data.byteLength}`
    );
  }

  const feedId = view.getUint8(0) as FeedIdValue;
  const flags = view.getUint8(1);
  const length = view.getUint32(2, false);

  if (length > MAX_PAYLOAD_SIZE) {
    throw new Error(`payload too large: ${length} bytes`);
  }

  if (data.byteLength < HEADER_SIZE + length) {
    throw new Error(
      `incomplete frame: need ${HEADER_SIZE + length} bytes, have ${data.byteLength}`
    );
  }

  // View into original buffer, no copy
  const payload = new Uint8Array(data, HEADER_SIZE, length);

  return { feedId, flags, payload };
}

/** Returns true if the flags indicate a control/meta frame */
export function isControlFrame(flags: number): boolean {
  return (flags & KIND_BIT) !== 0;
}

/**
 * Create a heartbeat frame (empty payload)
 */
export function heartbeatFrame(): Frame {
  return { feedId: FeedId.HEARTBEAT, flags: FrameFlags.DATA, payload: new Uint8Array(0) };
}

/**
 * Create a terminal input frame
 */
export function inputFrame(data: Uint8Array): Frame {
  return { feedId: FeedId.TERMINAL_INPUT, flags: FrameFlags.DATA, payload: data };
}

/**
 * Create a terminal resize frame
 */
export function resizeFrame(cols: number, rows: number): Frame {
  const json = JSON.stringify({ cols, rows });
  return {
    feedId: FeedId.TERMINAL_RESIZE,
    flags: FrameFlags.DATA,
    payload: new TextEncoder().encode(json),
  };
}

/**
 * Create a code input frame from a message object.
 *
 * Injects `tug_session_id` as the first field of the JSON payload so the
 * tugcast router's CODE_INPUT dispatcher can parse it before consulting
 * the supervisor ledger. The server hard-rejects CODE_INPUT frames that
 * are missing `tug_session_id` (Step 7's `missing_tug_session_id`
 * control error), so passing a real session id is required.
 */
export function encodeCodeInput(msg: object, tugSessionId: string): ArrayBuffer {
  const json = JSON.stringify({ tug_session_id: tugSessionId, ...msg });
  const payload = new TextEncoder().encode(json);
  const frame: Frame = {
    feedId: FeedId.CODE_INPUT,
    flags: FrameFlags.DATA,
    payload,
  };
  return encodeFrame(frame);
}

/**
 * Client-to-server message shapes for the CODE_INPUT feed. The union mirrors
 * the stream-json inbound messages tugcode accepts. T3.4.a only emits the
 * first four variants; the remaining entries are forward-compat placeholders
 * so later phases can extend without re-opening the union.
 */
export type InboundMessage =
  | { type: "user_message"; text: string; attachments: unknown[] }
  | { type: "interrupt" }
  | {
      type: "tool_approval";
      request_id: string;
      decision: "allow" | "deny";
      updatedInput?: unknown;
      message?: string;
    }
  | {
      type: "question_answer";
      request_id: string;
      answers: Record<string, unknown>;
    }
  | { type: "permission_mode"; mode: string }
  | { type: "model_change"; model: string }
  | { type: "session_command"; command: "new" | "continue" | "fork" }
  | { type: "stop_task"; task_id: string };

/**
 * Encode an InboundMessage as the raw JSON payload bytes (no frame header).
 * Paired with `TugConnection.send(FeedId.CODE_INPUT, payload)`, which wraps
 * the payload in a frame at the connection layer. Distinct from
 * `encodeCodeInput`, which returns a fully framed ArrayBuffer.
 */
export function encodeCodeInputPayload(
  msg: InboundMessage,
  tugSessionId: string,
): Uint8Array {
  const json = JSON.stringify({ tug_session_id: tugSessionId, ...msg });
  return new TextEncoder().encode(json);
}

/**
 * Inverse of `encodeCodeInputPayload` — used by test doubles to decode
 * outbound frame payloads into structured InboundMessage objects for
 * assertion. Not called from production code paths.
 */
export function decodeCodeInputPayload(
  payload: Uint8Array,
): InboundMessage & { tug_session_id: string } {
  const json = new TextDecoder().decode(payload);
  return JSON.parse(json) as InboundMessage & { tug_session_id: string };
}

/**
 * Create a control frame with a JSON action payload
 */
export function controlFrame(action: string, params?: Record<string, unknown>): Frame {
  const json = JSON.stringify({ action, ...params });
  return {
    feedId: FeedId.CONTROL,
    flags: FrameFlags.DATA,
    payload: new TextEncoder().encode(json),
  };
}

/**
 * Session-mode choice on spawn. Mirrors
 * `CardSessionBinding["sessionMode"]` — kept as a standalone type so the
 * wire encoder can import it without dragging the binding store in.
 * Roadmap step 4.5.
 */
export type SpawnSessionMode = "new" | "resume";

/**
 * Build a `spawn_session` CONTROL frame for the supervisor.
 *
 * Payload shape per Spec S03 (extended in roadmap step 4.5 with
 * `session_mode`):
 * ```json
 * {
 *   "action": "spawn_session",
 *   "card_id": "...",
 *   "tug_session_id": "...",
 *   "project_dir": "...",
 *   "session_mode": "new" | "resume"
 * }
 * ```
 *
 * `cardId`, `tugSessionId`, and `projectDir` are required; the server-side
 * supervisor hard-rejects CONTROL frames missing any of them via
 * `send_control_json` (`missing_card_id` / `missing_tug_session_id` /
 * `missing_project_dir` error details), so optional arguments on the client
 * side would only create silent failure modes.
 *
 * `sessionMode` defaults to `"new"` when omitted so pre-4.5 callers remain
 * on the fresh-by-default behavior from step 4k. On the server both sides
 * also default to `"new"` when the wire field is absent.
 *
 * `projectDir` is the workspace path the tugcode subprocess will be given
 * as its cwd. The server canonicalizes it via `PathResolver::watch_path()`
 * and echoes the canonical form back in the `spawn_session_ok` CONTROL ack
 * as `workspace_key`. Per Spec S03, tugdeck reads that ack field directly
 * into `cardSessionBindingStore` rather than attempting to canonicalize
 * client-side — JS path libraries don't match tugcast's firmlink handling,
 * so any client-side derivation would risk producing a string that does
 * not match the one spliced into FILETREE/FILESYSTEM/GIT frames.
 */
export function encodeSpawnSession(
  cardId: string,
  tugSessionId: string,
  projectDir: string,
  sessionMode: SpawnSessionMode = "new",
): Frame {
  return controlFrame(CONTROL_ACTION_SPAWN_SESSION, {
    card_id: cardId,
    tug_session_id: tugSessionId,
    project_dir: projectDir,
    session_mode: sessionMode,
  });
}

/**
 * Build a `close_session` CONTROL frame for the supervisor.
 * See [`encodeSpawnSession`] for payload shape and rationale.
 */
export function encodeCloseSession(cardId: string, tugSessionId: string): Frame {
  return controlFrame(CONTROL_ACTION_CLOSE_SESSION, {
    card_id: cardId,
    tug_session_id: tugSessionId,
  });
}

/**
 * Build a `reset_session` CONTROL frame for the supervisor.
 * See [`encodeSpawnSession`] for payload shape and rationale.
 */
export function encodeResetSession(cardId: string, tugSessionId: string): Frame {
  return controlFrame(CONTROL_ACTION_RESET_SESSION, {
    card_id: cardId,
    tug_session_id: tugSessionId,
  });
}
