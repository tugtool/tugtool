import { describe, expect, test } from "bun:test";

import {
  computeEditCapabilities,
  computeFileMenuGates,
  EMPTY_EDIT_CAPABILITIES,
  HostMenuStatePublisher,
  projectDeckState,
  registerEditCapsRefresher,
  requestEditMenuStateRefresh,
  type MenuStateDevBlock,
  type MenuStateEditBlock,
  type MenuStateFileBlock,
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

  test("selectionActive tracks activePaneId (deselect clears it)", () => {
    const base = deck([card("a")], [pane("p1", ["a"])]);
    // Deselected — no active pane (a click on the empty canvas).
    expect(projectDeckState(base).selectionActive).toBe(false);
    // A card is selected.
    expect(
      projectDeckState({ ...base, activePaneId: "p1" }).selectionActive,
    ).toBe(true);
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
    canChangeSettings: true,
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

  const fileBlock = (cardId: string): MenuStateFileBlock => ({
    cardId,
    mode: "manual",
    dirty: true,
    untitled: false,
    readOnly: false,
    hasPath: true,
    conflict: false,
  });

  test("attaches the file block only for the focused pane's active text card", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a", { componentId: "text" })], [pane("p1", ["a"])])),
    );
    publisher.setFileBlock("a", fileBlock("a"));
    await settle();
    expect(posted[0].file).toEqual(fileBlock("a"));
  });

  test("non-file active card rides with file: null even when a block exists", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setFileBlock("b", fileBlock("b"));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a", { componentId: "dev" })], [pane("p1", ["a"])])),
    );
    await settle();
    expect(posted[0].file).toBeNull();
  });

  test("clearing the file block reverts the payload to file: null", async () => {
    const posted: MenuStatePayload[] = [];
    const publisher = new HostMenuStatePublisher((p) => posted.push(p));
    publisher.setDeckProjection(
      projectDeckState(deck([card("a", { componentId: "text" })], [pane("p1", ["a"])])),
    );
    publisher.setFileBlock("a", fileBlock("a"));
    await settle();
    publisher.clearFileBlock("a");
    await settle();
    expect(posted[1].file).toBeNull();
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
    expect(caps.redo).toBe(false);
    expect(caps.find).toBe(false);
  });

  test("undo/redo follow the focused editor's depth-gated validateAction", () => {
    // An editor that handles UNDO/REDO but whose history holds only an
    // undoable step (depth-gated validator: undo yes, redo no).
    const caps = computeEditCapabilities(
      chainHandling(TUG_ACTIONS.UNDO),
    );
    expect(caps.undo).toBe(true);
    expect(caps.redo).toBe(false);
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

describe("edit-caps refresher registry", () => {
  test("requestEditMenuStateRefresh invokes the registered refresher; clearing stops it", () => {
    let calls = 0;
    registerEditCapsRefresher(() => {
      calls += 1;
    });
    requestEditMenuStateRefresh();
    expect(calls).toBe(1);
    registerEditCapsRefresher(null);
    requestEditMenuStateRefresh(); // no registered refresher → no-op
    expect(calls).toBe(1);
  });
});

describe("computeFileMenuGates (Spec S02)", () => {
  const base: MenuStateFileBlock = {
    cardId: "c",
    mode: "manual",
    dirty: false,
    untitled: false,
    readOnly: false,
    hasPath: true,
    conflict: false,
  };

  test("automatic-mode Save stays enabled even when clean (no-beep guard)", () => {
    expect(computeFileMenuGates({ ...base, mode: "automatic" }).save).toBe(true);
  });

  test("a clean titled manual card disables Save", () => {
    expect(computeFileMenuGates(base).save).toBe(false);
  });

  test("a dirty or untitled manual card enables Save", () => {
    expect(computeFileMenuGates({ ...base, dirty: true }).save).toBe(true);
    expect(computeFileMenuGates({ ...base, untitled: true, hasPath: false }).save).toBe(true);
  });

  test("read-only disables Save in either mode", () => {
    expect(computeFileMenuGates({ ...base, mode: "automatic", readOnly: true }).save).toBe(false);
    expect(computeFileMenuGates({ ...base, dirty: true, readOnly: true }).save).toBe(false);
  });

  test("a conflict disables automatic Save but keeps manual Save live", () => {
    // Automatic: flush no-ops on conflict, so an enabled Save would be a
    // live shortcut to a stub. Manual: Save is the re-entry to the conflict
    // sheet after a Cancel — gating it off would strand Save Anyway.
    expect(computeFileMenuGates({ ...base, mode: "automatic", conflict: true }).save).toBe(false);
    expect(computeFileMenuGates({ ...base, dirty: true, conflict: true }).save).toBe(true);
    expect(computeFileMenuGates({ ...base, conflict: true }).save).toBe(true);
    expect(
      computeFileMenuGates({ ...base, conflict: true, readOnly: true }).save,
    ).toBe(false);
  });

  test("Revert needs dirty + a path; Reload needs a path", () => {
    expect(computeFileMenuGates(base).revert).toBe(false);
    expect(computeFileMenuGates({ ...base, dirty: true }).revert).toBe(true);
    expect(computeFileMenuGates({ ...base, dirty: true, hasPath: false }).revert).toBe(false);
    expect(computeFileMenuGates(base).reload).toBe(true);
    expect(computeFileMenuGates({ ...base, hasPath: false }).reload).toBe(false);
  });

  test("Save As… and Save a Copy… are always enabled for a bound card", () => {
    const gates = computeFileMenuGates(base);
    expect(gates.saveAs).toBe(true);
    expect(gates.saveACopy).toBe(true);
  });
});
