/**
 * flash-pane-border.ts — the "here it is" flash ([P04]).
 *
 * One-shot pulse of a pane's BORDER: a CSS class toggled on the pane root,
 * which pulses an accent ring (box-shadow) and removes it on `animationend` —
 * pure appearance, never React state ([L06]). A mid-flash re-request restarts
 * the animation (remove → reflow → add).
 *
 * Every gesture that answers a reader by putting a card in front of them uses
 * it: the slot chords and `focus-session-card` raising a card that already
 * exists, and {@link flashCardPane} for a card that has just been made — a
 * file opened from a link, a session resumed from an atom. A card arriving
 * somewhere on the deck is a change the eye has to find; the ring says where
 * to look.
 *
 * @module lib/flash-pane-border
 */

import type { IDeckManagerStore } from "@/deck-manager-store";

const FLASH_CLASS = "tug-pane-flash";
const FLASH_ANIMATION_NAME = "tug-pane-border-flash";
/** `tug-pane-border-flash`'s duration in `tug-pane.css`, plus slack. */
const FLASH_BACKSTOP_MS = 1600;

/**
 * Flash the pane with this id.
 *
 * A pane the DOM does not hold yet gets one deferred retry: `assign-slot` can
 * pull a card out of a tab group into a pane that exists in the store but not
 * on screen until React commits, and the flash belongs on the pane the card
 * ends up in. The retry does not retry again — a second miss is a pane that
 * never rendered, not one still on its way.
 */
export function flashPaneBorder(paneId: string, allowRetry = true): void {
  if (typeof document === "undefined") return;
  const paneEl = document.querySelector(
    `.tug-pane[data-pane-id="${CSS.escape(paneId)}"]`,
  );
  if (!(paneEl instanceof HTMLElement)) {
    if (allowRetry) window.setTimeout(() => flashPaneBorder(paneId, false), 0);
    return;
  }
  paneEl.classList.remove(FLASH_CLASS);
  // Force a reflow so re-adding the class restarts the keyframes.
  void paneEl.offsetWidth;
  paneEl.classList.add(FLASH_CLASS);
  const clear = (): void => {
    paneEl.classList.remove(FLASH_CLASS);
    paneEl.removeEventListener("animationend", onEnd);
    window.clearTimeout(backstop);
  };
  // `animationend` bubbles, so the listener must name the flash's own
  // keyframes: any animation finishing anywhere inside the card — a streaming
  // transcript, a spinner — would otherwise cut the flash short.
  const onEnd = (event: AnimationEvent): void => {
    if (event.animationName !== FLASH_ANIMATION_NAME) return;
    clear();
  };
  paneEl.addEventListener("animationend", onEnd);
  // A window whose rendering is suspended never ticks the keyframes, so
  // `animationend` never arrives and the ring would rest on the pane forever.
  // The timer is the only thing that guarantees the flash is one-shot.
  const backstop = window.setTimeout(clear, FLASH_BACKSTOP_MS);
}

/**
 * Flash whichever pane holds `cardId` — what an opener has in hand, since the
 * card is what it made and the pane is the store's business.
 *
 * Called on the frame the card is added, when the pane it lands in is in the
 * store but not yet in the DOM; {@link flashPaneBorder}'s deferred retry is
 * what catches it after React commits. A card that reaches no pane at all is
 * silence, not a warning: nothing appeared, so nothing flashes.
 */
export function flashCardPane(store: IDeckManagerStore, cardId: string): void {
  const pane = store.getSnapshot().panes.find((p) => p.cardIds.includes(cardId));
  if (pane !== undefined) flashPaneBorder(pane.id);
}
