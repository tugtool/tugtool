/**
 * at0230-pinned-lens-geometry.test.ts — the pinned-pane treatment the Lens
 * gets from the imposer.
 *
 * The Lens is imposed, but as the arrangement's fixed end rather than one of
 * its slots: it holds the side `imposition.lens` names, one imposition gap in
 * on three edges and the deeper gap at the bottom, and takes only its width
 * from the store. The pane carries no marker of its own — it is pinned because
 * it hosts the Lens card, which is what `findLensPane` derives and
 * `DeckCanvas` turns into the `lensSide` prop.
 *
 * It is also DRAGGABLE, and the drag is the one gesture that ends the pin: the
 * Lens becomes an ordinary free pane standing where it was dropped, and any
 * choice in its own Layouts section puts it back.
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
 *   3. Window ▸ Tile — assert the pinned Lens keeps its geometry while the
 *      free pane is retiled around it.
 *   4. Drag the Lens's title bar — assert it moves, loses `data-lens`, and
 *      keeps `data-lens-pane`.
 *   5. Choose the Lens side in the Layouts section — assert it snaps back to
 *      the pin, gaps and all.
 *
 * @covers tugdeck/src/layout-tree.ts
 * @covers tugdeck/src/lib/layout-imposer.ts
 * @covers tugdeck/src/deck-store-selectors.ts
 * @covers tugdeck/src/components/lens/sections/layouts-section.tsx
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
/** The Lens's own Layouts section — the only way back onto the pin. */
const SIDE_RIGHT =
  '[data-testid="lens-layouts-side"] [data-radio-value="right"]';

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
  "at0230 — the Lens pins to its side, and a drag is what takes it off the pin",
  () => {
    test(
      "pinned right with gaps on all four sides and rounded chrome; drag unpins, the picker re-pins",
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

            // Window ▸ Tile arranges the deck around a pinned Lens rather
            // than over it. Tiling writes a stored rect, and a pinned Lens
            // paints from its pin, so a Lens caught up in the arrangement
            // would be visibly resized and would drag the whole band with it.
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

            // Dragging the title bar takes the Lens OFF the pin: it lands
            // where it was dropped, stops carrying a side, and is a free pane
            // in the deck from then on. `data-lens-pane` survives — it is
            // still the Lens, and still refuses a merge.
            {
              const before = await lensBounds(app);
              await app.nativeDragElement(LENS_TITLE_BAR, { x: 320, y: 420 });
              await app.waitForCondition<boolean>(
                `document.querySelector(${JSON.stringify(
                  `${LENS_SELECTOR}[data-lens]`,
                )}) === null`,
                { timeoutMs: 5_000 },
              );
              const after = await lensBounds(app);
              expect(Math.abs(after.x - before.x)).toBeGreaterThan(2);
              expect(
                await app.evalJS<boolean>(
                  `document.querySelector(${JSON.stringify(
                    `${LENS_SELECTOR}[data-lens-pane]`,
                  )}) !== null`,
                ),
              ).toBe(true);
              // Width is the user's either way — the release never touches it.
              expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
            }

            // Choosing the Lens's side puts it back. The side has not changed,
            // which is the point: naming the side the Lens holds is the gesture
            // that says it holds one, so the choice is never a no-op.
            {
              await app.nativeClickAtElement(SIDE_RIGHT);
              await app.waitForCondition<boolean>(
                `document.querySelector(${JSON.stringify(
                  `${LENS_SELECTOR}[data-lens="right"]`,
                )}) !== null`,
                { timeoutMs: 5_000 },
              );
              // Let the settle transition land before measuring.
              await new Promise<void>((r) => setTimeout(r, 900));
              const vp = await viewport(app);
              const b = await lensBounds(app);
              expect(Math.abs(b.x + b.width - (vp.w - GAP))).toBeLessThanOrEqual(2);
              expect(Math.abs(b.y - GAP)).toBeLessThanOrEqual(2);
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
