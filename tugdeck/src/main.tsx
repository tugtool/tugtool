// CSS HMR boundary — all CSS side-effect imports are consolidated in css-imports.ts,
// which self-accepts HMR updates so CSS changes never trigger a full page reload here.
import "./css-imports";

import initTugmark from "../crates/tugmark-wasm/pkg/tugmark_wasm.js";
import wasmUrl from "../crates/tugmark-wasm/pkg/tugmark_wasm_bg.wasm?url";
import { TugConnection } from "./connection";
import { setConnection } from "./lib/connection-singleton";
import { TugbankClient } from "./lib/tugbank-client";
import { setTugbankClient } from "./lib/tugbank-singleton";
import { DeckManager } from "./deck-manager";
import { initActionDispatch } from "./action-dispatch";
import { readLayout, readTheme, readTabStates, readDeckState } from "./settings-api";
import { getThemeSetter } from "./action-dispatch";
import {
  sendCanvasColor,
  activateProductionTheme,
  readHostCanvasColorFromAppliedCss,
} from "./contexts/theme-provider";
import { BASE_THEME_NAME } from "./theme-constants";
import { registerHelloWorldCard } from "./components/tugways/cards/hello-world-card";
import { registerGitCard } from "./components/tugways/cards/git-card";
import { registerGalleryCards } from "./components/tugways/cards/gallery-registrations";
import { initMotionObserver } from "./components/tugways/scale-timing";
import { initThemeTokens } from "./theme-tokens";
import { initStyleInspector } from "./components/tugways/style-inspector-overlay";
import { selectionGuard } from "./components/tugways/selection-guard";
import { deserialize } from "./serialization";

// Determine WebSocket URL from current page location
const wsUrl = `ws://${window.location.host}/ws`;

// Create connection (module scope — must be synchronous)
export const connection = new TugConnection(wsUrl);

// Register connection in the singleton so modules that cannot safely import
// from main.tsx (due to circular dependency risk) can access it via getConnection().
setConnection(connection);

// Create TugbankClient — registers for DEFAULTS frames on this connection.
// Must be created before connect() so it receives the initial snapshot frame.
const tugbankClient = new TugbankClient(connection);
setTugbankClient(tugbankClient);

// Get the deck container from the DOM (module scope — must be synchronous)
const container = document.getElementById("deck-container");
if (!container) {
  throw new Error("deck-container element not found");
}

// Async IIFE: wait for tugbank data + WASM before constructing DeckManager.
//
// Initialization sequence:
//   1. Connect WebSocket (triggers tugcast to push DEFAULTS frame with all domains)
//   2. Wait for TugbankClient.ready() + WASM init in parallel
//   3. Read layout, theme, deck state from TugbankClient cache (synchronous)
//   4. Deserialize layout, read tab states from cache (synchronous)
//   5. Construct DeckManager with all data
(async () => {
  // Connect first — this triggers the DEFAULTS frame push from tugcast.
  connection.connect();

  // Wait for initial DEFAULTS frame + WASM init in parallel.
  await Promise.all([
    tugbankClient.ready(),
    initTugmark({ module_or_path: wasmUrl }),
  ]);

  // All domain snapshots are now in the TugbankClient cache.
  // Read everything synchronously.
  const layout = readLayout(tugbankClient);
  const theme = readTheme(tugbankClient);
  const focusedCardId = readDeckState(tugbankClient);

  const initialTheme = theme ?? BASE_THEME_NAME;

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

  // Capture the baseline sentinel for theme change detection.
  initThemeTokens();

  // Initialize motion observer early so data-tug-motion attribute is set before
  // DeckManager construction. The cleanup function is intentionally not stored
  // here — the observer should live for the entire app lifetime.
  initMotionObserver();

  // Register card types before DeckManager construction so addCard("hello") works
  // from the first render. Additional card types (settings, about, etc.) will be
  // registered in Phase 9.
  registerHelloWorldCard();
  registerGitCard();
  registerGalleryCards();

  // Initialize the cascade inspector in dev mode only. The cleanup function is
  // intentionally not called during normal app lifetime (same pattern as
  // initMotionObserver) -- the inspector should live for the entire app session.
  // [D02] Dev-only gating via NODE_ENV
  if (process.env.NODE_ENV !== "production") {
    initStyleInspector();
  }

  // Extract tab IDs from the loaded layout and read tab states from cache.
  let tabStates = new Map<string, import("./layout-tree").TabStateBag>();
  if (layout !== null) {
    try {
      const parsed = deserialize(JSON.stringify(layout), 0, 0);
      const tabIds = parsed.cards.flatMap((c) => c.tabs.map((t) => t.id));
      if (tabIds.length > 0) {
        tabStates = readTabStates(tugbankClient, tabIds);
      }
    } catch (e) {
      console.warn("[main] failed to read tab states, continuing without", e);
    }
  }

  // Create deck manager with the pre-fetched layout, initial theme, tab states,
  // and focused card ID.
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

  // React to live tugbank changes pushed via the DEFAULTS WebSocket feed.
  // When an external process writes to tugbank (e.g., `tugbank write ... theme harmony`),
  // the TugbankClient cache updates and this callback fires.
  //
  // Guard: only call the setter if the theme actually changed. Without this,
  // setTheme → putTheme → tugbank write → DEFAULTS push → onDomainChanged → setTheme
  // creates an infinite loop of CSS HMR updates.
  let currentTheme = initialTheme;
  tugbankClient.onDomainChanged((domain, entries) => {
    if (domain === "dev.tugtool.app") {
      const themeEntry = entries["theme"];
      if (themeEntry && themeEntry.kind === "string" && typeof themeEntry.value === "string") {
        if (themeEntry.value !== currentTheme) {
          currentTheme = themeEntry.value;
          const setter = getThemeSetter();
          if (setter) setter(currentTheme);
        }
      }
    }
  });

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

  // Expose a reconnect trigger so the native app can force an immediate
  // WebSocket reconnection after silent re-authentication on tugcast restart.
  (window as unknown as Record<string, unknown>).__tugdeckReconnect = () => {
    connection.forceReconnect();
  };

  // Signal frontend readiness to native app.
  // This fires after theme is applied, canvas color is sent, and DeckManager is
  // constructed — so the WebView can be safely revealed without visual artifacts.
  // Also re-fires on WebSocket reconnection (e.g. after tugcast restart).
  const signalReady = () => {
    const webkit = (window as unknown as {
      webkit?: {
        messageHandlers?: {
          frontendReady?: { postMessage: (v: unknown) => void };
        };
      };
    }).webkit;
    webkit?.messageHandlers?.frontendReady?.postMessage({});
  };
  signalReady();
  connection.onOpen(signalReady);

  console.log("tugdeck initialized");
})();
