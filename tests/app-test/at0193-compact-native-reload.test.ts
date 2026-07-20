/**
 * at0193-compact-native-reload.test.ts — a natively-compacted session restores
 * its Compaction Summary block AND its boundary divider on a cold replay
 * ([AT0193]).
 *
 * ## Why this exists
 *
 * This is the relaunch-restore regression test for the original `/compact` bug:
 * the summary once lived only in an in-memory store and was lost on reload.
 * Native `/compact` persists the summary durably in the JSONL (an
 * `isCompactSummary` user record) right after the `system`/`compact_boundary`
 * record, and tugcode's replay now emits both as `compact_boundary` +
 * `compact_summary` frames. This drives the **real** delivery chain end-to-end
 * (like at0192): it places a real natively-compacted fixture JSONL on disk
 * where claude/tugcode expect it, fires a genuine `spawn_session(mode=resume)`,
 * and asserts that after replay the card shows the boundary divider AND the
 * carry-forward Compaction Summary block.
 *
 * The fixture is a real Claude Code 2.1.207 compaction (see
 * `tugcode/src/__tests__/fixtures/compact-native/`); its `cwd` / `sessionId`
 * fields are rewritten per-run so claude's `--resume` accepts the file (it
 * reads the SAME JSONL and reverts to the picker on a `cwd` mismatch).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "a7c0d1ea-0000-4000-8000-0000000c0mpact";

const DIVIDER = '[data-slot="compaction-divider"]';
const CARRY_FORWARD = '[data-card-id="A"] [data-slot="session-compaction"]';
// The compaction bar composes the shared BlockChrome; its label rides the
// tool-block header name span.
const CARRY_FORWARD_NAME = `${CARRY_FORWARD} .tool-call-header-name`;

/** Mirrors tugcode's `encodeProjectDir` (every non-`[A-Za-z0-9-]` → `-`). */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

// The real natively-compacted fixture, checked in for tugcode's replay unit
// tests. Read it here (the app-test graph must not import tugcode) and rewrite
// each record's `cwd` / `sessionId` to this run's values so claude's `--resume`
// accepts it; the uuid chain, `compactMetadata`, and `isCompactSummary` record
// are preserved verbatim — that content is what replay must restore.
const FIXTURE_SRC = join(
  import.meta.dir,
  "..",
  "..",
  "tugcode",
  "src",
  "__tests__",
  "fixtures",
  "compact-native",
  "0967f3f0-013d-4849-b967-4b66dc702146.jsonl",
);

function rehomeFixture(cwd: string, sessionId: string): string {
  const src = readFileSync(FIXTURE_SRC, "utf8");
  return (
    src
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if ("cwd" in entry) entry.cwd = cwd;
        if ("sessionId" in entry) entry.sessionId = sessionId;
        return JSON.stringify(entry);
      })
      .join("\n") + "\n"
  );
}

let projectDir = "";
let fixtureDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  // Resolve realpath: tugcode/claude resolve `/var` → `/private/var` before
  // encoding the claude-projects subdir, so encode + spawn against the SAME
  // resolved string (see at0192).
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0193-proj-")));
  fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(projectDir));
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, `${SID}.jsonl`), rehomeFixture(projectDir, SID));
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  if (fixtureDir !== "" && existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
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

describe.skipIf(!SHOULD_RUN)(
  "AT0193: a compacted session restores its divider + summary block on cold replay",
  () => {
    test(
      "real spawn_session(resume) replays the fixture → boundary divider + carry-forward summary",
      async () => {
        const app = await launchTugApp({ testName: "at0193-compact-native-reload" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );

          // Fire the REAL spawn_session(resume): tugcast spawns a real tugcode
          // that replays the fixture JSONL through the live delivery chain.
          await app.spawnSessionResume("A", { tugSessionId: SID, projectDir });

          // The carry-forward summary block restores from the replayed
          // `compact_summary` frame — the durability the original bug lacked.
          // The component returns null for an empty/absent summary, so its very
          // presence proves `compactionSeed.summary` was repopulated from JSONL.
          // (The body is collapsed by default and unmounts when collapsed, so
          // assert the block + its title, not the hidden body.)
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CARRY_FORWARD)}) !== null`,
            { timeoutMs: 20_000 },
          );

          // The boundary divider restores from the replayed `compact_boundary`
          // frame ([P04]: seated on the last committed turn, since the boundary
          // arrives with no open turn on replay).
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(DIVIDER)}) !== null`,
            { timeoutMs: 20_000 },
          );

          const title = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(CARRY_FORWARD_NAME)})||{}).textContent || ""`,
          );
          expect(title).toBe("Session compacted");

          // The bar renders even for a bare boundary, so its presence alone no
          // longer proves the summary survived reload — expand it and assert
          // the recap text. The disclosure toggles only when a body exists
          // (`compactionSeed.summary` repopulated from JSONL), so a click that
          // reveals the recap IS the durability proof.
          await app.evalJS<void>(
            `document.querySelector('${CARRY_FORWARD} [data-slot="tool-call-header-disclosure"]').click()`,
          );
          await app.waitForCondition<boolean>(
            `(document.querySelector(${JSON.stringify(CARRY_FORWARD)})||{}).textContent`.concat(
              `.includes("This session is being continued")`,
            ),
            { timeoutMs: 6000 },
          );

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const DIAG_JS = `JSON.stringify((() => {
            const card = document.querySelector('[data-card-id="A"]');
            const q = (sel) => !!(card && card.querySelector(sel));
            return {
              hasCard: !!card,
              picker: q('[data-slot="session-card-picker"]'),
              restoring: q('[data-slot="session-card-restoring"]'),
              body: q('[data-slot="session-card"]'),
              divider: q('[data-slot="compaction-divider"]'),
              carryForward: q('[data-slot="session-compaction"]'),
              spawnError: q('[data-testid="session-card-spawn-error-retry"]'),
            };
          })())`;
          try {
            const diag = await app.evalJS<string>(DIAG_JS);
            process.stderr.write(`\n[at0193] tugdeck state:\n${diag}\n`);
          } catch (probeErr) {
            process.stderr.write(`\n[at0193] diag probe failed: ${String(probeErr)}\n`);
          }
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0193] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
