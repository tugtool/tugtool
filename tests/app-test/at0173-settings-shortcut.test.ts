/**
 * at0173-settings-shortcut.test.ts — ⌘, opens the Settings card.
 *
 * The Tug ▸ Settings… item carries the ⌘, key equivalent. at0154
 * covers the web-dispatch path (`show-card settings`); this pins the
 * NATIVE menu key-equivalent path — a real CGEvent ⌘, offered to
 * `NSApp.mainMenu.performKeyEquivalent:`, exactly as a user keystroke
 * is — through to the Settings card appearing.
 *
 * Repro for: "⌘, blinks the menu but no Settings card; mouse works."
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;

function countSettings(): string {
  return `window.tugdeck.diag.getDeckState().cards.filter((c) => c.componentId === "settings").length`;
}

function sessionDeckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0173: ⌘, opens Settings", () => {
  test(
    "native ⌘, creates the Settings card (empty deck)",
    async () => {
      const app = await launchTugApp({ testName: "at0173-settings-shortcut" });
      try {
        await app.waitForCondition<boolean>(
          `typeof window.__tug !== "undefined" && typeof window.tugdeck !== "undefined"`,
        );
        expect(await app.evalJS<number>(countSettings())).toBe(0);

        await app.nativeKey(",", ["cmd"]);

        await app.waitForCondition<boolean>(`${countSettings()} === 1`, {
          timeoutMs: 8000,
        });
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-testid="settings-card"]') !== null`,
          { timeoutMs: 6000 },
        );
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0173-empty] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "native ⌘, creates the Settings card with a focused session-card editor",
    async () => {
      const app = await launchTugApp({ testName: "at0173-settings-shortcut-focused" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: sessionDeckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindSession("A", { tugSessionId: "at0173-session" });
        await app.awaitEngineReady("A");

        // Put the caret inside the CodeMirror prompt editor — the
        // real-usage state where ⌘, was reported dead.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.waitForCondition<boolean>(
          `(function(){ var c = document.querySelector(${JSON.stringify(PROMPT_INPUT)}); return c !== null && c.contains(document.activeElement); })()`,
          { timeoutMs: 6000 },
        );

        expect(await app.evalJS<number>(countSettings())).toBe(0);

        await app.nativeKey(",", ["cmd"]);

        await app.waitForCondition<boolean>(`${countSettings()} === 1`, {
          timeoutMs: 8000,
        });
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0173-focused] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
