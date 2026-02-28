// CSS imports — globals.css imports tailwindcss and tokens.css (which provides the shadcn variable bridge)
import "./globals.css";
import "../styles/cards-chrome.css";
// dock.css deleted in Step 5 — Dock styles are now Tailwind utilities on the React Dock component
// xterm CSS — previously mapped via assets.toml; now imported directly from node_modules
import "@xterm/xterm/css/xterm.css";

// Dev-flash diagnostic: log when this module executes to track startup timing.
// Note: inline <script> in index.html would be blocked by the CSP (script-src 'self' 'wasm-unsafe-eval').
console.debug("[dev-flash] main.tsx module executed", Date.now());

import React from "react";
import { createRoot } from "react-dom/client";
import { TugConnection } from "./connection";
import { DeckManager } from "./deck-manager";
import { ReactCardAdapter } from "./cards/react-card-adapter";
import { AboutCard as AboutCardComponent } from "./components/cards/about-card";
import { SettingsCard as SettingsCardComponent } from "./components/cards/settings-card";
import { FilesCard as FilesCardComponent } from "./components/cards/files-card";
import { GitCard as GitCardComponent } from "./components/cards/git-card";
import { StatsCard as StatsCardComponent } from "./components/cards/stats-card";
import { DeveloperCard as DeveloperCardComponent } from "./components/cards/developer-card";
import { ConversationCard as ConversationCardComponent } from "./components/cards/conversation/conversation-card";
import { TerminalCard as TerminalCardComponent } from "./components/cards/terminal-card";
import { FeedId } from "./protocol";
import { Dock } from "./components/chrome/dock";
import type { DockCallbacks } from "./components/chrome/dock";
import { initActionDispatch, dispatchAction } from "./action-dispatch";
import { CARD_TITLES } from "./card-titles";

// Determine WebSocket URL from current page location
const wsUrl = `ws://${window.location.host}/ws`;

// Create connection
const connection = new TugConnection(wsUrl);

// Get the deck container from the DOM
const container = document.getElementById("deck-container");
if (!container) {
  throw new Error("deck-container element not found");
}

// Create deck manager
const deck = new DeckManager(container, connection);

// Register card factories for multi-instance and reset-layout support.
// Factories capture connection in their closures; TugConnection is a single
// instance that reconnects internally, so the reference stays valid.
deck.registerCardFactory("code", () => {
  const adapter = new ReactCardAdapter({
    component: ConversationCardComponent,
    feedIds: [FeedId.CODE_OUTPUT],
    initialMeta: { title: CARD_TITLES.code, icon: "MessageSquare", closable: true, menuItems: [] },
    connection,
  });
  adapter.setDragState(deck);
  return adapter;
});
deck.registerCardFactory("terminal", () => {
  const adapter = new ReactCardAdapter({
    component: TerminalCardComponent,
    feedIds: [FeedId.TERMINAL_OUTPUT],
    initialMeta: { title: CARD_TITLES.terminal, icon: "Terminal", closable: true, menuItems: [] },
    connection,
  });
  adapter.setDragState(deck);
  return adapter;
});
deck.registerCardFactory("git", () => new ReactCardAdapter({
  component: GitCardComponent,
  feedIds: [FeedId.GIT],
  initialMeta: { title: CARD_TITLES.git, icon: "GitBranch", closable: true, menuItems: [] },
}));
deck.registerCardFactory("files", () => new ReactCardAdapter({
  component: FilesCardComponent,
  feedIds: [FeedId.FILESYSTEM],
  initialMeta: { title: CARD_TITLES.files, icon: "FolderOpen", closable: true, menuItems: [] },
}));
deck.registerCardFactory("stats", () => new ReactCardAdapter({
  component: StatsCardComponent,
  feedIds: [FeedId.STATS, FeedId.STATS_PROCESS_INFO, FeedId.STATS_TOKEN_USAGE, FeedId.STATS_BUILD_STATUS],
  initialMeta: { title: CARD_TITLES.stats, icon: "Activity", closable: true, menuItems: [] },
}));
deck.registerCardFactory("about", () => new ReactCardAdapter({
  component: AboutCardComponent,
  feedIds: [],
  initialMeta: { title: CARD_TITLES.about, icon: "Info", closable: true, menuItems: [] },
}));
deck.registerCardFactory("settings", () => new ReactCardAdapter({
  component: SettingsCardComponent,
  feedIds: [],
  initialMeta: { title: CARD_TITLES.settings, icon: "Settings", closable: true, menuItems: [] },
  connection,
}));
deck.registerCardFactory("developer", () => new ReactCardAdapter({
  component: DeveloperCardComponent,
  feedIds: [FeedId.GIT],
  initialMeta: { title: CARD_TITLES.developer, icon: "Code", closable: true, menuItems: [] },
  connection,
}));

// Create and register initial card instances
// DeckManager.addCard matches cards to layout tree TabItems by componentId

const codeAdapter = new ReactCardAdapter({
  component: ConversationCardComponent,
  feedIds: [FeedId.CODE_OUTPUT],
  initialMeta: { title: CARD_TITLES.code, icon: "MessageSquare", closable: true, menuItems: [] },
  connection,
});
codeAdapter.setDragState(deck);
deck.addCard(codeAdapter, "code");

const terminalAdapter = new ReactCardAdapter({
  component: TerminalCardComponent,
  feedIds: [FeedId.TERMINAL_OUTPUT],
  initialMeta: { title: CARD_TITLES.terminal, icon: "Terminal", closable: true, menuItems: [] },
  connection,
});
terminalAdapter.setDragState(deck);
deck.addCard(terminalAdapter, "terminal");

deck.addCard(new ReactCardAdapter({
  component: GitCardComponent,
  feedIds: [FeedId.GIT],
  initialMeta: { title: CARD_TITLES.git, icon: "GitBranch", closable: true, menuItems: [] },
}), "git");
deck.addCard(new ReactCardAdapter({
  component: FilesCardComponent,
  feedIds: [FeedId.FILESYSTEM],
  initialMeta: { title: CARD_TITLES.files, icon: "FolderOpen", closable: true, menuItems: [] },
}), "files");
deck.addCard(new ReactCardAdapter({
  component: StatsCardComponent,
  feedIds: [FeedId.STATS, FeedId.STATS_PROCESS_INFO, FeedId.STATS_TOKEN_USAGE, FeedId.STATS_BUILD_STATUS],
  initialMeta: { title: CARD_TITLES.stats, icon: "Activity", closable: true, menuItems: [] },
}), "stats");

// Re-render so CardFrame headers pick up card meta (menu buttons)
deck.refresh();

// Initialize action dispatch system (must be done before Dock is rendered so
// the show-card handler is registered when Dock icon buttons are first clicked)
initActionDispatch(connection, deck);

// Render React Dock (48px vertical rail on right viewport edge).
// Temporarily rendered as a separate React root; Step 7 unifies it into DeckCanvas.
const dockContainer = document.createElement("div");
document.body.appendChild(dockContainer);

const dockCallbacks: DockCallbacks = {
  onShowCard: (cardType: string) => {
    dispatchAction({ action: "show-card", component: cardType });
  },
  onResetLayout: () => deck.resetLayout(),
  onRestartServer: () => deck.sendControlFrame("restart"),
  onResetEverything: () => {
    // Clear localStorage before sending reset, since the server
    // will exit and the WebSocket will close
    localStorage.clear();
    deck.sendControlFrame("reset");
  },
  onReloadFrontend: () => deck.sendControlFrame("reload_frontend"),
};

const dockRoot = createRoot(dockContainer);
dockRoot.render(React.createElement(Dock, { callbacks: dockCallbacks }));

// Signal frontend readiness to native app (enables menu items)
connection.onOpen(() => {
  (window as any).webkit?.messageHandlers?.frontendReady?.postMessage({});
});

// Connect to the server
connection.connect();

console.log("tugdeck initialized");
