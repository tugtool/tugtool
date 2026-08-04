/**
 * keymap-editor-release — which arrow directions a text editor hands back to
 * the spatial plane, given its document, its latch, and whether its host took
 * over the exit. Pure policy; no EditorView, no DOM.
 *
 * The clause order is the load-bearing part. A host callback suppressing the
 * attribute entirely is what keeps the two exit paths from both firing: a
 * document-capture listener necessarily runs before CM6's handlers, so a
 * projected attribute would take the crossing press and the host handoff would
 * never happen.
 */

import { describe, expect, test } from "bun:test";

import { resolveEditorRelease } from "../keymap";

describe("resolveEditorRelease — a host that takes the exit owns every one", () => {
  test("nothing is projected, whatever the document or the latch says", () => {
    for (const docEmpty of [true, false]) {
      for (const armedEdge of ["start", "end", null] as const) {
        expect(
          resolveEditorRelease({
            hasHostExit: true,
            docEmpty,
            armedEdge,
            atArmedEdge: true,
          }),
        ).toBeNull();
      }
    }
  });
});

describe("resolveEditorRelease — an empty document is transparent", () => {
  test("all four directions release, with no latch press to pay", () => {
    expect(
      resolveEditorRelease({
        hasHostExit: false,
        docEmpty: true,
        armedEdge: null,
        atArmedEdge: false,
      }),
    ).toBe("up down left right");
  });
});

describe("resolveEditorRelease — the boundary latch", () => {
  test("an unarmed non-empty editor releases nothing", () => {
    expect(
      resolveEditorRelease({
        hasHostExit: false,
        docEmpty: false,
        armedEdge: null,
        atArmedEdge: false,
      }),
    ).toBeNull();
  });

  test("armed at the start releases Up only; armed at the end, Down only", () => {
    expect(
      resolveEditorRelease({
        hasHostExit: false,
        docEmpty: false,
        armedEdge: "start",
        atArmedEdge: true,
      }),
    ).toBe("up");
    expect(
      resolveEditorRelease({
        hasHostExit: false,
        docEmpty: false,
        armedEdge: "end",
        atArmedEdge: true,
      }),
    ).toBe("down");
  });

  test("a latch armed but no longer at its edge releases nothing", () => {
    // The caret moved off the boundary: the arming is stale and the editor is
    // opaque again, which is what stops a stale release from firing after an
    // edit carried the caret away.
    for (const armedEdge of ["start", "end"] as const) {
      expect(
        resolveEditorRelease({
          hasHostExit: false,
          docEmpty: false,
          armedEdge,
          atArmedEdge: false,
        }),
      ).toBeNull();
    }
  });
});
