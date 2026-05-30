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
import type { CompletionProvider, CompletionItem } from "./tug-text-types";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single slash command or skill entry from session metadata. */
export interface SlashCommandInfo {
  name: string;
  description?: string;
  category: "local" | "agent" | "skill";
}

/**
 * One model offered by the `initialize` control-response `models` list,
 * forwarded turn-free as a `session_capabilities` frame. The picker
 * ([#step-2b]) reads `value` (the `--model` selector) + `displayName`;
 * `models[0]` is the account default by convention (`value: "default"`,
 * `displayName: "Default (recommended)"`).
 */
export interface CapabilityModel {
  value: string;
  displayName: string;
  description?: string;
  /**
   * Whether this model supports reasoning effort ([#step-4]). Absent on the
   * wire (and here) when the model does not support it — e.g. haiku — so its
   * absence IS the "unsupported" signal that gates the effort chip.
   */
  supportsEffort?: boolean;
  /**
   * The effort levels this model supports, in the wire's order. Varies by
   * model (opus: `low|medium|high|xhigh|max`; sonnet drops `xhigh`), so the
   * picker offers the *active* model's list. Absent when effort is unsupported.
   */
  supportedEffortLevels?: string[];
}

/** Snapshot of the current session metadata state. */
export interface SessionMetadataSnapshot {
  sessionId: string | null;
  model: string | null;
  permissionMode: string | null;
  cwd: string | null;
  /**
   * Claude Code's stream-json format version (`system_metadata.version`,
   * e.g. `"2.1.105"`). `null` before the metadata event lands. Read by
   * the Dev card's drift-caution surface to compare against the pinned
   * catalog version.
   */
  version: string | null;
  slashCommands: SlashCommandInfo[];
  /**
   * Available models from the turn-free `initialize` handshake
   * ([#step-2a]). Empty until the `session_capabilities` frame lands.
   * `models[0]` is the account default. Source for the `/model` picker
   * ([#step-2b]) and the model chip's pre-turn default-model label —
   * `initialize` does NOT carry the exact current model id, only this
   * list, so the chip shows `models[0].displayName` until a live
   * `system_metadata.model` (or the on-bind ledger replay) sharpens it.
   */
  models: CapabilityModel[];
  /**
   * The session's current reasoning-effort level ([#step-4]), from
   * `session_capabilities.effort`. `null` when no `--effort` override is in
   * force (the model runs at its built-in default, which the wire does not
   * expose) — the chip reads `null` as "Default". tugcode is the authority
   * (it owns the `--effort` flag); a client-initiated change reflects here
   * optimistically via {@link SessionMetadataStore.applyEffort}, since the
   * respawn-to-apply ([R07]) emits no fresh metadata for a resumed session.
   */
  effort: string | null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const EMPTY_SNAPSHOT: SessionMetadataSnapshot = {
  sessionId: null,
  model: null,
  permissionMode: null,
  cwd: null,
  version: null,
  slashCommands: [],
  models: [],
  effort: null,
};

/**
 * Parse the `models` array of a `session_capabilities` payload. Keeps
 * only entries with a string `value` + `displayName`; `description` is
 * optional. Malformed entries are skipped (never throws) — mirrors
 * tugcode's `capabilities.ts` parser.
 */
function parseCapabilityModels(raw: unknown): CapabilityModel[] {
  if (!Array.isArray(raw)) return [];
  const out: CapabilityModel[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.value !== "string" || typeof obj.displayName !== "string") {
      continue;
    }
    const model: CapabilityModel = {
      value: obj.value,
      displayName: obj.displayName,
    };
    if (typeof obj.description === "string") model.description = obj.description;
    // Reasoning-effort capability ([#step-4]). `supportsEffort` is absent when
    // unsupported, so keep it only when present; `supportedEffortLevels` keeps
    // only its string elements. Mirrors tugcode's `capabilities.ts` parser.
    if (typeof obj.supportsEffort === "boolean") {
      model.supportsEffort = obj.supportsEffort;
    }
    if (Array.isArray(obj.supportedEffortLevels)) {
      model.supportedEffortLevels = obj.supportedEffortLevels.filter(
        (l): l is string => typeof l === "string",
      );
    }
    out.push(model);
  }
  return out;
}

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
    // Wire emits `permissionMode` (camelCase) per
    // `tugcode/src/session.ts:498,517`. The earlier snake_case parse
    // key silently returned null for every live payload.
    permissionMode: typeof p.permissionMode === "string" ? p.permissionMode : null,
    cwd: typeof p.cwd === "string" ? p.cwd : null,
    version: typeof p.version === "string" ? p.version : null,
    slashCommands,
    // `models` + `effort` come from `session_capabilities`, not
    // `system_metadata`; `_onFeedUpdate` preserves the captured values across
    // this replace.
    models: [],
    effort: null,
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
    this._processPayload(payload);
  }

  /**
   * Apply one decoded SESSION_METADATA payload to the snapshot. Shared by the
   * live feed path ({@link _onFeedUpdate}) and the test injection
   * ({@link _ingestForTest}); the reference-dedupe lives in `_onFeedUpdate`,
   * so this always processes what it is given.
   */
  private _processPayload(payload: unknown): void {
    // Two payload types ride the SESSION_METADATA feed: `system_metadata`
    // (live current model / version / mode, post-turn) and
    // `session_capabilities` (the turn-free `initialize` model list /
    // command catalog, [#step-2a]). The FeedStore keeps only the latest
    // payload per feed, so each arrives here as the single current slot;
    // we capture each into its own snapshot region and preserve the
    // other across the update, so a later `system_metadata` never wipes
    // the captured `models`, and vice versa.
    const payloadType =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>).type
        : undefined;

    if (payloadType === "session_capabilities") {
      const cap = payload as Record<string, unknown>;
      const models = parseCapabilityModels(cap.models);
      // tugcode surfaces the current effort level here (it owns `--effort`);
      // `null` when no override is in force ([#step-4]).
      const effort = typeof cap.effort === "string" ? cap.effort : null;
      this._snapshot = { ...this._snapshot, models, effort };
      for (const listener of this._listeners) listener();
      return;
    }

    const parsed = parseMetadataPayload(payload);
    if (!parsed) return;

    // Wholesale replace of the metadata region. The tugcast supervisor's
    // bridge intercept merges every `system_metadata` line against the
    // persisted ledger row before forwarding, so the wire always
    // delivers the most-informationally-rich payload. Client-side merge
    // is no longer needed — but the turn-free `models` captured from a
    // prior `session_capabilities` frame is preserved across the replace
    // (the two payload types share this feed slot).
    this._snapshot = {
      ...parsed,
      models: this._snapshot.models,
      effort: this._snapshot.effort,
    };
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
   * Test-only. Apply a decoded `session_capabilities` / `system_metadata`
   * payload as if it had landed on the feed, bypassing the connection. The
   * effort-chip app-test drives the Z4B chip with this via the `__tug` surface
   * (`ingestSessionMetadata`) — the chip reads its own `SESSION_METADATA`
   * FeedStore, which the `driveDevSession`/`ingestFrame` (CodeSessionStore)
   * path does not reach.
   *
   * @internal — reached only through the DEV-gated `window.__tug` test surface.
   */
  _ingestForTest = (payload: unknown): void => {
    this._processPayload(payload);
  };

  /**
   * Optimistically reflect a client-initiated permission-mode change.
   *
   * tugcode is the authority for permission mode — it owns the
   * `--permission-mode` flag and forwards `set_permission_mode` to claude
   * — but claude answers with a `control_response`, not a fresh
   * `system_metadata`, so there is no round-trip to await. The terminal
   * updates its mode banner optimistically and so do we: the dev card's
   * `Shift+Tab` / `/permissions` paths call this right after sending the
   * frame so the Z4B chip reflects the change immediately.
   *
   * Self-correcting: the next authoritative `system_metadata` payload (on
   * respawn / re-init) replaces the snapshot wholesale, carrying the same
   * mode tugcode applied. A no-op when the mode is unchanged (preserves
   * snapshot reference stability for `useSyncExternalStore`).
   */
  applyPermissionMode(mode: string): void {
    if (this._snapshot.permissionMode === mode) return;
    this._snapshot = { ...this._snapshot, permissionMode: mode };
    for (const listener of this._listeners) {
      listener();
    }
  }

  /**
   * Optimistically reflect a client-initiated model change.
   *
   * Like {@link applyPermissionMode}: claude answers a `set_model` control
   * request with a `control_response`, not a fresh `system_metadata`, so there
   * is no round-trip to await. The `/model` picker calls this right after
   * sending the frame so the Z4B model chip reflects the change immediately.
   * `model` is a resolved model id (e.g. `claude-sonnet-4-6`) so the chip's
   * `formatModelLabel` renders a friendly label. Self-correcting: the next
   * authoritative `system_metadata` replaces the snapshot wholesale. A no-op
   * when unchanged (preserves snapshot reference stability).
   */
  applyModel(model: string): void {
    if (this._snapshot.model === model) return;
    this._snapshot = { ...this._snapshot, model };
    for (const listener of this._listeners) {
      listener();
    }
  }

  /**
   * Optimistically reflect a client-initiated reasoning-effort change
   * ([#step-4]). Unlike model / permission mode, effort has no live control
   * verb — tugcode applies it by respawning claude with `--effort` + `--resume`
   * ([R07]) — and a resumed respawn emits no fresh `session_capabilities`, so
   * this optimistic update is the ONLY thing that moves the chip until a later
   * new-mode spawn re-reports it. The effort picker calls this right after
   * sending the frame. A no-op when unchanged (preserves snapshot reference
   * stability for `useSyncExternalStore`).
   */
  applyEffort(effort: string): void {
    if (this._snapshot.effort === effort) return;
    this._snapshot = { ...this._snapshot, effort };
    for (const listener of this._listeners) {
      listener();
    }
  }

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
