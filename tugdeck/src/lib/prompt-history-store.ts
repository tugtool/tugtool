/**
 * PromptHistoryStore — session-scoped prompt history with tugbank persistence.
 *
 * **Laws:** [L02] L02-compliant store with subscribe/getSnapshot.
 *           [L23] Persists to tugbank — data survives reload and quit.
 *
 * @module lib/prompt-history-store
 */

import type { HistoryProvider, TugTextEditingState } from "./tug-text-engine";
import { putPromptHistory, getPromptHistory } from "../settings-api";
import { logSessionLifecycle } from "./session-lifecycle-log";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A serialized atom captures the subset of atom fields needed for persistence.
 * Used to restore file references and other inline atoms when navigating history.
 *
 * Note: If tug-text-engine exports a compatible atom element type in the future,
 * consider aliasing it here instead of duplicating.
 */
export interface SerializedAtom {
  position: number;
  type: string;
  label: string;
  value: string;
}

/**
 * A single prompt history entry. Stores everything needed to restore the prompt
 * state when the user navigates Cmd+Up/Down through history.
 *
 * Metadata fields (sessionId, projectPath, route) are stored for future
 * cross-session search tiers (T3.4+).
 */
export interface HistoryEntry {
  id: string;
  sessionId: string;
  projectPath: string;
  route: string;
  text: string;
  atoms: SerializedAtom[];
  timestamp: number;
}

/**
 * Lightweight snapshot of PromptHistoryStore state for useSyncExternalStore.
 *
 * Only `totalEntries` is exposed. An earlier shape included `sessionEntries`
 * (count for `_lastActiveSessionId`), but that field's semantic meaning could
 * change without bumping `_version` (because `createRouteProvider` /
 * `createProvider` mutated `_lastActiveSessionId` without bumping). Snapshot
 * reference must change when observed state changes; keeping the field
 * created a stale-snapshot footgun. The `_lastActiveSessionId` field still
 * exists internally for non-snapshot paths.
 */
export interface PromptHistorySnapshot {
  totalEntries: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ENTRIES_PER_SESSION = 200;

// ── SessionHistoryProvider ────────────────────────────────────────────────────

/**
 * Session-scoped HistoryProvider returned by PromptHistoryStore.createProvider().
 *
 * Manages cursor and draft state, same pattern as GalleryHistoryProvider.
 * Returns null from back() if entries haven't loaded yet (loadSession is async).
 */
class SessionHistoryProvider implements HistoryProvider {
  private _cursor = -1; // -1 = at draft
  private _draft: TugTextEditingState = { text: "", atoms: [], selection: null };

  constructor(
    private readonly _sessionId: string,
    private readonly _store: PromptHistoryStore
  ) {}

  back(current: TugTextEditingState): TugTextEditingState | null {
    const entries = this._store._getSessionEntries(this._sessionId);
    if (entries.length === 0) return null;

    if (this._cursor === -1) {
      this._draft = current;
      this._cursor = entries.length - 1;
    } else if (this._cursor > 0) {
      this._cursor--;
    } else {
      return null;
    }
    return entryToEditingState(entries[this._cursor]);
  }

  forward(): TugTextEditingState | null {
    const entries = this._store._getSessionEntries(this._sessionId);

    if (this._cursor === -1) return null;

    if (this._cursor < entries.length - 1) {
      this._cursor++;
      return entryToEditingState(entries[this._cursor]);
    }

    this._cursor = -1;
    return this._draft;
  }
}

/**
 * Route-scoped HistoryProvider returned by `PromptHistoryStore.createRouteProvider()`.
 *
 * Same shape as `SessionHistoryProvider` but with an extra filter: only
 * entries whose `route` field matches the configured route are
 * surfaced. Each route within a session therefore gets an independent
 * history timeline, matching the per-route-drafts semantics of
 * TugPromptEntry's Tugcard persistence payload.
 *
 * Cursor and `_draft` are in-memory and per-provider. Callers that
 * create one provider per route and retain the reference across route
 * switches preserve their browsing position for each route.
 */
class RouteHistoryProvider implements HistoryProvider {
  private _cursor = -1;
  private _draft: TugTextEditingState = { text: "", atoms: [], selection: null };

  constructor(
    private readonly _sessionId: string,
    private readonly _store: PromptHistoryStore,
    private readonly _route: string,
  ) {}

  private _entries(): HistoryEntry[] {
    return this._store
      ._getSessionEntries(this._sessionId)
      .filter((e) => e.route === this._route);
  }

  back(current: TugTextEditingState): TugTextEditingState | null {
    const entries = this._entries();
    const allForSession = this._store._getSessionEntries(this._sessionId);
    logSessionLifecycle("history.provider_back", {
      session_id: this._sessionId,
      route: this._route,
      entries_for_session: allForSession.length,
      entries_for_route: entries.length,
      cursor_in: this._cursor,
    });
    if (entries.length === 0) return null;

    if (this._cursor === -1) {
      this._draft = current;
      this._cursor = entries.length - 1;
    } else if (this._cursor > 0) {
      this._cursor--;
    } else {
      return null;
    }
    return entryToEditingState(entries[this._cursor]);
  }

  forward(): TugTextEditingState | null {
    const entries = this._entries();

    if (this._cursor === -1) return null;

    if (this._cursor < entries.length - 1) {
      this._cursor++;
      return entryToEditingState(entries[this._cursor]);
    }

    this._cursor = -1;
    return this._draft;
  }
}

/** Convert a HistoryEntry into a TugTextEditingState for engine restore. */
function entryToEditingState(entry: HistoryEntry): TugTextEditingState {
  return {
    text: entry.text,
    atoms: entry.atoms.map((a) => ({
      position: a.position,
      type: a.type,
      label: a.label,
      value: a.value,
    })),
    selection: null,
  };
}

// ── PromptHistoryStore ────────────────────────────────────────────────────────

/**
 * PromptHistoryStore — L02-compliant store for session-scoped prompt history.
 *
 * - In-memory map of sessionId → HistoryEntry[].
 * - push() appends and fires tugbank PUT (fire-and-forget).
 * - loadSession() fetches from tugbank on first access per session.
 * - createProvider() returns a HistoryProvider scoped to a session.
 * - subscribe/getSnapshot for useSyncExternalStore. [L02]
 *
 * **Capacity:** 200 entries per session. Oldest entries are dropped on push()
 * when the cap is exceeded. [D07]
 */
export class PromptHistoryStore {
  private _sessions: Map<string, HistoryEntry[]> = new Map();
  private _loadedSessions: Set<string> = new Set();
  /**
   * Pending in-flight load promise per session id. Lets concurrent
   * `loadSession(id)` callers share a single fetch and lets `push(id)`
   * defer its PUT until the load settles — without this, a quick
   * push() before fetch resolves would PUT a partial in-memory list,
   * clobbering the persisted record.
   */
  private _loadPromises: Map<string, Promise<void>> = new Map();
  private _listeners: Set<() => void> = new Set();
  private _lastActiveSessionId: string | null = null;
  private _version = 0;
  private _cachedSnapshot: PromptHistorySnapshot | null = null;
  private _cachedSnapshotVersion = -1;

  // ── L02: subscribe/getSnapshot ────────────────────────────────────────────

  /** Subscribe to store updates. Returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /**
   * Return the current snapshot. Lightweight — counts only.
   * Reference-stable across calls until `_version` changes; required
   * by `useSyncExternalStore` consumers (otherwise React detects a
   * "new" snapshot every render and loops infinitely).
   */
  getSnapshot = (): PromptHistorySnapshot => {
    if (
      this._cachedSnapshot !== null &&
      this._cachedSnapshotVersion === this._version
    ) {
      return this._cachedSnapshot;
    }
    let total = 0;
    for (const entries of this._sessions.values()) {
      total += entries.length;
    }
    const snap: PromptHistorySnapshot = { totalEntries: total };
    this._cachedSnapshot = snap;
    this._cachedSnapshotVersion = this._version;
    return snap;
  };

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Push a new entry onto the session's history.
   *
   * - Enforces 200-entry cap by dropping oldest entries.
   * - Fire-and-forget PUT to tugbank.
   * - Notifies subscribers.
   */
  push(entry: HistoryEntry): void {
    const { sessionId } = entry;
    this._lastActiveSessionId = sessionId;

    let entries = this._sessions.get(sessionId);
    if (!entries) {
      entries = [];
      this._sessions.set(sessionId, entries);
    }

    entries.push(entry);

    // Enforce capacity cap: keep most recent MAX_ENTRIES_PER_SESSION entries.
    if (entries.length > MAX_ENTRIES_PER_SESSION) {
      entries.splice(0, entries.length - MAX_ENTRIES_PER_SESSION);
    }

    // If a load is in flight for this session, defer the PUT until it
    // settles so the merged in-memory view (persisted history + this
    // new entry) is what hits the wire — not just the latest entry,
    // which would otherwise clobber the persisted record.
    const pending = this._loadPromises.get(sessionId);
    if (pending) {
      pending.then(() => {
        const latest = this._sessions.get(sessionId) ?? [];
        putPromptHistory(sessionId, latest);
      });
    } else {
      putPromptHistory(sessionId, entries);
    }

    this._version++;
    this._notifyListeners();
  }

  /**
   * Load history entries for a session from tugbank.
   *
   * - Idempotent: returns the cached promise for any concurrent caller
   *   on the same `sessionId`; no-op if the session is already loaded.
   * - Marks `_loadedSessions` only on a successful fetch (404 included
   *   — that's a definitive "no record"). A network error leaves the
   *   session unmarked so the next `createProvider` call retries.
   * - Dedups the merge by entry id so a re-fetch can't introduce
   *   duplicates for entries that were pushed during the load window.
   */
  async loadSession(sessionId: string): Promise<void> {
    if (this._loadedSessions.has(sessionId)) {
      logSessionLifecycle("history.load_skipped_already_loaded", {
        session_id: sessionId,
        in_memory_count: (this._sessions.get(sessionId) ?? []).length,
      });
      return;
    }
    const inFlight = this._loadPromises.get(sessionId);
    if (inFlight) {
      logSessionLifecycle("history.load_skipped_in_flight", {
        session_id: sessionId,
      });
      return inFlight;
    }
    logSessionLifecycle("history.load_start", { session_id: sessionId });

    const promise = (async () => {
      try {
        const entries = await getPromptHistory(sessionId);
        const existing = this._sessions.get(sessionId) ?? [];
        // Merge: persisted entries first (older), then in-session
        // pushes (newer). Dedup by entry id.
        const seen = new Set<string>();
        const merged: HistoryEntry[] = [];
        for (const e of [...entries, ...existing]) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          merged.push(e);
        }
        const capped =
          merged.length > MAX_ENTRIES_PER_SESSION
            ? merged.slice(merged.length - MAX_ENTRIES_PER_SESSION)
            : merged;
        if (capped.length > 0 || existing.length > 0) {
          this._sessions.set(sessionId, capped);
        }
        this._loadedSessions.add(sessionId);
        logSessionLifecycle("history.load_complete", {
          session_id: sessionId,
          fetched_count: entries.length,
          merged_count: capped.length,
          in_memory_after: (this._sessions.get(sessionId) ?? []).length,
        });
        // Bump on every successful load completion so observers can
        // see "loaded but empty" as a real transition, not a no-op.
        this._version++;
        this._notifyListeners();
      } catch (err) {
        logSessionLifecycle("history.load_error", {
          session_id: sessionId,
          error: String(err),
        });
        // Don't mark loaded on error — a future createProvider call
        // will try again. The in-memory state survives.
      } finally {
        this._loadPromises.delete(sessionId);
      }
    })();
    this._loadPromises.set(sessionId, promise);
    return promise;
  }

  /**
   * Create a HistoryProvider scoped to a session.
   *
   * Kicks off loadSession() if not already loaded — the provider returns null
   * from back() until loading completes (matches HistoryProvider null contract).
   */
  createProvider(sessionId: string): HistoryProvider {
    this._lastActiveSessionId = sessionId;

    // Kick off background load if not already loaded.
    if (!this._loadedSessions.has(sessionId)) {
      void this.loadSession(sessionId);
    }

    return new SessionHistoryProvider(sessionId, this);
  }

  /**
   * Create a route-scoped HistoryProvider for the given session + route.
   *
   * Same semantics as `createProvider`, plus a `route` filter: only
   * entries whose `route` field matches are visible via `back()` /
   * `forward()`. Intended for compound inputs that present a per-route
   * history timeline (e.g. `TugPromptEntry`). Each provider instance
   * owns its own cursor + in-memory draft, so callers that cache one
   * provider per route keep their browsing position for that route
   * across route switches.
   */
  createRouteProvider(sessionId: string, route: string): HistoryProvider {
    this._lastActiveSessionId = sessionId;

    if (!this._loadedSessions.has(sessionId)) {
      void this.loadSession(sessionId);
    }

    return new RouteHistoryProvider(sessionId, this, route);
  }

  // ── Internal helpers (used by SessionHistoryProvider) ─────────────────────

  /** @internal — used by SessionHistoryProvider to read entries. */
  _getSessionEntries(sessionId: string): HistoryEntry[] {
    return this._sessions.get(sessionId) ?? [];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _notifyListeners(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }
}
