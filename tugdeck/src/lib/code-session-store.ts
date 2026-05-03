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
  type FeedIdValue,
} from "@/protocol";
import type { TugConnection } from "@/connection";
import type { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import {
  PropertyStore,
  type PropertyDescriptor,
} from "@/components/tugways/property-store";
import { FeedStore } from "@/lib/feed-store";
import type { AtomSegment } from "./tug-atom-img";
import {
  createInitialState,
  reduce,
  type CodeSessionState,
} from "./code-session-store/reducer";
import { logSessionLifecycle } from "./session-lifecycle-log";
import type { CodeSessionEvent } from "./code-session-store/events";
import type { Effect } from "./code-session-store/effects";
import type {
  CodeSessionSnapshot,
  TurnEntry,
} from "./code-session-store/types";
import { STREAMING_PATHS } from "./code-session-store/types";

export type {
  CodeSessionSnapshot,
  CodeSessionPhase,
  TurnEntry,
  ToolCallState,
  ControlRequestForward,
  CostSnapshot,
} from "./code-session-store/types";

const STREAM_SOURCE_TAG = "code-session-store";

/** CODE_OUTPUT frame `type` values the reducer currently handles. */
const KNOWN_CODE_OUTPUT_TYPES: ReadonlySet<string> = new Set([
  "session_init",
  "assistant_text",
  "thinking_text",
  "tool_use",
  "tool_result",
  "tool_use_structured",
  "turn_complete",
  "system_metadata",
  "control_request_forward",
  "cost_update",
  "error",
  // tugcode emits this after a failed `--resume` spawn. The reducer
  // rolls it into `lastError`.
  "resume_failed",
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
  private readonly feedStore: FeedStore;

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

    const descriptors: PropertyDescriptor[] = [
      {
        path: "inflight.assistant",
        type: "string",
        label: "In-flight assistant text",
      },
      {
        path: "inflight.thinking",
        type: "string",
        label: "In-flight thinking text",
      },
      {
        path: "inflight.tools",
        type: "string",
        label: "In-flight tool calls (JSON string)",
      },
    ];

    this.streamingDocument = new PropertyStore({
      schema: descriptors,
      initialValues: {
        "inflight.assistant": "",
        "inflight.thinking": "",
        "inflight.tools": "[]",
      },
    });

    this.state = createInitialState(this.tugSessionId, this.displayLabel);

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
      tugSessionId: this.tugSessionId,
      displayLabel: this.displayLabel,
      activeMsgId: this.state.activeMsgId,
      // [D01] submit is gated on the conjunction of phase and
      // transport health. An idle card whose wire is offline must
      // refuse new turns until reconnect; a card whose phase is
      // errored but whose wire is back can still retry.
      canSubmit:
        (this.state.phase === "idle" || this.state.phase === "errored") &&
        this.state.transportState === "online",
      canInterrupt:
        this.state.phase === "submitting" ||
        this.state.phase === "awaiting_first_token" ||
        this.state.phase === "streaming" ||
        this.state.phase === "tool_work" ||
        this.state.phase === "awaiting_approval",
      pendingApproval: this.state.pendingApproval,
      pendingQuestion: this.state.pendingQuestion,
      queuedSends: this.state.queuedSends.length,
      transcript: this._transcript,
      // [D10] Mirror the reducer's `pendingUserMessage` onto the
      // snapshot as `inflightUserMessage`. Pass the reference through
      // unchanged so its identity is stable across snapshot rebuilds
      // while the same pending message is in flight — downstream
      // `useSyncExternalStore` consumers ([L02]) need `Object.is`
      // stability to avoid spurious re-renders.
      inflightUserMessage: this.state.pendingUserMessage,
      streamingPaths: STREAMING_PATHS,
      lastCost: this.state.lastCost,
      lastError: this.state.lastError,
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
    this.dispatch({ type: "send", text, atoms });
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
   * Cancel the in-flight turn. Emits an `interrupt` CODE_INPUT frame
   * and clears any queued sends per [D05]. A no-op when the store is
   * `idle` / `errored` — accidental double-clicks don't spam the
   * server.
   */
  interrupt(): void {
    if (this._disposed) return;
    this.dispatch({ type: "interrupt_action" });
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
    this._listeners = [];
    this.state.queuedSends = [];
    this.streamingDocument.set(
      "inflight.assistant",
      "",
      STREAM_SOURCE_TAG,
    );
    this.streamingDocument.set("inflight.thinking", "", STREAM_SOURCE_TAG);
    this.streamingDocument.set("inflight.tools", "[]", STREAM_SOURCE_TAG);
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
    if (prev !== state || effects.length > 0) {
      this._cachedSnapshot = null;
      this.notifyListeners();
    }
  }

  private processEffects(effects: Effect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case "write-inflight":
          this.streamingDocument.set(
            effect.path,
            effect.value,
            STREAM_SOURCE_TAG,
          );
          break;
        case "clear-inflight":
          this.streamingDocument.set(
            "inflight.assistant",
            "",
            STREAM_SOURCE_TAG,
          );
          this.streamingDocument.set(
            "inflight.thinking",
            "",
            STREAM_SOURCE_TAG,
          );
          this.streamingDocument.set(
            "inflight.tools",
            "[]",
            STREAM_SOURCE_TAG,
          );
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
      }
    }
  }

  private notifyListeners(): void {
    for (const listener of this._listeners.slice()) {
      listener();
    }
  }
}
