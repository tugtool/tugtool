/**
 * at0036-inactive-card-app-switch-selection.test.ts — selection in an
 * INACTIVE FC card (TugInput) survives the app-resign /
 * app-become-active round-trip (cmd-tab away + back) and a subsequent
 * re-activation click.
 *
 * ## What this gates
 *
 * User-reported repro:
 *   - Two cards open, one is the TugInput gallery card.
 *   - Activate TugInput card. Type text into one of its inputs (e.g.
 *     `md`). Select some text.
 *   - Activate the OTHER card → TugInput card deactivates. The save
 *     callback captures `bag.formControls["gallery-input/size/md"]`
 *     with `value: "md"`, `selectionStart: 0`, `selectionEnd: 2`.
 *   - Cmd-Tab to another app.
 *   - Cmd-Tab back to Tug.
 *   - Re-activate the TugInput card.
 *   - 🢁 Selection lost. The user reports the typed value is also
 *     gone in some cases (no text or selection visible at all).
 *
 * The user noted that selection survives if the card stays *active*
 * during the app switch (m35 covers that path for EM cards). The
 * bug is specific to the inactive-during-app-switch path AND
 * specific to TugInput (FC, DOM-authority) — different code path
 * from TugPromptInput.
 *
 * ## What this is testing
 *
 * TugInput uses DOM-authority persistence: CardHost's
 * `captureFormControls` walks `[data-tug-state-key]` elements
 * inside the card root and snapshots `value`, `selectionStart`,
 * `selectionEnd`, `scrollTop` into `bag.formControls[componentStatePreservationKey]`.
 * Restore goes the other way via `applyFormControlSnapshot`.
 *
 * The test exercises:
 *   1. Live editing in card A's md input (`value="md"`, selection
 *      `{0, 2}`) before deactivation.
 *   2. Click into B's md input → A deactivates → save fires.
 *   3. Cmd-Tab away + back via `simulateAppResign`/`BecomeActive`.
 *   4. Click into A's md input again → A re-activates.
 *   5. Assert: A's md input still has the typed value AND selection.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 90_000;

const INPUT_MD_KEY = "gallery-input/size/md";
const INPUT_MD_SELECTOR = `input[data-tug-state-key="${INPUT_MD_KEY}"]`;

/**
 * Brief settle pause matching the natural pacing of user-driven
 * actions. Use `waitForCondition` when there's a specific
 * post-condition to gate on; use this when there isn't.
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
 * Two-pane geometry — matches the user's repro: two visible cards
 * in separate panes. Both are `gallery-input` so each has the
 * TugInput controls; the deactivation gesture is "click into B's
 * md input." Two-pane is critical: a single-pane tab-switch hides
 * the deactivated card via display:none, which is a different code
 * path from inter-pane activation.
 */
function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-input" as const, title: "TugInput A", closable: true },
      { id: "B", componentId: "gallery-input" as const, title: "TugInput B", closable: true },
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
  "m36: inactive TugInput selection survives cmd-tab cycle + re-activation click",
  () => {
    test(
      "TugInput value + selection preserved across deactivate → cmd-tab → re-activate",
      async () => {
        const app = await launchTugApp({ testName: "at0036-inactive-tug-input" });
        try {
          await app.enableDeckTrace(true);

          await app.seedDeckState({
            state: deckShape(),
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A") && window.__tug.assertHostRootRegistered("B")`,
          );

          // Click into A's md input and type "md".
          const aInputSel = `[data-card-id="A"] ${INPUT_MD_SELECTOR}`;
          const bInputSel = `[data-card-id="B"] ${INPUT_MD_SELECTOR}`;

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

          // Select all of "md" (offsets 0..2). Use the input's own
          // setSelectionRange — the user's gesture would be Cmd-A or
          // a drag, both of which set selectionStart/End on the
          // input directly.
          await app.evalJS<void>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(aInputSel)});
              if (!el) throw new Error("[m36] A's md input missing");
              el.focus();
              el.setSelectionRange(0, 2);
            })()`,
          );
          await pause(100);

          // Sanity: A's md input has the value AND selection live.
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

          // Click into B's md input. This deactivates A and activates
          // B's pane. The deactivation save fires for A, capturing
          // bag.formControls["gallery-input/size/md"].
          await app.nativeClickAtElement(bInputSel);
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "B")`,
            { timeoutMs: 2000 },
          );
          await pause(200);

          // Sanity: A's md input still holds its value live in the
          // DOM (browser doesn't clear inputs on blur). The user's
          // bug is that this state SURVIVES Cmd-Tab too.
          const postDeactivate = await app.evalJS<InputSnapshot>(
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
            postDeactivate.value,
            "post-deactivate (pre cmd-tab): value still in DOM",
          ).toBe("md");

          // Cmd-Tab away (resign) and Cmd-Tab back (become active).
          await app.simulateAppResign();
          await pause(200);
          await app.simulateAppBecomeActive();
          await pause(300);

          // After app-focus return: A is still inactive. The DOM
          // input element should still hold its value (browser
          // preserves form control state across app blur/focus).
          const postResume = await app.evalJS<InputSnapshot>(
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
            postResume.value,
            "post-resume (still inactive): value persists in DOM",
          ).toBe("md");

          // Re-activate A by clicking its md input. The user-visible
          // expectation: the typed value is still there, the
          // selection is still there.
          await app.nativeClickAtElement(aInputSel);
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && (window.__tug.getActiveCardId() === "A")`,
            { timeoutMs: 2000 },
          );
          await pause(250);

          // Final assertions — load-bearing per the user's bug report.
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
            "post-reactivate: typed value 'md' must still be in the input",
          ).toBe("md");
          expect(
            postReactivate.selectionStart,
            "post-reactivate: selection start must be 0 (user selected entire 'md')",
          ).toBe(0);
          expect(
            postReactivate.selectionEnd,
            "post-reactivate: selection end must be 2 (user selected entire 'md')",
          ).toBe(2);

          // Focus must land on the md input — the input the user
          // actually had focused before deactivation. Without the
          // focusin-tracked fallback in `captureFocus`, the
          // deactivation save captures `bag.focus = { kind: "none" }`
          // (focus had already moved to B's input by save time), and
          // the resolver falls through to the default-focus chain
          // which picks the FIRST componentStatePreservationKey input — `sm`, not `md`.
          const focusedPersistKey = await app.evalJS<string | null>(
            `(function(){
              var active = document.activeElement;
              if (!(active instanceof Element)) return null;
              return active.getAttribute("data-tug-state-key");
            })()`,
          );
          expect(
            focusedPersistKey,
            "post-reactivate: focus must land on the md input the user originally focused, not the sm input from the default-focus chain",
          ).toBe(INPUT_MD_KEY);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
