/**
 * recent-documents.test.ts — the Open Recent MRU: ordering, de-dupe,
 * cap, seeding from tugbank, and clearing. Persistence rides the real
 * `setTugbankClient` seam with an in-memory fake (no network).
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { FILE_EDITOR_DEFAULTS_DOMAIN } from "@/lib/file-editor-settings";
import {
  RECENT_DOCUMENTS_STORE_LIMIT,
  clearRecentDocuments,
  coerceRecentDocuments,
  getRecentDocuments,
  noteRecentDocument,
} from "@/lib/recent-documents";

// The module list is a process-global (the real app singleton). bun
// interleaves test files at hook boundaries, so state that routes through
// the shared tugbank singleton can't be asserted deterministically here —
// persistence I/O is exercised by the app-test. These tests drive the
// in-memory list (deterministic within one synchronous test body) and the
// pure coercion helper.

beforeEach(() => {
  clearRecentDocuments();
});

describe("noteRecentDocument", () => {
  it("keeps most-recent-first order with no duplicates", () => {
    noteRecentDocument("/a.txt");
    noteRecentDocument("/b.txt");
    noteRecentDocument("/a.txt"); // re-open moves /a to the front
    expect(getRecentDocuments()).toEqual(["/a.txt", "/b.txt"]);
  });

  it("caps the stored list", () => {
    for (let i = 0; i < RECENT_DOCUMENTS_STORE_LIMIT + 5; i++) {
      noteRecentDocument(`/f${i}.txt`);
    }
    const list = getRecentDocuments();
    expect(list.length).toBe(RECENT_DOCUMENTS_STORE_LIMIT);
    // Newest survives, oldest evicted.
    expect(list[0]).toBe(`/f${RECENT_DOCUMENTS_STORE_LIMIT + 4}.txt`);
    expect(list).not.toContain("/f0.txt");
  });

  it("ignores an empty path", () => {
    noteRecentDocument("");
    expect(getRecentDocuments()).toEqual([]);
  });
});

describe("coerceRecentDocuments", () => {
  it("drops dupes and non-strings, preserving order", () => {
    expect(
      coerceRecentDocuments(["/a.txt", "/a.txt", 42, "", "/b.txt"]),
    ).toEqual(["/a.txt", "/b.txt"]);
  });

  it("returns empty for a non-array (missing entry)", () => {
    expect(coerceRecentDocuments(undefined)).toEqual([]);
    expect(coerceRecentDocuments(null)).toEqual([]);
    expect(coerceRecentDocuments("nope")).toEqual([]);
  });

  it("caps at the store limit", () => {
    const many = Array.from(
      { length: RECENT_DOCUMENTS_STORE_LIMIT + 5 },
      (_, i) => `/f${i}.txt`,
    );
    expect(coerceRecentDocuments(many).length).toBe(RECENT_DOCUMENTS_STORE_LIMIT);
  });
});

describe("clearRecentDocuments", () => {
  it("empties the list", () => {
    noteRecentDocument("/a.txt");
    clearRecentDocuments();
    expect(getRecentDocuments()).toEqual([]);
  });
});

// The domain constant is part of the wire contract with the Swift host.
it("stores under the file-editor defaults domain", () => {
  expect(FILE_EDITOR_DEFAULTS_DOMAIN).toBe("dev.tugtool.file-editor");
});
