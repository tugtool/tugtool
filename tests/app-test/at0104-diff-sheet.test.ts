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
const ALERT_TITLE = `${SHEET} .tug-alert-title`;
const ALERT_OK = `${SHEET} [data-testid="alert-confirm"]`;

async function runDiff(app: App): Promise<void> {
  await app.nativeClickAtElement(PROMPT_INPUT);
  await app.nativeType("/diff");
  await app.nativeClickAtElement(SUBMIT_BTN);
}

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
    "/diff alerts when there's nothing to show, and opens the accordion for changes",
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

        // ── 1. Non-git dir → a pane-modal alert (NOT a diff sheet). ──────────
        // `/diff` waits for the response, then branches: nothing-to-show is
        // surfaced as a TugAlertSheet, not an empty diff sheet.
        await runDiff(app);
        await app.ingestGitDiff("A", {
          request_id: "gd-1",
          workspace_key: "test-workspace-A",
          base: "HEAD",
          no_repo: true,
          file_count: 0,
          total_added: 0,
          total_removed: 0,
          files: [],
        });
        await app.waitForCondition<boolean>(
          `(function(){ var e = document.querySelector(${JSON.stringify(ALERT_TITLE)}); return e !== null && /not a git repository/i.test(e.textContent || ""); })()`,
          { timeoutMs: 6000 },
        );
        // It's an alert, not the diff sheet — no file list, no title bar.
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(DIFF_FILE)}).length`,
          ),
        ).toBe(0);
        // OK dismisses it.
        await app.nativeClickAtElement(ALERT_OK);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET)}) === null`,
          { timeoutMs: 6000 },
        );

        // ── 2. Real changes → the per-file accordion diff sheet. ─────────────
        await runDiff(app);
        await app.ingestGitDiff("A", diffPayload());
        await app.waitForCondition<boolean>(
          `(function(){ var e = document.querySelector(${JSON.stringify(SHEET_TITLE)}); return e !== null && e.textContent === "Diff"; })()`,
          { timeoutMs: 6000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(DIFF_FILE)}).length === 2`,
          { timeoutMs: 6000 },
        );

        // Header summarizes the change set …
        const summary = await app.evalJS<string | null>(
          `(function(){ var e = document.querySelector(${JSON.stringify(DIFF_SUMMARY)}); return e ? e.textContent : null; })()`,
        );
        expect(summary).toBe("2 files changed +2 −0");

        // … the first trigger shows the path …
        const firstTriggerText = await app.evalJS<string | null>(
          `(function(){ var e = document.querySelector(${JSON.stringify(ACCORDION_TRIGGER)}); return e ? e.textContent : null; })()`,
        );
        expect(firstTriggerText).toContain("src/main.rs");

        // … multi-file opens collapsed …
        expect(
          await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(DIFF_HUNK)}).length`,
          ),
        ).toBe(0);

        // Expand All opens every file (controlled accordion) → hunks render.
        await app.nativeClickAtElement(`${SHEET} [data-testid="diff-expand-all"]`);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(DIFF_HUNK)}).length >= 2`,
          { timeoutMs: 6000 },
        );

        // Collapse All closes them again.
        await app.nativeClickAtElement(`${SHEET} [data-testid="diff-collapse-all"]`);
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(DIFF_HUNK)}).length === 0`,
          { timeoutMs: 6000 },
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
