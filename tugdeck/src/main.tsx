// CSS HMR boundary — all CSS side-effect imports are consolidated in css-imports.ts,
// which self-accepts HMR updates so CSS changes never trigger a full page reload here.
import "./css-imports";

import { TugConnection } from "./connection";
import { DeckManager } from "./deck-manager";
import { initActionDispatch } from "./action-dispatch";
import { fetchLayoutWithRetry, fetchThemeWithRetry, fetchTabStatesWithRetry, fetchDeckStateWithRetry } from "./settings-api";
import {
  sendCanvasColor,
  activateProductionTheme,
  readHostCanvasColorFromAppliedCss,
} from "./contexts/theme-provider";
import { BASE_THEME_NAME } from "./theme-constants";
import { registerHelloWorldCard } from "./components/tugways/cards/hello-world-card";
import { registerGalleryCards } from "./components/tugways/cards/gallery-card";
import { initMotionObserver } from "./components/tugways/scale-timing";
import { initStyleInspector } from "./components/tugways/style-inspector-overlay";
import { selectionGuard } from "./components/tugways/selection-guard";
import { deserialize } from "./serialization";

// Determine WebSocket URL from current page location
const wsUrl = `ws://${window.location.host}/ws`;

// Create connection (module scope — must be synchronous)
const connection = new TugConnection(wsUrl);

// Get the deck container from the DOM (module scope — must be synchronous)
const container = document.getElementById("deck-container");
if (!container) {
  throw new Error("deck-container element not found");
}

// Async IIFE: fetch settings before constructing DeckManager so the pre-fetched
// layout and theme are applied before React renders.
//
// Phase 5f two-phase initialization:
//   Phase 1: Fetch layout, theme, and deck state (focusedCardId) in parallel.
//            These three are independent of each other.
//   Phase 2: Deserialize the layout to extract all tab IDs, then fetch tab
//            states in parallel via fetchTabStatesWithRetry(tabIds).
//            Tab state fetch depends on tab IDs from the deserialized layout,
//            so it cannot be parallelized with the layout fetch itself.
(async () => {
  // Phase 1: parallel fetch of layout, theme, and focused card ID.
  const [layout, theme, focusedCardId] = await Promise.all([
    fetchLayoutWithRetry(),
    fetchThemeWithRetry(),
    fetchDeckStateWithRetry(),
  ]);

  const initialTheme = (theme as string) ?? BASE_THEME_NAME;

  // Production startup: apply saved non-base override before first render so
  // the app does not flash brio and then restyle.
  if (import.meta.env.PROD) {
    await activateProductionTheme(initialTheme);
  }

  // Sync canvas color to Swift bridge from the applied CSS metadata token.
  const initialHostCanvasColor = readHostCanvasColorFromAppliedCss();
  if (initialHostCanvasColor !== null) {
    sendCanvasColor(initialHostCanvasColor);
  }

  // Initialize motion observer early so data-tug-motion attribute is set before
  // DeckManager construction. The cleanup function is intentionally not stored
  // here — the observer should live for the entire app lifetime.
  initMotionObserver();

  // Register card types before DeckManager construction so addCard("hello") works
  // from the first render. Additional card types (settings, about, etc.) will be
  // registered in Phase 9.
  registerHelloWorldCard();
  registerGalleryCards();

  // Initialize the cascade inspector in dev mode only. The cleanup function is
  // intentionally not called during normal app lifetime (same pattern as
  // initMotionObserver) -- the inspector should live for the entire app session.
  // [D02] Dev-only gating via NODE_ENV
  if (process.env.NODE_ENV !== "production") {
    initStyleInspector();
  }

  // Phase 5f Phase 2: extract tab IDs from the loaded layout and fetch tab states.
  // This must run after the layout fetch (depends on tab IDs) but before
  // DeckManager construction (tab state cache must be warm for first render).
  //
  // Extract tab IDs without constructing DeckManager.
  // Canvas dimensions are not needed for tab ID extraction — use 0 as placeholders
  // (the geometry is re-applied inside DeckManager via loadLayout).
  let tabStates = new Map<string, import("./layout-tree").TabStateBag>();
  if (layout !== null) {
    try {
      const parsed = deserialize(JSON.stringify(layout), 0, 0);
      const tabIds = parsed.cards.flatMap((c) => c.tabs.map((t) => t.id));
      if (tabIds.length > 0) {
        tabStates = await fetchTabStatesWithRetry(tabIds);
      }
    } catch (e) {
      console.warn("[main] Phase 5f: failed to fetch tab states, continuing without", e);
    }
  }

  // Create deck manager with the pre-fetched layout, initial theme, tab states,
  // and focused card ID (Phase 5f).
  const deck = new DeckManager(
    container,
    connection,
    layout ?? undefined,
    initialTheme,
    tabStates,
    focusedCardId ?? undefined
  );

  // Initialize action dispatch (no DevNotificationRef in Phase 0).
  initActionDispatch(connection, deck);

  // Expose a global save-state function so the native app (Swift) can trigger
  // a synchronous save of all card states before terminating the WebView.
  // WKWebView does not fire visibilitychange or beforeunload on app quit,
  // so the native side calls this via evaluateJavaScript in
  // applicationShouldTerminate. Uses synchronous XHR so the native side can
  // safely tear down after evaluateJavaScript completes.
  (window as unknown as Record<string, unknown>).__tugdeckSaveState = () => {
    deck.saveAndFlushSync();
  };

  // App deactivation: save all card states to tugbank and dim all selections.
  // Called by Swift via applicationDidResignActive. Uses normal async fetch
  // (not sync) because the app and tugcast are still running.
  (window as unknown as Record<string, unknown>).__tugdeckAppDeactivated = () => {
    deck.saveAndFlush();
    selectionGuard.deactivateApp();
  };

  // App activation: restore the active card's selection highlight.
  // Called by Swift via applicationDidBecomeActive.
  (window as unknown as Record<string, unknown>).__tugdeckAppActivated = () => {
    selectionGuard.activateApp();
  };

  // Signal frontend readiness to native app (enables menu items).
  connection.onOpen(() => {
    const webkit = (window as unknown as {
      webkit?: {
        messageHandlers?: {
          frontendReady?: { postMessage: (v: unknown) => void };
        };
      };
    }).webkit;
    webkit?.messageHandlers?.frontendReady?.postMessage({});
  });

  // Connect to the server.
  connection.connect();

  console.log("tugdeck initialized");
})();
