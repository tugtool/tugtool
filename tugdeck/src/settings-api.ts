/**
 * Settings API client for tugcast.
 *
 * Read functions pull from the TugbankClient in-memory cache (populated via
 * the DEFAULTS WebSocket feed). Write functions PUT to the tugcast HTTP API.
 *
 * Domain/key mapping:
 *   Layout    → domain `dev.tugtool.deck.layout`,   key `layout`        (Value::Json)
 *   Theme     → domain `dev.tugtool.app`,            key `theme`         (Value::String)
 *   Tab state → domain `dev.tugtool.deck.tabstate`,  key `<tabId>`       (Value::Json)
 *   Deck state→ domain `dev.tugtool.deck.state`,     key `focusedCardId` (Value::String)
 *
 * The tagged-value wire format is `{"kind":"json","value":{...}}` for JSON
 * values and `{"kind":"string","value":"brio"}` for strings.
 */

import type { TabStateBag } from "./layout-tree";
import type { TugbankClient, TaggedValue } from "./lib/tugbank-client";
import type { HistoryEntry } from "./lib/prompt-history-store";
import { logSessionLifecycle } from "./lib/session-lifecycle-log";

// ── Read functions (TugbankClient cache) ─────────────────────────────────────

/**
 * Read the deck layout from the TugbankClient cache.
 * Returns the unwrapped layout object, or null if not stored.
 */
export function readLayout(client: TugbankClient): object | null {
  const entry = client.get("dev.tugtool.deck.layout", "layout");
  if (entry && entry.kind === "json" && entry.value !== undefined) {
    return entry.value as object;
  }
  return null;
}

/**
 * Read the app theme from the TugbankClient cache.
 * Returns the theme string, or null if not stored.
 */
export function readTheme(client: TugbankClient): string | null {
  const entry = client.get("dev.tugtool.app", "theme");
  if (entry && entry.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  return null;
}

/**
 * Read the focused card ID from the TugbankClient cache.
 * Returns the string value, or null if not stored.
 */
export function readDeckState(client: TugbankClient): string | null {
  const entry = client.get("dev.tugtool.deck.state", "focusedCardId");
  if (entry && entry.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  return null;
}

/**
 * Read all tab state bags from the TugbankClient cache.
 * Returns a Map of tabId → TabStateBag for tabs that have stored state.
 */
export function readTabStates(client: TugbankClient, tabIds: string[]): Map<string, TabStateBag> {
  const map = new Map<string, TabStateBag>();
  const domain = client.readDomain("dev.tugtool.deck.tabstate");
  if (!domain) return map;

  for (const tabId of tabIds) {
    const entry = domain[tabId] as TaggedValue | undefined;
    if (entry && entry.kind === "json" && entry.value !== undefined) {
      map.set(tabId, entry.value as TabStateBag);
    }
  }
  return map;
}

// ── Write functions (HTTP PUT, unchanged) ────────────────────────────────────

/**
 * PUT the deck layout to tugbank.
 *
 * Returns the fetch Promise so callers can await it when needed (e.g. before
 * page reload). Normal saves are fire-and-forget — the Promise is ignored.
 */
export function putLayout(layout: object): Promise<void> {
  return fetch("/api/defaults/dev.tugtool.deck.layout/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: layout }),
  })
    .then(() => {})
    .catch((err) => {
      console.warn("[settings] PUT layout failed:", err);
    });
}

/**
 * PUT the app theme to tugbank (fire-and-forget).
 */
export function putTheme(theme: string): void {
  fetch("/api/defaults/dev.tugtool.app/theme", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: theme }),
  }).catch((err) => {
    console.warn("[settings] PUT theme failed:", err);
  });
}

/**
 * PUT a single tab state bag to tugbank.
 *
 * Returns a Promise that resolves when the write completes. Callers that
 * need to wait (e.g. prepareForReload) can await it; fire-and-forget
 * callers can ignore the return value.
 */
export function putTabState(tabId: string, bag: TabStateBag, options?: { keepalive?: boolean; sync?: boolean }): Promise<void> {
  const url = `/api/defaults/dev.tugtool.deck.tabstate/${encodeURIComponent(tabId)}`;
  const body = JSON.stringify({ kind: "json", value: bag });

  if (options?.sync) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, false);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(body);
    } catch (err) {
      console.warn("[settings] PUT tabState (sync) failed for tab", tabId, err);
    }
    return Promise.resolve();
  }

  return fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: options?.keepalive,
  }).then(() => {}).catch((err) => {
    console.warn("[settings] PUT tabState failed for tab", tabId, err);
  });
}

/**
 * PUT the focused card ID to tugbank (fire-and-forget).
 */
export function putFocusedCardId(focusedCardId: string): void {
  fetch("/api/defaults/dev.tugtool.deck.state/focusedCardId", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: focusedCardId }),
  }).catch((err) => {
    console.warn("[settings] PUT focusedCardId failed:", err);
  });
}

// ── Editor settings ─────────────────────────────────────────────────────────

/** Editor settings shape stored in tugbank. */
export interface EditorSettings {
  fontId: string;
  fontSize: number;
  letterSpacing: number;
  /** Unit-less line-height multiplier (e.g. 1.7). */
  lineHeight: number;
}

/**
 * Read editor settings from the TugbankClient cache.
 */
export function readEditorSettings(client: TugbankClient): EditorSettings | null {
  const entry = client.get("dev.tugtool.editor", "settings");
  if (entry && entry.kind === "json" && entry.value !== undefined) {
    return entry.value as EditorSettings;
  }
  return null;
}

/**
 * PUT editor settings to tugbank (fire-and-forget).
 */
export function putEditorSettings(settings: EditorSettings): void {
  fetch("/api/defaults/dev.tugtool.editor/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: settings }),
  }).catch((err) => {
    console.warn("[settings] PUT editorSettings failed:", err);
  });
}

/**
 * GET editor settings from tugbank (HTTP, for use without TugbankClient).
 */
export async function getEditorSettings(): Promise<EditorSettings | null> {
  try {
    const response = await fetch("/api/defaults/dev.tugtool.editor/settings");
    if (response.status === 404) return null;
    const tagged = await response.json() as { kind: string; value: unknown };
    if (tagged.kind === "json" && tagged.value !== undefined) {
      return tagged.value as EditorSettings;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Split pane layouts ──────────────────────────────────────────────────────

/**
 * Split-pane layout persisted in tugbank. Matches react-resizable-panels'
 * `Layout` type: a map of panel id to flex-grow value.
 */
export type SplitPaneLayout = Record<string, number>;

/**
 * Read a split-pane layout from the TugbankClient cache.
 *
 * Domain: `dev.tugtool.tugways.split-pane`, key: caller-provided `storageKey`.
 * Returns the layout object, or null if not stored.
 */
export function readSplitPaneLayout(
  client: TugbankClient,
  storageKey: string,
): SplitPaneLayout | null {
  const entry = client.get("dev.tugtool.tugways.split-pane", storageKey);
  if (entry && entry.kind === "json" && entry.value !== undefined) {
    return entry.value as SplitPaneLayout;
  }
  return null;
}

/**
 * PUT a split-pane layout to tugbank (fire-and-forget).
 *
 * Domain: `dev.tugtool.tugways.split-pane`, key: caller-provided `storageKey`.
 *
 * `keepalive: true` lets the request outlive the page. Callers fire this
 * on sash pointerup, and users frequently reload immediately after
 * dragging; without `keepalive`, the reload cancels the in-flight PUT
 * before it reaches the server and the drag is silently lost.
 */
export function putSplitPaneLayout(storageKey: string, layout: SplitPaneLayout): void {
  const url = `/api/defaults/dev.tugtool.tugways.split-pane/${encodeURIComponent(storageKey)}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: layout }),
    keepalive: true,
  }).catch((err) => {
    console.warn("[settings] PUT splitPaneLayout failed for key", storageKey, err);
  });
}

// ── Tide recent projects ────────────────────────────────────────────────────

/** Maximum number of recent-project paths retained in the quick-pick list. */
export const TIDE_RECENT_PROJECTS_MAX = 5;

/**
 * Read the tide-card recent-projects list from the TugbankClient cache.
 *
 * Domain: `dev.tugtool.tide`, key: `recent-projects`.
 * Value shape: `{ paths: string[] }`. Returns `[]` if unset or malformed.
 *
 * The list is keyed by the user-typed project path — the same identifier
 * the picker displays, submits on `spawn_session`, and uses to key the
 * `session-id-by-workspace` map. Roadmap step 4.5 collapsed session
 * bookkeeping to a single identifier so every consumer (recents,
 * session-id map, bind payload, tugcode's persistence) reads and writes
 * the same string.
 */
export function readTideRecentProjects(client: TugbankClient): string[] {
  const entry = client.get("dev.tugtool.tide", "recent-projects");
  if (!entry || entry.kind !== "json" || entry.value === undefined) {
    return [];
  }
  const raw = entry.value as { paths?: unknown } | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.paths)) {
    return [];
  }
  return raw.paths.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/**
 * PUT the tide-card recent-projects list to tugbank (fire-and-forget).
 * Callers are responsible for dedup + capping; the helper writes the list
 * verbatim.
 */
export function putTideRecentProjects(paths: string[]): void {
  fetch("/api/defaults/dev.tugtool.tide/recent-projects", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: { paths } }),
  }).catch((err) => {
    console.warn("[settings] PUT recent-projects failed:", err);
  });
}

/**
 * Prepend `projectDir` onto `existing`, dedup case-sensitively, and cap at
 * `TIDE_RECENT_PROJECTS_MAX`. Pure helper so callers can compose the new
 * list before handing it to `putTideRecentProjects`.
 */
export function insertTideRecentProject(existing: string[], projectDir: string): string[] {
  const next = [projectDir, ...existing.filter((p) => p !== projectDir)];
  return next.slice(0, TIDE_RECENT_PROJECTS_MAX);
}

/**
 * PUT prompt history for a session to tugbank (fire-and-forget).
 *
 * Domain: `dev.tugtool.prompt.history`, key: `{sessionId}`.
 * Body format: `{ kind: "json", value: [...entries] }`
 */
export function putPromptHistory(sessionId: string, entries: HistoryEntry[]): void {
  const url = `/api/defaults/dev.tugtool.prompt.history/${encodeURIComponent(sessionId)}`;
  logSessionLifecycle("history.put", {
    session_id: sessionId,
    url,
    entry_count: entries.length,
  });
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: entries }),
  }).catch((err) => {
    console.warn("[settings] PUT promptHistory failed for session", sessionId, err);
  });
}

/**
 * GET prompt history for a session from tugbank.
 *
 * Returns the entries array, or an empty array on 404 or parse error.
 *
 * Domain: `dev.tugtool.prompt.history`, key: `{sessionId}`.
 * Response format: `{ kind: "json", value: [...entries] }`
 */
export async function getPromptHistory(sessionId: string): Promise<HistoryEntry[]> {
  const url = `/api/defaults/dev.tugtool.prompt.history/${encodeURIComponent(sessionId)}`;
  try {
    // `cache: "no-store"` defeats the browser HTTP cache. Without it a
    // 404 (or stale 200) from a prior load on the same URL gets reused
    // and the picker silently shows old/empty history after another
    // tugdeck process / card has already pushed new entries.
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 404) {
      logSessionLifecycle("history.get", {
        session_id: sessionId,
        url,
        status: 404,
        entry_count: 0,
      });
      return [];
    }
    const tagged = await response.json() as { kind: string; value: unknown };
    if (tagged.kind === "json" && Array.isArray(tagged.value)) {
      const entries = tagged.value as HistoryEntry[];
      logSessionLifecycle("history.get", {
        session_id: sessionId,
        url,
        status: response.status,
        entry_count: entries.length,
      });
      return entries;
    }
    logSessionLifecycle("history.get", {
      session_id: sessionId,
      url,
      status: response.status,
      entry_count: 0,
    });
    return [];
  } catch (err) {
    console.warn("[settings] GET promptHistory failed for session", sessionId, err);
    return [];
  }
}
