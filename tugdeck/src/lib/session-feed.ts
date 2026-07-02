/**
 * subscribeSessionFeed — the deck-side consumer half of a session-scoped
 * tugcast feed.
 *
 * tugcast multiplexes per-session feeds over single FeedIds: every frame
 * carries its `tug_session_id` inside the JSON payload (spliced as the
 * first object field by the cast-side `SessionScopedFeed` producer) and is
 * broadcast to every client. Isolation is enforced here, by the standard
 * `[D11]` predicate — `decoded.tug_session_id === tugSessionId` — so a
 * consumer sees only its own session's frames. Before this helper, each
 * per-session consumer re-authored that predicate by hand (see
 * `CodeSessionStore.acceptFrame`, which this generalizes; existing stores
 * are not retrofitted).
 *
 * This is a frame-stream subscription, not a snapshot store: samples are
 * delivered to `onSample` as they arrive (plus `TugConnection.onFrame`'s
 * synchronous replay of the cached last payload, which flows through the
 * same predicate). Consumers that feed imperative, non-React state (e.g.
 * activity meters) call this directly; it never touches React ([L02] does
 * not apply to the transport — the consuming store decides what, if
 * anything, enters a `useSyncExternalStore` snapshot).
 *
 * `TugConnection.onFrame` does not return an unsubscribe; like `FeedStore`,
 * disposal is a local tombstone — the callback stays registered on the
 * long-lived connection but drops every frame after `dispose`.
 *
 * @module lib/session-feed
 */

import type { FeedIdValue } from "../protocol";
import { defaultDecode } from "./feed-store";

/**
 * The one connection capability this helper needs. `TugConnection`
 * satisfies it structurally; tests drive the helper with a minimal
 * frame source and real payload bytes.
 */
export interface SessionFrameSource {
  onFrame(feedId: FeedIdValue, callback: (payload: Uint8Array) => void): void;
}

/** A decoded session-feed payload: a JSON object tagged with its session. */
export type SessionFeedSample = Record<string, unknown>;

/**
 * Subscribe to `feedId`, delivering only payloads whose
 * `tug_session_id` matches `tugSessionId`. Returns a dispose function.
 *
 * Malformed payloads (non-JSON, non-object) and frames for other
 * sessions are dropped silently — the wire is shared, so foreign
 * traffic is normal, not an error.
 */
export function subscribeSessionFeed(
  source: SessionFrameSource,
  feedId: FeedIdValue,
  tugSessionId: string,
  onSample: (sample: SessionFeedSample) => void,
  decode: (payload: Uint8Array) => unknown = defaultDecode,
): () => void {
  let disposed = false;
  source.onFrame(feedId, (payload: Uint8Array) => {
    if (disposed) return;
    let decoded: unknown;
    try {
      decoded = decode(payload);
    } catch {
      return;
    }
    if (typeof decoded !== "object" || decoded === null) return;
    const sample = decoded as SessionFeedSample;
    if (sample.tug_session_id !== tugSessionId) return;
    onSample(sample);
  });
  return () => {
    disposed = true;
  };
}
