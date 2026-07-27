/**
 * TugSetupRequest — the gate in front of the on-demand setup wizard. Mounted
 * once as a deck-root sibling of TugSetup (under `TugAlertProvider`); renders
 * nothing. It watches the setup-request nonce ({@link useSetupRequest}) and
 * decides whether the wizard may open:
 *
 *   nothing running                 → open the wizard
 *   turns in flight → confirm       → interrupt every turn → open the wizard
 *                   → cancel        → nothing happens
 *
 * The wizard is app-modal and its steps re-run install / log-in / model
 * acquisition, so it must not come up over live work. That makes this the same
 * shape as {@link TugLogout} — an app-level orchestrator that stops turns
 * before an app-level state change — and it shares TugLogout's interrupt loop
 * and the TugAlert singleton ([L02]/[L06]).
 *
 * @module components/tugways/tug-setup-request
 */

import { useEffect, useRef } from "react";

import { useSetupRequest, openSetupOnDemand } from "@/lib/setup-request-store";
import { cardServicesStore } from "@/lib/card-services-store";
import { useDeckManager } from "@/deck-manager-context";
import { useTugAlert } from "./tug-alert";

export function TugSetupRequest(): null {
  const nonce = useSetupRequest();
  const deck = useDeckManager();
  const showAlert = useTugAlert();
  const handledRef = useRef(0);

  useEffect(() => {
    if (nonce === 0 || nonce === handledRef.current) return;
    handledRef.current = nonce;

    // Which sessions are mid-turn right now. Same read as the logout path:
    // `canInterrupt` is the store's own answer to "is there a turn to stop".
    const running: Array<{ interrupt: () => void }> = [];
    for (const card of deck.getSnapshot().cards) {
      const services = cardServicesStore.getServices(card.id);
      if (services?.codeSessionStore.getSnapshot().canInterrupt) {
        running.push({
          interrupt: () => services.codeSessionStore.interrupt("setup"),
        });
      }
    }

    if (running.length === 0) {
      openSetupOnDemand();
      return;
    }

    let cancelled = false;
    void (async () => {
      const plural = running.length === 1 ? "session is" : "sessions are";
      const confirmed = await showAlert({
        title: "Stop Work and Open Setup?",
        message: `${running.length} ${plural} still working. Setup takes over the whole app, so those turns will stop.`,
        confirmLabel: "Stop and Open Setup",
        cancelLabel: "Cancel",
        confirmRole: "danger",
      });
      if (cancelled || !confirmed) return;
      // Stop the turns before the wizard covers them, so nothing is left
      // running behind a modal the user can't see past. Guarded: a card whose
      // session went away between the count and the confirm must not strand
      // the wizard.
      for (const session of running) {
        try {
          session.interrupt();
        } catch {
          // Session already gone — setup proceeds.
        }
      }
      openSetupOnDemand();
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce, showAlert, deck]);

  return null;
}
