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
export const CONTROL_ACTION_LIST_SESSIONS = "list_sessions";
export const CONTROL_ACTION_LIST_CARD_BINDINGS = "list_card_bindings";
export const CONTROL_ACTION_FORGET_SESSION = "forget_session";
export const CONTROL_ACTION_FORGET_PROJECT_DIR_SESSIONS = "forget_project_dir_sessions";
export const CONTROL_ACTION_REQUEST_REPLAY = "request_replay";
export const CONTROL_ACTION_RECORD_TURN_TELEMETRY = "record_turn_telemetry";
export const CONTROL_ACTION_RECORD_CONTEXT_BREAKDOWN = "record_context_breakdown";
export const CONTROL_ACTION_RECORD_SESSION_STATE_CHANGE =
  "record_session_state_change";
export const CONTROL_ACTION_LIST_SESSION_STATE_CHANGES =
  "list_session_state_changes";

/**
 * Wire shape for one row of the tugcast-side session ledger.
 * Mirrors `tugrust/crates/tugcast/src/session_ledger.rs::SessionRow` —
 * keep the fields in lockstep when the schema evolves.
 *
 * `card_id` is the card this session is bound to. Set on
 * `record_spawn` and preserved across `mark_closed` / `mark_failed`,
 * so the persisted row keeps the binding for client-side restore.
 */
export interface SessionRow {
  session_id: string;
  workspace_key: string;
  project_dir: string;
  created_at: number;
  last_used_at: number;
  turn_count: number;
  first_user_prompt: string | null;
  state: "live" | "closed" | "failed";
  card_id: string | null;
}

/**
 * Wire shape for one row of `list_card_bindings_ok`. Each row is a
 * persisted (card_id → project_dir) binding the client uses on
 * startup/reconnect to put a tide card back into a usable state
 * without showing the picker.
 *
 * The mode-selection gate is `turn_count > 0 || is_alive`:
 *
 * - `turn_count > 0` — claude has a JSONL on disk. Restore fires
 *   `spawn_session(mode=resume, session_id, project_dir, card_id)`
 *   and the JSONL replay rehydrates the transcript.
 * - `turn_count === 0 && is_alive === true` — **in-flight first
 *   turn**. The user submitted, claude is mid-response (possibly
 *   blocked on a permission/question control_request), no turn has
 *   committed to JSONL yet, but the live subprocess holds the runtime
 *   state. Restore fires `mode=resume` so the client rejoins the same
 *   session and the in-flight snapshot path delivers the partial
 *   assistant text + pending control_request_forward.
 * - `turn_count === 0 && is_alive === false` — Start Fresh + quit.
 *   No JSONL on disk and no live subprocess; resume would fail. Fire
 *   `mode=new` with a fresh `session_id` but the same `project_dir`
 *   so the card opens to its bound project on relaunch.
 */
export interface CardBinding {
  card_id: string;
  session_id: string;
  project_dir: string;
  state: "live" | "closed";
  turn_count: number;
  /**
   * True iff the server's in-memory supervisor holds a `Spawning` or
   * `Live` subprocess entry for this `session_id` at response time.
   * Combined with `turn_count` to gate `mode=resume` vs `mode=new` —
   * see the docstring above for the truth table.
   *
   * Older server builds (before this signal was added) won't emit the
   * field; treat the absence as `false` so the resume gate stays
   * conservative when running against a stale server.
   */
  is_alive?: boolean;
}

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
 */
export type SpawnSessionMode = "new" | "resume";

/**
 * Build a `spawn_session` CONTROL frame for the supervisor.
 *
 * Payload shape per (extended with `session_mode`):
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
 * `sessionMode` defaults to `"new"` when omitted so callers without an
 * explicit choice get the fresh-by-default behavior. On the server both sides
 * also default to `"new"` when the wire field is absent.
 *
 * `projectDir` is the workspace path the tugcode subprocess will be given
 * as its cwd. The server canonicalizes it via `PathResolver::watch_path()`
 * and echoes the canonical form back in the `spawn_session_ok` CONTROL ack
 * as `workspace_key`. Per, tugdeck reads that ack field directly
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

/**
 * Build a `list_sessions` CONTROL request frame.
 *
 * The picker passes the user's typed path (the value originally recorded
 * at `record_spawn` time on the server). The supervisor matches against
 * the ledger's `project_dir` column — no client-side canonicalization is
 * needed. The response broadcasts `list_sessions_ok` carrying
 * `{ project_dir, sessions: SessionRow[] }` ordered by `last_used_at
 * DESC`. Errors broadcast `list_sessions_err { project_dir, reason }`.
 */
export function encodeListSessions(projectDir: string): Frame {
  return controlFrame(CONTROL_ACTION_LIST_SESSIONS, {
    project_dir: projectDir,
  });
}


/**
 * Build a `forget_session` CONTROL request frame.
 *
 * The supervisor deletes the matching ledger row, broadcasts a
 * `session_updated { removed: true }` push, and emits a
 * `forget_session_ok` (or `_err`) ack. Refused for `state="live"` rows —
 * the user must close the card first.
 */
export function encodeForgetSession(sessionId: string): Frame {
  return controlFrame(CONTROL_ACTION_FORGET_SESSION, {
    session_id: sessionId,
  });
}

/**
 * Build a `forget_project_dir_sessions` CONTROL request frame.
 *
 * Drops every non-live row whose `project_dir` matches the given path.
 * Used by the recents-eviction → ledger-eviction coupling: when a
 * tide recent-projects entry ages out, the matching ledger rows go too.
 * Emits one `session_updated { removed: true }` per dropped row plus
 * `forget_project_dir_sessions_ok { project_dir, count }` on success.
 */
export function encodeForgetProjectDirSessions(projectDir: string): Frame {
  return controlFrame(CONTROL_ACTION_FORGET_PROJECT_DIR_SESSIONS, {
    project_dir: projectDir,
  });
}

/**
 * Build a `request_replay` CONTROL frame per [D12].
 *
 * The supervisor's handler looks up the live tugcode subprocess for the
 * given `tugSessionId` and forwards `{"type":"request_replay"}` to its
 * stdin. Tugcode's IPC loop runs `runReplay()` against the on-disk JSONL,
 * which streams `replay_started` / `user_message_replay` / `assistant_text`
 * / `turn_complete` / `replay_complete` frames back through CODE_OUTPUT.
 *
 * Idempotent at three layers:
 *   1. Supervisor — no-op if the entry isn't `Live`.
 *   2. Tugcode — `runReplay`'s re-entrancy guard drops a request that
 *      arrives mid-replay; the in-flight bracket's events satisfy it.
 *   3. Reducer ([D04]) — `msg_id` dedupe means a redundant replay's
 *      `turn_complete` events fold into the same `TurnEntry` rather than
 *      duplicating transcript.
 *
 * Used by `cardServicesStore._construct` whenever a fresh
 * `CodeSessionStore` is built for an existing resume binding (HMR,
 * Developer > Reload, future card mounts). The fresh store has no
 * replay history of its own; this verb tells the supervisor "send me
 * the JSONL again so I can rehydrate."
 */
export function encodeRequestReplay(tugSessionId: string): Frame {
  return controlFrame(CONTROL_ACTION_REQUEST_REPLAY, {
    tug_session_id: tugSessionId,
  });
}

/**
 * Build a `record_turn_telemetry` CONTROL frame.
 *
 * Tugdeck → tugcast: the reducer dispatches this from
 * `handleTurnComplete` (live path only — replayed turns are not
 * re-persisted) carrying the per-turn cost + multi-clock timing
 * block. The supervisor persists it to the sqlite SessionLedger so
 * the next resume can inline it back onto the replayed
 * `turn_complete` event. See plan `#step-20-3-3` / `#step-20-3-4`.
 *
 * Fire-and-forget at the wire level — no ack frame is broadcast.
 * The reducer doesn't wait on confirmation; the row's reason for
 * existing is to survive the next reload, not the next render.
 */
export function encodeRecordTurnTelemetry(input: {
  tugSessionId: string;
  msgId: string;
  telemetry: import("./lib/code-session-store/telemetry").TurnTelemetry;
  endedAt: number;
}): Frame {
  return controlFrame(CONTROL_ACTION_RECORD_TURN_TELEMETRY, {
    tug_session_id: input.tugSessionId,
    msg_id: input.msgId,
    telemetry: input.telemetry,
    ended_at: input.endedAt,
  });
}

/**
 * Build a `record_context_breakdown` CONTROL frame.
 *
 * Tugdeck → tugcast: the reducer dispatches this for every
 * `context_breakdown` event it consumes — both live frames from
 * tugcode and the bind-time attach the supervisor re-emits from the
 * persisted ledger row. The supervisor stores the payload verbatim
 * in the `context_breakdown_latest` table (UPSERT keyed by
 * `tug_session_id`); the next bind reads it back to seed the
 * popover before any new frame arrives.
 *
 * Fire-and-forget at the wire level — no ack frame is broadcast.
 * The popover's local snapshot is already current; persistence is
 * for the next reload, not the next render.
 */
export function encodeRecordContextBreakdown(input: {
  tugSessionId: string;
  payload: import("./lib/code-session-store/types").ContextBreakdownSnapshot;
  capturedAt: number;
}): Frame {
  return controlFrame(CONTROL_ACTION_RECORD_CONTEXT_BREAKDOWN, {
    tug_session_id: input.tugSessionId,
    payload: {
      context_max: input.payload.contextMax,
      categories: input.payload.categories,
    },
    captured_at: input.capturedAt,
  });
}

/**
 * One row of the `list_session_state_changes_ok` response — a single
 * indicator-tone triple transition persisted by the supervisor.
 * `at_ms` is the wall-clock millisecond when the triple landed on the
 * snapshot; the field order mirrors the writer's payload.
 *
 * Wire shape — keep in lockstep with
 * `tugrust/crates/tugcast/src/session_ledger.rs::SessionStateChangeRow`.
 */
export interface SessionStateChangeWireRow {
  at_ms: number;
  phase: import("./lib/code-session-store/types").CodeSessionPhase;
  transport_state: import("./lib/code-session-store/types").TransportState;
  interrupt_in_flight: boolean;
}

/**
 * Build a `record_session_state_change` CONTROL frame.
 *
 * Tugdeck → tugcast: the per-card `CodeSessionStore.dispatch` wrapper
 * compares prev/new triple after every reduce and emits this for every
 * change. The supervisor resolves `tug_session_id → claude_session_id`
 * and appends one row to `session_state_changes`. The SQL layer dedupes
 * against the most-recent persisted row as a race safety-net; the
 * client-side compare is the primary dedupe.
 *
 * Fire-and-forget at the wire level — no ack frame is broadcast.
 * Persistence is for the next reload (and the popover's history view),
 * not the next render.
 */
export function encodeRecordSessionStateChange(input: {
  tugSessionId: string;
  atMs: number;
  phase: import("./lib/code-session-store/types").CodeSessionPhase;
  transportState: import("./lib/code-session-store/types").TransportState;
  interruptInFlight: boolean;
}): Frame {
  return controlFrame(CONTROL_ACTION_RECORD_SESSION_STATE_CHANGE, {
    tug_session_id: input.tugSessionId,
    at_ms: input.atMs,
    phase: input.phase,
    transport_state: input.transportState,
    interrupt_in_flight: input.interruptInFlight,
  });
}

/**
 * Build a `list_session_state_changes` CONTROL request frame.
 *
 * Tugdeck → tugcast read: the popover reader (Step 20.4.9) asks the
 * supervisor for the persisted history for a given `tug_session_id`.
 * The response is `list_session_state_changes_ok { tug_session_id,
 * rows }`, oldest-first by insertion order. Unknown sessions surface
 * as an empty `rows` array, not an error frame — the client renders
 * the same "no history yet" UI for both.
 */
export function encodeListSessionStateChanges(tugSessionId: string): Frame {
  return controlFrame(CONTROL_ACTION_LIST_SESSION_STATE_CHANGES, {
    tug_session_id: tugSessionId,
  });
}

/**
 * Decoded `list_session_state_changes_ok` response payload. Correlated
 * to the request by `tug_session_id` (echoed verbatim from the request).
 */
export interface ListSessionStateChangesOk {
  tug_session_id: string;
  rows: SessionStateChangeWireRow[];
}

/**
 * Decoded `list_session_state_changes_err` response payload.
 */
export interface ListSessionStateChangesErr {
  tug_session_id: string;
  reason: string;
}

/**
 * Decoded `session_updated` push payload. The supervisor emits these on
 * every successful ledger write. `removed: true` means the row was
 * deleted; otherwise `fields` holds the post-write row state.
 */
export interface SessionUpdatedPush {
  session_id: string;
  fields?: SessionRow;
  removed?: boolean;
}

/**
 * Type guard + decoder for `session_updated` push frames. Returns `null`
 * if the payload is missing its `action` discriminant or the wrong action.
 * Validation is shape-only — fields' structural correctness is the caller's
 * responsibility (the type assertion is the contract).
 */
export function decodeSessionUpdated(payload: unknown): SessionUpdatedPush | null {
  if (typeof payload !== "object" || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  if (obj.action !== "session_updated") return null;
  const sessionId = obj.session_id;
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const removed = obj.removed === true ? true : undefined;
  const fields = (obj.fields as SessionRow | undefined) ?? undefined;
  return removed ? { session_id: sessionId, removed: true } : { session_id: sessionId, fields };
}
