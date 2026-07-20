/**
 * at0238-lens-git-history.test.ts — the Lens **Git History** section renders
 * the followed session card's real recent commits, read-only, over the live
 * GIT_LOG wire path.
 *
 * Single-project scope ([Q02]): the section is driven against a real repo —
 * this worktree itself, which tugcast registers as its bootstrap
 * `--source-tree`. A session card is bound to it and the section is asserted to
 * render that repo's real recent commits (by their unique short-sha prefixes,
 * most-recent-first) with a `<branch> · <n> commits` collapsed summary. The
 * expected shas / branch / count are read from `git` at test time, so the
 * assertions track the live repo rather than a hand-frozen fixture.
 *
 * Why the real worktree, not a synthetic temp repo: pointing tugcast's
 * bootstrap `--source-tree` at a freshly-`git init`ed throwaway repo hangs the
 * app's boot (its bootstrap-workspace setup never settles), so the empty
 * synthetic repo the "trap-closing" seed would need is not launchable. The
 * worktree is a real, already-registered repo — the followed card's root
 * resolves to it and the real wire path serves its log. Project-*change*
 * re-request stays proven at the store layer (git-log-store.test.ts) plus the
 * section's projectDir-keyed effect, per [Q02].
 *
 * Scenario:
 *   1. Open the Lens with a focused-but-unbound session card → empty state
 *      ("No session card in focus.").
 *   2. Bind the card to the repo → the section requests and renders the repo's
 *      recent commits, most-recent-first.
 *   3. Collapse → the band summary reads `<branch> · <n> commits` (Spec S03).
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

/** The worktree root (import.meta.dir → tests/app-test → up two) — the real
 *  repo tugcast serves as its bootstrap source-tree. */
const REPO = resolve(import.meta.dir, "..", "..");

/** The section requests the 20 most-recent commits ([P04]). */
const LIMIT = 20;

const SECTION = `.lens-section[data-lens-section="git-history"]`;
const BODY = `${SECTION} .lens-git-history`;
const EMPTY = `${SECTION} [data-testid="lens-git-history-empty"]`;

function gitOut(args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", REPO, ...args]);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString().trim();
}

async function dispatch(app: App, action: string): Promise<void> {
  await app.dispatchControlAction(action);
}

async function bodyText(app: App): Promise<string> {
  return app.evalJS<string>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(`${BODY} .cm-content`)});
      return el ? el.textContent : "";
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0238 — Lens Git History renders the followed project's real commits",
  () => {
    test(
      "empty state → bound project's commits most-recent-first → collapsed summary",
      async () => {
        // Expected values from the live repo. Short-sha prefixes are the
        // section's per-line leading token (`sha.slice(0,9)`) and are unique,
        // so they anchor both presence and most-recent-first ordering without
        // depending on subject text.
        const sha0 = gitOut(["rev-parse", "HEAD"]).slice(0, 9);
        const sha1 = gitOut(["rev-parse", "HEAD~1"]).slice(0, 9);
        const branch = gitOut(["branch", "--show-current"]);
        const total = parseInt(gitOut(["rev-list", "--count", "HEAD"]), 10);
        const shown = Math.min(LIMIT, total);
        const noun = shown === 1 ? "commit" : "commits";
        const expectedSummary = `${branch} · ${shown} ${noun}`;

        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath, { sourceTreePath: REPO });
          const app = await launchTugApp({
            testName: "at0238-lens-git-history",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });
          try {
            await app.waitForCondition<boolean>(
              `typeof window.__tug !== "undefined"`,
              { timeoutMs: 5_000 },
            );

            // A single session card, focused but not yet bound.
            await app.seedDeckState({
              state: {
                cards: [
                  { id: "D", componentId: "session", title: "Session", closable: true },
                ],
                panes: [
                  {
                    id: "pD",
                    position: { x: 40, y: 40 },
                    size: { width: 620, height: 460 },
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

            // Open the Lens → the Git History section mounts.
            await dispatch(app, "toggle-lens");
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(SECTION)}) !== null`,
              { timeoutMs: 3_000 },
            );

            // Nothing bound anywhere yet → the empty state.
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(EMPTY)});
                return el !== null && el.textContent.indexOf("No project open") >= 0;
              })()`,
              { timeoutMs: 3_000 },
            );

            // Bind the card to the repo. No re-activation: the section tracks
            // the topmost bound card even when it is not the active key card, so
            // binding alone drives the request + render.
            await app.bindSession("D", { projectDir: REPO });
            await app.waitForCondition<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(`${BODY} .cm-content`)});
                return el !== null && el.textContent.indexOf(${JSON.stringify(sha0)}) >= 0;
              })()`,
              { timeoutMs: 6_000 },
            );

            // Both HEAD and HEAD~1 present, most-recent-first.
            const text = await bodyText(app);
            expect(text).toContain(sha0);
            expect(text).toContain(sha1);
            expect(text.indexOf(sha0)).toBeLessThan(text.indexOf(sha1));

            // Collapse → the band summary names the branch and commit count.
            // Fire the collapse control's real onClick (→ lensStore.setCollapsed);
            // Git History is the last section, so its band can sit at the
            // far-right rail edge where a synthesized CGEvent is unreliable.
            await app.evalJS<void>(
              `document.querySelector(${JSON.stringify(
                `${SECTION} [aria-label="Collapse Git History"]`,
              )}).click()`,
            );
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(SECTION)}).getAttribute("data-collapsed") === "true"`,
              { timeoutMs: 3_000 },
            );
            const summary = await app.evalJS<string>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(
                  `${SECTION} [data-testid="lens-section-summary"]`,
                )});
                return el ? el.textContent : "";
              })()`,
            );
            expect(summary).toBe(expectedSummary);
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
