import { TugConnection } from "./connection";
import { DeckManager } from "./deck";
import { ConversationCard } from "./cards/conversation-card";
import { TerminalCard } from "./cards/terminal-card";
import { FilesCard } from "./cards/files-card";
import { GitCard } from "./cards/git-card";
import { StatsCard } from "./cards/stats-card";

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

// Create and register cards in named slots
const conversationCard = new ConversationCard(connection);
conversationCard.setDeckManager(deck);
deck.addCard(conversationCard, "conversation");

const terminalCard = new TerminalCard(connection);
terminalCard.setDeckManager(deck);
deck.addCard(terminalCard, "terminal");
deck.addCard(new GitCard(), "git");
deck.addCard(new FilesCard(), "files");
deck.addCard(new StatsCard(), "stats");

// Connect to the server
connection.connect();

console.log("tugdeck initialized");
