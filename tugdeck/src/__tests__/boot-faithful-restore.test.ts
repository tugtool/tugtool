/**
 * Faithful-restore boot guard.
 *
 * A reload must never rebuild the deck from a tugbank cache that has not yet
 * received its first DEFAULTS frame. Boundary hygiene reduces how often HMR
 * reloads, but cannot remove every reload trigger — so any reload that does
 * happen must restore the deck faithfully (cards survive, no orphan "live"
 * sessions). The concrete invariant: `main.tsx` must `await
 * tugbankClient.ready()` before constructing the `DeckManager`.
 *
 * This regression bit once already: the await was commented out, so a reload
 * raced the DEFAULTS frame, `readLayout` returned null, and the deck rebuilt
 * empty — blowing away the open card and stranding its server session as a
 * "Live in another card" picker row. This is a pure-logic source guard (no
 * fake-DOM; happy-dom is deleted): it reads `main.tsx` and fails if the await
 * is removed, commented out, or reordered after `new DeckManager`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Strip block and line comments so a commented-out call is not seen as live code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const MAIN_SRC = stripComments(
  readFileSync(resolve(import.meta.dir, "..", "main.tsx"), "utf8"),
);

describe("boot faithful-restore invariant", () => {
  test("main.tsx awaits tugbankClient.ready() (live, not commented out)", () => {
    expect(MAIN_SRC).toContain("tugbankClient.ready()");
  });

  test("the ready() call is awaited before the deck is constructed", () => {
    const idxReady = MAIN_SRC.indexOf("tugbankClient.ready()");
    const idxDeck = MAIN_SRC.indexOf("new DeckManager(");
    expect(idxReady).toBeGreaterThanOrEqual(0);
    expect(idxDeck).toBeGreaterThanOrEqual(0);
    // Construction must come after the cache is ready.
    expect(idxReady).toBeLessThan(idxDeck);
  });

  test("ready() resolves under an await (awaited directly or via Promise.all)", () => {
    const awaitedDirectly = /await\s+tugbankClient\.ready\(\)/.test(MAIN_SRC);
    const awaitedInPromiseAll = /await\s+Promise\.all\(\s*\[[\s\S]*?tugbankClient\.ready\(\)[\s\S]*?\]\s*\)/.test(
      MAIN_SRC,
    );
    expect(awaitedDirectly || awaitedInPromiseAll).toBe(true);
  });
});
