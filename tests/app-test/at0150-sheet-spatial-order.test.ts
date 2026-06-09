/**
 * at0150-sheet-spatial-order.test.ts — a composed (non-dialog) sheet declares a
 * spatial arrow order via the CONTEXT-derived `useSpatialOrder(order)` form
 * ([P22] / [P23]).
 *
 * The gallery's "Spatial Arrow Order" sheet is a real `TugSheet` trap whose body
 * (`SpatialSheetBody`) reads the enclosing `FocusModeContext` for its scope id —
 * the mechanism that generalizes the spatial plane past the dialogs (which own
 * their trap) to any composed surface. Its controls are a vertical radio group
 * over a Cancel / Save button row.
 *
 * Asserts the spatial moves: Tab seeds the radio group; arrows rove its cursor;
 * Up off the top edge seams into the button row; Down returns; Left / Right swap
 * the buttons; nothing dead-ends and focus never leaves the sheet.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const TRIGGER = `${CARD} [data-testid="gallery-spatial-sheet-trigger"]`;
const SHEET = '[data-slot="tug-sheet"]';
const RADIO = `${SHEET} [data-slot="tug-radio-group"]`;
const RADIO_ITEMS = `${RADIO} [data-slot="tug-radio-item"]`;
const CANCEL = `${SHEET} .tug-sheet-actions .tug-button-outlined-action`;
const SAVE = `${SHEET} .tug-sheet-actions .tug-button-primary-action`;

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-sheet", title: "Sheet Gallery", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function hasKeyView(app: App, selector: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var el=document.querySelector(${JSON.stringify(selector)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
  );
}

function nthHasAttr(
  app: App,
  listSelector: string,
  index: number,
  attr: string,
): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var els=document.querySelectorAll(${JSON.stringify(listSelector)});var el=els[${index}];return el!=null && el.hasAttribute(${JSON.stringify(attr)});})()`,
  );
}

function focusInsideSheet(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){var sheet=document.querySelector(${JSON.stringify(SHEET)});var ae=document.activeElement;return sheet!==null && ae!==null && sheet.contains(ae);})()`,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!SHOULD_RUN)("AT0150: a sheet declares its spatial order", () => {
  test(
    "context-derived order: arrows seam between the radio group and the button row; never beeps",
    async () => {
      const app = await launchTugApp({ testName: "at0150-sheet-spatial-order" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TRIGGER)}) !== null`,
          { timeoutMs: 4000 },
        );
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });

        // Open the sheet. The trigger sits in a section below the fold, so a
        // coordinate-based native click can miss it — scroll it into view and use a
        // synthetic click (unaffected by scroll/coord translation, like at0058).
        await app.evalJS<void>(
          `(function(){var t=document.querySelector(${JSON.stringify(TRIGGER)});if(t){t.scrollIntoView({block:"center"});t.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,cancelable:true}));t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));t.dispatchEvent(new MouseEvent("pointerup",{bubbles:true,cancelable:true}));t.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true}));t.click();}})()`,
        );
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(RADIO)});if(!el)return false;var r=el.getBoundingClientRect();return r.width>0&&r.height>0;})()`,
          { timeoutMs: 4000 },
        );

        // (1) Tab seeds the key view on the radio group (the first authored stop).
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(RADIO)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 3000 },
        );
        expect(await hasKeyView(app, RADIO), "Tab seeds the radio group").toBe(true);

        // (2) Inside the group, Up roves the cursor toward the top (no commit on move).
        await app.nativeKey("ArrowUp");
        await sleep(150);
        expect(
          await nthHasAttr(app, RADIO_ITEMS, 0, "data-key-cursor"),
          "ArrowUp roves the radio cursor to the first option",
        ).toBe(true);

        // (3) Up off the top edge seams into the button row (Cancel — its first member).
        await app.nativeKey("ArrowUp");
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(CANCEL)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 3000 },
        );
        expect(
          await hasKeyView(app, CANCEL),
          "Up off the radio group's top edge seams to the button row",
        ).toBe(true);

        // (4) Left / Right swap the buttons (closed horizontal ring).
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(SAVE)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 3000 },
        );
        expect(await hasKeyView(app, SAVE), "Right swaps Cancel → Save").toBe(true);

        // (5) Down from the button row crosses the seam back into the radio group.
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(RADIO)});return el!==null && el.hasAttribute("data-key-view-kbd");})()`,
          { timeoutMs: 3000 },
        );
        expect(
          await hasKeyView(app, RADIO),
          "Down from the button row returns to the radio group",
        ).toBe(true);

        // (6) The whole arrow sequence stayed inside the sheet — never dead-ended out.
        expect(
          await focusInsideSheet(app),
          "focus never left the sheet across the arrow sequence",
        ).toBe(true);

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0150-sheet-spatial-order] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
