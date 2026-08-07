import { describe, expect, test } from "bun:test";
import {
  type JotsDoc,
  type JotsFrame,
  applyCreate,
  applyDelete,
  applyOrder,
  applyUpdate,
  emptyDoc,
  emptyUndo,
  mergeForeignDoc,
  newJotId,
  parseJotsFrame,
  pushUndo,
  redo,
  shouldIgnoreFrame,
  jotIncipit,
  undo,
} from "../lib/jots-doc";

function doc(...ids: string[]): JotsDoc {
  return {
    version: 1,
    jots: ids.map((id) => ({ id, text: `body of ${id}` })),
  };
}

function encodeFrame(frame: JotsFrame): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(frame));
}

describe("document transforms", () => {
  test("applyCreate inserts after the given id", () => {
    const { doc: next, id } = applyCreate(doc("a", "b"), "a", "jt_new");
    expect(next.jots.map((s) => s.id)).toEqual(["a", "jt_new", "b"]);
    expect(id).toBe("jt_new");
  });

  test("applyCreate with null afterId appends", () => {
    const { doc: next } = applyCreate(doc("a"), null, "jt_new");
    expect(next.jots.map((s) => s.id)).toEqual(["a", "jt_new"]);
  });

  test("applyUpdate sets text", () => {
    const next = applyUpdate(doc("a"), "a", "X");
    expect(next.jots[0]).toEqual({ id: "a", text: "X" });
  });

  test("applyDelete returns successor selection", () => {
    const { doc: next, nextSelected } = applyDelete(doc("a", "b", "c"), "b");
    expect(next.jots.map((s) => s.id)).toEqual(["a", "c"]);
    expect(nextSelected).toBe("c");
  });

  test("applyDelete of last row selects the new last row", () => {
    const { nextSelected } = applyDelete(doc("a", "b"), "b");
    expect(nextSelected).toBe("a");
  });

  test("applyOrder is a splice to the given permutation", () => {
    const next = applyOrder(doc("a", "b", "c"), ["c", "a", "b"]);
    expect(next.jots.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});

describe("undo/redo", () => {
  test("delete then undo restores the jot", () => {
    const original = doc("a", "b");
    let stack = pushUndo(emptyUndo(), original);
    const afterDelete = applyDelete(original, "a").doc;
    const undone = undo(stack, afterDelete);
    expect(undone).not.toBeNull();
    expect(undone!.doc.jots.map((s) => s.id)).toEqual(["a", "b"]);
    // redo returns to the deleted state.
    const redone = redo(undone!.stack, undone!.doc);
    expect(redone!.doc.jots.map((s) => s.id)).toEqual(["b"]);
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
    expect(undone!.doc.jots[0].text).toBe("body of a");
  });

  test("undo returns null when there is nothing to undo", () => {
    expect(undo(emptyUndo(), doc("a"))).toBeNull();
  });
});

describe("frame decisions", () => {
  test("shouldIgnoreFrame suppresses the echo of our own write", () => {
    const frame: JotsFrame = { doc: doc("a"), hash: "abc", error: null };
    expect(shouldIgnoreFrame(frame, "abc")).toBe(true);
    expect(shouldIgnoreFrame(frame, "def")).toBe(false);
    expect(shouldIgnoreFrame(frame, null)).toBe(false);
  });

  test("mergeForeignDoc preserves the open row's local content", () => {
    const local: JotsDoc = {
      version: 1,
      jots: [
        { id: "a", text: "local editing" },
        { id: "b", text: "local-b" },
      ],
    };
    const foreign: JotsDoc = {
      version: 1,
      jots: [
        { id: "a", text: "foreign-a" },
        { id: "b", text: "foreign-b" },
      ],
    };
    const merged = mergeForeignDoc(local, foreign, "a");
    // Open row 'a' keeps local content; row 'b' takes foreign.
    expect(merged.jots.find((s) => s.id === "a")).toEqual({
      id: "a",
      text: "local editing",
    });
    expect(merged.jots.find((s) => s.id === "b")!.text).toBe("foreign-b");
  });

  test("mergeForeignDoc with no open row takes foreign wholesale", () => {
    const merged = mergeForeignDoc(doc("a"), doc("a", "b"), null);
    expect(merged.jots.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("mergeForeignDoc re-appends an open row the foreign doc dropped", () => {
    const local: JotsDoc = {
      version: 1,
      jots: [{ id: "a", text: "mine" }],
    };
    const merged = mergeForeignDoc(local, doc("b"), "a");
    expect(merged.jots.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("parseJotsFrame", () => {
  test("round-trips a valid frame", () => {
    const frame: JotsFrame = { doc: doc("a"), hash: "h", error: null };
    const parsed = parseJotsFrame(encodeFrame(frame));
    expect(parsed).not.toBeNull();
    expect(parsed!.doc.jots[0].id).toBe("a");
    expect(parsed!.hash).toBe("h");
  });

  test("returns null for malformed payloads", () => {
    expect(parseJotsFrame(new TextEncoder().encode("not json"))).toBeNull();
    expect(parseJotsFrame(new TextEncoder().encode("{}"))).toBeNull();
    expect(
      parseJotsFrame(new TextEncoder().encode('{"doc":{"version":1}}')),
    ).toBeNull();
  });
});

describe("helpers", () => {
  test("jotIncipit is the opening line of the text", () => {
    expect(jotIncipit({ id: "a", text: "first\nsecond" })).toBe("first");
    expect(jotIncipit({ id: "a", text: "  padded opening  \nmore" })).toBe("padded opening");
    expect(jotIncipit({ id: "a", text: "" })).toBe("");
  });

  test("newJotId is jt_ + 12 hex chars", () => {
    const id = newJotId();
    expect(id).toMatch(/^jt_[0-9a-f]{12}$/);
    expect(newJotId()).not.toBe(id);
  });

  test("emptyDoc is version 1 with no jots", () => {
    expect(emptyDoc()).toEqual({ version: 1, jots: [] });
  });
});
