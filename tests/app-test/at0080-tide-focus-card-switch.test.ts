/**
 * at0080-dev-focus-card-switch.test.ts — a tide card's activation
 * focus lands on the prompt entry after a card-switch round-trip
 * [AT0080].
 *
 * ## Why this exists
 *
 * Phase E.12's rule: a card has at most one text-entry surface, and
 * for a tide card that surface is the `tug-prompt-entry`. So a
 * tide card's activation focus has exactly one destination — the
 * engine's contenteditable — regardless of activation source.
 *
 * AT0080 gates the card-switch source. AT0078 gates app-switch;
 * at0034-em gates cross-pane drag (on the same `tug-prompt-entry`
 * surface); at0081 gates Developer > Reload.
 *
 * ## Shape
 *
 *   1. Seed two tide cards (A + B) in one pane; bind a fake
 *      session on each; await engine ready on each.
 *   2. Click into A's contenteditable; type "hello".
 *   3. Click B's tab — deactivating A captures A's focus on the
 *      engine axis; activating B lands focus on B's contenteditable.
 *   4. Click A's tab — activation routes through
 *      `transferFocusForActivation` → `applyBagFocus` → engine
 *      resolution → the registered engine hook → `view.focus()`.
 *   5. Assert `document.activeElement` is A's `tug-prompt-entry`
 *      contenteditable — never anything else.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const PROMPT_INPUT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

function tabSelectorFor(cardId: string): string {
  return `[data-testid="tug-tab-${cardId}"]`;
}

function activeElementInCard(cardId: string): string {
  return `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="${cardId}"]') !== null`;
}

describe.skipIf(!SHOULD_RUN)(
  "AT0080: dev-card focus lands on the prompt entry after card-switch",
  () => {
    test(
      "switch A → B → A returns focus to Card A's prompt-entry contenteditable",
      async () => {
        const app = await launchTugApp({ testName: "at0080-dev-focus-card-switch" });
        try {
          await app.enableDeckTrace(true);

          await app.seedDeckState({
            state: {
              cards: [
                { id: "A", componentId: "tide", title: "Dev A", closable: true },
                { id: "B", componentId: "tide", title: "Dev B", closable: true },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 540 },
                  cardIds: ["A", "B"],
                  activeCardId: "A",
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          await app.bindDevSession("A");
          await app.awaitEngineReady("A");
          await app.bindDevSession("B");
          await app.awaitEngineReady("B");

          // Click into A's contenteditable; type some text so the
          // save side has engine focus + content to capture.
          await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
          await app.waitForCondition<boolean>(activeElementInCard("A"));
          await app.nativeType("hello");
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "hello")`,
            { timeoutMs: 2000 },
          );

          // Switch to Card B. Deactivating A captures A's engine
          // focus; activating B lands focus on B's contenteditable.
          await app.nativeClickAtElement(tabSelectorFor("B"));
          await app.waitForCondition<boolean>(activeElementInCard("B"), {
            timeoutMs: 2000,
          });

          // Switch back to Card A. Activation routes through the
          // single-channel dispatcher; the engine hook lands focus
          // on A's prompt-entry contenteditable.
          await app.nativeClickAtElement(tabSelectorFor("A"));
          await app.waitForCondition<boolean>(activeElementInCard("A"), {
            timeoutMs: 2000,
          });
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0080-dev-focus-card-switch] log tail:\n${tail}\n`,
            );
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
