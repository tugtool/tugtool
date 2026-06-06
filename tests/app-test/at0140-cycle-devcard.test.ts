/**
 * at0140-cycle-devcard.test.ts — the dev card joins the keyboard-focus-cycling
 * mode: ⌥⇥ seeds the submit (the commit-home), ⌥⇥ again restores the editor
 * caret ([P09]/[P10]/[P12], [#step-cycle-devcard]).
 *
 * ## Why this exists
 *
 * The cycle mechanism is proven generically on `gallery-cycle-demo` (at0139).
 * This test gates the *real consumer*: a connected dev card. The submit button
 * (Z5), authored into the card's cycle scope via `TugPromptEntry`'s
 * `submitFocusGroup`, is the commit-home — the lowest-order stop the mode seeds
 * on entry. The card root carries `data-cycling`, the engine signal the
 * fill-suppression CSS keys on.
 *
 * The walk:
 *   1. **rest:** clicking the editor puts the caret there (base mode); the card
 *      reads `data-cycling="false"` and the submit holds no key view.
 *   2. **empty editor → submit is skipped:** the submit's empty-input gate
 *      disables it, so ⌥⇥ does NOT seed it — the walk skips the disabled
 *      control and seeds the next live stop (the route). ⌥⇥ off restores the
 *      caret.
 *   3. **typed editor → submit seeds:** with content, the submit is actionable;
 *      ⌥⇥ seeds the submit commit-home.
 *   4. **Tab tours the stops:** Tab moves submit → route (Z4A), then wraps back
 *      to the submit commit-home (trapped — only the card's stops are walked).
 *   5. **toggle off (⌥⇥):** the mode pops, `data-cycling="false"`, the submit
 *      drops the key view, and DOM focus returns to the editor caret.
 *
 * Mode keys (Return / Space) are a later step; this gates the dev-card
 * push/seed/wrap/restore + the `data-cycling` signal. The Picker → Open default
 * focus is environment-sensitive (it depends on whether a valid path seeds Open
 * enabled), so it is verified by-eye rather than asserted here.
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

// Whether the submit button currently holds the keyboard key view.
const SUBMIT_HAS_KEY_VIEW = `(function(){
  var el = document.querySelector(${JSON.stringify(SUBMIT)});
  return el ? el.hasAttribute("data-key-view-kbd") : false;
})()`;

// Whether the route group holds the keyboard key view. The route is an
// item-group: its root registers the focusable, so `data-key-view-kbd` lands
// on the group root itself (the arrow cursor `data-key-cursor` rides a child).
const ROUTE_HAS_KEY_VIEW = `(function(){
  var el = document.querySelector(${JSON.stringify(ROUTE)});
  return el ? el.hasAttribute("data-key-view-kbd") : false;
})()`;

// Whether DOM focus is on the editor's content surface (the restored caret).
const EDITOR_FOCUSED = `(function(){
  var el = document.querySelector(${JSON.stringify(EDITOR)});
  return el !== null && document.activeElement === el;
})()`;

describe.skipIf(!SHOULD_RUN)("AT0140: the dev card joins the focus cycle", () => {
  test(
    "⌥⇥ skips the disabled (empty) submit, seeds it once typed, Tab tours submit → route → wrap, ⌥⇥ restores the editor caret",
    async () => {
      const app = await launchTugApp({ testName: "at0140-cycle-devcard" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A");
        await app.awaitEngineReady("A");

        // The connected body is up: the submit button mounts and is authored
        // into the cycle scope (a registered focusable).
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

        // (1) Put the caret in the editor (base mode). The card is not cycling
        // and the submit holds no key view.
        await app.nativeClickAtElement(EDITOR);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(await app.evalJS<string | null>(CYCLING)).toBe("false");
        expect(await app.evalJS<boolean>(SUBMIT_HAS_KEY_VIEW)).toBe(false);

        // (2) Empty editor → the submit is disabled (its empty-input gate), so
        // it is NOT a Tab target: ⌥⇥ skips it and seeds the next live stop, the
        // route. The disabled submit never takes the key view.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(SUBMIT_HAS_KEY_VIEW)).toBe(false);
        // ⌥⇥ off → back to the editor caret.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });

        // Type into the editor so the submit becomes actionable (and thus a
        // cycle stop).
        await app.nativeType("hello");
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(SUBMIT)});
            return el !== null && el.closest(${JSON.stringify(`${CARD} [data-slot="tug-prompt-entry"]`)})
              ?.getAttribute("data-empty") === "false";
          })()`,
          { timeoutMs: 6000 },
        );

        // (3) Non-empty editor → ⌥⇥ seeds the submit commit-home.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(SUBMIT_HAS_KEY_VIEW, { timeoutMs: 6000 });

        // (4) Tab tours the stops: submit → route, then wraps back to the
        // submit commit-home (trapped to the card's two stops).
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(SUBMIT_HAS_KEY_VIEW)).toBe(false);
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(SUBMIT_HAS_KEY_VIEW, { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(ROUTE_HAS_KEY_VIEW)).toBe(false);

        // (5) ⌥⇥ → cycling off; the submit drops the key view and the caret
        // returns to the editor ([P12] Connected → editor).
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(SUBMIT_HAS_KEY_VIEW)).toBe(false);
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0140-cycle-devcard] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
