/**
 * Settings API client for tugcast.
 *
 * Provides domain-aware read and put functions that read through the
 * TugbankClient WebSocket cache and write through the
 * `/api/defaults/` HTTP endpoints introduced in Phase 5e3.
 *
 * Layout and theme are stored in separate tugbank domains per [D02]:
 *
 *   Layout    → domain `dev.tugtool.deck.layout`,   key `layout`        (Value::Json)
 *   Theme     → domain `dev.tugtool.app`,            key `theme`         (Value::String)
 *   Tab state → domain `dev.tugtool.deck.tabstate`,  key `<tabId>`       (Value::Json)
 *   Deck state→ domain `dev.tugtool.deck.state`,     key `focusedCardId` (Value::String)
 *
 * Read path: synchronous cache reads via TugbankClient after ready() resolves.
 * Write path: PUT /api/defaults/:domain/:key (unchanged).
 *
 * Wire format for writes: `{"kind":"json","value":{...}}` for layout/tab state
 * and `{"kind":"string","value":"brio"}` for theme/deck state [D04].
 * Wire format for reads (WebSocket): `{"type":"json","value":{...}}` etc.
 *
 * Both dev and production modes proxy /api to tugcast on port 55255, so
 * relative URLs work in both environments.
 */

import type { TabStateBag } from "./layout-tree";
import type { TugbankClient } from "./lib/tugbank-client";

/** Module-level TugbankClient instance, set via initTugbankClient(). */
let _client: TugbankClient | null = null;

/**
 * Initialize the settings-api module with a TugbankClient instance.
 *
 * Must be called before any fetch* function is invoked. Callers should
 * await client.ready() before calling the read functions.
 */
export function initTugbankClient(client: TugbankClient): void {
  _client = client;
}

/** Return the active TugbankClient, throwing if not initialized. */
function getClient(): TugbankClient {
  if (_client === null) {
    throw new Error("[settings] TugbankClient not initialized — call initTugbankClient() first");
  }
  return _client;
}

/**
 * Fetch the deck layout from the TugbankClient cache.
 *
 * Returns the unwrapped layout object, or `null` if no layout is stored.
 *
 * Callers must await TugbankClient.ready() before calling this function.
 * The function signature remains async for backward compatibility with call
 * sites that await it, but the read itself is synchronous.
 */
export async function fetchLayoutWithRetry(): Promise<object | null> {
  const tagged = getClient().get("dev.tugtool.deck.layout", "layout");
  if (tagged === undefined) {
    return null;
  }
  if (tagged.type === "json" && tagged.value !== undefined && tagged.value !== null) {
    return tagged.value as object;
  }
  console.warn("[settings] fetchLayoutWithRetry: unexpected tagged format", tagged);
  return null;
}

/**
 * Fetch the app theme from the TugbankClient cache.
 *
 * Returns the unwrapped theme string, or `null` if no theme is stored.
 *
 * Callers must await TugbankClient.ready() before calling this function.
 * The function signature remains async for backward compatibility.
 */
export async function fetchThemeWithRetry(): Promise<string | null> {
  const tagged = getClient().get("dev.tugtool.app", "theme");
  if (tagged === undefined) {
    return null;
  }
  if (tagged.type === "string" && typeof tagged.value === "string") {
    return tagged.value;
  }
  console.warn("[settings] fetchThemeWithRetry: unexpected tagged format", tagged);
  return null;
}

/**
 * PUT the deck layout to tugbank (fire-and-forget).
 *
 * Wraps `layout` in the tagged-value wire format `{"kind":"json","value":{...}}`
 * and PUTs to `/api/defaults/dev.tugtool.deck.layout/layout`.
 *
 * Errors are logged to console.warn and otherwise ignored — save failures
 * are non-fatal.
 */
export function putLayout(layout: object): void {
  fetch("/api/defaults/dev.tugtool.deck.layout/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "json", value: layout }),
  }).catch((err) => {
    console.warn("[settings] PUT layout failed:", err);
  });
}

/**
 * PUT the app theme to tugbank (fire-and-forget).
 *
 * Wraps `theme` in the tagged-value wire format `{"kind":"string","value":"..."}`
 * and PUTs to `/api/defaults/dev.tugtool.app/theme`.
 *
 * Errors are logged to console.warn and otherwise ignored — save failures
 * are non-fatal.
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

// ---- Theme Generator recipe persistence ----

/**
 * Fetch the Theme Generator recipe from the TugbankClient cache.
 * Returns "dark" or "light", or `null` if not stored.
 *
 * Note: the REST endpoint path remains `/api/defaults/dev.tugtool.app/generator-mode`
 * (legacy name) to preserve backward compatibility with previously persisted values.
 */
export async function fetchGeneratorRecipe(): Promise<"dark" | "light" | null> {
  const tagged = getClient().get("dev.tugtool.app", "generator-mode");
  if (tagged === undefined) {
    return null;
  }
  const v = tagged.value;
  return v === "dark" || v === "light" ? v : null;
}

/**
 * PUT the Theme Generator recipe to tugbank (fire-and-forget).
 *
 * Note: the REST endpoint path remains `/api/defaults/dev.tugtool.app/generator-mode`
 * (legacy name) to preserve backward compatibility with previously persisted values.
 */
export function putGeneratorRecipe(recipe: "dark" | "light"): void {
  fetch("/api/defaults/dev.tugtool.app/generator-mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: recipe }),
  }).catch((err) => {
    console.warn("[settings] PUT generator-mode failed:", err);
  });
}

// ---- Phase 5f: Tab state and deck state API ([D01], [D03], Spec S02) ----

/**
 * Fetch all tab state bags from the TugbankClient cache for the given tab IDs.
 *
 * Returns a Map<tabId, TabStateBag> of successfully retrieved entries. Tab IDs
 * with no stored state are absent from the map.
 *
 * Callers must await TugbankClient.ready() before calling this function.
 * The function signature remains async for backward compatibility.
 *
 * Spec S02: fetchTabStatesWithRetry
 */
export async function fetchTabStatesWithRetry(tabIds: string[]): Promise<Map<string, TabStateBag>> {
  const client = getClient();
  const map = new Map<string, TabStateBag>();
  for (const tabId of tabIds) {
    const tagged = client.get("dev.tugtool.deck.tabstate", tabId);
    if (tagged !== undefined && tagged.type === "json" && tagged.value !== undefined && tagged.value !== null) {
      map.set(tabId, tagged.value as TabStateBag);
    }
  }
  return map;
}

/**
 * PUT a single tab state bag to tugbank (fire-and-forget).
 *
 * Wraps `bag` in the tagged-value wire format `{"kind":"json","value":{...}}`
 * and PUTs to `/api/defaults/dev.tugtool.deck.tabstate/{tabId}`.
 *
 * The optional `options.keepalive` flag passes `keepalive: true` to the fetch
 * init, guaranteeing the browser dispatches the request even during page
 * teardown (used by the beforeunload handler per corrected D49).
 *
 * Errors are logged to console.warn and otherwise ignored — save failures
 * are non-fatal.
 *
 * Spec S02: putTabState
 */
export function putTabState(tabId: string, bag: TabStateBag, options?: { keepalive?: boolean; sync?: boolean }): void {
  const url = `/api/defaults/dev.tugtool.deck.tabstate/${encodeURIComponent(tabId)}`;
  const body = JSON.stringify({ kind: "json", value: bag });

  if (options?.sync) {
    // Synchronous XHR: blocks until tugbank confirms the write. Used by
    // saveAndFlushSync (app quit path) so the native side can safely kill tugcast
    // after evaluateJavaScript completes. fetch is always async and would
    // race with process shutdown.
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, false); // false = synchronous
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(body);
    } catch (err) {
      console.warn("[settings] PUT tabState (sync) failed for tab", tabId, err);
    }
    return;
  }

  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: options?.keepalive,
  }).catch((err) => {
    console.warn("[settings] PUT tabState failed for tab", tabId, err);
  });
}

/**
 * Fetch the focused card ID from the TugbankClient cache.
 *
 * Returns the string value on success, or null if no value is stored.
 *
 * Callers must await TugbankClient.ready() before calling this function.
 * The function signature remains async for backward compatibility.
 *
 * Spec S02: fetchDeckStateWithRetry
 */
export async function fetchDeckStateWithRetry(): Promise<string | null> {
  const tagged = getClient().get("dev.tugtool.deck.state", "focusedCardId");
  if (tagged === undefined) {
    return null;
  }
  if (tagged.type === "string" && typeof tagged.value === "string") {
    return tagged.value;
  }
  console.warn("[settings] fetchDeckStateWithRetry: unexpected tagged format", tagged);
  return null;
}

/**
 * PUT the focused card ID to tugbank (fire-and-forget).
 *
 * Wraps `focusedCardId` in the tagged-value wire format
 * `{"kind":"string","value":"<id>"}` and PUTs to
 * `/api/defaults/dev.tugtool.deck.state/focusedCardId`.
 *
 * Errors are logged to console.warn and otherwise ignored — save failures
 * are non-fatal.
 *
 * Spec S02: putFocusedCardId
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
