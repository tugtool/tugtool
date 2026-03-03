/**
 * DeckManager unit tests -- Step 5.
 *
 * Tests cover:
 * - T28: buildDefaultLayout returns empty DeckState (verified in layout-tree.test.ts)
 * - T29: deserialize fallback returns empty DeckState (verified in layout-tree.test.ts)
 * - T30: addCard creates CardState with correct tabs, activeTabId, and default size
 * - T31: addCard with unregistered component logs warning and returns null
 * - T32: removeCard removes the card from DeckState.cards
 * - T33: moveCard updates position and size of the specified card
 * - T34: focusCard moves the specified card to the end of the cards array
 * - T35: addCard cascading positions offset each new card by (30, 30)
 *
 * DeckManager tests use a minimal container div and mock connection.
 * They test data-layer state management via getDeckState(). The render()
 * call fires into the container but the React tree is not validated here --
 * rendering is tested in deck-canvas.test.tsx and e2e tests.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

// Stub localStorage -- not provided by happy-dom in this worker context.
// DeckManager.loadLayout() catches the ReferenceError and falls back to
// buildDefaultLayout, but the warning is noisy in test output. Stubbing here
// suppresses the warning and makes the test environment more realistic.
if (typeof (globalThis as Record<string, unknown>)["localStorage"] === "undefined") {
  (globalThis as Record<string, unknown>)["localStorage"] = {
    getItem: (_key: string) => null,
    setItem: (_key: string, _value: string) => {},
    removeItem: (_key: string) => {},
    clear: () => {},
  };
}

import { DeckManager } from "../deck-manager";
import { registerCard, _resetForTest } from "../card-registry";
import type { CardRegistration } from "../card-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock TugConnection.
 * DeckManager passes this to DeckCanvas; it is not called in these tests.
 */
function makeMockConnection() {
  return {
    onDisconnectState: () => () => {},
    onOpen: () => () => {},
    onFrame: () => () => {},
    sendControlFrame: () => {},
  } as unknown as import("../connection").TugConnection;
}

/**
 * Create a container div with non-zero dimensions so clientWidth/clientHeight
 * return meaningful values in happy-dom.
 */
function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  // happy-dom does not run layout so clientWidth/clientHeight remain 0.
  // Override via Object.defineProperty so cascade logic sees canvas bounds.
  Object.defineProperty(div, "clientWidth", { configurable: true, get: () => 1280 });
  Object.defineProperty(div, "clientHeight", { configurable: true, get: () => 800 });
  document.body.appendChild(div);
  return div;
}

/**
 * Make a minimal CardRegistration stub for a given componentId.
 */
function makeRegistration(componentId: string, title = "Test Card"): CardRegistration {
  return {
    componentId,
    factory: () => {
      throw new Error("factory not used in DeckManager tests");
    },
    defaultMeta: { title, closable: true },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let manager: DeckManager;
let container: HTMLDivElement;
let connection: ReturnType<typeof makeMockConnection>;

beforeEach(() => {
  _resetForTest();
  container = makeContainer();
  connection = makeMockConnection();
  manager = new DeckManager(container, connection);
});

afterEach(() => {
  manager.destroy();
  container.remove();
  _resetForTest();
});

// ---------------------------------------------------------------------------
// T30: addCard creates CardState with correct structure
// ---------------------------------------------------------------------------

describe("DeckManager.addCard – registered component", () => {
  it("T30: creates CardState with correct tabs, activeTabId, and default 400x300 size", () => {
    registerCard(makeRegistration("hello", "Hello"));

    const cardId = manager.addCard("hello");

    expect(cardId).not.toBeNull();
    expect(typeof cardId).toBe("string");

    const state = manager.getDeckState();
    expect(state.cards.length).toBe(1);

    const card = state.cards[0];
    expect(card.id).toBe(cardId);
    expect(card.size.width).toBe(400);
    expect(card.size.height).toBe(300);
    expect(card.tabs.length).toBe(1);
    expect(card.tabs[0].componentId).toBe("hello");
    expect(card.tabs[0].title).toBe("Hello");
    expect(card.tabs[0].closable).toBe(true);
    expect(card.activeTabId).toBe(card.tabs[0].id);
  });

  it("returns the generated card ID (non-empty UUID string)", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello");
    expect(typeof cardId).toBe("string");
    expect((cardId as string).length).toBeGreaterThan(0);
  });

  it("tab title comes from registration.defaultMeta.title", () => {
    registerCard(makeRegistration("terminal", "Terminal Window"));
    manager.addCard("terminal");
    const card = manager.getDeckState().cards[0];
    expect(card.tabs[0].title).toBe("Terminal Window");
  });

  it("tab closable reflects registration.defaultMeta.closable", () => {
    registerCard({
      componentId: "sticky",
      factory: () => { throw new Error("factory stub"); },
      defaultMeta: { title: "Sticky", closable: false },
    });
    manager.addCard("sticky");
    const card = manager.getDeckState().cards[0];
    expect(card.tabs[0].closable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T31: addCard with unregistered component
// ---------------------------------------------------------------------------

describe("DeckManager.addCard – unregistered component", () => {
  it("T31: logs a warning and returns null; DeckState unchanged", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const result = manager.addCard("nonexistent-card");

    expect(result).toBeNull();
    expect(manager.getDeckState().cards.length).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("nonexistent-card");

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// T32: removeCard removes the card
// ---------------------------------------------------------------------------

describe("DeckManager.removeCard", () => {
  it("T32: removes the specified card from DeckState.cards", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    expect(manager.getDeckState().cards.length).toBe(1);

    manager.removeCard(cardId);
    expect(manager.getDeckState().cards.length).toBe(0);
  });

  it("removes only the specified card when multiple cards exist", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("terminal") as string;
    expect(manager.getDeckState().cards.length).toBe(2);

    manager.removeCard(id1);

    const remaining = manager.getDeckState().cards;
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(id2);
  });

  it("is a no-op when the card ID does not exist", () => {
    registerCard(makeRegistration("hello"));
    manager.addCard("hello");
    expect(manager.getDeckState().cards.length).toBe(1);

    manager.removeCard("nonexistent-id");
    expect(manager.getDeckState().cards.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T33: moveCard updates position and size
// ---------------------------------------------------------------------------

describe("DeckManager.moveCard", () => {
  it("T33: updates position and size of the specified card", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;

    manager.moveCard(cardId, { x: 150, y: 200 }, { width: 500, height: 400 });

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.position.x).toBe(150);
    expect(card.position.y).toBe(200);
    expect(card.size.width).toBe(500);
    expect(card.size.height).toBe(400);
  });

  it("does not affect other cards when one card is moved", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("terminal") as string;

    const originalCard2 = manager.getDeckState().cards.find((c) => c.id === id2)!;
    const originalPos2 = { ...originalCard2.position };
    const originalSize2 = { ...originalCard2.size };

    manager.moveCard(id1, { x: 999, y: 888 }, { width: 777, height: 666 });

    const card2 = manager.getDeckState().cards.find((c) => c.id === id2)!;
    expect(card2.position.x).toBe(originalPos2.x);
    expect(card2.position.y).toBe(originalPos2.y);
    expect(card2.size.width).toBe(originalSize2.width);
    expect(card2.size.height).toBe(originalSize2.height);
  });
});

// ---------------------------------------------------------------------------
// T34: focusCard moves card to end of array
// ---------------------------------------------------------------------------

describe("DeckManager.focusCard", () => {
  it("T34: moves the specified card to the end of the cards array (highest z-index)", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    registerCard(makeRegistration("git"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("terminal") as string;
    const id3 = manager.addCard("git") as string;
    // Initial order: [id1, id2, id3]

    manager.focusCard(id1);

    const cards = manager.getDeckState().cards;
    expect(cards.length).toBe(3);
    expect(cards[cards.length - 1].id).toBe(id1);
    expect(cards[0].id).toBe(id2);
    expect(cards[1].id).toBe(id3);
  });

  it("is a no-op when the card is already at the end (already top-most)", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("terminal") as string;
    // id2 is already last

    manager.focusCard(id2);

    const cards = manager.getDeckState().cards;
    expect(cards[0].id).toBe(id1);
    expect(cards[1].id).toBe(id2);
  });

  it("is a no-op when the card ID does not exist", () => {
    registerCard(makeRegistration("hello"));
    const id1 = manager.addCard("hello") as string;

    manager.focusCard("nonexistent");

    expect(manager.getDeckState().cards[0].id).toBe(id1);
  });
});

// ---------------------------------------------------------------------------
// T35: addCard cascading positions
// ---------------------------------------------------------------------------

describe("DeckManager.addCard – cascade positioning", () => {
  it("T35: each new card offsets position by (30, 30) from the previous", () => {
    registerCard(makeRegistration("hello"));

    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("hello") as string;
    const id3 = manager.addCard("hello") as string;

    const cards = manager.getDeckState().cards;
    const c1 = cards.find((c) => c.id === id1)!;
    const c2 = cards.find((c) => c.id === id2)!;
    const c3 = cards.find((c) => c.id === id3)!;

    // First card: cascade index 0 → position (0, 0)
    expect(c1.position.x).toBe(0);
    expect(c1.position.y).toBe(0);

    // Second card: cascade index 1 → position (30, 30)
    expect(c2.position.x).toBe(30);
    expect(c2.position.y).toBe(30);

    // Third card: cascade index 2 → position (60, 60)
    expect(c3.position.x).toBe(60);
    expect(c3.position.y).toBe(60);
  });

  it("resets cascade index when cascaded position would overflow canvas bounds", () => {
    registerCard(makeRegistration("hello"));

    // Add enough cards to guarantee a cascade reset.
    // Canvas width fallback is 800 (clientWidth=0 in happy-dom worker).
    // Default card width=400. Overflow: x + 400 > 800 → x > 400.
    // At step 30: index 14 → x=30*14=420 > 400 → first reset → position (0,0).
    const NUM_CARDS = 20;
    for (let i = 0; i < NUM_CARDS; i++) {
      manager.addCard("hello");
    }

    const cards = manager.getDeckState().cards;
    expect(cards.length).toBe(NUM_CARDS);

    // The cascade must have reset at some point. Verify this by finding a card
    // whose x-position is strictly less than its predecessor's x-position.
    let foundReset = false;
    for (let i = 1; i < cards.length; i++) {
      if (cards[i].position.x < cards[i - 1].position.x) {
        foundReset = true;
        // The position after reset must be 0.
        expect(cards[i].position.x).toBe(0);
        expect(cards[i].position.y).toBe(0);
        break;
      }
    }
    expect(foundReset).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extra: getDeckState returns live reference
// ---------------------------------------------------------------------------

describe("DeckManager.getDeckState", () => {
  it("returns a DeckState with a cards array", () => {
    const state = manager.getDeckState();
    expect(state).toBeDefined();
    expect(Array.isArray(state.cards)).toBe(true);
  });

  it("initial state has 0 cards (empty default layout in Phase 5)", () => {
    expect(manager.getDeckState().cards.length).toBe(0);
  });
});
