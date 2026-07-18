/**
 * snippets-data-source.test.ts — the Lens Snippets list enumeration: id/kind
 * mapping (one kind always) and version bumps. Pure logic (no DOM).
 */

import { describe, expect, it } from "bun:test";

import type { Snippet } from "@/lib/snippets-doc";
import { LensSnippetsDataSource } from "../snippets-data-source";

function snippet(id: string, text: string): Snippet {
  return { id, text };
}

describe("LensSnippetsDataSource", () => {
  it("maps id to the snippet id and kind to 'snippet' (one kind always)", () => {
    const ds = new LensSnippetsDataSource([
      snippet("s1", "alpha"),
      snippet("s2", "beta\nmore"),
    ]);
    expect(ds.numberOfItems()).toBe(2);
    expect(ds.idForIndex(0)).toBe("s1");
    expect(ds.idForIndex(1)).toBe("s2");
    expect(ds.kindForIndex()).toBe("snippet");
    expect(ds.rowAt(1).text).toBe("beta\nmore");
    expect(ds.indexForId("s2")).toBe(1);
    expect(ds.indexForId("absent")).toBe(-1);
  });

  it("bumps the version only when the snippets array reference changes", () => {
    const first = [snippet("s1", "a")];
    const ds = new LensSnippetsDataSource(first);
    const v0 = ds.getVersion();
    ds.setInputsWithoutNotify(first); // same reference → no bump
    expect(ds.getVersion()).toBe(v0);
    ds.setInputsWithoutNotify([snippet("s1", "a"), snippet("s2", "b")]);
    expect(ds.getVersion()).not.toBe(v0);
    expect(ds.numberOfItems()).toBe(2);
  });
});
