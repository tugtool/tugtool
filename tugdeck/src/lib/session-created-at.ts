/**
 * session-created-at.ts — when a session was made, from the two places that
 * know.
 *
 * The date the description line falls back to, and the date the telemetry panel
 * reports. Two sources, in this order:
 *
 *  1. **The session ledger's `created_at`** — the authority. It is present at
 *     zero turns, which is exactly the state a fallback is reporting on.
 *  2. **The card's replay-derived anchor** — `sessionCreatedAtMs` on the card's
 *     own session store, which covers the window before the ledger answers. That
 *     window is not a formality: the ledger store drops a `session_updated` push
 *     for a workspace it has not listed yet, so a freshly-bound card in an
 *     unlisted project has no row at all until something opens the picker.
 *
 * Null until one of them answers. Shared rather than re-derived per surface,
 * because a masthead and a Lens row dating the same session differently is the
 * failure one resolver exists to prevent ([D123]).
 *
 * Laws: [L02] both reads enter through `useSyncExternalStore`.
 *
 * @module lib/session-created-at
 */

import { useSyncExternalStore } from "react";

import { cardServicesStore } from "@/lib/card-services-store";
import { useSessionLedger } from "@/lib/session-ledger-store";

/** Stable no-op subscribe for a card whose services aren't constructed yet. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/** When the session bound to `cardId` was made, in ms, or null. */
export function useSessionCreatedAtMs(
  cardId: string | undefined,
  tugSessionId: string,
  projectDir: string,
): number | null {
  const services = useSyncExternalStore(cardServicesStore.subscribe, () =>
    cardId === undefined ? null : cardServicesStore.getServices(cardId),
  );
  const store = services?.codeSessionStore ?? null;
  const replayCreatedAtMs = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store !== null ? () => store.getSnapshot().sessionCreatedAtMs : () => null,
    () => null,
  );
  const ledger = useSessionLedger(projectDir);
  const ledgerCreatedAtMs =
    ledger.rows.find((r) => r.session_id === tugSessionId)?.created_at ?? null;
  return ledgerCreatedAtMs ?? replayCreatedAtMs;
}
