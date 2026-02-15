import { TugConnection } from "./connection";
import { DeckManager } from "./deck";
import { TerminalCard } from "./cards/terminal-card";

// Determine WebSocket URL from current page location
const wsUrl = `ws://${window.location.host}/ws`;

// Create connection
const connection = new TugConnection(wsUrl);

// Get the terminal container from the DOM
const container = document.getElementById("terminal-container");
if (!container) {
  throw new Error("terminal-container element not found");
}

// Create deck manager
const deck = new DeckManager(container, connection);

// Create and register terminal card
const terminalCard = new TerminalCard(connection);
deck.addCard(terminalCard);

// Connect to the server
// (cookie auth is handled by the browser automatically --
//  the session cookie set by /auth is sent with the WS upgrade)
connection.connect();

console.log("tugdeck initialized");
