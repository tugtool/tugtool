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

/** Category priority for dedup: richer categories win over `local`. */
const CATEGORY_RANK: Record<SlashCommandInfo["category"], number> = {
  local: 0,
  skill: 1,
  agent: 1,
};

/**
 * Parse a raw entry from a `system_metadata` command-ish array (slash_commands,
 * skills, or agents) into a `SlashCommandInfo`, or null if malformed.
 *
 * Accepts two shapes because Claude Code's emitter has varied them:
 *   - Bare string — the current v2.1.105 payload ships `slash_commands`,
 *     `skills`, and `agents` as plain string arrays (e.g. `"tugplug:plan"`).
 *   - Object — `{ name, description?, category? }`, a forward-compatible
 *     shape if the emitter later adds metadata.
 */
function parseEntry(
  raw: unknown,
  defaultCategory: SlashCommandInfo["category"],
): SlashCommandInfo | null {
  if (typeof raw === "string" && raw.length > 0) {
    return { name: raw, category: defaultCategory };
  }
  if (raw && typeof raw === "object") {
    const entry = raw as Record<string, unknown>;
    if (typeof entry.name !== "string" || !entry.name) return null;
    return {
      name: entry.name,
      description:
        typeof entry.description === "string" ? entry.description : undefined,
      category:
        typeof entry.category === "string"
          ? toCategory(entry.category)
          : defaultCategory,
    };
  }
  return null;
}

/** Parse a system_metadata payload into a snapshot. Returns null if not system_metadata. */
function parseMetadataPayload(payload: unknown): SessionMetadataSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.type !== "system_metadata") return null;

  // Merge slash_commands, skills, and agents into one list. Real v2.1.105
  // payloads overlap — every tugplug skill (e.g. `tugplug:plan`) is both
  // in `skills[]` (category: skill) and in `slash_commands[]` (category:
  // local). Dedup by name after merging, keeping the richer category.
  const merged: SlashCommandInfo[] = [];

  if (Array.isArray(p.slash_commands)) {
    for (const entry of p.slash_commands) {
      const cmd = parseEntry(entry, "local");
      if (cmd) merged.push(cmd);
    }
  }
  if (Array.isArray(p.skills)) {
    for (const entry of p.skills) {
      const skill = parseEntry(entry, "skill");
      if (skill) merged.push(skill);
    }
  }
  if (Array.isArray(p.agents)) {
    for (const entry of p.agents) {
      const agent = parseEntry(entry, "agent");
      if (agent) merged.push(agent);
    }
  }

  const byName = new Map<string, SlashCommandInfo>();
  for (const cmd of merged) {
    const prev = byName.get(cmd.name);
    if (!prev || CATEGORY_RANK[cmd.category] > CATEGORY_RANK[prev.category]) {
      byName.set(cmd.name, cmd);
    }
  }
  const slashCommands = Array.from(byName.values());

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
