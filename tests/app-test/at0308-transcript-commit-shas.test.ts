/**
 * at0308-transcript-commit-shas.test.ts — a commit sha in transcript prose
 * opens the commit.
 *
 * Claude names commits constantly, and the transcript rendered those shas
 * as inert text that was nonetheless painted like code — a thing that
 * looks like a reference and refuses to be followed. This drives the whole
 * round trip against the real app and a real git repository: an assistant
 * message names two hex tokens, one a commit that exists in the bound
 * project and one that never will, and only the first becomes clickable.
 *
 * The verification is the same question as the payload. Asking the
 * repository which files a commit touched both proves the sha resolves
 * and produces the `paths` the diff is scoped to, so a confirmed
 * annotation is already carrying everything the gesture needs.
 *
 * Asserts:
 *  - **the repository gates the affordance**: the real sha gains
 *    `data-tug-annotation="commit-sha"` with its `data-sha` and `data-root`;
 *    the invented one never does, however long we wait;
 *  - **the commit's files ride the annotation**, so the diff opens scoped
 *    to the commit rather than to the whole tree;
 *  - **focus discipline**: the annotation carries the attributes that stop
 *    a click from stealing the composer's caret;
 *  - **the click opens a Diff card** showing the commit.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/lib/annotator/detect-commit-sha.ts
 * @covers tugdeck/src/lib/annotator/commit-resolution.ts
 * @covers tugdeck/src/lib/annotator/registry.ts
 * @covers tugdeck/src/lib/annotator/annotate-transcript.ts
 * @covers tugdeck/src/components/tugways/cards/transcript-host-helpers.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CODE_OUTPUT_FEED = 0x40; // FeedId.CODE_OUTPUT
const SID = "test-session-A";

/** A hex token of sha shape that no repository will ever resolve. */
const INVENTED_SHA = "0123456789abcdef0123456789abcdef01234567";

const COMMITTED_FILE = "alpha.txt";

let projectDir = "";
let realSha = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0308-commits-"));
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "at0308@example.invalid");
  git("config", "user.name", "AT0308");
  writeFileSync(join(projectDir, COMMITTED_FILE), "one\ntwo\n", "utf8");
  git("add", COMMITTED_FILE);
  git("commit", "-q", "-m", "at0308: seed a commit to reference");
  // The short form is what a transcript writes.
  realSha = git("rev-parse", "--short=9", "HEAD");
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
  seq: 1,
});
const turnDone = (msgId: string) => ({
  type: "turn_complete",
  tug_session_id: SID,
  msg_id: msgId,
  result: "success",
});
const replayStarted = () => ({ type: "replay_started", tug_session_id: SID });
const replayComplete = () => ({
  type: "replay_complete",
  tug_session_id: SID,
  count: 1,
  firstLoadedTurnIndex: 0,
  totalTurns: 1,
  hasOlder: false,
});

/** Read the annotation state of the wrapped run whose text is `needle`. */
const shaStateJS = (needle: string) => `JSON.stringify((function(){
  var spans = Array.from(document.querySelectorAll(
    '[data-card-id="A"] [data-tugx-wrapped]'));
  var el = spans.find(function(s){
    return (s.textContent || '') === ${JSON.stringify(needle)};
  });
  if (!el) return { wrapped: false };
  return {
    wrapped: true,
    kind: el.getAttribute('data-tug-annotation'),
    sha: el.getAttribute('data-sha'),
    root: el.getAttribute('data-root'),
    paths: el.getAttribute('data-commit-paths'),
    focus: el.getAttribute('data-tug-focus'),
    noActivate: el.hasAttribute('data-no-activate'),
  };
})())`;

describe.skipIf(!SHOULD_RUN)(
  "AT0308: commit shas in transcript prose open the commit",
  () => {
    test(
      "only the sha the repository knows becomes clickable, and clicking it opens the diff",
      async () => {
        const app = await launchTugApp({
          testName: "at0308-transcript-commit-shas",
        });
        const ingest = (decoded: unknown) =>
          app.driveSession("A", {
            op: "ingestFrame",
            feedId: CODE_OUTPUT_FEED,
            decoded,
          });

        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );
          // The binding names the repository every sha in this transcript
          // is asked about — the card's own project, not the frontmost.
          await app.bindSession("A", {
            tugSessionId: SID,
            sessionMode: "resume",
            projectDir,
            workspaceKey: projectDir,
          });

          await ingest(replayStarted());
          await ingest(userMsg("what landed"));
          await ingest(
            asstText(
              "m1",
              `Landed in ${realSha}, and not in ${INVENTED_SHA}.`,
            ),
          );
          await ingest(turnDone("m1"));
          await ingest(replayComplete());

          // --- the repository confirms one and refuses the other -------
          await app.waitForCondition<boolean>(
            `JSON.parse(${shaStateJS(realSha)}).kind === "commit-sha"`,
            { timeoutMs: 15_000 },
          );
          const confirmed = JSON.parse(
            await app.evalJS<string>(shaStateJS(realSha)),
          ) as Record<string, unknown>;
          expect(confirmed.sha).toBe(realSha);
          expect(confirmed.root).toBe(projectDir);
          // The commit's files ride along, so the diff is scoped to the
          // commit rather than to the whole working tree.
          expect(confirmed.paths).toBe(COMMITTED_FILE);
          expect(confirmed.focus).toBe("refuse");
          expect(confirmed.noActivate).toBe(true);

          const invented = JSON.parse(
            await app.evalJS<string>(shaStateJS(INVENTED_SHA)),
          ) as Record<string, unknown>;
          expect(invented.wrapped).toBe(false);

          // --- the click opens the commit's diff ----------------------
          await app.click(
            `[data-card-id="A"] [data-tug-annotation="commit-sha"]`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-slot="diff-card"], [data-component-id="diff"]') !== null`,
            { timeoutMs: 15_000 },
          );

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0308] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
