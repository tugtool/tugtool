/**
 * pane-title.test.ts — the one composition rule for a pane's name.
 *
 * The bug these pin: a Session card's title bar read `test-repo/petit-thaw`
 * while every list naming that same pane read `Untitled`, because the lists
 * used a `CardState.title` fallback chain and only the title bar consulted the
 * live override store. So the interesting cases here are the ones where a
 * card's *registry* title is empty and its identity lives entirely in the
 * override.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { composePaneTitleBarText, paneTitleBarTextFor } from "../pane-title";
import { cardTitleStore } from "../card-title-store";
import { registerCard } from "../../card-registry";
import type { CardState, TugPaneState } from "../../layout-tree";

// Two stand-ins for the two shapes that matter: a card whose name is baked
// into the registry, and a card (the Session card's shape) whose registry
// title is empty because its identity only exists at runtime.
registerCard({
  componentId: "pane-title-static",
  contentFactory: () => null,
  defaultMeta: { title: "File", closable: true },
});
registerCard({
  componentId: "pane-title-dynamic",
  contentFactory: () => null,
  defaultMeta: { title: "", closable: true },
});

function card(id: string, componentId: string): CardState {
  // `title` is deliberately something no rule should surface — the old one
  // did, and that is exactly the drift being pinned out.
  return { id, componentId, title: `STALE-${id}`, closable: true };
}

function pane(id: string, cardIds: string[], title = ""): TugPaneState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cardIds,
    activeCardId: cardIds[0],
    title,
    acceptsFamilies: ["standard"],
  };
}

const byId = (...cards: CardState[]): ReadonlyMap<string, CardState> =>
  new Map(cards.map((c) => [c.id, c]));

afterEach(() => {
  cardTitleStore.clear("a");
  cardTitleStore.clear("b");
});

describe("composePaneTitleBarText", () => {
  test("the registry title alone, when there is nothing else", () => {
    expect(composePaneTitleBarText({ metaTitle: "File" })).toBe("File");
  });

  test("a pane's group name prefixes the registry title", () => {
    expect(
      composePaneTitleBarText({ metaTitle: "File", paneTitle: "Notes" }),
    ).toBe("Notes : File");
  });

  test("an override REPLACES the registry title rather than extending it", () => {
    // `File : changes-rework.md` was the old answer, and the first word said
    // nothing the filename and the card's own document icon did not.
    expect(
      composePaneTitleBarText({
        metaTitle: "File",
        titleOverride: "changes-rework.md",
      }),
    ).toBe("changes-rework.md");
  });

  test("an override stands alone when the registry title is empty too", () => {
    // The Session card's case. It used to reach this outcome by declaring an
    // empty registry title; now it is simply the rule.
    expect(
      composePaneTitleBarText({ metaTitle: "", titleOverride: "test-repo/petit-thaw" }),
    ).toBe("test-repo/petit-thaw");
  });

  test("a group name still prefixes an override — it is redundant with nothing", () => {
    expect(
      composePaneTitleBarText({
        metaTitle: "File",
        paneTitle: "Notes",
        titleOverride: "draft.md",
      }),
    ).toBe("Notes : draft.md");
  });

  test("an empty override leaves the registry title standing — it is the fallback", () => {
    // A Text card with no file open is called "File". The registry title is
    // what a card is called before it has a name, not a category prefix.
    expect(
      composePaneTitleBarText({ metaTitle: "File", titleOverride: "" }),
    ).toBe("File");
    expect(
      composePaneTitleBarText({ metaTitle: "File", titleOverride: null }),
    ).toBe("File");
  });

  test("nothing at all composes to the empty string", () => {
    // The title bar renders empty here; only the list-facing resolver below
    // substitutes a name, because a nameless row is unpickable.
    expect(composePaneTitleBarText({ metaTitle: "" })).toBe("");
  });
});

describe("paneTitleBarTextFor", () => {
  test("resolves the registry title of the pane's ACTIVE card", () => {
    const cards = byId(card("a", "pane-title-static"));
    expect(paneTitleBarTextFor(pane("p", ["a"]), cards)).toBe("File");
  });

  test("never surfaces CardState.title — that was the old, drifting rule", () => {
    const cards = byId(card("a", "pane-title-static"));
    expect(paneTitleBarTextFor(pane("p", ["a"]), cards)).not.toContain("STALE");
  });

  test("folds in a live override, so a dynamic card is named at all", () => {
    const cards = byId(card("a", "pane-title-dynamic"));
    expect(paneTitleBarTextFor(pane("p", ["a"]), cards)).toBe("Untitled");
    cardTitleStore.set("a", "test-repo/petit-thaw");
    expect(paneTitleBarTextFor(pane("p", ["a"]), cards)).toBe(
      "test-repo/petit-thaw",
    );
  });

  test("a named card is called by its own name, not by its type", () => {
    // The `File : ` prefix, retired. `pane-title-static` registers as "File",
    // which is what an unnamed one is called — and only that.
    const cards = byId(card("a", "pane-title-static"));
    expect(paneTitleBarTextFor(pane("p", ["a"]), cards)).toBe("File");
    cardTitleStore.set("a", "stacks-interaction.md");
    expect(paneTitleBarTextFor(pane("p", ["a"]), cards)).toBe(
      "stacks-interaction.md",
    );
  });

  test("a pane's group name prefixes only when the pane is multi-tab", () => {
    const cards = byId(
      card("a", "pane-title-static"),
      card("b", "pane-title-static"),
    );
    // Single-tab: the group name is not the title bar's to show.
    expect(paneTitleBarTextFor(pane("p", ["a"], "Notes"), cards)).toBe("File");
    // Multi-tab: it is.
    expect(paneTitleBarTextFor(pane("p", ["a", "b"], "Notes"), cards)).toBe(
      "Notes : File",
    );
  });

  test('falls back to "Untitled" only when nothing resolves', () => {
    expect(paneTitleBarTextFor(pane("p", ["gone"]), byId())).toBe("Untitled");
  });
});
