/**
 * at0164-alert-focus-language.test.ts — TugAlert carries the full focus
 * language ([P14]/[P22]/[P23]).
 *
 * The alert's Cancel / Action buttons are now authored into a focus group with a
 * closed arrow ring, and the engine seeds the key view on the default button at
 * open (Action for a non-danger confirm). This pins all three:
 *   - on open the default (Action) button holds the ring (`data-key-view`);
 *   - Tab keeps the ring within the button row (the buttons are focus stops);
 *   - an arrow roves the ring between Cancel and Action (and back).
 *
 * Driven on the gallery Basic Alert (confirmRole "action" → Action is default).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const ALERT = '[data-slot="tug-alert"]';
// First push button in the gallery-alert card opens the basic alert.
const TRIGGER = `${CARD} [data-slot="tug-push-button"]`;
const ACTIONS = `${ALERT} .tug-alert-actions`;
const CANCEL = `${ACTIONS} [data-slot="tug-push-button"]:first-child`;
const ACTION = `${ACTIONS} [data-slot="tug-push-button"]:last-child`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-alert", title: "Alert Gallery", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 640, height: 520 },
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

const isRinged = (sel: string) =>
  `(function(){ var el = document.querySelector(${JSON.stringify(sel)});` +
  ` return el !== null && el.hasAttribute("data-key-view"); })()`;

// "cancel" | "action" | "none" — which alert button holds the key-view ring.
const ringedButton = `(function(){
  var c = document.querySelector(${JSON.stringify(CANCEL)});
  var a = document.querySelector(${JSON.stringify(ACTION)});
  if (a && a.hasAttribute("data-key-view")) return "action";
  if (c && c.hasAttribute("data-key-view")) return "cancel";
  return "none";
})()`;

describe.skipIf(!SHOULD_RUN)("AT0164: TugAlert carries the focus language", () => {
  test(
    "default button rings on open; Tab stays on buttons; an arrow roves them",
    async () => {
      const app = await launchTugApp({ testName: "at0164-alert-focus-language" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TRIGGER)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Open the basic alert (confirmRole "action" → Action is the default).
        await app.nativeClickAtElement(TRIGGER);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(ACTION)}) !== null`,
          { timeoutMs: 6000 },
        );

        // 1. The default (Action) button holds the ring at open.
        await app.waitForCondition<boolean>(isRinged(ACTION), { timeoutMs: 3000 });
        expect(
          await app.evalJS<string>(ringedButton),
          "the default Action button must hold the ring on open",
        ).toBe("action");

        // 2. Tab keeps the ring within the button row (buttons are focus stops).
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${ringedButton} !== "none"`, { timeoutMs: 3000 });
        expect(
          ["cancel", "action"],
          "Tab must keep the ring on an alert button",
        ).toContain(await app.evalJS<string>(ringedButton));

        // 3. An arrow roves the button row to the other button, then back.
        const before = await app.evalJS<string>(ringedButton);
        await app.nativeKey("ArrowLeft");
        await app.waitForCondition<boolean>(
          `${ringedButton} !== ${JSON.stringify(before)} && ${ringedButton} !== "none"`,
          { timeoutMs: 3000 },
        );
        const moved = await app.evalJS<string>(ringedButton);
        expect(moved, "ArrowLeft must move the ring to the other button").not.toBe(before);

        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(`${ringedButton} === ${JSON.stringify(before)}`, {
          timeoutMs: 3000,
        });
        expect(await app.evalJS<string>(ringedButton), "ArrowRight moves back").toBe(before);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0164] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
