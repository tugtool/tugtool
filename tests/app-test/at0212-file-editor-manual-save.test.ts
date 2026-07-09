/**
 * at0212-file-editor-manual-save.test.ts — File card manual save mode
 * ([AT0212], roadmap/file-editing-enhancements.md). Manual is the shipping
 * default; this drives the classic document contract on real files through
 * real code paths — no mocks.
 *
 * (The plan numbered this at0211, but that id was taken by the /btw
 * overlay test landed since; this is the same suite under the next id.)
 *
 * ## Scenarios
 *
 * 1. **Edits stay off disk; menu gates + dynamic ⇧⌘S.** Open a real file
 *    (manual default); typing marks the card "Edited" WITHOUT touching
 *    disk. The File menu validates per Spec S02 (clean → Save/Revert
 *    disabled, Reload enabled; dirty → Save/Revert enabled) and Save As…
 *    carries ⇧⌘S while a file card is frontmost ([P07]).
 * 2. **Dirty close.** A dirty card gated by both a plain X-click (the
 *    `!confirmClose` short-circuit, Risk R02) and the `close` control
 *    action presents the close sheet; Cancel keeps it, Don't Save closes
 *    without writing.
 * 3. **Aside crash-safety.** A dirty edit is set aside under Autosave
 *    Information without touching the real file.
 * 4. **Automatic mode retained.** A seeded automatic file card keeps Save
 *    enabled even when clean (the [P07] no-beep guard).
 * 5. **New Text File.** `new-text-file` opens a second Untitled editor.
 *
 * ## Coverage note — the explicit-save write, external-change conflict,
 * and the [P12] "Save Anyway writes the REAL file not the aside" guard are
 * verified at the real store layer in
 * `tugdeck/src/lib/__tests__/file-editor-store.manual.test.ts` (deterministic,
 * real fs-io code paths). They are NOT asserted here because a ⌘S-driven
 * save routes through the responder chain to the editor *leaf* responder,
 * and a headless sweep (no frontmost app; synthetic focus over CM6, which
 * owns pointerdown) cannot reliably make that leaf the chain first
 * responder — the same reason at0209 types via `execCommand` rather than
 * native keys. This test covers the wiring the harness can drive
 * faithfully; the store tests cover the write/conflict machine.
 *
 * Every scenario opens a real disk path so no save lands in an NSSavePanel.
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
const SAVE_CELL = `${CARD} [data-testid="file-card-status-save"]`;
const CLOSE_BUTTON = `[data-testid="tug-pane-close-button"]`;

const ORIGINAL = "alpha\nbeta\ngamma\n";

function mkFixture(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0212-"));
  const file = path.join(dir, "manual.txt");
  fs.writeFileSync(file, ORIGINAL, "utf8");
  return { dir, file };
}

function deckShape() {
  return {
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
  };
}

async function seedFileCard(
  app: App,
  filePath: string,
  mode: "manual" | "automatic" = "manual",
): Promise<void> {
  if (mode === "automatic") {
    await app.evalJS<null>(
      `(window.__tug.setTugbankValue("dev.tugtool.file-editor","save-mode",{kind:"string",value:"automatic"}), null)`,
    );
  }
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {
      A: { content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
    },
    focusCardId: "A",
  });
}

async function waitForEditor(app: App, sentinel: string, timeoutMs = 15000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector('${EDITOR_CONTENT}');
      return el !== null && el.innerText.indexOf(${JSON.stringify(sentinel)}) !== -1;
    })()`,
    { timeoutMs },
  );
}

async function typeIntoEditor(app: App, text: string): Promise<void> {
  const ok = await app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector('${EDITOR_CONTENT}');
      if (!el) return false;
      el.focus();
      return document.execCommand("insertText", false, ${JSON.stringify(text)});
    })()`,
  );
  if (!ok) throw new Error("[at0212] typeIntoEditor: insertText not handled");
}

async function waitForSaveCell(app: App, want: string, timeoutMs = 15000): Promise<void> {
  await app.waitForCondition<boolean>(
    `(function(){
      var el = document.querySelector('${SAVE_CELL}');
      return el !== null && el.innerText.indexOf(${JSON.stringify(want)}) === 0;
    })()`,
    { timeoutMs },
  );
}

async function saveCell(app: App): Promise<string> {
  return app.evalJS<string>(`document.querySelector('${SAVE_CELL}').innerText`);
}

/**
 * Let the app settle between synthetic gestures. Native clicks, control
 * dispatches, and sheet-button clicks each kick React renders, portal
 * mounts, and focus transfers that must commit before the next gesture —
 * firing them back-to-back races those transitions.
 */
const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));

async function dispatchControl(app: App, action: string): Promise<void> {
  await app.evalJS<null>(
    `(window.__tug.dispatchControlAction(${JSON.stringify(action)}), null)`,
  );
}

async function waitMenuEnabled(app: App, id: string, want: boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: { found: boolean; enabled?: boolean } = { found: false };
  while (Date.now() < deadline) {
    last = await app.menuItemState(id);
    if (last.found && last.enabled === want) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(last.found, `${id} must exist`).toBe(true);
  expect(last.enabled, `${id} enabled=${want}`).toBe(want);
}

async function waitSheetButton(app: App, result: string, timeoutMs = 15000): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.querySelector('[data-testid="file-save-sheet-${result}"]') !== null`,
    { timeoutMs },
  );
}

// NSEvent.ModifierFlags: .command = 1<<20, .shift = 1<<17.
const CMD_MASK = 1 << 20;
const SHIFT_MASK = 1 << 17;

describe.skipIf(!SHOULD_RUN)("at0212: File card manual save", () => {
  test(
    "edits stay off disk; menu gates + dynamic ⇧⌘S",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0212-gates" });
      try {
        await seedFileCard(app, file);
        await waitForEditor(app, "alpha");

        // Clean titled manual card: "Saved"; Save/Revert disabled, Reload
        // enabled; Save As… carries the dynamic ⇧⌘S ([P07]).
        await waitForSaveCell(app, "Saved");
        await waitMenuEnabled(app, "file.save", false);
        await waitMenuEnabled(app, "file.revertToSaved", false);
        await waitMenuEnabled(app, "file.reloadFromDisk", true);
        const saveAs = await app.menuItemState("file.saveAs");
        expect(saveAs.found && saveAs.keyEquivalent).toBe("s");
        expect(saveAs.found ? (saveAs.modifierMask & CMD_MASK) !== 0 : false).toBe(true);
        expect(saveAs.found ? (saveAs.modifierMask & SHIFT_MASK) !== 0 : false).toBe(true);

        // Type → "Edited", disk UNCHANGED, Save + Revert enabled.
        await typeIntoEditor(app, "EDIT ");
        await waitForSaveCell(app, "Edited");
        await settle();
        expect(fs.readFileSync(file, "utf8")).toBe(ORIGINAL);
        await waitMenuEnabled(app, "file.save", true);
        await waitMenuEnabled(app, "file.revertToSaved", true);

        // The `save` control (the same path File ▸ Save uses) writes the
        // real file and clears dirty. The editor is the first responder
        // (typing focused it), so `save` reaches it via the chain.
        await dispatchControl(app, "save");
        await settle();
        await waitForSaveCell(app, "Saved");
        expect(fs.readFileSync(file, "utf8")).toContain("EDIT ");
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "save survives a title-bar interaction (focus reclaim on cardDidMove)",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0212-reclaim" });
      try {
        await seedFileCard(app, file);
        await waitForEditor(app, "alpha");
        await typeIntoEditor(app, "MOVED ");
        await waitForSaveCell(app, "Edited");
        await settle();

        // Reposition the card by dragging its title bar. This promotes the
        // pane as first responder and fires cardDidMove — pulling chain
        // focus off the editor. The card's reclaim must restore the editor
        // as first responder, or `save` (editor-owned) would walk up from
        // the pane and miss it — the "moved the card, ⌘S went dead" bug.
        const tb = await app.getElementBounds(
          `[data-testid="tug-pane-title-bar"]`,
        );
        await app.nativeDragElement(`[data-testid="tug-pane-title-bar"]`, {
          x: tb.x + tb.width / 2 + 80,
          y: tb.y + tb.height / 2,
        });
        await settle();

        // The reclaim must have restored the editor as the chain first
        // responder (not merely DOM focus, which survived the drag).
        await app.waitForCondition<boolean>(
          `(function(){
             var fr = document.querySelector('[data-first-responder]');
             var content = document.querySelector('${EDITOR_CONTENT}');
             var editorRid = content ? content.closest('[data-responder-id]')?.getAttribute('data-responder-id') : null;
             return fr !== null && editorRid !== null && fr.getAttribute('data-first-responder') === editorRid;
           })()`,
          { timeoutMs: 8000 },
        );

        // `save` (the same path ⌘S/File▸Save use) still reaches the editor.
        await dispatchControl(app, "save");
        await settle();
        await waitForSaveCell(app, "Saved");
        expect(fs.readFileSync(file, "utf8")).toContain("MOVED ");
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "conflict: Save Anyway writes the buffer to the real file ([P12])",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0212-conflict" });
      try {
        await seedFileCard(app, file);
        await waitForEditor(app, "alpha");
        await typeIntoEditor(app, "MINE ");
        await waitForSaveCell(app, "Edited");
        await settle();

        // Another app changes the file underneath us; a save now conflicts
        // and raises the modal conflict sheet. (Identity-routed — no
        // pre-focus needed.)
        fs.writeFileSync(file, "FOREIGN CONTENT\n", "utf8");
        await dispatchControl(app, "save");
        await settle();
        await waitSheetButton(app, "save-anyway");

        // Save Anyway writes the BUFFER (not the aside) to the REAL file.
        await settle();
        await app.click(`[data-testid="file-save-sheet-save-anyway"]`);
        await settle();
        await waitForSaveCell(app, "Saved");
        const disk = fs.readFileSync(file, "utf8");
        expect(disk).toContain("MINE ");
        expect(disk).not.toContain("FOREIGN CONTENT");
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "dirty close via X-click and control both gate on the close sheet",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0212-close" });
      try {
        await seedFileCard(app, file);
        await waitForEditor(app, "alpha");
        await typeIntoEditor(app, "UNSAVED ");
        await waitForSaveCell(app, "Edited");
        await settle();

        // Plain X-click (the !confirmClose short-circuit, Risk R02) raises
        // the sheet, not a silent close. Cancel keeps the card + edits.
        await app.nativeClickAtElement(CLOSE_BUTTON);
        await settle();
        await waitSheetButton(app, "cancel");
        await settle();
        await app.click(`[data-testid="file-save-sheet-cancel"]`);
        await settle();
        await app.waitForCondition<boolean>(
          `document.querySelector('${EDITOR_CONTENT}') !== null`,
        );
        expect(await saveCell(app)).toBe("Edited");

        // The close control gates the same way; Don't Save closes without
        // writing the buffer to disk.
        await dispatchControl(app, "close");
        await settle();
        await waitSheetButton(app, "dont-save");
        await settle();
        await app.click(`[data-testid="file-save-sheet-dont-save"]`);
        await settle();
        await app.waitForCondition<boolean>(
          `document.querySelector('${EDITOR_CONTENT}') === null`,
          { timeoutMs: 15000 },
        );
        expect(fs.readFileSync(file, "utf8")).toBe(ORIGINAL);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a dirty edit is set aside without touching the real file",
    async () => {
      const asideDir = path.join(
        os.homedir(),
        "Library/Application Support/Tug/Autosave Information",
      );
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0212-aside" });
      try {
        await seedFileCard(app, file);
        await waitForEditor(app, "alpha");
        await typeIntoEditor(app, "ASIDE-SENTINEL ");
        await waitForSaveCell(app, "Edited");
        await settle();

        const deadline = Date.now() + 15000;
        let found = false;
        while (Date.now() < deadline && !found) {
          if (fs.existsSync(asideDir)) {
            for (const name of fs.readdirSync(asideDir)) {
              try {
                if (fs.readFileSync(path.join(asideDir, name), "utf8").includes("ASIDE-SENTINEL")) {
                  found = true;
                  break;
                }
              } catch {
                /* racing writer — retry */
              }
            }
          }
          if (!found) await new Promise((r) => setTimeout(r, 150));
        }
        expect(found).toBe(true);
        expect(fs.readFileSync(file, "utf8")).toBe(ORIGINAL);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "automatic mode keeps Save enabled when clean (no-beep guard, [P07])",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0212-automatic" });
      try {
        await seedFileCard(app, file, "automatic");
        await waitForEditor(app, "alpha");
        await waitMenuEnabled(app, "file.save", true);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "New Text File opens a second Untitled editor",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0212-new-text-file" });
      try {
        await seedFileCard(app, file);
        await waitForEditor(app, "alpha");
        await settle();
        await dispatchControl(app, "new-text-file");
        await settle();
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('[data-slot="tug-file-editor"]').length >= 2`,
          { timeoutMs: 15000 },
        );
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
