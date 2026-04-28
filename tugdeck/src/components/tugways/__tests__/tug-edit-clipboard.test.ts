/**
 * tug-edit clipboard serialization — pure round-trip tests.
 *
 * Exercises `serializeClipboard`, `parseClipboardSidecar`, and
 * `parseClipboardHtml` in isolation. The DOM event handler that wraps
 * these helpers is exercised via the `tug-edit.test.tsx` integration
 * suite; this file proves the wire format itself is bidirectional and
 * rejects malformed payloads cleanly.
 *
 * Note: setup-rtl MUST be the first import (required because
 * `serializeClipboard` builds the html payload via `atomImgHTML`,
 * which calls `createAtomImgElement` → `getTokenValue` →
 * `getComputedStyle(document.body)`).
 */
import "../../../__tests__/setup-rtl";

import { describe, it, expect } from "bun:test";

import {
  parseClipboardHtml,
  parseClipboardSidecar,
  serializeClipboard,
} from "@/components/tugways/tug-edit/clipboard-filters";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";

// ---------------------------------------------------------------------------
// Canvas 2D shim — atom rendering measures glyph widths via a 2D
// context; happy-dom doesn't implement one. Mirrors `tug-edit.test.tsx`.
// ---------------------------------------------------------------------------

interface MinimalCtx2D {
  font: string;
  measureText(text: string): { width: number };
}

(() => {
  const probe = document.createElement("canvas");
  const proto = Object.getPrototypeOf(probe) as {
    getContext?: (type: string) => unknown;
  };
  const ctx: MinimalCtx2D = {
    font: "",
    measureText(text: string) {
      return { width: text.length * 7 };
    },
  };
  proto.getContext = function getContext(type: string): unknown {
    if (type === "2d") return ctx;
    return null;
  };
})();

const SAMPLE_FILE = {
  position: 2,
  segment: { kind: "atom" as const, type: "file", label: "main.ts", value: "/main.ts" },
};

const SAMPLE_LINK = {
  position: 5,
  segment: { kind: "atom" as const, type: "link", label: "ant", value: "https://anthropic.com" },
};

describe("serializeClipboard", () => {
  it("returns null sidecar when there are no atoms in the slice", () => {
    const out = serializeClipboard("hello world", [], 0);
    expect(out.text).toBe("hello world");
    expect(out.fallback).toBe("hello world");
    expect(out.sidecar).toBeNull();
  });

  it("emits sidecar atoms with positions relative to the slice origin", () => {
    // Slice starts at offset 10 in the source doc; atom at absolute
    // position 12 should map to local position 2.
    const atomAt12 = { ...SAMPLE_FILE, position: 12 };
    const text = `ab${TUG_ATOM_CHAR}cd`;
    const out = serializeClipboard(text, [atomAt12], 10);
    expect(out.text).toBe(text);
    expect(out.sidecar).not.toBeNull();
    expect(out.sidecar!.atoms).toEqual([
      { position: 2, segment: atomAt12.segment },
    ]);
  });

  it("expands U+FFFC into atom labels in the fallback string", () => {
    const text = `pre ${TUG_ATOM_CHAR} mid ${TUG_ATOM_CHAR} end`;
    const atoms = [
      { ...SAMPLE_FILE, position: 4 },
      { ...SAMPLE_LINK, position: 10 },
    ];
    const out = serializeClipboard(text, atoms, 0);
    expect(out.fallback).toBe("pre main.ts mid ant end");
  });

  it("processes labels back-to-front so earlier replacements don't disturb later positions", () => {
    // Long-then-short label order is the worst case for naive
    // forward replacement.
    const text = `${TUG_ATOM_CHAR}_${TUG_ATOM_CHAR}`;
    const atoms = [
      {
        position: 0,
        segment: {
          kind: "atom" as const,
          type: "file",
          label: "a-very-long-filename.tsx",
          value: "v",
        },
      },
      {
        position: 2,
        segment: {
          kind: "atom" as const,
          type: "file",
          label: "x",
          value: "v",
        },
      },
    ];
    const out = serializeClipboard(text, atoms, 0);
    expect(out.fallback).toBe("a-very-long-filename.tsx_x");
  });
});

describe("parseClipboardSidecar", () => {
  it("round-trips a serialized payload", () => {
    const text = `ab${TUG_ATOM_CHAR}cd`;
    const out = serializeClipboard(text, [SAMPLE_FILE], 0);
    const parsed = parseClipboardSidecar(JSON.stringify(out.sidecar));
    expect(parsed).toEqual(out.sidecar);
  });

  it("returns null for non-JSON input", () => {
    expect(parseClipboardSidecar("not-json")).toBeNull();
    expect(parseClipboardSidecar("")).toBeNull();
  });

  it("returns null for unknown version values", () => {
    const payload = { version: 42, atoms: [] };
    expect(parseClipboardSidecar(JSON.stringify(payload))).toBeNull();
  });

  it("returns null when atoms is missing or not an array", () => {
    expect(parseClipboardSidecar(JSON.stringify({ version: 1 }))).toBeNull();
    expect(parseClipboardSidecar(JSON.stringify({ version: 1, atoms: "x" }))).toBeNull();
  });

  it("rejects atom entries missing required fields", () => {
    const missingType = {
      version: 1,
      atoms: [{ position: 0, segment: { kind: "atom", label: "a", value: "v" } }],
    };
    expect(parseClipboardSidecar(JSON.stringify(missingType))).toBeNull();

    const missingPosition = {
      version: 1,
      atoms: [{ segment: { kind: "atom", type: "file", label: "a", value: "v" } }],
    };
    expect(parseClipboardSidecar(JSON.stringify(missingPosition))).toBeNull();
  });

  it("ignores unknown segment kinds", () => {
    const wrongKind = {
      version: 1,
      atoms: [
        {
          position: 0,
          segment: { kind: "non-atom", type: "file", label: "a", value: "v" },
        },
      ],
    };
    expect(parseClipboardSidecar(JSON.stringify(wrongKind))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// html payload — Step 9.5B
// ---------------------------------------------------------------------------
//
// `serializeClipboard.html` is what crosses Tug.app's native clipboard
// bridge (the bridge exposes `text/plain` + `text/html` only — never
// the custom MIME sidecar). `parseClipboardHtml` reconstructs the doc
// text + atoms on the bridge-paste path. These tests prove the
// round-trip and the malformed-input rejection behavior.

describe("serializeClipboard — html payload", () => {
  it("emits empty html when there are no atoms in the slice", () => {
    const out = serializeClipboard("hello world", [], 0);
    expect(out.html).toBe("");
  });

  it("emits an <img data-atom-*> element at each atom position", () => {
    const text = `ab${TUG_ATOM_CHAR}cd`;
    const out = serializeClipboard(text, [SAMPLE_FILE], 0);
    expect(out.html).toContain('data-atom-label="main.ts"');
    expect(out.html).toContain('data-atom-type="file"');
    // text segments before / after are present and HTML-escaped.
    expect(out.html.startsWith("ab")).toBe(true);
    expect(out.html.endsWith("cd")).toBe(true);
  });

  it("escapes &, <, > in surrounding text segments", () => {
    const text = `<a&b>${TUG_ATOM_CHAR}c`;
    const out = serializeClipboard(text, [{ ...SAMPLE_FILE, position: 5 }], 0);
    expect(out.html.startsWith("&lt;a&amp;b&gt;")).toBe(true);
    expect(out.html.endsWith("c")).toBe(true);
  });

  it("translates absolute positions to slice-relative positions in html order", () => {
    // Slice starts at offset 10 in the source doc; atom at absolute
    // 12 should appear after the first two text glyphs of the slice.
    const text = `ab${TUG_ATOM_CHAR}cd`;
    const out = serializeClipboard(text, [{ ...SAMPLE_FILE, position: 12 }], 10);
    const labelIdx = out.html.indexOf('data-atom-label="main.ts"');
    const cdIdx = out.html.indexOf("cd");
    expect(labelIdx).toBeGreaterThan(0);
    expect(cdIdx).toBeGreaterThan(labelIdx);
  });
});

describe("parseClipboardHtml", () => {
  it("returns null for empty input", () => {
    expect(parseClipboardHtml("")).toBeNull();
  });

  it("returns null when no atom <img> is present", () => {
    expect(parseClipboardHtml("<p>hello</p>")).toBeNull();
    expect(parseClipboardHtml("plain text")).toBeNull();
    // <img> without data-atom-label is ignored too.
    expect(parseClipboardHtml('<img src="cat.png">')).toBeNull();
  });

  it("returns null when an atom img is missing required data attributes", () => {
    expect(
      parseClipboardHtml('<img data-atom-label="x">'),
    ).toBeNull();
    expect(
      parseClipboardHtml(
        '<img data-atom-label="x" data-atom-type="file">',
      ),
    ).toBeNull();
  });

  it("round-trips a single atom-only slice", () => {
    const text = TUG_ATOM_CHAR;
    const out = serializeClipboard(text, [{ ...SAMPLE_FILE, position: 0 }], 0);
    const parsed = parseClipboardHtml(out.html);
    expect(parsed).not.toBeNull();
    expect(parsed!.docText).toBe(TUG_ATOM_CHAR);
    expect(parsed!.atoms).toEqual([
      { position: 0, segment: SAMPLE_FILE.segment },
    ]);
  });

  it("round-trips a mixed slice with multiple atoms", () => {
    const text = `pre ${TUG_ATOM_CHAR} mid ${TUG_ATOM_CHAR} end`;
    const atoms = [
      { ...SAMPLE_FILE, position: 4 },
      { ...SAMPLE_LINK, position: 10 },
    ];
    const out = serializeClipboard(text, atoms, 0);
    const parsed = parseClipboardHtml(out.html);
    expect(parsed).not.toBeNull();
    expect(parsed!.docText).toBe(text);
    expect(parsed!.atoms).toEqual([
      { position: 4, segment: SAMPLE_FILE.segment },
      { position: 10, segment: SAMPLE_LINK.segment },
    ]);
  });

  it("descends through wrapper elements (e.g. WebKit's <span> / <meta>)", () => {
    // WebKit wraps clipboard html in <meta> + <span style="...">; the
    // parser must descend into these and pick up text + atoms.
    const html =
      '<meta charset="utf-8"><span style="font-family: serif;">'
      + 'ab<img data-atom-label="main.ts" data-atom-value="/main.ts" data-atom-type="file">cd'
      + '</span>';
    const parsed = parseClipboardHtml(html);
    expect(parsed).not.toBeNull();
    expect(parsed!.docText).toBe(`ab${TUG_ATOM_CHAR}cd`);
    expect(parsed!.atoms).toEqual([
      { position: 2, segment: SAMPLE_FILE.segment },
    ]);
  });

  it("preserves <br> as a newline in docText", () => {
    const html =
      'line1<br>'
      + '<img data-atom-label="main.ts" data-atom-value="/main.ts" data-atom-type="file">'
      + 'line2';
    const parsed = parseClipboardHtml(html);
    expect(parsed).not.toBeNull();
    expect(parsed!.docText).toBe(`line1\n${TUG_ATOM_CHAR}line2`);
  });
});
