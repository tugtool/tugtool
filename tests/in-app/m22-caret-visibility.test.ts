/**
 * m22-caret-visibility.test.ts — after every refocus path, the
 * engine root holds focus AND `document.hasFocus()` is true (so
 * the caret blinks).
 *
 * ## Why both axes matter
 *
 * `::selection` paint and the caret blink are browser-native and
 * tied to BOTH `document.activeElement` AND
 * `document.hasFocus()`. A refocus path that lands `.focus()` on
 * a contenteditable but doesn't bring the WKWebView's window into
 * key-window state (or vice-versa) leaves the user staring at a
 * focused-but-blink-less editor — visually identical to a blurred
 * editor. The dev-warn in `setSelectedRange` catches the silent-
 * focus-fail half; this test catches both halves on every path
 * the [M22] audit cares about.
 *
 * ## Refocus paths exercised
 *
 *   1. Cold-boot mount (`seedDeckState` with `focusCardId`).
 *   2. App resign + become-active.
 *   3. Tab switch + back inside one pane.
 *
 * Cross-pane and tab-close handoffs are covered by m07/m16 (which
 * assert focus on the right card; the `document.hasFocus` half is
 * implicit because those tests run with the WKWebView in steady-
 * active state). m22 specifically gates paths where window-active
 * state could plausibly be in flux.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_IN_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const PROMPT_INPUT_SELECTOR = '[data-tug-prompt-input-root] [contenteditable]';

function editorSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] ${PROMPT_INPUT_SELECTOR}`;
}

async function assertCaretVisible(app: App, cardId: string): Promise<void> {
  const verdict = await app.evalJS<{
    activeMatches: boolean;
    hasFocus: boolean;
    cardOf: string | null;
  }>(
    `(function(){
      var el = document.activeElement;
      var matches = el !== null && el.matches(${JSON.stringify(editorSelectorFor(cardId))});
      var card = el ? el.closest("[data-card-id]") : null;
      var cardOf = card ? card.getAttribute("data-card-id") : null;
      return {
        activeMatches: matches,
        hasFocus: document.hasFocus(),
        cardOf: cardOf,
      };
    })()`,
  );
  expect(verdict.activeMatches, `expected activeElement to match editor for ${cardId}`).toBe(true);
  expect(verdict.cardOf, `expected activeElement to live under ${cardId}`).toBe(cardId);
  expect(verdict.hasFocus, `expected document.hasFocus() === true after refocus on ${cardId}`).toBe(true);
}

describe.skipIf(!SHOULD_RUN)("m22: caret visible after every refocus path", () => {
  test("cold-boot, app-cycle, tab-switch all leave the engine root focused with document.hasFocus()", async () => {
    const app = await launchTugApp({ testName: "m22-caret-visibility" });
    try {
      await app.enableDeckTrace(true);

      // ---- Cold-boot path ----
      await app.seedDeckState({
        state: {
          cards: [
            { id: "A", componentId: "gallery-prompt-input", title: "EM A", closable: true },
            { id: "B", componentId: "gallery-prompt-input", title: "EM B", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 520, height: 360 },
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
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
      );
      await app.awaitEngineReady("A");

      // Anchor focus on the editor — synth-mount activation
      // doesn't always lift WKWebView's window-focus state on
      // its own; an explicit click fixes that and matches the
      // pattern used by m04 / m35-em.
      await app.nativeClickAtElement(editorSelectorFor("A"));
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelectorFor("A"))})`,
        { timeoutMs: 2000 },
      );
      await assertCaretVisible(app, "A");

      // ---- App resign / become-active ----
      await app.simulateAppResign();
      await app.simulateAppBecomeActive();
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelectorFor("A"))})`,
        { timeoutMs: 2000 },
      );
      await assertCaretVisible(app, "A");

      // ---- Tab switch within pane: A → B → A ----
      await app.nativeClickAtElement(`[data-testid="tug-tab-B"]`);
      await app.waitForCondition<boolean>(
        `window.__tug.getActiveCardId() === "B"`,
        { timeoutMs: 2000 },
      );
      await app.awaitEngineReady("B");
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelectorFor("B"))})`,
        { timeoutMs: 2000 },
      );
      await assertCaretVisible(app, "B");

      await app.nativeClickAtElement(`[data-testid="tug-tab-A"]`);
      await app.waitForCondition<boolean>(
        `window.__tug.getActiveCardId() === "A"`,
        { timeoutMs: 2000 },
      );
      await app.waitForCondition<boolean>(
        `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelectorFor("A"))})`,
        { timeoutMs: 2000 },
      );
      await assertCaretVisible(app, "A");
    } catch (err) {
      const tail = app.tailLog(200);
      if (tail !== "") {
        process.stderr.write(`\n[m22-caret-visibility] log tail:\n${tail}\n`);
      }
      throw err;
    } finally {
      await app.close();
    }
  }, TEST_TIMEOUT_MS);
});
