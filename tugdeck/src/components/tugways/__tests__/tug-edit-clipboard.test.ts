/**
 * tug-edit clipboard serialization — pure round-trip tests.
 *
 * Exercises `serializeClipboard` and `parseClipboardSidecar` in
 * isolation. The DOM event handler that wraps these helpers is
 * exercised via the `tug-edit.test.tsx` integration suite; this
 * file proves the wire format itself is bidirectional and rejects
 * malformed payloads cleanly.
 */
import { describe, it, expect } from "bun:test";

import {
  parseClipboardSidecar,
  serializeClipboard,
} from "@/components/tugways/tug-edit/clipboard-filters";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";

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
