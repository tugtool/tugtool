/**
 * at0210-file-editor-options.test.ts — File card top bar + gear options
 * ([AT0210]): open a real file, then drive the top-bar gear popover and
 * assert each toggle reconfigures the live CodeMirror 6 editor.
 *
 * Scenario: seed a File card bound to a real temp fixture, assert the
 * top bar shows the file path and the editor mounts with the default
 * line-number gutter. Open the gear, toggle Line numbers off (the CM6
 * `lineNumbers` compartment drops the gutter), then toggle Soft wrap on
 * (the `lineWrapping` compartment adds `.cm-lineWrapping`). Every step
 * drives the real settings → CM6 reconfigure path on a real file — no
 * mocks.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR_CONTENT = `${CARD} [data-slot="tug-file-editor"] .cm-content`;
const LINE_NUMBERS = `${CARD} [data-slot="tug-file-editor"] .cm-lineNumbers`;
const TOP_BAR = `${CARD} [data-slot="file-card-top-bar"]`;
const GEAR = `${CARD} [aria-label="Editor options"]`;
const OPTIONS_PANEL = '[data-testid="file-card-options"]';
// Scoped to the popover: the same option testids also appear in the
// Settings card's File Editor tab (shared FileEditorControls).
const LINE_NUMBERS_SWITCH = `${OPTIONS_PANEL} [data-testid="file-card-option-line-numbers"]`;
const LINE_WRAP_SWITCH = `${OPTIONS_PANEL} [data-testid="file-card-option-line-wrap"]`;

const FIXTURE_CONTENT =
  Array.from({ length: 12 }, (_, i) => `fixture line ${i + 1}`).join("\n") + "\n";

function mkFixture(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0210-"));
  const file = path.join(dir, "sample.txt");
  fs.writeFileSync(file, FIXTURE_CONTENT, "utf8");
  return { dir, file };
}

async function seedFileCard(app: App, filePath: string): Promise<void> {
  await app.seedDeckState({
    state: {
      cards: [{ id: "A", componentId: "file", title: "File", closable: true }],
      panes: [
        {
          id: "p1",
          position: { x: 40, y: 40 },
          size: { width: 760, height: 560 },
          cardIds: ["A"],
          activeCardId: "A",
          title: "",
          acceptsFamilies: ["standard"],
        },
      ],
      activePaneId: "p1",
      hasFocus: true,
    },
    cardStates: {
      A: { content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
    },
    focusCardId: "A",
  });
}

const WRAP_STATE = `(() => {
  const el = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
  return el !== null && el.classList.contains("cm-lineWrapping");
})()`;

describe.skipIf(!SHOULD_RUN)("at0210: File card top bar + gear options", () => {
  test(
    "top bar shows the path; gear toggles reconfigure the live editor",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0210-file-editor-options" });
      try {
        await seedFileCard(app, file);

        // Editor mounts with the fixture content.
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
            return el !== null && el.innerText.indexOf("fixture line 1") !== -1;
          })()`,
          { timeoutMs: 15000 },
        );

        // Top bar shows the full path.
        const barText = await app.evalJS<string>(
          `document.querySelector(${JSON.stringify(TOP_BAR)}).innerText`,
        );
        expect(barText).toContain("sample.txt");

        // Bottom status bar reflects the file + caret. A freshly loaded
        // file is clean (save cell "Saved"); .txt is Plain Text; the
        // caret starts at L: 1.
        const saveCell = await app.evalJS<string>(
          `document.querySelector('${CARD} [data-testid="file-card-status-save"]').innerText`,
        );
        expect(saveCell.startsWith("Saved")).toBe(true);
        const statusText = await app.evalJS<string>(
          `document.querySelector('${CARD} [data-slot="file-card-status-bar"]').innerText`,
        );
        // The settable popups render their current values (file type +
        // line ending).
        expect(statusText).toContain("Plain Text");
        expect(statusText).toContain("Unix (LF)");
        const caretCell = await app.evalJS<string>(
          `document.querySelector('${CARD} [data-testid="file-card-status-caret"]').innerText`,
        );
        expect(caretCell).toContain("L: 1");

        // Default settings: line-number gutter present, no wrap.
        expect(
          await app.evalJS<boolean>(
            `document.querySelector(${JSON.stringify(LINE_NUMBERS)}) !== null`,
          ),
        ).toBe(true);
        expect(await app.evalJS<boolean>(WRAP_STATE)).toBe(false);

        // Open the gear options popover.
        await app.nativeClickAtElement(GEAR);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(OPTIONS_PANEL)}) !== null`,
          { timeoutMs: 15000 },
        );

        // Toggle Line numbers off → the CM6 gutter drops.
        await app.nativeClickAtElement(LINE_NUMBERS_SWITCH);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(LINE_NUMBERS)}) === null`,
          { timeoutMs: 15000 },
        );

        // Toggle Soft wrap on → the CM6 content gains cm-lineWrapping.
        await app.nativeClickAtElement(LINE_WRAP_SWITCH);
        await app.waitForCondition<boolean>(`${WRAP_STATE} === true`, {
          timeoutMs: 15000,
        });
        expect(await app.evalJS<boolean>(WRAP_STATE)).toBe(true);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
