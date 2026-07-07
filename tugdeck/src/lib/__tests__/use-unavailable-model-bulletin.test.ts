/**
 * use-unavailable-model-bulletin.test.ts — pure-logic coverage for
 * `shouldWarnUnavailableModel`, the predicate deciding whether a card's seed
 * selector warrants the unavailable-model bulletin. The reset + alert + open-
 * Settings behavior is proven through the real-app test, not here.
 */

import { describe, expect, test } from "bun:test";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import { shouldWarnUnavailableModel } from "@/lib/use-unavailable-model-bulletin";

const CATALOG: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)" },
  { value: "sonnet", displayName: "Sonnet" },
  { value: "haiku", displayName: "Haiku" },
];

describe("shouldWarnUnavailableModel", () => {
  test("true for a concrete seed the catalog no longer offers", () => {
    expect(shouldWarnUnavailableModel("fable", CATALOG)).toBe(true);
  });

  test("false for a concrete seed the catalog still offers", () => {
    expect(shouldWarnUnavailableModel("sonnet", CATALOG)).toBe(false);
    expect(shouldWarnUnavailableModel("haiku", CATALOG)).toBe(false);
  });

  test("false for the default zero-state and for no seed at all", () => {
    expect(shouldWarnUnavailableModel("default", CATALOG)).toBe(false);
    expect(shouldWarnUnavailableModel(null, CATALOG)).toBe(false);
  });

  test("false when no live catalog was ever persisted", () => {
    expect(shouldWarnUnavailableModel("fable", null)).toBe(false);
    expect(shouldWarnUnavailableModel(null, null)).toBe(false);
  });

  test("a default-less catalog still clears its own members only", () => {
    const catalog: CapabilityModel[] = [{ value: "sonnet", displayName: "Sonnet" }];
    expect(shouldWarnUnavailableModel("sonnet", catalog)).toBe(false);
    expect(shouldWarnUnavailableModel("haiku", catalog)).toBe(true);
  });
});
