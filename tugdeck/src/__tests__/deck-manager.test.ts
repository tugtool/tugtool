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
// Global fetch stub
//
// DeckManager's fire-and-forget settings API calls (putLayout, putTabState,
// putFocusedCardId) use the global fetch. happy-dom does not provide fetch,
// so install a no-op stub for the entire test file. Individual tests that
// need to inspect fetch calls can temporarily replace globalThis.fetch within
// their own body and restore it afterward.
// ---------------------------------------------------------------------------
const _noopFetch = (async () =>
  ({ status: 200, ok: true, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch;

beforeEach(() => {
  globalThis.fetch = _noopFetch;
});

afterEach(() => {
  globalThis.fetch = _noopFetch;
});

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
    defaultMeta: { title, closable: true },
    contentFactory: () => null,
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
    expect(card.id).toBe(cardId!);
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
      defaultMeta: { title: "Sticky", closable: false },
      contentFactory: () => null,
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

    // First card: cascade index 0 → position (10, 10) (CASCADE_ORIGIN offset)
    expect(c1.position.x).toBe(10);
    expect(c1.position.y).toBe(10);

    // Second card: cascade index 1 → position (40, 40)
    expect(c2.position.x).toBe(40);
    expect(c2.position.y).toBe(40);

    // Third card: cascade index 2 → position (70, 70)
    expect(c3.position.x).toBe(70);
    expect(c3.position.y).toBe(70);
  });

  it("resets cascade index when cascaded position would overflow canvas bounds", () => {
    registerCard(makeRegistration("hello"));

    // Add enough cards to guarantee a cascade reset.
    // Canvas width fallback is 800 (clientWidth=0 in happy-dom worker).
    // Default card width=400. Overflow: x + 400 > 800 → x > 400.
    // At step 30: index 14 → x=10+30*14=430 > 400 → first reset → position (10,10).
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
        // The position after reset must be CASCADE_ORIGIN (10).
        expect(cards[i].position.x).toBe(10);
        expect(cards[i].position.y).toBe(10);
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
    expect(card.activeTabId).toBe(newTabId!);
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
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
      sets: [],
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
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
      sets: [],
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
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
      sets: [],
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
// Phase 5b3 Step 1: addCard with defaultTabs, title, acceptsFamilies
// ---------------------------------------------------------------------------

describe("DeckManager.addCard – defaultTabs registration", () => {
  it("addCard with defaultTabs creates a card with all specified tabs (fresh UUIDs, not template IDs)", () => {
    const templateTabId1 = "tmpl-id-1";
    const templateTabId2 = "tmpl-id-2";
    registerCard({
      componentId: "gallery-host",
      defaultMeta: { title: "Gallery Host", closable: true },
      contentFactory: () => null,
      defaultTabs: [
        { id: templateTabId1, componentId: "gallery-buttons", title: "Buttons", closable: false },
        { id: templateTabId2, componentId: "gallery-chain-actions", title: "Chain Actions", closable: false },
      ],
      defaultTitle: "Component Gallery",
      acceptsFamilies: ["developer"],
    });
    // Register the tab component types too (needed for filterRegisteredCards)
    registerCard({
      componentId: "gallery-buttons",
      defaultMeta: { title: "Buttons", closable: false },
      contentFactory: () => null,
    });
    registerCard({
      componentId: "gallery-chain-actions",
      defaultMeta: { title: "Chain Actions", closable: false },
      contentFactory: () => null,
    });

    const cardId = manager.addCard("gallery-host");
    expect(cardId).not.toBeNull();

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card).toBeDefined();

    // Should have 2 tabs matching the defaultTabs templates
    expect(card.tabs.length).toBe(2);
    expect(card.tabs[0].componentId).toBe("gallery-buttons");
    expect(card.tabs[0].title).toBe("Buttons");
    expect(card.tabs[0].closable).toBe(false);
    expect(card.tabs[1].componentId).toBe("gallery-chain-actions");
    expect(card.tabs[1].title).toBe("Chain Actions");

    // Tab IDs must be fresh UUIDs, NOT the template IDs
    expect(card.tabs[0].id).not.toBe(templateTabId1);
    expect(card.tabs[1].id).not.toBe(templateTabId2);
    // UUIDs are non-empty strings
    expect(card.tabs[0].id.length).toBeGreaterThan(0);
    expect(card.tabs[1].id.length).toBeGreaterThan(0);

    // activeTabId should be the first generated tab's ID
    expect(card.activeTabId).toBe(card.tabs[0].id);

    // title and acceptsFamilies from registration
    expect(card.title).toBe("Component Gallery");
    expect(card.acceptsFamilies).toEqual(["developer"]);
  });

  it("addCard without defaultTabs creates single-tab card with title: empty string", () => {
    registerCard(makeRegistration("hello", "Hello"));

    const cardId = manager.addCard("hello");
    expect(cardId).not.toBeNull();

    const card = manager.getDeckState().cards.find((c) => c.id === cardId)!;
    expect(card.tabs.length).toBe(1);
    expect(card.title).toBe("");
    expect(card.acceptsFamilies).toEqual(["standard"]);
  });

  it("detachTab on a card with acceptsFamilies: [developer] creates a new card that inherits acceptsFamilies", () => {
    registerCard({
      componentId: "gallery-host",
      defaultMeta: { title: "Gallery Host", closable: true },
      contentFactory: () => null,
      acceptsFamilies: ["developer"],
    });
    registerCard(makeRegistration("hello", "Hello"));

    const cardId = manager.addCard("gallery-host") as string;

    // Add a second tab so we can detach (last-tab guard)
    const tab2Id = manager.addTab(cardId, "hello") as string;

    const newCardId = manager.detachTab(cardId, tab2Id, { x: 50, y: 50 });
    expect(newCardId).not.toBeNull();

    const newCard = manager.getDeckState().cards.find((c) => c.id === newCardId)!;
    expect(newCard).toBeDefined();
    // Detached card loses the card-level title
    expect(newCard.title).toBe("");
    // Inherits acceptsFamilies from source card
    expect(newCard.acceptsFamilies).toEqual(["developer"]);
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

// ---------------------------------------------------------------------------
// Phase 5f: Tab state cache (Spec S03, Step 3)
// ---------------------------------------------------------------------------

describe("DeckManager tab state cache (Phase 5f Step 3)", () => {
  it("getTabState returns undefined for unknown tab ID", () => {
    expect(manager.getTabState("unknown-tab-id")).toBeUndefined();
  });

  it("setTabState followed by getTabState returns the saved bag", () => {
    const bag = { scroll: { x: 10, y: 50 }, content: { key: "value" } };
    manager.setTabState("tab-abc", bag);
    const retrieved = manager.getTabState("tab-abc");
    expect(retrieved).toBeDefined();
    expect(retrieved?.scroll?.x).toBe(10);
    expect(retrieved?.scroll?.y).toBe(50);
    expect((retrieved?.content as Record<string, string>).key).toBe("value");
  });

  it("setTabState overwrites an existing entry", () => {
    manager.setTabState("tab-xyz", { scroll: { x: 0, y: 0 } });
    manager.setTabState("tab-xyz", { scroll: { x: 99, y: 77 } });
    const retrieved = manager.getTabState("tab-xyz");
    expect(retrieved?.scroll?.x).toBe(99);
    expect(retrieved?.scroll?.y).toBe(77);
  });

  it("getTabState with different tab IDs returns independent entries", () => {
    manager.setTabState("tab-1", { scroll: { x: 1, y: 1 } });
    manager.setTabState("tab-2", { scroll: { x: 2, y: 2 } });
    expect(manager.getTabState("tab-1")?.scroll?.x).toBe(1);
    expect(manager.getTabState("tab-2")?.scroll?.x).toBe(2);
  });

  it("constructor accepts initialTabStates and populates cache", () => {
    const initialMap = new Map([
      ["tab-init-1", { scroll: { x: 5, y: 15 } }],
      ["tab-init-2", { content: "saved" }],
    ]);

    // Create a fresh manager with pre-loaded tab states.
    const c2 = makeContainer();
    const conn2 = makeMockConnection();
    const mgr2 = new DeckManager(c2, conn2, undefined, undefined, initialMap);
    try {
      expect(mgr2.getTabState("tab-init-1")?.scroll?.x).toBe(5);
      expect(mgr2.getTabState("tab-init-2")?.content).toBe("saved");
      expect(mgr2.getTabState("tab-init-3")).toBeUndefined();
    } finally {
      mgr2.destroy();
      c2.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 5f: focusCard calls putFocusedCardId (Step 3)
// ---------------------------------------------------------------------------

describe("DeckManager.focusCard calls putFocusedCardId (Phase 5f Step 3)", () => {
  it("focusCard on an existing card fires a PUT to the deck state endpoint", async () => {
    registerCard(makeRegistration("hello", "Hello"));
    const card1Id = manager.addCard("hello") as string;
    manager.addCard("hello");

    const putCalls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      putCalls.push(url as string);
      return { status: 200, ok: true, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    // Focus card1 (currently not top — card2 was added last).
    manager.handleCardFocused(card1Id);
    // Give fire-and-forget a tick.
    await new Promise((r) => setTimeout(r, 0));

    const deckStatePuts = putCalls.filter((u) =>
      u.includes("/api/defaults/dev.tugtool.deck.state/focusedCardId")
    );
    expect(deckStatePuts.length).toBeGreaterThan(0);
    // Restore the global no-op for afterEach cleanup.
    globalThis.fetch = _noopFetch;
  });

  it("focusCard on an already-focused (top) card still fires PUT", async () => {
    registerCard(makeRegistration("hello", "Hello"));
    manager.addCard("hello");
    const card2Id = manager.addCard("hello") as string;

    const putCalls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      putCalls.push(url as string);
      return { status: 200, ok: true, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    // card2 is already top-most (last in array). This should still PUT.
    manager.handleCardFocused(card2Id);
    await new Promise((r) => setTimeout(r, 0));

    const deckStatePuts = putCalls.filter((u) =>
      u.includes("/api/defaults/dev.tugtool.deck.state/focusedCardId")
    );
    expect(deckStatePuts.length).toBeGreaterThan(0);
    // Restore the global no-op for afterEach cleanup.
    globalThis.fetch = _noopFetch;
  });
});

// ---------------------------------------------------------------------------
// Phase 5f3 Step 2: Save callbacks — registerSaveCallback / unregisterSaveCallback
// and visibilitychange / beforeunload handlers (T03-T06)
// ---------------------------------------------------------------------------

describe("DeckManager – save callbacks (Phase 5f3 Step 2)", () => {
  /**
   * T03: registerSaveCallback stores the callback; unregisterSaveCallback removes it.
   *
   * Verified indirectly: after register + visibilitychange, callback fires;
   * after unregister + visibilitychange, callback does NOT fire again.
   */
  it("T03: registerSaveCallback stores and unregisterSaveCallback removes a callback", () => {
    let callCount = 0;
    const cb = () => { callCount += 1; };

    manager.registerSaveCallback("card-1", cb);

    // Simulate visibilitychange with document.hidden = true.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(callCount).toBe(1);

    // Unregister and fire again — callback must NOT fire.
    manager.unregisterSaveCallback("card-1");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(callCount).toBe(1);

    // Restore document.hidden to false.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  /**
   * T04: visibilitychange with document.hidden === true calls all registered
   * callbacks and flushes dirty tab states.
   */
  it("T04: visibilitychange (hidden) calls all registered callbacks and flushes dirty tab states", async () => {
    const calls: string[] = [];
    manager.registerSaveCallback("card-a", () => calls.push("card-a"));
    manager.registerSaveCallback("card-b", () => calls.push("card-b"));

    // Mark a tab as dirty so flush sends a PUT.
    manager.setTabState("tab-x", { scroll: { x: 1, y: 2 } });

    const fetchedUrls: string[] = [];
    const fetchInits: RequestInit[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchedUrls.push(url as string);
      if (init) fetchInits.push(init);
      return { status: 200, ok: true, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    // Simulate visibilitychange with document.hidden = true.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));

    // Callbacks fire synchronously (visibilitychange handler is sync).
    expect(calls).toContain("card-a");
    expect(calls).toContain("card-b");

    // Wait a tick for fire-and-forget fetch to execute.
    await new Promise((r) => setTimeout(r, 0));

    // flushDirtyTabStates must have issued a PUT for tab-x.
    const tabStatePuts = fetchedUrls.filter((u) => u.includes("/api/defaults/dev.tugtool.deck.tabstate/"));
    expect(tabStatePuts.length).toBeGreaterThan(0);

    // Restore.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    globalThis.fetch = _noopFetch;
  });

  /**
   * T05: beforeunload calls all registered save callbacks.
   */
  it("T05: beforeunload calls all registered save callbacks", () => {
    const calls: string[] = [];
    manager.registerSaveCallback("card-c", () => calls.push("card-c"));
    manager.registerSaveCallback("card-d", () => calls.push("card-d"));

    window.dispatchEvent(new Event("beforeunload"));

    expect(calls).toContain("card-c");
    expect(calls).toContain("card-d");
  });

  /**
   * T05b: prepareForReload() flushes without keepalive and sets reloadPending,
   * so a subsequent beforeunload event skips the flush entirely.
   */
  it("T05b: prepareForReload() causes beforeunload to skip flush", async () => {
    const calls: string[] = [];
    manager.registerSaveCallback("card-e", () => calls.push("card-e"));

    // Mark a tab as dirty.
    manager.setTabState("tab-z", { scroll: { x: 5, y: 10 } });

    const fetchedInits: RequestInit[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init) fetchedInits.push(init);
      return { status: 200, ok: true, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    // Call prepareForReload — flushes once, sets reloadPending.
    manager.prepareForReload();

    // Wait a tick for the fire-and-forget fetch.
    await new Promise((r) => setTimeout(r, 0));

    const countAfterPrepare = fetchedInits.length;
    expect(countAfterPrepare).toBeGreaterThan(0);

    // The flush from prepareForReload must NOT use keepalive.
    const keepaliveInits = fetchedInits.filter((init) => init.keepalive === true);
    expect(keepaliveInits.length).toBe(0);

    // Now simulate beforeunload — it must be a no-op because reloadPending is true.
    window.dispatchEvent(new Event("beforeunload"));

    await new Promise((r) => setTimeout(r, 0));

    // No additional fetches should have fired.
    expect(fetchedInits.length).toBe(countAfterPrepare);

    globalThis.fetch = _noopFetch;
  });

  /**
   * T06: destroy() removes the event listeners — a subsequent visibilitychange
   * must NOT call the registered callbacks.
   */
  it("T06: destroy() removes event listeners; subsequent visibilitychange does not call callbacks", () => {
    let callCount = 0;
    manager.registerSaveCallback("card-d", () => { callCount += 1; });

    // destroy() removes the listeners.
    manager.destroy();

    // Simulate visibilitychange AFTER destroy.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(callCount).toBe(0);

    // Restore.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });

    // Prevent afterEach from calling destroy() again on an already-destroyed manager.
    // Reassign manager to a fresh one so afterEach cleanup works cleanly.
    container.remove();
    container = makeContainer();
    manager = new DeckManager(container, connection);
  });
});

// ---------------------------------------------------------------------------
// Explicit set membership (5.5a)
// ---------------------------------------------------------------------------

describe("DeckManager.getCardSet", () => {
  it("returns empty array for a card not in any set", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello")!;
    expect(manager.getCardSet(cardId)).toEqual([]);
  });

  it("returns the full set including the queried card", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    manager.joinSet([a, b]);
    const setA = manager.getCardSet(a);
    expect(setA).toContain(a);
    expect(setA).toContain(b);
    expect(setA.length).toBe(2);
  });

  it("returns empty array for an unknown card ID", () => {
    expect(manager.getCardSet("nonexistent")).toEqual([]);
  });
});

describe("DeckManager.joinSet", () => {
  it("creates a set from two solo cards", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    manager.joinSet([a, b]);
    expect(manager.getDeckState().sets).toEqual([[a, b]]);
  });

  it("is a no-op when called with fewer than 2 cards", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    manager.joinSet([a]);
    expect(manager.getDeckState().sets).toEqual([]);
  });

  it("merges two existing sets when a card bridges them", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    const c = manager.addCard("hello")!;
    // Create two separate sets.
    manager.joinSet([a, b]);
    manager.joinSet([c, b]); // b bridges set {a,b} and solo c
    const sets = manager.getDeckState().sets;
    expect(sets.length).toBe(1);
    const merged = sets[0];
    expect(merged).toContain(a);
    expect(merged).toContain(b);
    expect(merged).toContain(c);
  });

  it("is idempotent when cards are already in the same set", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    manager.joinSet([a, b]);
    manager.joinSet([a, b]);
    const sets = manager.getDeckState().sets;
    expect(sets.length).toBe(1);
    expect(sets[0].length).toBe(2);
  });

  it("preserves unrelated sets", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    const c = manager.addCard("hello")!;
    const d = manager.addCard("hello")!;
    manager.joinSet([a, b]);
    manager.joinSet([c, d]);
    const sets = manager.getDeckState().sets;
    expect(sets.length).toBe(2);
  });
});

describe("DeckManager.removeFromSet", () => {
  it("removes a card from a 3-member set, leaving 2 members", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    const c = manager.addCard("hello")!;
    manager.joinSet([a, b, c]);
    manager.removeFromSet(a);
    const sets = manager.getDeckState().sets;
    expect(sets.length).toBe(1);
    expect(sets[0]).toContain(b);
    expect(sets[0]).toContain(c);
    expect(sets[0]).not.toContain(a);
  });

  it("dissolves a 2-member set when one card is removed", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    manager.joinSet([a, b]);
    manager.removeFromSet(a);
    expect(manager.getDeckState().sets).toEqual([]);
  });

  it("is a no-op for a card not in any set", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const versionBefore = manager.getVersion();
    manager.removeFromSet(a);
    // No state change — version should not increment.
    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("does not affect unrelated sets", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    const c = manager.addCard("hello")!;
    const d = manager.addCard("hello")!;
    manager.joinSet([a, b]);
    manager.joinSet([c, d]);
    manager.removeFromSet(a); // dissolves {a,b}, leaves {c,d}
    const sets = manager.getDeckState().sets;
    expect(sets.length).toBe(1);
    expect(sets[0]).toContain(c);
    expect(sets[0]).toContain(d);
  });
});

describe("DeckManager.removeCard — set cleanup", () => {
  it("removes a card from its set and dissolves if < 2 remain", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    manager.joinSet([a, b]);
    manager.handleCardClosed(a);
    expect(manager.getDeckState().sets).toEqual([]);
    expect(manager.getDeckState().cards.find((c) => c.id === a)).toBeUndefined();
  });

  it("removes a card from a 3-member set, leaving the set intact", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const a = manager.addCard("hello")!;
    const b = manager.addCard("hello")!;
    const c = manager.addCard("hello")!;
    manager.joinSet([a, b, c]);
    manager.handleCardClosed(a);
    const sets = manager.getDeckState().sets;
    expect(sets.length).toBe(1);
    expect(sets[0]).toContain(b);
    expect(sets[0]).toContain(c);
    expect(sets[0]).not.toContain(a);
  });
});
