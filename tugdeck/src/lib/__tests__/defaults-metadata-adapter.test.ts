/**
 * defaults-metadata-adapter.test.ts — pure-logic coverage for
 * `buildDefaultsSnapshot`, the memoized snapshot builder behind
 * `DefaultsMetadataAdapter`. The adapter's React binding (chips rendering the
 * defaults in Settings) is proven through the real-app test, not here.
 */

import { describe, expect, test } from "bun:test";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import { buildDefaultsSnapshot } from "@/lib/defaults-metadata-adapter";

const CATALOG: CapabilityModel[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 4.8 with 1M context",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  { value: "sonnet", displayName: "Sonnet", supportsEffort: true },
  { value: "haiku", displayName: "Haiku" },
];

describe("buildDefaultsSnapshot", () => {
  test("maps the selector to its catalog display label", () => {
    const snapshot = buildDefaultsSnapshot("default", "default", "high", CATALOG);
    expect(snapshot.model).toBe("Default");

    const sonnet = buildDefaultsSnapshot("sonnet", "default", "high", CATALOG);
    expect(sonnet.model).toBe("Sonnet");
  });

  test("with no catalog, the default selector still reads Default", () => {
    const snapshot = buildDefaultsSnapshot("default", "default", "high", null);
    expect(snapshot.model).toBe("Default");
    expect(snapshot.models).toEqual([]);
  });

  test("passes mode + effort through and sets models from the catalog", () => {
    const snapshot = buildDefaultsSnapshot(
      "haiku",
      "acceptEdits",
      "medium",
      CATALOG,
    );
    expect(snapshot.permissionMode).toBe("acceptEdits");
    expect(snapshot.effort).toBe("medium");
    expect(snapshot.models).toBe(CATALOG);
  });

  test("fills the session-only fields with inert defaults", () => {
    const snapshot = buildDefaultsSnapshot("default", "plan", "low", CATALOG);
    expect(snapshot.sessionId).toBeNull();
    expect(snapshot.cwd).toBeNull();
    expect(snapshot.version).toBeNull();
    expect(snapshot.slashCommands).toEqual([]);
  });

  test("identical inputs return the same cached reference", () => {
    const first = buildDefaultsSnapshot("sonnet", "default", "high", CATALOG);
    const second = buildDefaultsSnapshot("sonnet", "default", "high", CATALOG);
    expect(second).toBe(first);
  });

  test("any changed input produces a fresh snapshot", () => {
    const base = buildDefaultsSnapshot("sonnet", "default", "high", CATALOG);

    const modelChanged = buildDefaultsSnapshot(
      "haiku",
      "default",
      "high",
      CATALOG,
    );
    expect(modelChanged).not.toBe(base);
    expect(modelChanged.model).toBe("Haiku");

    const modeChanged = buildDefaultsSnapshot(
      "haiku",
      "acceptEdits",
      "high",
      CATALOG,
    );
    expect(modeChanged).not.toBe(modelChanged);

    const effortChanged = buildDefaultsSnapshot(
      "haiku",
      "acceptEdits",
      "max",
      CATALOG,
    );
    expect(effortChanged).not.toBe(modeChanged);

    const freshCatalog = [...CATALOG];
    const catalogChanged = buildDefaultsSnapshot(
      "haiku",
      "acceptEdits",
      "max",
      freshCatalog,
    );
    expect(catalogChanged).not.toBe(effortChanged);
    expect(catalogChanged.models).toBe(freshCatalog);
  });
});
