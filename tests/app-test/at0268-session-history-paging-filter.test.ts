/**
 * at0268-session-history-paging-filter.test.ts — the History shade pages in
 * more commits as the reader reaches the foot of the list, and the header's
 * filter field trims what is shown.
 *
 * Driven against a real repo — this worktree itself, which tugcast registers as
 * its bootstrap `--source-tree` (the same rationale as at0239: a synthetic temp
 * repo hangs the app's boot). It has thousands of commits, which is exactly
 * what a paging test needs and a temp fixture cannot cheaply provide.
 *
 * Scenario:
 *   1. Bind a card to the repo, open the History shade → the first page lands
 *      and stops at the page size rather than the whole history.
 *   2. Scroll the list to its foot → the next page appends. Every commit that
 *      was on screen is still there, in the same order, ABOVE the new ones —
 *      the load-on-scroll contract is that content grows downward and the
 *      reader's place does not move.
 *   3. Type a path only some commits touched into the filter → the list trims
 *      to matching rows, and a row kept by its file roster names the path that
 *      matched (otherwise the match is invisible and reads as a filter bug).
 *   4. Filter by a word that appears ONLY in some commit's message BODY → the
 *      collapsed row shows the matching line marked, and expanding it marks the
 *      term inside the syntax-highlighted message itself. This is the path that
 *      silently painted nothing before `renderFilterHighlightSpans`.
 *   5. Filter by a commit's short sha → exactly that commit survives.
 *   6. Clear the filter → the full walk comes back, no shorter than before.
 *
 * @covers tugdeck/src/lib/git-log-store.ts
 * @covers tugdeck/src/components/tugways/cards/session-history/session-history-view.tsx
 * @covers tugdeck/src/components/tugways/tug-history-list.tsx
 * @covers tugdeck/src/components/tugways/filter-highlight.tsx
 * @covers tugdeck/src/components/tugways/tug-markdown-text.tsx
 * @covers tugrust/crates/tugcast/src/feeds/git.rs
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** The worktree root — the real repo tugcast serves as its bootstrap tree. */
const REPO = resolve(import.meta.dir, "..", "..");

const VIEW = `[data-slot="session-history-view"]`;
const ROW = `${VIEW} [data-testid="session-history-commit"]`;
const FILTER = `[data-testid="session-history-filter"] input`;

/** Mirrors `GIT_LOG_PAGE_SIZE` in `lib/git-log-store.ts`. */
const PAGE_SIZE = 40;

function gitOut(args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", REPO, ...args]);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
  }
  return r.stdout.toString().trim();
}

/**
 * A recent commit with a distinctive word in its message BODY that appears
 * nowhere in its subject — the exact shape whose match was invisible before
 * the styled-span highlight path existed.
 *
 * Derived from the repo rather than hardcoded, so the test does not rot as
 * history moves past whichever commit happened to fit when it was written.
 */
function bodyOnlyMatch(): { sha: string; word: string } {
  const records = gitOut([
    "log",
    "-z",
    "-n40",
    "--format=%H%x1f%s%x1f%b",
  ]).split("\0");
  for (const record of records) {
    const [sha, subject, body] = record.split("\x1f");
    if (sha === undefined || subject === undefined || body === undefined) continue;
    const subjectLower = subject.toLowerCase();
    for (const word of body.toLowerCase().match(/[a-z]{8,}/g) ?? []) {
      // Not in the subject, and not in the sha's hex either, so the collapsed
      // row genuinely cannot account for the match on its own.
      if (subjectLower.includes(word)) continue;
      if (sha.slice(0, 8).includes(word)) continue;
      return { sha, word };
    }
  }
  throw new Error("no recent commit has a body-only word — fixture assumption broke");
}

describe.skipIf(!SHOULD_RUN)(
  "at0268 — History pages in on scroll and filters down",
  () => {
    test(
      "scrolling to the foot appends a page; the filter trims by path and by sha",
      async () => {
        const head8 = gitOut(["rev-parse", "HEAD"]).slice(0, 8);
        const headSubject = gitOut(["show", "-s", "--format=%s", "HEAD"]);
        const { sha: bodySha, word: bodyWord } = bodyOnlyMatch();

        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath, { sourceTreePath: REPO });
          const app = await launchTugApp({
            testName: "at0268-session-history-paging-filter",
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
                    size: { width: 900, height: 620 },
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

            await app.dispatchControlAction("toggle-history-view");
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(ROW)}).length > 0`,
              { timeoutMs: 8_000 },
            );

            // ── 1. The first page stops at the page size ──────────────────
            // Settle first: the view tops up on its own until the list
            // overflows the shade, so read the count once it has stopped
            // moving rather than the instant the first rows appear.
            const shasNow = `Array.from(document.querySelectorAll(${JSON.stringify(ROW)})).map(function(e){ return e.getAttribute("data-sha"); })`;
            await app.waitForCondition<boolean>(
              `document.querySelector('[data-testid="session-history-loading-more"]') === null`,
              { timeoutMs: 8_000 },
            );
            const firstPage = await app.evalJS<string[]>(shasNow);
            expect(firstPage.length).toBeGreaterThan(0);
            // A page at a time — not the repo's whole history in one frame.
            expect(firstPage.length).toBeLessThanOrEqual(PAGE_SIZE * 2);

            // ── 2. Scrolling to the foot appends the next page ────────────
            await app.evalJS(
              `(function(){
                var v = document.querySelector(${JSON.stringify(VIEW)});
                v.scrollTop = v.scrollHeight;
              })()`,
            );
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(ROW)}).length > ${firstPage.length}`,
              { timeoutMs: 8_000 },
            );
            const grown = await app.evalJS<string[]>(shasNow);

            // The page APPENDED: everything that was on screen is still on
            // screen, in the same order, at the same indices. That is what
            // keeps the scroll offset meaningful and the reader's place fixed.
            expect(grown.slice(0, firstPage.length)).toEqual(firstPage);

            // ── 3. Filter by a path ───────────────────────────────────────
            // A file only some commits touch. It appears in no commit SUBJECT
            // in this repo's recent history, so a row that survives can only
            // have been kept by its file roster.
            await app.click(FILTER);
            await app.type(FILTER, "tug-history-list.css");
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(ROW)}).length < ${grown.length}`,
              { timeoutMs: 8_000 },
            );
            const byPath = await app.evalJS<string[]>(shasNow);
            expect(byPath.length).toBeGreaterThan(0);
            expect(byPath.length).toBeLessThan(grown.length);
            // Every surviving row is a row that was already loaded — the
            // filter trims, it does not fetch a different list.
            for (const sha of byPath) expect(grown).toContain(sha);

            // The match is legible: the row names the path the query found,
            // with the matched span marked inside it.
            const pathContext = await app.evalJS<{ text: string; mark: string }>(
              `(function(){
                var el = document.querySelector('[data-testid="session-history-matched-context"]');
                if (!el) return { text: "", mark: "" };
                var m = el.querySelector('mark.tug-filter-mark');
                return { text: el.textContent, mark: m ? m.textContent : "" };
              })()`,
            );
            expect(pathContext.text).toContain("tug-history-list.css");
            expect(pathContext.mark.length).toBeGreaterThan(0);

            // ── 4. Filter by a word only the message BODY carries ─────────
            await app.evalJS(
              `(function(){
                var i = document.querySelector(${JSON.stringify(FILTER)});
                i.value = "";
                i.dispatchEvent(new Event("input", { bubbles: true }));
              })()`,
            );
            await app.type(FILTER, bodyWord);
            const bodyRow = `${VIEW} [data-testid="session-history-commit"][data-sha="${bodySha}"]`;
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(bodyRow)}) !== null`,
              { timeoutMs: 8_000 },
            );

            // Collapsed, the row cannot explain itself from its subject — so it
            // shows the matching message line, marked.
            const collapsedEvidence = await app.evalJS<{
              context: string;
              mark: string;
            }>(
              `(function(){
                var row = document.querySelector(${JSON.stringify(bodyRow)});
                var el = row.querySelector('[data-testid="session-history-matched-context"]');
                if (!el) return { context: "", mark: "" };
                var m = el.querySelector('mark.tug-filter-mark');
                return { context: el.textContent, mark: m ? m.textContent.toLowerCase() : "" };
              })()`,
            );
            expect(collapsedEvidence.context.toLowerCase()).toContain(bodyWord);
            expect(collapsedEvidence.mark).toBe(bodyWord);

            // Expanded, the term is marked inside the real message body — the
            // syntax-highlighted render, where a plain string renderer could
            // not reach and so used to paint nothing at all.
            await app.click(`${bodyRow} .tug-history-list-row-hit`);
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(bodyRow)} + '' ) !== null && document.querySelector(${JSON.stringify(bodyRow)}).getAttribute("data-expanded") === "true"`,
              { timeoutMs: 5_000 },
            );
            const bodyMark = await app.evalJS<string>(
              `(function(){
                var row = document.querySelector(${JSON.stringify(bodyRow)});
                var msg = row.querySelector('[data-slot="tug-history-list-message"]');
                if (!msg) return "";
                var m = msg.querySelector('mark.tug-filter-mark');
                return m ? m.textContent.toLowerCase() : "";
              })()`,
            );
            expect(bodyMark).toBe(bodyWord);

            // The expanded detail reads in a recessed well, like a tool
            // block's body — a real painted surface, not a bare region.
            const wellPainted = await app.evalJS<boolean>(
              `(function(){
                var row = document.querySelector(${JSON.stringify(bodyRow)});
                var well = row.querySelector('.tug-history-list-commit-detail');
                if (!well) return false;
                var cs = getComputedStyle(well);
                var bg = cs.backgroundColor;
                return bg !== "" && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)"
                  && parseFloat(cs.borderTopWidth) > 0;
              })()`,
            );
            expect(wellPainted).toBe(true);

            // ── 5. Filter by a short sha ─────────────────────────────────
            await app.evalJS(
              `(function(){
                var i = document.querySelector(${JSON.stringify(FILTER)});
                i.value = "";
                i.dispatchEvent(new Event("input", { bubbles: true }));
              })()`,
            );
            await app.type(FILTER, head8);
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(ROW)}).length === 1`,
              { timeoutMs: 8_000 },
            );
            const soleRow = await app.evalJS<string>(
              `(function(){
                var row = document.querySelector(${JSON.stringify(ROW)});
                return row ? row.textContent : "";
              })()`,
            );
            expect(soleRow).toContain(head8);
            expect(soleRow).toContain(headSubject);

            // The matched span wears the shared filter mark, so the reader can
            // see WHY the row survived.
            const markText = await app.evalJS<string>(
              `(function(){
                var m = document.querySelector(${JSON.stringify(ROW)} + ' mark.tug-filter-mark');
                return m ? m.textContent : "";
              })()`,
            );
            expect(head8).toContain(markText);
            expect(markText.length).toBeGreaterThan(0);

            // ── 6. Clearing restores the whole walk ──────────────────────
            await app.click(
              `[data-testid="session-history-filter"] [aria-label="Clear filter"]`,
            );
            await app.waitForCondition<boolean>(
              `document.querySelectorAll(${JSON.stringify(ROW)}).length >= ${grown.length}`,
              { timeoutMs: 8_000 },
            );
            const restored = await app.evalJS<string[]>(shasNow);
            // Nothing was lost to the round trip through the filter: the pages
            // already walked are still held, in order.
            expect(restored.slice(0, grown.length)).toEqual(grown);
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
