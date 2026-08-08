/**
 * session-identity.test.ts — the resolver's pure derivation.
 *
 * Precedence, lineage parsing, and the two flat-text forms. The reactivity
 * contract (`useSessionIdentity` repaints a live surface on `/rename`) is not
 * testable here by design — a render test would be the banned pattern — and is
 * covered by an app-test on the real app.
 */

import { describe, expect, test } from "bun:test";

import {
  composeSessionIdentity,
  parseTagLineage,
  projectLeafName,
  sessionCitation,
  sessionIdentityLine,
  shortSessionId,
  SESSION_SHORT_ID_LENGTH,
} from "@/lib/session-identity";

const ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const SHORT = "f6e43925";

function identity(over: Partial<Parameters<typeof composeSessionIdentity>[0]> = {}) {
  return composeSessionIdentity({
    sessionId: ID,
    name: null,
    synopsis: null,
    tag: "stocky-pixie",
    projectDir: "/Users/k/src/tugtool",
    ...over,
  });
}

describe("shortSessionId", () => {
  test("is the first 8 chars, computed in exactly one place", () => {
    expect(shortSessionId(ID)).toBe(SHORT);
    expect(SESSION_SHORT_ID_LENGTH).toBe(8);
  });
});

describe("projectLeafName", () => {
  test("takes the basename and ignores trailing slashes", () => {
    expect(projectLeafName("/Users/k/src/tugtool")).toBe("tugtool");
    expect(projectLeafName("/Users/k/src/tugtool///")).toBe("tugtool");
  });

  test("degrades to the trimmed input for a slash-only path", () => {
    expect(projectLeafName("/")).toBe("");
  });
});

describe("title precedence", () => {
  test("a user-set name wins and is the description", () => {
    expect(identity({ name: "Refactor the Lens", synopsis: "s" }).title).toBe(
      "Refactor the Lens",
    );
  });

  test("the synopsis fills the line when there is no name", () => {
    expect(identity({ synopsis: "Reworking the pane chrome" }).title).toBe(
      "Reworking the pane chrome",
    );
  });

  test("a session with neither has an honestly empty description", () => {
    expect(identity().title).toBeNull();
  });

  test("blank strings are unset, not values", () => {
    expect(identity({ name: "   ", synopsis: "  " }).title).toBeNull();
  });
});

describe("lineage", () => {
  test("a root session has no segments", () => {
    expect(identity().lineage).toEqual([]);
  });

  test("the structured tag_lineage wins when present", () => {
    expect(identity({ tag: "stocky-pixie-A1", tagLineage: "A1" }).lineage).toEqual([
      "A1",
    ]);
    expect(
      identity({ tag: "stocky-pixie-A1-B2", tagLineage: "A1-B2" }).lineage,
    ).toEqual(["A1", "B2"]);
  });

  test("falls back to reading the segments off the composed tag", () => {
    expect(parseTagLineage("stocky-pixie-A1-B2", null)).toEqual(["A1", "B2"]);
    expect(parseTagLineage("stocky-pixie", null)).toEqual([]);
  });

  test("a lowercase root callsign is never mistaken for a segment", () => {
    // Both words of a root callsign are lowercase, so no `<Letter><Number>`
    // run can be confused with one — this is why the tail scan is safe.
    expect(parseTagLineage("azure-heron", null)).toEqual([]);
    expect(parseTagLineage("azure-h2", null)).toEqual([]);
  });

  test("multi-digit sequence numbers parse", () => {
    expect(parseTagLineage("stocky-pixie-A12", null)).toEqual(["A12"]);
  });

  test("a tagless session has no lineage", () => {
    expect(parseTagLineage(null, null)).toEqual([]);
  });
});

describe("sessionIdentityLine", () => {
  test("is project/callsign — no branch suffix, no name arm", () => {
    expect(sessionIdentityLine(identity({ branch: "feature/x" }))).toBe(
      "tugtool/stocky-pixie",
    );
    expect(sessionIdentityLine(identity({ name: "Refactor the Lens" }))).toBe(
      "tugtool/stocky-pixie",
    );
  });

  test("carries the lineage suffix the tag already composes", () => {
    expect(sessionIdentityLine(identity({ tag: "stocky-pixie-A1" }))).toBe(
      "tugtool/stocky-pixie-A1",
    );
  });

  test("a legacy tagless session degrades to its short id, never the UUID", () => {
    const line = sessionIdentityLine(identity({ tag: null }));
    expect(line).toBe(`tugtool/${SHORT}`);
    expect(line).not.toContain(ID);
  });

  test("drops the prefix when the project is unknown", () => {
    expect(sessionIdentityLine(identity({ projectDir: null }))).toBe(
      "stocky-pixie",
    );
  });
});

describe("sessionCitation", () => {
  test("is `<tag> (<shortId>)`", () => {
    expect(sessionCitation(identity())).toBe("stocky-pixie (f6e43925)");
  });

  test("prefixes the project when the context does not supply it", () => {
    expect(sessionCitation(identity(), { project: true })).toBe(
      "tugtool/stocky-pixie (f6e43925)",
    );
  });

  test("a tagless session degrades to the bare short id — no doubled hash", () => {
    expect(sessionCitation(identity({ tag: null }))).toBe(SHORT);
    expect(sessionCitation(identity({ tag: null }), { project: true })).toBe(
      `tugtool/${SHORT}`,
    );
  });

  test("never prints the full UUID", () => {
    expect(sessionCitation(identity(), { project: true })).not.toContain(ID);
  });
});

describe("what the record deliberately does not carry", () => {
  test("no phase or liveness field — that is a per-card subscription", () => {
    const record = identity() as unknown as Record<string, unknown>;
    expect(record.phase).toBeUndefined();
    expect(record.liveness).toBeUndefined();
  });

  test("the branch rides for telemetry and never reaches a rendered name", () => {
    const withBranch = identity({ branch: "feature/x" });
    expect(withBranch.branch).toBe("feature/x");
    expect(sessionIdentityLine(withBranch)).not.toContain("feature/x");
    expect(sessionCitation(withBranch)).not.toContain("feature/x");
  });

  test("`main` is a branch like any other — the suffix rule is gone entirely", () => {
    expect(identity({ branch: "main" }).branch).toBe("main");
  });
});
