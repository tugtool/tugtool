/**
 * keyboard-access-store -- pure-logic tests for mode defaulting, normalization,
 * change notification, and toggle.
 *
 * The DOM projection (`data-keyboard-access` on the document root) is verified
 * in the real app via app-test, not here -- bun:test has no document, so
 * `applyAttribute` is a guarded no-op. Persistence (`putKeyboardAccess`) is a
 * fire-and-forget network call exercised at the real layer; these tests use
 * `persist: false` to keep them off the wire.
 */

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_KEYBOARD_ACCESS_MODE,
  keyboardAccessStore,
  normalizeKeyboardAccessMode,
} from "../keyboard-access-store";

describe("normalizeKeyboardAccessMode", () => {
  test("maps only the literal accessibility, else standard", () => {
    expect(normalizeKeyboardAccessMode("accessibility")).toBe("accessibility");
    expect(normalizeKeyboardAccessMode("standard")).toBe("standard");
    expect(normalizeKeyboardAccessMode(null)).toBe("standard");
    expect(normalizeKeyboardAccessMode(undefined)).toBe("standard");
    expect(normalizeKeyboardAccessMode("garbage")).toBe("standard");
  });
});

describe("keyboardAccessStore", () => {
  test("defaults to standard", () => {
    expect(DEFAULT_KEYBOARD_ACCESS_MODE).toBe("standard");
    expect(keyboardAccessStore.getSnapshot()).toBe("standard");
  });

  test("setMode changes the mode and notifies subscribers", () => {
    let notifications = 0;
    const unsubscribe = keyboardAccessStore.subscribe(() => {
      notifications += 1;
    });
    keyboardAccessStore.setMode("accessibility", { persist: false });
    expect(keyboardAccessStore.getMode()).toBe("accessibility");
    expect(notifications).toBe(1);
    // Setting the same value again does not re-notify.
    keyboardAccessStore.setMode("accessibility", { persist: false });
    expect(notifications).toBe(1);
    unsubscribe();
    keyboardAccessStore.setMode("standard", { persist: false });
    expect(notifications).toBe(1); // no longer subscribed
    expect(keyboardAccessStore.getMode()).toBe("standard");
  });

  test("toggle flips between modes", () => {
    keyboardAccessStore.setMode("standard", { persist: false });
    // toggle persists by default; relies on fetch being fire-and-forget. Guard
    // by toggling back so the singleton is left in its default for other tests.
    const seen: string[] = [];
    const unsubscribe = keyboardAccessStore.subscribe(() => {
      seen.push(keyboardAccessStore.getMode());
    });
    keyboardAccessStore.toggle();
    expect(keyboardAccessStore.getMode()).toBe("accessibility");
    keyboardAccessStore.toggle();
    expect(keyboardAccessStore.getMode()).toBe("standard");
    expect(seen).toEqual(["accessibility", "standard"]);
    unsubscribe();
  });
});
