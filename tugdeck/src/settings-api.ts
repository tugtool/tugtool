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

/**
 * PUT prompt history for a session to tugbank (fire-and-forget).
 *
 * Domain: `dev.tugtool.prompt.history`, key: `{sessionId}`.
 * Body format: `{ kind: "json", value: [...entries] }`
 */
export function putPromptHistory(sessionId: string, entries: HistoryEntry[]): void {
  const url = `/api/defaults/dev.tugtool.prompt.history/${encodeURIComponent(sessionId)}`;
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
    const response = await fetch(url);
    if (response.status === 404) {
      return [];
    }
    const tagged = await response.json() as { kind: string; value: unknown };
    if (tagged.kind === "json" && Array.isArray(tagged.value)) {
      return tagged.value as HistoryEntry[];
    }
    return [];
  } catch (err) {
    console.warn("[settings] GET promptHistory failed for session", sessionId, err);
    return [];
  }
}
