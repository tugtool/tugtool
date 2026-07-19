/**
 * text-files-data-source.test.ts — the Lens Text Files enumeration:
 * open-card rows, the open-path filter over recents, last-opened stamping, and
 * role/id mapping. Pure logic over `buildTextFilesRows` (with injected path and
 * opened-at resolvers — no shared registry, no DOM).
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

  it("lists recents not already open, with their last-opened stamp (no header)", () => {
    const rows = buildTextFilesRows(
      {
        deck: deck([["c1", "text"]]),
        recents: ["/proj/open.txt", "/proj/closed.txt"],
      },
      resolver({ c1: "/proj/open.txt" }),
      (p) => (p === "/proj/closed.txt" ? 1_700_000_000_000 : null),
    );
    // The open path is filtered out of recents; the still-closed one remains —
    // directly, with no "Recent" header row (retired).
    expect(rows.map((r) => r.kind)).toEqual(["text-open", "text-recent"]);
    const recent = rows[1];
    expect(recent.kind === "text-recent" && recent.path).toBe("/proj/closed.txt");
    expect(recent.kind === "text-recent" && recent.openedAt).toBe(1_700_000_000_000);
  });

  it("stamps openedAt null for a recent with no recorded time", () => {
    const rows = buildTextFilesRows(
      { deck: deck([]), recents: ["/proj/closed.txt"] },
      resolver({}),
      () => null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind === "text-recent" && rows[0].openedAt).toBeNull();
  });

  it("lists only the open card when every recent is already open", () => {
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
    expect(ds.numberOfItems()).toBe(2); // open + recent (no header)
    expect(ds.kindForIndex(0)).toBe("text-open");
    expect(ds.idForIndex(0)).toBe("open:lens-tf-uniq");
    expect(ds.roleForIndex(1)).toBe("cell");
    expect(ds.kindForIndex(1)).toBe("text-recent");
    expect(ds.idForIndex(1)).toBe("recent:/proj/closed.txt");

    const v0 = ds.getVersion();
    ds.setInputsWithoutNotify({
      deck: deck([["lens-tf-uniq", "text"]]),
      recents: ["/proj/closed.txt"],
      registryVersion: 1,
    });
    expect(ds.getVersion()).not.toBe(v0); // new references → recompute
  });
});
