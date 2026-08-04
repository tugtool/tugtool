/**
 * arrow-release — the policy deciding when a focused text surface hands an arrow
 * back to the spatial plane ([P03]). Pure: the subjects are hand-built, since
 * tugdeck's `bun test` has no DOM. The DOM adapter that produces real subjects is
 * covered end-to-end by the Lens and picker traversal app-tests.
 */

import { describe, expect, test } from "bun:test";

import { resolveArrowRelease } from "../arrow-release";
import type { ArrowReleaseSubject } from "../arrow-release";
import type { SpatialDirection } from "../spatial-order";

const DIRECTIONS: SpatialDirection[] = ["up", "down", "left", "right"];

function subject(overrides: Partial<ArrowReleaseSubject> = {}): ArrowReleaseSubject {
  return {
    tag: "INPUT",
    contentEditable: false,
    inputType: "text",
    value: "",
    releaseAttr: null,
    inKeyView: true,
    ...overrides,
  };
}

describe("resolveArrowRelease — non-text surfaces", () => {
  test("no active element is not a text surface", () => {
    expect(resolveArrowRelease(null, "down")).toBe("not-text");
  });

  test("an ordinary element is not a text surface", () => {
    const button = subject({ tag: "BUTTON", inputType: null, value: null });
    expect(resolveArrowRelease(button, "down")).toBe("not-text");
  });
});

describe("resolveArrowRelease — the explicit attribute is authoritative", () => {
  test("only the listed directions release", () => {
    const editor = subject({
      tag: "DIV",
      contentEditable: true,
      inputType: null,
      value: null,
      releaseAttr: "up down",
    });
    expect(resolveArrowRelease(editor, "up")).toBe("released");
    expect(resolveArrowRelease(editor, "down")).toBe("released");
    expect(resolveArrowRelease(editor, "left")).toBe("held");
    expect(resolveArrowRelease(editor, "right")).toBe("held");
  });

  test("an empty-string attribute releases nothing, overriding the automatic rule", () => {
    // An empty textual input would auto-release; a substrate that projects the
    // attribute owns every one of its exits, so the attribute wins.
    const held = subject({ releaseAttr: "" });
    for (const dir of DIRECTIONS) expect(resolveArrowRelease(held, dir)).toBe("held");
  });
});

describe("resolveArrowRelease — the automatic empty-field rule", () => {
  test("an empty textual input inside the key view releases all four directions", () => {
    const field = subject();
    for (const dir of DIRECTIONS) expect(resolveArrowRelease(field, dir)).toBe("released");
  });

  test("an input with no type attribute counts as textual", () => {
    expect(resolveArrowRelease(subject({ inputType: null }), "down")).toBe("released");
  });

  test("every textual type releases; a non-textual type never does", () => {
    for (const type of ["text", "search", "url", "email", "tel"]) {
      expect(resolveArrowRelease(subject({ inputType: type }), "down")).toBe("released");
    }
    expect(resolveArrowRelease(subject({ inputType: "number" }), "down")).toBe("held");
    expect(resolveArrowRelease(subject({ inputType: "range" }), "down")).toBe("held");
  });

  test("a field with text keeps every arrow for its caret", () => {
    const typed = subject({ value: "a" });
    for (const dir of DIRECTIONS) expect(resolveArrowRelease(typed, dir)).toBe("held");
  });

  test("an empty field outside the key view holds — the stale-key-view guard", () => {
    expect(resolveArrowRelease(subject({ inKeyView: false }), "down")).toBe("held");
  });

  test("multi-line surfaces without the attribute always hold", () => {
    const textarea = subject({ tag: "TEXTAREA", inputType: null, value: null });
    const editable = subject({
      tag: "DIV",
      contentEditable: true,
      inputType: null,
      value: null,
    });
    for (const dir of DIRECTIONS) {
      expect(resolveArrowRelease(textarea, dir)).toBe("held");
      expect(resolveArrowRelease(editable, dir)).toBe("held");
    }
  });
});
