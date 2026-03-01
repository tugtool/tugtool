// CSS imports — globals.css imports tailwindcss and tokens.css (which provides the shadcn variable bridge)
import "./globals.css";
import "../styles/cards-chrome.css";
// dock.css deleted in Step 5 — Dock styles are now Tailwind utilities on the React Dock component
// xterm CSS — previously mapped via assets.toml; now imported directly from node_modules
import "@xterm/xterm/css/xterm.css";

// Dev-flash diagnostic: log when this module executes to track startup timing.
// Note: inline <script> in index.html would be blocked by the CSP (script-src 'self' 'wasm-unsafe-eval').
console.debug("[dev-flash] main.tsx module executed", Date.now());

import { TugConnection } from "./connection";
import { DeckManager } from "./deck-manager";
import { ReactCardAdapter } from "./cards/react-card-adapter";
import type { CardConfig } from "./components/chrome/deck-canvas";
import { AboutCard as AboutCardComponent } from "./components/cards/about-card";
import { SettingsCard as SettingsCardComponent } from "./components/cards/settings-card";
import { FilesCard as FilesCardComponent } from "./components/cards/files-card";
import { GitCard as GitCardComponent } from "./components/cards/git-card";
import { StatsCard as StatsCardComponent } from "./components/cards/stats-card";
import { DeveloperCard as DeveloperCardComponent } from "./components/cards/developer-card";
import { ConversationCard as ConversationCardComponent } from "./components/cards/conversation/conversation-card";
import { TerminalCard as TerminalCardComponent } from "./components/cards/terminal-card";
import { FeedId } from "./protocol";
import { initActionDispatch, dispatchAction } from "./action-dispatch";
import { CARD_TITLES } from "./card-titles";
import type { DockCallbacks } from "./components/chrome/dock";

// Determine WebSocket URL from current page location
const wsUrl = `ws://${window.location.host}/ws`;

// Create connection
const connection = new TugConnection(wsUrl);

// Get the deck container from the DOM
const container = document.getElementById("deck-container");
if (!container) {
  throw new Error("deck-container element not found");
}

// Create deck manager (creates single React root internally)
const deck = new DeckManager(container, connection);

// ---- Card configs for DeckCanvas rendering ----
// These configs are used by DeckCanvas to render card components directly
// in the unified React tree. No per-card createRoot calls.

const codeConfig: CardConfig = {
  component: ConversationCardComponent,
  feedIds: [FeedId.CODE_OUTPUT],
  initialMeta: { title: CARD_TITLES.code, icon: "MessageSquare", closable: true, menuItems: [] },
  connection,
};

const terminalConfig: CardConfig = {
  component: TerminalCardComponent,
  feedIds: [FeedId.TERMINAL_OUTPUT],
  initialMeta: { title: CARD_TITLES.terminal, icon: "Terminal", closable: true, menuItems: [] },
  connection,
  dragState: deck,
};

const gitConfig: CardConfig = {
  component: GitCardComponent,
  feedIds: [FeedId.GIT],
  initialMeta: { title: CARD_TITLES.git, icon: "GitBranch", closable: true, menuItems: [] },
};

const filesConfig: CardConfig = {
  component: FilesCardComponent,
  feedIds: [FeedId.FILESYSTEM],
  initialMeta: { title: CARD_TITLES.files, icon: "FolderOpen", closable: true, menuItems: [] },
};

const statsConfig: CardConfig = {
  component: StatsCardComponent,
  feedIds: [FeedId.STATS, FeedId.STATS_PROCESS_INFO, FeedId.STATS_TOKEN_USAGE, FeedId.STATS_BUILD_STATUS],
  initialMeta: { title: CARD_TITLES.stats, icon: "Activity", closable: true, menuItems: [] },
};

const aboutConfig: CardConfig = {
  component: AboutCardComponent,
  feedIds: [],
  initialMeta: { title: CARD_TITLES.about, icon: "Info", closable: true, menuItems: [] },
};

const settingsConfig: CardConfig = {
  component: SettingsCardComponent,
  feedIds: [],
  initialMeta: { title: CARD_TITLES.settings, icon: "Settings", closable: true, menuItems: [] },
  connection,
};

const developerConfig: CardConfig = {
  component: DeveloperCardComponent,
  feedIds: [FeedId.GIT],
  initialMeta: { title: CARD_TITLES.developer, icon: "Code", closable: true, menuItems: [] },
  connection,
};

// Register card configs with DeckManager (for DeckCanvas rendering)
deck.registerCardConfig("code", codeConfig);
deck.registerCardConfig("terminal", terminalConfig);
deck.registerCardConfig("git", gitConfig);
deck.registerCardConfig("files", filesConfig);
deck.registerCardConfig("stats", statsConfig);
deck.registerCardConfig("about", aboutConfig);
deck.registerCardConfig("settings", settingsConfig);
deck.registerCardConfig("developer", developerConfig);

// Register card factories for multi-instance and reset-layout support.
// Factories capture connection in their closures.
deck.registerCardFactory("code", () => {
  const adapter = new ReactCardAdapter({
    component: ConversationCardComponent,
    feedIds: [FeedId.CODE_OUTPUT],
    initialMeta: { title: CARD_TITLES.code, icon: "MessageSquare", closable: true, menuItems: [] },
    connection,
    dragState: deck,
  });
  return adapter;
});
deck.registerCardFactory("terminal", () => new ReactCardAdapter({
  component: TerminalCardComponent,
  feedIds: [FeedId.TERMINAL_OUTPUT],
  initialMeta: { title: CARD_TITLES.terminal, icon: "Terminal", closable: true, menuItems: [] },
  connection,
  dragState: deck,
}));
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

// Register initial card instances for feedId tracking.
// DeckManager uses these for routing frames from TugConnection to DeckCanvas.
// DeckCanvas renders card components directly via cardConfigs (no mounting needed).
deck.addCard(new ReactCardAdapter({
  component: ConversationCardComponent,
  feedIds: [FeedId.CODE_OUTPUT],
  initialMeta: { title: CARD_TITLES.code, icon: "MessageSquare", closable: true, menuItems: [] },
  connection,
  dragState: deck,
}), "code");

deck.addCard(new ReactCardAdapter({
  component: TerminalCardComponent,
  feedIds: [FeedId.TERMINAL_OUTPUT],
  initialMeta: { title: CARD_TITLES.terminal, icon: "Terminal", closable: true, menuItems: [] },
  connection,
  dragState: deck,
}), "terminal");

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

// Re-render so DeckCanvas picks up card configs
deck.refresh();

// Initialize action dispatch system (must be done before Dock callbacks fire).
// Dock is now rendered inside DeckCanvas; action dispatch is initialized here
// and DeckManager is given the DockCallbacks so it can pass them to DeckCanvas.
initActionDispatch(connection, deck);

const dockCallbacks: DockCallbacks = {
  onShowCard: (cardType: string) => {
    dispatchAction({ action: "show-card", component: cardType });
  },
  onResetLayout: () => deck.resetLayout(),
  onRestartServer: () => deck.sendControlFrame("restart"),
  onResetEverything: () => {
    localStorage.clear();
    deck.sendControlFrame("reset");
  },
  onReloadFrontend: () => deck.sendControlFrame("reload_frontend"),
};
deck.setDockCallbacks(dockCallbacks);

// Signal frontend readiness to native app (enables menu items)
connection.onOpen(() => {
  (window as any).webkit?.messageHandlers?.frontendReady?.postMessage({});
});

// Connect to the server
connection.connect();

console.log("tugdeck initialized");
