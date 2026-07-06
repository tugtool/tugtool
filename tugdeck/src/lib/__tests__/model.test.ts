/**
 * model.test.ts — pure-logic coverage for the model persistence helpers.
 *
 * No store, no DOM — the chip rendering, per-card persistence, and the
 * `model_change` round-trip are covered by the real-app test; this pins the
 * selector validation, persisted-value parsing, and the seed resolution that
 * lets a fresh card adopt the deck-wide default while a used card keeps its own.
 *
 * The known selectors mirror the picker's static catalog (`default` / `sonnet`
 * / `haiku`), where `default` is the account default.
 */

import { describe, expect, test } from "bun:test";
import type { TaggedValue } from "@/lib/tugbank-client";
import {
  isModelSelector,
  parsePersistedModel,
  resolveSeedModel,
} from "@/lib/model";

describe("isModelSelector", () => {
  test("accepts the catalog selectors", () => {
    expect(isModelSelector("default")).toBe(true);
    expect(isModelSelector("sonnet")).toBe(true);
    expect(isModelSelector("haiku")).toBe(true);
  });

  test("rejects a resolved model id or an unknown string", () => {
    expect(isModelSelector("claude-opus-4-8[1m]")).toBe(false);
    expect(isModelSelector("gpt")).toBe(false);
    expect(isModelSelector("")).toBe(false);
  });
});

describe("parsePersistedModel", () => {
  test("reads a string-kinded tagged value that is a known selector", () => {
    const entry: TaggedValue = { kind: "string", value: "sonnet" };
    expect(parsePersistedModel(entry)).toBe("sonnet");
  });

  test("returns null for undefined, non-string, or unknown-selector values", () => {
    expect(parsePersistedModel(undefined)).toBeNull();
    expect(parsePersistedModel({ kind: "number", value: 3 })).toBeNull();
    expect(parsePersistedModel({ kind: "string", value: "opus-99" })).toBeNull();
  });
});

describe("resolveSeedModel", () => {
  test("per-card persisted selector wins over the global default", () => {
    expect(resolveSeedModel("sonnet", "haiku")).toBe("sonnet");
  });

  test("falls back to the global default when nothing is persisted", () => {
    expect(resolveSeedModel(null, "haiku")).toBe("haiku");
  });

  test("is null when neither is set (leave the session untouched)", () => {
    expect(resolveSeedModel(null, null)).toBeNull();
  });
});
