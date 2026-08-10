/**
 * session-atom.test.ts — the session atom's payload composition.
 *
 * The end-to-end evidence that the sidecar was written correctly is the paste
 * round-trip in the app-test: if the sidecar were wrong the chip would come
 * back as plain text. What is testable here is the payload BUILDER — the
 * shape the sidecar parser reads, and the two flat-text forms.
 */

import { describe, expect, test } from "bun:test";

import { parseClipboardSidecar } from "@/components/tugways/tug-text-editor/clipboard-filters";
import { wrapAtomMention, parseAtomMentionSegments } from "@/lib/atom-mention-marker";
import { composeSessionIdentity } from "@/lib/session-identity";
import {
  SESSION_ATOM_TYPE,
  sessionAtomClipboardPayload,
  sessionAtomCallsign,
  sessionAtomSegment,
} from "@/lib/session-atom";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";

const ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function identity(over: Partial<Parameters<typeof composeSessionIdentity>[0]> = {}) {
  return composeSessionIdentity({
    sessionId: ID,
    name: null,
    synopsis: null,
    tag: "syrupy-beam",
    projectDir: "/Users/k/src/tugtool",
    ...over,
  });
}

describe("sessionAtomSegment", () => {
  test("is a real atom segment, typed `session`", () => {
    const seg = sessionAtomSegment(identity());
    expect(seg.kind).toBe("atom");
    expect(seg.type).toBe(SESSION_ATOM_TYPE);
  });

  test("label and value are both the callsign run — what the chip shows is what the wire carries", () => {
    const seg = sessionAtomSegment(identity());
    expect(seg.label).toBe("tugtool/syrupy-beam");
    expect(seg.value).toBe("tugtool/syrupy-beam");
    expect(seg.value).toBe(seg.label);
  });

  test("a lineage-bearing callsign rides whole", () => {
    expect(sessionAtomSegment(identity({ tag: "syrupy-beam-A1" })).value).toBe(
      "tugtool/syrupy-beam-A1",
    );
  });
});

describe("sessionAtomClipboardPayload", () => {
  test("round-trips through the production sidecar parser", () => {
    const payload = sessionAtomClipboardPayload(identity());
    const parsed = parseClipboardSidecar(JSON.stringify(payload));
    expect(parsed).not.toBeNull();
    expect(parsed?.atoms.length).toBe(1);
    expect(parsed?.atoms[0].position).toBe(0);
    expect(parsed?.atoms[0].segment.type).toBe(SESSION_ATOM_TYPE);
    expect(parsed?.atoms[0].segment.value).toBe("tugtool/syrupy-beam");
  });

  test("the text is one object-replacement char — the atom's own position", () => {
    const payload = sessionAtomClipboardPayload(identity());
    expect(payload.text).toBe(TUG_ATOM_CHAR);
    expect(payload.text.length).toBe(1);
  });
});

describe("sessionAtomCallsign", () => {
  test("is what the chip displays and resolves through", () => {
    // The atom carries no id: the callsign is the whole of what a chip — in the
    // composer, or replayed from a wire marker — has to reach the ledger with.
    expect(sessionAtomCallsign(sessionAtomSegment(identity()).value)).toBe(
      "syrupy-beam",
    );
    expect(sessionAtomCallsign("tugtool/syrupy-beam-A1-B2")).toBe(
      "syrupy-beam-A1-B2",
    );
  });

  test("a value that is already a callsign passes through", () => {
    expect(sessionAtomCallsign("syrupy-beam")).toBe("syrupy-beam");
  });
});

describe("the wire marker round-trip", () => {
  test("a session mention wraps and parses back to its callsign", () => {
    const value = sessionAtomSegment(identity()).value;
    const wrapped = wrapAtomMention(value);
    expect(wrapped).toBe("`@tugtool/syrupy-beam`");
    const segments = parseAtomMentionSegments(`see ${wrapped} for context`);
    expect(segments).toEqual([
      { kind: "text", text: "see " },
      { kind: "mention", value: "tugtool/syrupy-beam" },
      { kind: "text", text: " for context" },
    ]);
  });

  test("a lineage callsign survives the marker — the `-A1` is not marker syntax", () => {
    const wrapped = wrapAtomMention("tugtool/syrupy-beam-A1-B2");
    const segments = parseAtomMentionSegments(wrapped);
    expect(segments).toEqual([
      { kind: "mention", value: "tugtool/syrupy-beam-A1-B2" },
    ]);
  });
});
