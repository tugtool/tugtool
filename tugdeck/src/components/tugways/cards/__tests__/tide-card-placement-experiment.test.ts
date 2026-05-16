/**
 * Pure-logic tests for the placement-experiment parser. The harness
 * itself (slot resolution + window-global installer) involves React
 * and tugbank; here we pin the JSON → PlacementMap parse — the
 * boundary that decides which mapping shapes survive a malformed
 * tugbank entry.
 */

import { describe, expect, it } from "bun:test";

import {
  EMPTY_PLACEMENT_MAP,
  parsePlacementEntry,
} from "@/components/tugways/cards/tide-card-placement-experiment";
import type { TaggedValue } from "@/lib/tugbank-client";

function jsonEntry(value: unknown): TaggedValue {
  return { kind: "json", value };
}

describe("parsePlacementEntry", () => {
  it("returns the empty default when the entry is undefined", () => {
    expect(parsePlacementEntry(undefined)).toEqual(EMPTY_PLACEMENT_MAP);
  });

  it("returns the empty default when the entry value is null", () => {
    expect(parsePlacementEntry(jsonEntry(null))).toEqual(EMPTY_PLACEMENT_MAP);
  });

  it("returns the empty default when the entry value is not an object", () => {
    expect(parsePlacementEntry(jsonEntry("nope"))).toEqual(
      EMPTY_PLACEMENT_MAP,
    );
    expect(parsePlacementEntry(jsonEntry(42))).toEqual(EMPTY_PLACEMENT_MAP);
  });

  it("accepts a fully-populated mapping with valid datums", () => {
    const parsed = parsePlacementEntry(
      jsonEntry({
        Z0: "window",
        Z2: "tokens",
        Z3: "active",
        Z4: "phase",
        Z1: "perTurnDuration",
      }),
    );
    expect(parsed).toEqual({
      Z0: "window",
      Z2: "tokens",
      Z3: "active",
      Z4: "phase",
      Z1: "perTurnDuration",
    });
  });

  it("coerces unknown datums to null", () => {
    const parsed = parsePlacementEntry(
      jsonEntry({
        Z2: "garbage",
        Z3: 42,
        Z1: "alsoUnknown",
      }),
    );
    expect(parsed.Z2).toBeNull();
    expect(parsed.Z3).toBeNull();
    expect(parsed.Z1).toBeNull();
  });

  it("forbids a session datum on Z1 (turn-only slot)", () => {
    expect(parsePlacementEntry(jsonEntry({ Z1: "window" })).Z1).toBeNull();
  });

  it("forbids a turn datum on a session slot", () => {
    expect(parsePlacementEntry(jsonEntry({ Z2: "perTurnCost" })).Z2).toBeNull();
  });
});
