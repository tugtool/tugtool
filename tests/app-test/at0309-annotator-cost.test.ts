/**
 * at0309-annotator-cost.test.ts — the content annotator's cost is bounded.
 *
 * The annotator's cost is not one DOM pass; it is how many passes an
 * arriving verdict provokes, times how much DOM each one walks. Both are
 * counted (`lib/annotator/annotate-counters`) so the claim is falsifiable
 * rather than argued.
 *
 * This drives a transcript of ordinary size — forty assistant messages,
 * each citing one real file and one name no resolver can confirm — and
 * pins the two invariants that were once violated:
 *
 *  1. **Marking is linear in content.** Passes are bounded by the number
 *     of blocks, not by blocks × answers: one answer about one path must
 *     not provoke a walk of every block. Content passes (link detection +
 *     normalize) run only where HTML was written, never on re-marks.
 *  2. **Idle cost is zero.** Once the transcript has settled, an
 *     unresolvable reference must cost nothing: no retry loop, no
 *     re-annotation heartbeat, no pass growth while nothing changes.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/lib/annotator/annotate-content.ts
 * @covers tugdeck/src/lib/annotator/annotate-counters.ts
 * @covers tugdeck/src/lib/annotator/verdict-batching.ts
 * @covers tugdeck/src/lib/annotator/file-name-resolution.ts
 * @covers tugdeck/src/components/tugways/cards/transcript-host-helpers.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 180_000;

const CODE_OUTPUT_FEED = 0x40;
const SID = "test-session-A";

/** How many assistant messages the measured transcript carries. */
const MESSAGES = 40;

/** How long the idle window is — the interval that must cost zero passes. */
const IDLE_WINDOW_MS = 15_000;

let projectDir = "";
const realPaths: string[] = [];

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0309-cost-"));
  for (let i = 0; i < MESSAGES; i += 1) {
    const path = join(projectDir, `file-${i}.txt`);
    writeFileSync(path, `contents ${i}\n`, "utf8");
    realPaths.push(path);
  }
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
        size: { width: 900, height: 640 },
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

interface AnnotateSample {
  passes: number;
  contentPasses: number;
  totalMs: number;
  textNodes: number;
}

describe.skipIf(!SHOULD_RUN)("AT0309: the annotator's cost is bounded", () => {
  test(
    "marking is linear in blocks, and a settled transcript idles at zero",
    async () => {
      const app = await launchTugApp({ testName: "at0309-annotator-cost" });
      const ingest = (decoded: unknown) =>
        app.driveSession("A", {
          op: "ingestFrame",
          feedId: CODE_OUTPUT_FEED,
          decoded,
        });
      const sample = async (): Promise<AnnotateSample> =>
        (await app.evalJS<unknown>(
          `window.__tug.getSessionPerf("A").annotate`,
        )) as AnnotateSample;

      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 30_000 },
        );
        await app.bindSession("A", {
          tugSessionId: SID,
          sessionMode: "resume",
          projectDir,
          workspaceKey: projectDir,
        });

        await ingest({ type: "replay_started", tug_session_id: SID });
        for (let i = 0; i < MESSAGES; i += 1) {
          await ingest({
            type: "add_user_message",
            tug_session_id: SID,
            content: [{ type: "text", text: `question ${i}` }],
          });
          await ingest({
            type: "assistant_text",
            tug_session_id: SID,
            msg_id: `m${i}`,
            text:
              `I looked at \`${realPaths[i]}\` and also ` +
              `\`no-such-name-${i}.ts\`, and both were fine.`,
            is_partial: false,
            rev: 0,
            seq: 1,
          });
          await ingest({
            type: "turn_complete",
            tug_session_id: SID,
            msg_id: `m${i}`,
            result: "success",
          });
        }
        await ingest({
          type: "replay_complete",
          tug_session_id: SID,
          count: MESSAGES,
          firstLoadedTurnIndex: 0,
          totalTurns: MESSAGES,
          hasOlder: false,
        });

        // Every real path must resolve and mark — the feature works.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('[data-card-id="A"] [data-tug-annotation="file-path"]').length === ${MESSAGES}`,
          { timeoutMs: 30_000 },
        );

        // Let in-flight verdict batches land before opening the idle
        // window, so trailing answers don't masquerade as idle churn.
        await new Promise((r) => setTimeout(r, 6000));
        const settled = await sample();
        await new Promise((r) => setTimeout(r, IDLE_WINDOW_MS));
        const idle = await sample();

        process.stderr.write(
          `\n[at0309] messages=${MESSAGES} ` +
            `passes=${settled.passes} contentPasses=${settled.contentPasses} ` +
            `textNodes=${settled.textNodes} totalMs=${settled.totalMs.toFixed(1)} ` +
            `idleGrowth=${idle.passes - settled.passes}\n`,
        );

        // Idle cost is zero: a settled transcript with unresolvable
        // references provokes no further passes of any kind, ever.
        expect(idle.passes).toBe(settled.passes);
        expect(idle.contentPasses).toBe(settled.contentPasses);

        // Marking cost is linear in blocks, not blocks × answers. The
        // bounds are generous on purpose: they pin the *shape* of the
        // cost, not a constant that will drift.
        expect(settled.passes).toBeLessThan(MESSAGES * 8);
        expect(settled.textNodes).toBeLessThan(MESSAGES * 80);
        // Content passes (link detection + normalize) happen where HTML
        // is written — rendering the transcript — never per verdict.
        expect(settled.contentPasses).toBeLessThan(MESSAGES * 4);

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0309] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
