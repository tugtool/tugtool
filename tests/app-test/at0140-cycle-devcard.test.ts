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
 *      live stops (route → Mode → Model → Effort → STATE → TIME → TOKENS →
 *      CONTEXT → TASKS → editor → wrap) never lands on the submit, because its
 *      empty-input gate disables it. ⌥⇥ off restores caret.
 *   3. **typed editor → route seeds:** with content, ⌥⇥ seeds the route (the
 *      first stop in the revised order).
 *   4. **Tab tours the stops:** route → Mode → Model → Effort → submit → STATE
 *      → TIME → TOKENS → CONTEXT → TASKS → editor → wrap (trapped). Each Z2
 *      status cell is its own leaf stop ([P10] revised — no arrow-roving): Tab
 *      steps cell-to-cell and each wears the blue leaf ring in turn. The editor
 *      is the last stop — a text stop: the input area takes the border while the
 *      editor stays blurred (no caret).
 *   5. **Return on the editor stop resumes typing ([P11]):** it descends into
 *      the editor, exiting cycling and returning the caret. (⌥⇥ also exits.)
 *   6. **Z2 popover keeps the cycle:** Return on a cell opens its popover;
 *      Escape returns the ring to the same cell — still cycling, editor
 *      untouched (the focus engine owns close-focus; the service-popup binding
 *      defers).
 *   7. **Using the mouse exits cycling (editor):** a click on the editor ends
 *      the cycle and returns the caret — the comprehensive rule for toggleable
 *      cycling (no ⌥⇥ needed).
 *   8. **Using the mouse exits cycling (Z4B chip):** re-enter, then a click on
 *      the Mode chip exits the cycle too (and opens its picker by mouse). The
 *      keyboard path — a sheet opened from a cycle stop returns the ring to that
 *      chip via the same engine-owns close-focus as the step-6 popover — lands
 *      with the cycle mode keys (#step-cycle-keys).
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
// The five Z2 status cells. Each is its own leaf cycle stop ([P10]
// revised — no item-group roving): the cell `<button>` carries
// `data-key-view-kbd` (and the leaf ring) when it is the active stop.
const Z2_STATE = `${CARD} [data-priority="state"]`;
const Z2_TIME = `${CARD} [data-priority="time"]`;
const Z2_TOKENS = `${CARD} [data-priority="tokens"]`;
const Z2_CONTEXT = `${CARD} [data-priority="context"]`;
const Z2_TASKS = `${CARD} [data-priority="tasks"]`;
// A settings sheet opened from a cycle-stop chip (here the permission-mode chip,
// which populates reliably headless) and one of its option rows.
const SHEET = '[data-slot="tug-sheet"]';
const SHEET_OPTION = `${SHEET} [data-mode]`;

// Expression: does the element at `selector` hold the keyboard key view? Works
// for leaf stops (submit, chips, the Z2 cells — the element carries
// `data-key-view-kbd`) and item-group stops (the route — its group root does).
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

// Whether a popover (portaled status-cell detail) is currently open.
const POPOVER_OPEN = `document.querySelector('[data-slot="tug-popover"]') !== null`;

// The editor's text content (the CodeMirror content surface). Used to prove that
// typing actually lands after a route commit relinquishes the cycle ([P15]).
const EDITOR_TEXT = `(function(){
  var el = document.querySelector(${JSON.stringify(EDITOR)});
  return el ? el.textContent : null;
})()`;

describe.skipIf(!SHOULD_RUN)("AT0140: the dev card joins the focus cycle", () => {
  test(
    "⌥⇥ seeds the route, Tab tours route → Mode → Model → Effort → submit → STATE → TIME → TOKENS → CONTEXT → TASKS → editor → wrap (each Z2 cell a leaf stop), skips the disabled submit when empty, Return on the editor stop resumes typing",
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
        // (route → Mode → Model → Effort → STATE → … → TASKS → editor → wrap)
        // skips it: Tab steps from Effort straight to STATE, never the submit.
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
        // Effort → STATE (the disabled submit is skipped). Each Z2 cell is
        // its own leaf stop, so Tab steps cell-to-cell through the row.
        await app.waitForCondition<boolean>(hasKeyView(Z2_STATE), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(SUBMIT_HAS_KEY_VIEW)).toBe(false);
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_TIME), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_TOKENS), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_CONTEXT), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_TASKS), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        // TASKS → editor.
        await app.waitForCondition<boolean>(hasKeyView(INPUT_AREA), { timeoutMs: 6000 });
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
        // submit → the five Z2 cells, each its own leaf stop ([P10] revised):
        // STATE → TIME → TOKENS → CONTEXT → TASKS. Each cell carries the leaf
        // key view (and the blue ring) in turn — no arrow-roving.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_STATE), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(SUBMIT_HAS_KEY_VIEW)).toBe(false);
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_TIME), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(hasKeyView(Z2_STATE))).toBe(false);
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_TOKENS), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_CONTEXT), { timeoutMs: 6000 });
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_TASKS), { timeoutMs: 6000 });
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
        // route→Mode→Model→Effort→submit→STATE→TIME→TOKENS→CONTEXT→TASKS→editor.
        for (let i = 0; i < 10; i++) await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(INPUT_AREA), { timeoutMs: 6000 });
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });

        // (6) A status-cell popover opened from a Z2 cell must not be read as a
        // cycle exit ([P10]). Re-enter, Tab to TIME, Return to open its popover,
        // Escape to close: the popover pushes a nested focus mode on top of the
        // card's cycle scope, but the card is STILL cycling (its scope remains
        // on the stack), so closing the popover returns the ring to the SAME
        // cell — focus is NOT yanked to the editor and the cycle position is not
        // lost.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
        // route→Mode→Model→Effort→submit→STATE→TIME (6 Tabs).
        for (let i = 0; i < 6; i++) await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(Z2_TIME), { timeoutMs: 6000 });
        // Return opens the TIME cell's popover (the cell `<button>` activates).
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(POPOVER_OPEN, { timeoutMs: 6000 });
        // While the popover is open the card's cycle scope is covered but still
        // on the stack — the card reads as cycling, NOT exited.
        expect(await app.evalJS<string | null>(CYCLING)).toBe("true");
        // Escape closes the popover. The ring returns to the TIME cell, the card
        // is still cycling, and DOM focus did not fall back to the editor.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(`${POPOVER_OPEN} === false`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(hasKeyView(Z2_TIME), { timeoutMs: 6000 });
        expect(await app.evalJS<string | null>(CYCLING)).toBe("true");
        expect(await app.evalJS<boolean>(EDITOR_FOCUSED)).toBe(false);

        // (7) Comprehensive rule: USING THE MOUSE EXITS CYCLING. From step 6
        // (still cycling, cycle is the top mode), a CLICK on the editor ends the
        // cycle and returns the caret — no ⌥⇥ needed.
        await app.nativeClickAtElement(EDITOR);
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });

        // (8) The mouse-exit rule also fires for a click on a Z4B chip: re-enter
        // cycling, then a CLICK on the Mode chip exits the cycle (a mouse click
        // leaves keyboard cycling) AND opens the chip's picker. Closing it then
        // restores the prompt-entry caret (the cycle has exited — no keyboard key
        // view — so close-focus falls to the editor, not the chip).
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.nativeClickAtElement(MODE_CHIP);
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
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

  test(
    "committing the route group by keyboard relinquishes the cycle ([P15]): Space commits + exits cycling, returns the caret, and typing lands",
    async () => {
      const app = await launchTugApp({ testName: "at0140-cycle-devcard-commit" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A");
        await app.awaitEngineReady("A");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(ROUTE)}) !== null`,
          { timeoutMs: 8000 },
        );

        // Caret in the editor (base mode, not cycling).
        await app.nativeClickAtElement(EDITOR);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });

        // ⌥⇥ enters cycling and seeds the route group (the first stop).
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });

        // Arrow to rove the route cursor to the other choice, then Space to commit
        // it. Under explicit commit ([P24]) arrows only ring; **Space** is the
        // group commit (an item-group `select`) — Return no longer commits a group
        // member, it bubbles to the scope default. In a toggleable cycle a value
        // commit's disposition is RELINQUISH ([P15]).
        await app.nativeKey("ArrowRight");
        await app.nativeKey(" ");

        // The cycle is relinquished: the card stops cycling, the engine returns
        // the key view to the editor, and DOM focus lands the caret there — no
        // caret-without-key-view desync.
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(ROUTE_HAS_KEY_VIEW)).toBe(false);

        // The definitive proof the desync is gone: typing actually lands in the
        // editor (before the fix, the cycle still owned the keys and this failed).
        await app.nativeType("ZZZ");
        await app.waitForCondition<boolean>(
          `(${EDITOR_TEXT} || "").indexOf("ZZZ") !== -1`,
          { timeoutMs: 6000 },
        );
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0140-cycle-devcard-commit] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "arrows give the cycle a 2D feel: a toolbar ring + a seam to the status row; a disabled stop is skipped; the editor is not an arrow stop",
    async () => {
      const app = await launchTugApp({ testName: "at0140-cycle-devcard-arrows" });
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

        // Caret in the editor (base mode).
        await app.nativeClickAtElement(EDITOR);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // ---- Phase 1: a disabled stop is skipped --------------------------------
        // Empty editor → the submit is disabled. ⌥⇥ seeds the route; Tab to the
        // Effort chip, then ArrowRight resolves toward the (disabled) submit — the
        // navigator must NOT strand the ring on it: it skips to the next live stop
        // (the STATE cell), never beeping.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
        for (let i = 0; i < 3; i++) await app.nativeKey("Tab"); // route→Mode→Model→Effort
        await app.waitForCondition<boolean>(hasKeyView(EFFORT_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(hasKeyView(Z2_STATE), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(SUBMIT_HAS_KEY_VIEW)).toBe(false);

        // ArrowUp from the status row seams back to the toolbar (its first member,
        // the route) — and NOT to the editor, which is excluded from the grid.
        await app.nativeKey("ArrowUp");
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(hasKeyView(INPUT_AREA))).toBe(false);

        // Exit, type so the full toolbar (incl. submit) is live.
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });
        await app.nativeType("hello");
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(SUBMIT)});return el!==null && el.closest(${JSON.stringify(`${CARD} [data-slot="tug-prompt-entry"]`)})?.getAttribute("data-empty")==="false";})()`,
          { timeoutMs: 6000 },
        );

        // ---- Phase 2: the toolbar ring + the cross-row seam ---------------------
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });

        // Tab to the Mode chip (a leaf), then Left/Right ring the toolbar.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(MODE_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(hasKeyView(MODEL_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(hasKeyView(EFFORT_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(SUBMIT_HAS_KEY_VIEW, { timeoutMs: 6000 });
        // Right off the last toolbar member wraps the closed ring back to the route.
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
        // Left reverses (route → submit, the ring's other edge).
        await app.nativeKey("ArrowLeft");
        await app.waitForCondition<boolean>(SUBMIT_HAS_KEY_VIEW, { timeoutMs: 6000 });

        // The cross-row seam: Down from a toolbar chip enters the status row; Up
        // returns to the toolbar. Tab back to the Mode chip first.
        await app.nativeKey("ArrowLeft"); // submit → effort
        await app.nativeKey("ArrowLeft"); // effort → model
        await app.nativeKey("ArrowLeft"); // model → mode
        await app.waitForCondition<boolean>(hasKeyView(MODE_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(hasKeyView(Z2_STATE), { timeoutMs: 6000 });
        await app.nativeKey("ArrowUp");
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });
        // Across the whole arrow sequence the editor was never an arrow stop and
        // the card never left cycling (no dead-end, no beep).
        expect(await app.evalJS<boolean>(hasKeyView(INPUT_AREA))).toBe(false);
        expect(await app.evalJS<string | null>(CYCLING)).toBe("true");
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0140-cycle-devcard-arrows] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "committing a settings picker opened from a cycle stop exits cycling and returns the blinking caret to the editor ([P15])",
    async () => {
      const app = await launchTugApp({ testName: "at0140-cycle-devcard-picker" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A");
        await app.awaitEngineReady("A");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MODE_CHIP)}) !== null`,
          { timeoutMs: 8000 },
        );

        // Caret in the editor, then ⌥⇥ to start cycling (route seeded).
        await app.nativeClickAtElement(EDITOR);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await app.nativeKey("Tab", ["alt"]);
        await app.waitForCondition<boolean>(`${CYCLING} === "true"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(ROUTE_HAS_KEY_VIEW, { timeoutMs: 6000 });

        // Tab to the permission-mode chip and open its sheet by keyboard (so the
        // engine owns close-focus and the cycle is preserved underneath).
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKeyView(MODE_CHIP), { timeoutMs: 6000 });
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET_OPTION)}) !== null`,
          { timeoutMs: 6000 },
        );
        // The sheet (a nested trap) covers the cycle scope but the card is STILL
        // cycling — opening a picker is not an exit.
        expect(await app.evalJS<string | null>(CYCLING)).toBe("true");

        // Return commits the sheet's default (OK). Committing a setting from a
        // cycle stop ENDS focus-cycling and returns the blinking caret to the
        // editor ([P15]): the sheet closes, the card stops cycling, and DOM focus
        // lands in the prompt — not stranded on a chip or a blurred editor.
        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET_OPTION)}) === null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(`${CYCLING} === "false"`, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(EDITOR_FOCUSED, { timeoutMs: 6000 });
        expect(
          await app.evalJS<string | null>(CYCLING),
          "committing a cycle-stop picker exits cycling",
        ).toBe("false");
        expect(
          await app.evalJS<boolean>(EDITOR_FOCUSED),
          "the caret returns to the editor",
        ).toBe(true);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0140-cycle-devcard-picker] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
