// IPC message type definitions (tugcast ↔ tugcode stdin/stdout)

// Helper types
export interface Attachment {
  filename: string;
  content: string; // text or base64
  media_type: string; // MIME type
}

export interface QuestionDef {
  id: string;
  text: string;
  type: "single_choice" | "multi_choice" | "text";
  options?: Array<{ label: string; description?: string }>;
}

// Inbound message types (tugcast → tugcode stdin)
export interface ProtocolInit {
  type: "protocol_init";
  version: number;
}

export interface UserMessage {
  type: "user_message";
  text: string;
  attachments: Attachment[];
}

export interface ToolApproval {
  type: "tool_approval";
  request_id: string;
  decision: "allow" | "deny";
  // Present when decision === "allow"; caller may override tool input.
  updatedInput?: Record<string, unknown>;
  // Present when decision === "deny"; human-readable reason.
  message?: string;
}

export interface QuestionAnswer {
  type: "question_answer";
  request_id: string;
  answers: Record<string, string>;
}

export interface Interrupt {
  type: "interrupt";
}

export interface PermissionModeMessage {
  type: "permission_mode";
  mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "delegate";
}

export interface ModelChange {
  type: "model_change";
  model: string;
}

export interface SessionCommand {
  type: "session_command";
  command: "fork" | "continue" | "new";
}

export interface StopTask {
  type: "stop_task";
  task_id: string;
}

/**
 * Inbound `request_replay` verb per [D12]. Tugdeck dispatches a
 * CONTROL frame on services construction for a resume binding;
 * tugcast forwards the verb to tugcode's stdin as this shape;
 * tugcode invokes its existing `runReplay()` so a freshly-mounted
 * `CodeSessionStore` receives the JSONL bracket without needing a
 * tugcode respawn. Idempotent at the reducer via [D04] msg_id dedupe;
 * the receiving side's re-entrancy guard drops a request that arrives
 * while a replay is already in flight (the in-flight replay's events
 * satisfy the request).
 */
export interface RequestReplay {
  type: "request_replay";
}

export type InboundMessage =
  | ProtocolInit
  | UserMessage
  | ToolApproval
  | QuestionAnswer
  | Interrupt
  | PermissionModeMessage
  | ModelChange
  | SessionCommand
  | StopTask
  | RequestReplay;

// Outbound message types (tugcode stdout → tugcast)
// ipc_version is required per D15 (#d15-ipc-version). Always set to 2.

export interface ProtocolAck {
  type: "protocol_ack";
  version: number;
  session_id: string;
  ipc_version: number;
}

export interface SessionInit {
  type: "session_init";
  session_id: string;
  ipc_version: number;
}

export interface AssistantText {
  type: "assistant_text";
  msg_id: string;
  seq: number;
  rev: number;
  text: string;
  is_partial: boolean;
  status: string;
  ipc_version: number;
}

export interface ToolUse {
  type: "tool_use";
  msg_id: string;
  seq: number;
  tool_name: string;
  tool_use_id: string;
  input: object;
  ipc_version: number;
}

export interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  output: string;
  is_error: boolean;
  ipc_version: number;
}

export interface ToolApprovalRequest {
  type: "tool_approval_request";
  request_id: string;
  tool_name: string;
  input: object;
  ipc_version: number;
}

export interface Question {
  type: "question";
  request_id: string;
  questions: QuestionDef[];
  ipc_version: number;
}

/**
 * Per-turn telemetry block — the persistable cost + multi-clock
 * timing snapshot the reducer commits onto `TurnEntry` at
 * `turn_complete`. Mirrors the tugdeck `TurnTelemetry` shape (see
 * `tugdeck/src/lib/code-session-store/telemetry.ts`). Used in two
 * places on the wire:
 *
 *  - inlined onto a replayed `TurnComplete` by the tugcast supervisor
 *    (the supervisor reads it from its sqlite SessionLedger and
 *    attaches it so the client reducer's merge function adopts the
 *    persisted values), and
 *  - carried on an inbound `RecordTurnTelemetry` from tugdeck so the
 *    supervisor can persist it for the next reload.
 *
 * Round-trip-stable: every field is a primitive scalar; nullable
 * fields are `number | null` per the data model.
 *
 * Field semantics live with the source of truth in tugdeck's
 * `TurnTelemetry` and `TurnEntry`. This type carries the wire shape
 * only; tugcode does not interpret any field.
 */
export interface TurnTelemetry {
  cost: TurnCost;
  wallClockMs: number;
  awaitingApprovalMs: number;
  transportDowntimeMs: number;
  activeMs: number;
  ttftMs: number | null;
  ttftcMs: number | null;
  reconnectCount: number;
  maxStreamGapMs: number;
}

/**
 * Cost subfield of {@link TurnTelemetry}. Field names match
 * tugdeck's `TurnCost` interface (camelCase, not the snake_case
 * `cost_update.usage.*` wire shape — that conversion happens
 * client-side in `extractTurnCost`).
 */
export interface TurnCost {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
}

export interface TurnComplete {
  type: "turn_complete";
  msg_id: string;
  seq: number;
  result: string;
  /**
   * Optional per-turn telemetry payload. Populated only on replay
   * (tugcast supervisor attaches it from the SessionLedger when
   * resuming a session). Live `turn_complete` frames from tugcode
   * never carry it — the client reducer derives telemetry from
   * in-memory clock anchors + cost snapshots on the live path. See
   * plan `#step-20-3-3` / `#step-20-3-4`.
   */
  telemetry?: TurnTelemetry;
  ipc_version: number;
}

export interface TurnCancelled {
  type: "turn_cancelled";
  msg_id: string;
  seq: number;
  partial_result: string;
  ipc_version: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  recoverable: boolean;
  ipc_version: number;
}

// ---------------------------------------------------------------------------
// New outbound IPC types (Step 2.1)
// ---------------------------------------------------------------------------

/**
 * Extended thinking text stream per D12 (#d12-extended-thinking).
 */
export interface ThinkingText {
  type: "thinking_text";
  msg_id: string;
  seq: number;
  text: string;
  is_partial: boolean;
  status: string;
  ipc_version: number;
}

/**
 * Forwarded control_request from claude stdout to tugcast frontend.
 */
export interface ControlRequestForward {
  type: "control_request_forward";
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  decision_reason?: string;
  permission_suggestions?: unknown[];
  blocked_path?: string;
  tool_use_id?: string;
  is_question: boolean;
  ipc_version: number;
}

/**
 * System init metadata forwarded to tugcast for UI population.
 */
export interface SystemMetadata {
  type: "system_metadata";
  session_id: string;
  cwd: string;
  tools: unknown[];
  model: string;
  permissionMode: string;
  slash_commands: unknown[];
  plugins: unknown[];
  agents: unknown[];
  skills: unknown[];
  mcp_servers: unknown[];
  version: string;
  output_style: string;
  fast_mode_state: string;
  apiKeySource: string;
  ipc_version: number;
}

/**
 * Cost and usage summary emitted after each turn completes per PN-19.
 */
export interface CostUpdate {
  type: "cost_update";
  total_cost_usd: number;
  num_turns: number;
  duration_ms: number;
  duration_api_ms: number;
  usage: Record<string, unknown>;
  modelUsage: Record<string, unknown>;
  ipc_version: number;
}

/**
 * Live intra-turn token usage, emitted from the streaming
 * `message_start` / `message_delta` events of the in-flight turn —
 * one frame per event, so the client's `Tokens` / `Context` status
 * cells can climb mid-turn instead of sitting frozen until the
 * terminal `cost_update`.
 *
 * `usage` is the same four-token shape `cost_update` carries
 * (`input_tokens` / `output_tokens` / `cache_creation_input_tokens` /
 * `cache_read_input_tokens`); both `message_start` and `message_delta`
 * carry the complete four fields (verified against live wire data).
 * `msg_id` is claude's `message.id` — a tool-loop turn has several
 * assistant messages, each with its own `message_start` +
 * `message_delta`; the per-message usages SUM to the terminal
 * `result.usage`, so the client keys by `msg_id` and accumulates.
 *
 * Display-only: drives no phase transition and is never persisted.
 * The terminal `cost_update` is authoritative and supersedes the
 * live accumulation at turn-complete.
 */
export interface StreamingUsage {
  type: "streaming_usage";
  msg_id: string;
  usage: Record<string, unknown>;
  ipc_version: number;
}

/**
 * Compact context boundary marker.
 */
export interface CompactBoundary {
  type: "compact_boundary";
  ipc_version: number;
}

/**
 * Category identities the popover surfaces in the `/context`-style
 * breakdown. The renderer trusts the wire — only categories present
 * in {@link ContextBreakdown.categories} are painted.
 *
 * `autocompact_buffer` is conditional: present only when the user has
 * Claude Code's autocompact feature enabled. Absence means the
 * popover paints one fewer slice and a larger free-space remainder.
 *
 * MCP is intentionally absent — Tug treats MCP as out of scope, so
 * no `mcp_tools` id ever appears. See the parent plan step's
 * "Out of scope: MCP" section for the rationale.
 */
export type ContextBreakdownCategoryId =
  | "system_prompt"
  | "system_tools"
  | "custom_agents"
  | "memory_files"
  | "skills"
  | "messages"
  | "autocompact_buffer";

/**
 * One category slice of the {@link ContextBreakdown} wire frame.
 */
export interface ContextBreakdownCategory {
  /** Identity for stable React keys + per-tone color mapping. */
  id: ContextBreakdownCategoryId;
  /** Display label (e.g. "System prompt"). */
  label: string;
  /** Per-category token count. Already calibrated when applicable. */
  tokens: number;
}

/**
 * `/context`-style per-category token breakdown of the session's
 * context window. Emitted by tugcode at session_init, after every
 * `cost_update`, and after every `compact_boundary`; consumed by
 * tugdeck's reducer + popover. Persisted by the tugcast supervisor
 * to `context_breakdown_latest` (one row per session, UPSERT) so the
 * popover renders pre-populated on a fresh bind.
 *
 * Renderer fallback: when no `context_breakdown` frame has landed
 * yet, the popover shows the 20.4.7.C `cost_update`-derived 5-segment
 * view. The fallback is a feature — it keeps the popover useful
 * across the deployment matrix (older tugcode, transient
 * pre-first-frame state).
 *
 * `free_space` is intentionally NOT a column — it's derived by the
 * renderer as `context_max - sum(categories.tokens)`.
 */
export interface ContextBreakdown {
  type: "context_breakdown";
  tug_session_id: string;
  /** Model's context-window cap (e.g. 200_000 for current sonnet/opus). */
  context_max: number;
  categories: ReadonlyArray<ContextBreakdownCategory>;
  /**
   * Set to `true` when the supervisor synthesizes this frame from the
   * persisted `context_breakdown_latest` row at bind time. The
   * tugdeck reducer uses the flag to suppress the redundant
   * `record_context_breakdown` round-trip — the row already exists,
   * re-persisting it would be a no-op write of the same bytes.
   *
   * Absent on live frames emitted by tugcode (the reducer dispatches
   * the persist effect for those as normal). The renderer ignores
   * the flag.
   */
  from_supervisor_attach?: boolean;
  ipc_version: number;
}

/**
 * API retry notification. Claude Code retries up to 10 times with exponential backoff.
 */
export interface ApiRetry {
  type: "api_retry";
  attempt: number;
  max_retries: number;
  retry_delay_ms: number;
  error_status: number | null;
  error: string;
  ipc_version: number;
}

/**
 * Structured tool result for rich UI display per D11/PN-4.
 */
export interface ToolUseStructured {
  type: "tool_use_structured";
  tool_use_id: string;
  tool_name: string;
  structured_result: Record<string, unknown>;
  ipc_version: number;
}

/**
 * Cancellation notice for a pending permission or question dialog.
 */
export interface ControlRequestCancel {
  type: "control_request_cancel";
  request_id: string;
  ipc_version: number;
}

/**
 * Emitted by `SessionManager.initialize()` when a `--session-mode resume`
 * spawn attempt fails (claude exits before `system:init`, JSONL missing,
 * stale id, etc.). Tugcast forwards the frame to the card as a CODE_OUTPUT
 * event and tugdeck surfaces it through `CodeSessionStore.lastError`,
 * which the card observer reads to unbind and re-present the picker
 * with the reason. tugcode then exits cleanly — the silent fresh-spawn
 * fallback was removed because it caused the bound `claudeSessionId`
 * to drift away from the id the user picked.
 */
export interface ResumeFailed {
  type: "resume_failed";
  /** Machine-readable category describing why resume failed. */
  reason: string;
  /** The id tugcode attempted to resume. */
  stale_session_id: string;
  ipc_version: number;
}

// ---------------------------------------------------------------------------
// Replay event types — JSONL → CODE_OUTPUT translator output
// ---------------------------------------------------------------------------

/**
 * Replay user-message echo. Emitted by the JSONL replay translator
 * at the start of each replayed turn, carrying the original user
 * submission text + attachments + the upcoming turn's `msg_id`
 * (claude's id for the *terminal* assistant entry of the turn — the
 * same id `turn_complete` will carry).
 *
 * Distinct from the inbound `user_message` (`tugcast → tugcode`
 * submission shape) because:
 *   - It rides CODE_OUTPUT (`tugcode → tugcast`), not CODE_INPUT.
 *   - It carries `msg_id` (the inbound shape doesn't — msg_id is
 *     minted by claude per turn, not by the submitter).
 *   - The reducer treats it as a synthetic `send` action so the
 *     subsequent `assistant_text` / `turn_complete` for the same
 *     `msg_id` commit a `TurnEntry` into `transcript` exactly as if
 *     the turn had been live.
 */
export interface UserMessageReplay {
  type: "user_message_replay";
  msg_id: string;
  text: string;
  attachments: Attachment[];
  ipc_version: number;
}

/**
 * Bracket marker emitted by the replay translator at the start of a
 * JSONL replay window. The reducer transitions
 * `phase: idle → replaying` on this event and gates `canSubmit` /
 * `canInterrupt` to `false` for the duration.
 */
export interface ReplayStarted {
  type: "replay_started";
  ipc_version: number;
}

/**
 * Bracket marker emitted by the replay translator at end-of-JSONL
 * (or on a hard-budget timeout). The reducer transitions
 * `phase: replaying → idle` and populates `lastReplayResult`.
 *
 * `count` is the number of `turn_complete` events emitted during
 * this replay window. `error` is set when replay terminated
 * abnormally; `kind` matches tugdeck's `LastReplayResult.kind` enum
 * exactly so the reducer can pass it through without translation.
 */
export interface ReplayComplete {
  type: "replay_complete";
  count: number;
  error?: {
    kind:
      | "jsonl_missing"
      | "jsonl_unreadable"
      | "jsonl_malformed"
      | "replay_timeout";
    message: string;
  };
  ipc_version: number;
}

export type OutboundMessage =
  | ProtocolAck
  | SessionInit
  | AssistantText
  | ToolUse
  | ToolResult
  | ToolApprovalRequest
  | Question
  | TurnComplete
  | TurnCancelled
  | ErrorEvent
  | ThinkingText
  | ControlRequestForward
  | SystemMetadata
  | CostUpdate
  | StreamingUsage
  | CompactBoundary
  | ContextBreakdown
  | ApiRetry
  | ToolUseStructured
  | ControlRequestCancel
  | ResumeFailed
  | UserMessageReplay
  | ReplayStarted
  | ReplayComplete;

// Type guards
export function isInboundMessage(msg: unknown): msg is InboundMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const typed = msg as { type?: string };
  return (
    typed.type === "protocol_init" ||
    typed.type === "user_message" ||
    typed.type === "tool_approval" ||
    typed.type === "question_answer" ||
    typed.type === "interrupt" ||
    typed.type === "permission_mode" ||
    typed.type === "model_change" ||
    typed.type === "session_command" ||
    typed.type === "stop_task" ||
    typed.type === "request_replay"
  );
}

export function isProtocolInit(msg: InboundMessage): msg is ProtocolInit {
  return msg.type === "protocol_init";
}

export function isUserMessage(msg: InboundMessage): msg is UserMessage {
  return msg.type === "user_message";
}

export function isToolApproval(msg: InboundMessage): msg is ToolApproval {
  return msg.type === "tool_approval";
}

export function isQuestionAnswer(msg: InboundMessage): msg is QuestionAnswer {
  return msg.type === "question_answer";
}

export function isInterrupt(msg: InboundMessage): msg is Interrupt {
  return msg.type === "interrupt";
}

export function isPermissionMode(msg: InboundMessage): msg is PermissionModeMessage {
  return msg.type === "permission_mode";
}

export function isModelChange(msg: InboundMessage): msg is ModelChange {
  return msg.type === "model_change";
}

export function isSessionCommand(msg: InboundMessage): msg is SessionCommand {
  return msg.type === "session_command";
}

export function isStopTask(msg: InboundMessage): msg is StopTask {
  return msg.type === "stop_task";
}

export function isRequestReplay(msg: InboundMessage): msg is RequestReplay {
  return msg.type === "request_replay";
}
