/**
 * at0246-focus-boot-invariant.test.ts — the focus engine's honesty contract
 * at cold-boot restore.
 *
 * Scenario: the deck restores with the Lens holding a saved *keyboard* focus
 * (`bag.focus = { kind: "dom", focusKey: "lens-section-snippets:0",
 * keyboard: true }`) while a focus-claiming editor card (the
 * `gallery-prompt-entry` session stand-in) is also present. Historically this
 * is the "ring lies" boot race: the Lens restore paints `data-key-view-kbd`
 * on the snippets list while the editor's late mount steals
 * `document.activeElement` — the ring promises keystrokes that actually go to
 * the editor, and the keyboard reads as dead.
 *
 * The HONESTY form: with placements atomic (`place()`), the projection
 * derived from settled DOM focus, and every engine claim gated on key-card
 * authority, the boot must end with the ring and the keyboard on the same
 * element — `document.activeElement` inside (or containing) the
 * `[data-key-view-kbd]` element — with ZERO tripwire violations, and
 * ArrowDown must move the Lens cursor (`data-key-cursor`), proving the
 * keydown path reaches the ringed list.
 *
 * Runs against an isolated snippets file (`TUG_SNIPPETS_PATH`) so the
 * snippets list has real rows and the `lens-section-snippets:0` focusable
 * registers.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const LENS_CARD_ID = "lens-card";
const SNIPPETS_FOCUS_KEY = "lens-section-snippets:0";

/**
 * A deck with a free pane hosting the prompt-entry editor card (the
 * focus-claiming session stand-in) and the anchored Lens rail at a FIXED
 * card id, so the seeded `bag.focus` and `focusCardId` name it.
 */
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

describe.skipIf(!SHOULD_RUN)("at0246 — focus boot invariant", () => {
  test(
    "boot restore with a saved Lens keyboard target: ring/DOM-focus drift is impossible or loudly detected",
    async () => {
      const tugbankPath = mkTempTugbank();
      const snippetsDir = mkdtempSync(join(tmpdir(), "tug-at0246-"));
      const snippetsPath = join(snippetsDir, "snippets.json");
      const snippets = Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        text: `snippet number ${i} — a one-line handle`,
      }));
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0246-focus-boot-invariant",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          persistInTestMode: true,
        });
        try {
          await app.seedDeckState({
            state: deckWithLensAndEditor(),
            cardStates: {
              [LENS_CARD_ID]: {
                focus: {
                  kind: "dom",
                  focusKey: SNIPPETS_FOCUS_KEY,
                  keyboard: true,
                },
              },
            },
            focusCardId: LENS_CARD_ID,
          });

          // Both surfaces mounted: the snippets list with rows, and the
          // editor stand-in whose CM6 mount is the historical focus thief.
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

          // The saved keyboard target must re-light the ring somewhere —
          // a boot that restores keyboard focus without any ring is its own
          // regression (the ring-resume axis).
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-key-view-kbd]') !== null`,
            { timeoutMs: 6_000 },
          );

          // Honesty: the ring and the keyboard settle on the same element.
          // Timing out here means the boot ended with a ring the keyboard
          // cannot reach — the exact bug this suite exists to forbid.
          await app.waitForCondition<boolean>(
            `(() => {
              const ringed = document.querySelector('[data-key-view-kbd]');
              if (ringed === null) return false;
              const active = document.activeElement;
              return (
                active instanceof HTMLElement &&
                active !== document.body &&
                (ringed === active || ringed.contains(active) || active.contains(ringed))
              );
            })()`,
            { timeoutMs: 8_000 },
          );

          const verdict = await app.evalJS<{
            agree: boolean;
            violations: number;
            last: unknown;
          }>(`(() => {
            const ringed = document.querySelector('[data-key-view-kbd]');
            const active = document.activeElement;
            const agree =
              ringed !== null &&
              active instanceof HTMLElement &&
              active !== document.body &&
              (ringed === active || ringed.contains(active) || active.contains(ringed));
            const report = window.__tug.getFocusInvariantReport();
            return {
              agree,
              violations: report === null ? -1 : report.violations,
              last: report?.last ?? null,
            };
          })()`);

          console.log("[at0246] settled state:", JSON.stringify(verdict));

          expect(verdict.agree).toBe(true);
          expect(verdict.violations).toBe(0);

          // The keydown path reaches the ringed list: ArrowDown moves the
          // engine cursor onto a snippets row.
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-snippets-list [data-key-cursor]') !== null`,
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
