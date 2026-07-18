/**
 * path-commands-store — the deck cache of the login-PATH executable set that
 * the shell-line classifier consults ([P08], Spec S02).
 *
 * One instance per Session card session, sharing the card's `SHELL_OUTPUT`
 * `FeedStore` (no new feed — the same session-scoped filter the shell session
 * store uses). `request()` fires the `path_commands` verb once, at session
 * bind, so the set is warm before the first submit; tugcast resolves the login
 * PATH once per process and replies with a `path_commands` frame this store
 * folds. `getSnapshot()` returns `null` until the reply lands — the classifier
 * treats null as "answer Code", the safety net that keeps the first
 * command-shaped line of a session from misrouting while the set loads.
 *
 * [L02] store surface (`subscribe` / `getSnapshot`); [L22] direct feed read.
 *
 * @module lib/path-commands-store
 */

import { FeedId, type FeedIdValue } from "../protocol";
import type { FeedStore } from "./feed-store";
import { getConnection } from "./connection-singleton";

export class PathCommandsStore {
  private _commands: ReadonlySet<string> | null = null;
  private readonly _listeners = new Set<() => void>();
  private readonly _unsubscribeFeed: () => void;
  private _requested = false;

  constructor(
    private readonly _feedStore: FeedStore,
    private readonly _feedId: FeedIdValue,
    private readonly _tugSessionId: string,
  ) {
    this._unsubscribeFeed = _feedStore.subscribe(() => this._onFeedUpdate());
    // Fold any frame already present at construction (replay-on-subscribe).
    this._onFeedUpdate();
  }

  /**
   * Request the login-PATH command set once (idempotent). Fired at session
   * bind so the set is warm before the first submit. A missing transport is a
   * silent no-op — the classifier answers Code until the set loads.
   */
  request(): void {
    if (this._requested) return;
    this._requested = true;
    getConnection()?.send(
      FeedId.SHELL_INPUT,
      new TextEncoder().encode(
        JSON.stringify({ type: "path_commands", tug_session_id: this._tugSessionId }),
      ),
    );
  }

  private _onFeedUpdate(): void {
    const payload = this._feedStore.getSnapshot().get(this._feedId);
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Record<string, unknown>;
    if (p.type !== "path_commands") return;
    if (p.tug_session_id !== this._tugSessionId) return;
    if (!Array.isArray(p.commands)) return;
    const set = new Set<string>();
    for (const name of p.commands) {
      if (typeof name === "string") set.add(name);
    }
    this._commands = set;
    for (const listener of this._listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /** The login-PATH command set, or `null` until the reply lands. */
  getSnapshot = (): ReadonlySet<string> | null => this._commands;

  dispose(): void {
    this._unsubscribeFeed();
    this._listeners.clear();
  }

  /** Test seam: fold a raw `SHELL_OUTPUT` payload as if it arrived on the feed. */
  _ingestForTest(payload: unknown): void {
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Record<string, unknown>;
    if (p.type !== "path_commands" || p.tug_session_id !== this._tugSessionId) return;
    if (!Array.isArray(p.commands)) return;
    const set = new Set<string>();
    for (const name of p.commands) if (typeof name === "string") set.add(name);
    this._commands = set;
    for (const listener of this._listeners) listener();
  }
}
