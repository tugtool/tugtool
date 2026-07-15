/**
 * PaneTitleBarMenuStore — the per-card channel for a card to contribute
 * items to its pane's title-bar `…` menu.
 *
 * This is the generic mechanism behind the `toggleMenu` pane affordance
 * (`pane-model.md`): the `…` menu is NOT lens-specific chrome baked into
 * `TugPane`. Any card publishes its menu items here; `CardTitleBar`
 * subscribes for the active card and renders a `…` button + popup when
 * items are present, and nothing when they are not. `tug-pane.tsx` imports
 * only this store — never a card-specific module ([L10]/[L25]).
 *
 * The exact precedent is `card-title-store.ts`: a card publishes into a
 * per-card store, the pane subscribes and renders — no card coupling in
 * the chrome.
 *
 * Laws: [L02] subscribable store consumed via `useSyncExternalStore`;
 * [L10]/[L25] chrome and content stay in their lanes with this store as
 * the channel; [L24] structure-zone state across the pane/card boundary.
 *
 * @module lib/pane-title-bar-menu-store
 */

/** A single title-bar menu item a card contributes. */
export interface PaneTitleBarMenuItem {
  /** Stable id within the menu. */
  id: string;
  /** Display label. */
  label: string;
  /** Optional checkmark state (a checkable/visibility toggle). */
  checked?: boolean;
  /** Invoked when the item is chosen. */
  onSelect: () => void;
}

class PaneTitleBarMenuStore {
  private readonly _byCard = new Map<string, readonly PaneTitleBarMenuItem[]>();
  private readonly _listeners = new Set<() => void>();

  /** Publish (or replace) the title-bar menu items for `cardId`. Passing
   *  `null` (or an empty array) clears them — no `…` renders. */
  set(cardId: string, items: readonly PaneTitleBarMenuItem[] | null): void {
    if (items === null || items.length === 0) {
      if (!this._byCard.has(cardId)) return;
      this._byCard.delete(cardId);
      this._notify();
      return;
    }
    this._byCard.set(cardId, items);
    this._notify();
  }

  /** Read the items for `cardId`, or `null` when none. */
  get(cardId: string | null): readonly PaneTitleBarMenuItem[] | null {
    if (cardId === null) return null;
    return this._byCard.get(cardId) ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  private _notify(): void {
    for (const listener of this._listeners) listener();
  }
}

export const paneTitleBarMenuStore = new PaneTitleBarMenuStore();
