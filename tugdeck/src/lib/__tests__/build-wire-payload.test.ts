/**
 * `build-wire-payload` — unit tests for the substrate → wire
 * flattener. Pure-logic coverage; no canvas, no DOM, no async.
 *
 * Pins the contract in [Spec S03](roadmap/tide-atoms.md#s03-build-wire-payload)
 * and the atom-type mapping in [List L03](roadmap/tide-atoms.md#l03-atom-to-wire-mapping).
 */

import { describe, expect, test } from "bun:test";

import { buildWirePayload } from "../build-wire-payload";
import { createAtomBytesStore } from "../atom-bytes-store";
import { TUG_ATOM_CHAR, type AtomSegment } from "../tug-atom-img";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const C = TUG_ATOM_CHAR; // shorthand for the U+FFFC sentinel

function imageAtom(label: string, id: string | undefined = undefined): AtomSegment {
  return {
    kind: "atom",
    type: "image",
    label,
    value: label,
    id,
  };
}

function fileAtom(path: string): AtomSegment {
  return { kind: "atom", type: "file", label: path, value: path };
}

function docAtom(path: string): AtomSegment {
  return { kind: "atom", type: "doc", label: path, value: path };
}

function linkAtom(url: string): AtomSegment {
  return { kind: "atom", type: "link", label: url, value: url };
}

function commandAtom(name: string): AtomSegment {
  return { kind: "atom", type: "command", label: name, value: name };
}

// ---------------------------------------------------------------------------
// Empty / trivial cases
// ---------------------------------------------------------------------------

describe("buildWirePayload — empty / trivial", () => {
  test("empty text + no atoms → empty wireText + no attachments", () => {
    const store = createAtomBytesStore();
    expect(buildWirePayload("", [], store)).toEqual({
      wireText: "",
      attachments: [],
    });
  });

  test("plain text + no atoms → text passes through verbatim", () => {
    const store = createAtomBytesStore();
    expect(buildWirePayload("hello, claude", [], store)).toEqual({
      wireText: "hello, claude",
      attachments: [],
    });
  });

  test("text with no atoms but a stray U+FFFC passes through (defensive)", () => {
    // Substrate invariant should prevent this; verifying the
    // defensive fallback rather than a crash or silent drop.
    const store = createAtomBytesStore();
    expect(buildWirePayload(`prefix${C}suffix`, [], store)).toEqual({
      wireText: `prefix${C}suffix`,
      attachments: [],
    });
  });
});

// ---------------------------------------------------------------------------
// File / doc / link / command atom substitution
// ---------------------------------------------------------------------------

describe("buildWirePayload — non-image atom substitution", () => {
  test("single file atom substitutes its value into the text", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `Read ${C} please.`,
      [fileAtom("README.md")],
      store,
    );
    expect(result.wireText).toBe("Read README.md please.");
    expect(result.attachments).toEqual([]);
  });

  test("multiple file atoms substitute in document order", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `Compare ${C} and ${C}.`,
      [fileAtom("a.ts"), fileAtom("b.ts")],
      store,
    );
    expect(result.wireText).toBe("Compare a.ts and b.ts.");
    expect(result.attachments).toEqual([]);
  });

  test("doc atom substitutes like a file atom", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `Read ${C}.`,
      [docAtom("docs/intro.md")],
      store,
    );
    expect(result.wireText).toBe("Read docs/intro.md.");
    expect(result.attachments).toEqual([]);
  });

  test("link atom substitutes its URL", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `See ${C}.`,
      [linkAtom("https://example.com/x")],
      store,
    );
    expect(result.wireText).toBe("See https://example.com/x.");
    expect(result.attachments).toEqual([]);
  });

  test("command atom substitutes its name", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `Run ${C}`,
      [commandAtom("/help")],
      store,
    );
    expect(result.wireText).toBe("Run /help");
    expect(result.attachments).toEqual([]);
  });

  test("atoms at boundaries (start, end) substitute correctly", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `${C} and ${C}`,
      [fileAtom("a.ts"), fileAtom("b.ts")],
      store,
    );
    expect(result.wireText).toBe("a.ts and b.ts");
  });

  test("adjacent atoms with no intervening text", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `${C}${C}${C}`,
      [fileAtom("x"), fileAtom("y"), fileAtom("z")],
      store,
    );
    expect(result.wireText).toBe("xyz");
  });
});

// ---------------------------------------------------------------------------
// Image atom + bytes-store
// ---------------------------------------------------------------------------

describe("buildWirePayload — image attachments", () => {
  test("image atom with bytes emits an Attachment + substitutes filename", () => {
    const store = createAtomBytesStore();
    store.put("img-1", { content: "iVBORw0KGgo=", mediaType: "image/png" });
    const result = buildWirePayload(
      `Look at ${C}.`,
      [imageAtom("shot.png", "img-1")],
      store,
    );
    expect(result.wireText).toBe("Look at shot.png.");
    expect(result.attachments).toEqual([
      {
        filename: "shot.png",
        content: "iVBORw0KGgo=",
        media_type: "image/png",
      },
    ]);
  });

  test("multiple image atoms emit Attachments in document order", () => {
    const store = createAtomBytesStore();
    store.put("a", { content: "AAA=", mediaType: "image/png" });
    store.put("b", { content: "BBB=", mediaType: "image/jpeg" });
    const result = buildWirePayload(
      `${C} vs ${C}`,
      [imageAtom("a.png", "a"), imageAtom("b.jpg", "b")],
      store,
    );
    expect(result.wireText).toBe("a.png vs b.jpg");
    expect(result.attachments).toEqual([
      { filename: "a.png", content: "AAA=", media_type: "image/png" },
      { filename: "b.jpg", content: "BBB=", media_type: "image/jpeg" },
    ]);
  });

  test("image atom without an id contributes text only, no Attachment", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `Decoration: ${C}`,
      [imageAtom("decor.png")], // no id
      store,
    );
    expect(result.wireText).toBe("Decoration: decor.png");
    expect(result.attachments).toEqual([]);
  });

  test("image atom whose id is missing from the store contributes text only", () => {
    // User dropped, then deleted the atom; bytes evicted. Or the
    // bytes write never completed (defensive — shouldn't happen
    // today, but the contract handles it).
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `${C}`,
      [imageAtom("missing.png", "evicted-id")],
      store,
    );
    expect(result.wireText).toBe("missing.png");
    expect(result.attachments).toEqual([]);
  });

  test("mixed image-with-bytes + image-without-bytes — only the present one becomes an Attachment", () => {
    const store = createAtomBytesStore();
    store.put("present-id", { content: "X", mediaType: "image/png" });
    const result = buildWirePayload(
      `${C} and ${C}`,
      [
        imageAtom("good.png", "present-id"),
        imageAtom("missing.png", "evicted-id"),
      ],
      store,
    );
    expect(result.wireText).toBe("good.png and missing.png");
    expect(result.attachments).toEqual([
      { filename: "good.png", content: "X", media_type: "image/png" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Text-file atom with bytes (Finder drop of a .md / .ts / .json)
// ---------------------------------------------------------------------------

describe("buildWirePayload — text-file attachments", () => {
  test("file atom with id + text bytes → Attachment with raw text content", () => {
    const store = createAtomBytesStore();
    store.put("doc-1", {
      content: "# Heading\n\nBody text.",
      mediaType: "text/markdown",
    });
    const result = buildWirePayload(
      `Read this: ${C}`,
      [
        {
          kind: "atom",
          type: "file",
          label: "notes.md",
          value: "notes.md",
          id: "doc-1",
        },
      ],
      store,
    );
    expect(result.wireText).toBe("Read this: notes.md");
    expect(result.attachments).toEqual([
      {
        filename: "notes.md",
        content: "# Heading\n\nBody text.",
        media_type: "text/markdown",
      },
    ]);
  });

  test("file atom without id stays text-only (workspace @-mention case)", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `@${C} for context`,
      [
        {
          kind: "atom",
          type: "file",
          label: "src/main.ts",
          value: "src/main.ts",
          // no id — workspace @-completion path
        },
      ],
      store,
    );
    expect(result.wireText).toBe("@src/main.ts for context");
    expect(result.attachments).toEqual([]);
  });

  test("mixed image + text-file with bytes → both emit Attachments", () => {
    const store = createAtomBytesStore();
    store.put("img", { content: "PNG-B64", mediaType: "image/png" });
    store.put("txt", {
      content: '{"key": "value"}',
      mediaType: "application/json",
    });
    const result = buildWirePayload(
      `Compare ${C} with ${C}`,
      [
        {
          kind: "atom",
          type: "image",
          label: "diagram.png",
          value: "diagram.png",
          id: "img",
        },
        {
          kind: "atom",
          type: "file",
          label: "data.json",
          value: "data.json",
          id: "txt",
        },
      ],
      store,
    );
    expect(result.wireText).toBe("Compare diagram.png with data.json");
    expect(result.attachments).toEqual([
      { filename: "diagram.png", content: "PNG-B64", media_type: "image/png" },
      { filename: "data.json", content: '{"key": "value"}', media_type: "application/json" },
    ]);
  });

  test("text-file atom whose bytes are evicted falls back to text-only", () => {
    const store = createAtomBytesStore();
    // No put() for "evicted" — simulate eviction or never-inserted.
    const result = buildWirePayload(
      `${C}`,
      [
        {
          kind: "atom",
          type: "file",
          label: "missing.md",
          value: "missing.md",
          id: "evicted",
        },
      ],
      store,
    );
    expect(result.wireText).toBe("missing.md");
    expect(result.attachments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mixed atom-type sequences
// ---------------------------------------------------------------------------

describe("buildWirePayload — mixed atom sequences", () => {
  test("image + file + image — text substitutes all; attachments only for images", () => {
    const store = createAtomBytesStore();
    store.put("a", { content: "AAA=", mediaType: "image/png" });
    store.put("c", { content: "CCC=", mediaType: "image/jpeg" });
    const result = buildWirePayload(
      `${C} ${C} ${C}`,
      [
        imageAtom("a.png", "a"),
        fileAtom("README.md"),
        imageAtom("c.jpg", "c"),
      ],
      store,
    );
    expect(result.wireText).toBe("a.png README.md c.jpg");
    expect(result.attachments).toEqual([
      { filename: "a.png", content: "AAA=", media_type: "image/png" },
      { filename: "c.jpg", content: "CCC=", media_type: "image/jpeg" },
    ]);
  });

  test("realistic prompt with leading text and one image atom", () => {
    const store = createAtomBytesStore();
    store.put("shot", { content: "PNG-DATA", mediaType: "image/png" });
    const result = buildWirePayload(
      `Summarize this screenshot: ${C}`,
      [imageAtom("design.png", "shot")],
      store,
    );
    expect(result.wireText).toBe("Summarize this screenshot: design.png");
    expect(result.attachments).toEqual([
      { filename: "design.png", content: "PNG-DATA", media_type: "image/png" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Defensive: atom count mismatches
// ---------------------------------------------------------------------------

describe("buildWirePayload — defensive count handling", () => {
  test("atoms.length < count(U+FFFC) — extra placeholders pass through verbatim", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `${C} ${C} ${C}`,
      [fileAtom("only-one.ts")],
      store,
    );
    // First placeholder gets the atom; the next two pass through
    // as literal U+FFFC characters.
    expect(result.wireText).toBe(`only-one.ts ${C} ${C}`);
  });

  test("atoms.length > count(U+FFFC) — extra atoms are dropped", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `Just ${C}.`,
      [fileAtom("a.ts"), fileAtom("b.ts"), fileAtom("c.ts")],
      store,
    );
    // Only the first atom is consumed; siblings are dropped because
    // their positions don't exist.
    expect(result.wireText).toBe("Just a.ts.");
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("buildWirePayload — purity", () => {
  test("does not mutate the input atoms array", () => {
    const store = createAtomBytesStore();
    store.put("img", { content: "X", mediaType: "image/png" });
    const atoms = [imageAtom("a.png", "img"), fileAtom("b.ts")];
    const snapshot = atoms.map((a) => ({ ...a }));
    buildWirePayload(`${C} ${C}`, atoms, store);
    expect(atoms).toEqual(snapshot);
  });

  test("does not mutate the bytes-store", () => {
    const store = createAtomBytesStore();
    store.put("a", { content: "AAA=", mediaType: "image/png" });
    const before = store.snapshot();
    buildWirePayload(`${C}`, [imageAtom("a.png", "a")], store);
    expect(store.snapshot()).toEqual(before);
  });

  test("same inputs yield deeply-equal outputs across calls", () => {
    const store = createAtomBytesStore();
    store.put("img", { content: "X", mediaType: "image/png" });
    const atoms: ReadonlyArray<AtomSegment> = [imageAtom("a.png", "img")];
    const a = buildWirePayload(`${C}`, atoms, store);
    const b = buildWirePayload(`${C}`, atoms, store);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Output stability
// ---------------------------------------------------------------------------

describe("buildWirePayload — output shape stability", () => {
  test("attachments array order matches atoms' document order", () => {
    const store = createAtomBytesStore();
    store.put("third", { content: "3", mediaType: "image/png" });
    store.put("first", { content: "1", mediaType: "image/png" });
    store.put("second", { content: "2", mediaType: "image/png" });
    const result = buildWirePayload(
      `${C} ${C} ${C}`,
      [
        imageAtom("1.png", "first"),
        imageAtom("2.png", "second"),
        imageAtom("3.png", "third"),
      ],
      store,
    );
    expect(result.attachments.map((a) => a.content)).toEqual(["1", "2", "3"]);
  });

  test("wireText preserves non-ASCII characters around atoms", () => {
    const store = createAtomBytesStore();
    const result = buildWirePayload(
      `🚀 ${C} — “quoted” ${C}.`,
      [fileAtom("a.ts"), fileAtom("b.ts")],
      store,
    );
    expect(result.wireText).toBe(`🚀 a.ts — “quoted” b.ts.`);
  });
});
