/**
 * CodeSessionStore — per-Tide-card L02 store that owns Claude Code turn
 * state for a single `tug_session_id`. It observes filtered
 * CODE_OUTPUT / SESSION_STATE frames, dispatches CODE_INPUT messages via
 * `encodeCodeInputPayload`, and exposes an append-only transcript plus an
 * in-flight streaming document that `TugMarkdownView` can render.
 *
 * Step 1 ships the scaffold: construction, the streaming PropertyStore,
 * `subscribe` / `getSnapshot` (memoized per [D11]), `dispose`, and
 * not-implemented stubs for the action methods. Steps 3–8 fill in the
 * reducer transitions and wire up the real FeedStore subscription.
 *
 * [D01] store owns filtered FeedStore
 * [D02] card owns CONTROL lifecycle
 * [D03] three-identifier model
 * [D04] transcript + streaming
 * [D09] metadata store independent
 * [D11] effect-list reducer
 */

import type { TugConnection } from "@/connection";
import {
  PropertyStore,
  type PropertyDescriptor,
} from "@/components/tugways/property-store";
import type { AtomSegment } from "./tug-atom-img";
import {
  createInitialState,
  reduce,
  type CodeSessionState,
} from "./code-session-store/reducer";
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

  private state: CodeSessionState;
  private _transcript: TurnEntry[] = [];
  private _listeners: Array<() => void> = [];
  private _cachedSnapshot: CodeSessionSnapshot | null = null;
  private _disposed = false;

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
      transcript: this._transcript as ReadonlyArray<TurnEntry>,
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
   *
   * Step 1 is a scaffold — real dispatch lands in Step 3.
   */
  send(_text: string, _atoms: AtomSegment[]): void {
    // Reference the reducer so the import is not dead weight during Step 1.
    const { state, effects } = reduce(this.state, { type: "__noop__" });
    this.state = state;
    void effects;
    throw new Error("CodeSessionStore.send: not implemented");
  }

  /** Step 1 scaffold — real dispatch lands in Step 7. */
  interrupt(): void {
    throw new Error("CodeSessionStore.interrupt: not implemented");
  }

  /** Step 1 scaffold — real dispatch lands in Step 6. */
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

  /** Step 1 scaffold — real dispatch lands in Step 6. */
  respondQuestion(
    _requestId: string,
    _payload: { answers: Record<string, unknown> },
  ): void {
    throw new Error("CodeSessionStore.respondQuestion: not implemented");
  }

  /**
   * Local teardown: clear listeners, clear queuedSends, clear in-flight
   * streaming paths. Per [L23] the transcript is user-visible state and
   * is NOT cleared. Per [D02] the card owns `close_session` — this method
   * never writes a CONTROL frame.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._listeners = [];
    this.state.queuedSends = [];
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
    this.streamingDocument.set("inflight.tools", "[]", STREAM_SOURCE_TAG);
    this._cachedSnapshot = null;
  }
}
