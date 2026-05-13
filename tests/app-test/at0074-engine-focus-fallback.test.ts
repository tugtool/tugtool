/**
 * at0074-engine-focus-fallback.test.ts — engine focus dispatches
 * through `onCardActivated` when `bag.focus` is absent ([AT0074]).
 *
 * ## What this pins
 *
 * `resolveActivationTarget` (focus-transfer.ts) has a precondition
 * above the engine-managed short-circuit: it resolves `dom` /
 * `form-control` focus targets inside content-owning cards before
 * handing off to the dispatch-activated path. The contract under
 * test here is the NEGATIVE case for that precondition:
 *
 *   When `bag.focus` is absent — i.e., the user's focus is on the
 *   engine's contenteditable (`kind: "component-owned"` is filtered
 *   out for content-owning cards by the save-side engine carve-out)
 *   — the precondition falls through and the resolver returns
 *   `{ kind: "dispatch-activated" }`. The engine's
 *   `onCardActivated` → `paintMirrorAsActive` is then the
 *   authoritative restore path.
 *
 * The regression we are gating against: if the precondition were to
 * naively honour `component-owned` (or fail to filter it on save),
 * the framework would `.focus()` the engine's contenteditable from
 * its own path, bypassing the engine's inactive-paint →
 * global-Selection transfer. The user would see focus on a view
 * with no caret. The engine-focus case must continue to route
 * through `dispatch-activated` even while non-engine framework-
 * focus targets (find row, future inline editors) ride `bag.focus`
 * directly.
 *
 * ## Shape
 *
 *   1. Seed a tide card; await engine ready; click into the
 *      contenteditable.
 *   2. Trigger a save (cmd-tab away — the window-blur listener
 *      flushes the save synchronously).
 *   3. Read the saved bag; assert `bag.focus` is absent (the
 *      engine carve-out on the save side).
 *   4. Cmd-tab back; assert `document.activeElement` is the
 *      contenteditable (the engine fallback on the resolver side).
 *
 * Sibling coverage: at0035-tide and at0036-inactive-card already
 * exercise the engine's full selection-restore through the same
 * window-blur / window-focus pair. AT0074's contribution is the
 * explicit gate on bag.focus absence — a cheap canary against a
 * misclassification in the new precondition.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const PROMPT_INPUT_SELECTOR = '[data-tug-prompt-input-root] [contenteditable]';

describe.skipIf(!SHOULD_RUN)("at0074: engine fallback when bag.focus is absent", () => {
  test("tide card with engine focus: bag.focus absent on save; focus returns to contenteditable on become-active", async () => {
    const app = await launchTugApp({ testName: "at0074-engine-fallback" });
    try {
      await app.enableDeckTrace(true);

      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "tide", title: "Tide A", closable: true },
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
      await app.bindTideSession("A");
      await app.awaitEngineReady("A");

      // Click into the engine's contenteditable. This is the
      // "engine focus" baseline — no `data-tug-focus-key` or
      // `data-tug-state-key` is involved.
      await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
      );
      await app.nativeType("alpha");
      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "alpha")`,
        { timeoutMs: 2000 },
      );

      const markBeforeResign = await app.markDeckTrace();
      await app.simulateAppResign();

      // window-blur fires the synchronous save flush.
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

      // Read the saved bag. The engine carve-out on the save side
      // means `bag.focus` is absent (`component-owned` was filtered
      // out for this content-owning card). `kind: "none"` is also
      // filtered out by the assembler so the axis is omitted
      // entirely from the bag.
      const bag = await app.evalJS<{ focus?: { kind: string } } | null>(
        `window.__tug.getCardStateBag("A")`,
      );
      expect(bag).not.toBeNull();
      // The contract: a content-owning card with engine focus
      // writes no `bag.focus` axis.
      expect(bag!.focus).toBeUndefined();

      // Brief blur dwell to let WKWebView's window.blur dispatch
      // settle, mirroring at0035-tide.
      await new Promise<void>((resolve) =>
        (
          globalThis as unknown as {
            setTimeout: (fn: () => void, ms: number) => unknown;
          }
        ).setTimeout(() => resolve(), 300),
      );

      await app.simulateAppBecomeActive();

      // The engine fallback runs: resolveActivationTarget falls
      // through the bag.focus precondition (kind is absent), hits
      // the engine-managed short-circuit, and the
      // dispatch-activated path lands focus on the contenteditable
      // via `paintMirrorAsActive`.
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="A"]') !== null`,
        { timeoutMs: 2000 },
      );
    } finally {
      await app.close();
    }
  }, 30_000);
});
