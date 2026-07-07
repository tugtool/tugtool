/**
 * TugCreateDevCard — the app-modal empty-deck affordance. A sibling of
 * {@link TugSetup} at the deck root that opens when a set-up, logged-in
 * user's deck holds no cards — the last card was closed, or the app launched
 * with an empty layout — and offers one Return-press path back to work: a
 * default double-ringed "Create" button that opens a fresh Dev card. The new
 * card becomes first responder and presents the Choose Session sheet on
 * mount.
 *
 * Drives a dedicated {@link TugAlert} instance (not the provider singleton,
 * so a logout confirm can never clobber its pending promise) from the derived
 * open state: an effect opens the alert when {@link deriveCreateDevCardOpen}
 * says so, Create resolves into `deck.addCard("dev")`, and Cancel (or Escape
 * / Cmd-.) dismisses so the user can work with an empty deck — the offer
 * re-arms after the deck next holds a card, and on every launch. If a card
 * lands by any other means while the alert is up (Cmd-N, a restored
 * layout), the alert auto-dismisses: the offer's premise is gone.
 *
 * Last in the app-modal precedence chain (Spec S02): gate > setup >
 * create-dev-card. During a genuine first run the setup wizard owns the empty
 * deck (its "Start a Claude Code session" step) until the first card has
 * existed; see {@link deriveCreateDevCardOpen}. Suppressed under the same
 * app-test flag as TugSetup so focus/selection-driven tests that empty the
 * deck never race a modal. Deliberately not gated on transport — the
 * app-wide reconnect banner owns that. Store reads per [L02].
 */

import {
  type ReactElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAuth } from "@/lib/auth-store";
import {
  useVersionGateOpen,
  deriveCreateDevCardOpen,
} from "@/lib/macos-support";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { readSetupSeen, readSetupSuppressed } from "@/settings-api";
import { useDeckManager } from "@/deck-manager-context";
import { TugAlert, type TugAlertHandle } from "./tug-alert";

export function TugCreateDevCard(): ReactElement {
  const { loggedIn } = useAuth();
  const deck = useDeckManager();
  const deckState = useSyncExternalStore(deck.subscribe, deck.getSnapshot);
  const cardCount = deckState.cards.length;

  // Read once at mount, exactly like TugSetup (tugbank is ready before React
  // mounts): the persisted first-run flag and the app-test suppression flag.
  const [firstRun] = useState(() => {
    const client = getTugbankClient();
    return client ? !readSetupSeen(client) : false;
  });
  const [suppressed] = useState(() => {
    const client = getTugbankClient();
    return client ? readSetupSuppressed(client) : false;
  });

  // Whether the deck has held a card at any point this app-run. On a first
  // run this is what hands the empty deck from the setup wizard to this
  // alert: the wizard's CTA opens the first card, and from then on an empty
  // deck lands here.
  const everHadCardRef = useRef(false);
  if (cardCount > 0) everHadCardRef.current = true;

  const gateOpen = useVersionGateOpen();
  const wantOpen = deriveCreateDevCardOpen({
    gateOpen,
    suppressed,
    loggedIn,
    cardCount,
    firstRun,
    deckEverHadCard: everHadCardRef.current,
  });

  // Cancelled: the user chose to stay on the empty deck. Cleared once the
  // deck holds a card again, so the next empty deck re-offers.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (cardCount > 0 && dismissed) setDismissed(false);
  }, [cardCount, dismissed]);

  const alertRef = useRef<TugAlertHandle>(null);
  const pendingRef = useRef(false);

  // A card landed while the alert was up (Cmd-N, a restored layout, any
  // path that isn't this alert's Create button): the offer's premise is
  // gone, so drop the modal state instead of stranding the user in it.
  // dismiss() resolves the pending promise false; the dismissed flag it
  // sets is immediately cleared by the effect above because cardCount > 0.
  useEffect(() => {
    if (cardCount > 0 && pendingRef.current) {
      alertRef.current?.dismiss();
    }
  }, [cardCount]);

  useEffect(() => {
    if (!wantOpen || dismissed || pendingRef.current) return;
    const handle = alertRef.current;
    if (handle === null) return;
    pendingRef.current = true;
    void handle
      .alert({
        title: "Create Dev Card",
        message: "Start a new development session",
        confirmLabel: "Create",
        cancelLabel: "Cancel",
        icon: "MessageSquareText",
      })
      .then((confirmed) => {
        pendingRef.current = false;
        if (confirmed) {
          deck.addCard("dev");
        } else {
          setDismissed(true);
        }
      });
  }, [wantOpen, dismissed, deck]);

  return <TugAlert ref={alertRef} title="Create Dev Card" />;
}
