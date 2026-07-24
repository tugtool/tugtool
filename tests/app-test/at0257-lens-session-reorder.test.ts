/**
 * at0257-lens-session-reorder.test.ts — drag-to-reorder for the Lens Sessions
 * section, plus the new-session-lands-at-the-bottom overlay.
 *
 * The Sessions list is fed by `cardSessionBindingStore` in bind order; a
 * per-row `BlockGrip` drives the shared `useBlockReorder` FLIP, whose drop
 * commits a persisted user order (`dev.tugtool.lens/sessionOrder`) that
 * `buildSessionRows` applies. Sessions absent from that order sort to the
 * bottom, so a session bound AFTER a reorder never disturbs the arrangement.
 *
 * Scenarios:
 *   1. Bind three session cards (A, B, C); drag C's grip above A. Assert the
 *      DOM row order puts C first and `sessionOrder` persists C before A.
 *   2. Bind a fourth session (D) after the reorder; assert it lands LAST,
 *      leaving the reordered set intact.
 *   3. Drag a grip far BELOW the list; assert the dragged row stays clamped
 *      within the list container instead of following the pointer out of it.
 *
 * @covers tugdeck/src/components/lens/sections/sessions-section.tsx
 * @covers tugdeck/src/components/lens/block-reorder.ts
 * @covers tugdeck/src/lib/lens-store/
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

const WRAP = ".sessions-list-wrap";
const LIST = ".lens-sessions-list";
const ROWS = `${LIST} .session-row-content[data-session-id]`;
const DRAGGING = `${WRAP} .session-row-content[data-dragging="true"]`;
const rowSel = (sessionId: string): string =>
  `${LIST} .session-row-content[data-session-id="${sessionId}"]`;
const gripSel = (sessionId: string): string =>
  `${rowSel(sessionId)} [data-slot="block-grip"]`;

function sessionDeck() {
  const card = (id: string) => ({
    id,
    componentId: "session",
    title: `Session ${id}`,
    closable: true,
  });
  return {
    cards: [card("A"), card("B"), card("C"), card("D")],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 520 },
        cardIds: ["A", "B", "C", "D"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

async function domOrder(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}))
      .map(function(el){ return el.getAttribute("data-session-id"); })`,
  );
}

describe.skipIf(!SHOULD_RUN)("at0257 — Lens Sessions reorder + bottom-append", () => {
  test(
    "dragging a session above another persists the new order; a later session lands last",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0257-lens-session-reorder",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: sessionDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );

          // Three real bindings → three Sessions rows in bind order.
          await app.bindSession("A");
          await app.bindSession("B");
          await app.bindSession("C");

          await app.dispatchControlAction("toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROWS)}).length === 3`,
            { timeoutMs: 5_000 },
          );
          expect(await domOrder(app)).toEqual([
            "test-session-A",
            "test-session-B",
            "test-session-C",
          ]);

          // The fronted card before the drag — a grip gesture must not change
          // it (the trailing click must never activate a row).
          const activeBefore = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );

          // Drag C's grip to just below A's top edge → C lands at index 0.
          const aBounds = await app.getElementBounds(rowSel("test-session-A"));
          await app.nativeDragElement(gripSel("test-session-C"), {
            x: Math.round(aBounds.x + aBounds.width / 2),
            y: Math.round(aBounds.y + 4),
          });

          await app.waitForCondition<boolean>(
            `(function(){
              var els = Array.from(document.querySelectorAll(${JSON.stringify(ROWS)}));
              return els.length === 3 && els[0].getAttribute("data-session-id") === "test-session-C";
            })()`,
            { timeoutMs: 5_000 },
          );
          const after = await domOrder(app);
          expect(after.indexOf("test-session-C")).toBeLessThan(
            after.indexOf("test-session-A"),
          );

          // The grip drag reordered the rows but did NOT front the row under
          // the release point (the trailing click was swallowed).
          const activeAfter = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );
          expect(activeAfter).toBe(activeBefore);

          // The reorder persisted to tugbank under the Lens domain.
          const persisted = tugbankRead<string[]>(
            tugbankPath,
            "dev.tugtool.lens",
            "sessionOrder",
          );
          const order = persisted?.value ?? [];
          expect(order.indexOf("test-session-C")).toBeLessThan(
            order.indexOf("test-session-A"),
          );

          // A session bound AFTER the reorder lands at the BOTTOM, leaving the
          // arranged set intact.
          await app.bindSession("D");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROWS)}).length === 4`,
            { timeoutMs: 5_000 },
          );
          const withNew = await domOrder(app);
          expect(withNew[withNew.length - 1]).toBe("test-session-D");
          // The previously-arranged rows keep their relative order.
          expect(withNew.indexOf("test-session-C")).toBeLessThan(
            withNew.indexOf("test-session-A"),
          );
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
    "a grip dragged far below the list stays clamped within the list bounds",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0257-lens-session-clamp",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: sessionDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.bindSession("A");
          await app.bindSession("B");

          await app.dispatchControlAction("toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROWS)}).length === 2`,
            { timeoutMs: 5_000 },
          );

          // Aim FAR below the list — past the bottom of the whole rail.
          const wrap = await app.getElementBounds(WRAP);
          await app.nativeDragElementWithoutRelease(gripSel("test-session-A"), {
            x: Math.round(wrap.x + wrap.width / 2),
            y: Math.round(wrap.y + wrap.height + 400),
          });

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(DRAGGING)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // The dragged row's bottom must not escape the list container's
          // bottom (a couple px of slack for the drag's scale transform / sub-
          // pixel rounding). Before the clamp it followed the pointer 400px out.
          const escaped = await app.evalJS<number>(
            `(function(){
              var d = document.querySelector(${JSON.stringify(DRAGGING)});
              var w = document.querySelector(${JSON.stringify(WRAP)});
              if (!d || !w) return 99999;
              return d.getBoundingClientRect().bottom - w.getBoundingClientRect().bottom;
            })()`,
          );
          expect(escaped).toBeLessThanOrEqual(2);

          await app.nativeMouseUp({
            x: Math.round(wrap.x + wrap.width / 2),
            y: Math.round(wrap.y + wrap.height + 400),
          });
        } finally {
          await app.close();
        }
      } finally {
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
