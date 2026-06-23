/**
 * tug-text-editor clipboard serialization — pure round-trip tests.
 *
 * Exercises `serializeClipboard`, `parseClipboardSidecar`, and
 * `rehydrateSidecarBytes` in isolation. The DOM event handlers and the
 * native-bridge copy/paste path that wrap these helpers are exercised
 * via app-test (`at0043`, `at0044`); this file proves the wire format
 * itself is bidirectional, carries image bytes / atom ids
 * self-contained, and rejects malformed payloads cleanly.
 */
import { describe, it, expect } from "bun:test";

import {
  parseClipboardSidecar,
  planLeadingCommandPaste,
  rehydrateSidecarBytes,
  serializeClipboard,
} from "@/components/tugways/tug-text-editor/clipboard-filters";
import { TUG_ATOM_CHAR, type AtomSegment } from "@/lib/tug-atom-img";
import {
  createAtomBytesStore,
  type AtomBytesEntry,
} from "@/lib/atom-bytes-store";

const SAMPLE_FILE = {
  position: 2,
  segment: { kind: "atom" as const, type: "file", label: "main.ts", value: "/main.ts" },
};

const SAMPLE_LINK = {
  position: 5,
  segment: { kind: "atom" as const, type: "link", label: "ant", value: "https://anthropic.com" },
};

const SAMPLE_BYTES: AtomBytesEntry = {
  content: "aGVsbG8=",
  mediaType: "image/png",
  thumbnailDataUrl: "data:image/png;base64,aGVsbG8=",
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
// serializeClipboard — self-contained image bytes
// ---------------------------------------------------------------------------

describe("serializeClipboard — image bytes", () => {
  const imageAtom = {
    position: 0,
    segment: {
      kind: "atom" as const,
      type: "image",
      label: "Bug-87A.png",
      value: "image-1",
      id: "id-abc",
    },
  };

  it("attaches stored bytes inline for image atoms with an id", () => {
    const getBytes = (id: string) => (id === "id-abc" ? SAMPLE_BYTES : null);
    const out = serializeClipboard(TUG_ATOM_CHAR, [imageAtom], 0, getBytes);
    expect(out.sidecar!.atoms[0]!.bytes).toEqual(SAMPLE_BYTES);
    // The id rides along on the segment so paste can key the store.
    expect(out.sidecar!.atoms[0]!.segment.id).toBe("id-abc");
  });

  it("omits bytes when no resolver is supplied", () => {
    const out = serializeClipboard(TUG_ATOM_CHAR, [imageAtom], 0);
    expect(out.sidecar!.atoms[0]!.bytes).toBeUndefined();
    expect(out.sidecar!.atoms[0]!.segment.id).toBe("id-abc");
  });

  it("omits bytes when the resolver has no entry for the id", () => {
    const out = serializeClipboard(TUG_ATOM_CHAR, [imageAtom], 0, () => null);
    expect(out.sidecar!.atoms[0]!.bytes).toBeUndefined();
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

  it("round-trips an image atom's id and bytes", () => {
    const imageAtom = {
      position: 0,
      segment: {
        kind: "atom" as const,
        type: "image",
        label: "Bug-87A.png",
        value: "image-1",
        id: "id-xyz",
      },
    };
    const out = serializeClipboard(
      TUG_ATOM_CHAR,
      [imageAtom],
      0,
      () => SAMPLE_BYTES,
    );
    const parsed = parseClipboardSidecar(JSON.stringify(out.sidecar));
    expect(parsed).toEqual(out.sidecar);
    expect(parsed!.atoms[0]!.segment.id).toBe("id-xyz");
    expect(parsed!.atoms[0]!.bytes).toEqual(SAMPLE_BYTES);
  });

  it("drops malformed bytes but keeps the atom", () => {
    const payload = {
      version: 1,
      text: TUG_ATOM_CHAR,
      atoms: [
        {
          position: 0,
          segment: { kind: "atom", type: "image", label: "a", value: "v", id: "i" },
          bytes: { content: 42, mediaType: "image/png" },
        },
      ],
    };
    const parsed = parseClipboardSidecar(JSON.stringify(payload));
    expect(parsed).not.toBeNull();
    expect(parsed!.atoms[0]!.bytes).toBeUndefined();
    expect(parsed!.atoms[0]!.segment.id).toBe("i");
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
// rehydrateSidecarBytes — restore image bytes into a destination store
// ---------------------------------------------------------------------------

describe("rehydrateSidecarBytes", () => {
  it("puts carried bytes into the store keyed by atom id", () => {
    const store = createAtomBytesStore();
    const payload = {
      version: 1 as const,
      text: TUG_ATOM_CHAR,
      atoms: [
        {
          position: 0,
          segment: {
            kind: "atom" as const,
            type: "image",
            label: "x",
            value: "v",
            id: "id-1",
          },
          bytes: SAMPLE_BYTES,
        },
      ],
    };
    rehydrateSidecarBytes(payload, store);
    expect(store.get("id-1")).toEqual(SAMPLE_BYTES);
  });

  it("skips atoms without bytes or without an id, and tolerates a null store", () => {
    const store = createAtomBytesStore();
    const payload = {
      version: 1 as const,
      text: `${TUG_ATOM_CHAR}${TUG_ATOM_CHAR}`,
      atoms: [
        // bytes but no id — nowhere to key it
        {
          position: 0,
          segment: { kind: "atom" as const, type: "image", label: "x", value: "v" },
          bytes: SAMPLE_BYTES,
        },
        // id but no bytes — a plain file atom
        {
          position: 1,
          segment: {
            kind: "atom" as const,
            type: "file",
            label: "y",
            value: "/y",
            id: "id-2",
          },
        },
      ],
    };
    rehydrateSidecarBytes(payload, store);
    expect(store.size()).toBe(0);
    // Null store is a no-op, not a throw.
    expect(() => rehydrateSidecarBytes(payload, null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// planLeadingCommandPaste — chip a slash command pasted at offset 0
// ---------------------------------------------------------------------------

describe("planLeadingCommandPaste", () => {
  const atomFor = (name: string): AtomSegment => ({
    kind: "atom",
    type: "command",
    label: name,
    value: name,
  });

  // Resolver that knows one plugin command, matching its full name or leaf.
  const resolve = (token: string): AtomSegment | null => {
    if (token === "tugplug:implement" || token === "implement") {
      return atomFor("tugplug:implement");
    }
    return null;
  };

  it("chips a full-name command and keeps the rest as argument text", () => {
    const plan = planLeadingCommandPaste(
      "/tugplug:implement roadmap/foo.md",
      0,
      resolve,
    );
    expect(plan).not.toBeNull();
    expect(plan!.insert).toBe(`${TUG_ATOM_CHAR} roadmap/foo.md`);
    expect(plan!.segment).toEqual(atomFor("tugplug:implement"));
  });

  it("resolves an unqualified leaf to the full command atom", () => {
    const plan = planLeadingCommandPaste("/implement roadmap/foo.md", 0, resolve);
    expect(plan).not.toBeNull();
    expect(plan!.segment).toEqual(atomFor("tugplug:implement"));
    expect(plan!.insert).toBe(`${TUG_ATOM_CHAR} roadmap/foo.md`);
  });

  it("inserts a separating space when the command stands alone", () => {
    const plan = planLeadingCommandPaste("/tugplug:implement", 0, resolve);
    expect(plan!.insert).toBe(`${TUG_ATOM_CHAR} `);
  });

  it("does not double the separator when the rest already opens with space", () => {
    const plan = planLeadingCommandPaste("/implement  two-spaces", 0, resolve);
    // The pasted run's own leading whitespace is preserved verbatim.
    expect(plan!.insert).toBe(`${TUG_ATOM_CHAR}  two-spaces`);
  });

  it("returns null when the paste does not land at offset 0", () => {
    expect(planLeadingCommandPaste("/implement x", 5, resolve)).toBeNull();
  });

  it("returns null when the leading token is not a known command", () => {
    expect(planLeadingCommandPaste("/unknown thing", 0, resolve)).toBeNull();
    expect(planLeadingCommandPaste("not a command", 0, resolve)).toBeNull();
    expect(planLeadingCommandPaste("/path/to/file.md", 0, resolve)).toBeNull();
  });
});
