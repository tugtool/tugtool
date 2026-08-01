/**
 * files-data-source.test.ts — the Lens Files enumeration: one row per open
 * file card (Text or viewer), in deck order, plus role/id/title mapping. Pure
 * logic over `buildFilesRows` (with injected resolvers — no shared registry,
 * no DOM). Recents are no longer listed here; they hang off the header menu.
 */

import { describe, expect, it } from "bun:test";

import type { DeckState } from "@/layout-tree";
import {
  LensFilesDataSource,
  basename,
  buildFilesRows,
  dirname,
  displayPath,
  type OpenCardPathResolver,
  type OpenViewCardPathResolver,
} from "../files-data-source";

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

  it("abbreviates the home prefix in the hover path", () => {
    expect(displayPath("/Users/ada/src/tug/a.md")).toBe("~/src/tug/a.md");
    expect(displayPath("/proj/a.md")).toBe("/proj/a.md");
    expect(displayPath("bare.md")).toBe("bare.md");
  });
});

describe("disambiguating duplicate filenames", () => {
  it("leaves a unique filename unannotated", () => {
    const rows = buildFilesRows(
      { deck: deck([["c1", "text"], ["c2", "text"]]) },
      resolver({ c1: "/proj/a.md", c2: "/proj/b.md" }),
    );
    expect(rows.map((r) => r.disambiguator)).toEqual([null, null]);
  });

  it("annotates twins with the shortest trailing run that separates them", () => {
    const rows = buildFilesRows(
      { deck: deck([["c1", "text"], ["c2", "text"]]) },
      resolver({
        c1: "/Users/ada/src/tug/roadmap/plan.md",
        c2: "/Users/ada/Desktop/plan.md",
      }),
    );
    expect(rows.map((r) => r.disambiguator)).toEqual(["roadmap", "Desktop"]);
  });

  it("takes more segments when the near directories also match", () => {
    const rows = buildFilesRows(
      { deck: deck([["c1", "text"], ["c2", "text"], ["c3", "text"]]) },
      resolver({
        c1: "/proj/tugcast/src/mod.rs",
        c2: "/proj/tugbank/src/mod.rs",
        c3: "/proj/other/mod.rs",
      }),
    );
    expect(rows.map((r) => r.disambiguator)).toEqual([
      "tugcast/src",
      "tugbank/src",
      "other",
    ]);
  });

  it("annotates only the rows whose name is shared", () => {
    const rows = buildFilesRows(
      { deck: deck([["c1", "text"], ["c2", "text"], ["c3", "text"]]) },
      resolver({
        c1: "/proj/one/a.md",
        c2: "/proj/two/a.md",
        c3: "/proj/three/b.md",
      }),
    );
    expect(rows.map((r) => r.disambiguator)).toEqual(["one", "two", null]);
  });

  it("leaves a path-less twin unannotated", () => {
    const rows = buildFilesRows(
      { deck: deck([["c1", "text"], ["c2", "text"]]) },
      resolver({ c1: "/proj/one/Untitled" }),
      () => "Untitled",
    );
    expect(rows.map((r) => r.disambiguator)).toEqual(["one", null]);
  });
});

describe("buildFilesRows", () => {
  it("skips cards that hold no file, in deck order", () => {
    const rows = buildFilesRows(
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
    const rows = buildFilesRows(
      { deck: deck([["c1", "text"]]) },
      resolver({ c1: "/proj/open.txt" }),
    );
    expect(rows[0].title).toBe("open.txt");
    expect(rows[0].path).toBe("/proj/open.txt");
  });

  it("titles an unbound card from its buffer name (Untitled)", () => {
    const rows = buildFilesRows(
      { deck: deck([["c1", "text"]]) },
      resolver({}),
      (cardId) => (cardId === "c1" ? "Untitled-2" : null),
    );
    expect(rows[0].title).toBe("Untitled-2");
    expect(rows[0].path).toBeNull();
  });

  it("honours the persisted order and lands unranked cards last", () => {
    const rows = buildFilesRows(
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
    const rows = buildFilesRows(
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
    const rows = buildFilesRows(
      { deck: deck([["c1", "text"]]) },
      resolver({}),
      () => null,
    );
    expect(rows[0].title).toBe("c1");
    expect(rows[0].path).toBeNull();
  });
});

describe("LensFilesDataSource", () => {
  it("maps id/kind/role and bumps version on input change", () => {
    const ds = new LensFilesDataSource({
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
    const all = new LensFilesDataSource({ ...base, filterQuery: "" });
    expect(all.numberOfItems()).toBe(2);

    // Titles fall back to the card title (`"c1"` / `"c2"` from the fixture) for
    // an unbound Text card, so filter on one of those.
    const first = all.rowAt(0).title;
    const filtered = new LensFilesDataSource({
      ...base,
      filterQuery: first,
    });
    expect(filtered.numberOfItems()).toBe(1);
    expect(filtered.rowAt(0).title).toBe(first);
    expect(filtered.unfilteredCount()).toBe(2);

    const none = new LensFilesDataSource({ ...base, filterQuery: "qqzzxx" });
    expect(none.numberOfItems()).toBe(0);
    expect(none.unfilteredCount()).toBe(2);
  });
});

describe("viewer rows", () => {
  /** A viewer path resolver backed by a fixed map — no global registry. */
  function viewResolver(
    paths: Record<string, string>,
  ): OpenViewCardPathResolver {
    return (cardId) => paths[cardId] ?? null;
  }

  it("lists text and viewer cards together, in deck order", () => {
    const rows = buildFilesRows(
      {
        deck: deck([
          ["c-text", "text"],
          ["c-session", "session"],
          ["c-view", "file-view"],
        ]),
      },
      resolver({ "c-text": "/a/notes.txt" }),
      () => null,
      () => false,
      viewResolver({ "c-view": "/a/shot.png" }),
    );
    expect(rows.map((r) => [r.kind, r.title])).toEqual([
      ["text-open", "notes.txt"],
      ["view-open", "shot.png"],
    ]);
  });

  it("never marks a viewer row unsaved", () => {
    const rows = buildFilesRows(
      { deck: deck([["c-view", "file-view"]]) },
      resolver({}),
      () => null,
      // Even a resolver that says "dirty" cannot mark a viewer: the row is
      // read-only by construction, not by what the text resolvers report.
      () => true,
      viewResolver({ "c-view": "/a/shot.png" }),
    );
    expect(rows[0].unsaved).toBe(false);
  });

  it("disambiguates across kinds when a name is shared", () => {
    const rows = buildFilesRows(
      {
        deck: deck([
          ["c-text", "text"],
          ["c-view", "file-view"],
        ]),
      },
      resolver({ "c-text": "/a/docs/logo.png" }),
      () => null,
      () => false,
      viewResolver({ "c-view": "/a/art/logo.png" }),
    );
    expect(rows.map((r) => r.disambiguator)).toEqual(["docs", "art"]);
  });

  it("titles a viewer card from its card title until its path binds", () => {
    const rows = buildFilesRows(
      { deck: deck([["c-view", "file-view"]]) },
      resolver({}),
      () => null,
      () => false,
      viewResolver({}),
    );
    expect(rows[0].title).toBe("c-view");
    expect(rows[0].path).toBeNull();
  });
});
