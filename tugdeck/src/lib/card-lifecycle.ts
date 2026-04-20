/**
 * card-lifecycle.ts — Unified card-lifecycle event pipe.
 *
 * Four lifecycle events, fired by the deck at well-defined transitions:
 *
 *   1. Construction  — a card was just added to the deck.
 *   2. Activation    — a card just became the active card.
 *   3. Deactivation  — a card just lost active status, either because
 *                      another card became active or because this
 *                      card is closing while active.
 *   4. Destruction   — a card is about to be removed from the deck.
 *
 * Subscribers (observers) register via `observeCard{Construction,
 * Activation, Deactivation, Destruction}`, filtered by card id or
 * wildcard. React components typically use the hook shorthand:
 * `useOnCard{Construction, Activation, Deactivation, Destruction}`.
 *
 * Timing:
 *   - All four notifications fire SYNCHRONOUSLY at the lifecycle
 *     layer. Subscribers receive the event the instant it happens,
 *     in the same call stack as whatever triggered it.
 *   - React-integrated subscribers (the `useOnCard*` hooks) defer
 *     their user callback via a setState → useEffect pipeline so
 *     side effects (focus moves especially) run AFTER React's
 *     post-commit paint — outside any browser pointer gesture that
 *     might otherwise revert focus changes via the focus-lock
 *     behavior on `preventDefault()`-ed mousedown. This keeps the
 *     subscription itself in `useLayoutEffect` (L03 — installed
 *     before events fire) while pushing the side-effect timing
 *     onto React's deterministic scheduler (L06 — appearance via
 *     DOM/CSS, driven off React-tracked state).
 *   - Non-hook subscribers (e.g., selectionGuard) receive the sync
 *     fire and handle timing themselves if they need to.
 *
 * Invariants:
 *   - Synchronously after `activateCard(cardId)` returns:
 *       - `store.getFocusedCardId() === cardId`
 *       - `manager.getKeyCard() === cardId`
 *       - every direct observer has been notified.
 *   - `notifyCardWillBeginDestruction(cardId)` fires BEFORE the store removes the
 *     card. Subscribers can read state.
 *   - When a close happens on the active card, deactivation fires
 *     before destruction, both sync, then the deck removes.
 *
 * See roadmap/tugplan-tide-card-polish.md §Step 5.5 for the design.
 */

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Observer callback shape. Receives the id of the card the event
 * applies to. Same value for wildcard subscribers, so callers can
 * route on id without also tracking "am I subscribed to cardId?".
 */
export type CardLifecycleObserver = (cardId: string) => void;

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
  /** `null` = wildcard (fires on every event of this type). */
  readonly cardId: string | null;
  readonly callback: CardLifecycleObserver;
}

export class CardLifecycle {
  // One subscription set per event channel. Separate sets (rather
  // than a single tagged set) so iteration in notify is straight-
  // forward and subscribers of different types don't interleave.
  private readonly constructionSubs: Set<Subscription> = new Set();
  private readonly activationSubs: Set<Subscription> = new Set();
  private readonly deactivationSubs: Set<Subscription> = new Set();
  private readonly destructionSubs: Set<Subscription> = new Set();

  // Tracks which cards have been constructed but not yet destroyed.
  // Used for construction initial-sync: a hook subscribing after
  // the card was already constructed should still fire once.
  private readonly constructedCards: Set<string> = new Set();

  private manager: CardLifecycleManager | null;

  constructor(
    private readonly store: CardLifecycleStore,
    manager: CardLifecycleManager | null = null,
  ) {
    this.manager = manager;
  }

  /**
   * Late-bind the responder chain manager. The DeckManager instance
   * is constructed before any ResponderChainProvider mounts; the
   * provider attaches the manager from its mount effect so the
   * lifecycle can promote the key responder on activations.
   *
   * Before the manager is attached, `activateCard` is store-only —
   * it updates z-order and fires observers but skips the responder
   * chain promotion. Once attached, activations flow through both
   * systems.
   */
  setManager(manager: CardLifecycleManager | null): void {
    this.manager = manager;
  }

  // ---- Activation (existing behavior) ----

  /**
   * Activate `cardId`. The only sanctioned way to change which card
   * is active.
   *
   * Synchronously:
   *   1. `store.focusCard(cardId)` — z-order update.
   *   2. If `manager.getKeyCard() !== cardId`, promote `cardId` via
   *      `manager.makeFirstResponder(cardId)`.
   *   3. If the activation changed which card is active:
   *      a. Fire DEACTIVATION on the previous card (if any).
   *      b. Fire ACTIVATION on the new card.
   *      Both are synchronous at this layer; React-integrated
   *      subscribers defer their user callback to React's post-
   *      commit useEffect so focus work runs outside the gesture.
   *
   * Same-card re-activation is silent on both channels.
   */
  activateCard(cardId: string): void {
    const wasActive = this.store.getFocusedCardId();
    this.store.focusCard(cardId);
    if (this.manager !== null && this.manager.getKeyCard() !== cardId) {
      this.manager.makeFirstResponder(cardId);
    }
    if (wasActive !== cardId) {
      if (wasActive !== null) {
        this.notifyCardDidDeactivate(wasActive);
      }
      this.notifyCardDidActivate(cardId);
    }
  }

  // ---- Public notify entry points (called by DeckManager) ----

  /**
   * Fire CONSTRUCTION for `cardId`. Called by the deck after the
   * card has been added to the store. Records the card in the
   * constructed-set so late-subscribing hooks receive initial-sync.
   */
  notifyCardDidFinishConstruction(cardId: string): void {
    this.constructedCards.add(cardId);
    this.fire(this.constructionSubs, cardId);
  }

  /**
   * Fire DESTRUCTION for `cardId`. Called by the deck right BEFORE
   * removing the card from the store so subscribers can read state.
   * Also removes the card from the constructed-set.
   */
  notifyCardWillBeginDestruction(cardId: string): void {
    this.fire(this.destructionSubs, cardId);
    this.constructedCards.delete(cardId);
  }

  /**
   * Fire DEACTIVATION for `cardId`. Called internally from
   * `activateCard` on transitions, and from the deck when removing
   * the active card (before firing destruction).
   */
  notifyCardDidDeactivate(cardId: string): void {
    this.fire(this.deactivationSubs, cardId);
  }

  // ---- Observe ----

  /**
   * Subscribe to CONSTRUCTION events. Initial-sync fires for each
   * currently-constructed card matching the subscription (wildcard
   * fires for every live card; specific fires if the card exists).
   * This lets a hook-calling card body receive its own construction
   * event even though the hook subscribes after construction fired.
   */
  observeCardDidFinishConstruction(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.constructionSubs, cardId, callback, (sub) => {
      // Initial-sync: fire for any currently-constructed card
      // matching the subscription.
      for (const constructedId of this.constructedCards) {
        if (sub.cardId === null || sub.cardId === constructedId) {
          this.safeInvoke(sub.callback, constructedId);
        }
      }
    });
  }

  /**
   * Subscribe to ACTIVATION events.
   *
   * Initial-sync fires synchronously on subscribe when the current
   * active card already matches the subscription (wildcard matches
   * any non-null active; specific matches by id). Mount-time
   * subscribers don't need a separate "read current state" branch —
   * if the card is already active when you subscribe, your callback
   * fires right now.
   */
  observeCardDidActivate(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.activationSubs, cardId, callback, (sub) => {
      const active = this.store.getFocusedCardId();
      if (active !== null && (sub.cardId === null || sub.cardId === active)) {
        this.safeInvoke(sub.callback, active);
      }
    });
  }

  /**
   * Subscribe to DEACTIVATION events. No initial-sync — deactivation
   * is strictly a transition event; there is no sensible "currently
   * deactivated" state to replay.
   */
  observeCardDidDeactivate(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.deactivationSubs, cardId, callback);
  }

  /**
   * Subscribe to DESTRUCTION events. No initial-sync — destruction
   * is a one-shot terminal event fired right before removal.
   */
  observeCardWillBeginDestruction(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.destructionSubs, cardId, callback);
  }

  /** Current active card id. Thin pass-through to the store. */
  getActiveCardId(): string | null {
    return this.store.getFocusedCardId();
  }

  // ---- Internals ----

  private subscribe(
    set: Set<Subscription>,
    cardId: string | null,
    callback: CardLifecycleObserver,
    onSubscribe?: (sub: Subscription) => void,
  ): () => void {
    const subscription: Subscription = { cardId, callback };
    set.add(subscription);
    onSubscribe?.(subscription);
    return () => {
      set.delete(subscription);
    };
  }

  private fire(set: Set<Subscription>, cardId: string): void {
    for (const sub of set) {
      if (sub.cardId === null || sub.cardId === cardId) {
        this.safeInvoke(sub.callback, cardId);
      }
    }
  }

  private notifyCardDidActivate(cardId: string): void {
    this.fire(this.activationSubs, cardId);
  }

  private safeInvoke(cb: CardLifecycleObserver, cardId: string): void {
    try {
      cb(cardId);
    } catch (err) {
      console.error("CardLifecycle observer threw:", err);
    }
  }
}

// ---- Module-level singleton for cross-provider bootstrapping ----

/**
 * Current process-wide `CardLifecycle` instance, registered by
 * `DeckManager` at construction so providers outside the React tree
 * (notably `ResponderChainProvider`, which needs to call
 * `setManager` from its mount effect before the deck manager
 * context is reachable via hooks) can attach the responder chain
 * manager without threading a prop.
 *
 * Last-registration-wins: mirrors `registerResponderChainManager`
 * in action-dispatch.ts. Intentionally nullable so tests that don't
 * construct a DeckManager see `null`.
 */
let cardLifecycleRef: CardLifecycle | null = null;

export function registerCardLifecycle(lifecycle: CardLifecycle | null): void {
  cardLifecycleRef = lifecycle;
}

export function getCardLifecycle(): CardLifecycle | null {
  return cardLifecycleRef;
}

// ---- React integration ----

/**
 * Context holding the process-wide `CardLifecycle` instance.
 * Consumers outside any provider receive `null` and should no-op
 * cleanly — production always has a provider; tests opt in when
 * they're exercising lifecycle-driven behavior.
 */
export const CardLifecycleContext = createContext<CardLifecycle | null>(null);

export function useCardLifecycle(): CardLifecycle | null {
  return useContext(CardLifecycleContext);
}

/**
 * Shared hook body for the four `useOnCard*` hooks.
 *
 * Architecture:
 *   - Subscription installs in `useLayoutEffect` (L03 — event-
 *     dependent setup is ready before events fire).
 *   - The observer callback enqueues pending event ids into a ref
 *     and bumps a state counter.
 *   - A `useEffect` (post-paint) drains the queue and invokes the
 *     user callback in React's deterministic post-commit phase,
 *     outside any browser pointer gesture. This is what lets the
 *     user callback (typically `entryDelegate.focus()`) succeed:
 *     by the time `useEffect` runs, WebKit's gesture focus-lock
 *     on `preventDefault()`-ed mousedowns has released.
 *
 * The caller's callback is held in a ref so inline closures don't
 * re-install the subscription on every render. A fresh `{ seq }`
 * state object per event ensures that even same-id repeat events
 * trigger the useEffect (React only re-runs on identity change).
 */
function useOnCardEvent(
  cardId: string,
  callback: CardLifecycleObserver,
  observe: (
    lifecycle: CardLifecycle,
    cardId: string,
    cb: CardLifecycleObserver,
  ) => () => void,
): void {
  const lifecycle = useCardLifecycle();

  // Live callback ref — avoids re-subscribing when the caller
  // passes an inline arrow every render.
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Pending event buffer + seq counter. Observer fire enqueues into
  // the ref and increments the counter to schedule a re-render; the
  // post-paint useEffect drains the buffer in order.
  const pendingRef = useRef<string[]>([]);
  const [seq, setSeq] = useState(0);

  useLayoutEffect(() => {
    if (lifecycle === null) return;
    return observe(lifecycle, cardId, (eventCardId) => {
      pendingRef.current.push(eventCardId);
      setSeq((s) => s + 1);
    });
  }, [lifecycle, cardId, observe]);

  useEffect(() => {
    if (seq === 0) return;
    const pending = pendingRef.current;
    pendingRef.current = [];
    for (const eventCardId of pending) {
      try {
        callbackRef.current(eventCardId);
      } catch (err) {
        console.error("useOnCardEvent callback threw:", err);
      }
    }
  }, [seq]);
}

// Stable observer-bindings so the effect's dep array doesn't treat
// each render's fresh arrow as a new subscription target.
const observeConstruction = (
  lifecycle: CardLifecycle,
  cardId: string,
  cb: CardLifecycleObserver,
): (() => void) => lifecycle.observeCardDidFinishConstruction(cardId, cb);

const observeActivation = (
  lifecycle: CardLifecycle,
  cardId: string,
  cb: CardLifecycleObserver,
): (() => void) => lifecycle.observeCardDidActivate(cardId, cb);

const observeDeactivation = (
  lifecycle: CardLifecycle,
  cardId: string,
  cb: CardLifecycleObserver,
): (() => void) => lifecycle.observeCardDidDeactivate(cardId, cb);

const observeDestruction = (
  lifecycle: CardLifecycle,
  cardId: string,
  cb: CardLifecycleObserver,
): (() => void) => lifecycle.observeCardWillBeginDestruction(cardId, cb);

/**
 * Subscribe to CONSTRUCTION of `cardId`. For a hook called from a
 * card body, this effectively fires once on mount — a card body
 * doesn't exist unless the card does, so initial-sync always fires.
 * Wildcard hooks (if cardId is dynamic) fire for each currently-
 * constructed card on subscribe and once per subsequent new card.
 */
export function useOnCardDidFinishConstruction(
  cardId: string,
  callback: CardLifecycleObserver,
): void {
  useOnCardEvent(cardId, callback, observeConstruction);
}

/**
 * Subscribe to ACTIVATION of `cardId`. Fires immediately on mount
 * if the card is currently active; fires again on each subsequent
 * activation. No-op when no lifecycle is provided.
 *
 * Typical use:
 *     useOnCardDidActivate(cardId, () => {
 *       entryDelegateRef.current?.focus();
 *     });
 */
export function useOnCardDidActivate(
  cardId: string,
  callback: CardLifecycleObserver,
): void {
  useOnCardEvent(cardId, callback, observeActivation);
}

/**
 * Subscribe to DEACTIVATION of `cardId`. Fires when this card loses
 * active status — either another card became active, or this card
 * is closing while active. No initial-sync.
 */
export function useOnCardDidDeactivate(
  cardId: string,
  callback: CardLifecycleObserver,
): void {
  useOnCardEvent(cardId, callback, observeDeactivation);
}

/**
 * Subscribe to DESTRUCTION of `cardId`. Fires once, synchronously,
 * right before the card is removed from the deck. Subscribers can
 * still read state. No initial-sync.
 */
export function useOnCardWillBeginDestruction(
  cardId: string,
  callback: CardLifecycleObserver,
): void {
  useOnCardEvent(cardId, callback, observeDestruction);
}

