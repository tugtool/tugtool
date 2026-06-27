/**
 * at0197-deactivation-caret-no-wash.test.ts — a bare caret must NOT paint
 * an inactive-selection band when its card deactivates.
 *
 * ## The user-reported bug this gates
 *
 * Open two cards in two panes. Type `hello` into the first (caret left
 * at the end, nothing selected). Click the second card to deactivate the
 * first. Before the fix: a gray "selection wash" appeared behind `hello`
 * on the now-inactive card, even though no text was selected.
 *
 * ## Root cause
 *
 * `paintMirrorAsInactive` published the editor's selection to the
 * `inactive-selection` CSS Custom Highlight on deactivation — including a
 * COLLAPSED selection (a bare caret). A collapsed Range handed to a CSS
 * Custom Highlight does not render as nothing in WebKit; it paints a band
 * across the caret's text node. The `inactive-selection` highlight is
 * meant to carry *remembered selections* only — a caret is not one.
 *
 * ## The fix this test gates
 *
 * `paintMirrorAsInactive` publishes `null` (clears) for an empty
 * selection, so a card with no selection leaves the highlight empty and
 * paints no band. A real (non-empty) selection still paints — that path
 * is covered by at0023 / at0038.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import { mkTempTugbank, rmTempTugbank, seedTugbankForLaunch } from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SETTLE = 450;

const ROUTE = "❯";
const TYPED = "hello";

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-prompt-entry", title: "Prompt A", closable: true },
      { id: "B", componentId: "gallery-prompt-entry", title: "Prompt B", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 700, height: 520 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
      {
        id: "p2",
        position: { x: 780, y: 40 },
        size: { width: 700, height: 520 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

function emptyBag() {
  return {
    content: {
      currentRoute: ROUTE,
      perRoute: { [ROUTE]: { text: "", atoms: [], selection: null } },
      maximized: false,
    },
  };
}

/** Count of ranges in the `inactive-selection` CSS Custom Highlight whose
 *  start is inside card A. */
const HIGHLIGHT_RANGES_IN_A = `(function(){
  var cardA = document.querySelector('[data-card-id="A"]');
  if (!cardA || typeof CSS === "undefined" || !CSS.highlights) return -1;
  var hl = CSS.highlights.get("inactive-selection");
  if (!hl) return 0;
  var n = 0;
  hl.forEach(function(r){ if (cardA.contains(r.startContainer)) n++; });
  return n;
})()`;

describe.skipIf(!SHOULD_RUN)("deactivation: bare caret paints no inactive band", () => {
  test(
    "typing then deactivating leaves the inactive-selection highlight empty",
    async () => {
      const tugbankPath = mkTempTugbank();
      let app: App | null = null;
      try {
        seedTugbankForLaunch(tugbankPath);
        app = await launchTugApp({ env: { TUGBANK_PATH: tugbankPath } });

        await app.seedDeckState({
          state: deckShape(),
          cardStates: { A: emptyBag() },
          focusCardId: "A",
        });

        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
        );
        await app.waitForCondition<boolean>(
          `(function(){ return document.querySelector('[data-card-id="A"] .cm-content') !== null; })()`,
          { timeoutMs: 10000 },
        );
        await sleep(SETTLE);

        // Focus card A's editor and type — caret ends after the text,
        // nothing selected.
        await app.nativeClickAtElement(`[data-card-id="A"] .cm-content`);
        await sleep(SETTLE);
        await app.nativeType(TYPED);
        await sleep(SETTLE);
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector('[data-card-id="A"] .cm-content'); return el !== null && el.textContent.indexOf("${TYPED}") !== -1; })()`,
          { timeoutMs: 5000 },
        );

        // Deactivate A by clicking into card B (a separate pane).
        await app.nativeClickAtElement(`[data-card-id="B"] .cm-content`);
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "B")`,
          { timeoutMs: 2000 },
        );
        await sleep(SETTLE);

        const rangesInA = await app.evalJS<number>(HIGHLIGHT_RANGES_IN_A);
        expect(rangesInA).toBe(0);
      } finally {
        if (app) await app.quitGracefully().catch(() => {});
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
