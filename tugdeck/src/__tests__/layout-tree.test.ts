import { describe, test, expect } from "bun:test";
import {
  type DeckState,
  type CardState,
  type TugWindowState,
  type CardStateBag,
  validateDeckState,
  DeckStateInvariantError,
} from "../layout-tree";
import { serialize, deserialize, buildDefaultLayout } from "../serialization";

// ---- DeckState / CardState / TugWindowState type tests ----

describe("DeckState", () => {
  test("DeckState with empty cards and windows is valid", () => {
    const state: DeckState = { cards: [], windows: [] };
    expect(state.cards.length).toBe(0);
    expect(state.windows.length).toBe(0);
  });
});

describe("CardState (two-table model)", () => {
  test("CardState holds id, componentId, title, closable", () => {
    const card: CardState = {
      id: "card-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    expect(card.id).toBe("card-1");
    expect(card.componentId).toBe("terminal");
    expect(card.title).toBe("Terminal");
    expect(card.closable).toBe(true);
  });

  test("CardState accepts optional state bag", () => {
    const card: CardState = {
      id: "card-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
      state: { scroll: { x: 10, y: 20 } },
    };
    expect(card.state?.scroll?.x).toBe(10);
  });
});

describe("TugWindowState (two-table model)", () => {
  test("TugWindowState with single cardId constructs correctly", () => {
    const stack: TugWindowState = {
      id: "stack-1",
      position: { x: 0, y: 0 },
      size: { width: 800, height: 600 },
      cardIds: ["card-1"],
      activeCardId: "card-1",
      title: "",
      acceptsFamilies: ["standard"],
    };
    expect(stack.position.x).toBe(0);
    expect(stack.size.width).toBe(800);
    expect(stack.cardIds).toEqual(["card-1"]);
    expect(stack.activeCardId).toBe("card-1");
  });

  test("TugWindowState with multiple cardIds constructs correctly", () => {
    const stack: TugWindowState = {
      id: "stack-2",
      position: { x: 100, y: 200 },
      size: { width: 400, height: 300 },
      cardIds: ["card-a", "card-b", "card-c"],
      activeCardId: "card-b",
      title: "",
      acceptsFamilies: ["standard"],
    };
    expect(stack.cardIds.length).toBe(3);
    expect(stack.activeCardId).toBe("card-b");
  });
});

// ---- buildDefaultLayout tests ----

describe("buildDefaultLayout", () => {
  test("buildDefaultLayout returns empty DeckState (Phase 5: no pre-registered cards)", () => {
    const result = buildDefaultLayout();
    expect(result.cards.length).toBe(0);
    expect(result.windows.length).toBe(0);
  });
});

// ---- serialize / deserialize tests (v3 wire format) ----

describe("serialize and deserialize (v3)", () => {
  test("round-trip preserves a single-card stack", () => {
    const card: CardState = {
      id: "card-known-1",
      componentId: "terminal",
      title: "Terminal",
      closable: true,
    };
    const stack: TugWindowState = {
      id: "stack-known-1",
      position: { x: 100, y: 200 },
      size: { width: 400, height: 300 },
      cardIds: ["card-known-1"],
      activeCardId: "card-known-1",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const state: DeckState = { cards: [card], windows: [stack] };

    const serialized = serialize(state);
    const json = JSON.stringify(serialized);
    const restored = deserialize(json, 1920, 1080);

    expect(restored.cards.length).toBe(1);
    expect(restored.windows.length).toBe(1);
    const rCard = restored.cards[0];
    expect(rCard.id).toBe("card-known-1");
    expect(rCard.componentId).toBe("terminal");
    const rStack = restored.windows[0];
    expect(rStack.id).toBe("stack-known-1");
    expect(rStack.position.x).toBe(100);
    expect(rStack.cardIds).toEqual(["card-known-1"]);
    expect(rStack.activeCardId).toBe("card-known-1");
  });

  test("round-trip preserves a multi-card stack", () => {
    const cards: CardState[] = [
      { id: "card-mt-1", componentId: "hello", title: "Hello", closable: true },
      { id: "card-mt-2", componentId: "hello", title: "Hello 2", closable: true },
      { id: "card-mt-3", componentId: "hello", title: "Hello 3", closable: false },
    ];
    const stack: TugWindowState = {
      id: "stack-mt",
      position: { x: 50, y: 80 },
      size: { width: 500, height: 400 },
      cardIds: ["card-mt-1", "card-mt-2", "card-mt-3"],
      activeCardId: "card-mt-2",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const state: DeckState = { cards, windows: [stack] };

    const json = JSON.stringify(serialize(state));
    const restored = deserialize(json, 1920, 1080);

    expect(restored.windows.length).toBe(1);
    const r = restored.windows[0];
    expect(r.cardIds.length).toBe(3);
    expect(r.activeCardId).toBe("card-mt-2");
    expect(restored.cards.find((c) => c.id === "card-mt-3")?.closable).toBe(false);
  });

  test("serialize emits version: 3", () => {
    const out = serialize({ cards: [], windows: [] }) as { version: number };
    expect(out.version).toBe(3);
  });

  test("v3 round-trip: serialize → deserialize → serialize is stable", () => {
    const card: CardState = {
      id: "c1",
      componentId: "terminal",
      title: "T",
      closable: true,
    };
    const win: TugWindowState = {
      id: "w1",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cardIds: ["c1"],
      activeCardId: "c1",
      title: "",
      acceptsFamilies: ["standard"],
    };
    const state: DeckState = {
      cards: [card],
      windows: [win],
      activeWindowId: "w1",
    };
    const first = serialize(state);
    const restored = deserialize(JSON.stringify(first), 1920, 1080);
    const second = serialize(restored);
    expect(second).toEqual(first);
  });

  test("deserialize with corrupt JSON falls back to buildDefaultLayout", () => {
    const result = deserialize("not-valid-json{{{", 1200, 800);
    expect(result.cards.length).toBe(0);
    expect(result.windows.length).toBe(0);
  });
});

// ---- v2 wire → v3 (field rename migration on load) ----

describe("v2 → v3 migration", () => {
  test("hand-authored v2 blob deserializes to the same DeckState as equivalent v3 blob", () => {
    const v2 = {
      version: 2 as const,
      cards: [
        { id: "c1", componentId: "hello", title: "C1", closable: true },
        { id: "c2", componentId: "hello", title: "C2", closable: true },
      ],
      stacks: [
        {
          id: "s1",
          position: { x: 10, y: 20 },
          size: { width: 400, height: 300 },
          cardIds: ["c1", "c2"],
          activeCardId: "c1",
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
      activeStackId: "s1",
    };
    const v3 = {
      version: 3 as const,
      cards: v2.cards,
      windows: [
        {
          id: "s1",
          position: { x: 10, y: 20 },
          size: { width: 400, height: 300 },
          cardIds: ["c1", "c2"],
          activeCardId: "c1",
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
      activeWindowId: "s1",
    };
    expect(deserialize(JSON.stringify(v2), 1920, 1080)).toEqual(
      deserialize(JSON.stringify(v3), 1920, 1080),
    );
  });
});

// ---- Legacy single-table (v1) migration ----

describe("v1 → two-table migration", () => {
  test("legacy v5 single-card blob migrates to a single-card stack", () => {
    const v1Blob = {
      version: 5,
      cards: [
        {
          id: "legacy-card-1",
          position: { x: 100, y: 200 },
          size: { width: 400, height: 300 },
          tabs: [
            { id: "legacy-tab-1", componentId: "terminal", title: "T", closable: true },
          ],
          activeTabId: "legacy-tab-1",
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v1Blob), 1920, 1080);
    expect(restored.windows.length).toBe(1);
    expect(restored.cards.length).toBe(1);
    // Stack id preserved from legacy card id.
    expect(restored.windows[0].id).toBe("legacy-card-1");
    // Card id preserved from legacy tab id.
    expect(restored.cards[0].id).toBe("legacy-tab-1");
    expect(restored.windows[0].cardIds).toEqual(["legacy-tab-1"]);
    expect(restored.windows[0].activeCardId).toBe("legacy-tab-1");
  });

  test("legacy multi-tab card migrates to a multi-card stack preserving order", () => {
    const v1Blob = {
      version: 5,
      cards: [
        {
          id: "legacy-card",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [
            { id: "t1", componentId: "hello", title: "T1", closable: true },
            { id: "t2", componentId: "hello", title: "T2", closable: true },
            { id: "t3", componentId: "hello", title: "T3", closable: false },
          ],
          activeTabId: "t2",
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v1Blob), 1920, 1080);
    expect(restored.windows.length).toBe(1);
    expect(restored.cards.length).toBe(3);
    expect(restored.windows[0].cardIds).toEqual(["t1", "t2", "t3"]);
    expect(restored.windows[0].activeCardId).toBe("t2");
    expect(restored.cards.find((c) => c.id === "t3")?.closable).toBe(false);
  });

  test("v1 → two-table round-trip: hand-authored v1 loads, save emits version: 3", () => {
    const v1 = {
      version: 5,
      cards: [
        {
          id: "L1",
          position: { x: 20, y: 30 },
          size: { width: 400, height: 300 },
          tabs: [
            { id: "T1a", componentId: "hello", title: "A", closable: true },
            { id: "T1b", componentId: "hello", title: "B", closable: true },
          ],
          activeTabId: "T1b",
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
      focusedCardId: "T1b",
    };
    const loaded = deserialize(JSON.stringify(v1), 1920, 1080);
    expect(loaded.windows.length).toBe(1);
    // `focusedCardId` is persisted separately via putFocusedCardId — it
    // does not round-trip through the layout blob.
    expect((loaded as { focusedCardId?: string }).focusedCardId).toBeUndefined();
    const saved = serialize(loaded) as {
      version: number;
      focusedCardId?: string;
    };
    expect(saved.version).toBe(3);
    expect(saved.focusedCardId).toBeUndefined();
  });

  test("legacy blob without a `version` field still migrates", () => {
    const v1 = {
      cards: [
        {
          id: "noversion-card",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          tabs: [{ id: "nv-tab", componentId: "hello", title: "X", closable: true }],
          activeTabId: "nv-tab",
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v1), 1920, 1080);
    expect(restored.windows.length).toBe(1);
    expect(restored.cards[0].id).toBe("nv-tab");
  });
});

// ---- CardStateBag + focusedCardId / CollapsedState ----

describe("TugWindowState collapsed field", () => {
  test("serialize -> deserialize round-trip preserves collapsed:true", () => {
    const card: CardState = { id: "c", componentId: "hello", title: "H", closable: true };
    const stack: TugWindowState = {
      id: "s",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cardIds: ["c"],
      activeCardId: "c",
      title: "",
      acceptsFamilies: ["standard"],
      collapsed: true,
    };
    const json = JSON.stringify(serialize({ cards: [card], windows: [stack] }));
    const restored = deserialize(json, 1920, 1080);
    expect(restored.windows[0].collapsed).toBe(true);
  });
});

describe("CardStateBag type", () => {
  test("CardStateBag with only scroll field is valid", () => {
    const bag: CardStateBag = { scroll: { x: 100, y: 250 } };
    expect(bag.scroll?.x).toBe(100);
  });

  test("empty CardStateBag is valid", () => {
    const bag: CardStateBag = {};
    expect(bag.scroll).toBeUndefined();
  });
});

describe("DeckState focusedCardId persistence", () => {
  test("serialize does not emit focusedCardId in the layout blob", () => {
    const state: DeckState = { cards: [], windows: [] };
    const blob = serialize(state) as Record<string, unknown>;
    expect("focusedCardId" in blob).toBe(false);
  });

  test("parseV3 ignores focusedCardId if present in a v3 blob", () => {
    const withFocused = {
      version: 3,
      cards: [],
      windows: [],
      focusedCardId: "card-abc",
    };
    const restored = deserialize(JSON.stringify(withFocused), 1920, 1080);
    expect((restored as { focusedCardId?: string }).focusedCardId).toBeUndefined();
  });

  test("v2 migration path ignores focusedCardId (not part of DeckState)", () => {
    const withFocused = {
      version: 2,
      cards: [],
      stacks: [],
      focusedCardId: "card-abc",
    };
    const restored = deserialize(JSON.stringify(withFocused), 1920, 1080);
    expect((restored as { focusedCardId?: string }).focusedCardId).toBeUndefined();
  });
});

// ---- Additional coverage ported from the pre-Card/CardStack test suite ----

describe("deserialize edge cases", () => {
  test("falls back activeCardId to cardIds[0] when activeCardId is missing", () => {
    const v2 = {
      version: 2,
      cards: [
        { id: "a", componentId: "hello", title: "A", closable: true },
        { id: "b", componentId: "hello", title: "B", closable: true },
      ],
      stacks: [
        {
          id: "s1",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: ["a", "b"],
          // activeCardId intentionally omitted
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v2), 1920, 1080);
    expect(restored.windows[0].activeCardId).toBe("a");
  });

  test("falls back activeCardId when it references a non-existent card", () => {
    const v2 = {
      version: 2,
      cards: [
        { id: "a", componentId: "hello", title: "A", closable: true },
        { id: "b", componentId: "hello", title: "B", closable: true },
      ],
      stacks: [
        {
          id: "s1",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: ["a", "b"],
          activeCardId: "not-in-stack",
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v2), 1920, 1080);
    expect(restored.windows[0].activeCardId).toBe("a");
  });

  test("round-trip with two multi-card stacks preserves both", () => {
    const cards: CardState[] = [
      { id: "a1", componentId: "hello", title: "A1", closable: true },
      { id: "a2", componentId: "hello", title: "A2", closable: true },
      { id: "b1", componentId: "hello", title: "B1", closable: true },
      { id: "b2", componentId: "hello", title: "B2", closable: false },
      { id: "b3", componentId: "hello", title: "B3", closable: true },
    ];
    const windows: TugWindowState[] = [
      {
        id: "sa",
        position: { x: 10, y: 20 },
        size: { width: 400, height: 300 },
        cardIds: ["a1", "a2"],
        activeCardId: "a2",
        title: "",
        acceptsFamilies: ["standard"],
      },
      {
        id: "sb",
        position: { x: 200, y: 100 },
        size: { width: 450, height: 320 },
        cardIds: ["b1", "b2", "b3"],
        activeCardId: "b3",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ];
    const json = JSON.stringify(serialize({ cards, windows }));
    const restored = deserialize(json, 1920, 1080);
    expect(restored.windows.length).toBe(2);
    expect(restored.windows[0].activeCardId).toBe("a2");
    expect(restored.windows[1].activeCardId).toBe("b3");
    expect(restored.cards.find((c) => c.id === "b2")?.closable).toBe(false);
  });

  test("deserialize with version:3 data falls back to buildDefaultLayout", () => {
    const json = JSON.stringify({ version: 3, root: {}, floating: [] });
    const result = deserialize(json, 1200, 800);
    expect(result.cards.length).toBe(0);
    expect(result.windows.length).toBe(0);
  });

  test("deserialize clamps stack positions with Finder-style rules", () => {
    const v2 = {
      version: 2,
      cards: [{ id: "c1", componentId: "hello", title: "C", closable: true }],
      stacks: [
        {
          id: "s1",
          position: { x: 5000, y: 5000 },
          size: { width: 400, height: 300 },
          cardIds: ["c1"],
          activeCardId: "c1",
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v2), 1920, 1080);
    expect(restored.windows.length).toBe(1);
    expect(restored.windows[0].position.x).toBe(1920 - 100);
    expect(restored.windows[0].position.y).toBe(1080 - 36);
  });

  test("deserialize enforces 100px minimum sizes", () => {
    const v2 = {
      version: 2,
      cards: [{ id: "c1", componentId: "hello", title: "C", closable: true }],
      stacks: [
        {
          id: "s1",
          position: { x: 0, y: 0 },
          size: { width: 50, height: 30 },
          cardIds: ["c1"],
          activeCardId: "c1",
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v2), 1920, 1080);
    expect(restored.windows[0].size.width).toBe(100);
    expect(restored.windows[0].size.height).toBe(100);
  });
});

describe("collapsed field serialization", () => {
  test("deserialize of v2 JSON with collapsed:true produces collapsed === true", () => {
    const v2 = {
      version: 2,
      cards: [{ id: "c1", componentId: "hello", title: "C", closable: true }],
      stacks: [
        {
          id: "s1",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: ["c1"],
          activeCardId: "c1",
          collapsed: true,
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v2), 1920, 1080);
    expect(restored.windows[0].collapsed).toBe(true);
  });

  test("deserialize of v2 JSON without collapsed produces collapsed === undefined", () => {
    const v2 = {
      version: 2,
      cards: [{ id: "c1", componentId: "hello", title: "C", closable: true }],
      stacks: [
        {
          id: "s1",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: ["c1"],
          activeCardId: "c1",
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v2), 1920, 1080);
    expect(restored.windows[0].collapsed).toBeUndefined();
  });

  test("serialize of DeckState with collapsed:true stack includes collapsed field", () => {
    const card: CardState = { id: "c", componentId: "hello", title: "H", closable: true };
    const stack: TugWindowState = {
      id: "s",
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cardIds: ["c"],
      activeCardId: "c",
      title: "",
      acceptsFamilies: ["standard"],
      collapsed: true,
    };
    const serialized = serialize({ cards: [card], windows: [stack] }) as {
      windows: Array<{ collapsed?: boolean }>;
    };
    expect(serialized.windows[0].collapsed).toBe(true);
  });
});

describe("CardStateBag type — additional coverage", () => {
  test("CardStateBag with all fields is valid", () => {
    const bag: CardStateBag = {
      scroll: { x: 0, y: 50 },
      selection: null,
      content: { someKey: "someValue" },
    };
    expect(bag.scroll?.y).toBe(50);
    expect(bag.selection).toBeNull();
    expect((bag.content as Record<string, string>)["someKey"]).toBe("someValue");
  });
});

describe("Two-table invariants via the parser", () => {
  test("stacks with zero cardIds after filtering are dropped", () => {
    // If cardIds contains only ids that don't exist in `cards`, the stack
    // should be dropped entirely (no empty windows invariant).
    const v2 = {
      version: 2,
      cards: [{ id: "real", componentId: "hello", title: "R", closable: true }],
      stacks: [
        {
          id: "s1",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: ["real"],
          activeCardId: "real",
        },
        {
          id: "phantom",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: ["missing"],
          activeCardId: "missing",
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v2), 1920, 1080);
    expect(restored.windows.length).toBe(1);
    expect(restored.windows[0].id).toBe("s1");
  });

  test("orphan cards (not referenced by any stack) are dropped during deserialize", () => {
    // A card that no stack references should not be retained.
    const v2 = {
      version: 2,
      cards: [
        { id: "a", componentId: "hello", title: "A", closable: true },
        { id: "orphan", componentId: "hello", title: "Orphan", closable: true },
      ],
      stacks: [
        {
          id: "s1",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          cardIds: ["a"],
          activeCardId: "a",
        },
      ],
    };
    const restored = deserialize(JSON.stringify(v2), 1920, 1080);
    expect(restored.cards.length).toBe(1);
    expect(restored.cards[0].id).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// validateDeckState — invariant checker
// ---------------------------------------------------------------------------

describe("validateDeckState", () => {
  function makeCard(id: string, componentId = "hello"): CardState {
    return { id, componentId, title: id, closable: true };
  }

  function makeStack(
    id: string,
    cardIds: string[],
    activeCardId: string,
  ): TugWindowState {
    return {
      id,
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      cardIds,
      activeCardId,
      title: "",
      acceptsFamilies: ["standard"],
    };
  }

  test("accepts the empty deck", () => {
    expect(() => validateDeckState({ cards: [], windows: [] })).not.toThrow();
  });

  test("accepts a well-formed single-card, single-window deck", () => {
    const state: DeckState = {
      cards: [makeCard("c1")],
      windows: [makeStack("s1", ["c1"], "c1")],
    };
    expect(() => validateDeckState(state)).not.toThrow();
  });

  test("accepts a well-formed multi-card window with activeWindowId set", () => {
    const state: DeckState = {
      cards: [makeCard("c1"), makeCard("c2"), makeCard("c3")],
      windows: [
        makeStack("s1", ["c1", "c2"], "c2"),
        makeStack("s2", ["c3"], "c3"),
      ],
      activeWindowId: "s2",
    };
    expect(() => validateDeckState(state)).not.toThrow();
  });

  test("rejects a window referencing a missing card id (invariant 1)", () => {
    const state: DeckState = {
      cards: [makeCard("c1")],
      windows: [makeStack("s1", ["c1", "ghost"], "c1")],
    };
    expect(() => validateDeckState(state)).toThrow(DeckStateInvariantError);
    expect(() => validateDeckState(state)).toThrow(/missing card id "ghost"/);
  });

  test("rejects a card appearing in two windows (invariant 2: no duplicates)", () => {
    const state: DeckState = {
      cards: [makeCard("c1"), makeCard("c2")],
      windows: [
        makeStack("s1", ["c1", "c2"], "c1"),
        makeStack("s2", ["c2"], "c2"),
      ],
    };
    expect(() => validateDeckState(state)).toThrow(DeckStateInvariantError);
    expect(() => validateDeckState(state)).toThrow(/appears in both window/);
  });

  test("rejects an orphan card (invariant 2: every card has a host)", () => {
    const state: DeckState = {
      cards: [makeCard("c1"), makeCard("orphan")],
      windows: [makeStack("s1", ["c1"], "c1")],
    };
    expect(() => validateDeckState(state)).toThrow(DeckStateInvariantError);
    expect(() => validateDeckState(state)).toThrow(/"orphan" is orphaned/);
  });

  test("rejects an empty window (invariant 3)", () => {
    const state: DeckState = {
      cards: [makeCard("c1")],
      windows: [
        makeStack("s1", ["c1"], "c1"),
        makeStack("s-empty", [], "x"),
      ],
    };
    expect(() => validateDeckState(state)).toThrow(DeckStateInvariantError);
    expect(() => validateDeckState(state)).toThrow(/empty cardIds/);
  });

  test("rejects activeCardId that is not in cardIds (invariant 4)", () => {
    const state: DeckState = {
      cards: [makeCard("c1"), makeCard("c2")],
      windows: [makeStack("s1", ["c1", "c2"], "ghost")],
    };
    expect(() => validateDeckState(state)).toThrow(DeckStateInvariantError);
    expect(() => validateDeckState(state)).toThrow(
      /activeCardId "ghost" is not in cardIds/,
    );
  });

  test("rejects activeWindowId that references no real window (invariant 5)", () => {
    const state: DeckState = {
      cards: [makeCard("c1")],
      windows: [makeStack("s1", ["c1"], "c1")],
      activeWindowId: "no-such-stack",
    };
    expect(() => validateDeckState(state)).toThrow(DeckStateInvariantError);
    expect(() => validateDeckState(state)).toThrow(
      /activeWindowId "no-such-stack" does not reference a real window/,
    );
  });

  test("rejects duplicate card ids in deckState.cards", () => {
    const state: DeckState = {
      cards: [makeCard("c1"), makeCard("c1", "terminal")],
      windows: [makeStack("s1", ["c1"], "c1")],
    };
    expect(() => validateDeckState(state)).toThrow(/duplicate card id "c1"/);
  });

  test("rejects duplicate window ids in deckState.windows", () => {
    const state: DeckState = {
      cards: [makeCard("c1"), makeCard("c2")],
      windows: [
        makeStack("s1", ["c1"], "c1"),
        makeStack("s1", ["c2"], "c2"),
      ],
    };
    expect(() => validateDeckState(state)).toThrow(/duplicate window id "s1"/);
  });
});
