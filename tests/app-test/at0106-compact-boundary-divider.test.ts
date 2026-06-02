/**
 * at0106-compact-boundary-divider.test.ts — the dev-card transcript shows
 * a soft compaction divider when claude auto-compacts mid-turn ([AT0106]).
 *
 * ## Why this exists
 *
 * Claude auto-compacts its context at capacity and emits a
 * `system`/`compact_boundary` (a typed `/compact` is client-dispatched
 * and never reaches the bridge). The dev card mirrors it as a soft
 * divider — matching the terminal's compaction indicator, NOT the raw
 * summary block (which Claude Code's own UI and tugcode's replay
 * translator hide). The pure halves (`compactionNoteText`, the reducer's
 * `handleCompactBoundary`) are unit-tested; the tugcode emit is covered
 * in `tugcode/src/__tests__/session.test.ts`. This drives the **live
 * render**: open a turn, inject a synthetic `compact_boundary` through the
 * store's real `frameToEvent → dispatch` path, and assert the divider.
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

const DIVIDER = '[data-slot="compaction-divider"]';
const DIVIDER_LABEL = `${DIVIDER} .dev-card-transcript-compaction-label`;
const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const TUG_SESSION_ID = "test-session-A"; // bindDevSession default

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0106-compact-"));
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
  "AT0106: compaction divider renders for an auto-compaction boundary",
  () => {
    test(
      "a mid-turn compact_boundary appends a soft divider with the token count",
      async () => {
        const app = await launchTugApp({ testName: "at0106-compact-boundary-divider" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            // Generous: a cold single-file run pays the tugdeck Vite
            // first-compile cost, which exceeds the 10s default.
            { timeoutMs: 30_000 },
          );
          await app.bindDevSession("A", { projectDir });
          await app.awaitEngineReady("A", { timeoutMs: 30_000 });

          // Open a turn so there is an active turn for the boundary to
          // attach to (auto-compaction fires mid-turn). No backend
          // response flows in stub mode — the active turn stays in flight.
          await app.driveDevSession("A", { op: "send", text: "do a long thing", atoms: [] });

          // Inject a synthetic compact_boundary through the store's real
          // frameToEvent → dispatch path.
          await app.driveDevSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded: {
              type: "compact_boundary",
              tug_session_id: TUG_SESSION_ID,
              trigger: "auto",
              pre_tokens: 48000,
            },
          });

          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(DIVIDER)}) !== null`,
            { timeoutMs: 6000 },
          );
          const label = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(DIVIDER_LABEL)})||{}).textContent || ""`,
          );
          expect(label).toBe("Session compacted · ~48k tokens");

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0106] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
