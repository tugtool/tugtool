/**
 * at0270-addcard-default-focus.test.ts — a freshly ADDED card receives its
 * default focus from the engine registry.
 *
 * Default focus for a card with no saved target is resolved from the card's own
 * `FocusContext` — the head of its authored walk order — with the DOM selector
 * chain as the fallback. The addCard path is the one that can outrun it: the
 * activation settle runs synchronously inside `setKeyCard`, while the new
 * card's children register their focusables in their own layout effects. A
 * tab-switch between mounted cards never shows this window.
 *
 * So this drives the real gesture — `show-card`, the same action ⌘N and the
 * app menu dispatch — and asserts the settled outcome: the new card is the key
 * card, the focus tripwire is clean, and Tab enters that card's OWN authored
 * walk. A registry that had not filled in when the settle ran would leave the
 * keyboard on the outgoing card, and Tab would move something else.
 *
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/default-focus.ts
 * @covers tugdeck/src/focus-transfer.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// One resident card, so the added card activates ACROSS a real outgoing first
// responder rather than into an empty deck.
function oneCard() {
  return {
    cards: [
      { id: "A", componentId: "gallery-input", title: "Card A", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 420, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0270 — addCard default focus", () => {
  test(
    "show-card adds a card that ends up the key card holding a key view",
    async () => {
      const app = await launchTugApp({
        testName: "at0270-addcard-default-focus",
      });
      try {
        await app.seedDeckState({ state: oneCard(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(`document.hasFocus()`, {
          timeoutMs: 6000,
        });

        // The real add gesture. `gallery-chain-actions` authors a focus group,
        // so its registry has stops to resolve — the case registry-first
        // resolution exists for.
        await app.evalJS<void>(
          `window.__tug.dispatchControlAction("show-card", { component: "gallery-chain-actions" })`,
        );

        const newCardId = await app.waitForCondition<string>(
          `(function(){
            var cards = window.tugdeck.diag.getDeckState().cards;
            var added = cards.filter(function(c){
              return c.componentId === "gallery-chain-actions";
            });
            return added.length === 1 ? added[0].id : null;
          })()`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(
          `window.__tug.assertHostRootRegistered(${JSON.stringify(newCardId)})`,
          { timeoutMs: 8000 },
        );

        // The settled outcome: the added card is the key card. Polled, not
        // sampled — the registry fills in as the card's children mount, and the
        // point of the test is where things END UP, not the order they arrive.
        await app.waitForCondition<boolean>(
          `window.__tug.getActiveCardId() === ${JSON.stringify(newCardId)}`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('[data-card-id="' + ${JSON.stringify(newCardId)} + '"] [data-tug-focusable]').length >= 2`,
          { timeoutMs: 8000 },
        );

        const report = await app.evalJS<{ violations: number } | null>(
          `window.__tug.getFocusInvariantReport()`,
        );
        console.log("[at0270] invariant report:", JSON.stringify(report));
        expect(report?.violations).toBe(0);

        // Tab enters the ADDED card's own walk — the keyboard followed the
        // activation, and the card's registry answered for it.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector("[data-key-view]");
            if (el === null) return false;
            var host = el.closest("[data-card-id]");
            return host !== null &&
              host.getAttribute("data-card-id") === ${JSON.stringify(newCardId)};
          })()`,
          { timeoutMs: 6000 },
        );
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0270] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
