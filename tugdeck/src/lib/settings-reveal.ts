/**
 * settings-reveal.ts — ask the Settings card to show a particular section.
 *
 * One caller today: the "Saved Model Unavailable" bulletin, whose "Review
 * Defaults" lands the reader on the Assistant controls in the Session Card
 * section. That section may be collapsed, so opening Settings is not enough —
 * the request has to survive the gap between the dispatch that opens the card
 * and the card's mount. A request made with no card attached is parked and
 * flushed the moment one registers.
 *
 * **A reveal never writes the persisted collapsed set.** The card holds the
 * revealed id in a transient override instead, so a reader who deliberately
 * collapsed Session Card finds it collapsed again on their next plain open. A
 * reveal that rewrote the stored preference would be the app editing a saved
 * choice with nothing to put it back.
 *
 * @module lib/settings-reveal
 */

import type { SettingsSectionId } from "./settings-sections-pref";

type RevealConsumer = (section: SettingsSectionId) => void;

/** The mounted Settings card, or null when none is attached. */
let consumer: RevealConsumer | null = null;

/** A request made before a card was attached, awaiting one. */
let pendingSection: SettingsSectionId | null = null;

/**
 * Show `section` in the Settings card: delivered now if a card is mounted,
 * parked for the next mount otherwise. Only the most recent request is kept —
 * a reveal is about where the reader is being sent, and that is one place.
 */
export function requestSettingsReveal(section: SettingsSectionId): void {
  if (consumer !== null) {
    consumer(section);
    return;
  }
  pendingSection = section;
}

/**
 * Register the mounted Settings card's handler; returns its unregister
 * ([L27]). Any parked request is flushed into the new consumer, which is what
 * makes "dispatch SHOW_SETTINGS, then request a reveal" work in either order.
 */
export function registerSettingsRevealConsumer(fn: RevealConsumer): () => void {
  consumer = fn;
  if (pendingSection !== null) {
    const section = pendingSection;
    pendingSection = null;
    fn(section);
  }
  return () => {
    if (consumer === fn) consumer = null;
  };
}
