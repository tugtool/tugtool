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
 * The press paints through the row's `::after` layer, so that is what this
 * reads. Three moments, one gesture, on the gallery's own `TugListRow` rows:
 *   - **rest** — pointer away from the row: the layer is fully transparent.
 *   - **held** — a native mouseDown parked on the row: the layer is fully
 *     opaque, and its transition duration is ZERO. The press lands on the frame
 *     the button goes down; nothing about it eases in.
 *   - **released** — after the mouseUp: transparent again, and the duration in
 *     force at rest is non-zero. That asymmetry IS the feature — pop in, fade
 *     out — and it is the half a screenshot could never catch.
 *
 * Read as computed values rather than colors, so the pin survives any retune of
 * the tokens (at0110 owns the hue) or of the fade's length.
 *
 * @covers tugdeck/src/components/tugways/tug-list-row.css
 * @covers tugdeck/src/components/tugways/cards/gallery-tug-list-row.tsx
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp } from "./_harness";
import { appIsActive } from "./_harness/selectors";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const GALLERY = `${CARD} [data-testid="gallery-tug-list-row"]`;
/** The Variants section's first `flush` row ("Rest row"). */
const ROW = `${GALLERY} .tug-list-row[data-variant="flush"]`;

/** The press layer's pose: how present it is, and the clock it is under. */
const PRESS_LAYER = `(function(){
  var el = document.querySelector(${JSON.stringify(ROW)});
  if (el === null) throw new Error("gallery list row not found");
  var s = getComputedStyle(el, "::after");
  return { opacity: s.opacity, duration: s.transitionDuration };
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
        // Gate on the app-active projection, the bit `focus-ring.css` suppresses
        // every mark under. NOT `document.hasFocus()`: a background-mode harness
        // window never activates, so that never becomes true (see `appIsActive`).
        await app.waitForCondition<boolean>(appIsActive(), {
          timeoutMs: 6_000,
        });

        const settle = (ms = 250): Promise<void> =>
          new Promise<void>((r) => setTimeout(r, ms));

        const bounds = await app.getElementBounds(ROW);
        const point = {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        };

        type Pose = { opacity: string; duration: string };
        const rest = await app.evalJS<Pose>(PRESS_LAYER);

        await app.nativeMouseDown(point);
        await settle();
        const held = await app.evalJS<Pose>(PRESS_LAYER);

        await app.nativeMouseUp(point);
        await settle();
        const released = await app.evalJS<Pose>(PRESS_LAYER);

        console.log(
          "[at0273] rest / held / released:",
          JSON.stringify({ rest, held, released }),
        );

        // The press is visible at all, and gone again after the release.
        expect(rest.opacity).toBe("0");
        expect(held.opacity).toBe("1");
        expect(released.opacity).toBe("0");

        // Pop in: nothing eases the press onto the row.
        expect(held.duration).toBe("0s");
        // Fade out: the release is the part that takes time.
        expect(parseFloat(released.duration)).toBeGreaterThan(0);
        expect(released.duration).toBe(rest.duration);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
