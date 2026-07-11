/**
 * at0163-sheet-focus-language.test.ts — gallery sheet bodies carry the full
 * focus language ([P14]/[P22]/[P23]).
 *
 * The gallery's Card Settings sheet (compound API) is now wired like every
 * production sheet: the commit (Save) button holds the persistent default ring
 * (`data-default-ring`), Tab walks the controls into the Cancel / Save row, and
 * the arrows rove that row. This pins all three:
 *   - Save carries `data-default-ring` while the caret rests in a field;
 *   - Tab reaches the action buttons (they take the key view, not skipped);
 *   - an arrow moves the ring between Cancel and Save (and back).
 *
 * Ring detection: the engine stamps `data-key-view` on the focused stop and
 * `data-default-ring` on the commit button while the key view is a non-button.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const TRIGGER = `${CARD} [data-testid="gallery-sheet-trigger"]`;
const SHEET = '[data-slot="tug-sheet"]';
const ACTIONS = `${SHEET} .tug-sheet-actions`;
const CANCEL = `${ACTIONS} [data-slot="tug-push-button"]:first-child`;
const SAVE = `${ACTIONS} [data-slot="tug-push-button"]:last-child`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-sheet", title: "Sheet Gallery", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 600 },
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

const hasDefaultRing = (sel: string) =>
  `(function(){ var el = document.querySelector(${JSON.stringify(sel)});` +
  ` return el !== null && el.hasAttribute("data-default-ring"); })()`;

const isRinged = (sel: string) =>
  `(function(){ var el = document.querySelector(${JSON.stringify(sel)});` +
  ` return el !== null && el.hasAttribute("data-key-view"); })()`;

// "cancel" | "save" | "none" — which action button holds the key-view ring.
const ringedButton = `(function(){
  var c = document.querySelector(${JSON.stringify(CANCEL)});
  var s = document.querySelector(${JSON.stringify(SAVE)});
  if (s && s.hasAttribute("data-key-view")) return "save";
  if (c && c.hasAttribute("data-key-view")) return "cancel";
  return "none";
})()`;

describe.skipIf(!SHOULD_RUN)("AT0163: sheet bodies carry the focus language", () => {
  test(
    "Save holds the default ring; Tab reaches buttons; an arrow roves them",
    async () => {
      const app = await launchTugApp({ testName: "at0163-sheet-focus-language" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TRIGGER)}) !== null`,
          { timeoutMs: 5000 },
        );

        // Open the Card Settings sheet; caret seeds in the name field.
        await app.nativeClickAtElement(TRIGGER);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SAVE)}) !== null`,
          { timeoutMs: 5000 },
        );

        // 1. Save carries the persistent default ring while the field holds the
        //    key view.
        await app.waitForCondition<boolean>(hasDefaultRing(SAVE), { timeoutMs: 3000 });
        expect(
          await app.evalJS<boolean>(hasDefaultRing(SAVE)),
          "Save must carry data-default-ring on open",
        ).toBe(true);

        // 2. Tab walks into the action buttons — they take the key view (they are
        //    authored focus stops, not skipped). Poll Tab until a button rings.
        let landed = "none";
        for (let i = 0; i < 8 && landed === "none"; i++) {
          await app.nativeKey("Tab");
          await new Promise((r) => setTimeout(r, 80));
          landed = await app.evalJS<string>(ringedButton);
        }
        expect(["cancel", "save"], "Tab must reach an action button").toContain(landed);

        // 3. An arrow roves the button row: the ring moves to the other button,
        //    then back. Direction-agnostic (the row is a closed horizontal ring).
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(
          `${ringedButton} !== ${JSON.stringify(landed)} && ${ringedButton} !== "none"`,
          { timeoutMs: 3000 },
        );
        const moved = await app.evalJS<string>(ringedButton);
        expect(moved, "ArrowRight must move the ring to the other button").not.toBe(landed);

        await app.nativeKey("ArrowLeft");
        await app.waitForCondition<boolean>(`${ringedButton} === ${JSON.stringify(landed)}`, {
          timeoutMs: 3000,
        });
        expect(await app.evalJS<string>(ringedButton), "ArrowLeft moves back").toBe(landed);

        // Sanity: exactly the two buttons exist and the ringed one is real.
        expect(await app.evalJS<boolean>(isRinged(landed === "save" ? SAVE : CANCEL))).toBe(true);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0163] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
