/**
 * Tugbank client singleton — provides the shared TugbankClient instance
 * to modules that cannot import from main.tsx due to circular dependency risks.
 *
 * Parallels connection-singleton.ts. `main.tsx` calls `setTugbankClient()`
 * immediately after constructing the client. All other modules import
 * `getTugbankClient()` from here.
 *
 * @module lib/tugbank-singleton
 */

import type { TugbankClient } from "./tugbank-client";

let _client: TugbankClient | null = null;

/** Set the shared TugbankClient instance. Called once from main.tsx. */
export function setTugbankClient(client: TugbankClient): void {
  _client = client;
}

/**
 * Get the shared TugbankClient instance.
 *
 * Returns null before main.tsx has called setTugbankClient. In practice
 * this is never null when card components mount since main.tsx sets it
 * before any React rendering occurs.
 */
export function getTugbankClient(): TugbankClient | null {
  return _client;
}
