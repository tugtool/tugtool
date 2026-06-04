/**
 * at0125-background-tab-focus-isolation.test.ts — the Tab walk ignores hidden
 * background tab cards ([P01]/[P02]).
 *
 * A pane keeps every card in its tab bar mounted; only the active card is laid
 * out (`display: contents`) while the rest are `display: none`. The engine Tab
 * walk must service only the *frontmost* card: one Tab from the active card
 * lands the key view on its first focusable — never stepping through the
 * focusables of the hidden cards behind it (which would make the Nth tab take N
 * Tabs).
 *
 * Three gallery cards share one pane (choice, option, radio); radio is active
 * and third. The test proves a SINGLE Tab rings the radio card's group, and the
 * hidden cards' groups never take the key view.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const RADIO_CARD = '[data-card-id="C"]';
const TITLE = `${RADIO_CARD} [data-testid="radio-focus-title"]`;
const RADIO_GROUP = `${RADIO_CARD} [data-testid="radio-focus-demo"] [data-slot="tug-radio-group"]`;

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-choice-group", title: "Choice", closable: true },
      { id: "B", componentId: "gallery-option-group", title: "Option", closable: true },
      { id: "C", componentId: "gallery-radio-group", title: "Radio", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 640 },
        cardIds: ["A", "B", "C"],
        activeCardId: "C",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

// Whether any focusable inside a HIDDEN (non-active) card holds the key view.
const HIDDEN_CARD_HAS_KEY_VIEW = `(function(){
  var hidden = document.querySelectorAll('[data-card-id="A"] [data-key-view], [data-card-id="B"] [data-key-view]');
  return hidden.length > 0;
})()`;

const RADIO_GROUP_KBD = `(function(){
  var el = document.querySelector(${JSON.stringify(RADIO_GROUP)});
  return el ? el.hasAttribute("data-key-view-kbd") : false;
})()`;

describe.skipIf(!SHOULD_RUN)("AT0125: the Tab walk skips hidden background tab cards", () => {
  test(
    "one Tab from the active (third) card rings its group; hidden cards never take the key view",
    async () => {
      const app = await launchTugApp({ testName: "at0125-background-tab-focus-isolation" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "C" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("C")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TITLE)}) !== null`,
          { timeoutMs: 8000 },
        );
        // All three cards are mounted, so several focusables are registered —
        // but only the active card's is rendered (laid out).
        await app.waitForCondition<boolean>(
          `document.querySelectorAll("[data-tug-focusable]").length >= 1`,
          { timeoutMs: 6000 },
        );

        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // A SINGLE Tab lands the ring on the active (radio) card's group — not on
        // a background card, and not after N Tabs.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(RADIO_GROUP_KBD, { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(RADIO_GROUP_KBD)).toBe(true);
        expect(await app.evalJS<boolean>(HIDDEN_CARD_HAS_KEY_VIEW)).toBe(false);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
