/**
 * snippets-store.test.ts — the `editingId` lifecycle on the real store.
 *
 * Drives a real `SnippetsStore` constructed with a null connection (the feed
 * stays inactive; the debounced `save` fires a caught, best-effort fetch that
 * never affects the synchronous snapshot). No mocks — the store's own methods
 * and snapshot are exercised directly.
 */

import { describe, expect, it } from "bun:test";

import { SnippetsStore } from "@/lib/snippets-store";

describe("SnippetsStore editingId", () => {
  it("is null on a fresh store", () => {
    const store = new SnippetsStore(null);
    expect(store.getSnapshot().editingId).toBeNull();
  });

  it("createSnippet creates and opens the new row", () => {
    const store = new SnippetsStore(null);
    const id = store.createSnippet(null);
    const snap = store.getSnapshot();
    expect(snap.doc.snippets.length).toBe(1);
    expect(snap.doc.snippets[0].id).toBe(id);
    expect(snap.editingId).toBe(id);
  });

  it("commitEdit clears the open row (a populated row survives)", () => {
    const store = new SnippetsStore(null);
    const id = store.createSnippet(null);
    store.updateSnippet(id, "There is a tide");
    expect(store.getSnapshot().editingId).toBe(id);
    store.commitEdit();
    expect(store.getSnapshot().editingId).toBeNull();
    expect(store.getSnapshot().doc.snippets.length).toBe(1);
  });

  it("discards a row left EMPTY on commit (create then escape without typing)", () => {
    const store = new SnippetsStore(null);
    const id = store.createSnippet(null);
    expect(store.getSnapshot().doc.snippets.length).toBe(1);
    // No text typed — closing the editor must not leave a blank row behind.
    store.commitEdit();
    expect(store.getSnapshot().editingId).toBeNull();
    expect(store.getSnapshot().doc.snippets.length).toBe(0);
  });

  it("discards an existing row cleared to empty (whitespace only) on commit", () => {
    const store = new SnippetsStore(null);
    const id = store.createSnippet(null);
    store.updateSnippet(id, "hello");
    store.commitEdit();
    expect(store.getSnapshot().doc.snippets.length).toBe(1);
    store.beginEdit(id);
    store.updateSnippet(id, "   ");
    store.commitEdit();
    expect(store.getSnapshot().doc.snippets.length).toBe(0);
  });

  it("beginEdit opens an existing row", () => {
    const store = new SnippetsStore(null);
    const id = store.createSnippet(null);
    store.updateSnippet(id, "kept");
    store.commitEdit();
    store.beginEdit(id);
    expect(store.getSnapshot().editingId).toBe(id);
  });

  it("a commit-then-create chain opens a distinct new row (⌘Return)", () => {
    const store = new SnippetsStore(null);
    const first = store.createSnippet(null);
    store.updateSnippet(first, "first");
    store.commitEdit();
    const second = store.createSnippet(first);
    expect(second).not.toBe(first);
    expect(store.getSnapshot().editingId).toBe(second);
    expect(store.getSnapshot().doc.snippets.length).toBe(2);
  });
});
