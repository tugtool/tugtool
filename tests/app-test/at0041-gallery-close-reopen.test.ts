/**
 * at0041-gallery-close-reopen.test.ts — closing the Component Gallery
 * via the title-bar X (multi-tab confirm flow) must leave the
 * SHOW_COMPONENT_GALLERY action reachable so a subsequent
 * `View > Show Component Gallery` menu invocation re-opens it.
 *
 * The user-visible repro:
 *   1. Empty deck.
 *   2. View > Show Component Gallery → gallery opens.
 *   3. Click X on gallery's title bar → confirm "Close N Tabs?" → Close All.
 *   4. View > Show Component Gallery again → silent no-op (BUG).
 *
 * Root cause: the action handler is registered on DeckCanvas's
 * responder. The dispatch path is `sendToFirstResponder`. After step 3
 * closes the only pane, the chain's first responder must end up on
 * `deck-canvas` (the root responder) so step 4's dispatch finds the
 * handler.
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

/** Count panes by counting `.tug-pane[data-pane-id]` elements. */
const PANE_COUNT_EXPR = `document.querySelectorAll('.tug-pane[data-pane-id]').length`;

/**
 * Find the data-pane-id of the (only) gallery pane by looking for
 * a title bar matching the Gallery's default title prefix. Returns
 * null if no gallery pane is in the DOM.
 */
const GALLERY_PANE_ID_EXPR = `(function(){
  // The Component Gallery pane's title comes from the gallery-buttons
  // registration's defaultTitle ("Component Gallery"). Locate any
  // .tug-pane whose title bar text starts with that string.
  var panes = document.querySelectorAll('.tug-pane[data-pane-id]');
  for (var i = 0; i < panes.length; i++) {
    var titleEl = panes[i].querySelector('[data-testid="tug-pane-title"]');
    var title = titleEl ? (titleEl.textContent || "") : "";
    if (title.indexOf("Component Gallery") !== -1) {
      return panes[i].getAttribute('data-pane-id');
    }
  }
  return null;
})()`;

describe.skipIf(!SHOULD_RUN)(
  "at0041: Component Gallery close via X-confirm leaves show-gallery action reachable",
  () => {
    test(
      "open → close (X-confirm) → open again — second open must succeed",
      async () => {
        const app = await launchTugApp({
          testName: "at0041-gallery-close-reopen",
        });
        try {
          await app.enableDeckTrace(true);

          // Start with an empty deck.
          await app.seedDeckState({
            state: {
              cards: [],
              panes: [],
              activePaneId: undefined,
              hasFocus: true,
            },
          });

          const initialPanes = await app.evalJS<number>(PANE_COUNT_EXPR);
          expect(initialPanes, "deck must start empty").toBe(0);

          // Wait for deck-canvas to register its responder. Without
          // this, the dispatch below races against the
          // ResponderChainProvider's useLayoutEffect that registers
          // the manager and DeckCanvas's own useResponder effect.
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-responder-id="deck-canvas"]') !== null`,
            { timeoutMs: 2000 },
          );
          await pause(50);

          // Step 2: dispatch show-component-gallery (same path as
          // the View > Show Component Gallery menu).
          await app.evalJS<void>(
            `window.__tug.dispatchControlAction("show-component-gallery")`,
          );
          await app.waitForCondition<boolean>(
            `${GALLERY_PANE_ID_EXPR} !== null`,
            { timeoutMs: 2000 },
          );

          const galleryPaneId1 = await app.evalJS<string | null>(
            GALLERY_PANE_ID_EXPR,
          );
          expect(galleryPaneId1, "first open: gallery pane id must be discoverable").not.toBeNull();

          // The gallery is multi-tab — sanity-check by clicking X
          // and verifying the confirm popover appears (the unique
          // visual signal of the multi-tab path).
          const closeBtnSel = `.tug-pane[data-pane-id="${galleryPaneId1}"] [data-testid="tug-pane-close-button"]`;
          await app.nativeClickAtElement(closeBtnSel);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER_SELECTOR)}) !== null`,
            { timeoutMs: 2000 },
          );

          // Click "Close All" to confirm.
          await app.evalJS<void>(
            `(function(){
              var btn = ${popoverButtonByText("Close All")};
              if (btn === null) throw new Error("[at0041] Close All button missing");
              btn.click();
            })()`,
          );
          await app.waitForCondition<boolean>(
            `${PANE_COUNT_EXPR} === 0`,
            { timeoutMs: 2000 },
          );

          // Brief settle pause for any pending React effects /
          // unregister cleanups to land.
          await pause(150);

          // Invariant: with deck-canvas still mounted as the
          // last-resort root responder, the chain MUST have a first
          // responder (deck-canvas) — even after a multi-tab close
          // cascade. Without this, the next dispatch silently no-ops
          // because `sendToFirstResponder` walks from `null`.
          const firstResponderAfterClose = await app.evalJS<string | null>(
            `(function(){
              var el = document.querySelector('[data-first-responder]');
              return el ? el.getAttribute('data-first-responder') : null;
            })()`,
          );
          expect(
            firstResponderAfterClose,
            "after close: first responder must fall back to deck-canvas, not null",
          ).toBe("deck-canvas");

          // Step 4: dispatch show-component-gallery again.
          await app.evalJS<void>(
            `window.__tug.dispatchControlAction("show-component-gallery")`,
          );

          // The bug: silent failure — no new gallery pane appears.
          // Wait up to 2s for a new gallery pane to materialize.
          await app.waitForCondition<boolean>(
            `${GALLERY_PANE_ID_EXPR} !== null`,
            { timeoutMs: 2000 },
          );

          const galleryPaneId2 = await app.evalJS<string | null>(
            GALLERY_PANE_ID_EXPR,
          );
          expect(
            galleryPaneId2,
            "second open: gallery pane must reappear after re-dispatch",
          ).not.toBeNull();
          expect(
            galleryPaneId2,
            "second open creates a new pane (different id from the closed one)",
          ).not.toBe(galleryPaneId1);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
