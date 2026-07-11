/**
 * at0198-wake-trigger-chip.test.ts — a wake turn opens with a trigger
 * chip naming what scheduled it ("loop pacing"), not an unexplained
 * assistant row.
 *
 * ## Why this exists
 *
 * tugcode's wake-trigger FIFO labels a Cohort B wake with the
 * `ScheduleWakeup` / `CronCreate` call observed earlier
 * (`wake_started.wake_trigger.summary`), and the reducer seeds that
 * summary into the wake turn's scratch as a `scheduled` system_note.
 * The pure halves are unit-tested (`wake-trigger-fifo.test.ts`,
 * `reducer.scheduled-work.test.ts`); this drives the live render:
 * inject a labeled `wake_started` through the store's real
 * `frameToEvent → dispatch` path plus a content frame, and assert the
 * chip paints with the label.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const SID = "test-session-A"; // bindDevSession default
const CHIP = '[data-slot="wake-trigger-chip"]';

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0198-wake-chip-"));
});
afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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
  "AT0198: wake turn renders its trigger chip",
  () => {
    test(
      "a labeled wake_started paints the chip above the wake content",
      async () => {
        const app = await launchTugApp({ testName: "at0198-wake-trigger-chip" });
        const ingest = (decoded: unknown) =>
          app.driveDevSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded,
          });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );
          await app.bindDevSession("A", { projectDir });
          await app.awaitEngineReady("A", { timeoutMs: 30_000 });

          // The wake bracket opens between turns (phase idle) with a
          // labeled trigger; content follows on the same bracket.
          await ingest({
            type: "wake_started",
            tug_session_id: SID,
            session_id: SID,
            wake_trigger: {
              task_id: "",
              tool_use_id: "tu-wake",
              status: "completed",
              summary: "loop pacing",
              output_file: "",
            },
          });
          await ingest({
            type: "content_block_start",
            tug_session_id: SID,
            msg_id: "mw",
            block_index: 0,
            kind: "text",
          });
          await ingest({
            type: "assistant_text",
            tug_session_id: SID,
            msg_id: "mw",
            block_index: 0,
            text: "tick.",
            is_partial: false,
            rev: 0,
            seq: 1,
          });

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CHIP)}) !== null`,
            { timeoutMs: 6000 },
          );
          const label = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(CHIP)})||{}).textContent || ""`,
          );
          expect(label).toBe("loop pacing");

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0198] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
