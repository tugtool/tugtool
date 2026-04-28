/**
 * at0040-multi-tab-close-confirm.test.ts — title-bar X behavior on
 * single-tab vs multi-tab panes, active vs inactive.
 *
 * ## Behavior matrix
 *
 *   1. **Active single-tab.** Click X → pane closes immediately.
 *   2. **Active multi-tab.** Click X → "Close N Tabs?" popover opens
 *      and STAYS open until the user confirms or cancels. Confirm
 *      closes the entire pane; cancel does nothing.
 *   3. **Inactive single-tab.** Click X → pane closes silently
 *      without bringing the pane forward (`data-no-activate` is
 *      preserved for this branch — the user has nothing to lose).
 *   4. **Inactive multi-tab.** Click X → pane comes forward
 *      (activates) AND the "Close N Tabs?" popover opens. Same
 *      confirm/cancel semantics as case 2. The user needs to see
 *      what they're about to discard.
 *
 * Case 2 also gates the "popover-flash" regression that motivated
 * this whole pass: if `Popover.Trigger`'s auto-toggle ever ends up
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

/** Inactive single-tab variant — case 3. */
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
  "at0040: title-bar X close behavior across the four cells of (active|inactive) × (single|multi)",
  () => {
    test(
      "case 1 — active single-tab: X closes the pane immediately",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c1-active-single" });
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
            `document.querySelector('[data-pane-id="p1"]') === null`,
            { timeoutMs: 2000 },
          );

          // No popover ever rendered — single-tab path bypasses it.
          const popoverPresent = await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) !== null`,
          );
          expect(popoverPresent, "no confirm popover should render for single-tab close").toBe(false);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "case 2 — active multi-tab: X opens 'Close 2 Tabs?' popover and the popover STAYS open",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c2-active-multi" });
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
      "case 2 — confirming 'Close All' closes the entire pane",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c2-confirm" });
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
      "case 2 — Cancel keeps the pane and dismisses the popover",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c2-cancel" });
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
      "case 3 — inactive single-tab: X closes the pane WITHOUT activating it first",
      async () => {
        const app = await launchTugApp({ testName: "at0040-c3-inactive-single" });
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

          // p1 must be removed from the DOM.
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-pane-id="p1"]') === null`,
            { timeoutMs: 2000 },
          );

          // C must STILL be the active card — the close on the
          // inactive single-tab pane must not steal first responder
          // from the active pane.
          const activeAfter = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );
          expect(
            activeAfter,
            "case 3: C must remain active — clicking X on an inactive single-tab pane should not bring it forward",
          ).toBe("C");
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
          // first responder — clicking X on an inactive MULTI-tab
          // pane brings the pane forward.
          const activeAfter = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );
          expect(
            activeAfter,
            "case 4: A must be active — clicking X on an inactive multi-tab pane must bring the pane forward",
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
