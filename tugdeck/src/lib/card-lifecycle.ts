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
  private readonly willActivateSubs: Set<Subscription> = new Set();
  private readonly activationSubs: Set<Subscription> = new Set();
  private readonly willDeactivateSubs: Set<Subscription> = new Set();
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
   * Fires the four lifecycle events in D3 order when the active card
   * changes (A → B):
   *   1. `cardWillDeactivate(A)` — preparation: A can stash state
   *      before the transition commits.
   *   2. `cardWillActivate(B)` — preparation: B can arm itself.
   *   3. Store + responder-chain update: `store.focusCard(B)` and,
   *      if needed, `manager.makeFirstResponder(B)`.
   *   4. `cardDidDeactivate(A)` — reaction: A reacts to the fact.
   *   5. `cardDidActivate(B)` — reaction: B reacts to the fact.
   *
   * All five phases are synchronous at this layer. React-integrated
   * subscribers defer their user callback to React's post-commit
   * useEffect so focus work runs outside the gesture.
   *
   * Same-card re-activation is silent on all four channels.
   */
  activateCard(cardId: string): void {
    const wasActive = this.store.getFocusedCardId();
    if (wasActive === cardId) {
      // Same-card re-activation: no will/did fires, but still flow
      // through the store (z-order is a no-op; the focused-card-id
      // pointer is refreshed) and ensure the responder chain matches
      // in case it drifted.
      this.store.focusCard(cardId);
      if (this.manager !== null && this.manager.getKeyCard() !== cardId) {
        this.manager.makeFirstResponder(cardId);
      }
      return;
    }
    // Phase 1–2: preparation callbacks — all fire before any state
    // change, per D3 ordering.
    if (wasActive !== null) {
      this.notifyCardWillDeactivate(wasActive);
    }
    this.notifyCardWillActivate(cardId);
    // Phase 3: commit the state transition atomically.
    this.store.focusCard(cardId);
    if (this.manager !== null && this.manager.getKeyCard() !== cardId) {
      this.manager.makeFirstResponder(cardId);
    }
    // Phase 4–5: reaction callbacks.
    if (wasActive !== null) {
      this.notifyCardDidDeactivate(wasActive);
    }
    this.notifyCardDidActivate(cardId);
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
   * Fire WILL-ACTIVATE for `cardId`. Preparation phase: subscribers
   * can prime state before the store transition commits. Called
   * from `activateCard` in the will-phase of a card switch.
   */
  notifyCardWillActivate(cardId: string): void {
    this.fire(this.willActivateSubs, cardId);
  }

  /**
   * Fire DID-ACTIVATE for `cardId`. Reaction phase: the store and
   * responder chain already reflect the new active card. Called
   * from `activateCard` after the transition commits, and from the
   * cascade layer when the app returns to the foreground.
   */
  notifyCardDidActivate(cardId: string): void {
    this.fire(this.activationSubs, cardId);
  }

  /**
   * Fire WILL-DEACTIVATE for `cardId`. Preparation phase: subscribers
   * can stash state before the store transition commits. Called
   * from `activateCard` in the will-phase of a card switch, and from
   * `removeCard` before closing an active card.
   */
  notifyCardWillDeactivate(cardId: string): void {
    this.fire(this.willDeactivateSubs, cardId);
  }

  /**
   * Fire DID-DEACTIVATE for `cardId`. Reaction phase: the card has
   * lost active status. Called from `activateCard` after the
   * transition commits, and from `removeCard` after will-deactivate
   * on an active card.
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
   * Subscribe to WILL-ACTIVATE events. No initial-sync — will-
   * activate is strictly a pre-transition event with no
   * "currently about to activate" state.
   */
  observeCardWillActivate(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.willActivateSubs, cardId, callback);
  }

  /**
   * Subscribe to DID-ACTIVATE events.
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
   * Subscribe to WILL-DEACTIVATE events. No initial-sync — will-
   * deactivate is strictly a pre-transition event.
   */
  observeCardWillDeactivate(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.willDeactivateSubs, cardId, callback);
  }

  /**
   * Subscribe to DID-DEACTIVATE events. No initial-sync — deactivation
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
 * Delegate protocol for a card's lifecycle events.
 *
 * Apple-style: a single object with optional methods, supplied to
 * `useCardDelegate(cardId, delegate)`. Missing methods are no-ops.
 *
 * Ordering on a card switch A → B (per D3 of the lifecycle-delegates
 * plan): `cardAWillDeactivate` → `cardBWillActivate` → (store +
 * responder updates) → `cardADidDeactivate` → `cardBDidActivate`.
 */
export interface TugCardDelegate {
  cardDidFinishConstruction?(cardId: string): void;
  cardWillActivate?(cardId: string): void; // wired in Step 3
  cardDidActivate?(cardId: string): void;
  cardWillDeactivate?(cardId: string): void; // wired in Step 3
  cardDidDeactivate?(cardId: string): void;
  cardWillBeginDestruction?(cardId: string): void;
}

/**
 * The set of delegate method names the hook routes events to. The
 * discriminator on the pending-event buffer, and the key used to
 * look up the delegate method at drain time.
 */
type CardDelegateMethodName =
  | "cardDidFinishConstruction"
  | "cardWillActivate"
  | "cardDidActivate"
  | "cardWillDeactivate"
  | "cardDidDeactivate"
  | "cardWillBeginDestruction";

interface PendingDelegateEvent {
  readonly method: CardDelegateMethodName;
  readonly cardId: string;
}

/**
 * `useCardDelegate` — subscribe a React component to a card's
 * lifecycle as a delegate.
 *
 * Architecture:
 *   - Subscriptions install in `useLayoutEffect` (L03 — event-
 *     dependent setup is ready before events fire). One subscription
 *     per observer channel is installed unconditionally; routing to
 *     a delegate method happens at drain time.
 *   - The observer callbacks enqueue `{ method, cardId }` tuples
 *     into a ref and bump a state counter.
 *   - A `useEffect` (post-paint) drains the queue and invokes the
 *     matching delegate method — if present — in React's determin-
 *     istic post-commit phase, outside any browser pointer gesture.
 *     This is what lets the delegate callback (typically
 *     `entryDelegate.focus()`) succeed: by the time `useEffect`
 *     runs, WebKit's gesture focus-lock on `preventDefault()`-ed
 *     mousedowns has released.
 *
 * The delegate object is held in a ref so inline literals don't
 * re-install the subscription on every render. The four observer
 * subscriptions install once per `(lifecycle, cardId)` pair.
 */
export function useCardDelegate(
  cardId: string,
  delegate: TugCardDelegate,
): void {
  const lifecycle = useCardLifecycle();

  // Live delegate ref — avoids re-subscribing when the caller
  // passes an inline object every render.
  const delegateRef = useRef(delegate);
  useLayoutEffect(() => {
    delegateRef.current = delegate;
  }, [delegate]);

  // Pending event buffer + seq counter. Observer fires enqueue into
  // the ref and increment the counter to schedule a re-render; the
  // post-paint useEffect drains the buffer in order.
  const pendingRef = useRef<PendingDelegateEvent[]>([]);
  const [seq, setSeq] = useState(0);

  useLayoutEffect(() => {
    if (lifecycle === null) return;
    const enqueue = (method: CardDelegateMethodName, eventCardId: string) => {
      pendingRef.current.push({ method, cardId: eventCardId });
      setSeq((s) => s + 1);
    };
    const unsubs = [
      lifecycle.observeCardDidFinishConstruction(cardId, (id) =>
        enqueue("cardDidFinishConstruction", id),
      ),
      lifecycle.observeCardWillActivate(cardId, (id) =>
        enqueue("cardWillActivate", id),
      ),
      lifecycle.observeCardDidActivate(cardId, (id) =>
        enqueue("cardDidActivate", id),
      ),
      lifecycle.observeCardWillDeactivate(cardId, (id) =>
        enqueue("cardWillDeactivate", id),
      ),
      lifecycle.observeCardDidDeactivate(cardId, (id) =>
        enqueue("cardDidDeactivate", id),
      ),
      lifecycle.observeCardWillBeginDestruction(cardId, (id) =>
        enqueue("cardWillBeginDestruction", id),
      ),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [lifecycle, cardId]);

  useEffect(() => {
    if (seq === 0) return;
    const pending = pendingRef.current;
    pendingRef.current = [];
    const d = delegateRef.current;
    for (const event of pending) {
      const fn = d[event.method];
      if (fn === undefined) continue;
      try {
        fn(event.cardId);
      } catch (err) {
        console.error(`useCardDelegate ${event.method} threw:`, err);
      }
    }
  }, [seq]);
}

