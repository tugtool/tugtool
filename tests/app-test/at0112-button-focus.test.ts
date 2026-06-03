/**
 * at0112-button-focus.test.ts — the base button's focus is engine-driven.
 *
 * Step 9 tames `internal/tug-button`: it registers as a focusable when a
 * surface authors it into a focus group ([P02]), and its old `data-tug-focus`
 * bundle is split into two explicit axes ([P10]) — no-steal-on-click (the
 * button keeps `data-tug-focus="refuse"` by default) and walk policy
 * (`accept` / `skip`).
 *
 * The gallery `Focus Walk` panel authors three buttons into one group: Alpha
 * (order 0, accept), Beta (order 1, accept), Gamma (order 2, skip). With them
 * registered, Tab in this card is engine-driven. The test proves:
 *   - **reachable per policy:** Tab walks Alpha → Beta and wraps, never landing
 *     on the `skip` Gamma in standard mode;
 *   - **ring on keyboard focus:** the engine-focused button shows the focus
 *     ring (an outline) and carries `data-key-view`;
 *   - **click does not move the key view:** clicking a button (which refuses
 *     focus) while the key view sits on another leaves the key view put.
 *
 * `data-key-view` carries the focusable's id; the test maps it back to a button
 * via that element's `data-testid`, so it never depends on the auto-generated
 * focusable id.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const DEMO = `${CARD} [data-testid="focus-walk-demo"]`;
const ALPHA = `${CARD} [data-testid="focus-walk-alpha"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-chain-actions", title: "Chain", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 640 },
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

// The data-testid of the element currently carrying the key view, or null.
const KEY_VIEW_TESTID = `(function(){
  var el = document.querySelector("[data-key-view]");
  return el ? el.getAttribute("data-testid") : null;
})()`;

// Outline width of the key-view element (the focus ring), or null.
const KEY_VIEW_OUTLINE = `(function(){
  var el = document.querySelector("[data-key-view]");
  if (!el) return null;
  return getComputedStyle(el).outlineWidth;
})()`;

describe.skipIf(!SHOULD_RUN)("AT0112: base button focus is engine-driven", () => {
  test(
    "Tab walks accept buttons, skips the skip button, rings on keyboard focus, and click doesn't move the key view",
    async () => {
      const app = await launchTugApp({ testName: "at0112-button-focus" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DEMO)}) !== null`,
          { timeoutMs: 8000 },
        );
        // Buttons must have registered as focusables (engine walk non-empty).
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(`${CARD} [data-tug-focusable]`)}).length >= 2`,
          { timeoutMs: 6000 },
        );

        // Give the webview key focus so native Tab reaches the document
        // capture-phase walk listener. Clicking the (non-refusing) panel
        // heading activates the window without landing focus on any control.
        await app.nativeClickAtElement(DEMO);
        await new Promise((resolve) => setTimeout(resolve, 200));

        // (1) Tab → key view lands on the first accept stop, Alpha.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "focus-walk-alpha"`, {
          timeoutMs: 6000,
        });

        // Ring shows on keyboard focus: the key view paints an outline.
        const outline = await app.evalJS<string | null>(KEY_VIEW_OUTLINE);
        expect(outline).not.toBeNull();
        expect(parseFloat(outline as string)).toBeGreaterThan(0);

        // (2) Tab → Beta (the second accept stop).
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "focus-walk-beta"`, {
          timeoutMs: 6000,
        });

        // (3) Tab → wraps back to Alpha — Gamma (skip) is never visited.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "focus-walk-alpha"`, {
          timeoutMs: 6000,
        });

        // Walk the full cycle a few more times; the skip button stays out.
        for (let i = 0; i < 4; i++) {
          await app.nativeKey("Tab");
          const where = await app.evalJS<string | null>(KEY_VIEW_TESTID);
          expect(where).not.toBe("focus-walk-gamma");
        }

        // (4) Click a button while the key view sits elsewhere: a refusing
        // button does not steal the key view. Land the key view on Beta
        // (advance up to a full cycle), then click Alpha and confirm the key
        // view stays on Beta.
        for (let i = 0; i < 3; i++) {
          if ((await app.evalJS<string | null>(KEY_VIEW_TESTID)) === "focus-walk-beta") break;
          await app.nativeKey("Tab");
        }
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "focus-walk-beta"`, {
          timeoutMs: 6000,
        });
        await app.nativeClickAtElement(ALPHA);
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(await app.evalJS<string | null>(KEY_VIEW_TESTID)).toBe("focus-walk-beta");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
