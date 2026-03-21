/**
 * Settings API client for tugcast.
 *
 * Provides domain-aware fetch and put functions that read/write through the
 * `/api/defaults/` endpoints introduced in Phase 5e3. Layout and theme are
 * stored in separate tugbank domains per [D02]:
 *
 *   Layout    → domain `dev.tugtool.deck.layout`,   key `layout`        (Value::Json)
 *   Theme     → domain `dev.tugtool.app`,            key `theme`         (Value::String)
 *   Tab state → domain `dev.tugtool.deck.tabstate`,  key `<tabId>`       (Value::Json)
 *   Deck state→ domain `dev.tugtool.deck.state`,     key `focusedCardId` (Value::String)
 *
 * The wire format is a tagged-value object: `{"kind":"json","value":{...}}`
 * for layout/tab state and `{"kind":"string","value":"brio"}` for theme/deck
 * state [D04].
 *
 * Both dev and production modes proxy /api to tugcast on port 55255, so
 * relative URLs work in both environments.
 */

import type { TabStateBag } from "./layout-tree";

const INITIAL_DELAY_MS = 100;
const MAX_DELAY_MS = 2000;

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the deck layout from tugbank with exponential backoff.
 *
 * Retries indefinitely on network errors or 5xx responses. Returns `null`
 * on 404 (no layout stored yet) without retrying — that is the expected
 * state on first launch.
 *
 * Returns the unwrapped layout object, or `null` if no layout is stored.
 */
export async function fetchLayoutWithRetry(): Promise<object | null> {
  const url = "/api/defaults/dev.tugtool.deck.layout/layout";
  let delayMs = INITIAL_DELAY_MS;
  let attempt = 0;

  for (;;) {
    try {
      const response = await fetch(url);
      if (response.status === 404) {
        // No layout stored yet — treat as "no data", not an error.
        return null;
      }
      if (response.ok) {
        const tagged = await response.json();
        if (tagged.kind === "json" && tagged.value !== undefined) {
          return tagged.value as object;
        }
        // Unexpected format — log and return null rather than crashing.
        console.warn("[settings] fetchLayoutWithRetry: unexpected tagged format", tagged);
        return null;
      }
      // 5xx or other non-404 error: log and retry.
      console.debug(
        `[settings] fetchLayout attempt ${attempt + 1} got status ${response.status}, retrying in ${delayMs}ms`
      );
    } catch (err) {
      // Network error (tugcast not yet ready): log and retry.
      console.debug(
        `[settings] fetchLayout attempt ${attempt + 1} failed (${err}), retrying in ${delayMs}ms`
      );
    }

    await sleep(delayMs);
    attempt++;
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
}

/**
 * Fetch the app theme from tugbank with exponential backoff.
 *
 * Retries indefinitely on network errors or 5xx responses. Returns `null`
 * on 404 (no theme stored yet) without retrying.
 *
 * Returns the unwrapped theme string, or `null` if no theme is stored.
 */
export async function fetchThemeWithRetry(): Promise<string | null> {
  const url = "/api/defaults/dev.tugtool.app/theme";
  let delayMs = INITIAL_DELAY_MS;
  let attempt = 0;

  for (;;) {
    try {
      const response = await fetch(url);
      if (response.status === 404) {
        // No theme stored yet — treat as "no data", not an error.
        return null;
      }
      if (response.ok) {
        const tagged = await response.json();
        if (tagged.kind === "string" && typeof tagged.value === "string") {
          return tagged.value;
        }
        // Unexpected format — log and return null rather than crashing.
        console.warn("[settings] fetchThemeWithRetry: unexpected tagged format", tagged);
        return null;
      }
      // 5xx or other non-404 error: log and retry.
      console.debug(
        `[settings] fetchTheme attempt ${attempt + 1} got status ${response.status}, retrying in ${delayMs}ms`
      );
    } catch (err) {
      // Network error (tugcast not yet ready): log and retry.
      console.debug(
        `[settings] fetchTheme attempt ${attempt + 1} failed (${err}), retrying in ${delayMs}ms`
      );
    }

    await sleep(delayMs);
    attempt++;
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
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
 * Fetch the Theme Generator recipe from tugbank.
 * Returns "dark" or "light", or `null` if not stored.
 *
 * Note: the REST endpoint path remains `/api/defaults/dev.tugtool.app/generator-mode`
 * (legacy name) to preserve backward compatibility with previously persisted values.
 */
export async function fetchGeneratorRecipe(): Promise<"dark" | "light" | null> {
  try {
    const response = await fetch("/api/defaults/dev.tugtool.app/generator-mode");
    if (!response.ok) return null;
    const tagged = await response.json();
    const v = tagged?.value;
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
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
 * Fetch all tab state bags from tugbank for the given set of tab IDs.
 *
 * Fetches all tab IDs in parallel via Promise.allSettled. 404 responses are
 * silently skipped (no saved state for that tab — expected on first launch).
 * 5xx / network errors are retried with exponential backoff per tab.
 *
 * Returns a Map<tabId, TabStateBag> of successfully retrieved entries. Tab IDs
 * with no stored state are absent from the map.
 *
 * Spec S02: fetchTabStatesWithRetry
 */
export async function fetchTabStatesWithRetry(tabIds: string[]): Promise<Map<string, TabStateBag>> {
  const results = await Promise.allSettled(
    tabIds.map((tabId) => fetchSingleTabStateWithRetry(tabId))
  );

  const map = new Map<string, TabStateBag>();
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value !== null) {
      map.set(tabIds[i], result.value);
    }
  }
  return map;
}

/**
 * Fetch a single tab state bag from tugbank with exponential backoff.
 * Returns null on 404 (no state stored yet). Retries on 5xx / network errors.
 */
async function fetchSingleTabStateWithRetry(tabId: string): Promise<TabStateBag | null> {
  const url = `/api/defaults/dev.tugtool.deck.tabstate/${encodeURIComponent(tabId)}`;
  let delayMs = INITIAL_DELAY_MS;
  let attempt = 0;

  for (;;) {
    try {
      const response = await fetch(url);
      if (response.status === 404) {
        return null;
      }
      if (response.ok) {
        const tagged = await response.json();
        if (tagged.kind === "json" && tagged.value !== undefined) {
          return tagged.value as TabStateBag;
        }
        console.warn("[settings] fetchSingleTabStateWithRetry: unexpected format for tab", tabId, tagged);
        return null;
      }
      console.debug(
        `[settings] fetchTabState(${tabId}) attempt ${attempt + 1} got status ${response.status}, retrying in ${delayMs}ms`
      );
    } catch (err) {
      console.debug(
        `[settings] fetchTabState(${tabId}) attempt ${attempt + 1} failed (${err}), retrying in ${delayMs}ms`
      );
    }

    await sleep(delayMs);
    attempt++;
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
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
 * Fetch the focused card ID from tugbank with exponential backoff.
 *
 * Reads from `/api/defaults/dev.tugtool.deck.state/focusedCardId`.
 * Returns the string value on success, or null on 404 (no value stored yet).
 * Retries indefinitely on 5xx / network errors.
 *
 * Spec S02: fetchDeckStateWithRetry
 */
export async function fetchDeckStateWithRetry(): Promise<string | null> {
  const url = "/api/defaults/dev.tugtool.deck.state/focusedCardId";
  let delayMs = INITIAL_DELAY_MS;
  let attempt = 0;

  for (;;) {
    try {
      const response = await fetch(url);
      if (response.status === 404) {
        return null;
      }
      if (response.ok) {
        const tagged = await response.json();
        if (tagged.kind === "string" && typeof tagged.value === "string") {
          return tagged.value;
        }
        console.warn("[settings] fetchDeckStateWithRetry: unexpected tagged format", tagged);
        return null;
      }
      console.debug(
        `[settings] fetchDeckState attempt ${attempt + 1} got status ${response.status}, retrying in ${delayMs}ms`
      );
    } catch (err) {
      console.debug(
        `[settings] fetchDeckState attempt ${attempt + 1} failed (${err}), retrying in ${delayMs}ms`
      );
    }

    await sleep(delayMs);
    attempt++;
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
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
