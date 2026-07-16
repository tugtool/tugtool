/**
 * at0180-list-accessory-keyboard.test.ts — list-row trailing accessories join
 * the keyboard focus language, end to end on the session picker's Recents list.
 *
 * ## What this gates
 *
 * The picker's per-row trash buttons used to be pointer-only: revealed by
 * `:hover` alone and unreachable by keyboard. This journey pins every seam of
 * the accessory keyboard model:
 *
 *   - **Engaged reveal:** the row under the keyboard movement cursor shows its
 *     trailing accessory (computed `opacity: 1`) with no pointer involvement; a
 *     non-engaged row (no cursor, not selected, provably not `:hover`) keeps it
 *     hidden (`opacity: 0`).
 *   - **Enter never descends a single-select row:** Enter on the Recents
 *     container is passthrough — it falls to the bubble default-button stage
 *     (the sheet's Open), never onto the row's accessory. Return stays the
 *     pick; Right is the descend gesture. Probed LAST, since pressing Open
 *     commits the dialog.
 *   - **Right descends onto the accessory:** ArrowRight lands the engine key
 *     view (`data-key-view-kbd`) on the row's trash button; the container is no
 *     longer the key view.
 *   - **Left and Escape both ascend:** each returns the key view to the list
 *     container with the movement cursor preserved on the same row.
 *   - **Activation → anchored confirm:** Enter on the descended trash button
 *     rides the bubble default-button stage's refusing-button branch (the
 *     button holds DOM focus and carries `data-tug-focus="refuse"`, so the
 *     stage clicks IT, not the sheet's Open default) and opens the confirm
 *     popover. Escape cancels it and restores the key view to the still-mounted
 *     trash button.
 *   - **Post-delete landing:** confirming the trash removes the row; the row
 *     scope ascends and the movement cursor + selection land on the nearest
 *     surviving row with the container holding the key view — for a mid-list
 *     row and for the last row.
 *   - **No Tab leak:** the trash buttons are registered in their row's descend
 *     scope, never the picker cycle — Tab never lands on an icon button.
 *
 * ## Why the Recents list (not Sessions)
 *
 * Both lists author their trash buttons identically (one shared focus-group
 * constant in `session-picker-cells.tsx`). The Recents trash flow commits through
 * an optimistic in-process tugbank write (`setLocalValue`), so the
 * delete-while-descended journey is fully real in the bare harness; the
 * Sessions trash needs a live ledger backend the harness lacks.
 *
 * ## Why synthetic keystrokes, and why Enter (not Space) activates the trash
 *
 * Keystrokes are dispatched as real `keydown` events on the focused element and
 * travel the same document-capture pipeline as hardware keys (see at0141's
 * rationale — the picker's seeded scroll makes native key focus fragile here).
 * One consequence: an untrusted synthetic Space cannot trigger a native
 * `<button>` activation (the act dispatch correctly leaves leaves to native),
 * so the activation assertion drives **Enter**, which runs through the bubble
 * default-button stage in JS. Space-activates-natively stays a by-eye check on
 * the real app.
 *
 * The pointer-hover hazard (an OS cursor parked over the window would force
 * `:hover` reveal and contaminate the `opacity: 0` assertion) is handled by
 * verifying the probed row does NOT match `:hover` before asserting.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const RECENTS = '[data-tug-focus-key="session-picker-cycle:1"]';
const SESSIONS = '[data-tug-focus-key="session-picker-cycle:2"]';
const OPEN = '[data-tug-focus-key="session-picker-cycle:5"]';
const PATH = '[data-tug-focus-key="session-picker-cycle:0"]';
// The native "Browse…" folder button sits between PATH and RECENTS in the walk.
const BROWSE = '[data-tug-focus-key="session-picker-cycle:0.5"]';
const PICKER_FORM = ".session-card-picker-form";
const RECENTS_LIST = ".session-card-picker-recents-list";
const POPOVER = ".tug-confirm-popover";

// Real directories on the macOS test host, so the path seed leaves Open
// enabled (at0141's convention). Four rows: a mid-list delete and a last-row
// delete both stay exercisable.
const SEED_RECENTS = ["/", "/tmp", "/usr", "/var"];

const PICKER_OPEN = `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`;

function hasKeyView(selector: string): string {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    return el ? el.hasAttribute("data-key-view-kbd") : false;
  })()`;
}

// The `data-recent-path` of the Recents row currently wearing the movement
// cursor, or null.
const CURSORED_RECENT = `(function(){
  var cell = document.querySelector('${RECENTS_LIST} [data-key-cursor]');
  if (cell === null) return null;
  var host = cell.querySelector('[data-recent-path]');
  return host ? host.getAttribute('data-recent-path') : null;
})()`;

// The trash button of the row carrying `data-recent-path=<path>`.
function rowTrash(path: string): string {
  return `document.querySelector('${RECENTS_LIST} [data-recent-path=' + ${JSON.stringify(JSON.stringify(path))} + '] .session-card-picker-recent-trash')`;
}

// Computed opacity of a row's trailing slot, by recent path. Returns null when
// the row is missing.
function trailingOpacity(path: string): string {
  return `(function(){
    var row = document.querySelector('${RECENTS_LIST} [data-recent-path=' + ${JSON.stringify(JSON.stringify(path))} + ']');
    if (row === null) return null;
    var t = row.querySelector('.tug-list-row-trailing');
    return t ? getComputedStyle(t).opacity : null;
  })()`;
}

// True when the row is provably NOT engaged: no cursor on its cell, not
// selected, and not under the OS pointer (`:hover` would contaminate the
// hidden-accessory assertion).
function rowNotEngaged(path: string): string {
  return `(function(){
    var row = document.querySelector('${RECENTS_LIST} [data-recent-path=' + ${JSON.stringify(JSON.stringify(path))} + ']');
    if (row === null) return false;
    if (row.matches(':hover')) return false;
    if (row.getAttribute('data-selected') === 'true') return false;
    var cell = row.closest('.tug-list-view-cell');
    return cell !== null && !cell.hasAttribute('data-key-cursor');
  })()`;
}

function pressKey(app: { evalJS<T>(s: string): Promise<T> }, key: string): Promise<null> {
  return app.evalJS<null>(
    `(function(){
      var el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
      return null;
    })()`,
  );
}

// Tab forward until `selector` wears the key view (at0141's helper). Bounded:
// the walk crosses stops whose presence is host-dependent (Move-all-to-Trash
// drops out when the typed path has no sessions).
async function tabUntil(
  app: {
    evalJS<T>(s: string): Promise<T>;
    waitForCondition<T>(s: string, opts?: { timeoutMs?: number }): Promise<T>;
  },
  selector: string,
  maxTabs: number,
): Promise<void> {
  for (let i = 0; i < maxTabs; i++) {
    await pressKey(app, "Tab");
    try {
      await app.waitForCondition<boolean>(hasKeyView(selector), { timeoutMs: 1_500 });
      return;
    } catch {
      // Not this stop — keep walking.
    }
  }
  throw new Error(`tab walk never reached ${selector} within ${maxTabs} tabs`);
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

describe.skipIf(!SHOULD_RUN)("AT0180: list-row accessories join the keyboard focus language", () => {
  test(
    "cursor reveals the trash, Right descends onto it, Left/Escape ascend, Enter confirms through the popover, and deletion lands the cursor on the nearest survivor",
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
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(RECENTS)}) !== null`,
          { timeoutMs: 8000 },
        );

        // Walk the cycle onto the Recents stop: the seed lands on the Sessions
        // list ([P12] Picker → New session, at0141's contract); Tab forward
        // through Trash-all (host-dependent) / Cancel / Open, wrap to the path
        // field, step through Browse, and reach Recents. Named waypoints keep
        // the wrap honest without hard-coding the hop count.
        await app.waitForCondition<boolean>(hasKeyView(SESSIONS), { timeoutMs: 8000 });
        await tabUntil(app, OPEN, 4);
        await pressKey(app, "Tab");
        await app.waitForCondition<boolean>(hasKeyView(PATH), { timeoutMs: 6000 });
        await pressKey(app, "Tab");
        await app.waitForCondition<boolean>(hasKeyView(BROWSE), { timeoutMs: 6000 });
        await pressKey(app, "Tab");
        await app.waitForCondition<boolean>(hasKeyView(RECENTS), { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(`${CURSORED_RECENT} !== null`, { timeoutMs: 6000 });
        // Settle: the sheet's open animation and the engine's focus write must
        // both be done — DOM focus resting on the list container is the signal.
        await app.waitForCondition<boolean>(
          `document.activeElement === document.querySelector(${JSON.stringify(RECENTS)})`,
          { timeoutMs: 8000 },
        );

        // (A) Engaged reveal, keyboard only. The cursor row's trailing slot is
        // visible; a non-engaged row's stays hidden. Each probe waits out the
        // 100ms reveal transition.
        const cursorPath = await app.evalJS<string | null>(CURSORED_RECENT);
        expect(cursorPath).not.toBeNull();
        await app.waitForCondition<boolean>(
          `${trailingOpacity(cursorPath as string)} === "1"`,
          { timeoutMs: 6000 },
        );
        // Probe row: any seeded row that is provably not engaged right now.
        let hiddenProbe: string | null = null;
        for (const p of SEED_RECENTS) {
          if (p === cursorPath) continue;
          if (await app.evalJS<boolean>(rowNotEngaged(p))) {
            hiddenProbe = p;
            break;
          }
        }
        expect(hiddenProbe, "no un-engaged row available to probe (pointer over the list?)").not.toBeNull();
        await app.waitForCondition<boolean>(
          `${trailingOpacity(hiddenProbe as string)} === "0"`,
          { timeoutMs: 6000 },
        );

        // Move the cursor to /tmp — the mid-list delete target.
        await pressKey(app, "ArrowDown");
        await app.waitForCondition<boolean>(
          `${CURSORED_RECENT} === ${JSON.stringify("/tmp")}`,
          { timeoutMs: 6000 },
        );

        // (C) Right descends: the key view lands on the /tmp row's trash
        // button; the container yields it.
        await pressKey(app, "ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){ var b = ${rowTrash("/tmp")}; return b !== null && b.hasAttribute("data-key-view-kbd"); })()`,
          { timeoutMs: 6000 },
        );
        expect(await app.evalJS<boolean>(hasKeyView(RECENTS))).toBe(false);

        // (D) Left ascends back to the container, cursor preserved.
        await pressKey(app, "ArrowLeft");
        await app.waitForCondition<boolean>(hasKeyView(RECENTS), { timeoutMs: 6000 });
        expect(await app.evalJS<string | null>(CURSORED_RECENT)).toBe("/tmp");

        // (E) Escape ascends too (descend again first).
        await pressKey(app, "ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){ var b = ${rowTrash("/tmp")}; return b !== null && b.hasAttribute("data-key-view-kbd"); })()`,
          { timeoutMs: 6000 },
        );
        await pressKey(app, "Escape");
        await app.waitForCondition<boolean>(hasKeyView(RECENTS), { timeoutMs: 6000 });
        expect(await app.evalJS<string | null>(CURSORED_RECENT)).toBe("/tmp");

        // (F) Activation: descend, Enter opens the anchored confirm popover
        // (the refusing-button branch clicks the trash, not Open — the picker
        // sheet is still up, which proves Open was not pressed).
        await pressKey(app, "ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){ var b = ${rowTrash("/tmp")}; return b !== null && b.hasAttribute("data-key-view-kbd"); })()`,
          { timeoutMs: 6000 },
        );
        await pressKey(app, "Enter");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPOVER)}) !== null`,
          { timeoutMs: 6000 },
        );
        expect(await app.evalJS<boolean>(PICKER_OPEN)).toBe(true);

        // (G) Escape cancels the popover; the key view restores to the
        // still-mounted trash button (the trap's opener restore), and the
        // engine re-projects DOM focus onto it (keyboard-opened surface →
        // engine owns the close-focus).
        await pressKey(app, "Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPOVER)}) === null`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){ var b = ${rowTrash("/tmp")}; return b !== null && b.hasAttribute("data-key-view-kbd"); })()`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){ var b = ${rowTrash("/tmp")}; return b !== null && document.activeElement === b; })()`,
          { timeoutMs: 6000 },
        );

        // (H) Mid-list delete: re-enter the descend fresh (Left, Right — the
        // descend's own focusKeyView guarantees DOM focus on the button for
        // the Enter below, independent of the popover's close-focus writer),
        // confirm, and the cursor + selection land on the nearest survivor.
        await pressKey(app, "ArrowLeft");
        await app.waitForCondition<boolean>(hasKeyView(RECENTS), { timeoutMs: 6000 });
        await pressKey(app, "ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){ var b = ${rowTrash("/tmp")}; return b !== null && b.hasAttribute("data-key-view-kbd"); })()`,
          { timeoutMs: 6000 },
        );
        await pressKey(app, "Enter");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPOVER)}) !== null`,
          { timeoutMs: 6000 },
        );
        await app.evalJS<null>(
          `(document.querySelectorAll('.tug-confirm-popover-actions button')[1].click(), null)`,
        );
        // /tmp is gone; the container holds the key view; the cursor landed on
        // the nearest surviving row at the same index (/usr) and — single
        // select — committed it into the path field.
        await app.waitForCondition<boolean>(
          `document.querySelector('${RECENTS_LIST} [data-recent-path=' + ${JSON.stringify(JSON.stringify("/tmp"))} + ']') === null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(hasKeyView(RECENTS), { timeoutMs: 8000 });
        await app.waitForCondition<boolean>(
          `${CURSORED_RECENT} === ${JSON.stringify("/usr")}`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(PATH)});
            return el !== null && el.value === ${JSON.stringify("/usr")};
          })()`,
          { timeoutMs: 8000 },
        );
        // Settle: the popover's close animation + teardown focus write must
        // finish before the next key press — DOM focus landing back on the
        // list container is the signal that the engine's landing is the final
        // writer and the surface is fully gone.
        await app.waitForCondition<boolean>(
          `document.activeElement === document.querySelector(${JSON.stringify(RECENTS)})`,
          { timeoutMs: 8000 },
        );

        // (I) Last-row delete: cursor to /var (the last row), trash it, and
        // the cursor lands on the NEW last row (/usr).
        await pressKey(app, "ArrowDown");
        await app.waitForCondition<boolean>(
          `${CURSORED_RECENT} === ${JSON.stringify("/var")}`,
          { timeoutMs: 6000 },
        );
        await pressKey(app, "ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){ var b = ${rowTrash("/var")}; return b !== null && b.hasAttribute("data-key-view-kbd"); })()`,
          { timeoutMs: 6000 },
        );
        await pressKey(app, "Enter");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(POPOVER)}) !== null`,
          { timeoutMs: 6000 },
        );
        await app.evalJS<null>(
          `(document.querySelectorAll('.tug-confirm-popover-actions button')[1].click(), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector('${RECENTS_LIST} [data-recent-path=' + ${JSON.stringify(JSON.stringify("/var"))} + ']') === null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(hasKeyView(RECENTS), { timeoutMs: 8000 });
        await app.waitForCondition<boolean>(
          `${CURSORED_RECENT} === ${JSON.stringify("/usr")}`,
          { timeoutMs: 8000 },
        );
        // Settle (same reason as the mid-list delete above).
        await app.waitForCondition<boolean>(
          `document.activeElement === document.querySelector(${JSON.stringify(RECENTS)})`,
          { timeoutMs: 8000 },
        );

        // (J) No Tab leak: Tab off the container; the key view never lands on
        // an icon button (the trash registrations live in row scopes, not the
        // picker cycle).
        await pressKey(app, "Tab");
        await app.waitForCondition<boolean>(`${hasKeyView(RECENTS)} === false`, { timeoutMs: 6000 });
        expect(
          await app.evalJS<boolean>(
            `document.querySelector('[data-slot="tug-icon-button"][data-key-view-kbd]') === null`,
          ),
        ).toBe(true);

        // (K) Enter on the container never descends. Enter is passthrough for
        // a single-select list — it falls to the bubble default-button stage
        // (Open, committing the dialog), which is why this probe is the
        // journey's LAST act. The keydown dispatch is synchronous, so a
        // descend would already show on the trash button here.
        let tabs = 0;
        while (!(await app.evalJS<boolean>(hasKeyView(RECENTS))) && tabs < 8) {
          await pressKey(app, "Tab");
          tabs += 1;
        }
        expect(await app.evalJS<boolean>(hasKeyView(RECENTS))).toBe(true);
        await app.waitForCondition<boolean>(`${CURSORED_RECENT} !== null`, { timeoutMs: 6000 });
        const lastCursor = await app.evalJS<string | null>(CURSORED_RECENT);
        await pressKey(app, "Enter");
        expect(
          await app.evalJS<boolean>(
            `(function(){ var b = ${rowTrash("/usr")}; return b !== null && b.hasAttribute("data-key-view-kbd"); })()`,
          ),
          `Enter descended onto the trash of ${lastCursor ?? "?"} — it must stay the pick`,
        ).toBe(false);
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
