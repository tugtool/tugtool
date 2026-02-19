import { TugConnection } from "./connection";
import { PanelManager } from "./panel-manager";
import { ConversationCard } from "./cards/conversation-card";
import { TerminalCard } from "./cards/terminal-card";
import { FilesCard } from "./cards/files-card";
import { GitCard } from "./cards/git-card";
import { StatsCard } from "./cards/stats-card";
import { Dock } from "./dock";

// Determine WebSocket URL from current page location
const wsUrl = `ws://${window.location.host}/ws`;

// Create connection
const connection = new TugConnection(wsUrl);

// Get the deck container from the DOM
const container = document.getElementById("deck-container");
if (!container) {
  throw new Error("deck-container element not found");
}

// Create panel manager (replaces DeckManager)
const deck = new PanelManager(container, connection);

// Register card factories for multi-instance and reset-layout support.
// Factories capture connection in their closures; TugConnection is a single
// instance that reconnects internally, so the reference stays valid.
deck.registerCardFactory("conversation", () => {
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

// Create and register cards by componentId
// PanelManager.addCard matches cards to layout tree TabItems by componentId
const conversationCard = new ConversationCard(connection);
conversationCard.setDragState(deck);
deck.addCard(conversationCard, "conversation");

const terminalCard = new TerminalCard(connection);
terminalCard.setDragState(deck);
deck.addCard(terminalCard, "terminal");

deck.addCard(new GitCard(), "git");
deck.addCard(new FilesCard(), "files");
deck.addCard(new StatsCard(), "stats");

// Create Dock (48px vertical rail on right viewport edge)
new Dock(deck);

// Connect to the server
connection.connect();

console.log("tugdeck initialized");
