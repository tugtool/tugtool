/**
 * at0230-pinned-lens-geometry.test.ts — the pinned-pane treatment the Lens
 * gets from the imposer.
 *
 * The Lens is imposed, but as the strip's fixed end rather than a link in
 * its chain: it holds the side `imposition.lens` names, one imposition gap
 * in on three edges and the deeper gap at the bottom, takes only its width
 * from the store, and is non-draggable. The pane carries no marker of its
 * own — it is pinned because it hosts the Lens card, which is what
 * `findLensPane` derives and `DeckCanvas` turns into the `lensSide` prop.
 *
 * The serialize → parseV4 round-trip for the side (the R01 fit-clamp /
 * drop-on-read regression) is pinned by the `serialization` unit tests
 * (`layout-tree.test.ts`). Auto-restore-on-reload is not an app-test: in
 * test mode `DeckManager` ignores the persisted layout and starts empty
 * (the harness drives state via `seedDeckState`), so the reload path
 * lives entirely at the unit layer.
 *
 * Scenario:
 *   1. Seed a deck: one free pane + the Lens pane (width 420).
 *   2. Assert the Lens renders pinned to its side with the imposition gaps
 *      and rounded chrome.
 *   3. Drag the Lens's title bar — assert it does not move (non-draggable).
 *   4. Window ▸ Tile — assert the Lens keeps its geometry while the free
 *      pane is retiled around it.
 *
 * @covers tugdeck/src/layout-tree.ts
 * @covers tugdeck/src/lib/layout-imposer.ts
 * @covers tugdeck/src/deck-store-selectors.ts
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/components/chrome/deck-canvas.tsx
 * @covers tugdeck/src/deck-manager.ts
 * @covers tugdeck/src/snap.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const LENS_WIDTH = 420;
/** The imposition gaps (`lib/layout-imposer.ts`). */
const GAP = 5;
const GAP_BOTTOM = 32;
const FREE_SELECTOR = `.tug-pane[data-pane-id="pFree"]`;
const LENS_SELECTOR = `.tug-pane[data-pane-id="pLens"]`;
const LENS_TITLE_BAR = `${LENS_SELECTOR} .tug-pane-title-bar`;

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      {
        id: "pFree",
        position: { x: 40, y: 40 },
        size: { width: 500, height: 400 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
      {
        id: "pLens",
        // Nominal position and height — the imposer pins the Lens at
        // render. Width is the live Lens width.
        position: { x: 0, y: 0 },
        size: { width: LENS_WIDTH, height: 900 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
    ],
    activePaneId: "pFree",
    imposition: { lens: "right" },
    hasFocus: true,
  };
}

async function lensBounds(app: App): Promise<{ x: number; y: number; width: number; height: number }> {
  return app.getElementBounds(LENS_SELECTOR);
}

async function viewport(app: App): Promise<{ w: number; h: number }> {
  return app.evalJS<{ w: number; h: number }>(
    `({ w: window.innerWidth, h: window.innerHeight })`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0230 — the Lens pins to its side with the imposition gaps and resists drag",
  () => {
    test(
      "pinned right with gaps on all four sides, rounded chrome, non-draggable",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0230-pinned-lens-geometry",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({ state: deckShape(), focusCardId: "A" });

            // The Lens pane mounts carrying the side it holds.
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(
                `${LENS_SELECTOR}[data-lens="right"]`,
              )}) !== null`,
              { timeoutMs: 5_000 },
            );

            // One gap off the right edge and the top, the deeper gap off
            // the bottom, at the seeded width.
            {
              const vp = await viewport(app);
              const b = await lensBounds(app);
              expect(Math.abs(b.width - LENS_WIDTH)).toBeLessThanOrEqual(2);
              expect(Math.abs(b.x + b.width - (vp.w - GAP))).toBeLessThanOrEqual(2);
              expect(Math.abs(b.y - GAP)).toBeLessThanOrEqual(2);
              expect(
                Math.abs(b.height - (vp.h - GAP - GAP_BOTTOM)),
              ).toBeLessThanOrEqual(2);
            }

            // Standing off the edges, it wears the ordinary rounded chrome
            // rather than the flush-edge treatment it used to get.
            {
              const radius = await app.evalJS<number>(
                `parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(
                  `${LENS_SELECTOR} .tug-pane-chrome`,
                )})).borderTopLeftRadius) || 0`,
              );
              expect(radius).toBeGreaterThan(0);
            }

            // Non-draggable: dragging the title bar to the center leaves
            // the Lens pinned.
            {
              const before = await lensBounds(app);
              await app.nativeDragElement(LENS_TITLE_BAR, { x: 300, y: 400 });
              const after = await lensBounds(app);
              expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
              expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
              expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
            }

            // Window ▸ Tile arranges the deck around the Lens rather than
            // over it. Tiling writes `size`, and the Lens paints at its
            // stored width, so a Lens caught up in the arrangement would be
            // visibly resized and would drag the whole band with it.
            {
              const before = await lensBounds(app);
              const freeBefore = await app.getElementBounds(FREE_SELECTOR);
              await app.evalJS<null>(
                `(window.__tug.dispatchControlAction("arrange-cards", { mode: "tile" }), null)`,
              );
              await app.waitForCondition<boolean>(
                `Math.abs(document.querySelector(${JSON.stringify(
                  FREE_SELECTOR,
                )}).getBoundingClientRect().width - ${freeBefore.width}) > 2`,
                { timeoutMs: 5_000 },
              );
              const after = await lensBounds(app);
              expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
              expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
              expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
              expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2);
            }

          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
