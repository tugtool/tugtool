/**
 * at0273-list-row-press.test.ts — the `TugListRow` pressed pose.
 *
 * ## What this gates (a failure mode, not busywork)
 *
 * A row whose click ACTS without leaving a selection behind — the Lens session
 * monitor fronts the clicked card and marks nothing — used to do that work in
 * total silence: mouse down, mouse up, the transcript moved, and the row itself
 * never flinched. The press pose is the row's answer to the finger, and it is
 * keyed on `:active`, so nothing in the React tree can be asserted about it: the
 * only honest test is to hold a real mouse button down over a real row and read
 * back what the engine painted.
 *
 * Three reads, one gesture, on the gallery's own `TugListRow` rows:
 *   - **rest** — pointer away from the row.
 *   - **held** — a native mouseDown parked on the row. Must differ from rest.
 *   - **released** — after the mouseUp, pointer still over the row (so this read
 *     is the HOVER fill). Must differ from held, which is what proves the press
 *     is its own rung and not just the hover wash arriving late.
 *
 * Backgrounds are compared as the computed `background-color` string, so the
 * pin survives any retune of the tokens themselves — it asserts that the three
 * poses are distinct, never what color each one is (at0110 owns the hue).
 *
 * @covers tugdeck/src/components/tugways/tug-list-row.css
 * @covers tugdeck/src/components/tugways/cards/gallery-tug-list-row.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const GALLERY = `${CARD} [data-testid="gallery-tug-list-row"]`;
/** The Variants section's first `flush` row ("Rest row"). */
const ROW = `${GALLERY} .tug-list-row[data-variant="flush"]`;

const ROW_BG = `(function(){
  var el = document.querySelector(${JSON.stringify(ROW)});
  if (el === null) throw new Error("gallery list row not found");
  return getComputedStyle(el).backgroundColor;
})()`;

function deckShape() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-tug-list-row",
        title: "List Row",
        closable: true,
      },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 640, height: 620 },
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

describe.skipIf(!SHOULD_RUN)("at0273 — a list row answers the press", () => {
  test(
    "holding the mouse down on a row paints a fill distinct from both rest and hover",
    async () => {
      const app = await launchTugApp({ testName: "at0273-list-row-press" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 8_000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(ROW)}) !== null`,
          { timeoutMs: 8_000 },
        );
        await app.waitForCondition<boolean>(`document.hasFocus()`, {
          timeoutMs: 6_000,
        });

        const settle = (ms = 250): Promise<void> =>
          new Promise<void>((r) => setTimeout(r, ms));

        const bounds = await app.getElementBounds(ROW);
        const point = {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        };

        const rest = await app.evalJS<string>(ROW_BG);

        await app.nativeMouseDown(point);
        await settle();
        const held = await app.evalJS<string>(ROW_BG);

        await app.nativeMouseUp(point);
        await settle();
        const released = await app.evalJS<string>(ROW_BG);

        console.log(
          "[at0273] rest / held / released:",
          JSON.stringify({ rest, held, released }),
        );

        // The press is visible at all…
        expect(held).not.toBe(rest);
        // …and it is its own rung, not the hover wash under another name.
        expect(held).not.toBe(released);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
