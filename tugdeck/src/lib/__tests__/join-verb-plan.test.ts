/**
 * join-verb-plan — the pure `/join` branch logic ([P05]/[P14]).
 */

import { describe, expect, test } from "bun:test";

import { matchLocalSlashCommand } from "@/lib/slash-commands";
import { planJoinVerb, type JoinDashRef } from "@/lib/join-verb-plan";

function dash(overrides: Partial<JoinDashRef> = {}): JoinDashRef {
  return {
    name: "snippets",
    ownerId: "tugdash/snippets",
    rounds: 4,
    dirty: false,
    ...overrides,
  };
}

describe("/join matcher", () => {
  test("bare and named forms match locally — never fall through to claude", () => {
    expect(matchLocalSlashCommand("/join")).toEqual({ name: "join", args: "" });
    expect(matchLocalSlashCommand("/join snippets")).toEqual({
      name: "join",
      args: "snippets",
    });
  });
});

describe("planJoinVerb", () => {
  test("bare: opens the lane with zero or several dashes", () => {
    expect(planJoinVerb("", [])).toEqual({ kind: "open-lane" });
    expect(
      planJoinVerb("", [dash(), dash({ name: "x", ownerId: "tugdash/x" })]),
    ).toEqual({ kind: "open-lane" });
  });

  test("bare with exactly one dash previews without auto-landing", () => {
    const plan = planJoinVerb("", [dash()]);
    expect(plan).toEqual({ kind: "preview", dash: dash(), autoLand: false });
  });

  test("named form previews with auto-land; accepts name or branch ref", () => {
    expect(planJoinVerb("snippets", [dash()])).toEqual({
      kind: "preview",
      dash: dash(),
      autoLand: true,
    });
    expect(planJoinVerb("tugdash/snippets", [dash()])).toEqual({
      kind: "preview",
      dash: dash(),
      autoLand: true,
    });
  });

  test("an empty dash routes to the release handoff instead of the refusal", () => {
    const empty = dash({ rounds: 0, dirty: false });
    expect(planJoinVerb("snippets", [empty])).toEqual({
      kind: "release-handoff",
      dash: empty,
    });
    expect(planJoinVerb("", [empty])).toEqual({
      kind: "release-handoff",
      dash: empty,
    });
    // A dirty roundless dash still joins — the join auto-commits its dirt.
    const dirtyEmpty = dash({ rounds: 0, dirty: true });
    expect(planJoinVerb("snippets", [dirtyEmpty])).toEqual({
      kind: "preview",
      dash: dirtyEmpty,
      autoLand: true,
    });
  });

  test("an unknown name reports itself", () => {
    expect(planJoinVerb("nope", [dash()])).toEqual({
      kind: "unknown",
      name: "nope",
    });
  });
});
