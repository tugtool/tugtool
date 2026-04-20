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

import type { DeckState, CardStateBag } from "./layout-tree";
import type { CardLifecycleObserver } from "./lib/card-lifecycle";

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

  /**
   * Stable bound callback: update a stack's position/size on drag-end /
   * resize-end. The frame that gets dragged is a CardStack; individual
   * cards within it share the stack's position.
   */
  handleStackMoved: (
    stackId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;

  /** Stable bound callback: close a stack (and all of its cards). */
  handleCardClosed: (stackId: string) => void;

  /**
   * Promote a card's host stack to the top of the stacks array (highest
   * z-index) and persist the card id for reload restoration. Does NOT
   * fire lifecycle events — pair with `activateCard` when handling a
   * user gesture that should also drive the responder chain.
   */
  focusCard: (cardId: string) => void;

  /**
   * Activate a card — fire will/didActivate through the card lifecycle
   * and promote the card as the responder chain's key card. Does NOT
   * update z-order; callers that need z-order (user clicks, detach,
   * addCard) call `focusCard` first.
   *
   * Optional `knownPreviousActive` is an escape hatch for callers
   * that have mutated the store before calling `activateCard` (e.g.,
   * `addCard` appends first, then activates). Passing `null`
   * explicitly forces the transition to fire activation-only (no
   * prior to deactivate).
   */
  activateCard: (cardId: string, knownPreviousActive?: string | null) => void;

  /**
   * Subscribe to card CONSTRUCTION events. Fires per card when
   * `deck.addCard` completes; initial-sync fires for each
   * already-constructed card matching the subscription.
   */
  observeCardDidFinishConstruction: (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ) => () => void;

  /**
   * Subscribe to card ACTIVATION events. `cardId === null` is a
   * wildcard (every activation); `cardId === "X"` is specific.
   * Fires synchronously on subscribe if the subscription matches
   * the currently-active card. Returns an unsubscribe function.
   */
  observeCardDidActivate: (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ) => () => void;

  /**
   * Subscribe to card DEACTIVATION events — fires when a card loses
   * active status, either to a subsequent activation or to closure
   * while active. No initial-sync.
   */
  observeCardDidDeactivate: (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ) => () => void;

  /**
   * Subscribe to card DESTRUCTION events. Fires once, synchronously,
   * right before the card is removed from the deck. Subscribers can
   * still read state. No initial-sync.
   */
  observeCardWillBeginDestruction: (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ) => () => void;

  /** Currently-active card id, or null if no card is active. */
  getActiveCardId: () => string | null;

  /**
   * Add a new card from the registry, wrapped in a new single-card
   * CardStack at the default position. Returns the generated card id,
   * or null if no registration is found for `componentId`.
   */
  addCard: (componentId: string) => string | null;

  /**
   * Add a new card to an existing stack. Returns the new card id, or
   * null if the stack or registration is not found. The new card
   * becomes the stack's active card.
   */
  addCardToStack: (stackId: string, componentId: string) => string | null;

  /**
   * Remove a card. If the card was the last card in its stack, the
   * stack is removed entirely. (Renamed from `removeTab`.)
   */
  removeCard: (stackId: string, cardId: string) => void;

  /**
   * Set the active card in a stack. No-op when `cardId` is not in
   * the stack. (Renamed from `setActiveTab`.)
   */
  setActiveCardInStack: (stackId: string, cardId: string) => void;

  /**
   * Reorder a card within its stack. Moves the card at `fromIndex`
   * to `toIndex`. No-op when the stack is not found, indices are out
   * of bounds, or fromIndex === toIndex. (Renamed from `reorderTab`.)
   */
  reorderCardInStack: (stackId: string, fromIndex: number, toIndex: number) => void;

  /**
   * Detach a card from its stack and create a new single-card stack at
   * the given position. Returns the new stack's id, or null if the
   * stack or card is not found, or if the card is the last card in
   * its stack. (Renamed from `detachTab`.)
   */
  detachCard: (
    stackId: string,
    cardId: string,
    position: { x: number; y: number },
  ) => string | null;

  /**
   * Move a card from its source stack to a target stack, inserting at
   * `insertAtIndex`. No-op when `sourceStackId === targetStackId`.
   * The moved card becomes the target stack's active card. If the
   * source stack has only one card, the source stack is removed.
   * (Renamed from `mergeTab`.)
   */
  moveCardToStack: (
    sourceStackId: string,
    cardId: string,
    targetStackId: string,
    insertAtIndex: number,
  ) => void;

  // ---- Phase 5f: Per-card state cache and focus persistence (Spec S03) ----

  /**
   * Read a per-card state bag from the in-memory cache. Returns
   * `undefined` when there is no cached state for the card.
   * (Renamed from `getTabState`.)
   */
  getCardState: (cardId: string) => CardStateBag | undefined;

  /**
   * Write a per-card state bag to the in-memory cache and schedule a
   * debounced tugbank write (fire-and-forget). (Renamed from
   * `setTabState`.)
   */
  setCardState: (cardId: string, bag: CardStateBag) => void;

  /**
   * The card ID that was focused when the deck was last saved to tugbank.
   * Used only on reload to restore focus via makeFirstResponder in DeckCanvas.
   * Cleared to undefined after DeckCanvas reads it (fires once on mount).
   * ([D03])
   */
  initialFocusedCardId?: string;

  // ---- Phase 5f3: Save callbacks for close-time state flush (Spec S01, [D01]) ----

  /**
   * Register a save callback associated with the given ID (typically a
   * cardId). The callback is invoked by DeckManager on visibilitychange
   * (hidden) and beforeunload to capture state before the page is
   * discarded. Registration should happen in useLayoutEffect (Rule of
   * Tugways #3) so the callback is registered before any events that
   * may depend on it fire.
   */
  registerSaveCallback: (id: string, callback: () => void) => void;

  /**
   * Unregister the save callback for the given ID.
   * Called in the cleanup of the useLayoutEffect that registered it.
   */
  unregisterSaveCallback: (id: string) => void;

  /**
   * Invoke the save callback registered under the given ID, if any. Used by
   * callers that need to trigger a specific save synchronously (e.g., save
   * outgoing card's state before switching to a new active card). No-op when
   * no callback is registered.
   */
  invokeSaveCallback: (id: string) => void;

  /**
   * Toggle the collapsed state of a stack. When collapsing, sets
   * `collapsed: true`; the StackFrame renders the stack at
   * CARD_TITLE_BAR_HEIGHT. When expanding, restores the full height.
   * Notifies subscribers and schedules a save so collapsed state is
   * persisted. (Renamed from `toggleCardCollapse` — position/size and
   * collapse are stack-level concerns.)
   */
  toggleStackCollapse: (stackId: string) => void;
}