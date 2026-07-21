/**
 * text-files-data-source.test.ts — the Lens Text Files enumeration: one row per
 * open Text card, in deck order, plus role/id/title mapping. Pure logic over
 * `buildTextFilesRows` (with an injected path resolver — no shared registry, no
 * DOM). Recents are no longer listed here; they hang off the header menu.
 */

import { describe, expect, it } from "bun:test";

import type { DeckState } from "@/layout-tree";
import {
  LensTextFilesDataSource,
  basename,
  buildTextFilesRows,
  dirname,
  type OpenCardPathResolver,
} from "../text-files-data-source";

function deck(cardIds: ReadonlyArray<[string, string]>): DeckState {
  return {
    cards: cardIds.map(([id, componentId]) => ({
      id,
      componentId,
      title: id,
      closable: true,
    })),
    panes: [],
  } as unknown as DeckState;
}

/** A path resolver backed by a fixed map — no global registry. */
function resolver(paths: Record<string, string>): OpenCardPathResolver {
  return (cardId) => paths[cardId] ?? null;
}

describe("path helpers", () => {
  it("splits basename and dirname", () => {
    expect(basename("/a/b/c.txt")).toBe("c.txt");
    expect(dirname("/a/b/c.txt")).toBe("/a/b");
    expect(basename("bare")).toBe("bare");
    expect(dirname("bare")).toBe("");
  });
});

describe("buildTextFilesRows", () => {
  it("lists only text cards, in deck order", () => {
    const rows = buildTextFilesRows(
      {
        deck: deck([
          ["s1", "session"],
          ["c1", "text"],
          ["c2", "text"],
        ]),
      },
      resolver({}),
    );
    expect(rows.map((r) => r.kind)).toEqual(["text-open", "text-open"]);
    expect(rows.map((r) => r.cardId)).toEqual(["c1", "c2"]);
  });

  it("titles an open card from its bound path's basename", () => {
    const rows = buildTextFilesRows(
      { deck: deck([["c1", "text"]]) },
      resolver({ c1: "/proj/open.txt" }),
    );
    expect(rows[0].title).toBe("open.txt");
    expect(rows[0].path).toBe("/proj/open.txt");
  });

  it("titles an unbound card from its buffer name (Untitled)", () => {
    const rows = buildTextFilesRows(
      { deck: deck([["c1", "text"]]) },
      resolver({}),
      (cardId) => (cardId === "c1" ? "Untitled-2" : null),
    );
    expect(rows[0].title).toBe("Untitled-2");
    expect(rows[0].path).toBeNull();
  });

  it("falls back to the card title when a path-less card has no buffer name", () => {
    const rows = buildTextFilesRows(
      { deck: deck([["c1", "text"]]) },
      resolver({}),
      () => null,
    );
    expect(rows[0].title).toBe("c1");
    expect(rows[0].path).toBeNull();
  });
});

describe("LensTextFilesDataSource", () => {
  it("maps id/kind/role and bumps version on input change", () => {
    const ds = new LensTextFilesDataSource({
      deck: deck([["lens-tf-uniq", "text"]]),
      registryVersion: 0,
    });
    expect(ds.numberOfItems()).toBe(1);
    expect(ds.kindForIndex(0)).toBe("text-open");
    expect(ds.idForIndex(0)).toBe("open:lens-tf-uniq");
    expect(ds.roleForIndex(0)).toBe("cell");

    const v0 = ds.getVersion();
    ds.setInputsWithoutNotify({
      deck: deck([["lens-tf-uniq", "text"]]),
      registryVersion: 1,
    });
    expect(ds.getVersion()).not.toBe(v0); // new references → recompute
  });
});
