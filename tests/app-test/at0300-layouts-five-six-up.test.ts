/**
 * at0300-layouts-five-six-up.test.ts — the Layouts picker offers every
 * arrangement the imposer defines, and the dense ones reach the geometry.
 *
 * The Cards axis is drawn from `IMPOSITION_KINDS`, one tile per kind, and every
 * consumer downstream — the miniature, the row slot pickers, the placement
 * math — is written in terms of `slotCount`. So a new arrangement is a list
 * entry and a label, and nothing else. This test is what makes that claim
 * checkable end to end rather than by reading three files.
 *
 * The geometry assertion is deliberately RELATIONAL. Slot 1 of two-up takes all
 * of a pane's travel; slot 1 of six-up takes a fifth of it. Neither number is
 * known here — the travel depends on the window and the Lens's width — but
 * their RATIO is fixed by the imposer's one rule, so the test states the rule
 * instead of re-deriving the band.
 *
 * Scenario:
 *   1. Seed a two-up deck: two slotted panes + the Lens pinned right.
 *   2. Open the Lens and assert the Cards axis offers one-up through six-up,
 *      in ascending order.
 *   3. Measure how far slot 1 stands from slot 0 — the whole travel.
 *   4. Choose Six Up, and assert that distance settles at a fifth of it.
 *
 * @covers tugdeck/src/components/lens/sections/layouts-section.tsx
 * @covers tugdeck/src/components/lens/layout-miniature.tsx
 * @covers tugdeck/src/lib/layout-imposer.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const LENS_WIDTH = 420;
const PANE_WIDTH = 260;

const KIND_TILES = '[data-testid="lens-layouts-kind"] [data-radio-value]';
const SIX_UP_TILE = '[data-testid="lens-layouts-kind"] [data-radio-value="six-up"]';

/** Every kind the imposer offers, in the order the picker must show them. */
const EXPECTED_KINDS = [
  "one-up",
  "two-up",
  "three-up",
  "four-up",
  "five-up",
  "six-up",
];

function deckShape() {
  const pane = (id: string, slot: number, cardId: string) => ({
    id,
    position: { x: 40, y: 40 },
    size: { width: PANE_WIDTH, height: 400 },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["maker"],
    slot,
  });
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Card A", closable: true },
      { id: "B", componentId: "gallery-accordion", title: "Card B", closable: true },
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      pane("p1", 0, "A"),
      pane("p2", 1, "B"),
      {
        id: "pLens",
        position: { x: 0, y: 0 },
        size: { width: LENS_WIDTH, height: 900 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
    ],
    activePaneId: "p1",
    imposition: { kind: "two-up", lens: "right" },
    hasFocus: true,
  };
}

/** How far the pane in slot 1 stands from the one in slot 0. */
const SLOT_SPREAD_JS = `(function () {
  var a = document.querySelector('.tug-pane[data-pane-id="p1"]').getBoundingClientRect();
  var b = document.querySelector('.tug-pane[data-pane-id="p2"]').getBoundingClientRect();
  return b.left - a.left;
})()`;

async function slotSpread(app: App): Promise<number> {
  return app.evalJS<number>(SLOT_SPREAD_JS);
}

describe.skipIf(!SHOULD_RUN)(
  "at0300 — the picker offers every arrangement, and six-up places six",
  () => {
    test(
      "one-up through six-up, and choosing six-up moves slot 1 to a fifth of the travel",
      async () => {
        const app = await launchTugApp({
          testName: "at0300-layouts-five-six-up",
        });
        try {
          // The seed carries the Lens pane, so the Lens is already open —
          // toggling here would close it.
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(KIND_TILES)}).length > 0`,
            { timeoutMs: 8_000 },
          );

          // The Cards axis is the kind list, in the kind list's order.
          expect(
            await app.evalJS<string[]>(
              `Array.from(document.querySelectorAll(${JSON.stringify(
                KIND_TILES,
              )})).map(function (el) { return el.getAttribute("data-radio-value"); })`,
            ),
          ).toEqual(EXPECTED_KINDS);

          // Each tile is a picture of its own arrangement: as many blocks as
          // the kind has slots. This is the whole of what the miniature had to
          // learn about the two new kinds — which is nothing.
          expect(
            await app.evalJS<number[]>(
              `Array.from(document.querySelectorAll(${JSON.stringify(
                KIND_TILES,
              )})).map(function (el) {
                return el.querySelectorAll(".layout-mini-block").length;
              })`,
            ),
          ).toEqual([1, 2, 3, 4, 5, 6]);

          // Slot 1 of two-up has travelled all of the pane's travel.
          const fullTravel = await slotSpread(app);
          expect(fullTravel).toBeGreaterThan(100);

          await app.nativeClickAtElement(SIX_UP_TILE);

          // Slot 1 of six-up has travelled a fifth of the same travel. The
          // wait is the settle tween landing, read off the geometry itself
          // rather than off a clock.
          await app.waitForCondition<boolean>(
            `Math.abs((${SLOT_SPREAD_JS}) - ${fullTravel / 5}) < 2`,
            { timeoutMs: 8_000 },
          );
          expect(
            Math.abs((await slotSpread(app)) - fullTravel / 5),
          ).toBeLessThanOrEqual(2);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
