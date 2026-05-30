/**
 * model-picker-data.test.ts — pure-logic coverage for the `/model` picker's
 * option resolver ([#step-2b]).
 *
 * No store, no DOM — the sheet rendering and the live `model_change`
 * round-trip are covered by the real-app test; this pins the snapshot →
 * (options, activeValue) mapping, including the static fallback and the
 * resolved-id → selector family mapping (the live `system_metadata.model` is a
 * resolved id, the picker rows are selectors).
 */

import { describe, expect, test } from "bun:test";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import {
  KNOWN_MODELS,
  resolvePickerModels,
  selectorToModelId,
} from "@/lib/model-picker-data";

const LIVE_LIST: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)" },
  { value: "sonnet", displayName: "Sonnet" },
  { value: "haiku", displayName: "Haiku" },
];

describe("resolvePickerModels", () => {
  test("uses the live list when present", () => {
    const { options } = resolvePickerModels(LIVE_LIST, null);
    expect(options).toBe(LIVE_LIST);
  });

  test("falls back to KNOWN_MODELS when the live list is empty", () => {
    const { options } = resolvePickerModels([], null);
    expect(options).toBe(KNOWN_MODELS);
  });

  test("never injects the resolved model as an extra row", () => {
    const { options } = resolvePickerModels(KNOWN_MODELS, "claude-opus-4-8[1m]");
    expect(options).toBe(KNOWN_MODELS);
    expect(options).toHaveLength(3);
  });

  test("no live model marks the first (default) row active", () => {
    expect(resolvePickerModels(LIVE_LIST, null).activeValue).toBe("default");
  });

  test("a resolved opus id maps to the default selector", () => {
    expect(
      resolvePickerModels(KNOWN_MODELS, "claude-opus-4-8[1m]").activeValue,
    ).toBe("default");
  });

  test("a resolved sonnet id maps to the sonnet selector", () => {
    expect(
      resolvePickerModels(LIVE_LIST, "claude-sonnet-4-6").activeValue,
    ).toBe("sonnet");
  });

  test("a resolved haiku id maps to the haiku selector", () => {
    expect(
      resolvePickerModels(LIVE_LIST, "claude-haiku-4-5-20251001").activeValue,
    ).toBe("haiku");
  });

  test("an unrecognized resolved id falls to the default row", () => {
    expect(resolvePickerModels(KNOWN_MODELS, "gpt-4o").activeValue).toBe(
      "default",
    );
  });
});

describe("selectorToModelId", () => {
  test("maps each selector to a representative resolved id", () => {
    expect(selectorToModelId("default")).toBe("claude-opus-4-8[1m]");
    expect(selectorToModelId("sonnet")).toBe("claude-sonnet-4-6");
    expect(selectorToModelId("haiku")).toBe("claude-haiku-4-5");
  });

  test("returns an unknown selector / already-resolved id unchanged", () => {
    expect(selectorToModelId("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(selectorToModelId("sonnet[1m]")).toBe("sonnet[1m]");
  });
});
