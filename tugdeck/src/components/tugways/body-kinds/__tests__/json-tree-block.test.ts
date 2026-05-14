/**
 * Pure-logic tests for `JsonTreeBlock`'s JSON-value model helpers.
 *
 * `JsonTreeBlock`'s behaviour is its exported pure helpers — value
 * classification, child-path construction, the expand resolver, leaf
 * formatting, and the Copy serializer. These are what the suite pins:
 *
 *  - `jsonValueType` / `isJsonContainer` / `jsonEntries` — the value
 *    model. "Renders a nested object correctly" is gated here: the
 *    renderer walks `jsonEntries` recursively, so a correct entry
 *    model is a correct render.
 *  - `resolveJsonExpanded` — "collapse beyond default depth shows an
 *    expand affordance": depth `< defaultDepth` resolves expanded,
 *    `>= defaultDepth` resolves collapsed (→ the row paints a twist).
 *  - `childJsonPath` — "copy-as-path produces the correct path
 *    string": `data[0].id`, bracket-quoting for non-identifier keys.
 *  - `formatJsonLeaf` / `stringifyJson` — display + Copy text.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests. "No text-entry
 * element in the rendered subtree" (the single-text-entry rule) is
 * satisfied by construction — the component's JSX renders only
 * `div` / `span` / `TugIconButton` / `BlockCopyButton`, never an
 * `input` / `textarea` / contenteditable — and is verified by code
 * inspection rather than a render assertion.
 */

import { describe, expect, test } from "bun:test";

import {
  childJsonPath,
  formatJsonLeaf,
  isJsonContainer,
  jsonEntries,
  jsonValueType,
  resolveJsonExpanded,
  stringifyJson,
  type JsonExpandMode,
} from "../json-tree-block";

// ---------------------------------------------------------------------------
// jsonValueType / isJsonContainer
// ---------------------------------------------------------------------------

describe("jsonValueType", () => {
  test("classifies the six JSON value classes", () => {
    expect(jsonValueType({})).toBe("object");
    expect(jsonValueType([])).toBe("array");
    expect(jsonValueType("s")).toBe("string");
    expect(jsonValueType(42)).toBe("number");
    expect(jsonValueType(true)).toBe("boolean");
    expect(jsonValueType(null)).toBe("null");
  });

  test("null is not an object; arrays are not plain objects", () => {
    expect(jsonValueType(null)).not.toBe("object");
    expect(jsonValueType([1, 2])).toBe("array");
    expect(jsonValueType({ length: 0 })).toBe("object");
  });

  test("a non-JSON unknown degrades to string rather than throwing", () => {
    expect(jsonValueType(undefined)).toBe("string");
    expect(jsonValueType(BigInt(1))).toBe("string");
  });
});

describe("isJsonContainer", () => {
  test("object and array are containers; scalars and null are not", () => {
    expect(isJsonContainer({})).toBe(true);
    expect(isJsonContainer([])).toBe(true);
    expect(isJsonContainer("s")).toBe(false);
    expect(isJsonContainer(0)).toBe(false);
    expect(isJsonContainer(false)).toBe(false);
    expect(isJsonContainer(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// jsonEntries — the value model the renderer walks
// ---------------------------------------------------------------------------

describe("jsonEntries", () => {
  test("array entries are index-keyed in order", () => {
    expect(jsonEntries(["a", "b"])).toEqual([
      { key: 0, value: "a" },
      { key: 1, value: "b" },
    ]);
  });

  test("object entries are prop-keyed in own-enumerable order", () => {
    expect(jsonEntries({ b: 2, a: 1 })).toEqual([
      { key: "b", value: 2 },
      { key: "a", value: 1 },
    ]);
  });

  test("non-containers yield no entries", () => {
    expect(jsonEntries("s")).toEqual([]);
    expect(jsonEntries(7)).toEqual([]);
    expect(jsonEntries(null)).toEqual([]);
  });

  test("renders a nested object correctly — the entry model recurses", () => {
    const data = {
      response: { data: [{ id: "x1" }, { id: "x2" }], ok: true },
    };
    // Root → one entry `response` (object).
    const [root] = jsonEntries(data);
    expect(root.key).toBe("response");
    expect(jsonValueType(root.value)).toBe("object");
    // `response` → `data` (array) + `ok` (boolean).
    const responseEntries = jsonEntries(root.value);
    expect(responseEntries.map((e) => e.key)).toEqual(["data", "ok"]);
    expect(jsonValueType(responseEntries[0].value)).toBe("array");
    expect(jsonValueType(responseEntries[1].value)).toBe("boolean");
    // `data` → two index-keyed object entries.
    const dataEntries = jsonEntries(responseEntries[0].value);
    expect(dataEntries.map((e) => e.key)).toEqual([0, 1]);
    // `data[0]` → `id` leaf.
    const [idEntry] = jsonEntries(dataEntries[0].value);
    expect(idEntry).toEqual({ key: "id", value: "x1" });
  });
});

// ---------------------------------------------------------------------------
// formatJsonLeaf
// ---------------------------------------------------------------------------

describe("formatJsonLeaf", () => {
  test("strings keep JSON quotes and escaping", () => {
    expect(formatJsonLeaf("hello")).toBe('"hello"');
    expect(formatJsonLeaf("a\nb")).toBe('"a\\nb"');
    expect(formatJsonLeaf("")).toBe('""');
  });

  test("number / boolean / null render bare", () => {
    expect(formatJsonLeaf(42)).toBe("42");
    expect(formatJsonLeaf(-0.5)).toBe("-0.5");
    expect(formatJsonLeaf(true)).toBe("true");
    expect(formatJsonLeaf(false)).toBe("false");
    expect(formatJsonLeaf(null)).toBe("null");
  });
});

// ---------------------------------------------------------------------------
// childJsonPath — copy-as-path
// ---------------------------------------------------------------------------

describe("childJsonPath", () => {
  test("array indices use bracket notation", () => {
    expect(childJsonPath("data", 0)).toBe("data[0]");
    expect(childJsonPath("", 3)).toBe("[3]");
  });

  test("identifier-safe object keys use dot notation; bare at the root", () => {
    expect(childJsonPath("", "response")).toBe("response");
    expect(childJsonPath("response", "data")).toBe("response.data");
    expect(childJsonPath("response", "_private$1")).toBe("response._private$1");
  });

  test("non-identifier keys use bracket-quoted notation", () => {
    expect(childJsonPath("headers", "content-type")).toBe(
      'headers["content-type"]',
    );
    expect(childJsonPath("m", "has space")).toBe('m["has space"]');
    expect(childJsonPath("m", "1leading-digit")).toBe('m["1leading-digit"]');
  });

  test("composes the worked example response.data[0].id", () => {
    const p1 = childJsonPath("", "response");
    const p2 = childJsonPath(p1, "data");
    const p3 = childJsonPath(p2, 0);
    const p4 = childJsonPath(p3, "id");
    expect(p4).toBe("response.data[0].id");
  });
});

// ---------------------------------------------------------------------------
// resolveJsonExpanded — the expand resolver
// ---------------------------------------------------------------------------

describe("resolveJsonExpanded", () => {
  const NO_OVERRIDES = new Map<string, boolean>();
  const DEPTH: JsonExpandMode = "depth";

  test("depth mode: shallow nodes expand, nodes at/below defaultDepth collapse", () => {
    // defaultDepth 3 → depths 0,1,2 expanded; 3,4,… collapsed → the
    // row paints a twist (the expand affordance).
    expect(resolveJsonExpanded("a", 0, 3, DEPTH, NO_OVERRIDES)).toBe(true);
    expect(resolveJsonExpanded("a", 2, 3, DEPTH, NO_OVERRIDES)).toBe(true);
    expect(resolveJsonExpanded("a", 3, 3, DEPTH, NO_OVERRIDES)).toBe(false);
    expect(resolveJsonExpanded("a", 9, 3, DEPTH, NO_OVERRIDES)).toBe(false);
  });

  test("an explicit per-node override wins over every base mode", () => {
    const overrides = new Map([["a.b", true]]);
    // Override true beats the depth-default collapse at depth 5.
    expect(resolveJsonExpanded("a.b", 5, 3, DEPTH, overrides)).toBe(true);
    // Override false beats all-expanded.
    const collapsedOverride = new Map([["a.b", false]]);
    expect(
      resolveJsonExpanded("a.b", 0, 3, "all-expanded", collapsedOverride),
    ).toBe(false);
  });

  test("all-expanded expands every depth; all-collapsed leaves only the root", () => {
    expect(resolveJsonExpanded("x", 7, 3, "all-expanded", NO_OVERRIDES)).toBe(
      true,
    );
    // Collapse-all keeps the root (depth 0) open so the top-level keys
    // stay visible; everything below collapses.
    expect(resolveJsonExpanded("", 0, 3, "all-collapsed", NO_OVERRIDES)).toBe(
      true,
    );
    expect(resolveJsonExpanded("x", 1, 3, "all-collapsed", NO_OVERRIDES)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// stringifyJson — Copy serializer
// ---------------------------------------------------------------------------

describe("stringifyJson", () => {
  test("pretty-prints a value with two-space indentation", () => {
    expect(stringifyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  test("returns empty string for a value JSON cannot serialize", () => {
    expect(stringifyJson(undefined)).toBe("");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(stringifyJson(cyclic)).toBe("");
  });
});
