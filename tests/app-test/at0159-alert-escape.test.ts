/**
 * at0159-alert-escape.test.ts — `tug-alert` joins the engine focus trap; Escape
 * is engine-owned ([P06] of the engine-owned-Escape model).
 *
 * The alert was the one dismissable surface entirely outside the engine model.
 * After it joins the trap, its Escape is arbitrated by the engine's Escape ladder
 * (Radix's own Escape suppressed) and routes to the alert's cancel path, and the
 * trap's teardown writer returns focus to the opener context. App-modal blocking
 * is unchanged — only who routes the Escape. This pins:
 *   - opening the alert mounts `data-slot="tug-alert"`;
 *   - Escape closes it (the engine ladder → the alert's cancel);
 *   - focus returns into the opener card (not stranded in the removed overlay).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const ALERT = '[data-slot="tug-alert"]';
// The first push button in the gallery-alert card is the "Replace File" basic
// alert trigger (useTugAlert hook).
const TRIGGER = `${CARD} [data-slot="tug-push-button"]`;

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

describe.skipIf(!SHOULD_RUN)("AT0159: tug-alert Escape is engine-owned", () => {
  test(
    "open the basic alert, Escape closes it, focus returns to the opener card",
    async () => {
      const app = await launchTugApp({ testName: "at0159-alert-escape" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        // gallery-alert is a pure gallery card (no text-editor engine), so there
        // is no engine to await — wait for the trigger button to mount.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TRIGGER)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Open the alert by clicking its trigger.
        await app.nativeClickAtElement(TRIGGER);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(ALERT)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Escape: the engine's ladder owns it (Radix Escape is suppressed) and
        // routes to the alert's cancel path → the alert closes.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(ALERT)}) === null`,
          { timeoutMs: 6000 },
        );

        // Focus returned to the opener context — into the card, not stranded on
        // the removed overlay / <body>.
        await app.waitForCondition<boolean>(
          `(function(){
            var ae = document.activeElement;
            var card = document.querySelector(${JSON.stringify(CARD)});
            return card !== null && ae !== null && card.contains(ae);
          })()`,
          { timeoutMs: 6000 },
        );
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0159-alert-escape] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
