/**
 * at0157-cycle-escape-two-pane.test.ts — Escape is mode-stack ordering, not a
 * DOM heuristic: with a surface open over a cycle, one Escape closes the
 * surface and the next Escape exits the cycle.
 *
 * ## What this pins
 *
 * Two cases, one principle (cycle-with-surface-open is `[…, cycle, surfaceTrap]`
 * on the engine's mode stack; Escape pops the top entry):
 *
 *   - **Same-pane (hard pin, current behavior):** a dev card cycling with one of
 *     its Z2 status popovers open. The FIRST Escape closes only the popover and
 *     the ring returns to the originating cell — the card is STILL cycling
 *     (at0140 step 6 already pins this half). The SECOND Escape — the new axis —
 *     exits the cycle and returns the caret to the editor. This is the pure
 *     stack-ordering sequence the engine ladder must preserve at every step of
 *     the mode-stack refactor.
 *
 *   - **Cross-pane (pinned TARGET, see `#step-7`):** a cycle active in pane A
 *     while an unrelated popover is open in pane B must NOT have its Escape-exit
 *     suppressed by the peer-pane surface. Today the DOM probe
 *     `aDismissableSurfaceIsOpen()` is document-global, so a popover anywhere
 *     suppresses the cycle's Escape-exit in the pane the user is actually in —
 *     the bug this refactor deletes. The case is authored as `test.todo` here
 *     (the intended behavior, not yet true on `main`) and flipped to a live,
 *     hard-asserting test when the probe is deleted.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const ROOT = `${CARD} [data-testid="dev-card"]`;
const SUBMIT = `${CARD} .tug-prompt-entry-submit-button`;
const ROUTE = `${CARD} [data-slot="tug-choice-group"][aria-label="Route"]`;
const EDITOR = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const Z2_TIME = `${CARD} [data-priority="time"]`;

function hasKeyView(selector: string): string {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    return el ? el.hasAttribute("data-key-view-kbd") : false;
  })()`;
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
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

// `data-cycling` on the dev-card root, or null.
const CYCLING = `(function(){
  var el = document.querySelector(${JSON.stringify(ROOT)});
  return el ? el.getAttribute("data-cycling") : null;
})()`;

const ROUTE_HAS_KEY_VIEW = `(function(){
  var el = document.querySelector(${JSON.stringify(ROUTE)});
  return el ? el.hasAttribute("data-key-view-kbd") : false;
})()`;

const EDITOR_FOCUSED = `(function(){
  var el = document.querySelector(${JSON.stringify(EDITOR)});
  return el !== null && document.activeElement === el;
})()`;

const POPOVER_OPEN = `document.querySelector('[data-slot="tug-popover"]') !== null`;

describe.skipIf(!SHOULD_RUN)("AT0157: Escape over a cycle is mode-stack ordering", () => {
  test(
    "same pane: first Escape closes the popover (cycle survives), second Escape exits the cycle",
    async () => {
      const app = await launchTugApp({ testName: "at0157-cycle-escape-two-pane" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A");
        await app.awaitEngineReady("A");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SUBMIT)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(SUBMIT)});
            return el !== null && el.hasAttribute("data-tug-focusable");
          })()`,
          { timeoutMs: 6000 },
        );

        // Caret in the editor (base mode).
        await app.nativeClickAtElement(EDITOR);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Type content so the submit button is actionable — and thus a live
        // cycle stop. With an empty editor the disabled submit is skipped, which
        // would shift the Tab count below.
        await app.nativeType("hello");
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(SUBMIT)});
            return el !== null && el.closest(${JSON.stringify(`${CARD} [data-slot="tug-prompt-entry"]`)})
              ?.getAttribute("data-empty") === "false";
          })()`,
          { timeoutMs: 6000 },
        );

        // ⌥⇥ to start cycling (route seeded).
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });

        // Tab to the TIME status cell and Return to open its popover.
        // route→Mode→Model→Effort→submit→STATE→TIME (6 Tabs; the submit is a
        // live stop now that the editor has content).
        for (let i = 0; i < 6; i++) await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_TIME), { timeoutMs: 6000 });
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(POPOVER_OPEN, { timeoutMs: 6000 });
        // The popover trap is on top of the card's cycle scope; the card still
        // reads as cycling (its scope remains on the stack).
        expect(await app.evalJS<string | null>(CYCLING)).toBe("true");

        // FIRST Escape: the top mode is the popover trap → it closes; the ring
        // returns to the TIME cell; the card is STILL cycling and DOM focus did
        // not fall back to the editor. (at0140 step 6 pins this half too.)
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(`${POPOVER_OPEN} === false`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(hasKeyView(Z2_TIME), { timeoutMs: 6000 });
        expect(await app.evalJS<string | null>(CYCLING)).toBe("true");
        expect(await app.evalJS<boolean>(EDITOR_FOCUSED)).toBe(false);

        // SECOND Escape (the new axis): the cycle is now the top mode → it exits
        // and the caret returns to the editor. No DOM heuristic consulted — pure
        // stack ordering: pop the popover, then pop the cycle.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0157-cycle-escape-two-pane] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // Cross-pane: a cycle active in pane A must exit on Escape regardless of an
  // unrelated popover open in pane B (no peer-pane surface can suppress it).
  //
  // RESOLVED STRUCTURALLY, not by a live gesture test. The bug was the
  // document-global DOM probe `aDismissableSurfaceIsOpen()`; that probe is now
  // DELETED (the plan's #step-7 — verified by a zero-hit grep in the Step 7 and
  // Step 8 checkpoints), and the Escape ladder reads `currentFocusMode()` of the
  // ACTIVE context (the key card) only, so a peer pane's surface — on a different
  // `FocusContext` — is structurally invisible to pane A's Escape.
  //
  // Why this is NOT a live app-test: constructing two live cross-pane surfaces is
  // precluded by two real interaction rules that are mutually exclusive here —
  // clicking pane B to open its popover exits pane A's cycle (the mouse-exit rule,
  // at0140 step 8), while clicking pane A to start its cycle dismisses pane B's
  // popover (Radix outside-pointerdown), and there is no keyboard pane-switch
  // chord to break the deadlock. The plan's #fixture-notes anticipated this:
  // "if even that can't realistically survive, that finding itself resolves the
  // cross-pane case — document it and pin the same-pane case hard" (above).
  test.todo(
    "cross pane: a peer-pane popover cannot suppress the cycle's Escape-exit (structural — probe deleted; see comment)",
    () => {
      // No live body: resolved structurally by the probe's deletion, not
      // constructible via realistic gestures (see the comment above).
    },
  );
});
