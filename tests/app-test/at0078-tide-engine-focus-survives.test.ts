/**
 * at0078-dev-engine-focus-survives.test.ts — dev-card engine focus
 * survives the app-resign / app-become-active round-trip
 * (cmd-tab away + back) [AT0078].
 *
 * ## Why this exists
 *
 * Phase E.11 retired the engine's autonomous focus claim in
 * `useCardStatePreservation.onCardActivated` (Step 4f for
 * TugPromptEntry; Step 4g for TugTextEditor) AND the macrotask
 * focus claim in `useCardDelegate.cardDidActivate` (Step 4h). After
 * those retirements, the engine's `paintMirrorAsActive` runs
 * EXCLUSIVELY through the framework's `applyBagFocus` dispatcher
 * invoking the registered engine hook. AT0078 is the regression
 * gate that proves removing the macrotask delegate + the
 * autonomous onCardActivated did NOT break engine focus on real
 * dev-card when the user genuinely had engine focus at save
 * time.
 *
 * ## Shape
 *
 *   1. Seed a dev card; bind a fake session; await engine ready.
 *   2. Click into the dev editor's contenteditable; type "hello".
 *   3. `simulateAppResign` → window-blur → save flushes the bag.
 *      The save site captures `bag.focus.kind === "engine"` (the
 *      engine's contenteditable was focused at save time).
 *   4. Brief blur dwell mirroring AT0035-dev.
 *   5. `simulateAppBecomeActive` → `reactivateCurrentFocusDestination`
 *      → `applyBagFocus` → engine resolution → engine hook
 *      invocation → `paintMirrorAsActive(undefined)` →
 *      `view.focus()` lands on the contenteditable.
 *   6. Assert `document.activeElement` is the dev-card's
 *      contenteditable.
 *
 * ## Why this is the engine-path regression gate
 *
 * The user-reported bug at Phase E.11's birth involved the
 * find-row path (framework axis) losing to the engine's
 * autonomous claim. AT0073 covered the framework-axis path
 * (engineless fixture). AT0078 covers the engine path — when the
 * user genuinely had engine focus at save time, the engine's
 * paint-active still fires on reactivation. Both paths must
 * work; this gate ensures the engine fix didn't break the
 * non-find-row case.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const PROMPT_INPUT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

describe.skipIf(!SHOULD_RUN)("AT0078: dev-card engine focus survives app-switch", () => {
  test(
    "cmd-tab away + back preserves focus on the dev-card contenteditable",
    async () => {
      const app = await launchTugApp({ testName: "at0078-dev-engine-focus" });
      try {
        await app.enableDeckTrace(true);

        await app.seedDeckState({
          state: {
            cards: [
              { id: "A", componentId: "dev", title: "Dev A", closable: true },
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

        await app.bindDevSession("A");
        await app.awaitEngineReady("A");

        // Click into the dev editor; focus lands on contenteditable.
        await app.nativeClickAtElement(`[data-card-id="A"] ${PROMPT_INPUT_SELECTOR}`);
        await app.waitForCondition<boolean>(
          `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)})`,
        );

        // Type some text so the save side has something to capture.
        await app.nativeType("hello");
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && (window.__tug.getEmCardState("A")?.text === "hello")`,
          { timeoutMs: 2000 },
        );

        // Trigger save via window-blur.
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

        // Brief blur dwell mirroring AT0035-dev.
        await new Promise<void>((resolve) =>
          (
            globalThis as unknown as {
              setTimeout: (fn: () => void, ms: number) => unknown;
            }
          ).setTimeout(() => resolve(), 300),
        );

        await app.simulateAppBecomeActive();

        // Focus lands back on the dev-card contenteditable via the
        // framework's `applyBagFocus` → engine hook path.
        await app.waitForCondition<boolean>(
          `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(PROMPT_INPUT_SELECTOR)}) && document.activeElement.closest('[data-card-id="A"]') !== null`,
          { timeoutMs: 2000 },
        );
      } finally {
        await app.close();
      }
    },
    60_000,
  );
});
