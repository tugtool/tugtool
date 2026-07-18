import { describe, expect, test } from "bun:test";
import {
  type SnippetsDoc,
  type SnippetsFrame,
  applyCreate,
  applyDelete,
  applyOrder,
  applyUpdate,
  emptyDoc,
  emptyUndo,
  mergeForeignDoc,
  newSnippetId,
  parseSnippetsFrame,
  pushUndo,
  redo,
  shouldIgnoreFrame,
  snippetIncipit,
  undo,
} from "../lib/snippets-doc";

function doc(...ids: string[]): SnippetsDoc {
  return {
    version: 1,
    snippets: ids.map((id) => ({ id, text: `body of ${id}` })),
  };
}

function encodeFrame(frame: SnippetsFrame): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(frame));
}

describe("document transforms", () => {
  test("applyCreate inserts after the given id", () => {
    const { doc: next, id } = applyCreate(doc("a", "b"), "a", "sn_new");
    expect(next.snippets.map((s) => s.id)).toEqual(["a", "sn_new", "b"]);
    expect(id).toBe("sn_new");
  });

  test("applyCreate with null afterId appends", () => {
    const { doc: next } = applyCreate(doc("a"), null, "sn_new");
    expect(next.snippets.map((s) => s.id)).toEqual(["a", "sn_new"]);
  });

  test("applyUpdate sets text", () => {
    const next = applyUpdate(doc("a"), "a", "X");
    expect(next.snippets[0]).toEqual({ id: "a", text: "X" });
  });

  test("applyDelete returns successor selection", () => {
    const { doc: next, nextSelected } = applyDelete(doc("a", "b", "c"), "b");
    expect(next.snippets.map((s) => s.id)).toEqual(["a", "c"]);
    expect(nextSelected).toBe("c");
  });

  test("applyDelete of last row selects the new last row", () => {
    const { nextSelected } = applyDelete(doc("a", "b"), "b");
    expect(nextSelected).toBe("a");
  });

  test("applyOrder is a splice to the given permutation", () => {
    const next = applyOrder(doc("a", "b", "c"), ["c", "a", "b"]);
    expect(next.snippets.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});

describe("undo/redo", () => {
  test("delete then undo restores the snippet", () => {
    const original = doc("a", "b");
    let stack = pushUndo(emptyUndo(), original);
    const afterDelete = applyDelete(original, "a").doc;
    const undone = undo(stack, afterDelete);
    expect(undone).not.toBeNull();
    expect(undone!.doc.snippets.map((s) => s.id)).toEqual(["a", "b"]);
    // redo returns to the deleted state.
    const redone = redo(undone!.stack, undone!.doc);
    expect(redone!.doc.snippets.map((s) => s.id)).toEqual(["b"]);
  });

  test("a typing burst coalesces to one undo entry at commit", () => {
    // Simulate the store's begin/commit bracket: while editing, updates do not
    // push undo; commit pushes exactly one entry (the pre-edit baseline).
    const baseline = doc("a");
    let live = baseline;
    live = applyUpdate(live, "a", "h");
    live = applyUpdate(live, "a", "he");
    live = applyUpdate(live, "a", "hello");
    // Commit: push the single baseline.
    const stack = pushUndo(emptyUndo(), baseline);
    expect(stack.past.length).toBe(1);
    const undone = undo(stack, live);
    expect(undone!.doc.snippets[0].text).toBe("body of a");
  });

  test("undo returns null when there is nothing to undo", () => {
    expect(undo(emptyUndo(), doc("a"))).toBeNull();
  });
});

describe("frame decisions", () => {
  test("shouldIgnoreFrame suppresses the echo of our own write", () => {
    const frame: SnippetsFrame = { doc: doc("a"), hash: "abc", error: null };
    expect(shouldIgnoreFrame(frame, "abc")).toBe(true);
    expect(shouldIgnoreFrame(frame, "def")).toBe(false);
    expect(shouldIgnoreFrame(frame, null)).toBe(false);
  });

  test("mergeForeignDoc preserves the open row's local content", () => {
    const local: SnippetsDoc = {
      version: 1,
      snippets: [
        { id: "a", text: "local editing" },
        { id: "b", text: "local-b" },
      ],
    };
    const foreign: SnippetsDoc = {
      version: 1,
      snippets: [
        { id: "a", text: "foreign-a" },
        { id: "b", text: "foreign-b" },
      ],
    };
    const merged = mergeForeignDoc(local, foreign, "a");
    // Open row 'a' keeps local content; row 'b' takes foreign.
    expect(merged.snippets.find((s) => s.id === "a")).toEqual({
      id: "a",
      text: "local editing",
    });
    expect(merged.snippets.find((s) => s.id === "b")!.text).toBe("foreign-b");
  });

  test("mergeForeignDoc with no open row takes foreign wholesale", () => {
    const merged = mergeForeignDoc(doc("a"), doc("a", "b"), null);
    expect(merged.snippets.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("mergeForeignDoc re-appends an open row the foreign doc dropped", () => {
    const local: SnippetsDoc = {
      version: 1,
      snippets: [{ id: "a", text: "mine" }],
    };
    const merged = mergeForeignDoc(local, doc("b"), "a");
    expect(merged.snippets.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("parseSnippetsFrame", () => {
  test("round-trips a valid frame", () => {
    const frame: SnippetsFrame = { doc: doc("a"), hash: "h", error: null };
    const parsed = parseSnippetsFrame(encodeFrame(frame));
    expect(parsed).not.toBeNull();
    expect(parsed!.doc.snippets[0].id).toBe("a");
    expect(parsed!.hash).toBe("h");
  });

  test("returns null for malformed payloads", () => {
    expect(parseSnippetsFrame(new TextEncoder().encode("not json"))).toBeNull();
    expect(parseSnippetsFrame(new TextEncoder().encode("{}"))).toBeNull();
    expect(
      parseSnippetsFrame(new TextEncoder().encode('{"doc":{"version":1}}')),
    ).toBeNull();
  });
});

describe("helpers", () => {
  test("snippetIncipit is the opening line of the text", () => {
    expect(snippetIncipit({ id: "a", text: "first\nsecond" })).toBe("first");
    expect(snippetIncipit({ id: "a", text: "  padded opening  \nmore" })).toBe("padded opening");
    expect(snippetIncipit({ id: "a", text: "" })).toBe("");
  });

  test("newSnippetId is sn_ + 12 hex chars", () => {
    const id = newSnippetId();
    expect(id).toMatch(/^sn_[0-9a-f]{12}$/);
    expect(newSnippetId()).not.toBe(id);
  });

  test("emptyDoc is version 1 with no snippets", () => {
    expect(emptyDoc()).toEqual({ version: 1, snippets: [] });
  });
});
