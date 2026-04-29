/**
 * at0049-tug-text-editor-no-doubled-caret.test.ts — Step 9.6 regression
 * guard. Verifies that each layout-shifting transition that
 * historically left WebKit's contentEditable caret cache stale (and
 * which the three deleted hacks once papered over) leaves exactly
 * one caret element when the CM6-owned caret layer is in place.
 *
 * Transitions covered:
 *
 *   1. Atom removal via backspace — was patched by
 *      `atomCaretRefreshPlugin` (commit 8c5ce8bc, reverted at
 *      d383a036). The reversion immediately reproduced the
 *      doubled-caret symptom; this test guards the now-fixed
 *      version.
 *   2. Ranged delete crossing atoms — same root-cause class as #1.
 *   3. Undo of a cut that removed an atom — atom widget reappears
 *      via `atomInvertedEffects`. Layout shift from no-widget to
 *      widget.
 *   4. Paste over a ranged selection — replaces the range with new
 *      content; layout shift.
 *   5. Typeahead deactivate (Esc) — was patched by
 *      `scheduleCaretRefresh` (commit e4ddd7e3). Popup paint sat
 *      on top of the surface; closing it left the cache stale.
 *
 * Each transition is sandwiched between settling delays. The OS
 * shortcut sensitivity reported in the deleted at0047 (emoji
 * picker / dictation triggered by rapid event firing) is avoided
 * here by inserting 200ms+ pauses between each significant input.
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
const TEST_TIMEOUT_MS = 120_000;

const TUG_EDIT_CONTENT_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';
const FILE_ATOM_BUTTON_SELECTOR =
  '[data-card-id="A"] .gallery-text-editor-atom-row [data-slot="tug-push-button"]:nth-of-type(1)';
const CARET_SELECTOR = '[data-card-id="A"] .tug-text-editor-caret';

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

async function caretCount(app: App): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll(${JSON.stringify(CARET_SELECTOR)}).length`,
  );
}

async function refocusEditor(app: App): Promise<void> {
  const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;
  await app.nativeClickAtElement(editorSelector);
  await new Promise((r) => setTimeout(r, 150));
}

/** Insert a "file" atom via the gallery's atom-row button. */
async function insertFileAtom(app: App): Promise<void> {
  const before = await app.evalJS<number>(
    `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length`,
  );
  await app.nativeClickAtElement(FILE_ATOM_BUTTON_SELECTOR);
  await refocusEditor(app);
  await app.waitForCondition<boolean>(
    `document.querySelectorAll('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR} img[data-atom-label]').length === ${before + 1}`,
    { timeoutMs: 2000 },
  );
}

async function clearEditor(app: App): Promise<void> {
  await app.nativeKey("a", ["cmd"]);
  await new Promise((r) => setTimeout(r, 100));
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
  await new Promise((r) => setTimeout(r, 200));
}

describe.skipIf(!SHOULD_RUN)(
  "m49: tug-text-editor caret count stays at 1 across stale-cache transitions",
  () => {
    test(
      "atom removal via backspace — exactly one caret",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m49-atom-removal-backspace",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);
            // Type a-atom-b sequence. Doc: "a\u{FFFC}b".
            await app.nativeType("a");
            await new Promise((r) => setTimeout(r, 150));
            await insertFileAtom(app);
            await new Promise((r) => setTimeout(r, 150));
            await app.nativeType("b");
            await new Promise((r) => setTimeout(r, 200));
            // Caret currently after "b". Backspace 1 = remove "b";
            // Backspace 2 = remove the atom (the layout-shifting step).
            await app.nativeKey("Backspace");
            await new Promise((r) => setTimeout(r, 200));
            await app.nativeKey("Backspace");
            await new Promise((r) => setTimeout(r, 300));
            const count = await caretCount(app);
            expect(count, "exactly one caret after atom-removal backspace").toBe(1);
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
      "ranged delete crossing an atom — exactly one caret",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m49-ranged-delete-crossing",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);
            await app.nativeType("a");
            await new Promise((r) => setTimeout(r, 150));
            await insertFileAtom(app);
            await new Promise((r) => setTimeout(r, 150));
            await app.nativeType("b");
            await new Promise((r) => setTimeout(r, 200));
            // Select-all, delete: removes the entire 3-token doc
            // including the atom — large layout shift.
            await app.nativeKey("a", ["cmd"]);
            await new Promise((r) => setTimeout(r, 150));
            await app.nativeKey("Delete");
            await new Promise((r) => setTimeout(r, 300));
            const count = await caretCount(app);
            expect(count, "exactly one caret after ranged delete across atom").toBe(1);
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
      "undo of cut that removed an atom — exactly one caret",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m49-undo-cut",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);
            await app.nativeType("a");
            await new Promise((r) => setTimeout(r, 150));
            await insertFileAtom(app);
            await new Promise((r) => setTimeout(r, 150));
            await app.nativeType("b");
            await new Promise((r) => setTimeout(r, 200));
            // Select-all + cut: doc empties, atom gone.
            await app.nativeKey("a", ["cmd"]);
            await new Promise((r) => setTimeout(r, 150));
            await app.nativeKey("x", ["cmd"]);
            await new Promise((r) => setTimeout(r, 300));
            // Undo: doc + atom return. CM6's history restores BOTH
            // the deleted content AND the pre-cut selection — so
            // the selection is ranged again. Collapse it to the end
            // with ArrowRight so the caret is the visible state to
            // assert on (a ranged selection correctly produces zero
            // caret markers; the doubled-caret bug being guarded
            // here is about a *collapsed* caret leaving a stale
            // stroke).
            await app.nativeKey("z", ["cmd"]);
            await new Promise((r) => setTimeout(r, 400));
            await app.nativeKey("ArrowRight");
            await new Promise((r) => setTimeout(r, 200));
            const count = await caretCount(app);
            expect(count, "exactly one caret after undo of cut + collapse").toBe(1);
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
      "paste over ranged selection — exactly one caret",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m49-paste-over-selection",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);
            await app.nativeType("ab");
            await new Promise((r) => setTimeout(r, 200));
            // Copy "ab" so we have a clipboard payload.
            await app.nativeKey("a", ["cmd"]);
            await new Promise((r) => setTimeout(r, 150));
            await app.nativeKey("c", ["cmd"]);
            await new Promise((r) => setTimeout(r, 200));
            // Replace selection (still "ab") via paste.
            await app.nativeKey("v", ["cmd"]);
            await new Promise((r) => setTimeout(r, 300));
            const count = await caretCount(app);
            expect(count, "exactly one caret after paste over selection").toBe(1);
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
      "typeahead deactivate (Esc) — exactly one caret",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);
          const app = await launchTugApp({
            testName: "m49-typeahead-deactivate",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await setupGallery(app);
            // The gallery wires a `/`-trigger provider into the
            // editor for slash-command typeahead. Open and close it
            // to exercise the popup-deactivate path.
            await app.nativeType("/");
            await new Promise((r) => setTimeout(r, 250));
            await app.nativeKey("Escape");
            await new Promise((r) => setTimeout(r, 300));
            const count = await caretCount(app);
            expect(count, "exactly one caret after typeahead Esc").toBe(1);
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
