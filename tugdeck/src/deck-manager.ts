/**
 * DeckManager -- orchestrates card state and the React render pipeline.
 *
 * Phase 5: Rebuilt with card registry integration, addCard / removeCard /
 * moveCard / focusCard, stable bound callbacks, and cascade positioning.
 *
 * Phase 5a2: DeckManager is now a subscribable store conforming to the
 * useSyncExternalStore contract. One root.render() at construction time;
 * all subsequent state changes call notify() instead of render().
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
 *   stable identity and auto-bound `this` -- safe to pass directly to
 *   `useSyncExternalStore` without `.bind()`.
 * - The constructor calls `this.reactRoot.render()` exactly once, wrapping the
 *   tree with `DeckManagerContext.Provider`. There is no private `render()` method.
 * - Card positions cascade: each new card offsets (30, 30) from the previous.
 *   When the card's right or bottom edge would exceed canvas bounds, the
 *   cascade counter resets to 0.
 * - Layout persistence uses the settings API only. No localStorage.
 * - Cards with unregistered componentIds are filtered out at load time
 *   (in loadLayout and applyLayout). deckState.cards contains only
 *   renderable cards that have registered factories in the card registry.
 */

import { type DeckState, type CardState, type TabItem } from "./layout-tree";
import { buildDefaultLayout, serialize, deserialize } from "./serialization";
import { getRegistration } from "./card-registry";
import { TugConnection } from "./connection";
import React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { DeckCanvas } from "./components/chrome/deck-canvas";
import { ErrorBoundary } from "./components/chrome/error-boundary";
import { ResponderChainProvider } from "./components/tugways/responder-chain-provider";
import { postSettings } from "./settings-api";
import { TugThemeProvider, type ThemeName } from "./contexts/theme-provider";
import type { IDeckManagerStore } from "./deck-manager-store";
import { DeckManagerContext } from "./deck-manager-context";

/** Debounce delay for saving layout (ms) */
const SAVE_DEBOUNCE_MS = 500;

/** Default card size for new cards (Spec S05) */
const DEFAULT_CARD_WIDTH = 400;
const DEFAULT_CARD_HEIGHT = 300;

/** Cascade step between consecutive new cards (pixels) */
const CASCADE_STEP = 30;

export class DeckManager implements IDeckManagerStore {
  private container: HTMLElement;
  private connection: TugConnection;

  /** Current canvas state */
  private deckState: DeckState;

  /** Debounce timer for layout saves */
  private saveTimer: number | null = null;

  /** Single React root for the canvas */
  private reactRoot: Root | null = null;

  /**
   * Pre-fetched layout from the settings API (passed in from main.tsx).
   * Consumed once by loadLayout(); null thereafter.
   */
  private initialLayout: object | null;

  /** Active theme at construction time -- passed to TugThemeProvider as initialTheme. */
  private initialTheme: ThemeName;

  /**
   * Cascade index for new card positioning. Incremented by 1 on each addCard
   * call. Reset to 0 when the next cascaded position would overflow canvas bounds.
   */
  private cascadeIndex: number = 0;

  // ---- Subscribable store state (useSyncExternalStore contract) ----

  /** Set of subscriber callbacks registered via subscribe(). */
  private subscribers: Set<() => void> = new Set();

  /** Monotonically increasing state version, incremented on every notify(). */
  private stateVersion: number = 0;

  // ---- Stable bound callbacks (bound once in constructor, never recreated) ----

  /** Stable bound callback: update card position/size on drag-end/resize-end. */
  public handleCardMoved: (
    id: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ) => void;

  /** Stable bound callback: remove a card. */
  public handleCardClosed: (id: string) => void;

  /** Stable bound callback: bring a card to front. */
  public handleCardFocused: (id: string) => void;

  /** Stable bound callback: add a tab to an existing card. */
  public addTab: (cardId: string, componentId: string) => string | null;

  /** Stable bound callback: remove a tab from a card. */
  public removeTab: (cardId: string, tabId: string) => void;

  /** Stable bound callback: set the active tab on a card. */
  public setActiveTab: (cardId: string, tabId: string) => void;

  // ---- useSyncExternalStore arrow properties (stable identity, auto-bound this) ----

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   * Arrow property for stable identity and auto-bound `this`.
   */
  public subscribe = (callback: () => void): (() => void) => {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  };

  /**
   * Return the current DeckState snapshot.
   * Arrow property for stable identity and auto-bound `this`.
   */
  public getSnapshot = (): DeckState => this.deckState;

  /**
   * Return the current state version (monotonically increasing integer).
   * Arrow property for stable identity and auto-bound `this`.
   */
  public getVersion = (): number => this.stateVersion;

  constructor(
    container: HTMLElement,
    connection: TugConnection,
    initialLayout?: object,
    initialTheme?: ThemeName,
  ) {
    this.container = container;
    this.connection = connection;
    this.initialLayout = initialLayout ?? null;
    this.initialTheme = initialTheme ?? "brio";

    // Canvas container needs position:relative for absolutely-positioned children
    container.style.position = "relative";

    // Create the single React root
    this.reactRoot = createRoot(container);

    // Bind callbacks once -- stable identity, safe to pass directly to the store interface.
    this.handleCardMoved = this.moveCard.bind(this);
    this.handleCardClosed = this.removeCard.bind(this);
    this.handleCardFocused = this.focusCard.bind(this);
    this.addTab = this._addTab.bind(this);
    this.removeTab = this._removeTab.bind(this);
    this.setActiveTab = this._setActiveTab.bind(this);

    // Load or build the initial canvas state.
    // subscribers, stateVersion, handleCard*, and deckState must all be initialized
    // before root.render() executes: React may synchronously flush the first render
    // and call subscribe/getSnapshot during it.
    this.deckState = this.loadLayout();

    // Single root.render() -- the only call that ever executes.
    // DeckManagerContext.Provider wraps DeckCanvas so it can access the store
    // via useDeckManager(). DeckCanvas no longer receives deckState/callback props;
    // it reads them from the store via useSyncExternalStore.
    this.reactRoot.render(
      React.createElement(
        TugThemeProvider,
        { initialTheme: this.initialTheme },
        React.createElement(
          ErrorBoundary,
          null,
          React.createElement(
            ResponderChainProvider,
            null,
            React.createElement(
              DeckManagerContext.Provider,
              { value: this },
              React.createElement(DeckCanvas, {
                connection: this.connection,
              }),
            ),
          ),
        ),
      ),
    );

    // Listen for window resize (kept for future phases)
    window.addEventListener("resize", () => this.handleResize());
  }

  // ---- Store notification ----

  /**
   * Increment stateVersion and fire all subscriber callbacks.
   *
   * Called by every state-mutating method after updating this.deckState.
   * The shallow copy of deckState is always performed by the calling method
   * before notify() runs -- notify() does not copy again.
   */
  private notify(): void {
    this.stateVersion += 1;
    this.subscribers.forEach((cb) => cb());
  }

  /**
   * Notify subscribers to pick up any external state changes.
   * There is no render() method -- all state changes flow
   * through notify() -> useSyncExternalStore -> synchronous React update.
   */
  refresh(): void {
    this.notify();
  }

  /**
   * Return the current canvas state.
   * Convenience alias for getSnapshot() -- kept for backward compatibility
   * with action-dispatch.ts and existing tests.
   */
  getDeckState(): DeckState {
    return this.getSnapshot();
  }

  /**
   * Send a control frame to the server.
   */
  sendControlFrame(action: string, params?: Record<string, unknown>): void {
    this.connection.sendControlFrame(action, params);
  }

  // ---- Card management (Spec S05) ----

  /**
   * Add a new card from the registry.
   *
   * Looks up `componentId` in the card registry. If not found, logs a warning
   * and returns null. Otherwise creates a new CardState with a cascaded position
   * and default 400×300 size, appends it to deckState, re-renders, and schedules
   * a save.
   *
   * @returns The generated card ID, or null if the component is not registered.
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

    const cardId = crypto.randomUUID();
    const tabId = crypto.randomUUID();

    const tab: TabItem = {
      id: tabId,
      componentId,
      title: registration.defaultMeta.title,
      closable: registration.defaultMeta.closable !== false,
    };

    const position = this.nextCascadePosition();

    const card: CardState = {
      id: cardId,
      position,
      size: { width: DEFAULT_CARD_WIDTH, height: DEFAULT_CARD_HEIGHT },
      tabs: [tab],
      activeTabId: tabId,
    };

    this.deckState = { ...this.deckState, cards: [...this.deckState.cards, card] };
    this.notify();
    this.scheduleSave();
    return cardId;
  }

  /**
   * Remove a card from the canvas by card ID.
   */
  removeCard(cardId: string): void {
    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.filter((c) => c.id !== cardId),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Update a card's position and size (called on drag-end / resize-end).
   */
  moveCard(
    id: string,
    position: { x: number; y: number },
    size: { width: number; height: number },
  ): void {
    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.map((c) =>
        c.id === id ? { ...c, position, size } : c,
      ),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Bring a card to front by moving it to the end of the cards array.
   * End-of-array = highest z-index by render order.
   */
  focusCard(cardId: string): void {
    const idx = this.deckState.cards.findIndex((c) => c.id === cardId);
    if (idx === -1 || idx === this.deckState.cards.length - 1) {
      // Card not found or already the top-most -- no-op.
      return;
    }
    const cards = [...this.deckState.cards];
    const [focused] = cards.splice(idx, 1);
    cards.push(focused);
    this.deckState = { ...this.deckState, cards };
    this.notify();
  }

  // ---- Tab management (Spec S03) ----

  /**
   * Add a new tab to an existing card.
   *
   * Looks up `componentId` in the card registry. Creates a new `TabItem` with
   * a random UUID id, appends it to the card's `tabs` array, sets it as
   * `activeTabId`, shallow-copies `deckState`, notifies subscribers, and
   * schedules a save.
   *
   * @returns The new tab id, or null if the card or registration is not found.
   */
  private _addTab(cardId: string, componentId: string): string | null {
    const card = this.deckState.cards.find((c) => c.id === cardId);
    if (!card) {
      console.warn(
        `[DeckManager] addTab: card "${cardId}" not found.`,
      );
      return null;
    }
    const registration = getRegistration(componentId);
    if (!registration) {
      console.warn(
        `[DeckManager] addTab: no registration found for componentId "${componentId}".`,
      );
      return null;
    }

    const tabId = crypto.randomUUID();
    const tab: TabItem = {
      id: tabId,
      componentId,
      title: registration.defaultMeta.title,
      closable: registration.defaultMeta.closable !== false,
    };

    const updatedCard = {
      ...card,
      tabs: [...card.tabs, tab],
      activeTabId: tabId,
    };

    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.map((c) => (c.id === cardId ? updatedCard : c)),
    };
    this.notify();
    this.scheduleSave();
    return tabId;
  }

  /**
   * Remove a tab from a card.
   *
   * If the removed tab was active, activates the previous tab (or first tab if
   * the removed tab was first). If only one tab remains after removal, the card
   * stays with that tab. If the last tab is removed, the card is removed entirely.
   */
  private _removeTab(cardId: string, tabId: string): void {
    const card = this.deckState.cards.find((c) => c.id === cardId);
    if (!card) return;

    const tabIndex = card.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    // If this is the last tab, remove the card entirely.
    if (card.tabs.length === 1) {
      this.removeCard(cardId);
      return;
    }

    const newTabs = card.tabs.filter((t) => t.id !== tabId);

    // Determine the new active tab.
    let newActiveTabId = card.activeTabId;
    if (card.activeTabId === tabId) {
      // Activate previous tab, or first tab if removed was first.
      const newIndex = tabIndex > 0 ? tabIndex - 1 : 0;
      newActiveTabId = newTabs[newIndex].id;
    }

    const updatedCard = { ...card, tabs: newTabs, activeTabId: newActiveTabId };

    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.map((c) => (c.id === cardId ? updatedCard : c)),
    };
    this.notify();
    this.scheduleSave();
  }

  /**
   * Set the active tab on a card.
   *
   * No-op if the tabId is not in the card's tabs array.
   */
  private _setActiveTab(cardId: string, tabId: string): void {
    const card = this.deckState.cards.find((c) => c.id === cardId);
    if (!card) return;
    if (!card.tabs.some((t) => t.id === tabId)) return;
    if (card.activeTabId === tabId) return;

    const updatedCard = { ...card, activeTabId: tabId };

    this.deckState = {
      ...this.deckState,
      cards: this.deckState.cards.map((c) => (c.id === cardId ? updatedCard : c)),
    };
    this.notify();
    this.scheduleSave();
  }

  // ---- Cascade positioning ----

  /**
   * Compute the next cascade position for a new card.
   *
   * Offsets by (CASCADE_STEP * cascadeIndex, CASCADE_STEP * cascadeIndex).
   * If the card's right or bottom edge would exceed canvas bounds, resets
   * the cascade counter to 0 and returns (0, 0).
   */
  private nextCascadePosition(): { x: number; y: number } {
    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;

    const x = CASCADE_STEP * this.cascadeIndex;
    const y = CASCADE_STEP * this.cascadeIndex;

    if (x + DEFAULT_CARD_WIDTH > canvasWidth || y + DEFAULT_CARD_HEIGHT > canvasHeight) {
      this.cascadeIndex = 0;
      return { x: 0, y: 0 };
    }

    this.cascadeIndex += 1;
    return { x, y };
  }

  // ---- Resize Handling ----

  /**
   * Called on reconnect (connection.onOpen) and window resize.
   */
  handleResize(): void {
    // Kept for connection.onOpen() compatibility.
  }

  // ---- Layout Persistence ----

  private loadLayout(): DeckState {
    const canvasWidth = this.container.clientWidth || 800;
    const canvasHeight = this.container.clientHeight || 600;

    let state: DeckState | null = null;

    // Use pre-fetched layout from the settings API if available.
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
      state = buildDefaultLayout(canvasWidth, canvasHeight);
    }

    return this.filterRegisteredCards(state);
  }

  private saveLayout(): void {
    const serialized = serialize(this.deckState);
    postSettings({ layout: serialized, theme: this.readCurrentThemeFromDOM() });
  }

  /**
   * Read the active theme from the injected stylesheet element.
   *
   * TugThemeProvider injects <style id="tug-theme-override" data-theme="...">
   * for non-Brio themes. Absence of the element means Brio is active.
   */
  private readCurrentThemeFromDOM(): string {
    if (typeof document === "undefined") return "brio";
    const el = document.getElementById("tug-theme-override");
    return el?.getAttribute("data-theme") ?? "brio";
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
   * Filter out cards whose tabs have unregistered componentIds.
   *
   * Called by loadLayout() and applyLayout() so that deckState.cards only
   * contains renderable cards. This is the single filtering gate -- downstream
   * code (DeckCanvas, cycleCard, responder chain) can trust that every card
   * in deckState has at least one tab with a registered factory.
   *
   * For each card:
   * - Unregistered tabs are removed from the tabs array.
   * - If all tabs are removed, the card is dropped entirely.
   * - If the active tab was removed, activeTabId falls back to the first
   *   remaining registered tab.
   */
  private filterRegisteredCards(state: DeckState): DeckState {
    let changed = false;
    const filtered: CardState[] = [];

    for (const card of state.cards) {
      // Filter out tabs with unregistered componentIds.
      const registeredTabs = card.tabs.filter((tab) => {
        if (!tab.componentId || !getRegistration(tab.componentId)) {
          console.warn(
            `[DeckManager] filterRegisteredCards: dropping tab "${tab.id}" ` +
              `from card "${card.id}" -- unregistered componentId "${tab.componentId ?? "(none)"}".`,
          );
          changed = true;
          return false;
        }
        return true;
      });

      // If all tabs were removed, drop the card entirely.
      if (registeredTabs.length === 0) {
        console.warn(
          `[DeckManager] filterRegisteredCards: dropping card "${card.id}" -- all tabs unregistered.`,
        );
        changed = true;
        continue;
      }

      // If the active tab was removed, fall back to the first remaining tab.
      let activeTabId = card.activeTabId;
      if (!registeredTabs.some((t) => t.id === activeTabId)) {
        activeTabId = registeredTabs[0].id;
        changed = true;
      }

      if (registeredTabs.length !== card.tabs.length || activeTabId !== card.activeTabId) {
        filtered.push({ ...card, tabs: registeredTabs, activeTabId });
      } else {
        filtered.push(card);
      }
    }

    if (changed) {
      return { ...state, cards: filtered };
    }
    return state;
  }

  /**
   * Apply an external DeckState, notify subscribers, and schedule a save.
   * Cards with unregistered componentIds are filtered out.
   */
  applyLayout(deckState: DeckState): void {
    this.deckState = this.filterRegisteredCards(deckState);
    this.notify();
    this.scheduleSave();
  }

  destroy(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
    window.removeEventListener("resize", () => this.handleResize());
  }
}
