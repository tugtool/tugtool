/**
 * Per-card persistence helpers for `<DiffBlock>`'s view-mode
 * preference (inline ↔ side-by-side).
 *
 * Wraps the shared `tugbank-client` singleton. Reads are synchronous
 * from the cache (the DEFAULTS frame populates it before any UI
 * mounts). Writes are fire-and-forget HTTP PUTs.
 *
 * Tugbank coordinates:
 *  - domain: `dev.tugtool.tide.diff-view` (matches the
 *    `dev.tugtool.<area>` naming used by sibling preferences in
 *    `settings-api.ts`).
 *  - key:    `<cardId>` (per-card; same scoping convention as
 *    `dev.tugtool.deck.cardstate/<cardId>`).
 *  - value:  `{ kind: "string", value: "inline" | "side-by-side" }`.
 *
 * @module lib/diff/diff-view-pref
 */

import { getTugbankClient } from "@/lib/tugbank-singleton";

export type DiffViewMode = "inline" | "side-by-side";

/** Tugbank domain that holds per-card diff-view preferences. */
export const DIFF_VIEW_DOMAIN = "dev.tugtool.tide.diff-view";

/**
 * Read the saved diff-view mode for `cardId`, or `null` if no
 * preference is set. Synchronous: the tugbank cache is populated
 * before the first render, so this is safe to call from a render
 * `useState` initializer.
 *
 * Returns `null` when:
 *  - The tugbank singleton hasn't been wired (test environments).
 *  - No entry exists for this card.
 *  - The stored value isn't a valid `DiffViewMode` string.
 */
export function readDiffViewMode(cardId: string): DiffViewMode | null {
  const client = getTugbankClient();
  if (client === null) return null;
  const raw = client.getValue(DIFF_VIEW_DOMAIN, cardId);
  if (raw === "inline" || raw === "side-by-side") return raw;
  return null;
}

/**
 * Persist `mode` for `cardId`. Fire-and-forget HTTP PUT — failures
 * log a warning and otherwise vanish (the next session simply falls
 * back to the default).
 *
 * Exposed as a function (not a method on a class) so tests can mock
 * it via the standard import-replacement pattern used elsewhere.
 */
export function writeDiffViewMode(cardId: string, mode: DiffViewMode): void {
  const url = `/api/defaults/${DIFF_VIEW_DOMAIN}/${encodeURIComponent(cardId)}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: mode }),
  }).catch((err) => {
    console.warn(
      `[diff-view-pref] PUT failed for card ${cardId}:`,
      err,
    );
  });
}
