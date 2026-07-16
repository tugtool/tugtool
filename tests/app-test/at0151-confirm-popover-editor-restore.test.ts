/**
 * at0151-confirm-popover-editor-restore.test.ts — the close-confirm popover
 * restores the prompt-entry caret on cancel.
 *
 * The user-visible repro:
 *   1. A connected session card with the caret blinking in the prompt entry.
 *   2. Click the title-bar X → the "Close Card?" confirm popover opens (the
 *      popover seeds the ring onto its default button, displacing DOM focus).
 *   3. Cmd-. (or Cancel) dismisses the popover.
 *   4. The caret must return to the prompt-entry editor and typing must land.
 *
 * This gates the focus-restoration contract: a surface that displaces DOM focus
 * on open (the confirm popover's `armKeyboardRestore`) must restore the opener's
 * focus on close, and the restore must honor the editor's responder FOCUS
 * CONTRACT ([D03] #focus-contract) — the engine's generic DOM walk cannot focus
 * CodeMirror's contenteditable caret, so `focusKeyView` routes through
 * `focusResponder` (which invokes `view.focus()`). Restoration falls out of the
 * key view + the focus contract by construction; no surface-side capture.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const CLOSE_BUTTON = `.tug-pane[data-pane-id="p1"] [data-testid="tug-pane-close-button"]`;
const CONFIRM_POPOVER = '[data-slot="tug-confirm-popover"]';

const EDITOR_FOCUSED = `(function(){
  var el = document.querySelector(${JSON.stringify(EDITOR)});
  return el !== null && document.activeElement === el;
})()`;

const EDITOR_TEXT = `(function(){
  var el = document.querySelector(${JSON.stringify(EDITOR)});
  return el ? el.textContent : null;
})()`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
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

describe.skipIf(!SHOULD_RUN)(
  "AT0151: close-confirm popover restores the prompt-entry caret on cancel",
  () => {
    test(
      "caret in editor → X opens confirm → Cmd-. cancels → caret restored and typing lands",
      async () => {
        const app = await launchTugApp({
          testName: "at0151-confirm-popover-editor-restore",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindSession("A");
          await app.awaitEngineReady("A");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(EDITOR)}) !== null`,
            { timeoutMs: 8000 },
          );

          // (1) Put the caret in the prompt-entry editor.
          await app.nativeClickAtElement(EDITOR);
          await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });

          // (2) Click the title-bar X — the session card opts into close-confirm, so
          // the "Close Card?" popover opens (and seeds the ring on its default
          // button, taking DOM focus off the editor).
          await app.nativeClickAtElement(CLOSE_BUTTON);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER)}) !== null`,
            { timeoutMs: 6000 },
          );
          // The editor is no longer focused while the popover owns the ring.
          expect(await app.evalJS<boolean>(EDITOR_FOCUSED)).toBe(false);

          // (3) Cmd-. cancels the popover (the popover owns the cancel keys by
          // claiming first responder).
          await app.nativeKey(".", ["cmd"]);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER)}) === null`,
            { timeoutMs: 6000 },
          );

          // (4) The pane survives, and the caret is restored to the editor — by
          // the engine routing the key-view restore through the editor's focus
          // contract (`view.focus()`), not a generic DOM walk.
          const paneExists = await app.evalJS<boolean>(
            `document.querySelector('[data-pane-id="p1"]') !== null`,
          );
          expect(paneExists, "pane must survive a cancelled close").toBe(true);
          await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });

          // And typing lands in the editor (focus is genuinely the caret, not a
          // stranded body focus that would beep).
          await app.nativeType("hi");
          await app.waitForCondition<boolean>(
            `(${EDITOR_TEXT}).indexOf("hi") !== -1`,
            { timeoutMs: 6000 },
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
