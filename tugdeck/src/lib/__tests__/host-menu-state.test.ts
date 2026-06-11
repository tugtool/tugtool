import { describe, expect, test } from "bun:test";

import {
  computeEditCapabilities,
  EMPTY_EDIT_CAPABILITIES,
  HostMenuStatePublisher,
  projectDeckState,
  type MenuStateDevBlock,
  type MenuStateEditBlock,
  type MenuStatePayload,
} from "../host-menu-state";
import { TUG_ACTIONS } from "../../components/tugways/action-vocabulary";
import type { CardState, DeckState, TugPaneState } from "../../layout-tree";

function card(id: string, overrides: Partial<CardState> = {}): CardState {
  return {
    id,
    componentId: "dev",
    title: `Card ${id}`,
    closable: true,
    ...overrides,
  };
}

function pane(
  id: string,
  cardIds: string[],
  overrides: Partial<TugPaneState> = {},
): TugPaneState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cardIds,
    activeCardId: cardIds[0],
    title: "",
    acceptsFamilies: ["standard"],
    ...overrides,
  };
}

function deck(cards: CardState[], panes: TugPaneState[]): DeckState {
  return { cards, panes, hasFocus: true };
}

describe("projectDeckState", () => {
  test("empty deck projects no panes and a null activeCard", () => {
    const projection = projectDeckState(deck([], []));
    expect(projection.panes).toEqual([]);
    expect(projection.activeCard).toBeNull();
  });

  test("focused pane is the last in z-order; list is reversed to topmost-first", () => {
    const state = deck(
      [card("a"), card("b")],
      [pane("p1", ["a"]), pane("p2", ["b"])],
    );
    const projection = projectDeckState(state);
    expect(projection.panes.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(projection.panes[0].focused).toBe(true);
    expect(projection.panes[1].focused).toBe(false);
  });

  test("pane entries carry cardCount and the active card's closable", () => {
    const state = deck(
      [card("a", { closable: false }), card("b")],
      [pane("p1", ["a", "b"], { activeCardId: "a" })],
    );
    const [entry] = projectDeckState(state).panes;
    expect(entry.cardCount).toBe(2);
    expect(entry.closable).toBe(false);
  });

  test("title falls back: pane title, then active card, then first card, then Untitled", () => {
    const titled = deck([card("a")], [pane("p1", ["a"], { title: "My Pane" })]);
    expect(projectDeckState(titled).panes[0].title).toBe("My Pane");

    const fromActive = deck(
      [card("a", { title: "" }), card("b", { title: "Active Title" })],
      [pane("p1", ["a", "b"], { activeCardId: "b" })],
    );
    expect(projectDeckState(fromActive).panes[0].title).toBe("Active Title");

    const fromFirst = deck(
      [card("a", { title: "First Title" }), card("b", { title: "" })],
      [pane("p1", ["a", "b"], { activeCardId: "b" })],
    );
    expect(projectDeckState(fromFirst).panes[0].title).toBe("First Title");

    const untitled = deck(
      [card("a", { title: "" })],
      [pane("p1", ["a"])],
    );
    expect(projectDeckState(untitled).panes[0].title).toBe("Untitled");
  });

  test("activeCard reflects the focused pane's active card component", () => {
    const state = deck(
      [card("a", { componentId: "git" }), card("b", { componentId: "dev", closable: false })],
      [pane("p1", ["a"]), pane("p2", ["b"])],
    );
    expect(projectDeckState(state).activeCard).toEqual({
      component: "dev",
      closable: false,
    });
  });
});

describe("HostMenuStatePublisher", () => {
  /** Drain the microtask queue so a scheduled flush runs. */
  const settle = () => Promise.resolve();

  test("posts the merged payload after a microtask", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a")], [pane("p1", ["a"])])),
    );
    expect(posted).toHaveLength(0); // not synchronous
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0].panes[0].id).toBe("p1");
    expect(posted[0].dev).toBeNull();
  });

  test("coalesces multiple same-tick updates into one post", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(projectDeckState(deck([], [])));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a")], [pane("p1", ["a"])])),
    );
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0].panes).toHaveLength(1);
  });

  test("suppresses identical consecutive payloads", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    const state = deck([card("a")], [pane("p1", ["a"])]);
    publisher.setDeckProjection(projectDeckState(state));
    await settle();
    publisher.setDeckProjection(projectDeckState(state));
    await settle();
    expect(posted).toHaveLength(1);
  });

  const devBlock = (cardId: string): MenuStateDevBlock => ({
    cardId,
    sessionBound: true,
    canInterrupt: false,
    permissionMode: "default",
    hasAssistantMessage: false,
    hasTurns: false,
  });

  test("attaches the dev block only for the focused pane's active dev card", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a", { componentId: "dev" })], [pane("p1", ["a"])])),
    );
    publisher.setDevBlock("a", devBlock("a"));
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0].dev).toEqual(devBlock("a"));
  });

  test("non-dev active card rides with dev: null even when a block exists", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDevBlock("b", devBlock("b"));
    publisher.setDeckProjection(
      projectDeckState(
        deck(
          [card("a", { componentId: "git" }), card("b", { componentId: "dev" })],
          [pane("p2", ["b"]), pane("p1", ["a"])],
        ),
      ),
    );
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0].activeCard?.component).toBe("git");
    expect(posted[0].dev).toBeNull();
  });

  test("a dev block for a non-active card does not ride the payload", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDevBlock("other", devBlock("other"));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a", { componentId: "dev" })], [pane("p1", ["a"])])),
    );
    await settle();
    expect(posted[0].dev).toBeNull();
  });

  test("clearing the dev block reverts the payload to dev: null", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a", { componentId: "dev" })], [pane("p1", ["a"])])),
    );
    publisher.setDevBlock("a", devBlock("a"));
    await settle();
    publisher.clearDevBlock("a");
    await settle();
    expect(posted).toHaveLength(2);
    expect(posted[1].dev).toBeNull();
    // Clearing an unknown card is a no-op (no extra post).
    publisher.clearDevBlock("a");
    await settle();
    expect(posted).toHaveLength(2);
  });

  test("posts again when the projection actually changes", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a")], [pane("p1", ["a"])])),
    );
    await settle();
    publisher.setDeckProjection(
      projectDeckState(deck([card("a"), card("b")], [pane("p1", ["a", "b"])])),
    );
    await settle();
    expect(posted).toHaveLength(2);
    expect(posted[1].panes[0].cardCount).toBe(2);
  });

  test("the payload carries an all-disabled edit block by default", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(projectDeckState(deck([card("a")], [pane("p1", ["a"])])));
    await settle();
    expect(posted[0].edit).toEqual(EMPTY_EDIT_CAPABILITIES);
  });

  test("setEditCapabilities rides the payload and flips on change", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(projectDeckState(deck([card("a")], [pane("p1", ["a"])])));
    const caps: MenuStateEditBlock = { ...EMPTY_EDIT_CAPABILITIES, copy: true, selectAll: true };
    publisher.setEditCapabilities(caps);
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0].edit).toEqual(caps);

    // Same caps again → suppressed; a changed cap → new post.
    publisher.setEditCapabilities({ ...caps });
    await settle();
    expect(posted).toHaveLength(1);
    publisher.setEditCapabilities({ ...caps, paste: true });
    await settle();
    expect(posted).toHaveLength(2);
    expect(posted[1].edit.paste).toBe(true);
  });
});

describe("computeEditCapabilities", () => {
  /** A chain stub that handles exactly the given actions. */
  function chainHandling(...handled: string[]) {
    const set = new Set<string>(handled);
    return { validateAction: (action: string) => set.has(action) };
  }

  test("maps each edit action to the chain's validateAction", () => {
    const caps = computeEditCapabilities(
      chainHandling(TUG_ACTIONS.COPY, TUG_ACTIONS.SELECT_ALL),
    );
    expect(caps.copy).toBe(true);
    expect(caps.selectAll).toBe(true);
    expect(caps.cut).toBe(false);
    expect(caps.paste).toBe(false);
    expect(caps.undo).toBe(false);
    expect(caps.find).toBe(false);
  });

  test("nothing focused → every capability is false", () => {
    expect(computeEditCapabilities(chainHandling())).toEqual(EMPTY_EDIT_CAPABILITIES);
  });

  test("a find-capable surface enables the find items", () => {
    const caps = computeEditCapabilities(
      chainHandling(TUG_ACTIONS.FIND, TUG_ACTIONS.FIND_NEXT, TUG_ACTIONS.FIND_PREVIOUS),
    );
    expect(caps.find).toBe(true);
    expect(caps.findNext).toBe(true);
    expect(caps.findPrevious).toBe(true);
  });
});
