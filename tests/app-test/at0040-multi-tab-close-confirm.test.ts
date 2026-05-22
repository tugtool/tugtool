/**
 * at0040-multi-tab-close-confirm.test.ts — title-bar X close
 * confirmation, a pane-level feature applied uniformly to every pane.
 *
 * ## Behavior matrix
 *
 *   1. **Plain click, single-tab.** Click X → "Close Card?" popover
 *      opens and STAYS open until the user confirms or cancels.
 *      Confirm ("Close") closes the pane; cancel keeps it.
 *   2. **Plain click, multi-tab.** Click X → "Close N Tabs?" popover
 *      opens and STAYS open. Confirm ("Close All") closes the entire
 *      pane; cancel keeps it.
 *   3. **Option-click.** Option(alt)-click X → the pane closes
 *      immediately, no popover. The power-user escape hatch, single-
 *      and multi-tab alike.
 *   4. **Inactive pane.** Click X on a background pane → the pane
 *      comes forward (activates) AND the confirm popover opens. The
 *      user needs to see what they are about to discard. Holds for
 *      single-tab and multi-tab background panes alike — the X
 *      button carries no `data-no-activate`.
 *
 * Case 2 also gates the "popover-flash" regression that motivated
 * the original pass: if `Popover.Trigger`'s auto-toggle ever ends up
 * composed onto the X button again, the popover briefly opens and
 * immediately closes via the toggle inverting the just-opened state
 * on the trailing `click` event. Any future change that reintroduces
 * a Trigger on the X button would fail this test on the
 * "popover still present 300ms after click" assertion.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import type { App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const CONFIRM_POPOVER_SELECTOR = "[data-slot=\"tug-pane-close-confirm\"]";

function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) =>
    (
      globalThis as unknown as {
        setTimeout: (fn: () => void, ms: number) => unknown;
      }
    ).setTimeout(() => resolve(), ms),
  );
}

function paneCloseButtonSelector(paneId: string): string {
  return `.tug-pane[data-pane-id="${paneId}"] [data-testid="tug-pane-close-button"]`;
}

function popoverButtonByText(label: string): string {
  return `(function(){
    var root = document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)});
    if (root === null) return null;
    var btns = root.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent && btns[i].textContent.trim() === ${JSON.stringify(label)}) {
        return btns[i];
      }
    }
    return null;
  })()`;
}

/**
 * Option(alt)-click an element. `holdModifier` buffers native verbs
 * into one atomic RPC with the modifier held; `evalJS` is not allowed
 * inside that scope, so the element's viewport-center point is
 * resolved beforehand.
 */
async function optionClickElement(app: App, selector: string): Promise<void> {
  const point = await app.evalJS<{ x: number; y: number }>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) throw new Error("[at0040] option-click target missing: " + ${JSON.stringify(selector)});
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  await app.holdModifier(["alt"], async (inner) => {
    await inner.rpcCall<void>("nativeClick", { viewportPoint: point });
  });
}

/** Two cards in a single pane → multi-tab pane. */
function multiTabActiveDeckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-input" as const, title: "TugInput", closable: true },
      { id: "B", componentId: "gallery-textarea" as const, title: "TugTextarea", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 600, height: 540 },
        cardIds: ["A", "B"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"] as const,
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/**
 * Two panes: p1 (multi-tab, contains M+N cards) and p2 (active,
 * single card). p2 is active so p1 starts inactive — this is the
 * setup case 4 needs.
 */
function inactiveMultiTabDeckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-input" as const, title: "TugInput", closable: true },
      { id: "B", componentId: "gallery-textarea" as const, title: "TugTextarea", closable: true },
      { id: "C", componentId: "gallery-input" as const, title: "Other", closable: true },
    ],
    panes: [
      {
        id: "p1",
        // Background pane (inactive) with two tabs.
        position: { x: 40, y: 40 },
        size: { width: 600, height: 540 },
        cardIds: ["A", "B"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"] as const,
      },
      {
        id: "p2",
        // Foreground pane (active) with one tab. Its existence
        // makes p1 the inactive pane.
        position: { x: 700, y: 40 },
        size: { width: 460, height: 540 },
        cardIds: ["C"],
        activeCardId: "C",
        title: "",
        acceptsFamilies: ["developer"] as const,
      },
    ],
    activePaneId: "p2",
    hasFocus: true,
  };
}

/** Inactive single-tab variant — case 4, single-tab cell. */
function inactiveSingleTabDeckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-input" as const, title: "TugInput", closable: true },
      { id: "C", componentId: "gallery-input" as const, title: "Other", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 460, height: 540 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"] as const,
      },
      {
        id: "p2",
        position: { x: 540, y: 40 },
        size: { width: 460, height: 540 },
        cardIds: ["C"],
        activeCardId: "C",
        title: "",
        acceptsFamilies: ["developer"] as const,
      },
    ],
    activePaneId: "p2",
    hasFocus: true,
  };
}

/** Active single-tab variant — case 1. */
function activeSingleTabDeckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-input" as const, title: "TugInput", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 460, height: 540 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"] as const,
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)(
  "at0040: title-bar X close confirmation — a uniform pane feature",
  () => {
    test(
      "case 1 — single-tab: X opens 'Close Card?' popover and the popover STAYS open",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c1-single-open" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: activeSingleTabDeckShape(),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          await app.nativeClickAtElement(paneCloseButtonSelector("p1"));

          // Sleep past the flash-bug window to gate that the popover holds.
          await pause(300);

          const popoverState = await app.evalJS<{ present: boolean; text: string | null }>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)});
              if (el === null) return { present: false, text: null };
              return { present: true, text: el.textContent };
            })()`,
          );
          expect(
            popoverState.present,
            "confirm popover must still be in the DOM 300ms after the X click",
          ).toBe(true);
          expect(
            popoverState.text ?? "",
            "popover prompt must read 'Close Card?'",
          ).toContain("Close Card?");

          // Pane must still exist — confirm wasn't pressed.
          const paneStillExists = await app.evalJS<boolean>(
            `document.querySelector('[data-pane-id="p1"]') !== null`,
          );
          expect(paneStillExists, "pane must still exist while popover is open").toBe(true);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 1 — single-tab: confirming 'Close' closes the pane",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c1-single-confirm" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: activeSingleTabDeckShape(),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          await app.nativeClickAtElement(paneCloseButtonSelector("p1"));
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) !== null`,
            { timeoutMs: 2000 },
          );

          await app.evalJS<void>(
            `(function(){
              var btn = ${popoverButtonByText("Close")};
              if (btn === null) throw new Error("[at0040] Close button missing");
              btn.click();
            })()`,
          );

          await app.waitForCondition<boolean>(
            `document.querySelector('[data-pane-id="p1"]') === null`,
            { timeoutMs: 2000 },
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 1 — single-tab: Cancel keeps the pane and dismisses the popover",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c1-single-cancel" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: activeSingleTabDeckShape(),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          await app.nativeClickAtElement(paneCloseButtonSelector("p1"));
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) !== null`,
            { timeoutMs: 2000 },
          );

          await app.evalJS<void>(
            `(function(){
              var btn = ${popoverButtonByText("Cancel")};
              if (btn === null) throw new Error("[at0040] Cancel button missing");
              btn.click();
            })()`,
          );

          // Popover dismisses, pane stays.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) === null`,
            { timeoutMs: 2000 },
          );
          const paneStillExists = await app.evalJS<boolean>(
            `document.querySelector('[data-pane-id="p1"]') !== null`,
          );
          expect(paneStillExists, "pane must still exist after cancel").toBe(true);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 2 — multi-tab: X opens 'Close 2 Tabs?' popover and the popover STAYS open",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c2-multi-open" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: multiTabActiveDeckShape(),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          await app.nativeClickAtElement(paneCloseButtonSelector("p1"));

          // The flash bug closed the popover within 1–2 frames.
          // Sleep past that window to gate that the popover holds.
          await pause(300);

          const popoverState = await app.evalJS<{ present: boolean; text: string | null }>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)});
              if (el === null) return { present: false, text: null };
              return { present: true, text: el.textContent };
            })()`,
          );
          expect(
            popoverState.present,
            "confirm popover must still be in the DOM 300ms after the X click",
          ).toBe(true);
          expect(
            popoverState.text ?? "",
            "popover prompt must read 'Close 2 Tabs?'",
          ).toContain("Close 2 Tabs?");

          // Pane must still exist — confirm wasn't pressed.
          const paneStillExists = await app.evalJS<boolean>(
            `document.querySelector('[data-pane-id="p1"]') !== null`,
          );
          expect(paneStillExists, "pane must still exist while popover is open").toBe(true);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 2 — multi-tab: confirming 'Close All' closes the entire pane",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c2-multi-confirm" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: multiTabActiveDeckShape(),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          await app.nativeClickAtElement(paneCloseButtonSelector("p1"));
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) !== null`,
            { timeoutMs: 2000 },
          );

          // Click the Close All button by text.
          await app.evalJS<void>(
            `(function(){
              var btn = ${popoverButtonByText("Close All")};
              if (btn === null) throw new Error("[at0040] Close All button missing");
              btn.click();
            })()`,
          );

          await app.waitForCondition<boolean>(
            `document.querySelector('[data-pane-id="p1"]') === null`,
            { timeoutMs: 2000 },
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 3 — Option-click on X closes a single-tab pane immediately, no popover",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c3-option-single" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: activeSingleTabDeckShape(),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          await optionClickElement(app, paneCloseButtonSelector("p1"));
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-pane-id="p1"]') === null`,
            { timeoutMs: 2000 },
          );

          // No popover ever rendered — Option-click bypasses it.
          const popoverPresent = await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) !== null`,
          );
          expect(
            popoverPresent,
            "no confirm popover should render for an Option-click close",
          ).toBe(false);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 3 — Option-click on X closes a multi-tab pane immediately, no popover",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c3-option-multi" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: multiTabActiveDeckShape(),
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          await optionClickElement(app, paneCloseButtonSelector("p1"));
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-pane-id="p1"]') === null`,
            { timeoutMs: 2000 },
          );

          const popoverPresent = await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) !== null`,
          );
          expect(
            popoverPresent,
            "no confirm popover should render for an Option-click close",
          ).toBe(false);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 4 — inactive single-tab: X activates the pane AND opens the confirm popover",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c4-inactive-single" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: inactiveSingleTabDeckShape(),
            focusCardId: "C",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("C")`,
          );

          // Sanity: C is the active card (foreground pane).
          const activeBefore = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );
          expect(activeBefore, "C must be active before the click").toBe("C");

          await app.nativeClickAtElement(paneCloseButtonSelector("p1"));
          await pause(300);

          // Clicking X on an inactive single-tab pane brings it
          // forward — A becomes the new active card.
          const activeAfter = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );
          expect(
            activeAfter,
            "case 4: A must be active — clicking X on an inactive pane must bring it forward",
          ).toBe("A");

          // And the popover must be open with the single-tab prompt.
          const popoverState = await app.evalJS<{ present: boolean; text: string | null }>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)});
              if (el === null) return { present: false, text: null };
              return { present: true, text: el.textContent };
            })()`,
          );
          expect(popoverState.present, "popover must be open").toBe(true);
          expect(popoverState.text ?? "", "popover must read 'Close Card?'").toContain(
            "Close Card?",
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 4 — inactive multi-tab: X activates the pane AND opens the confirm popover",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c4-inactive-multi" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: inactiveMultiTabDeckShape(),
            focusCardId: "C",
          });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B") && window.__tug.assertHostRootRegistered("C")`,
          );

          // Sanity: C is the active card; p1 (containing A+B) is
          // the background pane.
          const activeBefore = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );
          expect(activeBefore, "C must be active before the click").toBe("C");

          await app.nativeClickAtElement(paneCloseButtonSelector("p1"));
          await pause(300);

          // After the click, p1's active card (A) must be the new
          // first responder — clicking X on an inactive pane brings
          // the pane forward.
          const activeAfter = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );
          expect(
            activeAfter,
            "case 4: A must be active — clicking X on an inactive pane must bring it forward",
          ).toBe("A");

          // And the popover must be open with the right prompt.
          const popoverState = await app.evalJS<{ present: boolean; text: string | null }>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)});
              if (el === null) return { present: false, text: null };
              return { present: true, text: el.textContent };
            })()`,
          );
          expect(popoverState.present, "popover must be open").toBe(true);
          expect(popoverState.text ?? "", "popover must read 'Close 2 Tabs?'").toContain(
            "Close 2 Tabs?",
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
