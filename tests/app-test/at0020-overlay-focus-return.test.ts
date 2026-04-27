/**
 * at0020-overlay-focus-return.test.ts — context-menu dismiss returns
 * focus to the previously-focused card.
 *
 * ## Scenario
 *
 * Mount a `gallery-prompt-input` (EM card with editor + context
 * menu via `useTextInputResponder`). Focus the editor, type
 * something so the menu has selection state to render against.
 * `nativeRightClick` to open the editor context menu (portaled to
 * `document.body` with `data-slot="tug-editor-context-menu"`).
 * `nativeKey("Escape")` to dismiss. Assert focus is back inside
 * the editor.
 *
 * ## Why context menu
 *
 * The editor context menu is the most user-driven overlay in
 * tugdeck — every prompt-input surface installs it via
 * `useTextInputResponder.handleContextMenu`. The menu portals
 * OUTSIDE the editor subtree, so on close the focus has nowhere
 * to "naturally" return without explicit focus-return logic. The
 * menu's keydown handler dismisses on Escape; if focus-return
 * works, `document.activeElement` should be the editor again, not
 * `<body>`.
 *
 * Other overlay surfaces (`tug-popover`, `tug-sheet`,
 * `tug-context-menu`, `tug-alert`) follow the same portal-then-
 * dismiss pattern; the audit verifies the representative one
 * round-trips cleanly. A failure would surface focus-return as
 * the [AT0020] gap.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const PROMPT_INPUT_SELECTOR = '[data-tug-prompt-input-root] [contenteditable]';

function editorSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] ${PROMPT_INPUT_SELECTOR}`;
}

describe.skipIf(!SHOULD_RUN)("m20: overlay dismiss returns focus to previously-focused card", () => {
  test("right-click context menu + Escape returns focus to editor", async () => {
    const app = await launchTugApp({ testName: "at0020-overlay-focus-return" });
    try {
      await app.enableDeckTrace(true);

      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "gallery-prompt-input", title: "EM A", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 480, height: 320 },
              cardIds: ["A"],
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
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );
      await app.awaitEngineReady("A");

      // Click + type to anchor focus inside the editor and give
      // the context menu's selection-conditional items something
      // to render against.
      await app.nativeClickAtElement(editorSelectorFor("A"));
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelectorFor("A"))})`,
        { timeoutMs: 2000 },
      );
      await app.nativeType("hello");
      await app.waitForCondition<boolean>(
        `(window.__tug.getEmCardState("A") && window.__tug.getEmCardState("A").text === "hello")`,
        { timeoutMs: 2000 },
      );

      // Open the context menu via right-click on the editor.
      await app.nativeRightClickAtElement(editorSelectorFor("A"));
      await app.waitForCondition<boolean>(
        `document.querySelector('[data-slot="tug-editor-context-menu"]') !== null`,
        { timeoutMs: 2000 },
      );

      // Escape dismisses the menu; focus-return puts focus back
      // inside the editor.
      await app.nativeKey("Escape");
      await app.waitForCondition<boolean>(
        `document.querySelector('[data-slot="tug-editor-context-menu"]') === null`,
        { timeoutMs: 2000 },
      );

      const active = await app.evalJS<string | null>(
        `(function(){
          var el = document.activeElement;
          if (!el) return null;
          if (el.tagName === "BODY") return "BODY";
          var card = el.closest("[data-card-id]");
          var cardId = card ? card.getAttribute("data-card-id") : null;
          var matches = el.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)});
          return cardId + ":" + el.tagName + ":" + (matches ? "editor" : "other");
        })()`,
      );
      expect(active).toBe("A:DIV:editor");
    } catch (err) {
      const tail = app.tailLog(200);
      if (tail !== "") {
        process.stderr.write(`\n[at0020-overlay-focus-return] log tail:\n${tail}\n`);
      }
      throw err;
    } finally {
      await app.close();
    }
  }, TEST_TIMEOUT_MS);
});
