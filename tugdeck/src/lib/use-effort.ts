/**
 * use-effort.ts — the dev-card's reasoning-effort set path plus its per-card
 * persistence and mount-restore, factored out of `dev-card.tsx` (mirroring
 * [use-permission-mode.ts]).
 *
 * The chip ([effort-chip.tsx]) only *displays* the level; the behavior —
 * sending the IPC, persisting per card, and restoring on relaunch — lives here
 * so the picker and a future `/effort` command both funnel through one
 * `setEffort`.
 *
 * Unlike model / permission mode, effort has **no live control verb** in
 * claude 2.1.158: tugcode applies it by respawning claude with `--effort` +
 * `--resume` ([R07]). So `setEffort` reflects the level optimistically
 * (`applyEffort` — the respawn emits no fresh metadata for a resumed session),
 * persists it, and sends the `effort_change` frame.
 *
 * **Restore gate.** A fresh session's authoritative effort is `null` (no
 * override), so — unlike permission mode, whose live value becomes the
 * non-null `default` — we cannot gate the restore on "live value known".
 * Instead the restore waits for the capability `models[]` to land (the
 * readiness signal that a NEW-mode session is up and effort support is known),
 * then re-applies a persisted level only when the active model supports it and
 * the persisted level differs from the live one. A resumed session carries no
 * capabilities, so the gate stays shut — no respawn, no surprise.
 *
 * Persistence mirrors `use-permission-mode.ts`: an optimistic `setLocalValue`
 * so `useTugbankValue` readers reflect instantly, plus a PUT to
 * `/api/defaults/dev.effort/<cardId>` ([D07], `feedback_no_localstorage`).
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
  EFFORT_DOMAIN,
  parsePersistedEffort,
  resolveEffortSupport,
} from "@/lib/effort";

/**
 * Persist a card's effort level: optimistic local-cache write (so
 * `useTugbankValue` readers re-render instantly) plus an HTTP PUT to the
 * defaults endpoint. PUT failure logs and otherwise vanishes — the cache holds
 * for the session and a fresh load falls back to no override.
 */
export function writePersistedEffort(cardId: string, effort: string): void {
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(EFFORT_DOMAIN, cardId, { kind: "string", value: effort });
  }
  const url = `/api/defaults/${EFFORT_DOMAIN}/${encodeURIComponent(cardId)}`;
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value: effort }),
  }).catch((err) => {
    console.warn(`[effort] PUT failed for card ${cardId}:`, err);
  });
}

export interface UseEffortOptions {
  /** The card whose effort is set / persisted / restored. */
  cardId: string;
  /** Store that sends the `effort_change` frame. */
  codeSessionStore: CodeSessionStore;
  /** Store supplying the live effort + capability the restore aligns to. */
  sessionMetadataStore: SessionMetadataStore;
}

export interface UseEffortResult {
  /** Set the effort to an explicit level (the picker / `/effort` path). */
  setEffort: (effort: string) => void;
}

export function useEffort({
  cardId,
  codeSessionStore,
  sessionMetadataStore,
}: UseEffortOptions): UseEffortResult {
  const snapshot = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    sessionMetadataStore.getSnapshot,
  );

  const persistedEffort = useTugbankValue<string | null>(
    EFFORT_DOMAIN,
    cardId,
    parsePersistedEffort,
    null,
  );

  // Pre-armed by a manual `setEffort` so the mount-restore effect below never
  // overrides a change the user just made.
  const sentRef = useRef(false);

  // Set the effort to an explicit level: reflect it optimistically on the chip
  // (the respawn-to-apply emits no metadata for a resumed session), persist it
  // per card, and send the `effort_change` frame to tugcode → respawn. The
  // single path the picker and the mount-restore both funnel through.
  const setEffort = useCallback(
    (effort: string) => {
      sentRef.current = true;
      sessionMetadataStore.applyEffort(effort);
      writePersistedEffort(cardId, effort);
      codeSessionStore.setEffort(effort);
    },
    [cardId, codeSessionStore, sessionMetadataStore],
  );

  // Mount-restore ([D07]). Once the NEW-mode capabilities land (the `models[]`
  // readiness signal) and a persisted level has loaded, re-apply it if the
  // active model supports it and it differs from the live level. Fires at most
  // once per mount (`sentRef`). A resumed session has no capabilities, so this
  // never fires for it (no respawn). A manual change pre-arms `sentRef`.
  const liveEffort = snapshot.effort;
  const { models, model } = snapshot;
  useEffect(() => {
    if (sentRef.current) return;
    if (persistedEffort === null) return;
    // Readiness: capabilities present ⇒ a new-mode session is up and effort
    // support is known. Without them we cannot tell support nor avoid racing.
    if (models.length === 0) return;
    const support = resolveEffortSupport(models, model);
    if (
      !support.supported ||
      !(support.levels as string[]).includes(persistedEffort)
    ) {
      // Persisted level doesn't apply to this model — leave it, don't respawn.
      sentRef.current = true;
      return;
    }
    if (persistedEffort !== liveEffort) {
      setEffort(persistedEffort);
    } else {
      sentRef.current = true;
    }
  }, [persistedEffort, models, model, liveEffort, setEffort]);

  return { setEffort };
}
