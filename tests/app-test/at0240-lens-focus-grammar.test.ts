/**
 * at0240-lens-focus-grammar.test.ts — the Lens focus grammar round-trip after
 * the three-list rework: Cmd-L seeds a key view onto the first section's list,
 * Tab moves the key view between section lists, a Cmd-L toggle-out-and-back
 * restores it (the `adoptKeyCard` re-entry, watch-item #3), and Escape leaves
 * the Lens.
 *
 * These assertions ride the engine's projected `data-key-view-kbd` on each
 * section's `TugListView` scroll container — which lands even for an empty
 * list, so the round-trip is verifiable without seeding session/snippet
 * content. The finer within-list behaviors (cursor on a row, Enter opening a
 * snippet editor, Escape/⌘Return closing it) are covered at the store /
 * data-source layer (snippets-store `editingId` lifecycle; the section data
 * sources) and by `TugListView`'s own descend suites — a headless sweep can't
 * make an in-row editor the chain leaf, so those stay out of this app-test.
 *
 * Scenario:
 *   1. Seed a prior card + open/focus the Lens. The first section (Sessions)
 *      list holds the keyboard key view.
 *   2. Tab → the key view moves to the next section (Snippets); Sessions no
 *      longer holds it.
 *   3. Cmd-L (focus-lens) out → the prior card is active again; Cmd-L back in →
 *      the Snippets list (the last key view) re-lights (watch-item #3).
 *   4. Escape → the prior card is restored (the CANCEL_DIALOG focus-out).
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

const SESSIONS_KBD = `.lens-content .lens-sessions-list[data-key-view-kbd]`;
const SNIPPETS_KBD = `.lens-content .lens-snippets-list[data-key-view-kbd]`;

async function dispatch(app: App, action: string): Promise<void> {
  await app.evalJS<void>(
    `window.__tug.dispatchControlAction(${JSON.stringify(action)})`,
  );
}

async function exists(app: App, selector: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.querySelector(${JSON.stringify(selector)}) !== null`,
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

describe.skipIf(!SHOULD_RUN)("at0240 — Lens focus grammar round-trip", () => {
  test(
    "Cmd-L seeds a section list; Tab moves it; re-entry restores it; Escape exits",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0240-lens-focus-grammar",
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
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          // 1. Open + focus the Lens; the first section's list takes the key view.
          await dispatch(app, "focus-lens");
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() !== "A"`,
            { timeoutMs: 3_000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SESSIONS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // 2. Tab → the key view moves to the next section (Snippets).
          await app.nativeKey("Tab");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          expect(await exists(app, SESSIONS_KBD)).toBe(false);

          // 3. Cmd-L out → prior card active; Cmd-L back in → the last key view
          //    (Snippets) re-lights via adoptKeyCard (watch-item #3).
          await dispatch(app, "focus-lens");
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() === "A"`,
            { timeoutMs: 3_000 },
          );
          await dispatch(app, "focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // 4. Escape leaves the Lens → the prior card is restored.
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `window.__tug.getActiveCardId() === "A"`,
            { timeoutMs: 3_000 },
          );
          expect(await app.getActiveCardId()).toBe("A");
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
