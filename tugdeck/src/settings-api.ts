/**
 * Settings API client for tugcast.
 *
 * Provides `fetchSettingsWithRetry` for loading deck settings on startup
 * and `postSettings` for persisting layout/theme changes.
 *
 * Both dev and production modes proxy /api to tugcast on port 55255, so
 * relative URLs work in both environments.
 */

/** Deck settings stored and served by tugcast's /api/settings endpoint. */
export interface ServerSettings {
  /** v5 layout JSON; null signals deletion (null-as-delete per [D09]). */
  layout?: object | null;
  /** Theme name: "brio" | "bluenote" | "harmony"; null signals deletion. */
  theme?: string | null;
}

/**
 * Fetch settings from the API with exponential backoff.
 *
 * Retries indefinitely until the server responds with a successful JSON
 * response. Backoff starts at ~100ms, doubles each retry, caps at ~2s.
 * Each retry is logged to console.debug.
 *
 * No localStorage fallback: falling back would reproduce the
 * origin-scoping bug this feature exists to fix (see [D03]).
 */
export async function fetchSettingsWithRetry(
  url: string
): Promise<ServerSettings> {
  const INITIAL_DELAY_MS = 100;
  const MAX_DELAY_MS = 2000;

  let delayMs = INITIAL_DELAY_MS;
  let attempt = 0;

  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data: ServerSettings = await response.json();
        return data;
      }
      // Non-2xx response: log and retry
      console.debug(
        `[settings] fetch attempt ${attempt + 1} got status ${response.status}, retrying in ${delayMs}ms`
      );
    } catch (err) {
      // Network error (tugcast not yet ready): log and retry
      console.debug(
        `[settings] fetch attempt ${attempt + 1} failed (${err}), retrying in ${delayMs}ms`
      );
    }

    await sleep(delayMs);
    attempt++;
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
}

/**
 * POST settings to the API (fire-and-forget).
 *
 * Uses partial/null-as-delete semantics per [D09]:
 * - Absent fields preserve existing server-side values.
 * - Fields set to null delete the corresponding stored field.
 *
 * Errors are logged to console.warn and otherwise ignored — save failures
 * are non-fatal since localStorage still holds a local cache.
 */
export function postSettings(settings: Partial<ServerSettings>): void {
  fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }).catch((err) => {
    console.warn("[settings] POST /api/settings failed:", err);
  });
}

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
