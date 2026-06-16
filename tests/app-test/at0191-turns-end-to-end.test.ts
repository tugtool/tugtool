/**
 * at0191-turns-end-to-end.test.ts — Phase 2 canonical-turns integration:
 * the transcript addresses every entry by its true session turn, and that
 * turn number survives paging older history ([AT0191]).
 *
 * ## Why this exists
 *
 * "Turn" is the one canonical session metric. tugcode emits `totalTurns`
 * and `firstLoadedTurnIndex` on `replay_complete`; the transcript paints a
 * `#t{turn}m{message}` address on every entry, where the turn is
 * `firstLoadedTurnIndex + localTurnIndex + 1`. The tugcode-side equality
 * (`totalTurns == reconciled ledger == scanner`) is proven on the JSONL
 * corpus by the Phase 1 contract test; the picker subtitle reads
 * `turn_count` straight from that authority (the Step 16 pure-logic test).
 * The remaining, genuinely client-side risk ([R07]) is that the rendered
 * turn address drifts from `totalTurns` — a window-local reset, or a
 * renumber when older turns page in. This drives the **live render** and
 * asserts it does not:
 *
 *   1. A windowed resume (last 3 of 8 turns): the highest turn address
 *      equals `totalTurns` (8), and the oldest loaded turn reads its true
 *      session turn (6), NOT a window-local "1".
 *   2. Per-message addresses increment within a turn (a turn with a tool
 *      call shows m02, m03) and reset across turns (the next turn's first
 *      assistant message is m02 again).
 *   3. Paging in the older history (loadPrevious) does NOT renumber an
 *      already-loaded turn — turn 8 stays `#t0008`, and the window now
 *      reaches turn 1.
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

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0191-turns-"));
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
        acceptsFamilies: ["developer"],
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
const asstText = (msgId: string, text: string, seq: number) => ({
  type: "assistant_text",
  tug_session_id: SID,
  msg_id: msgId,
  text,
  is_partial: false,
  rev: 0,
  seq,
});
const toolUse = (msgId: string, seq: number) => ({
  type: "tool_use",
  tug_session_id: SID,
  msg_id: msgId,
  tool_use_id: `${msgId}-tool`,
  tool_name: "Bash",
  input: {},
  seq,
});
const turnDone = (msgId: string) => ({
  type: "turn_complete",
  tug_session_id: SID,
  msg_id: msgId,
  result: "success",
});
const replayStarted = () => ({ type: "replay_started", tug_session_id: SID });
const replayComplete = (
  count: number,
  firstLoadedTurnIndex: number,
  totalTurns: number,
  hasOlder: boolean,
) => ({
  type: "replay_complete",
  tug_session_id: SID,
  count,
  firstLoadedTurnIndex,
  totalTurns,
  hasOlder,
});

describe.skipIf(!SHOULD_RUN)(
  "AT0191: turn address == totalTurns and survives paging",
  () => {
    test(
      "windowed resume addresses by true turn; loadPrevious does not renumber",
      async () => {
        const app = await launchTugApp({ testName: "at0191-turns-end-to-end" });
        const ingest = (decoded: unknown) =>
          app.driveDevSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded,
          });
        // Collect every rendered transcript address in card A: the user-row
        // header badge (`#t…m01`) and each assistant inline message's
        // `data-message-address`.
        const ADDRS_JS = `JSON.stringify(
          Array.from(document.querySelectorAll('[data-card-id="A"] [data-message-address]'))
            .map((e) => e.getAttribute('data-message-address'))
            .concat(
              Array.from(document.querySelectorAll('[data-card-id="A"] [data-slot="tug-transcript-entry-sequence"]'))
                .map((e) => (e.textContent || '').trim())
            )
        )`;
        const readAddrs = async (): Promise<string[]> =>
          JSON.parse(await app.evalJS<string>(ADDRS_JS));
        const turnOf = (addr: string): number =>
          parseInt(addr.slice(addr.indexOf("t") + 1, addr.indexOf("m")), 10);

        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );
          await app.bindDevSession("A", {
            tugSessionId: SID,
            sessionMode: "resume",
          });

          // --- Phase 1: windowed resume — last 3 of 8 turns (6,7,8) -------
          // Turn 7 carries a tool call so its assistant row shows m02 (text)
          // and m03 (tool); turns 6 and 8 are plain (user m01 + asst m02).
          await ingest(replayStarted());
          await ingest(userMsg("u6"));
          await ingest(asstText("m6", "a6", 0));
          await ingest(turnDone("m6"));
          await ingest(userMsg("u7"));
          await ingest(asstText("m7", "a7", 0));
          await ingest(toolUse("m7", 1));
          await ingest(turnDone("m7"));
          await ingest(userMsg("u8"));
          await ingest(asstText("m8", "a8", 0));
          await ingest(turnDone("m8"));
          await ingest(replayComplete(3, 5, 8, true));

          await app.waitForCondition<boolean>(
            `JSON.parse(${ADDRS_JS}).length >= 6`,
            { timeoutMs: 8000 },
          );

          let addrs = await readAddrs();
          const turns = addrs.map(turnOf);
          // The highest turn address equals tugcode's totalTurns.
          expect(Math.max(...turns)).toBe(8);
          // The oldest loaded turn reads its TRUE session turn (6), not a
          // window-local reset to 1.
          expect(Math.min(...turns)).toBe(6);
          // Per-message: turn 7 increments (m02 text, m03 tool); turn 8's
          // first assistant message resets to m02.
          expect(addrs).toContain("#t0007m02");
          expect(addrs).toContain("#t0007m03");
          expect(addrs).toContain("#t0008m02");
          // User rows carry m01 at their true turn.
          expect(addrs).toContain("#t0006m01");
          expect(addrs).toContain("#t0008m01");

          // --- Phase 2: page in the older history (turns 1..5) ------------
          await app.driveDevSession("A", { op: "loadPrevious", amount: "all" });
          await ingest(replayStarted());
          for (let n = 1; n <= 5; n++) {
            await ingest(userMsg(`u${n}`));
            await ingest(asstText(`m${n}`, `a${n}`, 0));
            await ingest(turnDone(`m${n}`));
          }
          await ingest(replayComplete(5, 0, 8, false));

          await app.waitForCondition<boolean>(
            `JSON.parse(${ADDRS_JS}).some((a) => a === "#t0001m01")`,
            { timeoutMs: 8000 },
          );

          addrs = await readAddrs();
          const turns2 = addrs.map(turnOf);
          // The window now reaches turn 1; the highest is still totalTurns.
          expect(Math.min(...turns2)).toBe(1);
          expect(Math.max(...turns2)).toBe(8);
          // The already-loaded turns did NOT renumber across the prepend.
          expect(addrs).toContain("#t0008m02");
          expect(addrs).toContain("#t0007m03");
          expect(addrs).toContain("#t0006m01");

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0191] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
