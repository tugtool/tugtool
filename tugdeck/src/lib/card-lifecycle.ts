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
  useLayoutEffect,
  useRef,
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
  /**
   * Current composite first-responder: the active stack's active card,
   * or `null` when no stack is active. Used by the app → card cascade
   * to pick the right card to fire deactivate on at app-resign time.
   */
  getFirstResponderCardId(): string | null;
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
  private readonly willMoveSubs: Set<Subscription> = new Set();
  private readonly didMoveSubs: Set<Subscription> = new Set();
  private readonly willResizeSubs: Set<Subscription> = new Set();
  private readonly didResizeSubs: Set<Subscription> = new Set();
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

  /**
   * Promote `cardId` as the responder chain's key card. No-op when no
   * manager is attached, or when `cardId` is already the key card.
   *
   * Carved out of `activateCard` so `DeckManager._setFirstResponder` can
   * promote the responder chain as part of the composite-bit commit
   * without double-firing the will/did lifecycle events.
   */
  setResponderChainKey(cardId: string): void {
    if (this.manager === null) return;
    if (this.manager.getKeyCard() === cardId) return;
    this.manager.makeFirstResponder(cardId);
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
   *
   * `knownPreviousActive` is an escape hatch for callers that have
   * already mutated the store before calling `activateCard` (e.g.,
   * `DeckManager.addCard` appends the new card to the end of the
   * array, which changes the store's notion of "top-of-stack" to
   * the new card before any lifecycle event has fired; passing the
   * pre-append active id explicitly lets the transition compute
   * against the *pre*-mutation state). When omitted, the store is
   * read as usual.
   */
  activateCard(
    cardId: string,
    knownPreviousActive?: string | null,
  ): void {
    const wasActive =
      knownPreviousActive !== undefined
        ? knownPreviousActive
        : this.store.getFocusedCardId();
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
    console.log(`[CardLifecycle] cardDidFinishConstruction id=${cardId}`);
    this.constructedCards.add(cardId);
    this.fire(this.constructionSubs, cardId);
  }

  /**
   * Fire DESTRUCTION for `cardId`. Called by the deck right BEFORE
   * removing the card from the store so synchronous observers can
   * read state. Also removes the card from the constructed-set.
   *
   * Important timing caveat for `useCardDelegate` consumers: the
   * React delegate hook defers callbacks through a MessageChannel
   * drain queue (see `scheduleDelegateCall`), which runs as the next
   * macrotask. Between the synchronous fire and the deferred drain,
   * the deck removes the card from its store. Delegate callbacks
   * that need the card's pre-destruction state must capture it
   * synchronously in an observer, not from within the deferred
   * `cardWillBeginDestruction` delegate method.
   */
  notifyCardWillBeginDestruction(cardId: string): void {
    console.log(`[CardLifecycle] cardWillBeginDestruction id=${cardId}`);
    this.fire(this.destructionSubs, cardId);
    this.constructedCards.delete(cardId);
  }

  /**
   * Fire WILL-ACTIVATE for `cardId`. Preparation phase: subscribers
   * can prime state before the store transition commits. Called
   * from `activateCard` in the will-phase of a card switch.
   */
  notifyCardWillActivate(cardId: string): void {
    console.log(`[CardLifecycle] cardWillActivate id=${cardId}`);
    this.fire(this.willActivateSubs, cardId);
  }

  /**
   * Fire DID-ACTIVATE for `cardId`. Reaction phase: the store and
   * responder chain already reflect the new active card. Called
   * from `activateCard` after the transition commits, and from the
   * cascade layer when the app returns to the foreground.
   */
  notifyCardDidActivate(cardId: string): void {
    console.log(`[CardLifecycle] cardDidActivate id=${cardId}`);
    this.fire(this.activationSubs, cardId);
  }

  /**
   * Fire WILL-DEACTIVATE for `cardId`. Preparation phase: subscribers
   * can stash state before the store transition commits. Called
   * from `activateCard` in the will-phase of a card switch, and from
   * `removeCard` before closing an active card.
   */
  notifyCardWillDeactivate(cardId: string): void {
    console.log(`[CardLifecycle] cardWillDeactivate id=${cardId}`);
    this.fire(this.willDeactivateSubs, cardId);
  }

  /**
   * Fire DID-DEACTIVATE for `cardId`. Reaction phase: the card has
   * lost active status. Called from `activateCard` after the
   * transition commits, and from `removeCard` after will-deactivate
   * on an active card.
   */
  notifyCardDidDeactivate(cardId: string): void {
    console.log(`[CardLifecycle] cardDidDeactivate id=${cardId}`);
    this.fire(this.deactivationSubs, cardId);
  }

  /**
   * Fire WILL-MOVE for `cardId`. Preparation phase: subscribers can
   * stash state before the position commit. Called by the deck's
   * `moveCard` when the new position differs from the existing one.
   */
  notifyCardWillMove(cardId: string): void {
    console.log(`[CardLifecycle] cardWillMove id=${cardId}`);
    this.fire(this.willMoveSubs, cardId);
  }

  /**
   * Fire DID-MOVE for `cardId`. Reaction phase: the store now reflects
   * the new position. Canonical place to re-assert focus or other
   * side-effects that a move may have disturbed (browser-level focus
   * loss during a drag gesture, etc.).
   */
  notifyCardDidMove(cardId: string): void {
    console.log(`[CardLifecycle] cardDidMove id=${cardId}`);
    this.fire(this.didMoveSubs, cardId);
  }

  /**
   * Fire WILL-RESIZE for `cardId`. Preparation phase: subscribers can
   * stash state before the size commit. Called by the deck's
   * `moveCard` when the new size differs from the existing one.
   */
  notifyCardWillResize(cardId: string): void {
    console.log(`[CardLifecycle] cardWillResize id=${cardId}`);
    this.fire(this.willResizeSubs, cardId);
  }

  /**
   * Fire DID-RESIZE for `cardId`. Reaction phase: the store now
   * reflects the new size. Parallel to `cardDidMove` for the size
   * transition.
   */
  notifyCardDidResize(cardId: string): void {
    console.log(`[CardLifecycle] cardDidResize id=${cardId}`);
    this.fire(this.didResizeSubs, cardId);
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
   * Subscribe to WILL-MOVE events. No initial-sync — move is strictly
   * transitional, no "currently about to move" state to replay.
   */
  observeCardWillMove(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.willMoveSubs, cardId, callback);
  }

  /**
   * Subscribe to DID-MOVE events. No initial-sync.
   */
  observeCardDidMove(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.didMoveSubs, cardId, callback);
  }

  /**
   * Subscribe to WILL-RESIZE events. No initial-sync.
   */
  observeCardWillResize(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.willResizeSubs, cardId, callback);
  }

  /**
   * Subscribe to DID-RESIZE events. No initial-sync.
   */
  observeCardDidResize(
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): () => void {
    return this.subscribe(this.didResizeSubs, cardId, callback);
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

  /**
   * Current composite first responder (the active stack's active card).
   * Thin pass-through to the store. See `CardLifecycleStore.getFirstResponderCardId`.
   */
  getFirstResponderCardId(): string | null {
    return this.store.getFirstResponderCardId();
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
  cardWillActivate?(cardId: string): void;
  cardDidActivate?(cardId: string): void;
  cardWillDeactivate?(cardId: string): void;
  cardDidDeactivate?(cardId: string): void;
  cardWillMove?(cardId: string): void;
  cardDidMove?(cardId: string): void;
  cardWillResize?(cardId: string): void;
  cardDidResize?(cardId: string): void;
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
  | "cardWillMove"
  | "cardDidMove"
  | "cardWillResize"
  | "cardDidResize"
  | "cardWillBeginDestruction";

// ---- MessageChannel-based delegate drain queue ----
//
// Per the lifecycle-delegate-reliability study, delegate callbacks
// defer through a module-scope `MessageChannel` rather than through
// React's `setState → useEffect` commit cycle. The MessageChannel
// drain:
//
//   - Runs as a macrotask (escapes WebKit's gesture focus-lock).
//   - Skips the 4 ms setTimeout clamp and timer-throttling in
//     background tabs.
//   - Is not entangled with React's commit scheduling; closures queued
//     here survive component unmount (the dying card's own
//     `cardWillBeginDestruction` delegate fires reliably — hole H1
//     closed).
//
// The queue is snapshot+cleared on each drain so callbacks that enqueue
// further work run on the next drain, preserving order within a tick
// and preventing runaway reentrant drains.

type DelegateCall = () => void;
const delegateQueue: DelegateCall[] = [];
const delegateChannel: MessageChannel =
  typeof MessageChannel !== "undefined" ? new MessageChannel() : (null as unknown as MessageChannel);

if (delegateChannel !== null) {
  delegateChannel.port1.onmessage = (): void => {
    const pending = delegateQueue.splice(0);
    for (const fn of pending) {
      try {
        fn();
      } catch (err) {
        console.error("[CardLifecycle] delegate callback threw:", err);
      }
    }
  };
}

function scheduleDelegateCall(fn: DelegateCall): void {
  delegateQueue.push(fn);
  if (delegateChannel !== null) {
    delegateChannel.port2.postMessage(null);
  }
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
 *   - Observer callbacks enqueue a closure onto the module-scope
 *     `MessageChannel`-backed delegate queue. The drain runs as a
 *     macrotask after the current task completes — past WebKit's
 *     gesture focus-lock, independent of React's commit scheduler.
 *   - The closure captures the delegate ref directly, so the
 *     callback survives component unmount between fire and drain.
 *
 * The delegate object is held in a ref so inline literals don't
 * re-install the subscription on every render. The six observer
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

  useLayoutEffect(() => {
    if (lifecycle === null) return;
    const enqueue = (
      method: CardDelegateMethodName,
      eventCardId: string,
    ): void => {
      scheduleDelegateCall(() => {
        const fn = delegateRef.current[method];
        if (fn === undefined) return;
        try {
          fn(eventCardId);
        } catch (err) {
          console.error(`useCardDelegate ${method} threw:`, err);
        }
      });
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
      lifecycle.observeCardWillMove(cardId, (id) =>
        enqueue("cardWillMove", id),
      ),
      lifecycle.observeCardDidMove(cardId, (id) =>
        enqueue("cardDidMove", id),
      ),
      lifecycle.observeCardWillResize(cardId, (id) =>
        enqueue("cardWillResize", id),
      ),
      lifecycle.observeCardDidResize(cardId, (id) =>
        enqueue("cardDidResize", id),
      ),
      lifecycle.observeCardWillBeginDestruction(cardId, (id) =>
        enqueue("cardWillBeginDestruction", id),
      ),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [lifecycle, cardId]);
}

