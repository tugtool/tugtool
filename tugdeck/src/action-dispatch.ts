/**
 * Action dispatcher for incoming Control frames
 *
 * Implements a Map-based action registry where handlers can be registered
 * and dispatched based on the action string in Control frame payloads.
 */

import type { TugConnection } from "./connection";
import type { DeckManager } from "./deck-manager";
import type { DevNotificationRef } from "./contexts/dev-notification-context";
import { FeedId } from "./protocol";

/** Handler function for an action */
export type ActionHandler = (payload: Record<string, unknown>) => void;

/** Map of action names to handler functions */
const handlers = new Map<string, ActionHandler>();

/** Module-level flag to prevent duplicate reload_frontend calls */
let reloadPending = false;

/** DevNotificationRef for context-based notification dispatch (set by initActionDispatch) */
let devNotificationRef: { current: DevNotificationRef | null } | null = null;

/** TextDecoder for UTF-8 payload decoding */
const textDecoder = new TextDecoder();

/**
 * Register an action handler
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
  devNotificationRef = null;
}

/**
 * Dispatch an action to its registered handler
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
 * Initialize action dispatch system
 *
 * Registers a callback for Control frames and registers all built-in handlers.
 * @param devNotificationRefArg Optional ref to DevNotificationContext for context-based dispatch
 */
export function initActionDispatch(
  connection: TugConnection,
  deckManager: DeckManager,
  devNotificationRefArg?: { current: DevNotificationRef | null }
): void {
  if (devNotificationRefArg) {
    devNotificationRef = devNotificationRefArg;
  }
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

  // show-card: Toggle or focus/create card
  registerAction("show-card", (payload) => {
    const component = payload.component;
    if (typeof component !== "string") {
      console.warn("show-card: missing component parameter", payload);
      return;
    }

    const deckState = deckManager.getDeckState();
    const panel = deckManager.findPanelByComponent(component);

    if (!panel) {
      // No card of this type exists, create one
      deckManager.addNewCard(component);
    } else {
      // Check if this panel is topmost overall (last in array)
      const isTopmost = deckState.cards[deckState.cards.length - 1] === panel;

      if (isTopmost) {
        // Toggle: close the topmost card
        deckManager.closePanelByComponent(component);
      } else {
        // Not topmost: focus it
        deckManager.focusPanel(panel.id);
      }
    }
  });

  // focus-card: Focus existing card (no-op if none)
  registerAction("focus-card", (payload) => {
    const component = payload.component;
    if (typeof component !== "string") {
      console.warn("focus-card: missing component parameter", payload);
      return;
    }

    const panel = deckManager.findPanelByComponent(component);
    if (panel) {
      deckManager.focusPanel(panel.id);
    }
  });

  // close-card: Close topmost card
  registerAction("close-card", (payload) => {
    const component = payload.component;
    if (typeof component !== "string") {
      console.warn("close-card: missing component parameter", payload);
      return;
    }

    deckManager.closePanelByComponent(component);
  });

  // reload_frontend: Reload page with dedup guard
  registerAction("reload_frontend", () => {
    if (reloadPending) {
      // Skip duplicate reload
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

    // Call bridge if available
    const webkit = (window as any).webkit;
    if (webkit?.messageHandlers?.setDevMode) {
      webkit.messageHandlers.setDevMode.postMessage({ enabled });
    } else {
      console.info("set-dev-mode: WKScriptMessageHandler bridge not available");
    }
  });

  // choose-source-tree: Call WKScriptMessageHandler bridge if available
  registerAction("choose-source-tree", () => {
    console.info("choose-source-tree: triggering source tree picker");

    const webkit = (window as any).webkit;
    if (webkit?.messageHandlers?.chooseSourceTree) {
      webkit.messageHandlers.chooseSourceTree.postMessage({});
    } else {
      console.info("choose-source-tree: WKScriptMessageHandler bridge not available");
    }
  });

  // dev_notification: Route to Developer card via DevNotificationContext.
  // Also set dock badge when card is closed and notification is a dirty type.
  registerAction("dev_notification", (payload) => {
    const type = payload.type as string | undefined;
    const count = payload.count as number | undefined;

    // Find Developer card via panel lookup + card registry
    const panel = deckManager.findPanelByComponent("developer");
    let developerCard: any = null;

    if (panel) {
      // Find the tab with componentId === "developer"
      const cardState = deckManager.getDeckState().cards.find((cs) => cs.id === panel.id);
      if (cardState) {
        for (const tabItem of cardState.tabs) {
          if ((tabItem as any).componentId === "developer") {
            developerCard = deckManager.getCardRegistry().get(tabItem.id);
            break;
          }
        }
      }
    }

    if (developerCard && typeof developerCard.update === "function") {
      // Vanilla DeveloperCard: call update() directly
      developerCard.update(payload);
    } else {
      // React DeveloperCard: push notification via DevNotificationContext ref
      devNotificationRef?.current?.notify(payload);

      if (!developerCard) {
        // Card is closed: also set dock badge for dirty notifications
        if (type === "restart_available" || type === "relaunch_available") {
          devNotificationRef?.current?.setBadge("developer", count ?? 0);
        }
      }
    }
  });

  // dev_build_progress: Route to Developer card via DevNotificationContext.
  registerAction("dev_build_progress", (payload) => {
    // Find Developer card same way
    const panel = deckManager.findPanelByComponent("developer");
    let developerCard: any = null;

    if (panel) {
      const cardState = deckManager.getDeckState().cards.find((cs) => cs.id === panel.id);
      if (cardState) {
        for (const tabItem of cardState.tabs) {
          if ((tabItem as any).componentId === "developer") {
            developerCard = deckManager.getCardRegistry().get(tabItem.id);
            break;
          }
        }
      }
    }

    if (developerCard && typeof developerCard.updateBuildProgress === "function") {
      // Vanilla DeveloperCard: call updateBuildProgress() directly
      developerCard.updateBuildProgress(payload);
    } else {
      // React DeveloperCard: push build progress via DevNotificationContext ref
      devNotificationRef?.current?.updateBuildProgress(payload);
    }
    // If card closed, no-op
  });
}
