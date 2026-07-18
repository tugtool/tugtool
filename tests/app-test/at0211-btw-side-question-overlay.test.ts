/**
 * at0211-btw-side-question-overlay.test.ts — `!btw` opens the side-question
 * placard and the exchange leaves the transcript untouched ([P02]/[P05],
 * roadmap/add-btw.md).
 *
 * A side question is answered from the live conversation with no tools and
 * MUST NOT enter the transcript. Tug renders it as the `!btw` body inside the
 * shared Z2 `TugPlacard` (in-DOM, just above the status row), fed by a
 * dedicated `SideQuestionStore` whose `side_question_answer` frame is
 * deliberately absent from `KNOWN_CODE_OUTPUT_TYPES` — so the code-session
 * (transcript) store drops it.
 *
 * This standard-tier test drives one committed turn (so the transcript has
 * entries to count), types `!btw <question>` and submits, and asserts:
 *   1. the placard opens (a side-question row appears), above Z2 and within the
 *      card;
 *   2. the transcript entry count is UNCHANGED across the whole `!btw`
 *      exchange — the ask, and the settled answer (injected as a
 *      `side_question_answer` frame);
 *   3. the placard AUTO-DISMISSES — a click away closes it (there is no `×`);
 *      it reopens on a BTW-cell click; and
 *   4. it is ONE-AT-A-TIME — opening a log cell (TIME) while `!btw` is open
 *      swaps the placard rather than stacking a second one.
 *
 * The mid-turn + reload-clean behaviors are covered against real claude in
 * the Step 6/7 tiers; here the answer is injected so the surface + the
 * transcript-invisibility invariant are proven without a live model.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0211";
const FEED_CODE_OUTPUT = 0x40;

const PROMPT = '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content';
const TRANSCRIPT_ENTRIES = '[data-card-id="A"] [data-slot="tug-transcript-entry"]';
const SIDE_Q_ASK = '.side-question-question';
const SIDE_Q_ANSWER = '.side-question-answer';
// The `!btw` body inside the shared Z2 placard — its presence means the btw
// placard is open.
const SIDE_Q_BODY = '[data-card-id="A"] [data-slot="side-question-body"]';
const BTW_CELL = '[data-card-id="A"] .session-telemetry-status-cell[data-priority="btw"]';
const TIME_CELL = '[data-card-id="A"] .session-telemetry-status-cell[data-priority="time"]';
const POPUP_LIST = '[data-card-id="A"] [data-slot="tug-popup-list"]';

let dir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  dir = mkdtempSync(join(tmpdir(), "at0211-"));
});

afterAll(() => {
  if (dir !== "" && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session A", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 640 },
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
  "AT0211: `!btw` opens the side-question overlay and never touches the transcript",
  () => {
    test(
      "a !btw ask + settled answer leaves the transcript entry count unchanged",
      async () => {
        const app = await launchTugApp({
          testName: "at0211-btw-side-question-overlay",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          await app.bindSession("A", { tugSessionId: SID, projectDir: dir });
          await app.awaitEngineReady("A");

          // One committed turn so the transcript has entries to count.
          await app.driveSession("A", { op: "send", text: "hello" });
          const frame = (decoded: Record<string, unknown>) =>
            app.driveSession("A", {
              op: "ingestFrame",
              feedId: FEED_CODE_OUTPUT,
              decoded: { tug_session_id: SID, ...decoded },
            });
          await frame({ type: "prompt_anchor", promptUuid: "uuid-1" });
          await frame({
            type: "content_block_start",
            msg_id: "m1",
            block_index: 0,
            kind: "text",
          });
          await frame({
            type: "assistant_text",
            msg_id: "m1",
            block_index: 0,
            text: "hi there",
            is_partial: false,
          });
          await frame({ type: "turn_complete", msg_id: "m1", result: "success" });

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(PROMPT)}) !== null`,
            { timeoutMs: 8000 },
          );

          const countEntries = () =>
            app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(TRANSCRIPT_ENTRIES)}).length`,
            );
          const baseline = await countEntries();
          expect(baseline).toBeGreaterThan(0); // the committed turn rendered

          // The Z2 BTW cell reads the `!btw` count — an em-dash before any ask.
          const btwCellValue = () =>
            app.evalJS<string | null>(
              `(() => { const el = document.querySelector('[data-card-id="A"] .session-telemetry-status-cell[data-priority="btw"] .session-telemetry-status-value'); return el ? el.textContent : null; })()`,
            );
          expect(await btwCellValue()).toBe("—");

          // Type `!btw <question>` and submit. Escape first dismisses any
          // open completion menu; Cmd+Return is the editor's forced submit.
          await app.nativeClickAtElement(PROMPT);
          await app.nativeType("!btw what did I just say");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Escape");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Enter", ["cmd"]);

          // The overlay opens with the ask (loading pose).
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SIDE_Q_ASK)}) !== null`,
            { timeoutMs: 6000 },
          );

          // The ask must not have added a transcript entry.
          const afterAsk = await countEntries();
          expect(afterAsk).toBe(baseline);

          // Positioning ([P02]/[P06]): the placard floats ABOVE the Z2 status
          // row (never overlapping it) and stays WITHIN the card's horizontal
          // bounds (anchored under the BTW cell, clamped inside the card).
          // Measured against the live layout so a regression (an in-flow anchor
          // that displaces the status cells, or a placard escaping the card)
          // fails here rather than only in the eye. The Z2 status bar spans the
          // card's content width, so it is the reliable reference.
          const geom = await app.evalJS<{
            paneLeft: number;
            paneRight: number;
            paneBottom: number;
            z2Top: number;
            z2Left: number;
            z2Right: number;
            z2Width: number;
          } | null>(
            `(() => {
               const pane = document.querySelector('.tug-placard');
               const z2 = document.querySelector('[data-card-id="A"] [data-slot="session-card-status-bar"]');
               if (!pane || !z2) return null;
               const p = pane.getBoundingClientRect();
               const s = z2.getBoundingClientRect();
               return { paneLeft: p.left, paneRight: p.right, paneBottom: p.bottom, z2Top: s.top, z2Left: s.left, z2Right: s.right, z2Width: s.width };
             })()`,
          );
          expect(geom).not.toBeNull();
          // Bottom sits above Z2 (no overlap; a small fudge for sub-pixel).
          expect(geom!.paneBottom).toBeLessThanOrEqual(geom!.z2Top + 1);
          // Within the card horizontally (never escaping left or right).
          expect(geom!.paneLeft).toBeGreaterThanOrEqual(geom!.z2Left - 1);
          expect(geom!.paneRight).toBeLessThanOrEqual(geom!.z2Right + 1);
          // Z2 is intact — the status row spans a real card width, proving the
          // placard did not collapse or displace the status cells.
          expect(geom!.z2Width).toBeGreaterThan(600);

          // Settle the answer (the shape the probe pinned) through the real
          // SideQuestionStore. The store minted `btw-1` for the first ask.
          // (The `side_question_answer` frame is intentionally absent from
          // KNOWN_CODE_OUTPUT_TYPES, so the codeSessionStore ingest path can't
          // deliver it — the dedicated store settles it instead.)
          await app.ingestSideQuestionAnswer("A", {
            type: "side_question_answer",
            request_id: "btw-1",
            answer: "You said: hello",
            synthetic: false,
          });

          // The overlay shows the settled answer...
          await app.waitForCondition<boolean>(
            `Array.from(document.querySelectorAll(${JSON.stringify(SIDE_Q_ANSWER)})).some((el) => el.textContent && el.textContent.indexOf("You said: hello") !== -1)`,
            { timeoutMs: 6000 },
          );

          // ...and the transcript is STILL unchanged (the [P05] invariant).
          const afterAnswer = await countEntries();
          expect(afterAnswer).toBe(baseline);

          // Auto-dismiss ([P05]/[Q01]): clicking away (into the editor) closes
          // the placard — there is no `×` on an auto-dismiss placard, and it no
          // longer survives losing focus the way the retired pinned pane did.
          await app.nativeClickAtElement(PROMPT);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SIDE_Q_BODY)}) === null`,
            { timeoutMs: 4000 },
          );

          // The exchange survives the dismiss (the store is untouched), so the
          // BTW cell still shows the count, and a click on the cell reopens the
          // placard onto that same history — exactly like the other Z2 cells.
          expect(await btwCellValue()).toBe("1");
          await app.nativeClickAtElement(BTW_CELL);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SIDE_Q_BODY)}) !== null`,
            { timeoutMs: 4000 },
          );

          // One-at-a-time ([P05]): opening the TIME cell while `!btw` is open
          // SWAPS the placard — the `!btw` body is gone, the TIME log popup is
          // shown, and exactly one placard is mounted (never stacked).
          await app.nativeClickAtElement(TIME_CELL);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(POPUP_LIST)}) !== null`,
            { timeoutMs: 4000 },
          );
          const swap = await app.evalJS<string>(
            `JSON.stringify({
               btwGone: document.querySelector(${JSON.stringify(SIDE_Q_BODY)}) === null,
               placards: document.querySelectorAll('[data-card-id="A"] .tug-placard').length,
             })`,
          );
          const swapped = JSON.parse(swap);
          expect(swapped.btwGone).toBe(true);
          expect(swapped.placards).toBe(1);
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
