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
} from "./code-session-store/types";

const STREAM_SOURCE_TAG = "code-session-store";

/** CODE_OUTPUT frame `type` values the reducer currently handles. */
const KNOWN_CODE_OUTPUT_TYPES: ReadonlySet<string> = new Set([
  "session_init",
  "assistant_text",
  "turn_complete",
  "system_metadata",
]);

export interface CodeSessionStoreOptions {
  conn: TugConnection;
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
  private readonly tugSessionId: string;
  private readonly displayLabel: string;
  private readonly feedStore: FeedStore;

  private state: CodeSessionState;
  private _transcript: ReadonlyArray<TurnEntry> = [];
  private _listeners: Array<() => void> = [];
  private _cachedSnapshot: CodeSessionSnapshot | null = null;
  private _disposed = false;
  private _feedStoreUnsub: (() => void) | null = null;
  private _lastFrameByFeed: Map<number, unknown> = new Map();

  constructor(options: CodeSessionStoreOptions) {
    this.conn = options.conn;
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
      [FeedId.CODE_OUTPUT, FeedId.SESSION_STATE] as ReadonlyArray<FeedIdValue>,
      undefined,
      (_feedId, decoded) =>
        (decoded as { tug_session_id?: string }).tug_session_id ===
        this.tugSessionId,
    );
    this._feedStoreUnsub = this.feedStore.subscribe(() =>
      this.onFeedStoreChange(),
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
   * that produce no state, transcript, or claudeSessionId change — required
   * for `useSyncExternalStore` to avoid tearing ([D11]).
   */
  getSnapshot = (): CodeSessionSnapshot => {
    if (this._cachedSnapshot !== null) {
      return this._cachedSnapshot;
    }
    const snap: CodeSessionSnapshot = {
      phase: this.state.phase,
      tugSessionId: this.tugSessionId,
      claudeSessionId: this.state.claudeSessionId,
      displayLabel: this.displayLabel,
      activeMsgId: this.state.activeMsgId,
      canSubmit: this.state.phase === "idle" || this.state.phase === "errored",
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
      streamingPaths: STREAMING_PATHS,
      lastCostUsd: this.state.lastCostUsd,
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

  /** Step 7 scaffold — real dispatch lands there. */
  interrupt(): void {
    throw new Error("CodeSessionStore.interrupt: not implemented");
  }

  /** Step 6 scaffold — real dispatch lands there. */
  respondApproval(
    _requestId: string,
    _payload: {
      decision: "allow" | "deny";
      updatedInput?: unknown;
      message?: string;
    },
  ): void {
    throw new Error("CodeSessionStore.respondApproval: not implemented");
  }

  /** Step 6 scaffold — real dispatch lands there. */
  respondQuestion(
    _requestId: string,
    _payload: { answers: Record<string, unknown> },
  ): void {
    throw new Error("CodeSessionStore.respondQuestion: not implemented");
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
      return ev as unknown as CodeSessionEvent;
    }
    // Step 8 wires SESSION_STATE handling.
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
