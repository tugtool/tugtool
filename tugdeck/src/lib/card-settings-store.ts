/**
 * CardSettingsStore — per-card settings state shared between pane
 * chrome and card content.
 *
 * The pane's title bar offers a `…` button that opens a card's
 * settings sheet. The button needs:
 *
 *   1. A way to invoke the settings sheet's toggle behavior. The
 *      card owns the sheet's lifecycle (showSheet, the close
 *      callback); the pane doesn't.
 *   2. A reactive read of "is the settings sheet currently open?" so
 *      the button can paint as highlighted while the sheet is up —
 *      the user's mental model is "this button shows the card's
 *      settings; pressing again hides them; the button reflects
 *      that state."
 *
 * This module is the channel between those two concerns. Cards
 * register a {@link CardSettingsController} via the
 * {@link useCardSettings} hook on mount; the controller exposes
 * `toggle()` / `open()` / `close()`. The pane calls
 * `getController(activeCardId)?.toggle()` for click handling and
 * subscribes via `useSyncExternalStore(subscribe, () =>
 * isOpen(cardId))` for the highlight state.
 *
 * The hook also writes the open state into this store, so the
 * highlight tracks the actual sheet lifecycle: opens turn the
 * button on; OK / Escape / Cmd-. dismissals turn it off automatically.
 *
 * **Laws:** [L02] subscribable store consumed via `useSyncExternalStore`
 * — no `useEffect` copying through React state. [L09] / [L10] the pane
 * (chrome) and card (content) stay in their lanes — this store is the
 * sanctioned channel between them, not a prop drill or DOM query.
 * [L24] structure-zone state shared across the pane / card boundary.
 *
 * @module lib/card-settings-store
 */

export interface CardSettingsController {
  /** Toggle: close if open, open if closed. */
  toggle(): void;
  /** Open the settings sheet. No-op when already open. */
  open(): void;
  /** Close the settings sheet. No-op when already closed. */
  close(): void;
}

class CardSettingsStore {
  private readonly _controllers = new Map<string, CardSettingsController>();
  private readonly _openIds = new Set<string>();
  private readonly _listeners = new Set<() => void>();

  /**
   * Register a controller for `cardId`. Returns an unregister function
   * that the consumer's `useLayoutEffect` cleanup must call. Card
   * teardown also clears any lingering open-state for the same id —
   * the settings sheet can't be open if the controller is gone.
   */
  register = (cardId: string, controller: CardSettingsController): (() => void) => {
    this._controllers.set(cardId, controller);
    this._notify();
    return () => {
      this._controllers.delete(cardId);
      this._openIds.delete(cardId);
      this._notify();
    };
  };

  /**
   * Set the per-card open state. The hook writes here on sheet open
   * (true) and on sheet close / promise resolution (false). Idempotent
   * — repeated writes of the same value are a no-op so listeners
   * aren't churned by duplicate notifications.
   */
  setOpen(cardId: string, isOpen: boolean): void {
    const wasOpen = this._openIds.has(cardId);
    if (wasOpen === isOpen) return;
    if (isOpen) this._openIds.add(cardId);
    else this._openIds.delete(cardId);
    this._notify();
  }

  /**
   * Look up the controller for `cardId`. Returns null when the card
   * has registered no settings (the pane button is disabled for
   * cards without settings).
   */
  getController(cardId: string | null): CardSettingsController | null {
    if (cardId === null) return null;
    return this._controllers.get(cardId) ?? null;
  }

  /**
   * Reactive snapshot for `useSyncExternalStore`: whether `cardId`
   * has a settings controller registered. The pane's title bar reads
   * this to decide whether the `…` button is enabled — a card with
   * no settings gets a disabled button rather than a live no-op.
   * Pairs with `subscribe`, which notifies on every register /
   * unregister.
   */
  hasController = (cardId: string | null): boolean => {
    if (cardId === null) return false;
    return this._controllers.has(cardId);
  };

  /**
   * Reactive snapshot for `useSyncExternalStore`. Returns false for
   * unknown cardIds so the pane button rests un-highlighted when no
   * card is active or the active card has no settings registered.
   */
  isOpen = (cardId: string | null): boolean => {
    if (cardId === null) return false;
    return this._openIds.has(cardId);
  };

  /** Subscribe to any change (controller register/unregister or open
   *  state flip). [L02] */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  private _notify(): void {
    for (const l of this._listeners) l();
  }
}

/** Module-scope singleton. */
export const cardSettingsStore = new CardSettingsStore();
