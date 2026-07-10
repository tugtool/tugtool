/**
 * Persistence helper for {@link TugPinnedPanel}'s horizontal drag position.
 *
 * A pinned panel is draggable **horizontally only**; the committed position is
 * stored as a **fraction of the available horizontal travel** (`0` = flush
 * left, `1` = flush right) rather than raw pixels, so it survives a pane
 * resize — a narrow pane and a wide pane both re-derive a sensible left offset
 * from the same fraction, clamped back into view on load.
 *
 * Reads go through `useSyncExternalStore` per [L02] — the tugbank cache is the
 * source of truth, the component subscribes for updates, and the drag-end
 * handler writes optimistically through `setLocalValue` so the position sticks
 * without waiting for the server's DEFAULTS round-trip. The PUT to
 * `/api/defaults/...` runs fire-and-forget (with `keepalive`, so a reload
 * fired immediately after a drag still lands the value).
 *
 * Tugbank coordinates:
 *  - domain: `dev.tugtool.tugways.pinned-panel` (matches the
 *    `dev.tugtool.tugways.*` family used by `split-pane`).
 *  - key:    a caller-supplied `persistKey` (e.g. `btw:<cardId>` — per-card,
 *    same scoping convention as `dev.tugtool.dev.diff-view/<cardId>`).
 *  - value:  `{ kind: "f64", value: 0..1 }`.
 *
 * @module components/tugways/tug-pinned-panel-pref
 */

import React from "react";

import { getTugbankClient } from "@/lib/tugbank-singleton";
import { tugDevLogStore } from "@/lib/tug-dev-log-store/tug-dev-log-store";

/** Tugbank domain that holds pinned-panel horizontal offsets. */
export const PINNED_PANEL_DOMAIN = "dev.tugtool.tugways.pinned-panel";

/** Clamp a fraction into the closed unit interval. */
export function clampOffsetFraction(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Subscribe to tugbank changes for the pinned-panel domain. Fires whenever any
 * key in the domain updates (including the optimistic `setLocalValue` write).
 * Returns a no-op unsubscriber when the tugbank singleton isn't wired.
 */
function subscribePinnedPanelDomain(onChange: () => void): () => void {
  const client = getTugbankClient();
  if (client === null) return () => {};
  return client.onDomainChanged((domain) => {
    if (domain === PINNED_PANEL_DOMAIN) onChange();
  });
}

/**
 * Read the saved offset fraction for `persistKey` from the tugbank cache, or
 * `null` if none is set / the singleton isn't wired / the stored value isn't a
 * finite number. Synchronous — safe from a `useSyncExternalStore` snapshot.
 */
function getPinnedPanelOffset(persistKey: string): number | null {
  const client = getTugbankClient();
  if (client === null) return null;
  const raw = client.getValue(PINNED_PANEL_DOMAIN, persistKey);
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return clampOffsetFraction(raw);
  }
  return null;
}

/**
 * `useSyncExternalStore`-based hook returning the persisted horizontal offset
 * fraction for `persistKey`, or `null` when none is set (the panel then falls
 * back to its default right alignment). Per [L02] this is the only sanctioned
 * path for the tugbank value to enter React.
 */
export function usePinnedPanelOffset(persistKey: string | undefined): number | null {
  const getSnapshot = React.useCallback((): number | null => {
    if (persistKey === undefined) return null;
    return getPinnedPanelOffset(persistKey);
  }, [persistKey]);

  return React.useSyncExternalStore(subscribePinnedPanelDomain, getSnapshot);
}

/**
 * Persist `fraction` (clamped to `0..1`) for `persistKey`. Optimistically
 * updates the local tugbank cache, then PUTs to the server fire-and-forget
 * (with `keepalive` so a reload right after the drag still lands the value).
 */
export function writePinnedPanelOffset(persistKey: string, fraction: number): void {
  const value = clampOffsetFraction(fraction);
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(PINNED_PANEL_DOMAIN, persistKey, { kind: "f64", value });
  }

  const url = `/api/defaults/${PINNED_PANEL_DOMAIN}/${encodeURIComponent(persistKey)}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "f64", value }),
    keepalive: true,
  }).catch((err) => {
    tugDevLogStore.warn(
      "pinned-panel",
      `offset PUT failed for ${persistKey}: ${String(err)}`,
    );
  });
}
