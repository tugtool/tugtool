/**
 * at0051-tide-mount-focus.test.ts — when a tide card mounts as the
 * focused card and its session binds, the prompt-entry editor
 * (CodeMirror's contentDOM) gains DOM focus AND the custom caret
 * layer renders, all without a user click.
 *
 * Pins the integration contract for the focus-claim chain:
 *
 *   - Plan A (`tug-text-editor.tsx`): `focus()` delegate routes
 *     through `manager.focusResponder(responderId)` → atomic chain
 *     promotion + DOM focus.
 *   - `cardDidActivate` handler in `TideCardBody` calls
 *     `entryDelegate.focus()` on initial-sync via `useCardDelegate`.
 *   - `sheetDidHide` / `bannerDidHide` lifecycle handlers (per
 *     `lib/sheet-lifecycle.ts` + `lib/banner-lifecycle.ts`) re-claim
 *     editor focus when a sheet or banner finishes hiding (covers
 *     the case where a session-init banner mounts during the bind
 *     and clears inert on unmount).
 *
 * The earlier symptom this guards against: caret flashes and is
 * stolen as a banner mounts (sets `inert` on `.tug-pane-body`,
 * blurs the contentDOM), then the banner hides without anyone
 * re-focusing the editor. With the lifecycle plumbing in place,
 * `bannerDidHide` fires after the inert clears and `TideCardBody`'s
 * delegate handler claims focus through the chain.
 *
 * Test strategy: seed a tide card + bind a fake session, wait for
 * the editor to mount, capture focus + caret + chain state at
 * multiple timepoints. The harness skips the picker UI by binding
 * the session directly — the production picker has its own UI
 * surface that's awkward to drive in the harness, but the focus-
 * claim plumbing on the post-bind path is what matters here.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

// CodeMirror's editable surface is `.cm-content[contenteditable]`
// inside the `<div data-slot="tug-text-editor">` host. The custom
// caret is rendered by `tug-text-editor/caret-layer.ts` as
// `.tug-text-editor-caret`, which only paints when CM6's
// `view.hasFocus` is true (see `caret-layer.ts:181`). Asserting on
// the caret element existence is the user-visible test for "is the
// caret blinking?".
const PROMPT_INPUT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';

const TIDE_DECK_STATE = {
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
};

interface FocusState {
  matchesPromptEntry: boolean;
  underCardId: string | null;
  hasFocus: boolean;
  caretCount: number;
  cmFocused: boolean;
}

async function captureFocus(app: App, cardId: string): Promise<FocusState> {
  const promptSelector = `[data-card-id="${cardId}"] ${PROMPT_INPUT_SELECTOR}`;
  return app.evalJS<FocusState>(
    `(function(){
      var el = document.activeElement;
      var card = el && el.closest ? el.closest("[data-card-id]") : null;
      var matches = el !== null && el.matches ? el.matches(${JSON.stringify(promptSelector)}) : false;
      var carets = document.querySelectorAll(${JSON.stringify(`[data-card-id="${cardId}"] .tug-text-editor-caret`)});
      var cmEditor = document.querySelector(${JSON.stringify(`[data-card-id="${cardId}"] .cm-editor`)});
      return {
        matchesPromptEntry: matches,
        underCardId: card ? card.getAttribute("data-card-id") : null,
        hasFocus: document.hasFocus(),
        caretCount: carets.length,
        cmFocused: cmEditor !== null && cmEditor.classList.contains("cm-focused"),
      };
    })()`,
  );
}

async function waitForEditor(app: App, cardId: string): Promise<void> {
  // The 2-second waitForCondition cap is too short for the
  // seedDeckState → mount → bindTideSession → engine-construct
  // pipeline. Longer dwells sidestep the cap; the production
  // contract is "settles within a second or so" (these dwells are
  // for headroom in the harness, not real production timing).
  await new Promise<void>((r) => setTimeout(r, 1500));
  const dump = await app.evalJS<{
    hostRootRegistered: boolean;
    engineReady: boolean;
    contentPresent: boolean;
  }>(
    `(function(){
      var promptSel = '[data-card-id=${JSON.stringify(cardId).slice(1, -1)}] [data-slot="tug-text-editor"] .cm-content';
      return {
        hostRootRegistered: typeof window.__tug !== "undefined" && window.__tug.assertHostRootRegistered(${JSON.stringify(cardId)}),
        engineReady: typeof window.__tug !== "undefined" && window.__tug.isEngineReady(${JSON.stringify(cardId)}),
        contentPresent: document.querySelector(promptSel) !== null,
      };
    })()`,
  );
  expect(dump.hostRootRegistered, `host root not registered for ${cardId}; dump=${JSON.stringify(dump)}`).toBe(true);
  expect(dump.engineReady, `engine not ready for ${cardId}; dump=${JSON.stringify(dump)}`).toBe(true);
  expect(dump.contentPresent, `editor contentDOM missing for ${cardId}; dump=${JSON.stringify(dump)}`).toBe(true);
}

describe.skipIf(!SHOULD_RUN)(
  "at0051: tide card mount-time focus + caret claim",
  () => {
    test(
      "after seed + bind: editor's contentDOM is activeElement, .cm-focused is set, exactly one caret renders",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);

          const app = await launchTugApp({
            testName: "at0051-tide-mount-focus",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({ state: TIDE_DECK_STATE, focusCardId: "A" });
            await new Promise<void>((r) => setTimeout(r, 1500));
            await app.bindTideSession("A");
            await waitForEditor(app, "A");

            // Probe focus state at multiple timepoints. Settling
            // window covers any late session-init banner activity
            // that previously stole focus from the editor.
            const t0 = await captureFocus(app, "A");
            await new Promise<void>((r) => setTimeout(r, 1000));
            const t1000 = await captureFocus(app, "A");

            // The user-visible contract: caret renders on the
            // editor for cardId "A", and stays there.
            expect(
              t1000.matchesPromptEntry,
              `expected editor contentDOM activeElement at t+1s; saw ${JSON.stringify(t1000)}`,
            ).toBe(true);
            expect(t1000.underCardId).toBe("A");
            expect(t1000.hasFocus, "expected document.hasFocus()").toBe(true);
            expect(
              t1000.cmFocused,
              `expected .cm-focused on .cm-editor (CM6 view.hasFocus=true); saw ${JSON.stringify(t1000)}`,
            ).toBe(true);
            expect(
              t1000.caretCount,
              `expected exactly one caret element rendered; saw ${JSON.stringify(t1000)}`,
            ).toBe(1);

            // Also ensure the caret didn't appear-then-disappear:
            // both timepoints should agree.
            expect(
              t0.caretCount,
              `expected caret rendered at t+0 too; saw t0=${JSON.stringify(t0)} t1000=${JSON.stringify(t1000)}`,
            ).toBe(1);
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
