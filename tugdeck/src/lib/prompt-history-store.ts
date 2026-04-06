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
 */
export interface PromptHistorySnapshot {
  totalEntries: number;
  sessionEntries: number;
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
  private _listeners: Set<() => void> = new Set();
  private _lastActiveSessionId: string | null = null;
  private _version = 0;

  // ── L02: subscribe/getSnapshot ────────────────────────────────────────────

  /** Subscribe to store updates. Returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /** Return the current snapshot. Lightweight — counts only. */
  getSnapshot = (): PromptHistorySnapshot => {
    let total = 0;
    for (const entries of this._sessions.values()) {
      total += entries.length;
    }
    const sessionEntries =
      this._lastActiveSessionId !== null
        ? (this._sessions.get(this._lastActiveSessionId)?.length ?? 0)
        : 0;
    return { totalEntries: total, sessionEntries };
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

    // Persist to tugbank (fire-and-forget).
    putPromptHistory(sessionId, entries);

    this._version++;
    this._notifyListeners();
  }

  /**
   * Load history entries for a session from tugbank.
   *
   * No-op if already loaded for this session.
   */
  async loadSession(sessionId: string): Promise<void> {
    if (this._loadedSessions.has(sessionId)) return;
    this._loadedSessions.add(sessionId);

    try {
      const entries = await getPromptHistory(sessionId);
      if (entries.length > 0) {
        const existing = this._sessions.get(sessionId) ?? [];
        // Merge: existing in-session pushes take priority; prepend persisted entries.
        const merged = [...entries, ...existing];
        // Apply cap after merge.
        const capped =
          merged.length > MAX_ENTRIES_PER_SESSION
            ? merged.slice(merged.length - MAX_ENTRIES_PER_SESSION)
            : merged;
        this._sessions.set(sessionId, capped);
        this._version++;
        this._notifyListeners();
      }
    } catch {
      // If fetch fails, continue with in-memory state.
    }
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
