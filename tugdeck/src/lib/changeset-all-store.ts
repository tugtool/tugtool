/**
 * Account-global changeset store — the aggregate CHANGESET_ALL feed (0x24)
 * as app-level external state.
 *
 * Modeled on `UsageStore` / `PulseStore`: an app-level singleton holding a
 * `FeedStore` over CHANGESET_ALL with **no workspace filter**. The aggregate
 * frame carries every open project at once (server-composed over the
 * `WorkspaceRegistry` entries), so there is nothing to filter and it must not
 * go through `useCardData` → `useCardWorkspaceKey`: a `FeedStore` holds one
 * value per feed id, so per-workspace filtering would collapse the aggregate
 * to a single project.
 *
 * Consumed via {@link useChangesetAll}; attached once at app boot with
 * {@link attachChangesetAllStore}. Returns the idle (empty) snapshot when no
 * store is attached (gallery / fixtures).
 *
 * Laws: [L02] external state enters React through useSyncExternalStore only.
 *
 * @module lib/changeset-all-store
 */

import { useSyncExternalStore } from "react";

import type { TugConnection } from "../connection";
import { FeedId } from "../protocol";
import { FeedStore } from "./feed-store";
import {
  isWorkspacesChangesetSnapshot,
  type ProjectChangeset,
  type WorkspacesChangesetSnapshot,
} from "./changeset-types";

/** The empty aggregate — no open projects yet. Frozen and shared. */
const IDLE_SNAPSHOT: WorkspacesChangesetSnapshot = Object.freeze({
  projects: [] as ProjectChangeset[],
});

export class ChangesetAllStore {
  private _snapshot: WorkspacesChangesetSnapshot = IDLE_SNAPSHOT;
  private readonly _listeners = new Set<() => void>();
  private readonly _feedStore: FeedStore;
  private readonly _unsubscribeFeed: () => void;
  private _lastPayloadRef: unknown = undefined;

  constructor(connection: TugConnection) {
    // CHANGESET_ALL carries no workspace_key scoping — account-global,
    // intentionally unfiltered.
    this._feedStore = new FeedStore(connection, [FeedId.CHANGESET_ALL]);
    this._unsubscribeFeed = this._feedStore.subscribe(() => this._onFeedUpdate());
    // Pull whatever the FeedStore already holds. CHANGESET_ALL is a
    // deliver-on-connect snapshot feed, so its retained frame can be
    // replayed into the FeedStore *during* the `new FeedStore(...)` call
    // above — before this `subscribe` was in place. That notification is
    // then lost, and because the aggregate is diff-suppressed no further
    // frame arrives to re-trigger it. This initial drain adopts the cached
    // value so the store isn't stuck on the idle snapshot.
    this._onFeedUpdate();
  }

  private _onFeedUpdate(): void {
    const payload = this._feedStore.getSnapshot().get(FeedId.CHANGESET_ALL);
    if (payload === this._lastPayloadRef) return;
    this._lastPayloadRef = payload;
    if (!isWorkspacesChangesetSnapshot(payload)) return;
    this._snapshot = payload;
    for (const listener of [...this._listeners]) listener();
  }

  dispose(): void {
    this._unsubscribeFeed();
    this._feedStore.dispose();
    this._listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  getSnapshot = (): WorkspacesChangesetSnapshot => this._snapshot;
}

// ---------------------------------------------------------------------------
// Singleton + hook
// ---------------------------------------------------------------------------

let _activeStore: ChangesetAllStore | null = null;

export function attachChangesetAllStore(conn: TugConnection): ChangesetAllStore {
  if (_activeStore !== null) return _activeStore;
  _activeStore = new ChangesetAllStore(conn);
  return _activeStore;
}

export function getChangesetAllStore(): ChangesetAllStore | null {
  return _activeStore;
}

/** Test-only: detach the singleton between cases. */
export function _resetChangesetAllStoreForTest(): void {
  _activeStore?.dispose();
  _activeStore = null;
}

/**
 * React hook: the account-global aggregate changeset snapshot. Returns the
 * idle (empty) snapshot when no store is attached.
 */
export function useChangesetAll(): WorkspacesChangesetSnapshot {
  return useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => _activeStore?.getSnapshot() ?? IDLE_SNAPSHOT,
    () => IDLE_SNAPSHOT,
  );
}
