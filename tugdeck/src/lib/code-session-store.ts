/**
 * CodeSessionStore — per-Tide-card L02 store that owns Claude Code turn
 * state for a single `tug_session_id`. It observes filtered
 * CODE_OUTPUT / SESSION_STATE frames through a real `FeedStore`,
 * dispatches CODE_INPUT messages via `encodeCodeInputPayload`, and
 * exposes an append-only transcript plus an in-flight streaming
 * document that `TugMarkdownView` can render.
 *
 * Step 3 wires the basic `idle → submitting → awaiting_first_token →
 * streaming → idle` round-trip; Steps 4–8 extend the reducer to cover
 * streaming deltas, tool calls, control forwards, interrupt + queue,
 * and errored transitions.
 *
 * [D01] store owns filtered FeedStore
 * [D02] card owns CONTROL lifecycle
 * [D03] three-identifier model
 * [D04] transcript + streaming
 * [D09] metadata store independent
 * [D11] effect-list reducer
 */

import {
  FeedId,
  encodeCodeInputPayload,
  encodeRecordContextBreakdown,
  encodeRecordSessionStateChange,
  encodeRecordTurnTelemetry,
  type FeedIdValue,
} from "@/protocol";
import type { TugConnection } from "@/connection";
import type { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import {
  PropertyStore,
} from "@/components/tugways/property-store";
import { FeedStore } from "@/lib/feed-store";
import type { AtomSegment } from "./tug-atom-img";
import {
  createAtomBytesStore,
  type AtomBytesStore,
} from "./atom-bytes-store";
import {
  createInitialState,
  deriveActiveTurnSnapshot,
  reduce,
  type CodeSessionState,
} from "./code-session-store/reducer";
import { logSessionLifecycle } from "./session-lifecycle-log";
import type { CodeSessionEvent } from "./code-session-store/events";
import type { Effect } from "./code-session-store/effects";
import { publishLocalSessionStateChange } from "./session-state-changes-local-events";
import type {
  CardSessionMode,
  CodeSessionSnapshot,
  TurnEntry,
} from "./code-session-store/types";

export type {
  ActiveTurnSnapshot,
  CardSessionMode,
  CodeSessionSnapshot,
  CodeSessionPhase,
  TransportState,
  TurnEntry,
  Message,
  MessageKind,
  UserMessage,
  AssistantText,
  AssistantThinking,
  SystemNote,
  ToolUseMessage,
  QueuedSend,
  ControlRequestForward,
  CostSnapshot,
  LastReplayResult,
} from "./code-session-store/types";

export {
  REPLAY_PREFLIGHT_TIMEOUT_MS,
  REPLAY_SOFT_BUDGET_MS,
  REPLAY_TIMEOUT_DWELL_MS,
} from "./code-session-store/reducer";

/**
 * Timer source injected into `CodeSessionStore` for the replay-clock
 * `schedule_timer` / `cancel_timer` effects. Defaults to globalThis
 * timers in production; tests inject a fake source so they can
 * deterministically advance time without racing real wall-clock
 * delays.
 */
export interface TimerSource {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const DEFAULT_TIMER_SOURCE: TimerSource = {
  setTimeout: (cb, ms) =>
    (globalThis as { setTimeout: (cb: () => void, ms: number) => unknown })
      .setTimeout(cb, ms),
  clearTimeout: (handle) =>
    (globalThis as { clearTimeout: (handle: unknown) => void })
      .clearTimeout(handle),
};

const STREAM_SOURCE_TAG = "code-session-store";

/**
 * Mint a stable per-turn key. Used as the React-key seed for the
 * inflight cell pair and preserved unchanged through commit into
 * `TurnEntry.turnKey`. Lives in the store wrapper (not the reducer)
 * because `crypto.randomUUID()` is impure and the reducer is
 * contractually pure + time-independent.
 *
 * Fallback `turn-${time}-${random}` shape covers runtimes without
 * `crypto.randomUUID` — uniqueness is per-session, not global.
 */
function mintTurnKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** CODE_OUTPUT frame `type` values the reducer currently handles. */
const KNOWN_CODE_OUTPUT_TYPES: ReadonlySet<string> = new Set([
  "session_init",
  "content_block_start",
  "assistant_text",
  "thinking_text",
  "tool_use",
  "tool_result",
  "tool_use_structured",
  "turn_complete",
  "system_metadata",
  "control_request_forward",
  "cost_update",
  // Live intra-turn token usage — high-frequency telemetry frame the
  // reducer folds into `liveTurnUsage`; no phase change, no persist.
  "streaming_usage",
  "context_breakdown",
  "error",
  // tugcode emits this after a failed `--resume` spawn. The reducer
  // rolls it into `lastError`.
  "resume_failed",
  // Replay bracket events emitted by the JSONL replay translator.
  // The reducer transitions into / out of the `replaying` phase on
  // these and populates `lastReplayResult` on completion.
  "replay_started",
  "replay_complete",
  // Per-turn synthetic user-message frame emitted by the replay
  // translator at the start of each replayed turn (and by tugcode's
  // mid-turn snapshot path). The reducer's `handleAddUserMessage`
  // mints a `pendingTurn` whose `initialMessages` is `[user_message]`
  // so the subsequent `turn_complete` commits a `TurnEntry` with the
  // historical user submission text. Named per [D15]'s `add_<kind>`
  // template.
  "add_user_message",
  // Wake-bracket opener emitted by tugcode when claude resumes from
  // idle in response to an async deferred-completion trigger
  // (Monitor / CronCreate / ScheduleWakeup / …). The reducer
  // transitions `idle → waking` and accepts the wake's content
  // events; the bracket closes implicitly on the next `turn_complete`.
  // See `roadmap/tugplan-tide-session-wake.md` [D01].
  "wake_started",
]);

export interface CodeSessionStoreOptions {
  conn: TugConnection;
  /**
   * Connection-lifecycle event pipe. The store subscribes to
   * `connectionDidClose` to dispatch `transport_close` into the reducer
   * (idle phases drop it, non-idle routes to `errored`). Required so the
   * store has a single, named source of truth for transport-close
   * events; the legacy `TugConnection.onClose` callable was removed in
   * favor of this lifecycle.
   */
  lifecycle: ConnectionLifecycle;
  tugSessionId: string;
  displayLabel?: string;
  /**
   * The user's session-mode intent at card-open time, captured from
   * the per-card `CardSessionBinding`. Threaded onto
   * `CodeSessionSnapshot.sessionMode` so pure derivations (e.g.
   * `deriveTideCardBannerSpec`) can branch on it without a second
   * subscription to `cardSessionBindingStore`. Required: every binding
   * carries a mode, so every store has one. Stable for the store's
   * lifetime — a re-bind constructs a fresh services bag with a
   * fresh store.
   */
  sessionMode: CardSessionMode;
  /**
   * Test seam — defaults to globalThis `setTimeout` / `clearTimeout`.
   * Production callers omit this. Tests inject a captured-table
   * timer source so they can advance time deterministically.
   */
  timerSource?: TimerSource;
}

/**
 * L02 external store for a single Claude Code session's turn state.
 * See module JSDoc for scope and phasing.
 */
export class CodeSessionStore {
  readonly streamingDocument: PropertyStore;

  private readonly conn: TugConnection;
  private readonly lifecycle: ConnectionLifecycle;
  private readonly tugSessionId: string;
  private readonly displayLabel: string;
  private readonly sessionMode: CardSessionMode;
  private readonly feedStore: FeedStore;
  private readonly timerSource: TimerSource;
  /**
   * Active replay-clock timers keyed by their effect `name`
   * (`"preflight"`, `"soft_budget"`, `"timeout_dwell"`). Populated by
   * `schedule_timer` effects from the reducer; cleared by
   * `cancel_timer` effects, by the timer's own callback after it
   * dispatches the named tick event, and by `dispose()`.
   */
  private readonly _replayTimers: Map<string, unknown> = new Map();

  /**
   * Per-card bytes side-table for inline image attachments. One
   * instance is created at construction and survives until `dispose`;
   * the drop / paste handlers in the embedded text editor populate
   * it, the wire-flattening at submit-time reads from it, and the
   * `useCardStatePreservation` snapshot round-trips its contents
   * across cold boot / pane restore.
   *
   * Exposed via {@link getAtomBytesStore} so non-React consumers
   * (the drop / paste extensions inside CodeMirror) can reach it
   * through a thunk read at fire time ([L07]). Per
   * [D03](roadmap/tide-atoms.md#d03-atom-bytes-store).
   */
  private readonly atomBytesStore: AtomBytesStore;

  private state: CodeSessionState;
  private _transcript: ReadonlyArray<TurnEntry> = [];
  private _listeners: Array<() => void> = [];
  private _cachedSnapshot: CodeSessionSnapshot | null = null;
  private _disposed = false;
  private _feedStoreUnsub: (() => void) | null = null;
  /**
   * Aggregated unsubscribe callbacks for every `ConnectionLifecycle`
   * channel the store observes. Currently `connectionDidClose` (Step 1b)
   * and `connectionDidReconnect` (Step 5). Held as an array so adding
   * future channels is a one-line append at construction and a
   * one-line iteration at dispose; no chance of forgetting one.
   */
  private _lifecycleUnsubs: Array<() => void> = [];
  private _lastFrameByFeed: Map<number, unknown> = new Map();

  constructor(options: CodeSessionStoreOptions) {
    this.conn = options.conn;
    this.lifecycle = options.lifecycle;
    this.tugSessionId = options.tugSessionId;
    this.displayLabel = options.displayLabel ?? options.tugSessionId.slice(0, 8);
    this.sessionMode = options.sessionMode;
    this.timerSource = options.timerSource ?? DEFAULT_TIMER_SOURCE;

    // Per-card bytes side-table — populated at drop / paste, drained
    // at `clear()` on dispose. Snapshot rides
    // `useCardStatePreservation` so attachment bytes survive cold
    // boot and pane restore alongside the rest of the prompt-entry
    // draft. Per [D03](roadmap/tide-atoms.md#d03-atom-bytes-store).
    this.atomBytesStore = createAtomBytesStore();

    // The streaming document holds per-turn streaming paths only,
    // shaped `turn.${turnKey}.${channel}` (assistant / thinking /
    // tools). Each turn writes to its own path; every committed
    // turn's cell keeps observing the same path forever (no
    // overwrites). The previous legacy `inflight.*` paths are gone —
    // they were a parallel path system from before the turnKey
    // architecture and were inert in the transcript dispatch.
    this.streamingDocument = new PropertyStore({
      schema: [],
      initialValues: {},
      // Per-turn paths (`turn.${turnKey}.{channel}`) are minted at
      // `handleSend` and observed by `CodeRowCell` for the rest of
      // that turn's life — including after `turn_complete`, when
      // the path retains its final value forever. The set of paths
      // is unknowable at construction time; `dynamicPaths` lets
      // them register on first write rather than requiring a
      // brittle global enumeration.
      dynamicPaths: true,
    });

    this.state = createInitialState(
      this.tugSessionId,
      this.displayLabel,
      this.sessionMode,
    );

    this.feedStore = new FeedStore(
      this.conn,
      [
        FeedId.CODE_OUTPUT,
        FeedId.SESSION_STATE,
        FeedId.CONTROL,
      ] as ReadonlyArray<FeedIdValue>,
      undefined,
      (feedId, decoded) => this.acceptFrame(feedId, decoded),
    );
    this._feedStoreUnsub = this.feedStore.subscribe(() =>
      this.onFeedStoreChange(),
    );

    // Lifecycle wiring per [D07]: `ConnectionLifecycle` is the action
    // source, the reducer is the responder. The store subscribes once
    // at construction and translates the two lifecycle events that
    // matter to its reducer:
    //
    //   - `connectionDidClose` → `transport_close`. The reducer flips
    //     `transportState` to `offline` (and, for non-idle phases, the
    //     phase to `errored` per [D06]).
    //   - `connectionDidReconnect` → `transport_open`. The reducer
    //     flips `transportState` to `restoring` per [D08]. The
    //     lifecycle gates this event on a prior open + close, so the
    //     store never has to maintain a `_seenFirstOpen` flag of its
    //     own — initial-mount opens never reach this callback.
    //
    // Both subscriptions live for the store's lifetime; `dispose()`
    // unsubscribes the whole list.
    this._lifecycleUnsubs.push(
      this.lifecycle.observeConnectionDidClose(() => {
        if (this._disposed) return;
        this.dispatch({ type: "transport_close" });
      }),
    );
    this._lifecycleUnsubs.push(
      this.lifecycle.observeConnectionDidReconnect(() => {
        if (this._disposed) return;
        this.dispatch({ type: "transport_open" });
      }),
    );
  }

  /** L02 subscribe contract. Returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  };

  /**
   * Dev-only read-only accessor over the internal reducer state.
   * Used by `TugDevPanel`'s telemetry inspector to surface live
   * counters and live-clock anchors (`awaitingApprovalSince`,
   * `transportNonOnlineSince`, etc.) that aren't on the public
   * snapshot because they would surprise non-dev consumers. The
   * inspector pairs the returned state with the public snapshot for
   * stable fields (transcript, phase, transport).
   *
   * Returns the same reference for consecutive calls when no
   * dispatch has occurred — uses the same listener notification path
   * as `getSnapshot`, so consumers can subscribe via `subscribe` and
   * read this for fresh data.
   *
   * @internal — only consumed by the dev panel; not part of the
   *  public L02 contract.
   */
  _getInternalStateForDevPanel = (): CodeSessionState => this.state;

  /**
   * Test-only. Feed a wire frame into the store exactly as
   * `onFeedStoreChange` would for a real frame off the connection —
   * decode via `frameToEvent`, then `dispatch`. The app-test harness
   * drives a tide card through the lifecycle matrix with this;
   * production frames always arrive through the `FeedStore`
   * subscription, never here.
   *
   * `feedId` is a `FeedId` value (`CODE_OUTPUT` / `SESSION_STATE` /
   * `CONTROL`); `decoded` is the already-decoded frame payload, with
   * a `tug_session_id` matching this store's session. A frame whose
   * `type` is not reducer-relevant decodes to `null` and is a no-op.
   *
   * @internal — reached only through the DEV-gated `window.__tug` test
   *  surface; not part of the public L02 contract.
   */
  _ingestFrameForTest = (feedId: number, decoded: unknown): void => {
    if (this._disposed) return;
    const event = this.frameToEvent(feedId, decoded);
    if (event !== null) this.dispatch(event);
  };

  /**
   * Test-only. Drive the transport-lifecycle transitions the store
   * normally receives from `ConnectionLifecycle` — `"close"` dispatches
   * `transport_close` (→ `transportState: "offline"`), `"reconnect"`
   * dispatches `transport_open` (→ `"restoring"`). Lets an app-test
   * exercise the TRANSPORT_DOWN overlay without tearing down the real
   * shared connection.
   *
   * @internal — reached only through the DEV-gated `window.__tug` test
   *  surface.
   */
  _simulateTransportForTest = (kind: "close" | "reconnect"): void => {
    if (this._disposed) return;
    this.dispatch({
      type: kind === "close" ? "transport_close" : "transport_open",
    });
  };

  /**
   * L02 snapshot contract. Returns a stable reference between dispatches
   * that produce no state or transcript change — required for
   * `useSyncExternalStore` to avoid tearing ([D11]).
   */
  getSnapshot = (): CodeSessionSnapshot => {
    if (this._cachedSnapshot !== null) {
      return this._cachedSnapshot;
    }
    const snap: CodeSessionSnapshot = {
      phase: this.state.phase,
      transportState: this.state.transportState,
      interruptInFlight: this.state.interruptInFlight,
      tugSessionId: this.tugSessionId,
      displayLabel: this.displayLabel,
      sessionMode: this.sessionMode,
      activeMsgId: this.state.activeMsgId,
      // [D01] submit is gated on the conjunction of phase and
      // transport health. An idle card whose wire is offline must
      // refuse new turns until reconnect; a card whose phase is
      // errored but whose wire is back can still retry.
      // `replaying` excludes both submit and interrupt — the bracket
      // window owns the card; the user can only watch.
      canSubmit:
        (this.state.phase === "idle" || this.state.phase === "errored") &&
        this.state.transportState === "online",
      // `waking` is included per [Q03] resolution in
      // `roadmap/tugplan-tide-session-wake.md`: the user can stop a
      // runaway wake turn just like a user-initiated one. The
      // interrupt frame uses the same wire shape regardless — the
      // server doesn't need to distinguish.
      canInterrupt:
        this.state.phase === "submitting" ||
        this.state.phase === "awaiting_first_token" ||
        this.state.phase === "streaming" ||
        this.state.phase === "tool_work" ||
        this.state.phase === "awaiting_approval" ||
        this.state.phase === "waking",
      pendingApproval: this.state.pendingApproval,
      pendingQuestion: this.state.pendingQuestion,
      // The reducer rebuilds `queuedSends` only on enqueue / flush /
      // clear; passing the reference through unchanged preserves
      // `Object.is` stability across quiescent snapshot rebuilds so
      // `useSyncExternalStore` consumers ([L02]) don't see spurious
      // queue churn.
      queuedSends: this.state.queuedSends,
      transcript: this._transcript,
      // [D07] Derive the public `activeTurn` projection from
      // `state.pendingTurn` + `state.scratch[turnKey]`. `null` when no
      // turn is in flight; otherwise carries the turn-stable
      // `turnKey` + `submitAt` + `isWake` plus the live Message
      // sequence the data source iterates. The derivation is pure but
      // produces a fresh object on each call — the outer snapshot
      // cache (`_cachedSnapshot`) ensures `Object.is` stability across
      // quiescent reads, satisfying [L02] for downstream
      // `useSyncExternalStore` consumers.
      activeTurn: deriveActiveTurnSnapshot(this.state),
      // [D10]-style identity stability: pass the reducer's
      // pendingDraftRestore reference through unchanged so the
      // prompt-entry's `useLayoutEffect` (keyed on the slot's identity)
      // fires exactly once per CASE A interrupt — not on every
      // snapshot rebuild that touches an unrelated field.
      pendingDraftRestore: this.state.pendingDraftRestore,
      lastCost: this.state.lastCost,
      // Live intra-turn token usage — the latest `streaming_usage`
      // frame. The reducer assigns a fresh `liveTurnUsage` only on a
      // frame (and clears it to `null` at turn boundaries); passing
      // the reference through unchanged preserves `Object.is`
      // stability across quiescent snapshot rebuilds ([L02]).
      liveTurnUsage: this.state.liveTurnUsage,
      // `window(0)` — captured once from the session's first telemetry
      // iteration, never reassigned thereafter, so the reference is
      // trivially stable.
      sessionInitTokens: this.state.sessionInitTokens,
      // The reducer assigns a fresh `lastContextBreakdown` only when
      // a new `context_breakdown` frame lands; reading the state's
      // reference through unchanged preserves `Object.is` stability
      // across quiescent snapshot rebuilds ([L02]).
      lastContextBreakdown: this.state.lastContextBreakdown,
      lastError: this.state.lastError,
      lastReplayResult: this.state.lastReplayResult,
      replayPreflightActive: this.state.replayPreflightActive,
      replaySoftBudgetElapsed: this.state.replaySoftBudgetElapsed,
      replayTimeoutDwellActive: this.state.replayTimeoutDwellActive,
      // Per-turn pause-axis projections for the live-clock
      // derivation. Three closed-intervals arrays + three
      // segment-start timestamps, one set per axis. References pass
      // through unchanged so identity is stable across snapshot
      // rebuilds while the underlying reducer fields don't change
      // ([L02] `useSyncExternalStore` consumers see `Object.is`
      // stability during quiescent renders).
      //
      // Two of the three segment-start fields are renamed
      // projections of existing reducer fields (`awaitingApprovalSince`
      // → `awaitingApprovalSegmentStartedAt`, `transportNonOnlineSince`
      // → `transportDowntimeSegmentStartedAt`). The renames give all
      // three axes a uniform `<axis>SegmentStartedAt` vocabulary at
      // the snapshot surface so `deriveInflightActiveMs` can read
      // them generically.
      awaitingApprovalIntervals: this.state.awaitingApprovalIntervals,
      awaitingApprovalSegmentStartedAt: this.state.awaitingApprovalSince,
      transportDowntimeIntervals: this.state.transportDowntimeIntervals,
      transportDowntimeSegmentStartedAt: this.state.transportNonOnlineSince,
      interruptInFlightIntervals: this.state.interruptInFlightIntervals,
      interruptInFlightSegmentStartedAt:
        this.state.interruptInFlightSegmentStartedAt,
      // Wake-bracket trigger metadata, set during `phase === "waking"`
      // and cleared at the wake's terminal `turn_complete`. Reference
      // passed through unchanged so identity is stable across snapshot
      // rebuilds while the reducer's underlying field doesn't change
      // ([L02]). Slice 1 has no consumers; the field is plumbed so
      // Slice 2 chrome can read it without further reducer changes.
      wakeTrigger: this.state.wakeTrigger,
    };
    this._cachedSnapshot = snap;
    return snap;
  };

  /**
   * Submit a user message. The route (>, $, :) — when present — is the
   * leading atom in `atoms`; `tug-prompt-entry` (T3.4.b) owns route
   * extraction and the store is route-oblivious.
   */
  send(text: string, atoms: AtomSegment[]): void {
    if (this._disposed) return;
    // `turnKey` is generated in the impure wrapper layer (not in the
    // reducer) so the reducer remains pure and time-independent —
    // mirrors how timers live outside the reducer.
    this.dispatch({ type: "send", text, atoms, turnKey: mintTurnKey() });
  }

  /**
   * Per-card byte-payload store for inline image attachments. The
   * drop / paste extensions populate it at insert time; the
   * wire-flattening at submit reads from it; the
   * `useCardStatePreservation` snapshot round-trips it across pane
   * restore and cold boot. See {@link AtomBytesStore} and
   * [D03](roadmap/tide-atoms.md#d03-atom-bytes-store).
   *
   * Returns the live instance — callers should not snapshot or
   * memoize the reference across disposal. Survives until
   * `dispose()` clears it.
   */
  getAtomBytesStore(): AtomBytesStore {
    return this.atomBytesStore;
  }

  /**
   * Surface a transient attachment-rejection error on the card's
   * banner. Called by the drop / paste pipelines when
   * `downsampleImage` returns a discriminated error (oversized image
   * after JPEG-quality-60 fallback, unsupported source MIME, or a
   * decode failure on a corrupt / exotic source).
   *
   * Routes through the same `lastError` channel transport / wire
   * errors use; the existing `tide-card-banner-spec` and
   * `tide-card.tsx` label map render it as an inline banner. The
   * banner self-dismisses on the user's next successful submit
   * (the `lastError: null` reset in the turn-complete commit path).
   *
   * No-ops when the store has been disposed.
   */
  publishAttachmentError(message: string): void {
    if (this._disposed) return;
    this.dispatch({ type: "attachment_rejected", message });
  }

  /**
   * System notification: the per-card binding has been (re-)acked by
   * the supervisor and the wire is fully settled. Dispatched by the
   * `cardSessionBindingStore` subscriber in `tide-session-restore.ts`
   * after a restore completes; the reducer flips `transportState`
   * from `restoring` → `online` (and is a no-op when already online).
   *
   * Public rather than internal because the dispatch source lives
   * outside this class. The store does not subscribe to the binding
   * store directly: per [D04] / [D07] the binding subscriber in
   * `tide-session-restore.ts` is the canonical "binding has arrived"
   * signal, and feeding the event through a named method here keeps
   * `dispatch` private and the binding subscriber free of any
   * knowledge of the reducer event vocabulary.
   */
  notifyTransportSettled(): void {
    if (this._disposed) return;
    this.dispatch({ type: "transport_settled" });
  }

  /**
   * System notification: the per-card binding for a resume-mode
   * session has just been (re-)constructed and the wire is online.
   * Called by `cardServicesStore._construct` once, immediately after
   * the binding for `sessionMode === "resume"` lands. The reducer
   * opens the cold-boot preflight beat — `replayPreflightActive`
   * flips true and a 12s last-resort timer is scheduled. The
   * preflight clears on the first of: `replay_started`,
   * `replay_complete`, `transport_close`, or the 12s tick.
   *
   * Idempotent — re-calling while preflight is already active is a
   * reducer no-op (no second timer is scheduled). A no-op when
   * not in `idle` (e.g. mid-replay) since the live replay is what
   * the banner would otherwise be reflecting anyway.
   *
   * Public rather than internal because the dispatch source lives
   * outside this class — `cardServicesStore` is the single signal
   * point for "resume binding landed". Routing through a named
   * method here keeps `dispatch` private and the binding subscriber
   * free of any knowledge of the reducer event vocabulary, mirroring
   * the existing `notifyTransportSettled()` precedent.
   */
  notifyResumeBindingLanded(): void {
    if (this._disposed) return;
    this.dispatch({ type: "bind_resume_acknowledged" });
  }

  /**
   * Cancel the in-flight turn. Emits an `interrupt` CODE_INPUT frame
   * and clears any queued sends per [D05]. A no-op when the store is
   * `idle` / `errored` — accidental double-clicks don't spam the
   * server.
   *
   * Behavior splits on whether any *answer-channel* content has begun
   * — an `assistant_text` delta or a `tool_use`
   * (`firstAssistantDeltaAt === null && firstToolUseAt === null`).
   * Thinking does not cross the line: a turn that has emitted only
   * `thinking_text` is still a clean pull-down.
   *
   *   - **CASE A** (no answer content yet) — the wire received our
   *     `user_message` and claude may have thought, but produced
   *     nothing committable. The reducer captures `pendingUserMessage`
   *     into `pendingDraftRestore` for the prompt entry to seed back
   *     into the editor, clears the in-flight pair so the transcript
   *     stops rendering it, and returns `phase` to `idle`. The wire's
   *     eventual `turn_complete(error)` is suppressed by the
   *     `pendingCaseAEchoes` gate — no `TurnEntry` is appended.
   *   - **CASE B** (answer content has begun) — claude has produced at
   *     least one `assistant_text` delta or `tool_use`. Phase stays put
   *     (or restores from `awaiting_approval` to its `prevPhase`), the
   *     wire's `turn_complete(error)` commits a `TurnEntry` carrying
   *     whatever scratch has accumulated with `result: "interrupted"`.
   */
  interrupt(): void {
    if (this._disposed) return;
    this.dispatch({ type: "interrupt_action" });
  }

  /**
   * Acknowledge that the prompt-entry editor has applied the most
   * recent CASE A draft restore. The reducer clears
   * `pendingDraftRestore` to `null` so the editor's
   * `useLayoutEffect` (keyed on the slot's identity) does not
   * re-apply the same restore on subsequent snapshot rebuilds.
   *
   * Idempotent — a call while the slot is already `null` is a state-
   * ref-stable no-op and produces no listener notification.
   *
   * Public rather than internal because the dispatch source is the
   * UI surface (`TugPromptEntry`), not the reducer; routing through a
   * named method here keeps `dispatch` private and the prompt-entry
   * free of any reducer-event-vocabulary knowledge — the same
   * precedent as `notifyTransportSettled` /
   * `notifyResumeBindingLanded`.
   */
  consumePendingDraftRestore(): void {
    if (this._disposed) return;
    this.dispatch({ type: "consume_draft_restore" });
  }

  /**
   * Un-send one queued mid-turn submission, identified by the
   * `turnKey` its transcript ghost row carries. The send was queued
   * but never dispatched, so this is a pure local removal — no wire
   * frame. The reducer offers the prompt back through
   * `pendingDraftRestore`. A no-op if the send already flushed (a race
   * with `turn_complete`) or the store is disposed.
   */
  cancelQueuedSend(turnKey: string): void {
    if (this._disposed) return;
    this.dispatch({ type: "cancel_queued_send", turnKey });
  }

  /**
   * Pop the newest pending interactive — the unified Stop / Esc /
   * Cancel gesture across the Tide interactive-dialog family.
   *
   * Stack semantic. The "interactive stack" is the implicit LIFO
   * order of cancellable things attached to the current turn:
   *
   *   1. Queued sends — user messages already submitted but not yet
   *      on the wire (the turn ahead is still running). Popping one
   *      of these is a true un-send: no wire frame; the reducer
   *      offers the prompt back via `pendingDraftRestore`.
   *   2. The running turn itself — the assistant's in-flight work.
   *      Once the queue is empty, this method reaches the turn and
   *      emits an `interrupt` frame (CASE A pull-down or CASE B
   *      interrupt per the threshold).
   *
   * A turn with N queued sends takes N + 1 pops to fully unwind.
   *
   * What "interactive" means here. Every Tide UI surface that asks
   * the user for input — the prompt entry, `QuestionDialog`, the
   * Stop button — funnels its walk-away gesture through this
   * method. Esc reaches it via the responder chain's
   * `CANCEL_DIALOG` action; the prompt entry's Stop button calls it
   * directly; `QuestionDialog`'s Cancel button calls it directly.
   * One gesture, one wire signal, one model reading — no
   * `respondX({})` paths that the assistant could read as "user
   * picked the defaults."
   *
   * Carve-outs (gestures that look like "cancel" but are not pops):
   *
   *   - `PermissionDialog`'s `Deny` is a positive decision via
   *     `respondApproval`, not a walk-away. Routed through the
   *     dialog's own handler.
   *   - `AskUserQuestionToolBlock`'s salvage UI `Cancel` is a local
   *     dismissal of the recovery surface — the failed tool call
   *     has already resolved with an error before the salvage UI
   *     mounts, so there is no pending interactive to pop. Uses
   *     local component state, not this method.
   *
   * No-op when the store is disposed.
   */
  popInteractive(): void {
    if (this._disposed) return;
    const queued = this.getSnapshot().queuedSends;
    if (queued.length > 0) {
      this.cancelQueuedSend(queued[queued.length - 1].turnKey);
      return;
    }
    this.interrupt();
  }

  /**
   * Respond to a pending permission prompt. Emits a `tool_approval`
   * frame and restores the phase that was active before the
   * `control_request_forward` arrived (typically `tool_work`).
   */
  respondApproval(
    requestId: string,
    payload: {
      decision: "allow" | "deny";
      updatedInput?: unknown;
      message?: string;
    },
  ): void {
    if (this._disposed) return;
    this.dispatch({
      type: "respond_approval",
      request_id: requestId,
      decision: payload.decision,
      updatedInput: payload.updatedInput,
      message: payload.message,
    });
  }

  /**
   * Respond to a pending `AskUserQuestion` prompt. Emits a
   * `question_answer` frame and restores the phase that was active
   * before the `control_request_forward` arrived.
   */
  respondQuestion(
    requestId: string,
    payload: { answers: Record<string, unknown> },
  ): void {
    if (this._disposed) return;
    this.dispatch({
      type: "respond_question",
      request_id: requestId,
      answers: payload.answers,
    });
  }

  /**
   * Local teardown: unsubscribe from FeedStore, clear listeners, clear
   * queuedSends, clear in-flight streaming paths. Per [L23] the
   * transcript is user-visible state and is NOT cleared. Per [D02] the
   * card owns `close_session` — this method never writes a CONTROL frame.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._feedStoreUnsub) {
      this._feedStoreUnsub();
      this._feedStoreUnsub = null;
    }
    for (const unsub of this._lifecycleUnsubs) {
      unsub();
    }
    this._lifecycleUnsubs = [];
    this.feedStore.dispose();
    // Cancel every in-flight replay-clock timer. After dispose, even
    // if a callback fires before the cancel takes effect (timer
    // sources without instant cancellation guarantees), the
    // `_disposed` guard inside the schedule_timer callback drops the
    // dispatch — listeners are already cleared and the reducer
    // wouldn't observe its tick anyway.
    for (const handle of this._replayTimers.values()) {
      this.timerSource.clearTimeout(handle);
    }
    this._replayTimers.clear();
    this._listeners = [];
    this.state.queuedSends = [];
    // Release any retained attachment bytes; the bytes-store is per-
    // card and has no consumers past dispose.
    this.atomBytesStore.clear();
    // No per-turn-path cleanup on dispose: the streamingDocument
    // dies with the store instance, taking its accumulated paths
    // with it. Consumers that survived past dispose would already
    // be in undefined-behaviour territory.
    this._cachedSnapshot = null;
  }

  // ---------------------------------------------------------------------
  // Internal dispatch pipeline
  // ---------------------------------------------------------------------

  /**
   * Per-card frame filter. For CODE_OUTPUT and SESSION_STATE the rule
   * is simple: match on the payload's `tug_session_id`. For CONTROL it
   * is relaxed: session-scoped non-error frames (e.g. `spawn_session_ok`)
   * still require a tsid match, but CONTROL *error* frames are
   * accepted either way — some (`session_unknown`) carry
   * `tug_session_id`, while others (`session_not_owned`, per
   * `router.rs`'s rejection handler) do not. The reducer's phase gate
   * decides which store owns an unrouted error, so the filter stays
   * permissive on the CONTROL-error path without flooding non-active
   * stores with spurious transitions.
   */
  private acceptFrame(feedId: number, decoded: unknown): boolean {
    const d = decoded as { tug_session_id?: string; type?: string };
    if (feedId === FeedId.CONTROL) {
      if (d.type === "error") {
        return (
          d.tug_session_id === undefined ||
          d.tug_session_id === this.tugSessionId
        );
      }
      return d.tug_session_id === this.tugSessionId;
    }
    return d.tug_session_id === this.tugSessionId;
  }

  private onFeedStoreChange(): void {
    if (this._disposed) return;
    const snap = this.feedStore.getSnapshot();
    for (const [feedId, value] of snap.entries()) {
      if (this._lastFrameByFeed.get(feedId) !== value) {
        this._lastFrameByFeed.set(feedId, value);
        const event = this.frameToEvent(feedId, value);
        if (event !== null) {
          this.dispatch(event);
        }
      }
    }
  }

  private frameToEvent(
    feedId: number,
    decoded: unknown,
  ): CodeSessionEvent | null {
    if (feedId === FeedId.CODE_OUTPUT) {
      const ev = decoded as { type?: string } & Record<string, unknown>;
      if (typeof ev.type !== "string") return null;
      if (!KNOWN_CODE_OUTPUT_TYPES.has(ev.type)) return null;
      if (ev.type === "session_init") {
        // Divergence check: log loudly if claude's session_id differs
        // from our tugSessionId. Tugdeck operates on a single id
        // (tugSessionId, decided by the picker); a divergence here
        // would be a tugcast/tugcode bug that broke the post-Phase-B
        // invariant. The store does not consume claude's id for any
        // user-facing purpose — see reducer.handleSessionInit.
        const claudeSid = typeof ev.session_id === "string" ? ev.session_id : null;
        logSessionLifecycle("code_store.session_init_recv", {
          tug_session_id: this.tugSessionId,
          claude_session_id: claudeSid,
          divergent: claudeSid !== null && claudeSid !== this.tugSessionId,
        });
      } else if (ev.type === "resume_failed") {
        logSessionLifecycle("code_store.resume_failed_recv", {
          tug_session_id: this.tugSessionId,
          stale_session_id: typeof ev.stale_session_id === "string"
            ? ev.stale_session_id
            : null,
          reason: typeof ev.reason === "string" ? ev.reason : null,
        });
      }
      if (ev.type === "add_user_message") {
        // `turnKey` is a client-side React-key seed minted by the
        // store wrapper for every dispatched replay event. The wire
        // doesn't (and shouldn't) carry it — replay is a synthesis
        // of historical user submissions, and the cell wrapper
        // identity is purely React's concern. Minting here keeps the
        // reducer pure: it never calls `crypto.randomUUID()`.
        return { ...ev, turnKey: mintTurnKey() } as unknown as CodeSessionEvent;
      }
      if (ev.type === "wake_started") {
        // Same mint contract as `add_user_message`: the wake's
        // turnKey is a React-key seed with no meaning on the wire.
        // tugcode does not mint it (tugcode is a Node subprocess; it
        // has no React); the store wrapper mints it on receipt and
        // threads it onto the dispatched event so the reducer stays
        // pure. See `roadmap/tugplan-tide-session-wake.md` [D02].
        return { ...ev, turnKey: mintTurnKey() } as unknown as CodeSessionEvent;
      }
      return ev as unknown as CodeSessionEvent;
    }
    if (feedId === FeedId.SESSION_STATE) {
      // SESSION_STATE payload shape is `{ tug_session_id, state, detail }`.
      // Only `state: "errored"` maps to a reducer event; all other
      // states (`pending`, `spawning`, `closed`, …) are dropped.
      const ss = decoded as { state?: string; detail?: string };
      if (ss.state !== "errored") return null;
      return {
        type: "session_state_errored",
        detail: typeof ss.detail === "string" ? ss.detail : undefined,
      };
    }
    if (feedId === FeedId.CONTROL) {
      // Only CONTROL *error* frames map to reducer events. Everything
      // else (`spawn_session_ok`, `session_backpressure`, app-level
      // actions like `reload` / `set-theme`) either belongs to
      // `action-dispatch.ts` or is dropped by `acceptFrame` upstream
      // of this point. The two error details we recognize are
      // `session_unknown` (supervisor orphan dispatcher) and
      // `session_not_owned` (router P5 authz reject).
      const ce = decoded as { type?: string; detail?: string };
      if (ce.type !== "error") return null;
      if (ce.detail === "session_unknown") {
        return { type: "session_unknown", detail: ce.detail };
      }
      if (ce.detail === "session_not_owned") {
        return { type: "session_not_owned", detail: ce.detail };
      }
      return null;
    }
    return null;
  }

  private dispatch(event: CodeSessionEvent): void {
    const prev = this.state;
    const { state, effects } = reduce(this.state, event);
    this.state = state;
    this.processEffects(effects);
    this.maybePersistStateChange(prev, state);
    if (prev !== state || effects.length > 0) {
      this._cachedSnapshot = null;
      this.notifyListeners();
    }
  }

  /**
   * After every reduce, compare the indicator-tone triple `(phase,
   * transportState, interruptInFlight)` between prev and next state.
   * If any axis changed, fire-and-forget a
   * `record_session_state_change` CONTROL frame so the supervisor
   * appends one row to the `session_state_changes` ledger. This is
   * the client-side primary dedupe; the ledger layer dedupes against
   * the most-recent persisted triple as a race safety-net.
   *
   * The triple seeds the popover's state-change log
   * (Step 20.4.9); persistence survives reload so the log is not
   * lost when the card re-mounts. The collapse rules (transcript-
   * length, `pendingApproval` vs `pendingQuestion`, `queuedSends`,
   * `turnEndReason`, DRILLDOWN_OPEN) are owned by the reducer's
   * indicator-tone derivation; this hook only sees what the snapshot
   * already exposes through these three fields. See the parent plan
   * step's "Coverage and known collapses" note.
   */
  private maybePersistStateChange(
    prev: CodeSessionState,
    next: CodeSessionState,
  ): void {
    if (
      prev.phase === next.phase &&
      prev.transportState === next.transportState &&
      prev.interruptInFlight === next.interruptInFlight
    ) {
      return;
    }
    const atMs = Date.now();
    const frame = encodeRecordSessionStateChange({
      tugSessionId: this.tugSessionId,
      atMs,
      phase: next.phase,
      transportState: next.transportState,
      interruptInFlight: next.interruptInFlight,
    });
    this.conn.send(frame.feedId, frame.payload);
    // Local notify for any popover subscribed to this card's
    // state-change log. Same `atMs` as the wire write so the
    // persisted row and the locally-published row carry identical
    // timestamps — important for the popover's dedupe-on-subsequent-
    // reload path.
    publishLocalSessionStateChange({
      tugSessionId: this.tugSessionId,
      atMs,
      phase: next.phase,
      transportState: next.transportState,
      interruptInFlight: next.interruptInFlight,
    });
  }

  private processEffects(effects: Effect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case "write-inflight":
          // Per-Message path `turn.${turnKey}.message.${messageKey}.${channel}`
          // ([D07]). Each Message's path is stable from mint through
          // commit (the cell wrapper subscribing to it survives the
          // inflight → committed transition without a React unmount);
          // each new Message of the same turn writes to its own path
          // so streaming subscriptions don't cross-pollinate.
          this.streamingDocument.set(
            `turn.${effect.turnKey}.message.${effect.messageKey}.${effect.channel}`,
            effect.value,
            STREAM_SOURCE_TAG,
          );
          break;
        case "clear-inflight":
          // No-op under the per-turn-paths architecture. Each turn
          // writes to its own path; nothing needs clearing at
          // `turn_complete`. Kept as an enum variant so the reducer
          // (which still emits the effect at turn boundaries — see
          // `handleTurnComplete`) doesn't need a coordinated change.
          // If `clear-inflight` outlives its callers, fold the
          // emission out of the reducer too.
          break;
        case "send-frame":
          this.conn.send(
            FeedId.CODE_INPUT,
            encodeCodeInputPayload(effect.msg, this.tugSessionId),
          );
          break;
        case "append-transcript":
          // Copy-on-write so old snapshot refs remain valid for
          // useSyncExternalStore consumers.
          this._transcript = [...this._transcript, effect.entry];
          break;
        case "schedule_timer": {
          // Re-entry on the same name cancels the prior timer first
          // so neither callback can race with the new one.
          const prior = this._replayTimers.get(effect.name);
          if (prior !== undefined) {
            this.timerSource.clearTimeout(prior);
          }
          const fire = effect.fire;
          const name = effect.name;
          const handle = this.timerSource.setTimeout(() => {
            this._replayTimers.delete(name);
            if (this._disposed) return;
            this.dispatch(fire);
          }, effect.ms);
          this._replayTimers.set(effect.name, handle);
          break;
        }
        case "cancel_timer": {
          const handle = this._replayTimers.get(effect.name);
          if (handle !== undefined) {
            this.timerSource.clearTimeout(handle);
            this._replayTimers.delete(effect.name);
          }
          break;
        }
        case "record-telemetry": {
          // Fire-and-forget CONTROL frame to the supervisor. Persists
          // the per-turn telemetry block in the sqlite SessionLedger
          // so the next resume can inline it onto the replayed
          // `turn_complete`. The supervisor doesn't ack; the
          // reducer's TurnEntry is already committed locally — the
          // wire write is purely "remember this for the next reload."
          const frame = encodeRecordTurnTelemetry({
            tugSessionId: this.tugSessionId,
            msgId: effect.msgId,
            telemetry: effect.telemetry,
            endedAt: effect.endedAt,
          });
          this.conn.send(frame.feedId, frame.payload);
          break;
        }
        case "record-context-breakdown": {
          // Fire-and-forget CONTROL frame to the supervisor. Persists
          // the `/context`-style breakdown blob in the sqlite
          // `context_breakdown_latest` table so the next bind can
          // re-emit it as a synthetic `context_breakdown` frame
          // before any new live frame lands. Idempotent on
          // `tug_session_id` via UPSERT — repeat writes overwrite.
          const frame = encodeRecordContextBreakdown({
            tugSessionId: this.tugSessionId,
            payload: effect.payload,
            capturedAt: effect.capturedAt,
          });
          this.conn.send(frame.feedId, frame.payload);
          break;
        }
      }
    }
  }

  private notifyListeners(): void {
    for (const listener of this._listeners.slice()) {
      listener();
    }
  }
}
