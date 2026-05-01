/**
 * at0051-completion-popup-escapes-card.test.ts —
 * Regression guard for the canvas-overlay tier (`tugplan-tide-overlay-tier`).
 *
 * The file covers the load-bearing properties of the canvas-overlay
 * migration end-to-end against Tug.app on macOS / WebKit:
 *
 *   1. **Pointerdown focus retention across portal detach** — the
 *      [Q01] spike. Synthetic portaled element + `pointerdown` +
 *      `preventDefault()` keeps the editor as `document.activeElement`.
 *      Resolves [D08] to option (c).
 *
 *   2. **Structural placement** — after mount, `<CanvasOverlayRoot />`
 *      exists, the completion menu is portaled into it, and is NOT a
 *      descendant of `[data-slot="tug-text-editor"]`. This is the
 *      migration's central invariant: the popup belongs to the canvas,
 *      not the card.
 *
 *   3. **Live click-to-accept** — open `/` typeahead, click an item,
 *      assert focus retained AND the doc gained a U+FFFC atom. Validates
 *      the production code path (vs. the synthetic spike in #1).
 *
 *   4. **Resize re-anchor** — open `/` typeahead, capture popup top,
 *      shrink the editor host's bounds, wait for the ResizeObserver in
 *      `CompletionOverlay` to fire, capture the new popup top. Asserts
 *      the popup re-anchored. Catches the sash-drag regression that
 *      would land if the painter relied on window-scroll/resize alone.
 *
 * The tests use `gallery-text-editor` because its `/` provider is
 * pre-populated by `system-metadata-fixture` from a captured JSONL,
 * yielding deterministic items even under app-test launch (the live
 * `@`-trigger file-tree provider depends on a bound workspace).
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

// ---------------------------------------------------------------------------
// Helpers — typeahead trigger + popup readout
// ---------------------------------------------------------------------------

const COMPLETION_MENU_SELECTOR = '[data-slot="tug-completion-menu"]';
const CANVAS_OVERLAY_ROOT_SELECTOR = '[data-slot="tug-canvas-overlay-root"]';
const EDITOR_HOST_SELECTOR = '[data-slot="tug-text-editor"]';

interface PopupSnapshot {
  /** True iff the popup `<div>` exists somewhere in the document. */
  exists: boolean;
  /** True iff the popup is a child (or descendant) of the canvas overlay root. */
  inOverlayRoot: boolean;
  /** True iff the popup is a descendant of the editor host. */
  inEditorHost: boolean;
  /** Computed CSS `display` (e.g., "none" or "block"). */
  display: string;
  /** Bounding rect at the moment of the call. Empty zeros when not visible. */
  rect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  /** Number of `.tug-completion-menu-item` children. */
  itemCount: number;
  /** Whether <CanvasOverlayRoot /> is mounted. */
  overlayRootExists: boolean;
}

async function readPopup(app: App): Promise<PopupSnapshot> {
  return app.evalJS<PopupSnapshot>(
    `(function(){
      var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      var overlayRoot = document.querySelector(${JSON.stringify(CANVAS_OVERLAY_ROOT_SELECTOR)});
      var host = document.querySelector(${JSON.stringify(EDITOR_HOST_SELECTOR)});
      if (!popup) {
        return {
          exists: false,
          inOverlayRoot: false,
          inEditorHost: false,
          display: "",
          rect: { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 },
          itemCount: 0,
          overlayRootExists: !!overlayRoot,
        };
      }
      var inOverlayRoot = !!(overlayRoot && overlayRoot.contains(popup));
      var inEditorHost = !!(host && host.contains(popup));
      var rect = popup.getBoundingClientRect();
      var items = popup.querySelectorAll(".tug-completion-menu-item");
      return {
        exists: true,
        inOverlayRoot: inOverlayRoot,
        inEditorHost: inEditorHost,
        display: popup.style.display || getComputedStyle(popup).display,
        rect: {
          top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height,
        },
        itemCount: items.length,
        overlayRootExists: !!overlayRoot,
      };
    })()`,
  );
}

/**
 * Wait for the popup to be visible (display: block) with at least one
 * item. Pollable; returns once the condition holds, throws on timeout.
 */
async function waitForPopupVisible(app: App, timeoutMs = 4000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
      if (!popup) return false;
      var display = popup.style.display || getComputedStyle(popup).display;
      var items = popup.querySelectorAll(".tug-completion-menu-item");
      return display === "block" && items.length > 0;
    })()`,
    { timeoutMs },
  );
}

interface DocProbe {
  text: string;
  length: number;
}

async function probeDoc(app: App): Promise<DocProbe> {
  return app.evalJS<DocProbe>(
    `(function(){
      var s = window.__tug.getEmCardState("A");
      var t = (s && typeof s.text === "string") ? s.text : "";
      return { text: t, length: t.length };
    })()`,
  );
}

/**
 * Resize the editor's host element by writing inline padding-top
 * to the substrate's host wrapper. Padding-top:
 *   1. Increases the wrappers bounding-rect height — this is the
 *      change ResizeObserver actually fires on (size change, not
 *      position change).
 *   2. Pushes the editor contentDOM downward, so the trigger
 *      characters viewport coords move and coordsAtPos(anchorOffset)
 *      returns a different rect.
 *
 * Margin-top alone moves the host but does not change its size, so
 * ResizeObserver would not fire. Padding-top covers both axes.
 *
 * Inline-style writes survive React reconciliation because the
 * gallery wrapper never re-renders in response to ResizeObserver
 * events — its tree is static across the lifetime of the test.
 */
async function shrinkEditorHost(app: App): Promise<void> {
  await app.evalJS<void>(
    `(function(){
      var wrap = document.querySelector(".gallery-text-editor-host");
      if (!wrap) throw new Error("gallery-text-editor-host not found");
      wrap.setAttribute("data-original-style", wrap.getAttribute("style") || "");
      // Padding-top pushes contentDOM downward, but flex-bounded
      // children keep the same height — ResizeObserver only fires
      // on SIZE changes, not POSITION changes. We also shrink the
      // wrapper width by writing an explicit max-width: this
      // narrows the substrate host (a flex child filling the wrapper),
      // and that bounding-rect width change is what triggers
      // ResizeObserver to fire and the painter to re-run.
      wrap.style.paddingTop = "80px";
      wrap.style.maxWidth = "400px";
    })()`,
  );
}

async function restoreEditorHost(app: App): Promise<void> {
  await app.evalJS<void>(
    `(function(){
      var wrap = document.querySelector(".gallery-text-editor-host");
      if (wrap instanceof HTMLElement) {
        var orig = wrap.getAttribute("data-original-style");
        if (orig !== null) {
          wrap.setAttribute("style", orig);
          wrap.removeAttribute("data-original-style");
        } else {
          wrap.removeAttribute("style");
        }
      }
    })()`,
  );
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)(
  "at0051: completion popup escapes card (canvas-overlay tier regression guard)",
  () => {
    test(
      "Q01 / D08: pointerdown+preventDefault on a portaled element keeps the editor focused",
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
            // sibling-of-editor portaled element the popup is
            // post-migration.
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

    test(
      "structural: popup mounts inside <CanvasOverlayRoot />, not inside the editor host",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0051-structural-placement",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            const popup = await readPopup(app);
            expect(popup.exists, "popup div exists in the document").toBe(true);
            expect(
              popup.overlayRootExists,
              "<CanvasOverlayRoot /> is mounted inside DeckCanvas",
            ).toBe(true);
            expect(
              popup.inOverlayRoot,
              "popup is portaled inside <CanvasOverlayRoot />",
            ).toBe(true);
            expect(
              popup.inEditorHost,
              "popup is NOT a descendant of [data-slot=\"tug-text-editor\"] (the migration's central invariant)",
            ).toBe(false);
            expect(
              popup.display,
              "popup is hidden until typeahead activates",
            ).toBe("none");
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "live click-to-accept: editor focus retained, atom inserted into doc",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0051-live-click-to-accept",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            // Trigger `/` completion. The fixture-backed provider
            // returns real items from the captured system-metadata
            // JSONL, so the popup populates deterministically.
            await app.nativeType("/");
            await waitForPopupVisible(app);

            const beforeClick = await readPopup(app);
            expect(beforeClick.itemCount, "popup has at least one item").toBeGreaterThan(0);
            expect(beforeClick.display, "popup is visible").toBe("block");

            const docBefore = await probeDoc(app);

            // Click the first item.
            await app.nativeClickAtElement(
              `${COMPLETION_MENU_SELECTOR} .tug-completion-menu-item:first-child`,
            );
            await new Promise((r) => setTimeout(r, 300));

            const focus = await probeFocus(app);
            expect(
              focus.editorIsActive,
              "click-to-accept: editor's contentDOM is still activeElement",
            ).toBe(true);
            expect(
              focus.firstResponderTag,
              "click-to-accept: first responder is still tug-text-editor",
            ).toContain("tug-text-editor");

            const docAfter = await probeDoc(app);
            // The accept transaction replaces the trigger char + query
            // range with U+FFFC. The doc went from `/` (length 1) to
            // a single U+FFFC (length 1) — same length, different
            // content. Or the user typed nothing else, so the doc is
            // exactly U+FFFC.
            expect(
              docAfter.text.includes("￼"),
              "doc contains the inserted atom (U+FFFC)",
            ).toBe(true);
            // The popup hides after accept.
            const after = await readPopup(app);
            expect(after.display, "popup hides after accept").toBe("none");
            // Surface unused `docBefore` to keep lint quiet — we keep
            // the read for diagnostic clarity if the assertion fails.
            void docBefore;
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "resize re-anchor: shrinking the editor host repaints the popup at the new viewport coords",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "at0051-resize-re-anchor",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            // Open `/` typeahead and capture the initial popup top.
            await app.nativeType("/");
            await waitForPopupVisible(app);
            const initial = await readPopup(app);
            expect(initial.exists).toBe(true);
            expect(initial.display).toBe("block");
            const initialTop = initial.rect.top;

            // Resize the editor host. The wrapper gains padding-top
            // (which pushes the contentDOM downward, so the trigger
            // characters viewport coords change) AND a smaller
            // max-width (which shrinks the substrate hosts flex-bounded
            // width — ResizeObserver only fires on SIZE changes,
            // never on position changes, so the width delta is what
            // triggers the observer to fire and the painter to re-run).
            await shrinkEditorHost(app);

            // Poll for the re-anchor. ResizeObserver delivers via
            // the browsers microtask queue; CM6's measure phase
            // runs on the next animation frame. Typically settled
            // within a few hundred ms; the 3s budget is comfortably
            // above WebKits worst-case deferral.
            await app.waitForCondition<boolean>(
              `(function(){
                var popup = document.querySelector(${JSON.stringify(COMPLETION_MENU_SELECTOR)});
                if (!popup) return false;
                var rect = popup.getBoundingClientRect();
                return Math.abs(rect.top - ${initialTop}) > 1;
              })()`,
              { timeoutMs: 3000 },
            );

            const afterShrink = await readPopup(app);
            expect(
              Math.abs(afterShrink.rect.top - initialTop),
              "popup re-anchored after host bounds change (sash-drag regression guard)",
            ).toBeGreaterThan(1);
          } finally {
            await restoreEditorHost(app);
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
