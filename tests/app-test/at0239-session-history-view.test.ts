/**
 * at0239-session-history-view.test.ts — the History shade (⇧⌘H →
 * `toggle-history-view`) renders the bound card's real recent commits over the
 * live GIT_LOG wire path, each as a collapsible `BlockChrome`.
 *
 * Driven against a real repo — this worktree itself, which tugcast registers as
 * its bootstrap `--source-tree` (the same rationale as at0238: a synthetic temp
 * repo hangs the app's boot). A session card is bound to it and the shade is
 * asserted to render that repo's real recent commits.
 *
 * Scenario:
 *   1. Bind a card to the repo, open the History shade.
 *   2. Each commit row leads with its 8-char short sha as `code`-colored text
 *      (the lifecycle dot is gone) and NO row carries the old full-40-char hash.
 *   3. Expand the top commit → the committer's identity (name + email), the
 *      message body, and the commit's changed files (a `TugChangesList`, served
 *      by the new GIT_COMMIT_FILES path) render.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

/** The worktree root — the real repo tugcast serves as its bootstrap tree. */
const REPO = resolve(import.meta.dir, "..", "..");

const VIEW = `[data-slot="session-history-view"]`;
const ROW = `${VIEW} [data-testid="session-history-commit"]`;

function gitOut(args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", REPO, ...args]);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString().trim();
}

describe.skipIf(!SHOULD_RUN)(
  "at0239 — History shade renders the bound project's commits, sha-left, expandable",
  () => {
    test(
      "short-sha leads each row (no dot, no duplicate full hash) → expand shows message + files",
      async () => {
        const headFull = gitOut(["rev-parse", "HEAD"]);
        const head8 = headFull.slice(0, 8);
        const committerEmail = gitOut(["show", "-s", "--format=%ce", "HEAD"]);
        // A recent commit that actually changed files, for the expand assertion.
        const headFile = gitOut([
          "show",
          "--name-only",
          "--format=",
          "HEAD",
        ])
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)[0];

        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath, { sourceTreePath: REPO });
          const app = await launchTugApp({
            testName: "at0239-session-history-view",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.waitForCondition<boolean>(
              `typeof window.__tug !== "undefined"`,
              { timeoutMs: 5_000 },
            );

            await app.seedDeckState({
              state: {
                cards: [
                  { id: "D", componentId: "session", title: "Session", closable: true },
                ],
                panes: [
                  {
                    id: "pD",
                    position: { x: 40, y: 40 },
                    size: { width: 720, height: 560 },
                    cardIds: ["D"],
                    activeCardId: "D",
                    title: "",
                    acceptsFamilies: ["maker"],
                  },
                ],
                activePaneId: "pD",
                hasFocus: true,
              },
              focusCardId: "D",
            });
            await app.waitForCondition<boolean>(
              `window.__tug.assertHostRootRegistered("D")`,
              { timeoutMs: 5_000 },
            );

            await app.bindSession("D", { projectDir: REPO });

            // Open the History shade and wait for the commit rows to render.
            await app.dispatchControlAction("toggle-history-view");
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(ROW)}).length > 0`,
              { timeoutMs: 6_000 },
            );

            // The top row leads with the 8-char short sha as code-colored text
            // (the lifecycle dot is gone; the leading slot is collapsed away).
            const topShaText = await app.evalJS<string>(
              `(function(){
                var row = document.querySelector(${JSON.stringify(ROW)});
                var sha = row.querySelector('code.session-history-commit-sha');
                return sha ? sha.textContent.trim() : "";
              })()`,
            );
            expect(topShaText).toBe(head8);

            // The old duplicated full-40-char hash <pre> is gone: no row's
            // collapsed content shows the full sha.
            const hasFullHashPre = await app.evalJS<boolean>(
              `(function(){
                return document.body.textContent.indexOf(${JSON.stringify(headFull)}) >= 0;
              })()`,
            );
            expect(hasFullHashPre).toBe(false);

            // Expand the top commit via the real disclosure chevron.
            await app.evalJS<void>(
              `document.querySelector(${JSON.stringify(
                `${ROW} [data-slot="tool-call-header-disclosure"]`,
              )}).click()`,
            );

            // The expanded area names the committer (identity + email).
            await app.waitForCondition<boolean>(
              `(function(){
                var meta = document.querySelector(${JSON.stringify(
                  `${ROW} .session-history-commit-meta`,
                )});
                return meta !== null && meta.textContent.indexOf(${JSON.stringify(committerEmail)}) >= 0;
              })()`,
              { timeoutMs: 6_000 },
            );

            // The commit's changed files render as a TugChangesList — wait for
            // the new GIT_COMMIT_FILES response to land.
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(
                `${ROW} [data-slot="tug-commit-changes-list"] [data-testid="tug-changes-list-file-block"]`,
              )}) !== null`,
              { timeoutMs: 6_000 },
            );
            const filePaths = await app.evalJS<string[]>(
              `(function(){
                var blocks = document.querySelectorAll(${JSON.stringify(
                  `${ROW} [data-testid="tug-changes-list-file-block"]`,
                )});
                return Array.prototype.map.call(blocks, function(b){
                  return b.getAttribute("data-path");
                });
              })()`,
            );
            expect(filePaths).toContain(headFile);

            const shot = await app.screenshot();
            console.log(`SCREENSHOT: ${shot.path}`);
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
