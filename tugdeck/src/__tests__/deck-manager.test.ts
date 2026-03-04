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

// ---------------------------------------------------------------------------
// Phase 5a2 store API tests
// ---------------------------------------------------------------------------

describe("DeckManager store API – subscribe / unsubscribe", () => {
  it("subscribe returns an unsubscribe function; calling it removes the listener", () => {
    registerCard(makeRegistration("hello"));

    let callCount = 0;
    const unsubscribe = manager.subscribe(() => {
      callCount += 1;
    });

    // Trigger a notification via addCard
    manager.addCard("hello");
    expect(callCount).toBe(1);

    // Unsubscribe and trigger again -- callback must not fire
    unsubscribe();
    manager.addCard("hello");
    expect(callCount).toBe(1);
  });

  it("multiple subscribers each receive the callback on notify", () => {
    registerCard(makeRegistration("hello"));

    let callsA = 0;
    let callsB = 0;
    const unsubA = manager.subscribe(() => { callsA += 1; });
    const unsubB = manager.subscribe(() => { callsB += 1; });

    manager.addCard("hello");
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);

    // Unsubscribe A; only B should fire on the next mutation
    unsubA();
    manager.addCard("hello");
    expect(callsA).toBe(1);
    expect(callsB).toBe(2);

    unsubB();
  });
});

describe("DeckManager store API – getSnapshot", () => {
  it("getSnapshot() returns current deckState", () => {
    const snapshot = manager.getSnapshot();
    expect(snapshot).toBeDefined();
    expect(Array.isArray(snapshot.cards)).toBe(true);
  });

  it("after addCard(), getSnapshot() reflects the new card", () => {
    registerCard(makeRegistration("hello"));
    const before = manager.getSnapshot();
    expect(before.cards.length).toBe(0);

    manager.addCard("hello");

    const after = manager.getSnapshot();
    expect(after.cards.length).toBe(1);
    // New object reference after mutation (shallow copy invariant)
    expect(after).not.toBe(before);
  });

  it("getDeckState() returns the same value as getSnapshot()", () => {
    registerCard(makeRegistration("hello"));
    manager.addCard("hello");
    expect(manager.getDeckState()).toBe(manager.getSnapshot());
  });
});

describe("DeckManager store API – getVersion", () => {
  it("initial version is 0", () => {
    expect(manager.getVersion()).toBe(0);
  });

  it("getVersion() increments after addCard()", () => {
    registerCard(makeRegistration("hello"));
    const v0 = manager.getVersion();
    manager.addCard("hello");
    expect(manager.getVersion()).toBe(v0 + 1);
  });

  it("getVersion() increments after removeCard()", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const v1 = manager.getVersion();
    manager.removeCard(cardId);
    expect(manager.getVersion()).toBe(v1 + 1);
  });

  it("getVersion() increments after moveCard()", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const v1 = manager.getVersion();
    manager.moveCard(cardId, { x: 10, y: 20 }, { width: 300, height: 200 });
    expect(manager.getVersion()).toBe(v1 + 1);
  });

  it("getVersion() increments after focusCard() that moves the card", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    manager.addCard("terminal");
    const vBefore = manager.getVersion();
    // id1 is not at the end, so focusCard should fire notify
    manager.focusCard(id1);
    expect(manager.getVersion()).toBe(vBefore + 1);
  });

  it("getVersion() does NOT increment for focusCard() no-op (already top-most)", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    manager.addCard("hello");
    const id2 = manager.addCard("terminal") as string;
    const vBefore = manager.getVersion();
    // id2 is already last -- focusCard is a no-op, no notify
    manager.focusCard(id2);
    expect(manager.getVersion()).toBe(vBefore);
  });

  it("version increments monotonically across multiple mutations", () => {
    registerCard(makeRegistration("hello"));
    const v0 = manager.getVersion();
    manager.addCard("hello");
    const v1 = manager.getVersion();
    manager.addCard("hello");
    const v2 = manager.getVersion();
    expect(v1).toBeGreaterThan(v0);
    expect(v2).toBeGreaterThan(v1);
  });
});

describe("DeckManager store API – subscriber callback timing", () => {
  it("subscriber fires on addCard()", () => {
    registerCard(makeRegistration("hello"));
    let fired = false;
    manager.subscribe(() => { fired = true; });
    manager.addCard("hello");
    expect(fired).toBe(true);
  });

  it("subscriber fires on removeCard()", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    let fired = false;
    manager.subscribe(() => { fired = true; });
    manager.removeCard(cardId);
    expect(fired).toBe(true);
  });

  it("subscriber fires on moveCard()", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    let fired = false;
    manager.subscribe(() => { fired = true; });
    manager.moveCard(cardId, { x: 5, y: 10 }, { width: 300, height: 200 });
    expect(fired).toBe(true);
  });

  it("subscriber fires on focusCard() that reorders cards", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    manager.addCard("terminal");
    let fired = false;
    manager.subscribe(() => { fired = true; });
    manager.focusCard(id1);
    expect(fired).toBe(true);
  });

  it("subscriber does NOT fire on focusCard() no-op", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    manager.addCard("hello");
    const id2 = manager.addCard("terminal") as string;
    let fired = false;
    manager.subscribe(() => { fired = true; });
    // id2 is already last -- no-op, no notify
    manager.focusCard(id2);
    expect(fired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addTab tests (Spec S03)
// ---------------------------------------------------------------------------

describe("DeckManager.addTab", () => {
  it("creates a new tab with correct componentId and title from registration", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const initialTabCount = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.length;
    expect(initialTabCount).toBe(1);

    registerCard(makeRegistration("terminal", "Terminal"));
    const newTabId = manager.addTab(cardId, "terminal");

    expect(newTabId).not.toBeNull();
    expect(typeof newTabId).toBe("string");

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.tabs.length).toBe(2);
    const newTab = card.tabs.find((t) => t.id === newTabId)!;
    expect(newTab.componentId).toBe("terminal");
    expect(newTab.title).toBe("Terminal");
  });

  it("new tab becomes the active tab after addTab", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;

    registerCard(makeRegistration("terminal", "Terminal"));
    const newTabId = manager.addTab(cardId, "terminal");

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.activeTabId).toBe(newTabId);
  });

  it("returns null for unregistered componentId", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const result = manager.addTab(cardId, "nonexistent");

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns null for non-existent cardId", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const result = manager.addTab("nonexistent-card-id", "hello");

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("notifies subscribers after addTab", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    registerCard(makeRegistration("terminal", "Terminal"));

    let callCount = 0;
    manager.subscribe(() => { callCount += 1; });
    manager.addTab(cardId, "terminal");

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// removeTab tests (Spec S03)
// ---------------------------------------------------------------------------

describe("DeckManager.removeTab", () => {
  it("removes the specified tab and activates the previous tab", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const cardId = manager.addCard("hello") as string;
    const firstTabId = manager.getDeckState().cards.find((c) => c.id === cardId)!.activeTabId;

    // Add a second tab and make it active
    const secondTabId = manager.addTab(cardId, "terminal") as string;
    expect(manager.getDeckState().cards.find((c) => c.id === cardId)!.activeTabId).toBe(secondTabId);

    // Remove the second (active) tab -- should activate the previous (first) tab
    manager.removeTab(cardId, secondTabId);

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.tabs.length).toBe(1);
    expect(card.activeTabId).toBe(firstTabId);
  });

  it("activates first tab when the first tab is removed", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const cardId = manager.addCard("hello") as string;
    const firstTabId = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;

    // Add a second tab (it becomes active)
    const secondTabId = manager.addTab(cardId, "terminal") as string;

    // Make first tab active, then remove it
    manager.setActiveTab(cardId, firstTabId);
    manager.removeTab(cardId, firstTabId);

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.tabs.length).toBe(1);
    expect(card.activeTabId).toBe(secondTabId);
  });

  it("removes the card entirely when the last tab is removed", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const tabId = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;

    manager.removeTab(cardId, tabId);

    expect(manager.getDeckState().cards.find((c) => c.id === cardId)).toBeUndefined();
  });

  it("is a no-op for a non-existent tabId", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const tabsBefore = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.length;

    manager.removeTab(cardId, "nonexistent-tab-id");

    expect(manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.length).toBe(tabsBefore);
  });

  it("is a no-op for a non-existent cardId", () => {
    const cardCountBefore = manager.getDeckState().cards.length;

    manager.removeTab("nonexistent-card-id", "some-tab-id");

    expect(manager.getDeckState().cards.length).toBe(cardCountBefore);
  });

  it("notifies subscribers after removeTab", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const cardId = manager.addCard("hello") as string;
    const secondTabId = manager.addTab(cardId, "terminal") as string;

    let callCount = 0;
    manager.subscribe(() => { callCount += 1; });
    manager.removeTab(cardId, secondTabId);

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// setActiveTab tests (Spec S03)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// filterRegisteredCards tests (Step 9)
// ---------------------------------------------------------------------------

describe("DeckManager filterRegisteredCards – multi-tab filtering", () => {
  it("keeps only registered tabs from a card with mixed registered/unregistered tabs", () => {
    // Register only "hello"; "ghost" is intentionally not registered.
    registerCard(makeRegistration("hello", "Hello"));

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    // Build a DeckState with one card having two tabs: one registered ("hello")
    // and one unregistered ("ghost"). Bypass addTab (which checks registration)
    // by calling applyLayout directly.
    const cardId = crypto.randomUUID();
    const helloTabId = crypto.randomUUID();
    const ghostTabId = crypto.randomUUID();

    manager.applyLayout({
      cards: [
        {
          id: cardId,
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [
            { id: helloTabId, componentId: "hello", title: "Hello", closable: true },
            { id: ghostTabId, componentId: "ghost", title: "Ghost", closable: true },
          ],
          activeTabId: helloTabId,
        },
      ],
    });

    const card = manager.getDeckState().cards.find((c) => c.id === cardId);
    expect(card).toBeDefined();
    expect(card!.tabs.length).toBe(1);
    expect(card!.tabs[0].id).toBe(helloTabId);
    expect(card!.activeTabId).toBe(helloTabId);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("removes a card entirely when all its tabs are unregistered", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const cardId = crypto.randomUUID();
    const tabId = crypto.randomUUID();

    manager.applyLayout({
      cards: [
        {
          id: cardId,
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [
            { id: tabId, componentId: "totally-unknown", title: "Unknown", closable: true },
          ],
          activeTabId: tabId,
        },
      ],
    });

    expect(manager.getDeckState().cards.find((c) => c.id === cardId)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back activeTabId to first registered tab when the active tab is unregistered", () => {
    registerCard(makeRegistration("hello", "Hello"));

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const cardId = crypto.randomUUID();
    const helloTabId = crypto.randomUUID();
    const ghostTabId = crypto.randomUUID();

    // Active tab is the unregistered "ghost" tab.
    manager.applyLayout({
      cards: [
        {
          id: cardId,
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [
            { id: helloTabId, componentId: "hello", title: "Hello", closable: true },
            { id: ghostTabId, componentId: "ghost", title: "Ghost", closable: true },
          ],
          activeTabId: ghostTabId,
        },
      ],
    });

    const card = manager.getDeckState().cards.find((c) => c.id === cardId);
    expect(card).toBeDefined();
    // Only the hello tab survives; activeTabId falls back to it.
    expect(card!.tabs.length).toBe(1);
    expect(card!.tabs[0].id).toBe(helloTabId);
    expect(card!.activeTabId).toBe(helloTabId);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("DeckManager.setActiveTab", () => {
  it("updates activeTabId to the specified tab", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const cardId = manager.addCard("hello") as string;
    const firstTabId = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;

    // Add second tab (becomes active)
    manager.addTab(cardId, "terminal");

    // Switch back to first tab
    manager.setActiveTab(cardId, firstTabId);

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.activeTabId).toBe(firstTabId);
  });

  it("is a no-op for an invalid tabId (not in tabs array)", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    const originalActiveTabId = card.activeTabId;
    const versionBefore = manager.getVersion();

    manager.setActiveTab(cardId, "nonexistent-tab-id");

    const cardAfter = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(cardAfter.activeTabId).toBe(originalActiveTabId);
    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("is a no-op when the tab is already active", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const tabId = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;
    const versionBefore = manager.getVersion();

    manager.setActiveTab(cardId, tabId);

    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("notifies subscribers after setActiveTab changes the active tab", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const cardId = manager.addCard("hello") as string;
    const firstTabId = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;
    manager.addTab(cardId, "terminal");

    let callCount = 0;
    manager.subscribe(() => { callCount += 1; });
    manager.setActiveTab(cardId, firstTabId);

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// reorderTab tests (Spec S01 / Step 1)
// ---------------------------------------------------------------------------

describe("DeckManager.reorderTab", () => {
  it("T1: moves tab from index 0 to index 2 in a 3-tab card", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    registerCard(makeRegistration("git", "Git"));

    const cardId = manager.addCard("hello") as string;
    const tab1Id = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;
    const tab2Id = manager.addTab(cardId, "terminal") as string;
    const tab3Id = manager.addTab(cardId, "git") as string;

    // Initial order: [tab1, tab2, tab3]
    manager.reorderTab(cardId, 0, 2);

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.tabs[0].id).toBe(tab2Id);
    expect(card.tabs[1].id).toBe(tab3Id);
    expect(card.tabs[2].id).toBe(tab1Id);
  });

  it("T2: no-op when fromIndex === toIndex", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const cardId = manager.addCard("hello") as string;
    manager.addTab(cardId, "terminal");

    const before = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.map((t) => t.id);
    const versionBefore = manager.getVersion();

    manager.reorderTab(cardId, 0, 0);

    const after = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.map((t) => t.id);
    expect(after).toEqual(before);
    // No-op means no notify was fired (version unchanged)
    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("T3: no-op when card not found", () => {
    const versionBefore = manager.getVersion();
    manager.reorderTab("nonexistent-card", 0, 1);
    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("T4: no-op when indices out of bounds", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const cardId = manager.addCard("hello") as string;
    manager.addTab(cardId, "terminal");

    const before = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.map((t) => t.id);
    const versionBefore = manager.getVersion();

    // fromIndex out of bounds
    manager.reorderTab(cardId, -1, 1);
    expect(manager.getVersion()).toBe(versionBefore);

    // toIndex out of bounds
    manager.reorderTab(cardId, 0, 5);
    expect(manager.getVersion()).toBe(versionBefore);

    const after = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.map((t) => t.id);
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// detachTab tests (Spec S02 / Step 1)
// ---------------------------------------------------------------------------

describe("DeckManager.detachTab", () => {
  it("T5: creates new card with detached tab, removes tab from source", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const cardId = manager.addCard("hello") as string;
    const tab2Id = manager.addTab(cardId, "terminal") as string;

    const newCardId = manager.detachTab(cardId, tab2Id, { x: 100, y: 150 });

    expect(newCardId).not.toBeNull();
    expect(typeof newCardId).toBe("string");

    const state = manager.getDeckState();

    // Source card should still exist with only 1 tab
    const sourceCard = state.cards.find((c) => c.id === cardId);
    expect(sourceCard).toBeDefined();
    expect(sourceCard!.tabs.length).toBe(1);
    expect(sourceCard!.tabs.some((t) => t.id === tab2Id)).toBe(false);

    // New card should have the detached tab
    const newCard = state.cards.find((c) => c.id === newCardId);
    expect(newCard).toBeDefined();
    expect(newCard!.tabs.length).toBe(1);
    expect(newCard!.tabs[0].id).toBe(tab2Id);
    expect(newCard!.activeTabId).toBe(tab2Id);
    expect(newCard!.position.x).toBe(100);
    expect(newCard!.position.y).toBe(150);
  });

  it("T6: returns null when card has only one tab (last-tab guard)", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const tabId = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;

    const result = manager.detachTab(cardId, tabId, { x: 100, y: 100 });

    expect(result).toBeNull();
    // Card should still have 1 tab
    expect(manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.length).toBe(1);
  });

  it("T7: handles two-tab card: source transitions to single-tab after detach", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const cardId = manager.addCard("hello") as string;
    const tab1Id = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;
    const tab2Id = manager.addTab(cardId, "terminal") as string;

    const newCardId = manager.detachTab(cardId, tab2Id, { x: 200, y: 200 });

    expect(newCardId).not.toBeNull();

    const state = manager.getDeckState();
    const sourceCard = state.cards.find((c) => c.id === cardId);
    expect(sourceCard).toBeDefined();
    expect(sourceCard!.tabs.length).toBe(1);
    expect(sourceCard!.tabs[0].id).toBe(tab1Id);
    expect(sourceCard!.activeTabId).toBe(tab1Id);
  });

  it("T8: returns null when card not found", () => {
    const result = manager.detachTab("nonexistent-card", "some-tab", { x: 0, y: 0 });
    expect(result).toBeNull();
  });

  it("new card is appended to end of cards array (highest z-index)", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const cardId = manager.addCard("hello") as string;
    const tab2Id = manager.addTab(cardId, "terminal") as string;

    const cardsBefore = manager.getDeckState().cards.length;
    const newCardId = manager.detachTab(cardId, tab2Id, { x: 50, y: 50 }) as string;

    const cards = manager.getDeckState().cards;
    expect(cards.length).toBe(cardsBefore + 1);
    // New card should be the last in the array
    expect(cards[cards.length - 1].id).toBe(newCardId);
  });

  it("detached card position is clamped to canvas bounds", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const cardId = manager.addCard("hello") as string;
    const tab2Id = manager.addTab(cardId, "terminal") as string;

    // Position far outside canvas bounds (canvas is 1280x800 in tests)
    const newCardId = manager.detachTab(cardId, tab2Id, { x: 9999, y: 9999 }) as string;

    const newCard = manager.getDeckState().cards.find((c) => c.id === newCardId)!;
    // Position should be clamped: canvasWidth - DEFAULT_CARD_WIDTH = 1280 - 400 = 880
    expect(newCard.position.x).toBe(1280 - 400);
    expect(newCard.position.y).toBe(800 - 300);
  });
});

// ---------------------------------------------------------------------------
// mergeTab tests (Spec S03 / Step 1)
// ---------------------------------------------------------------------------

describe("DeckManager.mergeTab", () => {
  it("T9: moves tab from source to target at insertAtIndex", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    registerCard(makeRegistration("git", "Git"));

    // Create two cards
    const card1Id = manager.addCard("hello") as string;
    const tab1Id = manager.getDeckState().cards.find((c) => c.id === card1Id)!.tabs[0].id;
    manager.addTab(card1Id, "terminal");

    const card2Id = manager.addCard("git") as string;
    const tab3Id = manager.getDeckState().cards.find((c) => c.id === card2Id)!.tabs[0].id;
    // card2 needs 2 tabs so it doesn't get removed
    manager.addTab(card2Id, "terminal");

    // Merge first tab of card1 into card2 at index 0
    manager.mergeTab(card1Id, tab1Id, card2Id, 0);

    const state = manager.getDeckState();
    const targetCard = state.cards.find((c) => c.id === card2Id)!;
    expect(targetCard.tabs[0].id).toBe(tab1Id);
    // Source card should still exist (it had 2 tabs, now 1)
    const sourceCard = state.cards.find((c) => c.id === card1Id);
    expect(sourceCard).toBeDefined();
    expect(sourceCard!.tabs.some((t) => t.id === tab1Id)).toBe(false);
  });

  it("T10: removes source card when source had only one tab", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    registerCard(makeRegistration("git", "Git"));

    // Create source card with 1 tab
    const sourceCardId = manager.addCard("hello") as string;
    const tab1Id = manager.getDeckState().cards.find((c) => c.id === sourceCardId)!.tabs[0].id;

    // Create target card with 1 tab (also needs 2 to stay alive, but the merge adds one)
    const targetCardId = manager.addCard("terminal") as string;

    manager.mergeTab(sourceCardId, tab1Id, targetCardId, 0);

    const state = manager.getDeckState();
    // Source card should be gone
    expect(state.cards.find((c) => c.id === sourceCardId)).toBeUndefined();
    // Target card should have the merged tab
    const targetCard = state.cards.find((c) => c.id === targetCardId)!;
    expect(targetCard.tabs.some((t) => t.id === tab1Id)).toBe(true);
  });

  it("T11: sets merged tab as activeTabId on target", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const tab1Id = manager.getDeckState().cards.find((c) => c.id === card1Id)!.tabs[0].id;
    manager.addTab(card1Id, "terminal");

    const card2Id = manager.addCard("hello") as string;

    manager.mergeTab(card1Id, tab1Id, card2Id, 0);

    const targetCard = manager.getDeckState().cards.find((c) => c.id === card2Id)!;
    expect(targetCard.activeTabId).toBe(tab1Id);
  });

  it("T12: clamps insertAtIndex to target tabs length", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const tab1Id = manager.getDeckState().cards.find((c) => c.id === card1Id)!.tabs[0].id;
    manager.addTab(card1Id, "terminal");

    const card2Id = manager.addCard("hello") as string;
    // card2 has 1 tab; insertAtIndex of 999 should be clamped to 1 (tabs.length)
    manager.mergeTab(card1Id, tab1Id, card2Id, 999);

    const targetCard = manager.getDeckState().cards.find((c) => c.id === card2Id)!;
    // Merged tab should appear at end (index 1)
    expect(targetCard.tabs[targetCard.tabs.length - 1].id).toBe(tab1Id);
  });

  it("T13: no-op when sourceCardId === targetCardId", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const cardId = manager.addCard("hello") as string;
    const tab1Id = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs[0].id;
    manager.addTab(cardId, "terminal");

    const tabsBefore = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.map((t) => t.id);
    const versionBefore = manager.getVersion();

    manager.mergeTab(cardId, tab1Id, cardId, 0);

    expect(manager.getVersion()).toBe(versionBefore);
    const tabsAfter = manager.getDeckState().cards.find((c) => c.id === cardId)!.tabs.map((t) => t.id);
    expect(tabsAfter).toEqual(tabsBefore);
  });
});
