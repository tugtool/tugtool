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
import { isSidebarCard } from "./card-registry";

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
 * `findSidebarPane(state, componentId)` — the pane hosting a sidebar card, or
 * `undefined` when that card is closed.
 *
 * A sidebar pane carries no marker of its own: it is the pane holding the card
 * registered under `componentId`. A sidebar card is a singleton and its pane
 * hosts nothing else (`acceptsFamilies: []` and an un-mergeable family), so the
 * derivation is single-valued. This is the one predicate every consumer that
 * needs "which pane is the Lens / the Jots card" goes through.
 */
export function findSidebarPane(
  state: DeckState,
  componentId: string,
): TugPaneState | undefined {
  const cardIds = new Set(
    state.cards.filter((c) => c.componentId === componentId).map((c) => c.id),
  );
  if (cardIds.size === 0) return undefined;
  return state.panes.find((p) => p.cardIds.some((cid) => cardIds.has(cid)));
}

/**
 * Every pane hosting a sidebar-role card, paired with the componentId it hosts.
 * The order is the panes array's own (z-order); callers that need a spatial
 * order sort by the side each card holds.
 */
export function findSidebarPanes(
  state: DeckState,
): readonly { componentId: string; pane: TugPaneState }[] {
  const byCardId = new Map<string, string>();
  for (const card of state.cards) {
    if (isSidebarCard(card.componentId)) byCardId.set(card.id, card.componentId);
  }
  if (byCardId.size === 0) return [];
  const out: { componentId: string; pane: TugPaneState }[] = [];
  for (const pane of state.panes) {
    for (const cid of pane.cardIds) {
      const componentId = byCardId.get(cid);
      if (componentId !== undefined) {
        out.push({ componentId, pane });
        break;
      }
    }
  }
  return out;
}

/** `findLensPane(state)` — the pane hosting the Lens, or `undefined` when the
 *  Lens is closed. The Lens-shaped reading of {@link findSidebarPane}, kept
 *  because most call sites want exactly this one. */
export function findLensPane(state: DeckState): TugPaneState | undefined {
  return findSidebarPane(state, LENS_CARD_ID);
}

/**
 * `slotStackOf(state, slot)` — every pane holding `slot`, in z-order
 * (last = topmost, the order `DeckState.panes` itself carries). Empty when
 * the slot is unoccupied.
 *
 * `undefined` never matches: a free pane and the Lens hold no slot, so they
 * stand in no stack. The membership and the order are both fully determined
 * by state the deck already owns, which is why nothing here is stored — a
 * stored copy could only ever disagree with the array it was copied from.
 */
export function slotStackOf(
  state: DeckState,
  slot: number | undefined,
): readonly TugPaneState[] {
  if (slot === undefined) return [];
  return state.panes.filter((p) => p.slot === slot);
}

// A pane's display name is NOT derived here. It is the string that pane's own
// title bar renders — registry title, multi-tab group prefix, and the live
// `cardTitleStore` override composed together — and it lives in exactly one
// place, `lib/pane-title.ts`. A simpler rule used to live here (the
// `CardState.title` fallback chain) and it disagreed with the title bar for
// every card whose identity is dynamic: a Session card bound to a project read
// `test-repo/petit-thaw` on its title bar and `Untitled` in every list.

/**
 * One row of a slot's stack, already resolved for display. Ordered
 * topmost-first, matching the host menu-state convention.
 *
 * The title bar renders its picker from these and never reaches for the deck
 * store: it has no access to one, and chrome driven entirely by props is what
 * keeps chrome and content in their lanes ([L10]).
 */
export interface SlotStackEntry {
  /** The pane this row raises. */
  paneId: string;
  /**
   * The card id to activate — the pane's `activeCardId`, resolved at
   * projection time so the raise needs no second store read.
   */
  cardId: string;
  /** Display title, from {@link paneDisplayTitle}. */
  title: string;
  /**
   * The pane's icon, as a `lucide-react` name — the same `CardMeta.icon` its
   * own title bar draws, resolved here so a picker row reads as a miniature of
   * the title bar it stands for rather than as a bare list of strings.
   * Absent when the card's registration declares no icon.
   */
  icon?: string;
  /** True for the pane currently at the front of the slot. */
  topmost: boolean;
}

/**
 * `countWorkCards(state)` — how many cards the user is working in, i.e. every
 * card but the Lens. The Lens is app furniture (it opens by factory default),
 * so anything asking "does this deck hold work yet" — the setup wizard's
 * "start a session" step, the copy that reads a deck as busy — counts through
 * here rather than off `state.cards.length`.
 */
export function countWorkCards(state: DeckState): number {
  return state.cards.filter((c) => c.componentId !== LENS_CARD_ID).length;
}
