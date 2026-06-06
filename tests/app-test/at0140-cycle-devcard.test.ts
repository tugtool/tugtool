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
 *   2. **empty editor → submit is skipped:** ⌥⇥ seeds the route; touring the
 *      live stops (route → Mode → Model → Effort → wrap) never lands on the
 *      submit, because its empty-input gate disables it. ⌥⇥ off restores caret.
 *   3. **typed editor → route seeds:** with content, ⌥⇥ seeds the route (the
 *      first stop in the revised order).
 *   4. **Tab tours the stops:** route → Mode → Model → Effort → submit →
 *      editor → wrap (trapped). The editor is the last stop — a text stop: the
 *      input area takes the ring while the editor stays blurred (no caret).
 *      (Z2 joins in a later slice.)
 *   5. **Return on the editor stop resumes typing ([P11]):** it descends into
 *      the editor, exiting cycling and returning the caret. (⌥⇥ also exits.)
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
const MODE_CHIP = `${CARD} [data-slot="permission-mode-chip"]`;
const MODEL_CHIP = `${CARD} [data-slot="model-chip"]`;
const EFFORT_CHIP = `${CARD} [data-slot="effort-chip"]`;
const INPUT_AREA = `${CARD} .tug-prompt-entry-input-area`;
const EDITOR = `${CARD} [data-slot="tug-text-editor"] .cm-content`;

// Expression: does the element at `selector` hold the keyboard key view? Works
// for leaf stops (submit, chips — the element carries `data-key-view-kbd`) and
// item-group stops (the route — its group root carries it).
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
    "⌥⇥ seeds the route, Tab tours route → Mode → Model → Effort → submit → editor → wrap, skips the disabled submit when empty, Return on the editor stop resumes typing",
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

        // (2) Empty editor → ⌥⇥ seeds the route; the submit is disabled (its
        // empty-input gate), so it is NOT a Tab target — touring the live stops
        // (route → Mode → Model → Effort → editor → wrap) skips it: Tab steps
        // from Effort straight to the editor, never landing on the submit.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(MODE_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(MODEL_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(EFFORT_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        // Effort → editor (the disabled submit is skipped).
        await app.waitForCondition<boolean>(hasKeyView(INPUT_AREA), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(SUBMIT_HAS_KEY_VIEW)).toBe(false);
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
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

        // (3) Non-empty editor → ⌥⇥ seeds the route (the first stop, [P10]
        // revised order — the cycle now seeds at the route, not the submit).
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });

        // (4) Tab tours the stops left→right, up to the editor, then wraps back
        // to the route (trapped): route → Mode → Model → Effort → submit →
        // editor → route. (Z2 joins in a later slice.) The editor is the last
        // stop — a text stop: the input area takes the ring while the editor
        // stays blurred.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(MODE_CHIP), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(ROUTE_HAS_KEY_VIEW)).toBe(false);
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(MODEL_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(EFFORT_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(SUBMIT_HAS_KEY_VIEW, { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(INPUT_AREA), { timeoutMs: 6000 });
        // The editor text-stop holds the ring but the caret is NOT active (the
        // editor is blurred during cycling).
        expect(await app.evalJS<boolean>(EDITOR_FOCUSED)).toBe(false);
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });

        // (5) Return on the editor text-stop resumes typing ([P11]): it descends
        // into the editor, which exits cycling and returns the caret. First Tab
        // back onto the editor stop, then Return.
        await app.nativeKey("Tab", ["alt"]); // exit cycling (back to editor)
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });
        // Re-enter, walk to the editor stop, and Return to resume typing.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        for (let i = 0; i < 5; i++) await app.nativeKey("Tab"); // route→…→submit→editor
        await app.waitForCondition<boolean>(hasKeyView(INPUT_AREA), { timeoutMs: 6000 });
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
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
