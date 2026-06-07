/**
 * at0141-picker-keys.test.ts — the session picker is a PERSISTENT keyboard-focus
 * cycle ([P13] persistent, [#step-picker-keys]).
 *
 * ## What this gates (failure modes, not busywork)
 *
 * The picker (the "Choose Session" sheet) used to hand-roll its own arrow model
 * (`handleArrowKey` + a parallel `PickerSelection`) and its controls were not
 * focus stops at all. This step retires that and authors the controls into the
 * sheet's already-trapped engine focus mode as one group — path field (0) →
 * Recents (1) → Sessions (2) → Move-all-to-Trash (3) → Cancel (4) → Open (5) —
 * so the engine's Tab walk owns navigation, each `TugListView` is ONE item-group
 * stop that arrow-roves internally, and `armKeyboardRestore` seeds the ring on
 * the commit-home (Open). Each assertion below fails loudly if a seam breaks:
 *
 *   - **Seed (A):** the ring rests on Open at open ([P12] Picker → Open via the
 *     focus-key seed). Fails if the smart-latch `.focus()`→`armKeyboardRestore`
 *     swap regressed or Open wasn't authored.
 *   - **Walk owns Tab + wraps (B):** Tab from Open (the last stop) wraps to the
 *     path field (order 0) and lands DOM focus on the real `<input>`. Fails if
 *     the engine walk didn't take over Tab in the sheet, the field isn't a stop,
 *     or the wrap is wrong.
 *   - **Path field releases Tab when its menu is closed (C):** Tab leaves the
 *     field for Recents. Fails if the `data-tug-tab-consume` marker is stuck on
 *     (Tab would be eaten and stay on the field).
 *   - **List = one stop with internal roving (D):** on Recents, ArrowDown moves
 *     the cursor to a different row while the *container* keeps the key view;
 *     then Tab leaves the container. Fails if rows became individual stops (Tab
 *     would step row-to-row) or the list didn't rove.
 *
 * Escape → Cancel is PRE-EXISTING sheet behavior this step does not touch (no
 * Escape wiring was added), and the engine already guarantees the persistent
 * trap cannot swallow it: the act dispatch defers Escape for a trapped mode to
 * the surface ([R04]). It rides the sheet's React-delegated `onKeyDown` cancel
 * ladder, which the synthetic-keydown path below can't faithfully drive, so it
 * stays a by-eye check rather than a flaky assertion.
 *
 * ## Why synthetic keystrokes here (not `nativeKey`)
 *
 * The keystrokes are dispatched as real `keydown` events on the focused element,
 * which travel the SAME document-level capture pipeline a hardware key does — the
 * engine's Tab-walk listener, `focusNext`, the list's arrow-rove handler, the act
 * dispatch, and the sheet's Escape ladder all run for real. What this skips is
 * only the OS→WebView delivery layer (exercised by at0140's `nativeKey`), which
 * this step does not touch. Native delivery is also impractical here: the picker
 * form scrolls its seeded commit-home (Open) into view, which pushes the top
 * field off-screen, and a native click to take OS key focus would land on an
 * off-screen target. The engine integration is what this step changes, and that
 * is what these synthetic events exercise end-to-end.
 *
 * The completion-menu-open Tab-consume case (Tab accepts a match instead of
 * leaving) needs a live `/api/fs/complete` backend the bare harness lacks, so it
 * is verified by-eye; the closed-menu release (C) is the testable half and is the
 * regression that actually bites.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

// Picker stops addressed by their stable authored focus-key (`group:order`) —
// the same attribute the engine lands `data-key-view-kbd` on, so it doubles as
// the key-view probe target and is immune to DOM-structure churn.
const PATH = '[data-tug-focus-key="dev-picker-cycle:0"]';
const RECENTS = '[data-tug-focus-key="dev-picker-cycle:1"]';
const OPEN = '[data-tug-focus-key="dev-picker-cycle:5"]';
const PICKER_FORM = ".dev-card-picker-form";

// Real directories that exist on the macOS test host, so the path-seed (first
// recent) leaves Open ENABLED whether or not a tugcast backend answers the
// directory-existence check — the seed lands on Open either way.
const SEED_RECENTS = ["/", "/tmp", "/usr"];

function hasKeyView(selector: string): string {
  return `(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    return el ? el.hasAttribute("data-key-view-kbd") : false;
  })()`;
}

// Dispatch a real `keydown` on the focused element. It travels the document
// capture pipeline exactly as a hardware key would (the engine's listeners are
// document-capture), so the focus walk / list rove / Escape ladder all run.
function pressKey(app: { evalJS<T>(s: string): Promise<T> }, key: string): Promise<null> {
  return app.evalJS<null>(
    `(function(){
      var el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
      return null;
    })()`,
  );
}

// The `data-recent-path` of the Recents row currently wearing the movement
// cursor (`data-key-cursor`), or null. Proves the cursor roves WITHIN the single
// list stop.
const CURSORED_RECENT = `(function(){
  var row = document.querySelector('.dev-card-picker-recents-list [data-key-cursor]');
  if (row === null) return null;
  var host = row.closest('[data-recent-path]') || row.querySelector('[data-recent-path]') || row;
  return host ? (host.getAttribute('data-recent-path') || row.textContent) : row.textContent;
})()`;

// DOM focus is on the path field's real <input> (the engine landed the caret on
// the editable, not a wrapper).
const PATH_INPUT_FOCUSED = `(function(){
  var el = document.querySelector(${JSON.stringify(PATH)});
  return el !== null && document.activeElement === el && el.tagName === "INPUT";
})()`;

const PICKER_OPEN = `document.querySelector(${JSON.stringify(PICKER_FORM)}) !== null`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 600 },
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

describe.skipIf(!SHOULD_RUN)("AT0141: the session picker is a persistent keyboard cycle", () => {
  test(
    "seeds Open, Tab wraps to the path field then Recents, Recents is one roving stop, and the path field releases Tab when its menu is closed",
    async () => {
      const app = await launchTugApp({ testName: "at0141-picker-keys" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );

        // An UNBOUND dev card presents its picker. Do NOT bind a session.
        await app.waitForCondition<boolean>(PICKER_OPEN, { timeoutMs: 8000 });

        // Populate Recents in-process so the list mounts as a cycle stop and the
        // path-seed fills the field (→ Open enabled → seed lands on Open).
        await app.evalJS<null>(
          `(window.__tug.setTugbankValue(${JSON.stringify("dev.tugtool.dev")}, ${JSON.stringify("recent-projects")}, { kind: "json", value: { paths: ${JSON.stringify(SEED_RECENTS)} } }), null)`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(RECENTS)}) !== null`,
          { timeoutMs: 8000 },
        );

        // (A) Seed: the ring rests on Open (the commit-home, [P12]) once the path
        // seed settles Open enabled — via the engine key view (armKeyboardRestore),
        // not a bare `.focus()`. The seed also focuses Open in the DOM, so the
        // walk below starts there.
        await app.waitForCondition<boolean>(hasKeyView(OPEN), { timeoutMs: 8000 });

        // (B) The engine walk owns Tab inside the sheet, and Open (last) wraps to
        // the path field (order 0) with DOM focus on the real <input>.
        await pressKey(app, "Tab");
        await app.waitForCondition<boolean>(hasKeyView(PATH), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(PATH_INPUT_FOCUSED)).toBe(true);

        // (C) The completion menu is closed, so the path field does NOT own Tab:
        // Tab leaves it for Recents (the next present stop). If the tab-consume
        // marker were stuck on, the key view would stay on the field.
        await pressKey(app, "Tab");
        await app.waitForCondition<boolean>(hasKeyView(RECENTS), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(hasKeyView(PATH))).toBe(false);

        // (D) Recents is ONE stop with internal arrow-roving. Landing on it seeds
        // the cursor on a row; ArrowDown moves the cursor to a DIFFERENT row while
        // the container keeps the key view (not a per-row Tab stop).
        await app.waitForCondition<boolean>(`${CURSORED_RECENT} !== null`, { timeoutMs: 6000 });
        const firstCursor = await app.evalJS<string | null>(CURSORED_RECENT);
        await pressKey(app, "ArrowDown");
        await app.waitForCondition<boolean>(
          `${CURSORED_RECENT} !== null && ${CURSORED_RECENT} !== ${JSON.stringify(firstCursor)}`,
          { timeoutMs: 6000 },
        );
        // Still the single key view — the arrow roved WITHIN it.
        expect(await app.evalJS<boolean>(hasKeyView(RECENTS))).toBe(true);

        // Return commits the roved recent into the path field (the list's
        // `delegate.onSelect` via the engine act dispatch) — the keyboard equivalent
        // of clicking the row. Fails if Return didn't route through onSelect.
        const rovedRecent = await app.evalJS<string | null>(CURSORED_RECENT);
        await pressKey(app, "Enter");
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(PATH)});
            return el !== null && el.value === ${JSON.stringify(rovedRecent)};
          })()`,
          { timeoutMs: 6000 },
        );

        // Tab now LEAVES the list (one stop, not one-per-row): the key view moves
        // off the Recents container.
        await pressKey(app, "Tab");
        await app.waitForCondition<boolean>(`${hasKeyView(RECENTS)} === false`, { timeoutMs: 6000 });
      } catch (err) {
        const tail = app.tailLog(200);
        if (tail !== "") {
          process.stderr.write(`\n[at0141-picker-keys] log tail:\n${tail}\n`);
        }
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
