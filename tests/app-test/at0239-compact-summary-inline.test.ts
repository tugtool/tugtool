/**
 * at0239-compact-summary-inline.test.ts — the compaction point renders IN PLACE
 * as ONE session-meta bar, with the transcript otherwise left intact.
 *
 * ## Why this exists
 *
 * After `/compact` the transcript stays whole (no turns dropped, no top banner);
 * the compaction point carries a single collapsible bar ("Session compacted ·
 * ~Nk tokens", recap one expand away). The pure halves are unit-tested (the
 * reducer appends the `compact` system_note, the store folds `compact_summary`
 * into `compactionSeed`, `deriveContextWindows` stamps the honest window). This
 * drives the **live render**: cold-replay a few turns, then a `compact_boundary`
 * + `compact_summary`, and assert every turn is still present and the bar sits
 * at the compaction point (not the top).
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
const SID = "test-session-A"; // sessionIdFor("A")

// The compaction point wrapper, and the single session-meta bar nested inside
// it (label rides the bar's tool-block header name span).
const COMPACTION = '[data-card-id="A"] [data-slot="compaction-divider"]';
const SUMMARY_AT_POINT = `${COMPACTION} [data-slot="session-compaction"]`;
const BAR_LABEL_AT_POINT = `${SUMMARY_AT_POINT} .tool-call-header-name`;

const SUMMARY_TEXT =
  "This session is being continued from a previous conversation.\n\n" +
  "Summary: the user asked for fun facts about numbers.";

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0239-compact-"));
});
afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
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

// --- Frame builders (decoded CODE_OUTPUT payloads for SID) -----------------
const userMsg = (text: string) => ({
  type: "add_user_message",
  tug_session_id: SID,
  content: [{ type: "text", text }],
});
const asstText = (msgId: string, text: string) => ({
  type: "assistant_text",
  tug_session_id: SID,
  msg_id: msgId,
  text,
  is_partial: false,
  rev: 0,
  seq: 0,
});
const turnDone = (msgId: string) => ({
  type: "turn_complete",
  tug_session_id: SID,
  msg_id: msgId,
  result: "success",
});
const replayStarted = () => ({ type: "replay_started", tug_session_id: SID });
const compactBoundary = () => ({
  type: "compact_boundary",
  tug_session_id: SID,
  trigger: "manual",
  pre_tokens: 26239,
  post_tokens: 1442,
});
const compactSummary = () => ({
  type: "compact_summary",
  tug_session_id: SID,
  summary: SUMMARY_TEXT,
});
const replayComplete = () => ({
  type: "replay_complete",
  tug_session_id: SID,
  count: 3,
  firstLoadedTurnIndex: 0,
  totalTurns: 3,
  hasOlder: false,
});

describe.skipIf(!SHOULD_RUN)(
  "AT0239: compaction bar renders in place at the compaction point",
  () => {
    test(
      "cold replay + compact: transcript intact, bar at the compaction point",
      async () => {
        const app = await launchTugApp({ testName: "at0239-compact-summary-inline" });
        const ingest = (decoded: unknown) =>
          app.driveSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded,
          });
        const TX_JS = `(document.querySelector('[data-card-id="A"] .session-card-transcript') || document.body).textContent || ""`;
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );
          await app.bindSession("A", {
            tugSessionId: SID,
            sessionMode: "resume",
            projectDir,
          });
          await app.awaitEngineReady("A", { timeoutMs: 30_000 });

          // Cold-replay 3 distinguishable turns, then compact.
          await ingest(replayStarted());
          await ingest(userMsg("funfact ONE about numbers"));
          await ingest(asstText("m1", "reply-funfact-ONE"));
          await ingest(turnDone("m1"));
          await ingest(userMsg("funfact TWO about numbers"));
          await ingest(asstText("m2", "reply-funfact-TWO"));
          await ingest(turnDone("m2"));
          await ingest(userMsg("funfact THREE about numbers"));
          await ingest(asstText("m3", "reply-funfact-THREE"));
          await ingest(turnDone("m3"));
          await ingest(compactBoundary());
          await ingest(compactSummary());
          await ingest(replayComplete());

          // The compaction bar appears at the compaction point (nested in the
          // compaction wrapper), not hoisted to the top of the transcript.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SUMMARY_AT_POINT)}) !== null`,
            { timeoutMs: 8000 },
          );

          // The transcript is intact — every turn's text is still present.
          const tx = await app.evalJS<string>(TX_JS);
          expect(tx.includes("reply-funfact-ONE")).toBe(true);
          expect(tx.includes("reply-funfact-TWO")).toBe(true);
          expect(tx.includes("reply-funfact-THREE")).toBe(true);

          // The compaction bar's label renders at the compaction point.
          const barLabel = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(BAR_LABEL_AT_POINT)})||{}).textContent || ""`,
          );
          expect(barLabel).toContain("Session compacted");

          // No SESSION COMPACTED banner (the transcript-top affordance is gone).
          const bannerPresent = await app.evalJS<boolean>(
            `document.querySelector('[data-card-id="A"] [data-compacted-banner]') !== null`,
          );
          expect(bannerPresent).toBe(false);

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0239] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
