/**
 * slash-argument-hint.test.ts — pure-logic coverage for the argument
 * placeholder decision.
 */

import { describe, expect, test } from "bun:test";
import {
  GENERIC_ARGUMENT_HINT,
  resolveArgumentHint,
} from "@/lib/slash-argument-hint";

describe("resolveArgumentHint", () => {
  test("an explicit catalog argumentHint wins", () => {
    expect(
      resolveArgumentHint({
        name: "tugplug:devise",
        category: "skill",
        argumentHint: "<idea> → <output-path>",
      }),
    ).toBe("<idea> → <output-path>");
  });

  test("a skill with no explicit hint gets the generic slot", () => {
    expect(resolveArgumentHint({ name: "tugplug:devise", category: "skill" })).toBe(
      GENERIC_ARGUMENT_HINT,
    );
  });

  test("an agent with no explicit hint gets the generic slot", () => {
    expect(
      resolveArgumentHint({ name: "tugplug:reviewer", category: "agent" }),
    ).toBe(GENERIC_ARGUMENT_HINT);
  });

  test("a local command opts in via takesArgs", () => {
    expect(
      resolveArgumentHint({ name: "resume", category: "local", takesArgs: true }),
    ).toBe(GENERIC_ARGUMENT_HINT);
  });

  test("a no-arg local command gets no placeholder", () => {
    expect(
      resolveArgumentHint({ name: "model", category: "local", takesArgs: false }),
    ).toBeNull();
    expect(resolveArgumentHint({ name: "model", category: "local" })).toBeNull();
  });

  test("a whitespace-only explicit hint falls back, not shown verbatim", () => {
    // An empty/blank hint is treated as absent; a skill still gets the
    // generic slot, a no-arg local still gets nothing.
    expect(
      resolveArgumentHint({ name: "tugplug:x", category: "skill", argumentHint: "   " }),
    ).toBe(GENERIC_ARGUMENT_HINT);
    expect(
      resolveArgumentHint({ name: "init", category: "local", argumentHint: "" }),
    ).toBeNull();
  });

  test("an unknown shape (no category, no flag) gets no placeholder", () => {
    expect(resolveArgumentHint({ name: "mystery" })).toBeNull();
  });
});
