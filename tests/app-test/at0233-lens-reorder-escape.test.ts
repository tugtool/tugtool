/**
 * at0233-lens-reorder-escape.test.ts — Lens section drag-reorder + Escape
 * focus-out, exercised with the two real registered sections (Log +
 * Telemetry).
 *
 * Scenarios:
 *   1. Drag the Telemetry section's grip above Log; assert the DOM order
 *      flips and `dev.tugtool.lens/sectionOrder` persists the new order.
 *   2. Focus the Lens (its Log section gives it real focusable content),
 *      then Escape; assert the previously-focused card is restored (the
 *      deck-canvas CANCEL_DIALOG focus-out, [P05]).
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const SECTIONS = ".lens-sections .lens-section[data-lens-section]";
const LOG = `.lens-section[data-lens-section="log"]`;
const TELEMETRY_GRIP = `.lens-section[data-lens-section="telemetry"] .lens-section-grip`;

async function dispatch(app: App, action: string): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction(${JSON.stringify(action)})`,
  );
}

async function domOrder(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `Array.from(document.querySelectorAll(${JSON.stringify(SECTIONS)}))
      .map(function(el){ return el.getAttribute("data-lens-section"); })`,
  );
}

function priorCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 520, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pA",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)(
  "at0233 — Lens section reorder + Escape focus-out",
  () => {
    test(
      "dragging Telemetry above Log persists the new order",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0233-lens-reorder",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(SECTIONS)}).length >= 2`,
              { timeoutMs: 3_000 },
            );
            // Default (registration) order: log, telemetry.
            expect(await domOrder(app)).toEqual(["log", "telemetry"]);

            // Drag Telemetry's grip to just below the top of the Log
            // section so it lands at index 0.
            const logBounds = await app.getElementBounds(LOG);
            await app.nativeDragElement(TELEMETRY_GRIP, {
              x: Math.round(logBounds.x + logBounds.width / 2),
              y: Math.round(logBounds.y + 4),
            });

            await app.waitForCondition<boolean>(
              `(function(){
                var els = Array.from(document.querySelectorAll(${JSON.stringify(SECTIONS)}));
                return els.length >= 2 && els[0].getAttribute("data-lens-section") === "telemetry";
              })()`,
              { timeoutMs: 3_000 },
            );
            expect(await domOrder(app)).toEqual(["telemetry", "log"]);

            const persisted = tugbankRead<string[]>(
              tugbankPath,
              "dev.tugtool.lens",
              "sectionOrder",
            );
            const order = persisted?.value ?? [];
            expect(order.indexOf("telemetry")).toBeLessThan(order.indexOf("log"));
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "Escape inside the Lens restores the prior card",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0233-lens-escape",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
            await app.waitForCondition<boolean>(
              `window.__tug.assertHostRootRegistered("A")`,
              { timeoutMs: 5_000 },
            );

            await dispatch(app, "focus-lens");
            await app.waitForCondition<boolean>(
              `window.__tug.getActiveCardId() !== "A"`,
              { timeoutMs: 3_000 },
            );

            await app.nativeKey("Escape");
            await app.waitForCondition<boolean>(
              `window.__tug.getActiveCardId() === "A"`,
              { timeoutMs: 3_000 },
            );
            expect(await app.evalJS<string | null>(`window.__tug.getActiveCardId()`)).toBe("A");
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
