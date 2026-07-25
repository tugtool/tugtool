/**
 * model-selector.test.ts — pure-logic coverage for matching a saved selector
 * against the live catalog across the respellings claude ships: the `[Nm]`
 * context-variant suffix, the `claude-` vendor prefix, a dated-snapshot tail,
 * and short family selectors alongside fully-qualified ids.
 */

import { describe, expect, test } from "bun:test";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import { canonicalModelKey, resolveCatalogSelector } from "@/lib/model-selector";

const CATALOG: CapabilityModel[] = [
  { value: "default", displayName: "Default (recommended)" },
  { value: "opus[1m]", displayName: "Opus (1M context)" },
  { value: "claude-fable-5[1m]", displayName: "Fable" },
  { value: "sonnet", displayName: "Sonnet" },
  { value: "haiku", displayName: "Haiku" },
];

describe("canonicalModelKey", () => {
  test("drops the vendor prefix, the context suffix, and a dated tail", () => {
    expect(canonicalModelKey("claude-fable-5[1m]")).toBe("fable-5");
    expect(canonicalModelKey("claude-fable-5")).toBe("fable-5");
    expect(canonicalModelKey("opus[1m]")).toBe("opus");
    expect(canonicalModelKey("claude-haiku-4-5-20251001")).toBe("haiku-4-5");
    expect(canonicalModelKey("  Sonnet  ")).toBe("sonnet");
  });
});

describe("resolveCatalogSelector", () => {
  test("exact value wins", () => {
    expect(resolveCatalogSelector("sonnet", CATALOG)?.value).toBe("sonnet");
    expect(resolveCatalogSelector("default", CATALOG)?.value).toBe("default");
  });

  test("matches across a context-variant respelling, both directions", () => {
    expect(resolveCatalogSelector("claude-fable-5", CATALOG)?.value).toBe(
      "claude-fable-5[1m]",
    );
    expect(resolveCatalogSelector("opus", CATALOG)?.value).toBe("opus[1m]");
    expect(
      resolveCatalogSelector("claude-sonnet-4-6[1m]", CATALOG)?.value,
    ).toBe("sonnet");
  });

  test("matches a family selector against a fully-qualified row", () => {
    expect(resolveCatalogSelector("fable", CATALOG)?.value).toBe(
      "claude-fable-5[1m]",
    );
    expect(resolveCatalogSelector("claude-haiku-4-5", CATALOG)?.value).toBe(
      "haiku",
    );
  });

  test("never drifts onto the default row — it names no model", () => {
    const rows: CapabilityModel[] = [
      { value: "default", displayName: "Default (recommended)" },
    ];
    expect(resolveCatalogSelector("sonnet", rows)).toBeNull();
    expect(resolveCatalogSelector("claude-default-5", rows)).toBeNull();
  });

  test("null for a model the catalog genuinely lacks", () => {
    expect(resolveCatalogSelector("fable-9", [CATALOG[0], CATALOG[3]])).toBeNull();
    expect(resolveCatalogSelector("gpt", CATALOG)).toBeNull();
    expect(resolveCatalogSelector("", CATALOG)).toBeNull();
  });

  test("catalog order breaks a tie among same-family rows", () => {
    const rows: CapabilityModel[] = [
      { value: "claude-opus-5[1m]", displayName: "Opus 5" },
      { value: "claude-opus-4-8", displayName: "Opus 4.8" },
    ];
    expect(resolveCatalogSelector("opus", rows)?.value).toBe("claude-opus-5[1m]");
  });
});
