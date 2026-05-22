import { describe, it, expect } from "bun:test";

import {
  HostFactsStore,
  parseHostFacts,
  type HostFactsFetch,
} from "../host-facts-store";

// ── Test fetch stubs ───────────────────────────────────────────────────────

/** A stub that resolves a 200 response carrying `body`. */
function okFetch(body: unknown): HostFactsFetch {
  return async () => ({ ok: true, json: async () => body });
}

/** A stub that resolves a non-2xx response. */
function notOkFetch(): HostFactsFetch {
  return async () => ({ ok: false, json: async () => ({}) });
}

/** A stub that rejects, modelling a network failure. */
function rejectingFetch(): HostFactsFetch {
  return () => Promise.reject(new Error("offline"));
}

// ── parseHostFacts ─────────────────────────────────────────────────────────

describe("parseHostFacts", () => {
  it("maps a Spec S01 literal to a HostFacts snapshot", () => {
    expect(parseHostFacts({ hostname: "studio.local", shell: "zsh" })).toEqual({
      hostname: "studio.local",
      shell: "zsh",
    });
  });

  it("accepts an empty shell — the value sent when $SHELL is unset", () => {
    expect(parseHostFacts({ hostname: "studio.local", shell: "" })).toEqual({
      hostname: "studio.local",
      shell: "",
    });
  });

  it("tolerates unknown extra fields, keeping only hostname and shell", () => {
    expect(
      parseHostFacts({
        hostname: "studio.local",
        shell: "zsh",
        platform: "linux",
        extra: 42,
      }),
    ).toEqual({ hostname: "studio.local", shell: "zsh" });
  });

  it("returns null when a contract field is missing", () => {
    expect(parseHostFacts({ hostname: "studio.local" })).toBeNull();
    expect(parseHostFacts({ shell: "zsh" })).toBeNull();
    expect(parseHostFacts({})).toBeNull();
  });

  it("returns null when a contract field is not a string", () => {
    expect(parseHostFacts({ hostname: 123, shell: "zsh" })).toBeNull();
    expect(parseHostFacts({ hostname: "studio.local", shell: null })).toBeNull();
  });

  it("returns null for a non-object body", () => {
    expect(parseHostFacts(null)).toBeNull();
    expect(parseHostFacts(undefined)).toBeNull();
    expect(parseHostFacts("not json")).toBeNull();
    expect(parseHostFacts(42)).toBeNull();
  });
});

// ── HostFactsStore ─────────────────────────────────────────────────────────

describe("HostFactsStore", () => {
  it("resolves the snapshot from a successful fetch", async () => {
    const store = new HostFactsStore(
      okFetch({ hostname: "studio.local", shell: "zsh" }),
    );
    await store.ready();
    expect(store.getSnapshot()).toEqual({
      hostname: "studio.local",
      shell: "zsh",
    });
  });

  it("ignores unknown fields in the fetched body", async () => {
    const store = new HostFactsStore(
      okFetch({ hostname: "studio.local", shell: "zsh", platform: "linux" }),
    );
    await store.ready();
    expect(store.getSnapshot()).toEqual({
      hostname: "studio.local",
      shell: "zsh",
    });
  });

  it("leaves the snapshot empty after a rejected fetch", async () => {
    const store = new HostFactsStore(rejectingFetch());
    await store.ready();
    expect(store.getSnapshot()).toBeNull();
  });

  it("leaves the snapshot empty on a non-2xx response", async () => {
    const store = new HostFactsStore(notOkFetch());
    await store.ready();
    expect(store.getSnapshot()).toBeNull();
  });

  it("leaves the snapshot empty when the body fails Spec S01", async () => {
    const store = new HostFactsStore(okFetch({ hostname: "studio.local" }));
    await store.ready();
    expect(store.getSnapshot()).toBeNull();
  });

  it("starts empty before the fetch resolves", () => {
    const store = new HostFactsStore(
      okFetch({ hostname: "studio.local", shell: "zsh" }),
    );
    expect(store.getSnapshot()).toBeNull();
  });

  it("notifies a subscriber once when the fetch resolves", async () => {
    const store = new HostFactsStore(
      okFetch({ hostname: "studio.local", shell: "zsh" }),
    );
    let ticks = 0;
    store.subscribe(() => {
      ticks += 1;
    });
    await store.ready();
    expect(ticks).toBe(1);
  });

  it("does not notify an unsubscribed listener", async () => {
    const store = new HostFactsStore(
      okFetch({ hostname: "studio.local", shell: "zsh" }),
    );
    let ticks = 0;
    const unsubscribe = store.subscribe(() => {
      ticks += 1;
    });
    unsubscribe();
    await store.ready();
    expect(ticks).toBe(0);
  });

  it("getSnapshot returns a stable reference after resolution", async () => {
    const store = new HostFactsStore(
      okFetch({ hostname: "studio.local", shell: "zsh" }),
    );
    await store.ready();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});
