/**
 * Public types for `CodeSessionStore` — the per-Tide-card L02 store that
 * owns Claude Code turn state.
 *
 * [D03] three-identifier model
 * [D04] transcript + streaming
 * [D07] full sequence substrate — a turn is an ordered sequence of typed
 *       `Message`s; the snapshot exposes the in-flight turn as
 *       `activeTurn` (and the committed turns as `transcript[].messages`)
 *       so consumers iterate the sequence rather than reading paired
 *       fields. Paired `userMessage` / `assistant` / `thinking` /
 *       `toolCalls` aggregation retires.
 * [D11] effect-list reducer
 */

import type { AtomSegment } from "../tug-atom-img";
import type { CardSessionMode } from "../card-session-binding-store";

export type { CardSessionMode } from "../card-session-binding-store";

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
 *
 * `waking` is the phase for a spontaneous mid-session resume bracketed
 * by `wake_started` and the next `turn_complete`. Closes [PPF-01]:
 * before this phase existed, content events arriving from idle in
 * response to an async deferred-completion trigger (Monitor timeout,
 * CronCreate firing, ScheduleWakeup arriving) were silently dropped
 * by the `handleTextDelta` / `handleTurnComplete` guards. The bracket
 * mirrors the replay pattern but uses claude's existing `turn_complete`
 * as the implicit close (no `wake_complete` frame on the wire).
 * See `roadmap/tugplan-tide-session-wake.md` [D01].
 */
export type CodeSessionPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
  | "replaying"
  | "waking"
  | "errored";

/**
 * Verbatim forward of the SDK's `SDKTaskNotificationMessage` payload
 * (`@anthropic-ai/claude-agent-sdk/sdk.d.ts:1659-1668`), minus the
 * `type:"system"` / `subtype:"task_notification"` envelope. Set by
 * `handleWakeStarted` on the reducer state and cleared by
 * `handleTurnComplete`'s `waking → idle` commit branch.
 *
 * Slice 1 has no consumers — the field is set, surfaced on the
 * snapshot, and cleared without being read anywhere. Slice 2 will
 * render a trigger-aware chip / banner from it. The shape is pinned
 * to the SDK type so a future SDK upgrade surfaces as a type-level
 * drift (caught by the Step 5 drift test) rather than a silent
 * field-rename.
 */
export interface WakeTrigger {
  taskId: string;
  toolUseId: string;
  status: "completed" | "failed" | "stopped";
  summary: string;
  outputFile: string;
}

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

// ---------------------------------------------------------------------------
// Message sequence substrate ([D07])
// ---------------------------------------------------------------------------

/**
 * Discriminant of a {@link Message}. The substrate is a flat ordered
 * sequence of these — interleaving (text → tool → text) is preserved
 * by `messages` array position, not by paired fields. Adding a new
 * kind is a union extension plus a reducer handler plus a renderer.
 */
export type MessageKind =
  | "user_message"
  | "assistant_text"
  | "assistant_thinking"
  | "system_note"
  | "tool_use";

/**
 * Fields every `Message` carries. `messageKey` is the React-row /
 * subscription identity, stable from mint through every subsequent
 * mutation (streaming append, `tool_result` landing on a `tool_use`,
 * etc.). Derivation per [D07]:
 *
 *  - `user_message`: `${turnKey}-user` (one per turn at most).
 *  - wire-derived (`assistant_text` / `assistant_thinking` /
 *    `tool_use`): `${msg_id}-b${block_index}` — intrinsically unique
 *    within a session, mirrors the wire's `(msg_id, block_index)`
 *    coordinate.
 *  - `system_note`: `${turnKey}-sys${seq}` where `seq` is a monotonic
 *    per-turn counter ({@link ScratchEntry.systemNoteSeq} in the
 *    reducer).
 *
 * `createdAt` is the wall-clock at mint time; consumers needing a
 * stable timestamp for display read this instead of re-deriving from
 * turn boundaries. Replay events synthesize it from the JSONL anchor.
 */
export interface MessageBase {
  messageKey: string;
  createdAt: number;
}

export interface UserMessage extends MessageBase {
  kind: "user_message";
  text: string;
  attachments: ReadonlyArray<AtomSegment>;
  /**
   * Wall-clock ms when `send()` was dispatched. Distinct from
   * `TurnEntry.endedAt` — the "submitted at" time the user-row
   * timestamp display reads. Carried on the Message so the data
   * source can derive the user row's timestamp without reaching
   * back into turn-level metadata.
   */
  submitAt: number;
}

export interface AssistantText extends MessageBase {
  kind: "assistant_text";
  /** Mutates by append during streaming; replaced wholesale on
   *  `is_partial: false`. */
  text: string;
}

export interface AssistantThinking extends MessageBase {
  kind: "assistant_thinking";
  text: string;
}

/**
 * Subdued note inside a turn — Step 8's scheduled-prompt rendering is
 * the first user, with `source: "scheduled"`. Future kinds
 * (`compact_boundary` / `wake_summary`) extend the `source` union
 * without changing the substrate shape.
 */
export interface SystemNote extends MessageBase {
  kind: "system_note";
  text: string;
  source: "scheduled" | "compact" | "other";
}

/**
 * Tool call as a Message in the sequence. Carries the same fields
 * `ToolCallState` carried in the paired substrate, plus the
 * `MessageBase` identity. Mutations follow copy-on-write per [D07]'s
 * mutation discipline — the reducer shallow-clones the Message and
 * the messages-array slot; other Messages stay reference-identical.
 */
export interface ToolUseMessage extends MessageBase {
  kind: "tool_use";
  toolUseId: string;
  toolName: string;
  input: unknown;
  status: "pending" | "done" | "error";
  result: unknown | null;
  structuredResult: unknown | null;
  /** Spawning `Agent` call's `toolUseId`; `undefined` for a top-level call. */
  parentToolUseId?: string;
  /**
   * Wall-clock ms between the `tool_use` event and the matching
   * `tool_result`. `null` while pending; remains `null` if the turn
   * ended before the result arrived.
   */
  toolWallMs: number | null;
}

/**
 * Discriminated union of every Message kind. Iteration is the substrate's
 * primary access pattern — consumers `messages.filter(m => m.kind === ...)`
 * or `messages[0]?.kind === "user_message"` instead of reaching for
 * paired fields.
 */
export type Message =
  | UserMessage
  | AssistantText
  | AssistantThinking
  | SystemNote
  | ToolUseMessage;

/**
 * Per-turn token + cost figures, frozen onto the committed `TurnEntry`
 * at `turn_complete`.
 *
 * The four token fields are the turn's LAST tool-loop iteration's
 * `usage` — `cost_update.usage`, which tugcode emits from the turn's
 * most recent `message_delta`. They are NOT `result.usage`:
 * `result.usage` is the SUM of `usage` across every API call of the
 * turn, so a K-tool-call turn over-reports by ~K×. The last
 * iteration's `input + cache_read + cache_creation + output` IS the
 * resident context window after the turn — `turnWindowTokens` reads
 * exactly that.
 *
 * Only `totalCostUsd` is a delta (`total_cost_usd` IS
 * cumulative-per-session, so the committed value is `after − before`).
 * See `extractTurnCost`. Zeros for a turn that received no
 * `cost_update` event, or an interrupted turn whose only iteration was
 * a degenerate zero-usage stop — the transcript window-walk
 * (`deriveContextWindows`) carries the prior window forward for those.
 */
export interface TurnCost {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
}

/**
 * Typed terminal state of a turn — strictly richer than the legacy
 * `TurnEntry.result` (`"success" | "interrupted"`). Used by lifecycle
 * coordinators to distinguish a clean completion from each failure
 * mode without re-reading `lastError`.
 *
 * - `complete`       — `turn_complete` with `result: "success"`.
 * - `interrupted`    — user pressed Stop; `handleInterrupt` ran.
 * - `error`          — `turn_complete` with `result: "error"` outside the
 *                       transport-lost path.
 * - `transport_lost` — turn was in flight when the transport closed.
 */
export type TurnEndReason =
  | "complete"
  | "interrupted"
  | "error"
  | "transport_lost";

/**
 * Immutable transcript entry appended once per completed turn.
 * `result === "interrupted"` covers both user-initiated stop
 * (`turn_complete(error)`) and any preserved-text interrupt path.
 *
 * [D07] sequence-substrate shape: `messages` is the ordered Message
 * sequence the wire produced (preserving multi-msgId iterations
 * faithfully). Paired fields (`userMessage` / `thinking` / `assistant`
 * / `toolCalls`) retired — consumers iterate `messages` and filter by
 * `kind` instead.
 */
export interface TurnEntry {
  /**
   * Stable React-key seed for this turn's row(s). Generated at
   * `handleSend` (or `handleWakeStarted`) and preserved unchanged
   * across the inflight → committed transition. The transcript data
   * source uses it to mint `idForIndex` so React keys for the
   * streaming row stay identical when it becomes the committed row —
   * preventing the cell wrapper from unmounting at `turn_complete`,
   * which previously caused `scrollTop` to silently clamp to 0.
   *
   * Distinct from `msgId`: `msgId` is the wire-correlation identifier
   * assigned by the backend (used to match streaming frames to their
   * turn); `turnKey` is a client-only key, generated at submit time,
   * meaningful only to React reconciliation.
   */
  turnKey: string;
  msgId: string;
  /**
   * Ordered Message sequence — the wire's arrival order, preserving
   * the interleaving of text / thinking / tool_use across every
   * `msg_id` iteration of the turn ([D07]). Each Message carries a
   * stable `messageKey` for per-Message React identity and PropertyStore
   * subscriptions.
   *
   * A normal user turn opens with a `user_message` Message; a wake
   * turn naturally doesn't (its `messages` opens with `assistant_text`
   * or `assistant_thinking`). Consumers that need to gate on the
   * presence of a user message inline-check
   * `turn.messages[0]?.kind === "user_message"` — no named helper.
   */
  messages: ReadonlyArray<Message>;
  /**
   * @deprecated Use {@link turnEndReason}. Derived from `turnEndReason`
   * so the two never diverge (`"complete"` → `"success"`; everything
   * else → `"interrupted"`). Kept in place for incremental consumer
   * migration; remove once all callers have moved.
   */
  result: "success" | "interrupted";
  endedAt: number;

  /**
   * Pure wall-clock duration of the turn: `endedAt - submitAt`
   * (`submitAt` carried on the opening `user_message` Message for a
   * normal turn, or on the wake bracket's `ActiveTurnSnapshot` for a
   * wake turn that commits with no user message).
   * Indisputable; covers everything.
   */
  wallClockMs: number;
  /**
   * Cumulative ms paused on a `TugInlineDialog` waiting for the user's
   * answer. Covers BOTH permission prompts and `AskUserQuestion`
   * question dialogs — the time the turn was blocked on user input.
   */
  awaitingApprovalMs: number;
  /**
   * Cumulative ms with the transport disconnected (`offline` OR
   * `restoring`) during this turn. The cleanest objective signal —
   * the transport authoritatively knows when it lost service.
   */
  transportDowntimeMs: number;
  /**
   * Machine-doing-work duration. Stored directly so consumers don't
   * recompute: `wallClockMs - awaitingApprovalMs - transportDowntimeMs`,
   * clamped ≥ 0. The "assistant response time" reported in the UI.
   */
  activeMs: number;

  /**
   * Submit-to-first-`assistant_delta` latency. `null` if the turn
   * produced no assistant output (e.g. tool-only or interrupted).
   */
  ttftMs: number | null;
  /**
   * Submit-to-first-`tool_use` latency. `null` if the turn produced no
   * tool calls.
   */
  ttftcMs: number | null;
  /**
   * Number of transport reconnects observed during this turn.
   * Companion to `transportDowntimeMs`.
   */
  reconnectCount: number;
  /**
   * Longest single inter-event silence across this turn, in ms.
   * Diagnostic — informs any future stream-idle heuristic.
   */
  maxStreamGapMs: number;
  /**
   * Typed terminal state. Strictly richer than {@link result}; consumers
   * SHOULD prefer this field. The reducer derives `result` from this
   * value.
   */
  turnEndReason: TurnEndReason;
  /**
   * Per-turn delta of cumulative `cost_update` fields. Zeros for a turn
   * that received no `cost_update`. See {@link TurnCost}.
   */
  cost: TurnCost;
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
 * The four-token `usage` shape carried by a `streaming_usage` /
 * `cost_update` frame, decoded to camelCase. Mirrors {@link TurnCost}
 * minus the dollar cost — dollars are cumulative-per-session and only
 * land with the terminal `cost_update`, so the live shape omits them.
 *
 * Used both as the live in-flight `liveTurnUsage` value and as the
 * minimal structural input to the window helpers in `end-state.ts`
 * ({@link TurnCost} is structurally assignable to it).
 */
export interface LiveMessageUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Per-category identity carried by the `context_breakdown` wire frame
 * — the static half of the breakdown. Mirrors tugcode's wire-frame
 * `ContextBreakdownCategoryId` enum.
 *
 * `messages` is intentionally absent: it is feed-derived
 * (`window - sessionInit`), assembled tugdeck-side, never on the wire.
 * `mcp_tools` is intentionally absent — Tug treats MCP as out of scope.
 */
export type ContextBreakdownCategoryId =
  | "system_prompt"
  | "system_tools"
  | "custom_agents"
  | "memory_files"
  | "skills"
  | "autocompact_buffer";

/**
 * One per-category slice of the breakdown. Mirrors the wire-frame
 * shape (snake_case `id` enum, label string, numeric token count).
 */
export interface ContextBreakdownCategory {
  id: ContextBreakdownCategoryId;
  label: string;
  tokens: number;
}

/**
 * Reducer projection of the most-recent `context_breakdown` wire
 * frame. Drives the Tide card's Context popover when present. The
 * popover paints the categories in array order; `contextMax` is the
 * model's context-window cap (so the renderer can compute the
 * free-space remainder).
 *
 * The `autocompact_buffer` category is conditional — present only
 * when the user has Claude Code's autocompact setting enabled.
 * Absence means one fewer slice and a larger free-space remainder.
 *
 * Reference is preserved across snapshot rebuilds while the reducer's
 * `lastContextBreakdown` field doesn't change — [L02] consumers see
 * `Object.is` stability during quiescent renders.
 */
export interface ContextBreakdownSnapshot {
  contextMax: number;
  categories: ReadonlyArray<ContextBreakdownCategory>;
}

/**
 * A user message submitted while a turn was already running — held in
 * the reducer's `queuedSends` FIFO and dispatched on the next idle
 * (`handleTurnComplete(success)` flushes the head). `turnKey` is minted
 * at the queueing `send` and travels with the entry so the flushed
 * turn keeps the same React-key seed.
 *
 * Surfaced on `CodeSessionSnapshot.queuedSends` so the transcript can
 * paint one ghost row per queued send.
 */
export interface QueuedSend {
  text: string;
  atoms: ReadonlyArray<AtomSegment>;
  turnKey: string;
}

/**
 * Public projection of the in-flight turn ([D07]). Mirrors
 * `TurnEntry`'s sequence shape so consumers iterate
 * `activeTurn.messages` the same way they iterate `turn.messages` for
 * committed rows — one substrate, two lifecycle slots.
 *
 * `isWake` is the substrate's wake discriminator (replaces the [D06]
 * empty-text sentinel). `messages` may open with a `user_message`
 * (normal turn) or with `assistant_text` / `assistant_thinking` (wake
 * turn — no user submission); consumers gating on user-row presence
 * inline-check `messages[0]?.kind === "user_message"`.
 */
export interface ActiveTurnSnapshot {
  turnKey: string;
  submitAt: number;
  isWake: boolean;
  /**
   * Live, mutates as wire events land. Per [D07] copy-on-write: a
   * mutation shallow-clones the affected Message + the messages array
   * slot; other Messages stay reference-identical so downstream
   * consumers comparing `messages[i]` by reference can detect changes.
   */
  messages: ReadonlyArray<Message>;
}

/**
 * Public snapshot returned by `CodeSessionStore.getSnapshot()`. Stable
 * reference between dispatches that produce no change — callers can use
 * `useSyncExternalStore` without tearing ([D11]).
 */
export interface CodeSessionSnapshot {
  phase: CodeSessionPhase;
  transportState: TransportState;

  /**
   * True while the user-initiated interrupt round-trip is in flight —
   * set when `interrupt()` is dispatched during an active turn and
   * cleared when the matching `turn_complete` (or terminal phase
   * change) lands. The Z2 status-row indicator promotes its dot to
   * "caution" + ring-pulse while this is true so the user can see
   * their stop request hasn't been lost between request and ack.
   */
  interruptInFlight: boolean;

  tugSessionId: string;
  displayLabel: string;
  /**
   * The `"new" | "resume"` discriminator carried on the per-card
   * `CardSessionBinding` and threaded onto the snapshot so pure
   * derivations can branch on the user's intent at session-open
   * time. Stable for the lifetime of the store — the mode is captured
   * once at construction from the binding `cardServicesStore` reads
   * and never changes thereafter; a re-bind (close + reopen) builds
   * a fresh services bag with a fresh store.
   *
   * Consumed today by `deriveTideCardBannerSpec` to suppress the
   * "Loading session…" banner during the JSONL replay round-trip
   * for new sessions (where there is no JSONL to replay). Branch 1
   * (the cold-boot preflight beat) is gated upstream — only resume
   * mode triggers `notifyResumeBindingLanded()` — so the helper
   * does not need to read `sessionMode` to keep that branch
   * resume-only.
   */
  sessionMode: CardSessionMode;

  activeMsgId: string | null;
  canSubmit: boolean;
  canInterrupt: boolean;
  pendingApproval: ControlRequestForward | null;
  pendingQuestion: ControlRequestForward | null;
  /**
   * User messages submitted while a turn was running, in submit order
   * — the reducer's FIFO of held sends, drained head-first on each
   * `turn_complete(success)`. Empty between turns and whenever nothing
   * is queued. The transcript paints one ghost row per entry; consumers
   * needing only the count read `.length`.
   *
   * The reducer rebuilds the array only on enqueue / flush / clear, so
   * the reference is `Object.is`-stable across quiescent snapshot
   * rebuilds ([L02]).
   */
  queuedSends: ReadonlyArray<QueuedSend>;

  transcript: ReadonlyArray<TurnEntry>;

  /**
   * The in-flight turn — set the moment `send()` (or
   * `handleWakeStarted`) opens a turn and cleared exactly when the
   * matching `TurnEntry` commits to `transcript`
   * (`turn_complete(success)` / `turn_complete(error)` / interrupt).
   *
   * Drives every in-flight row in the Tide card transcript: the data
   * source iterates `activeTurn.messages` the same way it iterates
   * `turn.messages` for committed turns — one substrate, two lifecycle
   * slots ([D07]).
   *
   * The reference is rebuilt on every state-changing reducer tick that
   * touches the in-flight turn (text delta, tool result, new Message
   * mint) per [D07]'s copy-on-write mutation discipline. Quiescent
   * dispatches reuse the prior reference so `useSyncExternalStore`
   * consumers ([L02]) get `Object.is` stability.
   */
  activeTurn: ActiveTurnSnapshot | null;

  /**
   * One-shot restore slot — carries a prompt (text + atoms) the
   * prompt-entry editor can seed back into its document for re-edit.
   * Two paths populate it:
   *
   *   - **CASE A interrupt** — the user pulls a turn back before any
   *     answer-channel content has begun (`firstAssistantDeltaAt ===
   *     null && firstToolUseAt === null`; thinking does not cross the
   *     line). `handleInterrupt` captures the in-flight `user_message`
   *     here, clears the in-flight turn and the queue, and returns
   *     `phase` to `idle`.
   *   - **Queued-send cancel** — `cancelQueuedSend` un-sends one
   *     never-dispatched queued submission and routes its prompt here.
   *
   * Consumed by the prompt entry via
   * {@link CodeSessionStore.consumePendingDraftRestore} once it has
   * applied the restore — and only when the editor is empty, so a
   * cancel never clobbers in-progress content. The consume call is
   * what transitions this slot back to `null`; until then it survives
   * subsequent snapshot rebuilds so a remount or late mount of the
   * prompt entry still picks it up.
   *
   * The reference is preserved across snapshot rebuilds while the slot
   * is non-null so `useSyncExternalStore` consumers ([L02]) get
   * `Object.is` stability — a `useLayoutEffect` keyed on the slot's
   * identity fires once per restore, not on every parent render.
   *
   * The wire's `turn_complete(error)` that arrives after a CASE A
   * interrupt round-trip does NOT clear or repopulate this slot — the
   * reducer's `pendingCaseAEchoes` gate suppresses that echo and skips
   * appending a transcript entry, so a CASE A interrupt produces zero
   * `TurnEntry` regardless of the wire echo's timing.
   */
  pendingDraftRestore: {
    text: string;
    atoms: ReadonlyArray<AtomSegment>;
  } | null;

  lastCost: CostSnapshot | null;
  /**
   * Live intra-turn token usage for the in-flight turn — the LATEST
   * `streaming_usage` wire frame, so the `Tokens` / `Context` status
   * cells can climb mid-turn. `null` between turns.
   *
   * Not an accumulation: `observedInput` (`input + cache_read +
   * cache_creation`) grows monotonically across a turn's API calls, so
   * the most recent frame is always the current window. The reducer
   * replaces this field on each frame (no per-message map). The cells
   * read it while `activeTurn !== null` and fall back to the last
   * committed turn's window otherwise; the committed `cost_update`
   * carries the same last-iteration usage and supersedes it at
   * turn-complete with no discontinuity. The reference is preserved
   * across snapshot rebuilds while the reducer's underlying field
   * doesn't change, so [L02] consumers get `Object.is` stability during
   * quiescent renders.
   */
  liveTurnUsage: LiveMessageUsage | null;
  /**
   * `window(0)` — the resident context before any turn (system prompt
   * + tools + agents + memory + skills). Captured by the reducer as
   * the `observedInput` of the session's first telemetry iteration
   * (first `streaming_usage` frame; first `cost_update` as fallback)
   * and never overwritten. `null` until the first frame lands.
   *
   * The transcript window-walk uses it as the prior window for turn 1,
   * so `sessionInitTokens + Σ perTurn = window(latest)` telescopes
   * exactly. Persisted via `TurnTelemetry` so a resumed session
   * restores it.
   */
  sessionInitTokens: number | null;
  /**
   * Most-recent `/context`-style per-category token breakdown for this
   * session. Populated by `context_breakdown` events from tugcode
   * (live path) and by the supervisor's bind-time attach from the
   * persisted `context_breakdown_latest` ledger row (resume path).
   * `null` until the first frame lands — the popover renders its
   * 20.4.7.C `cost_update`-derived fallback view in that case.
   *
   * The reference is preserved across snapshot rebuilds while the
   * reducer's underlying field doesn't change — `useSyncExternalStore`
   * consumers ([L02]) get `Object.is` stability during quiescent
   * renders.
   */
  lastContextBreakdown: ContextBreakdownSnapshot | null;
  lastError: {
    cause:
      | "session_state_errored"
      | "transport_closed"
      | "wire_error"
      | "session_unknown"
      | "session_not_owned"
      | "resume_failed"
      // Transient attachment-rejection (oversize / unsupported /
      // decode-failed image at drop or paste). Originates from
      // `CodeSessionStore.publishAttachmentError`. Per
      // [Table T01](../../../roadmap/tide-atoms.md#t01-failure-modes).
      | "attachment_rejected";
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
   * "Loading session…" to "Loading session… (N turns)"
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

  /**
   * Closed awaiting-approval intervals observed within the current
   * in-flight turn, as `[startMs, endMs]` pairs in chronological order.
   * Cleared at every new turn start (`send`); appended to whenever a
   * dialog (permission or question) closes. Sits alongside the scalar
   * `TurnEntry.awaitingApprovalMs` accumulator — the array is the
   * authoritative shape for live-derivation (it can be unioned with
   * the other yellow axes' intervals to correctly handle overlap),
   * while the scalar continues to drive the committed entry.
   *
   * Reference is preserved across snapshot rebuilds while the array
   * doesn't change; per [L02] `useSyncExternalStore` consumers get
   * `Object.is` stability during quiescent renders.
   */
  awaitingApprovalIntervals: ReadonlyArray<readonly [number, number]>;
  /**
   * Wall-clock ms when the current awaiting-approval dialog (permission
   * or question) opened, or `null` if no dialog is open. Mirrors the
   * reducer's `awaitingApprovalSince` field under the spec's per-turn
   * vocabulary so live-derivation helpers read it under the same
   * naming as the matching intervals array.
   */
  awaitingApprovalSegmentStartedAt: number | null;
  /**
   * Closed transport-downtime intervals observed within the current
   * in-flight turn (both `offline` and `restoring` count as
   * non-online), as `[startMs, endMs]` pairs in chronological order.
   * Cleared at every new turn start (`send`); appended to whenever the
   * transport returns to `online` (`transport_settled`). Sits
   * alongside the scalar `TurnEntry.transportDowntimeMs` accumulator
   * with the same dual-source contract as
   * {@link awaitingApprovalIntervals}.
   */
  transportDowntimeIntervals: ReadonlyArray<readonly [number, number]>;
  /**
   * Wall-clock ms when the transport first left `online` (to
   * `offline` or `restoring`), or `null` while online. Mirrors the
   * reducer's `transportNonOnlineSince` under the spec's per-turn
   * vocabulary.
   */
  transportDowntimeSegmentStartedAt: number | null;
  /**
   * Closed interrupt-in-flight intervals observed within the current
   * turn, as `[startMs, endMs]` pairs. In practice each turn carries
   * at most one such interval — the user presses Stop once and the
   * subsequent `turn_complete` ends both the segment and the turn —
   * so the array's length is usually 0 (no interrupt happened) or 1
   * (CASE B interrupt ran to completion). The array shape is uniform
   * with the other two axes so {@link deriveInflightActiveMs} can
   * union them generically.
   */
  interruptInFlightIntervals: ReadonlyArray<readonly [number, number]>;
  /**
   * Trigger metadata for the in-flight wake turn (`phase === "waking"`),
   * `null` otherwise. Populated by `handleWakeStarted` from the wire
   * `wake_started.wake_trigger` payload and cleared by
   * `handleTurnComplete`'s `waking → idle` commit branch.
   *
   * Slice 1 has no React consumers. The reference is preserved across
   * snapshot rebuilds while the underlying reducer field doesn't change,
   * so future `useSyncExternalStore` consumers ([L02]) get `Object.is`
   * stability during quiescent renders.
   */
  wakeTrigger: WakeTrigger | null;
  /**
   * Wall-clock ms when the user-initiated interrupt round-trip
   * started (`interrupt()` from a content-bearing phase — CASE B), or
   * `null` while no interrupt is in flight. Mirrors the semantics of
   * the existing `interruptInFlight` boolean (which is the latched
   * state); this field is the entry-side timestamp the live-clock
   * helper uses to compute the open-segment duration.
   */
  interruptInFlightSegmentStartedAt: number | null;
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
