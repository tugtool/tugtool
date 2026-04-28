/**
 * at0042-tug-edit-state-roundtrip.test.ts — gallery-text-edit
 * state-preservation round-trip across `appReload` ([AT0042]).
 *
 * ## Why this exists
 *
 * The user-reported regression: load the gallery TugEdit card, type
 * some text, hit `Developer > Reload`, and the typed text is gone.
 * The Step 7 implementation in `text-editing-base.md` wired
 * `useEditStatePreservation` into `TugEdit` and registered the hook
 * with the enclosing `CardHost`, but evidently the live save →
 * reload → restore pipeline does not round-trip the typed text.
 *
 * This test reproduces the user's exact path:
 *
 *   1. Launch with a fresh tugbank.
 *   2. Seed a deck with one `gallery-text-edit` card (no pre-cooked
 *      content).
 *   3. Click into the editor, type via `nativeType` (real
 *      NSEvent keystrokes that reach the WebView as native input),
 *      so the substrate exercises the same code path users hit.
 *   4. Wait for the in-memory bag to reflect the typed text — uses
 *      `__tug.getEmCardState` which calls
 *      `deck.invokeSaveCallback("manual")` synchronously, forcing a
 *      capture without waiting on the dirty-state debounce.
 *   5. `app.appReload()` — fresh WebView in the same Tug.app
 *      process; before-unload save flushes through tugbank.
 *   6. Read the on-disk bag and assert the text is present.
 *   7. Re-seed the deck from the on-disk bag (test mode skips
 *      boot-time tugbank reads) and assert the live editor's
 *      `.cm-content` carries the same text.
 *
 * Each of those steps is also a fault-isolation point. If the test
 * fails at step 4, the in-memory save is broken and the on-disk
 * write would never have had the text. If it fails at step 6, the
 * before-unload flush isn't wiring through. If it fails at step 7,
 * the cold-mount restore branch in `useEditStatePreservation` isn't
 * landing the doc in the live view.
 *
 * The four-axis matrix (text + atoms + selection + scrollTop)
 * covered by `at0024-prompt-state-roundtrip.test.ts` is the right
 * model long-term, but the user's reproduction is just text loss —
 * we keep the assertion surface narrow here so a green run proves
 * the load-bearing case and we add atoms / selection / scrollTop as
 * follow-up coverage.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Selectors and fixtures
// ---------------------------------------------------------------------------

/**
 * `data-slot="tug-edit"` is the host wrapper attribute the
 * substrate emits ([L19] component-authoring guide). The CodeMirror
 * 6 contentEditable surface is `.cm-content` — every typed
 * character lands there.
 */
const TUG_EDIT_CONTENT_SELECTOR =
  '[data-slot="tug-edit"] .cm-content';

/**
 * Plain-ASCII text that exercises the `nativeType` path (the harness
 * rejects non-ASCII before any events are posted) and reads cleanly
 * from `view.state.doc.toString()` without atom-character sentinel
 * confusion.
 *
 * For the scrollLeft round-trip variant we need a line longer than
 * the editor's content box so the scroller actually has horizontal
 * room to scroll. `tug-edit` defaults to no line wrapping, so a long
 * line of ASCII without spaces produces a single visual line that
 * extends past the right edge.
 */
const TYPED_TEXT = "hello tug-edit reload";

/**
 * Single-line ASCII string long enough to overflow the gallery
 * card's editor content box (≈700 px / monospace ≈10 px per char
 * ≈ 70 chars before the right edge). All lowercase: rapid posting
 * of shifted characters via `nativeType` can desynchronize the
 * shift modifier with the character keydown — the shift release
 * sometimes arrives before the keyboard's modifier-state read,
 * yielding lowercase output for letters that should be capitals
 * (observed empirically against the live WebKit event queue).
 * Shifting isn't what this test is about, so we sidestep it.
 */
const TYPED_LONG_LINE =
  "abcdefghijklmnopqrstuvwxyz"
  + "abcdefghijklmnopqrstuvwxyz"
  + "0123456789012345678901234567890123456789"
  + "final.";

const SCROLL_LEFT_OFFSET = 120;

interface RawBag {
  content?: unknown;
}

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
// Phase A — type, force in-memory save, trigger appReload
// ---------------------------------------------------------------------------

async function setupPhaseA(app: App, opts: { forceSave: boolean }): Promise<void> {
  await app.enableDeckTrace(true);

  // No pre-cooked content — we type the text in this phase.
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {},
    focusCardId: "A",
  });

  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );

  // Wait for the EditorView to mount; the `engine-ready` deck-trace
  // event is emitted at the tail of `TugEdit`'s mount effect.
  await app.awaitEngineReady("A");

  // Click into the contentEditable so subsequent nativeType events
  // land on it. The editor is the only focusable thing in the card,
  // but `data-card-id` scoping keeps the selector unambiguous if
  // future gallery additions add more cards.
  const editorSelector = `[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}`;
  await app.nativeClickAtElement(editorSelector);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(editorSelector)})`,
    { timeoutMs: 2000 },
  );

  // Type the test fixture. nativeType produces real NSEvent keypresses
  // that the WebView delivers as native `input` / `keydown` events,
  // so CM6's standard input pipeline handles them — no synthetic
  // dispatches.
  await app.nativeType(TYPED_TEXT);

  // Verify the editor's live document carries the typed text. We
  // read this from CM6 directly (not the DOM, not the bag) so a
  // failure here points squarely at typing → CM6 input pipeline,
  // not at any save / restore plumbing further downstream.
  await app.waitForCondition<boolean>(
    `(function(){
      var ed = document.querySelector('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}');
      return ed !== null && ed.textContent === ${JSON.stringify(TYPED_TEXT)};
    })()`,
    { timeoutMs: 4000 },
  );

  if (opts.forceSave) {
    // Optional manual save force. `getEmCardState` calls
    // `deck.invokeSaveCallback("manual")` synchronously, capturing
    // the live state into the in-memory bag without waiting on the
    // dirty-state debounce timer. The user's reproduction path
    // (`forceSave: false`) relies entirely on
    // `prepareForReload` (or `beforeunload`) flushing through the
    // save chain — that's the path we want to harden.
    await app.waitForCondition<boolean>(
      `(function(){
        var s = window.__tug.getEmCardState("A");
        return s !== null && s.text === ${JSON.stringify(TYPED_TEXT)};
      })()`,
      { timeoutMs: 4000 },
    );
  }
}

// ---------------------------------------------------------------------------
// Disk-side assertion
// ---------------------------------------------------------------------------

function readActiveEngineState(bag: RawBag): Record<string, unknown> | null {
  const content = bag.content;
  if (typeof content !== "object" || content === null) return null;
  // gallery-text-edit uses the raw TugTextEditingState shape — no
  // currentRoute / perRoute wrapper.
  return content as Record<string, unknown>;
}

function assertBagOnDisk(tugbankPath: string): void {
  const onDisk = tugbankRead<RawBag>(
    tugbankPath,
    "dev.tugtool.deck.cardstate",
    "A",
  );
  expect(
    onDisk,
    "expected bag for card A to exist on tugbank disk",
  ).not.toBeNull();
  expect(onDisk?.type).toBe("json");
  const bag = onDisk?.value;
  expect(bag, "expected on-disk bag value to be present").toBeDefined();

  const engineState = readActiveEngineState(bag as RawBag);
  expect(
    engineState,
    "expected on-disk bag.content to carry an engine state for the active card",
  ).not.toBeNull();

  expect(
    engineState!.text,
    "axis text: on-disk bag.content text must match what we typed",
  ).toBe(TYPED_TEXT);
}

// ---------------------------------------------------------------------------
// Phase B — re-seed from disk, assert live editor
// ---------------------------------------------------------------------------

async function reseedFromDisk(app: App, tugbankPath: string): Promise<void> {
  const onDisk = tugbankRead<RawBag>(
    tugbankPath,
    "dev.tugtool.deck.cardstate",
    "A",
  );
  expect(onDisk).not.toBeNull();
  const cardStates: Record<string, RawBag> = {};
  cardStates.A = onDisk!.value as RawBag;

  await app.enableDeckTrace(true);

  await app.seedDeckState({
    state: deckShape(),
    cardStates,
    focusCardId: "A",
  });

  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );

  await app.awaitEngineReady("A");
}

async function assertLiveText(app: App): Promise<void> {
  // The substrate's `captureEditState(view)` returns
  // `view.state.doc.toString()` as `text`. We re-read it through
  // `getEmCardState` (which forces a save first) so we observe the
  // engine's authoritative document, not just the rendered DOM
  // (CM6 may be mid-line-virtualization on long docs; not the case
  // here, but the principle is the same as in at0024).
  await app.waitForCondition<boolean>(
    `(function(){
      var s = window.__tug.getEmCardState("A");
      return s !== null && s.text === ${JSON.stringify(TYPED_TEXT)};
    })()`,
    { timeoutMs: 4000 },
  );
  const liveText = await app.evalJS<string>(
    `window.__tug.getEmCardState("A").text`,
  );
  expect(
    liveText,
    "axis text: live engine text after reload must match what we typed",
  ).toBe(TYPED_TEXT);

  // Cross-check the rendered DOM. CM6 reconciles
  // `view.state.doc` into `.cm-content` synchronously inside
  // `view.dispatch`, so the two should agree — but if a future
  // refactor introduces a path that updates state without
  // reconciling, the bag-side check above would still pass while
  // the user sees an empty editor. This second assertion catches
  // that drift.
  const liveDom = await app.evalJS<string>(
    `(function(){
      var ed = document.querySelector('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}');
      return ed === null ? "" : ed.textContent;
    })()`,
  );
  expect(
    liveDom,
    "axis text (DOM): live `.cm-content` after reload must match what we typed",
  ).toBe(TYPED_TEXT);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Disk-poll helper for the dirty-state-debounce isolation test
// ---------------------------------------------------------------------------

const DIRTY_DEBOUNCE_MS = 1000;
const DEBOUNCE_FLUSH_GRACE_MS = 1500;

/**
 * Sleep for the given milliseconds. Used to wait past the
 * dirty-state debounce window so a save fires without any external
 * trigger. Bun's `setTimeout` is good enough for this — drift on
 * the order of milliseconds doesn't matter against a 1000ms
 * debounce + 500ms grace.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe.skipIf(!SHOULD_RUN)(
  "m42: gallery-text-edit state round-trip across appReload",
  () => {
    test(
      "type, debounce, read disk — dirty-state save chain alone must persist typed text",
      async () => {
        // Isolation test: prove the natural dirty-state debounce
        // save chain reaches tugbank without any reload trigger.
        // If this fails but the reload variants pass, the bug is
        // in `useCardDirtyState`'s wiring for the tug-edit
        // substrate (probably: typing in CM6 doesn't fire
        // `selectionchange` in a shape the dirty hook recognizes).
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);

          const app = await launchTugApp({
            testName: "m42-gallery-text-edit-debounce-only",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          try {
            await setupPhaseA(app, { forceSave: false });

            // Wait past the dirty-state debounce + a grace margin so
            // the save callback fires and `flushDirtyCardStates`
            // writes the bag to tugbank.
            await sleep(DIRTY_DEBOUNCE_MS + DEBOUNCE_FLUSH_GRACE_MS);

            // Now read the bag directly off disk — no
            // `getEmCardState`, no `appReload`, nothing that would
            // synthesize a save. If the text is on disk, the
            // dirty-state debounce save chain works end-to-end. If
            // it isn't, we've isolated the bug.
            assertBagOnDisk(tugbankPath);
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
      "type, reload — prepareForReload alone must flush typed text to disk",
      async () => {
        // The user's exact reproduction: type, hit reload, no manual
        // save force. `appReload` invokes `prepareForReload`, which
        // walks every registered save callback synchronously before
        // tearing down the WebView — so a green run here proves the
        // dirty-state markup → save callback chain is wired.
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);

          const app = await launchTugApp({
            testName: "m42-gallery-text-edit-no-force-save",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          try {
            await setupPhaseA(app, { forceSave: false });
            await app.appReload();
            assertBagOnDisk(tugbankPath);
            await reseedFromDisk(app, tugbankPath);
            await assertLiveText(app);
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
      "type long line, scroll horizontally, reload — scrollLeft round-trips",
      async () => {
        // The horizontal-scroll case the user reported: type a line
        // wider than the content box, drag the editor's
        // `.cm-scroller` element to a non-zero scrollLeft, reload,
        // and verify the saved scrollLeft is restored. Without the
        // scrollLeft axis on `TugTextEditingState`, the bag's
        // horizontal position is silently dropped — visible to the
        // user as the caret jumping back to column 0 after every
        // reload.
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);

          const app = await launchTugApp({
            testName: "m42-gallery-text-edit-scroll-left",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          try {
            // Custom Phase A: type a long single-line text instead of
            // the short fixture, then programmatically set scrollLeft
            // on `.cm-scroller` so the test doesn't depend on
            // synthesizing real wheel events. The save chain reads
            // `view.scrollDOM.scrollLeft`, so a direct DOM write is
            // fine — the live engine sees the scroll listener fire
            // and writes the mirror.
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

            await app.nativeType(TYPED_LONG_LINE);
            // 8s ceiling so the typing has slack on cold-launched
            // WebViews — the per-keystroke event posting is fast but
            // CM6's reconciliation has to flush each transaction
            // through the layout pipeline, which is what gates this
            // textContent comparison.
            //
            // Settle on `.length` first (CM6 may still be reconciling
            // when the last keystroke posts; `length` converges
            // earlier than the textContent string compare) before
            // making the equality assertion.
            await app.waitForCondition<boolean>(
              `(function(){
                var ed = document.querySelector('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}');
                return ed !== null && ed.textContent.length === ${TYPED_LONG_LINE.length};
              })()`,
              { timeoutMs: 8000 },
            );
            const observedText = await app.evalJS<string>(
              `(function(){
                var ed = document.querySelector('[data-card-id="A"] ${TUG_EDIT_CONTENT_SELECTOR}');
                return ed === null ? "" : ed.textContent;
              })()`,
            );
            expect(
              observedText,
              "axis text: nativeType must land the long line verbatim",
            ).toBe(TYPED_LONG_LINE);

            // Drive scrollLeft on the `.cm-scroller` element CM6
            // owns. The engine's `scroll` listener mirrors both
            // axes, so this lands in `view.scrollDOM.scrollLeft`
            // and `captureEditState` reads it on save.
            await app.evalJS<void>(
              `(function(){
                var sc = document.querySelector('[data-card-id="A"] [data-slot="tug-edit"] .cm-scroller');
                if (!sc) throw new Error("[m42] cm-scroller not found");
                sc.scrollLeft = ${SCROLL_LEFT_OFFSET};
              })()`,
            );
            await app.waitForCondition<boolean>(
              `(function(){
                var sc = document.querySelector('[data-card-id="A"] [data-slot="tug-edit"] .cm-scroller');
                return sc !== null && Math.abs(sc.scrollLeft - ${SCROLL_LEFT_OFFSET}) < 2;
              })()`,
              { timeoutMs: 2000 },
            );

            await app.appReload();

            // Verify scrollLeft is on the disk bag.
            const onDisk = tugbankRead<RawBag>(
              tugbankPath,
              "dev.tugtool.deck.cardstate",
              "A",
            );
            expect(onDisk).not.toBeNull();
            const engineState = readActiveEngineState(onDisk!.value as RawBag);
            expect(
              engineState,
              "expected on-disk bag.content for the active card",
            ).not.toBeNull();
            expect(
              engineState!.text,
              "axis text: long line must survive save",
            ).toBe(TYPED_LONG_LINE);
            expect(
              (engineState as Record<string, unknown>).scrollLeft,
              "axis scrollLeft: must be persisted to disk",
            ).toBe(SCROLL_LEFT_OFFSET);

            await reseedFromDisk(app, tugbankPath);

            // Verify scrollLeft on the live `.cm-scroller`.
            await app.waitForCondition<boolean>(
              `(function(){
                var sc = document.querySelector('[data-card-id="A"] [data-slot="tug-edit"] .cm-scroller');
                return sc !== null && Math.abs(sc.scrollLeft - ${SCROLL_LEFT_OFFSET}) < 2;
              })()`,
              { timeoutMs: 4000 },
            );
            const liveScrollLeft = await app.evalJS<number>(
              `(function(){
                var sc = document.querySelector('[data-card-id="A"] [data-slot="tug-edit"] .cm-scroller');
                return sc === null ? -1 : sc.scrollLeft;
              })()`,
            );
            expect(
              Math.abs(liveScrollLeft - SCROLL_LEFT_OFFSET),
              `axis scrollLeft: live cm-scroller offset must round-trip (got ${liveScrollLeft})`,
            ).toBeLessThanOrEqual(2);
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
      "type, force save, reload — explicit save flush also round-trips",
      async () => {
        // Companion test that drives a manual save before the reload.
        // Both tests should be green; if only this one is green, the
        // bug is "live save chain doesn't fire while typing"; if both
        // fail, the bug is in restore.
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);

          const app = await launchTugApp({
            testName: "m42-gallery-text-edit-force-save",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          try {
            await setupPhaseA(app, { forceSave: true });
            await app.appReload();
            assertBagOnDisk(tugbankPath);
            await reseedFromDisk(app, tugbankPath);
            await assertLiveText(app);
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
