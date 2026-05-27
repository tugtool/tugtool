/**
 * Pure reducer for `CodeSessionStore`.
 *
 * Step 3 implements the basic `idle → submitting → awaiting_first_token
 * → streaming → idle` round-trip. Later steps extend this with streaming
 * delta accumulation (4), tool lifecycle (5), control forwards (6),
 * interrupt + queue (7), errored triggers (8), JSONL replay bracketing,
 * and the cold-boot replay-clock derivations
 * (`replayPreflightActive` / `replaySoftBudgetElapsed` /
 * `replayTimeoutDwellActive`) that drive the resume placeholder /
 * banner UX.
 *
 * Step 5 ([D07]) lifts the substrate to a full Message-sequence
 * model. `state.scratch` re-keys from `Map<msgId, …>` to
 * `Map<turnKey, ScratchEntry>` (one scratch entry per turn, spanning
 * every msgId iteration of the turn's tool-use loop). The committed
 * `TurnEntry` exposes `messages: ReadonlyArray<Message>` instead of
 * the old paired `userMessage` / `thinking` / `assistant` /
 * `toolCalls` fields. `pendingUserMessage` → `pendingTurn`;
 * `toolCallMap` retires (folded into `ScratchEntry.toolCallIndex`).
 *
 * `transcript` intentionally does NOT live here — the class wrapper
 * owns it and appends via `AppendTranscript` effects ([D04] / [D11]).
 *
 * Timers are also outside the reducer: the `schedule_timer` /
 * `cancel_timer` effects are processed by the dispatch loop, which
 * keeps a `Map<string, TimerHandle>` and dispatches the named tick
 * event back into the reducer when a timer fires. The reducer stays
 * pure and time-independent.
 */

import type { AtomSegment } from "../tug-atom-img";
import type { ContentBlock } from "../../protocol";
import type { Effect } from "./effects";
import type {
  AddUserMessageEvent,
  AssistantTextEvent,
  AttachmentRejectedEvent,
  CancelQueuedSendActionEvent,
  CodeSessionEvent,
  ContentBlockStartEvent,
  ContextBreakdownEvent,
  ControlRequestForwardEvent,
  CostUpdateEvent,
  ReplayCompleteEvent,
  ReplayStartedEvent,
  RespondApprovalActionEvent,
  RespondQuestionActionEvent,
  SendActionEvent,
  SessionInitEvent,
  SessionNotOwnedEvent,
  SessionStateErroredEvent,
  SessionUnknownEvent,
  StreamingUsageEvent,
  ThinkingTextEvent,
  ToolResultEvent,
  ToolUseEvent,
  ToolUseStructuredEvent,
  TurnCompleteEvent,
  WakeStartedEvent,
  WireErrorEvent,
} from "./events";
import type {
  ActiveTurnSnapshot,
  AssistantText,
  AssistantThinking,
  CardSessionMode,
  CodeSessionPhase,
  ContextBreakdownSnapshot,
  ControlRequestForward,
  CostSnapshot,
  LastReplayResult,
  LiveMessageUsage,
  Message,
  ToolUseMessage,
  TransportState,
  TurnEndReason,
  TurnEntry,
  UserMessage,
  WakeTrigger,
} from "./types";
import { tugDevLogStore } from "../tug-dev-log-store/tug-dev-log-store";
import {
  deriveTurnTelemetry,
  mergeTurnTelemetry,
  readUsage,
  type TurnTelemetry,
} from "./telemetry";

// ---------------------------------------------------------------------------
// Per-turn scratch ([D07])
// ---------------------------------------------------------------------------

/**
 * One scratch entry per turn — accumulates the wire's Message sequence
 * across every msgId iteration of the turn ([D07] § Multi-msgId-per-
 * turn handling). The `messages` array is the substrate's primary
 * payload; `blockIndex` and `toolCallIndex` are O(1) lookup tables
 * into it.
 *
 * `blockIndex` keys are `${msg_id}:${block_index}` — the wire's
 * coordinate for one content block. `handleContentBlockStart` mints a
 * Message and writes its array index here; `handleTextDelta` reads
 * this index to find the Message to mutate.
 *
 * `toolCallIndex` keys are `tool_use_id`. The mint at
 * `handleContentBlockStart` (for `kind: "tool_use"`) populates both
 * indices; subsequent `tool_use` (input fill), `tool_result`, and
 * `tool_use_structured` events look up via `toolCallIndex` and mutate
 * the indexed `ToolUseMessage`.
 *
 * `systemNoteSeq` is the monotonic per-turn counter for
 * `SystemNote.messageKey` derivation (`${turnKey}-sys${seq}`).
 */
export interface ScratchEntry {
  turnKey: string;
  messages: Message[];
  blockIndex: Map<string, number>;
  toolCallIndex: Map<string, number>;
  systemNoteSeq: number;
}

/**
 * The in-flight turn marker — replaces `pendingUserMessage` under
 * [D07]. The substrate distinguishes "a turn is open" from "the open
 * turn carries a user submission" by the presence (or absence) of a
 * `user_message` Message at the head of `scratch[turnKey].messages` —
 * `isWake` is the explicit, non-derived bit for handlers that need to
 * branch on the source.
 */
export interface PendingTurn {
  turnKey: string;
  submitAt: number;
  isWake: boolean;
}

/** Derive a Message's `messageKey` from the wire coordinate it owns. */
function wireMessageKey(msgId: string, blockIndex: number): string {
  return `${msgId}-b${blockIndex}`;
}

/** Derive a user_message's `messageKey` from its turn. */
function userMessageKey(turnKey: string): string {
  return `${turnKey}-user`;
}

/** Derive a system_note's `messageKey` from its turn + monotonic seq. */
function systemNoteKey(turnKey: string, seq: number): string {
  return `${turnKey}-sys${seq}`;
}

/** Composite key into `ScratchEntry.blockIndex`. */
function blockKey(msgId: string, blockIndex: number): string {
  return `${msgId}:${blockIndex}`;
}

/**
 * Build a fresh `ScratchEntry`. The caller seeds `messages` with the
 * turn's opening Messages (e.g., the `user_message` for a normal
 * turn, `[]` for a wake) and the indices are initialized empty —
 * wire-derived Messages mint into `blockIndex` (and `toolCallIndex`
 * for tool_use) as `content_block_start` events arrive.
 */
function newScratchEntry(
  turnKey: string,
  initialMessages: Message[],
): ScratchEntry {
  return {
    turnKey,
    messages: initialMessages,
    blockIndex: new Map(),
    toolCallIndex: new Map(),
    systemNoteSeq: 0,
  };
}

/**
 * Replace `scratch[turnKey]` via copy-on-write at the smallest
 * container that changes ([D07] mutation discipline). Returns a fresh
 * `Map<turnKey, ScratchEntry>` for the next state slot; other turns'
 * entries stay reference-identical.
 */
function withScratchEntry(
  scratch: ReadonlyMap<string, ScratchEntry>,
  turnKey: string,
  entry: ScratchEntry,
): Map<string, ScratchEntry> {
  const next = new Map(scratch);
  next.set(turnKey, entry);
  return next;
}

/**
 * Iterate a turn's `tool_use` Messages — the substrate's replacement
 * for today's `toolCallMap.values()`. Pure over the entry's messages
 * array; preserves arrival order.
 */
function* toolUseMessages(
  entry: ScratchEntry | undefined,
): IterableIterator<ToolUseMessage> {
  if (entry === undefined) return;
  for (const m of entry.messages) {
    if (m.kind === "tool_use") yield m;
  }
}

/**
 * Predicate driving the `tool_work → streaming` transition: every
 * tool_use Message in the turn's scratch must be terminal
 * (`done` / `error`). An empty iteration counts as "all done" but
 * the reducer only calls this after a state-changing tool event, so
 * the empty case never triggers a spurious return.
 */
function allToolsTerminal(entry: ScratchEntry | undefined): boolean {
  for (const m of toolUseMessages(entry)) {
    if (m.status !== "done" && m.status !== "error") return false;
  }
  return true;
}

/** Reducer-internal state. Not exposed to consumers. */
export interface CodeSessionState {
  phase: CodeSessionPhase;
  transportState: TransportState;

  tugSessionId: string;
  displayLabel: string;
  /**
   * Captured at construction from the per-card `CardSessionBinding`'s
   * `sessionMode`. Mirrored onto `CodeSessionSnapshot.sessionMode` for
   * pure-derivation consumers. Reducer transitions never mutate this
   * field — a re-bind builds a fresh state via `createInitialState`,
   * and the in-flight reducer is mode-agnostic for everything except
   * derivations that read the snapshot.
   */
  sessionMode: CardSessionMode;

  activeMsgId: string | null;
  /**
   * Per-turn scratch ([D07]) — one entry per turn, keyed by `turnKey`,
   * spanning every msgId iteration of the turn's tool-use loop. The
   * shift from `Map<msgId, …>` was a correctness fix: today's
   * substrate dropped intermediate iterations' Messages at commit
   * because `buildTurnEntry` only read `scratch[activeMsgId]`.
   *
   * The entry's `toolCallIndex` field absorbs what `toolCallMap` used
   * to hold (toolUseId → array index instead of toolUseId → state),
   * so tool lookup stays O(1) and there's no parallel storage to
   * drift out of sync with the Message sequence.
   */
  scratch: Map<string, ScratchEntry>;
  pendingApproval: ControlRequestForward | null;
  pendingQuestion: ControlRequestForward | null;
  prevPhase: CodeSessionPhase | null;
  /**
   * The in-flight turn marker — replaces the [D07]-superseded
   * `pendingUserMessage`. Set the moment `send()` or
   * `handleWakeStarted` opens a turn; cleared at commit / interrupt /
   * transport_close. Carries the React-key seed (`turnKey`) that
   * `TurnEntry` adopts at commit (so the row's React identity is
   * stable across the inflight → committed transition) plus the
   * `isWake` discriminator the substrate uses to branch wake handling
   * without resurrecting the [D06] empty-text sentinel.
   */
  pendingTurn: PendingTurn | null;
  /**
   * One-shot draft restore for CASE A interrupt — `interrupt()` fired
   * while `phase === "submitting"`, before claude produced any content
   * keyed to a `msg_id`. The reducer captures the in-flight user
   * submission's text + atoms here so the prompt entry can seed the
   * editor with them for re-edit. Cleared by `consume_draft_restore`
   * (the prompt entry's signal that it has applied the restore) —
   * never overwritten elsewhere; a brand-new CASE A interrupt while
   * a previous restore still sits in this slot replaces the contents
   * (the editor effectively "missed" the prior restore, but losing
   * the older draft is preferable to stranding the most recent one).
   *
   * Mirrored onto the public snapshot as
   * `CodeSessionSnapshot.pendingDraftRestore`. The reference is shared
   * with the snapshot so identity is stable across snapshot rebuilds
   * (per the same [D10]-style stability contract previously honored
   * by `pendingUserMessage`).
   */
  pendingDraftRestore: {
    text: string;
    atoms: ReadonlyArray<AtomSegment>;
  } | null;
  /**
   * Counter of outstanding CASE A wire echoes the reducer expects to
   * suppress. Incremented every time `handleInterrupt` fires from
   * `phase === "submitting"`; decremented when `handleTurnComplete`'s
   * suppression gate matches and drops the echo.
   *
   * Why a counter and not a boolean: a single bit can't represent
   * multiple in-flight aborted cycles, and the wire doesn't carry a
   * client-assigned correlation id. The user can rapid-fire
   * interrupts (CASE A → re-submit → CASE A → …) before any single
   * wire echo lands; each pending abort needs its own slot. The
   * counter rises with the user's actions and falls as wire echoes
   * arrive in FIFO order.
   *
   * Why this is correct under FIFO wire ordering: tugcode processes
   * inbound user_message frames sequentially via
   * `await turn.completion`, so the aborted cycle's eventual
   * `turn_complete(error)` (which the abort probe shows carries
   * `msg_id: ""` for a no-content abort) always lands before any
   * frame from the next cycle. At the moment the gate fires,
   * `state.activeMsgId === null` confirms no live turn has produced
   * content yet — the echo can only belong to an aborted cycle.
   *
   * Reset to 0 on `transport_close` (any stranded echoes are lost
   * with the dead wire — letting them carry across a reconnect would
   * falsely suppress the next live turn's pre-content error). Not
   * exposed on the snapshot.
   */
  pendingCaseAEchoes: number;
  /**
   * Send actions queued while the session is busy. Each entry carries
   * the `turnKey` that was minted at the queueing `send` event; when
   * the queue drains at `handleTurnComplete` the queued turnKey is
   * reused as the new in-flight turn's React-key seed. Carrying the
   * key with the queued send (rather than minting at drain time)
   * keeps the reducer pure.
   *
   * `content` is the Anthropic-API content-block array forwarded on
   * the `send-frame` effect at queue-flush time. `text` + `atoms`
   * are the already-synthesized substrate (produced by
   * `synthesizeUserMessageFromBlocks` at the queueing `send`) —
   * synthesis happens once per submission regardless of whether the
   * message goes active or queued. The bytes-store entries are also
   * minted at synthesis time and persist across the queue gap (the
   * bytes-store is per-card-mount).
   *
   * Same field names as {@link QueuedSend} (the public snapshot
   * projection) so the snapshot can pass the array reference
   * through without reshaping — preserves `Object.is` stability for
   * `useSyncExternalStore` consumers ([L02]).
   *
   * Per [Step 5c](../../../roadmap/tide-atoms.md#step-5c).
   */
  queuedSends: Array<{
    content: ContentBlock[];
    text: string;
    atoms: AtomSegment[];
    turnKey: string;
  }>;
  lastError: {
    cause:
      | "session_state_errored"
      | "transport_closed"
      | "wire_error"
      | "session_unknown"
      | "session_not_owned"
      | "resume_failed"
      // Inline-attachment rejection at drop / paste time. Distinct
      // cause from transport / wire errors because:
      //  - the session is otherwise healthy (the next submit can
      //    proceed without retry / reconnect),
      //  - the message names a specific file the user can act on
      //    (resize, convert, drop a smaller image),
      //  - it self-clears on the next successful turn commit per
      //    the standard `lastError: null` reset path.
      // Originates from `CodeSessionStore.publishAttachmentError`,
      // dispatched as `{ type: "attachment_rejected", message }`.
      // Per [Table T01](roadmap/tide-atoms.md#t01-failure-modes).
      | "attachment_rejected";
    message: string;
    at: number;
  } | null;
  lastCost: CostSnapshot | null;
  /**
   * Live intra-turn token usage — the LATEST `streaming_usage` wire
   * frame so the `Tokens` / `Context` status cells can climb mid-turn.
   * `null` between turns.
   *
   * Not an accumulation: `observedInput` grows monotonically across a
   * turn's API calls, so the most recent frame is always the current
   * window. `handleStreamingUsage` replaces this field on each frame.
   *
   * Lifecycle: reset to `null` at `handleSend` (turn start), replaced
   * by `handleStreamingUsage` across the turn, and reset to `null`
   * again at `handleTurnComplete` (via `resetPerTurnTelemetry`) — the
   * committed `cost_update` carries the same last-iteration usage and
   * supersedes the live frame. The reducer assigns a fresh object only
   * when a frame lands; quiescent reductions preserve the reference
   * for [L02] `Object.is` stability.
   */
  liveTurnUsage: LiveMessageUsage | null;
  /**
   * `window(0)` — the resident context before any turn. Captured once,
   * from the `observedInput` (`input + cache_read + cache_creation`)
   * of the session's first telemetry iteration: the first
   * `streaming_usage` frame, or the first `cost_update` as a fallback.
   * Never overwritten once set. `null` until the first frame lands.
   *
   * Session-level — NOT reset at turn boundaries. The transcript
   * window-walk uses it as the prior window for turn 1. Restored on
   * resume from the first replayed `turn_complete`'s inlined
   * `TurnTelemetry.sessionInitTokens`.
   */
  sessionInitTokens: number | null;
  /**
   * Most-recent `/context`-style breakdown captured from a
   * `context_breakdown` wire frame. Projected onto
   * `CodeSessionSnapshot.lastContextBreakdown` with reference
   * stability — the reducer assigns a fresh object only when a new
   * frame lands (handleContextBreakdown); quiescent reductions
   * preserve the reference so [L02] consumers see `Object.is`
   * stability.
   */
  lastContextBreakdown: ContextBreakdownSnapshot | null;
  /**
   * Set of msg_ids already committed to the transcript. Used to
   * dedupe `turn_complete` events whose msg_id has already produced a
   * TurnEntry — defense-in-depth against a supervisor that
   * accidentally re-emits a turn (a misordered replay-vs-live during
   * a fast reconnect, a manual dev-tool replay) so the worst case is
   * a silent no-op, not a duplicate transcript row.
   *
   * **Assistant-side-first dedupe** (per [D14]). In the steady-state
   * path the ids stored here are claude's *real* `msg_id` values, set
   * onto `activeMsgId` by the first content event of each turn
   * (`assistant_text` / `thinking_text` / `tool_use` /
   * `content_block_start`) and read back here at `handleTurnComplete`.
   *
   * The no-content interrupt fallback ([D13] / `#spec-reducer-state`
   * rule 2) also adds an entry: when the translator emits an
   * orphan-synthesis `turn_complete` carrying a synthesized opener
   * id (`u-<n>` for user-text openers, `w-<n>` for wake openers),
   * `handleTurnComplete` falls through to a `pendingTurn`-based
   * commit and adds the synthesized id to this set so a duplicate
   * orphan-synthesis frame (replay overlap, dev-tool re-emission)
   * is deduped on second arrival rather than committing a phantom
   * second TurnEntry. The synthesized ids are unique per
   * `orphanCounter`, so cross-orphan collisions don't happen in
   * normal operation. See `reducer.no-content-fallback.test.ts`.
   *
   * Maintained alongside the class wrapper's `_transcript` array. The
   * reducer adds entries on `turn_complete`; `dispose` and clear
   * paths are owned by the wrapper.
   */
  committedMsgIds: Set<string>;
  /**
   * Outcome of the most recent JSONL replay window. `null` between
   * windows; populated on every `replay_complete` (success and error
   * variants). The class wrapper mirrors this to
   * `CodeSessionSnapshot.lastReplayResult`.
   */
  lastReplayResult: LastReplayResult | null;
  /**
   * Replay-clock derived flags. Exposed through the snapshot identically-
   * named (`replayPreflightActive`, `replaySoftBudgetElapsed`,
   * `replayTimeoutDwellActive`); see `types.ts` for semantics. Driven
   * by `bind_resume_acknowledged` / `replay_started` / `replay_complete` /
   * `transport_close` / `tick_*` events; the dispatch loop manages the
   * actual `setTimeout` handles via `schedule_timer` / `cancel_timer`
   * effects so the reducer stays pure.
   */
  replayPreflightActive: boolean;
  replaySoftBudgetElapsed: boolean;
  replayTimeoutDwellActive: boolean;

  // -------------------------------------------------------------------------
  // Per-turn telemetry — populated incrementally during a turn, frozen
  // onto the committed `TurnEntry` at `handleTurnComplete` and reset at
  // each turn boundary.
  // -------------------------------------------------------------------------

  /**
   * `Date.now()` when the in-flight turn entered `awaiting_approval`
   * (permission OR question dialog). `null` while no dialog is open.
   * Cleared on every dialog response, on interrupt, on transport-close,
   * and at turn boundaries — the awaiting-approval clock has at most
   * one in-progress interval at any moment.
   */
  awaitingApprovalSince: number | null;
  /**
   * Cumulative ms paused on `TugInlineDialog` so far in the in-flight
   * turn. Each closed dialog interval folds into this accumulator;
   * `liveTurnAwaitingApprovalMs` adds the live in-progress interval
   * (from `awaitingApprovalSince`) on top.
   */
  awaitingApprovalAccumulatedMs: number;
  /**
   * `Date.now()` when the transport first left `online` during the
   * in-flight turn (either to `offline` or `restoring`). `null` while
   * the transport is online. Set by `handleTransportClose`, cleared by
   * `handleTransportSettled` after accumulating the elapsed downtime.
   */
  transportNonOnlineSince: number | null;
  /**
   * Cumulative ms the transport was not `"online"` during the
   * in-flight turn. `liveTurnTransportDowntimeMs` folds in the live
   * in-progress interval (from `transportNonOnlineSince`) on top.
   */
  transportDowntimeAccumulatedMs: number;
  /**
   * Number of transport reconnects (`restoring → online` transitions)
   * observed during the in-flight turn. Used to populate
   * `TurnEntry.reconnectCount` at completion.
   */
  transportReconnectCount: number;
  /**
   * `Date.now()` of the most recent stream event observed during the
   * in-flight turn (assistant_delta / tool_use / tool_result /
   * tool_use_structured). `null` until the first stream event lands.
   * Used to compute the inter-event gap that feeds `maxStreamGapMs`.
   */
  lastStreamEventAt: number | null;
  /**
   * Longest single inter-event silence (ms) observed during the
   * in-flight turn. `0` until at least two stream events have landed.
   */
  maxStreamGapMs: number;
  /**
   * `Date.now()` of the first `assistant_delta` of the in-flight turn,
   * for the TTFT (time-to-first-token) latency. `null` if no assistant
   * output has landed yet.
   */
  firstAssistantDeltaAt: number | null;
  /**
   * `Date.now()` of the first `tool_use` of the in-flight turn, for the
   * TTFTC (time-to-first-tool-call) latency. `null` if no tool call has
   * landed yet.
   */
  firstToolUseAt: number | null;
  /**
   * Snapshot of `lastCost` taken at `handleSend` so the per-turn cost
   * delta can be computed at `handleTurnComplete` against the
   * `lastCost` snapshot current at completion. `null` for the first
   * turn of a session (the helper degenerates the delta to `after`).
   */
  costAtSubmit: CostSnapshot | null;
  /**
   * `true` from the moment `handleInterrupt` fires until the matching
   * `handleTurnComplete` (any reason) clears it. Drives the
   * INTERRUPTING lifecycle state in the per-turn coordinator matrix.
   */
  interruptInFlight: boolean;
  /**
   * Wall-clock ms when `handleInterrupt` opened the current
   * CASE B interrupt round-trip; `null` while no interrupt is in
   * flight. Companion to {@link interruptInFlight} (which is the
   * latched bool) — this field is the entry-side timestamp the
   * live-clock helper folds in via the yellow-axis union.
   *
   * The two fields could be inferred from each other (bool ↔
   * timestamp), but keeping them parallel matches the
   * `awaitingApprovalSince` / `transportNonOnlineSince` pattern and
   * lets `closeInterruptInFlightInterval` push a closed `[start, end]`
   * pair into {@link interruptInFlightIntervals} without re-deriving
   * the start time.
   */
  interruptInFlightSegmentStartedAt: number | null;
  /**
   * Closed pause-axis intervals observed within the current in-flight
   * turn, as `[startMs, endMs]` pairs in chronological order. The
   * three arrays mirror the three scalar accumulators / segment-start
   * timestamps and are appended to whenever the matching segment
   * closes:
   *
   *   - awaiting-approval: closes when a dialog (permission OR
   *     question) is answered, or when an interrupt fires while a
   *     dialog is open
   *   - transport-downtime: closes when the wire returns to `online`
   *     via `transport_settled`
   *   - interrupt-in-flight: closes at the matching `turn_complete`
   *     (the only path that flips `interruptInFlight` back to false)
   *
   * Reset to `[]` at every new turn start (`handleSend`). They are
   * deliberately NOT reset at `handleTurnComplete` — the closed
   * intervals from the just-ended turn linger through the brief idle
   * gap so the reducer-state inspector can show the full pause
   * history of the most recent turn, and so the next `handleSend`
   * does the canonical reset in one place.
   *
   * The arrays sit alongside the existing scalar accumulators
   * (`awaitingApprovalAccumulatedMs` / `transportDowntimeAccumulatedMs`).
   * The scalars continue to drive the committed `TurnEntry` per-turn
   * telemetry; the arrays are an additional, parallel projection that
   * the pure live-derivation helper (`deriveInflightActiveMs`) unions
   * across axes so overlapping pauses contribute only once. See plan
   * `#step-20-4-5-a` for the overlap-correctness rationale — naive
   * scalar sums over-subtract under any pair-overlap, the union is
   * the smallest fix.
   */
  awaitingApprovalIntervals: ReadonlyArray<readonly [number, number]>;
  transportDowntimeIntervals: ReadonlyArray<readonly [number, number]>;
  interruptInFlightIntervals: ReadonlyArray<readonly [number, number]>;
  /**
   * Per-tool-call start timestamps captured at `handleContentBlockStart`
   * (`kind: "tool_use"`), used by `handleToolResult` to compute the
   * matching `ToolUseMessage.toolWallMs`. Reducer-internal — never
   * exposed on the snapshot. Cleared on turn boundaries with the
   * rest of the per-turn state.
   */
  toolUseStartedAt: Map<string, number>;
  /**
   * Trigger metadata for the in-flight wake turn (`phase === "waking"`),
   * `null` otherwise. Set by `handleWakeStarted` from the wire
   * `wake_started.wake_trigger` payload; cleared by `handleTurnComplete`'s
   * `waking → idle` commit branch. Mirrored unchanged onto
   * `CodeSessionSnapshot.wakeTrigger` for stable `Object.is` identity
   * across quiescent snapshot rebuilds ([L02]).
   */
  wakeTrigger: WakeTrigger | null;
}

/**
 * Replay-clock millisecond constants. Re-exported from
 * `code-session-store.ts` as the public surface; the reducer uses
 * them inline where it emits `schedule_timer` effects.
 *
 * - `REPLAY_SOFT_BUDGET_MS` — once `phase === "replaying"` has been
 *   held for this long without leaving, `replaySoftBudgetElapsed`
 *   flips true. Drives the count-aware banner copy per [D10].
 * - `REPLAY_TIMEOUT_DWELL_MS` — after a `replay_complete` carrying a
 *   `replay_timeout` outcome, `replayTimeoutDwellActive` stays true
 *   for this long so the user has a chance to read the failure copy
 *   before the banner dismisses.
 * - `REPLAY_PREFLIGHT_TIMEOUT_MS` — last-resort escape hatch for the
 *   preflight window: if `replay_started` somehow never lands (e.g.
 *   a tugcode that didn't run replay at all), the preflight banner
 *   dismisses on its own at this mark instead of hanging forever.
 *   Sized large enough to easily cover a normal cold boot's 5–10s
 *   wait while still bounding the worst case.
 */
export const REPLAY_SOFT_BUDGET_MS = 2000;
export const REPLAY_TIMEOUT_DWELL_MS = 1500;
export const REPLAY_PREFLIGHT_TIMEOUT_MS = 12_000;

/** Build the initial state for a freshly constructed store. */
export function createInitialState(
  tugSessionId: string,
  displayLabel: string,
  sessionMode: CardSessionMode,
): CodeSessionState {
  return {
    phase: "idle",
    transportState: "online",
    tugSessionId,
    displayLabel,
    sessionMode,
    activeMsgId: null,
    scratch: new Map(),
    pendingApproval: null,
    pendingQuestion: null,
    prevPhase: null,
    pendingTurn: null,
    pendingDraftRestore: null,
    pendingCaseAEchoes: 0,
    queuedSends: [],
    lastError: null,
    lastCost: null,
    liveTurnUsage: null,
    sessionInitTokens: null,
    lastContextBreakdown: null,
    committedMsgIds: new Set(),
    lastReplayResult: null,
    replayPreflightActive: false,
    replaySoftBudgetElapsed: false,
    replayTimeoutDwellActive: false,
    awaitingApprovalSince: null,
    awaitingApprovalAccumulatedMs: 0,
    transportNonOnlineSince: null,
    transportDowntimeAccumulatedMs: 0,
    transportReconnectCount: 0,
    lastStreamEventAt: null,
    maxStreamGapMs: 0,
    firstAssistantDeltaAt: null,
    firstToolUseAt: null,
    costAtSubmit: null,
    interruptInFlight: false,
    interruptInFlightSegmentStartedAt: null,
    awaitingApprovalIntervals: [],
    transportDowntimeIntervals: [],
    interruptInFlightIntervals: [],
    toolUseStartedAt: new Map(),
    wakeTrigger: null,
  };
}

// ---------------------------------------------------------------------------
// Transition handlers
// ---------------------------------------------------------------------------

function handleSend(
  state: CodeSessionState,
  event: SendActionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Submit is gated to idle/errored. While replaying, submit is
  // refused at the snapshot level (`canSubmit: false`); the reducer
  // drops the action defensively in case a UI race fires `send`
  // anyway. The queue is also bypassed — a queued message that
  // commits after replay completes would surprise the user with a
  // dispatch they don't remember initiating.
  if (state.phase === "replaying") {
    return { state, effects: [] };
  }

  if (state.phase === "idle" || state.phase === "errored") {
    const submitAt = Date.now();
    const userMessage: UserMessage = {
      kind: "user_message",
      messageKey: userMessageKey(event.turnKey),
      createdAt: submitAt,
      text: event.text,
      attachments: event.atoms,
      submitAt,
    };
    const next: CodeSessionState = {
      ...state,
      phase: "submitting",
      pendingTurn: {
        turnKey: event.turnKey,
        submitAt,
        isWake: false,
      },
      // Seed the scratch with the opening user_message so the
      // substrate carries the user submission as its first Message
      // (no separate paired field). Wire-derived assistant content
      // mints into the same scratch entry as `content_block_start`
      // events arrive.
      scratch: withScratchEntry(
        state.scratch,
        event.turnKey,
        newScratchEntry(event.turnKey, [userMessage]),
      ),
      // The user is moving on to a new turn. The prompt-entry editor
      // consumes `pendingDraftRestore` synchronously via
      // `useLayoutEffect` before user input is possible, so by the
      // time `send` fires the restore slot is moot — clear it for
      // cleanliness.
      //
      // `pendingCaseAEchoes` is deliberately NOT cleared here:
      // outstanding aborted-cycle echoes are still in flight on the
      // wire and must be matched against their respective suppression
      // slots. Wire FIFO ordering guarantees those echoes arrive
      // before any frame from this new cycle, so the counter drains
      // naturally as `handleTurnComplete`'s gate fires.
      pendingDraftRestore: null,
      // Snapshot the cost cursor so the per-turn delta is computed
      // against this submit point at completion. `null` on the first
      // turn of a session is fine — `extractTurnCost` degenerates the
      // delta to `after`.
      costAtSubmit: state.lastCost,
      // Clear last turn's live token accumulation — the new turn's
      // `streaming_usage` frames build a fresh `liveTurnUsage` from
      // scratch.
      liveTurnUsage: null,
      // Reset per-turn accumulators. `transportNonOnlineSince` is
      // owned by the transport handlers — leave it alone so a
      // disconnect that started before this submit still folds into
      // the turn correctly. The new per-turn interval arrays + the
      // interrupt segment-start ARE reset here (canSubmit gating
      // ensures the wire is online at submit time, so no
      // transport-downtime segment can carry over the boundary in a
      // way the next turn cares about; the array projection is
      // strictly per-turn).
      awaitingApprovalSince: null,
      awaitingApprovalAccumulatedMs: 0,
      transportDowntimeAccumulatedMs: 0,
      transportReconnectCount: 0,
      lastStreamEventAt: null,
      maxStreamGapMs: 0,
      firstAssistantDeltaAt: null,
      firstToolUseAt: null,
      interruptInFlight: false,
      interruptInFlightSegmentStartedAt: null,
      awaitingApprovalIntervals: [],
      transportDowntimeIntervals: [],
      interruptInFlightIntervals: [],
    };
    return {
      state: next,
      effects: [
        {
          kind: "send-frame",
          msg: {
            type: "user_message",
            // Anthropic-API content-block array built by
            // `buildWirePayload` in the store wrapper before
            // dispatch. The substrate's `UserMessage` retains the
            // synthesized `(text, atoms)` pair so the transcript chip
            // renderer can paint chips at the original positions.
            // Per [Step 5c].
            content: event.content,
          },
        },
      ],
    };
  }

  // Mid-turn send — enqueue. The queue is speculative: a single
  // entry flushes at `turn_complete(success)` via the single-tick
  // collapse in `handleTurnComplete`; `interrupt()` clears it.
  // The queued entry carries both the wire content blocks (for the
  // send-frame at flush time) and the already-synthesized substrate
  // (so the flush mints the new turn's `UserMessage` without
  // re-running the synthesizer at the reducer layer).
  const queuedSends = [
    ...state.queuedSends,
    {
      content: event.content,
      text: event.text,
      atoms: [...event.atoms],
      turnKey: event.turnKey,
    },
  ];
  return { state: { ...state, queuedSends }, effects: [] };
}

/**
 * Read the in-flight turn's `user_message` text + attachments, if
 * present. Returns `null` for a wake turn (no user_message Message at
 * head) or when no turn is in flight. Used by `handleInterrupt`'s
 * CASE A capture and by anywhere that needs the in-flight user
 * submission's payload.
 */
function readInflightUserMessage(state: CodeSessionState): UserMessage | null {
  const turnKey = state.pendingTurn?.turnKey;
  if (turnKey === undefined) return null;
  const entry = state.scratch.get(turnKey);
  if (entry === undefined) return null;
  const head = entry.messages[0];
  if (head !== undefined && head.kind === "user_message") return head;
  return null;
}

/**
 * Drop the in-flight turn's scratch entry. Returns a fresh scratch
 * Map with the entry removed (other turns' entries reference-stable).
 */
function withoutPendingTurnScratch(
  state: CodeSessionState,
): Map<string, ScratchEntry> {
  const turnKey = state.pendingTurn?.turnKey;
  if (turnKey === undefined) return new Map(state.scratch);
  const next = new Map(state.scratch);
  next.delete(turnKey);
  return next;
}

function handleInterrupt(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // Idle / errored: no in-flight turn to interrupt. Drop silently so
  // accidental calls from stale UI state don't spam the server with
  // noop interrupt frames.
  if (state.phase === "idle" || state.phase === "errored") {
    return { state, effects: [] };
  }

  // CASE A — interrupt fired before claude produced any answer-channel
  // content: no `assistant_text` delta and no `tool_use` yet
  // (`firstAssistantDeltaAt === null && firstToolUseAt === null`). The
  // dividing line between A and B is the first *answer* — thinking
  // does NOT cross it: a turn that has emitted only `thinking_text` is
  // still a clean pull-down, because thinking is not an answer and
  // there is nothing committable as an interrupted `TurnEntry`. (Phase
  // cannot express this line — `submitting → awaiting_first_token →
  // streaming` is a text-event count ladder driven identically by
  // `assistant_text` and `thinking_text`, so `phase` advances on
  // thinking alone; `firstAssistantDeltaAt` / `firstToolUseAt` are the
  // real "answer has begun" signals.) The user's intent is "pull it
  // back and re-edit" — capture the user submission into a one-shot
  // restore slot, drop the in-flight scratch so the transcript stops
  // rendering it, and return the phase to `idle` so the user can
  // resubmit immediately without waiting for the wire's
  // `turn_complete(error)` round-trip.
  //
  // Wire echo handling: increment `pendingCaseAEchoes` so the matching
  // `turn_complete(error)` is suppressed by the gate at the top of
  // `handleTurnComplete`. That gate keys on `state.activeMsgId ===
  // null` — which the reset below establishes — NOT on the echo's
  // `msg_id`, so it suppresses correctly whether the aborted cycle
  // carried no `msg_id` (the not-yet-started case, `msg_id: ""` —
  // verified via `tugcode/probe-case-a.ts`) or a real one (the
  // thinking-only case, where a `thinking_text` partial had already
  // bound `activeMsgId`). The counter (rather than a boolean) makes
  // back-to-back CASE A cancels and re-submit-before-echo races
  // correct: each abort claims its own pending suppression slot,
  // decremented in FIFO order as wire echoes arrive. Late content
  // frames hit their own phase guards and drop with phase `idle` —
  // no scratch leakage.
  if (
    state.firstAssistantDeltaAt === null &&
    state.firstToolUseAt === null
  ) {
    // Detect the wake context: an interrupt fired during `waking`
    // before any content has landed. A wake has no user submission
    // ([Q03] in `roadmap/tugplan-tide-session-wake.md`), so there is
    // nothing to route into the restore slot. Preserve any prior
    // restore so a wake pull-down doesn't clobber a stranded user
    // draft.
    const isWakePulldown = state.pendingTurn?.isWake === true;
    const inflightUser = isWakePulldown ? null : readInflightUserMessage(state);
    const restore =
      inflightUser !== null
        ? { text: inflightUser.text, atoms: inflightUser.attachments }
        : state.pendingDraftRestore;
    return {
      state: {
        ...state,
        phase: "idle",
        activeMsgId: null,
        scratch: withoutPendingTurnScratch(state),
        toolUseStartedAt: new Map(),
        pendingTurn: null,
        pendingDraftRestore: restore,
        // Wake pull-down clears the wake bracket marker — the wire
        // echo (`turn_complete(error)`) will arrive later and is
        // suppressed by `pendingCaseAEchoes` below, same as a normal
        // CASE A user pull-down.
        wakeTrigger: isWakePulldown ? null : state.wakeTrigger,
        pendingCaseAEchoes: state.pendingCaseAEchoes + 1,
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        queuedSends: [],
        // CASE A is locally terminal — phase goes straight to idle and
        // no TurnEntry will commit (the wire echo is suppressed).
        // Reset all per-turn accumulators here so a subsequent send
        // starts fresh; do NOT set interruptInFlight (the UI never
        // sees an INTERRUPTING state for CASE A — it's instant).
        awaitingApprovalSince: null,
        awaitingApprovalAccumulatedMs: 0,
        lastStreamEventAt: null,
        maxStreamGapMs: 0,
        firstAssistantDeltaAt: null,
        firstToolUseAt: null,
        // Transport-downtime accumulator is bounded to the active
        // turn boundary; reset on CASE A so a transport blip during
        // an aborted submit doesn't leak into the next turn.
        transportDowntimeAccumulatedMs: 0,
        transportReconnectCount: 0,
        // `transportNonOnlineSince` is owned by the transport
        // handlers; leave it as-is so an in-progress disconnect that
        // outlasts the abort still folds into the next turn correctly.
        // `costAtSubmit` is moot on CASE A (no commit); reset for
        // cleanliness.
        costAtSubmit: null,
        interruptInFlight: false,
        // Per-turn interval projections: clear alongside the scalar
        // accumulators so the next turn starts with empty pause
        // history. CASE A doesn't open an interrupt segment (the UI
        // never sees an INTERRUPTING state for a no-content abort),
        // so `interruptInFlightSegmentStartedAt` is already null
        // here — written explicitly for invariant clarity.
        interruptInFlightSegmentStartedAt: null,
        awaitingApprovalIntervals: [],
        transportDowntimeIntervals: [],
        interruptInFlightIntervals: [],
      },
      effects: [
        { kind: "send-frame", msg: { type: "interrupt" } },
        // `clear-inflight` is a no-op under the per-turn-paths
        // streaming architecture (each turn writes its own
        // `turn.${turnKey}.*` paths). The in-flight pair stops
        // rendering because `pendingTurn` is now `null`; a
        // thinking-only pull-down's per-turn streaming paths are simply
        // never read again — the next turn mints a fresh `turnKey`.
        // The effect is still emitted for turn-boundary symmetry with
        // `handleTurnComplete`.
        { kind: "clear-inflight" },
      ],
    };
  }

  // CASE B — interrupt fired after claude produced at least one
  // content frame (`activeMsgId` is set, scratch may hold partial
  // text/thinking/tool-use content). The wire's eventual
  // `turn_complete(result: "error")` commits a `TurnEntry` with
  // `result: "interrupted"` carrying whatever has accumulated.
  //
  // Interrupting from `awaiting_approval` must also abandon the
  // approval prompt: the `interrupt` frame dooms the turn, but the
  // following `turn_complete(error)` is a round-trip away. Between
  // those two moments the UI would otherwise see `pendingApproval`
  // still set and `phase === "awaiting_approval"`, which reads as a
  // live prompt on a dead turn. Clear pending + restore to the pre-
  // approval phase so subscribers observe a coherent
  // "interrupted-tool-work" state until `turn_complete(error)` lands.
  const restoredPhase =
    state.phase === "awaiting_approval"
      ? state.prevPhase ?? "streaming"
      : state.phase;

  // CASE B: the wire's eventual `turn_complete(error)` commits an
  // interrupted entry. Set `interruptInFlight` so the UI can show
  // an INTERRUPTING state during the round-trip; `handleTurnComplete`
  // clears it. Open the interrupt-in-flight segment at this same
  // instant so live-derivation can pause the in-flight active clock
  // for the round-trip's duration (the segment closes at
  // `handleTurnComplete` and the closed `[start, end]` pair lands on
  // `interruptInFlightIntervals`). If we were paused on a dialog,
  // fold the in-progress awaiting interval into the accumulator so
  // the committed entry reports the full time the user waited.
  const interruptOpenedAt = Date.now();
  return {
    state: {
      ...state,
      phase: restoredPhase,
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      queuedSends: [],
      interruptInFlight: true,
      interruptInFlightSegmentStartedAt: interruptOpenedAt,
      ...closeAwaitingApprovalInterval(state, interruptOpenedAt),
    },
    effects: [{ kind: "send-frame", msg: { type: "interrupt" } }],
  };
}

function handleConsumeDraftRestore(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // Idempotent — return the same state ref when the slot is already
  // null so the dispatch loop sees no change and skips the listener
  // notification. Callers can safely fire `consume_draft_restore` from
  // a `useLayoutEffect` keyed on `pendingDraftRestore` identity
  // without worrying about a notification storm.
  if (state.pendingDraftRestore === null) {
    return { state, effects: [] };
  }
  return {
    state: { ...state, pendingDraftRestore: null },
    effects: [],
  };
}

/**
 * Cancel one queued send, identified by the `turnKey` its ghost row
 * carries. The send was queued mid-turn but never dispatched, so
 * removing it is a pure local edit — no wire frame. The un-sent
 * prompt routes back through `pendingDraftRestore`; the prompt-entry
 * seeds the editor from it iff the editor is empty (a cancel never
 * clobbers in-progress content). A no-op when the `turnKey` is no
 * longer queued — it flushed first, racing the cancel.
 */
function handleCancelQueuedSend(
  state: CodeSessionState,
  event: CancelQueuedSendActionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  const target = state.queuedSends.find((q) => q.turnKey === event.turnKey);
  if (target === undefined) {
    return { state, effects: [] };
  }
  return {
    state: {
      ...state,
      queuedSends: state.queuedSends.filter(
        (q) => q.turnKey !== event.turnKey,
      ),
      pendingDraftRestore: { text: target.text, atoms: target.atoms },
    },
    effects: [],
  };
}

function handleSessionInit(
  state: CodeSessionState,
  _event: SessionInitEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // No state mutation. Tugdeck uses a single session id (`tugSessionId`,
  // chosen by the picker and known from CodeSessionStore construction)
  // for everything user-facing — history keys, picker matching, the
  // sessions record. Claude's `session_init.session_id` is verified to
  // equal `tugSessionId` by the lifecycle log on the wire side; if they
  // ever diverge it's a tugcast/tugcode bug, not something React state
  // has to mirror. Frame is consumed for its lifecycle log only.
  return { state, effects: [] };
}

/**
 * Update the stream-gap accumulator from a live stream event landing at
 * `now`. Replay events should NOT call this — replay does not
 * correspond to wall-clock event arrival. Returns the patch to fold
 * into the next state.
 */
function foldStreamEvent(
  state: CodeSessionState,
  now: number,
): { lastStreamEventAt: number; maxStreamGapMs: number } {
  if (state.lastStreamEventAt === null) {
    return { lastStreamEventAt: now, maxStreamGapMs: state.maxStreamGapMs };
  }
  const gap = Math.max(0, now - state.lastStreamEventAt);
  return {
    lastStreamEventAt: now,
    maxStreamGapMs: gap > state.maxStreamGapMs ? gap : state.maxStreamGapMs,
  };
}

// ---------------------------------------------------------------------------
// Message-sequence handlers ([D07])
// ---------------------------------------------------------------------------

/**
 * Phases in which wire events that mint or mutate Messages are
 * accepted. Matches the previous `handleTextDelta` / `handleToolUse`
 * guard surface. `submitting` / `awaiting_first_token` / `streaming`
 * are normal live progression; `tool_work` admits text and tool
 * follow-ups within an active tool-loop iteration; `replaying` /
 * `waking` are the two bracket phases ([D01]).
 */
function isContentBearingPhase(phase: CodeSessionPhase): boolean {
  return (
    phase === "submitting" ||
    phase === "awaiting_first_token" ||
    phase === "streaming" ||
    phase === "tool_work" ||
    phase === "replaying" ||
    phase === "waking"
  );
}

/**
 * `content_block_start` mint — idempotent per [D07]. The reducer
 * looks up `${msg_id}:${block_index}` in the active turn's
 * `blockIndex`; if already present, no-op (the live path minted, and
 * a snapshot replay is re-emitting the same envelope). Otherwise
 * mints a Message of the given `kind`, appends to the scratch
 * `messages` array, and indexes it. For `kind: "tool_use"` also
 * indexes by `tool_use_id` so subsequent tool events resolve in O(1).
 *
 * `handleContentBlockStart` does NOT advance the phase ladder —
 * `submitting → awaiting_first_token → streaming` advances on the
 * first text/tool delta, NOT on block-open ([D07] § Phase machine).
 * Block-open is metadata; the first delta is the first user-visible
 * event.
 */
function handleContentBlockStart(
  state: CodeSessionState,
  event: ContentBlockStartEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (!isContentBearingPhase(state.phase)) {
    return { state, effects: [] };
  }
  const turnKey = state.pendingTurn?.turnKey;
  if (turnKey === undefined) {
    return { state, effects: [] };
  }
  const entry = state.scratch.get(turnKey);
  if (entry === undefined) {
    return { state, effects: [] };
  }

  const key = blockKey(event.msg_id, event.block_index);
  if (entry.blockIndex.has(key)) {
    // Idempotent: already minted (live path beat us, or a snapshot
    // replay is re-emitting). State stays reference-identical so
    // `useSyncExternalStore` subscribers see no spurious churn.
    return { state, effects: [] };
  }

  const now = Date.now();
  const messageKey = wireMessageKey(event.msg_id, event.block_index);
  let message: Message;
  let toolUseId: string | undefined;
  switch (event.kind) {
    case "text":
      message = {
        kind: "assistant_text",
        messageKey,
        createdAt: now,
        text: "",
      } satisfies AssistantText;
      break;
    case "thinking":
      message = {
        kind: "assistant_thinking",
        messageKey,
        createdAt: now,
        text: "",
      } satisfies AssistantThinking;
      break;
    case "tool_use": {
      const id = typeof event.tool_use_id === "string" ? event.tool_use_id : "";
      const name = typeof event.tool_name === "string" ? event.tool_name : "";
      if (id === "" || name === "") {
        // Wire-input boundary regression — `content_block_start` for
        // tool_use missing the required id/name. Log a dev warning
        // and drop; minting a Message with empty identity would
        // orphan downstream lookups by `tool_use_id`.
        tugDevLogStore.warn(
          "code-session-store",
          "content_block_start tool_use missing id/name",
          { msgId: event.msg_id, blockIndex: event.block_index },
        );
        return { state, effects: [] };
      }
      toolUseId = id;
      message = {
        kind: "tool_use",
        messageKey,
        createdAt: now,
        toolUseId: id,
        toolName: name,
        input: {},
        status: "pending",
        result: null,
        structuredResult: null,
        toolWallMs: null,
      } satisfies ToolUseMessage;
      break;
    }
    default: {
      const _exhaustive: never = event.kind;
      void _exhaustive;
      return { state, effects: [] };
    }
  }

  const arrayIdx = entry.messages.length;
  const nextMessages: Message[] = [...entry.messages, message];
  const nextBlockIndex = new Map(entry.blockIndex);
  nextBlockIndex.set(key, arrayIdx);
  const nextToolCallIndex = new Map(entry.toolCallIndex);
  if (toolUseId !== undefined) {
    nextToolCallIndex.set(toolUseId, arrayIdx);
  }
  const nextEntry: ScratchEntry = {
    ...entry,
    messages: nextMessages,
    blockIndex: nextBlockIndex,
    toolCallIndex: nextToolCallIndex,
  };

  // Capture the tool wall-clock anchor on the mint (the wire's open
  // event), not the input-fill `tool_use` event — the open is the
  // moment the user-visible block appears.
  let toolUseStartedAt = state.toolUseStartedAt;
  if (toolUseId !== undefined && !state.toolUseStartedAt.has(toolUseId)) {
    // Live turns (including wakes) — capture wall-clock. Replay turns
    // don't produce real-time anchors, but the matching
    // `handleToolResult` only computes `toolWallMs` when not replaying,
    // so a captured replay anchor is harmless.
    toolUseStartedAt = new Map(state.toolUseStartedAt);
    toolUseStartedAt.set(toolUseId, now);
  }

  return {
    state: {
      ...state,
      scratch: withScratchEntry(state.scratch, turnKey, nextEntry),
      activeMsgId: event.msg_id,
      toolUseStartedAt,
    },
    effects: [],
  };
}

/**
 * `assistant_text` / `thinking_text` delta — mutate the Message minted
 * by the matching `content_block_start`. The `(msg_id, block_index)`
 * coordinate is the wire's correlation key and resolves to the
 * Message via `scratch[turnKey].blockIndex`. Each delta shallow-clones
 * the affected Message + the messages-array slot per [D07] mutation
 * discipline; other Messages stay reference-identical.
 *
 * Defensive: if no `content_block_start` ever opened this block (a
 * tugcode regression, or a wire-shape change), the delta defensively
 * mints the Message in place — losing the createdAt anchor but
 * preserving the text. A dev-log warning surfaces the irregularity
 * without breaking the user's session.
 */
function handleTextDelta(
  state: CodeSessionState,
  event: AssistantTextEvent | ThinkingTextEvent,
  kind: "assistant_text" | "assistant_thinking",
): { state: CodeSessionState; effects: Effect[] } {
  if (!isContentBearingPhase(state.phase)) {
    return { state, effects: [] };
  }
  const turnKey = state.pendingTurn?.turnKey;
  if (turnKey === undefined) {
    return { state, effects: [] };
  }
  const entry = state.scratch.get(turnKey);
  if (entry === undefined) {
    return { state, effects: [] };
  }

  const msgId = event.msg_id;
  const text = event.text ?? "";
  const key = blockKey(msgId, event.block_index);

  // Resolve the Message via blockIndex. If absent (no prior
  // `content_block_start` for this coordinate), defensively mint —
  // surfaces a wire-shape regression in dev-log but preserves the
  // text in the user-visible substrate.
  let arrayIdx = entry.blockIndex.get(key);
  let nextMessages: Message[];
  let nextBlockIndex = entry.blockIndex;
  let messageKey: string;
  if (arrayIdx === undefined) {
    tugDevLogStore.warn(
      "code-session-store",
      `${kind} delta without matching content_block_start; defensive mint`,
      { msgId, blockIndex: event.block_index },
    );
    messageKey = wireMessageKey(msgId, event.block_index);
    const minted: Message =
      kind === "assistant_text"
        ? {
            kind: "assistant_text",
            messageKey,
            createdAt: Date.now(),
            text,
          }
        : {
            kind: "assistant_thinking",
            messageKey,
            createdAt: Date.now(),
            text,
          };
    arrayIdx = entry.messages.length;
    nextMessages = [...entry.messages, minted];
    nextBlockIndex = new Map(entry.blockIndex);
    nextBlockIndex.set(key, arrayIdx);
  } else {
    const existing = entry.messages[arrayIdx];
    if (existing.kind !== kind) {
      // The minted Message's kind disagrees with this delta — a
      // tugcode bug (the wire shouldn't emit text deltas under a
      // tool_use block, etc.). Drop with a dev-log warning rather
      // than mutating across kinds.
      tugDevLogStore.warn(
        "code-session-store",
        `${kind} delta into Message of kind ${existing.kind}; dropping`,
        { msgId, blockIndex: event.block_index },
      );
      return { state, effects: [] };
    }
    messageKey = existing.messageKey;
    const buffer = event.is_partial ? existing.text + text : text;
    const mutated: Message =
      kind === "assistant_text"
        ? {
            kind: "assistant_text",
            messageKey: existing.messageKey,
            createdAt: existing.createdAt,
            text: buffer,
          }
        : {
            kind: "assistant_thinking",
            messageKey: existing.messageKey,
            createdAt: existing.createdAt,
            text: buffer,
          };
    nextMessages = entry.messages.slice();
    nextMessages[arrayIdx] = mutated;
  }

  const nextEntry: ScratchEntry = {
    ...entry,
    messages: nextMessages,
    blockIndex: nextBlockIndex,
  };

  // Phase transitions only fire on live turns. While replaying, the
  // bracket pair owns phase entry/exit — text accumulates into the
  // Message but does not flip phase. (Replay always synthesizes
  // is_partial: false, so the live submitting → awaiting_first_token
  // → streaming sequence has no analogue.) Wake bracket-phase stays
  // `waking` for the same reason.
  let nextPhase: CodeSessionPhase;
  if (state.phase === "submitting") {
    nextPhase = "awaiting_first_token";
  } else if (state.phase === "awaiting_first_token") {
    nextPhase = "streaming";
  } else {
    nextPhase = state.phase;
  }

  // Telemetry: only fold for live turns. Replay events are
  // synthesized from JSONL and do not correspond to wall-clock
  // arrivals. The first `assistant_text` of a live turn captures
  // `firstAssistantDeltaAt` for the TTFT readout; thinking deltas do
  // NOT count for TTFT (TTFT is "time-to-first-assistant-output").
  const now = Date.now();
  const isReplay = state.phase === "replaying";
  const streamFold = isReplay ? {} : foldStreamEvent(state, now);
  const firstAssistantDeltaAt =
    !isReplay && kind === "assistant_text" && state.firstAssistantDeltaAt === null
      ? now
      : state.firstAssistantDeltaAt;

  // Per-Message PropertyStore path ([D07] § Streaming substrate). The
  // `text` channel carries the rendered buffer for both text and
  // thinking Messages; `TugMarkdownBlock` subscribes to the resulting
  // `turn.${turnKey}.message.${messageKey}.text` path and writes the
  // DOM imperatively per delta ([L22]). Per-Message paths survive
  // the inflight → committed transition ([L26]) because `messageKey`
  // is stable from mint through commit.
  const mutatedText = (nextMessages[arrayIdx] as AssistantText | AssistantThinking).text;
  const effects: Effect[] = [
    {
      kind: "write-inflight",
      turnKey,
      messageKey,
      channel: "text",
      value: mutatedText,
    },
  ];

  return {
    state: {
      ...state,
      phase: nextPhase,
      activeMsgId: msgId,
      scratch: withScratchEntry(state.scratch, turnKey, nextEntry),
      ...streamFold,
      firstAssistantDeltaAt,
    },
    effects,
  };
}

// ---------------------------------------------------------------------------
// Tool call lifecycle ([D07])
// ---------------------------------------------------------------------------

/**
 * `tool_use` input-fill / continuation. The minted `ToolUseMessage`
 * lives in scratch from the prior `content_block_start { kind:
 * "tool_use" }`; this event mutates `input` once the wire's
 * `input_json_delta` accumulator finalizes the payload.
 *
 * Two continuation paths are tolerated:
 *  - **Normal**: `content_block_start` (mint, `input: {}`) → `tool_use`
 *    (input fill, populates `input`).
 *  - **Re-emit**: a second `tool_use` for the same `tool_use_id` —
 *    same `tool_name`, possibly empty `input` continuation. The
 *    handler overwrites `input` only when the incoming payload is
 *    non-empty so an empty-object continuation doesn't clobber a
 *    previously-filled payload.
 *
 * Defensive: if the mint never landed (`toolCallIndex` miss), the
 * handler defensively mints a `ToolUseMessage` in place — losing
 * the createdAt anchor but preserving the call. A dev-log warning
 * surfaces the irregularity.
 */
function handleToolUse(
  state: CodeSessionState,
  event: ToolUseEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (!isContentBearingPhase(state.phase)) {
    return { state, effects: [] };
  }
  const turnKey = state.pendingTurn?.turnKey;
  if (turnKey === undefined) {
    return { state, effects: [] };
  }
  const entry = state.scratch.get(turnKey);
  if (entry === undefined) {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const toolName = event.tool_name;
  const incomingInput = (event.input ?? {}) as Record<string, unknown>;
  const incomingParentId =
    typeof event.parent_tool_use_id === "string"
      ? event.parent_tool_use_id
      : undefined;

  let arrayIdx = entry.toolCallIndex.get(toolUseId);
  let nextMessages: Message[];
  let nextToolCallIndex = entry.toolCallIndex;
  let defensiveStartCapture: number | null = null;
  if (arrayIdx === undefined) {
    // Defensive mint — no prior `content_block_start`. Logged so a
    // tugcode wire-shape regression surfaces in the dev-log rather
    // than silently orphaning the call's lookup.
    tugDevLogStore.warn(
      "code-session-store",
      "tool_use without matching content_block_start; defensive mint",
      { toolUseId, toolName },
    );
    const messageKey =
      typeof event.msg_id === "string"
        ? `${event.msg_id}-tu-${toolUseId}`
        : `defensive-${toolUseId}`;
    const now = Date.now();
    const minted: ToolUseMessage = {
      kind: "tool_use",
      messageKey,
      createdAt: now,
      toolUseId,
      toolName,
      input: incomingInput,
      status: "pending",
      result: null,
      structuredResult: null,
      parentToolUseId: incomingParentId,
      toolWallMs: null,
    };
    arrayIdx = entry.messages.length;
    nextMessages = [...entry.messages, minted];
    nextToolCallIndex = new Map(entry.toolCallIndex);
    nextToolCallIndex.set(toolUseId, arrayIdx);
    // The defensive mint must also capture the wall-clock anchor so
    // `handleToolResult` can compute `toolWallMs`. The normal mint
    // path in `handleContentBlockStart` does this; the defensive
    // path mirrors it.
    if (!state.toolUseStartedAt.has(toolUseId)) {
      defensiveStartCapture = now;
    }
  } else {
    const existing = entry.messages[arrayIdx];
    if (existing.kind !== "tool_use") {
      tugDevLogStore.warn(
        "code-session-store",
        `tool_use into Message of kind ${existing.kind}; dropping`,
        { toolUseId },
      );
      return { state, effects: [] };
    }
    // Continuation — Claude streams `tool_use` twice for a logical
    // call (first with `input: {}`, then with the filled-in input).
    // Only `input` is gated so an empty-object continuation doesn't
    // clobber a previously-filled payload. `parentToolUseId` is
    // sticky once set; the mint's `toolName` is authoritative
    // (continuations may omit it).
    const nextInput =
      Object.keys(incomingInput).length > 0 ? incomingInput : existing.input;
    const mutated: ToolUseMessage = {
      ...existing,
      input: nextInput,
      parentToolUseId: existing.parentToolUseId ?? incomingParentId,
    };
    nextMessages = entry.messages.slice();
    nextMessages[arrayIdx] = mutated;
  }

  const nextEntry: ScratchEntry = {
    ...entry,
    messages: nextMessages,
    toolCallIndex: nextToolCallIndex,
  };

  // Phase transition is live-only: a `tool_use` flips `streaming` /
  // `submitting` / `awaiting_first_token` to `tool_work`; replay and
  // wake keep their bracket phase (the bracket pair owns phase
  // entry/exit).
  const isReplaying = state.phase === "replaying";
  const isWaking = state.phase === "waking";
  const isBracketed = isReplaying || isWaking;

  // Telemetry: skip for replay (synthesized from JSONL, no wall-clock
  // arrival). Wake is live (real wall-clock event arrival from claude),
  // so fold and capture TTFTC just like a normal turn. Continuations
  // of the same tool_use_id still count for the stream-gap fold but
  // do NOT advance `firstToolUseAt` past the first call.
  const now = Date.now();
  const streamFold = isReplaying ? {} : foldStreamEvent(state, now);
  const firstToolUseAt =
    !isReplaying && state.firstToolUseAt === null
      ? now
      : state.firstToolUseAt;
  let toolUseStartedAt = state.toolUseStartedAt;
  if (defensiveStartCapture !== null) {
    toolUseStartedAt = new Map(toolUseStartedAt);
    toolUseStartedAt.set(toolUseId, defensiveStartCapture);
  }

  return {
    state: {
      ...state,
      phase: isBracketed ? state.phase : "tool_work",
      activeMsgId: event.msg_id ?? state.activeMsgId,
      scratch: withScratchEntry(state.scratch, turnKey, nextEntry),
      toolUseStartedAt,
      ...streamFold,
      firstToolUseAt,
    },
    effects: [],
  };
}

function handleToolResult(
  state: CodeSessionState,
  event: ToolResultEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // tool_result is accepted in `tool_work`, `replaying`, and `waking` —
  // pairing with a prior `tool_use` that minted the Message during
  // this same bracketed turn.
  if (
    state.phase !== "tool_work" &&
    state.phase !== "replaying" &&
    state.phase !== "waking"
  ) {
    return { state, effects: [] };
  }
  const turnKey = state.pendingTurn?.turnKey;
  if (turnKey === undefined) {
    return { state, effects: [] };
  }
  const entry = state.scratch.get(turnKey);
  if (entry === undefined) {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const arrayIdx = entry.toolCallIndex.get(toolUseId);
  if (arrayIdx === undefined) {
    console.warn(
      `[code-session-store] tool_result for unknown tool_use_id: ${toolUseId}`,
    );
    return { state, effects: [] };
  }
  const existing = entry.messages[arrayIdx];
  if (existing.kind !== "tool_use") {
    console.warn(
      `[code-session-store] tool_result indexed Message of kind ${existing.kind}; dropping`,
    );
    return { state, effects: [] };
  }

  const isReplaying = state.phase === "replaying";
  const isWaking = state.phase === "waking";
  const now = Date.now();
  const startedAt = state.toolUseStartedAt.get(toolUseId);
  const toolWallMs =
    !isReplaying && typeof startedAt === "number"
      ? Math.max(0, now - startedAt)
      : existing.toolWallMs;

  const mutated: ToolUseMessage = {
    ...existing,
    status: event.is_error === true ? "error" : "done",
    result: event.output ?? null,
    toolWallMs,
  };
  const nextMessages = entry.messages.slice();
  nextMessages[arrayIdx] = mutated;
  const nextEntry: ScratchEntry = { ...entry, messages: nextMessages };

  let toolUseStartedAt = state.toolUseStartedAt;
  if (toolUseStartedAt.has(toolUseId)) {
    toolUseStartedAt = new Map(toolUseStartedAt);
    toolUseStartedAt.delete(toolUseId);
  }

  const nextScratch = withScratchEntry(state.scratch, turnKey, nextEntry);
  // Phase transition: tool_result drives `tool_work → streaming` once
  // every tool_use Message in the turn is terminal. Replay and wake
  // keep their bracket phase.
  const nextPhase: CodeSessionPhase = isReplaying || isWaking
    ? state.phase
    : allToolsTerminal(nextEntry)
      ? "streaming"
      : "tool_work";

  const streamFold = isReplaying ? {} : foldStreamEvent(state, now);

  return {
    state: {
      ...state,
      phase: nextPhase,
      scratch: nextScratch,
      toolUseStartedAt,
      ...streamFold,
    },
    effects: [],
  };
}

function handleToolUseStructured(
  state: CodeSessionState,
  event: ToolUseStructuredEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Accept in the same phases that admit the paired `tool_use` and
  // `tool_result` events. `replaying` is critical: the JSONL replay
  // path emits `tool_use_structured` from the entry-level
  // `toolUseResult` (see `tugcode/src/replay.ts`); a guard that
  // excluded `replaying` would silently drop those events, leaving
  // resumed Read tool calls with `structuredResult: null` and the
  // wrapper rendering an empty body. `waking` is admitted for the
  // same reason — a wake's structured tool result must populate the
  // pending call's `structuredResult`.
  if (
    state.phase !== "tool_work" &&
    state.phase !== "streaming" &&
    state.phase !== "replaying" &&
    state.phase !== "waking"
  ) {
    return { state, effects: [] };
  }
  const turnKey = state.pendingTurn?.turnKey;
  if (turnKey === undefined) {
    return { state, effects: [] };
  }
  const entry = state.scratch.get(turnKey);
  if (entry === undefined) {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const arrayIdx = entry.toolCallIndex.get(toolUseId);
  if (arrayIdx === undefined) {
    console.warn(
      `[code-session-store] tool_use_structured for unknown tool_use_id: ${toolUseId}`,
    );
    return { state, effects: [] };
  }
  const existing = entry.messages[arrayIdx];
  if (existing.kind !== "tool_use") {
    console.warn(
      `[code-session-store] tool_use_structured indexed Message of kind ${existing.kind}; dropping`,
    );
    return { state, effects: [] };
  }

  const mutated: ToolUseMessage = {
    ...existing,
    structuredResult: event.structured_result ?? null,
  };
  const nextMessages = entry.messages.slice();
  nextMessages[arrayIdx] = mutated;
  const nextEntry: ScratchEntry = { ...entry, messages: nextMessages };

  const isReplaying = state.phase === "replaying";
  const streamFold = isReplaying ? {} : foldStreamEvent(state, Date.now());

  return {
    state: {
      ...state,
      scratch: withScratchEntry(state.scratch, turnKey, nextEntry),
      ...streamFold,
    },
    effects: [],
  };
}

/**
 * Close any open per-turn pause segments (awaiting-approval +
 * interrupt-in-flight) and produce the resulting interval-array
 * updates. Called by every turn-boundary callsite (`handleTurnComplete`,
 * transport-lost commit) so the just-ended turn's intervals projection
 * is complete before the post-state lands.
 *
 * Note the asymmetry with transport-downtime: a transport-downtime
 * segment that's still open at turn boundary (the transport-lost
 * commit case) is deliberately NOT closed here — the disconnect
 * outlives the turn and the segment continues into the next
 * idle/errored window. `handleTransportSettled` is the sole closer of
 * transport segments. (At the next `handleSend`, `transportDowntimeIntervals`
 * is reset to `[]` along with the rest of the per-turn array
 * projections; an open `transportNonOnlineSince` remains the
 * transport handler's concern.)
 */
function closeTurnPauseSegments(
  state: CodeSessionState,
  end: number,
): {
  awaitingApprovalIntervals: ReadonlyArray<readonly [number, number]>;
  interruptInFlightIntervals: ReadonlyArray<readonly [number, number]>;
  interruptInFlightSegmentStartedAt: null;
} {
  const awaitingApprovalIntervals =
    state.awaitingApprovalSince === null
      ? state.awaitingApprovalIntervals
      : [
          ...state.awaitingApprovalIntervals,
          [state.awaitingApprovalSince, end] as const,
        ];
  const interruptInFlightIntervals =
    state.interruptInFlightSegmentStartedAt === null
      ? state.interruptInFlightIntervals
      : [
          ...state.interruptInFlightIntervals,
          [state.interruptInFlightSegmentStartedAt, end] as const,
        ];
  return {
    awaitingApprovalIntervals,
    interruptInFlightIntervals,
    interruptInFlightSegmentStartedAt: null,
  };
}

/**
 * Per-turn reset slice — fields cleared at every turn boundary
 * (`turn_complete` success/error, `turn_complete` interrupted,
 * mid-turn transport-lost). The active-turn axis (phase, scratch,
 * pendingTurn, etc.) is reset separately at each call site because
 * the queue-flush path needs to populate the next turn's slots
 * synchronously.
 *
 * The per-turn interval arrays (`awaitingApprovalIntervals` /
 * `transportDowntimeIntervals` / `interruptInFlightIntervals`) are
 * deliberately NOT reset here — the closed-intervals projection
 * from the just-ended turn persists through the brief idle gap so
 * the dev-panel inspector and any debug-time consumer can see the
 * full pause history. The arrays reset at the next `handleSend`
 * (start of the next turn). Open segments are closed by
 * {@link closeTurnPauseSegments} at the same callsite that spreads
 * this reset.
 */
function resetPerTurnTelemetry(): Pick<
  CodeSessionState,
  | "awaitingApprovalSince"
  | "awaitingApprovalAccumulatedMs"
  | "transportDowntimeAccumulatedMs"
  | "transportReconnectCount"
  | "lastStreamEventAt"
  | "maxStreamGapMs"
  | "firstAssistantDeltaAt"
  | "firstToolUseAt"
  | "costAtSubmit"
  | "interruptInFlight"
  | "liveTurnUsage"
> {
  return {
    awaitingApprovalSince: null,
    awaitingApprovalAccumulatedMs: 0,
    transportDowntimeAccumulatedMs: 0,
    transportReconnectCount: 0,
    lastStreamEventAt: null,
    maxStreamGapMs: 0,
    firstAssistantDeltaAt: null,
    firstToolUseAt: null,
    costAtSubmit: null,
    interruptInFlight: false,
    // The committed `cost_update` is authoritative; the live
    // accumulation is dropped so the cells fall back to the just-
    // committed turn's figures with no double-count.
    liveTurnUsage: null,
  };
}

/**
 * Build a `record-telemetry` effect for a freshly-committed live
 * `TurnEntry`. The effect carries the telemetry block in the wire
 * shape the supervisor's `record_turn_telemetry` CONTROL handler
 * expects; the store wrapper looks up `tug_session_id` and dispatches
 * the frame.
 *
 * Returns `undefined` when the persistence shouldn't run — the
 * caller's branch on `event.telemetry !== undefined` (replay path)
 * is the precondition; this helper just packages the payload.
 */
function buildRecordTelemetryEffect(
  entry: TurnEntry,
  sessionInitTokens: number | null,
): Effect {
  // `sessionInitTokens` is session-level — it is not on `TurnEntry`,
  // so the caller passes the reducer's captured value. Persisting it
  // on every turn's telemetry row lets a resumed session restore it
  // from the first replayed `turn_complete`.
  const telemetry: TurnTelemetry = {
    cost: entry.cost,
    wallClockMs: entry.wallClockMs,
    awaitingApprovalMs: entry.awaitingApprovalMs,
    transportDowntimeMs: entry.transportDowntimeMs,
    activeMs: entry.activeMs,
    ttftMs: entry.ttftMs,
    ttftcMs: entry.ttftcMs,
    reconnectCount: entry.reconnectCount,
    maxStreamGapMs: entry.maxStreamGapMs,
    sessionInitTokens,
    // Persist the terminal reason so a future resume recovers it
    // instead of re-deriving (the re-derivation can't tell an
    // interrupted turn from an errored one — [replay-2]).
    turnEndReason: entry.turnEndReason,
  };
  return {
    kind: "record-telemetry",
    msgId: entry.msgId,
    telemetry,
    endedAt: entry.endedAt,
  };
}

/**
 * Read `submitAt` from a turn's opening `user_message` Message (if
 * any). Wake turns carry no `user_message`, so the fallback path
 * uses the `pendingTurn.submitAt` recorded at `handleWakeStarted`.
 */
function submitAtFor(
  state: CodeSessionState,
  endedAt: number,
): number {
  const pending = state.pendingTurn;
  if (pending !== null) return pending.submitAt;
  return endedAt;
}

function buildTurnEntry(
  state: CodeSessionState,
  msgId: string,
  reason: TurnEndReason,
  endedAt: number,
  inlineTelemetry: TurnTelemetry | undefined,
): TurnEntry {
  const turnKey = state.pendingTurn?.turnKey ?? `msg-${msgId}`;
  const entry = state.scratch.get(turnKey);
  const messages: ReadonlyArray<Message> =
    entry !== undefined ? entry.messages.slice() : [];
  const submitAt = submitAtFor(state, endedAt);
  // Live path derives the telemetry block from reducer state at this
  // moment; replay path receives it inlined on the wire event. The
  // merge picks the authoritative source — see telemetry.ts /
  // `mergeTurnTelemetry` for the contract.
  const derivedTelemetry = deriveTurnTelemetry(state, submitAt, endedAt);
  const telemetry = mergeTurnTelemetry(inlineTelemetry, derivedTelemetry);
  // The terminal reason is recovered from the persisted telemetry
  // block on the replay path — `mergeTurnTelemetry` adopted the inline
  // block wholesale, so `telemetry.turnEndReason` is the value the
  // live reducer classified during the original turn. The live path
  // carries no inline block, so the freshly-passed `reason` stands.
  // Without this, a replayed interrupted turn (wire `result: "error"`,
  // no live `interruptInFlight`) mis-commits as `error` ([replay-2]).
  const effectiveReason: TurnEndReason = telemetry.turnEndReason ?? reason;
  return {
    msgId,
    turnKey,
    messages,
    result: effectiveReason === "complete" ? "success" : "interrupted",
    endedAt,
    wallClockMs: telemetry.wallClockMs,
    awaitingApprovalMs: telemetry.awaitingApprovalMs,
    transportDowntimeMs: telemetry.transportDowntimeMs,
    activeMs: telemetry.activeMs,
    ttftMs: telemetry.ttftMs,
    ttftcMs: telemetry.ttftcMs,
    reconnectCount: telemetry.reconnectCount,
    maxStreamGapMs: telemetry.maxStreamGapMs,
    turnEndReason: effectiveReason,
    cost: telemetry.cost,
  };
}

function handleTurnComplete(
  state: CodeSessionState,
  event: TurnCompleteEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // CASE A wire-echo suppression gate. When the user cancelled a
  // turn while `phase === "submitting"`, the wire eventually echoes
  // a `turn_complete(result: "error", msg_id: "")` for the aborted
  // cycle (verified via `tugcode/probe-case-a.ts`). Suppress it so
  // no phantom transcript entry lands.
  //
  // The triple-clause gate is what makes this correct under all
  // observed user-action races:
  //
  //   - `pendingCaseAEchoes > 0` — at least one aborted cycle is
  //     awaiting its echo. The counter is incremented per CASE A
  //     interrupt (in `handleInterrupt`) and decremented here in
  //     FIFO order, so back-to-back cancels each consume their own
  //     suppression slot.
  //   - `state.activeMsgId === null` — no live turn has bound a
  //     `msg_id` yet. Wire FIFO ordering (verified via
  //     `tugcode/probe-case-a-race.ts`) means an aborted cycle's
  //     `turn_complete(error)` always arrives before any content
  //     frame of a subsequent cycle, so this clause distinguishes
  //     "aborted cycle echo" from "live turn errored mid-stream"
  //     (which would have set `activeMsgId` via a prior content
  //     delta) AND from "live turn errored without ever producing
  //     content" (which falls through this gate when the counter is
  //     zero).
  //   - `event.result === "error"` — defensive; the aborted cycle
  //     never completes successfully on the wire.
  //
  // Counter is reset to 0 on `transport_close` (any stranded echoes
  // are lost with the dead wire) so a stale aborted-cycle suppression
  // can't carry across a reconnect and falsely consume a future live
  // turn's pre-content error.
  if (
    state.pendingCaseAEchoes > 0 &&
    state.activeMsgId === null &&
    event.result === "error"
  ) {
    return {
      state: {
        ...state,
        pendingCaseAEchoes: state.pendingCaseAEchoes - 1,
      },
      effects: [],
    };
  }

  // Guard `activeMsgId === null`. Three sub-cases:
  //
  //   1. Phase is `idle` — stray live `turn_complete` arrived between
  //      turns. No turn to commit. Drop.
  //
  //   2. `pendingTurn === null` — no turn open. A `turn_complete`
  //      here is either a translator regression (orphan synthesis
  //      without an opener) or a wire-side stray. Drop with a warn so
  //      a real regression is visible without breaking the session.
  //
  //   3. `pendingTurn !== null` — the no-content interrupt fallback
  //      ([D13] / [D14] / `#spec-reducer-state` rule 2). The
  //      translator's orphan-synthesis `turn_complete` arrived with a
  //      synthesized opener id (today: `orphan-<n>` from
  //      `flushPendingOrphan`; under [D13] / Step 5.6: `u-<n>` /
  //      `w-<n>` from the `openTurnMsgId` tracker) because transport
  //      loss hit before any first-content event could set
  //      `activeMsgId` to claude's real `msg_id`. Commit `pendingTurn`
  //      as an interrupted-before-response turn. `pendingTurn.turnKey`
  //      drives the scratch lookup (see `buildTurnEntry`); the
  //      committed `messages` is `[user_message]` for user-side
  //      openers, `[]` for wake openers. The synthesized id enters
  //      `committedMsgIds` only here, not via `add_user_message`
  //      (which carries no `msg_id` per [D15]).
  //
  // The `replaying` phase is the common case for sub-case 3. The
  // `waking` phase could in principle reach sub-case 3 if a live wake
  // interrupted before any assistant content arrived; today's wire
  // does not exercise this path (live `turn_complete` on a wake
  // always follows at least a `message_start`), but the same commit
  // path serves it correctly if the wire shape ever changes.
  if (state.activeMsgId === null) {
    if (state.phase === "idle") {
      return { state, effects: [] };
    }
    if (state.pendingTurn === null) {
      tugDevLogStore.warn(
        "code-session-store",
        "dropping turn_complete with no pendingTurn or activeMsgId",
        { eventMsgId: event.msg_id, phase: state.phase },
      );
      return { state, effects: [] };
    }
    // Sub-case 3 fall-through: pendingTurn-based commit via the
    // existing path below. `buildTurnEntry` uses
    // `state.pendingTurn.turnKey` to look up scratch — `msgId` is
    // recorded onto the TurnEntry for diagnostics but does not gate
    // the lookup.
  }

  const msgId = event.msg_id ?? state.activeMsgId ?? "";

  // Dedupe by msg_id. A `turn_complete` whose id is already in
  // `committedMsgIds` is a no-op — defense-in-depth against a
  // supervisor that re-emits a turn (e.g. replay overlapping live).
  // Logged at debug level so a real regression is observable without
  // spamming the console on every legitimate redundant event.
  //
  // Belt-and-suspenders: a duplicate `turn_complete` is also a signal
  // that an upstream emitter opened a phantom cycle for an already-
  // committed msg_id — the prior `add_user_message` (if any) wrote
  // junk to `pendingTurn` and any preceding content frames wrote to
  // scratch. If we early-return here without clearing that pending
  // state, `replay_complete`'s "in-flight cycle survived the bracket"
  // branch (chain-link 13) sees `pendingTurn !== null` and transitions
  // phase to `streaming` after replay closes — leaving the card stuck
  // with `canInterrupt=true` and a Stop button that can't reach the
  // wire. Clear the stale pending state so duplicate turn_complete
  // events are inert beyond the no-op transcript commit.
  if (state.committedMsgIds.has(msgId)) {
    tugDevLogStore.warn(
      "code-session-store",
      "dropping duplicate turn_complete",
      { msgId },
    );
    return {
      state: {
        ...state,
        pendingTurn: null,
        activeMsgId: state.activeMsgId === msgId ? null : state.activeMsgId,
        scratch: withoutPendingTurnScratch(state),
      },
      effects: [],
    };
  }

  const isSuccess = event.result === "success";
  // Choose the terminal reason for this completion:
  //  - `result: "interrupted"` is an explicit cut-off terminal —
  //    tugcode's replay translator emits it for orphan-interrupted
  //    submissions and for a dangling cold-resume turn ([replay-1]).
  //    Honored directly so a replayed interrupted turn is not
  //    mislabelled `error` (the replay path has no `interruptInFlight`).
  //  - a wire-side `turn_complete(error)` that landed because the user
  //    pressed Stop (CASE B) maps to `"interrupted"` via the live
  //    `interruptInFlight` signal set by `handleInterrupt`.
  //  - otherwise an error-result completion is a genuine `"error"`.
  const turnEndReason: TurnEndReason = isSuccess
    ? "complete"
    : event.result === "interrupted"
      ? "interrupted"
      : state.interruptInFlight
        ? "interrupted"
        : "error";
  // Pass `event.telemetry` straight through: when the supervisor
  // attached a persisted telemetry block (replay path), buildTurnEntry
  // adopts it via `mergeTurnTelemetry`; when it's undefined (live
  // path), buildTurnEntry derives the block from reducer state.
  // `event.timestamp` (replay path) carries the original JSONL terminal
  // assistant entry's wall-clock time; without it, `endedAt` would
  // reset to the replay-emission time and the Z1 transcript timestamp
  // would re-stamp on every session restore.
  const endedAt = event.timestamp ?? Date.now();
  const entry: TurnEntry = buildTurnEntry(
    state,
    msgId,
    turnEndReason,
    endedAt,
    event.telemetry,
  );
  // Restore `sessionInitTokens` on the resume path: the live capture
  // (`handleStreamingUsage` / `handleCostUpdate`) never ran for a
  // replayed session, so the value rides in on the first replayed
  // `turn_complete`'s inlined telemetry. Keep an already-captured
  // value; otherwise adopt the inlined one.
  const sessionInitTokens =
    state.sessionInitTokens ?? event.telemetry?.sessionInitTokens ?? null;
  // Close any open per-turn pause segments (awaiting-approval +
  // interrupt-in-flight) into their interval-array projections. The
  // committed `TurnEntry` above already folds the scalar
  // accumulators; this is the parallel projection for live-derivation
  // consumers (see `deriveInflightActiveMs` in telemetry.ts). The
  // transport-downtime segment is owned by the transport handlers
  // and deliberately not closed here.
  const closedPauseSegments = closeTurnPauseSegments(state, endedAt);

  const scratch = withoutPendingTurnScratch(state);
  const committedMsgIds = new Set(state.committedMsgIds);
  committedMsgIds.add(msgId);

  // While replaying, turn_complete commits a transcript entry but
  // stays in `replaying` — the bracket's terminal `replay_complete`
  // is what returns the phase to `idle`. Skip the queued-send flush
  // (replay produces no queued sends) and the `clear-inflight` effect
  // (replay never wrote to the in-flight streaming document).
  if (state.phase === "replaying") {
    return {
      state: {
        ...state,
        // phase stays `replaying`
        activeMsgId: null,
        scratch,
        toolUseStartedAt: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingTurn: null,
        committedMsgIds,
        sessionInitTokens,
        ...resetPerTurnTelemetry(),
        ...closedPauseSegments,
      },
      effects: [{ kind: "append-transcript", entry }],
    };
  }

  // The wake bracket closes here — `turn_complete` is the implicit
  // close (no separate `wake_complete` frame, by design at [D01]).
  // Mirrors the normal `streaming → idle` commit path with two
  // additions: clears `wakeTrigger`, and the committed entry's
  // `messages` carries no `user_message` Message — that absence IS
  // the substrate's wake discriminator under [D07] (consumers that
  // need to gate on user-row presence inline-check
  // `turn.messages[0]?.kind === "user_message"`). Queue-flush is
  // skipped (a queued send arriving during a wake would land in
  // `queuedSends`; the wake's commit does not flush it — the user's
  // queued message gets its own turn after the wake settles to idle
  // in the normal way).
  if (state.phase === "waking") {
    return {
      state: {
        ...state,
        phase: "idle",
        activeMsgId: null,
        scratch,
        toolUseStartedAt: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingTurn: null,
        wakeTrigger: null,
        // A wake does not touch `lastError` — the user did not submit
        // anything, so a wake-success does not "clear" a prior error
        // cue that still applies to the user's most recent action. The
        // normal commit branch below clears on success because a
        // successful user turn is the recovery signal; a wake is not.
        committedMsgIds,
        sessionInitTokens,
        ...resetPerTurnTelemetry(),
        ...closedPauseSegments,
      },
      effects: [
        { kind: "append-transcript", entry },
        { kind: "clear-inflight" },
        // Persist per-turn telemetry via the supervisor's SessionLedger
        // — wakes are live turns, same as user-initiated ones.
        ...(event.telemetry === undefined ? [buildRecordTelemetryEffect(entry, sessionInitTokens)] : []),
      ],
    };
  }

  // Single-tick collapse: a queued send on a successful turn flushes
  // in the same dispatch as the commit, so observers see the final
  // phase as `submitting`, not a transient `idle`.
  if (isSuccess && state.queuedSends.length > 0) {
    const [next, ...rest] = state.queuedSends;
    const flushedSubmitAt = Date.now();
    // Mint the flushed turn's `UserMessage` directly from the
    // queued entry's already-synthesized substrate — no re-synthesis
    // at flush time. Bytes-store entries minted at the original
    // queueing `send` stayed live across the queue gap (the
    // bytes-store is per-card-mount). Per [Step 5c].
    const flushedUserMessage: UserMessage = {
      kind: "user_message",
      messageKey: userMessageKey(next.turnKey),
      createdAt: flushedSubmitAt,
      text: next.text,
      attachments: next.atoms,
      submitAt: flushedSubmitAt,
    };
    return {
      state: {
        ...state,
        phase: "submitting",
        activeMsgId: null,
        scratch: withScratchEntry(
          scratch,
          next.turnKey,
          newScratchEntry(next.turnKey, [flushedUserMessage]),
        ),
        toolUseStartedAt: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingTurn: {
          turnKey: next.turnKey,
          submitAt: flushedSubmitAt,
          isWake: false,
        },
        queuedSends: rest,
        lastError: null,
        committedMsgIds,
        sessionInitTokens,
        // Queue-flush starts the next turn synchronously. Reset
        // per-turn telemetry as if `handleSend` had just run, then
        // snapshot the post-completion `lastCost` so the next turn's
        // delta is measured from this point.
        ...resetPerTurnTelemetry(),
        // Queue-flush IS the next `handleSend` for telemetry purposes,
        // so apply the same per-turn interval-array reset that
        // `handleSend` does. The closed-segment push from the
        // just-ended turn is discarded — the new turn's intervals
        // start empty.
        awaitingApprovalIntervals: [],
        transportDowntimeIntervals: [],
        interruptInFlightIntervals: [],
        interruptInFlightSegmentStartedAt: null,
        costAtSubmit: state.lastCost,
      },
      effects: [
        { kind: "append-transcript", entry },
        { kind: "clear-inflight" },
        // Persist the per-turn telemetry block via the supervisor's
        // SessionLedger so the next resume can inline it onto the
        // replayed `turn_complete`. Live path only — the replaying
        // branch above returns before reaching here, and inlined
        // event.telemetry on a non-replay event would be an upstream
        // bug (the wire shape's replay-only contract is enforced by
        // tugcast's supervisor; defensively, only persist when there
        // was no inline source).
        ...(event.telemetry === undefined ? [buildRecordTelemetryEffect(entry, sessionInitTokens)] : []),
        {
          kind: "send-frame",
          msg: {
            type: "user_message",
            // The queued entry carries the wire content blocks built
            // at queue time by `buildWirePayload`. We pass them
            // through verbatim — the reducer never re-reads the
            // bytes-store. Per [Step 5c].
            content: next.content,
          },
        },
      ],
    };
  }

  return {
    state: {
      ...state,
      phase: "idle",
      activeMsgId: null,
      scratch,
      toolUseStartedAt: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      pendingTurn: null,
      // Error-path queue clear: if a turn errored out without a
      // preceding `interrupt()`, any enqueued follow-ups are dropped.
      // Interrupt-driven paths already cleared the queue.
      queuedSends: isSuccess ? state.queuedSends : [],
      // A successful turn clears any lingering `lastError` from an
      // earlier errored-phase recovery.
      lastError: isSuccess ? null : state.lastError,
      committedMsgIds,
      ...resetPerTurnTelemetry(),
      ...closedPauseSegments,
    },
    effects: [
      { kind: "append-transcript", entry },
      { kind: "clear-inflight" },
      // Persist per-turn telemetry via the supervisor's SessionLedger
      // on the live path. See note above in the queue-flush branch.
      ...(event.telemetry === undefined ? [buildRecordTelemetryEffect(entry, sessionInitTokens)] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Control request forward + respond actions
// ---------------------------------------------------------------------------

/**
 * Extract the `ControlRequestForward` fields from the event envelope.
 * Strips `type` so the stored record matches the public type. All other
 * fields (including unknown ones from forward-compat wire versions)
 * pass through so UI code can read `tool_name`, `input`, `options`,
 * `question`, etc.
 */
function extractForward(
  event: ControlRequestForwardEvent,
): ControlRequestForward {
  const { type: _type, ...rest } = event;
  return rest as ControlRequestForward;
}

function handleControlRequestForward(
  state: CodeSessionState,
  event: ControlRequestForwardEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Meaningful in two windows:
  //   1. **Live turn** — the normal path. claude has called a tool
  //      requiring permission, the SDK forwards `can_use_tool`, and
  //      the reducer flips the phase to `awaiting_approval`.
  //   2. **Replay bracket** — the in-flight snapshot path. tugcode's
  //      `emitInflightTurnFromActiveTurn` re-emits any pending
  //      `control_request_forward` from `pendingControlRequests` so a
  //      Developer > Reload mid-dialog can rehydrate the dialog
  //      against the same `request_id`. During replay we stash the
  //      forward into `pendingApproval` / `pendingQuestion` but do
  //      NOT transition the phase — `replay_complete` owns the post-
  //      bracket phase decision and reads these fields to land in
  //      `awaiting_approval` instead of the normal `streaming`
  //      tail-preservation branch.
  // Outside both windows, silently drop — the reducer stays total and
  // the mid-turn gate tolerates stray forwards from a stale feed
  // replay.
  const isReplay = state.phase === "replaying";
  const isWaking = state.phase === "waking";
  if (
    !isReplay &&
    !isWaking &&
    state.phase !== "streaming" &&
    state.phase !== "tool_work" &&
    state.phase !== "awaiting_first_token" &&
    state.phase !== "submitting"
  ) {
    return { state, effects: [] };
  }

  const forward = extractForward(event);
  if (isReplay) {
    // Stash only; do not move off `replaying`. `replay_complete`
    // checks for a populated pending dialog and lands in
    // `awaiting_approval` accordingly. The awaiting-approval clock
    // starts when the post-bracket phase resolves, not here — the
    // user wasn't actually awaiting during the replay window.
    return {
      state: {
        ...state,
        pendingApproval: event.is_question ? state.pendingApproval : forward,
        pendingQuestion: event.is_question ? forward : state.pendingQuestion,
      },
      effects: [],
    };
  }
  const next: CodeSessionState = {
    ...state,
    phase: "awaiting_approval",
    prevPhase: state.phase,
    pendingApproval: event.is_question ? state.pendingApproval : forward,
    pendingQuestion: event.is_question ? forward : state.pendingQuestion,
    // Stamp the entry-side timestamp for the awaiting-approval clock.
    // If a prior dialog's `awaitingApprovalSince` is still set (e.g.
    // back-to-back forwards without a respond in between — shouldn't
    // happen on a sane wire, but defensive), preserve it: the user
    // never left the dialog state, so the interval is still open.
    awaitingApprovalSince: state.awaitingApprovalSince ?? Date.now(),
  };
  return { state: next, effects: [] };
}

/**
 * Close the awaiting-approval interval and fold it into the
 * accumulator. Used by both `handleRespondApproval` and
 * `handleRespondQuestion` so the two dialog kinds count identically.
 *
 * Also appends the closed `[since, end]` pair onto
 * `awaitingApprovalIntervals` so live-derivation (which unions
 * per-axis intervals) sees the closed segment. The scalar accumulator
 * and the intervals array are populated in lockstep — the scalar
 * continues to drive the committed `TurnEntry`, the array drives the
 * live in-flight clock.
 */
function closeAwaitingApprovalInterval(
  state: CodeSessionState,
  end: number = Date.now(),
): {
  awaitingApprovalSince: null;
  awaitingApprovalAccumulatedMs: number;
  awaitingApprovalIntervals: ReadonlyArray<readonly [number, number]>;
} {
  if (state.awaitingApprovalSince === null) {
    return {
      awaitingApprovalSince: null,
      awaitingApprovalAccumulatedMs: state.awaitingApprovalAccumulatedMs,
      awaitingApprovalIntervals: state.awaitingApprovalIntervals,
    };
  }
  const start = state.awaitingApprovalSince;
  const elapsed = Math.max(0, end - start);
  return {
    awaitingApprovalSince: null,
    awaitingApprovalAccumulatedMs: state.awaitingApprovalAccumulatedMs + elapsed,
    awaitingApprovalIntervals: [
      ...state.awaitingApprovalIntervals,
      [start, end] as const,
    ],
  };
}

/**
 * Close the in-flight transport-downtime interval. Folds the elapsed
 * non-online time into the scalar accumulator AND appends the closed
 * `[since, end]` pair onto `transportDowntimeIntervals`. Used by
 * `handleTransportSettled` when the wire returns to `online`. No-op
 * (returns the existing references) when no segment is open.
 */
function closeTransportDowntimeInterval(
  state: CodeSessionState,
  end: number = Date.now(),
): {
  transportNonOnlineSince: null;
  transportDowntimeAccumulatedMs: number;
  transportDowntimeIntervals: ReadonlyArray<readonly [number, number]>;
} {
  if (state.transportNonOnlineSince === null) {
    return {
      transportNonOnlineSince: null,
      transportDowntimeAccumulatedMs: state.transportDowntimeAccumulatedMs,
      transportDowntimeIntervals: state.transportDowntimeIntervals,
    };
  }
  const start = state.transportNonOnlineSince;
  const elapsed = Math.max(0, end - start);
  return {
    transportNonOnlineSince: null,
    transportDowntimeAccumulatedMs:
      state.transportDowntimeAccumulatedMs + elapsed,
    transportDowntimeIntervals: [
      ...state.transportDowntimeIntervals,
      [start, end] as const,
    ],
  };
}

function handleRespondApproval(
  state: CodeSessionState,
  event: RespondApprovalActionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // No pending approval — drop the action. Prevents accidental writes
  // if the UI double-clicks or replays an action after dispose.
  if (state.pendingApproval === null) {
    return { state, effects: [] };
  }

  const restored: CodeSessionPhase = state.prevPhase ?? "streaming";
  // The decision is sent out on the wire below and the SDK's
  // tool_use/tool_result for the gated tool IS the durable transcript
  // artifact — there is no client-side record kept here. See
  // `#step-3-5` in `roadmap/archive/tide-interactive-dialogs.md` for why
  // JSONL cannot durably reconstruct a separate permission record.
  const next: CodeSessionState = {
    ...state,
    phase: restored,
    prevPhase: null,
    pendingApproval: null,
    // Close and fold the awaiting-approval interval into the
    // accumulator. Same fold for permission and question dialogs;
    // see `closeAwaitingApprovalInterval`.
    ...closeAwaitingApprovalInterval(state),
  };
  return {
    state: next,
    effects: [
      {
        kind: "send-frame",
        msg: {
          type: "tool_approval",
          request_id: event.request_id,
          decision: event.decision,
          updatedInput: event.updatedInput,
          message: event.message,
        },
      },
    ],
  };
}

function handleRespondQuestion(
  state: CodeSessionState,
  event: RespondQuestionActionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.pendingQuestion === null) {
    return { state, effects: [] };
  }

  const restored: CodeSessionPhase = state.prevPhase ?? "streaming";
  const next: CodeSessionState = {
    ...state,
    phase: restored,
    prevPhase: null,
    pendingQuestion: null,
    ...closeAwaitingApprovalInterval(state),
  };
  return {
    state: next,
    effects: [
      {
        kind: "send-frame",
        msg: {
          type: "question_answer",
          request_id: event.request_id,
          answers: event.answers,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Cost update — telemetry surface, phase-tolerant
// ---------------------------------------------------------------------------

function numericOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function handleCostUpdate(
  state: CodeSessionState,
  event: CostUpdateEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Guard against non-numeric total_cost_usd. Live Claude sends a
  // number; the golden loader's `"{{f64}}"` → `0` preprocessing also
  // lands as a number. A string or undefined would mean a wire
  // contract break and the frame is dropped.
  if (typeof event.total_cost_usd !== "number") {
    return { state, effects: [] };
  }

  const lastCost: CostSnapshot = {
    totalCostUsd: event.total_cost_usd,
    numTurns: numericOrNull(event.num_turns),
    durationMs: numericOrNull(event.duration_ms),
    durationApiMs: numericOrNull(event.duration_api_ms),
    usage: event.usage ?? null,
    modelUsage: event.modelUsage ?? null,
  };

  return {
    // `cost_update.usage` is the turn's last-iteration usage — the
    // `streaming_usage` path captures `sessionInitTokens` first in
    // practice; this is the fallback for a session whose first turn
    // produced a `cost_update` but no `streaming_usage` frame.
    state: {
      ...state,
      lastCost,
      sessionInitTokens: captureSessionInit(
        state.sessionInitTokens,
        readUsage(event.usage),
      ),
    },
    effects: [],
  };
}

/**
 * `streaming_usage` reducer handler — live intra-turn token telemetry,
 * phase-tolerant like {@link handleCostUpdate}.
 *
 * `observedInput` (`input + cache_read + cache_creation`) grows
 * monotonically across a turn's API calls — each call re-reads the
 * prior context plus its own output and tool result — so the LATEST
 * frame is always the current context window. The handler stores the
 * frame's `usage` as `liveTurnUsage`, replacing the prior frame; there
 * is no accumulation and no per-message map.
 *
 * Also captures `sessionInitTokens` once: the `observedInput` of the
 * session's first token-bearing telemetry iteration is `window(0)` —
 * the bootstrap the transcript walk measures turn 1 against.
 *
 * Drops a frame with no `msg_id` — a malformed frame (tugcode gates
 * the wire emit on a non-empty id). No phase transition, no effect: a
 * display-only telemetry frame.
 */
function handleStreamingUsage(
  state: CodeSessionState,
  event: StreamingUsageEvent,
): { state: CodeSessionState; effects: Effect[] } {
  const msgId = typeof event.msg_id === "string" ? event.msg_id : "";
  if (msgId === "") {
    return { state, effects: [] };
  }
  const usage = readUsage(event.usage);
  return {
    state: {
      ...state,
      liveTurnUsage: usage,
      sessionInitTokens: captureSessionInit(state.sessionInitTokens, usage),
    },
    effects: [],
  };
}

/**
 * `observedInput` of a `usage` — `input + cache_read + cache_creation`,
 * the model's resident context excluding its own output. `window(0)`
 * for the session's first iteration; the per-turn input term elsewhere.
 */
function observedInput(usage: LiveMessageUsage): number {
  return (
    usage.inputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens
  );
}

/**
 * Latch `sessionInitTokens` on the first token-bearing iteration:
 * keep an already-captured value, else adopt this iteration's
 * `observedInput` when it is positive, else stay `null`.
 */
function captureSessionInit(
  current: number | null,
  usage: LiveMessageUsage,
): number | null {
  if (current !== null) {
    return current;
  }
  const obs = observedInput(usage);
  return obs > 0 ? obs : null;
}

/**
 * `context_breakdown` reducer handler. Projects the wire frame onto
 * `state.lastContextBreakdown` and fires a `record-context-breakdown`
 * effect so the supervisor persists the latest blob.
 *
 * Validation: drops malformed frames silently (non-numeric
 * `context_max`, non-array `categories`, individual category entries
 * missing the required `id`/`label`/`tokens` triple). A dropped
 * frame leaves state unchanged — the popover keeps showing whatever
 * the prior frame produced (or the 20.4.7.C fallback if none has
 * landed). The renderer is resilient; the reducer doesn't need to
 * surface a wire-contract error.
 */
function handleContextBreakdown(
  state: CodeSessionState,
  event: ContextBreakdownEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (typeof event.context_max !== "number" || !Array.isArray(event.categories)) {
    return { state, effects: [] };
  }
  const categories: Array<ContextBreakdownSnapshot["categories"][number]> = [];
  for (const c of event.categories) {
    if (typeof c !== "object" || c === null) continue;
    const id = (c as { id?: unknown }).id;
    const label = (c as { label?: unknown }).label;
    const tokens = (c as { tokens?: unknown }).tokens;
    if (typeof id !== "string" || typeof label !== "string" || typeof tokens !== "number") {
      continue;
    }
    categories.push({
      id: id as ContextBreakdownSnapshot["categories"][number]["id"],
      label,
      tokens,
    });
  }
  const projection: ContextBreakdownSnapshot = {
    contextMax: event.context_max,
    categories,
  };
  // Suppress the persist effect for bind-attach frames: the supervisor
  // synthesized this frame from the row it already holds, so writing
  // the same bytes back via record_context_breakdown would just be a
  // no-op UPSERT round-trip. Live frames from tugcode (no flag) get
  // persisted as normal.
  const effects: Effect[] =
    event.from_supervisor_attach === true
      ? []
      : [
          {
            kind: "record-context-breakdown",
            payload: projection,
            capturedAt: Date.now(),
          },
        ];
  return {
    state: { ...state, lastContextBreakdown: projection },
    effects,
  };
}

// ---------------------------------------------------------------------------
// Errored triggers —
// ---------------------------------------------------------------------------

function handleSessionStateErrored(
  state: CodeSessionState,
  event: SessionStateErroredEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Distinct from `interrupted` per [D08]: an errored session is not
  // recoverable via a simple retry — the underlying session is dead.
  // The next `send()` from `errored` re-submits and clears `lastError`
  // on the following `turn_complete(success)`.
  const message = event.detail ?? "session errored";
  return {
    state: {
      ...state,
      phase: "errored",
      // Clear the wake bracket marker — after a session error, the
      // bracket-close `turn_complete` will never arrive.
      wakeTrigger: null,
      lastError: {
        cause: "session_state_errored",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

/**
 * Surface a transient attachment-rejection error on the card banner.
 * Distinct from `handleWireError` and `handleSessionStateErrored`:
 * the session is otherwise healthy (no phase transition to
 * `"errored"`), the next submit can proceed without retry, and the
 * banner self-dismisses on the next successful turn commit via the
 * standard `lastError: null` reset.
 *
 * Originates from `CodeSessionStore.publishAttachmentError`, called
 * by the drop / paste pipelines when `downsampleImage` returns a
 * discriminated error. Per
 * [Table T01](roadmap/tide-atoms.md#t01-failure-modes).
 */
function handleAttachmentRejected(
  state: CodeSessionState,
  event: AttachmentRejectedEvent,
): { state: CodeSessionState; effects: Effect[] } {
  return {
    state: {
      ...state,
      lastError: {
        cause: "attachment_rejected",
        message: event.message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

function handleWireError(
  state: CodeSessionState,
  event: WireErrorEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Distinct from SESSION_STATE errored and transport close. The
  // renderer can dispatch on `lastError.cause === "wire_error"` to
  // surface a different affordance (e.g. a retry button for a
  // `recoverable: true` wire error).
  const message = event.message ?? "wire error";
  return {
    state: {
      ...state,
      phase: "errored",
      // Same rationale as `handleSessionStateErrored` above.
      wakeTrigger: null,
      lastError: {
        cause: "wire_error",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

function handleResumeFailed(
  state: CodeSessionState,
  event: { reason?: string; stale_session_id?: string },
): { state: CodeSessionState; effects: Effect[] } {
  // tugcode emits `resume_failed` and exits; the bridge promotes
  // EOF to a terminal `ResumeFailed` outcome and broadcasts
  // `SESSION_STATE = errored { detail: "resume_failed" }`. Set
  // `lastError` here so the card-side observer (clear binding,
  // re-present picker with notice) can read both the cause and the
  // human-readable reason; the phase flip to `errored` arrives via
  // the subsequent `session_state_errored` event.
  const parts: string[] = [];
  if (event.reason) parts.push(event.reason);
  if (event.stale_session_id) parts.push(`stale id ${event.stale_session_id}`);
  const message = parts.length > 0 ? parts.join("; ") : "resume failed";
  return {
    state: {
      ...state,
      lastError: {
        cause: "resume_failed",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

function handleTransportClose(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // Idempotence: a duplicate close from the lifecycle (e.g., a stray
  // dispatch during teardown) on an already-offline state is a no-op.
  // Returning the same state reference keeps `getSnapshot()`
  // reference-stable for `useSyncExternalStore`.
  if (state.transportState === "offline") {
    return { state, effects: [] };
  }

  // Transport-state takes precedence over the cold-boot preflight
  // beat: if the wire goes down (or starts restoring) the preflight
  // banner has nothing left to bridge to, so cancel and clear. The
  // dwell and soft-budget timers are scoped to the active replay
  // window itself; they survive a transport blip and let the live
  // replay outcome (or a subsequent replay_started) clear them.
  const wasPreflightActive = state.replayPreflightActive;
  const cancelPreflightEffect: Effect[] = wasPreflightActive
    ? [{ kind: "cancel_timer", name: "preflight" }]
    : [];
  const preflightCleared = wasPreflightActive
    ? { replayPreflightActive: false }
    : {};

  // Any aborted CASE A cycles whose `turn_complete(error)` had not
  // yet arrived will never arrive — the wire is dead and the next
  // `transport_open` brings up a fresh connection with no memory of
  // the prior cycles. Letting `pendingCaseAEchoes` carry across the
  // close would falsely suppress the first live `turn_complete(error)`
  // after reconnect (e.g. a real claude error on a new turn).
  const caseAEchoesCleared = state.pendingCaseAEchoes !== 0
    ? { pendingCaseAEchoes: 0 }
    : {};

  // Transport-downtime timer: opening the non-online interval. The
  // entry-side timestamp is set when the transport first leaves
  // `online` (whether to `offline` or `restoring`). Idempotent — if
  // it's already set (e.g. `online → restoring → offline` skipping
  // settled), preserve it: the user never returned to online.
  const transportClock =
    state.transportNonOnlineSince === null
      ? { transportNonOnlineSince: Date.now() }
      : {};

  // Transport close from `idle` no longer drops silently — per [D06]
  // the offline transportState gates submit even for cards that had
  // nothing in flight. Phase stays `idle` (there is nothing to error
  // on); `lastError` is left untouched for the same reason.
  if (state.phase === "idle") {
    return {
      state: {
        ...state,
        transportState: "offline",
        ...preflightCleared,
        ...caseAEchoesCleared,
        ...transportClock,
      },
      effects: cancelPreflightEffect,
    };
  }

  // Non-idle close with an in-flight turn: the turn is dead — the
  // wire will not deliver its `turn_complete`. Commit a TurnEntry
  // with `turnEndReason: "transport_lost"` so the transcript records
  // what happened (and the chrome can show the failure mode) instead
  // of leaving an orphaned in-flight cell behind.
  const endedAt = Date.now();
  const transportLostCommit: Effect[] = [];
  let perTurnReset: Partial<CodeSessionState> = {};
  if (state.pendingTurn !== null) {
    const msgId = state.activeMsgId ?? `transport-lost-${state.pendingTurn.turnKey}`;
    if (!state.committedMsgIds.has(msgId)) {
      // Transport-lost commits never come from replay (replay never
      // synthesizes a transport_lost reason); the live derivation is
      // always the source.
      const entry = buildTurnEntry(state, msgId, "transport_lost", endedAt, undefined);
      transportLostCommit.push({ kind: "append-transcript", entry });
      transportLostCommit.push({ kind: "clear-inflight" });
      const committedMsgIds = new Set(state.committedMsgIds);
      committedMsgIds.add(msgId);
      perTurnReset = {
        committedMsgIds,
        activeMsgId: null,
        scratch: withoutPendingTurnScratch(state),
        toolUseStartedAt: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingTurn: null,
        queuedSends: [],
        ...resetPerTurnTelemetry(),
        // Same per-turn-boundary close as `handleTurnComplete`:
        // close awaiting + interrupt segments into their arrays so
        // the just-lost turn's pause history is complete. The
        // transport segment is deliberately left open — the
        // disconnect that lost the turn is still live.
        ...closeTurnPauseSegments(state, endedAt),
      };
    }
  }

  // Non-idle: flip phase to errored and stamp lastError exactly as
  // before, but ALSO record `transportState = "offline"`. The card
  // observer reads phase to surface "errored"; submit gating reads
  // the conjunction of phase ∈ {idle, errored} and transportState.
  // `wakeTrigger` is cleared unconditionally — after transport-lost
  // there is no active wake; the bracket-close (`turn_complete`) will
  // not arrive on the dead wire.
  return {
    state: {
      ...state,
      ...perTurnReset,
      phase: "errored",
      transportState: "offline",
      wakeTrigger: null,
      lastError: {
        cause: "transport_closed",
        message: "transport closed",
        at: endedAt,
      },
      ...preflightCleared,
      ...caseAEchoesCleared,
      ...transportClock,
    },
    effects: [...cancelPreflightEffect, ...transportLostCommit],
  };
}

function handleTransportOpen(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // [D08] no-op when already online. The lifecycle layer already
  // gates `connectionDidReconnect` on having seen a prior close, so a
  // `transport_open` against `online` would be a duplicate dispatch
  // (or a bootstrap-time event that arrived before any close). Return
  // the same state ref so subscribers don't observe a churn.
  if (state.transportState === "online") {
    return { state, effects: [] };
  }
  // `transportNonOnlineSince` is not closed here — we're still
  // non-online (just transitioning offline → restoring) and the
  // interval continues until `handleTransportSettled` returns to
  // `online`. Defensive: if the timer wasn't set (transport_open
  // observed without a prior close on this side), open it now so the
  // restoring window counts toward downtime correctly.
  const transportClock =
    state.transportNonOnlineSince === null
      ? { transportNonOnlineSince: Date.now() }
      : {};
  return {
    state: {
      ...state,
      transportState: "restoring",
      ...transportClock,
    },
    effects: [],
  };
}

function handleTransportSettled(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  // Idempotence: settling while already online is a no-op. The
  // `cardSessionBindingStore` subscription path may dispatch this on
  // first bind even when `transportState` was already `online`
  // (initial mount, no transport_close had been observed); skipping
  // the churn keeps the snapshot ref stable.
  if (state.transportState === "online") {
    return { state, effects: [] };
  }
  // Close the transport-downtime interval and fold the elapsed time
  // into both the scalar accumulator and the per-turn intervals
  // array; increment the reconnect counter. If `transportNonOnlineSince`
  // was somehow null (defensive — both transport_close and
  // transport_open set it), the helper is a no-op and only the
  // reconnect count moves.
  return {
    state: {
      ...state,
      transportState: "online",
      ...closeTransportDowntimeInterval(state),
      transportReconnectCount: state.transportReconnectCount + 1,
    },
    effects: [],
  };
}

/**
 * Predicate used by the CONTROL-error handlers: a store "owns" an
 * incoming CONTROL error if it is currently waiting on a response to
 * a CODE_INPUT write. This covers `submitting` (just wrote the frame,
 * waiting for Claude's first token) and `awaiting_first_token` (same
 * waiting window, distinct only because a partial might already have
 * arrived in a previous turn context). Other active phases
 * (`streaming`, `tool_work`, `awaiting_approval`) have already
 * received some response from Claude, so a CONTROL error arriving
 * unrouted isn't about the current card's latest write.
 *
 * This gate is the multi-card self-routing mechanism: when the wire
 * frame lacks `tug_session_id` (see `router.rs`'s `session_not_owned`
 * path), every per-card FeedStore's filter lets it through, and each
 * reducer decides on its own whether to accept the routing.
 */
function isAwaitingInputResponse(state: CodeSessionState): boolean {
  return (
    state.phase === "submitting" || state.phase === "awaiting_first_token"
  );
}

function handleSessionUnknown(
  state: CodeSessionState,
  event: SessionUnknownEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // The wire frame carries `tug_session_id`, so the per-card filter
  // already routed it to the correct store. Drop if we're not in a
  // turn that could have triggered it — defensive, because the wire
  // contract says this only fires after a CODE_INPUT write.
  if (!isAwaitingInputResponse(state)) {
    return { state, effects: [] };
  }
  const message = event.detail ?? "session unknown to supervisor";
  return {
    state: {
      ...state,
      phase: "errored",
      lastError: {
        cause: "session_unknown",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

function handleSessionNotOwned(
  state: CodeSessionState,
  event: SessionNotOwnedEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // The wire frame may arrive without `tug_session_id`, so every
  // store's filter saw it. The phase gate picks the one store (or,
  // rarely, small set) that actually issued a CODE_INPUT write in
  // the immediate past.
  if (!isAwaitingInputResponse(state)) {
    return { state, effects: [] };
  }
  const message = event.detail ?? "session not owned by this client";
  return {
    state: {
      ...state,
      phase: "errored",
      lastError: {
        cause: "session_not_owned",
        message,
        at: Date.now(),
      },
    },
    effects: [],
  };
}

// ---------------------------------------------------------------------------
// Replay bracket handlers (replay_started / replay_complete /
// add_user_message)
// ---------------------------------------------------------------------------

/**
 * Open a replay window. Allowed only from `idle` or `errored` —
 * other phases mean a live turn is in flight, which would race the
 * supervisor's flush-before-live ordering. The `errored` case is the
 * explicit invariant: a previously-errored card whose
 * `spawn_session_ok` cleared the error before replay began would
 * already be `idle` by the time `replay_started` lands; this branch
 * exists in case the supervisor sequences differently.
 */
function handleReplayStarted(
  state: CodeSessionState,
  _event: ReplayStartedEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "idle" && state.phase !== "errored") {
    console.warn(
      `[code-session-store] replay_started in unexpected phase ${state.phase}; dropping`,
    );
    return { state, effects: [] };
  }
  return {
    state: {
      ...state,
      phase: "replaying",
      // Clear pendingTurn defensively — replay should never observe
      // one (idle/errored have it null), but a future caller that
      // drives `send` then `replay_started` synchronously would
      // otherwise leak the pending turn into the first replayed
      // turn's commit.
      pendingTurn: null,
      // Same defensive clear for any in-flight scratch.
      activeMsgId: null,
      scratch: new Map(),
      toolUseStartedAt: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      // Clear lastReplayResult — the new window is the new outcome.
      lastReplayResult: null,
      // Replay-clock: opening a replay window clears preflight (its
      // job is done) and the prior window's timeout-dwell (the new
      // window supersedes the prior outcome). Soft-budget starts
      // false and the dispatch loop schedules the soft-budget timer
      // via the effect below.
      replayPreflightActive: false,
      replaySoftBudgetElapsed: false,
      replayTimeoutDwellActive: false,
    },
    effects: [
      { kind: "cancel_timer", name: "preflight" },
      { kind: "cancel_timer", name: "timeout_dwell" },
      {
        kind: "schedule_timer",
        name: "soft_budget",
        ms: REPLAY_SOFT_BUDGET_MS,
        fire: { type: "tick_soft_budget" },
      },
    ],
  };
}

/**
 * Close a replay window. Always returns to `idle` and populates
 * `lastReplayResult` with the success or error variant. Idempotent:
 * a stray `replay_complete` outside `replaying` is logged and
 * dropped so the normal idle / errored state isn't perturbed.
 */
function handleReplayComplete(
  state: CodeSessionState,
  event: ReplayCompleteEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "replaying") {
    console.warn(
      `[code-session-store] replay_complete in unexpected phase ${state.phase}; dropping`,
    );
    return { state, effects: [] };
  }
  const lastReplayResult: LastReplayResult = event.error
    ? {
        kind: event.error.kind,
        message: event.error.message,
        count: event.count,
        at: Date.now(),
      }
    : {
        kind: "success",
        message: "",
        count: event.count,
        at: Date.now(),
      };
  // Replay-clock: closing the window cancels preflight (defensive — it
  // would already be cleared by the preceding replay_started) and the
  // soft-budget timer. A timeout outcome opens the timeout-dwell timer
  // so the banner copy lingers briefly before dismissing.
  const isTimeout = lastReplayResult.kind === "replay_timeout";
  const effects: Effect[] = [
    { kind: "cancel_timer", name: "preflight" },
    { kind: "cancel_timer", name: "soft_budget" },
  ];
  if (isTimeout) {
    effects.push({
      kind: "schedule_timer",
      name: "timeout_dwell",
      ms: REPLAY_TIMEOUT_DWELL_MS,
      fire: { type: "tick_timeout_dwell_done" },
    });
  }

  // Never-drop chain link 13: if `pendingTurn` survived the bracket,
  // the in-flight snapshot's `add_user_message` landed without a
  // matching `turn_complete` (the live tail is still streaming).
  // Preserve `pendingTurn` + scratch, transition to `streaming` so
  // post-bracket live deltas continue to accumulate, and let the
  // eventual live `turn_complete` commit the TurnEntry naturally.
  // Without this preservation, replay_complete wipes the cycle and
  // post-bracket deltas land in `idle` (which `handleTextDelta`'s
  // phase guard rejects), the user sees no inflight indicator after
  // HMR-mid-stream, and the response never auto-syncs.
  //
  // Dialog-survival sibling: if the snapshot also re-emitted a
  // `control_request_forward` (tugcode replays any pending
  // `can_use_tool` from `pendingControlRequests` on resume), the
  // forward stashed `pendingApproval` / `pendingQuestion` while the
  // phase guard kept us in `replaying`. The right post-bracket
  // landing is `awaiting_approval` — not `streaming` — so the
  // permission / question dialog reappears and the awaiting-approval
  // clock starts now (the user wasn't actually waiting during the
  // replay window). Without this branch, the rehydrated dialog
  // fields would be wiped below and the user sees only the empty
  // streaming indicator.
  if (state.pendingTurn !== null) {
    const hasPendingDialog =
      state.pendingApproval !== null || state.pendingQuestion !== null;
    if (hasPendingDialog) {
      // `prevPhase` is what `handleRespondApproval` / `handleRespondQuestion`
      // restore to once the user resolves the dialog. The live flow's
      // forward landed at `tool_work` (the `tool_use` for the gated
      // tool flipped phase there before the SDK control_request
      // arrived), so the post-resolve phase MUST be `tool_work` —
      // it is the only phase that accepts the subsequent `tool_result`
      // (`handleToolResult` drops the event outside `tool_work` /
      // `replaying`). The snapshot path synthesised a `tool_use` for
      // the same toolUseId during the bracket, so the scratch has
      // the pending entry waiting for the result. Restoring to
      // `streaming` here would drop the live `tool_result` and the
      // tool block would dangle in its pending state forever.
      return {
        state: {
          ...state,
          phase: "awaiting_approval",
          prevPhase: "tool_work",
          pendingApproval: state.pendingApproval,
          pendingQuestion: state.pendingQuestion,
          awaitingApprovalSince: state.awaitingApprovalSince ?? Date.now(),
          lastReplayResult,
          replayPreflightActive: false,
          replaySoftBudgetElapsed: false,
          replayTimeoutDwellActive: isTimeout,
        },
        effects,
      };
    }
    return {
      state: {
        ...state,
        phase: "streaming",
        // activeMsgId stays as whatever the snapshot's
        // assistant_text set (claude's id for the in-flight
        // message). scratch preserved as-is. pendingTurn preserved
        // as-is.
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        lastReplayResult,
        replayPreflightActive: false,
        replaySoftBudgetElapsed: false,
        replayTimeoutDwellActive: isTimeout,
      },
      effects,
    };
  }

  // No surviving in-flight cycle: clean replay terminates to idle.
  return {
    state: {
      ...state,
      phase: "idle",
      activeMsgId: null,
      scratch: new Map(),
      toolUseStartedAt: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      pendingTurn: null,
      lastReplayResult,
      replayPreflightActive: false,
      replaySoftBudgetElapsed: false,
      replayTimeoutDwellActive: isTimeout,
    },
    effects,
  };
}

/**
 * Replay user-message echo: the synthetic open of each replayed turn.
 * Sets `pendingTurn` + seeds the scratch with the opening user_message
 * so the upcoming `turn_complete` commits a `TurnEntry` with this user
 * submission. No `send-frame` effect — the user already submitted this
 * message historically; replaying it must NOT round-trip back to the
 * wire.
 *
 * Does NOT pre-bind `activeMsgId` (per [D14]). The first content event
 * of the turn (`assistant_text` / `thinking_text` / `tool_use` /
 * `content_block_start`) sets `activeMsgId` to claude's real `msg_id`;
 * `handleTurnComplete` matches on that. For the no-content interrupt
 * case (translator emits orphan `turn_complete` with no content
 * arrived), `handleTurnComplete` falls back to committing `pendingTurn`
 * when `activeMsgId === null` (per `#spec-reducer-state` rule 2 and
 * [D13]'s orphan-synthesis path).
 *
 * `committedMsgIds` dedupe is therefore assistant-side-only — the
 * translator's synthesized `u-<n>` opener id ([D13]) never reaches
 * `committedMsgIds`. Documented on `committedMsgIds` itself.
 *
 * Drops in any phase other than `replaying`.
 */
function handleAddUserMessage(
  state: CodeSessionState,
  event: AddUserMessageEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "replaying") {
    return { state, effects: [] };
  }
  // The store wrapper has already walked the inbound `content` blocks
  // through `synthesizeUserMessageFromBlocks` and dispatches the
  // substrate `(text, atoms)` pair on the event. The reducer trusts
  // the contract — no shape check, no fallback path. Per [Step 5c].
  // `event.timestamp` (replay path) carries the original JSONL entry's
  // wall-clock submission time; without it, `submitAt` would reset to
  // the replay-emission time and the Z1 transcript timestamp would
  // re-stamp on every session restore.
  const now = event.timestamp ?? Date.now();
  const userMessage: UserMessage = {
    kind: "user_message",
    messageKey: userMessageKey(event.turnKey),
    createdAt: now,
    text: event.text,
    attachments: event.atoms,
    submitAt: now,
  };
  return {
    state: {
      ...state,
      pendingTurn: {
        turnKey: event.turnKey,
        submitAt: now,
        isWake: false,
      },
      scratch: withScratchEntry(
        state.scratch,
        event.turnKey,
        newScratchEntry(event.turnKey, [userMessage]),
      ),
      // No `activeMsgId` pre-bind per [D14]. The first content event
      // of the turn (assistant_text / thinking_text / tool_use /
      // content_block_start) sets it to claude's real `msg_id`. The
      // LIVE `handleSend` path also doesn't pre-bind; replay and live
      // converge on the same handler behavior.
    },
    effects: [],
  };
}

/**
 * Wake-bracket opener for a spontaneous resume — fires when claude
 * resumes from idle in response to an async deferred-completion event
 * (Monitor timeout, CronCreate firing, ScheduleWakeup arriving, etc.).
 * Closes [PPF-01]: the wake's subsequent content events would
 * otherwise be dropped by guards expecting an active turn.
 *
 * Pattern mirrors `handleSend`'s state setup so the wake turn behaves
 * like any user-initiated turn for streaming + telemetry, with three
 * differences:
 *   - `phase: "waking"` rather than `"submitting"` so the bracket is
 *     visible to consumers and `handleTurnComplete` can branch on it.
 *   - `pendingTurn.isWake === true` is the substrate's wake
 *     discriminator (replaces the [D06] empty-text sentinel under
 *     [D07]). The scratch opens with NO `user_message` Message —
 *     wake turns have no user submission to surface.
 *   - `pendingDraftRestore` is preserved — the user's in-progress
 *     draft must not be touched by a wake (a wake mid-compose should
 *     not clobber what the user was typing).
 *
 * Idempotent on nested wakes: a `wake_started` arriving while already
 * `phase === "waking"` is treated as a metadata refresh (updates
 * `wakeTrigger` only when the new payload is non-null and the prior
 * was null). Flattens nested wakes to a single outer bracket per the
 * design at [D01].
 *
 * Closed implicitly by `turn_complete`'s `waking → idle` commit
 * branch — no separate `wake_complete` frame.
 *
 * Phases other than `idle` and `waking` drop defensively. Live
 * tugcode only emits `wake_started` from idle (the detector flips
 * `isInWake` and gates re-emission until the next `result`); a stray
 * frame from a busy phase would be a tugcode bug.
 *
 * See `roadmap/tugplan-tide-session-wake.md` [D01] [D02]
 * [#spec-wake-started-state-reset].
 */
function handleWakeStarted(
  state: CodeSessionState,
  event: WakeStartedEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // Wire payload is snake_case (verbatim SDK shape); reducer state
  // is camelCase per tugdeck convention. Translate once at the
  // reducer boundary so downstream consumers read camelCase.
  const trigger: WakeTrigger = {
    taskId: event.wake_trigger.task_id,
    toolUseId: event.wake_trigger.tool_use_id,
    status: event.wake_trigger.status,
    summary: event.wake_trigger.summary,
    outputFile: event.wake_trigger.output_file,
  };
  if (state.phase === "waking") {
    // Nested wake — idempotent refresh of trigger metadata only.
    if (state.wakeTrigger === null) {
      return {
        state: { ...state, wakeTrigger: trigger },
        effects: [],
      };
    }
    return { state, effects: [] };
  }
  // Accept wake_started from `replaying` too — the cold-boot replay
  // path emits a synthesized `wake_started` when it recognizes the
  // JSONL's `<task-notification>` envelope (see
  // `tugcode/src/replay.ts`'s `extractTaskNotificationWake`). During
  // replay, the bracket pair (replay_started / replay_complete) owns
  // phase entry/exit, so the wake opens its scratch + pendingTurn
  // here but the phase stays `replaying`. The wake's content frames
  // accumulate under the same handlers that admit `replaying`, and
  // the matching `turn_complete` commits the entry via the
  // replaying-stays-in-replaying branch.
  if (state.phase !== "idle" && state.phase !== "replaying") {
    return { state, effects: [] };
  }
  const submitAt = Date.now();
  const nextPhase: CodeSessionPhase = state.phase === "replaying" ? "replaying" : "waking";
  return {
    state: {
      ...state,
      phase: nextPhase,
      wakeTrigger: trigger,
      activeMsgId: null,
      scratch: withScratchEntry(
        state.scratch,
        event.turnKey,
        // No initial messages — wake turns have no user_message. The
        // first wire content event (assistant_text / thinking_text /
        // tool_use) mints into this scratch via `handleContentBlockStart`.
        newScratchEntry(event.turnKey, []),
      ),
      toolUseStartedAt: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      pendingTurn: {
        turnKey: event.turnKey,
        submitAt,
        isWake: true,
      },
      // Per-turn telemetry reset — same single-source-of-truth helper
      // `handleSend` uses on the queue-flush path. Future fields added
      // to the helper apply to wakes automatically.
      ...resetPerTurnTelemetry(),
      // The per-turn interval arrays + the interrupt segment-start
      // ARE reset here (mirrors handleSend). `transportNonOnlineSince`
      // is owned by the transport handlers and intentionally left
      // alone so an in-progress disconnect that pre-dates the wake
      // still folds into the wake's downtime correctly.
      awaitingApprovalIntervals: [],
      transportDowntimeIntervals: [],
      interruptInFlightIntervals: [],
      interruptInFlightSegmentStartedAt: null,
      // Snapshot the cost cursor so the per-turn delta is computed
      // against this wake-start point at completion. (resetPerTurnTelemetry
      // clears `costAtSubmit` to null; re-set it here after the spread.)
      costAtSubmit: state.lastCost,
    },
    effects: [],
  };
}

// ---------------------------------------------------------------------------
// Replay-clock handlers (preflight + soft-budget + timeout-dwell)
// ---------------------------------------------------------------------------

/**
 * `bind_resume_acknowledged` — emitted once by `cardServicesStore`
 * after constructing services for a `sessionMode === "resume"`
 * binding. Opens the preflight window. Idempotent: a second call
 * while preflight is already active is a no-op (no second timer
 * scheduled). Also a no-op if not in `idle` (e.g. mid-replay) — the
 * downstream `replay_started` will populate the live replay copy
 * directly without a redundant preflight beat.
 */
function handleBindResumeAcknowledged(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.replayPreflightActive) {
    return { state, effects: [] };
  }
  if (state.phase !== "idle") {
    return { state, effects: [] };
  }
  if (state.transportState !== "online") {
    // Transport-state takes precedence: there's no point opening a
    // preflight banner over a transport restoring/offline backdrop.
    return { state, effects: [] };
  }
  return {
    state: { ...state, replayPreflightActive: true },
    effects: [
      {
        kind: "schedule_timer",
        name: "preflight",
        ms: REPLAY_PREFLIGHT_TIMEOUT_MS,
        fire: { type: "tick_preflight_done" },
      },
    ],
  };
}

/**
 * `tick_soft_budget` — scheduled by `replay_started`, fires
 * `REPLAY_SOFT_BUDGET_MS` later. Drops if not currently replaying
 * (the `replay_complete` cancel path should already have cleared
 * the timer; this is defense-in-depth against a stale tick racing
 * the cancel).
 */
function handleTickSoftBudget(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "replaying") {
    return { state, effects: [] };
  }
  if (state.replaySoftBudgetElapsed) {
    return { state, effects: [] };
  }
  return {
    state: { ...state, replaySoftBudgetElapsed: true },
    effects: [],
  };
}

/**
 * `tick_timeout_dwell_done` — scheduled by `replay_complete` when
 * the outcome is `replay_timeout`. Dismisses the timeout banner
 * after the dwell window.
 */
function handleTickTimeoutDwellDone(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  if (!state.replayTimeoutDwellActive) {
    return { state, effects: [] };
  }
  return {
    state: { ...state, replayTimeoutDwellActive: false },
    effects: [],
  };
}

/**
 * `tick_preflight_done` — last-resort 12s timer expiring. Clears the
 * preflight banner if it somehow survived `replay_started` /
 * `replay_complete` / `transport_close` (none of which lit up).
 */
function handleTickPreflightDone(
  state: CodeSessionState,
): { state: CodeSessionState; effects: Effect[] } {
  if (!state.replayPreflightActive) {
    return { state, effects: [] };
  }
  return {
    state: { ...state, replayPreflightActive: false },
    effects: [],
  };
}

// ---------------------------------------------------------------------------
// Snapshot derivation helpers ([D07])
// ---------------------------------------------------------------------------

/**
 * Derive the public {@link ActiveTurnSnapshot} from reducer state.
 * Returns `null` when no turn is in flight. Used by
 * `CodeSessionStore.getSnapshot` to project `state.pendingTurn` +
 * `state.scratch[turnKey]` onto the snapshot surface.
 *
 * Pure: returns a fresh object each call. The class wrapper memoizes
 * the full snapshot, so callers don't pay re-derivation costs across
 * quiescent reads.
 */
export function deriveActiveTurnSnapshot(
  state: CodeSessionState,
): ActiveTurnSnapshot | null {
  const pending = state.pendingTurn;
  if (pending === null) return null;
  const entry = state.scratch.get(pending.turnKey);
  const messages: ReadonlyArray<Message> =
    entry !== undefined ? entry.messages : [];
  return {
    turnKey: pending.turnKey,
    submitAt: pending.submitAt,
    isWake: pending.isWake,
    messages,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Pure reducer. Returns the next state and an ordered effect list; the
 * class wrapper in `code-session-store.ts` processes the effects.
 */
export function reduce(
  state: CodeSessionState,
  event: CodeSessionEvent,
): { state: CodeSessionState; effects: Effect[] } {
  switch (event.type) {
    case "send":
      return handleSend(state, event);
    case "session_init":
      return handleSessionInit(state, event);
    case "content_block_start":
      return handleContentBlockStart(state, event);
    case "assistant_text":
      return handleTextDelta(state, event, "assistant_text");
    case "thinking_text":
      return handleTextDelta(state, event, "assistant_thinking");
    case "tool_use":
      return handleToolUse(state, event);
    case "tool_result":
      return handleToolResult(state, event);
    case "tool_use_structured":
      return handleToolUseStructured(state, event);
    case "turn_complete":
      return handleTurnComplete(state, event);
    case "control_request_forward":
      return handleControlRequestForward(state, event);
    case "respond_approval":
      return handleRespondApproval(state, event);
    case "respond_question":
      return handleRespondQuestion(state, event);
    case "interrupt_action":
      return handleInterrupt(state);
    case "consume_draft_restore":
      return handleConsumeDraftRestore(state);
    case "cancel_queued_send":
      return handleCancelQueuedSend(state, event);
    case "cost_update":
      return handleCostUpdate(state, event);
    case "streaming_usage":
      return handleStreamingUsage(state, event);
    case "context_breakdown":
      return handleContextBreakdown(state, event);
    case "system_metadata":
      // [D09] SessionMetadataStore owns this feed — drop explicitly.
      return { state, effects: [] };
    case "session_state_errored":
      return handleSessionStateErrored(state, event);
    case "session_unknown":
      return handleSessionUnknown(state, event);
    case "session_not_owned":
      return handleSessionNotOwned(state, event);
    case "transport_close":
      return handleTransportClose(state);
    case "transport_open":
      return handleTransportOpen(state);
    case "transport_settled":
      return handleTransportSettled(state);
    case "error":
      return handleWireError(state, event);
    case "resume_failed":
      return handleResumeFailed(state, event);
    case "replay_started":
      return handleReplayStarted(state, event);
    case "replay_complete":
      return handleReplayComplete(state, event);
    case "add_user_message":
      return handleAddUserMessage(state, event);
    case "wake_started":
      return handleWakeStarted(state, event);
    case "bind_resume_acknowledged":
      return handleBindResumeAcknowledged(state);
    case "tick_soft_budget":
      return handleTickSoftBudget(state);
    case "tick_timeout_dwell_done":
      return handleTickTimeoutDwellDone(state);
    case "tick_preflight_done":
      return handleTickPreflightDone(state);
    case "attachment_rejected":
      return handleAttachmentRejected(state, event);
    default:
      return { state, effects: [] };
  }
}
