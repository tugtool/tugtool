/**
 * deck-store-selectors.ts — derived predicates over `DeckState`.
 *
 * A selector here is a pure function of `DeckState` plus its inputs
 * (typically a `cardId`). No side effects, no memoization, no imports
 * from React. Consumers pick the subscription shape that fits:
 *
 *   - React components subscribe through `useSyncExternalStore` — see
 *     `deck-store-hooks.ts` for the `use*` wrappers built on these
 *     selectors (upholds [L02]).
 *   - Non-React singletons (e.g. the `selectionGuard`, app-lifecycle
 *     plumbing) subscribe to the deck store directly and re-run the
 *     selector inside their subscription callback:
 *
 *     ```ts
 *     const unsubscribe = deckStore.subscribe(() => {
 *       if (isFocusDestination(cardId, deckStore.getSnapshot())) {
 *         // react to the current card being the focus destination
 *       }
 *     });
 *     ```
 *
 * Keeping these derivations pure means the same predicate is reused
 * from both pathways without forking the logic per consumer — the
 * foundation [A1] establishes for [A3] / [A4] in later steps.
 */

import type { DeckState, TugPaneState } from "./layout-tree";
import { LENS_CARD_ID } from "./lib/lens-card-id";

/**
 * `isFocusDestination(cardId, state)` — returns true iff `cardId`
 * identifies the card that currently deserves the OS keyboard caret
 * ([A1]). Three conditions, all of which must hold:
 *
 *   1. The app is foreground (`state.hasFocus === true`). When the
 *      tugdeck window is blurred, no card is the focus destination —
 *      restoring focus into the DOM while another app owns the caret
 *      would steal focus back (the [R07] class of bugs).
 *   2. The card's host pane is the active pane
 *      (`state.activePaneId === card.paneId`).
 *   3. The card is the active card of that pane
 *      (`pane.activeCardId === cardId`).
 *
 * Returns `false` for unknown `cardId` (card not in the deck, card
 * with no containing pane, pane missing) — the selector degrades
 * quietly in transient states that show up during deck mutations.
 *
 * Pure: the same inputs always produce the same output. Safe to call
 * from any context — React render, effect, non-React subscribe
 * callback.
 */
export function isFocusDestination(
  cardId: string,
  state: DeckState,
): boolean {
  if (!state.hasFocus) return false;
  const pane = state.panes.find((p) => p.cardIds.includes(cardId));
  if (!pane) return false;
  if (state.activePaneId !== pane.id) return false;
  return pane.activeCardId === cardId;
}

/**
 * `findLensPane(state)` — the pane hosting the Lens, or `undefined` when the
 * Lens is closed.
 *
 * The Lens pane carries no marker of its own: it is the pane holding the card
 * registered as {@link LENS_CARD_ID}. That card is a singleton and its pane
 * hosts nothing else (`acceptsFamilies: []` and an un-mergeable family), so
 * the derivation is single-valued. This is the one predicate every consumer
 * that needs "which pane is the Lens" goes through.
 */
export function findLensPane(state: DeckState): TugPaneState | undefined {
  const lensCardIds = new Set(
    state.cards.filter((c) => c.componentId === LENS_CARD_ID).map((c) => c.id),
  );
  if (lensCardIds.size === 0) return undefined;
  return state.panes.find((p) => p.cardIds.some((cid) => lensCardIds.has(cid)));
}
