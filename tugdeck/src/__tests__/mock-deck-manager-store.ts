/**
 * Minimal mock IDeckManagerStore for tests that render Tugcard or other
 * components that call useDeckManager().
 *
 * Phase 5f added `useDeckManager()` to Tugcard so it can read/write tab state
 * bags. All test render helpers that wrap Tugcard must now include a
 * DeckManagerContext.Provider. This module provides a factory function for
 * a no-op mock store so existing tests can opt in with minimal changes.
 *
 * Usage:
 *   import { makeMockStore, withDeckManager } from "./mock-deck-manager-store";
 *
 *   // Wrap render output:
 *   render(withDeckManager(<Tugcard .../>));
 *
 *   // Or access the store for assertions:
 *   const store = makeMockStore();
 *   render(<DeckManagerContext.Provider value={store}>...</DeckManagerContext.Provider>);
 */

import React from "react";
import type { IDeckManagerStore } from "../deck-manager-store";
import type { DeckState, CardStateBag } from "../layout-tree";
import { DeckManagerContext } from "../deck-manager-context";

/** Build a minimal no-op DeckManager store mock suitable for unit tests. */
export function makeMockStore(
  overrides?: Partial<IDeckManagerStore>,
): IDeckManagerStore {
  const cardStateCache = new Map<string, CardStateBag>();
  const saveCallbacks = new Map<string, () => void>();

  const base: IDeckManagerStore = {
    subscribe: () => () => {},
    getSnapshot: (): DeckState => ({ cards: [], stacks: [] }),
    getVersion: () => 0,
    handleStackMoved: () => {},
    handleCardClosed: () => {},
    activateCard: () => {},
    observeCardDidFinishConstruction: () => () => {},
    observeCardDidActivate: () => () => {},
    observeCardDidDeactivate: () => () => {},
    observeCardWillBeginDestruction: () => () => {},
    getActiveCardId: () => null,
    addCard: () => null,
    addCardToStack: () => null,
    removeCard: () => {},
    setActiveCardInStack: () => {},
    reorderCardInStack: () => {},
    detachCard: () => null,
    moveCardToStack: () => {},
    getCardState: (id: string) => cardStateCache.get(id),
    setCardState: (id: string, bag: CardStateBag) => {
      cardStateCache.set(id, bag);
    },
    initialFocusedCardId: undefined,
    // Save callbacks are actually wired so CardContentHost's registered
    // per-card callback fires on invokeSaveCallback. Tests that spy on
    // register/unregister still see the calls; tests that rely on
    // invokeSaveCallback triggering the registered function also work.
    registerSaveCallback: (id: string, callback: () => void) => {
      saveCallbacks.set(id, callback);
    },
    unregisterSaveCallback: (id: string) => {
      saveCallbacks.delete(id);
    },
    invokeSaveCallback: (id: string) => {
      saveCallbacks.get(id)?.();
    },
    toggleStackCollapse: () => {},
  };

  return { ...base, ...overrides };
}

/**
 * Wrap a React element with DeckManagerContext.Provider carrying a no-op mock
 * store. Drop-in replacement for bare render helpers in Tugcard tests.
 */
export function withDeckManager(
  ui: React.ReactElement,
  store?: IDeckManagerStore,
): React.ReactElement {
  const s = store ?? makeMockStore();
  return React.createElement(DeckManagerContext.Provider, { value: s }, ui);
}
