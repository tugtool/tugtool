// CSS imports — globals.css imports tailwindcss and tokens.css
import "./globals.css";
import "../styles/chrome.css";

import { TugConnection } from "./connection";
import { DeckManager } from "./deck-manager";
import { initActionDispatch } from "./action-dispatch";
import { fetchSettingsWithRetry } from "./settings-api";

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
(async () => {
  const serverSettings = await fetchSettingsWithRetry("/api/settings");

  // Apply theme to document.body before DeckManager construction.
  const THEME_CLASS_PREFIX = "td-theme-";
  for (const cls of Array.from(document.body.classList)) {
    if (cls.startsWith(THEME_CLASS_PREFIX)) {
      document.body.classList.remove(cls);
    }
  }
  if (serverSettings.theme && serverSettings.theme !== "brio") {
    document.body.classList.add(`${THEME_CLASS_PREFIX}${serverSettings.theme}`);
  }

  // Create deck manager with the pre-fetched layout.
  const deck = new DeckManager(
    container,
    connection,
    serverSettings.layout ?? undefined
  );

  // Initialize action dispatch (no DevNotificationRef in Phase 0).
  initActionDispatch(connection, deck);

  // Signal frontend readiness to native app (enables menu items).
  connection.onOpen(() => {
    const webkit = (window as unknown as { webkit?: { messageHandlers?: { frontendReady?: { postMessage: (v: unknown) => void } } } }).webkit;
    webkit?.messageHandlers?.frontendReady?.postMessage({});
  });

  // Connect to the server.
  connection.connect();

  console.log("tugdeck initialized");
})();
