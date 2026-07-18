/**
 * at0233-lens-reorder-escape.test.ts — Lens section drag-reorder + Escape
 * focus-out, exercised with the top two registered rail sections (whatever
 * they currently are — the test reads them live, nothing is hardcoded).
 *
 * Scenarios:
 *   1. Drag the second rail section's grip above the first; assert the
 *      two swap in the DOM and `dev.tugtool.lens/sectionOrder` persists
 *      the new relative order. The section kinds and their default order
 *      are read from the live rail — nothing is hardcoded, so the test
 *      survives changes to the default section order.
 *   2. Focus the Lens (its sections give it real focusable content),
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
const sectionSel = (kind: string): string =>
  `.lens-section[data-lens-section="${kind}"]`;
const gripSel = (kind: string): string =>
  `${sectionSel(kind)} [data-testid="lens-section-grip"]`;

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
      "dragging the second section above the first persists the new order",
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
            // Read the live default order — the top two sections, whatever
            // they currently are.
            const before = await domOrder(app);
            const [first, second] = before;

            // Drag the second section's grip to just below the top of the
            // first section so it lands at index 0, above `first`.
            const firstBounds = await app.getElementBounds(sectionSel(first));
            await app.nativeDragElement(gripSel(second), {
              x: Math.round(firstBounds.x + firstBounds.width / 2),
              y: Math.round(firstBounds.y + 4),
            });

            await app.waitForCondition<boolean>(
              `(function(){
                var els = Array.from(document.querySelectorAll(${JSON.stringify(SECTIONS)}));
                return els.length >= 2 && els[0].getAttribute("data-lens-section") === ${JSON.stringify(second)};
              })()`,
              { timeoutMs: 3_000 },
            );
            // Invariant: the dragged section now precedes the one it was
            // dropped above.
            const after = await domOrder(app);
            expect(after.indexOf(second)).toBeLessThan(after.indexOf(first));

            const persisted = tugbankRead<string[]>(
              tugbankPath,
              "dev.tugtool.lens",
              "sectionOrder",
            );
            const order = persisted?.value ?? [];
            expect(order.indexOf(second)).toBeLessThan(order.indexOf(first));
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
      "a held drag ghosts the band + shows the drop caret, then lands on release",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0233-lens-flip",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(SECTIONS)}).length >= 2`,
              { timeoutMs: 3_000 },
            );
            const before = await domOrder(app);
            const [first, second] = before;

            const firstBounds = await app.getElementBounds(sectionSel(first));
            const target = {
              x: Math.round(firstBounds.x + firstBounds.width / 2),
              y: Math.round(firstBounds.y + 4),
            };

            // Press + drag the second grip toward the top of the first, HOLDING
            // (no release) so the mid-drag FLIP visuals can be observed.
            await app.nativeDragElementWithoutRelease(gripSel(second), target);

            // Mid-drag: the dragged band is ghosted (`data-dragging`) and the
            // drop caret is revealed in the opened gap ([P08]).
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(
                `${sectionSel(second)}[data-dragging="true"]`,
              )}) !== null &&
               document.querySelector('.lens-sections .block-drop-caret[data-visible="true"]') !== null`,
              { timeoutMs: 3_000 },
            );

            // Release — the section lands and the reorder commits to the store.
            await app.nativeMouseUp(target);
            await app.waitForCondition<boolean>(
              `(function(){
                var els = Array.from(document.querySelectorAll(${JSON.stringify(SECTIONS)}));
                return els.length >= 2 && els[0].getAttribute("data-lens-section") === ${JSON.stringify(second)};
              })()`,
              { timeoutMs: 3_000 },
            );
            const after = await domOrder(app);
            expect(after.indexOf(second)).toBeLessThan(after.indexOf(first));

            // The caret is gone once the drag ends.
            expect(
              await app.evalJS<boolean>(
                `document.querySelector('.lens-sections .block-drop-caret[data-visible="true"]') === null`,
              ),
            ).toBe(true);

            const persisted = tugbankRead<string[]>(
              tugbankPath,
              "dev.tugtool.lens",
              "sectionOrder",
            );
            const order = persisted?.value ?? [];
            expect(order.indexOf(second)).toBeLessThan(order.indexOf(first));
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
