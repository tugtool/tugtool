/**
 * at0310-commit-receipt-annotations.test.ts — the Git Commit row is ink too.
 *
 * A `/commit` lands in the transcript as a shell-route exchange whose
 * bespoke renderer paints a commit receipt: the subject on the header line,
 * the message body below it. That body is where a commit says what it did,
 * and it says it in backticked paths — which sat entirely inert.
 *
 * Two structural gaps caused it, and this pins both:
 *
 *  1. **The shell row had no annotation scope.** The scope was mounted
 *     around the user and assistant cells only, so *nothing* in any shell
 *     row could annotate no matter what opted in. Fixing it is what makes
 *     the receipt reachable at all.
 *  2. **`TugMarkdownText` could not say what was code.** It renders
 *     markdown with the syntax left visible, and its highlight classes are
 *     CodeMirror-generated and opaque — so a backticked run reached the
 *     annotator indistinguishable from prose, and a bare relative path in
 *     prose is deliberately refused. The parse tree now marks inline-code
 *     content, which renders as a real `<code>`.
 *
 * The negative half matters as much as the positive: an unbackticked path
 * in the same body must stay plain text. That is the prose rule holding —
 * a reference is trusted where it is marked as code, not everywhere it is
 * path-shaped.
 *
 * And a third case that lands where the unbackticked one does: a
 * backticked path the endpoint probed and refused. There is no file and
 * nothing to open, so it stays plain text carrying no mark of any kind —
 * a refusal the annotator makes silently.
 *
 * @covers tugdeck/src/lib/annotator/wrap-matches.ts
 * @covers tugdeck/src/lib/annotator/annotate-content.ts
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/cards/session-commit-receipt-block.tsx
 * @covers tugdeck/src/components/tugways/tug-markdown-text.tsx
 * @covers tugdeck/src/components/tugways/filter-highlight.tsx
 * @covers tugdeck/src/lib/markdown-text-styling.ts
 * @covers tugdeck/src/components/tugways/cards/session-card-transcript.tsx
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "test-session-A";

/**
 * Both references are *relative* paths, and both name a file that really
 * exists. Relative is the point: an absolute path is unambiguous enough that
 * the annotator trusts it anywhere, so it would mark with or without the fix
 * and prove nothing. A relative path is trusted only where something says it
 * is code — so the pair differs by one thing, the backticks.
 */
const CODED_PATH = "lib/verdict-batching.ts";
const BARE_PATH = "lib/annotate-counters.ts";

/**
 * A path that does not exist. **Absolute**, and that is load-bearing: a
 * relative miss escalates to the project file index, which can only
 * report `unknown` for a workspace it has not indexed — and `unknown` is
 * deliberately silent. An absolute path is a complete address, so
 * `fs/stat`'s "no" is the whole answer and the miss is definite. It is
 * also the shape the case was reported in: a `/tmp` scratch file written
 * by one tool call and gone by the time the reader hovers it.
 */
const ABSENT_PATH = "/tmp/at0310-nowhere-at-all.ts";

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0310-commit-"));
  mkdirSync(join(projectDir, "lib"), { recursive: true });
  writeFileSync(join(projectDir, CODED_PATH), "export const a = 1;\n", "utf8");
  writeFileSync(join(projectDir, BARE_PATH), "export const b = 2;\n", "utf8");
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

/**
 * The S02 commit-summary shape the receipt parses: a machine header, then
 * the verbatim message. (`·` is U+00B7, `−` U+2212 — matched exactly.)
 */
function commitOutput(): string {
  return [
    "committed 95428607 · 2 file(s) · +756 −135",
    "tugdash(annotator-perf): fix content-annotation invalidation",
    "",
    `- add \`${CODED_PATH}\` to coalesce resolver notifications`,
    `- add ${BARE_PATH} and the regression test`,
    `- drop \`${ABSENT_PATH}\` on the way through`,
  ].join("\n");
}

/** Read one receipt-body span's annotation state by its exact text. */
const bodySpanJS = (needle: string) => `JSON.stringify((function(){
  var root = document.querySelector(
    '[data-card-id="A"] [data-slot="commit-receipt-detail"]');
  if (!root) return { rooted: false };
  var all = Array.from(root.querySelectorAll('*'));
  var el = all.find(function(n){
    return (n.textContent || '') === ${JSON.stringify(needle)}
      && n.hasAttribute('data-tug-annotation');
  });
  if (!el) return { rooted: true, found: false };
  return {
    rooted: true,
    found: true,
    kind: el.getAttribute('data-tug-annotation'),
    path: el.getAttribute('data-path'),
  };
})())`;

/**
 * Read what, if anything, the annotator left on one receipt-body run —
 * a wrapper, a mark, a hover title. A refused reference must show none of
 * them: the run is still in the ink, and it is still plain text.
 */
const runStateJS = (needle: string) => `JSON.stringify((function(){
  var root = document.querySelector(
    '[data-card-id="A"] [data-slot="commit-receipt-detail"]');
  if (!root) return { rooted: false };
  var marked = Array.from(
    root.querySelectorAll('[data-tugx-wrapped], [data-tug-annotation], [title]'),
  ).filter(function(n){ return (n.textContent || '') === ${JSON.stringify(needle)}; });
  return {
    rooted: true,
    present: (root.textContent || '').indexOf(${JSON.stringify(needle)}) !== -1,
    markedCount: marked.length,
  };
})())`;

describe.skipIf(!SHOULD_RUN)(
  "AT0310: the Git Commit receipt's message body annotates",
  () => {
    test(
      "a backticked path in the commit message becomes a link; a bare one does not",
      async () => {
        const app = await launchTugApp({
          testName: "at0310-commit-receipt-annotations",
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );
          await app.bindSession("A", {
            tugSessionId: SID,
            sessionMode: "resume",
            projectDir,
            workspaceKey: projectDir,
          });

          // The session cwd is what a relative reference resolves against;
          // it arrives on the metadata handshake, not the binding.
          await app.ingestSessionMetadata("A", {
            type: "system_metadata",
            tug_session_id: SID,
            session_id: SID,
            cwd: projectDir,
          });

          // A `/commit` row: the shell route carries it, the receipt
          // renderer claims it.
          await app.driveSession("A", {
            op: "shellExchange",
            exchangeId: "commit-1",
            command: "/commit",
            output: commitOutput(),
            cwd: projectDir,
            exitCode: 0,
            startedAtMs: 1_700_000_000_000,
          });

          // The receipt rendered at all — the row is a commit receipt, not
          // a generic shell exchange dump.
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('[data-card-id="A"] [data-slot="commit-receipt-block"]').length === 1`,
            { timeoutMs: 20_000 },
          );

          // The backticked reference resolves and marks — the whole round
          // trip: inline-code detection, the scope reaching a shell row, and
          // `fs/stat` confirming the path against the session cwd.
          await app.waitForCondition<boolean>(
            `(function(){ var s = ${bodySpanJS(CODED_PATH)}; return JSON.parse(s).found === true; })()`,
            { timeoutMs: 30_000 },
          );
          const coded = JSON.parse(
            await app.evalJS<string>(bodySpanJS(CODED_PATH)),
          ) as { found: boolean; kind: string; path: string };
          expect(coded.kind).toBe("file-path");
          expect(coded.path).toContain(CODED_PATH);

          // The bare one stays prose. Asserted after the coded one has
          // resolved, so this is a real "did not mark", not "has not marked
          // yet": both names were scanned in the same pass.
          const bare = JSON.parse(
            await app.evalJS<string>(bodySpanJS(BARE_PATH)),
          ) as { rooted: boolean; found: boolean };
          expect(bare.rooted).toBe(true);
          expect(bare.found).toBe(false);

          // A backticked path the endpoint probed and refused stays plain
          // text — no wrapper, no mark, no hover. Asserted only once the
          // card stops awaiting verdicts, so the `fs/stat` "no" has really
          // come back and this is a settled refusal, not an unanswered one.
          await app.waitForCondition<boolean>(
            `document.querySelectorAll('[data-card-id="A"] [data-tugx-awaiting]').length === 0`,
            { timeoutMs: 30_000 },
          );
          const absent = JSON.parse(
            await app.evalJS<string>(runStateJS(ABSENT_PATH)),
          ) as { rooted: boolean; present: boolean; markedCount: number };
          expect(absent.rooted).toBe(true);
          expect(absent.present).toBe(true);
          expect(absent.markedCount).toBe(0);

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0310] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
