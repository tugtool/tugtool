/**
 * at0043-tug-edit-copy-diag.test.ts — empirical clipboard read-back
 * for tug-edit copy across selection classes (text-only / mixed /
 * atom-only).
 *
 * ## Why this exists
 *
 * Manual checkpoint of Step 9 surfaced two clipboard symptoms:
 *
 *   1. Atom-only selection appears to "fail to copy" — pasting the
 *      result reproduces the atom's label as text rather than an atom
 *      widget, which from a UX POV reads as "the atom didn't get
 *      copied."
 *   2. Mixed (text + atom) selection copies, but pasting reproduces
 *      the atom as plain-text label rather than an atom widget.
 *
 * The plan's Step 9.5A asked: confirm empirically what the failure
 * shape actually is, before refactoring `handleCopy`. This test
 * walks the gallery card through the three selection classes, fires
 * ⌘C, and reads the bridge-readable clipboard back via the same
 * `window.webkit.messageHandlers.clipboardRead` channel that
 * `tug-native-clipboard.ts` exposes to the substrate's paste handler.
 *
 * ## Findings (recorded for future readers)
 *
 *   | scenario   | bridge text |
 *   |------------|-------------|
 *   | text-only  | "abc"       |
 *   | mixed      | "xmain.ts"  |
 *   | atom-only  | "main.ts"   |
 *
 *   In every case, `document.execCommand("copy")` succeeds, the copy
 *   event fires, and `clipboardExt` writes both `text/plain` (with
 *   atom labels substituted for U+FFFC, per `serializeClipboard`'s
 *   `fallback` field) and the `application/x-tug-atoms` sidecar.
 *   The native bridge reads `text/plain` + `text/html` only — the
 *   sidecar is invisible to it. So both UX symptoms are the same root
 *   cause: atoms travel through the custom MIME but the bridge
 *   doesn't carry custom MIMEs, and the substrate's paste path on
 *   Tug.app reconstructs from `text` only.
 *
 * The fix lands in Step 9.5B: emit a `text/html` payload too (the
 * bridge does carry html), and parse it on the bridge-paste path
 * to reconstruct atoms. Once 9.5B lands, this test is extended to
 * assert on the html field and round-trip atom decorations.
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

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const TUG_EDIT_CONTENT_SELECTOR =
  '[data-slot="tug-edit"] .cm-content';

/**
 * The gallery card renders five `TugPushButton`s in
 * `.gallery-text-edit-atom-row`, one per atom kind: file, command,
 * doc, image, link. We only need one — pick "file" by index. Its
 * onClick calls `editRef.current?.insertAtom({ kind: "atom", type:
 * "file", label: "main.ts", value: "/project/src/main.ts" })`.
 */
const GALLERY_FILE_ATOM_BUTTON_SELECTOR =
  '[data-card-id="A"] .gallery-text-edit-atom-row [data-slot="tug-push-button"]:nth-of-type(1)';

/** Label of the "file" sample atom in `gallery-text-edit.tsx`. */
const FILE_ATOM_LABEL = "main.ts";

// ---------------------------------------------------------------------------
// Deck shape
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Clear the editor (Cmd-A, Delete) so each scenario starts fresh. */
async function clearEditor(app: App): Promise<void> {
  await app.nativeKey("a", ["cmd"]);
  await app.nativeKey("Delete");
}

interface ClipboardSnapshot {
  hasBridge: boolean;
  text: string;
  html: string;
}

/**
 * Read the system clipboard via Tug.app's native bridge
 * (NSPasteboard read). Returns plain text + html. Custom MIME types
 * (the `application/x-tug-atoms` sidecar) don't cross the bridge, so
 * this gives us the same view a paste destination outside the
 * substrate's browser-mode paste path would see.
 *
 * Talks to `window.webkit.messageHandlers.clipboardRead` directly
 * rather than importing `tug-native-clipboard.ts` (the harness's
 * `evalJS` context doesn't resolve module paths). Drives the same
 * Swift-side handler and unique-`requestId` callback shape, with the
 * production `__tugNativeClipboardCallback` chained so a concurrent
 * read in the substrate isn't dropped.
 *
 * Caller pattern: kick off the read, poll until the result lands in
 * `window.__tugClipReadResult` (evalJS doesn't await Promises), then
 * read the result.
 */
async function readClipboard(app: App): Promise<ClipboardSnapshot> {
  await app.evalJS<void>(
    `(function(){
      var w = window;
      w.__tugClipReadResult = null;
      var bridge = w.webkit && w.webkit.messageHandlers && w.webkit.messageHandlers.clipboardRead;
      if (!bridge || typeof bridge.postMessage !== "function") {
        w.__tugClipReadResult = { hasBridge: false, text: "", html: "" };
        return;
      }
      var id = "diag-" + Math.random().toString(36).slice(2);
      var prior = w.__tugNativeClipboardCallback;
      w.__tugNativeClipboardCallback = function(data) {
        if (!data || data.requestId !== id) {
          if (typeof prior === "function") prior(data);
          return;
        }
        w.__tugNativeClipboardCallback = prior;
        w.__tugClipReadResult = {
          hasBridge: true,
          text: typeof data.text === "string" ? data.text : "",
          html: typeof data.html === "string" ? data.html : "",
        };
      };
      bridge.postMessage({ requestId: id });
    })()`,
  );
  await app.waitForCondition<boolean>(
    `window.__tugClipReadResult !== null`,
    { timeoutMs: 2000 },
  );
  return app.evalJS<ClipboardSnapshot>(
    `(function(){ var r = window.__tugClipReadResult; window.__tugClipReadResult = null; return r; })()`,
  );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)(
  "m43: tug-edit copy clipboard read-back across selection classes",
  () => {
    test(
      "text-only / mixed / atom-only ⌘C produces the documented bridge text payload",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);

          const app = await launchTugApp({
            testName: "m43-tug-edit-copy-diag",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          try {
            await setupGallery(app);

            // ---- Scenario 1: text-only ----
            // Type "abc", select all, ⌘C. Bridge text should match
            // verbatim — text glyphs round-trip unchanged.
            await app.nativeType("abc");
            await app.nativeKey("a", ["cmd"]);
            await app.nativeKey("c", ["cmd"]);
            const textOnlyClip = await readClipboard(app);
            expect(textOnlyClip.hasBridge, "native bridge required for this test").toBe(true);
            expect(
              textOnlyClip.text,
              "text-only ⌘C: bridge text payload",
            ).toBe("abc");

            // ---- Scenario 2: mixed (text + atom) ----
            // Reset, type "x", insert "file" atom (doc = `x` + `￼`),
            // re-focus the editor, select all, ⌘C. Bridge text should
            // be `"x" + atom.label` because `serializeClipboard`
            // substitutes labels for U+FFFC in the `fallback` payload.
            await clearEditor(app);
            await app.nativeType("x");
            await app.nativeClickAtElement(GALLERY_FILE_ATOM_BUTTON_SELECTOR);
            await app.nativeClickAtElement(`[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`);
            await app.waitForCondition<boolean>(
              `(function(){
                var ed = document.querySelector('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}');
                if (ed === null) return false;
                return ed.querySelector('img[data-atom-label]') !== null;
              })()`,
              { timeoutMs: 2000 },
            );
            await app.nativeKey("a", ["cmd"]);
            await app.nativeKey("c", ["cmd"]);
            const mixedClip = await readClipboard(app);
            expect(
              mixedClip.text,
              "mixed ⌘C: bridge text payload (label substituted for U+FFFC)",
            ).toBe(`x${FILE_ATOM_LABEL}`);

            // ---- Scenario 3: atom-only ----
            // Reset, insert "file" atom, shift-arrow-left to select it,
            // ⌘C. Bridge text should be just the label.
            await clearEditor(app);
            await app.nativeClickAtElement(GALLERY_FILE_ATOM_BUTTON_SELECTOR);
            await app.nativeClickAtElement(`[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`);
            await app.waitForCondition<boolean>(
              `(function(){
                var ed = document.querySelector('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}');
                if (ed === null) return false;
                return ed.querySelectorAll('img[data-atom-label]').length === 1
                  && ed.textContent.length === 0;
              })()`,
              { timeoutMs: 2000 },
            );
            await app.nativeKey("ArrowLeft", ["shift"]);
            await app.nativeKey("c", ["cmd"]);
            const atomOnlyClip = await readClipboard(app);
            expect(
              atomOnlyClip.text,
              "atom-only ⌘C: bridge text payload (label only)",
            ).toBe(FILE_ATOM_LABEL);

            // ---- Pre-fix baseline assertions on html ----
            // Step 9.5B will populate `text/html` with atom <img>
            // markup. Until that lands, the bridge sees no html for
            // any scenario. Recording these as expectations now means
            // the fix-step's commit will turn them red and force the
            // implementer to update them — a clear signal of the
            // post-fix shape.
            expect(textOnlyClip.html, "text-only html payload (pre-9.5B)").toBe("");
            expect(mixedClip.html, "mixed html payload (pre-9.5B)").toBe("");
            expect(atomOnlyClip.html, "atom-only html payload (pre-9.5B)").toBe("");
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
