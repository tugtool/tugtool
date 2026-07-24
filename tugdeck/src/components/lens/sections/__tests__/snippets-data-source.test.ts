/**
 * snippets-data-source.test.ts — the Lens Snippets list enumeration: id/kind
 * mapping (one kind always), version bumps, and the filtered projection every
 * index-taking consumer depends on. Pure logic (no DOM).
 */

import { describe, expect, it } from "bun:test";

import type { Snippet } from "@/lib/snippets-doc";
import {
  LensSnippetsDataSource,
  type LensSnippetsInputs,
} from "../snippets-data-source";

function snippet(id: string, text: string): Snippet {
  return { id, text };
}

function inputs(
  snippets: readonly Snippet[],
  filterQuery = "",
  editingId: string | null = null,
): LensSnippetsInputs {
  return { snippets, filterQuery, editingId };
}

describe("LensSnippetsDataSource", () => {
  it("maps id to the snippet id and kind to 'snippet' (one kind always)", () => {
    const ds = new LensSnippetsDataSource(
      inputs([snippet("s1", "alpha"), snippet("s2", "beta\nmore")]),
    );
    expect(ds.numberOfItems()).toBe(2);
    expect(ds.idForIndex(0)).toBe("s1");
    expect(ds.idForIndex(1)).toBe("s2");
    expect(ds.kindForIndex()).toBe("snippet");
    expect(ds.rowAt(1).text).toBe("beta\nmore");
    expect(ds.indexForId("s2")).toBe(1);
    expect(ds.indexForId("absent")).toBe(-1);
  });

  it("bumps the version only when an input actually changes", () => {
    const first = [snippet("s1", "a")];
    const ds = new LensSnippetsDataSource(inputs(first));
    const v0 = ds.getVersion();
    ds.setInputsWithoutNotify(inputs(first)); // same reference → no bump
    expect(ds.getVersion()).toBe(v0);
    ds.setInputsWithoutNotify(inputs([snippet("s1", "a"), snippet("s2", "b")]));
    expect(ds.getVersion()).not.toBe(v0);
    expect(ds.numberOfItems()).toBe(2);
    const v1 = ds.getVersion();
    ds.setInputsWithoutNotify(
      inputs([snippet("s1", "a"), snippet("s2", "b")], "a"),
    );
    expect(ds.getVersion()).not.toBe(v1);
  });

  it("narrows to the snippets whose text matches", () => {
    const all = [
      snippet("s1", "ledger reconciliation"),
      snippet("s2", "telemetry sweep"),
      snippet("s3", "session ledger notes"),
    ];
    const ds = new LensSnippetsDataSource(inputs(all, "ledger"));
    expect(ds.numberOfItems()).toBe(2);
    expect(ds.idForIndex(0)).toBe("s1");
    expect(ds.idForIndex(1)).toBe("s3");
    expect(ds.isFiltering()).toBe(true);
    expect(ds.unfilteredCount()).toBe(3);
  });

  it("keeps every snippet for an empty or whitespace query", () => {
    const all = [snippet("s1", "a"), snippet("s2", "b")];
    expect(new LensSnippetsDataSource(inputs(all, "")).numberOfItems()).toBe(2);
    expect(new LensSnippetsDataSource(inputs(all, "  ")).numberOfItems()).toBe(2);
    expect(new LensSnippetsDataSource(inputs(all)).isFiltering()).toBe(false);
  });

  it("exempts the row being edited so an open editor cannot vanish", () => {
    const all = [
      snippet("s1", "ledger reconciliation"),
      snippet("s2", "telemetry sweep"),
    ];
    const ds = new LensSnippetsDataSource(inputs(all, "ledger", "s2"));
    expect(ds.numberOfItems()).toBe(2);
    // Unranked, the edited row leads — a fixed spot while the user types in it.
    expect(ds.indexForId("s2")).toBe(0);
    // Without the exemption the same query drops it.
    expect(
      new LensSnippetsDataSource(inputs(all, "ledger")).indexForId("s2"),
    ).toBe(-1);
  });

  it("ranks the survivors best-first, and restores document order when cleared", () => {
    const all = [
      snippet("s1", "a note mentioning the ledger in passing"),
      snippet("s2", "telemetry sweep"),
      snippet("s3", "ledger"),
    ];
    const filtered = new LensSnippetsDataSource(inputs(all, "ledger"));
    expect(filtered.numberOfItems()).toBe(2);
    expect(filtered.idForIndex(0)).toBe("s3"); // exact match leads
    expect(filtered.idForIndex(1)).toBe("s1");
    // Clearing the query returns the document's own (drag) order untouched.
    const cleared = new LensSnippetsDataSource(inputs(all, ""));
    expect([0, 1, 2].map((i) => cleared.idForIndex(i))).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("reports rowAt / indexForId in FILTERED coordinates", () => {
    const all = [
      snippet("s1", "alpha"),
      snippet("s2", "beta ledger"),
      snippet("s3", "gamma ledger"),
    ];
    const ds = new LensSnippetsDataSource(inputs(all, "ledger"));
    // Index 0 of the list is the doc's SECOND snippet — the whole reason every
    // consumer must route through the data source.
    expect(ds.rowAt(0).id).toBe("s2");
    expect(ds.indexForId("s3")).toBe(1);
    expect(ds.indexForId("s1")).toBe(-1);
  });

  it("returns undefined past either end (the delete-survivor probe)", () => {
    const ds = new LensSnippetsDataSource(inputs([snippet("s1", "a")]));
    expect(ds.rowAt(-1)).toBeUndefined();
    expect(ds.rowAt(1)).toBeUndefined();
  });
});
