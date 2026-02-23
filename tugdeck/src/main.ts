import { TugConnection } from "./connection";
import { DeckManager } from "./deck-manager";
import { ConversationCard } from "./cards/conversation-card";
import { TerminalCard } from "./cards/terminal-card";
import { FilesCard } from "./cards/files-card";
import { GitCard } from "./cards/git-card";
import { StatsCard } from "./cards/stats-card";
import { AboutCard } from "./cards/about-card";
import { SettingsCard } from "./cards/settings-card";
import { DeveloperCard } from "./cards/developer-card";
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
deck.registerCardFactory("git", () => new GitCard());
deck.registerCardFactory("files", () => new FilesCard());
deck.registerCardFactory("stats", () => new StatsCard());
deck.registerCardFactory("about", () => new AboutCard());
deck.registerCardFactory("settings", () => new SettingsCard(connection));
deck.registerCardFactory("developer", () => new DeveloperCard(connection));

// Create and register cards by componentId
// DeckManager.addCard matches cards to layout tree TabItems by componentId
const codeCard = new ConversationCard(connection);
codeCard.setDragState(deck);
deck.addCard(codeCard, "code");

const terminalCard = new TerminalCard(connection);
terminalCard.setDragState(deck);
deck.addCard(terminalCard, "terminal");

deck.addCard(new GitCard(), "git");
deck.addCard(new FilesCard(), "files");
deck.addCard(new StatsCard(), "stats");

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
