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
 *      disabled (no surface implements find). Undo/Redo/Delete are left
 *      unasserted here — a text input registers neither, but an ancestor
 *      responder may (the macOS "nearest ancestor handles undo"
 *      semantics: layout / tab-reopen undo), so their state isn't a
 *      property of focusing the input. Case 1 already pins the all-off
 *      baseline.
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
});
