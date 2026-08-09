/**
 * session-created-at.ts — when a session was made, from the two places that
 * know.
 *
 * The date the description line falls back to, and the date the telemetry panel
 * reports. Two sources, in this order:
 *
 *  1. **The session ledger's `created_at`** — the authority. It is present at
 *     zero turns, which is exactly the state a fallback is reporting on. Read
 *     through `useSessionLedgerRow` rather than off the workspace listing: a
 *     just-spawned session is content-empty, the listing deliberately omits it
 *     so nobody is offered an abandoned session to resume into, and the by-id
 *     lookup is what still answers for the card that holds it.
 *  2. **The card's replay-derived anchor** — `sessionCreatedAtMs` on the card's
 *     own session store, which covers the window before the ledger answers. It
 *     is derived from the first turn entry in the JSONL, so it says nothing
 *     about a session that has not taken a turn — which is exactly why rung 1
 *     has to see the detached row.
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
import { useSessionLedgerRow } from "@/lib/session-ledger-store";

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
  const row = useSessionLedgerRow(tugSessionId, projectDir);
  return row?.created_at ?? replayCreatedAtMs;
}
