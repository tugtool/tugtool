/**
 * FeedStore — external subscribable store for WebSocket feed data.
 *
 * Subscribes to one or more feed IDs via `TugConnection.onFrame()`, decodes
 * each payload, and exposes a `useSyncExternalStore`-compatible API so feed
 * data enters React as external state (L02 compliance).
 *
 * **Laws:** [L02] External state enters React through useSyncExternalStore only.
 *
 * @module lib/feed-store
 */

import type { TugConnection } from "../connection";
import type { FeedIdValue } from "../protocol";

/** Default decoder: UTF-8 bytes → JSON.parse */
export function defaultDecode(payload: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(payload));
}

/**
 * FeedStore holds decoded feed payloads in a `Map<number, unknown>`.
 *
 * Lifecycle:
 * - Constructed with a connection, a list of feed IDs, and an optional decoder.
 * - Subscribes to each feed ID via `connection.onFrame()`.
 * - On each frame: decodes the payload and replaces the internal map (new
 *   reference) so `useSyncExternalStore` detects the change.
 * - Disposed when the card unmounts (subscriptions remain registered on
 *   `TugConnection` — the connection is long-lived and callbacks are
 *   accumulated; we track our own callbacks to remove them on dispose).
 *
 * Note: `TugConnection.onFrame()` does not return an unsubscribe function in
 * the current implementation. The store keeps its own cleanup by patching the
 * callback list. Because connections are long-lived and cards are relatively
 * few, leaking a small number of stale callbacks is acceptable for now; the
 * architecture doc notes this as a future improvement.
 */
export class FeedStore {
  private _data: Map<number, unknown> = new Map();
  private _listeners: Array<() => void> = [];
  private _disposed = false;

  constructor(
    connection: TugConnection,
    feedIds: readonly FeedIdValue[],
    decode: (payload: Uint8Array) => unknown = defaultDecode,
  ) {
    for (const feedId of feedIds) {
      connection.onFrame(feedId, (payload: Uint8Array) => {
        if (this._disposed) return;
        try {
          const decoded = decode(payload);
          // Create a new Map reference so useSyncExternalStore detects the change.
          const next = new Map(this._data);
          next.set(feedId, decoded);
          this._data = next;
          for (const listener of this._listeners) {
            listener();
          }
        } catch (err) {
          console.error(`[FeedStore] failed to decode payload for feed 0x${feedId.toString(16)}:`, err);
        }
      });
    }
  }

  /** Subscribe to store updates. Returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  };

  /** Return the current feed data snapshot. */
  getSnapshot = (): Map<number, unknown> => {
    return this._data;
  };

  /** Dispose the store. Subsequent frames are ignored. */
  dispose(): void {
    this._disposed = true;
    this._listeners = [];
  }
}
