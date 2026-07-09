/**
 * card-close-guard.ts — a per-card veto over close gestures.
 *
 * A card whose body holds unsaved in-memory state (the manual-mode File
 * card) registers a guard: an async predicate the pane chrome consults
 * before any close gesture destroys the card. The guard presents whatever
 * sheet the card needs (Save / Don't Save / Cancel) and resolves
 * `"close"` to proceed or `"cancel"` to abort.
 *
 * Registration returns its own release ([L27]); the card releases on
 * unmount. Only the mounted active card can be dirty-in-memory, so at
 * most one guard is live per pane — background tabs are unmounted bags and
 * their asides on disk are the safety net ([P06]).
 *
 * @module lib/card-close-guard
 */

/** Resolves `"close"` to proceed with the close, `"cancel"` to abort it. */
export type CardCloseGuard = () => Promise<"close" | "cancel">;

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
