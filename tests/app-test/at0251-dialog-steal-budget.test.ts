/**
 * at0251-dialog-steal-budget.test.ts — trapped-surface steal budget and the
 * Radix containment audit checkpoint ([P13]/[Q01] of the
 * keyboard-as-engine-state plan).
 *
 * Opens a real TugAlert (Radix AlertDialog — the one shipped surface with a
 * Radix trapped FocusScope), tours it by keyboard, dismisses it, and asserts
 * the watchdog never entered a reassertion fight: `violations === 0`, the
 * steal ledger stays flat, and `reasserted` does not climb unboundedly while
 * the surface is open (a Radix-vs-watchdog ping-pong would rack up
 * corrections at event cadence).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const DECK = {
  cards: [
    { id: "A", componentId: "gallery-alert", title: "Alert", closable: true },
  ],
  panes: [
    {
      id: "p1",
      position: { x: 40, y: 40 },
      size: { width: 720, height: 540 },
      cardIds: ["A"],
      activeCardId: "A",
      title: "",
      acceptsFamilies: ["maker"],
    },
  ],
  activePaneId: "p1",
  hasFocus: true,
};

describe.skipIf(!SHOULD_RUN)("at0251 — trapped-surface steal budget", () => {
  test(
    "TugAlert open/tour/close: no reassertion fight, ledger flat, zero violations",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0251-dialog-steal-budget",
          env: { TUGBANK_PATH: tugbankPath },
        });
        try {
          await app.seedDeckState({ state: DECK, focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          // Boot budget: a card activation performs no raw focus write —
          // the default-focus claim routes through the engine.
          const s0 = await app.evalJS<{
            reasserted: number;
            steals: Record<string, number>;
          }>(`window.__tug.getFocusInvariantReport()`);
          console.log("[at0251] boot baseline:", JSON.stringify(s0));
          expect(Object.keys(s0.steals)).toEqual([]);

          // Open the danger-confirmation alert via its gallery button. A
          // synthetic click is fine here — the opening gesture is not what
          // is under test; the trapped surface's settled behavior is.
          await app.evalJS<void>(
            `(function(){
              var buttons = document.querySelectorAll('[data-card-id="A"] button');
              for (var i = 0; i < buttons.length; i++) {
                if ((buttons[i].textContent || "").indexOf("Delete Card") !== -1) {
                  buttons[i].click();
                  return;
                }
              }
              throw new Error("Delete Card trigger not found");
            })()`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('[role="alertdialog"]') !== null`,
            { timeoutMs: 4_000 },
          );

          // Let any reassertion fight play out, then sample the counter
          // twice one second apart — a ping-pong climbs continuously.
          await new Promise<void>((r) => setTimeout(r, 800));
          const s1 = await app.evalJS<{ reasserted: number }>(
            `window.__tug.getFocusInvariantReport()`,
          );
          // Keyboard tour inside the trap: Tab between the buttons.
          await app.nativeKey("Tab");
          await app.nativeKey("Tab");
          await new Promise<void>((r) => setTimeout(r, 1_000));
          const s2 = await app.evalJS<{
            reasserted: number;
            violations: number;
            steals: Record<string, number>;
          }>(`window.__tug.getFocusInvariantReport()`);
          console.log(
            "[at0251] samples:",
            JSON.stringify({ s1: s1.reasserted, s2 }),
          );
          // Budget: the counter may tick a few times as the surface opens,
          // but a fight climbs by tens per second. Allow a small settle
          // delta between the two samples.
          expect(s2.reasserted - s1.reasserted).toBeLessThanOrEqual(3);
          expect(s2.violations).toBe(0);
          expect(Object.keys(s2.steals)).toEqual([]);

          // Escape dismisses; the surface closes and the world stays calm.
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector('[role="alertdialog"]') === null`,
            { timeoutMs: 4_000 },
          );
          await new Promise<void>((r) => setTimeout(r, 500));
          const s3 = await app.evalJS<{
            violations: number;
            steals: Record<string, number>;
          }>(`window.__tug.getFocusInvariantReport()`);
          expect(s3.violations).toBe(0);
          expect(Object.keys(s3.steals)).toEqual([]);
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
