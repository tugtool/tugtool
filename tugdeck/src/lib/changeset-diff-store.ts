/**
 * Changeset diff stores — per-consumer `GitDiffStore` instances over one
 * shared, **unfiltered** GIT_DIFF `FeedStore` ([P20]).
 *
 * The changeset card serves every open project and shows several diffs at once
 * (one per expanded entry), and each pop-out Diff card wants its own. Unlike
 * the session card's per-card, workspace-key-filtered store (see
 * `card-services-store`), these take no construction-time project dir and no
 * workspace filter: each `requestDiff(descriptor)` names its own project, and
 * response correlation rides the store-unique `requestId` alone (the GIT_DIFF
 * response is a broadcast every store sees, so the `gd-<storeId>-<seq>` id is
 * what keeps them from crossing wires).
 *
 * One `FeedStore` is shared across every store here; each `GitDiffStore`
 * subscribes to it and accepts only its own correlated response. The entry
 * stores are keyed by changeset-entry id and swept when their entries leave the
 * snapshot; a Diff card gets a standalone store it owns for its lifetime.
 *
 * Laws: [L02] consumers read the stores via `useSyncExternalStore`.
 *
 * @module lib/changeset-diff-store
 */

import { FeedId } from "../protocol";
import { FeedStore } from "./feed-store";
import { getConnection } from "./connection-singleton";
import { GitDiffStore } from "./git-diff-store";

/** The single unfiltered GIT_DIFF feed store shared by every diff store. */
let _feedStore: FeedStore | null = null;

function sharedFeedStore(): FeedStore | null {
  if (_feedStore !== null) return _feedStore;
  const conn = getConnection();
  if (!conn) return null;
  _feedStore = new FeedStore(conn, [FeedId.GIT_DIFF]);
  return _feedStore;
}

// ---------------------------------------------------------------------------
// Per-entry stores (the changeset card's inline diffs)
// ---------------------------------------------------------------------------

const _entryStores = new Map<string, GitDiffStore>();

/**
 * The diff store for one changeset entry, created on first use. Returns `null`
 * when no connection is up (gallery / fixtures) — callers skip the affordance.
 */
export function getEntryDiffStore(entryId: string): GitDiffStore | null {
  const existing = _entryStores.get(entryId);
  if (existing !== undefined) return existing;
  const feedStore = sharedFeedStore();
  if (feedStore === null) return null;
  const store = new GitDiffStore(feedStore, FeedId.GIT_DIFF);
  _entryStores.set(entryId, store);
  return store;
}

/** Dispose and forget one entry's store. */
export function releaseEntryDiffStore(entryId: string): void {
  const store = _entryStores.get(entryId);
  if (store !== undefined) {
    store.dispose();
    _entryStores.delete(entryId);
  }
}

/**
 * Drop every entry store whose id is not in `activeIds` — called from the card
 * after each snapshot so stores for closed entries don't linger.
 */
export function sweepEntryDiffStores(activeIds: ReadonlySet<string>): void {
  for (const id of [..._entryStores.keys()]) {
    if (!activeIds.has(id)) releaseEntryDiffStore(id);
  }
}

// ---------------------------------------------------------------------------
// Standalone store (a Diff card's pop-out)
// ---------------------------------------------------------------------------

/**
 * A standalone diff store with its own `requestId` space, for a Diff card. The
 * caller owns it and calls `dispose()` on unmount. Returns `null` with no
 * connection.
 */
export function createGitDiffStore(): GitDiffStore | null {
  const feedStore = sharedFeedStore();
  if (feedStore === null) return null;
  return new GitDiffStore(feedStore, FeedId.GIT_DIFF);
}
