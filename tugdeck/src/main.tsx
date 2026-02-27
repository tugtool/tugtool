// CSS imports — globals.css imports tailwindcss and tokens.css (which provides the shadcn variable bridge)
import "./globals.css";
import "../styles/cards-chrome.css";
import "../styles/dock.css";
// xterm CSS — previously mapped via assets.toml; now imported directly from node_modules
import "@xterm/xterm/css/xterm.css";

import { TugConnection } from "./connection";
import { DeckManager } from "./deck-manager";
import { ConversationCard } from "./cards/conversation-card";
import { TerminalCard } from "./cards/terminal-card";
import { ReactCardAdapter } from "./cards/react-card-adapter";
import { AboutCard as AboutCardComponent } from "./components/cards/about-card";
import { SettingsCard as SettingsCardComponent } from "./components/cards/settings-card";
import { FilesCard as FilesCardComponent } from "./components/cards/files-card";
import { GitCard as GitCardComponent } from "./components/cards/git-card";
import { StatsCard as StatsCardComponent } from "./components/cards/stats-card";
import { DeveloperCard as DeveloperCardComponent } from "./components/cards/developer-card";
import { FeedId } from "./protocol";
import { Dock } from "./dock";
import { initActionDispatch } from "./action-dispatch";

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
  const card = new ConversationCard(connection);
  card.setDragState(deck);
  return card;
});
deck.registerCardFactory("terminal", () => {
  const card = new TerminalCard(connection);
  card.setDragState(deck);
  return card;
});
deck.registerCardFactory("git", () => new ReactCardAdapter({
  component: GitCardComponent,
  feedIds: [FeedId.GIT],
  initialMeta: { title: "Git", icon: "GitBranch", closable: true, menuItems: [] },
}));
deck.registerCardFactory("files", () => new ReactCardAdapter({
  component: FilesCardComponent,
  feedIds: [FeedId.FILESYSTEM],
  initialMeta: { title: "Files", icon: "FolderOpen", closable: true, menuItems: [] },
}));
deck.registerCardFactory("stats", () => new ReactCardAdapter({
  component: StatsCardComponent,
  feedIds: [FeedId.STATS, FeedId.STATS_PROCESS_INFO, FeedId.STATS_TOKEN_USAGE, FeedId.STATS_BUILD_STATUS],
  initialMeta: { title: "Stats", icon: "Activity", closable: true, menuItems: [] },
}));
deck.registerCardFactory("about", () => new ReactCardAdapter({
  component: AboutCardComponent,
  feedIds: [],
  initialMeta: { title: "About", icon: "Info", closable: true, menuItems: [] },
}));
deck.registerCardFactory("settings", () => new ReactCardAdapter({
  component: SettingsCardComponent,
  feedIds: [],
  initialMeta: { title: "Settings", icon: "Settings", closable: true, menuItems: [] },
  connection,
}));
deck.registerCardFactory("developer", () => new ReactCardAdapter({
  component: DeveloperCardComponent,
  feedIds: [FeedId.GIT],
  initialMeta: { title: "Developer", icon: "Code", closable: true, menuItems: [] },
  connection,
}));

// Create and register cards by componentId
// DeckManager.addCard matches cards to layout tree TabItems by componentId
const codeCard = new ConversationCard(connection);
codeCard.setDragState(deck);
deck.addCard(codeCard, "code");

const terminalCard = new TerminalCard(connection);
terminalCard.setDragState(deck);
deck.addCard(terminalCard, "terminal");

deck.addCard(new ReactCardAdapter({
  component: GitCardComponent,
  feedIds: [FeedId.GIT],
  initialMeta: { title: "Git", icon: "GitBranch", closable: true, menuItems: [] },
}), "git");
deck.addCard(new ReactCardAdapter({
  component: FilesCardComponent,
  feedIds: [FeedId.FILESYSTEM],
  initialMeta: { title: "Files", icon: "FolderOpen", closable: true, menuItems: [] },
}), "files");
deck.addCard(new ReactCardAdapter({
  component: StatsCardComponent,
  feedIds: [FeedId.STATS, FeedId.STATS_PROCESS_INFO, FeedId.STATS_TOKEN_USAGE, FeedId.STATS_BUILD_STATUS],
  initialMeta: { title: "Stats", icon: "Activity", closable: true, menuItems: [] },
}), "stats");

// Re-render so CardFrame headers pick up card meta (menu buttons)
deck.refresh();

// Create Dock (48px vertical rail on right viewport edge)
new Dock(deck);

// Initialize action dispatch system
initActionDispatch(connection, deck);

// Signal frontend readiness to native app (enables menu items)
connection.onOpen(() => {
  (window as any).webkit?.messageHandlers?.frontendReady?.postMessage({});
});

// Connect to the server
connection.connect();

console.log("tugdeck initialized");
