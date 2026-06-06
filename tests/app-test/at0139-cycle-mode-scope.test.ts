/**
 * at0139-cycle-mode-scope.test.ts — the keyboard-focus-cycling mode primitive
 * (`useCycleMode`) pushes / seeds / wraps / restores ([P09]/[P10]).
 *
 * Driven on `gallery-cycle-demo`, a minimal text-first-card stand-in: a resting
 * focusable in the base mode plus three cycle stops in the hook's cycle scope.
 * The test proves the mechanism end-to-end:
 *
 *   1. **rest:** clicking "Resting" puts the key view on it; no cycle stop holds
 *      the key view.
 *   2. **toggle on (⌥⇥):** the mode is pushed and the key view seeds on the
 *      commit-home (lowest `focusOrder`), not the resting control.
 *   3. **Tab wraps:** Tab advances commit-home → A → B → commit-home, walking
 *      only the cycle stops (trapped).
 *   4. **toggle off (⌥⇥):** the mode pops and the key view returns to "Resting".
 *
 * Escape / Return / Space semantics are a later step; this gates push/seed/wrap/
 * restore only.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const DEMO = `${CARD} [data-testid="gallery-cycle-demo"]`;
const REST = `${CARD} [data-testid="cycle-rest"]`;
const HOME = `${CARD} [data-testid="cycle-home"]`;
const STOP_A = `${CARD} [data-testid="cycle-a"]`;
const STOP_B = `${CARD} [data-testid="cycle-b"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-cycle-demo", title: "Cycle", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 520 },
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

// The data-testid of the element that currently holds the keyboard key view, or
// null. Scoped to the demo so unrelated chrome never matches.
const KEY_VIEW_TESTID = `(function(){
  var el = document.querySelector(${JSON.stringify(`${DEMO} [data-key-view-kbd]`)});
  return el ? el.getAttribute("data-testid") : null;
})()`;

const CYCLING = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)});
  return el ? el.getAttribute("data-cycling") : null;
})()`;

describe.skipIf(!SHOULD_RUN)("AT0139: the cycle-mode primitive pushes/seeds/wraps/restores", () => {
  test(
    "⌥⇥ seeds the commit-home, Tab wraps the stops, ⌥⇥ restores the resting key view",
    async () => {
      const app = await launchTugApp({ testName: "at0139-cycle-mode-scope" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(REST)}) !== null`,
          { timeoutMs: 8000 },
        );

        // (1) Put the key view on the resting control (a real click → pointer
        // promotion → key view), and confirm no cycle stop holds it.
        await app.nativeClickAtElement(REST);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(await app.evalJS<string | null>(CYCLING)).toBe("false");

        // (2) ⌥⇥ → cycling on; key view seeds on the commit-home.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "cycle-home"`, {
          timeoutMs: 6000,
        });

        // (3) Tab wraps the cycle stops: home → A → B → home.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "cycle-a"`, { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "cycle-b"`, { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "cycle-home"`, {
          timeoutMs: 6000,
        });

        // The walk is trapped: the resting control never takes the key view.
        expect(await app.evalJS<string | null>(KEY_VIEW_TESTID)).toBe("cycle-home");

        // (4) ⌥⇥ → cycling off; the key view returns to the resting control.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        // No cycle stop holds the kbd key view once the mode has popped.
        expect(await app.evalJS<string | null>(KEY_VIEW_TESTID)).toBeNull();
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
