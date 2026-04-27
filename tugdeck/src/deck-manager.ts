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
import { registerDeckStore, getDeckStore } from "./lib/deck-store-registry";
import { isDevEnv } from "./lib/dev-env";
import {
  installLifecycleCascade,
  type LifecycleCascadeHandle,
} from "./lib/lifecycle-cascade";
import { ComponentPersistenceRegistry } from "./components/tugways/component-persistence-registry";
import {
  CardStateOrchestrator,
  type CardAssembler,
} from "./card-state-orchestrator";
import { deckTrace, type SaveCallbackSource } from "./deck-trace";
import {
  reactivateCurrentFocusDestination,
  transferFocusAfterMove,
  transferFocusForActivation,
} from "./focus-transfer";

/** Debounce delay for saving layout (ms) */
const SAVE_DEBOUNCE_MS = 500;

/** Cascade step between consecutive new stacks (pixels) */
const CASCADE_STEP = 30;

/**
 * Module-scope guard so the window `focus` / `blur` listeners that
 * drive `DeckState.hasFocus` install exactly once per JS context, even
 * if a test (or a future multi-deck scenario) constructs more than one
 * `DeckManager`. Handlers read the live store via
 * {@link getDeckStore} rather than closing over a specific instance,
 * so they remain correct across deck-store replacement.
 */
let focusListenersInstalled = false;

function installDeckStoreFocusListeners(): void {
  if (focusListenersInstalled) return;
  if (typeof window === "undefined") return;
  focusListenersInstalled = true;
  const onFocus = (): void => {
    const store = getDeckStore();
    if (store === null) return;
    // Order matters: setHasFocus(true) must land before the helper
    // call because canProgrammaticallyFocus reads state.hasFocus —
    // the gate would refuse a transfer issued while hasFocus is
    // still false from the prior blur.
    store.setHasFocus(true);
    reactivateCurrentFocusDestination(store);
  };
  const onBlur = (): void => {
    const store = getDeckStore();
    if (store === null) return;
    // Synchronous save-on-blur. Closes the stale-bag residual: a
    // user who cmd-tabs away mid-typing leaves `bag.focus` /
    // `bag.formControls` reflecting the moment of the last
    // debounced save (which may be hundreds of ms stale). Without
    // this flush, the subsequent reactivate on window-focus would
    // restore stale form-control values. visibilitychange covers
    // tab-hide on browsers, but window-blur without tab-hide is
    // the common cmd-tab case on macOS — saving here makes the
    // pre-resign capture unconditional.
    const fr = store.getFirstResponderCardId();
    if (fr !== null) {
      store.invokeSaveCallback(fr, "window-blur");
    }
    store.setHasFocus(false);
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
}

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

/**
 * Read the DEBUG-only `__tugPersistInTestMode` flag. When `true` AND
 * `__tugTestMode` is also `true`, the test-mode persistence bypass
 * in the `put*Guarded` wrappers is skipped — writes go through.
 * Used by cold-boot harness tests that pair test-mode IPC with
 * per-test `TUGBANK_PATH` isolation. See
 * `tugapp/Sources/TestHarness/TestHarnessUserScript.swift`.
 */
function shouldPersistInTestMode(): boolean {
  return typeof window !== "undefined" && window.__tugPersistInTestMode === true;
}

export class DeckManager implements IDeckManagerStore {
  private container: HTMLElement;
  private connection: TugConnection;

  /** Current canvas state (two-table shape). */
  private deckState: DeckState;

  /** Debounce timer for layout saves */
  private saveTimer: number | null = null;

  // ---- Per-card state cache ([D01], [D06]) ----

  /** In-memory cache of per-card state bags. Primary read source during a session. */
  private cardStateCache: Map<string, CardStateBag> = new Map();

  /** Debounce timer for per-card state saves (separate from layout save timer). */
  private cardStateSaveTimer: number | null = null;

  /** Set of card IDs with unsaved (dirty) state bags. Used for flush-on-destroy. */
  private dirtyCardIds: Set<string> = new Set();

  // ---- Save callbacks for close-time state flush ([D01]) ----

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

  /**
   * Framework orchestrator for capture/restore ([A9c]). Every save
   * trigger (debounced callback, close-before-destroy flush,
   * `saveState` RPC) routes through `captureCardState`; every restore
   * trigger routes through `restoreCardState`. `CardHost` registers its
   * per-card assembler with this orchestrator on mount.
   */
  private readonly cardStateOrchestrator: CardStateOrchestrator =
    new CardStateOrchestrator((cardId) =>
      this.componentRegistries.get(cardId),
    );

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.stateFlushed) return;
      // Route each save through `invokeSaveCallback` (not a direct
      // `forEach((cb) => cb())`) so the deck-trace picks up a
      // `save-callback` event with `source: "visibilitychange"` per
      // List [#l01-recording-sites]. Snapshot the keys first so a
      // callback that unregisters another card mid-iteration does
      // not confuse the Map iterator.
      for (const cardId of Array.from(this.saveCallbacks.keys())) {
        this.invokeSaveCallback(cardId, "visibilitychange");
      }
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
    // Route through `invokeSaveCallback` so the deck-trace sees a
    // `save-callback` event tagged `"beforeunload"` per
    // [#l01-recording-sites].
    for (const cardId of Array.from(this.saveCallbacks.keys())) {
      this.invokeSaveCallback(cardId, "beforeunload");
    }
    this.flushDirtyCardStates({ sync: true });
  };

  // ---- Initial focused card ID for reload restoration ([D03]) ----

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
    this._flipFirstResponder(
      cardId,
      () => this._commitStandardFirstResponderFlip(cardId),
      "activateCard",
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

  /**
   * When true, DeckManager starts with an empty in-memory DeckState and
   * never issues tugbank reads or writes. See test-mode semantics
   * and design decision [D02]: every `putLayout` / `putCardState` /
   * `putFocusedCardId` call site is guarded with `if (this.testMode) return;`
   * so test-mode sessions never mutate the user's persisted deck.
   *
   * The sole source of state in test mode is {@link seedDeckState}; the
   * boot path ignores any `initialLayout` / `initialCardStates` /
   * `initialFocusedCardId` arguments when `testMode` is true.
   *
   * Release builds never reach this code path because the flag is set
   * only by the DEBUG-gated bridge ([D03]).
   */
  private readonly testMode: boolean;

  constructor(
    container: HTMLElement,
    connection: TugConnection,
    initialLayout?: object,
    initialTheme?: ThemeName,
    initialCardStates?: Map<string, CardStateBag>,
    initialFocusedCardId?: string,
    options?: { testMode?: boolean },
  ) {
    this.container = container;
    this.connection = connection;
    this.testMode = options?.testMode === true;
    // Test mode: discard any tugbank-sourced boot arguments so the deck
    // starts empty. The harness drives state exclusively via
    // `seedDeckState`; silently honoring a stray pre-populated layout
    // would couple test scenarios to whatever happened to be in
    // tugbank when the run started.
    this.initialLayout = this.testMode ? null : (initialLayout ?? null);
    this.initialTheme = initialTheme ?? BASE_THEME_NAME;

    if (initialCardStates && !this.testMode) {
      this.cardStateCache = new Map(initialCardStates);
    }

    this.initialFocusedCardId = this.testMode ? undefined : initialFocusedCardId;

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

    this.deckState = {
      ...this.loadLayout(),
      // `hasFocus` is session-only state; the loaded layout carries a
      // placeholder value. Overwrite it with the live foreground
      // reading so the selector is correct on the very first render.
      hasFocus:
        typeof document !== "undefined" && typeof document.hasFocus === "function"
          ? document.hasFocus()
          : true,
    };

    // Install window focus/blur listeners exactly once per JS context.
    // Safe to call unconditionally — the module-scope flag short-circuits
    // subsequent constructions.
    installDeckStoreFocusListeners();

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

  // ---- App-foreground tracking ([A1]) ----

  /**
   * Flip the session-only `hasFocus` slice when the window gains or
   * loses OS foreground. Idempotent: a no-op when the bit is already
   * at `value`, so spurious duplicate events don't churn React
   * subscribers. Called from the module-scope listeners installed by
   * {@link installDeckStoreFocusListeners}; tests may call this
   * directly to simulate focus transitions without dispatching DOM
   * events.
   */
  public setHasFocus = (value: boolean): void => {
    if (this.deckState.hasFocus === value) return;
    this.deckState = { ...this.deckState, hasFocus: value };
    this.notify();
  };

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

  // ---- Card / stack management () ----

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
    this._flipFirstResponder(
      firstCardId,
      () => {
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
        this.putFocusedCardIdGuarded(firstCardId);
      },
      "addCard",
    );

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
    //
    // Routed through `transferFocusForActivation` on the active-pane
    // branch. The helper
    // is only called when there is a surviving pane to receive focus
    // (`newFR !== null`); when the deck becomes empty there is no
    // incoming card to focus and the raw `_flipFirstResponder` path
    // applies.
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
      const flipCommit = (): void => {
        this.deckState = {
          ...this.deckState,
          ...(newActivePaneId !== undefined
            ? { activePaneId: newActivePaneId }
            : { activePaneId: undefined }),
        };
        this.notify();
        this.scheduleSave();
        if (newFR !== null) this.putFocusedCardIdGuarded(newFR);
      };
      if (newFR !== null) {
        transferFocusForActivation({
          outgoingCardId: currentFR,
          incomingCardId: newFR,
          store: this,
          outgoingWillBeDestroyed: true,
          commitMutation: () => {
            this._flipFirstResponder(newFR, flipCommit, "_closePane");
          },
        });
      } else {
        this._flipFirstResponder(newFR, flipCommit, "_closePane");
      }
    }

    // Phase 2: flush each card's save callback then fire destruction.
    // Save-on-close runs BEFORE destruction so the card's last bag
    // lands before subscribers tear down dependent state. [L23].
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
    trigger: string,
  ): void {
    const oldFR = this.getFirstResponderCardId();
    if (oldFR === newFR) {
      commit();
      // Same-bit refresh still counts as a flip trigger for trace
      // purposes — the composite bit's stored value does not change,
      // but callers route through this helper specifically because
      // they produced an intent to flip. Recording here lets a trace
      // reader see the trigger even when the bit collapsed.
      deckTrace.record({
        kind: "fr-flip",
        from: oldFR,
        to: newFR,
        trigger,
      });
      return;
    }
    if (oldFR !== null) this.cardLifecycle.notifyCardWillDeactivate(oldFR);
    if (newFR !== null) this.cardLifecycle.notifyCardWillActivate(newFR);
    commit();
    if (newFR !== null) this.cardLifecycle.setResponderChainKey(newFR);
    if (oldFR !== null) this.cardLifecycle.notifyCardDidDeactivate(oldFR);
    if (newFR !== null) this.cardLifecycle.notifyCardDidActivate(newFR);
    // Record after the composite bit has changed — matches Spec
    // `deck-trace` ordering ("fr-flip after the composite
    // bit changes"). See list [#l01-recording-sites].
    deckTrace.record({
      kind: "fr-flip",
      from: oldFR,
      to: newFR,
      trigger,
    });
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
    this.putFocusedCardIdGuarded(newFR);
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
      this.putFocusedCardIdGuarded(cardId);
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

  // ---- Per-card state cache API ([D01], [D06]) ----

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
        promises.push(this.putCardStateGuarded(cardId, bag, options));
      }
    }
    this.dirtyCardIds.clear();
    return Promise.all(promises).then(() => {});
  }

  // ---- Save callback registration ([D01]) ----

  registerSaveCallback(id: string, callback: () => void): void {
    this.saveCallbacks.set(id, callback);
  }

  unregisterSaveCallback(id: string): void {
    this.saveCallbacks.delete(id);
  }

  /**
   * Invoke the registered save callback for `id`, if any, recording a
   * `save-callback` deck-trace event tagged with the caller-supplied
   * `source`. `source` is optional for backward compatibility with
   * mock stores in the test suite (they implement the interface with
   * the one-arg shape and still type-check); live callers always pass
   * an explicit tag so the trace preserves the triggering path.
   *
   * See `deck-trace` for the `save-callback` event shape
   * and the recording-sites list for per-source wiring.
   */
  invokeSaveCallback(id: string, source?: SaveCallbackSource): void {
    const tag: SaveCallbackSource = source ?? "manual";
    deckTrace.record({
      kind: "save-callback",
      cardId: id,
      source: tag,
    });
    this.saveCallbacks.get(id)?.();
  }

  // ---- Focus-transfer channels (focus-transfer.ts seam) ----

  /**
   * Content-factory activation callbacks, keyed by cardId. Written by
   * `useCardPersistence` (through the context-provided register
   * helper) on every mount of a card whose content component opts in
   * via `options.onCardActivated`. Last-write-wins per cardId.
   */
  private activationCallbacks: Map<string, () => void> = new Map();

  /**
   * Per-card deactivation callbacks (parallel to
   * {@link activationCallbacks}). [L23]:
   * fires when a card is about to lose focus-destination status, so
   * the consumer can route its selection into the inactive-paint
   * channel via `paintMirrorAsInactive(publish)` before the new
   * active card claims focus + global Selection.
   */
  private deactivationCallbacks: Map<string, () => void> = new Map();

  /**
   * Live `[data-card-host][data-card-id="…"]` elements, keyed by
   * cardId. Written by `CardHost` from a callback-ref so mount,
   * unmount, and (if it ever occurs) element-identity changes are all
   * covered.
   */
  private cardHostRoots: Map<string, HTMLElement> = new Map();

  registerActivationCallback(cardId: string, callback: () => void): () => void {
    this.activationCallbacks.set(cardId, callback);
    return () => {
      // Only clear when we still own the slot. A later `register`
      // for the same cardId will have displaced us; its cleanup
      // owns the removal.
      if (this.activationCallbacks.get(cardId) === callback) {
        this.activationCallbacks.delete(cardId);
      }
    };
  }

  invokeActivationCallback(cardId: string, dispatchedFrom: string): void {
    const callback = this.activationCallbacks.get(cardId);
    if (callback === undefined) return;

    // Record the engine-activation-dispatched trace event ahead of
    // invoking the callback so the trace ring's order matches
    // dispatch order. The factory's onCardActivated body stays
    // simple — focus the engine root, that's it; the framework
    // owns the observability surface.
    const card = this.deckState.cards.find((c) => c.id === cardId);
    if (card !== undefined) {
      deckTrace.record({
        kind: "engine-activation-dispatched",
        cardId,
        engine: card.componentId,
        dispatchedFrom,
      });
    }

    callback();
  }

  registerDeactivationCallback(cardId: string, callback: () => void): () => void {
    this.deactivationCallbacks.set(cardId, callback);
    return () => {
      if (this.deactivationCallbacks.get(cardId) === callback) {
        this.deactivationCallbacks.delete(cardId);
      }
    };
  }

  invokeDeactivationCallback(cardId: string, _dispatchedFrom: string): void {
    const callback = this.deactivationCallbacks.get(cardId);
    if (callback === undefined) return;
    callback();
  }

  registerCardHostRoot(cardId: string, el: HTMLElement | null): void {
    if (el === null) {
      this.cardHostRoots.delete(cardId);
    } else {
      this.cardHostRoots.set(cardId, el);
    }
  }

  peekCardHostRoot(cardId: string): HTMLElement | null {
    return this.cardHostRoots.get(cardId) ?? null;
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
   * Register a card-level assembler with the framework orchestrator
   * ([A9c]). Called by `CardHost` from a `useLayoutEffect`; returned
   * function unregisters on cleanup. The orchestrator invokes the
   * assembler's `capture()` on every save trigger.
   */
  registerCardAssembler(cardId: string, assembler: CardAssembler): () => void {
    return this.cardStateOrchestrator.registerAssembler(cardId, assembler);
  }

  /**
   * Capture the full `CardStateBag` for `cardId` via the orchestrator
   * — framework axes from the registered assembler, plus component
   * state harvested parent-first from the card's
   * `ComponentPersistenceRegistry`. Single entry point for every save
   * trigger; guarantees `bag.components` lands with every save by
   * construction ([D13], [M17]).
   */
  captureCardState(cardId: string): CardStateBag {
    return this.cardStateOrchestrator.captureCardState(cardId);
  }

  /**
   * Apply `bag.components` to the card's registered components via
   * the orchestrator. Framework-axis restore (content, scroll, DOM
   * selection, focus, form controls, region scroll) remains driven
   * by CardHost's existing lifecycle hooks.
   */
  restoreCardState(cardId: string, bag: CardStateBag): void {
    this.cardStateOrchestrator.restoreCardState(cardId, bag);
  }

  /**
   * Flush a card's save callback before the card's own destruction
   * runs. Called by close paths (`_removeCard`, `_closePane`) so the
   * card's last unsaved edits land in the bag before
   * `cardWillBeginDestruction` subscribers tear down dependent state
   * (engine teardown, session release, etc.). The save
   * runs BEFORE the destruction notification — the reverse order
   * would let a destruction subscriber invalidate the state the save
   * callback is trying to read.
   *
   * The callback is wrapped in `try/catch` so a single
   * throwing save never blocks the destruction. In dev, a throw is
   * logged with enough context to find the offending card; in
   * production the failure is swallowed silently — the alternative
   * (blocking destruction and leaving the deck in an inconsistent
   * state) is strictly worse.
   */
  private flushSaveCallbackBeforeDestruction(cardId: string): void {
    try {
      this.invokeSaveCallback(cardId, "close-handoff");
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
    // Route through `invokeSaveCallback` so the trace records one
    // `save-callback` event per card with `source: "manual"`.
    for (const cardId of Array.from(this.saveCallbacks.keys())) {
      this.invokeSaveCallback(cardId, "manual");
    }
    this.flushDirtyCardStates({ sync: true });
    this.stateFlushed = true;
  }

  saveAndFlush(): void {
    for (const cardId of Array.from(this.saveCallbacks.keys())) {
      this.invokeSaveCallback(cardId, "manual");
    }
    this.flushDirtyCardStates();
  }

  async prepareForReload(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveLayout();
    for (const cardId of Array.from(this.saveCallbacks.keys())) {
      this.invokeSaveCallback(cardId, "manual");
    }
    await this.flushDirtyCardStates();
    this.reloadPending = true;
  }

  // ---- Test-mode state seeding ([D02]) ----

  /**
   * Replace the current `DeckState` atomically, merge per-card state
   * bags into the in-memory cache, and optionally activate a focused
   * card. The single source of state for a test-mode session ([D02]):
   * harness authors describe the desired axis state; this method
   * installs it in one commit.
   *
   * Semantics:
   * - `this.deckState` is replaced with `args.state` verbatim (no
   *   merge with the previous state). The caller is responsible for
   *   passing a fully-formed `DeckState`.
   * - `args.cardStates` (if present) is merged into
   *   `this.cardStateCache`; existing entries for other card ids are
   *   preserved so repeated `seedDeckState` calls can layer state.
   * - `args.focusCardId` (if present) drives the cold-boot restore
   *   path — `activateCard(id)` runs after the state commit when the
   *   card exists in the new state.
   *
   * Callable in non-test-mode too so harness-authored scenarios can
   * exercise the same entry point inside unit tests that don't
   * construct a whole bridge. The I/O guards elsewhere ensure a
   * non-test-mode caller still routes writes to tugbank normally —
   * `seedDeckState` itself issues no tugbank I/O.
   *
   * Subscribers are notified exactly once via `this.notify()` at the
   * end of the commit; `useSyncExternalStore` consumers see a single
   * state transition, not a series of partial ones.
   */
  seedDeckState(args: {
    state: DeckState;
    cardStates?: Map<string, CardStateBag>;
    focusCardId?: string;
  }): void {
    // Clear construction lifecycle memory for cards that are leaving
    // the deck so a later `seedDeckState` call that re-introduces an
    // id does not double-fire construction. Fresh-card construction
    // below picks up the id set that resulted from the replace.
    const previousCardIds = new Set(this.deckState.cards.map((c) => c.id));
    const nextCardIds = new Set(args.state.cards.map((c) => c.id));

    // Atomic state replace: one assignment, one notify, one snapshot
    // transition for useSyncExternalStore consumers. hasFocus is
    // session-only — the caller supplies it in `args.state`.
    this.deckState = args.state;

    if (args.cardStates) {
      for (const [cardId, bag] of args.cardStates) {
        this.cardStateCache.set(cardId, bag);
      }
    }

    // Fire construction for every card that just entered the deck so
    // lifecycle subscribers' `constructedCards` set matches reality
    // (mirrors the constructor's post-load fan-out in the normal boot
    // path).
    for (const card of args.state.cards) {
      if (!previousCardIds.has(card.id)) {
        this.cardLifecycle.notifyCardDidFinishConstruction(card.id);
      }
    }

    // Discard per-card component registries for cards that left the
    // deck so closures don't outlive the card. Explicit cleanup,
    // symmetric with `_removeCard` / `_closePane`.
    for (const prevId of previousCardIds) {
      if (!nextCardIds.has(prevId)) {
        // discardComponentRegistry is private; inline the equivalent
        // cleanup so we don't widen the surface.
        const registry = this.componentRegistries.get(prevId);
        if (registry) {
          registry.clear();
          this.componentRegistries.delete(prevId);
        }
      }
    }

    this.notify();

    // Cold-boot restore: after the state commit, activate the
    // requested focus card. `activateCard` is the single entry point
    // for z-order + lifecycle + responder-chain updates ([D03]).
    if (args.focusCardId !== undefined) {
      const exists = this.deckState.cards.some(
        (c) => c.id === args.focusCardId,
      );
      if (exists) {
        this.activateCard(args.focusCardId);
      }
    }
  }

  // ---- Stack/card mutators () ----

  /**
   * Add a new card to an existing stack. Creates a fresh card, appends its id
   * to the stack's `cardIds`, and sets it as the stack's `activeCardId`.
   *
   * When `paneId` is the deck's active
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
    this._flipFirstResponder(
      newFR,
      () => {
        this.deckState = {
          ...this.deckState,
          cards: [...this.deckState.cards, newCard],
          panes: this.deckState.panes.map((s) => (s.id === paneId ? updatedStack : s)),
        };
        this.notify();
        this.scheduleSave();
        this.cardLifecycle.notifyCardDidFinishConstruction(cardId);
        if (isActiveStack) this.putFocusedCardIdGuarded(cardId);
      },
      "_addCardToPane",
    );

    return cardId;
  }

  /**
   * Remove a card from a stack.
   *
   * If the card is the only one in the stack, closes the whole stack via
   * `_closePane`. Otherwise removes the card from `deckState.cards` and
   * from the stack's `cardIds`, reassigning `activeCardId` if needed.
   *
   * **Save-on-close invariant ([L23]):** the card's save
   * callback fires BEFORE `notifyCardWillBeginDestruction`, so the
   * last unsaved bag (scroll, DOM-selection, focus, form-controls,
   * region-scroll, engine content) lands in tugbank before
   * destruction subscribers release any dependent state. A throwing
   * save callback is caught and dev-warned; destruction proceeds
   * regardless.
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
    //
    // Routed through `transferFocusForActivation`. The helper's `commitMutation`
    // closure is the entire `_flipFirstResponder` call so the
    // existing will/commit/did ordering is preserved inside the
    // `flushSync` boundary, and the new FR's card host is mounted
    // and visible before focus transfer runs.
    //
    // `outgoingWillBeDestroyed: true` skips the helper's outgoing
    // save step — phase 2 below runs `flushSaveCallbackBeforeDestruction`
    // for the same card, which is the canonical destruction-flush.
    // Saving twice would mask the destruction-ordering audit (P9).
    if (wasRemovingFR) {
      transferFocusForActivation({
        outgoingCardId: cardId,
        incomingCardId: newActiveCardId,
        store: this,
        outgoingWillBeDestroyed: true,
        commitMutation: () => {
          this._flipFirstResponder(
            newActiveCardId,
            () => {
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
              this.putFocusedCardIdGuarded(newActiveCardId);
            },
            "_removeCard",
          );
        },
      });
    }

    // Phase 2: save, then destruction + removal. Save runs first so
    // the card's last bag is flushed before subscribers tear down
    // dependent state. [L23].
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
      this._flipFirstResponder(
        cardId,
        () => this._commitStandardFirstResponderFlip(cardId),
        "_setActiveCardInPane",
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

    // Fresh-bag invariant: see method docstring. The `"manual"` tag
    // on the save-callback trace event distinguishes this pre-move
    // flush from the close-handoff flush that destruction paths fire.
    this.invokeSaveCallback(cardId, "manual");

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
    this._flipFirstResponder(
      cardId,
      () => {
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
        this.putFocusedCardIdGuarded(cardId);
      },
      "_detachCard",
    );

    // Refocus after the move. The
    // detached card's CardHost has just been re-parented under the
    // new pane via React's portal reconciliation; its registered
    // host root now points at the post-commit DOM. The drag-start
    // save (captureFocusForDragStart) preserved bag.focus + bag
    // .domSelection while the input was still focused, so the
    // helper can resolve the saved snapshot and restore focus
    // inside the moved card. When the pre-move save (line above
    // the flip) clobbered bag.focus to "none" because activeElement
    // was on body, resolveActivationTarget falls through to the
    // default-focus path so the card still receives the caret.
    transferFocusAfterMove({ sourceCardId: cardId, store: this });

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

    // Fresh-bag invariant: see method docstring. `"manual"` tag per
    // the pre-move flush convention shared with `_detachCard`.
    this.invokeSaveCallback(cardId, "manual");

    const sourceWillBeDestroyed = sourceStack.cardIds.length === 1;

    // Post-move `activePaneId`: always shift to the target. Cross-
    // pane move is exclusively driven by the user's drag gesture
    // (the only production caller is `cardDragCoordinator.onPointerUp`
    // committing a "merge"-mode drop), and the user's intent in
    // dragging a card to another pane is to follow the card —
    // attention moves with the gesture. Previously the target
    // only became active when the source was destroyed, which left
    // the dragged card mounted but not focused; users had to click
    // back into it to resume work. Always activating the target
    // closes that gap and lets `transferFocusAfterMove` resolve
    // a focus-destination card on the post-commit DOM.
    const postMoveActivePaneId = targetPaneId;

    const spliced = spliceCardFromStack(sourceStack, cardId);

    // Composite first-responder bit: the moved card is the active
    // card of the active pane post-move, so it becomes FR
    // unconditionally.
    const newFR: string = cardId;

    // Transition 7: flip composite bit. Card identity is preserved
    // across the move, so no destruction event. Post-flip,
    // transferFocusAfterMove restores focus into the card's new DOM
    // location.
    this._flipFirstResponder(
      newFR,
      () => {
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

        // Bump the target pane to the end of the panes array (z-
        // top). Mirrors `_commitStandardFirstResponderFlip` — the
        // deck's "focused card" is read as the activeCardId of the
        // last (top-most) pane, so the target needs to be at the
        // end for the moved card to be observable as the FR.
        const withoutTarget = intermediateStacks.filter(
          (s) => s.id !== targetPaneId,
        );
        const finalStacks: readonly TugPaneState[] = [
          ...withoutTarget,
          updatedTargetStack,
        ];

        this.deckState = {
          ...this.deckState,
          panes: finalStacks,
          activePaneId: postMoveActivePaneId,
        };
        this.notify();
        this.scheduleSave();
        this.putFocusedCardIdGuarded(newFR);
      },
      "_moveCardToPane",
    );

    // Refocus after the move. See the
    // matching comment in _detachCard for the L23 / drag-start-save
    // contract.
    transferFocusAfterMove({ sourceCardId: cardId, store: this });
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

  /**
   * Fire-and-forget `putFocusedCardId` with a test-mode bypass. See
   * Test-mode tugbank write semantics and [D02]: every tugbank write is
   * wrapped so test-mode sessions never leak state into tugbank.
   *
   * Named wrapper (rather than a literal `if (this.testMode) return;
   * putFocusedCardId(id);` at each call site) keeps a single
   * implementation per wrapped write family while still covering every
   * live caller.
   *
   * `__tugPersistInTestMode`
   * is the explicit escape hatch for cold-boot harness tests: when
   * true, the test-mode bypass is skipped and the write goes
   * through. Tests that opt in pair this with a per-test
   * `TUGBANK_PATH` so pollution of the user's real tugbank is
   * impossible.
   */
  private putFocusedCardIdGuarded(focusedCardId: string): void {
    if (this.testMode && !shouldPersistInTestMode()) return;
    putFocusedCardId(focusedCardId);
  }

  /**
   * Fire-and-forget `putLayout` with a test-mode bypass. Returns a
   * `Promise<void>` so `prepareForReload` (the sole awaiter) still
   * sees a resolved Promise under test mode — no behavioral change
   * for callers, no network I/O. See {@link putFocusedCardIdGuarded}
   * for the `__tugPersistInTestMode` escape hatch.
   */
  private putLayoutGuarded(layout: object): Promise<void> {
    if (this.testMode && !shouldPersistInTestMode()) return Promise.resolve();
    return putLayout(layout);
  }

  /**
   * Fire-and-forget `putCardState` with a test-mode bypass. Returns a
   * resolved `Promise<void>` under test mode so `flushDirtyCardStates`
   * can still `Promise.all` the batch without special-casing the
   * empty-network branch. See {@link putFocusedCardIdGuarded} for
   * the `__tugPersistInTestMode` escape hatch.
   */
  private putCardStateGuarded(
    cardId: string,
    bag: CardStateBag,
    options?: { keepalive?: boolean; sync?: boolean },
  ): Promise<void> {
    if (this.testMode && !shouldPersistInTestMode()) return Promise.resolve();
    return putCardState(cardId, bag, options);
  }

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
    return this.putLayoutGuarded(serialized);
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
