/**
 * TugCreateDevCard — the app-modal empty-deck affordance. A sibling of
 * {@link TugSetup} at the deck root that opens when a set-up, logged-in
 * user's deck holds no cards — the last card was closed, or the app launched
 * with an empty layout — and offers a "What's next?" chooser with two paths
 * back to work: a default double-ringed "Create Dev Card" button that opens a
 * fresh Dev card (which becomes first responder and presents the Choose
 * Session sheet on mount), and an "Open Text File" button that runs the
 * native Open panel and opens the chosen file in a File card.
 *
 * Drives a dedicated {@link TugAlert} instance (not the provider singleton,
 * so a logout confirm can never clobber its pending promise) from the derived
 * open state: an effect opens the chooser when {@link deriveCreateDevCardOpen}
 * says so. "Create Dev Card" resolves into `deck.addCard("dev")`; "Open Text
 * File" runs `pickPath("file")` then `openFileInCard` (a cancelled panel
 * leaves the deck empty so the chooser re-arms); Cancel (or Escape / Cmd-.)
 * dismisses so the user can work with an empty deck — the offer re-arms after
 * the deck next holds a card, and on every launch. If a card lands by any
 * other means while the alert is up (Cmd-N, a restored layout), the alert
 * auto-dismisses: the offer's premise is gone.
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
import { isPathPickerAvailable, pickPath } from "@/lib/native-path-picker";
import { openFileInCard } from "@/lib/open-file-in-card";
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

  // Bumped to re-arm the chooser after a flow that ends with the deck still
  // empty and no other state change to re-run the open effect — namely
  // cancelling the native Open panel. A ref reset alone can't re-trigger the
  // effect; this state can.
  const [reopenNonce, setReopenNonce] = useState(0);

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
      .choose({
        title: "What's next?",
        icon: "Compass",
        cancelLabel: "Cancel",
        // Rows render top-to-bottom in this order; keep any copy that names
        // them in the same order.
        choices: [
          {
            id: "dev",
            label: "Create Dev Card",
            description: "Start a new development session.",
            icon: "MessageSquareText",
            isDefault: true,
          },
          {
            id: "file",
            label: "Open Text File",
            description: "Open an existing file to edit.",
            icon: "FileText",
          },
        ],
      })
      .then(async (choice) => {
        if (choice === "dev") {
          pendingRef.current = false;
          deck.addCard("dev");
          return;
        }
        if (choice === "file") {
          // Hold pendingRef across the native Open panel so the offer never
          // re-opens behind it.
          let openedPath: string | null = null;
          try {
            openedPath = isPathPickerAvailable() ? await pickPath("file") : null;
            if (openedPath !== null) openFileInCard(deck, openedPath);
          } finally {
            pendingRef.current = false;
            // A chosen path opened a File card (deck non-empty → the offer
            // closes on its own). A cancelled panel changed nothing, so
            // re-arm the chooser explicitly — otherwise the user is stranded
            // on an empty deck with no sheet.
            if (openedPath === null) setReopenNonce((n) => n + 1);
          }
          return;
        }
        // null: Cancel / Escape — stay on the empty deck.
        pendingRef.current = false;
        setDismissed(true);
      });
  }, [wantOpen, dismissed, deck, reopenNonce]);

  return <TugAlert ref={alertRef} title="What's next?" />;
}
