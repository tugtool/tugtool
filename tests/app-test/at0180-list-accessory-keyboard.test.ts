/**
 * at0180-list-accessory-keyboard.test.ts — the combo-box dropdown's per-row
 * delete joins the keyboard, end to end on the session picker's recents.
 *
 * ## What this gates
 *
 * The recent projects live in the path combo box's dropdown ([the picker
 * redesign]); each row carries a trailing trash button. This journey pins the
 * keyboard-removal model:
 *
 *   - **Engaged reveal:** the keyboard-highlighted row shows its trailing trash
 *     (computed `opacity: 1`) with no pointer involvement; a non-highlighted row
 *     (not selected, provably not `:hover`) keeps it hidden (`opacity: 0`).
 *   - **No Tab leak:** the dropdown's trash buttons are NOT engine focus stops
 *     (no `data-tug-focusable`), so they can never take the key view or join the
 *     picker's Tab cycle.
 *   - **Shift+Delete opens the confirm, never commits the dialog:** on the
 *     highlighted row, Shift+Delete opens the hoisted `TugConfirmPopover`; the
 *     picker sheet stays up (proving Open was not pressed).
 *   - **Escape cancels, leaving the row:** the recent survives a cancelled
 *     confirm (reopening the dropdown still shows it).
 *   - **Confirm removes the row:** confirming trashes the recent (an optimistic
 *     in-process tugbank write, real in the bare harness) — reopening the
 *     dropdown no longer shows it.
 *
 * The confirm anchors to the (stable) path field, so the dropdown is free to
 * close when the confirm takes focus; each remove/cancel is verified by
 * reopening the dropdown as a menu.
 *
 * ## Why the recents (not the Sessions list)
 *
 * The recents trash commits through an optimistic in-process tugbank write
 * (`setLocalValue`), so the delete-and-verify journey is fully real in the bare
 * harness; the Sessions trash needs a live ledger backend the harness lacks.
 *
 * ## Why synthetic keystrokes
 *
 * Keystrokes are dispatched as real `keydown` events on the focused element and
 * travel the same document-capture pipeline as hardware keys (see at0141's
 * rationale — the picker's seeded scroll makes native key focus fragile here).
 * The confirm is activated by clicking the popover's Confirm button (an untrusted
 * synthetic key can't fire a native `<button>` from the trap).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const PICKER_FORM = ".session-card-picker-form";
const DROPDOWN = ".tug-combo-box-menu";
const POPOVER = ".tug-confirm-popover";

// Real directories on the macOS test host, so the path seed leaves Open enabled
// (at0141's convention). Four rows so a mid-list delete stays exercisable.
const SEED_RECENTS = ["/", "/tmp", "/usr", "/var"];

const PICKER_OPEN = `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`;

// Focus the path combo box and open its dropdown as a menu (mousedown fires the
// combo box's menu-open), so all recents rows + their trash controls mount.
const OPEN_DROPDOWN = `(function(){
  var input = document.querySelector(".session-card-picker-form input");
  if (input === null) return false;
  input.focus();
  input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  return true;
})()`;

// The `data-recent-path` of the keyboard-highlighted dropdown row, or null.
const ACTIVE_RECENT = `(function(){
  var row = document.querySelector('${DROPDOWN} .tug-completion-menu-item-selected');
  return row ? row.getAttribute('data-recent-path') : null;
})()`;

// Computed opacity of a row's trailing slot, by recent path. Null when missing.
function trailingOpacity(path: string): string {
  return `(function(){
    var row = document.querySelector('${DROPDOWN} [data-recent-path=' + ${JSON.stringify(JSON.stringify(path))} + ']');
    if (row === null) return null;
    var t = row.querySelector('.tug-combo-box-item-trailing');
    return t ? getComputedStyle(t).opacity : null;
  })()`;
}

// True when the row is provably NOT engaged: not the highlighted row and not
// under the OS pointer (`:hover` would contaminate the hidden-accessory check).
function rowNotEngaged(path: string): string {
  return `(function(){
    var row = document.querySelector('${DROPDOWN} [data-recent-path=' + ${JSON.stringify(JSON.stringify(path))} + ']');
    if (row === null) return false;
    if (row.matches(':hover')) return false;
    return !row.classList.contains('tug-completion-menu-item-selected');
  })()`;
}

// Recent path present in the dropdown right now.
function rowPresent(path: string): string {
  return `document.querySelector('${DROPDOWN} [data-recent-path=' + ${JSON.stringify(JSON.stringify(path))} + ']') !== null`;
}

// Dispatch a real `keydown` (optionally with Shift) on the focused element.
function pressKey(
  app: { evalJS<T>(s: string): Promise<T> },
  key: string,
  shift = false,
): Promise<null> {
  return app.evalJS<null>(
    `(function(){
      var el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, shiftKey: ${shift ? "true" : "false"}, bubbles: true, cancelable: true }));
      return null;
    })()`,
  );
}

// Open the dropdown and move the highlight to `path`.
async function openAndHighlight(
  app: {
    evalJS<T>(s: string): Promise<T>;
    waitForCondition<T>(s: string, opts?: { timeoutMs?: number }): Promise<T>;
  },
  path: string,
): Promise<void> {
  await app.waitForCondition<boolean>(OPEN_DROPDOWN, { timeoutMs: 8000 });
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(DROPDOWN)}) !== null`,
    { timeoutMs: 8000 },
  );
  await app.waitForCondition<boolean>(`${ACTIVE_RECENT} !== null`, { timeoutMs: 8000 });
  // Highlight starts on the first row; step down until it lands on `path`.
  for (let i = 0; i < SEED_RECENTS.length + 1; i++) {
    if ((await app.evalJS<string | null>(ACTIVE_RECENT)) === path) return;
    await pressKey(app, "ArrowDown");
  }
  throw new Error(`could not highlight ${path}`);
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 600 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0180: the combo-box dropdown's per-row delete joins the keyboard", () => {
  test(
    "the highlight reveals the trash, the trash never joins the Tab cycle, Shift+Delete opens the confirm (never Open), Escape leaves the row, and confirming removes it",
    async () => {
      const app = await launchTugApp({ testName: "at0180-list-accessory-keyboard" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(PICKER_OPEN, { timeoutMs: 8000 });

        await app.evalJS<null>(
          `(window.__tug.setTugbankValue(${JSON.stringify("dev.tugtool.dev")}, ${JSON.stringify("recent-projects")}, { kind: "json", value: { paths: ${JSON.stringify(SEED_RECENTS)} } }), null)`,
        );

        // Open the dropdown as a menu; wait for the rows and the highlight.
        await app.waitForCondition<boolean>(OPEN_DROPDOWN, { timeoutMs: 8000 });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DROPDOWN)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(`${ACTIVE_RECENT} !== null`, { timeoutMs: 8000 });

        // (A) Engaged reveal, keyboard only: the highlighted row's trash is
        // visible; a non-highlighted row's stays hidden.
        const activePath = await app.evalJS<string | null>(ACTIVE_RECENT);
        expect(activePath).not.toBeNull();
        await app.waitForCondition<boolean>(
          `${trailingOpacity(activePath as string)} === "1"`,
          { timeoutMs: 6000 },
        );
        let hiddenProbe: string | null = null;
        for (const p of SEED_RECENTS) {
          if (p === activePath) continue;
          if (await app.evalJS<boolean>(rowNotEngaged(p))) {
            hiddenProbe = p;
            break;
          }
        }
        expect(hiddenProbe, "no un-engaged row available to probe (pointer over the dropdown?)").not.toBeNull();
        await app.waitForCondition<boolean>(
          `${trailingOpacity(hiddenProbe as string)} === "0"`,
          { timeoutMs: 6000 },
        );

        // (B) No Tab leak: the dropdown's trash buttons are not engine focus
        // stops (no `data-tug-focusable`), so they can never take the key view
        // or join the picker's Tab cycle.
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll('${DROPDOWN} [data-slot="tug-icon-button"][data-tug-focusable]').length`,
          ),
        ).toBe(0);

        // (C) Shift+Delete on the highlighted /tmp row opens the anchored confirm
        // popover; the picker sheet stays up (Open was NOT pressed).
        await openAndHighlight(app, "/tmp");
        await pressKey(app, "Delete", true);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPOVER)}) !== null`,
          { timeoutMs: 6000 },
        );
        expect(await app.evalJS<boolean>(PICKER_OPEN)).toBe(true);

        // (D) Escape cancels the confirm; reopening the dropdown still shows /tmp.
        await pressKey(app, "Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPOVER)}) === null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(OPEN_DROPDOWN, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(rowPresent("/tmp"), { timeoutMs: 6000 });

        // (E) Shift+Delete again → confirm → click Confirm: /tmp is trashed, and
        // reopening the dropdown no longer shows it.
        await openAndHighlight(app, "/tmp");
        await pressKey(app, "Delete", true);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPOVER)}) !== null`,
          { timeoutMs: 6000 },
        );
        await app.evalJS<null>(
          `(document.querySelectorAll('.tug-confirm-popover-actions button')[1].click(), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPOVER)}) === null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(OPEN_DROPDOWN, { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(DROPDOWN)}) !== null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(`${rowPresent("/tmp")} === false`, { timeoutMs: 8000 });
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0180-list-accessory-keyboard] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
