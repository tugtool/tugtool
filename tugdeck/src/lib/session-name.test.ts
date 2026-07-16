/**
 * session-name.test.ts — the Lens entry-title precedence helper ([P07]):
 * name → tag → id-hash, detected by exact equality against the id-hash
 * fallback. Pure logic — no React, no store.
 *
 * @module lib/session-name.test
 */

import { describe, expect, it } from "bun:test";
import { sessionEntryTitle } from "./session-name";

const OWNER = "d665249ecafe1234"; // a full session id; its 8-char hash is "d665249e"
const HASH = OWNER.slice(0, 8);

describe("sessionEntryTitle", () => {
  it("hash display_name + tag ⇒ tag (no custom name ⇒ the friendly tag)", () => {
    expect(sessionEntryTitle(HASH, OWNER, "brisk-otter")).toBe("brisk-otter");
  });

  it("named display_name + tag ⇒ the name (a user name wins over the tag)", () => {
    expect(sessionEntryTitle("Refactor Lens", OWNER, "brisk-otter")).toBe(
      "Refactor Lens",
    );
  });

  it("no tag + hash ⇒ the hash (last-resort fallback, unchanged)", () => {
    expect(sessionEntryTitle(HASH, OWNER, null)).toBe(HASH);
  });

  it("named display_name + no tag ⇒ the name", () => {
    expect(sessionEntryTitle("Refactor Lens", OWNER, null)).toBe("Refactor Lens");
  });
});
