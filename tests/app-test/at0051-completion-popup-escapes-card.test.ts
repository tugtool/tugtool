/**
 * at0051-completion-popup-escapes-card.test.ts —
 * Regression guard for the canvas-overlay tier (`tugplan-tide-overlay-tier`).
 *
 * ## Phases
 *
 * The file lands in two phases. Step 0 (this commit) is the [Q01] spike:
 * confirm that a `pointerdown` + `preventDefault()` on a *portaled* element
 * (a sibling of, not a descendant of, the editor's DOM subtree) keeps the
 * editor as `document.activeElement`. That is the load-bearing assumption
 * for migrating the completion popup off the editor host onto the
 * canvas-level overlay tier — if focus is lost on click-to-accept, the
 * accept transaction lands on a stale caret. Step 1 grows the same file
 * with the popup-escapes-card layout assertion and the resize-re-anchor
 * assertion.
 *
 * ## Why this exists (Step 0 scope)
 *
 * Today the completion popup lives inside the editor's host `<div>`. The
 * per-item `pointerdown` handler calls `e.preventDefault()` to suppress
 * the browser's default focus shift, then dispatches `acceptCompletionAt`.
 * The editor stays focused; the accept transaction lands on the live
 * caret. This works because the popup is a descendant of the editor — the
 * `pointerdown` originates in the same DOM subtree.
 *
 * After the migration, the popup will be portaled to a canvas-level
 * overlay root that is a *sibling* of the pane tree (not a descendant of
 * the editor). Focus retention across that detachment is the question.
 * WebKit and Chromium both document the `preventDefault()` behavior as
 * element-agnostic, but the contract has been observed to fail in nested
 * portal cases with focus traps. This spike falsifies (or confirms) the
 * assumption against the actual Tug.app shell.
 *
 * ## What the spike does
 *
 *   1. Mounts a `gallery-text-editor` card so a real `EditorView` exists
 *      with a real `.cm-content` contentDOM.
 *   2. Focuses the editor; types `abc` so the doc has content.
 *   3. Injects a sibling-portaled `<div>` directly into `document.body`
 *      with a clickable `<button>` inside. The button's `pointerdown`
 *      handler calls `e.preventDefault()` — the same trick the
 *      completion popup will use post-migration.
 *   4. Issues a real OS-level `nativeClickAtElement` on the injected
 *      button. (`nativeClick` triggers the browser's native focus shift;
 *      programmatic `dispatchEvent` does not, so it cannot test this.)
 *   5. Asserts `document.activeElement` is still the editor's `.cm-content`,
 *      and the editor's first-responder tag is still `tug-text-editor`.
 *   6. Cleans up the injected DOM.
 *
 * If the test passes, [Q01]'s [D08] resolution is option (c) — the
 * existing direct-call `pointerdown` path survives detachment unmodified.
 * Step 1's migration is a one-pointerdown swap.
 *
 * If the test fails, [D08] resolves to option (a) — Step 1 must mirror
 * the editor's `data-responder-id` on the portal-root div so the
 * responder-chain walk-up still resolves the editor.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const TUG_EDIT_CONTENT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';
const SPIKE_BUTTON_SELECTOR = '[data-testid="overlay-tier-spike-button"]';

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-text-editor", title: "TugTextEditor A", closable: true },
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
}

async function setupGallery(app: App): Promise<void> {
  await app.enableDeckTrace(true);
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {},
    focusCardId: "A",
  });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.awaitEngineReady("A");
  const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;
  await app.nativeClickAtElement(editorSelector);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelector)})`,
    { timeoutMs: 2000 },
  );
}

interface FocusProbe {
  /** True iff `document.activeElement` matches the cm-content selector. */
  editorIsActive: boolean;
  /** Tag of the data-first-responder element, or "(none)". */
  firstResponderTag: string;
  /** Whether the synthetic preventDefault listener observed the click. */
  preventDefaultFired: boolean;
}

async function probeFocus(app: App): Promise<FocusProbe> {
  return app.evalJS<FocusProbe>(
    `(function(){
      var ae = document.activeElement;
      var editorMatch = ae !== null && ae.matches(${JSON.stringify(
        TUG_EDIT_CONTENT_SELECTOR,
      )});
      var fr = document.querySelector("[data-first-responder]");
      var frTag = "(none)";
      if (fr) {
        var slot = fr.getAttribute("data-slot") || "";
        var rid = fr.getAttribute("data-responder-id") || "";
        frTag = fr.tagName + (slot ? "." + slot : "") + " (id=" + rid + ")";
      }
      return {
        editorIsActive: editorMatch,
        firstResponderTag: frTag,
        preventDefaultFired: window.__overlayTierSpikePDFired === true,
      };
    })()`,
  );
}

/**
 * Inject a sibling-portaled <div> into document.body with a button
 * that runs e.preventDefault() in its pointerdown handler. Returns
 * once the DOM is in place. The container is also a top-level child
 * of <body>, mimicking the canvas-overlay-root's mount target ([D02]
 * body-fallback).
 */
async function injectSpikeOverlay(app: App): Promise<void> {
  await app.evalJS<void>(
    `(function(){
      // Reset the marker for repeated runs.
      window.__overlayTierSpikePDFired = false;

      var existing = document.getElementById("overlay-tier-spike-root");
      if (existing) existing.remove();

      var root = document.createElement("div");
      root.id = "overlay-tier-spike-root";
      // Mimic the planned canvas-overlay-root contract: position-fixed,
      // viewport-filling, pointer-events: none on the root, auto on the
      // child. Anchor near the bottom-right so it does not overlap the
      // editor's contentDOM (avoids accidentally clicking the editor).
      root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9000;";

      var btn = document.createElement("button");
      btn.setAttribute("data-testid", "overlay-tier-spike-button");
      btn.textContent = "spike";
      btn.style.cssText =
        "position:fixed;right:24px;bottom:24px;width:120px;height:40px;" +
        "pointer-events:auto;background:#444;color:#fff;border:1px solid #888;";
      btn.addEventListener("pointerdown", function (e) {
        // The exact trick the completion popup uses post-migration:
        // suppress the browser's default focus shift so the editor
        // stays first responder. Mark a global so the test can verify
        // the listener actually fired (catches the case where the
        // click missed the button entirely).
        e.preventDefault();
        window.__overlayTierSpikePDFired = true;
      });

      root.appendChild(btn);
      document.body.appendChild(root);
    })()`,
  );
}

async function removeSpikeOverlay(app: App): Promise<void> {
  await app.evalJS<void>(
    `(function(){
      var el = document.getElementById("overlay-tier-spike-root");
      if (el) el.remove();
      delete window.__overlayTierSpikePDFired;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0051: completion popup escapes card (Step 0 — pointerdown focus retention spike)",
  () => {
    test(
      "click on a portaled element with pointerdown+preventDefault keeps the editor focused",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0051-pointerdown-focus-retention-spike",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            // Type some text. This both verifies the editor accepts
            // input (sanity) and lets a follow-up assertion check the
            // selection is unchanged after the spike click.
            await app.nativeType("abc");
            await new Promise((r) => setTimeout(r, 200));

            const baseline = await probeFocus(app);
            expect(
              baseline.editorIsActive,
              "baseline: editor's contentDOM is the activeElement",
            ).toBe(true);
            expect(
              baseline.firstResponderTag,
              "baseline: first responder is the tug-text-editor host",
            ).toContain("tug-text-editor");

            // Inject the portaled overlay button. This is the
            // sibling-of-editor portaled element the popup will
            // become post-migration.
            await injectSpikeOverlay(app);

            // Click it. Real OS-level click — the only way to trigger
            // the browser's native focus shift that preventDefault is
            // designed to suppress.
            await app.nativeClickAtElement(SPIKE_BUTTON_SELECTOR);
            await new Promise((r) => setTimeout(r, 250));

            const afterClick = await probeFocus(app);
            expect(
              afterClick.preventDefaultFired,
              "spike button's pointerdown listener actually fired",
            ).toBe(true);
            expect(
              afterClick.editorIsActive,
              "[Q01] / [D08] gate: editor's contentDOM MUST still be the activeElement",
            ).toBe(true);
            expect(
              afterClick.firstResponderTag,
              "first responder MUST still be the tug-text-editor host",
            ).toContain("tug-text-editor");
          } finally {
            await removeSpikeOverlay(app);
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
