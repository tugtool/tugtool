/**
 * CardSessionBindingStore — per-card session binding for workspace filter routing.
 *
 * Maps `cardId → { tugSessionId, workspaceKey, projectDir }`. The binding is
 * populated from the `spawn_session_ok` CONTROL ack (where tugcast echoes the
 * canonical `workspace_key`) and consumed by `useCardWorkspaceKey`, which
 * `TugPane` uses to build its `FeedStore` workspace-value filter.
 *
 * **Laws:** [L02] External state enters React through `useSyncExternalStore`
 * only — this store exposes `subscribe + getSnapshot` and is read via
 * `useCardWorkspaceKey`, never through component state.
 *
 * @module lib/card-session-binding-store
 */

import { useCallback, useSyncExternalStore } from "react";

/**
 * User's choice of session mode when the card was opened. Populated from
 * the `spawn_session_ok` CONTROL ack, which echoes the value tugdeck sent
 * on `spawn_session`. "new" matches the fresh-by-default behavior of
 * the fresh-by-default behavior; "resume" carries the explicit
 * resume intent.
 */
export type CardSessionMode = "new" | "resume";

export interface CardSessionBinding {
  readonly tugSessionId: string;
  readonly workspaceKey: string;
  readonly projectDir: string;
  readonly sessionMode: CardSessionMode;
}

export class CardSessionBindingStore {
  private _bindings: Map<string, CardSessionBinding> = new Map();
  private _listeners: Array<() => void> = [];

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  };

  getSnapshot = (): Map<string, CardSessionBinding> => this._bindings;

  getBinding = (cardId: string): CardSessionBinding | undefined =>
    this._bindings.get(cardId);

  setBinding = (cardId: string, binding: CardSessionBinding): void => {
    const next = new Map(this._bindings);
    next.set(cardId, binding);
    this._bindings = next;
    for (const listener of this._listeners) listener();
  };

  clearBinding = (cardId: string): void => {
    if (!this._bindings.has(cardId)) return;
    const next = new Map(this._bindings);
    next.delete(cardId);
    this._bindings = next;
    for (const listener of this._listeners) listener();
  };

  /**
   * Drop every binding in a single notify. Used by the reconnect handler
   * after a WebSocket re-open: bindings without a live server peer are
   * worse than no bindings, so the new resume frames go out against an
   * empty store. Per [D04] in
   * `roadmap/tugplan-session-connection-health.md`, the clear-then-restore
   * order is part of the contract. A no-op when the store is already
   * empty so the first reconnect after a fresh boot does not emit a
   * spurious notify.
   */
  clearAll = (): void => {
    if (this._bindings.size === 0) return;
    this._bindings = new Map();
    for (const listener of this._listeners) listener();
  };
}

/** Module-scope singleton — mirrors FeedStore's usage shape. */
export const cardSessionBindingStore = new CardSessionBindingStore();

/**
 * The card currently bound to `sessionId`, or `null` when none is open — the
 * reverse of {@link CardSessionBindingStore.getBinding}, and the one place that
 * walk lives.
 *
 * The store is keyed by card because that is the direction the feed plumbing
 * reads it; a session reference needs the other direction, and the walk is
 * cheap (a deck holds a handful of cards). Every "go to that session" gesture
 * in the app — a Gazette ref, a citation chip — asks this, so it answers once
 * rather than in each caller.
 */
export function cardIdForSession(sessionId: string): string | null {
  for (const [cardId, binding] of cardSessionBindingStore.getSnapshot()) {
    if (binding.tugSessionId === sessionId) return cardId;
  }
  return null;
}

/**
 * The subscribed form, for a component deciding whether to *offer* the gesture
 * ([L02]). A chip that reads this unsubscribed would keep offering a click into
 * a card that has since closed, or withhold one from a card that has since
 * opened.
 */
export function useCardIdForSession(sessionId: string): string | null {
  return useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    useCallback(() => cardIdForSession(sessionId), [sessionId]),
  );
}
