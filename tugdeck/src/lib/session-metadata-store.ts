/**
 * SessionMetadataStore — subscribable store for Claude Code session metadata.
 *
 * Subscribes to a FeedStore and watches for `system_metadata` payloads on
 * the specified feed ID. Parses slash commands and skills into a merged
 * SlashCommandInfo array and exposes a CompletionProvider factory for the
 * `/` trigger.
 *
 * **Laws:** [L02] External state enters React through useSyncExternalStore only.
 * [L22] Observed by engine callbacks, not round-tripped through React.
 *
 * @module lib/session-metadata-store
 */

import type { FeedStore } from "./feed-store";
import type { FeedIdValue } from "../protocol";
import type { CompletionProvider, CompletionItem } from "./tug-text-engine";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single slash command or skill entry from session metadata. */
export interface SlashCommandInfo {
  name: string;
  description?: string;
  category: "local" | "agent" | "skill";
}

/** Snapshot of the current session metadata state. */
export interface SessionMetadataSnapshot {
  sessionId: string | null;
  model: string | null;
  permissionMode: string | null;
  cwd: string | null;
  slashCommands: SlashCommandInfo[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const EMPTY_SNAPSHOT: SessionMetadataSnapshot = {
  sessionId: null,
  model: null,
  permissionMode: null,
  cwd: null,
  slashCommands: [],
};

/** Validate and normalize a category string. */
function toCategory(raw: unknown): "local" | "agent" | "skill" {
  if (raw === "agent" || raw === "skill") return raw;
  return "local";
}

/** Parse a raw slash_commands array entry into SlashCommandInfo, or null if invalid. */
function parseSlashCommand(raw: unknown, defaultCategory: "local" | "agent" | "skill"): SlashCommandInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.name !== "string" || !entry.name) return null;
  return {
    name: entry.name,
    description: typeof entry.description === "string" ? entry.description : undefined,
    category: typeof entry.category === "string" ? toCategory(entry.category) : defaultCategory,
  };
}

/** Parse a system_metadata payload into a snapshot. Returns null if not system_metadata. */
function parseMetadataPayload(payload: unknown): SessionMetadataSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "system_metadata") return null;

  const slashCommands: SlashCommandInfo[] = [];

  // Parse slash_commands
  if (Array.isArray(p.slash_commands)) {
    for (const entry of p.slash_commands) {
      const cmd = parseSlashCommand(entry, "local");
      if (cmd) slashCommands.push(cmd);
    }
  }

  // Parse skills (same format, category = "skill")
  if (Array.isArray(p.skills)) {
    for (const entry of p.skills) {
      const skill = parseSlashCommand(entry, "skill");
      if (skill) slashCommands.push(skill);
    }
  }

  return {
    sessionId: typeof p.session_id === "string" ? p.session_id : null,
    model: typeof p.model === "string" ? p.model : null,
    permissionMode: typeof p.permission_mode === "string" ? p.permission_mode : null,
    cwd: typeof p.cwd === "string" ? p.cwd : null,
    slashCommands,
  };
}

// ── SessionMetadataStore ──────────────────────────────────────────────────────

/**
 * SessionMetadataStore — L02-compliant store subscribing to FeedStore.
 *
 * Detects system_metadata payloads via reference comparison on the given feed.
 * Exposes subscribe/getSnapshot for useSyncExternalStore and
 * getCommandCompletionProvider() for the / trigger.
 */
export class SessionMetadataStore {
  private _snapshot: SessionMetadataSnapshot = { ...EMPTY_SNAPSHOT, slashCommands: [] };
  private _listeners: Set<() => void> = new Set();
  private _unsubscribeFeed: (() => void) | null = null;
  private _lastPayloadRef: unknown = undefined;
  private _feedId: FeedIdValue;

  constructor(feedStore: FeedStore, feedId: FeedIdValue) {
    this._feedId = feedId;
    this._unsubscribeFeed = feedStore.subscribe(() => {
      this._onFeedUpdate(feedStore);
    });
    // Run an initial check in case data is already available.
    this._onFeedUpdate(feedStore);
  }

  private _onFeedUpdate(feedStore: FeedStore): void {
    const map = feedStore.getSnapshot();
    const payload = map.get(this._feedId);

    // Reference comparison: only process if the payload reference changed.
    if (payload === this._lastPayloadRef) return;
    this._lastPayloadRef = payload;

    const parsed = parseMetadataPayload(payload);
    if (!parsed) return;

    this._snapshot = parsed;
    for (const listener of this._listeners) {
      listener();
    }
  }

  /** Subscribe to store updates. Returns an unsubscribe function. (L02) */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /** Return the current session metadata snapshot. (L02) */
  getSnapshot = (): SessionMetadataSnapshot => {
    return this._snapshot;
  };

  /**
   * Returns a CompletionProvider for the / trigger.
   * The provider closes over the store and reads current slashCommands on each call.
   * Filters by case-insensitive substring match. Returns CompletionItem[] with
   * atom.type = "command".
   */
  getCommandCompletionProvider(): CompletionProvider {
    return (query: string): CompletionItem[] => {
      const { slashCommands } = this._snapshot;
      const lower = query.toLowerCase();
      const results: CompletionItem[] = [];
      for (const cmd of slashCommands) {
        if (!lower || cmd.name.toLowerCase().includes(lower)) {
          results.push({
            label: cmd.name,
            atom: {
              kind: "atom",
              type: "command",
              label: cmd.name,
              value: cmd.name,
            },
          });
        }
      }
      return results;
    };
  }

  /** Unsubscribe from FeedStore and clear listeners. */
  dispose(): void {
    if (this._unsubscribeFeed) {
      this._unsubscribeFeed();
      this._unsubscribeFeed = null;
    }
    this._listeners.clear();
  }
}
