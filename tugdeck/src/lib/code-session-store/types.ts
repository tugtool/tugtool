/**
 * Public types for `CodeSessionStore` — the per-Tide-card L02 store that
 * owns Claude Code turn state.
 *
 * [D03] three-identifier model
 * [D04] transcript + streaming
 * [D10] `inflightUserMessage` mirror — the snapshot exposes the
 *       reducer's `pendingUserMessage` as `inflightUserMessage` so the
 *       transcript's in-flight `user` row enters React via
 *       `useSyncExternalStore` without card-level shadow state ([L02]).
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
 */
export type CodeSessionPhase =
  | "idle"
  | "submitting"
  | "awaiting_first_token"
  | "streaming"
  | "tool_work"
  | "awaiting_approval"
  | "replaying"
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
 *
 * `parentToolUseId` is set when this call was made by a subagent — it
 * carries the spawning `Agent` call's `toolUseId` (from the wire
 * `tool_use.parent_tool_use_id`). The `toolCallMap` stays flat — every
 * call, parent or child, is one entry — and the rendering layer groups
 * children under their parent at display time ([#step-17-5]).
 *
 * `toolWallMs` records the wall-clock duration between the originating
 * `tool_use` and its matching `tool_result` — populated when the
 * `tool_result` lands; `null` if the turn ended (interrupted, errored,
 * transport-lost) while the call was still pending.
 */
export interface ToolCallState {
  toolUseId: string;
  toolName: string;
  input: unknown;
  status: "pending" | "done" | "error";
  result: unknown | null;
  structuredResult: unknown | null;
  /** Spawning `Agent` call's `toolUseId`; `undefined` for a top-level call. */
  parentToolUseId?: string;
  /**
   * Wall-clock milliseconds between the `tool_use` event and the
   * matching `tool_result`. `null` while pending, and remains `null` if
   * the turn ends before the result arrives.
   */
  toolWallMs: number | null;
}

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
 */
export interface TurnEntry {
  /**
   * Stable React-key seed for this turn's cell pair (user + code).
   * Generated at `handleSend` on the corresponding `pendingUserMessage`
   * and preserved unchanged across the inflight → committed
   * transition. The transcript data source uses it to mint
   * `idForIndex` so the React key for the streaming cell stays
   * identical when it becomes the committed cell — preventing the
   * cell wrapper from unmounting at `turn_complete`, which previously
   * caused `scrollTop` to silently clamp to 0.
   *
   * Distinct from `msgId`: `msgId` is the wire-correlation identifier
   * assigned by the backend (used to match streaming frames to their
   * turn); `turnKey` is a client-only key, generated at submit time,
   * meaningful only to React reconciliation.
   */
  turnKey: string;
  msgId: string;
  userMessage: {
    text: string;
    attachments: ReadonlyArray<unknown>;
    /**
     * Wall-clock millisecond timestamp captured when `send()` was
     * dispatched. Distinct from `endedAt` — the user-visible
     * "submitted at" time. The transcript's user row reads this for
     * its timestamp display while the turn's code row reads
     * `endedAt`, so the row identifier line can post the moment the
     * user hits submit instead of waiting for the assistant's reply.
     */
    submitAt: number;
  };
  thinking: string;
  assistant: string;
  toolCalls: ReadonlyArray<ToolCallState>;
  /**
   * Control requests (`control_request_forward`) the user answered
   * during this turn — the permanent transcript artifact of a
   * permission prompt per [D13]. Empty for the common case of a turn
   * with no permission prompts. A request that was never answered (the
   * turn was interrupted while `awaiting_approval`) does not land here:
   * only the resolved decision is durable.
   *
   * Step 18 commits permission records (`is_question: false`);
   * `AskUserQuestion` records (`is_question: true`) join this array at
   * #step-19.
   */
  controlRequests: ReadonlyArray<ControlRequestRecord>;
  /**
   * @deprecated Use {@link turnEndReason}. Derived from `turnEndReason`
   * so the two never diverge (`"complete"` → `"success"`; everything
   * else → `"interrupted"`). Kept in place for incremental consumer
   * migration; remove once all callers have moved.
   */
  result: "success" | "interrupted";
  endedAt: number;

  /**
   * Pure wall-clock duration of the turn: `endedAt - userMessage.submitAt`.
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
 * A resolved `control_request_forward` — the durable record committed
 * into `TurnEntry.controlRequests` once the user answers. `request` is
 * the original forward (so the rendering layer can re-show the tool,
 * input, reason, and suggestions exactly as they were asked);
 * `decision` is how the user answered; `respondedAt` is the wall-clock
 * millisecond timestamp of the answer.
 *
 * Step 18 records permission decisions (`allow` / `deny`). When
 * `AskUserQuestion` history joins this record at #step-19, `decision`
 * gains the answer-bearing variant.
 */
export interface ControlRequestRecord {
  request: ControlRequestForward;
  decision: "allow" | "deny";
  respondedAt: number;
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
 * Per-category identity for the `/context`-style breakdown. Mirrors
 * tugcode's wire-frame `ContextBreakdownCategoryId` enum. `mcp_tools`
 * is intentionally absent — Tug treats MCP as out of scope; no MCP
 * id ever appears on the wire, in this snapshot, or in the
 * persisted ledger row.
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
   * Permission prompts the user has answered during the in-flight turn,
   * in the order they resolved. The reducer accumulates each
   * `respondApproval` resolution into `controlRequestLog` and freezes
   * the array into `TurnEntry.controlRequests` at `turn_complete`,
   * resetting on every turn boundary.
   *
   * Mirrored onto the snapshot so the in-flight transcript row can
   * render the resolved record(s) in the same slot the live dialog
   * occupied — the dialog→record transition stays *in place* instead
   * of leaving the slot empty until the streaming row is replaced by
   * the committed row at turn-complete.
   *
   * The reference is preserved across snapshot rebuilds while the
   * underlying array doesn't change; the reducer rebuilds it
   * (`[...prev, record]`) only when a new resolution is recorded, so
   * `useSyncExternalStore` consumers ([L02]) get `Object.is` stability
   * during quiescent renders.
   */
  controlRequestLog: ReadonlyArray<ControlRequestRecord>;
  queuedSends: number;

  transcript: ReadonlyArray<TurnEntry>;

  /**
   * The in-flight user message — set the moment `send()` is dispatched
   * and cleared exactly when the matching `TurnEntry` is committed to
   * `transcript` (`turn_complete(success)`) or the turn is interrupted
   * (`turn_complete(error)` / `interrupted`). Mirrors the reducer's
   * `pendingUserMessage`; the field name change to `inflightUserMessage`
   * matches the `inflight.*` streaming-path naming so the in-flight
   * vocabulary is consistent at the snapshot surface.
   *
   * Drives the in-flight `user` row in the Tide card transcript: the
   * `TideTranscriptDataSource` (Step 10) reports `transcript.length * 2
   * + (inflightUserMessage ? 2 : 0)` items, with the last two indices
   * representing the in-flight pair when the field is non-null.
   *
   * The reference is shared with the reducer's `pendingUserMessage`,
   * so identity is stable across snapshot rebuilds while the same
   * pending message is in flight — `useSyncExternalStore` consumers
   * downstream get the `Object.is` stability they need ([D10]).
   */
  inflightUserMessage: {
    text: string;
    atoms: ReadonlyArray<AtomSegment>;
    /**
     * Wall-clock millisecond timestamp captured when `send()` was
     * dispatched. Drives the in-flight user row's timestamp display so
     * the row can post the submit time the moment the user submits,
     * without waiting for the matching `TurnEntry` to commit.
     */
    submitAt: number;
    /**
     * Stable React-key seed for the in-flight cell pair, preserved
     * unchanged from `handleSend` through `handleTurnComplete` (the
     * committed `TurnEntry` carries the same value via
     * `TurnEntry.turnKey`). The transcript data source uses it to mint
     * `idForIndex` — same React key inflight + committed → no cell
     * unmount at turn boundary.
     */
    turnKey: string;
  } | null;

  /**
   * One-shot restore slot populated when the user interrupts a turn
   * before claude has produced any content (CASE A — `phase ===
   * "submitting"`, no `activeMsgId`). Carries the user's exact prompt
   * (text + atoms) at submit time so the prompt-entry editor can seed
   * its document for re-edit.
   *
   * Lifecycle:
   *   - Set by `handleInterrupt` the moment `interrupt()` fires while
   *     the phase is `submitting`. Simultaneously cleared:
   *     `pendingUserMessage` (so the in-flight pair stops rendering),
   *     `queuedSends` (current `interrupt()` semantics).
   *   - Consumed by the prompt entry via
   *     {@link CodeSessionStore.consumePendingDraftRestore} once it has
   *     applied the restore to the editor. The consume call is what
   *     transitions this slot back to `null`; until then it survives
   *     subsequent snapshot rebuilds so a remount or late mount of the
   *     prompt entry still picks it up.
   *
   * The reference is preserved across snapshot rebuilds while the slot
   * is non-null so `useSyncExternalStore` consumers ([L02]) get
   * `Object.is` stability — a `useLayoutEffect` keyed on the slot's
   * identity fires once per restore, not on every parent render.
   *
   * The wire's `turn_complete(error)` that arrives after the interrupt
   * round-trip does NOT clear or repopulate this slot — the reducer
   * routes that path via the internal `interruptOrigin` flag and skips
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
   * read it while `inflightUserMessage !== null` and fall back to the
   * last committed turn's window otherwise; the committed `cost_update`
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
      | "resume_failed";
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

