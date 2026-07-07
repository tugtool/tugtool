/**
 * model-picker-data.test.ts — pure-logic coverage for the `/model` picker's
 * option resolver and the selector/id/label mapping helpers.
 *
 * No store, no DOM — the sheet rendering and the live `model_change`
 * round-trip are covered by the real-app test; this pins the snapshot →
 * (options, activeValue) mapping, including the honest no-catalog placeholder
 * (there is NO hardcoded model list) and the resolved-id → selector family
 * mapping (the live `system_metadata.model` is a resolved id, the picker rows
 * are selectors).
 */

import { describe, expect, test } from "bun:test";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import {
  UNKNOWN_CATALOG_OPTION,
  modelIdToSelector,
  resolvePickerModels,
} from "@/lib/model-picker-data";

const LIVE_LIST: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)" },
  { value: "sonnet", displayName: "Sonnet" },
  { value: "haiku", displayName: "Haiku" },
];

const CATALOG: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)", description: "Opus" },
  { value: "sonnet", displayName: "Sonnet", description: "Everyday" },
];

describe("resolvePickerModels", () => {
  test("uses the live list when present", () => {
    const { options } = resolvePickerModels(LIVE_LIST, null, CATALOG);
    expect(options).toBe(LIVE_LIST);
  });

  test("falls back to the persisted catalog when the live list is empty", () => {
    const { options } = resolvePickerModels([], null, CATALOG);
    expect(options).toBe(CATALOG);
  });

  test("no catalog at all → the single honest Default placeholder", () => {
    const { options, activeValue } = resolvePickerModels([], null, null);
    expect(options).toEqual([UNKNOWN_CATALOG_OPTION]);
    expect(activeValue).toBe("default");
    // The placeholder explains itself — it is a UI state, not model data.
    expect(UNKNOWN_CATALOG_OPTION.description).toContain("first request");
  });

  test("an empty catalog behaves like no catalog", () => {
    const { options } = resolvePickerModels([], null, []);
    expect(options).toEqual([UNKNOWN_CATALOG_OPTION]);
  });

  test("never injects the resolved model as an extra row", () => {
    const { options } = resolvePickerModels(LIVE_LIST, "claude-opus-4-8[1m]", null);
    expect(options).toBe(LIVE_LIST);
    expect(options).toHaveLength(3);
  });

  test("no live model marks the first (default) row active", () => {
    expect(resolvePickerModels(LIVE_LIST, null, null).activeValue).toBe("default");
  });

  test("a resolved opus id maps to the default selector", () => {
    expect(
      resolvePickerModels(LIVE_LIST, "claude-opus-4-8[1m]", null).activeValue,
    ).toBe("default");
  });

  test("a resolved sonnet id maps to the sonnet selector", () => {
    expect(
      resolvePickerModels(LIVE_LIST, "claude-sonnet-4-6", null).activeValue,
    ).toBe("sonnet");
  });

  test("a resolved haiku id maps to the haiku selector", () => {
    expect(
      resolvePickerModels(LIVE_LIST, "claude-haiku-4-5-20251001", null).activeValue,
    ).toBe("haiku");
  });

  test("an unrecognized resolved id falls to the default row", () => {
    expect(resolvePickerModels(LIVE_LIST, "gpt-4o", null).activeValue).toBe(
      "default",
    );
  });
});

describe("modelIdToSelector", () => {
  test("maps resolved ids, labels, and selectors against the rows", () => {
    expect(modelIdToSelector("claude-sonnet-4-6", LIVE_LIST)).toBe("sonnet");
    expect(modelIdToSelector("claude-haiku-4-5-20251001", LIVE_LIST)).toBe(
      "haiku",
    );
    expect(modelIdToSelector("Sonnet", LIVE_LIST)).toBe("sonnet");
    expect(modelIdToSelector("sonnet", LIVE_LIST)).toBe("sonnet");
  });

  test("anything unmatched maps to default", () => {
    expect(modelIdToSelector("claude-opus-4-8[1m]", LIVE_LIST)).toBe("default");
    expect(modelIdToSelector("gpt-4o", LIVE_LIST)).toBe("default");
    expect(modelIdToSelector("claude-fable-5", [])).toBe("default");
  });

  test("a data-driven family maps the moment it appears in the rows", () => {
    const rows: CapabilityModel[] = [
      { value: "default", displayName: "Default (recommended)" },
      { value: "fable", displayName: "Fable" },
    ];
    expect(modelIdToSelector("claude-fable-5", rows)).toBe("fable");
  });

  test("a row describing the same model as Default maps to default", () => {
    // An explicit Opus row alongside a Default row that resolves to Opus —
    // a session on that model checkmarks Default, mirroring the terminal.
    const rows: CapabilityModel[] = [
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus 4.8 with 1M context · Best for everyday work",
      },
      {
        value: "opus",
        displayName: "Opus",
        description: "Opus 4.8 with 1M context · Best for everyday work",
      },
      {
        value: "fable",
        displayName: "Fable",
        description: "Fable 5 · Most capable",
      },
    ];
    expect(modelIdToSelector("claude-opus-4-8[1m]", rows)).toBe("default");
    expect(modelIdToSelector("claude-fable-5", rows)).toBe("fable");
  });
});
