/**
 * at0160-context-menu-escape.test.ts — `tug-context-menu` Escape is engine-owned
 * via the marked-synthetic-Escape mechanism ([P03]/[P04]/[R02]).
 *
 * The Radix ContextMenu is uncontrolled, so its only programmatic close lever is
 * a synthesized Escape keydown. After it joins the engine trap, a user Escape is
 * arbitrated by the engine's ladder (which calls the menu's `onEscapeDismiss` =
 * `synthesizeEscapeDismiss`); that synthetic Escape carries a marker so the
 * engine's own listeners skip it (no loop, [R02]) and the menu's `onEscapeKeyDown`
 * suppressor lets it through to Radix, which closes the menu. This pins:
 *   - right-click opens the context menu (`data-slot="tug-context-menu"`);
 *   - one Escape closes it (exactly once — no loop, no double-close [R02]).
 *
 * Close-focus restore is NOT asserted here: the gallery trigger is a bare,
 * non-focusable region with no prior first responder / key view to restore (so
 * the trap correctly falls through to Radix's default). Context-menu close-focus
 * restoration to a real editor is covered by at0020 (the editor context menu).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const REGION = `${CARD} [data-testid="ctx-region"]`;
const MENU = '[data-slot="tug-context-menu"]';

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-context-menu", title: "Context Menu Gallery", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 640, height: 520 },
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

const MENU_OPEN = `document.querySelector(${JSON.stringify(MENU)}) !== null`;

describe.skipIf(!SHOULD_RUN)("AT0160: tug-context-menu Escape is engine-owned", () => {
  test(
    "right-click opens the context menu, one Escape closes it (and it stays closed)",
    async () => {
      const app = await launchTugApp({ testName: "at0160-context-menu-escape" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(REGION)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Right-click the region to open the context menu.
        await app.nativeRightClickAtElement(REGION);
        await app.waitForCondition<boolean>(MENU_OPEN, { timeoutMs: 6000 });

        // One Escape: the engine ladder calls onEscapeDismiss → a MARKED synthetic
        // Escape → Radix closes the menu. The engine skips its own synthetic event
        // (no loop), so the menu closes exactly once.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(`${MENU_OPEN} === false`, { timeoutMs: 6000 });

        // Settle, then confirm it stayed closed (a re-entrant synthetic Escape —
        // the [R02] loop — would have reopened/thrashed it).
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(await app.evalJS<boolean>(MENU_OPEN)).toBe(false);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0160-context-menu-escape] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
