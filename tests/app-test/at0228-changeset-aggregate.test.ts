/**
 * at0228-changeset-aggregate.test.ts — the changeset card, end-to-end, for the
 * three behaviors that can ONLY be verified in the real browser against real
 * dev cards + real git (everything else — snapshot partitioning, the aggregate
 * feed's session-row join, the git_init verb — is covered by Rust unit tests
 * on real content):
 *
 *   1. **Open-dev-card filter** — the card shows one session entry per open
 *      dev card, and ONLY those. The bootstrap `--source-tree` is registered
 *      (and its workspace has ledger rows) but no dev card here is bound to
 *      it, so it must NOT appear.
 *   2. **Init self-heal** — clicking "Initialize git" on a session entry in a
 *      non-repo directory runs `git init`, and the entry flips to a repo on
 *      the next recompute.
 *   3. **File click** — a dirty file (in the project's Unattributed entry)
 *      opens in a Text card.
 *   4. **Diff click** — a modified tracked file's diff affordance opens the
 *      diff sheet scoped to exactly that file (a second modified file stays
 *      out — the pathspec flows through the GIT_DIFF_QUERY round trip).
 *   5. **Card commit** — selecting one file, drafting a message, and
 *      committing runs the changeset_commit verb: HEAD gains exactly that
 *      file, the receipt renders its numstat, and the aggregate recompute
 *      drops the committed row.
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
import { join } from "node:path";
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
// The added line in the modified tracked file — the diff sheet must show it.
const DIFF_MARKER = "at0228-diff-marker-2e7b";

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
      writeFileSync(join(s.dir, "other.txt"), "other-base\n");
      git(s.dir, ["add", "."]);
      git(s.dir, ["commit", "-q", "-m", "base"]);
      // One untracked file — it flows into the card as an unattributed,
      // clickable file row.
      writeFileSync(join(s.dir, DIRTY_FILE), `${DIRTY_CONTENT}\n`);
      // Two modified tracked files — the diff-click assertion scopes the
      // sheet to one and proves the other stays out.
      writeFileSync(join(s.dir, "committed.txt"), `base\n${DIFF_MARKER}\n`);
      writeFileSync(join(s.dir, "other.txt"), "other-base\nother-changed\n");
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

const SESSION_IDS_JS = `Array.from(document.querySelectorAll('${CARD} [data-testid="changeset-toc-entry"][data-session-id]')).map(function(n){ return n.getAttribute("data-session-id"); })`;

function nonRepoProbe(sid: string): string {
  return `(function(){
    var entry = document.querySelector('${CARD} [data-testid="changeset-entry"][data-entry-id="session:${sid}"]');
    if (!entry) return { present: false, nonRepo: false };
    return { present: true, nonRepo: entry.querySelector('[data-testid="changeset-non-repo"]') !== null };
  })()`;
}

describe.skipIf(!SHOULD_RUN)("AT0228: changeset card — open-dev-card filter, Init, file click", () => {
  test(
    "shows exactly the open dev-card projects; Init self-heals; a file opens in a Text card",
    async () => {
      const app = await launchTugApp({ testName: "at0228-changeset-aggregate" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        for (const s of SCRATCH) {
          await app.spawnSessionResume(s.cardId, { tugSessionId: s.sid, projectDir: s.dir });
        }

        // (1) Filter: the card settles on EXACTLY the two open dev cards'
        // sessions (one row each). The bootstrap source-tree is registered but
        // unbound to any dev card here, so none of its sessions appear.
        await app.waitForCondition<boolean>(
          `(function(){
            var ids = ${SESSION_IDS_JS};
            return ids.length === 2 &&
              ids.indexOf(${JSON.stringify(NON_REPO.sid)}) !== -1 &&
              ids.indexOf(${JSON.stringify(REPO.sid)}) !== -1;
          })()`,
          { timeoutMs: 30_000 },
        );
        const ids = await app.evalJS<string[]>(SESSION_IDS_JS);
        expect(ids.sort()).toEqual([NON_REPO.sid, REPO.sid].sort());

        // (2) Init self-heal: the non-repo session entry hosts the Init
        // affordance; clicking it flips the entry to a repo on the next
        // recompute.
        expect(
          (await app.evalJS<{ nonRepo: boolean }>(nonRepoProbe(NON_REPO.sid))).nonRepo,
          "the non-repo session entry shows the Init affordance",
        ).toBe(true);
        await app.click(
          `${CARD} [data-testid="changeset-entry"][data-entry-id="session:${NON_REPO.sid}"] [data-testid="changeset-git-init"]`,
        );
        await app.waitForCondition<boolean>(
          `(function(){ var p = ${nonRepoProbe(NON_REPO.sid)}; return p.present && !p.nonRepo; })()`,
          { timeoutMs: 20_000 },
        );
        expect(existsSync(join(NON_REPO.dir, ".git")), "git init created a .git dir").toBe(true);

        // (3) Diff click: each file is a BlockChrome ([P25]/[P29]); the modified
        // tracked file's block carries an ENABLED disclosure chevron, the
        // untracked file's is DISABLED (no HEAD side). Clicking the chevron
        // mounts the file's embedded `DiffBlock` in the block body carrying the
        // added line's marker; a second click unmounts it (collapse-by-unmount)
        // so the later commit leg reads a clean file list.
        const UNATTRIBUTED = `${CARD} [data-testid="changeset-entry"][data-entry-id="unattributed:${REPO.dir}"]`;
        const FILE_BLOCK = `${UNATTRIBUTED} [data-testid="changeset-file-block"][data-path="committed.txt"]`;
        const DISCLOSURE = `${FILE_BLOCK} [data-slot="tool-call-header-disclosure"]`;
        const FILE_BODY = `${FILE_BLOCK} [data-slot="tool-block-body"]`;
        const UNTRACKED_DISCLOSURE = `${UNATTRIBUTED} [data-testid="changeset-file-block"][data-path="${DIRTY_FILE}"] [data-slot="tool-call-header-disclosure"]`;
        await app.waitForCondition<boolean>(
          `document.querySelector('${DISCLOSURE}') !== null`,
          { timeoutMs: 20_000 },
        );
        expect(
          await app.evalJS<boolean>(
            `(function(){ var d = document.querySelector('${UNTRACKED_DISCLOSURE}'); return d !== null && d.disabled === true; })()`,
          ),
          "an untracked file's disclosure chevron is disabled (no HEAD side)",
        ).toBe(true);
        await app.click(DISCLOSURE);
        await app.waitForCondition<boolean>(
          `(function(){
            var d = document.querySelector('${FILE_BODY}');
            return d !== null &&
              (d.textContent || "").indexOf(${JSON.stringify(DIFF_MARKER)}) !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );
        await app.click(DISCLOSURE);
        await app.waitForCondition<boolean>(
          `document.querySelector('${FILE_BODY}') === null`,
          { timeoutMs: 8000 },
        );

        // (4) Card commit: deselect all but other.txt in the Unattributed
        // entry, draft a message, commit. The verb must commit exactly the
        // selected file (numstat receipt names it; the other two dirty paths
        // survive on disk), and the aggregate recompute drops the committed
        // row from the entry.
        await app.click(`${UNATTRIBUTED} [data-testid="changeset-file-select"][data-path="committed.txt"]`);
        await app.click(`${UNATTRIBUTED} [data-testid="changeset-file-select"][data-path="${DIRTY_FILE}"]`);
        // The commit field is now the CM6 `TugMessageEditor` ([P26]/[P28]): its
        // document has no `<textarea>.value`, so `app.type` can't drive it. Use
        // the house CM6-typing pattern — focus the field's `.cm-content` and
        // `execCommand("insertText", …)` — scoped under the composer block.
        await app.evalJS<boolean>(
          `(function(){
            var el = document.querySelector('${UNATTRIBUTED} [data-testid="changeset-commit-message"] .cm-content');
            if (el === null) return false;
            el.focus();
            // Replace any pre-filled draft so the message is exactly ours.
            document.execCommand("selectAll");
            document.execCommand("insertText", false, "at0228 card commit");
            return true;
          })()`,
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${UNATTRIBUTED} [data-testid="changeset-commit-message"] .cm-content');
            return el !== null && (el.textContent || "").indexOf("at0228 card commit") !== -1;
          })()`,
          { timeoutMs: 8000 },
        );
        await app.click(`${UNATTRIBUTED} [data-testid="changeset-commit-button"]`);
        await app.waitForCondition<boolean>(
          `(function(){
            var receipt = document.querySelector('${UNATTRIBUTED} [data-testid="changeset-commit-receipt"]');
            return receipt !== null && (receipt.textContent || "").indexOf("other.txt") !== -1;
          })()`,
          { timeoutMs: 20_000 },
        );
        // On disk: HEAD holds exactly other.txt; the deselected files are
        // still dirty.
        const show = Bun.spawnSync(["git", "-C", REPO.dir, "show", "--numstat", "--format=", "HEAD"]);
        const numstatPaths = show.stdout
          .toString()
          .trim()
          .split("\n")
          .map((l) => l.split("\t")[2]);
        expect(numstatPaths).toEqual(["other.txt"]);
        const porcelain = Bun.spawnSync(["git", "-C", REPO.dir, "status", "--porcelain"]).stdout.toString();
        expect(porcelain).toContain(" M committed.txt");
        expect(porcelain).toContain(`?? ${DIRTY_FILE}`);
        // The committed row leaves the entry on the next recompute.
        await app.waitForCondition<boolean>(
          `document.querySelector('${UNATTRIBUTED} [data-testid="changeset-file-select"][data-path="other.txt"]') === null`,
          { timeoutMs: 20_000 },
        );

        // (5) File click: the repo's untracked file lands in the project's
        // Unattributed entry as a link; clicking it opens the file in a Text
        // card.
        const FILE_LINK = `${CARD} [data-testid="changeset-entry"][data-entry-id="unattributed:${REPO.dir}"] [data-slot="changeset-file-ref"][title="${DIRTY_FILE}"]`;
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
