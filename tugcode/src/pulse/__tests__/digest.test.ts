/**
 * Digest building — the spike-pinned format: BEAT header, scope-tag
 * groups in first-seen order, fact bullets in arrival order.
 */

import { describe, expect, test } from "bun:test";

import { beatScopes, buildDigest, scopeAlias } from "../digest";
import type { PulseFact } from "../types";

function fact(text: string, scope: string): PulseFact {
  return {
    type: "pulse_fact",
    source: "test",
    scope,
    kind: "note",
    fact: text,
    at: 0,
  };
}

const LONG_SCOPE = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";

describe("scopeAlias", () => {
  test("shortens long ids, passes short ones through", () => {
    expect(scopeAlias(LONG_SCOPE)).toBe("0a1b2c3d");
    expect(scopeAlias("app")).toBe("app");
    expect(scopeAlias("s1")).toBe("s1");
  });
});

describe("buildDigest", () => {
  test("single scope renders header, tag, bullets", () => {
    const digest = buildDigest(7, [fact("did a thing", "s1"), fact("did more", "s1")]);
    expect(digest).toBe("BEAT 7\n[s1]\n- did a thing\n- did more");
  });

  test("two scopes group with facts contiguous per scope", () => {
    const digest = buildDigest(3, [
      fact("a1 first", LONG_SCOPE),
      fact("b1 first", "scope-b"),
      fact("a2 second", LONG_SCOPE),
    ]);
    expect(digest).toBe(
      "BEAT 3\n[0a1b2c3d]\n- a1 first\n- a2 second\n[scope-b]\n- b1 first",
    );
  });
});

describe("beatScopes", () => {
  test("unique full ids in first-seen order", () => {
    const scopes = beatScopes([
      fact("x", LONG_SCOPE),
      fact("y", "scope-b"),
      fact("z", LONG_SCOPE),
    ]);
    expect(scopes).toEqual([LONG_SCOPE, "scope-b"]);
  });
});
