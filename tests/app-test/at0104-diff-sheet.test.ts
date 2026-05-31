/**
 * at0104-diff-sheet.test.ts — `/diff` opens a per-file accordion sheet that
 * renders the project's uncommitted changes ([#step-10b]).
 *
 * Typing `/diff` opens a card-scoped overlay ([D15]) whose body is a
 * `TugAccordion type="multiple"` with one item per changed file: the trigger
 * shows the path + `+N −M`, the body renders that file's hunks via the shared
 * `DiffBlock`. The header mirrors Claude Code's "N files changed +X −Y".
 *
 * Sourcing is single-shot over the GIT_DIFF feed; 10.A's subprocess+ws test
 * proves the real git round-trip. Here we drive the card's `GitDiffStore`
 * directly (`ingestGitDiff`) with a known two-file payload so the UI mapping
 * is deterministic: assert the sheet opens, the accordion lists both files
 * with the right stats, the header summarizes, and expanding a file renders
 * its hunks.
 *
 * Has teeth: before the accordion is wired, `/diff` would open a sheet with
 * no `diff-file` items; before the body renders DiffBlock, expanding a file
 * would show no `diff-hunk`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0104-session";

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SUBMIT_BTN = `${CARD} .tug-prompt-entry-submit-button`;
const SHEET = '[data-slot="tug-sheet"]';
const SHEET_TITLE = `${SHEET} .tug-sheet-title`;
const DIFF_FILE = `${SHEET} [data-testid="diff-file"]`;
const DIFF_SUMMARY = `${SHEET} .diff-sheet-summary`;
const DIFF_HUNK = `${SHEET} [data-slot="diff-hunk"]`;
const ACCORDION_TRIGGER = `${SHEET} .tug-accordion-trigger`;

const MODIFIED_UNIFIED =
  "diff --git a/src/main.rs b/src/main.rs\n" +
  "index 1111111..2222222 100644\n" +
  "--- a/src/main.rs\n" +
  "+++ b/src/main.rs\n" +
  "@@ -1,2 +1,3 @@\n" +
  " fn main() {\n" +
  "+    let x = 1;\n" +
  " }\n";

const ADDED_UNIFIED =
  "diff --git a/new.txt b/new.txt\n" +
  "new file mode 100644\n" +
  "--- /dev/null\n" +
  "+++ b/new.txt\n" +
  "@@ -0,0 +1,1 @@\n" +
  "+hello\n";

function diffPayload() {
  return {
    request_id: "gd-1",
    workspace_key: "test-workspace-A",
    base: "HEAD",
    file_count: 2,
    total_added: 2,
    total_removed: 0,
    files: [
      {
        path: "src/main.rs",
        status: "modified",
        added: 1,
        removed: 0,
        binary: false,
        unified: MODIFIED_UNIFIED,
      },
      {
        path: "new.txt",
        status: "added",
        added: 1,
        removed: 0,
        binary: false,
        unified: ADDED_UNIFIED,
      },
    ],
  };
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 880, height: 640 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0104: /diff accordion sheet", () => {
  test(
    "typing /diff opens a per-file accordion that renders the diff",
    async () => {
      const app = await launchTugApp({ testName: "at0104-diff-sheet" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.bindDevSession("A", { tugSessionId: SID });
        await app.awaitEngineReady("A");

        // Type `/diff` and submit → RUN_SLASH_COMMAND opens the sheet.
        await app.nativeClickAtElement(PROMPT_INPUT);
        await app.nativeType("/diff");
        await app.nativeClickAtElement(SUBMIT_BTN);

        // The Diff sheet opens (loading until the response lands).
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
          { timeoutMs: 6000 },
        );
        const title = await app.evalJS<string | null>(
          `(function(){ var e = document.querySelector(${JSON.stringify(SHEET_TITLE)}); return e ? e.textContent : null; })()`,
        );
        expect(title).toBe("Diff");

        // Drive the response: two changed files.
        await app.ingestGitDiff("A", diffPayload());

        // The accordion lists both files …
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(DIFF_FILE)}).length === 2`,
          { timeoutMs: 6000 },
        );

        // … the header summarizes them …
        const summary = await app.evalJS<string | null>(
          `(function(){ var e = document.querySelector(${JSON.stringify(DIFF_SUMMARY)}); return e ? e.textContent : null; })()`,
        );
        expect(summary).toBe("2 files changed +2 −0");

        // … the first trigger shows the path …
        const firstTriggerText = await app.evalJS<string | null>(
          `(function(){ var e = document.querySelector(${JSON.stringify(ACCORDION_TRIGGER)}); return e ? e.textContent : null; })()`,
        );
        expect(firstTriggerText).toContain("src/main.rs");

        // … and nothing is expanded yet (multi-file opens collapsed).
        const hunksBefore = await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(DIFF_HUNK)}).length`,
        );
        expect(hunksBefore).toBe(0);

        // Expanding the first file renders its hunks via DiffBlock.
        await app.nativeClickAtElement(ACCORDION_TRIGGER);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(DIFF_HUNK)}).length >= 1`,
          { timeoutMs: 6000 },
        );

        // Refresh re-fires the request; a now-clean tree shows the empty
        // state (covered here rather than in a second app launch to avoid a
        // redundant cold boot).
        await app.nativeClickAtElement(`${SHEET} [data-testid="diff-refresh"]`);
        await app.ingestGitDiff("A", {
          request_id: "gd-2",
          workspace_key: "test-workspace-A",
          base: "HEAD",
          file_count: 0,
          total_added: 0,
          total_removed: 0,
          files: [],
        });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(`${SHEET} .diff-sheet-empty`)}) !== null`,
          { timeoutMs: 6000 },
        );
        const filesAfter = await app.evalJS<number>(
          `document.querySelectorAll(${JSON.stringify(DIFF_FILE)}).length`,
        );
        expect(filesAfter).toBe(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
