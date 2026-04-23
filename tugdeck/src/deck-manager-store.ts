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
import type { ComponentPersistenceRegistry } from "./components/tugways/component-persistence-registry";
import type { CardAssembler } from "./card-state-orchestrator";

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
   * Stable bound callback: update a pane frame's position/size on drag-end /
   * resize-end. The frame that gets dragged is the chrome shell; individual
   * cards within it share the pane's position.
   */
  handlePaneMoved: (
    paneId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;

  /** Stable bound callback: close a pane (and all of its cards). */
  handlePaneClosed: (paneId: string) => void;

  /**
   * Promote a card's host pane to the top of the `panes` array (highest
   * z-index) and persist the card id for reload restoration. Does NOT
   * fire lifecycle events — pair with `activateCard` when handling a
   * user gesture that should also drive the responder chain.
   */
  focusCard: (cardId: string) => void;

  /**
   * Make `cardId` the first responder — flip the composite bit
   * `(activeWindow?.activeCardId)` to point at `cardId`, fire the
   * will/didDeactivate + will/didActivate lifecycle events, promote
   * the card as the responder chain's key card, bump its host window's
   * z-order, and persist the focused-card pointer for reload
   * restoration. No-op when `cardId` is already the first responder
   * (same-bit calls still refresh the persisted pointer and the
   * responder chain in case it drifted).
   */
  activateCard: (cardId: string) => void;

  /**
   * Read the composite first-responder bit: the active pane's
   * active card id, or `null` when no pane is active. At any
   * moment, exactly zero or one card is the first responder.
   */
  getFirstResponderCardId: () => string | null;

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

  /**
   * Add a new card from the registry, wrapped in a new single-card
   * window at the default position. Returns the generated card id,
   * or null if no registration is found for `componentId`.
   */
  addCard: (componentId: string) => string | null;

  /**
   * Add a new card to an existing pane. Returns the new card id, or
   * null if the pane or registration is not found. The new card
   * becomes the pane's active card.
   */
  addCardToPane: (paneId: string, componentId: string) => string | null;

  /**
   * Remove a card. If the card was the last card in its pane, the
   * pane is removed entirely. (Renamed from `removeTab`.)
   */
  removeCard: (paneId: string, cardId: string) => void;

  /**
   * Set the active card in a pane. No-op when `cardId` is not in
   * the pane. (Renamed from `setActiveTab`.)
   */
  setActiveCardInPane: (paneId: string, cardId: string) => void;

  /**
   * Reorder a card within its pane. Moves the card at `fromIndex`
   * to `toIndex`. No-op when the pane is not found, indices are out
   * of bounds, or fromIndex === toIndex. (Renamed from `reorderTab`.)
   */
  reorderCardInPane: (paneId: string, fromIndex: number, toIndex: number) => void;

  /**
   * Detach a card from its pane and create a new single-card pane at
   * the given position. Returns the new pane's id, or null if the
   * pane or card is not found, or if the card is the last card in
   * its pane. (Renamed from `detachTab`.)
   */
  detachCard: (
    paneId: string,
    cardId: string,
    position: { x: number; y: number },
  ) => string | null;

  /**
   * Move a card from its source pane to a target pane, inserting at
   * `insertAtIndex`. No-op when `sourcePaneId === targetPaneId`.
   * The moved card becomes the target pane's active card. If the
   * source pane has only one card, the source pane is removed.
   * (Renamed from `mergeTab`.)
   */
  moveCardToPane: (
    sourcePaneId: string,
    cardId: string,
    targetPaneId: string,
    insertAtIndex: number,
  ) => void;

  // ---- Phase 5f: Per-card state cache and focus persistence (Spec S03) ----

  /**
   * Read a per-card state bag from the in-memory cache. Returns
   * `undefined` when there is no cached state for the card.
   */
  getCardState: (cardId: string) => CardStateBag | undefined;

  /**
   * Write a per-card state bag to the in-memory cache and schedule a
   * debounced tugbank write (fire-and-forget).
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
   * Toggle the collapsed state of a pane. When collapsing, sets
   * `collapsed: true`; `TugPane` renders the pane at
   * CARD_TITLE_BAR_HEIGHT. When expanding, restores the full height.
   * Notifies subscribers and schedules a save so collapsed state is
   * persisted. (Renamed from `toggleCardCollapse` — position/size and
   * collapse are pane-level concerns.)
   */
  togglePaneCollapse: (paneId: string) => void;

  /**
   * Return the per-card Component Persistence Protocol registry
   * ([D13], [A9]) for `cardId`, creating it lazily on first call. Used
   * by `useComponentPersistence` to register capture/restore closures
   * and by the framework orchestration layer at save/restore time.
   */
  getComponentRegistry: (cardId: string) => ComponentPersistenceRegistry;

  /**
   * Look up a card's component registry without creating one. Returns
   * `undefined` when the card has never registered an opt-in
   * component. Used by the capture/restore orchestration so a
   * non-participating card incurs no allocation.
   */
  peekComponentRegistry: (
    cardId: string,
  ) => ComponentPersistenceRegistry | undefined;

  /**
   * Register a card-level assembler with the framework orchestrator
   * ([A9c]). `CardHost` calls this from a `useLayoutEffect` and uses
   * the returned unregister function for cleanup. The orchestrator
   * invokes the assembler's `capture()` for every save trigger
   * (will-phase, close-before-destroy, `saveState` RPC), layering
   * component-level state on top to produce the full `CardStateBag`.
   */
  registerCardAssembler: (
    cardId: string,
    assembler: CardAssembler,
  ) => () => void;

  /**
   * Capture the full bag for `cardId` via the orchestrator. Every save
   * trigger (debounced save callback, close-before-destroy flush,
   * `saveState` RPC) flows through this entry point so `bag.components`
   * lands alongside framework-owned axes by construction.
   */
  captureCardState: (cardId: string) => CardStateBag;

  /**
   * Apply `bag.components` to the card's registered components via
   * the orchestrator. Framework-axis restore (content, scroll, DOM
   * selection, focus, form controls, region scroll) is driven by the
   * existing CardHost lifecycle hooks; this entry adds the component
   * pass.
   */
  restoreCardState: (cardId: string, bag: CardStateBag) => void;

  /**
   * Flip the session-only `DeckState.hasFocus` slice ([A1]). Wired up
   * from the module-scope window `focus` / `blur` listeners installed
   * by `DeckManager`; tests may call this directly to simulate
   * foreground transitions without dispatching DOM events. Must be an
   * arrow property (stable identity, auto-bound `this`) so it can be
   * passed as a listener callback without `.bind()`. No-op when the
   * bit is already at `value`.
   */
  setHasFocus: (value: boolean) => void;
}