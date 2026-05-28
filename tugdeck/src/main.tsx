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
import { tugDevPanelStore } from "./lib/tug-dev-panel-store/tug-dev-panel-store";
import { restoreDevSessions } from "./lib/dev-session-restore";
import { attachDevSessionLedgerStore } from "./lib/dev-session-ledger-store";
import { attachSessionStateChangesStore } from "./lib/session-state-changes-store";
import { cardSessionBindingStore } from "./lib/card-session-binding-store";
import {
  ConnectionLifecycle,
  registerConnectionLifecycle,
} from "./lib/connection-lifecycle";
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
import { registerDevCard } from "./components/tugways/cards/dev-card";
import { registerGalleryCards } from "./components/tugways/cards/gallery-registrations";
import { registerDevPanelInspectorTabs } from "./components/tug-dev-panel/inspector-tab-registrations";
import { installDevPlacementGlobal } from "./components/tugways/cards/dev-card-placement-experiment";
import { tugDevLogStore } from "./lib/tug-dev-log-store/tug-dev-log-store";
import { initMotionObserver } from "./components/tugways/scale-timing";
import { initThemeTokens } from "./theme-tokens";
import { deserialize } from "./serialization";
import { attachTugTestSurface } from "./test-surface";
import { installHmrBridge } from "./hmr-bridge";

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
      /**
       * Diagnostic surface — always available, no test-mode gate. Lets
       * a developer paste one-liners into DevTools without knowing the
       * DeckManager internals.
       */
      diag: {
        listCardIds(): string[];
        getDeckState(): unknown;
        getCardState(cardId: string): unknown;
        captureCardState(cardId: string): unknown;
        registeredComponentKeys(cardId: string): string[];
      };
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
    /**
     * DEBUG-only escape hatch on test-mode's persistence bypass.
     * When `true` AND `__tugTestMode` is also `true`, tugdeck still
     * skips the boot-time tugbank reads (so `seedDeckState` remains
     * the source of state truth) but the `put*Guarded` wrappers
     * actually issue their tugbank writes instead of short-circuiting.
     *
     * Used by cold-boot harness tests ([AT0014] / focus round-trips)
     * that pair test-mode IPC with per-test `TUGBANK_PATH` isolation
     * — the temp DB makes the test-mode pollution prevention
     * redundant, and the writes are required for Phase A's "bag is
     * on disk" assertion.
     *
     * Set by a `WKUserScript` injected at `atDocumentStart` when
     * the Swift host starts with `TUGAPP_PERSIST_IN_TEST_MODE=1`.
     * Release builds never reach this path (`#if DEBUG`-gated).
     */
    __tugPersistInTestMode?: boolean;
  }
}

// Determine WebSocket URL from current page location
const wsUrl = `ws://${window.location.host}/ws`;

// Create connection (module scope — must be synchronous)
export const connection = new TugConnection(wsUrl);

// Construct the connection-lifecycle event pipe and attach it to the
// connection BEFORE `connection.connect()` runs below, so the very first
// handshake fires `connectionDidOpen` through the lifecycle. Register it
// as the module singleton for non-React subscribers (mirrors AppLifecycle's
// `registerAppLifecycle` pattern).
export const connectionLifecycle = new ConnectionLifecycle();
connection.setLifecycle(connectionLifecycle);
registerConnectionLifecycle(connectionLifecycle);

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
  registerDevCard();
  registerGalleryCards();
  registerDevPanelInspectorTabs();

  // Dev-build convenience: expose the log store on `window.tugDevLog`
  // so the WebKit Web Inspector console can drive the Log tab without
  // a test-mode harness. Production bundles strip this branch — see
  // Vite's `import.meta.env.DEV` constant folding. The exposed object
  // is the store itself, so `tugDevLog.warn("manual", "msg", {x:1})`
  // and the rest work directly.
  if (import.meta.env.DEV) {
    (window as unknown as { tugDevLog?: typeof tugDevLogStore }).tugDevLog =
      tugDevLogStore;
    installDevPlacementGlobal();
  }

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
  // `atDocumentStart` when `TUGAPP_TEST_SOCKET` is set at app launch.
  // That script is gated by `#if DEBUG` in
  // `tugapp/Sources/TestHarness/TestHarnessUserScript.swift`, so
  // production users never have the global set — making this read
  // safe regardless of build mode. The previous `import.meta.env.DEV`
  // co-gate was a belt-and-braces tree-shake hint; we drop it so the
  // in-app harness can run against a prod-built `dist/` (no Vite),
  // which is ~700ms faster on cold launch.
  const isTestMode = window.__tugTestMode === true;

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

  // Install `window.__tug` test-harness surface when
  // `window.__tugTestMode === true`. The attach is a no-op otherwise;
  // production users never have the global set, since the
  // `WKUserScript` that injects it is `#if DEBUG`-gated in
  // `tugapp/Sources/TestHarness/TestHarnessUserScript.swift`.
  // See `test-surface.ts` for the full surface and attach-site rationale ([D03]/[D08]).
  attachTugTestSurface(deck);

  // Install the Vite-HMR bridge so React Fast Refresh remounts (the
  // dev-only fifth and sixth "known transitions" beyond tab-switch /
  // saveState / beforeunload / close-before-destroy) trigger the
  // same iterate-and-save pass as `beforeunload`. The bridge is a
  // no-op in production — `import.meta.hot` is `undefined` in
  // shipped bundles. See `hmr-bridge.ts` for the full rationale and
  // the [L23] preservation contract this extension honors.
  installHmrBridge(deck);

  // Wire the per-card services store to the deck-manager so it can
  // detect card removals and send `close_session` for any held
  // bindings. Per [L10] this keeps the deck-canvas card-type-agnostic:
  // user-close gestures flow through deck-manager.removeCard, and the
  // services store reacts on its own.
  cardServicesStore.attachDeckManager(deck);

  // Wire the dev panel to deck-manager so it clears its selectedCardId
  // when the selected card is closed. Subscribes once at boot; checks
  // each deck-state notification for removed cards and notifies the
  // dev panel store. No-op when the panel never opens (it lives lazy).
  let knownCardIdsForDevPanel = new Set(
    deck.getSnapshot().cards.map((c) => c.id),
  );
  deck.subscribe(() => {
    const next = new Set(deck.getSnapshot().cards.map((c) => c.id));
    for (const id of knownCardIdsForDevPanel) {
      if (!next.has(id)) {
        tugDevPanelStore.notifyCardGone(id);
      }
    }
    knownCardIdsForDevPanel = next;
  });

  // Wire the tide session-ledger store to the connection. The store
  // dispatches `list_sessions` requests on first observation, subscribes
  // to `session_updated` push frames, and invalidates on reconnect. The
  // picker reads via `useSessionLedger(workspaceKey)` (step 5).
  attachDevSessionLedgerStore(connection);

  // Wire the per-session state-change store to the connection. Without
  // this the singleton is never created — `useSessionStateChanges`
  // finds no active store and the Z2 STATE popover renders a permanent
  // "no state changes recorded yet", even though the supervisor's
  // ledger holds the rows. The store dispatches
  // `list_session_state_changes` on first observation of a session and
  // appends live triple transitions from the local pub/sub bus.
  attachSessionStateChangesStore(connection);

  // Re-assert session bindings for tide cards that were alive before
  // this page reload. The deck layout is materialized;
  // `restoreDevSessions` sends a `list_card_bindings` CONTROL request
  // (the server reads from its sqlite ledger) and emits
  // `spawn_session(mode=resume)` per matching card. The server's ack
  // populates `cardSessionBindingStore`, which flips each card from
  // picker to bound body before `cardDidActivate` fires for any of
  // them.
  restoreDevSessions(deck, connection);

  // Reconnect path: every WebSocket recovery from a close re-runs the
  // restore loop so cards rebind without a page reload after a tugcast
  // restart. The order — clearAll, then re-restore — is per [D04] in
  // roadmap/tugplan-dev-connection-health.md: bindings the client
  // still holds against a now-dead server are worse than no bindings,
  // because they would route frames the new server is not emitting.
  //
  // `connectionDidReconnect` (vs `connectionDidOpen`) is the right event
  // here: it fires only when the wire recovered from a prior close,
  // never on the initial app-boot open. The lifecycle layer maintains
  // the close-then-open gating so this subscriber never has to.
  connectionLifecycle.observeConnectionDidReconnect(() => {
    cardSessionBindingStore.clearAll();
    restoreDevSessions(deck, connection, {
      reason: "reconnect",
    });
  });

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
  // control-frame path is preferred; only these stay as
  // evaluateJavaScript entry points because they're synchronous
  // Swift-initiated RPCs where a WebSocket round-trip is the wrong
  // timing.
  window.tugdeck = {
    saveState: () => deck.saveAndFlushSync(),
    reconnect: () => connection.forceReconnect(),

    /**
     * Diagnostic surface — always available, no test-mode gate. Lets
     * a developer paste one-liners into DevTools without knowing the
     * DeckManager internals. Every method here is read-only: it
     * observes DOM and reads the deck snapshot.
     *
     * Security note. This surface assumes the document context is
     * trusted (Tug.app loads its own bundle into a same-origin
     * WKWebView; the dev server is loopback-bound). The methods
     * return full deck state and any card's bag. Do not expose
     * `tugdeck` to untrusted iframes or cross-origin contexts —
     * `getDeckState` would become an exfiltration channel.
     */
    diag: {
      /** Card ids currently in the deck, in z-order (last = top). */
      listCardIds: () => deck.getSnapshot().cards.map((c) => c.id),
      /** Full active state — for ad-hoc inspection only. */
      getDeckState: () => deck.getSnapshot(),
      /** The bag currently in the cardStateCache for `cardId`. */
      getCardState: (cardId: string) => deck.getCardState(cardId),
      /**
       * Capture the bag for `cardId` right now via the orchestrator —
       * same code path every save trigger runs. Use to verify what
       * the framework would write if a save fired at this moment.
       * Does NOT write to the store or to tugbank.
       */
      captureCardState: (cardId: string) => deck.captureCardState(cardId),
      /**
       * Scoped keys currently registered in `cardId`'s component-state
       * preservation registry. Empty array when no registry exists or
       * no consumers have registered.
       */
      registeredComponentKeys: (cardId: string) => {
        const reg = deck.peekComponentStatePreservationRegistry(cardId);
        return reg ? Array.from(reg.keys()) : [];
      },
    },
  };

  // Signal frontend readiness to native app.
  // This fires after theme is applied, canvas color is sent, and DeckManager is
  // constructed — so the WebView can be safely revealed without visual artifacts.
  // Subscribed via `connectionDidOpen` (not `connectionDidReconnect`) because
  // signalReady should also re-fire on every reconnect — the WebView host
  // tracks readiness per-connection.
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
  connectionLifecycle.observeConnectionDidOpen(signalReady);

  console.log("tugdeck initialized");
})();
