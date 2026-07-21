/**
 * at0228-changeset-aggregate.test.ts — the Session card's changes glance,
 * end-to-end, for the behaviors that can ONLY be verified in the real browser
 * against real dev cards + real git ([D117]/[D118]; the Lens changeset section
 * this test originally drove was retired by the Lens Route Rework — the glance
 * is where these behaviors live now):
 *
 *   1. **Init self-heal** — the glance on a non-repo project shows the
 *      "Initialize git" affordance; clicking it runs `git init` and the glance
 *      flips to file rows on the next recompute.
 *   2. **Every row expands** ([D118]) — a modified tracked file's row fold cue
 *      mounts its embedded `DiffBlock` carrying the added line's marker, and an
 *      UNTRACKED file's row expands the same way (the backend synthesizes its
 *      new-file diff — the whole `git diff --no-index` → GIT_DIFF_QUERY → row
 *      body path in one drive). A second click unmounts (collapse-by-unmount).
 *   3. **File click** — an untracked file's path link opens the file in a Text
 *      card showing its content.
 *
 * The commit round-trip itself is covered at the Rust layer and the route
 * open/dismiss drives live in at0253.
 *
 * Two dev cards are opened via real `spawn_session(mode=resume)` (the
 * production binding path): one on a non-repo scratch dir, one on a scratch git
 * repo carrying a modified tracked file and an untracked file. No synthetic
 * ledger seeding — the files flow through the real compose + wire + render.
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
// A distinct marker written as the file's CONTENT: the untracked row's
// synthesized diff must carry it, and the Text card opened from the path link
// must show it.
const DIRTY_CONTENT = "at0228-dirty-marker-9f3a";
// The added line in the modified tracked file — the row diff must show it.
const DIFF_MARKER = "at0228-diff-marker-2e7b";

// Two scratch projects, each opened in its own session card.
interface Scratch {
  cardId: string;
  sid: string;
  repo: boolean; // git-init'd + carries the dirty files
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
      // One untracked file — its row must expand into a SYNTHESIZED new-file
      // diff ([D118]) — and one modified tracked file for the HEAD-diff row.
      writeFileSync(join(s.dir, DIRTY_FILE), `${DIRTY_CONTENT}\n`);
      writeFileSync(join(s.dir, "committed.txt"), `base\n${DIFF_MARKER}\n`);
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

function deckShape() {
  return {
    cards: [
      { id: "B", componentId: "session", title: "Session B", closable: true },
      { id: "C", componentId: "session", title: "Session C", closable: true },
    ],
    panes: [
      { id: "p2", position: { x: 40, y: 40 }, size: { width: 680, height: 560 }, cardIds: ["B"], activeCardId: "B", title: "", acceptsFamilies: ["maker"] },
      { id: "p3", position: { x: 740, y: 40 }, size: { width: 680, height: 560 }, cardIds: ["C"], activeCardId: "C", title: "", acceptsFamilies: ["maker"] },
    ],
    activePaneId: "p2",
    hasFocus: true,
  };
}

/** The changes glance pane inside one card. */
const glance = (cardId: string): string =>
  `[data-card-id="${cardId}"] .session-view-pane[data-view="changes"]`;

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!SHOULD_RUN)("AT0228: changes glance — Init self-heal, expandable rows, file click", () => {
  test(
    "Init self-heals; modified AND untracked rows expand into diffs; a file opens in a Text card",
    async () => {
      const app = await launchTugApp({ testName: "at0228-changeset-aggregate" });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "B" });
        for (const s of SCRATCH) {
          await app.spawnSessionResume(s.cardId, { tugSessionId: s.sid, projectDir: s.dir });
        }
        // Wait for each card's replay to land (transcript cells render) so the
        // composer is live before we type into it.
        for (const s of SCRATCH) {
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('[data-card-id="${s.cardId}"] [data-tug-list-cell-index]').length >= 2`,
            { timeoutMs: 30_000 },
          );
        }

        // Open each card's changes glance by submitting `/commit` in its
        // composer (the at0253 drive — the local verb enters the route and
        // raises the bottom-anchored sheet).
        const openGlance = async (cardId: string): Promise<void> => {
          const composer = `[data-card-id="${cardId}"] [data-slot="tug-text-editor"] .cm-content`;
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(composer)}) !== null`,
            { timeoutMs: 20_000 },
          );
          await app.nativeClickAtElement(composer);
          await app.nativeType("/commit");
          await settle();
          // Dismiss the slash-completion popup if (and only if) it opened — a
          // stray Escape with no popup to consume falls through the chain.
          const completionOpen = await app.evalJS<boolean>(
            `document.querySelector('[data-slot="tug-completion-menu"]') !== null`,
          );
          if (completionOpen) {
            await app.nativeKey("Escape");
            await settle();
          }
          await app.nativeKey("Return", ["cmd"]);
          try {
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(`${glance(cardId)} [data-slot="tug-sheet"]`)}) !== null`,
              { timeoutMs: 8000 },
            );
          } catch (e) {
            const diag = await app.evalJS<unknown>(
              `(function(){
                var card = document.querySelector('[data-card-id="${cardId}"]');
                var editor = card ? card.querySelector('[data-slot="tug-text-editor"] .cm-content') : null;
                return {
                  cardPresent: card !== null,
                  editorText: editor ? editor.textContent : null,
                  allCards: Array.from(document.querySelectorAll('[data-card-id]')).map(function(n){ return n.getAttribute('data-card-id'); }),
                  sheets: document.querySelectorAll('[data-slot="tug-sheet"]').length,
                  viewPanes: Array.from(document.querySelectorAll('.session-view-pane')).map(function(p){ return p.getAttribute('data-view'); }),
                  commitButtons: document.querySelectorAll('[data-testid="tug-prompt-entry-commit-button"]').length,
                  focused: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null,
                };
              })()`,
            );
            console.error("openGlance diagnostics:", JSON.stringify(diag));
            throw e;
          }
        };

        // (1) Init self-heal: the non-repo card's glance shows the Init
        // affordance; clicking it runs `git init` and the non-repo body yields
        // to the (empty) changes view on the next recompute.
        await openGlance(NON_REPO.cardId);
        const GIT_INIT = `${glance(NON_REPO.cardId)} [data-testid="session-changes-git-init"]`;
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(GIT_INIT)}) !== null`,
          { timeoutMs: 20_000 },
        );
        await app.click(GIT_INIT);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(
            `${glance(NON_REPO.cardId)} [data-testid="session-changes-non-repo"]`,
          )}) === null`,
          { timeoutMs: 20_000 },
        );
        expect(existsSync(join(NON_REPO.dir, ".git")), "git init created a .git dir").toBe(true);

        // Exit B's commit route (Escape while B holds focus) so its sheet and
        // route chrome are down before driving card C.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(`${glance(NON_REPO.cardId)} [data-slot="tug-sheet"]`)}) === null`,
          { timeoutMs: 6000 },
        );

        // (2) Expandable rows on the repo card: both dirty files surface as
        // rows (the session touched neither, so they land in the project's
        // unattributed entry) with LIVE fold cues — the untracked row too
        // ([D118]: no more status-dependent disabled chevron).
        await openGlance(REPO.cardId);
        const ROW = (path: string): string =>
          `${glance(REPO.cardId)} [data-testid="tug-changes-list-file-block"][data-path="${path}"]`;
        const FOLD = (path: string): string => `${ROW(path)} [data-slot="tug-changes-list-fold"]`;
        const DIFF_BODY = (path: string): string =>
          `${ROW(path)} [data-slot="tug-changes-list-file-diff"]`;
        await app.waitForCondition<boolean>(
          `document.querySelector('${FOLD("committed.txt")}') !== null &&
           document.querySelector('${FOLD(DIRTY_FILE)}') !== null`,
          { timeoutMs: 30_000 },
        );
        expect(
          await app.evalJS<boolean>(
            `(function(){ var d = document.querySelector('${FOLD(DIRTY_FILE)}'); return d !== null && d.disabled !== true; })()`,
          ),
          "an untracked file's fold cue is live ([D118])",
        ).toBe(true);

        // The modified tracked row expands into its HEAD diff…
        await app.click(FOLD("committed.txt"));
        await app.waitForCondition<boolean>(
          `(function(){
            var d = document.querySelector('${DIFF_BODY("committed.txt")}');
            return d !== null && (d.textContent || "").indexOf(${JSON.stringify(DIFF_MARKER)}) !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );
        // …and collapses by unmount.
        await app.click(FOLD("committed.txt"));
        await app.waitForCondition<boolean>(
          `document.querySelector('${DIFF_BODY("committed.txt")}') === null`,
          { timeoutMs: 8000 },
        );

        // The UNTRACKED row expands into its synthesized new-file diff — the
        // content marker arrives as an added line through the real
        // GIT_DIFF_QUERY round trip.
        await app.click(FOLD(DIRTY_FILE));
        await app.waitForCondition<boolean>(
          `(function(){
            var d = document.querySelector('${DIFF_BODY(DIRTY_FILE)}');
            return d !== null && (d.textContent || "").indexOf(${JSON.stringify(DIRTY_CONTENT)}) !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );

        // (3) File click: the untracked file's path link opens it in a Text
        // card showing the marker content.
        await app.click(
          `${ROW(DIRTY_FILE)} [data-slot="tug-changes-list-file-ref"][title="${DIRTY_FILE}"]`,
        );
        await app.waitForCondition<boolean>(
          `(function(){
            var eds = document.querySelectorAll('[data-slot="tug-text-card-editor"] .cm-content');
            for (var i = 0; i < eds.length; i++) {
              if ((eds[i].textContent || "").indexOf(${JSON.stringify(DIRTY_CONTENT)}) !== -1) return true;
            }
            return false;
          })()`,
          { timeoutMs: 10_000 },
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
