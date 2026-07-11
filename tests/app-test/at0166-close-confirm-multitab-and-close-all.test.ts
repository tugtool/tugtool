/**
 * at0166-close-confirm-multitab-and-close-all.test.ts — per-card
 * close-confirm on a multi-tab pane (Cmd-W) and the Close All Card Tabs
 * command (⌥⌘W).
 *
 * Two close gestures, each gated on the *card's own* `confirmClose`
 * policy rather than the blanket "multi-tab always confirms" rule the
 * X button uses:
 *
 *  1. **Cmd-W on a multi-tab pane** removes only the active card. When
 *     that card opts into `confirmClose` (the Dev card) a single-card
 *     "Close Card?" popover guards the removal; a non-opt-in active card
 *     (gallery-input) is removed immediately with no popover.
 *
 *  2. **Close All Card Tabs (⌥⌘W → CLOSE_ALL)** closes the whole focused
 *     pane. It pops the "Close N Tabs?" guard only when *any* hosted
 *     card opts into `confirmClose`, and closes immediately otherwise —
 *     unlike the X button, whose multi-tab close always confirms (the
 *     menu command is a deliberate gesture, the X a stray-click target).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = (id: string) => `[data-card-id="${id}"]`;
const PANE = (id: string) => `[data-pane-id="${id}"]`;
const CONFIRM_POPOVER = `[data-slot="tug-confirm-popover"]`;

const exists = (sel: string) => `document.querySelector(${JSON.stringify(sel)}) !== null`;

/** A single pane holding two cards. `aComponent` is the active card's type. */
function twoCardPane(aComponent: string) {
  return {
    cards: [
      { id: "A", componentId: aComponent, title: "Card A", closable: true },
      { id: "B", componentId: "gallery-input", title: "Card B", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 60, y: 60 },
        size: { width: 860, height: 620 },
        cardIds: ["A", "B"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** Synthetic capture-phase keydown — same pipeline a real chord drives
 *  (matchKeybinding → sendToFirstResponder). `alt` selects ⌥⌘W (CLOSE_ALL)
 *  vs the bare ⌘W (CLOSE). */
async function dispatchKey(app: App, code: string, key: string, alt: boolean): Promise<void> {
  await app.evalJS<void>(
    `document.dispatchEvent(new KeyboardEvent("keydown", { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, metaKey: true, altKey: ${alt ? "true" : "false"}, bubbles: true, cancelable: true }))`,
  );
}

const popoverText = `(function(){
  var el = document.querySelector(${JSON.stringify(CONFIRM_POPOVER)});
  return el ? (el.textContent || "") : null;
})()`;

function clickPopoverButton(label: string): string {
  return `(function(){
    var root = document.querySelector(${JSON.stringify(CONFIRM_POPOVER)});
    if (root === null) throw new Error("popover missing for button: " + ${JSON.stringify(label)});
    var btns = root.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent && btns[i].textContent.trim() === ${JSON.stringify(label)}) {
        btns[i].click();
        return;
      }
    }
    throw new Error("popover button not found: " + ${JSON.stringify(label)});
  })()`;
}

const settle = () => new Promise((r) => setTimeout(r, 350));

describe.skipIf(!SHOULD_RUN)(
  "AT0166: per-card close-confirm on multi-tab Cmd-W and Close All Card Tabs",
  () => {
    test(
      "Cmd-W — multi-tab, opt-in active card: 'Close Card?' guards, confirm removes only that tab",
      async () => {
        const app = await launchTugApp({ testName: "at0166-cmdw-confirm" });
        try {
          await app.enableDeckTrace(true);
          // Active card A is a Dev card (confirmClose: true); B is gallery-input.
          await app.seedDeckState({ state: twoCardPane("dev"), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );
          await settle();

          // Cmd-W removes the active tab only — but A opts into confirm, so the
          // single-card "Close Card?" popover guards it. Both cards survive.
          await dispatchKey(app, "KeyW", "w", false);
          await app.waitForCondition<boolean>(exists(CONFIRM_POPOVER), { timeoutMs: 6000 });
          expect(await app.evalJS<string | null>(popoverText)).toContain("Close Card?");
          expect(await app.evalJS<boolean>(exists(CARD("A"))), "A survives while popover open").toBe(true);
          expect(await app.evalJS<boolean>(exists(CARD("B"))), "B survives while popover open").toBe(true);

          // Confirm → A removed, B remains, pane stays (it still hosts B).
          await app.evalJS<void>(clickPopoverButton("Close"));
          await app.waitForCondition<boolean>(`${exists(CARD("A"))} === false`, { timeoutMs: 6000 });
          expect(await app.evalJS<boolean>(exists(CARD("B"))), "B remains after closing A").toBe(true);
          expect(await app.evalJS<boolean>(exists(PANE("p1"))), "pane survives — still hosts B").toBe(true);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0166-cmdw-confirm] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "Cmd-W — multi-tab, non-opt-in active card: removes the tab immediately, no popover",
      async () => {
        const app = await launchTugApp({ testName: "at0166-cmdw-immediate" });
        try {
          await app.enableDeckTrace(true);
          // Both cards gallery-input — no confirmClose.
          await app.seedDeckState({ state: twoCardPane("gallery-input"), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );
          await settle();

          await dispatchKey(app, "KeyW", "w", false);
          await app.waitForCondition<boolean>(`${exists(CARD("A"))} === false`, { timeoutMs: 6000 });
          expect(await app.evalJS<boolean>(exists(CARD("B"))), "B remains after closing A").toBe(true);
          expect(await app.evalJS<boolean>(exists(PANE("p1"))), "pane survives — still hosts B").toBe(true);
          expect(
            await app.evalJS<boolean>(exists(CONFIRM_POPOVER)),
            "no confirm popover for a non-opt-in active card",
          ).toBe(false);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0166-cmdw-immediate] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "Close All (⌥⌘W) — pane with an opt-in card: 'Close 2 Tabs?' guards, confirm closes the pane",
      async () => {
        const app = await launchTugApp({ testName: "at0166-closeall-confirm" });
        try {
          await app.enableDeckTrace(true);
          // A Dev card lives in the pane → any-card-opts-in → confirm.
          await app.seedDeckState({ state: twoCardPane("dev"), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );
          await settle();

          await dispatchKey(app, "KeyW", "w", true);
          await app.waitForCondition<boolean>(exists(CONFIRM_POPOVER), { timeoutMs: 6000 });
          expect(await app.evalJS<string | null>(popoverText)).toContain("Close 2 Tabs?");
          expect(await app.evalJS<boolean>(exists(PANE("p1"))), "pane survives while popover open").toBe(true);

          await app.evalJS<void>(clickPopoverButton("Close All"));
          await app.waitForCondition<boolean>(`${exists(PANE("p1"))} === false`, { timeoutMs: 6000 });
          expect(await app.evalJS<boolean>(exists(CARD("A"))), "A gone after Close All").toBe(false);
          expect(await app.evalJS<boolean>(exists(CARD("B"))), "B gone after Close All").toBe(false);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0166-closeall-confirm] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "Close All (⌥⌘W) — pane with no opt-in card: closes the pane immediately, no popover",
      async () => {
        const app = await launchTugApp({ testName: "at0166-closeall-immediate" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: twoCardPane("gallery-input"), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );
          await settle();

          await dispatchKey(app, "KeyW", "w", true);
          await app.waitForCondition<boolean>(`${exists(PANE("p1"))} === false`, { timeoutMs: 6000 });
          expect(await app.evalJS<boolean>(exists(CARD("A"))), "A gone").toBe(false);
          expect(await app.evalJS<boolean>(exists(CARD("B"))), "B gone").toBe(false);
          expect(
            await app.evalJS<boolean>(exists(CONFIRM_POPOVER)),
            "no confirm popover for an all-recoverable pane",
          ).toBe(false);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0166-closeall-immediate] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
