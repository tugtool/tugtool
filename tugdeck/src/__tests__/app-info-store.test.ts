/**
 * app-info-store.test.ts — snapshot identity + subscribe semantics for
 * the in-memory app-identity store behind the About card.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { appInfoStore } from "../lib/app-info-store";

describe("appInfoStore", () => {
  beforeEach(() => {
    appInfoStore._resetForTest();
  });

  it("starts empty", () => {
    expect(appInfoStore.getSnapshot()).toBeNull();
  });

  it("set stores the info and getSnapshot returns a stable reference", () => {
    appInfoStore.set({ version: "1.2.3", build: "456" });
    const first = appInfoStore.getSnapshot();
    expect(first).toEqual({ version: "1.2.3", build: "456" });
    // Identity is stable across reads — required by useSyncExternalStore.
    expect(appInfoStore.getSnapshot()).toBe(first);
  });

  it("notifies subscribers on set and stops after unsubscribe", () => {
    let notified = 0;
    const unsubscribe = appInfoStore.subscribe(() => {
      notified++;
    });

    appInfoStore.set({ version: "1.0.0" });
    expect(notified).toBe(1);

    unsubscribe();
    appInfoStore.set({ version: "2.0.0" });
    expect(notified).toBe(1);
  });

  it("setFromPayload picks string identity fields and drops the rest", () => {
    appInfoStore.setFromPayload({
      action: "show-card",
      component: "about",
      version: "0.8.0",
      build: "800",
      commit: "abcdef0123456789",
      branch: "main",
      profile: "debug",
      copyright: "Copyright © 2026",
      bogus: "ignored",
    });
    expect(appInfoStore.getSnapshot()).toEqual({
      version: "0.8.0",
      build: "800",
      commit: "abcdef0123456789",
      branch: "main",
      profile: "debug",
      copyright: "Copyright © 2026",
    });
  });

  it("setFromPayload drops non-string values per-field", () => {
    appInfoStore.setFromPayload({ version: "1.0.0", build: 800 });
    expect(appInfoStore.getSnapshot()).toEqual({ version: "1.0.0" });
  });
});
