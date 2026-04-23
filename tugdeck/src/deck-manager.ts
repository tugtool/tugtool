/**
 * DeckManager -- orchestrates card state and the React render pipeline.
 *
 * Operates against the two-table model: `deckState.cards` (content
 * identities) and `deckState.panes` (visual frames). Every public mutator
 * keeps the two tables in sync, preserving the invariants documented in
 * `layout-tree.ts` (no orphan cards, no empty panes, activeCardId ∈ cardIds).
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
  type TugPaneState,
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
import { putLayout, putCardState, putFocusedCardId } from "./settings-api";
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
import { registerDeckStore } from "./lib/deck-store-registry";
import { isDevEnv } from "./lib/dev-env";
import {
  installLifecycleCascade,
  type LifecycleCascadeHandle,
} from "./lib/lifecycle-cascade";
import { ComponentPersistenceRegistry } from "./components/tugways/component-persistence-registry";

/** Debounce delay for saving layout (ms) */
const SAVE_DEBOUNCE_MS = 500;

/** Cascade step between consecutive new stacks (pixels) */
const CASCADE_STEP = 30;

/**
 * Pure helper: remove `cardId` from the stack's `cardIds` and pick a new
 * `activeCardId` if the removed card was active. Mirrors the fallback rule
 * used by `_removeCard`, `_detachCard`, and `_moveCardToPane`: the previous
 * card becomes active, or the first card if the removed card was first.
 *
 * Returns `activeCardId: null` when the stack is left empty — the caller
 * decides what to do (close the stack, or drop it because its card moved
 * elsewhere). Returns the input references unchanged when `cardId` is not
 * in `cardIds`.
 */
function spliceCardFromStack(
  win: TugPaneState,
  cardId: string,
): { cardIds: readonly string[]; activeCardId: string | null } {
  const cardIndex = win.cardIds.indexOf(cardId);
  if (cardIndex === -1) {
    return { cardIds: win.cardIds, activeCardId: win.activeCardId };
  }
  const cardIds = win.cardIds.filter((id) => id !== cardId);
  if (cardIds.length === 0) {
    return { cardIds, activeCardId: null };
  }
  let activeCardId = win.activeCardId;
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

  /**
   * Per-card Component Persistence Protocol registries ([D13], [A9]).
   * Lazily created on first `getComponentRegistry(cardId)` call from a
   * child component's `useComponentPersistence` hook; cleared when the
   * card is destroyed (`_removeCard` / `_closePane`). A card that uses
   * no opt-in components never gets an entry here.
   */
  private componentRegistries: Map<string, ComponentPersistenceRegistry> =
    new Map();

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

  public handlePaneMoved: (
    paneId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;

  public handlePaneClosed: (paneId: string) => void;

  public readonly cardLifecycle: CardLifecycle;

  public readonly appLifecycle: AppLifecycle;

  private readonly lifecycleCascade: LifecycleCascadeHandle;

  public addCardToPane: (paneId: string, componentId: string) => string | null;

  public removeCard: (paneId: string, cardId: string) => void;

  public setActiveCardInPane: (paneId: string, cardId: string) => void;

  public reorderCardInPane: (paneId: string, fromIndex: number, toIndex: number) => void;

  public detachCard: (paneId: string, cardId: string, position: { x: number; y: number }) => string | null;

  public moveCardToPane: (sourcePaneId: string, cardId: string, targetPaneId: string, insertAtIndex: number) => void;

  public togglePaneCollapse: (paneId: string) => void;

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
    const stacks = this.deckState.panes;
    if (stacks.length === 0) return null;
    return stacks[stacks.length - 1].activeCardId;
  };

  // ---- CardLifecycle pass-throughs ----

  public activateCard = (cardId: string): void => {
    this._flipFirstResponder(cardId, () =>
      this._commitStandardFirstResponderFlip(cardId),
    );
    // Same-bit refresh: re-clicking the already-active card re-syncs
    // the responder chain against any drift. The flip helper skips
    // setResponderChainKey in the same-bit branch, so call it here.
    // Idempotent when the responder chain's key card is already cardId.
    this.cardLifecycle.setResponderChainKey(cardId);
  };

  /**
   * Read the composite first-responder bit: the active stack's
   * active card id, or `null` when no stack is active. At any
   * moment, exactly zero or one card is the first responder.
   */
  public getFirstResponderCardId = (): string | null => {
    const activePaneId = this.deckState.activePaneId;
    if (activePaneId === undefined) return null;
    const activeWin = this.deckState.panes.find((s) => s.id === activePaneId);
    return activeWin?.activeCardId ?? null;
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

    this.handlePaneMoved = this.movePane.bind(this);
    this.handlePaneClosed = this._closePane.bind(this);
    this.cardLifecycle = new CardLifecycle(this);
    registerCardLifecycle(this.cardLifecycle);
    this.appLifecycle = new AppLifecycle();
    registerAppLifecycle(this.appLifecycle);
    // Expose this store to non-React singletons (notably `selectionGuard`,
    // which `ResponderChainProvider` attaches from a `useLayoutEffect`
    // that sits outside the `DeckManagerContext` provider and so cannot
    // reach the store through React context).
    registerDeckStore(this);
    this.lifecycleCascade = installLifecycleCascade(
      this.cardLifecycle,
      this.appLifecycle,
    );
    this.addCardToPane = this._addCardToPane.bind(this);
    this.removeCard = this._removeCard.bind(this);
    this.setActiveCardInPane = this._setActiveCardInPane.bind(this);
    this.reorderCardInPane = this._reorderCardInPane.bind(this);
    this.detachCard = this._detachCard.bind(this);
    this.moveCardToPane = this._moveCardToPane.bind(this);
    this.togglePaneCollapse = this._togglePaneCollapse.bind(this);

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

    const stacks = this.deckState.panes;
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

    const paneId = crypto.randomUUID();
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
    const win: TugPaneState = {
      id: paneId,
      position,
      size: { width: sizePolicy.preferred.width, height: sizePolicy.preferred.height },
      cardIds: seededCards.map((c) => c.id),
      activeCardId: firstCardId,
      title: registration.defaultTitle ?? "",
      acceptsFamilies: registration.acceptsFamilies ?? ["standard"],
    };

    // Single-commit flip (transition 4). `_flipFirstResponder` reads
    // `oldFR` internally BEFORE running the commit, so it fires the
    // correct deactivate pair even though the commit puts
    // `activePaneId = paneId` (which would make a post-commit
    // state-derived read return `firstCardId`).
    this._flipFirstResponder(firstCardId, () => {
      this.deckState = {
        ...this.deckState,
        cards: [...this.deckState.cards, ...seededCards],
        panes: [...this.deckState.panes, win],
        activePaneId: paneId,
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
   * Ordering: if the closing stack contains the first responder, flip
   * the composite bit to the new top-of-deck's active card (or `null`
   * when the deck becomes empty) BEFORE firing
   * `cardWillBeginDestruction`. Then fire destruction for every card
   * in the closed stack, mutate to remove the stack and its cards,
   * and notify.
   *
   * Destruction order within the pane: `cardWillBeginDestruction` fires
   * once per card in the pane's `cardIds` array order — not z-order
   * within the pane, not active-card-first. Subscribers that care
   * about relative destruction order between siblings on the same
   * pane should subscribe per-id rather than relying on the wildcard
   * channel's sequence.
   */
  _closePane(paneId: string): void {
    const win = this.deckState.panes.find((s) => s.id === paneId);
    if (!win) return;

    const currentFR = this.getFirstResponderCardId();
    const closedContainsOldFR =
      currentFR !== null && win.cardIds.includes(currentFR);

    // Phase 1: flip the first responder to the new top-of-deck BEFORE
    // the destruction events. The closed stack is still in state at
    // this point — the commit just moves `activePaneId` off the
    // closing stack.
    if (closedContainsOldFR) {
      const remainingStacks = this.deckState.panes.filter(
        (s) => s.id !== paneId,
      );
      const newTopStack =
        remainingStacks.length > 0
          ? remainingStacks[remainingStacks.length - 1]
          : null;
      const newFR = newTopStack?.activeCardId ?? null;
      const newActivePaneId = newTopStack?.id;
      this._flipFirstResponder(newFR, () => {
        this.deckState = {
          ...this.deckState,
          ...(newActivePaneId !== undefined
            ? { activePaneId: newActivePaneId }
            : { activePaneId: undefined }),
        };
        this.notify();
        this.scheduleSave();
        if (newFR !== null) putFocusedCardId(newFR);
      });
    }

    // Phase 2: flush each card's save callback then fire destruction.
    // Save-on-close runs BEFORE destruction so the card's last bag
    // lands before subscribers tear down dependent state. [L23], [Q05].
    for (const cid of win.cardIds) {
      this.flushSaveCallbackBeforeDestruction(cid);
    }
    for (const cid of win.cardIds) {
      this.cardLifecycle.notifyCardWillBeginDestruction(cid);
    }
    const cardIdSet = new Set(win.cardIds);
    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.filter((c) => !cardIdSet.has(c.id)),
      panes: this.deckState.panes.filter((s) => s.id !== paneId),
    };
    // Discard per-card component-persistence registries ([A9]) after
    // destruction notifications have fired — subscribers observing
    // destruction never have a stake in these registries, but ordering
    // after the lifecycle event makes the intent explicit.
    for (const cid of win.cardIds) {
      this.discardComponentRegistry(cid);
    }
    this.notify();
    this.scheduleSave();
  }

  /**
   * Flip the composite first-responder bit to `newFR`, running the
   * caller's `commit` between the will and did phases. The central
   * entry point for first-responder transitions.
   *
   * The helper snapshots `oldFR` internally — from
   * `getFirstResponderCardId()` at entry, before any caller code
   * runs. Callers should NOT pre-mutate state that affects the
   * composite bit before calling this method; do all such mutations
   * inside `commit`.
   *
   * Ordering:
   *   - `oldFR === newFR`: run `commit` only. No lifecycle events,
   *     no responder-chain promotion. Callers that want a same-bit
   *     refresh (e.g. re-clicking the already-active card to re-sync
   *     a drifted responder chain) should call
   *     `cardLifecycle.setResponderChainKey(newFR)` themselves after
   *     this method returns.
   *   - `oldFR !== newFR`: `cardWillDeactivate(oldFR)` →
   *     `cardWillActivate(newFR)` → `commit` →
   *     `setResponderChainKey(newFR)` → `cardDidDeactivate(oldFR)` →
   *     `cardDidActivate(newFR)`.
   *
   * `commit` owns the state mutation, `notify()`, and `scheduleSave()`
   * (and any persistence side-effects specific to the caller, e.g.
   * `putFocusedCardId`). For the standard promote-a-card-to-FR
   * commit, use `_commitStandardFirstResponderFlip(newFR)`.
   */
  private _flipFirstResponder(
    newFR: string | null,
    commit: () => void,
  ): void {
    const oldFR = this.getFirstResponderCardId();
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
   * Standard commit body for a first-responder flip: bump `newFR`'s
   * host pane to z-top, set `activePaneId` and the host's
   * `activeCardId = newFR`, persist the focused-card pointer, then
   * notify and schedule a save. No-op on the composite bit when
   * `newFR === null` (clears `activePaneId` without touching
   * z-order or individual pane `activeCardId` fields, and does not
   * persist a focused card).
   *
   * Designed to be passed as the `commit` closure to
   * `_flipFirstResponder`. Use for promote-to-active transitions
   * where the caller has no other state mutation to bundle.
   */
  private _commitStandardFirstResponderFlip(newFR: string | null): void {
    if (newFR === null) {
      this.deckState = { ...this.deckState, activePaneId: undefined };
      this.notify();
      this.scheduleSave();
      return;
    }
    const stacks = this.deckState.panes;
    const hostIdx = stacks.findIndex((s) => s.cardIds.includes(newFR));
    if (hostIdx === -1) {
      // newFR has no host pane (shouldn't happen in practice). The
      // helper that wraps this commit has already fired
      // cardWillActivate(newFR); returning without mutation leaves
      // the did-phase to run (old behavior preserved) but the
      // composite bit is unchanged.
      return;
    }
    const hostStack = stacks[hostIdx];
    const updatedHost: TugPaneState =
      hostStack.activeCardId === newFR
        ? hostStack
        : { ...hostStack, activeCardId: newFR };

    let newStacks: readonly TugPaneState[];
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
      panes: newStacks,
      activePaneId: updatedHost.id,
    };
    putFocusedCardId(newFR);
    this.notify();
    this.scheduleSave();
  }

  /**
   * Update a pane's position and size (called on drag-end / resize-end).
   *
   * Fires will/did lifecycle events for move/resize on the **active card** of
   * the pane (panes, not cards, own position/size — but the active card is
   * the observable subject).
   */
  movePane(
    paneId: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ): void {
    const existing = this.deckState.panes.find((s) => s.id === paneId);
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
      panes: this.deckState.panes.map((s) =>
        s.id === paneId ? { ...s, position, size } : s,
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
    const stacks = this.deckState.panes;
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
      panes: newStacks,
      activePaneId: focused.id,
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
    const stacks = this.deckState.panes;
    if (stacks.length === 0) return;

    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;

    const cardsById = new Map<string, CardState>();
    for (const c of this.deckState.cards) cardsById.set(c.id, c);

    let arranged: TugPaneState[];

    if (mode === "cascade") {
      const ORIGIN = 10;
      arranged = stacks.map((win, i) => {
        const x = ORIGIN + CASCADE_STEP * i;
        const y = ORIGIN + CASCADE_STEP * i;
        return { ...win, position: { x, y } };
      });
    } else {
      const n = stacks.length;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const GAP = 5;
      const tileW = Math.floor((canvasWidth - GAP * (cols + 1)) / cols);
      const tileH = Math.floor((canvasHeight - GAP * (rows + 1)) / rows);

      arranged = stacks.map((win, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = GAP + col * (tileW + GAP);
        const y = GAP + row * (tileH + GAP);

        const activeCard = cardsById.get(win.activeCardId);
        const fallbackCard =
          activeCard ?? cardsById.get(win.cardIds[0]);
        const componentId = fallbackCard?.componentId;
        const policy = componentId ? getSizePolicy(componentId) : undefined;
        const minW = policy?.min.width ?? 250;
        const minH = policy?.min.height ?? 180;
        const width = Math.max(minW, tileW);
        const height = Math.max(minH, tileH);

        return {
          ...win,
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

    this.deckState = { ...this.deckState, panes: arranged };
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
   * Persists under `dev.tugtool.deck.cardstate/{cardId}`. `putCardState` uses
   * the card id, which is numerically identical to the former tab id from the one-table model.
   */
  private flushDirtyCardStates(options?: { keepalive?: boolean; sync?: boolean }): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const cardId of this.dirtyCardIds) {
      const bag = this.cardStateCache.get(cardId);
      if (bag !== undefined) {
        promises.push(putCardState(cardId, bag, options));
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

  /**
   * Return the per-card Component Persistence Protocol registry ([D13],
   * [A9]) for `cardId`, creating it lazily on first call. Used by
   * `useComponentPersistence` to register / unregister capture/restore
   * closures; used by the framework orchestration layer
   * (`captureCardState` / `restoreCardState`) at save and restore time.
   *
   * The registry is discarded in `discardComponentRegistry(cardId)` once
   * the card is destroyed, so repeated create / destroy cycles of the
   * same cardId yield fresh registries.
   */
  getComponentRegistry(cardId: string): ComponentPersistenceRegistry {
    let registry = this.componentRegistries.get(cardId);
    if (!registry) {
      registry = new ComponentPersistenceRegistry();
      this.componentRegistries.set(cardId, registry);
    }
    return registry;
  }

  /**
   * Look up a card's component registry without creating one. Returns
   * `undefined` when the card has never registered an opt-in component.
   * Used by the capture/restore orchestration so a non-participating card
   * incurs no allocation.
   */
  peekComponentRegistry(
    cardId: string,
  ): ComponentPersistenceRegistry | undefined {
    return this.componentRegistries.get(cardId);
  }

  /**
   * Discard the per-card component registry for `cardId`. Called from
   * `_removeCard` and `_closePane` alongside `flushSaveCallbackBeforeDestruction`
   * so a card's registered closures don't outlive the card itself.
   */
  private discardComponentRegistry(cardId: string): void {
    const registry = this.componentRegistries.get(cardId);
    if (!registry) return;
    registry.clear();
    this.componentRegistries.delete(cardId);
  }

  /**
   * Flush a card's save callback before the card's own destruction
   * runs. Called by close paths (`_removeCard`, `_closePane`) so the
   * card's last unsaved edits land in the bag before
   * `cardWillBeginDestruction` subscribers tear down dependent state
   * (engine teardown, session release, etc.). Per [Q05] the save
   * runs BEFORE the destruction notification — the reverse order
   * would let a destruction subscriber invalidate the state the save
   * callback is trying to read.
   *
   * The callback is wrapped in `try/catch` ([R06]) so a single
   * throwing save never blocks the destruction. In dev, a throw is
   * logged with enough context to find the offending card; in
   * production the failure is swallowed silently — the alternative
   * (blocking destruction and leaving the deck in an inconsistent
   * state) is strictly worse.
   */
  private flushSaveCallbackBeforeDestruction(cardId: string): void {
    try {
      this.invokeSaveCallback(cardId);
    } catch (err) {
      if (isDevEnv()) {
        console.warn(
          `[deck-manager] save callback threw during close for card "${cardId}"; ` +
            `destruction proceeds regardless.`,
          err,
        );
      }
    }
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
   * Plan 11.6.1b transitions 5a/5b: when `paneId` is the deck's active
   * stack, the new card becomes first responder (full flip). When it is
   * not, the new card becomes the stack's active-in-stack but the deck's
   * composite first-responder bit is unchanged (no lifecycle events).
   */
  private _addCardToPane(paneId: string, componentId: string): string | null {
    const win = this.deckState.panes.find((s) => s.id === paneId);
    if (!win) {
      console.warn(`[DeckManager] addCardToPane: stack "${paneId}" not found.`);
      return null;
    }
    const registration = getRegistration(componentId);
    if (!registration) {
      console.warn(
        `[DeckManager] addCardToPane: no registration found for componentId "${componentId}".`,
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

    const isActiveStack = paneId === this.deckState.activePaneId;
    // Post-mutation the stack's `activeCardId` is always `cardId`; the
    // composite bit only flips when the stack is the deck's active stack.
    // For the inactive-stack case pass the current FR so the helper
    // recognizes same-bit (no lifecycle events).
    const newFR = isActiveStack ? cardId : this.getFirstResponderCardId();

    const updatedStack: TugPaneState = {
      ...win,
      cardIds: [...win.cardIds, cardId],
      activeCardId: cardId,
    };

    // Single-commit flip. Construction fires inside commit so it lands
    // between the will and did phases for transition 5a, and right after
    // the commit-notify for transition 5b (inactive-stack, same-bit).
    this._flipFirstResponder(newFR, () => {
      this.deckState = {
        ...this.deckState,
        cards: [...this.deckState.cards, newCard],
        panes: this.deckState.panes.map((s) => (s.id === paneId ? updatedStack : s)),
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
   * `_closePane`. Otherwise removes the card from `deckState.cards` and
   * from the stack's `cardIds`, reassigning `activeCardId` if needed.
   *
   * **Save-on-close invariant ([L23], [Q05]):** the card's save
   * callback fires BEFORE `notifyCardWillBeginDestruction`, so the
   * last unsaved bag (scroll, DOM-selection, focus, form-controls,
   * region-scroll, engine content) lands in tugbank before
   * destruction subscribers release any dependent state. A throwing
   * save callback is caught and dev-warned; destruction proceeds
   * regardless per [R06].
   *
   * Transition 8a: when the removed card is the first responder, flip
   * the composite bit to the neighbor BEFORE firing
   * `cardWillBeginDestruction`.
   */
  private _removeCard(paneId: string, cardId: string): void {
    const win = this.deckState.panes.find((s) => s.id === paneId);
    if (!win) return;
    if (!win.cardIds.includes(cardId)) return;

    if (win.cardIds.length === 1) {
      this._closePane(paneId);
      return;
    }

    const wasRemovingFR = this.getFirstResponderCardId() === cardId;
    const spliced = spliceCardFromStack(win, cardId);
    // `cardIds.length > 1` above guarantees a survivor → activeCardId !== null.
    const newActiveCardId = spliced.activeCardId as string;

    // Phase 1 (FR-removal only): flip composite bit to the neighbor
    // BEFORE destruction. Commit updates `win.activeCardId` but
    // leaves `cardId` in `win.cardIds` — destruction in phase 2
    // removes it. Two commits, two notifies.
    if (wasRemovingFR) {
      this._flipFirstResponder(newActiveCardId, () => {
        const flippedStack: TugPaneState = {
          ...win,
          activeCardId: newActiveCardId,
        };
        this.deckState = {
          ...this.deckState,
          panes: this.deckState.panes.map((s) =>
            s.id === paneId ? flippedStack : s,
          ),
        };
        this.notify();
        this.scheduleSave();
        putFocusedCardId(newActiveCardId);
      });
    }

    // Phase 2: save, then destruction + removal. Save runs first so
    // the card's last bag is flushed before subscribers tear down
    // dependent state. [L23], [Q05].
    this.flushSaveCallbackBeforeDestruction(cardId);
    this.cardLifecycle.notifyCardWillBeginDestruction(cardId);
    const currentStack =
      this.deckState.panes.find((s) => s.id === paneId) ?? win;
    const finalStack: TugPaneState = {
      ...currentStack,
      cardIds: currentStack.cardIds.filter((id) => id !== cardId),
    };
    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.filter((c) => c.id !== cardId),
      panes: this.deckState.panes.map((s) => (s.id === paneId ? finalStack : s)),
    };
    this.discardComponentRegistry(cardId);
    this.notify();
    this.scheduleSave();
  }

  /**
   * Set the active card in a stack. No-op if `cardId` is not in the
   * stack or is already the stack's `activeCardId`.
   *
   * Transition 2 vs transition-5b's sibling:
   *   - When `paneId` is the deck's active stack, flipping the stack's
   *     active-in-stack card also flips the composite first-responder
   *     bit. Route through `_flipFirstResponder` with the standard
   *     commit so lifecycle events fire.
   *   - When `paneId` is not the deck's active stack, flip the stack's
   *     active-in-stack card with a raw mutation — no lifecycle events,
   *     no first-responder change. Subscribers that need to react to
   *     active-in-pane changes on inactive panes must subscribe to
   *     deck-state notifications directly (`deckManager.subscribe`)
   *     and diff `pane.activeCardId` themselves; the card-lifecycle
   *     channel is silent on this path.
   */
  private _setActiveCardInPane(paneId: string, cardId: string): void {
    const win = this.deckState.panes.find((s) => s.id === paneId);
    if (!win) return;
    if (!win.cardIds.includes(cardId)) return;
    if (win.activeCardId === cardId) return;

    if (paneId === this.deckState.activePaneId) {
      // Reached only when win.activeCardId !== cardId (guarded above),
      // so the composite bit is guaranteed to change — the helper's
      // same-bit branch is unreachable from here.
      this._flipFirstResponder(cardId, () =>
        this._commitStandardFirstResponderFlip(cardId),
      );
      return;
    }

    const updatedStack: TugPaneState = { ...win, activeCardId: cardId };
    this.deckState = {
      ...this.deckState,
      panes: this.deckState.panes.map((s) => (s.id === paneId ? updatedStack : s)),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Reorder a card within its stack.
   */
  private _reorderCardInPane(paneId: string, fromIndex: number, toIndex: number): void {
    const win = this.deckState.panes.find((s) => s.id === paneId);
    if (!win) return;

    const len = win.cardIds.length;
    if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len) return;
    if (fromIndex === toIndex) return;

    const newCardIds = [...win.cardIds];
    const [moved] = newCardIds.splice(fromIndex, 1);
    newCardIds.splice(toIndex, 0, moved);

    const updatedStack: TugPaneState = { ...win, cardIds: newCardIds };
    this.deckState = {
      ...this.deckState,
      panes: this.deckState.panes.map((s) => (s.id === paneId ? updatedStack : s)),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Detach a card from its source stack into a new single-card stack at the
   * clamped position. If the source stack becomes empty, close it (via
   * `_closePane`). Returns the new stack's id.
   *
   * Unlike the pre-Card/CardStack implementation, card identity is preserved:
   * the card object moves from the source stack's `cardIds` into the new
   * stack's `cardIds`. Tugcast sessions, portal DOM, and React state survive.
   *
   * **Fresh-bag invariant.** The card's save callback is invoked before the
   * commit so the per-card `CardStateBag` (scroll, selection, content
   * payload) reflects the card's live pre-move values. `CardHost`'s
   * `useCardContentRestore` re-fires on `hostStackId` change and will
   * re-apply the bag against the new pane's content element — re-applying a
   * stale bag would overwrite live scroll position with values from before
   * the user's most recent interaction, violating [L23]. Flushing here
   * closes the debounce window between the last edit and the move.
   */
  private _detachCard(
    paneId: string,
    cardId: string,
    position: { x: number; y: number },
  ): string | null {
    const win = this.deckState.panes.find((s) => s.id === paneId);
    if (!win) return null;
    if (!win.cardIds.includes(cardId)) return null;

    // Last-card guard: cannot detach the only card (that's just moving the
    // stack, not detaching).
    if (win.cardIds.length === 1) return null;

    // Fresh-bag invariant: see method docstring.
    this.invokeSaveCallback(cardId);

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

    const newPaneId = crypto.randomUUID();
    const newStack: TugPaneState = {
      id: newPaneId,
      position: { x: clampedX, y: clampedY },
      size: { width: sizePolicy.preferred.width, height: sizePolicy.preferred.height },
      cardIds: [cardId],
      activeCardId: cardId,
      title: "",
      acceptsFamilies: win.acceptsFamilies,
    };

    // Source keeps at least one card (last-card guard above), so
    // `spliced.activeCardId` is guaranteed non-null here.
    const spliced = spliceCardFromStack(win, cardId);
    const updatedSourceStack: TugPaneState = {
      ...win,
      cardIds: spliced.cardIds,
      activeCardId: spliced.activeCardId as string,
    };

    // Single-commit flip: insert new pane + patch source + move
    // `activePaneId` to the new pane, all in one notify. The helper
    // reads `oldFR` before commit, so transition 6 (cardId was
    // already FR → same-bit, no events) and transition 6b (cardId
    // was not FR → full flip) are distinguished correctly. Card
    // identity is preserved across the detach, so no construction
    // event fires.
    this._flipFirstResponder(cardId, () => {
      this.deckState = {
        ...this.deckState,
        panes: [
          ...this.deckState.panes.map((s) =>
            s.id === paneId ? updatedSourceStack : s,
          ),
          newStack,
        ],
        activePaneId: newPaneId,
      };
      this.notify();
      this.scheduleSave();
      putFocusedCardId(cardId);
    });

    return newPaneId;
  }

  /**
   * Move a card from its source stack to a target stack at `insertAtIndex`.
   *
   * Card identity is preserved. If the source stack becomes empty (it had
   * only this card), the source stack is closed.
   *
   * **Fresh-bag invariant.** The card's save callback is invoked before the
   * commit so the per-card `CardStateBag` (scroll, selection, content
   * payload) reflects the card's live pre-move values. `CardHost`'s
   * `useCardContentRestore` re-fires on `hostStackId` change and will
   * re-apply the bag against the target pane's content element —
   * re-applying a stale bag would overwrite live scroll position with
   * values from before the user's most recent interaction, violating
   * [L23]. Flushing here closes the debounce window between the last edit
   * and the move.
   */
  private _moveCardToPane(
    sourcePaneId: string,
    cardId: string,
    targetPaneId: string,
    insertAtIndex: number,
  ): void {
    if (sourcePaneId === targetPaneId) return;

    const sourceStack = this.deckState.panes.find((s) => s.id === sourcePaneId);
    if (!sourceStack || !sourceStack.cardIds.includes(cardId)) return;

    const targetStack = this.deckState.panes.find((s) => s.id === targetPaneId);
    if (!targetStack) return;

    // Fresh-bag invariant: see method docstring.
    this.invokeSaveCallback(cardId);

    const sourceWillBeDestroyed = sourceStack.cardIds.length === 1;
    const sourceIsActive = this.deckState.activePaneId === sourcePaneId;

    // Post-move `activePaneId`: shift to target when the source was
    // active AND will be destroyed (otherwise we'd leave a stale
    // reference to a removed stack). In every other case `activePaneId`
    // stays put — plan transition 7 only flips the first responder when
    // the target is/becomes the active stack.
    const postMoveActivePaneId =
      sourceWillBeDestroyed && sourceIsActive
        ? targetPaneId
        : this.deckState.activePaneId;

    const spliced = spliceCardFromStack(sourceStack, cardId);

    // Determine the composite first-responder bit after the move.
    let newFR: string | null;
    if (postMoveActivePaneId === targetPaneId) {
      // Target is/becomes the active stack → moved card is first responder.
      newFR = cardId;
    } else if (
      postMoveActivePaneId === sourcePaneId &&
      !sourceWillBeDestroyed
    ) {
      // Source remains active; its new `activeCardId` depends on whether
      // the moved card was the source's active-in-stack pre-move.
      newFR = spliced.activeCardId;
    } else if (postMoveActivePaneId !== undefined) {
      const other = this.deckState.panes.find(
        (s) => s.id === postMoveActivePaneId,
      );
      newFR = other?.activeCardId ?? null;
    } else {
      newFR = null;
    }

    // Transition 7 / 7b: flip composite bit iff it changes. Card
    // identity is preserved across the move, so no destruction event.
    this._flipFirstResponder(newFR, () => {
      let intermediateStacks: readonly TugPaneState[] = this.deckState.panes;
      if (spliced.activeCardId === null) {
        intermediateStacks = intermediateStacks.filter(
          (s) => s.id !== sourcePaneId,
        );
      } else {
        const updatedSourceStack: TugPaneState = {
          ...sourceStack,
          cardIds: spliced.cardIds,
          activeCardId: spliced.activeCardId,
        };
        intermediateStacks = intermediateStacks.map((s) =>
          s.id === sourcePaneId ? updatedSourceStack : s,
        );
      }

      const clampedIndex = Math.max(
        0,
        Math.min(insertAtIndex, targetStack.cardIds.length),
      );
      const newTargetCardIds = [...targetStack.cardIds];
      newTargetCardIds.splice(clampedIndex, 0, cardId);
      const updatedTargetStack: TugPaneState = {
        ...targetStack,
        cardIds: newTargetCardIds,
        activeCardId: cardId,
      };
      const finalStacks = intermediateStacks.map((s) =>
        s.id === targetPaneId ? updatedTargetStack : s,
      );

      this.deckState = {
        ...this.deckState,
        panes: finalStacks,
        ...(postMoveActivePaneId !== undefined
          ? { activePaneId: postMoveActivePaneId }
          : { activePaneId: undefined }),
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
   * `TugPane` reads `CardState.collapsed` and overrides the rendered
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
  private _togglePaneCollapse(paneId: string): void {
    const win = this.deckState.panes.find((s) => s.id === paneId);
    if (!win) return;

    const nowCollapsed = !win.collapsed;
    const updatedStack: TugPaneState = nowCollapsed
      ? { ...win, collapsed: true as const }
      : { ...win, collapsed: undefined };

    this.deckState = {
      ...this.deckState,
      panes: this.deckState.panes.map((s) => (s.id === paneId ? updatedStack : s)),
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

    const keptStacks: TugPaneState[] = [];
    for (const win of state.panes) {
      const survivingCardIds = win.cardIds.filter(
        (id) => !droppedCardIds.has(id),
      );
      if (survivingCardIds.length === 0) {
        console.warn(
          `[DeckManager] filterRegisteredCards: dropping stack "${win.id}" — ` +
            `all cards had unregistered componentIds.`,
        );
        changed = true;
        continue;
      }
      let activeCardId = win.activeCardId;
      if (!survivingCardIds.includes(activeCardId)) {
        activeCardId = survivingCardIds[0];
        changed = true;
      }
      if (
        survivingCardIds.length !== win.cardIds.length ||
        activeCardId !== win.activeCardId
      ) {
        keptStacks.push({ ...win, cardIds: survivingCardIds, activeCardId });
      } else {
        keptStacks.push(win);
      }
    }

    if (!changed) return state;

    const keptPaneIds = new Set(keptStacks.map((s) => s.id));
    const activePaneId =
      state.activePaneId !== undefined && keptPaneIds.has(state.activePaneId)
        ? state.activePaneId
        : undefined;

    return {
      ...state,
      cards: keptCards,
      panes: keptStacks,
      ...(activePaneId !== undefined
        ? { activePaneId }
        : { activePaneId: undefined }),
    };
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
