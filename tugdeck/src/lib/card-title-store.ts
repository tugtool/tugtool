/**
 * CardTitleStore — per-card title override surfaced in pane chrome.
 *
 * A card's registered `defaultMeta.title` is the static label baked
 * into the registry at card type definition time ("Dev", "Git",
 * "Hello"). Some cards have a stateful identity beyond their type —
 * the Dev card binds to a project at session pick time, and from
 * that moment forward the title bar should reflect *which* project
 * is loaded, not just "Dev".
 *
 * This store is the sanctioned channel for that override. Cards
 * write `set(cardId, "<override>")` once their identity resolves
 * and `clear(cardId)` (or unmount) when it goes away. The pane
 * subscribes via `useSyncExternalStore` and composes the override
 * with the registry title as `"<registry> — <override>"`.
 *
 * **Laws:**
 * - [L02] subscribable store, consumed via `useSyncExternalStore`
 *   (no `useEffect` copying through React state).
 * - [L09] / [L10] the pane (chrome) and the card (content) stay in
 *   their lanes; this store is the channel between them, not a
 *   prop drill or DOM query.
 * - [L24] structure-zone state shared across the pane / card
 *   boundary.
 *
 * @module lib/card-title-store
 */

class CardTitleStore {
  private readonly _overrides = new Map<string, string>();
  private readonly _listeners = new Set<() => void>();

  /** Set the title override for `cardId`. Idempotent. */
  set(cardId: string, title: string): void {
    if (this._overrides.get(cardId) === title) return;
    this._overrides.set(cardId, title);
    this._notify();
  }

  /** Remove the title override for `cardId`. No-op when absent. */
  clear(cardId: string): void {
    if (!this._overrides.has(cardId)) return;
    this._overrides.delete(cardId);
    this._notify();
  }

  /** Read the title override for `cardId`, or `null` when none. */
  get(cardId: string | null): string | null {
    if (cardId === null) return null;
    return this._overrides.get(cardId) ?? null;
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

export const cardTitleStore = new CardTitleStore();
