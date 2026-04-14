/**
 * FeedStore — external subscribable store for WebSocket feed data.
 *
 * Subscribes to one or more feed IDs via `TugConnection.onFrame()`, decodes
 * each payload, and exposes a `useSyncExternalStore`-compatible API so feed
 * data enters React as external state (L02 compliance).
 *
 * ## Optional session filter
 *
 * The 4th constructor argument is an optional `filter(feedId, decoded) =>
 * boolean` predicate. If present, each decoded payload is passed through
 * the filter before the internal map is updated; a `false` result drops
 * the frame silently (no snapshot mutation, no listener notification).
 *
 * The filter is applied **inside** the frame handler registered with
 * `TugConnection.onFrame`, which means it runs on both code paths for
 * free:
 *
 * 1. **Live frames** — `TugConnection.dispatch` invokes every registered
 *    callback with the payload bytes. Our handler decodes and filters.
 * 2. **Replay on subscribe** — `TugConnection.onFrame` synchronously
 *    replays the cached `lastPayload` for the feed id (if any) into the
 *    newly registered callback. That replay flows through the same
 *    handler, so the filter runs against cached payloads too.
 *
 * This is the `[D11]` filter scope: tugdeck-side per-card filters enforce
 * multi-session isolation on the shared CODE_OUTPUT replay buffer and on
 * the SESSION_STATE / SESSION_METADATA broadcasts. Without this the
 * shared replay would leak frames from one session into another card's
 * store.
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
 * Optional per-frame filter predicate. Receives the feed id and the
 * decoded payload and returns `true` to keep the frame or `false` to
 * drop it. See the module JSDoc for replay-path semantics.
 */
export type FeedStoreFilter = (feedId: FeedIdValue, decoded: unknown) => boolean;

/**
 * FeedStore holds decoded feed payloads in a `Map<number, unknown>`.
 *
 * Lifecycle:
 * - Constructed with a connection, a list of feed IDs, an optional
 *   decoder, and an optional filter.
 * - Subscribes to each feed ID via `connection.onFrame()`.
 * - On each frame: decodes the payload, runs the optional filter, and
 *   (if accepted) replaces the internal map (new reference) so
 *   `useSyncExternalStore` detects the change.
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
  private _filter?: FeedStoreFilter;

  constructor(
    connection: TugConnection,
    feedIds: readonly FeedIdValue[],
    decode: (payload: Uint8Array) => unknown = defaultDecode,
    filter?: FeedStoreFilter,
  ) {
    this._filter = filter;
    for (const feedId of feedIds) {
      connection.onFrame(feedId, (payload: Uint8Array) => {
        if (this._disposed) return;
        try {
          const decoded = decode(payload);
          // Session-scoped filter, per [D11]. Runs on both live frames
          // and the replay-on-subscribe path (see module JSDoc) because
          // `TugConnection.onFrame` replays the cached `lastPayload`
          // through this same handler. A `false` result drops the frame
          // silently — no snapshot mutation, no listener notify.
          if (this._filter && !this._filter(feedId, decoded)) {
            return;
          }
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

  /**
   * Replace the current filter. Used by consumers whose filter predicate
   * depends on reactive state (e.g., `Tugcard` when its `workspaceKey`
   * binding arrives asynchronously). Only affects future frames; cached
   * payloads already in the snapshot are left in place.
   */
  setFilter(filter?: FeedStoreFilter): void {
    this._filter = filter;
  }

  /** Dispose the store. Subsequent frames are ignored. */
  dispose(): void {
    this._disposed = true;
    this._listeners = [];
  }
}
