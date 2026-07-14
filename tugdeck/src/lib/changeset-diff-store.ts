/**
 * Changeset-card diff store — a lazy app-level `GitDiffStore` singleton over
 * an **unfiltered** GIT_DIFF `FeedStore`.
 *
 * The changeset card serves every open project through one store, so unlike
 * the dev card's per-card, workspace-key-filtered store (see
 * `card-services-store`), this one takes no construction-time project dir and
 * no workspace filter: each `requestDiff({root, paths})` names its own
 * project, and response correlation rides the store-unique `requestId` alone.
 *
 * Laws: [L02] consumers read it via `useSyncExternalStore` (through the
 *       diff-sheet body).
 *
 * @module lib/changeset-diff-store
 */

import { FeedId } from "../protocol";
import { FeedStore } from "./feed-store";
import { getConnection } from "./connection-singleton";
import { GitDiffStore } from "./git-diff-store";

let _store: GitDiffStore | null = null;

/**
 * The shared changeset-card diff store, created on first use. Returns `null`
 * when no connection is up yet (gallery / fixtures) — callers skip the
 * affordance in that case.
 */
export function getChangesetDiffStore(): GitDiffStore | null {
  if (_store !== null) return _store;
  const conn = getConnection();
  if (!conn) return null;
  _store = new GitDiffStore(new FeedStore(conn, [FeedId.GIT_DIFF]), FeedId.GIT_DIFF);
  return _store;
}
