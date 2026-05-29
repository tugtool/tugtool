/**
 * use-permission-mode.ts — the dev-card's permission-mode `Shift+Tab` cycle
 * plus its per-card persistence and mount-restore, factored out of
 * `dev-card.tsx`.
 *
 * The chip itself ([permission-mode-chip.tsx]) only *displays* the mode; the
 * behavior — advancing the cycle, sending the IPC, persisting per card, and
 * restoring on relaunch — lives here so the dev card's card-content responder
 * can register a single `cycle` handler.
 *
 * Mutations round-trip per [D03]: `cycle()` sends a `permission_mode` frame
 * (via `CodeSessionStore.setPermissionMode`) and the chip reflects the new
 * mode from the post-mutation `system_metadata` (owned by
 * `SessionMetadataStore`), not from the keypress.
 *
 * Persistence mirrors `diff-view-pref.ts`: an optimistic `setLocalValue` so
 * `useSyncExternalStore` readers reflect instantly, plus a PUT to
 * `/api/defaults/dev.permission-mode/<cardId>` ([D07], `feedback_no_localstorage`).
 *
 * Laws: [L02] store subscription, [L07] handler reads current state through
 *       the store (no stale render closure)
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import {
  PERMISSION_MODE_DOMAIN,
  cyclePermissionMode,
  parsePersistedPermissionMode,
} from "@/lib/permission-mode";

/**
 * Persist a card's permission mode: optimistic local-cache write (so
 * `useTugbankValue` readers re-render instantly) plus an HTTP PUT to the
 * defaults endpoint. PUT failure logs and otherwise vanishes — the cache
 * holds for the session and a fresh load falls back to the default.
 */
export function writePersistedPermissionMode(cardId: string, mode: string): void {
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(PERMISSION_MODE_DOMAIN, cardId, {
      kind: "string",
      value: mode,
    });
  }
  const url = `/api/defaults/${PERMISSION_MODE_DOMAIN}/${encodeURIComponent(cardId)}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: mode }),
  }).catch((err) => {
    console.warn(`[permission-mode] PUT failed for card ${cardId}:`, err);
  });
}

export interface UsePermissionModeOptions {
  /** The card whose mode is cycled / persisted / restored. */
  cardId: string;
  /** Store that sends the `permission_mode` frame. */
  codeSessionStore: CodeSessionStore;
  /** Store supplying the live mode the cycle reads and the restore aligns. */
  sessionMetadataStore: SessionMetadataStore;
}

export interface UsePermissionModeResult {
  /** Advance the mode one `Shift+Tab` step (default → acceptEdits → plan → auto → …). */
  cycle: () => void;
}

export function usePermissionMode({
  cardId,
  codeSessionStore,
  sessionMetadataStore,
}: UsePermissionModeOptions): UsePermissionModeResult {
  const liveMode = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    useCallback(
      () => sessionMetadataStore.getSnapshot().permissionMode,
      [sessionMetadataStore],
    ),
  );

  const persistedMode = useTugbankValue<string | null>(
    PERMISSION_MODE_DOMAIN,
    cardId,
    parsePersistedPermissionMode,
    null,
  );

  // Mount-restore ([D07]). Once the session reports its initial mode, align
  // it to the per-card persisted mode if they differ — so a relaunched card
  // comes back in the mode it was left in. Fires at most once per mount
  // (`sentRef`), and only after BOTH the live mode is known AND a persisted
  // value has loaded, so it neither races the session's first metadata frame
  // nor fires for a card that has nothing persisted. A manual cycle below
  // pre-arms `sentRef`, superseding any pending restore.
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    if (liveMode === null) return;
    if (persistedMode === null) return;
    sentRef.current = true;
    if (persistedMode !== liveMode) {
      codeSessionStore.setPermissionMode(persistedMode);
    }
  }, [liveMode, persistedMode, codeSessionStore]);

  const cycle = useCallback(() => {
    // A manual cycle supersedes any not-yet-fired mount restore.
    sentRef.current = true;
    // Read the current mode fresh from the store rather than a render-time
    // closure so the handler registered once on the responder is never
    // stale [L07].
    const current = sessionMetadataStore.getSnapshot().permissionMode;
    const next = cyclePermissionMode(current);
    codeSessionStore.setPermissionMode(next);
    writePersistedPermissionMode(cardId, next);
  }, [cardId, codeSessionStore, sessionMetadataStore]);

  return { cycle };
}
