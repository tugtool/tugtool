/**
 * Action dispatcher for incoming Control frames.
 *
 * Implements a Map-based action registry where handlers can be registered
 * and dispatched based on the action string in Control frame payloads.
 *
 * Phase 0: DevNotificationRef dependency removed, card handlers removed.
 * Phase 2: Added gallerySetterRef and show-component-gallery handler.
 * Spec S04 (#s04-action-dispatch-shape), [D04] Gut action-dispatch
 * Spec S05 (#s05-gallery-action)
 */

import type React from "react";
import type { TugConnection } from "./connection";
import type { DeckManager } from "./deck-manager";
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
 * Module-level reference to the gallery visibility setter, populated by DeckCanvas on mount.
 *
 * Typed as React.Dispatch<React.SetStateAction<boolean>> to support the toggle-via-callback
 * pattern: gallerySetterRef((prev) => !prev). This differs from themeSetterRef which accepts
 * a direct value -- the dispatch type is needed so the toggle can read the previous state.
 *
 * Spec S05 (#s05-gallery-action)
 */
let gallerySetterRef: React.Dispatch<React.SetStateAction<boolean>> | null = null;

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
 * Register the gallery visibility setter from DeckCanvas.
 * Called by DeckCanvas on mount so the show-component-gallery action handler
 * can toggle gallery visibility when the Mac Developer menu item is selected.
 *
 * Last-registration-wins: calling again replaces the previous setter.
 *
 * Spec S05 (#s05-gallery-action)
 */
export function registerGallerySetter(
  setter: React.Dispatch<React.SetStateAction<boolean>>
): void {
  gallerySetterRef = setter;
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
  gallerySetterRef = null;
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

  // set-theme: Switch the active theme via TugThemeProvider
  registerAction("set-theme", (payload) => {
    const theme = payload.theme;
    if (typeof theme !== "string" || !["brio", "bluenote", "harmony"].includes(theme)) {
      console.warn("set-theme: invalid theme", payload);
      return;
    }
    if (themeSetterRef) {
      themeSetterRef(theme);
    } else {
      console.warn("set-theme: theme setter not registered yet");
    }
  });

  // show-component-gallery: Toggle Component Gallery visibility via DeckCanvas state
  registerAction("show-component-gallery", () => {
    if (gallerySetterRef) {
      gallerySetterRef((prev: boolean) => !prev);
    } else {
      console.warn("show-component-gallery: gallery setter not registered yet");
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

  // Suppress unused variable warning -- deckManager retained for future phases
  void deckManager;
}
