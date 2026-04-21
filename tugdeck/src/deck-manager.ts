/**
 * DeckManager -- orchestrates card state and the React render pipeline.
 *
 * Operates against the two-table model: `deckState.cards` (content
 * identities) and `deckState.stacks` (visual frames). Every public mutator
 * keeps the two tables in sync, preserving the invariants documented in
 * `layout-tree.ts` (no orphan cards, no empty stacks, activeCardId ∈ cardIds).
 *
 * DeckManager is a subscribable store conforming to the `useSyncExternalStore`
 * contract. One `root.render()` at construction time; all subsequent state
 * changes call `notify()` instead of render().
 *
 * **Authoritative references:**
 * - [D01] DeckManager is a subscribable store with one root.render() at mount
 * - [D02] Extract IDeckManagerStore interface to break circular imports
 * - [D04] Single-call registration, [D08] DeckManager stays a plain class
 * - Spec S03: DeckManager store API additions
 * - Spec S05: DeckManager new methods
 *
 * ## Design notes
 *
 * - `notify()` fires all subscriber callbacks after each state mutation.
 *   `useSyncExternalStore` forces SyncLane updates (always synchronous).
 * - Each state-mutating method assigns `this.deckState = { ...this.deckState }`
 *   (shallow copy) before calling `notify()` so React sees a new reference.
 * - `subscribe`, `getSnapshot`, and `getVersion` are arrow properties for
 *   stable identity and auto-bound `this`.
 * - The constructor calls `this.reactRoot.render()` exactly once, wrapping the
 *   tree with `DeckManagerContext.Provider`.
 * - Stack positions cascade: each new stack offsets (30, 30) from the previous.
 * - Cards whose componentId is not registered in the card registry are
 *   filtered out at load time (see `filterRegisteredCards`).
 */

import {
  type DeckState,
  type CardState,
  type CardStackState,
  type CardStateBag,
  validateDeckState,
} from "./layout-tree";
import { buildDefaultLayout, serialize, deserialize } from "./serialization";
import { getRegistration, getSizePolicy } from "./card-registry";
import { TugConnection } from "./connection";
import React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { DeckCanvas } from "./components/chrome/deck-canvas";
import { ErrorBoundary } from "./components/chrome/error-boundary";
import { TugBannerProvider } from "./components/chrome/tug-banner-bridge";
import { ResponderChainProvider } from "./components/tugways/responder-chain-provider";
import { TugTooltipProvider } from "./components/tugways/tug-tooltip";
import { TugAlertProvider } from "./components/tugways/tug-alert";
import { TugBulletinProvider } from "./components/tugways/tug-bulletin";
import { putLayout, putTabState, putFocusedCardId } from "./settings-api";
import { TugThemeProvider, type ThemeName } from "./contexts/theme-provider";
import type { IDeckManagerStore } from "./deck-manager-store";
import { DeckManagerContext } from "./deck-manager-context";
import { BASE_THEME_NAME } from "./theme-constants";
import {
  CardLifecycle,
  CardLifecycleContext,
  registerCardLifecycle,
  type CardLifecycleManager,
  type CardLifecycleObserver,
} from "./lib/card-lifecycle";
import {
  AppLifecycle,
  AppLifecycleContext,
  registerAppLifecycle,
} from "./lib/app-lifecycle";
import {
  installLifecycleCascade,
  type LifecycleCascadeHandle,
} from "./lib/lifecycle-cascade";

/** Debounce delay for saving layout (ms) */
const SAVE_DEBOUNCE_MS = 500;

/** Cascade step between consecutive new stacks (pixels) */
const CASCADE_STEP = 30;

/**
 * True when running outside a production build. Used to gate dev-only
 * assertions (deck-state invariant checks) so production pays no cost.
 * Permissive: returns true in any environment without `NODE_ENV=production`
 * (browsers, worker contexts, test runners).
 */
function isDevEnv(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).process?.env?.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

/**
 * Pure helper: remove `cardId` from the stack's `cardIds` and pick a new
 * `activeCardId` if the removed card was active. Mirrors the fallback rule
 * used by `_removeCard`, `_detachCard`, and `_moveCardToStack`: the previous
 * card becomes active, or the first card if the removed card was first.
 *
 * Returns `activeCardId: null` when the stack is left empty — the caller
 * decides what to do (close the stack, or drop it because its card moved
 * elsewhere). Returns the input references unchanged when `cardId` is not
 * in `cardIds`.
 */
function spliceCardFromStack(
  stack: CardStackState,
  cardId: string,
): { cardIds: readonly string[]; activeCardId: string | null } {
  const cardIndex = stack.cardIds.indexOf(cardId);
  if (cardIndex === -1) {
    return { cardIds: stack.cardIds, activeCardId: stack.activeCardId };
  }
  const cardIds = stack.cardIds.filter((id) => id !== cardId);
  if (cardIds.length === 0) {
    return { cardIds, activeCardId: null };
  }
  let activeCardId = stack.activeCardId;
  if (activeCardId === cardId) {
    activeCardId = cardIds[cardIndex > 0 ? cardIndex - 1 : 0];
  }
  return { cardIds, activeCardId };
}

export class DeckManager implements IDeckManagerStore {
  private container: HTMLElement;
  private connection: TugConnection;

  /** Current canvas state (two-table shape). */
  private deckState: DeckState;

  /** Debounce timer for layout saves */
  private saveTimer: number | null = null;

  // ---- Phase 5f: Per-card state cache (Spec S03, [D01], [D06]) ----

  /** In-memory cache of per-card state bags. Primary read source during a session. */
  private cardStateCache: Map<string, CardStateBag> = new Map();

  /** Debounce timer for per-card state saves (separate from layout save timer). */
  private cardStateSaveTimer: number | null = null;

  /** Set of card IDs with unsaved (dirty) state bags. Used for flush-on-destroy. */
  private dirtyCardIds: Set<string> = new Set();

  // ---- Phase 5f3: Save callbacks for close-time state flush (Spec S01, [D01]) ----

  /**
   * Map of registered save callbacks keyed by card ID. Called on
   * visibilitychange (hidden) and beforeunload so each active card can
   * capture its current state before the page is discarded.
   */
  private saveCallbacks: Map<string, () => void> = new Map();

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.stateFlushed) return;
      this.saveCallbacks.forEach((cb) => cb());
      this.flushDirtyCardStates();
    }
  };

  private reloadPending = false;

  private stateFlushed = false;

  private readonly handleBeforeUnload = (): void => {
    if (this.reloadPending || this.stateFlushed) return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.saveLayout();
    }
    this.saveCallbacks.forEach((cb) => cb());
    this.flushDirtyCardStates({ sync: true });
  };

  // ---- Phase 5f: Initial focused card ID for reload restoration ([D03]) ----

  public initialFocusedCardId: string | undefined;

  /** Single React root for the canvas */
  private reactRoot: Root | null = null;

  private initialLayout: object | null;

  private initialTheme: ThemeName;

  private cascadeIndex: number = 0;

  // ---- Subscribable store state (useSyncExternalStore contract) ----

  private subscribers: Set<() => void> = new Set();

  private stateVersion: number = 0;

  // ---- Stable bound callbacks ----

  public handleStackMoved: (
    stackId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;

  public handleStackClosed: (stackId: string) => void;

  public readonly cardLifecycle: CardLifecycle;

  public readonly appLifecycle: AppLifecycle;

  private readonly lifecycleCascade: LifecycleCascadeHandle;

  public addCardToStack: (stackId: string, componentId: string) => string | null;

  public removeCard: (stackId: string, cardId: string) => void;

  public setActiveCardInStack: (stackId: string, cardId: string) => void;

  public reorderCardInStack: (stackId: string, fromIndex: number, toIndex: number) => void;

  public detachCard: (stackId: string, cardId: string, position: { x: number; y: number }) => string | null;

  public moveCardToStack: (sourceStackId: string, cardId: string, targetStackId: string, insertAtIndex: number) => void;

  public toggleStackCollapse: (stackId: string) => void;

  // ---- useSyncExternalStore arrow properties (stable identity, auto-bound this) ----

  public subscribe = (callback: () => void): (() => void) => {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  };

  public getSnapshot = (): DeckState => this.deckState;

  public getVersion = (): number => this.stateVersion;

  // ---- CardLifecycleStore contract ----

  /**
   * The id of the currently-focused card (top of z-order). `null` when the
   * deck has no cards. Derived from deckState: the last stack in `stacks` is
   * the top of z-order, and its `activeCardId` is the focused card.
   */
  public getFocusedCardId = (): string | null => {
    const stacks = this.deckState.stacks;
    if (stacks.length === 0) return null;
    return stacks[stacks.length - 1].activeCardId;
  };

  // ---- CardLifecycle pass-throughs ----

  public activateCard = (cardId: string): void => {
    this._setFirstResponder(cardId);
  };

  /**
   * Read the composite first-responder bit: the active stack's
   * active card id, or `null` when no stack is active. At any
   * moment, exactly zero or one card is the first responder.
   */
  public getFirstResponderCardId = (): string | null => {
    const activeStackId = this.deckState.activeStackId;
    if (activeStackId === undefined) return null;
    const activeStack = this.deckState.stacks.find((s) => s.id === activeStackId);
    return activeStack?.activeCardId ?? null;
  };

  public observeCardDidFinishConstruction = (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): (() => void) =>
    this.cardLifecycle.observeCardDidFinishConstruction(cardId, callback);

  public observeCardDidActivate = (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): (() => void) => this.cardLifecycle.observeCardDidActivate(cardId, callback);

  public observeCardDidDeactivate = (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): (() => void) =>
    this.cardLifecycle.observeCardDidDeactivate(cardId, callback);

  public observeCardWillBeginDestruction = (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): (() => void) =>
    this.cardLifecycle.observeCardWillBeginDestruction(cardId, callback);

  public getActiveCardId = (): string | null =>
    this.cardLifecycle.getActiveCardId();

  public attachResponderChainManager = (
    manager: CardLifecycleManager | null,
  ): void => {
    this.cardLifecycle.setManager(manager);
  };

  constructor(
    container: HTMLElement,
    connection: TugConnection,
    initialLayout?: object,
    initialTheme?: ThemeName,
    initialCardStates?: Map<string, CardStateBag>,
    initialFocusedCardId?: string,
  ) {
    this.container = container;
    this.connection = connection;
    this.initialLayout = initialLayout ?? null;
    this.initialTheme = initialTheme ?? BASE_THEME_NAME;

    if (initialCardStates) {
      this.cardStateCache = new Map(initialCardStates);
    }

    this.initialFocusedCardId = initialFocusedCardId;

    container.style.position = "relative";

    this.reactRoot = createRoot(container);

    this.handleStackMoved = this.moveStack.bind(this);
    this.handleStackClosed = this._closeStack.bind(this);
    this.cardLifecycle = new CardLifecycle(this);
    registerCardLifecycle(this.cardLifecycle);
    this.appLifecycle = new AppLifecycle();
    registerAppLifecycle(this.appLifecycle);
    this.lifecycleCascade = installLifecycleCascade(
      this.cardLifecycle,
      this.appLifecycle,
    );
    this.addCardToStack = this._addCardToStack.bind(this);
    this.removeCard = this._removeCard.bind(this);
    this.setActiveCardInStack = this._setActiveCardInStack.bind(this);
    this.reorderCardInStack = this._reorderCardInStack.bind(this);
    this.detachCard = this._detachCard.bind(this);
    this.moveCardToStack = this._moveCardToStack.bind(this);
    this.toggleStackCollapse = this._toggleStackCollapse.bind(this);

    this.deckState = this.loadLayout();

    // Fire CONSTRUCTION for every card loaded from the saved layout so the
    // lifecycle's `constructedCards` set matches reality and later-subscribing
    // delegates receive initial-sync correctly.
    for (const card of this.deckState.cards) {
      this.cardLifecycle.notifyCardDidFinishConstruction(card.id);
    }

    this.pushCardListToHost();

    this.reactRoot.render(
      React.createElement(
        TugThemeProvider,
        { initialTheme: this.initialTheme },
        React.createElement(
          TugTooltipProvider,
          null,
          React.createElement(
            ErrorBoundary,
            null,
            React.createElement(
              ResponderChainProvider,
              null,
              React.createElement(
                DeckManagerContext.Provider,
                { value: this },
                React.createElement(
                  CardLifecycleContext.Provider,
                  { value: this.cardLifecycle },
                  React.createElement(
                    AppLifecycleContext.Provider,
                    { value: this.appLifecycle },
                    React.createElement(
                      TugAlertProvider,
                      null,
                      React.createElement(
                        TugBulletinProvider,
                        null,
                        React.createElement(TugBannerProvider, {
                          connection: this.connection,
                        }),
                        React.createElement(DeckCanvas, {}),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("beforeunload", this.handleBeforeUnload);
  }

  // ---- Store notification ----

  private notify(): void {
    // Dev-only invariant check. Fires after every mutation so violations
    // surface at the site that produced them rather than downstream where
    // the symptom manifests. Guarded so production builds pay no cost.
    if (isDevEnv()) {
      validateDeckState(this.deckState);
    }
    this.stateVersion += 1;
    this.subscribers.forEach((cb) => cb());
    this.pushCardListToHost();
  }

  /**
   * Push the current stack list (id, title, focused state, cardCount) to the
   * Swift host via WKScriptMessage so the View menu can build a dynamic stack
   * list. No-op when running outside a WKWebView (browser dev mode).
   *
   * Payload shape is a wire contract with `AppDelegate.swift`
   * (`updateCardList`). Keep the fields here in sync with the Swift reader.
   */
  private pushCardListToHost(): void {
    const webkit = (globalThis as unknown as Record<string, unknown>).webkit as Record<string, unknown> | undefined;
    const messageHandlers = webkit?.messageHandlers as Record<string, unknown> | undefined;
    const handler = messageHandlers?.cardList as { postMessage: (v: unknown) => void } | undefined;
    if (!handler) return;

    const stacks = this.deckState.stacks;
    const cardsById = new Map<string, CardState>();
    for (const c of this.deckState.cards) cardsById.set(c.id, c);
    const focusedStack = stacks.length > 0 ? stacks[stacks.length - 1] : null;
    const focusedId = focusedStack ? focusedStack.id : null;
    const list = stacks.map((s) => {
      const activeCard = cardsById.get(s.activeCardId);
      const firstCard = cardsById.get(s.cardIds[0]);
      const title = s.title || activeCard?.title || firstCard?.title || "Untitled";
      return { id: s.id, title, focused: s.id === focusedId, cardCount: s.cardIds.length };
    }).reverse();
    handler.postMessage(list);
  }

  refresh(): void {
    this.notify();
  }

  getDeckState(): DeckState {
    return this.getSnapshot();
  }

  sendControlFrame(action: string, params?: Record<string, unknown>): void {
    this.connection.sendControlFrame(action, params);
  }

  // ---- Card / stack management (Spec S05) ----

  /**
   * Add a new card from the registry, wrapped in a new single-card stack at
   * the cascaded position. Returns the generated card id, or null if no
   * registration is found for `componentId`.
   *
   * If the registration carries `defaultCards`, the stack is seeded with one
   * card per template (fresh UUIDs); otherwise a single card is created from
   * `defaultMeta`.
   */
  addCard(componentId: string): string | null {
    const registration = getRegistration(componentId);
    if (!registration) {
      console.warn(
        `[DeckManager] addCard: no registration found for componentId "${componentId}". ` +
          `Call registerCard() before addCard().`,
      );
      return null;
    }

    const stackId = crypto.randomUUID();
    const sizePolicy = getSizePolicy(componentId);
    const position = this.nextCascadePosition(sizePolicy.preferred);

    const seededCards: CardState[] = [];
    if (registration.defaultCards && registration.defaultCards.length > 0) {
      for (const template of registration.defaultCards) {
        seededCards.push({
          id: crypto.randomUUID(),
          componentId: template.componentId,
          title: template.title,
          closable: template.closable,
        });
      }
    } else {
      seededCards.push({
        id: crypto.randomUUID(),
        componentId,
        title: registration.defaultMeta.title,
        closable: registration.defaultMeta.closable !== false,
      });
    }

    const firstCardId = seededCards[0].id;
    const stack: CardStackState = {
      id: stackId,
      position,
      size: { width: sizePolicy.preferred.width, height: sizePolicy.preferred.height },
      cardIds: seededCards.map((c) => c.id),
      activeCardId: firstCardId,
      title: registration.defaultTitle ?? "",
      acceptsFamilies: registration.acceptsFamilies ?? ["standard"],
    };

    const oldFR = this.getFirstResponderCardId();
    const newFR = firstCardId;

    // Single-commit flip (transition 4): `oldFR` is snapshotted before
    // the mutation, so `_flipFirstResponder` fires the correct deactivate
    // pair even though the commit puts `activeStackId = stackId` (which
    // would make a state-derived `oldFR` read return `firstCardId`).
    this._flipFirstResponder(oldFR, newFR, () => {
      this.deckState = {
        ...this.deckState,
        cards: [...this.deckState.cards, ...seededCards],
        stacks: [...this.deckState.stacks, stack],
        activeStackId: stackId,
      };
      this.notify();
      this.scheduleSave();
      for (const c of seededCards) {
        this.cardLifecycle.notifyCardDidFinishConstruction(c.id);
      }
      putFocusedCardId(firstCardId);
    });

    return firstCardId;
  }

  /**
   * Close a stack by id.
   *
   * Plan 11.6.1b ordering: if the closing stack contains the first
   * responder, flip the composite bit to the new top-of-deck's active
   * card (or `null` when the deck becomes empty) BEFORE firing
   * `cardWillBeginDestruction`. Then fire destruction for every card in
   * the closed stack, mutate to remove the stack and its cards, and
   * notify.
   */
  _closeStack(stackId: string): void {
    const stack = this.deckState.stacks.find((s) => s.id === stackId);
    if (!stack) return;

    const oldFR = this.getFirstResponderCardId();
    const closedContainsOldFR =
      oldFR !== null && stack.cardIds.includes(oldFR);

    // Phase 1: flip the first responder to the new top-of-deck BEFORE
    // the destruction events. The closed stack is still in state at
    // this point — `_flipFirstResponder`'s commit just moves
    // `activeStackId` off the closing stack.
    if (closedContainsOldFR) {
      const remainingStacks = this.deckState.stacks.filter(
        (s) => s.id !== stackId,
      );
      const newTopStack =
        remainingStacks.length > 0
          ? remainingStacks[remainingStacks.length - 1]
          : null;
      const newFR = newTopStack?.activeCardId ?? null;
      const newActiveStackId = newTopStack?.id;
      this._flipFirstResponder(oldFR, newFR, () => {
        this.deckState = {
          ...this.deckState,
          ...(newActiveStackId !== undefined
            ? { activeStackId: newActiveStackId }
            : { activeStackId: undefined }),
        };
        this.notify();
        this.scheduleSave();
        if (newFR !== null) putFocusedCardId(newFR);
      });
    }

    // Phase 2: fire destruction for each card in the closed stack, then
    // remove the stack and its cards from state.
    for (const cid of stack.cardIds) {
      this.cardLifecycle.notifyCardWillBeginDestruction(cid);
    }
    const cardIdSet = new Set(stack.cardIds);
    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.filter((c) => !cardIdSet.has(c.id)),
      stacks: this.deckState.stacks.filter((s) => s.id !== stackId),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Flip the composite first-responder bit to `newFR`. The central
   * entry point for first-responder transitions. Handles:
   *
   *   - Old-FR lookup via `getFirstResponderCardId()` (reads the
   *     composite bit from current state).
   *   - Same-bit refresh (no events) when `oldFR === newFR`: still
   *     bumps z-order, refreshes the persisted focused-card pointer,
   *     and re-syncs the responder chain in case it drifted.
   *   - Full flip: fires `cardWillDeactivate(oldFR)` → `cardWillActivate(newFR)`
   *     → commits the state mutation (z-order + `activeStackId` +
   *     target stack's `activeCardId` + persisted pointer) → `notify()`
   *     → promotes the responder chain → `cardDidDeactivate(oldFR)` →
   *     `cardDidActivate(newFR)`.
   *
   * Piece 1 callers: public `activateCard`, `_closeStack`. Piece 2
   * routes every other mutator that can flip the bit through this
   * method.
   */
  private _setFirstResponder(newFR: string | null): void {
    const oldFR = this.getFirstResponderCardId();

    if (oldFR === newFR) {
      if (newFR !== null) {
        // Same-bit refresh: still bump z-order + persist + re-key
        // the responder chain so callers can force a refresh when
        // state has drifted (e.g., post-reload focus restoration).
        this.focusCard(newFR);
        this.cardLifecycle.setResponderChainKey(newFR);
      }
      return;
    }

    // Will phase — fires BEFORE any state mutation.
    if (oldFR !== null) this.cardLifecycle.notifyCardWillDeactivate(oldFR);
    if (newFR !== null) this.cardLifecycle.notifyCardWillActivate(newFR);

    // Commit state mutation.
    if (newFR === null) {
      // Deactivate to null: clear activeStackId without touching z-order
      // or individual stacks' activeCardId fields.
      this.deckState = { ...this.deckState, activeStackId: undefined };
      this.notify();
      this.scheduleSave();
    } else {
      // Bump host stack to the end of the stacks array (z-order top),
      // set activeStackId to the host, set host's activeCardId = newFR,
      // and persist the focused-card pointer. One commit, one notify.
      const stacks = this.deckState.stacks;
      const hostIdx = stacks.findIndex((s) => s.cardIds.includes(newFR));
      if (hostIdx === -1) {
        // newFR has no host stack (shouldn't happen in practice).
        // Bail without mutating; will/did deactivate already fired
        // for oldFR, but no activation fires for a non-existent card.
        return;
      }
      const hostStack = stacks[hostIdx];
      const updatedHost: CardStackState =
        hostStack.activeCardId === newFR
          ? hostStack
          : { ...hostStack, activeCardId: newFR };

      let newStacks: readonly CardStackState[];
      const isAtEnd = hostIdx === stacks.length - 1;
      if (isAtEnd && updatedHost === hostStack) {
        newStacks = stacks;
      } else if (isAtEnd) {
        newStacks = stacks.map((s, i) => (i === hostIdx ? updatedHost : s));
      } else {
        const reordered = [...stacks];
        reordered.splice(hostIdx, 1);
        reordered.push(updatedHost);
        newStacks = reordered;
      }

      this.deckState = {
        ...this.deckState,
        stacks: newStacks,
        activeStackId: updatedHost.id,
      };
      putFocusedCardId(newFR);
      this.notify();
      this.scheduleSave();

      this.cardLifecycle.setResponderChainKey(newFR);
    }

    // Did phase — observers read post-mutation state.
    if (oldFR !== null) this.cardLifecycle.notifyCardDidDeactivate(oldFR);
    if (newFR !== null) this.cardLifecycle.notifyCardDidActivate(newFR);
  }

  /**
   * Flip the composite first-responder bit from a caller-provided `oldFR`
   * to `newFR`, running the caller's `commit` in between. The caller is
   * responsible for all state mutation inside `commit` (including the
   * changes that take the composite bit from `oldFR` to `newFR`) and for
   * calling `notify()`/`scheduleSave()`.
   *
   * Use this helper instead of `_setFirstResponder` when the mutator
   * already has composite-bit mutations tangled up with non-composite-bit
   * mutations (adding/removing cards, reordering stacks) — passing
   * `oldFR` explicitly lets the helper avoid reading the composite bit
   * from state that has been partially mutated.
   *
   * Ordering:
   *   will-phase → commit → responder-chain promotion → did-phase.
   * Same-bit (`oldFR === newFR`) runs `commit` with no lifecycle events
   * and no responder-chain re-promotion.
   */
  private _flipFirstResponder(
    oldFR: string | null,
    newFR: string | null,
    commit: () => void,
  ): void {
    if (oldFR === newFR) {
      commit();
      return;
    }
    if (oldFR !== null) this.cardLifecycle.notifyCardWillDeactivate(oldFR);
    if (newFR !== null) this.cardLifecycle.notifyCardWillActivate(newFR);
    commit();
    if (newFR !== null) this.cardLifecycle.setResponderChainKey(newFR);
    if (oldFR !== null) this.cardLifecycle.notifyCardDidDeactivate(oldFR);
    if (newFR !== null) this.cardLifecycle.notifyCardDidActivate(newFR);
  }

  /**
   * Update a stack's position and size (called on drag-end / resize-end).
   *
   * Fires will/did lifecycle events for move/resize on the **active card** of
   * the stack (stacks, not cards, own position/size — but the active card is
   * the observable subject).
   */
  moveStack(
    stackId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ): void {
    const existing = this.deckState.stacks.find((s) => s.id === stackId);
    if (!existing) return;
    const positionChanged =
      existing.position.x !== position.x || existing.position.y !== position.y;
    const sizeChanged =
      existing.size.width !== size.width ||
      existing.size.height !== size.height;

    const activeCardId = existing.activeCardId;
    if (positionChanged) this.cardLifecycle.notifyCardWillMove(activeCardId);
    if (sizeChanged) this.cardLifecycle.notifyCardWillResize(activeCardId);

    this.deckState = {
      ...this.deckState,
      stacks: this.deckState.stacks.map((s) =>
        s.id === stackId ? { ...s, position, size } : s,
      ),
    };
    this.notify();

    if (positionChanged) this.cardLifecycle.notifyCardDidMove(activeCardId);
    if (sizeChanged) this.cardLifecycle.notifyCardDidResize(activeCardId);

    this.scheduleSave();
  }

  /**
   * Bring a card to front by moving its host stack to the end of the
   * `stacks` array. End-of-array = highest z-index by render order.
   *
   * Persists `focusedCardId` to tugbank (fire-and-forget) on every call so
   * clicking an already-focused card still updates the reload restoration
   * pointer. Also calls scheduleSave() so z-order changes land in the layout
   * blob.
   */
  focusCard(cardId: string): void {
    const stacks = this.deckState.stacks;
    const hostStackIndex = stacks.findIndex((s) => s.cardIds.includes(cardId));

    if (hostStackIndex !== -1) {
      putFocusedCardId(cardId);
    }

    if (hostStackIndex === -1 || hostStackIndex === stacks.length - 1) {
      if (hostStackIndex !== -1) {
        this.scheduleSave();
      }
      return;
    }
    const newStacks = [...stacks];
    const [focused] = newStacks.splice(hostStackIndex, 1);
    newStacks.push(focused);
    this.deckState = {
      ...this.deckState,
      stacks: newStacks,
      activeStackId: focused.id,
    };
    this.notify();
    this.scheduleSave();
  }

  // ---- Arrange (cascade / tile) ----

  /**
   * Rearrange all stacks on the canvas.
   *
   * - `cascade`: diagonal cascade from top-left, each offset by CASCADE_STEP.
   * - `tile`: grid layout filling the canvas.
   */
  arrangeCards(mode: "cascade" | "tile"): void {
    const stacks = this.deckState.stacks;
    if (stacks.length === 0) return;

    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;

    const cardsById = new Map<string, CardState>();
    for (const c of this.deckState.cards) cardsById.set(c.id, c);

    let arranged: CardStackState[];

    if (mode === "cascade") {
      const ORIGIN = 10;
      arranged = stacks.map((stack, i) => {
        const x = ORIGIN + CASCADE_STEP * i;
        const y = ORIGIN + CASCADE_STEP * i;
        return { ...stack, position: { x, y } };
      });
    } else {
      const n = stacks.length;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const GAP = 5;
      const tileW = Math.floor((canvasWidth - GAP * (cols + 1)) / cols);
      const tileH = Math.floor((canvasHeight - GAP * (rows + 1)) / rows);

      arranged = stacks.map((stack, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = GAP + col * (tileW + GAP);
        const y = GAP + row * (tileH + GAP);

        const activeCard = cardsById.get(stack.activeCardId);
        const fallbackCard =
          activeCard ?? cardsById.get(stack.cardIds[0]);
        const componentId = fallbackCard?.componentId;
        const policy = componentId ? getSizePolicy(componentId) : undefined;
        const minW = policy?.min.width ?? 250;
        const minH = policy?.min.height ?? 180;
        const width = Math.max(minW, tileW);
        const height = Math.max(minH, tileH);

        return {
          ...stack,
          position: { x, y },
          size: { width, height },
        };
      });
    }

    const changes: { id: string; positionChanged: boolean; sizeChanged: boolean }[] = [];
    for (let i = 0; i < stacks.length; i++) {
      const before = stacks[i];
      const after = arranged[i];
      changes.push({
        id: after.activeCardId,
        positionChanged:
          before.position.x !== after.position.x ||
          before.position.y !== after.position.y,
        sizeChanged:
          before.size.width !== after.size.width ||
          before.size.height !== after.size.height,
      });
    }

    for (const ch of changes) {
      if (ch.positionChanged) this.cardLifecycle.notifyCardWillMove(ch.id);
      if (ch.sizeChanged) this.cardLifecycle.notifyCardWillResize(ch.id);
    }

    this.deckState = { ...this.deckState, stacks: arranged };
    this.notify();

    for (const ch of changes) {
      if (ch.positionChanged) this.cardLifecycle.notifyCardDidMove(ch.id);
      if (ch.sizeChanged) this.cardLifecycle.notifyCardDidResize(ch.id);
    }

    this.scheduleSave();
  }

  // ---- Per-card state cache API (Spec S03, [D01], [D06]) ----

  getCardState(cardId: string): CardStateBag | undefined {
    return this.cardStateCache.get(cardId);
  }

  setCardState(cardId: string, bag: CardStateBag): void {
    this.cardStateCache.set(cardId, bag);
    this.dirtyCardIds.add(cardId);

    if (this.cardStateSaveTimer !== null) {
      window.clearTimeout(this.cardStateSaveTimer);
    }
    this.cardStateSaveTimer = window.setTimeout(() => {
      this.flushDirtyCardStates();
      this.cardStateSaveTimer = null;
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Write all dirty per-card state bags to tugbank and clear the dirty set.
   *
   * The underlying tugbank row prefix is still `tabstate/{id}` (unchanged
   * external wire format — cleanup is out of scope for Piece 2). `putTabState`
   * uses the cardId, which is numerically identical to the former tabId.
   */
  private flushDirtyCardStates(options?: { keepalive?: boolean; sync?: boolean }): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const cardId of this.dirtyCardIds) {
      const bag = this.cardStateCache.get(cardId);
      if (bag !== undefined) {
        promises.push(putTabState(cardId, bag, options));
      }
    }
    this.dirtyCardIds.clear();
    return Promise.all(promises).then(() => {});
  }

  // ---- Save callback registration (Spec S01, [D01]) ----

  registerSaveCallback(id: string, callback: () => void): void {
    this.saveCallbacks.set(id, callback);
  }

  unregisterSaveCallback(id: string): void {
    this.saveCallbacks.delete(id);
  }

  invokeSaveCallback(id: string): void {
    this.saveCallbacks.get(id)?.();
  }

  saveAndFlushSync(): void {
    this.saveCallbacks.forEach((cb) => cb());
    this.flushDirtyCardStates({ sync: true });
    this.stateFlushed = true;
  }

  saveAndFlush(): void {
    this.saveCallbacks.forEach((cb) => cb());
    this.flushDirtyCardStates();
  }

  async prepareForReload(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveLayout();
    this.saveCallbacks.forEach((cb) => cb());
    await this.flushDirtyCardStates();
    this.reloadPending = true;
  }

  // ---- Stack/card mutators (Spec S03) ----

  /**
   * Add a new card to an existing stack. Creates a fresh card, appends its id
   * to the stack's `cardIds`, and sets it as the stack's `activeCardId`.
   *
   * Plan 11.6.1b transitions 5a/5b: when `stackId` is the deck's active
   * stack, the new card becomes first responder (full flip). When it is
   * not, the new card becomes the stack's active-in-stack but the deck's
   * composite first-responder bit is unchanged (no lifecycle events).
   */
  private _addCardToStack(stackId: string, componentId: string): string | null {
    const stack = this.deckState.stacks.find((s) => s.id === stackId);
    if (!stack) {
      console.warn(`[DeckManager] addCardToStack: stack "${stackId}" not found.`);
      return null;
    }
    const registration = getRegistration(componentId);
    if (!registration) {
      console.warn(
        `[DeckManager] addCardToStack: no registration found for componentId "${componentId}".`,
      );
      return null;
    }

    const cardId = crypto.randomUUID();
    const newCard: CardState = {
      id: cardId,
      componentId,
      title: registration.defaultMeta.title,
      closable: registration.defaultMeta.closable !== false,
    };

    const isActiveStack = stackId === this.deckState.activeStackId;
    const oldFR = this.getFirstResponderCardId();
    // Post-mutation the stack's `activeCardId` is always `cardId`; the
    // composite bit only flips when the stack is the deck's active stack.
    const newFR = isActiveStack ? cardId : oldFR;

    const updatedStack: CardStackState = {
      ...stack,
      cardIds: [...stack.cardIds, cardId],
      activeCardId: cardId,
    };

    // Single-commit flip. For the inactive-stack case (transition 5b),
    // `oldFR === newFR`, so `_flipFirstResponder` runs commit only — no
    // lifecycle events. Construction fires inside commit so it lands
    // between the will and did phases for transition 5a, and right after
    // the commit-notify for transition 5b.
    this._flipFirstResponder(oldFR, newFR, () => {
      this.deckState = {
        ...this.deckState,
        cards: [...this.deckState.cards, newCard],
        stacks: this.deckState.stacks.map((s) => (s.id === stackId ? updatedStack : s)),
      };
      this.notify();
      this.scheduleSave();
      this.cardLifecycle.notifyCardDidFinishConstruction(cardId);
      if (isActiveStack) putFocusedCardId(cardId);
    });

    return cardId;
  }

  /**
   * Remove a card from a stack.
   *
   * If the card is the only one in the stack, closes the whole stack via
   * `_closeStack`. Otherwise removes the card from `deckState.cards` and
   * from the stack's `cardIds`, reassigning `activeCardId` if needed.
   *
   * Plan 11.6.1b transition 8a: when the removed card is the first
   * responder, flip the composite bit to the neighbor (via
   * `_flipFirstResponder`) BEFORE firing `cardWillBeginDestruction`.
   */
  private _removeCard(stackId: string, cardId: string): void {
    const stack = this.deckState.stacks.find((s) => s.id === stackId);
    if (!stack) return;
    if (!stack.cardIds.includes(cardId)) return;

    if (stack.cardIds.length === 1) {
      this._closeStack(stackId);
      return;
    }

    const oldFR = this.getFirstResponderCardId();
    const wasRemovingFR = oldFR === cardId;
    const spliced = spliceCardFromStack(stack, cardId);
    // `cardIds.length > 1` above guarantees a survivor → activeCardId !== null.
    const newActiveCardId = spliced.activeCardId as string;

    // Phase 1 (FR-removal only): flip composite bit to the neighbor
    // BEFORE destruction, per plan. Commit updates `stack.activeCardId`
    // but leaves `cardId` in `stack.cardIds` — destruction in phase 2
    // removes it. Two commits, two notifies.
    if (wasRemovingFR) {
      this._flipFirstResponder(oldFR, newActiveCardId, () => {
        const flippedStack: CardStackState = {
          ...stack,
          activeCardId: newActiveCardId,
        };
        this.deckState = {
          ...this.deckState,
          stacks: this.deckState.stacks.map((s) =>
            s.id === stackId ? flippedStack : s,
          ),
        };
        this.notify();
        this.scheduleSave();
        putFocusedCardId(newActiveCardId);
      });
    }

    // Phase 2: destruction + removal.
    this.cardLifecycle.notifyCardWillBeginDestruction(cardId);
    const currentStack =
      this.deckState.stacks.find((s) => s.id === stackId) ?? stack;
    const finalStack: CardStackState = {
      ...currentStack,
      cardIds: currentStack.cardIds.filter((id) => id !== cardId),
    };
    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.filter((c) => c.id !== cardId),
      stacks: this.deckState.stacks.map((s) => (s.id === stackId ? finalStack : s)),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Set the active card in a stack. No-op if `cardId` is not in the
   * stack or is already the stack's `activeCardId`.
   *
   * Plan 11.6.1b transition 2 vs transition-5b's sibling:
   *   - When `stackId` is the deck's active stack, flipping the stack's
   *     active-in-stack card also flips the composite first-responder
   *     bit. Route through `_setFirstResponder` so lifecycle events fire.
   *   - When `stackId` is not the deck's active stack, flip the stack's
   *     active-in-stack card with a raw mutation — no lifecycle events,
   *     no first-responder change.
   */
  private _setActiveCardInStack(stackId: string, cardId: string): void {
    const stack = this.deckState.stacks.find((s) => s.id === stackId);
    if (!stack) return;
    if (!stack.cardIds.includes(cardId)) return;
    if (stack.activeCardId === cardId) return;

    if (stackId === this.deckState.activeStackId) {
      this._setFirstResponder(cardId);
      return;
    }

    const updatedStack: CardStackState = { ...stack, activeCardId: cardId };
    this.deckState = {
      ...this.deckState,
      stacks: this.deckState.stacks.map((s) => (s.id === stackId ? updatedStack : s)),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Reorder a card within its stack.
   */
  private _reorderCardInStack(stackId: string, fromIndex: number, toIndex: number): void {
    const stack = this.deckState.stacks.find((s) => s.id === stackId);
    if (!stack) return;

    const len = stack.cardIds.length;
    if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len) return;
    if (fromIndex === toIndex) return;

    const newCardIds = [...stack.cardIds];
    const [moved] = newCardIds.splice(fromIndex, 1);
    newCardIds.splice(toIndex, 0, moved);

    const updatedStack: CardStackState = { ...stack, cardIds: newCardIds };
    this.deckState = {
      ...this.deckState,
      stacks: this.deckState.stacks.map((s) => (s.id === stackId ? updatedStack : s)),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Detach a card from its source stack into a new single-card stack at the
   * clamped position. If the source stack becomes empty, close it (via
   * `_closeStack`). Returns the new stack's id.
   *
   * Unlike the pre-Card/CardStack implementation, card identity is preserved:
   * the card object moves from the source stack's `cardIds` into the new
   * stack's `cardIds`. Tugcast sessions, portal DOM, and React state survive.
   */
  private _detachCard(
    stackId: string,
    cardId: string,
    position: { x: number; y: number },
  ): string | null {
    const stack = this.deckState.stacks.find((s) => s.id === stackId);
    if (!stack) return null;
    if (!stack.cardIds.includes(cardId)) return null;

    // Last-card guard: cannot detach the only card (that's just moving the
    // stack, not detaching).
    if (stack.cardIds.length === 1) return null;

    const card = this.deckState.cards.find((c) => c.id === cardId);
    if (!card) return null;

    const sizePolicy = getSizePolicy(card.componentId);

    const TITLE_BAR_VISIBLE_MIN_X = 100;
    const TITLE_BAR_HEIGHT = 36;
    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;
    const clampedX = Math.max(
      -(sizePolicy.preferred.width - TITLE_BAR_VISIBLE_MIN_X),
      Math.min(position.x, canvasWidth - TITLE_BAR_VISIBLE_MIN_X),
    );
    const clampedY = Math.max(0, Math.min(position.y, canvasHeight - TITLE_BAR_HEIGHT));

    const newStackId = crypto.randomUUID();
    const newStack: CardStackState = {
      id: newStackId,
      position: { x: clampedX, y: clampedY },
      size: { width: sizePolicy.preferred.width, height: sizePolicy.preferred.height },
      cardIds: [cardId],
      activeCardId: cardId,
      title: "",
      acceptsFamilies: stack.acceptsFamilies,
    };

    // Source keeps at least one card (last-card guard above), so
    // `spliced.activeCardId` is guaranteed non-null here.
    const spliced = spliceCardFromStack(stack, cardId);
    const updatedSourceStack: CardStackState = {
      ...stack,
      cardIds: spliced.cardIds,
      activeCardId: spliced.activeCardId as string,
    };

    const oldFR = this.getFirstResponderCardId();

    // Phase 1: insert the new stack and patch the source, but leave
    // `activeStackId` unchanged. `_flipFirstResponder` below handles
    // the composite-bit commit. Card identity is preserved, so no
    // construction event fires.
    this.deckState = {
      ...this.deckState,
      stacks: [
        ...this.deckState.stacks.map((s) =>
          s.id === stackId ? updatedSourceStack : s,
        ),
        newStack,
      ],
    };
    this.notify();
    this.scheduleSave();

    // Phase 2: flip to `cardId`. Transition 6 (cardId was already FR)
    // → same-bit, no events. Transition 6b (cardId was not FR) → full
    // flip. In both cases the commit sets `activeStackId = newStackId`.
    this._flipFirstResponder(oldFR, cardId, () => {
      this.deckState = { ...this.deckState, activeStackId: newStackId };
      this.notify();
      this.scheduleSave();
      putFocusedCardId(cardId);
    });

    return newStackId;
  }

  /**
   * Move a card from its source stack to a target stack at `insertAtIndex`.
   *
   * Card identity is preserved. If the source stack becomes empty (it had
   * only this card), the source stack is closed.
   */
  private _moveCardToStack(
    sourceStackId: string,
    cardId: string,
    targetStackId: string,
    insertAtIndex: number,
  ): void {
    if (sourceStackId === targetStackId) return;

    const sourceStack = this.deckState.stacks.find((s) => s.id === sourceStackId);
    if (!sourceStack || !sourceStack.cardIds.includes(cardId)) return;

    const targetStack = this.deckState.stacks.find((s) => s.id === targetStackId);
    if (!targetStack) return;

    const sourceWillBeDestroyed = sourceStack.cardIds.length === 1;
    const sourceIsActive = this.deckState.activeStackId === sourceStackId;

    // Post-move `activeStackId`: shift to target when the source was
    // active AND will be destroyed (otherwise we'd leave a stale
    // reference to a removed stack). In every other case `activeStackId`
    // stays put — plan transition 7 only flips the first responder when
    // the target is/becomes the active stack.
    const postMoveActiveStackId =
      sourceWillBeDestroyed && sourceIsActive
        ? targetStackId
        : this.deckState.activeStackId;

    const spliced = spliceCardFromStack(sourceStack, cardId);
    const oldFR = this.getFirstResponderCardId();

    // Determine the composite first-responder bit after the move.
    let newFR: string | null;
    if (postMoveActiveStackId === targetStackId) {
      // Target is/becomes the active stack → moved card is first responder.
      newFR = cardId;
    } else if (
      postMoveActiveStackId === sourceStackId &&
      !sourceWillBeDestroyed
    ) {
      // Source remains active; its new `activeCardId` depends on whether
      // the moved card was the source's active-in-stack pre-move.
      newFR = spliced.activeCardId;
    } else if (postMoveActiveStackId !== undefined) {
      const other = this.deckState.stacks.find(
        (s) => s.id === postMoveActiveStackId,
      );
      newFR = other?.activeCardId ?? null;
    } else {
      newFR = null;
    }

    // Plan 11.6.1b transition 7 / 7b: flip composite bit iff it changes.
    // Card identity is preserved across the move, so no destruction event.
    this._flipFirstResponder(oldFR, newFR, () => {
      let intermediateStacks: readonly CardStackState[] = this.deckState.stacks;
      if (spliced.activeCardId === null) {
        intermediateStacks = intermediateStacks.filter(
          (s) => s.id !== sourceStackId,
        );
      } else {
        const updatedSourceStack: CardStackState = {
          ...sourceStack,
          cardIds: spliced.cardIds,
          activeCardId: spliced.activeCardId,
        };
        intermediateStacks = intermediateStacks.map((s) =>
          s.id === sourceStackId ? updatedSourceStack : s,
        );
      }

      const clampedIndex = Math.max(
        0,
        Math.min(insertAtIndex, targetStack.cardIds.length),
      );
      const newTargetCardIds = [...targetStack.cardIds];
      newTargetCardIds.splice(clampedIndex, 0, cardId);
      const updatedTargetStack: CardStackState = {
        ...targetStack,
        cardIds: newTargetCardIds,
        activeCardId: cardId,
      };
      const finalStacks = intermediateStacks.map((s) =>
        s.id === targetStackId ? updatedTargetStack : s,
      );

      this.deckState = {
        ...this.deckState,
        stacks: finalStacks,
        ...(postMoveActiveStackId !== undefined
          ? { activeStackId: postMoveActiveStackId }
          : { activeStackId: undefined }),
      };
      this.notify();
      this.scheduleSave();
      if (newFR !== null) putFocusedCardId(newFR);
    });
  }

  // ---- Collapse management ----

  /**
   * Flip the stack's `collapsed` flag and notify subscribers (H-A8).
   *
   * Collapse/expand is an **appearance-zone** transition per [L06]:
   * `CardFrame` reads `CardState.collapsed` and overrides the rendered
   * height to `CARD_TITLE_BAR_HEIGHT` via CSS/DOM when collapsed.
   * `CardState.size` (the stored geometry) is not touched — restoring
   * the full height on expand is a pure re-read of the original value.
   *
   * Because no data-zone geometry changed, the move/resize lifecycle
   * events stay silent: `cardWillResize` / `cardDidResize` do NOT fire
   * on collapse or expand. Subscribers that care about collapse
   * specifically should subscribe to the deck-manager store directly —
   * `CardState.collapsed` flips on each toggle and store subscribers
   * see the transition in their snapshot. Bolting collapse onto the
   * resize event channel would make `cardDidResize` a false positive
   * for every card that ever collapsed, which defeats the point of
   * the delegate.
   */
  private _toggleStackCollapse(stackId: string): void {
    const stack = this.deckState.stacks.find((s) => s.id === stackId);
    if (!stack) return;

    const nowCollapsed = !stack.collapsed;
    const updatedStack: CardStackState = nowCollapsed
      ? { ...stack, collapsed: true as const }
      : { ...stack, collapsed: undefined };

    this.deckState = {
      ...this.deckState,
      stacks: this.deckState.stacks.map((s) => (s.id === stackId ? updatedStack : s)),
    };
    this.notify();
    this.scheduleSave();
  }

  // ---- Cascade positioning ----

  private nextCascadePosition(stackSize: { width: number; height: number }): { x: number; y: number } {
    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;

    const CASCADE_ORIGIN = 10;
    const x = CASCADE_ORIGIN + CASCADE_STEP * this.cascadeIndex;
    const y = CASCADE_ORIGIN + CASCADE_STEP * this.cascadeIndex;

    if (x + stackSize.width > canvasWidth || y + stackSize.height > canvasHeight) {
      this.cascadeIndex = 0;
      return { x: CASCADE_ORIGIN, y: CASCADE_ORIGIN };
    }

    this.cascadeIndex += 1;
    return { x, y };
  }

  // ---- Layout Persistence ----

  private loadLayout(): DeckState {
    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;

    let state: DeckState | null = null;

    if (this.initialLayout !== null) {
      try {
        const json = JSON.stringify(this.initialLayout);
        state = deserialize(json, canvasWidth, canvasHeight);
      } catch (e) {
        console.warn("DeckManager: failed to deserialize initialLayout from API, falling back", e);
      }
      this.initialLayout = null;
    }

    if (state === null) {
      state = buildDefaultLayout();
    }

    return this.filterRegisteredCards(state);
  }

  private saveLayout(): Promise<void> {
    const serialized = serialize(this.deckState);
    return putLayout(serialized);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveLayout();
      this.saveTimer = null;
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Filter out cards whose componentIds are not registered and, as a result,
   * any stacks that lose all their cards.
   *
   * For each card: if `componentId` is not registered, drop the card.
   * For each stack: if all its cardIds now point to dropped cards, drop the
   * stack. Otherwise rewrite `cardIds` to reference only remaining cards and
   * fall `activeCardId` back to the first surviving card id.
   */
  private filterRegisteredCards(state: DeckState): DeckState {
    let changed = false;

    const keptCards: CardState[] = [];
    const droppedCardIds = new Set<string>();
    for (const card of state.cards) {
      if (!card.componentId || !getRegistration(card.componentId)) {
        console.warn(
          `[DeckManager] filterRegisteredCards: dropping card "${card.id}" — ` +
            `unregistered componentId "${card.componentId ?? "(none)"}".`,
        );
        droppedCardIds.add(card.id);
        changed = true;
        continue;
      }
      keptCards.push(card);
    }

    const keptStacks: CardStackState[] = [];
    for (const stack of state.stacks) {
      const survivingCardIds = stack.cardIds.filter(
        (id) => !droppedCardIds.has(id),
      );
      if (survivingCardIds.length === 0) {
        console.warn(
          `[DeckManager] filterRegisteredCards: dropping stack "${stack.id}" — ` +
            `all cards had unregistered componentIds.`,
        );
        changed = true;
        continue;
      }
      let activeCardId = stack.activeCardId;
      if (!survivingCardIds.includes(activeCardId)) {
        activeCardId = survivingCardIds[0];
        changed = true;
      }
      if (
        survivingCardIds.length !== stack.cardIds.length ||
        activeCardId !== stack.activeCardId
      ) {
        keptStacks.push({ ...stack, cardIds: survivingCardIds, activeCardId });
      } else {
        keptStacks.push(stack);
      }
    }

    if (!changed) return state;

    const keptStackIds = new Set(keptStacks.map((s) => s.id));
    const activeStackId =
      state.activeStackId !== undefined && keptStackIds.has(state.activeStackId)
        ? state.activeStackId
        : undefined;

    return {
      ...state,
      cards: keptCards,
      stacks: keptStacks,
      ...(activeStackId !== undefined ? { activeStackId } : { activeStackId: undefined }),
    };
  }

  /**
   * Apply an external DeckState, notify subscribers, and schedule a save.
   *
   * Validates the two-table invariants **unconditionally** after
   * filtering — `applyLayout` is the external-input gate, and bad shapes
   * must fail loudly in every build, not just dev.
   *
   * @deprecated Test-only today (H-A7). Fires no lifecycle events: no
   *   `cardDidFinishConstruction` for cards that appear in the new
   *   state, no `cardWillBeginDestruction` for cards that disappear,
   *   no first-responder flip even when the new state changes the
   *   composite bit. If a production caller ever needs to swap the
   *   deck state wholesale, replace this method with a diff-based
   *   implementation that drives the changes through
   *   `addCardToStack` / `removeCard` / `_setFirstResponder` so the
   *   lifecycle stays consistent. Do not reuse `applyLayout` as-is —
   *   adding one more caller to the event-free path compounds the
   *   drift risk.
   */
  applyLayout(deckState: DeckState): void {
    this.deckState = this.filterRegisteredCards(deckState);
    validateDeckState(this.deckState);
    this.notify();
    this.scheduleSave();
  }

  destroy(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.saveLayout();
    }

    if (this.cardStateSaveTimer !== null) {
      window.clearTimeout(this.cardStateSaveTimer);
      this.cardStateSaveTimer = null;
      this.flushDirtyCardStates();
    }

    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("beforeunload", this.handleBeforeUnload);

    this.lifecycleCascade.dispose();
  }
}
