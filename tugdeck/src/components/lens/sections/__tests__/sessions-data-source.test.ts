/**
 * sessions-data-source.test.ts — the Lens Sessions list enumeration:
 * dedupe by session in binding order, the persisted user reorder overlay,
 * id/kind mapping, and version bumps. Pure logic over the real data source
 * (no DOM).
 */

import { describe, expect, it } from "bun:test";

import type { CardSessionBinding } from "@/lib/card-session-binding-store";
import { sessionNameStore } from "@/lib/session-name-store";
import {
  LensSessionsDataSource,
  buildSessionRows,
  type LensSessionsInputs,
} from "../sessions-data-source";

/** A stable empty order, so an unchanged call really is unchanged. */
const NO_ORDER: readonly string[] = [];

/** The data source's input bundle, with the filter fields defaulted off. */
function inputs(
  bindingMap: ReadonlyMap<string, CardSessionBinding>,
  order: readonly string[] = NO_ORDER,
  filterQuery = "",
): LensSessionsInputs {
  return {
    bindings: bindingMap,
    order,
    filterQuery,
    nameVersion: sessionNameStore.getVersion(),
    tagVersion: 0,
  };
}

function binding(
  tugSessionId: string,
  projectDir: string,
): CardSessionBinding {
  return {
    tugSessionId,
    workspaceKey: `${projectDir}#${tugSessionId}`,
    projectDir,
    sessionMode: "new",
  };
}

function bindings(
  entries: ReadonlyArray<readonly [string, CardSessionBinding]>,
): ReadonlyMap<string, CardSessionBinding> {
  return new Map(entries);
}

describe("buildSessionRows", () => {
  it("emits one row per session in binding order", () => {
    const rows = buildSessionRows(
      bindings([
        ["card-a", binding("sess-1", "/p1")],
        ["card-b", binding("sess-2", "/p2")],
      ]),
    );
    expect(rows.map((r) => r.tugSessionId)).toEqual(["sess-1", "sess-2"]);
    expect(rows[0].cardId).toBe("card-a");
  });

  it("dedupes by session — the first card bound to a session wins the row", () => {
    const rows = buildSessionRows(
      bindings([
        ["card-a", binding("sess-1", "/p1")],
        ["card-b", binding("sess-1", "/p1")], // same session, second card
        ["card-c", binding("sess-2", "/p2")],
      ]),
    );
    expect(rows.map((r) => r.tugSessionId)).toEqual(["sess-1", "sess-2"]);
    expect(rows.find((r) => r.tugSessionId === "sess-1")?.cardId).toBe("card-a");
  });

  it("orders rows by the persisted user order", () => {
    const map = bindings([
      ["card-a", binding("sess-1", "/p1")],
      ["card-b", binding("sess-2", "/p2")],
      ["card-c", binding("sess-3", "/p3")],
    ]);
    const rows = buildSessionRows(map, ["sess-3", "sess-1", "sess-2"]);
    expect(rows.map((r) => r.tugSessionId)).toEqual([
      "sess-3",
      "sess-1",
      "sess-2",
    ]);
  });

  it("sorts sessions absent from the order to the bottom, in binding order", () => {
    const map = bindings([
      ["card-a", binding("sess-1", "/p1")], // new — not in order
      ["card-b", binding("sess-2", "/p2")], // ordered
      ["card-c", binding("sess-3", "/p3")], // new — not in order
      ["card-d", binding("sess-4", "/p4")], // ordered
    ]);
    const rows = buildSessionRows(map, ["sess-4", "sess-2"]);
    // Ordered set first (sess-4, sess-2), then new sessions in binding order.
    expect(rows.map((r) => r.tugSessionId)).toEqual([
      "sess-4",
      "sess-2",
      "sess-1",
      "sess-3",
    ]);
  });

  it("ignores stale ids in the order (closed sessions)", () => {
    const map = bindings([
      ["card-a", binding("sess-1", "/p1")],
      ["card-b", binding("sess-2", "/p2")],
    ]);
    const rows = buildSessionRows(map, ["gone", "sess-2", "also-gone", "sess-1"]);
    expect(rows.map((r) => r.tugSessionId)).toEqual(["sess-2", "sess-1"]);
  });

  it("falls back to binding order for an empty order", () => {
    const map = bindings([
      ["card-a", binding("sess-1", "/p1")],
      ["card-b", binding("sess-2", "/p2")],
    ]);
    expect(buildSessionRows(map, []).map((r) => r.tugSessionId)).toEqual([
      "sess-1",
      "sess-2",
    ]);
  });
});

describe("LensSessionsDataSource", () => {
  it("maps id to the session id and kind to 'session'", () => {
    const ds = new LensSessionsDataSource(
      inputs(bindings([["card-a", binding("sess-1", "/p1")]])),
    );
    expect(ds.numberOfItems()).toBe(1);
    expect(ds.idForIndex(0)).toBe("sess-1");
    expect(ds.kindForIndex()).toBe("session");
    expect(ds.rowAt(0).projectDir).toBe("/p1");
    expect(ds.indexForId("sess-1")).toBe(0);
    expect(ds.indexForId("absent")).toBe(-1);
  });

  it("keeps the version stable across unrelated reads and bumps on input change", () => {
    const ds = new LensSessionsDataSource(
      inputs(bindings([["card-a", binding("sess-1", "/p1")]])),
    );
    const v0 = ds.getVersion();
    // Repeated reads do not bump the version.
    ds.numberOfItems();
    ds.idForIndex(0);
    expect(ds.getVersion()).toBe(v0);
    // Same reference in → no recompute, no bump.
    const same = bindings([["card-a", binding("sess-1", "/p1")]]);
    ds.setInputsWithoutNotify(inputs(same));
    ds.setInputsWithoutNotify(inputs(same));
    const v1 = ds.getVersion();
    // A new reference → recompute → bump.
    ds.setInputsWithoutNotify(
      inputs(
        bindings([
          ["card-a", binding("sess-1", "/p1")],
          ["card-b", binding("sess-2", "/p2")],
        ]),
      ),
    );
    expect(ds.getVersion()).not.toBe(v1);
    expect(ds.numberOfItems()).toBe(2);
  });

  it("recomputes and re-sorts when only the order changes", () => {
    const map = bindings([
      ["card-a", binding("sess-1", "/p1")],
      ["card-b", binding("sess-2", "/p2")],
    ]);
    const ds = new LensSessionsDataSource(inputs(map));
    expect(ds.visibleOrder()).toEqual(["sess-1", "sess-2"]);
    const v0 = ds.getVersion();
    // Same bindings, new order → recompute → bump → re-sorted rows.
    const changed = ds.setInputsWithoutNotify(inputs(map, ["sess-2", "sess-1"]));
    expect(changed).toBe(true);
    expect(ds.getVersion()).not.toBe(v0);
    expect(ds.visibleOrder()).toEqual(["sess-2", "sess-1"]);
  });

  it("narrows to the rows whose label matches, in native order", () => {
    const map = bindings([
      ["card-a", binding("sess-1", "/work/tugtool")],
      ["card-b", binding("sess-2", "/work/atlas")],
      ["card-c", binding("sess-3", "/work/tugdeck")],
    ]);
    const ds = new LensSessionsDataSource(inputs(map, NO_ORDER, "tug"));
    expect(ds.visibleOrder()).toEqual(["sess-1", "sess-3"]);
    expect(ds.isFiltering()).toBe(true);
    expect(ds.unfilteredCount()).toBe(3);
    // Filtered coordinates: index 0 is the doc's first MATCH.
    expect(ds.rowAt(0).tugSessionId).toBe("sess-1");
    expect(ds.indexForId("sess-3")).toBe(1);
    expect(ds.indexForId("sess-2")).toBe(-1);
  });

  it("matches a session's name once one arrives", () => {
    const map = bindings([["card-a", binding("sess-name", "/work/atlas")]]);
    expect(
      new LensSessionsDataSource(inputs(map, NO_ORDER, "harbor")).numberOfItems(),
    ).toBe(0);
    sessionNameStore.setName("sess-name", "harbor");
    try {
      expect(
        new LensSessionsDataSource(inputs(map, NO_ORDER, "harbor")).numberOfItems(),
      ).toBe(1);
    } finally {
      sessionNameStore.setName("sess-name", null);
    }
  });

  it("keeps every row for an empty or whitespace query", () => {
    const map = bindings([["card-a", binding("sess-1", "/work/tugtool")]]);
    expect(new LensSessionsDataSource(inputs(map)).numberOfItems()).toBe(1);
    expect(
      new LensSessionsDataSource(inputs(map, NO_ORDER, "  ")).numberOfItems(),
    ).toBe(1);
    expect(new LensSessionsDataSource(inputs(map)).isFiltering()).toBe(false);
  });
});
