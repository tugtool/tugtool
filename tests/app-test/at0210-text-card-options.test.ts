/**
 * at0210-text-card-options.test.ts — Text card top bar + gear options
 * ([AT0210]): open a real file, then drive the top-bar gear popover and
 * assert each toggle reconfigures the live CodeMirror 6 editor.
 *
 * Scenario: seed a Text card bound to a real temp fixture, assert the
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
const EDITOR_CONTENT = `${CARD} [data-slot="tug-text-card-editor"] .cm-content`;
const LINE_NUMBERS = `${CARD} [data-slot="tug-text-card-editor"] .cm-lineNumbers`;
const TOP_BAR = `${CARD} [data-slot="text-card-top-bar"]`;
const GEAR = `${CARD} [aria-label="Editor options"]`;
const OPTIONS_PANEL = '[data-testid="text-card-options"]';
// Scoped to the popover: the same option testids also appear in the
// Settings card's Text Card tab (shared TextCardControls).
const LINE_NUMBERS_SWITCH = `${OPTIONS_PANEL} [data-testid="text-card-option-line-numbers"]`;
const LINE_WRAP_SWITCH = `${OPTIONS_PANEL} [data-testid="text-card-option-line-wrap"]`;

const FIXTURE_CONTENT =
  Array.from({ length: 12 }, (_, i) => `fixture line ${i + 1}`).join("\n") + "\n";

function mkFixture(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0210-"));
  const file = path.join(dir, "sample.txt");
  fs.writeFileSync(file, FIXTURE_CONTENT, "utf8");
  return { dir, file };
}

/** A fixture whose newlines are CRLF (Windows). */
function mkCrlfFixture(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0210-crlf-"));
  const file = path.join(dir, "windows.txt");
  const crlf =
    Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\r\n") + "\r\n";
  fs.writeFileSync(file, crlf, "utf8");
  return { dir, file };
}

/** Type into the editor through CM6's real beforeinput pipeline. */
async function typeIntoEditor(app: App, text: string): Promise<void> {
  await app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
      if (!el) return false;
      el.focus();
      return document.execCommand("insertText", false, ${JSON.stringify(text)});
    })()`,
  );
}

/** Poll the real file on disk until `predicate` holds. */
async function waitForDisk(
  file: string,
  predicate: (content: string) => boolean,
  timeoutMs = 8000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = fs.readFileSync(file, "utf8");
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`[at0210] disk predicate unmet in ${timeoutMs}ms; last:\n${last.slice(0, 200)}`);
}

async function seedTextCard(app: App, filePath: string): Promise<void> {
  // Manual is the shipping default ([P01]); this test's clean-file "Saved"
  // cell and the CRLF-autosave scenario are automatic-mode behaviors, so
  // opt into automatic before the card mounts (populates the same client
  // cache `readSaveMode` reads).
  await app.evalJS<null>(
    `(window.__tug.setTugbankValue("dev.tugtool.text-card","save-mode",{kind:"string",value:"automatic"}), null)`,
  );
  await app.seedDeckState({
    state: {
      cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
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

describe.skipIf(!SHOULD_RUN)("at0210: Text card top bar + gear options", () => {
  test(
    "top bar shows the path; gear toggles reconfigure the live editor",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0210-text-card-options" });
      try {
        await seedTextCard(app, file);

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
          `document.querySelector('${CARD} [data-testid="text-card-status-save"]').innerText`,
        );
        expect(saveCell.startsWith("Saved")).toBe(true);
        const statusText = await app.evalJS<string>(
          `document.querySelector('${CARD} [data-slot="text-card-status-bar"]').innerText`,
        );
        // The settable popups render their current values (file type +
        // line ending).
        expect(statusText).toContain("Plain Text");
        expect(statusText).toContain("Unix (LF)");
        const caretCell = await app.evalJS<string>(
          `document.querySelector('${CARD} [data-testid="text-card-status-caret"]').innerText`,
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

  test(
    "autosave preserves a file's CRLF line endings on write",
    async () => {
      const { dir, file } = mkCrlfFixture();
      const app = await launchTugApp({ testName: "at0210-crlf" });
      try {
        await seedTextCard(app, file);
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
            return el !== null && el.innerText.indexOf("line 1") !== -1;
          })()`,
          { timeoutMs: 15000 },
        );

        // The status bar detected the file's newline style.
        const statusText = await app.evalJS<string>(
          `document.querySelector('${CARD} [data-slot="text-card-status-bar"]').innerText`,
        );
        expect(statusText).toContain("Windows (CRLF)");

        // Word count (middle of "lines / words / characters") before edit.
        const wordsBefore = await app.evalJS<number>(
          `parseInt(document.querySelector('${CARD} [data-testid="text-card-status-counts"]').innerText.split("/")[1].replace(/[^0-9]/g,""), 10)`,
        );

        // Type an edit → autosave writes. CM6 normalizes to \n
        // internally, so the store must re-serialize to CRLF at the
        // write boundary; the file must NOT be flattened to LF.
        await typeIntoEditor(app, "EDIT ");

        // The incremental word count picked up the one new word.
        await app.waitForCondition<boolean>(
          `parseInt(document.querySelector('${CARD} [data-testid="text-card-status-counts"]').innerText.split("/")[1].replace(/[^0-9]/g,""), 10) === ${wordsBefore + 1}`,
          { timeoutMs: 8000 },
        );

        const disk = await waitForDisk(file, (c) => c.includes("EDIT"));
        expect(disk.includes("\r\n")).toBe(true);
        // No bare LF: every "\n" is part of a "\r\n".
        expect(disk.split("\r\n").length).toBe(disk.split("\n").length);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
