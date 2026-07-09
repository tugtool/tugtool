/**
 * card-close-guard.ts — a per-card veto over close gestures.
 *
 * A card whose body holds unsaved in-memory state (the manual-mode File
 * card) registers a guard the pane chrome consults before a close gesture
 * destroys the card. `needsDecision()` reports synchronously whether the
 * card would prompt — the pane uses it to ACTIVATE the card first, so the
 * user sees what they are deciding about. `run()` presents whatever sheet
 * the card needs (Save / Don't Save / Cancel) and resolves `"close"` to
 * proceed or `"cancel"` to abort.
 *
 * Background tabs stay mounted (CardHost hides them with `display: none`),
 * so every hosted card's guard is live — a whole-pane close must consult
 * ALL of them, visiting each dirty card in turn, never just the active one.
 *
 * Registration returns its own release ([L27]); the card releases on
 * unmount.
 *
 * @module lib/card-close-guard
 */

/** Presents the card's close decision; `"close"` proceeds, `"cancel"` aborts. */
export type CardCloseDecision = () => Promise<"close" | "cancel">;

/** A registered close guard: a dirty probe plus the decision runner. */
export interface CardCloseGuard {
  /**
   * True when `run()` would prompt (the card holds unsaved state). The
   * pane activates the card before prompting so the decision is made
   * looking at the content it concerns.
   */
  needsDecision(): boolean;
  run: CardCloseDecision;
}

const guards = new Map<string, CardCloseGuard>();

/**
 * Register `guard` for `cardId`. Returns a release that removes it — call
 * on unmount ([L27]). A re-registration replaces the prior guard.
 */
export function registerCardCloseGuard(
  cardId: string,
  guard: CardCloseGuard,
): () => void {
  guards.set(cardId, guard);
  return () => {
    // Only remove if it is still ours — a later registration for the same
    // card id owns the slot now.
    if (guards.get(cardId) === guard) guards.delete(cardId);
  };
}

/** The close guard for `cardId`, or null when the card registered none. */
export function getCardCloseGuard(cardId: string): CardCloseGuard | null {
  return guards.get(cardId) ?? null;
}
