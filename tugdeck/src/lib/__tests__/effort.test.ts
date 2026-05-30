/**
 * effort.test.ts — pure-logic coverage for the reasoning-effort helpers
 * ([#step-4]).
 *
 * No store, no DOM — the chip rendering, persistence, and the
 * respawn-with-resume round-trip are covered by the real-app test; this pins
 * the level ordering, label formatting, persisted-value parsing, and the
 * per-model support resolution (which gates the chip and bounds the picker).
 *
 * The fixtures mirror the real claude 2.1.158 `initialize` `models[]`: opus
 * (default) supports all five levels, sonnet four (no `xhigh`), haiku none
 * (the `supportsEffort` flag is absent).
 */

import { describe, expect, test } from "bun:test";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import {
  EFFORT_LEVELS,
  formatEffortLabel,
  orderEffortLevels,
  parsePersistedEffort,
  resolveEffortSupport,
} from "@/lib/effort";

const CAPABILITY_MODELS: CapabilityModel[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
    displayName: "Sonnet",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
  },
  { value: "haiku", displayName: "Haiku" }, // no effort support
];

describe("formatEffortLabel", () => {
  test("title-cases the known levels, with claude's wording for xhigh", () => {
    expect(formatEffortLabel("low")).toBe("Low");
    expect(formatEffortLabel("medium")).toBe("Medium");
    expect(formatEffortLabel("high")).toBe("High");
    expect(formatEffortLabel("xhigh")).toBe("Extra-High");
    expect(formatEffortLabel("max")).toBe("Max");
  });

  test("null (no value) reads as the `-` placeholder", () => {
    expect(formatEffortLabel(null)).toBe("-");
  });

  test("an unknown level falls back to its raw value", () => {
    expect(formatEffortLabel("ludicrous")).toBe("ludicrous");
  });
});

describe("orderEffortLevels", () => {
  test("filters + orders into canonical order, dropping unknowns", () => {
    expect(orderEffortLevels(["max", "low", "bogus", "high"])).toEqual([
      "low",
      "high",
      "max",
    ]);
  });

  test("empty in, empty out", () => {
    expect(orderEffortLevels([])).toEqual([]);
  });

  test("canonical order matches the wire enum", () => {
    expect([...EFFORT_LEVELS]).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("parsePersistedEffort", () => {
  test("returns the stored string for a string-kinded value", () => {
    expect(parsePersistedEffort({ kind: "string", value: "high" })).toBe("high");
  });

  test("returns null for missing / non-string entries", () => {
    expect(parsePersistedEffort(undefined)).toBeNull();
    expect(parsePersistedEffort({ kind: "number", value: 3 })).toBeNull();
  });
});

describe("resolveEffortSupport", () => {
  test("opus (default) supports all five levels in canonical order", () => {
    const support = resolveEffortSupport(CAPABILITY_MODELS, "claude-opus-4-8[1m]");
    expect(support.supported).toBe(true);
    expect(support.levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("sonnet supports four levels (no xhigh)", () => {
    const support = resolveEffortSupport(CAPABILITY_MODELS, "claude-sonnet-4-6");
    expect(support.supported).toBe(true);
    expect(support.levels).toEqual(["low", "medium", "high", "max"]);
  });

  test("haiku does not support effort — gated", () => {
    const support = resolveEffortSupport(CAPABILITY_MODELS, "claude-haiku-4-5");
    expect(support.supported).toBe(false);
    expect(support.levels).toEqual([]);
  });

  test("no model id resolves to the default (account-default) row's support", () => {
    const support = resolveEffortSupport(CAPABILITY_MODELS, null);
    expect(support.supported).toBe(true);
    expect(support.levels).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  test("resumed session (no caps) resolves support from the known model id", () => {
    // Empty capabilities but a known model → static KNOWN_MODELS fallback.
    const opus = resolveEffortSupport([], "claude-opus-4-8[1m]");
    expect(opus.supported).toBe(true);
    expect(opus.levels).toEqual(["low", "medium", "high", "xhigh", "max"]);

    const sonnet = resolveEffortSupport([], "claude-sonnet-4-6");
    expect(sonnet.supported).toBe(true);
    expect(sonnet.levels).toEqual(["low", "medium", "high", "max"]);

    const haiku = resolveEffortSupport([], "claude-haiku-4-5");
    expect(haiku.supported).toBe(false);
    expect(haiku.levels).toEqual([]);
  });

  test("nothing known (no caps, no model) is gated — unknowable support", () => {
    const support = resolveEffortSupport([], null);
    expect(support.supported).toBe(false);
    expect(support.levels).toEqual([]);
  });
});
