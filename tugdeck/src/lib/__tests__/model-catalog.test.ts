/**
 * model-catalog.test.ts — pure-logic coverage for `parsePersistedCatalog`, the
 * narrower that turns an untrusted persisted tugbank value into a usable
 * `CapabilityModel[]` (the always-current model list). The persist/read/fallback
 * round-trip through tugbank is covered by the real-app test.
 */

import { describe, expect, test } from "bun:test";
import type { TaggedValue } from "@/lib/tugbank-client";
import { parsePersistedCatalog } from "@/lib/model-catalog";

describe("parsePersistedCatalog", () => {
  test("parses a json-kind array of well-formed models", () => {
    const entry: TaggedValue = {
      kind: "json",
      value: [
        {
          value: "default",
          displayName: "Default (recommended)",
          description: "Opus",
          supportsEffort: true,
          supportedEffortLevels: ["low", "high"],
        },
        { value: "haiku", displayName: "Haiku" },
      ],
    };
    expect(parsePersistedCatalog(entry)).toEqual([
      {
        value: "default",
        displayName: "Default (recommended)",
        description: "Opus",
        supportsEffort: true,
        supportedEffortLevels: ["low", "high"],
      },
      { value: "haiku", displayName: "Haiku" },
    ]);
  });

  test("skips malformed entries but keeps the well-formed ones", () => {
    const entry: TaggedValue = {
      kind: "json",
      value: [
        { value: "ok", displayName: "OK" },
        { value: "no-name" }, // missing displayName → skipped
        { displayName: "no-value" }, // missing value → skipped
        null,
        "garbage",
      ],
    };
    expect(parsePersistedCatalog(entry)).toEqual([
      { value: "ok", displayName: "OK" },
    ]);
  });

  test("returns null for a non-json kind, a non-array, or an empty list", () => {
    expect(parsePersistedCatalog(undefined)).toBeNull();
    expect(parsePersistedCatalog({ kind: "string", value: "x" })).toBeNull();
    expect(parsePersistedCatalog({ kind: "json", value: {} })).toBeNull();
    expect(parsePersistedCatalog({ kind: "json", value: [] })).toBeNull();
    // an all-malformed list yields no usable entries → null, so the caller
    // falls back to the bootstrap seed rather than an empty picker
    expect(
      parsePersistedCatalog({ kind: "json", value: [{ value: 1 }] }),
    ).toBeNull();
  });
});
