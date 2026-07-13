/**
 * at0228-changeset-aggregate.test.ts — the changeset card, end-to-end, for the
 * three behaviors that can ONLY be verified in the real browser against real
 * dev cards + real git (everything else — snapshot partitioning, the aggregate
 * feed, the git_init verb — is covered by Rust unit tests on real content):
 *
 *   1. **Open-dev-card filter** — the card shows EXACTLY the projects the user
 *      has a dev card open on. The bootstrap `--source-tree` is registered but
 *      has no dev card bound to it, so it must NOT appear.
 *   2. **Init self-heal** — clicking "Initialize git" on a non-repo project
 *      runs `git init`, and the section flips to a repo on the next recompute.
 *   3. **File click** — a present file in a project opens in a Text card.
 *
 * Two dev cards are opened via real `spawn_session(mode=resume)` (the
 * production binding path): one on a non-repo scratch dir, one on a scratch git
 * repo carrying a single untracked file. No synthetic ledger seeding — the file
 * flows through the real compose + wire + render.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/** Mirror tugcode's `encodeProjectDir`: every non-`[A-Za-z0-9-]` char → `-`. */
const encodeProjectDir = (absDir: string): string => absDir.replace(/[^A-Za-z0-9-]/g, "-");

/** A minimal but claude-`--resume`-satisfying session JSONL (see at0192). */
function buildFixtureJsonl(cwd: string, sessionId: string): string {
  const base = {
    isSidechain: false,
    userType: "external",
    cwd,
    sessionId,
    version: "2.1.105",
    gitBranch: "main",
  };
  const lines = [
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-4000-8000-000000000d01",
      timestamp: "2026-06-17T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    },
    {
      ...base,
      parentUuid: "00000000-0000-4000-8000-000000000d01",
      type: "assistant",
      uuid: "00000000-0000-4000-8000-000000000d02",
      timestamp: "2026-06-17T10:00:01.000Z",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "hi there" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 1200,
          output_tokens: 50,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 8000,
        },
      },
    },
  ];
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

function git(dir: string, args: string[]): void {
  const r = Bun.spawnSync(["git", "-C", dir, ...args]);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
}

const DIRTY_FILE = "at0228-dirty.txt";
// A distinct marker written as the file's CONTENT, so the file-click assertion
// can confirm the Text card opened on THIS file (the editor shows content).
const DIRTY_CONTENT = "at0228-dirty-marker-9f3a";

// Two scratch projects, each opened in its own dev card.
interface Scratch {
  cardId: string;
  sid: string;
  repo: boolean; // git-init'd + carries an untracked file
  dir: string;
  fixtureDir: string;
}
const NON_REPO: Scratch = { cardId: "B", sid: "at0228-b", repo: false, dir: "", fixtureDir: "" };
const REPO: Scratch = { cardId: "C", sid: "at0228-c", repo: true, dir: "", fixtureDir: "" };
const SCRATCH: Scratch[] = [NON_REPO, REPO];

beforeAll(() => {
  if (!SHOULD_RUN) return;
  for (const s of SCRATCH) {
    // realpath: macOS mkdtemp returns /var/folders/…; tugcode + claude resolve
    // /var → /private/var before encoding, so encode + spawn against the SAME
    // resolved string or the fixture lands where neither reads it.
    s.dir = realpathSync(mkdtempSync(join(tmpdir(), "at0228-proj-")));
    if (s.repo) {
      git(s.dir, ["init", "-q", "-b", "main"]);
      git(s.dir, ["config", "user.email", "t@t"]);
      git(s.dir, ["config", "user.name", "t"]);
      writeFileSync(join(s.dir, "committed.txt"), "base\n");
      git(s.dir, ["add", "."]);
      git(s.dir, ["commit", "-q", "-m", "base"]);
      // One untracked file — it flows into the card as an unattributed,
      // clickable file row.
      writeFileSync(join(s.dir, DIRTY_FILE), `${DIRTY_CONTENT}\n`);
    }
    s.fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(s.dir));
    mkdirSync(s.fixtureDir, { recursive: true });
    writeFileSync(join(s.fixtureDir, `${s.sid}.jsonl`), buildFixtureJsonl(s.dir, s.sid));
  }
});

afterAll(() => {
  for (const s of SCRATCH) {
    if (s.dir !== "" && existsSync(s.dir)) rmSync(s.dir, { recursive: true, force: true });
    if (s.fixtureDir !== "" && existsSync(s.fixtureDir)) {
      rmSync(s.fixtureDir, { recursive: true, force: true });
    }
  }
});

const CARD = '[data-card-id="A"]';

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "changeset", title: "Changeset", closable: true },
      { id: "B", componentId: "dev", title: "Dev B", closable: true },
      { id: "C", componentId: "dev", title: "Dev C", closable: true },
    ],
    panes: [
      { id: "p1", position: { x: 40, y: 40 }, size: { width: 680, height: 560 }, cardIds: ["A"], activeCardId: "A", title: "", acceptsFamilies: ["maker"] },
      { id: "p2", position: { x: 740, y: 40 }, size: { width: 680, height: 560 }, cardIds: ["B"], activeCardId: "B", title: "", acceptsFamilies: ["maker"] },
      { id: "p3", position: { x: 740, y: 620 }, size: { width: 680, height: 560 }, cardIds: ["C"], activeCardId: "C", title: "", acceptsFamilies: ["maker"] },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

const PROJECT_NAMES_JS = `Array.from(document.querySelectorAll('${CARD} [data-testid="changeset-project"] .changeset-project-name')).map(function(n){ return n.textContent.trim(); })`;

function nonRepoProbe(name: string): string {
  return `(function(){
    var sections = Array.from(document.querySelectorAll('${CARD} [data-testid="changeset-project"]'));
    var match = sections.find(function(s){
      var n = s.querySelector(".changeset-project-name");
      return n !== null && n.textContent.trim() === ${JSON.stringify(name)};
    });
    if (!match) return { present: false, nonRepo: false };
    return { present: true, nonRepo: match.querySelector('[data-testid="changeset-non-repo"]') !== null };
  })()`;
}

describe.skipIf(!SHOULD_RUN)("AT0228: changeset card — open-dev-card filter, Init, file click", () => {
  test(
    "shows exactly the open dev-card projects; Init self-heals; a file opens in a Text card",
    async () => {
      const app = await launchTugApp({ testName: "at0228-changeset-aggregate" });
      const nonRepoName = basename(NON_REPO.dir);
      const repoName = basename(REPO.dir);
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        for (const s of SCRATCH) {
          await app.spawnSessionResume(s.cardId, { tugSessionId: s.sid, projectDir: s.dir });
        }

        // (1) Filter: the card settles on EXACTLY the two open-dev-card
        // projects. The bootstrap source-tree is registered but unbound to any
        // dev card, so it must be absent.
        await app.waitForCondition<boolean>(
          `(function(){
            var names = ${PROJECT_NAMES_JS};
            return names.length === 2 &&
              names.indexOf(${JSON.stringify(nonRepoName)}) !== -1 &&
              names.indexOf(${JSON.stringify(repoName)}) !== -1;
          })()`,
          { timeoutMs: 30_000 },
        );
        const names = await app.evalJS<string[]>(PROJECT_NAMES_JS);
        expect(names.sort()).toEqual([nonRepoName, repoName].sort());

        // (2) Init self-heal: click "Initialize git" on the non-repo project →
        // the section flips to a repo on the next recompute.
        expect(
          (await app.evalJS<{ nonRepo: boolean }>(nonRepoProbe(nonRepoName))).nonRepo,
          "the non-repo project shows the Init affordance",
        ).toBe(true);
        await app.click(
          `${CARD} [data-testid="changeset-project"][data-project-dir="${NON_REPO.dir}"] [data-testid="changeset-git-init"]`,
        );
        await app.waitForCondition<boolean>(
          `(function(){ var p = ${nonRepoProbe(nonRepoName)}; return p.present && !p.nonRepo; })()`,
          { timeoutMs: 20_000 },
        );
        expect(existsSync(join(NON_REPO.dir, ".git")), "git init created a .git dir").toBe(true);

        // (3) File click: the repo project's untracked file renders as a link;
        // clicking it opens that file in a Text card.
        const FILE_LINK = `${CARD} [data-testid="changeset-project"][data-project-dir="${REPO.dir}"] [data-slot="changeset-file-ref"][title="${DIRTY_FILE}"]`;
        await app.waitForCondition<boolean>(
          `document.querySelector('${FILE_LINK}') !== null`,
          { timeoutMs: 20_000 },
        );
        await app.click(FILE_LINK);
        // A Text card opens showing THIS file's content (the marker).
        await app.waitForCondition<boolean>(
          `(function(){
            var eds = document.querySelectorAll('[data-slot="tug-text-card-editor"] .cm-content');
            for (var i = 0; i < eds.length; i++) {
              if ((eds[i].textContent || "").indexOf(${JSON.stringify(DIRTY_CONTENT)}) !== -1) return true;
            }
            return false;
          })()`,
          { timeoutMs: 8000 },
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
