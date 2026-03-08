/**
 * Settings API client for tugcast.
 *
 * Provides domain-aware fetch and put functions that read/write through the
 * `/api/defaults/` endpoints introduced in Phase 5e3. Layout and theme are
 * stored in separate tugbank domains per [D02]:
 *
 *   Layout  → domain `dev.tugtool.deck.layout`, key `layout`  (Value::Json)
 *   Theme   → domain `dev.tugtool.app`,          key `theme`   (Value::String)
 *
 * The wire format is a tagged-value object: `{"kind":"json","value":{...}}`
 * for layout and `{"kind":"string","value":"brio"}` for theme [D04].
 *
 * Both dev and production modes proxy /api to tugcast on port 55255, so
 * relative URLs work in both environments.
 */

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
