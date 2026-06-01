/**
 * inbound-dispatch.test.ts — the verb-registry invariants ([#step-13c1]).
 *
 * These guard the two failure modes the registry refactor is meant to make
 * impossible:
 *  - `isInboundMessage` drifting from the verb set (the old hand-maintained
 *    allowlist's silent "Invalid message type" footgun), and
 *  - a verb existing in the shared contract with no dispatch handler (which
 *    would throw at runtime when that verb arrives).
 *
 * Pure data over the registry + the shared verb list — no SessionManager, no
 * mocks, no wire.
 */

import { describe, expect, test } from "bun:test";
import { INBOUND_VERBS, isInboundMessage } from "@tugproto/inbound";
import { INBOUND_HANDLERS } from "../inbound-dispatch.ts";

// Verbs that main.ts handles inline (handshake + hot turn path), not via the
// registry. Everything else MUST have a handler.
const SPECIAL_CASED = new Set(["protocol_init", "user_message"]);

describe("isInboundMessage (derived from INBOUND_VERBS)", () => {
  test("accepts every declared verb", () => {
    for (const verb of INBOUND_VERBS) {
      expect(isInboundMessage({ type: verb })).toBe(true);
    }
  });

  test("rejects an unknown verb and non-objects", () => {
    expect(isInboundMessage({ type: "not_a_real_verb" })).toBe(false);
    expect(isInboundMessage({ type: 42 })).toBe(false);
    expect(isInboundMessage({})).toBe(false);
    expect(isInboundMessage(null)).toBe(false);
    expect(isInboundMessage("user_message")).toBe(false);
  });
});

describe("INBOUND_HANDLERS registry coverage", () => {
  test("has a handler for every non-special verb, and no extras", () => {
    const expected = INBOUND_VERBS.filter((v) => !SPECIAL_CASED.has(v)).sort();
    const actual = Object.keys(INBOUND_HANDLERS).sort();
    expect(actual).toEqual(expected);
  });

  test("does not register the special-cased verbs", () => {
    expect(INBOUND_HANDLERS).not.toHaveProperty("protocol_init");
    expect(INBOUND_HANDLERS).not.toHaveProperty("user_message");
  });
});
