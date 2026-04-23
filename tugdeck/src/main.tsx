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
import { cardServicesStore } from "./lib/card-services-store";
import { restoreTideSessions } from "./lib/tide-session-restore";
import { readLayout, readTheme, readCardStates, readDeckState } from "./settings-api";
import { getThemeSetter } from "./action-dispatch";
import {
  sendCanvasColor,
  activateProductionTheme,
  readHostCanvasColorFromAppliedCss,
} from "./contexts/theme-provider";
import { BASE_THEME_NAME } from "./theme-constants";
import { registerHelloWorldCard } from "./components/tugways/cards/hello-world-card";
import { registerGitCard } from "./components/tugways/cards/git-card";
import { registerTideCard } from "./components/tugways/cards/tide-card";
import { registerGalleryCards } from "./components/tugways/cards/gallery-registrations";
import { initMotionObserver } from "./components/tugways/scale-timing";
import { initThemeTokens } from "./theme-tokens";
import { deserialize } from "./serialization";

/**
 * `window.tugdeck` — the single namespace the native Swift host uses
 * for synchronous `evaluateJavaScript` entry points. Only the two
 * methods installed below live here. Typed via `declare global` so
 * consumers get IDE autocomplete and so the assignment below is a
 * straightforward `window.tugdeck = { ... }` rather than a cast
 * through `Record<string, unknown>`.
 */
declare global {
  interface Window {
    tugdeck?: {
      saveState(): void;
      reconnect(): void;
    };
    /**
     * DEBUG-only harness boot flag. When `true`, tugdeck constructs
     * `DeckManager` with `testMode: true` — no tugbank reads, no
     * tugbank writes, state sourced exclusively from `seedDeckState`.
     * Set by a `WKUserScript` injected at `atDocumentStart` in
     * DEBUG builds when the Swift host starts with
     * `TUGAPP_TEST_SOCKET` set ([D08]). Release builds never reach
     * this path because the WKUserScript is gated by `#if DEBUG`.
     */
    __tugTestMode?: boolean;
  }
}

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
//   4. Deserialize layout, read per-card state from cache (synchronous)
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
  registerTideCard();
  registerGalleryCards();

  // Extract card IDs from the loaded layout and read per-card state bags
  // from the tugbank cache (`dev.tugtool.deck.cardstate`).
  let cardStates = new Map<string, import("./layout-tree").CardStateBag>();
  if (layout !== null) {
    try {
      const parsed = deserialize(JSON.stringify(layout), 0, 0);
      const cardIds = parsed.cards.map((c) => c.id);
      if (cardIds.length > 0) {
        cardStates = readCardStates(tugbankClient, cardIds);
      }
    } catch (e) {
      console.warn("[main] failed to read per-card states, continuing without", e);
    }
  }

  // DEBUG-only test-mode flag ([D02], [D08]). The Swift host injects
  // `window.__tugTestMode = true` via a `WKUserScript` at
  // `atDocumentStart` when `TUGAPP_TEST_SOCKET` is set at app launch;
  // that script runs before this module executes, so the read here is
  // deterministic. The `import.meta.env.DEV` gate is a belt-and-braces
  // check — release builds never inject the user script in the first
  // place ([D03]), but the double-guard keeps the read from doing
  // anything in production even if the global were set by some other
  // path.
  const isTestMode =
    import.meta.env.DEV && window.__tugTestMode === true;

  // Create deck manager with the pre-fetched layout, initial theme, card states,
  // and focused card ID. In test mode, `DeckManager` ignores the
  // tugbank-sourced arguments and starts empty — the harness drives
  // state via `seedDeckState`.
  const deck = new DeckManager(
    container,
    connection,
    layout ?? undefined,
    initialTheme,
    cardStates,
    focusedCardId ?? undefined,
    { testMode: isTestMode }
  );

  // Initialize action dispatch (no DevNotificationRef in Phase 0).
  initActionDispatch(connection, deck);

  // Wire the per-card services store to the deck-manager so it can
  // detect card removals and send `close_session` for any held
  // bindings. Per [L10] this keeps the deck-canvas card-type-agnostic:
  // user-close gestures flow through deck-manager.removeCard, and the
  // services store reacts on its own.
  cardServicesStore.attachDeckManager(deck);

  // Re-assert session bindings for tide cards that were alive before
  // this page reload. The tugbank cache is already populated (we awaited
  // `tugbankClient.ready()` above) and the deck layout is materialized;
  // `restoreTideSessions` reads per-card records from tugbank and emits
  // `spawn_session(mode=resume)` for each. The server's ack populates
  // `cardSessionBindingStore`, which flips each card from picker to
  // bound body before `cardDidActivate` fires for any of them.
  restoreTideSessions(deck, tugbankClient, connection);

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

  // `window.tugdeck` — the single namespace the native app (Swift) uses
  // for synchronous evaluateJavaScript entry points. Only two methods
  // live here, both driven from the Swift host:
  //
  //   - `saveState()` — triggers `DeckManager.saveAndFlushSync()` before
  //     WebView teardown on app quit. Synchronous XHR so all writes
  //     complete before evaluateJavaScript returns. Called from
  //     `applicationShouldTerminate` — WKWebView doesn't fire
  //     visibilitychange or beforeunload on quit, so this is the only
  //     reliable save-on-quit path.
  //   - `reconnect()` — forces a WebSocket reconnection. Called after
  //     silent re-authentication when tugcast restarts.
  //
  // App lifecycle events (become-active / resign-active / hide / unhide)
  // ride the `app-lifecycle` control frame instead, routed through
  // `action-dispatch.ts` to the `AppLifecycle` singleton. The
  // control-frame path is preferred; only these two stay as
  // evaluateJavaScript entry points because they're synchronous
  // Swift-initiated RPCs where a WebSocket round-trip is the wrong
  // timing.
  window.tugdeck = {
    saveState: () => deck.saveAndFlushSync(),
    reconnect: () => connection.forceReconnect(),
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
