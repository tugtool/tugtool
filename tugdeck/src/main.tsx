// CSS imports — globals.css imports tailwindcss and tokens.css
import "./globals.css";
import "../styles/chrome.css";

import { TugConnection } from "./connection";
import { DeckManager } from "./deck-manager";
import { initActionDispatch } from "./action-dispatch";
import { fetchSettingsWithRetry } from "./settings-api";
import {
  applyInitialTheme,
  sendCanvasColor,
  type ThemeName,
} from "./contexts/theme-provider";
import { registerHelloCard } from "./components/tugways/cards/hello-card";
import { registerGalleryCards } from "./components/tugways/cards/gallery-card";
import { injectPaletteCSS } from "./components/tugways/palette-engine";

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

  // Apply the initial theme via stylesheet injection before DeckManager construction
  // so the correct colors are visible before React renders.
  const initialTheme = (serverSettings.theme as ThemeName) ?? "brio";
  applyInitialTheme(initialTheme);

  // Inject palette CSS variables before React mounts so they are available
  // to any component that reads them on first render. Must come after
  // applyInitialTheme so any theme parameter overrides are in the DOM when
  // getComputedStyle reads them. [D04]
  injectPaletteCSS(initialTheme);

  // Sync canvas color to Swift bridge so UserDefaults gets the correct
  // background color on startup before the user switches themes.
  sendCanvasColor();

  // Register card types before DeckManager construction so addCard("hello") works
  // from the first render. Additional card types (settings, about, etc.) will be
  // registered in Phase 9.
  registerHelloCard();
  registerGalleryCards();

  // Create deck manager with the pre-fetched layout and initial theme.
  const deck = new DeckManager(
    container,
    connection,
    serverSettings.layout ?? undefined,
    initialTheme
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
