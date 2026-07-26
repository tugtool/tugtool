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

  it("honours the persisted order and lands unranked cards last", () => {
    const rows = buildTextFilesRows(
      {
        deck: deck([
          ["c1", "text"],
          ["c2", "text"],
          ["c3", "text"],
        ]),
        order: ["c3", "c1"],
      },
      resolver({}),
    );
    expect(rows.map((r) => r.cardId)).toEqual(["c3", "c1", "c2"]);
  });

  it("ignores stale ids in the persisted order", () => {
    const rows = buildTextFilesRows(
      {
        deck: deck([
          ["c1", "text"],
          ["c2", "text"],
        ]),
        order: ["gone", "c2"],
      },
      resolver({}),
    );
    expect(rows.map((r) => r.cardId)).toEqual(["c2", "c1"]);
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
      order: [],
      registryVersion: 0,
      filterQuery: "",
    });
    expect(ds.numberOfItems()).toBe(1);
    expect(ds.kindForIndex(0)).toBe("text-open");
    expect(ds.idForIndex(0)).toBe("open:lens-tf-uniq");
    expect(ds.roleForIndex(0)).toBe("cell");

    const v0 = ds.getVersion();
    ds.setInputsWithoutNotify({
      deck: deck([["lens-tf-uniq", "text"]]),
      order: [],
      registryVersion: 1,
      filterQuery: "",
    });
    expect(ds.getVersion()).not.toBe(v0); // new references → recompute
  });

  it("narrows to the rows whose displayed name matches", () => {
    const base = {
      deck: deck([
        ["lens-tf-uniq", "text"],
        ["lens-tf-other", "text"],
      ]),
      order: [],
      registryVersion: 0,
    };
    const all = new LensTextFilesDataSource({ ...base, filterQuery: "" });
    expect(all.numberOfItems()).toBe(2);

    // Titles fall back to the card title (`"c1"` / `"c2"` from the fixture) for
    // an unbound Text card, so filter on one of those.
    const first = all.rowAt(0).title;
    const filtered = new LensTextFilesDataSource({
      ...base,
      filterQuery: first,
    });
    expect(filtered.numberOfItems()).toBe(1);
    expect(filtered.rowAt(0).title).toBe(first);
    expect(filtered.unfilteredCount()).toBe(2);

    const none = new LensTextFilesDataSource({ ...base, filterQuery: "qqzzxx" });
    expect(none.numberOfItems()).toBe(0);
    expect(none.unfilteredCount()).toBe(2);
  });
});
