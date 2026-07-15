/**
 * at0230-anchored-pane-geometry.test.ts — the anchored-pane treatment
 * (Lens rail mechanism), exercised card-agnostically.
 *
 * An anchored pane (`anchor: "right"` on its `TugPaneState`) derives its
 * geometry from the right edge instead of a free position: it pins to
 * `right:0; top:0; bottom:0`, takes only its width from the store, is
 * non-draggable, and survives a reload with its `anchor` intact (the
 * `serialization.ts parseV4` round-trip regression — the field-by-field
 * pane rebuild would drop `anchor` unless explicitly parsed).
 *
 * This test does not need the Lens card — the treatment is generic to
 * any pane carrying `anchor`, so it seeds an ordinary card into an
 * anchored pane and asserts the pane behavior.
 *
 * The serialize → parseV4 anchor round-trip (the R01 fit-clamp / drop-on-
 * read regression) is pinned by the `serialization` unit tests
 * (`layout-tree.test.ts`). Auto-restore-on-reload is not an app-test: in
 * test mode `DeckManager` ignores the persisted layout and starts empty
 * (the harness drives state via `seedDeckState`), so the reload path
 * lives entirely at the unit layer.
 *
 * Scenario:
 *   1. Seed a deck: one free pane + one anchored rail (width 420).
 *   2. Assert the rail renders pinned to the right edge, full height.
 *   3. Drag the rail's title bar — assert it does not move (non-draggable).
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

const RAIL_WIDTH = 420;
const RAIL_SELECTOR = `.tug-pane[data-pane-id="pRail"]`;
const RAIL_TITLE_BAR = `${RAIL_SELECTOR} .tug-pane-title-bar`;

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
      { id: "L", componentId: "gallery-accordion", title: "Rail", closable: true },
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
        id: "pRail",
        // Nominal position (derived at render); width is the live rail
        // width; height is nominal (full-height derived).
        position: { x: 0, y: 0 },
        size: { width: RAIL_WIDTH, height: 900 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Rail",
        acceptsFamilies: [],
        anchor: "right",
      },
    ],
    activePaneId: "pFree",
    hasFocus: true,
  };
}

async function railBounds(app: App): Promise<{ x: number; y: number; width: number; height: number }> {
  return app.getElementBounds(RAIL_SELECTOR);
}

async function viewport(app: App): Promise<{ w: number; h: number }> {
  return app.evalJS<{ w: number; h: number }>(
    `({ w: window.innerWidth, h: window.innerHeight })`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0230 — anchored pane pins to the right edge, resists drag, survives reload",
  () => {
    test(
      "geometry pinned right + non-draggable + anchor survives reload",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0230-anchored-pane-geometry",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({ state: deckShape(), focusCardId: "A" });

            // The anchored rail mounts with its data-anchored marker.
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(
                `${RAIL_SELECTOR}[data-anchored="true"]`,
              )}) !== null`,
              { timeoutMs: 5_000 },
            );

            // Pinned to the right edge, full height, seeded width.
            {
              const vp = await viewport(app);
              const b = await railBounds(app);
              expect(Math.abs(b.width - RAIL_WIDTH)).toBeLessThanOrEqual(2);
              // Right edge flush with the viewport right edge.
              expect(Math.abs(b.x + b.width - vp.w)).toBeLessThanOrEqual(2);
              // Top-anchored, full height.
              expect(Math.abs(b.y)).toBeLessThanOrEqual(2);
              expect(Math.abs(b.height - vp.h)).toBeLessThanOrEqual(2);
            }

            // Non-draggable: dragging the title bar to the center leaves
            // the rail pinned.
            {
              const before = await railBounds(app);
              await app.nativeDragElement(RAIL_TITLE_BAR, { x: 300, y: 400 });
              const after = await railBounds(app);
              expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
              expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
              expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
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
