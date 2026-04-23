/**
 * Process-wide registry for the current `IDeckManagerStore`.
 *
 * Mirrors `lib/card-lifecycle.ts`'s last-registration-wins singleton so
 * non-React code (the `selectionGuard` singleton, mounted from
 * `ResponderChainProvider`'s `useLayoutEffect`) can subscribe to deck
 * state changes without threading the store through context. The
 * `DeckManager` constructor calls `registerDeckStore(this)` before
 * rendering the React tree, so the store is available by the time any
 * consumer reads it.
 *
 * Intentionally nullable: tests that do not construct a `DeckManager`
 * see `null` and must no-op cleanly.
 */

import type { IDeckManagerStore } from "../deck-manager-store";

let deckStoreRef: IDeckManagerStore | null = null;

/**
 * Register the current process-wide deck store. Called by
 * `DeckManager` at construction; last-wins semantics.
 */
export function registerDeckStore(store: IDeckManagerStore | null): void {
  deckStoreRef = store;
}

/**
 * Read the current process-wide deck store, or `null` when one has
 * not been registered. Consumers must defensively handle the null
 * case — tests may bootstrap only a subset of the deck.
 */
export function getDeckStore(): IDeckManagerStore | null {
  return deckStoreRef;
}
