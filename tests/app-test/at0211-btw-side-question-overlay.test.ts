/**
 * at0211-btw-side-question-overlay.test.ts — `/btw` opens the non-modal
 * side-question overlay and the exchange leaves the transcript untouched
 * ([P02]/[P05], roadmap/add-btw.md).
 *
 * A side question is answered from the live conversation with no tools and
 * MUST NOT enter the transcript. Tug renders it in a non-modal `TugPopover`
 * anchored at the prompt entry, fed by a dedicated `SideQuestionStore` whose
 * `side_question_answer` frame is deliberately absent from
 * `KNOWN_CODE_OUTPUT_TYPES` — so the code-session (transcript) store drops it.
 *
 * This standard-tier test drives one committed turn (so the transcript has
 * entries to count), types `/btw <question>` and submits, and asserts:
 *   1. the overlay opens (a side-question row appears), and
 *   2. the transcript entry count is UNCHANGED across the whole `/btw`
 *      exchange — the ask, and the settled answer (injected as a
 *      `side_question_answer` frame, the shape the #step-1 probe pinned).
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
    cards: [{ id: "A", componentId: "dev", title: "Dev A", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 640 },
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

describe.skipIf(!SHOULD_RUN)(
  "AT0211: `/btw` opens the side-question overlay and never touches the transcript",
  () => {
    test(
      "a /btw ask + settled answer leaves the transcript entry count unchanged",
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

          await app.bindDevSession("A", { tugSessionId: SID, projectDir: dir });
          await app.awaitEngineReady("A");

          // One committed turn so the transcript has entries to count.
          await app.driveDevSession("A", { op: "send", text: "hello" });
          const frame = (decoded: Record<string, unknown>) =>
            app.driveDevSession("A", {
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

          // Type `/btw <question>` and submit. Escape first dismisses any
          // open completion menu; Cmd+Return is the editor's forced submit.
          await app.nativeClickAtElement(PROMPT);
          await app.nativeType("/btw what did I just say");
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

          // Positioning contract ([P02]): the pane floats ABOVE the Z2 status
          // row (never overlapping it), right-aligned to the card. Measured
          // against the live layout so a regression (e.g. an in-flow anchor
          // that displaces the status cells, or a left-aligned pane) fails
          // here rather than only in the eye.
          // The Z2 status bar spans the card's content width, so it is the
          // reliable reference for both "above Z2" and "right-aligned".
          const geom = await app.evalJS<{
            paneBottom: number;
            paneRight: number;
            z2Top: number;
            z2Right: number;
            z2Width: number;
          } | null>(
            `(() => {
               const pane = document.querySelector('.side-question-pane');
               const z2 = document.querySelector('[data-card-id="A"] [data-slot="dev-card-status-bar"]');
               if (!pane || !z2) return null;
               const p = pane.getBoundingClientRect();
               const s = z2.getBoundingClientRect();
               return { paneBottom: p.bottom, paneRight: p.right, z2Top: s.top, z2Right: s.right, z2Width: s.width };
             })()`,
          );
          expect(geom).not.toBeNull();
          // Bottom sits above Z2 (no overlap; a small fudge for sub-pixel).
          expect(geom!.paneBottom).toBeLessThanOrEqual(geom!.z2Top + 1);
          // Right-aligned: the pane's right edge tracks Z2's right edge (within
          // a small gutter), and never overhangs it.
          expect(Math.abs(geom!.z2Right - geom!.paneRight)).toBeLessThan(24);
          // Z2 is intact — the status row spans a real card width, proving the
          // anchor did not collapse or displace the status cells.
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
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
