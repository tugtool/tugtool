/**
 * card-lifecycle.ts — Unified card-activation lifecycle.
 *
 * The canonical "activate a card" operation. Every code path that
 * used to separately poke `store.handleCardFocused`, the responder
 * chain, and the selection guard routes through `activateCard` here
 * instead. Consumers subscribe once via `observeCardActivation` (or
 * the `useOnCardActivated` React hook) and receive one reliable
 * event per activation — regardless of which trigger path fired,
 * regardless of whether the click target was focus-refuse.
 *
 * Invariant. Synchronously after `activateCard(cardId)` returns:
 *   - `store.getFocusedCardId() === cardId`
 *   - `manager.getKeyCard() === cardId`
 *   - every observer registered for `cardId` (and every wildcard
 *     observer) has been notified — unless the call was a no-op
 *     (same card re-activated), in which case observers are silent.
 *
 * See roadmap/tugplan-tide-card-polish.md §Step 5.5 for the design
 * and the resolved decisions [D7]–[D11].
 */

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";

/**
 * Observer callback shape. Receives the id of the card that just
 * became active. Same value every time, even for wildcard
 * subscribers, so callers can route on id without also tracking a
 * parallel "am I subscribed to cardId?" bit.
 */
export type CardActivationObserver = (cardId: string) => void;

/**
 * Structural contract for the deck store. Typed minimally so tests
 * can inject plain objects without bringing DeckManager's surface
 * area along. Production passes the real DeckManager here.
 */
export interface CardLifecycleStore {
  /** Bring `cardId` to front in the z-order (last in the cards array). */
  focusCard(cardId: string): void;
  /** Current focused card id (top of z-order), or null if no cards. */
  getFocusedCardId(): string | null;
}

/**
 * Structural contract for the responder chain. Typed minimally for
 * the same reason as `CardLifecycleStore`. Production passes the
 * real `ResponderChainManager`.
 */
export interface CardLifecycleManager {
  getKeyCard(): string | null;
  makeFirstResponder(id: string): void;
}

interface Subscription {
  /** `null` = wildcard (fires on every activation). */
  readonly cardId: string | null;
  readonly callback: CardActivationObserver;
}

export class CardLifecycle {
  private readonly subscriptions: Set<Subscription> = new Set();

  constructor(
    private readonly store: CardLifecycleStore,
    private readonly manager: CardLifecycleManager,
  ) {}

  /**
   * Activate `cardId`. The only sanctioned way to change which card
   * is active. Synchronously:
   *
   *   1. `store.focusCard(cardId)` — z-order update. Idempotent on
   *      same-card re-activation; the store's own persistence side
   *      effect still fires (we rely on that to keep the last-focus
   *      restore pointer fresh).
   *   2. If `manager.getKeyCard() !== cardId`, promote `cardId` via
   *      `manager.makeFirstResponder(cardId)`. The guard preserves
   *      in-card descendant focus: when the chain already sits
   *      inside this card (e.g., the editor is first responder),
   *      promoting the card-level responder would demote focus out
   *      of the editor for no reason.
   *   3. If the activation changed which card is active, notify
   *      observers. Same-card re-activation is silent on the
   *      observer channel.
   */
  activateCard(cardId: string): void {
    const wasActive = this.store.getFocusedCardId();
    this.store.focusCard(cardId);
    if (this.manager.getKeyCard() !== cardId) {
      this.manager.makeFirstResponder(cardId);
    }
    if (wasActive !== cardId) {
      this.notify(cardId);
    }
  }

  /**
   * Subscribe to activation events.
   *
   *   - `cardId === null` — wildcard; fires on every activation.
   *   - `cardId === "X"`  — fires only when `"X"` becomes active.
   *
   * Fires synchronously on subscribe when the current active card
   * already matches the subscription (wildcard matches any non-null
   * active; specific matches by id). The initial-sync rule means
   * mount-time subscribers don't need a separate "read current state"
   * branch — if the card is already active when you subscribe, your
   * callback fires right now.
   *
   * Observer exceptions are caught and logged so one misbehaving
   * subscriber can't starve the rest.
   */
  observeCardActivation(
    cardId: string | null,
    callback: CardActivationObserver,
  ): () => void {
    const subscription: Subscription = { cardId, callback };
    this.subscriptions.add(subscription);
    const active = this.store.getFocusedCardId();
    if (active !== null && (cardId === null || cardId === active)) {
      this.safeInvoke(callback, active);
    }
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  /** Current active card id. Thin pass-through to the store. */
  getActiveCardId(): string | null {
    return this.store.getFocusedCardId();
  }

  private notify(cardId: string): void {
    for (const sub of this.subscriptions) {
      if (sub.cardId === null || sub.cardId === cardId) {
        this.safeInvoke(sub.callback, cardId);
      }
    }
  }

  private safeInvoke(cb: CardActivationObserver, cardId: string): void {
    try {
      cb(cardId);
    } catch (err) {
      console.error("CardLifecycle observer threw:", err);
    }
  }
}

// ---- React integration ----

/**
 * Context holding the process-wide `CardLifecycle` instance. The
 * provider installs in the deck bootstrap (Commit 2 of Step 5.5).
 * Consumers outside any provider receive `null` and should no-op
 * cleanly — production always has a provider; tests opt in when
 * they're exercising lifecycle-driven behavior.
 */
export const CardLifecycleContext = createContext<CardLifecycle | null>(null);

export function useCardLifecycle(): CardLifecycle | null {
  return useContext(CardLifecycleContext);
}

/**
 * Subscribe the calling component to activation events for
 * `cardId`. Fires immediately on mount if the card is currently
 * active; fires again on each subsequent activation. No-op when
 * no lifecycle is provided (safe to render in isolation).
 *
 * The callback is stored in a ref so inline closures don't cause
 * the subscription to re-install on every render — identity of
 * `callback` is ignored for effect deps. Callers write naturally:
 *
 *     useOnCardActivated(cardId, () => {
 *       entryDelegateRef.current?.focus();
 *     });
 */
export function useOnCardActivated(
  cardId: string,
  callback: CardActivationObserver,
): void {
  const lifecycle = useCardLifecycle();
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  useLayoutEffect(() => {
    if (lifecycle === null) return;
    return lifecycle.observeCardActivation(cardId, (activatedCardId) => {
      callbackRef.current(activatedCardId);
    });
  }, [lifecycle, cardId]);
}
