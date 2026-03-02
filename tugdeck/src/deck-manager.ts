/**
 * DeckManager — empty canvas shell for Phase 0.
 *
 * Owns a DeckState (empty cards array), renders an empty DeckCanvas with only
 * the DisconnectBanner. No panels, no card registration, no geometric pipeline.
 *
 * Spec S02 (#s02-deckmanager-shape), [D05] Strip DeckManager to empty shell
 * Phase 5 will re-integrate snap.ts geometry and rebuild the rendering pipeline.
 */

import { type DeckState } from "./layout-tree";
import { buildDefaultLayout, serialize, deserialize } from "./serialization";
import { TugConnection } from "./connection";
import React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { DeckCanvas, type DeckCanvasHandle } from "./components/chrome/deck-canvas";
import { ErrorBoundary } from "./components/chrome/error-boundary";
import { postSettings } from "./settings-api";

/** localStorage key for layout persistence */
const LAYOUT_STORAGE_KEY = "tugdeck-layout";

/** Debounce delay for saving layout (ms) */
const SAVE_DEBOUNCE_MS = 500;

export class DeckManager {
  private container: HTMLElement;
  private connection: TugConnection;

  /** Current canvas state (empty in Phase 0) */
  private deckState: DeckState;

  /** Debounce timer for layout saves */
  private saveTimer: number | null = null;

  /** Single React root for the canvas */
  private reactRoot: Root | null = null;

  /** Ref to DeckCanvas imperative handle (empty in Phase 0) */
  private deckCanvasRef: React.RefObject<DeckCanvasHandle | null>;

  /**
   * Pre-fetched layout from the settings API (passed in from main.tsx).
   * Consumed once by loadLayout(); null thereafter.
   */
  private initialLayout: object | null;

  constructor(container: HTMLElement, connection: TugConnection, initialLayout?: object) {
    this.container = container;
    this.connection = connection;
    this.initialLayout = initialLayout ?? null;

    // Canvas container needs position:relative for absolutely-positioned children
    container.style.position = "relative";

    // Initialize React root and ref
    this.deckCanvasRef = React.createRef<DeckCanvasHandle | null>();

    // Create the single React root
    this.reactRoot = createRoot(container);

    // Load or build the initial canvas state
    this.deckState = this.loadLayout();

    // Initial render
    this.render();

    // Listen for window resize (kept for future phases)
    window.addEventListener("resize", () => this.handleResize());
  }

  // ---- Rendering ----

  private render(): void {
    if (!this.reactRoot) return;

    this.reactRoot.render(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement(DeckCanvas, {
          ref: this.deckCanvasRef,
          connection: this.connection,
        })
      )
    );
  }

  /**
   * Re-render to pick up any state changes.
   */
  refresh(): void {
    this.render();
  }

  /**
   * Return the current canvas state.
   */
  getDeckState(): DeckState {
    return this.deckState;
  }

  /**
   * Send a control frame to the server.
   */
  sendControlFrame(action: string, params?: Record<string, unknown>): void {
    this.connection.sendControlFrame(action, params);
  }

  // ---- Resize Handling ----

  /**
   * Called on reconnect (connection.onOpen) and window resize.
   * No-op in Phase 0 (no panels to resize).
   */
  handleResize(): void {
    // No panels in Phase 0; kept for connection.onOpen() compatibility.
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
   * Read the active theme from document.body.classList.
   */
  private readCurrentThemeFromDOM(): string {
    if (typeof document === "undefined") return "brio";
    const prefix = "td-theme-";
    for (const cls of Array.from(document.body.classList)) {
      if (cls.startsWith(prefix)) {
        return cls.slice(prefix.length);
      }
    }
    return "brio";
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
