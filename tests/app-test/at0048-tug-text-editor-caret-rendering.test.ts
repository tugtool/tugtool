/**
 * at0048-tug-text-editor-caret-rendering.test.ts — Step 9.6 caret-layer
 * smoke test. Asserts the CM6-owned caret renders as exactly one
 * DOM node with line-height-derived geometry across the four
 * canonical doc shapes.
 *
 * What this guards against:
 *
 *   - The custom caret layer regressing to zero markers (no caret
 *     visible) or two markers (a leftover from a previous
 *     transition).
 *   - The caret height drifting away from the row-box. The
 *     `.cm-line::before` ghost in `theme.ts` pins each row to
 *     `max(1lh, atom-height)` (24.5px at the default 14px font /
 *     1.75 line-height); `caret-layer.ts` paints the caret at
 *     90% of that row height (`CARET_HEIGHT_FACTOR`), so the
 *     expected stroke is ~22.05px. A regression to glyph-rect
 *     height (`coordsAtPos(head).bottom - .top`) would show up
 *     as ~14-18px; a regression to full row height would show
 *     up as ~24.5px.
 *   - Step 9.5C requirement: caret visible at offset 0 on a
 *     leading-atom doc. The previous native-caret implementation
 *     left the caret invisible there because WebKit's
 *     contentEditable caret has nowhere to render to the left of
 *     a Decoration.replace at offset 0; the layer paints outside
 *     the inline-replaced widget hierarchy so it's unconstrained.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
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
const FILE_ATOM_BUTTON_SELECTOR =
  '[data-card-id="A"] .gallery-text-editor-atom-row [data-slot="tug-push-button"]:nth-of-type(1)';
const CARET_SELECTOR = '[data-card-id="A"] .tug-text-editor-caret';

/**
 * Expected caret height — `.cm-line::before` ghost pins the row to
 * `max(1lh, atom-height)` = `max(24.5px, 21px)` = 24.5px at the
 * default 14px font / 1.75 line-height; the caret is 90% of that
 * (`CARET_HEIGHT_FACTOR` in `caret-layer.ts`).
 */
const EXPECTED_CARET_HEIGHT_PX = 24.5 * 0.9;
/**
 * Pixel tolerance. Sub-pixel layout under WebKit can produce
 * 22.0 / 22.05 / 22.1 depending on rasterization, plus the 90%
 * factor multiplies any 1-px row-height jitter into ~0.9-px caret
 * jitter. ±1.5px is safe.
 */
const HEIGHT_TOLERANCE_PX = 1.5;

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

interface CaretProbe {
  count: number;
  height: number | null;
  width: number | null;
}

async function caretProbe(app: App): Promise<CaretProbe> {
  return app.evalJS<CaretProbe>(
    `(function(){
      var nodes = document.querySelectorAll(${JSON.stringify(CARET_SELECTOR)});
      if (nodes.length === 0) return { count: 0, height: null, width: null };
      var first = nodes[0];
      var rect = first.getBoundingClientRect();
      return { count: nodes.length, height: rect.height, width: rect.width };
    })()`,
  );
}

async function refocusEditor(app: App): Promise<void> {
  const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;
  await app.nativeClickAtElement(editorSelector);
  await new Promise((r) => setTimeout(r, 150));
}

/** Insert a "file" atom via the gallery's atom-row button. Re-focuses afterwards. */
async function insertFileAtom(app: App): Promise<void> {
  await app.nativeClickAtElement(FILE_ATOM_BUTTON_SELECTOR);
  await refocusEditor(app);
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length >= 1`,
    { timeoutMs: 2000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "m48: tug-text-editor caret rendering across doc shapes",
  () => {
    test(
      "single .tug-text-editor-caret with line-box height across empty/text/atom/mixed",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m48-tug-text-editor-caret-rendering",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);

            // ---------------------------------------------------------
            // Empty doc, caret at 0
            // ---------------------------------------------------------
            await new Promise((r) => setTimeout(r, 200));
            const empty = await caretProbe(app);
            expect(empty.count, "empty doc: exactly one caret").toBe(1);
            expect(empty.width, "empty doc: caret width = 2px").toBe(2);
            expect(
              Math.abs((empty.height ?? 0) - EXPECTED_CARET_HEIGHT_PX),
              "empty doc: caret height ≈ 90% of 1.75em",
            ).toBeLessThan(HEIGHT_TOLERANCE_PX);

            // ---------------------------------------------------------
            // Text-only doc, caret at end
            // ---------------------------------------------------------
            await app.nativeType("abc");
            await new Promise((r) => setTimeout(r, 200));
            const textOnly = await caretProbe(app);
            expect(textOnly.count, "text-only: exactly one caret").toBe(1);
            expect(
              Math.abs((textOnly.height ?? 0) - EXPECTED_CARET_HEIGHT_PX),
              "text-only: caret height ≈ 90% of 1.75em",
            ).toBeLessThan(HEIGHT_TOLERANCE_PX);

            // Clear back to empty.
            await app.nativeKey("a", ["cmd"]);
            await new Promise((r) => setTimeout(r, 100));
            await app.nativeKey("Delete");
            await new Promise((r) => setTimeout(r, 200));

            // ---------------------------------------------------------
            // Atom-only doc, caret BEFORE atom (Step 9.5C requirement)
            // ---------------------------------------------------------
            await insertFileAtom(app);
            await new Promise((r) => setTimeout(r, 200));
            // Caret lands AFTER the atom by default; move to start.
            await app.nativeKey("Home");
            await new Promise((r) => setTimeout(r, 150));
            const beforeAtom = await caretProbe(app);
            expect(beforeAtom.count, "atom-only, caret before atom: exactly one caret").toBe(1);
            expect(
              Math.abs((beforeAtom.height ?? 0) - EXPECTED_CARET_HEIGHT_PX),
              "atom-only, caret before atom: caret height ≈ 90% of 1.75em (Step 9.5C)",
            ).toBeLessThan(HEIGHT_TOLERANCE_PX);

            // ---------------------------------------------------------
            // Atom-only doc, caret AFTER atom
            // ---------------------------------------------------------
            await app.nativeKey("End");
            await new Promise((r) => setTimeout(r, 150));
            const afterAtom = await caretProbe(app);
            expect(afterAtom.count, "atom-only, caret after atom: exactly one caret").toBe(1);
            expect(
              Math.abs((afterAtom.height ?? 0) - EXPECTED_CARET_HEIGHT_PX),
              "atom-only, caret after atom: caret height ≈ 90% of 1.75em",
            ).toBeLessThan(HEIGHT_TOLERANCE_PX);

            // ---------------------------------------------------------
            // Mixed doc, caret between text and atom.
            // Type "ab", we already have an atom, so doc is "ab\u{FFFC}".
            // ---------------------------------------------------------
            await app.nativeType("ab");
            await new Promise((r) => setTimeout(r, 200));
            const mixed = await caretProbe(app);
            expect(mixed.count, "mixed doc: exactly one caret").toBe(1);
            expect(
              Math.abs((mixed.height ?? 0) - EXPECTED_CARET_HEIGHT_PX),
              "mixed doc: caret height ≈ 90% of 1.75em",
            ).toBeLessThan(HEIGHT_TOLERANCE_PX);
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
