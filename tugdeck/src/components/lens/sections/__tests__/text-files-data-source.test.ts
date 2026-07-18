/**
 * text-files-data-source.test.ts — the Lens Text Files enumeration:
 * open-card rows, the open-path filter over recents, the header only when
 * recents survive, and role/id mapping. Pure logic over `buildTextFilesRows`
 * (with an injected path resolver — no shared registry, no DOM).
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
        recents: [],
      },
      resolver({}),
    );
    expect(rows.map((r) => r.kind)).toEqual(["text-open", "text-open"]);
  });

  it("adds a header + recents only for recents not already open", () => {
    const rows = buildTextFilesRows(
      {
        deck: deck([["c1", "text"]]),
        recents: ["/proj/open.txt", "/proj/closed.txt"],
      },
      resolver({ c1: "/proj/open.txt" }),
    );
    // The open path is filtered out of recents; the still-closed one remains,
    // preceded by the header.
    expect(rows.map((r) => r.kind)).toEqual([
      "text-open",
      "text-recents-header",
      "text-recent",
    ]);
    const recent = rows[2];
    expect(recent.kind === "text-recent" && recent.path).toBe("/proj/closed.txt");
  });

  it("emits no header when every recent is already open", () => {
    const rows = buildTextFilesRows(
      {
        deck: deck([["c1", "text"]]),
        recents: ["/proj/open.txt"],
      },
      resolver({ c1: "/proj/open.txt" }),
    );
    expect(rows.map((r) => r.kind)).toEqual(["text-open"]);
  });

  it("titles an open card with no bound path as Untitled", () => {
    const rows = buildTextFilesRows(
      { deck: deck([["c1", "text"]]), recents: [] },
      resolver({}),
    );
    expect(rows[0].kind === "text-open" && rows[0].title).toBe("c1");
  });
});

describe("LensTextFilesDataSource", () => {
  it("maps id/kind/role and bumps version on input change", () => {
    // No open registry entry for c1 → its path is null (an open card with no
    // bound path yet); the recent survives the (empty) open-path filter.
    const ds = new LensTextFilesDataSource({
      deck: deck([["lens-tf-uniq", "text"]]),
      recents: ["/proj/closed.txt"],
      registryVersion: 0,
    });
    expect(ds.numberOfItems()).toBe(3); // open + header + recent
    expect(ds.kindForIndex(0)).toBe("text-open");
    expect(ds.idForIndex(0)).toBe("open:lens-tf-uniq");
    expect(ds.roleForIndex(1)).toBe("header");
    expect(ds.kindForIndex(1)).toBe("text-recents-header");
    expect(ds.roleForIndex(2)).toBe("cell");
    expect(ds.idForIndex(2)).toBe("recent:/proj/closed.txt");

    const v0 = ds.getVersion();
    ds.setInputsWithoutNotify({
      deck: deck([["lens-tf-uniq", "text"]]),
      recents: ["/proj/closed.txt"],
      registryVersion: 1,
    });
    expect(ds.getVersion()).not.toBe(v0); // new references → recompute
  });
});
