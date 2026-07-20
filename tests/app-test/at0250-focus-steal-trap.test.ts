/**
 * at0250-focus-steal-trap.test.ts — the watchdog's steal trap ([P04] /
 * Spec S03 of the keyboard-as-engine-state plan).
 *
 * The at0247 Phase-B shape, reachable via the activation channel: the Lens
 * holds the keyboard target (ring on the snippets list, engine-routed) while
 * a session editor card is present. A RAW `.focus()` on the editor's
 * contenteditable — the exact write class behind the historical
 * relaunch-with-Lens-focus failure — must:
 *
 *   1. steal nothing: the ring stays on the snippets list, `violations`
 *      stays 0 (keys never routed through the stolen register);
 *   2. be corrected: the watchdog re-parks `document.activeElement`;
 *   3. be ATTRIBUTED: the `steals` ledger names the offender — a raw write
 *      introduced next month announces itself instead of being silently
 *      absorbed;
 *   4. leave the keyboard alive: a native ArrowDown still moves the Lens
 *      cursor.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const LENS_CARD_ID = "lens-card";
const SNIPPETS_KBD = ".lens-content .lens-snippets-list[data-key-view-kbd]";
const CURSOR = ".lens-content .lens-snippets-list [data-key-cursor]";

function deckWithLensAndEditor() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-prompt-entry",
        title: "TugPromptEntry",
        closable: true,
      },
      { id: LENS_CARD_ID, componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 560, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
      {
        id: "lens-pane",
        position: { x: 0, y: 0 },
        size: { width: 320, height: 600 },
        cardIds: [LENS_CARD_ID],
        activeCardId: LENS_CARD_ID,
        title: "Lens",
        acceptsFamilies: [],
        anchor: "right",
      },
    ],
    activePaneId: "lens-pane",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0250 — the watchdog's steal trap", () => {
  test(
    "a raw editor focus write is corrected, attributed, and steals nothing",
    async () => {
      const tugbankPath = mkTempTugbank();
      const snippetsDir = mkdtempSync(join(tmpdir(), "tug-at0250-"));
      const snippetsPath = join(snippetsDir, "snippets.json");
      const snippets = Array.from({ length: 6 }, (_, i) => ({
        id: `s${i}`,
        text: `steal-trap row ${i}`,
      }));
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0250-focus-steal-trap",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({
            state: deckWithLensAndEditor(),
            cardStates: {
              [LENS_CARD_ID]: {
                focus: {
                  kind: "dom",
                  focusKey: "lens-section-snippets:0",
                  keyboard: true,
                },
              },
            },
            focusCardId: LENS_CARD_ID,
          });
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-snippets-list') !== null`,
            { timeoutMs: 6_000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-card-id="A"] .cm-content') !== null`,
            { timeoutMs: 6_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 6_000 },
          );

          // THE STEAL: a raw focus write on the editor's contenteditable
          // while the Lens holds the target — outside any granted window.
          await app.evalJS<void>(
            `document.querySelector('[data-card-id="A"] .cm-content').focus()`,
          );
          await new Promise<void>((r) => setTimeout(r, 500));

          const verdict = await app.evalJS<{
            ringOnList: boolean;
            activeIsEditor: boolean;
            violations: number;
            reasserted: number;
            stealOffenders: string[];
          }>(`(() => {
            const report = window.__tug.getFocusInvariantReport();
            const active = document.activeElement;
            return {
              ringOnList: document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null,
              activeIsEditor: active !== null && active.closest('[data-card-id="A"]') !== null,
              violations: report === null ? -1 : report.violations,
              reasserted: report === null ? -1 : report.reasserted,
              stealOffenders: report === null ? [] : Object.keys(report.steals),
            };
          })()`);
          console.log("[at0250] post-steal:", JSON.stringify(verdict));

          // Nothing stolen, correction attributed.
          expect(verdict.ringOnList).toBe(true);
          expect(verdict.activeIsEditor).toBe(false);
          expect(verdict.violations).toBe(0);
          expect(verdict.reasserted).toBeGreaterThanOrEqual(1);
          expect(
            verdict.stealOffenders.some((s) => s.includes("cm-")),
          ).toBe(true);

          // The keyboard is alive: ArrowDown moves the Lens cursor.
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CURSOR)}) !== null`,
            { timeoutMs: 3_000 },
          );
        } finally {
          await app.close();
        }
      } finally {
        rmSync(snippetsDir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
