/**
 * sessions-data-source.test.ts — the Lens Sessions list enumeration:
 * dedupe by session in binding order, id/kind mapping, and version bumps.
 * Pure logic over the real data source (no DOM).
 */

import { describe, expect, it } from "bun:test";

import type { CardSessionBinding } from "@/lib/card-session-binding-store";
import {
  LensSessionsDataSource,
  buildSessionRows,
} from "../sessions-data-source";

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
});

describe("LensSessionsDataSource", () => {
  it("maps id to the session id and kind to 'session'", () => {
    const ds = new LensSessionsDataSource(
      bindings([["card-a", binding("sess-1", "/p1")]]),
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
      bindings([["card-a", binding("sess-1", "/p1")]]),
    );
    const v0 = ds.getVersion();
    // Repeated reads do not bump the version.
    ds.numberOfItems();
    ds.idForIndex(0);
    expect(ds.getVersion()).toBe(v0);
    // Same reference in → no recompute, no bump.
    const same = bindings([["card-a", binding("sess-1", "/p1")]]);
    ds.setInputsWithoutNotify(same);
    ds.setInputsWithoutNotify(same);
    const v1 = ds.getVersion();
    // A new reference → recompute → bump.
    ds.setInputsWithoutNotify(
      bindings([
        ["card-a", binding("sess-1", "/p1")],
        ["card-b", binding("sess-2", "/p2")],
      ]),
    );
    expect(ds.getVersion()).not.toBe(v1);
    expect(ds.numberOfItems()).toBe(2);
  });
});
