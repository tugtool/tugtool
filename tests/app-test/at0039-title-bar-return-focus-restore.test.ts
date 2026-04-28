/**
 * at0039-title-bar-return-focus-restore.test.ts — selection in an
 * INACTIVE FC card (TugInput) survives a title-bar-driven activation
 * round-trip when the OTHER card (TugTextarea) was the focused card
 * mid-trip.
 *
 * ## What this gates
 *
 * User-reported repro that at0036 missed because at0036 uses an
 * input click — not a title-bar click — for the activation gesture
 * AND uses the same component on both sides:
 *
 *   1. Two standalone cards in two panes:
 *        - p1: TugInput card (gallery-input) — "A"
 *        - p2: TugTextarea card (gallery-textarea) — "B"
 *   2. Click into A's `md` input. Type "md". Select 0..2.
 *   3. Click on B's title bar (NOT B's content) — A deactivates,
 *      B activates.
 *   4. Click into one of B's textareas (e.g. its `md` textarea) —
 *      focus lands inside B.
 *   5. Click on A's title bar (NOT A's content) — B deactivates,
 *      A activates.
 *   6. 🢁 The user expects focus on A's `md` input. The bug they
 *      observe: focus lands on A's `sm` input (the FIRST
 *      `[data-tug-state-key]` element — the default-focus chain's
 *      step 3). The selection in `md` is restored correctly; only
 *      the FOCUS axis is wrong.
 *
 * Two things distinguish this from at0036:
 *
 *   - **Activation gesture is title bar.** The click target is
 *     `[data-testid="tug-pane-title-bar"]` inside the destination
 *     pane, NOT a `[data-tug-state-key]` input. Pane-focus-controller's
 *     pointerdown classifies this as a chrome activation. The
 *     subsequent `installFormControlReapplyOnNextMousedown` listener
 *     (registered by `transferFocusForActivation`) does NOT match
 *     a non-input mousedown target, so any re-apply that listener
 *     would have done is skipped.
 *
 *   - **Focus is in the OUTGOING (B) card's form-control at the
 *     moment of return.** When the user clicks A's title bar,
 *     `pane-focus-controller`'s capture-phase pointerdown calls
 *     `invokeSaveCallback(B)`. `document.activeElement` at save
 *     time is B's textarea. B's bag.focus is correctly captured.
 *     Then the helper resolves A's bag and calls `target.el.focus()`
 *     where `target.el` is A's md input. If anything subsequent
 *     re-walks the default-focus chain (cold-boot mount restore
 *     re-firing, an unrelated focus call, etc.), focus falls onto
 *     A's `sm` input — the first `[data-tug-state-key]` match in
 *     A's subtree.
 *
 * Test name choice: `at0039` to extend the at0036 family without
 * editing at0036 (which still gates the input-click variant).
 *
 * ## What this is testing
 *
 * The full round-trip in two panes with two DIFFERENT components.
 * The asserted final state is the same as at0036's last assertion:
 * focus must land on A's `md` input (`data-tug-state-key`
 * matches `gallery-input/size/md`), with the typed value and saved
 * selection both restored.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 90_000;

const INPUT_MD_KEY = "gallery-input/size/md";
const INPUT_MD_SELECTOR = `input[data-tug-state-key="${INPUT_MD_KEY}"]`;

const TEXTAREA_MD_KEY = "gallery-textarea/size/md";
const TEXTAREA_MD_SELECTOR = `textarea[data-tug-state-key="${TEXTAREA_MD_KEY}"]`;

function paneTitleBarSelector(paneId: string): string {
  return `.tug-pane[data-pane-id="${paneId}"] [data-testid="tug-pane-title-bar"]`;
}

/**
 * Brief settle pause matching the natural pacing of user-driven
 * actions. Used for the same reason as at0036's `pause` helper.
 */
function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) =>
    (
      globalThis as unknown as {
        setTimeout: (fn: () => void, ms: number) => unknown;
      }
    ).setTimeout(() => resolve(), ms),
  );
}

/**
 * Two-pane geometry. p1 holds A (TugInput / gallery-input);
 * p2 holds B (TugTextarea / gallery-textarea). Two-pane is
 * critical so card B's deactivation and card A's re-activation
 * both flow through pane-focus-controller's chrome-click branch
 * (single-pane card switches use a different intra-pane code
 * path covered by other tests).
 */
function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-input" as const, title: "TugInput", closable: true },
      { id: "B", componentId: "gallery-textarea" as const, title: "TugTextarea", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 460, height: 540 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"] as const,
      },
      {
        id: "p2",
        position: { x: 540, y: 40 },
        size: { width: 460, height: 540 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["developer"] as const,
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

interface InputSnapshot {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

describe.skipIf(!SHOULD_RUN)(
  "at0039: TugInput selection + focus restored after title-bar return when TugTextarea was focused mid-trip",
  () => {
    test(
      "title-bar-driven A→B(focus textarea)→A returns focus to A's md input",
      async () => {
        const app = await launchTugApp({
          testName: "at0039-title-bar-return-focus-restore",
        });
        try {
          await app.enableDeckTrace(true);

          await app.seedDeckState({
            state: deckShape(),
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          const aInputSel = `[data-card-id="A"] ${INPUT_MD_SELECTOR}`;
          const bTextareaSel = `[data-card-id="B"] ${TEXTAREA_MD_SELECTOR}`;
          const bTitleBarSel = paneTitleBarSelector("p2");
          const aTitleBarSel = paneTitleBarSelector("p1");

          // Step 1 — Click into A's md input and type "md".
          await app.nativeClickAtElement(aInputSel);
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(aInputSel)})`,
            { timeoutMs: 2000 },
          );
          await app.nativeType("md");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(aInputSel)});
              return el !== null && el.value === "md";
            })()`,
            { timeoutMs: 2000 },
          );
          await pause(150);

          // Step 2 — Programmatically select 0..2 (matches a Cmd-A
          // or drag selection of the typed text).
          await app.evalJS<void>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(aInputSel)});
              if (!el) throw new Error("[at0039] A's md input missing");
              el.focus();
              el.setSelectionRange(0, 2);
            })()`,
          );
          await pause(100);

          const preDeactivate = await app.evalJS<InputSnapshot>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(aInputSel)});
              if (!el) return { value: "<missing>", selectionStart: null, selectionEnd: null };
              return {
                value: el.value,
                selectionStart: el.selectionStart,
                selectionEnd: el.selectionEnd,
              };
            })()`,
          );
          expect(preDeactivate.value).toBe("md");
          expect(preDeactivate.selectionStart).toBe(0);
          expect(preDeactivate.selectionEnd).toBe(2);

          // Step 3 — Click on B's TITLE BAR (not its content). This
          // is the user's exact gesture and is the variant at0036
          // does NOT cover. Pane-focus-controller's capture-phase
          // pointerdown classifies it as a chrome activation and
          // routes through `transferFocusForActivation` with
          // outgoing=A, incoming=B. The deactivation save fires
          // for A while document.activeElement is still A's md input.
          await app.nativeClickAtElement(bTitleBarSel);
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "B")`,
            { timeoutMs: 2000 },
          );
          await pause(200);

          // Step 4 — Click into one of B's textareas to put focus
          // in a [data-tug-state-key] inside B. The user reported
          // this step is essential: without focus inside B's
          // textarea, the bug does not reproduce reliably.
          await app.nativeClickAtElement(bTextareaSel);
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(bTextareaSel)})`,
            { timeoutMs: 2000 },
          );
          await pause(150);

          // Step 4b — Trigger an "inactive-card save" for A.
          //
          // The user's manual repro uses `Developer > Reload`,
          // which fires `beforeunload`'s save-all-cards fan-out.
          // The production save-all-cards path is the same one
          // `window.tugdeck.saveState()` exposes for the saveState
          // RPC (and the same one a soft reload's
          // `prepareForReload` drains): every registered save
          // callback fires, including A's, while focus is still
          // in B's textarea. At that moment `document.activeElement`
          // is outside A's card root, so `captureFocus(A_root)`
          // returns `{kind: "none"}`. Pre-fix, the assembler
          // conditionally spreads `focus` only when its kind is
          // non-none, so A's bag was replaced with one that had no
          // `focus` axis — even though the prior deactivation save
          // had correctly captured `bag.focus = { kind:
          // "form-control", componentStatePreservationKey:
          // "gallery-input/size/md" }`.
          //
          // We use `tugdeck.saveState()` directly rather than
          // `simulateAppHide` / `appReload` because it's the same
          // fan-out without any app-lifecycle turbulence (no
          // window.blur, no visibilitychange, no WKWebView reload
          // race) — keeping the test deterministic and the failure
          // signal narrow.
          const aFocusBeforeSave = await app.evalJS<unknown>(
            `(function(){
              var bag = window.__tug.getCardStateBag("A");
              return bag === null ? null : (bag.focus ?? null);
            })()`,
          );
          expect(
            aFocusBeforeSave,
            "pre-saveState: A's bag.focus must reflect the deactivation capture (form-control md)",
          ).toEqual({ kind: "form-control", componentStatePreservationKey: INPUT_MD_KEY });

          // Drive the saveState RPC. Same code path the on-quit
          // save-and-flush hits. Iterates every card through
          // `invokeSaveCallback("manual")`.
          await app.evalJS<void>(
            `(function(){
              if (!window.tugdeck || typeof window.tugdeck.saveState !== "function") {
                throw new Error("[at0039] window.tugdeck.saveState missing");
              }
              window.tugdeck.saveState();
            })()`,
          );

          const aFocusAfterSave = await app.evalJS<unknown>(
            `(function(){
              var bag = window.__tug.getCardStateBag("A");
              return bag === null ? null : (bag.focus ?? null);
            })()`,
          );
          expect(
            aFocusAfterSave,
            "post-saveState: A's bag.focus must STILL reflect form-control md — the inactive-card save must not wipe a previously-captured focus axis",
          ).toEqual({ kind: "form-control", componentStatePreservationKey: INPUT_MD_KEY });

          // Step 5 — Click on A's TITLE BAR. This deactivates B
          // (save fires for B with bag.focus = form-control textarea)
          // and activates A. Resolver should pick A's md input
          // from bag.focus and focus it.
          await app.nativeClickAtElement(aTitleBarSel);
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "A")`,
            { timeoutMs: 2000 },
          );
          await pause(250);

          // Step 6 — Final assertions.
          //
          // Selection is the easier half: the user reports it IS
          // restored on md, so this should pass. We assert it
          // anyway so a regression in either axis breaks the test
          // explicitly.
          const postReactivate = await app.evalJS<InputSnapshot>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(aInputSel)});
              if (!el) return { value: "<missing>", selectionStart: null, selectionEnd: null };
              return {
                value: el.value,
                selectionStart: el.selectionStart,
                selectionEnd: el.selectionEnd,
              };
            })()`,
          );
          expect(
            postReactivate.value,
            "post-reactivate: typed value 'md' must still be in A's md input",
          ).toBe("md");
          expect(
            postReactivate.selectionStart,
            "post-reactivate: A's md selection start must be 0",
          ).toBe(0);
          expect(
            postReactivate.selectionEnd,
            "post-reactivate: A's md selection end must be 2",
          ).toBe(2);

          // Focus is the load-bearing assertion — this is the
          // axis the user reports as broken. After title-bar
          // return, document.activeElement must be A's md input
          // (data-tug-state-key === "gallery-input/size/md"),
          // NOT A's sm input (the first [data-tug-state-key]
          // match the default-focus chain falls through to).
          const focusedPersistKey = await app.evalJS<string | null>(
            `(function(){
              var active = document.activeElement;
              if (!(active instanceof Element)) return null;
              return active.getAttribute("data-tug-state-key");
            })()`,
          );
          expect(
            focusedPersistKey,
            "post-reactivate: focus must land on A's md input the user originally focused, not on the default-focus-chain fallback (sm)",
          ).toBe(INPUT_MD_KEY);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
