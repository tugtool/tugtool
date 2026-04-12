import { describe, test, expect } from "bun:test";
import {
  type DeckState,
  type CardState,
  type TabItem,
  type TabStateBag,
} from "../layout-tree";
import { serialize, deserialize, buildDefaultLayout } from "../serialization";

// ---- DeckState / CardState type tests ----

describe("DeckState", () => {
  test("DeckState with empty cards array is valid", () => {
    const state: DeckState = { cards: [] };
    expect(state.cards).toBeDefined();
    expect(Array.isArray(state.cards)).toBe(true);
    expect(state.cards.length).toBe(0);
  });
});

describe("CardState", () => {
  test("CardState with single tab constructs correctly", () => {
    const tab: TabItem = {
      id: "tab-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const card: CardState = {
      id: "card-1",
      position: { x: 0, y: 0 },
      size: { width: 800, height: 600 },
      tabs: [tab],
      activeTabId: "tab-1",
      title: "",
      acceptsFamilies: ["standard"],
    };

    expect(card.id).toBe("card-1");
    expect(card.position.x).toBe(0);
    expect(card.position.y).toBe(0);
    expect(card.size.width).toBe(800);
    expect(card.size.height).toBe(600);
    expect(card.tabs.length).toBe(1);
    expect(card.tabs[0].componentId).toBe("terminal");
    expect(card.activeTabId).toBe("tab-1");
  });

  test("CardState with multiple same-type tabs constructs correctly", () => {
    const tab1: TabItem = {
      id: "tab-a",
      componentId: "terminal",
      title: "Terminal 1",
      closable: true,
    };
    const tab2: TabItem = {
      id: "tab-b",
      componentId: "terminal",
      title: "Terminal 2",
      closable: true,
    };
    const tab3: TabItem = {
      id: "tab-c",
      componentId: "terminal",
      title: "Terminal 3",
      closable: false,
    };
    const card: CardState = {
      id: "card-2",
      position: { x: 100, y: 200 },
      size: { width: 400, height: 300 },
      tabs: [tab1, tab2, tab3],
      activeTabId: "tab-b",
      title: "",
      acceptsFamilies: ["standard"],
    };

    expect(card.tabs.length).toBe(3);
    expect(card.tabs[0].id).toBe("tab-a");
    expect(card.tabs[1].id).toBe("tab-b");
    expect(card.tabs[2].id).toBe("tab-c");
    expect(card.tabs[2].closable).toBe(false);
    expect(card.activeTabId).toBe("tab-b");
    // All tabs have the same componentId
    card.tabs.forEach((tab) => {
      expect(tab.componentId).toBe("terminal");
    });
  });
});

// ---- buildDefaultLayout tests ----

describe("buildDefaultLayout", () => {
  test("buildDefaultLayout(1200, 800) returns empty DeckState (Phase 5: no pre-registered cards)", () => {
    // T28: Phase 5 buildDefaultLayout returns { cards: [] }.
    // The old five-card default used componentIds that are not registered in Phase 5.
    const result = buildDefaultLayout(1200, 800);
    expect(result.cards.length).toBe(0);
  });

  test("buildDefaultLayout cards have non-overlapping bounding boxes (trivially true for empty layout)", () => {
    // With an empty cards array there are no cards to overlap.
    const result = buildDefaultLayout(1200, 800);
    const cards = result.cards;
    // Empty array: no pair (i,j) with i < j exists, so the loop is vacuously true.
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i];
        const b = cards[j];
        const noOverlap =
          a.position.x + a.size.width <= b.position.x ||
          b.position.x + b.size.width <= a.position.x ||
          a.position.y + a.size.height <= b.position.y ||
          b.position.y + b.size.height <= a.position.y;
        expect(noOverlap).toBe(true);
      }
    }
    expect(cards.length).toBe(0);
  });
});

// ---- serialize / deserialize tests ----

describe("serialize and deserialize", () => {
  test("serialize -> deserialize round-trip preserves all card data (single tab)", () => {
    const tab: TabItem = {
      id: "tab-known-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const card: CardState = {
      id: "card-known-1",
      position: { x: 100, y: 200 },
      size: { width: 400, height: 300 },
      tabs: [tab],
      activeTabId: "tab-known-1",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const canvasState: DeckState = { cards: [card] };

    const serialized = serialize(canvasState);
    const json = JSON.stringify(serialized);
    const restored = deserialize(json, 1920, 1080);

    expect(restored.cards.length).toBe(1);
    const restoredCard = restored.cards[0];
    expect(restoredCard.id).toBe("card-known-1");
    expect(restoredCard.position.x).toBe(100);
    expect(restoredCard.position.y).toBe(200);
    expect(restoredCard.size.width).toBe(400);
    expect(restoredCard.size.height).toBe(300);
    expect(restoredCard.tabs.length).toBe(1);
    expect(restoredCard.tabs[0].id).toBe("tab-known-1");
    expect(restoredCard.tabs[0].componentId).toBe("terminal");
    expect(restoredCard.activeTabId).toBe("tab-known-1");
  });

  test("serialize -> deserialize round-trip preserves multi-tab CardState (Step 8)", () => {
    // Verify that a card with multiple tabs survives a full serialize/deserialize
    // cycle with all tabs, all tab metadata, and activeTabId intact.
    const tab1: TabItem = { id: "tab-mt-1", componentId: "hello", title: "Hello", closable: true };
    const tab2: TabItem = { id: "tab-mt-2", componentId: "hello", title: "Hello 2", closable: true };
    const tab3: TabItem = { id: "tab-mt-3", componentId: "hello", title: "Hello 3", closable: false };
    const card: CardState = {
      id: "card-mt",
      position: { x: 50, y: 80 },
      size: { width: 500, height: 400 },
      tabs: [tab1, tab2, tab3],
      activeTabId: "tab-mt-2",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const canvasState: DeckState = { cards: [card] };

    const json = JSON.stringify(serialize(canvasState));
    const restored = deserialize(json, 1920, 1080);

    expect(restored.cards.length).toBe(1);
    const r = restored.cards[0];
    expect(r.id).toBe("card-mt");
    expect(r.tabs.length).toBe(3);
    expect(r.tabs[0]).toEqual(tab1);
    expect(r.tabs[1]).toEqual(tab2);
    expect(r.tabs[2]).toEqual(tab3);
    // activeTabId points to the second tab, not tabs[0]
    expect(r.activeTabId).toBe("tab-mt-2");
  });

  test("deserialize falls back activeTabId to tabs[0] when activeTabId is missing", () => {
    // If stored JSON has no activeTabId field, deserialize uses tabs[0].id.
    const v5 = {
      version: 5,
      cards: [
        {
          id: "card-no-active",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [
            { id: "tab-a", componentId: "hello", title: "Hello", closable: true },
            { id: "tab-b", componentId: "hello", title: "Hello 2", closable: true },
          ],
          // activeTabId intentionally omitted
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v5), 1920, 1080);
    expect(restored.cards.length).toBe(1);
    expect(restored.cards[0].activeTabId).toBe("tab-a");
  });

  test("deserialize falls back activeTabId to tabs[0] when activeTabId references a non-existent tab", () => {
    // If stored activeTabId doesn't match any tab id, deserialize falls back to tabs[0].
    const v5 = {
      version: 5,
      cards: [
        {
          id: "card-bad-active",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [
            { id: "tab-1", componentId: "hello", title: "Hello", closable: true },
            { id: "tab-2", componentId: "hello", title: "Hello 2", closable: true },
          ],
          activeTabId: "tab-does-not-exist",
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v5), 1920, 1080);
    expect(restored.cards.length).toBe(1);
    expect(restored.cards[0].activeTabId).toBe("tab-1");
  });

  test("serialize -> deserialize round-trip with two multi-tab cards preserves both (Step 8)", () => {
    // Two cards each with two tabs; verify both are restored correctly.
    const cardA: CardState = {
      id: "card-a",
      position: { x: 10, y: 20 },
      size: { width: 400, height: 300 },
      tabs: [
        { id: "a-tab-1", componentId: "hello", title: "Hello", closable: true },
        { id: "a-tab-2", componentId: "hello", title: "Hello 2", closable: true },
      ],
      activeTabId: "a-tab-2",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const cardB: CardState = {
      id: "card-b",
      position: { x: 200, y: 100 },
      size: { width: 450, height: 320 },
      tabs: [
        { id: "b-tab-1", componentId: "hello", title: "Tab 1", closable: true },
        { id: "b-tab-2", componentId: "hello", title: "Tab 2", closable: false },
        { id: "b-tab-3", componentId: "hello", title: "Tab 3", closable: true },
      ],
      activeTabId: "b-tab-3",
      title: "",
      acceptsFamilies: ["standard"],
    };

    const json = JSON.stringify(serialize({ cards: [cardA, cardB] }));
    const restored = deserialize(json, 1920, 1080);

    expect(restored.cards.length).toBe(2);

    const ra = restored.cards[0];
    expect(ra.id).toBe("card-a");
    expect(ra.tabs.length).toBe(2);
    expect(ra.activeTabId).toBe("a-tab-2");
    expect(ra.tabs[1].closable).toBe(true);

    const rb = restored.cards[1];
    expect(rb.id).toBe("card-b");
    expect(rb.tabs.length).toBe(3);
    expect(rb.activeTabId).toBe("b-tab-3");
    expect(rb.tabs[1].closable).toBe(false);
  });

  test("deserialize with version:3 data falls back to buildDefaultLayout", () => {
    // T29: buildDefaultLayout now returns { cards: [] } in Phase 5.
    const json = JSON.stringify({ version: 3, root: {}, floating: [] });
    const result = deserialize(json, 1200, 800);
    expect(result.cards.length).toBe(0);
  });

  test("deserialize with corrupt JSON falls back to buildDefaultLayout", () => {
    // T29: buildDefaultLayout now returns { cards: [] } in Phase 5.
    const result = deserialize("not-valid-json{{{", 1200, 800);
    expect(result.cards.length).toBe(0);
  });

  test("deserialize clamps card positions to canvas bounds", () => {
    const tab: TabItem = {
      id: "tab-clamp-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const v5 = {
      version: 5,
      cards: [
        {
          id: "card-clamp-1",
          position: { x: 1800, y: 900 },
          size: { width: 400, height: 300 },
          tabs: [tab],
          activeTabId: "tab-clamp-1",
        },
      ],
    };
    const result = deserialize(JSON.stringify(v5), 1920, 1080);
    expect(result.cards.length).toBe(1);
    // x + width(400) = 1800 + 400 = 2200 > 1920 -> x = 1920 - 400 = 1520
    expect(result.cards[0].position.x).toBe(1520);
    // y + height(300) = 900 + 300 = 1200 > 1080 -> y = 1080 - 300 = 780
    expect(result.cards[0].position.y).toBe(780);
  });

  test("deserialize enforces 100px minimum sizes", () => {
    const tab: TabItem = {
      id: "tab-small-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const v5 = {
      version: 5,
      cards: [
        {
          id: "card-small-1",
          position: { x: 0, y: 0 },
          size: { width: 50, height: 30 },
          tabs: [tab],
          activeTabId: "tab-small-1",
        },
      ],
    };
    const result = deserialize(JSON.stringify(v5), 1920, 1080);
    expect(result.cards.length).toBe(1);
    expect(result.cards[0].size.width).toBe(100);
    expect(result.cards[0].size.height).toBe(100);
  });

});

// ---- Card management data-layer tests (D01, D06) ----

/** Build a minimal CardState with a single tab. */
function makeCard(componentId: string): CardState {
  const tabId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    tabs: [{ id: tabId, componentId, title: componentId, closable: true }],
    activeTabId: tabId,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

describe("focusCard data model (D06)", () => {
  test("moving a card to end of array changes z-order", () => {
    const p0 = makeCard("terminal");
    const p1 = makeCard("git");
    const p2 = makeCard("files");
    const canvasState: DeckState = { cards: [p0, p1, p2] };

    // Simulate focusCard(p0.id): splice and push
    const idx = canvasState.cards.findIndex((p) => p.id === p0.id);
    const [focused] = canvasState.cards.splice(idx, 1);
    canvasState.cards.push(focused);

    // p0 should now be last (highest z-order)
    expect(canvasState.cards[canvasState.cards.length - 1].id).toBe(p0.id);
    // p1 and p2 shift left
    expect(canvasState.cards[0].id).toBe(p1.id);
    expect(canvasState.cards[1].id).toBe(p2.id);
  });

  test("focusing already-last card does not reorder", () => {
    const p0 = makeCard("terminal");
    const p1 = makeCard("git");
    const canvasState: DeckState = { cards: [p0, p1] };

    // p1 is already last — focusCard would early-return
    const idx = canvasState.cards.findIndex((p) => p.id === p1.id);
    const isAlreadyLast = idx === canvasState.cards.length - 1;
    expect(isAlreadyLast).toBe(true);

    // Array unchanged
    expect(canvasState.cards[0].id).toBe(p0.id);
    expect(canvasState.cards[1].id).toBe(p1.id);
  });
});

describe("addNewCard data model (D01)", () => {
  test("pushing a new CardState adds it at canvas center", () => {
    const canvasState: DeckState = { cards: [] };
    const canvasW = 800;
    const canvasH = 600;
    const CARD_W = 400;
    const CARD_H = 300;

    const tabId = crypto.randomUUID();
    const newCard: CardState = {
      id: crypto.randomUUID(),
      position: {
        x: Math.max(0, (canvasW - CARD_W) / 2),
        y: Math.max(0, (canvasH - CARD_H) / 2),
      },
      size: { width: CARD_W, height: CARD_H },
      tabs: [{ id: tabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: tabId,
      title: "",
      acceptsFamilies: ["standard"],
    };

    canvasState.cards.push(newCard);

    expect(canvasState.cards.length).toBe(1);
    expect(canvasState.cards[0].position.x).toBe(200); // (800-400)/2
    expect(canvasState.cards[0].position.y).toBe(150); // (600-300)/2
    expect(canvasState.cards[0].tabs[0].componentId).toBe("terminal");
  });
});

describe("removeCard data model (D01)", () => {
  test("splicing a card from the array removes it", () => {
    const p0 = makeCard("terminal");
    const p1 = makeCard("git");
    const canvasState: DeckState = { cards: [p0, p1] };

    // Simulate removeCard: filter out the card whose tab matches
    const tabIdToRemove = p0.tabs[0].id;
    canvasState.cards = canvasState.cards
      .map((card) => {
        const newTabs = card.tabs.filter((t) => t.id !== tabIdToRemove);
        if (newTabs.length === card.tabs.length) return card;
        const newActiveTabId = newTabs.find((t) => t.id === card.activeTabId)
          ? card.activeTabId
          : (newTabs[0]?.id ?? "");
        return { ...card, tabs: newTabs, activeTabId: newActiveTabId };
      })
      .filter((card) => card.tabs.length > 0);

    expect(canvasState.cards.length).toBe(1);
    expect(canvasState.cards[0].id).toBe(p1.id);
  });

  test("removing a tab from a multi-tab card leaves card intact", () => {
    const tab1: TabItem = { id: "t1", componentId: "terminal", title: "T1", closable: true };
    const tab2: TabItem = { id: "t2", componentId: "terminal", title: "T2", closable: true };
    const card: CardState = {
      id: "p1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [tab1, tab2],
      activeTabId: "t1",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const canvasState: DeckState = { cards: [card] };

    // Remove tab1
    canvasState.cards = canvasState.cards
      .map((p) => {
        const newTabs = p.tabs.filter((t) => t.id !== "t1");
        if (newTabs.length === p.tabs.length) return p;
        const newActiveTabId = newTabs.find((t) => t.id === p.activeTabId)
          ? p.activeTabId
          : (newTabs[0]?.id ?? "");
        return { ...p, tabs: newTabs, activeTabId: newActiveTabId };
      })
      .filter((p) => p.tabs.length > 0);

    // Card still exists with tab2
    expect(canvasState.cards.length).toBe(1);
    expect(canvasState.cards[0].tabs.length).toBe(1);
    expect(canvasState.cards[0].tabs[0].id).toBe("t2");
    // activeTabId falls back to tab2
    expect(canvasState.cards[0].activeTabId).toBe("t2");
  });
});

describe("addNewTab data model (D01)", () => {
  test("adding a tab to existing card pushes to tabs array", () => {
    const existingTabId = "t-existing";
    const card: CardState = {
      id: "p1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: existingTabId, componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: existingTabId,
      title: "",
      acceptsFamilies: ["standard"],
    };

    const newTabId = crypto.randomUUID();
    const newTab: TabItem = { id: newTabId, componentId: "terminal", title: "Terminal 2", closable: true };
    card.tabs.push(newTab);
    card.activeTabId = newTabId;

    expect(card.tabs.length).toBe(2);
    expect(card.activeTabId).toBe(newTabId);
    expect(card.tabs[1].componentId).toBe("terminal");
  });

  test("same-componentId constraint: tabs must share componentId", () => {
    const card: CardState = {
      id: "p1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: "t1", componentId: "terminal", title: "Terminal", closable: true }],
      activeTabId: "t1",
      title: "",
      acceptsFamilies: ["standard"],
    };

    // Verify same-componentId check logic
    const existingComponentId = card.tabs[0]?.componentId;
    const canAddGit = existingComponentId === "git";
    const canAddTerminal = existingComponentId === "terminal";

    expect(canAddGit).toBe(false);
    expect(canAddTerminal).toBe(true);
  });
});

// ---- Phase 5f: collapsed field serialization tests ([D04]) ----

describe("CardState collapsed field (Phase 5f, Step 1)", () => {
  test("deserialize of v5 JSON with collapsed:true produces CardState with collapsed === true", () => {
    const v5 = {
      version: 5,
      cards: [
        {
          id: "card-collapsed-1",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [{ id: "tab-c1", componentId: "hello", title: "Hello", closable: true }],
          activeTabId: "tab-c1",
          title: "",
          acceptsFamilies: ["standard"],
          collapsed: true,
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v5), 1920, 1080);
    expect(restored.cards.length).toBe(1);
    expect(restored.cards[0].collapsed).toBe(true);
  });

  test("deserialize of v5 JSON without collapsed produces CardState with collapsed === undefined", () => {
    const v5 = {
      version: 5,
      cards: [
        {
          id: "card-no-collapsed",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [{ id: "tab-nc", componentId: "hello", title: "Hello", closable: true }],
          activeTabId: "tab-nc",
          title: "",
          acceptsFamilies: ["standard"],
          // collapsed intentionally omitted
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v5), 1920, 1080);
    expect(restored.cards.length).toBe(1);
    expect(restored.cards[0].collapsed).toBeUndefined();
  });

  test("serialize of DeckState with collapsed:true card includes collapsed field in output", () => {
    const card: CardState = {
      id: "card-ser-collapsed",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: "tab-sc", componentId: "hello", title: "Hello", closable: true }],
      activeTabId: "tab-sc",
      title: "",
      acceptsFamilies: ["standard"],
      collapsed: true,
    };
    const state: DeckState = { cards: [card] };
    const serialized = serialize(state) as { version: number; cards: CardState[] };
    expect(serialized.cards.length).toBe(1);
    expect(serialized.cards[0].collapsed).toBe(true);
  });

  test("serialize -> deserialize round-trip preserves collapsed:true", () => {
    const card: CardState = {
      id: "card-rt-collapsed",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      tabs: [{ id: "tab-rtc", componentId: "hello", title: "Hello", closable: true }],
      activeTabId: "tab-rtc",
      title: "",
      acceptsFamilies: ["standard"],
      collapsed: true,
    };
    const json = JSON.stringify(serialize({ cards: [card] }));
    const restored = deserialize(json, 1920, 1080);
    expect(restored.cards[0].collapsed).toBe(true);
  });
});

// ---- Phase 5f: TabStateBag type tests ([D01]) ----

describe("TabStateBag type (Phase 5f, Step 1)", () => {
  test("TabStateBag with only scroll field is valid", () => {
    const bag: TabStateBag = { scroll: { x: 100, y: 250 } };
    expect(bag.scroll?.x).toBe(100);
    expect(bag.scroll?.y).toBe(250);
    expect(bag.selection).toBeUndefined();
    expect(bag.content).toBeUndefined();
  });

  test("TabStateBag with all fields is valid", () => {
    const bag: TabStateBag = {
      scroll: { x: 0, y: 50 },
      selection: null,
      content: { someKey: "someValue" },
    };
    expect(bag.scroll?.y).toBe(50);
    expect(bag.selection).toBeNull();
    expect((bag.content as Record<string, string>)["someKey"]).toBe("someValue");
  });

  test("empty TabStateBag is valid", () => {
    const bag: TabStateBag = {};
    expect(bag.scroll).toBeUndefined();
    expect(bag.selection).toBeUndefined();
    expect(bag.content).toBeUndefined();
  });
});

// ---- Phase 5f: DeckState focusedCardId field tests ([D03]) ----

describe("DeckState focusedCardId field (Phase 5f, Step 1)", () => {
  test("DeckState accepts optional focusedCardId", () => {
    const state: DeckState = { cards: [], focusedCardId: "card-abc" };
    expect(state.focusedCardId).toBe("card-abc");
  });

  test("DeckState without focusedCardId has undefined field", () => {
    const state: DeckState = { cards: [] };
    expect(state.focusedCardId).toBeUndefined();
  });
});
