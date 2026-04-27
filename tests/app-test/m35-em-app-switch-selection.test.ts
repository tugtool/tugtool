/**
 * m35-em-app-switch-selection.test.ts — selection survives the
 * app-resign / app-become-active round-trip (cmd-tab away + back)
 * for EM cards.
 *
 * ## Why this exists
 *
 * User-reported: type "hello" in a tide-card's TugPromptEntry,
 * select the last 3 chars ("llo"), cmd-tab away, cmd-tab back.
 * Text always restores; selection is **intermittently** lost,
 * with the caret left blinking at the end of "hello". The
 * gallery-prompt-entry path doesn't reproduce the bug — only
 * tide does — but the underlying activation chain is shared
 * (TugPromptEntry registers `onCardActivated` for both), so the
 * gallery-prompt-entry path is a useful forward-regression gate
 * for any fix to the activation-time selection-restore behavior.
 *
 * ## Root-cause hypothesis (Step 23G)
 *
 * WebKit's selectionchange-on-focus quirk: calling `.focus()` on
 * a contenteditable that already holds a programmatic selection
 * fires an asynchronous `selectionchange` event that sometimes
 * collapses the caret to position 0. The engine's
 * `setSelectedRange` handles this by focusing FIRST then setting
 * the selection. The EM-card's `onCardActivated` doesn't — it
 * calls `root.focus()` AFTER the (pre-existing) selection is
 * already in place, so the quirk can fire.
 *
 * The fix is to capture the existing selection range via
 * `engine.getSelectedRange()` BEFORE focusing, then re-apply via
 * `engine.setSelectedRange()` AFTER. The engine handles the
 * focus-then-select ordering internally.
 *
 * ## Coverage
 *
 * `gallery-prompt-input` (TugPromptInput direct) and
 * `gallery-prompt-entry` (TugPromptEntry, what tide-card uses
 * internally). Tide itself can't run in the in-app sweep because
 * its content factory gates on `feedsReady`, which depends on a
 * live tugcast/Claude Code stream — manual user verification
 * gates the tide path.
 *
 * ## Stress note
 *
 * The bug is intermittent. Each test runs the resign/return cycle
 * once; the test is added to the default sweep so it runs on
 * every CI cycle. Repeated runs over time exercise the race; if
 * the fix regresses, the test will eventually fail.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const PROMPT_INPUT_SELECTOR = '[data-tug-prompt-input-root] [contenteditable]';

async function runAppSwitchSelection(app: App, componentId: string): Promise<void> {
  await app.enableDeckTrace(true);

  await app.seedDeckState({
    state: {
      cards: [
        { id: "A", componentId, title: "EM A", closable: true },
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

  // Click into engine; type "hello".
  await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
  );
  await app.nativeType("hello");
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "hello")`,
    { timeoutMs: 2000 },
  );

  // Set selection to "llo" (offsets 2..5) directly via DOM Selection
  // API — drives the contenteditable's live Selection so the engine's
  // captureState picks it up. setSelectedRange via the delegate would
  // also work, but the user's gesture is mouse/keyboard selection
  // landing in the live DOM.
  await app.evalJS<void>(
    `(function(){
      var ed = document.querySelector('[data-card-id="A"] [data-tug-prompt-input-root] [contenteditable]');
      var sel = window.getSelection();
      var range = document.createRange();
      var textNode = ed.firstChild;
      range.setStart(textNode, 2);
      range.setEnd(textNode, 5);
      sel.removeAllRanges();
      sel.addRange(range);
    })()`,
  );

  // Confirm pre-resign selection is live.
  const preResign = await app.evalJS<{ start: number; end: number } | null>(
    `(function(){
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      var r = sel.getRangeAt(0);
      return { start: r.startOffset, end: r.endOffset };
    })()`,
  );
  expect(preResign).toEqual({ start: 2, end: 5 });

  // Resign (cmd-tab away analog). Window-blur listener flushes save.
  const markBeforeResign = await app.markDeckTrace();
  await app.simulateAppResign();
  await app.waitForCondition<boolean>(
    `(function(){
      var t = window.__tug.getDeckTrace({since: ${markBeforeResign}});
      for (var i = 0; i < t.length; i++) {
        if (t[i].kind === "save-callback" && t[i].source === "window-blur" && t[i].cardId === "A") return true;
      }
      return false;
    })()`,
    { timeoutMs: 2000 },
  );

  // Become active (cmd-tab back). Window-focus listener calls
  // reactivateCurrentFocusDestination → invokeActivationCallback →
  // TugPromptEntry's / TugPromptInput's onCardActivated → .focus().
  await app.simulateAppBecomeActive();

  // Focus must land back on the engine's contenteditable.
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="A"]') !== null`,
    { timeoutMs: 2000 },
  );

  // Selection MUST survive the round-trip. The user-visible bug is
  // the caret being left at end-of-content with the selection lost.
  const postResign = await app.evalJS<{ start: number; end: number; collapsed: boolean } | null>(
    `(function(){
      var sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      var r = sel.getRangeAt(0);
      return { start: r.startOffset, end: r.endOffset, collapsed: r.collapsed };
    })()`,
  );
  expect(postResign).not.toBeNull();
  expect(postResign!.collapsed).toBe(false);
  expect(postResign!.start).toBe(2);
  expect(postResign!.end).toBe(5);
}

describe.skipIf(!SHOULD_RUN)("m35-em: selection survives app resign + become-active (cmd-tab analog)", () => {
  test("gallery-prompt-input: selection survives cmd-tab away + back", async () => {
    const app = await launchTugApp({ testName: "m35-em-app-switch-input" });
    try {
      await runAppSwitchSelection(app, "gallery-prompt-input");
    } finally {
      await app.close();
    }
  });

  test("gallery-prompt-entry: selection survives cmd-tab away + back", async () => {
    const app = await launchTugApp({ testName: "m35-em-app-switch-entry" });
    try {
      await runAppSwitchSelection(app, "gallery-prompt-entry");
    } finally {
      await app.close();
    }
  });
});
