/**
 * at0162-button-ctrl-click-no-activate.test.ts — a Control-click must not fire a
 * TugButton's action.
 *
 * On macOS, Control-click is the secondary (context-menu) gesture. WebKit still
 * dispatches a `click` for it — with `button === 0` and `ctrlKey === true` —
 * alongside the `contextmenu` event, so without a guard a Ctrl-click on a Z4B
 * chip both raised the context menu AND opened the chip's sheet. (A true
 * right-click, `button === 2`, fires no `click` at all, so it was never
 * affected.) `TugButton.handleClick` now ignores any click carrying `ctrlKey`
 * or a non-primary `button`.
 *
 * Pins, on the real permission-mode chip:
 *   - a Control-click leaves the sheet closed;
 *   - a plain left-click still opens it (the guard didn't break activation).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const CHIP = `${CARD} [data-slot="permission-mode-chip"]`;
const CHIP_CONTENT = `${CHIP} [data-slot="permission-mode-value"] [data-tug-stable="active"]`;
const SHEET = '[data-slot="tug-sheet"]';
const SHEET_PRESENT = `document.querySelector(${JSON.stringify(SHEET)}) !== null`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0162: Ctrl-click must not open the chip sheet", () => {
  test(
    "Control-click raises no sheet; left-click still opens it",
    async () => {
      const app = await launchTugApp({ testName: "at0162-button-ctrl-click-no-activate" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A");
        await app.awaitEngineReady("A");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CHIP_CONTENT)}) !== null`,
          { timeoutMs: 8000 },
        );

        expect(await app.evalJS<boolean>(SHEET_PRESENT), "sheet starts closed").toBe(false);

        // Control+left-click: WebKit fires a `click` (button 0, ctrlKey true).
        // The fix must swallow it — no sheet.
        const b = await app.getElementBounds(CHIP);
        const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        await app.holdModifier(["ctrl"], async (inner) => {
          await inner.rpcCall<void>("nativeClick", { viewportPoint: point });
        });
        await new Promise((r) => setTimeout(r, 500));
        expect(
          await app.evalJS<boolean>(SHEET_PRESENT),
          "Ctrl-click must NOT open the sheet",
        ).toBe(false);

        // Dismiss any context menu the Ctrl-click raised, then confirm a normal
        // left-click DOES open the sheet (the fix didn't break activation).
        await app.nativeKey("Escape");
        await new Promise((r) => setTimeout(r, 150));
        await app.nativeClickAtElement(CHIP);
        await app.waitForCondition<boolean>(SHEET_PRESENT, { timeoutMs: 4000 });
        expect(
          await app.evalJS<boolean>(SHEET_PRESENT),
          "left-click must open the sheet",
        ).toBe(true);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[atDIAG] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
