/**
 * tug-text-editor clipboard serialization — pure round-trip tests.
 *
 * Exercises `serializeClipboard`, `parseClipboardSidecar`, and
 * `parseClipboardHtmlEnvelope` in isolation. The DOM event handlers
 * that wrap these helpers are exercised via app-test (`at0043`,
 * `at0044`); this file proves the wire format itself is bidirectional
 * and rejects malformed payloads cleanly.
 */
import { describe, it, expect } from "bun:test";

import {
  parseClipboardHtmlEnvelope,
  parseClipboardSidecar,
  serializeClipboard,
} from "@/components/tugways/tug-text-editor/clipboard-filters";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";

const SAMPLE_FILE = {
  position: 2,
  segment: { kind: "atom" as const, type: "file", label: "main.ts", value: "/main.ts" },
};

const SAMPLE_LINK = {
  position: 5,
  segment: { kind: "atom" as const, type: "link", label: "ant", value: "https://anthropic.com" },
};

// ---------------------------------------------------------------------------
// serializeClipboard — text + fallback
// ---------------------------------------------------------------------------

describe("serializeClipboard — text + fallback", () => {
  it("returns null sidecar when there are no atoms in the slice", () => {
    const out = serializeClipboard("hello world", [], 0);
    expect(out.text).toBe("hello world");
    expect(out.fallback).toBe("hello world");
    expect(out.sidecar).toBeNull();
    expect(out.html).toBe("");
  });

  it("emits sidecar atoms with positions relative to the slice origin", () => {
    const atomAt12 = { ...SAMPLE_FILE, position: 12 };
    const text = `ab${TUG_ATOM_CHAR}cd`;
    const out = serializeClipboard(text, [atomAt12], 10);
    expect(out.text).toBe(text);
    expect(out.sidecar).not.toBeNull();
    expect(out.sidecar!.text).toBe(text);
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

// ---------------------------------------------------------------------------
// serializeClipboard — html envelope
// ---------------------------------------------------------------------------

describe("serializeClipboard — html envelope", () => {
  it("emits a <span data-tug-atoms='...'> envelope with the visible label text", () => {
    const text = `ab${TUG_ATOM_CHAR}cd`;
    const out = serializeClipboard(text, [SAMPLE_FILE], 0);
    expect(out.html.startsWith('<span data-tug-atoms="')).toBe(true);
    expect(out.html.endsWith("</span>")).toBe(true);
    // Visible portion is the label-substituted text (atom label
    // replaces U+FFFC).
    expect(out.html).toContain(">abmain.tscd</span>");
  });

  it("html-escapes &, <, > in the visible span content", () => {
    const text = `<a&b>${TUG_ATOM_CHAR}c`;
    const out = serializeClipboard(text, [{ ...SAMPLE_FILE, position: 5 }], 0);
    expect(out.html).toContain(">&lt;a&amp;b&gt;main.tsc</span>");
  });

  it("keeps the data-tug-atoms attribute opaque (base64) — no quotes, no html-special chars", () => {
    const text = TUG_ATOM_CHAR;
    const out = serializeClipboard(text, [{ ...SAMPLE_FILE, position: 0 }], 0);
    const m = /data-tug-atoms="([^"]*)"/.exec(out.html);
    expect(m).not.toBeNull();
    const encoded = m![1]!;
    // Base64 alphabet: [A-Za-z0-9+/=].
    expect(/^[A-Za-z0-9+/=]+$/.test(encoded)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseClipboardSidecar
// ---------------------------------------------------------------------------

describe("parseClipboardSidecar", () => {
  it("round-trips a serialized payload (with text field)", () => {
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
    const payload = { version: 42, text: "", atoms: [] };
    expect(parseClipboardSidecar(JSON.stringify(payload))).toBeNull();
  });

  it("returns null when text field is missing or wrong type", () => {
    expect(parseClipboardSidecar(JSON.stringify({ version: 1, atoms: [] }))).toBeNull();
    expect(
      parseClipboardSidecar(JSON.stringify({ version: 1, text: 42, atoms: [] })),
    ).toBeNull();
  });

  it("returns null when atoms is missing or not an array", () => {
    expect(parseClipboardSidecar(JSON.stringify({ version: 1, text: "" }))).toBeNull();
    expect(
      parseClipboardSidecar(JSON.stringify({ version: 1, text: "", atoms: "x" })),
    ).toBeNull();
  });

  it("rejects atom entries missing required fields", () => {
    const missingType = {
      version: 1,
      text: TUG_ATOM_CHAR,
      atoms: [{ position: 0, segment: { kind: "atom", label: "a", value: "v" } }],
    };
    expect(parseClipboardSidecar(JSON.stringify(missingType))).toBeNull();

    const missingPosition = {
      version: 1,
      text: TUG_ATOM_CHAR,
      atoms: [{ segment: { kind: "atom", type: "file", label: "a", value: "v" } }],
    };
    expect(parseClipboardSidecar(JSON.stringify(missingPosition))).toBeNull();
  });

  it("ignores unknown segment kinds", () => {
    const wrongKind = {
      version: 1,
      text: TUG_ATOM_CHAR,
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
// parseClipboardHtmlEnvelope — round-trips through the html channel
// ---------------------------------------------------------------------------

describe("parseClipboardHtmlEnvelope", () => {
  it("returns null for empty input", () => {
    expect(parseClipboardHtmlEnvelope("")).toBeNull();
  });

  it("returns null when the html has no data-tug-atoms attribute", () => {
    expect(parseClipboardHtmlEnvelope("<p>hello</p>")).toBeNull();
    expect(parseClipboardHtmlEnvelope("plain text")).toBeNull();
    expect(parseClipboardHtmlEnvelope('<span style="color:red">x</span>')).toBeNull();
  });

  it("returns null when data-tug-atoms is empty or malformed base64", () => {
    expect(parseClipboardHtmlEnvelope('<span data-tug-atoms=""></span>')).toBeNull();
    expect(
      parseClipboardHtmlEnvelope('<span data-tug-atoms="!!!not-base64!!!"></span>'),
    ).toBeNull();
  });

  it("round-trips a single atom-only slice", () => {
    const text = TUG_ATOM_CHAR;
    const out = serializeClipboard(text, [{ ...SAMPLE_FILE, position: 0 }], 0);
    const parsed = parseClipboardHtmlEnvelope(out.html);
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe(TUG_ATOM_CHAR);
    expect(parsed!.atoms).toEqual([
      { position: 0, segment: SAMPLE_FILE.segment },
    ]);
  });

  it("round-trips a mixed slice with multiple atoms across multiple lines", () => {
    // The case the user-reported bug exercised: two atoms with text +
    // newlines between them. Single-attribute envelope makes line-
    // breaks a non-issue (the data is base64 inside an HTML attribute).
    const text = `${TUG_ATOM_CHAR}\ndd\n${TUG_ATOM_CHAR}`;
    const atoms = [
      { ...SAMPLE_FILE, position: 0 },
      { ...SAMPLE_LINK, position: 5 },
    ];
    const out = serializeClipboard(text, atoms, 0);
    const parsed = parseClipboardHtmlEnvelope(out.html);
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe(text);
    expect(parsed!.atoms).toEqual([
      { position: 0, segment: SAMPLE_FILE.segment },
      { position: 5, segment: SAMPLE_LINK.segment },
    ]);
  });

  it("survives WebKit's <span style='...'> wrapper injection", () => {
    // WebKit injects computed-style on the <span> when round-tripping
    // html through NSPasteboard. The data-tug-atoms attribute survives
    // unchanged — verified empirically in
    // `at0045-pasteboard-custom-mime-probe.test.ts`. Construct a
    // similar wrapped html here and assert the parser still finds the
    // attribute.
    const text = TUG_ATOM_CHAR;
    const out = serializeClipboard(text, [{ ...SAMPLE_FILE, position: 0 }], 0);
    const m = /data-tug-atoms="([^"]*)"/.exec(out.html)!;
    const encoded = m[1]!;
    const wrapped = `<meta charset="utf-8"><span data-tug-atoms="${encoded}" style="color: rgb(0,0,0); font-family: -webkit-system-font;">${SAMPLE_FILE.segment.label}</span>`;
    const parsed = parseClipboardHtmlEnvelope(wrapped);
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe(TUG_ATOM_CHAR);
    expect(parsed!.atoms).toEqual([
      { position: 0, segment: SAMPLE_FILE.segment },
    ]);
  });

  it("supports labels with non-ASCII characters via UTF-8 base64", () => {
    const segment = {
      kind: "atom" as const,
      type: "file",
      label: "résumé.txt",
      value: "/files/résumé.txt",
    };
    const text = TUG_ATOM_CHAR;
    const out = serializeClipboard(text, [{ position: 0, segment }], 0);
    const parsed = parseClipboardHtmlEnvelope(out.html);
    expect(parsed).not.toBeNull();
    expect(parsed!.atoms[0]!.segment).toEqual(segment);
  });
});
