/**
 * at0152-confirm-popover-firstresponder-restore.test.ts — a confirm popover
 * opened over a focus-refusing LIST stop restores the FIRST RESPONDER on cancel.
 *
 * ## The repro this gates
 *
 * In the session picker, an in-list trash control opens one hoisted
 * `TugConfirmPopover` ([D14]/[D16]). The popover claims first responder on open
 * (its `handleContentFocus → makeFirstResponder`, so its own Cmd-. cancel lands —
 * its `data-tug-focus="refuse"` buttons never promote). When the user dismisses
 * the popover (Escape), the prior first responder must come back, or a
 * first-responder-routed accelerator (Cmd-.) keeps landing on the now-closed
 * popover's stale CANCEL_DIALOG handler — the user's symptom was "Cmd-. no longer
 * dismisses the card after I trashed a row and pressed Escape."
 *
 * The editor case (at0151) restores by accident: re-projecting the editor key
 * view routes through the responder focus contract, which calls
 * `makeFirstResponder` as a side effect. THIS case has no such luck — the key
 * view under the popover is a focus-refusing list stop (or null), so restoring
 * DOM focus to it never re-promotes a responder. The restore must therefore be a
 * first-class axis of the focus-mode stack: it captures the first responder at
 * push and restores it at pop, alongside the key view ([#cfrunloop-model]). This
 * test pins that the first responder returns to exactly what it was — whatever it
 * was — by construction.
 *
 * Driven through the RECENTS trash flow (it mirrors the sessions handler) because
 * Recents seed from tugbank with no backend, while the Sessions list needs a live
 * `list_sessions` round-trip the bare harness lacks. Same hoisted-popover code
 * path, same first-responder displacement.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const PICKER_FORM = ".dev-card-picker-form";
const CONFIRM_POPOVER = '[data-slot="tug-confirm-popover"]';
const TRASH_RECENT = '[data-recent-path="/tmp"] .dev-card-picker-recent-trash';

// Real directories on the macOS test host, so the recents seed renders rows
// (and the path-existence check, if a backend answers, is satisfied).
const SEED_RECENTS = ["/", "/tmp", "/usr"];

// The id the chain currently considers first responder (the value of the single
// `data-first-responder` attribute), or null. The chain writes this in lockstep
// with `makeFirstResponder` (responder-chain.ts), so it is the exact projection
// the restore must return to its pre-popover value.
const FIRST_RESPONDER = `(function(){
  var el = document.querySelector("[data-first-responder]");
  return el ? el.getAttribute("data-first-responder") : null;
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
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)(
  "AT0152: a confirm popover over a list stop restores first responder on cancel",
  () => {
    test(
      "trash a recents row → Escape cancels → first responder returns to its pre-popover value",
      async () => {
        const app = await launchTugApp({
          testName: "at0152-confirm-popover-firstresponder-restore",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          // An UNBOUND dev card presents its picker. Seed Recents in-process so a
          // trashable list row mounts (no backend needed).
          await app.waitForCondition<boolean>(PICKER_OPEN, { timeoutMs: 8000 });
          await app.evalJS<null>(
            `(window.__tug.setTugbankValue(${JSON.stringify("dev.tugtool.dev")}, ${JSON.stringify("recent-projects")}, { kind: "json", value: { paths: ${JSON.stringify(SEED_RECENTS)} } }), null)`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(TRASH_RECENT)}) !== null`,
            { timeoutMs: 8000 },
          );

          // The chain has settled on a first responder inside the picker (the
          // picker form / its list) — capture it. This is the value the restore
          // must return to.
          await app.waitForCondition<boolean>(`${FIRST_RESPONDER} !== null`, {
            timeoutMs: 8000,
          });
          const before = await app.evalJS<string | null>(FIRST_RESPONDER);
          expect(before, "a first responder must be set before opening the popover").not.toBeNull();

          // Activate the recents-row trash control → the hoisted confirm popover
          // opens and claims first responder for itself (so its Cmd-. cancel lands).
          // A synthetic `click()` (the picker scrolls the commit-home into view,
          // pushing the top rows off the visible frame so a native click can't reach
          // them — see at0141): the trash control is a focus-REFUSING `TugIconButton`,
          // so its click never moves first responder anyway; the displacement under
          // test happens when the popover's own content takes focus on open, which
          // fires regardless of how the trash control was activated.
          await app.evalJS<null>(
            `(function(){ var el = document.querySelector(${JSON.stringify(TRASH_RECENT)}); if (el) el.click(); return null; })()`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER)}) !== null`,
            { timeoutMs: 6000 },
          );
          // The popover displaced first responder (it is no longer the picker's).
          const during = await app.evalJS<string | null>(FIRST_RESPONDER);
          expect(during, "the popover claims first responder while open").not.toBe(before);

          // Escape dismisses the popover (Radix DismissableLayer owns Escape) —
          // the user's exact path before Cmd-. went dead.
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CONFIRM_POPOVER)}) === null`,
            { timeoutMs: 6000 },
          );

          // The picker survives (cancel, not confirm) and — the pin — the first
          // responder is back to exactly what it was, so a first-responder-routed
          // accelerator (Cmd-.) reaches the card again.
          expect(await app.evalJS<boolean>(PICKER_OPEN)).toBe(true);
          await app.waitForCondition<boolean>(
            `${FIRST_RESPONDER} === ${JSON.stringify(before)}`,
            { timeoutMs: 6000 },
          );
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
