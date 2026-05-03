/**
 * TideSessionLedgerStore — tugdeck-side cache for the tugcast session ledger.
 *
 * Backs the picker's session list view. Cached by raw user-typed
 * `projectDir` — the server matches the request against the ledger's
 * `project_dir` column (no client-side canonicalization needed). Sources:
 *
 * 1. **Initial load** — first time `getSnapshot(projectDir)` is called for
 *    a path, the store dispatches a `list_sessions` CONTROL request and
 *    returns `{ status: "pending", rows: [] }`. The server's
 *    `list_sessions_ok` ack settles the entry to `{ status: "ready", rows }`.
 *
 * 2. **Live updates** — the supervisor broadcasts `session_updated` push
 *    frames after every successful ledger write. The store patches the
 *    matching row in place (or removes it on `removed: true`), re-sorts by
 *    `last_used_at DESC`, and emits a listener tick.
 *
 * 3. **Connection bounce** — `connectionDidReconnect` invalidates every
 *    cached entry back to `idle`; the next `getSnapshot` for each workspace
 *    re-issues `list_sessions`. This catches any push the server emitted
 *    while the wire was down.
 *
 * **Laws:** [L02] Picker reads enter React via `useSyncExternalStore` only.
 * The hook `useSessionLedger(workspaceKey)` wraps that contract.
 *
 * @module lib/tide-session-ledger-store
 */

import { useSyncExternalStore } from "react";
import type { TugConnection } from "../connection";
import type { SessionRow } from "../protocol";
import {
  encodeForgetSession,
  encodeListSessions,
} from "../protocol";
import {
  subscribeToForgetSessionErr,
  subscribeToForgetSessionOk,
  subscribeToListSessionsErr,
  subscribeToListSessionsOk,
  subscribeToSessionUpdated,
} from "./tide-session-ledger-events";
import { getConnectionLifecycle } from "./connection-lifecycle";

export type WorkspaceLoadStatus = "idle" | "pending" | "ready" | "error";

export interface WorkspaceSnapshot {
  status: WorkspaceLoadStatus;
  rows: readonly SessionRow[];
  error?: { reason: string };
}

const EMPTY_ROWS: readonly SessionRow[] = Object.freeze([]);
const IDLE_SNAPSHOT: WorkspaceSnapshot = Object.freeze({
  status: "idle",
  rows: EMPTY_ROWS,
});
const PENDING_SNAPSHOT: WorkspaceSnapshot = Object.freeze({
  status: "pending",
  rows: EMPTY_ROWS,
});

type ForgetSessionResult = { ok: true } | { error: { reason: string } };

/**
 * Per-session-id index entry. Tracks which `projectDir` cache currently
 * holds the row so a `session_updated` push can locate the cached entry
 * without scanning every workspace. Used during patch + remove paths.
 */
interface RowLocation {
  projectDir: string;
}

export class TideSessionLedgerStore {
  private readonly conn: TugConnection;
  private readonly snapshots = new Map<string, WorkspaceSnapshot>();
  /** Reverse index from session_id → workspace, kept in lockstep with snapshots. */
  private readonly rowLocations = new Map<string, RowLocation>();
  private readonly listeners = new Set<() => void>();

  /** Resolves attached to in-flight `forget_session` calls, keyed by id. */
  private readonly pendingForget = new Map<string, (r: ForgetSessionResult) => void>();

  private readonly disposers: Array<() => void> = [];

  constructor(conn: TugConnection) {
    this.conn = conn;
    this.installSubscriptions();
  }

  /**
   * Free every subscription this store holds. Tests call this to keep the
   * pub/sub bus clean between cases; production discards the store at
   * process shutdown so this is rarely exercised.
   */
  dispose(): void {
    for (const fn of this.disposers) fn();
    this.disposers.length = 0;
    this.listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Return the cached snapshot for `projectDir`. The first call for a
   * path triggers a CONTROL `list_sessions` request and returns
   * `{ status: "pending", rows: [] }`; the `list_sessions_ok` push settles
   * the entry to `{ status: "ready", rows }`.
   *
   * Per `useSyncExternalStore`'s contract this method is referentially
   * stable when state hasn't changed — pending callers see the same frozen
   * snapshot until a settle happens.
   */
  getSnapshot = (projectDir: string): WorkspaceSnapshot => {
    const cached = this.snapshots.get(projectDir);
    if (cached !== undefined) return cached;
    // First observation: kick the request and seed pending.
    this.snapshots.set(projectDir, PENDING_SNAPSHOT);
    this.requestList(projectDir);
    return PENDING_SNAPSHOT;
  };

  forgetSession(sessionId: string): Promise<ForgetSessionResult> {
    return new Promise((resolve) => {
      this.pendingForget.set(sessionId, resolve);
      const frame = encodeForgetSession(sessionId);
      this.conn.send(frame.feedId, frame.payload);
    });
  }

  /**
   * Flip every cached entry's status back to `idle` and discard rows. The
   * next `getSnapshot` for each workspace re-issues `list_sessions`.
   *
   * Called on `connectionDidReconnect` so a wire-bounce gap during which
   * the supervisor emitted unobserved `session_updated` pushes doesn't
   * leave the store advertising a stale view.
   */
  invalidateAll(): void {
    if (this.snapshots.size === 0) return;
    this.snapshots.clear();
    this.rowLocations.clear();
    this.tick();
  }

  // ── internals ───────────────────────────────────────────────────────────

  private requestList(projectDir: string): void {
    const frame = encodeListSessions(projectDir);
    this.conn.send(frame.feedId, frame.payload);
  }

  private installSubscriptions(): void {
    this.disposers.push(
      subscribeToListSessionsOk(({ project_dir, sessions }) => {
        const sorted = [...sessions].sort(
          (a, b) => b.last_used_at - a.last_used_at,
        );
        // Refresh the reverse index for this projectDir: drop any stale ids
        // that previously pointed here, then re-index the current rows.
        for (const [sid, loc] of this.rowLocations) {
          if (loc.projectDir === project_dir) this.rowLocations.delete(sid);
        }
        for (const row of sorted) {
          this.rowLocations.set(row.session_id, { projectDir: project_dir });
        }
        this.snapshots.set(project_dir, {
          status: "ready",
          rows: Object.freeze(sorted),
        });
        this.tick();
      }),
      subscribeToListSessionsErr(({ project_dir, reason }) => {
        this.snapshots.set(project_dir, {
          status: "error",
          rows: EMPTY_ROWS,
          error: { reason },
        });
        this.tick();
      }),
      subscribeToSessionUpdated((push) => {
        if (push.removed) {
          this.removeRow(push.session_id);
          return;
        }
        if (push.fields !== undefined) {
          this.patchRow(push.session_id, push.fields);
        }
      }),
      subscribeToForgetSessionOk(({ session_id }) => {
        const resolve = this.pendingForget.get(session_id);
        if (resolve === undefined) return;
        this.pendingForget.delete(session_id);
        resolve({ ok: true });
      }),
      subscribeToForgetSessionErr(({ session_id, reason }) => {
        const resolve = this.pendingForget.get(session_id);
        if (resolve === undefined) return;
        this.pendingForget.delete(session_id);
        resolve({ error: { reason } });
      }),
    );
    // Connection-restore re-fetch hook: every reconnect (not the first
    // open) flips the cache back to idle so subsequent picker mounts
    // re-issue list_sessions and pick up any push frames missed during
    // the wire bounce. The lifecycle singleton may not be registered
    // yet (e.g., tests that mock the connection); skip the hook gracefully.
    const lifecycle = getConnectionLifecycle();
    if (lifecycle !== null) {
      this.disposers.push(
        lifecycle.observeConnectionDidReconnect(() => this.invalidateAll()),
      );
    }
  }

  /**
   * Patch a single row by id. The push carries the post-write row state;
   * we drop into the matching `projectDir` snapshot, replace or insert by
   * id, re-sort, and emit. If the path isn't cached yet, ignore — the
   * picker will pick up the row when it next calls `getSnapshot`.
   */
  private patchRow(sessionId: string, row: SessionRow): void {
    // Locate the cache slot via the reverse index, falling back to the
    // payload's `project_dir` if the index doesn't yet know about this
    // session (the row was created on the server before the picker ever
    // fetched the path).
    const located = this.rowLocations.get(sessionId);
    const projectDir = located?.projectDir ?? row.project_dir;
    const cached = this.snapshots.get(projectDir);
    if (cached === undefined || cached.status !== "ready") {
      // Path isn't cached yet; nothing to patch into. Update the reverse
      // index opportunistically so a later patch with the same id can
      // find its way home.
      this.rowLocations.set(sessionId, { projectDir });
      return;
    }
    const existingIdx = cached.rows.findIndex((r) => r.session_id === sessionId);
    let nextRows: SessionRow[];
    if (existingIdx >= 0) {
      nextRows = cached.rows.slice();
      nextRows[existingIdx] = row;
    } else {
      nextRows = [...cached.rows, row];
    }
    nextRows.sort((a, b) => b.last_used_at - a.last_used_at);
    this.rowLocations.set(sessionId, { projectDir });
    this.snapshots.set(projectDir, {
      status: "ready",
      rows: Object.freeze(nextRows),
    });
    this.tick();
  }

  private removeRow(sessionId: string): void {
    const located = this.rowLocations.get(sessionId);
    if (located === undefined) return;
    this.rowLocations.delete(sessionId);
    const cached = this.snapshots.get(located.projectDir);
    if (cached === undefined || cached.status !== "ready") return;
    const nextRows = cached.rows.filter((r) => r.session_id !== sessionId);
    if (nextRows.length === cached.rows.length) return;
    this.snapshots.set(located.projectDir, {
      status: "ready",
      rows: Object.freeze(nextRows),
    });
    this.tick();
  }

  private tick(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * Module-level reference to the singleton store. Wired by the connection
 * boot path (similar to `cardServicesStore.attachDeckManager`). `null`
 * before wire-up; tests construct their own instances.
 */
let _activeStore: TideSessionLedgerStore | null = null;

export function attachTideSessionLedgerStore(conn: TugConnection): TideSessionLedgerStore {
  if (_activeStore !== null) return _activeStore;
  _activeStore = new TideSessionLedgerStore(conn);
  return _activeStore;
}

export function getTideSessionLedgerStore(): TideSessionLedgerStore | null {
  return _activeStore;
}

/**
 * Test-only: detach the singleton so each test can attach a fresh one
 * with its own mock connection.
 */
export function _resetTideSessionLedgerStoreForTest(): void {
  _activeStore?.dispose();
  _activeStore = null;
}

/**
 * React hook: subscribe to the ledger store and return the snapshot for
 * `projectDir` (the user-typed path). Returns the idle snapshot when no
 * store is attached (e.g., in a Storybook fixture or a minimal test
 * renderer). Empty string short-circuits to the idle snapshot — the
 * picker doesn't issue a request until the user has typed something.
 */
export function useSessionLedger(projectDir: string): WorkspaceSnapshot {
  return useSyncExternalStore(
    (listener) => {
      const store = _activeStore;
      if (store === null) return () => {};
      return store.subscribe(listener);
    },
    () => {
      if (projectDir.length === 0) return IDLE_SNAPSHOT;
      const store = _activeStore;
      if (store === null) return IDLE_SNAPSHOT;
      return store.getSnapshot(projectDir);
    },
    () => IDLE_SNAPSHOT,
  );
}
