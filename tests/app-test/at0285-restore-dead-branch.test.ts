/**
 * at0285-restore-dead-branch.test.ts — a cold replay restores every live turn
 * exactly once and no abandoned one ([AT0285]).
 *
 * ## Why this exists
 *
 * A session JSONL is an append-only `parentUuid` tree, and restore has to
 * render the same conversation claude itself would resume: the live chain from
 * the newest leaf, each preserved message once. Two things break that, in
 * opposite directions.
 *
 * Rendering too much: a rewind abandons a branch without removing its bytes,
 * so a flat scan repaints turns the live session no longer has. Rendering too
 * little: parent resolution that takes a uuid's LAST occurrence walks forward
 * into a compaction's re-appended copy and strands the genuine history behind
 * it — which cost a real session 980 of its 5082 entries, including a whole
 * day's work ([L23]).
 *
 * The unit tests pin the walk over fixtures. This pins the thing they cannot:
 * that the answer survives the **real** delivery chain. It seeds a real
 * session on disk, fires a genuine `spawn_session(mode=resume)`, and asserts
 * against the rendered transcript.
 *
 * The fixture is a real Claude Code session generated for this purpose (a
 * scratch project, throwaway prompts) and sanitized: three turns, `/compact`,
 * two more turns, then a `/rewind` → "Restore conversation" that strands them,
 * a diverging turn, and a second `/compact`. So DELTA and ECHO are abandoned
 * while FOXTROT and everything after it are live — and both compactions sit in
 * the same file, which is what makes the walk's bridging load-bearing here.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugcode/src/replay.ts
 * @covers tugrust/crates/tugcast/src/dead_branch.rs
 * @covers tugrust/crates/tugcast/src/turn_engine.rs
 * @covers tugdeck/src/lib/session-restore.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "b7c0d1ea-0000-4000-8000-00000rewind01";

const TRANSCRIPT = '[data-card-id="A"]';

/** Mirrors tugcode's `encodeProjectDir` (every non-`[A-Za-z0-9-]` → `-`). */
const encodeProjectDir = (absDir: string): string =>
  absDir.replace(/[^A-Za-z0-9-]/g, "-");

const FIXTURE_SRC = join(
  import.meta.dir,
  "fixtures",
  "sessions",
  "session-rewind-branch.jsonl",
);

// Rewrite `cwd` / `sessionId` per run so claude's `--resume` accepts the file
// (it reads the SAME JSONL and reverts to the picker on a `cwd` mismatch). The
// uuid chain is preserved verbatim — that topology is the whole subject.
function rehomeFixture(cwd: string, sessionId: string): string {
  return (
    readFileSync(FIXTURE_SRC, "utf8")
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
  // resolved string.
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0285-proj-")));
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
  "AT0285: a cold replay restores the live chain, once, and nothing abandoned",
  () => {
    test(
      "real spawn_session(resume) replays past two compactions and skips the rewound branch",
      async () => {
        const app = await launchTugApp({ testName: "at0285-restore-dead-branch" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );

          await app.spawnSessionResume("A", { tugSessionId: SID, projectDir });

          // The tail of the session — written after the SECOND compaction —
          // is what a forward-resolving walk used to strand. Waiting on it
          // proves the replay reached the end of the file.
          await app.waitForCondition<boolean>(
            `(document.querySelector(${JSON.stringify(TRANSCRIPT)})||{}).textContent`.concat(
              `?.includes("about the number 6") === true`,
            ),
            { timeoutMs: 30_000 },
          );

          const transcript = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(TRANSCRIPT)})||{}).textContent || ""`,
          );

          // Pre-compaction history stays visible: it left claude's context but
          // it is still the conversation the user had.
          expect(transcript).toContain("ALPHA");
          expect(transcript).toContain("CHARLIE");

          // The diverging submission and everything after it are live.
          expect(transcript).toContain("FOXTROT");
          expect(transcript).toContain("GOLF");

          // DELTA and ECHO were rewound away. Claude's own resume will never
          // show them again; neither may the transcript.
          expect(transcript).not.toContain("DELTA");
          expect(transcript).not.toContain("ECHO");

          // Each live turn renders once — the property compaction re-appends
          // break when a duplicated record is replayed twice.
          const foxtrots = transcript.split("FOXTROT").length - 1;
          expect(foxtrots).toBe(2); // the prompt echo and the reply
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
