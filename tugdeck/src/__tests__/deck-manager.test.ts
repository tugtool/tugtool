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
import { serialize } from "../serialization";

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

type DeckStateT = import("../layout-tree").DeckState;
type CardT = import("../layout-tree").CardState;
type StackT = import("../layout-tree").CardStackState;

/** Return the stack hosting `cardId`. Throws when no stack hosts it. */
function hostStack(state: DeckStateT, cardId: string): StackT {
  const s = state.stacks.find((st) => st.cardIds.includes(cardId));
  if (!s) throw new Error(`deck-manager.test: no stack hosts card ${cardId}`);
  return s;
}

/** Return the card by id. Throws when absent. */
function getCard(state: DeckStateT, cardId: string): CardT {
  const c = state.cards.find((card) => card.id === cardId);
  if (!c) throw new Error(`deck-manager.test: no card with id ${cardId}`);
  return c;
}

/** Return every card belonging to `stack`, in stack order. */
function cardsOf(state: DeckStateT, stack: StackT): CardT[] {
  return stack.cardIds.map((cid) => getCard(state, cid));
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
  it("T30: creates a Card and single-Card Stack with 400x300 default size", () => {
    registerCard(makeRegistration("hello", "Hello"));

    const cardId = manager.addCard("hello");

    expect(cardId).not.toBeNull();
    expect(typeof cardId).toBe("string");

    const state = manager.getDeckState();
    expect(state.cards.length).toBe(1);
    expect(state.stacks.length).toBe(1);

    const stack = state.stacks[0];
    expect(stack.cardIds).toEqual([cardId!]);
    expect(stack.size.width).toBe(400);
    expect(stack.size.height).toBe(300);
    expect(stack.activeCardId).toBe(cardId!);

    const card = getCard(state, cardId!);
    expect(card.componentId).toBe("hello");
    expect(card.title).toBe("Hello");
    expect(card.closable).toBe(true);
  });

  it("returns the generated card ID (non-empty UUID string)", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello");
    expect(typeof cardId).toBe("string");
    expect((cardId as string).length).toBeGreaterThan(0);
  });

  it("card title comes from registration.defaultMeta.title", () => {
    registerCard(makeRegistration("terminal", "Terminal Window"));
    const cardId = manager.addCard("terminal") as string;
    expect(getCard(manager.getDeckState(), cardId).title).toBe("Terminal Window");
  });

  it("card closable reflects registration.defaultMeta.closable", () => {
    registerCard({
      componentId: "sticky",
      defaultMeta: { title: "Sticky", closable: false },
      contentFactory: () => null,
    });
    const cardId = manager.addCard("sticky") as string;
    expect(getCard(manager.getDeckState(), cardId).closable).toBe(false);
  });

  it("fires construction + full activation transition on each new card", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));

    const log: string[] = [];
    manager.cardLifecycle.observeCardDidFinishConstruction(null, (id) =>
      log.push(`construct:${id}`),
    );
    manager.cardLifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willActivate:${id}`),
    );
    manager.cardLifecycle.observeCardDidActivate(null, (id) =>
      log.push(`didActivate:${id}`),
    );
    manager.cardLifecycle.observeCardWillDeactivate(null, (id) =>
      log.push(`willDeactivate:${id}`),
    );
    manager.cardLifecycle.observeCardDidDeactivate(null, (id) =>
      log.push(`didDeactivate:${id}`),
    );

    // First card: construction + activation only (no prior active).
    const id1 = manager.addCard("hello") as string;
    // Second card: construction, then deactivate old + activate new.
    const id2 = manager.addCard("terminal") as string;

    expect(log).toEqual([
      // First card
      `construct:${id1}`,
      `willActivate:${id1}`,
      `didActivate:${id1}`,
      // Second card
      `construct:${id2}`,
      `willDeactivate:${id1}`,
      `willActivate:${id2}`,
      `didDeactivate:${id1}`,
      `didActivate:${id2}`,
    ]);
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

describe("DeckManager.handleCardClosed", () => {
  it("T32: closes the specified stack, removing all its cards from DeckState.cards", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    expect(manager.getDeckState().cards.length).toBe(1);

    manager.handleCardClosed(stackId);
    expect(manager.getDeckState().cards.length).toBe(0);
    expect(manager.getDeckState().stacks.length).toBe(0);
  });

  it("removes only the specified stack when multiple stacks exist", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("terminal") as string;
    const stack1Id = hostStack(manager.getDeckState(), id1).id;
    expect(manager.getDeckState().cards.length).toBe(2);

    manager.handleCardClosed(stack1Id);

    const remaining = manager.getDeckState().cards;
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(id2);
  });

  it("is a no-op when the stack ID does not exist", () => {
    registerCard(makeRegistration("hello"));
    manager.addCard("hello");
    expect(manager.getDeckState().cards.length).toBe(1);

    manager.handleCardClosed("nonexistent-id");
    expect(manager.getDeckState().cards.length).toBe(1);
  });

  it("fires will/didActivate on the new top-of-deck when the active stack closes", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("terminal") as string;
    const stack2Id = hostStack(manager.getDeckState(), id2).id;
    // id2 is now the active card (its stack is top-of-deck). Closing id2's
    // stack should deactivate id2, destroy it, and activate id1 as the new top.

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willActivate:${id}`),
    );
    manager.cardLifecycle.observeCardDidActivate(null, (id) =>
      log.push(`didActivate:${id}`),
    );
    manager.cardLifecycle.observeCardWillDeactivate(null, (id) =>
      log.push(`willDeactivate:${id}`),
    );
    manager.cardLifecycle.observeCardDidDeactivate(null, (id) =>
      log.push(`didDeactivate:${id}`),
    );
    manager.cardLifecycle.observeCardWillBeginDestruction(null, (id) =>
      log.push(`willDestroy:${id}`),
    );
    log.length = 0;

    manager.handleCardClosed(stack2Id);

    expect(log).toEqual([
      `willDeactivate:${id2}`,
      `didDeactivate:${id2}`,
      `willDestroy:${id2}`,
      `willActivate:${id1}`,
      `didActivate:${id1}`,
    ]);
  });

  it("fires no activation when the last stack closes (nothing left to activate)", () => {
    registerCard(makeRegistration("hello"));
    const id1 = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), id1).id;

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willActivate:${id}`),
    );
    manager.cardLifecycle.observeCardDidActivate(null, (id) =>
      log.push(`didActivate:${id}`),
    );
    log.length = 0;

    manager.handleCardClosed(stackId);

    expect(log).toEqual([]);
  });

  it("fires no activation when a non-active stack closes", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    const stack1Id = hostStack(manager.getDeckState(), id1).id;
    manager.addCard("terminal"); // id2's stack is now active

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willActivate:${id}`),
    );
    manager.cardLifecycle.observeCardDidActivate(null, (id) =>
      log.push(`didActivate:${id}`),
    );
    manager.cardLifecycle.observeCardWillDeactivate(null, (id) =>
      log.push(`willDeactivate:${id}`),
    );
    manager.cardLifecycle.observeCardDidDeactivate(null, (id) =>
      log.push(`didDeactivate:${id}`),
    );
    log.length = 0;

    manager.handleCardClosed(stack1Id);

    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T33: moveCard updates position and size
// ---------------------------------------------------------------------------

describe("DeckManager.moveStack", () => {
  it("T33: updates position and size of the specified stack", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;

    manager.moveStack(stackId, { x: 150, y: 200 }, { width: 500, height: 400 });

    const stack = hostStack(manager.getDeckState(), cardId);
    expect(stack.position.x).toBe(150);
    expect(stack.position.y).toBe(200);
    expect(stack.size.width).toBe(500);
    expect(stack.size.height).toBe(400);
  });

  it("does not affect other stacks when one stack is moved", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("terminal") as string;

    const originalStack2 = hostStack(manager.getDeckState(), id2);
    const originalPos2 = { ...originalStack2.position };
    const originalSize2 = { ...originalStack2.size };

    const stackId1 = hostStack(manager.getDeckState(), id1).id;
    manager.moveStack(stackId1, { x: 999, y: 888 }, { width: 777, height: 666 });

    const stack2 = hostStack(manager.getDeckState(), id2);
    expect(stack2.position.x).toBe(originalPos2.x);
    expect(stack2.position.y).toBe(originalPos2.y);
    expect(stack2.size.width).toBe(originalSize2.width);
    expect(stack2.size.height).toBe(originalSize2.height);
  });

  it("fires cardWillMove/cardDidMove only when position changes", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stack = hostStack(manager.getDeckState(), cardId);

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillMove(cardId, () =>
      log.push("willMove"),
    );
    manager.cardLifecycle.observeCardDidMove(cardId, () => log.push("didMove"));
    manager.cardLifecycle.observeCardWillResize(cardId, () =>
      log.push("willResize"),
    );
    manager.cardLifecycle.observeCardDidResize(cardId, () =>
      log.push("didResize"),
    );

    // Pure drag: position changes, size stays the same.
    manager.moveStack(
      stack.id,
      { x: stack.position.x + 100, y: stack.position.y + 50 },
      { width: stack.size.width, height: stack.size.height },
    );

    expect(log).toEqual(["willMove", "didMove"]);
  });

  it("fires cardWillResize/cardDidResize only when size changes", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stack = hostStack(manager.getDeckState(), cardId);

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillMove(cardId, () =>
      log.push("willMove"),
    );
    manager.cardLifecycle.observeCardDidMove(cardId, () => log.push("didMove"));
    manager.cardLifecycle.observeCardWillResize(cardId, () =>
      log.push("willResize"),
    );
    manager.cardLifecycle.observeCardDidResize(cardId, () =>
      log.push("didResize"),
    );

    // Pure edge resize: size changes, position stays.
    manager.moveStack(
      stack.id,
      { x: stack.position.x, y: stack.position.y },
      { width: stack.size.width + 50, height: stack.size.height + 30 },
    );

    expect(log).toEqual(["willResize", "didResize"]);
  });

  it("fires both pairs when a corner-handle resize changes position AND size", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stack = hostStack(manager.getDeckState(), cardId);

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillMove(cardId, () =>
      log.push("willMove"),
    );
    manager.cardLifecycle.observeCardDidMove(cardId, () => log.push("didMove"));
    manager.cardLifecycle.observeCardWillResize(cardId, () =>
      log.push("willResize"),
    );
    manager.cardLifecycle.observeCardDidResize(cardId, () =>
      log.push("didResize"),
    );

    // Top-left handle drag: origin moves, size changes.
    manager.moveStack(
      stack.id,
      { x: stack.position.x + 20, y: stack.position.y + 20 },
      { width: stack.size.width - 20, height: stack.size.height - 20 },
    );

    // will-pair fires before store update (both fires), did-pair after.
    expect(log).toEqual(["willMove", "willResize", "didMove", "didResize"]);
  });

  it("fires neither pair on an identity moveStack (same position AND size)", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stack = hostStack(manager.getDeckState(), cardId);

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillMove(cardId, () => log.push("m"));
    manager.cardLifecycle.observeCardDidMove(cardId, () => log.push("M"));
    manager.cardLifecycle.observeCardWillResize(cardId, () => log.push("r"));
    manager.cardLifecycle.observeCardDidResize(cardId, () => log.push("R"));

    manager.moveStack(
      stack.id,
      { x: stack.position.x, y: stack.position.y },
      { width: stack.size.width, height: stack.size.height },
    );

    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// arrangeCards lifecycle events (H-A2)
// ---------------------------------------------------------------------------

describe("DeckManager.arrangeCards", () => {
  it("cascade fires cardWillMove/cardDidMove only on cards whose position changed (H-A2)", () => {
    registerCard(makeRegistration("hello"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("hello") as string;
    const id3 = manager.addCard("hello") as string;

    // addCard lays out the stacks in cascade positions already. Move
    // one stack off the cascade so arrangeCards("cascade") actually
    // changes its position; the other two stay put.
    const stack2 = hostStack(manager.getDeckState(), id2);
    manager.moveStack(stack2.id, { x: 500, y: 500 }, stack2.size);

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillMove(null, (id) =>
      log.push(`willMove:${id}`),
    );
    manager.cardLifecycle.observeCardDidMove(null, (id) =>
      log.push(`didMove:${id}`),
    );
    manager.cardLifecycle.observeCardWillResize(null, (id) =>
      log.push(`willResize:${id}`),
    );
    manager.cardLifecycle.observeCardDidResize(null, (id) =>
      log.push(`didResize:${id}`),
    );

    manager.arrangeCards("cascade");

    // Only card2 actually moves back; card1 and card3 already at
    // cascade positions. Cascade doesn't change size.
    expect(log).toEqual([`willMove:${id2}`, `didMove:${id2}`]);
    expect(id1).toBeTruthy();
    expect(id3).toBeTruthy();
  });

  it("tile fires both cardWillMove/cardDidMove and cardWillResize/cardDidResize (H-A2)", () => {
    registerCard(makeRegistration("hello"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("hello") as string;

    const moveLog: string[] = [];
    const resizeLog: string[] = [];
    manager.cardLifecycle.observeCardDidMove(null, (id) =>
      moveLog.push(id),
    );
    manager.cardLifecycle.observeCardDidResize(null, (id) =>
      resizeLog.push(id),
    );

    manager.arrangeCards("tile");

    // Tile commits both position and size for all cards.
    expect(moveLog.sort()).toEqual([id1, id2].sort());
    expect(resizeLog.sort()).toEqual([id1, id2].sort());
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

    // focusCard reorders stacks (frames hold z-order), not cards.
    const stacks = manager.getDeckState().stacks;
    expect(stacks.length).toBe(3);
    expect(stacks[stacks.length - 1].cardIds).toContain(id1);
    expect(stacks[0].cardIds).toContain(id2);
    expect(stacks[1].cardIds).toContain(id3);
  });

  it("is a no-op when the card is already at the end (already top-most)", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const id1 = manager.addCard("hello") as string;
    const id2 = manager.addCard("terminal") as string;
    // id2's stack is already last

    manager.focusCard(id2);

    const stacks = manager.getDeckState().stacks;
    expect(stacks[0].cardIds).toContain(id1);
    expect(stacks[1].cardIds).toContain(id2);
  });

  it("is a no-op when the card ID does not exist", () => {
    registerCard(makeRegistration("hello"));
    const id1 = manager.addCard("hello") as string;

    manager.focusCard("nonexistent");

    expect(manager.getDeckState().stacks[0].cardIds).toContain(id1);
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

    const s1 = hostStack(manager.getDeckState(), id1);
    const s2 = hostStack(manager.getDeckState(), id2);
    const s3 = hostStack(manager.getDeckState(), id3);

    // First stack: cascade index 0 → position (10, 10) (CASCADE_ORIGIN offset)
    expect(s1.position.x).toBe(10);
    expect(s1.position.y).toBe(10);

    // Second stack: cascade index 1 → position (40, 40)
    expect(s2.position.x).toBe(40);
    expect(s2.position.y).toBe(40);

    // Third stack: cascade index 2 → position (70, 70)
    expect(s3.position.x).toBe(70);
    expect(s3.position.y).toBe(70);
  });

  it("resets cascade index when cascaded position would overflow canvas bounds", () => {
    registerCard(makeRegistration("hello"));

    // Add enough cards to guarantee a cascade reset.
    // Canvas width fallback is 800 (clientWidth=0 in happy-dom worker).
    // Default stack width=400. Overflow: x + 400 > 800 → x > 400.
    // At step 30: index 14 → x=10+30*14=430 > 400 → first reset → position (10,10).
    const NUM_CARDS = 20;
    for (let i = 0; i < NUM_CARDS; i++) {
      manager.addCard("hello");
    }

    const stacks = manager.getDeckState().stacks;
    expect(stacks.length).toBe(NUM_CARDS);

    // The cascade must have reset at some point. Verify this by finding a stack
    // whose x-position is strictly less than its predecessor's x-position.
    let foundReset = false;
    for (let i = 1; i < stacks.length; i++) {
      if (stacks[i].position.x < stacks[i - 1].position.x) {
        foundReset = true;
        // The position after reset must be CASCADE_ORIGIN (10).
        expect(stacks[i].position.x).toBe(10);
        expect(stacks[i].position.y).toBe(10);
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

  it("getVersion() increments after handleCardClosed()", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    const v1 = manager.getVersion();
    manager.handleCardClosed(stackId);
    expect(manager.getVersion()).toBe(v1 + 1);
  });

  it("getVersion() increments after moveStack()", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    const v1 = manager.getVersion();
    manager.moveStack(stackId, { x: 10, y: 20 }, { width: 300, height: 200 });
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

  it("subscriber fires on handleCardClosed()", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    let fired = false;
    manager.subscribe(() => { fired = true; });
    manager.handleCardClosed(stackId);
    expect(fired).toBe(true);
  });

  it("subscriber fires on moveStack()", () => {
    registerCard(makeRegistration("hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    let fired = false;
    manager.subscribe(() => { fired = true; });
    manager.moveStack(stackId, { x: 5, y: 10 }, { width: 300, height: 200 });
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
// addCardToStack tests (Spec S03)
// ---------------------------------------------------------------------------

describe("DeckManager.addCardToStack", () => {
  it("creates a new card with correct componentId and title from registration", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stack = hostStack(manager.getDeckState(), cardId);
    expect(stack.cardIds.length).toBe(1);

    registerCard(makeRegistration("terminal", "Terminal"));
    const newCardId = manager.addCardToStack(stack.id, "terminal");

    expect(newCardId).not.toBeNull();
    expect(typeof newCardId).toBe("string");

    const updated = hostStack(manager.getDeckState(), cardId);
    expect(updated.cardIds.length).toBe(2);
    const newCard = getCard(manager.getDeckState(), newCardId!);
    expect(newCard.componentId).toBe("terminal");
    expect(newCard.title).toBe("Terminal");
  });

  it("new card becomes the active card after addCardToStack", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;

    registerCard(makeRegistration("terminal", "Terminal"));
    const newCardId = manager.addCardToStack(stackId, "terminal");

    expect(hostStack(manager.getDeckState(), cardId).activeCardId).toBe(newCardId!);
  });

  it("returns null for unregistered componentId", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const result = manager.addCardToStack(stackId, "nonexistent");

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns null for non-existent stackId", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const result = manager.addCardToStack("nonexistent-stack-id", "hello");

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("notifies subscribers after addCardToStack", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    registerCard(makeRegistration("terminal", "Terminal"));

    let callCount = 0;
    manager.subscribe(() => { callCount += 1; });
    manager.addCardToStack(stackId, "terminal");

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// removeCard tests (Spec S03)
// ---------------------------------------------------------------------------

describe("DeckManager.removeCard", () => {
  it("removes the specified card and activates the previous card", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const firstCardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), firstCardId).id;

    // Add a second card and make it active
    const secondCardId = manager.addCardToStack(stackId, "terminal") as string;
    expect(hostStack(manager.getDeckState(), firstCardId).activeCardId).toBe(secondCardId);

    // Remove the second (active) card -- should activate the previous (first) card
    manager.removeCard(stackId, secondCardId);

    const stack = hostStack(manager.getDeckState(), firstCardId);
    expect(stack.cardIds.length).toBe(1);
    expect(stack.activeCardId).toBe(firstCardId);
  });

  it("activates first card when the first card is removed", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const firstCardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), firstCardId).id;

    // Add a second card (it becomes active)
    const secondCardId = manager.addCardToStack(stackId, "terminal") as string;

    // Make first card active, then remove it
    manager.setActiveCardInStack(stackId, firstCardId);
    manager.removeCard(stackId, firstCardId);

    const state = manager.getDeckState();
    const stack = state.stacks.find((s) => s.id === stackId)!;
    expect(stack.cardIds.length).toBe(1);
    expect(stack.activeCardId).toBe(secondCardId);
  });

  it("removes the stack entirely when the last card is removed", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;

    manager.removeCard(stackId, cardId);

    const state = manager.getDeckState();
    expect(state.stacks.find((s) => s.id === stackId)).toBeUndefined();
    expect(state.cards.find((c) => c.id === cardId)).toBeUndefined();
  });

  it("is a no-op for a non-existent cardId", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    const cardsBefore = hostStack(manager.getDeckState(), cardId).cardIds.length;

    manager.removeCard(stackId, "nonexistent-card-id");

    expect(hostStack(manager.getDeckState(), cardId).cardIds.length).toBe(cardsBefore);
  });

  it("is a no-op for a non-existent stackId", () => {
    const cardCountBefore = manager.getDeckState().cards.length;

    manager.removeCard("nonexistent-stack-id", "some-card-id");

    expect(manager.getDeckState().cards.length).toBe(cardCountBefore);
  });

  it("notifies subscribers after removeCard", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const firstCardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), firstCardId).id;
    const secondCardId = manager.addCardToStack(stackId, "terminal") as string;

    let callCount = 0;
    manager.subscribe(() => { callCount += 1; });
    manager.removeCard(stackId, secondCardId);

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// filterRegisteredCards tests
// ---------------------------------------------------------------------------

describe("DeckManager filterRegisteredCards – multi-card filtering", () => {
  it("keeps only registered cards from a stack with mixed registered/unregistered cards", () => {
    // Register only "hello"; "ghost" is intentionally not registered.
    registerCard(makeRegistration("hello", "Hello"));

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const stackId = crypto.randomUUID();
    const helloCardId = crypto.randomUUID();
    const ghostCardId = crypto.randomUUID();

    manager.applyLayout({
      cards: [
        { id: helloCardId, componentId: "hello", title: "Hello", closable: true },
        { id: ghostCardId, componentId: "ghost", title: "Ghost", closable: true },
      ],
      stacks: [
        {
          id: stackId,
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: [helloCardId, ghostCardId],
          activeCardId: helloCardId,
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
    });

    const state = manager.getDeckState();
    const stack = state.stacks.find((s) => s.id === stackId);
    expect(stack).toBeDefined();
    expect(stack!.cardIds).toEqual([helloCardId]);
    expect(stack!.activeCardId).toBe(helloCardId);
    expect(state.cards.find((c) => c.id === ghostCardId)).toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("removes a stack entirely when all its cards are unregistered", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const stackId = crypto.randomUUID();
    const cardId = crypto.randomUUID();

    manager.applyLayout({
      cards: [
        { id: cardId, componentId: "totally-unknown", title: "Unknown", closable: true },
      ],
      stacks: [
        {
          id: stackId,
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: [cardId],
          activeCardId: cardId,
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
    });

    const state = manager.getDeckState();
    expect(state.stacks.find((s) => s.id === stackId)).toBeUndefined();
    expect(state.cards.find((c) => c.id === cardId)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back activeCardId to first registered card when the active card is unregistered", () => {
    registerCard(makeRegistration("hello", "Hello"));

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const stackId = crypto.randomUUID();
    const helloCardId = crypto.randomUUID();
    const ghostCardId = crypto.randomUUID();

    // Active card is the unregistered "ghost" card.
    manager.applyLayout({
      cards: [
        { id: helloCardId, componentId: "hello", title: "Hello", closable: true },
        { id: ghostCardId, componentId: "ghost", title: "Ghost", closable: true },
      ],
      stacks: [
        {
          id: stackId,
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: [helloCardId, ghostCardId],
          activeCardId: ghostCardId,
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
    });

    const stack = manager.getDeckState().stacks.find((s) => s.id === stackId);
    expect(stack).toBeDefined();
    expect(stack!.cardIds).toEqual([helloCardId]);
    expect(stack!.activeCardId).toBe(helloCardId);

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("DeckManager.setActiveCardInStack", () => {
  it("updates activeCardId to the specified card", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const firstCardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), firstCardId).id;

    // Add second card (becomes active)
    manager.addCardToStack(stackId, "terminal");

    // Switch back to first card
    manager.setActiveCardInStack(stackId, firstCardId);

    expect(hostStack(manager.getDeckState(), firstCardId).activeCardId).toBe(firstCardId);
  });

  it("is a no-op for an invalid cardId (not in cardIds)", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stack = hostStack(manager.getDeckState(), cardId);
    const originalActiveCardId = stack.activeCardId;
    const versionBefore = manager.getVersion();

    manager.setActiveCardInStack(stack.id, "nonexistent-card-id");

    expect(hostStack(manager.getDeckState(), cardId).activeCardId).toBe(originalActiveCardId);
    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("is a no-op when the card is already active", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;
    const versionBefore = manager.getVersion();

    manager.setActiveCardInStack(stackId, cardId);

    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("notifies subscribers after setActiveCardInStack changes the active card", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    const firstCardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), firstCardId).id;
    manager.addCardToStack(stackId, "terminal");

    let callCount = 0;
    manager.subscribe(() => { callCount += 1; });
    manager.setActiveCardInStack(stackId, firstCardId);

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// reorderCardInStack tests (Spec S01 / Step 1)
// ---------------------------------------------------------------------------

describe("DeckManager.reorderCardInStack", () => {
  it("T1: moves card from index 0 to index 2 in a 3-card stack", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    registerCard(makeRegistration("git", "Git"));

    const card1Id = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), card1Id).id;
    const card2Id = manager.addCardToStack(stackId, "terminal") as string;
    const card3Id = manager.addCardToStack(stackId, "git") as string;

    // Initial order: [card1, card2, card3]
    manager.reorderCardInStack(stackId, 0, 2);

    const stack = hostStack(manager.getDeckState(), card1Id);
    expect(stack.cardIds[0]).toBe(card2Id);
    expect(stack.cardIds[1]).toBe(card3Id);
    expect(stack.cardIds[2]).toBe(card1Id);
  });

  it("T2: no-op when fromIndex === toIndex", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), card1Id).id;
    manager.addCardToStack(stackId, "terminal");

    const before = [...hostStack(manager.getDeckState(), card1Id).cardIds];
    const versionBefore = manager.getVersion();

    manager.reorderCardInStack(stackId, 0, 0);

    const after = [...hostStack(manager.getDeckState(), card1Id).cardIds];
    expect(after).toEqual(before);
    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("T3: no-op when stack not found", () => {
    const versionBefore = manager.getVersion();
    manager.reorderCardInStack("nonexistent-stack", 0, 1);
    expect(manager.getVersion()).toBe(versionBefore);
  });

  it("T4: no-op when indices out of bounds", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), card1Id).id;
    manager.addCardToStack(stackId, "terminal");

    const before = [...hostStack(manager.getDeckState(), card1Id).cardIds];
    const versionBefore = manager.getVersion();

    manager.reorderCardInStack(stackId, -1, 1);
    expect(manager.getVersion()).toBe(versionBefore);

    manager.reorderCardInStack(stackId, 0, 5);
    expect(manager.getVersion()).toBe(versionBefore);

    const after = [...hostStack(manager.getDeckState(), card1Id).cardIds];
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// detachTab tests (Spec S02 / Step 1)
// ---------------------------------------------------------------------------

describe("DeckManager.detachCard", () => {
  it("T5: creates new stack with detached card, removes card from source stack", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const firstCardId = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), firstCardId).id;
    const card2Id = manager.addCardToStack(sourceStackId, "terminal") as string;

    const newStackId = manager.detachCard(sourceStackId, card2Id, { x: 100, y: 150 });

    expect(newStackId).not.toBeNull();
    expect(typeof newStackId).toBe("string");

    const state = manager.getDeckState();

    // Source stack should still exist with only 1 card
    const sourceStack = state.stacks.find((s) => s.id === sourceStackId);
    expect(sourceStack).toBeDefined();
    expect(sourceStack!.cardIds.length).toBe(1);
    expect(sourceStack!.cardIds.includes(card2Id)).toBe(false);

    // New stack should carry the detached card (same card identity)
    const newStack = state.stacks.find((s) => s.id === newStackId);
    expect(newStack).toBeDefined();
    expect(newStack!.cardIds).toEqual([card2Id]);
    expect(newStack!.activeCardId).toBe(card2Id);
    expect(newStack!.position.x).toBe(100);
    expect(newStack!.position.y).toBe(150);
  });

  it("T6: returns null when stack has only one card (last-card guard)", () => {
    registerCard(makeRegistration("hello", "Hello"));
    const cardId = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), cardId).id;

    const result = manager.detachCard(stackId, cardId, { x: 100, y: 100 });

    expect(result).toBeNull();
    // Stack should still have 1 card
    expect(hostStack(manager.getDeckState(), cardId).cardIds.length).toBe(1);
  });

  it("T7: handles two-card stack: source transitions to single-card after detach", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), card1Id).id;
    const card2Id = manager.addCardToStack(sourceStackId, "terminal") as string;

    const newStackId = manager.detachCard(sourceStackId, card2Id, { x: 200, y: 200 });

    expect(newStackId).not.toBeNull();

    const state = manager.getDeckState();
    const sourceStack = state.stacks.find((s) => s.id === sourceStackId);
    expect(sourceStack).toBeDefined();
    expect(sourceStack!.cardIds).toEqual([card1Id]);
    expect(sourceStack!.activeCardId).toBe(card1Id);
  });

  it("T8: returns null when stack not found", () => {
    const result = manager.detachCard("nonexistent-stack", "some-card", { x: 0, y: 0 });
    expect(result).toBeNull();
  });

  it("new stack is appended to end of stacks array (highest z-index)", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), card1Id).id;
    const card2Id = manager.addCardToStack(sourceStackId, "terminal") as string;

    const stacksBefore = manager.getDeckState().stacks.length;
    const newStackId = manager.detachCard(sourceStackId, card2Id, { x: 50, y: 50 }) as string;

    const stacks = manager.getDeckState().stacks;
    expect(stacks.length).toBe(stacksBefore + 1);
    // New stack should be the last in the array (highest z-index).
    expect(stacks[stacks.length - 1].id).toBe(newStackId);
  });

  it("detached stack position is clamped with Finder-style rules", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), card1Id).id;
    const card2Id = manager.addCardToStack(sourceStackId, "terminal") as string;

    // Position far outside canvas bounds (canvas is 1280x800 in tests)
    const newStackId = manager.detachCard(sourceStackId, card2Id, { x: 9999, y: 9999 }) as string;

    const newStack = manager.getDeckState().stacks.find((s) => s.id === newStackId)!;
    // Finder-style: x clamped to canvasWidth - 100 = 1180, y clamped to canvasHeight - 36 = 764
    expect(newStack.position.x).toBe(1280 - 100);
    expect(newStack.position.y).toBe(800 - 36);
  });
});

// ---------------------------------------------------------------------------
// addCard with defaultCards, title, acceptsFamilies
// ---------------------------------------------------------------------------

describe("DeckManager.addCard – defaultCards registration", () => {
  it("addCard with defaultCards creates a stack with one card per template (fresh UUIDs)", () => {
    const templateCardId1 = "tmpl-id-1";
    const templateCardId2 = "tmpl-id-2";
    registerCard({
      componentId: "gallery-host",
      defaultMeta: { title: "Gallery Host", closable: true },
      contentFactory: () => null,
      defaultCards: [
        { id: templateCardId1, componentId: "gallery-buttons", title: "Buttons", closable: false },
        { id: templateCardId2, componentId: "gallery-chain-actions", title: "Chain Actions", closable: false },
      ],
      defaultTitle: "Component Gallery",
      acceptsFamilies: ["developer"],
    });
    // Register the card component types too (needed for filterRegisteredCards)
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

    const firstCardId = manager.addCard("gallery-host");
    expect(firstCardId).not.toBeNull();

    const state = manager.getDeckState();
    const stack = hostStack(state, firstCardId!);
    expect(stack).toBeDefined();

    // Should have 2 cards matching the defaultCards templates
    const cards = cardsOf(state, stack);
    expect(cards.length).toBe(2);
    expect(cards[0].componentId).toBe("gallery-buttons");
    expect(cards[0].title).toBe("Buttons");
    expect(cards[0].closable).toBe(false);
    expect(cards[1].componentId).toBe("gallery-chain-actions");
    expect(cards[1].title).toBe("Chain Actions");

    // Card IDs must be fresh UUIDs, NOT the template IDs
    expect(cards[0].id).not.toBe(templateCardId1);
    expect(cards[1].id).not.toBe(templateCardId2);
    expect(cards[0].id.length).toBeGreaterThan(0);
    expect(cards[1].id.length).toBeGreaterThan(0);

    // activeCardId should be the first generated card's ID
    expect(stack.activeCardId).toBe(cards[0].id);

    // title and acceptsFamilies from registration
    expect(stack.title).toBe("Component Gallery");
    expect(stack.acceptsFamilies).toEqual(["developer"]);
  });

  it("addCard without defaultCards creates single-card stack with title: empty string", () => {
    registerCard(makeRegistration("hello", "Hello"));

    const cardId = manager.addCard("hello");
    expect(cardId).not.toBeNull();

    const stack = hostStack(manager.getDeckState(), cardId!);
    expect(stack.cardIds.length).toBe(1);
    expect(stack.title).toBe("");
    expect(stack.acceptsFamilies).toEqual(["standard"]);
  });

  it("detachCard on a stack with acceptsFamilies: [developer] creates a new stack that inherits acceptsFamilies", () => {
    registerCard({
      componentId: "gallery-host",
      defaultMeta: { title: "Gallery Host", closable: true },
      contentFactory: () => null,
      acceptsFamilies: ["developer"],
    });
    registerCard(makeRegistration("hello", "Hello"));

    const firstCardId = manager.addCard("gallery-host") as string;
    const sourceStackId = hostStack(manager.getDeckState(), firstCardId).id;

    // Add a second card so we can detach (last-card guard)
    const card2Id = manager.addCardToStack(sourceStackId, "hello") as string;

    const newStackId = manager.detachCard(sourceStackId, card2Id, { x: 50, y: 50 });
    expect(newStackId).not.toBeNull();

    const newStack = manager.getDeckState().stacks.find((s) => s.id === newStackId)!;
    expect(newStack).toBeDefined();
    // Detached stack loses the card-level title
    expect(newStack.title).toBe("");
    // Inherits acceptsFamilies from source stack
    expect(newStack.acceptsFamilies).toEqual(["developer"]);
  });

  it("preserves card identity across detach — no construction event", () => {
    registerCard(makeRegistration("hello"));
    const card1Id = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), card1Id).id;
    const card2Id = manager.addCardToStack(sourceStackId, "hello") as string;

    // Switch active back to the first card so the detached card (card2) is
    // non-active — mimicking the production pattern where the user explicitly
    // chooses which card to detach.
    manager.setActiveCardInStack(sourceStackId, card1Id);
    manager.activateCard(card1Id);

    const log: string[] = [];
    manager.cardLifecycle.observeCardDidFinishConstruction(null, (id) =>
      log.push(`construct:${id}`),
    );
    manager.cardLifecycle.observeCardWillBeginDestruction(null, (id) =>
      log.push(`willDestroy:${id}`),
    );
    log.length = 0; // clear initial-sync

    manager.detachCard(sourceStackId, card2Id, { x: 200, y: 200 });

    // Card identity is preserved across detach, so no CONSTRUCTION event
    // fires on the detached card and no DESTRUCTION event fires on the
    // source stack (the source keeps the other card). The log stays empty.
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// moveCardToStack tests (Spec S03 / Step 1)
// ---------------------------------------------------------------------------

describe("DeckManager.moveCardToStack", () => {
  it("T9: moves card from source to target at insertAtIndex", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));
    registerCard(makeRegistration("git", "Git"));

    // Create source stack with 2 cards
    const card1Id = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), card1Id).id;
    manager.addCardToStack(sourceStackId, "terminal");

    // Create target stack with 2 cards
    const card3Id = manager.addCard("git") as string;
    const targetStackId = hostStack(manager.getDeckState(), card3Id).id;
    manager.addCardToStack(targetStackId, "terminal");

    manager.moveCardToStack(sourceStackId, card1Id, targetStackId, 0);

    const state = manager.getDeckState();
    const targetStack = state.stacks.find((s) => s.id === targetStackId)!;
    expect(targetStack.cardIds[0]).toBe(card1Id);

    // Source stack should still exist (it had 2 cards, now 1).
    const sourceStack = state.stacks.find((s) => s.id === sourceStackId);
    expect(sourceStack).toBeDefined();
    expect(sourceStack!.cardIds.includes(card1Id)).toBe(false);
  });

  it("T10: removes source stack when source had only one card", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const sourceCardId = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), sourceCardId).id;

    const targetCardId = manager.addCard("terminal") as string;
    const targetStackId = hostStack(manager.getDeckState(), targetCardId).id;

    manager.moveCardToStack(sourceStackId, sourceCardId, targetStackId, 0);

    const state = manager.getDeckState();
    // Source stack should be gone (single-card stack closed when its card moved).
    expect(state.stacks.find((s) => s.id === sourceStackId)).toBeUndefined();
    // Target stack should carry the merged card.
    const targetStack = state.stacks.find((s) => s.id === targetStackId)!;
    expect(targetStack.cardIds.includes(sourceCardId)).toBe(true);
  });

  it("T11: sets merged card as activeCardId on target", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), card1Id).id;
    manager.addCardToStack(sourceStackId, "terminal");

    const targetCardId = manager.addCard("hello") as string;
    const targetStackId = hostStack(manager.getDeckState(), targetCardId).id;

    manager.moveCardToStack(sourceStackId, card1Id, targetStackId, 0);

    const targetStack = manager.getDeckState().stacks.find((s) => s.id === targetStackId)!;
    expect(targetStack.activeCardId).toBe(card1Id);
  });

  it("T12: clamps insertAtIndex to target cardIds length", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const sourceStackId = hostStack(manager.getDeckState(), card1Id).id;
    manager.addCardToStack(sourceStackId, "terminal");

    const targetCardId = manager.addCard("hello") as string;
    const targetStackId = hostStack(manager.getDeckState(), targetCardId).id;

    // target has 1 card; insertAtIndex of 999 should be clamped to 1
    manager.moveCardToStack(sourceStackId, card1Id, targetStackId, 999);

    const targetStack = manager.getDeckState().stacks.find((s) => s.id === targetStackId)!;
    // Merged card should appear at end
    expect(targetStack.cardIds[targetStack.cardIds.length - 1]).toBe(card1Id);
  });

  it("T13: no-op when sourceStackId === targetStackId", () => {
    registerCard(makeRegistration("hello", "Hello"));
    registerCard(makeRegistration("terminal", "Terminal"));

    const card1Id = manager.addCard("hello") as string;
    const stackId = hostStack(manager.getDeckState(), card1Id).id;
    manager.addCardToStack(stackId, "terminal");

    const cardsBefore = [...hostStack(manager.getDeckState(), card1Id).cardIds];
    const versionBefore = manager.getVersion();

    manager.moveCardToStack(stackId, card1Id, stackId, 0);

    expect(manager.getVersion()).toBe(versionBefore);
    const cardsAfter = [...hostStack(manager.getDeckState(), card1Id).cardIds];
    expect(cardsAfter).toEqual(cardsBefore);
  });

  it("fires deactivation + target activation on the merged card when an active single-card source is merged", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const srcCardId = manager.addCard("hello") as string;
    const srcStackId = hostStack(manager.getDeckState(), srcCardId).id;
    const tgtCardId = manager.addCard("terminal") as string;
    const tgtStackId = hostStack(manager.getDeckState(), tgtCardId).id;
    // tgt is top-of-stack (active). Manually activate src so src is active.
    manager.activateCard(srcCardId);

    // Card identity is preserved across merge — the card moves from source
    // to target, so no `cardWillBeginDestruction` fires for this path. The
    // source *stack* is removed as a side effect of emptying, but a stack
    // vanishing is not a card-lifecycle event. The test asserts absence of
    // that spurious destruction signal.
    const log: string[] = [];
    manager.cardLifecycle.observeCardWillDeactivate(null, (id) =>
      log.push(`willDeact:${id}`),
    );
    manager.cardLifecycle.observeCardDidDeactivate(null, (id) =>
      log.push(`didDeact:${id}`),
    );
    manager.cardLifecycle.observeCardWillBeginDestruction(null, (id) =>
      log.push(`willDestroy:${id}`),
    );
    manager.cardLifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willAct:${id}`),
    );
    manager.cardLifecycle.observeCardDidActivate(null, (id) =>
      log.push(`didAct:${id}`),
    );
    log.length = 0; // clear initial-sync

    manager.moveCardToStack(srcStackId, srcCardId, tgtStackId, 0);

    expect(log).toEqual([
      `willDeact:${srcCardId}`,
      `didDeact:${srcCardId}`,
      `willAct:${srcCardId}`,
      `didAct:${srcCardId}`,
    ]);
    // No spurious destruction event in the log.
    expect(log.some((entry) => entry.startsWith("willDestroy:"))).toBe(false);
    // Source stack is gone, target survives.
    expect(manager.getDeckState().stacks.find((s) => s.id === srcStackId)).toBeUndefined();
    expect(manager.getDeckState().stacks.find((s) => s.id === tgtStackId)).toBeDefined();
  });

  it("fires no card-lifecycle events when a non-active single-card source is merged", () => {
    registerCard(makeRegistration("hello"));
    registerCard(makeRegistration("terminal"));
    const srcCardId = manager.addCard("hello") as string;
    const srcStackId = hostStack(manager.getDeckState(), srcCardId).id;
    const tgtCardId = manager.addCard("terminal") as string;
    const tgtStackId = hostStack(manager.getDeckState(), tgtCardId).id;
    // tgt is active (top-of-stack), src is single-card but not active.

    const log: string[] = [];
    manager.cardLifecycle.observeCardWillDeactivate(null, (id) =>
      log.push(`willDeact:${id}`),
    );
    manager.cardLifecycle.observeCardDidDeactivate(null, (id) =>
      log.push(`didDeact:${id}`),
    );
    manager.cardLifecycle.observeCardWillBeginDestruction(null, (id) =>
      log.push(`willDestroy:${id}`),
    );
    manager.cardLifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willAct:${id}`),
    );
    manager.cardLifecycle.observeCardDidActivate(null, (id) =>
      log.push(`didAct:${id}`),
    );
    log.length = 0;

    manager.moveCardToStack(srcStackId, srcCardId, tgtStackId, 0);

    // Card identity preserved (no destruction); source's sole card was not
    // active (no deactivation); tgt stays active with its own activeCardId
    // replaced by the merged card, but the lifecycle's active-card pointer
    // is still tgtCardId's sibling — the merge does not re-fire activation
    // events for the moved card because it was not the first responder
    // before or after.
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 5f: Tab state cache (Spec S03, Step 3)
// ---------------------------------------------------------------------------

describe("DeckManager tab state cache (Phase 5f Step 3)", () => {
  it("getTabState returns undefined for unknown tab ID", () => {
    expect(manager.getCardState("unknown-tab-id")).toBeUndefined();
  });

  it("setTabState followed by getTabState returns the saved bag", () => {
    const bag = { scroll: { x: 10, y: 50 }, content: { key: "value" } };
    manager.setCardState("tab-abc", bag);
    const retrieved = manager.getCardState("tab-abc");
    expect(retrieved).toBeDefined();
    expect(retrieved?.scroll?.x).toBe(10);
    expect(retrieved?.scroll?.y).toBe(50);
    expect((retrieved?.content as Record<string, string>).key).toBe("value");
  });

  it("setTabState overwrites an existing entry", () => {
    manager.setCardState("tab-xyz", { scroll: { x: 0, y: 0 } });
    manager.setCardState("tab-xyz", { scroll: { x: 99, y: 77 } });
    const retrieved = manager.getCardState("tab-xyz");
    expect(retrieved?.scroll?.x).toBe(99);
    expect(retrieved?.scroll?.y).toBe(77);
  });

  it("getTabState with different tab IDs returns independent entries", () => {
    manager.setCardState("tab-1", { scroll: { x: 1, y: 1 } });
    manager.setCardState("tab-2", { scroll: { x: 2, y: 2 } });
    expect(manager.getCardState("tab-1")?.scroll?.x).toBe(1);
    expect(manager.getCardState("tab-2")?.scroll?.x).toBe(2);
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
      expect(mgr2.getCardState("tab-init-1")?.scroll?.x).toBe(5);
      expect(mgr2.getCardState("tab-init-2")?.content).toBe("saved");
      expect(mgr2.getCardState("tab-init-3")).toBeUndefined();
    } finally {
      mgr2.destroy();
      c2.remove();
    }
  });

  it("loadLayout fires cardDidFinishConstruction for every loaded card (H-A5)", () => {
    registerCard(makeRegistration("hello"));

    // Build a layout with two cards by running addCard on a throwaway
    // manager and serializing its state into the wire format.
    const c1 = makeContainer();
    const conn1 = makeMockConnection();
    const primer = new DeckManager(c1, conn1);
    primer.addCard("hello");
    primer.addCard("hello");
    const layout = serialize(primer.getDeckState());
    primer.destroy();
    c1.remove();

    // Fresh manager loads the serialized layout. Subscribe via the
    // wildcard initial-sync: every card in `constructedCards` should
    // trigger the callback exactly once.
    const c2 = makeContainer();
    const conn2 = makeMockConnection();
    const mgr2 = new DeckManager(c2, conn2, layout);
    try {
      const constructed: string[] = [];
      mgr2.cardLifecycle.observeCardDidFinishConstruction(null, (id) =>
        constructed.push(id),
      );
      expect(constructed.length).toBe(2);
      const loadedIds = mgr2.getDeckState().cards.map((c) => c.id).sort();
      expect(constructed.sort()).toEqual(loadedIds);
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
    manager.focusCard(card1Id);
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
    manager.focusCard(card2Id);
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
    manager.setCardState("tab-x", { scroll: { x: 1, y: 2 } });

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
    manager.setCardState("tab-z", { scroll: { x: 5, y: 10 } });

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

