/**
 * `pendingAskStore` — routes questions raised from outside the turn stream.
 *
 * A command-line tool that is about to do something the developer will feel can
 * `POST /api/ask` to tugcast and block. Tugcast broadcasts an `ask` CONTROL
 * frame; this store parks it on the target session's `CodeSessionStore` as
 * `pendingAsk`, the Session card renders a dialog, and the answer goes back the
 * way it came.
 *
 * Routing is by `sessionId` through `cardServicesStore.getByTugSessionId`. A
 * frame with no `sessionId` lands on the active session — a terminal one
 * directory over has no way to know which card the developer is looking at.
 *
 * The blocked caller is the reason for two behaviors that would otherwise look
 * over-careful:
 *
 *  - **A question that cannot be routed is answered immediately**, with the
 *    designated declining option, rather than dropped. Silence would leave the
 *    caller hanging until its own timeout.
 *  - **A session torn down under a live question answers on its way out**, for
 *    the same reason.
 *
 * **Laws:** [L02] — the store exposes `subscribe` + `getSnapshot`; the dialog
 * reads it through `useSyncExternalStore`, never through component state.
 *
 * @module lib/pending-ask-store
 */

import { cardServicesStore } from "./card-services-store";
import type { PendingAsk, PendingAskOption } from "./code-session-store/types";

/**
 * The frame tugcast broadcasts for a question. Every field is `unknown`: this
 * arrives off the wire and is validated on the way in.
 */
type AskFrame = Record<string, unknown>;

/**
 * What the store needs from the app to do its job: a wire to answer on, and a
 * way to find the card the developer is looking at when a question names no
 * session. Injected at dispatch-init rather than imported, so the store has no
 * opinion about how either is obtained.
 */
export interface PendingAskContext {
  sendControlFrame: (action: string, payload: Record<string, unknown>) => void;
  /** The focused session's `tugSessionId`, or `null` if none is focused. */
  focusedTugSessionId: () => string | null;
}

/**
 * The option a question falls back to when nobody can answer it. Callers put
 * their declining choice last, matching the dialog's own ordering.
 */
function decliningOption(options: ReadonlyArray<PendingAskOption>): string | null {
  return options.length > 0 ? options[options.length - 1].value : null;
}

function parseOptions(raw: unknown): PendingAskOption[] {
  if (!Array.isArray(raw)) return [];
  const parsed: PendingAskOption[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { value, label, description } = entry as Record<string, unknown>;
    if (typeof value !== "string" || typeof label !== "string") continue;
    parsed.push({
      value,
      label,
      ...(typeof description === "string" && description.length > 0
        ? { description }
        : {}),
    });
  }
  return parsed;
}

class PendingAskStore {
  /** Sessions currently holding a question, so teardown can answer for them. */
  private _live = new Map<string, { tugSessionId: string; requestId: string }>();

  private _listeners: Array<() => void> = [];

  private _context: PendingAskContext | null = null;

  /** Wire the store to the app. Called once from `initActionDispatch`. */
  init = (context: PendingAskContext): (() => void) => {
    this._context = context;
    return () => {
      this._context = null;
    };
  };

  /** Send an answer back to the blocked caller. */
  private respondOnWire(requestId: string, choice: string): void {
    this._context?.sendControlFrame("ask-response", { requestId, choice });
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  };

  /**
   * The request ids currently awaiting an answer. The dialog reads its content
   * from the owning `CodeSessionStore`, not from here — this snapshot exists so
   * consumers that care only about "is anything pending" have an [L02] handle.
   */
  getSnapshot = (): ReadonlyMap<string, { tugSessionId: string; requestId: string }> =>
    this._live;

  /** Handle an inbound `ask` CONTROL frame. */
  receive = (frame: AskFrame): void => {
    const { requestId, title } = frame;
    if (typeof requestId !== "string" || requestId.length === 0) return;

    const options = parseOptions(frame.options);
    if (typeof title !== "string" || title.length === 0 || options.length === 0) {
      // Malformed past the point of rendering. The caller is still blocked, so
      // decline rather than drop — but there is no option list to decline with.
      this.respondOnWire(requestId, "");
      return;
    }

    const ask: PendingAsk = {
      requestId,
      title,
      description:
        typeof frame.description === "string" && frame.description.length > 0
          ? frame.description
          : null,
      options,
    };

    const targetSessionId =
      typeof frame.sessionId === "string" && frame.sessionId.length > 0
        ? frame.sessionId
        : this._context?.focusedTugSessionId() ?? null;
    const services =
      targetSessionId === null
        ? null
        : cardServicesStore.getByTugSessionId(targetSessionId);

    if (services === null) {
      // No card to show it on. Answering beats leaving the caller to time out.
      this.respondOnWire(requestId, decliningOption(options) ?? "");
      return;
    }

    this._live.set(requestId, {
      tugSessionId: services.tugSessionId,
      requestId,
    });
    services.codeSessionStore.setPendingAsk(ask);
    this._notify();
  };

  /**
   * Answer a question and release the caller. Clearing the session's
   * `pendingAsk` is what unmounts the dialog.
   */
  respond = (requestId: string, choice: string): void => {
    const live = this._live.get(requestId);
    if (live === undefined) return;
    this._live.delete(requestId);
    const services = cardServicesStore.getByTugSessionId(live.tugSessionId);
    services?.codeSessionStore.setPendingAsk(null);
    this.respondOnWire(requestId, choice);
    this._notify();
  };

  /**
   * A session is going away. Anything it was being asked gets the declining
   * answer, because the dialog is about to stop existing.
   */
  sessionClosed = (tugSessionId: string): void => {
    for (const [requestId, live] of [...this._live]) {
      if (live.tugSessionId !== tugSessionId) continue;
      const services = cardServicesStore.getByTugSessionId(tugSessionId);
      const options = services?.codeSessionStore.getSnapshot().pendingAsk?.options ?? [];
      this._live.delete(requestId);
      this.respondOnWire(requestId, decliningOption(options) ?? "");
    }
    this._notify();
  };

  private _notify(): void {
    for (const listener of this._listeners.slice()) listener();
  }
}

export const pendingAskStore = new PendingAskStore();
