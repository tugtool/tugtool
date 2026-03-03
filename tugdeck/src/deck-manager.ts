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
 * - Card positions cascade: each new card offsets (30, 30) from the previous.
 *   When the card's right or bottom edge would exceed canvas bounds, the
 *   cascade counter resets to 0.
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

/** localStorage key for layout persistence */
const LAYOUT_STORAGE_KEY = "tugdeck-layout";

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

  // ---- Stable bound callbacks (bound once in constructor) ----

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

    // Bind callbacks once so render() never creates new function objects.
    this.handleCardMoved = this.moveCard.bind(this);
    this.handleCardClosed = this.removeCard.bind(this);
    this.handleCardFocused = this.focusCard.bind(this);

    // Load or build the initial canvas state
    this.deckState = this.loadLayout();

    // Initial render
    this.render();

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

  // ---- Rendering ----

  private render(): void {
    if (!this.reactRoot) return;

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
            React.createElement(DeckCanvas, {
              connection: this.connection,
              deckState: this.deckState,
              onCardMoved: this.handleCardMoved,
              onCardClosed: this.handleCardClosed,
              onCardFocused: this.handleCardFocused,
            }),
          ),
        ),
      ),
    );
  }

  /**
   * Re-render to pick up any state changes.
   */
  refresh(): void {
    this.notify();
    this.render();
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
    this.render();
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
    this.render();
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
    this.render();
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
    this.render();
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

    // Try pre-fetched layout from the settings API first.
    if (this.initialLayout !== null) {
      try {
        const json = JSON.stringify(this.initialLayout);
        const state = deserialize(json, canvasWidth, canvasHeight);
        // Cache to localStorage so subsequent loads are fast.
        try {
          localStorage.setItem(LAYOUT_STORAGE_KEY, json);
        } catch {
          // localStorage may be unavailable
        }
        this.initialLayout = null;
        return state;
      } catch (e) {
        console.warn("DeckManager: failed to deserialize initialLayout from API, falling back", e);
      }
      this.initialLayout = null;
    }

    // Fall back to localStorage.
    try {
      const json = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (json) {
        return deserialize(json, canvasWidth, canvasHeight);
      }
    } catch (e) {
      console.warn("DeckManager: failed to load layout from localStorage", e);
    }

    return buildDefaultLayout(canvasWidth, canvasHeight);
  }

  private saveLayout(): void {
    try {
      const serialized = serialize(this.deckState);
      const json = JSON.stringify(serialized);
      localStorage.setItem(LAYOUT_STORAGE_KEY, json);
      // Persist to API (fire-and-forget).
      postSettings({ layout: serialized, theme: this.readCurrentThemeFromDOM() });
    } catch (e) {
      console.warn("DeckManager: failed to save layout to localStorage", e);
    }
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
   * Apply an external DeckState, re-render, and schedule a save.
   */
  applyLayout(deckState: DeckState): void {
    this.deckState = deckState;
    this.notify();
    this.render();
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
