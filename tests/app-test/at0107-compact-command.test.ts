/**
 * at0107-compact-command.test.ts — `/compact`'s live surface: the
 * compaction divider header renders for a `/compact`-born session, and a
 * suppressed seed turn never appears in the transcript ([AT0107]).
 *
 * ## Why this exists
 *
 * `/compact` re-creates compaction over the bridge (no native trigger):
 * summarize the current session → fresh session seeded (suppressed) with
 * the summary → divider header. The full summarize→spawn→seed continuity
 * needs a real claude turn (spike-verified separately; the stub harness
 * can't summarize). This drives the two **tugdeck-side** halves the stub
 * CAN exercise: `markCompactionSeed` → the divider header renders; a
 * `suppress`ed send → the turn runs but never shows in the transcript
 * (an ordinary send does). The pure pieces (`buildSummarizationPrompt`,
 * the reducer suppression + `mark_compaction_seed`) are unit-tested.
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

const CARD = '[data-card-id="A"]';
const TRANSCRIPT = `${CARD} [data-slot="dev-card-transcript"]`;
const DIVIDER = `${TRANSCRIPT} [data-slot="compaction-divider"]`;
const DIVIDER_LABEL = `${DIVIDER} .dev-card-transcript-compaction-label`;

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0107-compact-"));
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

describe.skipIf(!SHOULD_RUN)(
  "AT0107: /compact divider header + suppressed seed",
  () => {
    test(
      "markCompactionSeed renders the divider; a suppressed send stays out of the transcript",
      async () => {
        const app = await launchTugApp({ testName: "at0107-compact-command" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );
          await app.bindDevSession("A", { projectDir });
          await app.awaitEngineReady("A", { timeoutMs: 30_000 });

          // Flag the session as compaction-born → divider header appears.
          await app.driveDevSession("A", { op: "markCompactionSeed", preTokens: 48000 });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(DIVIDER)}) !== null`,
            { timeoutMs: 6000 },
          );
          const label = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(DIVIDER_LABEL)})||{}).textContent || ""`,
          );
          expect(label).toBe("Conversation compacted · ~48k tokens");

          // A suppressed seed send runs on claude but must NOT appear.
          await app.driveDevSession("A", {
            op: "send",
            text: "ZZSUPPRESSEDSEEDZZ",
            suppress: true,
          });
          // Give the in-flight turn a moment to (not) render.
          await new Promise((r) => setTimeout(r, 600));
          const afterSuppressed = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(TRANSCRIPT)})||{}).textContent || ""`,
          );
          expect(afterSuppressed).not.toContain("ZZSUPPRESSEDSEEDZZ");

          // Sanity: an ordinary send DOES show (suppression is the differ).
          await app.driveDevSession("A", { op: "send", text: "ZZVISIBLETURNZZ" });
          await app.waitForCondition<boolean>(
            `(document.querySelector(${JSON.stringify(TRANSCRIPT)})||{}).textContent.includes("ZZVISIBLETURNZZ")`,
            { timeoutMs: 6000 },
          );

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0107] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
