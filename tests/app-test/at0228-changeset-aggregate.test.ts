/**
 * at0228-changeset-aggregate.test.ts — the account-global changeset card with
 * a second (non-repo) open project, end-to-end over the aggregate
 * CHANGESET_ALL feed (0x24) and the `changeset_git_init` CONTROL verb.
 *
 * The aggregate card shows every open workspace at once. The bootstrap
 * `--source-tree` (a git repo) is always one project; this test opens a
 * SECOND workspace on a **non-repo** scratch dir by firing a real
 * `spawn_session(mode=resume)` against a fixture JSONL (the same registration
 * path production uses — `do_spawn_session` calls `WorkspaceRegistry::
 * get_or_create`). The aggregate then carries two projects:
 *
 *   1. **Two project sections** — the bootstrap repo and the scratch dir both
 *      appear as collapsible project sections.
 *   2. **Non-repo Init affordance** — the scratch section shows the
 *      "Initialize git" button (it is not a git repository).
 *   3. **Init click-through** — clicking it fires `changeset_git_init`, tugcast
 *      runs `git init -b main`, fires the aggregate bump, and the section
 *      self-heals: the non-repo state (and its Init button) is gone on the
 *      next recompute.
 *
 * (The repo-project read path — owner grouping, badges, unattributed, and a
 * file click opening a Text card — is covered by at0227 on the bootstrap
 * project; this file focuses on the multi-project + non-repo + Init surface.)
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

const SID = "at0228-nonrepo-session";

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
        id: "msg-nonrepo-1",
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

let projectDir = "";
let fixtureDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  // realpath: macOS mkdtemp returns /var/folders/…; tugcode + claude resolve
  // /var → /private/var before encoding, so encode + spawn against the SAME
  // resolved string or the fixture lands where neither reads it.
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "at0228-proj-")));
  fixtureDir = join(homedir(), ".claude", "projects", encodeProjectDir(projectDir));
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, `${SID}.jsonl`), buildFixtureJsonl(projectDir, SID));
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  if (fixtureDir !== "" && existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

const CARD = '[data-card-id="A"]';

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "changeset", title: "Changeset", closable: true },
      { id: "B", componentId: "dev", title: "Dev", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
      {
        id: "p2",
        position: { x: 800, y: 40 },
        size: { width: 720, height: 560 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** The project section whose display name === `name`, or null. Returns a small
 *  descriptor the caller can assert on. */
function projectSectionProbe(name: string): string {
  return `(function(){
    var sections = Array.from(document.querySelectorAll(${JSON.stringify(`${CARD} [data-testid="changeset-project"]`)}));
    var match = sections.find(function(s){
      var n = s.querySelector(".changeset-project-name");
      return n !== null && n.textContent.trim() === ${JSON.stringify(name)};
    });
    if (!match) return { present: false, nonRepo: false, count: sections.length };
    return {
      present: true,
      nonRepo: match.querySelector('[data-testid="changeset-non-repo"]') !== null,
      count: sections.length,
    };
  })()`;
}

describe.skipIf(!SHOULD_RUN)("AT0228: aggregate changeset — two projects + non-repo Init", () => {
  test(
    "a second non-repo workspace shows an Init affordance that self-heals on click",
    async () => {
      const app = await launchTugApp({ testName: "at0228-changeset-aggregate" });
      const scratchName = basename(projectDir);
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "B" });

        // The bootstrap project (the source-tree repo) is always present.
        await app.waitForCondition<boolean>(
          `(function(){
            return document.querySelectorAll(${JSON.stringify(`${CARD} [data-testid="changeset-project"]`)}).length >= 1;
          })()`,
          { timeoutMs: 20_000 },
        );

        // Open a SECOND workspace on the non-repo scratch dir via a real
        // resume — `do_spawn_session` registers it with the WorkspaceRegistry,
        // so the aggregate picks it up.
        await app.spawnSessionResume("B", { tugSessionId: SID, projectDir });

        // The scratch project appears as a non-repo section (Init affordance),
        // alongside the bootstrap repo — two project sections total.
        await app.waitForCondition<boolean>(
          `(function(){ var p = ${projectSectionProbe(scratchName)}; return p.present && p.nonRepo && p.count >= 2; })()`,
          { timeoutMs: 30_000 },
        );

        const before = await app.evalJS<{ present: boolean; nonRepo: boolean; count: number }>(
          projectSectionProbe(scratchName),
        );
        expect(before.present, "scratch project section present").toBe(true);
        expect(before.nonRepo, "scratch project shows the non-repo Init state").toBe(true);
        expect(before.count, "bootstrap + scratch = at least two projects").toBeGreaterThanOrEqual(
          2,
        );

        // TOC: one thin entry per project, matching the section count.
        const tocCount = await app.evalJS<number>(
          `document.querySelectorAll('${CARD} [data-testid="changeset-toc-entry"]').length`,
        );
        expect(tocCount, "one TOC entry per project section").toBe(before.count);

        const openCountJs = `document.querySelectorAll('${CARD} [data-testid="changeset-project"][data-state="open"]').length`;

        // Collapse all → no project accordion open.
        await app.click(`${CARD} [data-testid="changeset-collapse-all"]`);
        await app.waitForCondition<boolean>(`${openCountJs} === 0`, { timeoutMs: 8000 });

        // Click the scratch project's TOC entry → exactly its (non-repo)
        // accordion opens.
        await app.click(`${CARD} [data-testid="changeset-toc-entry"][title="${projectDir}"]`);
        await app.waitForCondition<boolean>(
          `(function(){
            var open = Array.from(document.querySelectorAll('${CARD} [data-testid="changeset-project"][data-state="open"]'));
            return open.length === 1 &&
              open[0].querySelector('[data-testid="changeset-non-repo"]') !== null;
          })()`,
          { timeoutMs: 8000 },
        );

        // Expand all → every project accordion open.
        await app.click(`${CARD} [data-testid="changeset-expand-all"]`);
        await app.waitForCondition<boolean>(`${openCountJs} === ${before.count}`, {
          timeoutMs: 8000,
        });

        // Click "Initialize git" → the verb runs `git init -b main`, fires the
        // aggregate bump, and the section self-heals: no longer non-repo.
        await app.click(`${CARD} [data-testid="changeset-git-init"]`);
        await app.waitForCondition<boolean>(
          `(function(){ var p = ${projectSectionProbe(scratchName)}; return p.present && !p.nonRepo; })()`,
          { timeoutMs: 20_000 },
        );

        const after = await app.evalJS<{ present: boolean; nonRepo: boolean }>(
          projectSectionProbe(scratchName),
        );
        expect(after.present, "scratch project still present after init").toBe(true);
        expect(after.nonRepo, "scratch project is no longer non-repo after git init").toBe(false);
        expect(existsSync(join(projectDir, ".git")), "git init created a .git dir").toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
