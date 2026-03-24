/**
 * Action dispatcher for incoming Control frames.
 *
 * Implements a Map-based action registry where handlers can be registered
 * and dispatched based on the action string in Control frame payloads.
 *
 * Phase 0: DevNotificationRef dependency removed, card handlers removed.
 * Phase 2: Added gallerySetterRef and show-component-gallery handler.
 * Phase 5b3 (Step 6): Removed gallerySetterRef and registerGallerySetter.
 *   show-component-gallery now dispatches "showComponentGallery" through
 *   the responder chain manager (same pattern as add-tab).
 * Spec S04 (#s04-action-dispatch-shape), [D04] Gut action-dispatch
 * Spec S05 (#s05-gallery-action)
 */

import type { TugConnection } from "./connection";
import type { DeckManager } from "./deck-manager";
import type { ResponderChainManager } from "./components/tugways/responder-chain";
import { FeedId } from "./protocol";

/** Handler function for an action */
export type ActionHandler = (payload: Record<string, unknown>) => void;

/** Map of action names to handler functions */
const handlers = new Map<string, ActionHandler>();

/** Module-level flag to prevent duplicate reload_frontend calls */
let reloadPending = false;

/** Module-level reference to the theme setter, populated by TugThemeProvider on mount. */
let themeSetterRef: ((theme: string) => void) | null = null;

/**
 * Module-level reference to the ResponderChainManager, populated by
 * ResponderChainProvider on mount via `registerResponderChainManager`.
 *
 * Used by the `add-tab` and `show-component-gallery` Control-frame actions
 * to dispatch through the responder chain, which routes them to DeckCanvas's
 * registered handlers.
 *
 * [D06] Add-tab action uses DeckManager + responder chain
 * [D09] Add-tab routed as DeckCanvas responder action
 */
let responderChainManagerRef: ResponderChainManager | null = null;

/**
 * Register the theme setter function from TugThemeProvider.
 * Called by TugThemeProvider on mount so the set-theme action handler
 * can call it when a Theme submenu item is selected.
 */
export function registerThemeSetter(setter: (theme: string) => void): void {
  themeSetterRef = setter;
}

/**
 * Get the registered theme setter (used by the set-theme action handler).
 * Returns null if TugThemeProvider has not yet mounted.
 */
export function getThemeSetter(): ((theme: string) => void) | null {
  return themeSetterRef;
}

/**
 * Register the ResponderChainManager from ResponderChainProvider.
 * Called by ResponderChainProvider on mount so the `add-tab` and
 * `show-component-gallery` action handlers can dispatch through the chain.
 *
 * Last-registration-wins: calling again replaces the previous manager.
 *
 * [D06] Add-tab action uses DeckManager + responder chain
 */
export function registerResponderChainManager(manager: ResponderChainManager): void {
  responderChainManagerRef = manager;
}

/** TextDecoder for UTF-8 payload decoding */
const textDecoder = new TextDecoder();

/**
 * Register an action handler.
 */
export function registerAction(action: string, handler: ActionHandler): void {
  handlers.set(action, handler);
}

/**
 * Reset handler registry and module state for test isolation.
 * Internal/test-only -- must never be called from production code.
 */
export function _resetForTest(): void {
  handlers.clear();
  reloadPending = false;
  themeSetterRef = null;
  responderChainManagerRef = null;
}

/**
 * Dispatch an action to its registered handler.
 */
export function dispatchAction(payload: Record<string, unknown>): void {
  const action = payload.action;
  if (typeof action !== "string") {
    console.warn("dispatchAction: payload missing action field", payload);
    return;
  }

  const handler = handlers.get(action);
  if (handler) {
    handler(payload);
  } else {
    console.warn(`dispatchAction: unknown action: ${action}`, payload);
  }
}

/**
 * Initialize action dispatch system.
 *
 * Registers a callback for Control frames and registers all built-in handlers.
 */
export function initActionDispatch(
  connection: TugConnection,
  deckManager: DeckManager
): void {
  // Register Control frame callback
  connection.onFrame(FeedId.CONTROL, (payload: Uint8Array) => {
    try {
      const json = textDecoder.decode(payload);
      const data = JSON.parse(json) as Record<string, unknown>;
      dispatchAction(data);
    } catch (error) {
      console.error("initActionDispatch: failed to parse Control frame", error);
    }
  });

  // Register built-in handlers

  // reload_frontend: Reload page with dedup guard
  registerAction("reload_frontend", () => {
    if (reloadPending) {
      return;
    }
    reloadPending = true;
    location.reload();
  });

  // reset: Clear all localStorage
  registerAction("reset", () => {
    localStorage.clear();
  });

  // set-dev-mode: Call WKScriptMessageHandler bridge if available
  registerAction("set-dev-mode", (payload) => {
    const enabled = payload.enabled;
    if (typeof enabled !== "boolean") {
      console.warn("set-dev-mode: missing or invalid enabled parameter", payload);
      return;
    }

    console.info(`set-dev-mode: enabled=${enabled}`);

    const webkit = (globalThis as unknown as Record<string, unknown>).webkit as Record<string, unknown> | undefined;
    const messageHandlers = webkit?.messageHandlers as Record<string, unknown> | undefined;
    if (messageHandlers?.setDevMode) {
      (messageHandlers.setDevMode as { postMessage: (v: unknown) => void }).postMessage({ enabled });
    } else {
      console.info("set-dev-mode: WKScriptMessageHandler bridge not available");
    }
  });

  // set-theme: Switch the active theme via TugThemeProvider.
  // Accepts any string theme name — validation is delegated to the theme provider,
  // which fetches CSS via middleware and handles 404s gracefully. [D07]
  // The Swift AppDelegate sends this action from the Theme submenu.
  registerAction("set-theme", (payload) => {
    const theme = payload.theme;
    if (typeof theme !== "string") {
      console.warn("set-theme: invalid theme", payload);
      return;
    }
    if (themeSetterRef) {
      themeSetterRef(theme);
    } else {
      console.warn("set-theme: theme setter not registered yet");
    }
  });

  // show-component-gallery: Show the Component Gallery card via DeckCanvas responder action.
  // Dispatches "showComponentGallery" through the ResponderChainManager, which routes it
  // to DeckCanvas's registered showComponentGallery handler. DeckCanvas finds or creates
  // the gallery card and focuses it. ([D05], [D07] show-only semantics)
  registerAction("show-component-gallery", () => {
    if (responderChainManagerRef) {
      responderChainManagerRef.dispatch({ action: "showComponentGallery", phase: "discrete" });
    } else {
      console.warn("show-component-gallery: responder chain manager not registered yet");
    }
  });

  // show-style-inspector: Show the Style Inspector card via DeckCanvas responder action.
  // Dispatches "showStyleInspector" through the ResponderChainManager, which routes it
  // to DeckCanvas's registered showStyleInspector handler. DeckCanvas finds or creates
  // the inspector card and focuses it. ([D04] show action pattern)
  registerAction("show-style-inspector", () => {
    if (responderChainManagerRef) {
      responderChainManagerRef.dispatch({ action: "showStyleInspector", phase: "discrete" });
    } else {
      console.warn("show-style-inspector: responder chain manager not registered yet");
    }
  });

  // choose-source-tree: Call WKScriptMessageHandler bridge if available
  registerAction("choose-source-tree", () => {
    console.info("choose-source-tree: triggering source tree picker");

    const webkit = (globalThis as unknown as Record<string, unknown>).webkit as Record<string, unknown> | undefined;
    const messageHandlers = webkit?.messageHandlers as Record<string, unknown> | undefined;
    if (messageHandlers?.chooseSourceTree) {
      (messageHandlers.chooseSourceTree as { postMessage: (v: unknown) => void }).postMessage({});
    } else {
      console.info("choose-source-tree: WKScriptMessageHandler bridge not available");
    }
  });

  // show-card: Add a card by componentId (Spec S08)
  // The AppDelegate already sends show-card with component: "settings" and
  // component: "about" -- those will log a warning and return null from addCard
  // until Phase 9 registers those card types. This is correct behavior.
  registerAction("show-card", (payload) => {
    const component = payload.component;
    if (typeof component !== "string") {
      console.warn("show-card: missing or invalid component parameter", payload);
      return;
    }
    deckManager.addCard(component);
  });

  // add-tab: Add a new tab to the focused card via the responder chain.
  // Dispatches "addTab" through the ResponderChainManager, which routes it to
  // DeckCanvas's registered addTab handler. DeckCanvas reads the focused card
  // from its cardsRef and calls store.addTab(). ([D06], [D09])
  registerAction("add-tab", () => {
    if (responderChainManagerRef) {
      responderChainManagerRef.dispatch({ action: "addTab", phase: "discrete" });
    } else {
      console.warn("add-tab: responder chain manager not registered yet");
    }
  });
}
