// IPC message type definitions (tugcast ↔ tugcode stdin/stdout)

/**
 * Anthropic content-block wire shape — carried verbatim on the
 * `user_message` IPC frame post-Step-5c. Tugcode forwards `content`
 * to the Anthropic SDK with no construction step (the inbound shape
 * IS the API shape).
 *
 * Per tugdeck's `protocol.ts`'s `ContentBlock` — keep field names in
 * lockstep.
 */
export type ContentBlock = ContentBlockText | ContentBlockImage;

export interface ContentBlockText {
  type: "text";
  text: string;
}

export interface ContentBlockImage {
  type: "image";
  source: ContentBlockImageSourceBase64;
}

export interface ContentBlockImageSourceBase64 {
  type: "base64";
  media_type: string;
  data: string;
}

/**
 * Legacy wire-shape attachment — used only on the journal-projection
 * path (`derive_legacy_journal_view` in tugcast and
 * `buildContentBlocksFromLegacyJournal` here). The live user_message
 * frame carries {@link ContentBlock}[] directly; this shape exists for
 * the never-drop synthetic emit path that bridges the gap between
 * submit and JSONL ack and reads from the tugcast journal's legacy
 * `text` + `attachments` columns.
 */
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
  /**
   * Anthropic-API content-block array — forwarded to the Anthropic
   * SDK verbatim. Tugcast forwards inbound `user_message` frames
   * without reshape; the journal's legacy `text` + `attachments`
   * columns are derived from this via
   * `derive_legacy_journal_view`. Per Step 5c.
   */
  content: ContentBlock[];
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
  mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "auto" | "dontAsk" | "delegate";
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
  /**
   * Position of this text block within its message (the `index` from
   * the wire's `content_block_start { index }` for the block this
   * delta belongs to). Within a single `message_start`, blocks are
   * numbered 0, 1, 2, ... in arrival order; index resets to 0 at the
   * next `message_start`. The reducer uses `(msg_id, block_index)` as
   * the mint key: a new `content_block_start` mints a Message,
   * subsequent deltas with the same pair append to it.
   *
   * Synthetic emissions (slash-command output, the consolidated
   * mid-turn snapshot, terminal emissions from top-level `assistant`
   * snapshots) carry `block_index: 0` paired with a preceding
   * synthetic `content_block_start { block_index: 0, kind: "text" }`
   * so the reducer's mint path is uniform across live, replay, and
   * synthetic.
   */
  block_index: number;
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
  /**
   * Optional original wall-clock timestamp (epoch milliseconds) of
   * the terminal assistant JSONL entry that closes this turn. Set
   * only on the replay path so the reducer can stamp the committed
   * `TurnEntry.endedAt` with the original completion time instead of
   * `Date.now()` (the replay-emission time). Live `turn_complete`
   * frames omit it — the reducer falls back to `Date.now()` for live
   * turns.
   */
  timestamp?: number;
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
  /** See {@link AssistantText.block_index} — same semantics. */
  block_index: number;
  seq: number;
  text: string;
  is_partial: boolean;
  status: string;
  ipc_version: number;
}

/**
 * Opens a content block within an assistant message. Emitted by tugcode's
 * `mapStreamEvent` at every wire `content_block_start`, and by `replay.ts`
 * + `emitInflightTurnFromActiveTurn` at every reconstructed block.
 *
 * The reducer mints a `Message` of the corresponding kind on receipt
 * and indexes by `(msg_id, block_index)` for subsequent delta lookup.
 *
 * Discriminated by `kind`: `tool_use_id` and `tool_name` are required
 * when `kind === "tool_use"` and forbidden otherwise — the union below
 * encodes this in the type system so nonsensical constructions are
 * compile errors.
 *
 * Idempotent on the reducer side: a `content_block_start` for an
 * already-minted `(msg_id, block_index)` is a no-op. This is what
 * makes the mid-turn replay snapshot pattern ([D07] § Mid-turn replay)
 * safe: the live path may have already minted before the disconnect;
 * the snapshot's re-emission must not duplicate-mint.
 */
export type ContentBlockStart =
  | ContentBlockStartText
  | ContentBlockStartThinking
  | ContentBlockStartToolUse;

export interface ContentBlockStartText {
  type: "content_block_start";
  msg_id: string;
  block_index: number;
  kind: "text";
  ipc_version: number;
}

export interface ContentBlockStartThinking {
  type: "content_block_start";
  msg_id: string;
  block_index: number;
  kind: "thinking";
  ipc_version: number;
}

export interface ContentBlockStartToolUse {
  type: "content_block_start";
  msg_id: string;
  block_index: number;
  kind: "tool_use";
  tool_use_id: string;
  tool_name: string;
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
 *
 * `version` is optional and is included only when the source actually
 * knows the running Claude Code version. The live init path
 * (`session.ts` `case "system"` / `subtype === "init"`) reads
 * `event.claude_code_version` from claude's own init event and
 * includes it when present. The replay path
 * (`replay.ts` synthesized `system_metadata` from JSONL) NEVER
 * includes it — the JSONL doesn't carry the Claude Code version.
 * Treating absence as "no signal" (instead of `""` as "empty
 * signal") lets the downstream `session_metadata_merge` preserve
 * whatever real version the ledger already has, and lets the
 * frontend's `??` fallback chain fire correctly when the live init
 * hasn't landed yet.
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
  version?: string;
  output_style: string;
  fast_mode_state: string;
  apiKeySource: string;
  ipc_version: number;
}

/**
 * Cost and usage summary emitted after each turn completes per PN-19.
 *
 * `usage` carries the turn's LAST tool-loop iteration's `usage` — the
 * most recent `message_delta` of the turn (or last `message_start`
 * when the turn produced no `message_delta`; `{}` for a fully
 * degenerate turn). It is NOT `result.usage`: `result.usage` is the
 * SUM of `usage` across every API call of the turn, so a turn making
 * K tool calls re-reads the (cached) context K times and over-counts
 * by ~K×. The last iteration's `input + cache_read + cache_creation +
 * output` IS the resident context window after the turn — the figure
 * the client's per-turn / context surfaces need.
 *
 * `total_cost_usd` and `num_turns` are unchanged — those genuinely
 * accumulate across the session and are read straight off the `result`
 * event.
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
 * `msg_id` is claude's `message.id`.
 *
 * `observedInput` (`input + cache_read + cache_creation`) grows
 * monotonically across a turn's API calls — each call re-reads the
 * prior call's context plus its own output and tool result. So the
 * MOST RECENT frame is always the current window; the client keeps
 * the latest frame and does not accumulate across `msg_id`s. The
 * terminal `cost_update` carries this same last-iteration `usage` and
 * supersedes the live frame at turn-complete with no discontinuity.
 *
 * Display-only: drives no phase transition and is never persisted.
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
 * Category identities the `context_breakdown` wire frame carries —
 * the *static* half of the `/context`-style breakdown.
 *
 * `messages` is intentionally absent: it is not a static, locally-
 * tokenizable category. tugdeck derives it feed-exact (`window -
 * sessionInit`) and appends it when assembling the popover breakdown.
 *
 * `autocompact_buffer` is conditional: present only when the user has
 * Claude Code's autocompact feature enabled.
 *
 * MCP is intentionally absent — Tug treats MCP as out of scope, so
 * no `mcp_tools` id ever appears.
 */
export type ContextBreakdownCategoryId =
  | "system_prompt"
  | "system_tools"
  | "custom_agents"
  | "memory_files"
  | "skills"
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
 * The *static* half of a `/context`-style context breakdown — the
 * five session-stable categories (system prompt, tool schemas, custom
 * agents, memory files, skills) plus the conditional
 * `autocompact_buffer`. Emitted by tugcode at `session_init` (so the
 * Context surface populates the moment the session opens) and
 * re-emitted after every `cost_update` to refresh `context_max`;
 * consumed by tugdeck's reducer + popover. Persisted by the tugcast
 * supervisor to `context_breakdown_latest` (one row per session,
 * UPSERT) so the popover renders pre-populated on a fresh bind.
 *
 * This frame carries NO `messages` category and NO total — both are
 * feed-exact and assembled tugdeck-side: tugdeck scales these static
 * categories so they sum to the feed-exact `sessionInit`, then
 * appends `messages = window(latest) - sessionInit`.
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
 * Subscription-quota status broadcast emitted by Claude Code 2.1.x at the
 * start of every turn (post-`system/init`, pre-stream). Distinct from
 * {@link ApiRetry}, which fires on backoff-retryable HTTP failures.
 *
 * Mirrors the claude top-level event shape verbatim:
 * `{ type, rate_limit_info: { status, resetsAt, rateLimitType,
 *    overageStatus, overageDisabledReason, isUsingOverage }, uuid,
 *    session_id }`. The frontend reads this to surface "X hours until
 * quota reset" in the chrome and to flip into a "rate-limited" mode when
 * `status !== "allowed"`.
 */
export interface RateLimitInfo {
  /** `"allowed"`, `"warning"`, `"exceeded"`, etc. */
  status: string;
  /** Unix epoch seconds at which the current window resets. */
  resetsAt: number;
  /** `"five_hour"`, `"daily"`, etc. */
  rateLimitType: string;
  /** `"accepted"` or `"rejected"`. */
  overageStatus: string;
  /** Reason overage is disabled (`"org_level_disabled"`, etc.). May be absent. */
  overageDisabledReason?: string;
  /** Whether the current turn is consuming overage allotment. */
  isUsingOverage: boolean;
}

export interface RateLimitEvent {
  type: "rate_limit_event";
  rate_limit_info: RateLimitInfo;
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
 * Replay user-message frame. Emitted by the JSONL replay translator
 * at the start of each replayed turn (and by tugcode's mid-turn
 * `emitInflightTurnFromActiveTurn` snapshot path), carrying the
 * original user submission text + attachments.
 *
 * Named after the substrate operation it performs — adds a
 * `user_message` Message to the substrate — symmetric with
 * `content_block_start { kind: "text" | "thinking" | "tool_use" }`'s
 * message-kind-keyed naming. The `add_<kind>` template established
 * here applies to all future Message-creating IPC frames (Step 8's
 * `add_system_note` for scheduled prompts, anything beyond).
 *
 * Distinct from the inbound `user_message` (`tugcast → tugcode`
 * submission shape) because:
 *   - It rides CODE_OUTPUT (`tugcode → tugcast`), not CODE_INPUT.
 *   - It is a *substrate add*, not a *submission*. The outbound
 *     submission keeps its operation-centric name (`UserMessage`)
 *     because it is heading to claude, semantically distinct from
 *     "add a Message to the substrate."
 *   - The reducer's `handleAddUserMessage` mints a `pendingTurn`
 *     whose `initialMessages` is `[user_message]`; the substrate's
 *     correlation key is `turnKey`, not `msg_id`.
 *
 * No `msg_id` field. Under [D14] the reducer's `activeMsgId` is set
 * only by the first content event (`assistant_text` / `thinking_text`
 * / `tool_use` / `content_block_start`) — it is never pre-bound from
 * a user-side opener. The replay translator's `openTurnMsgId` tracker
 * holds whatever synthesized opener id it minted ([D13]); that id is
 * translator-internal and never reaches the wire on this frame.
 *
 * See `roadmap/tugplan-dev-session-wake.md` [D14] (activeMsgId
 * tracking), [D15] (add_<kind> naming), and `#spec-wire-frames` for
 * the canonical wire-shape definition.
 */
export interface AddUserMessage {
  type: "add_user_message";
  /**
   * Anthropic-API content-block array.
   *
   * On the JSONL-replay path (`replay.ts`), this is the recorded
   * message's `content` array passed through verbatim — JSONL is
   * Anthropic's storage format, so the interleaving of text + image
   * blocks survives round-trip.
   *
   * On the never-drop synthetic path (`session.ts`'s
   * `injectPendingRowSynthetics`), this is built via
   * `buildContentBlocksFromLegacyJournal` from the tugcast journal's
   * legacy `text` + `attachments` columns — a flat all-images-first
   * shape. Interleaving is lost here; the never-drop path is the
   * gap-bridge, not the primary restore path.
   */
  content: ContentBlock[];
  /**
   * Optional original wall-clock timestamp (epoch milliseconds) of
   * the user JSONL entry that produced this opener. Set only on the
   * replay path so the reducer can stamp the synthesized `UserMessage`
   * with the original submission time instead of `Date.now()` (the
   * replay-emission time). Live `add_user_message` frames omit it —
   * the reducer falls back to `Date.now()` for live submissions.
   */
  timestamp?: number;
  ipc_version: number;
}

/**
 * Bracket marker emitted by the replay translator at the start of a
 * JSONL replay window. The reducer transitions
 * `phase: idle → replaying` on this event and gates `canSubmit` /
 * `canInterrupt` to `false` for the duration.
 */
/**
 * Bracket marker emitted by tugcode when it observes a
 * `system/task_notification` event on the claude stream-json wire.
 * Signals that claude is about to resume from idle in response to a
 * deferred-completion tool's async event (Monitor timing out, a cron
 * job firing, a wakeup arriving, etc.) — without a preceding user
 * submission.
 *
 * The reducer transitions `phase: idle → waking` on this event and
 * accepts the subsequent assistant_text / thinking_text / tool_use
 * events that would otherwise be dropped by guards expecting an
 * active turn. The bracket closes implicitly on the next
 * `turn_complete` (no separate `wake_complete` frame on the wire —
 * the reducer's commit path extends to map `waking → idle`).
 *
 * `wake_trigger` is a verbatim forward of the SDK's
 * `SDKTaskNotificationMessage` payload (`sdk.d.ts:1659-1668`),
 * minus the `type:"system" / subtype:"task_notification"` envelope.
 * `turnKey` is intentionally absent here — tugdeck's store wrapper
 * (`frameToEvent`) mints it on frame receipt, mirroring the
 * `add_user_message` pattern.
 *
 * See `roadmap/tugplan-dev-session-wake.md` [D02] for the detector
 * rationale and [Q01] for the empirical capture this contract is
 * pinned against.
 */
export interface WakeStarted {
  type: "wake_started";
  session_id: string;
  wake_trigger: {
    task_id: string;
    tool_use_id: string;
    status: "completed" | "failed" | "stopped";
    summary: string;
    output_file: string;
  };
  ipc_version: number;
}

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
  | ContentBlockStart
  | ControlRequestForward
  | SystemMetadata
  | CostUpdate
  | StreamingUsage
  | CompactBoundary
  | ContextBreakdown
  | ApiRetry
  | RateLimitEvent
  | ToolUseStructured
  | ControlRequestCancel
  | ResumeFailed
  | AddUserMessage
  | ReplayStarted
  | ReplayComplete
  | WakeStarted;

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
