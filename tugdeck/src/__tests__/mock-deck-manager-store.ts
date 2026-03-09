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
import type { DeckState, TabStateBag } from "../layout-tree";
import { DeckManagerContext } from "../deck-manager-context";

/** Build a minimal no-op DeckManager store mock suitable for unit tests. */
export function makeMockStore(
  overrides?: Partial<IDeckManagerStore>,
): IDeckManagerStore {
  const tabStateCache = new Map<string, TabStateBag>();

  const base: IDeckManagerStore = {
    subscribe: () => () => {},
    getSnapshot: (): DeckState => ({ cards: [] }),
    getVersion: () => 0,
    handleCardMoved: () => {},
    handleCardClosed: () => {},
    handleCardFocused: () => {},
    addCard: () => null,
    addTab: () => null,
    removeTab: () => {},
    setActiveTab: () => {},
    reorderTab: () => {},
    detachTab: () => null,
    mergeTab: () => {},
    getTabState: (tabId: string) => tabStateCache.get(tabId),
    setTabState: (tabId: string, bag: TabStateBag) => {
      tabStateCache.set(tabId, bag);
    },
    initialFocusedCardId: undefined,
    // Phase 5f3: no-op stubs; tests that need to inspect these can spyOn them.
    registerSaveCallback: () => {},
    unregisterSaveCallback: () => {},
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
