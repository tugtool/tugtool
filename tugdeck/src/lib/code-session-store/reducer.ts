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
import type { Effect } from "./effects";
import type {
  AssistantTextEvent,
  CancelQueuedSendActionEvent,
  CodeSessionEvent,
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
  UserMessageReplayEvent,
  WireErrorEvent,
} from "./events";
import type {
  CardSessionMode,
  CodeSessionPhase,
  ContextBreakdownSnapshot,
  ControlRequestForward,
  CostSnapshot,
  LastReplayResult,
  LiveMessageUsage,
  ToolCallState,
  TransportState,
  TurnEndReason,
  TurnEntry,
} from "./types";
import { tugDevLogStore } from "../tug-dev-log-store/tug-dev-log-store";
import {
  deriveTurnTelemetry,
  mergeTurnTelemetry,
  readUsage,
  type TurnTelemetry,
} from "./telemetry";

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
  scratch: Map<string, { assistant: string; thinking: string }>;
  toolCallMap: Map<string, ToolCallState>;
  pendingApproval: ControlRequestForward | null;
  pendingQuestion: ControlRequestForward | null;
  prevPhase: CodeSessionPhase | null;
  pendingUserMessage: {
    text: string;
    atoms: ReadonlyArray<AtomSegment>;
    submitAt: number;
    /**
     * Stable React-key seed for the in-flight cell pair. Generated at
     * `handleSend` and preserved unchanged through every phase of the
     * turn. The transcript's `idForIndex` uses it to mint the user +
     * code cell ids; the same `turnKey` is copied onto `TurnEntry` at
     * `handleTurnComplete`, so the React key stays identical across
     * the inflight → committed transition. The single React key for
     * the lifetime of a turn is the foundation that prevents the
     * cell wrapper from unmounting mid-turn (which previously caused
     * `scrollTop` to silently clamp to 0 when streaming content
     * remounted).
     */
    turnKey: string;
  } | null;
  /**
   * One-shot draft restore for CASE A interrupt — `interrupt()` fired
   * while `phase === "submitting"`, before claude produced any content
   * keyed to a `msg_id`. The reducer captures `pendingUserMessage` here
   * so the prompt entry can seed the editor with the original text +
   * atoms for re-edit. Cleared by `consume_draft_restore` (the prompt
   * entry's signal that it has applied the restore) — never overwritten
   * elsewhere; a brand-new CASE A interrupt while a previous restore
   * still sits in this slot replaces the contents (the editor
   * effectively "missed" the prior restore, but losing the older draft
   * is preferable to stranding the most recent one).
   *
   * Mirrored onto the public snapshot as
   * `CodeSessionSnapshot.pendingDraftRestore`. The reference is shared
   * with the snapshot so identity is stable across snapshot rebuilds
   * (per the same [D10]-style stability contract that
   * `pendingUserMessage` honors).
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
   */
  queuedSends: Array<{ text: string; atoms: AtomSegment[]; turnKey: string }>;
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
   * Per-tool-call start timestamps captured at `handleToolUse`, used
   * by `handleToolResult` to compute the matching `ToolCallState.toolWallMs`.
   * Reducer-internal — never exposed on the snapshot. Cleared on turn
   * boundaries with the rest of the toolCallMap.
   */
  toolUseStartedAt: Map<string, number>;
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
    toolCallMap: new Map(),
    pendingApproval: null,
    pendingQuestion: null,
    prevPhase: null,
    pendingUserMessage: null,
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
    const next: CodeSessionState = {
      ...state,
      phase: "submitting",
      pendingUserMessage: {
        text: event.text,
        atoms: event.atoms,
        submitAt: Date.now(),
        turnKey: event.turnKey,
      },
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
            text: event.text,
            attachments: [],
          },
        },
      ],
    };
  }

  // Mid-turn send — enqueue. The queue is speculative: a single
  // entry flushes at `turn_complete(success)` via the single-tick
  // collapse in `handleTurnComplete`; `interrupt()` clears it.
  const queuedSends = [
    ...state.queuedSends,
    { text: event.text, atoms: [...event.atoms], turnKey: event.turnKey },
  ];
  return { state: { ...state, queuedSends }, effects: [] };
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
  // back and re-edit" — capture the pending message into a one-shot
  // restore slot, clear the in-flight pair so the transcript stops
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
    const pending = state.pendingUserMessage;
    // Carry the pending submission into the restore slot. If
    // `pendingUserMessage` is somehow null (defensive — handleSend
    // populates it on every successful send), preserve any existing
    // restore so a brand-new CASE A doesn't wipe a previously-stranded
    // one.
    const restore = pending !== null
      ? { text: pending.text, atoms: pending.atoms }
      : state.pendingDraftRestore;
    return {
      state: {
        ...state,
        phase: "idle",
        activeMsgId: null,
        scratch: new Map(),
        toolCallMap: new Map(),
        toolUseStartedAt: new Map(),
        pendingUserMessage: null,
        pendingDraftRestore: restore,
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
        // rendering because `pendingUserMessage` is now `null`; a
        // thinking-only pull-down's per-turn streaming paths are simply
        // never read again — the next turn mints a fresh `turnKey`.
        // The effect is still emitted for turn-boundary symmetry with
        // `handleTurnComplete`.
        { kind: "clear-inflight" },
      ],
    };
  }

  // CASE B — interrupt fired after claude produced at least one
  // content frame (`activeMsgId` is set, `scratch[activeMsgId]` may
  // hold partial text/thinking/tool-use content). The wire's eventual
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
 * Shared delta-accumulation logic for `assistant_text` and
 * `thinking_text`. Both events share structure: a partial accumulates
 * into the matching scratch field and a terminal frame
 * (`is_partial: false`) replaces the scratch buffer with the
 * authoritative full text. The first partial of either kind drives the
 * `submitting → awaiting_first_token` transition; the next drives
 * `awaiting_first_token → streaming`.
 */

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

function handleTextDelta(
  state: CodeSessionState,
  event: AssistantTextEvent | ThinkingTextEvent,
  field: "assistant" | "thinking",
  channel: "assistant" | "thinking",
): { state: CodeSessionState; effects: Effect[] } {
  // Incoming text outside of an active turn — drop. Live Claude
  // should not emit this, but defensive handling keeps the reducer
  // total. `replaying` is allowed: the JSONL replay translator emits
  // assistant_text / thinking_text events that need to land in
  // scratch keyed by msg_id so the subsequent `turn_complete` can
  // commit them.
  if (
    state.phase !== "submitting" &&
    state.phase !== "awaiting_first_token" &&
    state.phase !== "streaming" &&
    state.phase !== "tool_work" &&
    state.phase !== "replaying"
  ) {
    return { state, effects: [] };
  }

  const msgId = event.msg_id;
  const text = event.text ?? "";
  const scratch = new Map(state.scratch);
  const existing = scratch.get(msgId) ?? { assistant: "", thinking: "" };
  const buffer = event.is_partial ? existing[field] + text : text;
  scratch.set(msgId, { ...existing, [field]: buffer });

  // Phase transitions only fire on live turns. While replaying, the
  // bracket pair owns phase entry/exit — assistant_text accumulates
  // into scratch but does not flip phase. The replay translator
  // emits is_partial: false on every text event, so the live
  // submitting → awaiting_first_token → streaming sequence has no
  // analogue here anyway.
  let nextPhase: CodeSessionPhase;
  if (state.phase === "submitting") {
    nextPhase = "awaiting_first_token";
  } else if (state.phase === "awaiting_first_token") {
    nextPhase = "streaming";
  } else {
    nextPhase = state.phase;
  }

  // Per-turn paths are the sole render surface for both in-flight
  // and committed cells ([L26]). Every accepted text event — live or
  // replayed — writes the current buffer into
  // `turn.${turnKey}.${channel}`, so the cell's subscription has
  // data to render across all transitions, including cold-boot
  // rehydration. The `turnKey === undefined` short-circuit is the
  // only suppression that remains and it covers a genuine
  // "no in-flight turn" case (`pendingUserMessage` is null between
  // turns, e.g., a stray text event that survived a guard upstream).
  const turnKey = state.pendingUserMessage?.turnKey;
  const effects: Effect[] =
    turnKey === undefined
      ? []
      : [{ kind: "write-inflight", turnKey, channel, value: buffer }];

  // Telemetry: only fold for live turns. Replay events are
  // synthesized from JSONL and do not correspond to wall-clock
  // arrivals. The first `assistant_text` of a live turn captures
  // `firstAssistantDeltaAt` for the TTFT readout; thinking deltas do
  // NOT count for TTFT (TTFT is "time-to-first-assistant-output").
  const now = Date.now();
  const isReplay = state.phase === "replaying";
  const streamFold = isReplay ? {} : foldStreamEvent(state, now);
  const firstAssistantDeltaAt =
    !isReplay && channel === "assistant" && state.firstAssistantDeltaAt === null
      ? now
      : state.firstAssistantDeltaAt;

  return {
    state: {
      ...state,
      phase: nextPhase,
      activeMsgId: msgId,
      scratch,
      ...streamFold,
      firstAssistantDeltaAt,
    },
    effects,
  };
}

// ---------------------------------------------------------------------------
// Tool call lifecycle
// ---------------------------------------------------------------------------

/**
 * Serialize the current toolCallMap values into the JSON string the
 * `inflight.tools` PropertyStore path holds. Insertion order is
 * preserved by `Map.values()`.
 */
function serializeToolCalls(
  toolCallMap: ReadonlyMap<string, ToolCallState>,
): string {
  return JSON.stringify(Array.from(toolCallMap.values()));
}

/**
 * Predicate driving the `tool_work → streaming` transition: every
 * entry must be terminal (`done` or `error`). An empty map counts as
 * "all done" but the reducer only calls this after a state-changing
 * tool event, so the empty case never triggers a spurious return.
 */
function allToolsTerminal(
  toolCallMap: ReadonlyMap<string, ToolCallState>,
): boolean {
  for (const entry of toolCallMap.values()) {
    if (entry.status !== "done" && entry.status !== "error") {
      return false;
    }
  }
  return true;
}

function handleToolUse(
  state: CodeSessionState,
  event: ToolUseEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (
    state.phase !== "submitting" &&
    state.phase !== "awaiting_first_token" &&
    state.phase !== "streaming" &&
    state.phase !== "tool_work" &&
    state.phase !== "replaying"
  ) {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const toolName = event.tool_name;
  const incomingInput = (event.input ?? {}) as Record<string, unknown>;
  // A subagent's tool calls carry `parent_tool_use_id`; top-level calls
  // omit it. Narrowed defensively — the field is new on the wire and an
  // index-signature reach away from a plain `unknown`.
  const incomingParentId =
    typeof event.parent_tool_use_id === "string"
      ? event.parent_tool_use_id
      : undefined;

  const toolCallMap = new Map(state.toolCallMap);
  const toolUseStartedAt = new Map(state.toolUseStartedAt);
  const existing = toolCallMap.get(toolUseId);

  if (existing) {
    // Continuation — Claude streams `tool_use` twice for a logical
    // call (first with `input: {}`, then with the filled-in input).
    // The second event carries the same `tool_name`, so we overwrite
    // freely; only `input` is gated so an empty-object continuation
    // doesn't clobber a previously-filled payload. `parentToolUseId`
    // is sticky once set — a call's parent never changes — so a
    // continuation that omits it keeps the established link.
    const nextInput =
      Object.keys(incomingInput).length > 0 ? incomingInput : existing.input;
    toolCallMap.set(toolUseId, {
      ...existing,
      input: nextInput,
      parentToolUseId: existing.parentToolUseId ?? incomingParentId,
    });
  } else {
    toolCallMap.set(toolUseId, {
      toolUseId,
      toolName,
      input: incomingInput,
      status: "pending",
      result: null,
      structuredResult: null,
      parentToolUseId: incomingParentId,
      toolWallMs: null,
    });
    // First (non-continuation) tool_use carries the timing anchor for
    // this call's `toolWallMs`. Continuations refine the input only.
    // Replay events use the JSONL timestamp and never produce a
    // wall-clock duration; the `isReplaying` branch below skips this
    // capture by way of not entering this `else` for stored entries —
    // but the very first replayed tool_use still lands here. The
    // matching `handleToolResult` only computes a wall when NOT
    // replaying, so a leftover replay entry in the map is harmless.
    toolUseStartedAt.set(toolUseId, Date.now());
  }

  // Phase transition is live-only: `tool_use` flips `streaming` /
  // `submitting` / `awaiting_first_token` to `tool_work`; replay keeps
  // `replaying` because the bracket pair owns phase entry/exit.
  //
  // The write-inflight effect, by contrast, fires for both live and
  // replay ([L26] — per-turn paths are the sole render surface for
  // committed cells, so replayed turns must populate them too;
  // cold-boot rehydration depends on this symmetry). The
  // `pendingUserMessage` guard covers the genuine "no in-flight
  // turn" case (null between turns).
  const isReplaying = state.phase === "replaying";
  const effects: Effect[] =
    state.pendingUserMessage !== null
      ? [
          {
            kind: "write-inflight" as const,
            turnKey: state.pendingUserMessage.turnKey,
            channel: "tools" as const,
            value: serializeToolCalls(toolCallMap),
          },
        ]
      : [];

  // Telemetry: skip for replay; capture firstToolUseAt on first live
  // tool_use of this turn. Continuations of the same tool_use_id
  // still count for the stream-gap fold (they're wire events) but do
  // NOT advance `firstToolUseAt` past the first call.
  const now = Date.now();
  const streamFold = isReplaying ? {} : foldStreamEvent(state, now);
  const firstToolUseAt =
    !isReplaying && state.firstToolUseAt === null
      ? now
      : state.firstToolUseAt;

  return {
    state: {
      ...state,
      phase: isReplaying ? state.phase : "tool_work",
      activeMsgId: event.msg_id ?? state.activeMsgId,
      ...streamFold,
      firstToolUseAt,
      toolCallMap,
      toolUseStartedAt,
    },
    effects,
  };
}

function handleToolResult(
  state: CodeSessionState,
  event: ToolResultEvent,
): { state: CodeSessionState; effects: Effect[] } {
  // The transition table only lists tool_result under the
  // `tool_work → streaming` row for live turns. While replaying,
  // tool_result also accepted — it pairs with a prior tool_use that
  // landed in toolCallMap during this same replayed turn.
  if (state.phase !== "tool_work" && state.phase !== "replaying") {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const existing = state.toolCallMap.get(toolUseId);
  if (!existing) {
    console.warn(
      `[code-session-store] tool_result for unknown tool_use_id: ${toolUseId}`,
    );
    return { state, effects: [] };
  }

  // Compute per-call wall-clock. Live turns have a `toolUseStartedAt`
  // entry from the matching `handleToolUse`; replay turns do not (the
  // JSONL replay does not correspond to real-time arrivals, and the
  // committed entry's `toolWallMs` stays `null` per the field's contract).
  const isReplaying = state.phase === "replaying";
  const now = Date.now();
  const startedAt = state.toolUseStartedAt.get(toolUseId);
  const toolWallMs =
    !isReplaying && typeof startedAt === "number"
      ? Math.max(0, now - startedAt)
      : existing.toolWallMs;

  const toolCallMap = new Map(state.toolCallMap);
  toolCallMap.set(toolUseId, {
    ...existing,
    status: event.is_error === true ? "error" : "done",
    result: event.output ?? null,
    toolWallMs,
  });

  // Discard the start timestamp now that the wall-clock is committed
  // on the entry — keeps the map bounded.
  let toolUseStartedAt = state.toolUseStartedAt;
  if (toolUseStartedAt.has(toolUseId)) {
    toolUseStartedAt = new Map(toolUseStartedAt);
    toolUseStartedAt.delete(toolUseId);
  }

  // Phase transition is live-only: `tool_result` drives `tool_work
  // → streaming` once every entry is terminal. Replay keeps
  // `replaying`; the bracket's `replay_complete` returns to idle.
  //
  // The write-inflight effect, by contrast, fires for both live and
  // replay ([L26] — per-turn paths are the sole render surface for
  // committed cells, so replayed turns must populate them too;
  // cold-boot rehydration depends on this symmetry).
  const nextPhase: CodeSessionPhase = isReplaying
    ? state.phase
    : allToolsTerminal(toolCallMap)
      ? "streaming"
      : "tool_work";

  const effects: Effect[] =
    state.pendingUserMessage !== null
      ? [
          {
            kind: "write-inflight" as const,
            turnKey: state.pendingUserMessage.turnKey,
            channel: "tools" as const,
            value: serializeToolCalls(toolCallMap),
          },
        ]
      : [];

  const streamFold = isReplaying ? {} : foldStreamEvent(state, now);

  return {
    state: {
      ...state,
      phase: nextPhase,
      toolCallMap,
      toolUseStartedAt,
      ...streamFold,
    },
    effects,
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
  // wrapper rendering an empty body.
  if (
    state.phase !== "tool_work" &&
    state.phase !== "streaming" &&
    state.phase !== "replaying"
  ) {
    return { state, effects: [] };
  }

  const toolUseId = event.tool_use_id;
  const existing = state.toolCallMap.get(toolUseId);
  if (!existing) {
    console.warn(
      `[code-session-store] tool_use_structured for unknown tool_use_id: ${toolUseId}`,
    );
    return { state, effects: [] };
  }

  const toolCallMap = new Map(state.toolCallMap);
  toolCallMap.set(toolUseId, {
    ...existing,
    structuredResult: event.structured_result ?? null,
  });

  // Write the updated toolCallMap (now carrying `structuredResult`
  // on the matching entry) to the per-turn `.tools` path for both
  // live and replay ([L26] — per-turn paths are the sole render
  // surface for committed cells, and the structured-tool blocks
  // read `structuredResult` to render their bodies; gating this
  // write on `state.phase` strips the structured payload from every
  // cold-boot-rehydrated tool call). The `pendingUserMessage` guard
  // covers the genuine "no in-flight turn" case (null between
  // turns).
  const effects: Effect[] =
    state.pendingUserMessage !== null
      ? [
          {
            kind: "write-inflight" as const,
            turnKey: state.pendingUserMessage.turnKey,
            channel: "tools" as const,
            value: serializeToolCalls(toolCallMap),
          },
        ]
      : [];

  // Telemetry: fold stream-gap on live turns only.
  const isReplaying = state.phase === "replaying";
  const streamFold = isReplaying ? {} : foldStreamEvent(state, Date.now());

  return {
    state: { ...state, toolCallMap, ...streamFold },
    effects,
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
 * pendingUserMessage, etc.) is reset separately at each call site
 * because the queue-flush path needs to populate the next turn's slots
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
 * Build a committed `TurnEntry` from the current reducer state and
 * the chosen terminal reason. Folds any in-progress
 * awaiting-approval / transport-downtime intervals into their
 * accumulators so the committed entry reports the full intervals even
 * when the turn ended mid-pause / mid-disconnect (e.g.
 * `transport_lost`).
 *
 * The `result` field is derived from `reason` (`"complete"` →
 * `"success"`; everything else → `"interrupted"`) so legacy consumers
 * stay coherent until they migrate to `turnEndReason`.
 */
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

function buildTurnEntry(
  state: CodeSessionState,
  msgId: string,
  reason: TurnEndReason,
  endedAt: number,
  inlineTelemetry: TurnTelemetry | undefined,
): TurnEntry {
  const scratchEntry = state.scratch.get(msgId) ?? {
    assistant: "",
    thinking: "",
  };
  const submitAt = state.pendingUserMessage?.submitAt ?? endedAt;
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
    turnKey: state.pendingUserMessage?.turnKey ?? `msg-${msgId}`,
    userMessage: {
      text: state.pendingUserMessage?.text ?? "",
      attachments: state.pendingUserMessage?.atoms ?? [],
      submitAt,
    },
    thinking: scratchEntry.thinking,
    assistant: scratchEntry.assistant,
    toolCalls: Array.from(state.toolCallMap.values()),
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

  // turn_complete before any turn started — drop. (The `replaying`
  // phase is excluded from this guard because the replay translator
  // emits `turn_complete` while `replaying`; activeMsgId is set by
  // the preceding `assistant_text` / `tool_use` events.)
  if (
    state.activeMsgId === null &&
    state.phase === "idle"
  ) {
    return { state, effects: [] };
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
  // committed msg_id — the prior `user_message_replay` (if any) wrote
  // junk to `pendingUserMessage` and any preceding content frames
  // wrote to `scratch[msgId]`. If we early-return here without
  // clearing that pending state, `replay_complete`'s "in-flight cycle
  // survived the bracket" branch (chain-link 13) sees
  // `pendingUserMessage !== null` and transitions phase to
  // `streaming` after replay closes — leaving the card stuck with
  // `canInterrupt=true` and a Stop button that can't reach the wire.
  // Clear the stale pending state so duplicate turn_complete events
  // are inert beyond the no-op transcript commit.
  if (state.committedMsgIds.has(msgId)) {
    tugDevLogStore.warn(
      "code-session-store",
      "dropping duplicate turn_complete",
      { msgId },
    );
    const scratch = new Map(state.scratch);
    scratch.delete(msgId);
    return {
      state: {
        ...state,
        pendingUserMessage: null,
        activeMsgId: state.activeMsgId === msgId ? null : state.activeMsgId,
        scratch,
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
  const endedAt = Date.now();
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

  const scratch = new Map(state.scratch);
  scratch.delete(msgId);
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
        toolCallMap: new Map(),
        toolUseStartedAt: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingUserMessage: null,
        committedMsgIds,
        sessionInitTokens,
        ...resetPerTurnTelemetry(),
        ...closedPauseSegments,
      },
      effects: [{ kind: "append-transcript", entry }],
    };
  }

  // Single-tick collapse: a queued send on a successful turn flushes
  // in the same dispatch as the commit, so observers see the final
  // phase as `submitting`, not a transient `idle`.
  if (isSuccess && state.queuedSends.length > 0) {
    const [next, ...rest] = state.queuedSends;
    return {
      state: {
        ...state,
        phase: "submitting",
        activeMsgId: null,
        scratch,
        toolCallMap: new Map(),
        toolUseStartedAt: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingUserMessage: {
          text: next.text,
          atoms: next.atoms,
          submitAt: Date.now(),
          // `turnKey` was generated by the store wrapper at the
          // queueing `send` and carried on the queue entry. Reusing
          // it here keeps the reducer pure.
          turnKey: next.turnKey,
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
            text: next.text,
            attachments: [],
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
      toolCallMap: new Map(),
      toolUseStartedAt: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      pendingUserMessage: null,
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
  // Only meaningful during an active turn. Outside an active phase,
  // silently drop — the reducer stays total and the mid-turn gate
  // tolerates stray forwards from a stale feed replay.
  if (
    state.phase !== "streaming" &&
    state.phase !== "tool_work" &&
    state.phase !== "awaiting_first_token" &&
    state.phase !== "submitting"
  ) {
    return { state, effects: [] };
  }

  const forward = extractForward(event);
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

/**
 * Close the in-flight interrupt segment. Appends the closed
 * `[since, end]` pair onto `interruptInFlightIntervals` and clears
 * `interruptInFlightSegmentStartedAt`. Used by `handleTurnComplete`
 * (and the transport-lost commit path) so the just-ended turn's
 * pause history is complete before the new state lands. The latched
 * `interruptInFlight` boolean is cleared separately, by the same
 * call site, via `resetPerTurnTelemetry`.
 */
function closeInterruptInFlightInterval(
  state: CodeSessionState,
  end: number = Date.now(),
): {
  interruptInFlightSegmentStartedAt: null;
  interruptInFlightIntervals: ReadonlyArray<readonly [number, number]>;
} {
  if (state.interruptInFlightSegmentStartedAt === null) {
    return {
      interruptInFlightSegmentStartedAt: null,
      interruptInFlightIntervals: state.interruptInFlightIntervals,
    };
  }
  const start = state.interruptInFlightSegmentStartedAt;
  return {
    interruptInFlightSegmentStartedAt: null,
    interruptInFlightIntervals: [
      ...state.interruptInFlightIntervals,
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
  // `#step-3-5` in `roadmap/tide-interactive-dialogs.md` for why
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
      lastError: {
        cause: "session_state_errored",
        message,
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
  if (state.pendingUserMessage !== null) {
    const msgId = state.activeMsgId ?? `transport-lost-${state.pendingUserMessage.turnKey}`;
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
        scratch: (() => {
          const s = new Map(state.scratch);
          s.delete(msgId);
          return s;
        })(),
        toolCallMap: new Map(),
        toolUseStartedAt: new Map(),
        pendingApproval: null,
        pendingQuestion: null,
        prevPhase: null,
        pendingUserMessage: null,
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
  return {
    state: {
      ...state,
      ...perTurnReset,
      phase: "errored",
      transportState: "offline",
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
// user_message_replay)
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
      // Clear pendingUserMessage defensively — replay should never
      // observe one (idle/errored have it null), but a future caller
      // that drives `send` then `replay_started` synchronously would
      // otherwise leak the pending message into the first replayed
      // turn's commit.
      pendingUserMessage: null,
      // Same defensive clear for any in-flight scratch / tool state.
      // A live turn racing replay would be a supervisor-side bug,
      // but the reducer leaves no fingerprint of it on the snapshot.
      activeMsgId: null,
      scratch: new Map(),
      toolCallMap: new Map(),
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

  // Never-drop chain link 13: if `pendingUserMessage` survived the
  // bracket, the in-flight snapshot's `user_message_replay` landed
  // without a matching `turn_complete` (the live tail is still
  // streaming). Preserve `pendingUserMessage` + `scratch` +
  // `toolCallMap`, transition to `streaming` so post-bracket live
  // deltas continue to accumulate, and let the eventual live
  // `turn_complete` commit the TurnEntry naturally. Without this
  // preservation, replay_complete wipes the cycle and post-bracket
  // deltas land in `idle` (which `handleTextDelta`'s phase guard
  // rejects), the user sees no inflight indicator after HMR-mid-
  // stream, and the response never auto-syncs.
  if (state.pendingUserMessage !== null) {
    return {
      state: {
        ...state,
        phase: "streaming",
        // activeMsgId stays as whatever the snapshot's
        // assistant_text set (claude's id for the in-flight
        // message). scratch + toolCallMap preserved as-is.
        // pendingUserMessage preserved as-is.
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
      toolCallMap: new Map(),
      toolUseStartedAt: new Map(),
      pendingApproval: null,
      pendingQuestion: null,
      prevPhase: null,
      pendingUserMessage: null,
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
 * Sets `pendingUserMessage` so the upcoming `turn_complete` for the
 * same `msg_id` commits a `TurnEntry` with this user submission. No
 * `send-frame` effect — the user already submitted this message
 * historically; replaying it must NOT round-trip back to the wire.
 *
 * Drops in any phase other than `replaying`.
 */
function handleUserMessageReplay(
  state: CodeSessionState,
  event: UserMessageReplayEvent,
): { state: CodeSessionState; effects: Effect[] } {
  if (state.phase !== "replaying") {
    return { state, effects: [] };
  }
  const attachments: ReadonlyArray<AtomSegment> = (() => {
    const raw = event.attachments;
    return Array.isArray(raw) ? (raw as ReadonlyArray<AtomSegment>) : [];
  })();
  return {
    state: {
      ...state,
      pendingUserMessage: {
        text: event.text,
        atoms: attachments,
        submitAt: Date.now(),
        // Minted by the store wrapper in `frameToEvent` before
        // dispatching the replay event — keeps the reducer pure.
        turnKey: event.turnKey,
      },
      activeMsgId: event.msg_id,
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
    case "assistant_text":
      return handleTextDelta(state, event, "assistant", "assistant");
    case "thinking_text":
      return handleTextDelta(state, event, "thinking", "thinking");
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
    case "user_message_replay":
      return handleUserMessageReplay(state, event);
    case "bind_resume_acknowledged":
      return handleBindResumeAcknowledged(state);
    case "tick_soft_budget":
      return handleTickSoftBudget(state);
    case "tick_timeout_dwell_done":
      return handleTickTimeoutDwellDone(state);
    case "tick_preflight_done":
      return handleTickPreflightDone(state);
    default:
      return { state, effects: [] };
  }
}
