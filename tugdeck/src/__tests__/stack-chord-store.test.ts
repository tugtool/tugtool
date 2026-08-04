/**
 * stack-chord-store.test.ts — the ⌘R slot-stack preference.
 *
 * Three properties matter here and none of them is about React. The
 * normalizer must never answer with something that is neither item, because
 * the host reads it as "cycle unless the string is exactly `reveal`" and a
 * third value would silently mean one of them; setting must notify so the
 * menu-state publisher re-posts (the host is the only place the chord can
 * actually move); and `persist: false` must not write back, or a value that
 * arrived over the DEFAULTS push would echo straight into tugbank.
 */

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";

import {
  DEFAULT_STACK_CHORD,
  normalizeStackChord,
  stackChordStore,
} from "../stack-chord-store";

// The store's write path is a `fetch` in settings-api. Stub it so a set()
// under test cannot reach the network, and count the calls.
const fetchCalls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = mock((url: string) => {
  fetchCalls.push(String(url));
  return Promise.resolve(new Response("{}"));
}) as unknown as typeof fetch;

afterEach(() => {
  stackChordStore.setChord(DEFAULT_STACK_CHORD, { persist: false });
  fetchCalls.length = 0;
});

// Restore the real fetch once the suite is done. It has to be `afterAll` and
// not module scope: module scope runs before any test does, so a restore
// there would put the real `fetch` back before the first `setChord`.
afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("normalizeStackChord", () => {
  test("only the literal `reveal` reads as reveal", () => {
    expect(normalizeStackChord("reveal")).toBe("reveal");
    expect(normalizeStackChord("cycle")).toBe("cycle");
  });

  test("anything unrecognized falls back to the default rather than a third state", () => {
    for (const raw of [null, undefined, "", "Reveal", "menu", "true"]) {
      expect(normalizeStackChord(raw)).toBe(DEFAULT_STACK_CHORD);
    }
  });
});

describe("stackChordStore", () => {
  test("a change notifies subscribers and persists", () => {
    const seen: string[] = [];
    const unsubscribe = stackChordStore.subscribe(() => {
      seen.push(stackChordStore.getChord());
    });

    stackChordStore.setChord("reveal");
    expect(seen).toEqual(["reveal"]);
    expect(fetchCalls.some((u) => u.includes("stackChord"))).toBe(true);

    unsubscribe();
  });

  test("setting the value it already holds is silent", () => {
    let notifications = 0;
    const unsubscribe = stackChordStore.subscribe(() => {
      notifications += 1;
    });

    stackChordStore.setChord(stackChordStore.getChord());
    expect(notifications).toBe(0);
    expect(fetchCalls).toEqual([]);

    unsubscribe();
  });

  test("a value that came FROM tugbank notifies without writing back", () => {
    const seen: string[] = [];
    const unsubscribe = stackChordStore.subscribe(() => {
      seen.push(stackChordStore.getChord());
    });

    stackChordStore.setChord("reveal", { persist: false });
    expect(seen, "the menu-state publisher still has to hear about it").toEqual([
      "reveal",
    ]);
    expect(fetchCalls, "but nothing echoes back to tugbank").toEqual([]);

    unsubscribe();
  });

  test("initialize seeds without persisting — boot reads are not writes", () => {
    stackChordStore.initialize("reveal");
    expect(stackChordStore.getChord()).toBe("reveal");
    expect(fetchCalls).toEqual([]);
  });
});
