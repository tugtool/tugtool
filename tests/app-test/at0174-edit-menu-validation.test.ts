/**
 * at0174-edit-menu-validation.test.ts — the Edit menu validates against
 * the focused responder's real edit capabilities.
 *
 * The standard Edit items (Cut / Copy / Paste / Delete / Select All /
 * Undo / Redo) and the Find items are gated by
 * `AppDelegate.validateMenuItem` from `MenuState.edit` — the web
 * responder chain's `validateAction` projected onto the menu (design
 * decision D05). The native AppKit selectors used to let WebKit validate
 * these, which over-enabled Copy and Select All because a web page is
 * always "selectable"; now enablement follows app focus.
 *
 * Two cases:
 *   1. **No editing surface focused** (a static label card): every Edit
 *      item — including Copy and Select All — and every Find item is
 *      disabled.
 *   2. **A text input focused**: the actions that text surface handles
 *      (Cut / Copy / Paste / Select All) enable, while Find stays
 *      disabled (no surface implements find).
 *   3. **Undo/Redo are card-specific.** They ride the edit caps like the
 *      other items, with depth supplied by the focused editor's
 *      `validateAction` (CM6 `undoDepth`/`redoDepth`) and a liveness gate
 *      (the FR element must hold `document.activeElement` — the chain FR
 *      is deliberately sticky, so a canvas deselect blurs the editor
 *      without demoting it). Typing into the CM6 editor enables Undo
 *      (the depth-flip refresher republishes without a focus change);
 *      clicking the empty canvas deselects/blurs and disables it;
 *      clicking back in re-enables it (per-instance history survives
 *      in-session, [L23]).
 *   4. **Native inputs ride the web view's NSUndoManager, scoped by
 *      clear-on-blur.** While a browser-native text control is focused
 *      (`nativeUndoToken` non-zero), the host validates Undo/Redo LIVE
 *      from `webView.undoManager` and executes the native `undo:` —
 *      typing lights the menu and ⌘Z works (a chord on a disabled item
 *      is eaten at the menu bar with a beep, so a dark Undo means a dead
 *      ⌘Z). The host clears the stack on every token change, so the
 *      per-web-view stack never outlives focus in one control: leave the
 *      control and its history is gone.
 *
 * Verified through the harness's native-menu introspection
 * (`menuItemState`) — the real `NSMenuItemValidation` path, not a stored
 * flag. Assertions by identifier only.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 150_000;

const CARD = (id: string) => `[data-card-id="${id}"]`;

const COPY = "edit.copy";
const CUT = "edit.cut";
const PASTE = "edit.paste";
const SELECT_ALL = "edit.selectAll";
const DELETE = "edit.delete";
const UNDO = "edit.undo";
const REDO = "edit.redo";
const FIND = "edit.find";
const FIND_NEXT = "edit.findNext";
const FIND_PREVIOUS = "edit.findPrevious";

/** One single-card pane holding a card of the given component. */
function paneOf(component: string) {
  return {
    cards: [{ id: "A", componentId: component, title: "Card A", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 60, y: 60 },
        size: { width: 640, height: 480 },
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

/** Poll the validated menu-item state until it matches `wantEnabled`. */
async function waitMenuEnabled(
  app: App,
  identifier: string,
  wantEnabled: boolean,
  timeoutMs = 8000,
): Promise<{ found: boolean; enabled?: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let last: { found: boolean; enabled?: boolean } = { found: false };
  while (Date.now() < deadline) {
    last = await app.menuItemState(identifier);
    if (last.found && last.enabled === wantEnabled) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

async function expectEnabled(app: App, identifier: string, want: boolean): Promise<void> {
  const state = await waitMenuEnabled(app, identifier, want);
  expect(state.found, `${identifier} must exist`).toBe(true);
  expect(state.enabled, `${identifier} enabled=${want}`).toBe(want);
}

describe.skipIf(!SHOULD_RUN)("AT0174: Edit-menu capability validation", () => {
  test(
    "no editing surface focused: Copy / Select All / Find all disabled",
    async () => {
      const app = await launchTugApp({ testName: "at0174-static" });
      try {
        await app.enableDeckTrace(true);
        // A static label card has no text-editing responder, so nothing
        // in focus handles any edit action.
        await app.seedDeckState({ state: paneOf("gallery-label"), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );

        await expectEnabled(app, COPY, false);
        await expectEnabled(app, SELECT_ALL, false);
        await expectEnabled(app, CUT, false);
        await expectEnabled(app, PASTE, false);
        await expectEnabled(app, UNDO, false);
        await expectEnabled(app, REDO, false);
        await expectEnabled(app, DELETE, false);
        await expectEnabled(app, FIND, false);
        await expectEnabled(app, FIND_NEXT, false);
        await expectEnabled(app, FIND_PREVIOUS, false);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0174-static] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "text input focused: Cut/Copy/Paste/Select All enable; Find stays off",
    async () => {
      const app = await launchTugApp({ testName: "at0174-textinput" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: paneOf("gallery-input"), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(`${CARD("A")} input`)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Focus the text input — it becomes the first responder, a
        // text-editing substrate that handles Cut/Copy/Paste/Select All.
        await app.nativeClickAtElement(`${CARD("A")} input`);

        await expectEnabled(app, COPY, true);
        await expectEnabled(app, CUT, true);
        await expectEnabled(app, PASTE, true);
        await expectEnabled(app, SELECT_ALL, true);

        // No surface implements find, so the Find items stay disabled
        // even with a text input focused.
        await expectEnabled(app, FIND, false);
        await expectEnabled(app, FIND_NEXT, false);
        await expectEnabled(app, FIND_PREVIOUS, false);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0174-textinput] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "CM6 editor: Undo tracks history depth and goes dark on canvas deselect",
    async () => {
      const app = await launchTugApp({ testName: "at0174-cm6undo" });
      try {
        await app.enableDeckTrace(true);
        // One pane hosting the CM6 prompt-entry editor, positioned to
        // leave empty canvas on the right for the deselect click.
        const state = {
          cards: [
            { id: "A", componentId: "gallery-prompt-entry", title: "Editor", closable: true },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 520, height: 420 },
              cardIds: ["A"],
              activeCardId: "A",
              title: "",
              acceptsFamilies: ["developer"],
            },
          ],
          activePaneId: "p1",
          hasFocus: true,
        };
        await app.seedDeckState({ state, focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        const EDITOR = `${CARD("A")} [data-slot="tug-text-editor"] .cm-content`;
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(EDITOR)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Focused editor, empty history → Undo disabled.
        await app.nativeClickAtElement(EDITOR);
        await expectEnabled(app, UNDO, false);

        // Type. CM6's history gains a step; the depth-flip refresher
        // republishes the edit caps with no focus change → Undo enables,
        // titled with the event noun ("Undo Typing").
        await app.nativeType("hello");
        await expectEnabled(app, UNDO, true);
        const undoState = await app.menuItemState(UNDO);
        expect(undoState.title, "Undo names the next step").toBe("Undo Typing");
        await expectEnabled(app, REDO, false);

        // The repro: click the empty canvas to deselect the pane. The
        // editor blurs (the chain FR goes stale on it), so its undo
        // depth must stop driving the menu — the deactivated card's
        // undo state no longer shows.
        await app.nativeMouseDown({ x: 700, y: 300 });
        await app.nativeMouseUp({ x: 700, y: 300 });
        await expectEnabled(app, UNDO, false);

        // Click back into the editor: its per-instance history survived
        // in-session, so Undo lights back up.
        await app.nativeClickAtElement(EDITOR);
        await expectEnabled(app, UNDO, true);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0174-cm6undo] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "native input: Undo rides the web view's NSUndoManager, cleared on blur",
    async () => {
      const app = await launchTugApp({ testName: "at0174-nativeundo" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: paneOf("gallery-input"), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        const INPUT = `${CARD("A")} input`;
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(INPUT)}) !== null`,
          { timeoutMs: 6000 },
        );

        // Focused, untouched input → Undo disabled (empty native stack).
        await app.nativeClickAtElement(INPUT);
        await expectEnabled(app, COPY, true);
        await expectEnabled(app, UNDO, false);

        // Type. WebKit registers the edit on the web view's NSUndoManager;
        // the host validates Undo LIVE from it (nativeUndoToken path).
        await app.nativeType("hello");
        await expectEnabled(app, UNDO, true);

        // ⌘Z executes the native undo: — the typing reverts (this is the
        // chord that used to beep when the item validated disabled).
        // Redo lights up from the same live NSUndoManager; its execution
        // path is the same wrapper shape as undo's (performRedo →
        // sendAction(redo:)), asserted by validation only — the harness's
        // synthesized cmd+shift chord doesn't reach AppKit's menu
        // matching the way a real keyboard's does (it types a literal
        // "Z"), so the chord itself isn't drivable from here.
        await app.nativeKey("z", ["cmd"]);
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(INPUT)}); return el !== null && el.value === ""; })()`,
          { timeoutMs: 6000 },
        );
        await expectEnabled(app, REDO, true);

        // Blur via canvas deselect: the token drops to 0 and the host
        // clears the native stack — the focused control's history never
        // leaks elsewhere.
        await app.nativeMouseDown({ x: 760, y: 300 });
        await app.nativeMouseUp({ x: 760, y: 300 });
        await expectEnabled(app, UNDO, false);
        await expectEnabled(app, REDO, false);

        // Clicking back in does NOT resurrect the old history — the
        // clear-on-blur semantics: keep undo while you stay, lose it when
        // you leave. Fresh typing builds a fresh stack.
        await app.nativeClickAtElement(INPUT);
        await expectEnabled(app, UNDO, false);
        await app.nativeType("x");
        await expectEnabled(app, UNDO, true);
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0174-nativeundo] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
