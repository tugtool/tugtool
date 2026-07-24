/**
 * at0267-drag-activation-focus.test.ts — a drag is a content gesture, not a
 * focus gesture (tuglaws/focus-language.md § Drag and the keyboard).
 *
 * The repro this pins: a prompt-entry card holds the keyboard while the Lens
 * sits inactive beside it, and the user grabs a snippet row in the Lens.
 * Every scenario below was a distinct failure before the drag doctrine landed:
 *
 *  1. **Selection commits on mousedown.** A mousedown on an inactive Lens's
 *     snippet row moves the list's owned selection to that row immediately —
 *     so the drag carries the row it selected — and does NOT activate the
 *     Lens. Selection used to ride `click`, which no drag ever produces.
 *
 *  2. **Mouseup commits the activation.** The same gesture ended without a
 *     drag is a plain click: the Lens activates on mouseup.
 *
 *  3. **Dragstart cancels the activation.** A `dragstart` between the down and
 *     the up means the gesture was a drag: the source card stays inactive
 *     (macOS background-drag semantics) and the keyboard stays where it was.
 *
 *  4. **One click brings the card back with its caret.** Returning to the
 *     entry from the Lens takes exactly ONE click: the card activates and the
 *     caret lands. It used to take three — the unguarded engine re-`focus()`
 *     of an already-focused contenteditable blurs to `<body>` in WebKit, and
 *     the watchdog does not correct `<body>`.
 *
 *  5. **A drop claims no focus.** A snippet drop into a NON-key card's prompt
 *     entry inserts the text and moves neither `document.activeElement`, nor
 *     the active card, nor the focus engine's ledger. The drop used to end in
 *     a raw `view.focus()`, leaving a blinking caret and live typing in a card
 *     that was never activated.
 *
 *  6. **One click works after a REAL drag from a parked-sink start.**
 *     Deselect via the deck canvas, run a genuine CGEvent-driven drag (WebKit
 *     runs the real drag session) from the never-activated Lens into the
 *     entry, then click the entry ONCE: the card activates with its caret.
 *     Two defects used to stack here. First, WebKit delivers no `pointerdown`
 *     for the first click after a native drag session (the drag consumed the
 *     stream's release), so every pointerdown-driven layer missed the click
 *     entirely — healed by the pane-focus-controller's pointer-stream resync,
 *     which synthesizes the missing pointerdown off the orphan mousedown.
 *     Second, the drag churn leaves `document.activeElement` parked on the
 *     engine's key sink, and the focus-theft gate used to read the sink as
 *     "the user has focus somewhere real" and refuse the activation's focus
 *     dispatch — engine registers settled, no DOM grant, no caret.
 * Ledger assertions are scenario-scoped: the report is snapshotted before and
 * after each scenario and the DELTA asserted, so one scenario's corrections
 * can never be absorbed by another's budget.
 *
 * @covers tugdeck/src/focus-theft-gate.ts
 * @covers tugdeck/src/components/chrome/pane-focus-controller.ts
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/tug-text-editor/drop-extension.ts
 * @covers tugdeck/src/components/tugways/tug-text-editor/state-preservation.ts
 * @covers tugdeck/src/components/tugways/responder-chain-provider.tsx
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/lib/snippet-drag.ts
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const ENTRY_CARD_ID = "A";
const LENS_CARD_ID = "lens-card";
const SNIPPET_MIME = "application/x-tug-snippet";
const ENTRY_EDITOR = '[data-slot="tug-text-editor"] .cm-content';

/** A snippet row's draggable label, by snippet id. */
function rowLabel(id: string): string {
  return `.lens-snippets-list .snippet-row-content[data-snippet-id="${id}"] .snippet-row-label`;
}

/** The list cell wrapping a snippet row, by snippet id. */
function selectedSnippetIdExpr(): string {
  return `(() => {
    const cell = document.querySelector('.lens-snippets-list .tug-list-view-cell[data-selected="true"]');
    return cell?.querySelector('[data-snippet-id]')?.getAttribute('data-snippet-id') ?? null;
  })()`;
}

function deckWithEntryAndLens() {
  return {
    cards: [
      {
        id: ENTRY_CARD_ID,
        componentId: "session",
        title: "Session A",
        closable: true,
      },
      { id: LENS_CARD_ID, componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 400, y: 60 },
        size: { width: 560, height: 420 },
        cardIds: [ENTRY_CARD_ID],
        activeCardId: ENTRY_CARD_ID,
        title: "",
        acceptsFamilies: ["maker"],
      },
      {
        id: "lens-pane",
        position: { x: 0, y: 0 },
        size: { width: 320, height: 600 },
        cardIds: [LENS_CARD_ID],
        activeCardId: LENS_CARD_ID,
        title: "Lens",
        acceptsFamilies: [],
        anchor: "right",
      },
    ],
    activePaneId: "pA",
    hasFocus: true,
  };
}

interface Ledger {
  violations: number;
  reasserted: number;
  steals: Record<string, number>;
}

/** Entries added to the steal ledger between two snapshots. */
function ledgerDelta(before: Ledger, after: Ledger): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const [key, count] of Object.entries(after.steals)) {
    const added = count - (before.steals[key] ?? 0);
    if (added > 0) delta[key] = added;
  }
  return delta;
}

describe.skipIf(!SHOULD_RUN)("at0267 — drag, activation, and focus", () => {
  test(
    "a drag never activates or focuses; selection rides mousedown; one click lands the caret",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-at0267-"));
      const snippetsPath = join(dir, "snippets.json");
      const snippets = Array.from({ length: 6 }, (_, i) => ({
        id: `s${i}`,
        text: `drag doctrine snippet ${i}`,
      }));
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0267-drag-activation-focus",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({
            state: deckWithEntryAndLens(),
            focusCardId: ENTRY_CARD_ID,
          });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered(${JSON.stringify(ENTRY_CARD_ID)})`,
            { timeoutMs: 6_000 },
          );
          await app.bindSession(ENTRY_CARD_ID);
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}') !== null`,
            { timeoutMs: 6_000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(rowLabel("s2"))}) !== null`,
            { timeoutMs: 6_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          const readLedger = (): Promise<Ledger> =>
            app.evalJS<Ledger>(`(() => {
              const r = window.__tug.getFocusInvariantReport();
              return r === null
                ? { violations: -1, reasserted: -1, steals: {} }
                : { violations: r.violations, reasserted: r.reasserted, steals: r.steals };
            })()`);
          const centerOf = async (
            selector: string,
          ): Promise<{ x: number; y: number }> => {
            const r = await app.getElementBounds(selector);
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          };
          const settle = (ms = 350): Promise<void> =>
            new Promise<void>((r) => setTimeout(r, ms));

          // The entry card is the active one; a click in its editor makes that
          // unambiguous and lands the caret we later assert never moves.
          await app.nativeClickAtElement(
            `[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}`,
          );
          await settle();
          expect(await app.getActiveCardId()).toBe(ENTRY_CARD_ID);

          // ---- 1 + 2. Mousedown selects (no activation); mouseup activates.
          const s2 = await centerOf(rowLabel("s2"));
          await app.nativeMouseDown(s2);
          await settle();

          const afterDown = await app.evalJS<{
            selected: string | null;
            activeCard: string | null;
          }>(`(() => ({
            selected: ${selectedSnippetIdExpr()},
            activeCard: window.__tug.getActiveCardId(),
          }))()`);
          console.log("[at0267] after mousedown:", JSON.stringify(afterDown));
          // Selection moved with the mousedown — the drag would carry this row.
          expect(afterDown.selected).toBe("s2");
          // ...and the Lens did NOT activate: the gesture is still undecided.
          expect(afterDown.activeCard).toBe(ENTRY_CARD_ID);

          await app.nativeMouseUp(s2);
          await settle();
          // No drag came: the click commits the activation on mouseup.
          expect(await app.getActiveCardId()).toBe(LENS_CARD_ID);

          // ---- 3. A dragstart between down and up cancels the activation.
          await app.nativeClickAtElement(
            `[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}`,
          );
          await settle();
          expect(await app.getActiveCardId()).toBe(ENTRY_CARD_ID);

          const dragLedgerBefore = await readLedger();
          const s4 = await centerOf(rowLabel("s4"));
          await app.nativeMouseDown(s4);
          await settle();
          expect(await app.evalJS<string | null>(selectedSnippetIdExpr())).toBe(
            "s4",
          );
          // The browser's own dragstart for this gesture, dispatched on the
          // row the mousedown landed on — the signal the controller resolves
          // the deferred activation against.
          await app.evalJS<boolean>(`(() => {
            const el = document.querySelector(${JSON.stringify(rowLabel("s4"))});
            if (el === null) return false;
            return el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }));
          })()`);
          await settle();
          await app.nativeMouseUp(s4);
          await settle();

          const afterDrag = await app.evalJS<{
            activeCard: string | null;
            activeInEntry: boolean;
          }>(`(() => {
            const active = document.activeElement;
            return {
              activeCard: window.__tug.getActiveCardId(),
              activeInEntry: active !== null && active.closest('[data-card-id="${ENTRY_CARD_ID}"]') !== null,
            };
          })()`);
          console.log("[at0267] after drag:", JSON.stringify(afterDrag));
          // The drag left the source card inactive and the keyboard put.
          expect(afterDrag.activeCard).toBe(ENTRY_CARD_ID);
          expect(afterDrag.activeInEntry).toBe(true);
          expect(ledgerDelta(dragLedgerBefore, await readLedger())).toEqual({});

          // ---- 4. ONE click brings the card forward WITH its caret.
          // The D/E symptom was that returning to the entry took three clicks:
          // the first activated but blurred to `<body>` (the unguarded engine
          // re-`focus()`), the second re-settled the engine, and only the
          // third landed a caret. Hand the Lens the keyboard, then click once.
          await app.nativeClickAtElement(rowLabel("s0"));
          await settle();
          expect(await app.getActiveCardId()).toBe(LENS_CARD_ID);

          const caretLedgerBefore = await readLedger();
          await app.nativeClickAtElement(
            `[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}`,
          );
          await settle(500);

          const afterClick = await app.evalJS<{
            activeCard: string | null;
            activeIsEditor: boolean;
            activeDesc: string;
            hasCaret: boolean;
          }>(`(() => {
            const active = document.activeElement;
            const sel = window.getSelection();
            const content = document.querySelector('[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}');
            return {
              activeCard: window.__tug.getActiveCardId(),
              activeDesc: active === null ? "(null)" : active.tagName + "." + active.className,
              activeIsEditor: active !== null && content !== null && (active === content || content.contains(active)),
              hasCaret: sel !== null && sel.rangeCount > 0 && sel.anchorNode !== null
                && content !== null && content.contains(sel.anchorNode),
            };
          })()`);
          console.log("[at0267] after one click:", JSON.stringify(afterClick));
          // ONE click: the card is active AND the caret is in its editor.
          expect(afterClick.activeCard).toBe(ENTRY_CARD_ID);
          expect(afterClick.activeIsEditor).toBe(true);
          expect(afterClick.hasCaret).toBe(true);
          // A healthy activation ledgers nothing at all.
          expect(ledgerDelta(caretLedgerBefore, await readLedger())).toEqual({});

          // The engine may never have LIED: `violations` counts incoherence
          // the watchdog could not fix.
          expect((await readLedger()).violations).toBe(0);

          // ---- 5. A drop into a NON-key card claims nothing.
          // Hand the Lens the active card again so the entry is a background
          // card, then drop a snippet onto its editor.
          await app.nativeClickAtElement(rowLabel("s1"));
          await settle();
          expect(await app.getActiveCardId()).toBe(LENS_CARD_ID);

          const dropLedgerBefore = await readLedger();
          const beforeDrop = await app.evalJS<{
            activeDesc: string;
            text: string;
          }>(`(() => {
            const active = document.activeElement;
            const content = document.querySelector('[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}');
            return {
              activeDesc: active === null ? "(null)" : active.className + "|" + active.tagName,
              text: content === null ? "" : content.textContent,
            };
          })()`);

          const dropResult = await app.evalJS<{
            constructed: boolean;
            dispatched: boolean;
          }>(`(() => {
            const content = document.querySelector('[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}');
            if (content === null) return { constructed: false, dispatched: false };
            let dt;
            try {
              dt = new DataTransfer();
              dt.setData(${JSON.stringify(SNIPPET_MIME)}, "dropped-payload");
              dt.setData("text/plain", "dropped-payload");
            } catch {
              return { constructed: false, dispatched: false };
            }
            const rect = content.getBoundingClientRect();
            const ev = new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              dataTransfer: dt,
              clientX: Math.round(rect.left + rect.width / 2),
              clientY: Math.round(rect.top + 4),
            });
            content.dispatchEvent(ev);
            return { constructed: true, dispatched: true };
          })()`);
          console.log("[at0267] drop:", JSON.stringify(dropResult));
          // The harness page must be able to build a DragEvent + DataTransfer;
          // without it the capture-phase drop handler is not reachable at all.
          expect(dropResult.constructed).toBe(true);
          await settle();

          const afterDrop = await app.evalJS<{
            activeDesc: string;
            activeCard: string | null;
            text: string;
          }>(`(() => {
            const active = document.activeElement;
            const content = document.querySelector('[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}');
            return {
              activeDesc: active === null ? "(null)" : active.className + "|" + active.tagName,
              activeCard: window.__tug.getActiveCardId(),
              text: content === null ? "" : content.textContent,
            };
          })()`);
          console.log("[at0267] after drop:", JSON.stringify(afterDrop));
          // The text landed...
          expect(beforeDrop.text).not.toContain("dropped-payload");
          expect(afterDrop.text).toContain("dropped-payload");
          // ...and nothing else moved: not DOM focus, not the active card, not
          // the focus engine's ledger.
          expect(afterDrop.activeDesc).toBe(beforeDrop.activeDesc);
          expect(afterDrop.activeCard).toBe(LENS_CARD_ID);
          expect(ledgerDelta(dropLedgerBefore, await readLedger())).toEqual({});

          // ---- 6. One click works after a REAL drag from a parked-sink
          // start. Deselect via the deck canvas (no pane active), run a
          // genuine CGEvent drag from the inactive Lens into the entry, then
          // click the entry ONCE. Pins both the post-drag pointer-stream
          // resync and the theft gate's parked-sink permit.
          await app.nativeClick({ x: 120, y: 640 });
          await settle();
          expect(await app.getActiveCardId()).toBe(null);

          await app.nativeDragElement(
            rowLabel("s5"),
            { selector: `[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}` },
            { mouseDownDelayMs: 150, mouseUpDelayMs: 150 },
          );
          await settle(600);
          // The real drag left the deck deselected; the drop inserted the
          // snippet's text inertly.
          expect(await app.getActiveCardId()).toBe(null);
          expect(
            await app.evalJS<string>(
              `document.querySelector('[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}').textContent`,
            ),
          ).toContain("drag doctrine snippet 5");

          await app.nativeClickAtElement(
            `[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}`,
          );
          await settle(500);
          const afterSinkClick = await app.evalJS<{
            activeCard: string | null;
            activeIsEditor: boolean;
            hasCaret: boolean;
          }>(`(() => {
            const active = document.activeElement;
            const sel = window.getSelection();
            const content = document.querySelector('[data-card-id="${ENTRY_CARD_ID}"] ${ENTRY_EDITOR}');
            return {
              activeCard: window.__tug.getActiveCardId(),
              activeIsEditor: active !== null && content !== null && (active === content || content.contains(active)),
              hasCaret: sel !== null && sel.rangeCount > 0 && sel.anchorNode !== null
                && content !== null && content.contains(sel.anchorNode),
            };
          })()`);
          console.log(
            "[at0267] after parked-sink click:",
            JSON.stringify(afterSinkClick),
          );
          expect(afterSinkClick.activeCard).toBe(ENTRY_CARD_ID);
          expect(afterSinkClick.activeIsEditor).toBe(true);
          expect(afterSinkClick.hasCaret).toBe(true);
        } finally {
          await app.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
