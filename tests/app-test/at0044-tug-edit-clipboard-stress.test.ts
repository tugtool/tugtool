/**
 * at0044-tug-edit-clipboard-stress.test.ts — multi-step clipboard
 * round-trip + undo for tug-edit atoms.
 *
 * ## Why this exists
 *
 * Step 9.5B's at0043 only verified a *single* copy → paste round trip
 * for an atom-only payload. The user's manual checkpoint surfaced
 * additional failure modes:
 *
 *   1. Copying and pasting in succession (across multiple paste sites
 *      or multiple iterations) loses atom content.
 *   2. Undo after a cut/paste fails to restore atom decorations —
 *      the U+FFFC document text comes back, but the widget does not.
 *
 * Both of these slip past at0043 because it only exercises the
 * happy-path single round-trip. This test drives the gallery through
 * the multi-step scenarios so a regression here is caught before the
 * user sees it again.
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

const TUG_EDIT_CONTENT_SELECTOR = '[data-slot="tug-edit"] .cm-content';
const GALLERY_FILE_ATOM_BUTTON_SELECTOR =
  '[data-card-id="A"] .gallery-text-edit-atom-row [data-slot="tug-push-button"]:nth-of-type(1)';
const FILE_ATOM_LABEL = "main.ts";

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-text-edit", title: "TugEdit A", closable: true },
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

async function clearEditor(app: App): Promise<void> {
  await app.nativeKey("a", ["cmd"]);
  await app.nativeKey("Delete");
  await app.waitForCondition<boolean>(
    `(function(){
      var ed = document.querySelector('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}');
      if (ed === null) return false;
      return ed.querySelectorAll('img[data-atom-label]').length === 0
        && ed.textContent.length === 0;
    })()`,
    { timeoutMs: 2000 },
  );
}

/** Insert a "file" atom via the gallery's atom-row button. Re-focuses the editor afterwards. */
async function insertFileAtom(app: App): Promise<void> {
  const before = await app.evalJS<number>(
    `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length`,
  );
  await app.nativeClickAtElement(GALLERY_FILE_ATOM_BUTTON_SELECTOR);
  await app.nativeClickAtElement(`[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`);
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length === ${before + 1}`,
    { timeoutMs: 2000 },
  );
}

/** Read the live atom widget count from the editor DOM. */
async function atomCount(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "m44: tug-edit clipboard stress — repeated paste, undo",
  () => {
    test(
      "select-all + copy + paste twice produces three atom widgets in succession",
      async () => {
        // User's report: "Copying and pasting multiple times in
        // succession loses atom content."
        //
        // Repro: insert atom (1 widget), Cmd+A select all, Cmd+C
        // copy, move caret to end (Right), Cmd+V paste (now 2),
        // Right, Cmd+V again (now 3). Each paste should produce a
        // fresh atom widget. If the html-channel paste loses
        // decorations on the second invocation, the count plateaus.
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m44-clipboard-stress-paste-twice",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);
            await insertFileAtom(app);
            expect(await atomCount(app), "after insert: one atom").toBe(1);

            // Select the atom, copy.
            await app.nativeKey("a", ["cmd"]);
            await app.nativeKey("c", ["cmd"]);

            // Move caret to end (collapse selection right), paste.
            await app.nativeKey("ArrowRight");
            await app.nativeKey("v", ["cmd"]);
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length === 2`,
              { timeoutMs: 4000 },
            );
            expect(await atomCount(app), "after first paste: two atoms").toBe(2);

            // Move caret to end again, paste again.
            await app.nativeKey("ArrowRight");
            await app.nativeKey("v", ["cmd"]);
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length === 3`,
              { timeoutMs: 4000 },
            );
            expect(await atomCount(app), "after second paste: three atoms").toBe(3);
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
      "undo after cut restores the atom widget",
      async () => {
        // User's report: "Undo fails to restore atoms."
        //
        // Repro: insert atom (1 widget), select it, Cmd+X cut (0
        // widgets), Cmd+Z undo. Expectation: 1 widget again. The CM6
        // history's invertedEffects facet is what makes
        // decoration-field state survive an undo of changes that
        // mapped the decoration through deletion.
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m44-clipboard-stress-undo-cut",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);
            await insertFileAtom(app);
            expect(await atomCount(app), "after insert: one atom").toBe(1);

            await app.nativeKey("a", ["cmd"]);
            await app.nativeKey("x", ["cmd"]);
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length === 0`,
              { timeoutMs: 2000 },
            );
            expect(await atomCount(app), "after cut: no atoms").toBe(0);

            await app.nativeKey("z", ["cmd"]);
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length === 1`,
              { timeoutMs: 2000 },
            );
            const restoredLabel = await app.evalJS<string | null>(
              `(function(){
                var img = document.querySelector('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]');
                return img === null ? null : img.getAttribute('data-atom-label');
              })()`,
            );
            expect(restoredLabel, "after undo: atom widget restored with original label")
              .toBe(FILE_ATOM_LABEL);
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
      "undo after paste removes the pasted atom widget",
      async () => {
        // Symmetry test: paste adds atoms via addAtomsEffect; undo
        // should remove them. CM6 history undoes `tr.changes` (the
        // doc text returns) but our atom-decoration field's added
        // decorations need an inverted effect registered via
        // `invertedEffects` to be undone too. If the inverted effect
        // is missing, after undo we'd see U+FFFC text without an
        // atom widget — invisible characters that re-render on next
        // paste / theme regen and confuse the user.
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m44-clipboard-stress-undo-paste",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);
            await insertFileAtom(app);
            await app.nativeKey("a", ["cmd"]);
            await app.nativeKey("c", ["cmd"]);
            await app.nativeKey("ArrowRight");
            await app.nativeKey("v", ["cmd"]);
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length === 2`,
              { timeoutMs: 4000 },
            );
            // Undo the paste — back to one atom.
            await app.nativeKey("z", ["cmd"]);
            await app.waitForCondition<boolean>(
              `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length === 1`,
              { timeoutMs: 2000 },
            );
            // Cross-check: doc text length matches widget count
            // (one U+FFFC per atom — no orphan tofu glyphs).
            const docLen = await app.evalJS<number>(
              `(function(){
                var s = window.__tug.getEmCardState("A");
                return s ? s.text.length : -1;
              })()`,
            );
            expect(docLen, "after undo: doc length matches one-atom state").toBe(1);
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
