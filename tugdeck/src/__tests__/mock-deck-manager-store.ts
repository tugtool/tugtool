/**
 * Minimal mock IDeckManagerStore for tests that render TugPane or other
 * components that call useDeckManager().
 *
 * Phase 5f added `useDeckManager()` to TugPane so it can read/write tab state
 * bags. All test render helpers that wrap TugPane must now include a
 * DeckManagerContext.Provider. This module provides a factory function for
 * a no-op mock store so existing tests can opt in with minimal changes.
 *
 * Usage:
 *   import { makeMockStore, withDeckManager } from "./mock-deck-manager-store";
 *
 *   // Wrap render output:
 *   render(withDeckManager(<TugPane .../>));
 *
 *   // Or access the store for assertions:
 *   const store = makeMockStore();
 *   render(<DeckManagerContext.Provider value={store}>...</DeckManagerContext.Provider>);
 */

import React from "react";
import type { IDeckManagerStore } from "../deck-manager-store";
import type { DeckState, CardStateBag } from "../layout-tree";
import { DeckManagerContext } from "../deck-manager-context";
import { ComponentPersistenceRegistry } from "../components/tugways/component-persistence-registry";
import { CardStateOrchestrator } from "../card-state-orchestrator";

/** Build a minimal no-op DeckManager store mock suitable for unit tests. */
export function makeMockStore(
  overrides?: Partial<IDeckManagerStore>,
): IDeckManagerStore {
  const cardStateCache = new Map<string, CardStateBag>();
  const saveCallbacks = new Map<string, () => void>();
  const activationCallbacks = new Map<string, () => void>();
  const cardHostRoots = new Map<string, HTMLElement>();
  const componentRegistries = new Map<string, ComponentPersistenceRegistry>();
  const orchestrator = new CardStateOrchestrator((cardId) =>
    componentRegistries.get(cardId),
  );

  const base: IDeckManagerStore = {
    subscribe: () => () => {},
    getSnapshot: (): DeckState => ({ cards: [], panes: [], hasFocus: true }),
    getVersion: () => 0,
    handlePaneMoved: () => {},
    handlePaneClosed: () => {},
    focusCard: () => {},
    activateCard: () => {},
    getFirstResponderCardId: () => null,
    observeCardDidFinishConstruction: () => () => {},
    observeCardDidActivate: () => () => {},
    observeCardDidDeactivate: () => () => {},
    observeCardWillBeginDestruction: () => () => {},
    addCard: () => null,
    addCardToPane: () => null,
    removeCard: () => {},
    setActiveCardInPane: () => {},
    reorderCardInPane: () => {},
    detachCard: () => null,
    moveCardToPane: () => {},
    getCardState: (id: string) => cardStateCache.get(id),
    setCardState: (id: string, bag: CardStateBag) => {
      cardStateCache.set(id, bag);
    },
    initialFocusedCardId: undefined,
    // Save callbacks are actually wired so CardHost's registered
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
    togglePaneCollapse: () => {},
    getComponentRegistry: (cardId: string) => {
      let registry = componentRegistries.get(cardId);
      if (!registry) {
        registry = new ComponentPersistenceRegistry();
        componentRegistries.set(cardId, registry);
      }
      return registry;
    },
    peekComponentRegistry: (cardId: string) =>
      componentRegistries.get(cardId),
    registerCardAssembler: (cardId, assembler) =>
      orchestrator.registerAssembler(cardId, assembler),
    captureCardState: (cardId) => orchestrator.captureCardState(cardId),
    restoreCardState: (cardId, bag) =>
      orchestrator.restoreCardState(cardId, bag),
    setHasFocus: () => {},
    registerActivationCallback: (cardId: string, callback: () => void) => {
      activationCallbacks.set(cardId, callback);
      return () => {
        if (activationCallbacks.get(cardId) === callback) {
          activationCallbacks.delete(cardId);
        }
      };
    },
    invokeActivationCallback: (cardId: string) => {
      activationCallbacks.get(cardId)?.();
    },
    registerCardHostRoot: (cardId: string, el: HTMLElement | null) => {
      if (el === null) {
        cardHostRoots.delete(cardId);
      } else {
        cardHostRoots.set(cardId, el);
      }
    },
    peekCardHostRoot: (cardId: string) => cardHostRoots.get(cardId) ?? null,
  };

  return { ...base, ...overrides };
}

/**
 * Wrap a React element with DeckManagerContext.Provider carrying a no-op mock
 * store. Drop-in replacement for bare render helpers in TugPane tests.
 */
export function withDeckManager(
  ui: React.ReactElement,
  store?: IDeckManagerStore,
): React.ReactElement {
  const s = store ?? makeMockStore();
  return React.createElement(DeckManagerContext.Provider, { value: s }, ui);
}
