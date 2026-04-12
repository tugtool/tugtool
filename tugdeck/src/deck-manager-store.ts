/**
 * IDeckManagerStore -- subscribable store interface for DeckManager.
 *
 * Lives in a separate file to break the circular import between
 * deck-manager.ts (which imports deck-manager-context.tsx for the
 * root.render() wrapper) and deck-manager-context.tsx (which needs
 * a type for the store value).
 *
 * **Authoritative references:**
 * - [D02] Extract IDeckManagerStore interface to break circular imports
 * - Spec S01: IDeckManagerStore interface
 */

import type { DeckState, TabStateBag } from "./layout-tree";

/**
 * Subscribable store interface for DeckManager.
 * Conforms to the useSyncExternalStore contract.
 */
export interface IDeckManagerStore {
  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   * Must be an arrow property (stable identity, auto-bound this)
   * so it can be passed directly to useSyncExternalStore without .bind().
   */
  subscribe: (callback: () => void) => () => void;

  /**
   * Return the current DeckState snapshot.
   * Must be an arrow property (stable identity, auto-bound this).
   */
  getSnapshot: () => DeckState;

  /**
   * Return the current state version (monotonically increasing integer).
   * Must be an arrow property (stable identity, auto-bound this).
   */
  getVersion: () => number;

  /** Stable bound callback: update card position/size on drag-end/resize-end. */
  handleCardMoved: (
    id: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;

  /** Stable bound callback: remove a card. */
  handleCardClosed: (id: string) => void;

  /** Stable bound callback: bring a card to front. */
  handleCardFocused: (id: string) => void;

  /**
   * Add a new card from the registry.
   * Returns the generated card ID, or null if no registration is found for componentId.
   */
  addCard: (componentId: string) => string | null;

  /**
   * Add a new tab to an existing card.
   * Returns the new tab id, or null if the card or registration is not found.
   */
  addTab: (cardId: string, componentId: string) => string | null;

  /** Remove a tab from a card. If the last tab is removed, the card is removed entirely. */
  removeTab: (cardId: string, tabId: string) => void;

  /** Set the active tab on a card. No-op if the tabId is not in the card's tabs array. */
  setActiveTab: (cardId: string, tabId: string) => void;

  /**
   * Reorder a tab within a card's tabs array.
   * Moves the tab at fromIndex to toIndex.
   * No-op if the card is not found, indices are out of bounds, or fromIndex === toIndex.
   */
  reorderTab: (cardId: string, fromIndex: number, toIndex: number) => void;

  /**
   * Detach a tab from its card and create a new single-tab card at the given position.
   * Returns the new card's id, or null if the source card or tab is not found,
   * or if the tab is the last tab on the card.
   */
  detachTab: (cardId: string, tabId: string, position: { x: number; y: number }) => string | null;

  /**
   * Move a tab from sourceCardId to targetCardId, inserting at insertAtIndex.
   * No-op if sourceCardId === targetCardId.
   * The merged tab becomes the active tab on the target card.
   * If the source card has only one tab, the source card is removed.
   */
  mergeTab: (sourceCardId: string, tabId: string, targetCardId: string, insertAtIndex: number) => void;

  // ---- Phase 5f: Tab state cache and focus persistence (Spec S03) ----

  /**
   * Read a tab state bag from the in-memory cache.
   * Returns undefined if the tab has no cached state.
   */
  getTabState: (tabId: string) => TabStateBag | undefined;

  /**
   * Write a tab state bag to the in-memory cache and schedule a debounced
   * tugbank write (fire-and-forget).
   */
  setTabState: (tabId: string, bag: TabStateBag) => void;

  /**
   * The card ID that was focused when the deck was last saved to tugbank.
   * Used only on reload to restore focus via makeFirstResponder in DeckCanvas.
   * Cleared to undefined after DeckCanvas reads it (fires once on mount).
   * ([D03])
   */
  initialFocusedCardId?: string;

  // ---- Phase 5f3: Save callbacks for close-time state flush (Spec S01, [D01]) ----

  /**
   * Register a save callback associated with the given ID (typically a cardId).
   * The callback is called by DeckManager on visibilitychange (hidden) and
   * beforeunload to capture all card states before the page is discarded.
   *
   * Registration should happen in useLayoutEffect (Rule of Tugways #3) so the
   * callback is registered before any events that may depend on it fire.
   */
  registerSaveCallback: (id: string, callback: () => void) => void;

  /**
   * Unregister the save callback for the given ID.
   * Called in the cleanup of the useLayoutEffect that registered it.
   */
  unregisterSaveCallback: (id: string) => void;

  /**
   * Toggle the collapsed state of a card.
   *
   * When collapsing: sets `collapsed: true` in CardState. The CardFrame will
   * render the card at CARD_TITLE_BAR_HEIGHT height.
   * When expanding: sets `collapsed: false` (or removes the field). The CardFrame
   * restores the full `size.height` from CardState.
   *
   * Notifies subscribers and schedules a save so collapsed state is persisted.
   * Step 3: Card Frame & Title Bar
   */
  toggleCardCollapse: (cardId: string) => void;

}
