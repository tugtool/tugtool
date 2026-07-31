/**
 * Pure-logic coverage for path resolution.
 *
 * The network round trip is not simulated here — a mocked fetch would
 * only prove the mock was called. The real endpoint is driven by the
 * app-test that clicks a real path in a real transcript. What this file
 * pins is everything the store decides on its own: how a candidate
 * resolves to something askable, how wants are batched, and — driving the
 * real store with real response shapes — how verdicts settle, when the
 * version moves, and what happens when an answer never comes.
 */

import { describe, expect, test } from "bun:test";

import {
  PathResolutionStore,
  chunkPaths,
  joinPath,
  resolveCandidate,
} from "../path-resolution";

describe("joinPath", () => {
  test("joins a relative path onto a cwd", () => {
    expect(joinPath("/repo", "src/a.ts")).toBe("/repo/src/a.ts");
  });

  test("tolerates a trailing slash on the cwd", () => {
    expect(joinPath("/repo/", "src/a.ts")).toBe("/repo/src/a.ts");
  });

  test("normalizes . and .. away", () => {
    expect(joinPath("/repo", "./src/../lib/a.ts")).toBe("/repo/lib/a.ts");
    expect(joinPath("/repo/src", "../lib/a.ts")).toBe("/repo/lib/a.ts");
  });

  test("collapses repeated separators", () => {
    expect(joinPath("/repo", "src//a.ts")).toBe("/repo/src/a.ts");
  });
});

describe("resolveCandidate", () => {
  test("an absolute candidate needs no cwd", () => {
    expect(resolveCandidate("/repo/a.ts", null)).toBe("/repo/a.ts");
  });

  test("an absolute candidate is normalized so spellings share a cache entry", () => {
    expect(resolveCandidate("/repo/./src/../a.ts", null)).toBe("/repo/a.ts");
  });

  test("a relative candidate resolves against the cwd", () => {
    expect(resolveCandidate("src/a.ts", "/repo")).toBe("/repo/src/a.ts");
  });

  test("a relative candidate with no cwd is unresolvable, not guessed", () => {
    expect(resolveCandidate("src/a.ts", null)).toBeNull();
  });
});

describe("chunkPaths", () => {
  test("a batch under the cap stays whole", () => {
    expect(chunkPaths(["a", "b"], 64)).toEqual([["a", "b"]]);
  });

  test("splits at the endpoint's cap", () => {
    const paths = Array.from({ length: 70 }, (_, i) => `/p/${i}`);
    const chunks = chunkPaths(paths);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(64);
    expect(chunks[1].length).toBe(6);
    expect(chunks.flat()).toEqual(paths);
  });

  test("an empty batch produces no chunks", () => {
    expect(chunkPaths([])).toEqual([]);
  });
});

describe("verdicts settle on the real store", () => {
  test("an unseen path is unknown, and asking does not answer it", () => {
    const store = new PathResolutionStore();
    expect(store.lookup("/repo/a.ts", null)).toEqual({ state: "unknown" });
  });

  test("a confirmed path carries the canonical form the endpoint returned", () => {
    const store = new PathResolutionStore();
    store.lookup("/repo/a.ts", null);
    store.applyProbeResult(["/repo/a.ts"], {
      exists: { "/repo/a.ts": true },
      canonical: { "/repo/a.ts": "/private/repo/a.ts" },
      isDir: {},
    });
    expect(store.lookup("/repo/a.ts", null)).toEqual({
      state: "confirmed",
      canonical: "/private/repo/a.ts",
        isDir: false,
    });
  });

  test("a confirmed path with no canonical form falls back to itself", () => {
    const store = new PathResolutionStore();
    store.applyProbeResult(["/repo/a.ts"], {
      exists: { "/repo/a.ts": true },
      canonical: {},
      isDir: {},
    });
    expect(store.lookup("/repo/a.ts", null)).toEqual({
      state: "confirmed",
      canonical: "/repo/a.ts",
        isDir: false,
    });
  });

  test("a missing path stays missing — it is cached, not re-asked", () => {
    const store = new PathResolutionStore();
    store.applyProbeResult(["/repo/gone.ts"], {
      exists: { "/repo/gone.ts": false },
      canonical: {},
      isDir: {},
    });
    expect(store.lookup("/repo/gone.ts", null)).toEqual({ state: "missing" });
  });

  test("a lost answer returns the path to unknown, never to a false verdict", () => {
    const store = new PathResolutionStore();
    store.applyProbeResult(["/repo/a.ts"], null);
    expect(store.lookup("/repo/a.ts", null)).toEqual({ state: "unknown" });
  });

  test("a path the response omits is also unknown, not missing", () => {
    const store = new PathResolutionStore();
    store.applyProbeResult(["/repo/a.ts", "/repo/b.ts"], {
      exists: { "/repo/a.ts": true },
      canonical: {},
      isDir: {},
    });
    expect(store.lookup("/repo/b.ts", null)).toEqual({ state: "unknown" });
  });

  test("a relative candidate with no cwd is never cached, so the cwd's arrival can answer it", () => {
    const store = new PathResolutionStore();
    expect(store.lookup("src/a.ts", null)).toEqual({ state: "unknown" });
    store.applyProbeResult(["/repo/src/a.ts"], {
      exists: { "/repo/src/a.ts": true },
      canonical: {},
      isDir: {},
    });
    expect(store.lookup("src/a.ts", "/repo")).toEqual({
      state: "confirmed",
      canonical: "/repo/src/a.ts",
        isDir: false,
    });
  });
});

describe("the version moves exactly when the ink would need re-marking", () => {
  test("a verdict arrival bumps it", () => {
    const store = new PathResolutionStore();
    const before = store.version();
    store.applyProbeResult(["/repo/a.ts"], {
      exists: { "/repo/a.ts": true },
      canonical: {},
      isDir: {},
    });
    expect(store.version()).toBeGreaterThan(before);
  });

  test("the same verdict again does not", () => {
    const store = new PathResolutionStore();
    const result = { exists: { "/repo/a.ts": true }, canonical: {}, isDir: {} };
    store.applyProbeResult(["/repo/a.ts"], result);
    const after = store.version();
    store.applyProbeResult(["/repo/a.ts"], result);
    expect(store.version()).toBe(after);
  });

  test("a lost answer for a path we never knew does not", () => {
    const store = new PathResolutionStore();
    const before = store.version();
    store.applyProbeResult(["/repo/a.ts"], null);
    expect(store.version()).toBe(before);
  });

  test("subscribers hear about arrivals until they unsubscribe", () => {
    const store = new PathResolutionStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.applyProbeResult(["/repo/a.ts"], {
      exists: { "/repo/a.ts": true },
      canonical: {},
      isDir: {},
    });
    expect(notifications).toBe(1);
    unsubscribe();
    store.applyProbeResult(["/repo/b.ts"], {
      exists: { "/repo/b.ts": true },
      canonical: {},
      isDir: {},
    });
    expect(notifications).toBe(1);
  });
});
