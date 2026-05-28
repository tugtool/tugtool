/**
 * at0035-dev-app-switch-selection.test.ts — selection survives the
 * app-resign / app-become-active round-trip (cmd-tab away + back)
 * for the **dev-card** specifically.
 *
 * ## Why a dev-specific variant
 *
 * The user-reported bug at the heart of [AT0035]
 * reproduces ONLY with dev-card; gallery-prompt-entry doesn't
 * exhibit the intermittent collapse. Dev-card has TWO redundant
 * focus paths on activation — its own `useCardDelegate({
 * cardDidActivate })` legacy hook plus TugPromptEntry's
 * framework-driven `onCardActivated` — and the back-to-back focus
 * calls trigger WebKit's selectionchange-on-focus quirk
 * intermittently. Gallery has only the framework path. So the
 * dev-specific test is the only one that exercises the actual
 * race the fix addresses.
 *
 * ## Why the harness can render dev-card
 *
 * Dev-card's content factory gates on `feedsReady` — its
 * `defaultFeedIds: [CODE_INPUT, CODE_OUTPUT, SESSION_METADATA,
 * FILETREE]` would otherwise block mount until a live
 * tugcast/tugcode backend populated frames. In test mode
 * (`window.__tugTestMode === true`, set by the Swift host's
 * `WKUserScript` injection when the app is launched via
 * `TUGAPP_TEST_SOCKET`), CardHost bypasses the gate so tide
 * mounts immediately with empty feed stores. The editor and the
 * focus / selection paths don't depend on feed data; the AI
 * streaming path does, but that's not what this test exercises.
 *
 * ## Stress note
 *
 * Pre-fix repro required multi-second blur dwell to expose the
 * race; the test ran 10 iterations × 2-second dwell to nail down
 * the bug. Post-fix (drop dev-card's `cardWillDeactivate → .blur()`),
 * the path is deterministic, so the test is right-sized to 3
 * iterations × 300ms dwell — enough to gate against regression
 * without burning wall-clock time on every CI run.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const PROMPT_INPUT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

const STRESS_ITERATIONS = 3;

describe.skipIf(!SHOULD_RUN)("at0035-tide: dev-card selection survives app resign + become-active", () => {
  test("cmd-tab away + back preserves \"llo\" selection on dev-card", async () => {
    const app = await launchTugApp({ testName: "at0035-dev-app-switch" });
    let lastIteration = -1;
    try {
      await app.enableDeckTrace(true);

      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "tide", title: "Dev A", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 720, height: 540 },
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

      // Dev-card mounts its picker by default (no session bound).
      // Bind a fake session so DevCardBody renders the editor.
      await app.bindDevSession("A");

      await app.awaitEngineReady("A");

      // Click into the tide editor; type "hello".
      await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
      );
      await app.nativeType("hello");
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "hello")`,
        { timeoutMs: 2000 },
      );

      // Stress-loop: each iteration sets selection to "llo", then
      // resigns + becomes-active, then asserts the selection
      // survived. Pre-fix, intermittent; post-fix, deterministic.
      for (let i = 0; i < STRESS_ITERATIONS; i++) {
        lastIteration = i;
        // Set selection to "llo" (offsets 2..5) via the engine's
        // own setSelectedRange (which goes through the focus-then-
        // select WebKit-safe ordering). Mirrors what a real user's
        // shift+arrow selection would land in the engine.
        await app.evalJS<void>(
          `(function(){
            var ed = document.querySelector('[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content');
            ed.focus();
            // CM6 wraps each line in a .cm-line div; the text node
            // lives inside the line, not directly under .cm-content.
            var line = ed.querySelector('.cm-line') || ed;
            var textNode = line.firstChild;
            while (textNode && textNode.nodeType !== Node.TEXT_NODE) {
              textNode = textNode.firstChild;
            }
            if (!textNode) throw new Error("[at0035-tide] no text node under .cm-content");
            var sel = window.getSelection();
            var range = document.createRange();
            range.setStart(textNode, 2);
            range.setEnd(textNode, 5);
            sel.removeAllRanges();
            sel.addRange(range);
          })()`,
        );

        const preResign = await app.evalJS<{ start: number; end: number } | null>(
          `(function(){
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            var r = sel.getRangeAt(0);
            return { start: r.startOffset, end: r.endOffset };
          })()`,
        );
        expect(preResign).toEqual({ start: 2, end: 5 });

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

        // Brief blur dwell to give WKWebView's window.blur dispatch
        // time to settle. Pre-fix, longer dwells (~2s) were the
        // most reliable repro vector; once the fix landed (drop
        // tide's `cardWillDeactivate → .blur()`), 300ms is enough
        // to drive the pathway and keep the test cheap.
        await new Promise<void>((resolve) =>
          (
            globalThis as unknown as {
              setTimeout: (fn: () => void, ms: number) => unknown;
            }
          ).setTimeout(() => resolve(), 300),
        );

        await app.simulateAppBecomeActive();

        await app.waitForCondition<boolean>(
          `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="A"]') !== null`,
          { timeoutMs: 2000 },
        );

        const postResign = await app.evalJS<{ start: number; end: number; collapsed: boolean } | null>(
          `(function(){
            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return null;
            var r = sel.getRangeAt(0);
            return { start: r.startOffset, end: r.endOffset, collapsed: r.collapsed };
          })()`,
        );
        if (
          postResign === null ||
          postResign.collapsed ||
          postResign.start !== 2 ||
          postResign.end !== 5
        ) {
          // eslint-disable-next-line no-console
          console.error(
            `[at0035-tide] iteration ${i + 1}/${STRESS_ITERATIONS} lost selection:`,
            JSON.stringify(postResign),
          );
        }
        expect(postResign).not.toBeNull();
        expect(postResign!.collapsed).toBe(false);
        expect(postResign!.start).toBe(2);
        expect(postResign!.end).toBe(5);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[at0035-tide] failed at iteration ${lastIteration + 1}/${STRESS_ITERATIONS}`);
      throw err;
    } finally {
      await app.close();
    }
  }, 60_000);
});
