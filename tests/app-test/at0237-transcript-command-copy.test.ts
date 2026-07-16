/**
 * at0237-transcript-command-copy.test.ts — the REAL command right-click
 * Copy / Copy as Plain Text path, end to end.
 *
 * Drives the actual affordance the user triggers on a transcript command
 * span (`enhance-commands` → `.tugx-md-cmd`): a right-click opens the cell's
 * `useTranscriptCellMenu` context menu, whose Copy / Copy as Plain Text
 * items dispatch `copy-command` / `copy-command-as-plain-text` to the cell
 * responder → the command-copy handlers → the clipboard. The handlers copy
 * the WHOLE command (read from the span), never a smart-selected sub-word.
 * The `gallery-transcript-copy` fixture's cell D mounts a real
 * `TugMarkdownBlock` with `isKnownSlashCommand`, so `enhanceCommands` tags
 * the inline `<code>` commands in real DOM.
 *
 * Asserts:
 *  - **enhancer tagging**: a project shell command (`just launch-debug`,
 *    `tug dash join --preview`) gets `.tugx-md-cmd` + `data-shell-command`;
 *    a known slash command (`/diff HEAD`) gets `.tugx-md-cmd` +
 *    `data-slash-command` / `data-slash-args`;
 *  - **Copy** (rich): `text/plain` = the whole command in Markdown
 *    backticks, `text/html` = a `<code>` element;
 *  - **Copy as Plain Text**: `text/plain` = the bare whole command, no
 *    backticks, no `text/html`;
 *  - **no standard-copy duplicate**: a command right-click shows the two
 *    command items and NOT the selection-scoped standard `copy`.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const CARD = `[data-card-id="A"]`;
const CELL_D = `${CARD} [data-testid="gallery-transcript-copy-cell-d"]`;

// Capture both clipboard flavors: the dual-format `navigator.clipboard.write`
// (text/plain + text/html — the rich Copy) and the `writeText` plain path
// (Copy as Plain Text). Mirrors at0188's capture.
const INSTALL_CLIPBOARD_CAPTURE = `(function(){
  window.__copied = [];
  window.__copiedHtml = [];
  var writeTextSink = function(t){ window.__copied.push(String(t)); return Promise.resolve(); };
  var writeSink = function(items){
    try {
      var arr = items || [];
      for (var i = 0; i < arr.length; i++){
        (function(item){
          var types = item.types || [];
          if (types.indexOf("text/plain") !== -1){
            item.getType("text/plain").then(function(b){ return b.text(); }).then(function(t){ window.__copied.push(String(t)); });
          }
          if (types.indexOf("text/html") !== -1){
            item.getType("text/html").then(function(b){ return b.text(); }).then(function(t){ window.__copiedHtml.push(String(t)); });
          }
        })(arr[i]);
      }
    } catch (e) { /* ignore */ }
    return Promise.resolve();
  };
  try { navigator.clipboard.writeText = writeTextSink; }
  catch (e) { Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: writeTextSink }); }
  try { navigator.clipboard.write = writeSink; }
  catch (e) { Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: writeSink }); }
  return typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined";
})()`;

/** Read the class + command datasets off the `.tugx-md-cmd` span whose text === `cmd`. */
function tagInfoScript(cmd: string): string {
  return `(function(){
    var spans = document.querySelectorAll('${CELL_D} code.tugx-md-cmd');
    for (var i = 0; i < spans.length; i++){
      if ((spans[i].textContent || "").trim() === ${JSON.stringify(cmd)}){
        var d = spans[i].dataset;
        return {
          hasClass: spans[i].classList.contains("tugx-md-cmd"),
          shell: d.shellCommand === undefined ? null : d.shellCommand,
          slash: d.slashCommand === undefined ? null : d.slashCommand,
          slashArgs: d.slashArgs === undefined ? null : d.slashArgs,
        };
      }
    }
    return "__NOT_FOUND__";
  })()`;
}

type Harness = Awaited<ReturnType<typeof launchTugApp>>;

/**
 * Open the command context menu with a trusted native right-click on the
 * command span selected by `selector` (a `data-shell-command` /
 * `data-slash-command` attribute selector), then wait for `action`'s item.
 * Native gestures — not synthetic events — are what fire the menu's real
 * `onMouseDown` activation and preserve clipboard user-activation.
 */
async function openMenu(app: Harness, selector: string, action: string): Promise<void> {
  await app.evalJS(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: "center" }); return !!el; })()`,
  );
  await app.nativeRightClickAtElement(selector);
  await app.waitForCondition<boolean>(
    `document.querySelector('[data-item-action="' + ${JSON.stringify(action)} + '"]') !== null`,
    { timeoutMs: 3000 },
  );
}

/** Trusted native-click the open menu's item with `data-item-action === action`. */
async function activateItem(app: Harness, action: string): Promise<void> {
  const point = await app.evalJS<{ x: number; y: number } | null>(
    `(() => {
      const item = document.querySelector('[data-item-action="' + ${JSON.stringify(action)} + '"]');
      if (item === null) return null;
      const r = item.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`,
  );
  if (point === null) throw new Error(`menu item ${action} not found`);
  await app.nativeClick(point);
}

describe.skipIf(!SHOULD_RUN)(
  "AT0237: transcript command right-click copies the command to the clipboard",
  () => {
    test(
      "enhancer tags shell + slash commands; Copy / Copy as Plain Text write the command",
      async () => {
        const app = await launchTugApp({ testName: "at0237-transcript-command-copy" });
        try {
          await app.seedDeckState({
            state: {
              cards: [{ id: "A", componentId: "gallery-transcript-copy", title: "Transcript Copy", closable: true }],
              panes: [{ id: "p1", position: { x: 40, y: 40 }, size: { width: 760, height: 560 }, cardIds: ["A"], activeCardId: "A", title: "", acceptsFamilies: ["maker"] }],
              activePaneId: "p1",
              hasFocus: true,
            },
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          // The enhancer runs at block build; wait for the shell span to be tagged.
          await app.waitForCondition<boolean>(
            `document.querySelector('${CELL_D} code.tugx-md-cmd[data-shell-command]') !== null`,
            { timeoutMs: 6000 },
          );

          // ---- enhancer tagging (real DOM) ----
          const shellTag = await app.evalJS<{ hasClass: boolean; shell: string | null; slash: string | null }>(
            tagInfoScript("just launch-debug"),
          );
          expect(shellTag).toMatchObject({ hasClass: true, shell: "just launch-debug", slash: null });

          const shellTag2 = await app.evalJS<{ shell: string | null }>(
            tagInfoScript("tug dash join --preview"),
          );
          expect(shellTag2.shell).toBe("tug dash join --preview");

          const slashTag = await app.evalJS<{ shell: string | null; slash: string | null; slashArgs: string | null }>(
            tagInfoScript("/diff HEAD"),
          );
          expect(slashTag).toMatchObject({ shell: null, slash: "diff", slashArgs: "HEAD" });

          const captureReady = await app.evalJS<boolean>(INSTALL_CLIPBOARD_CAPTURE);
          expect(captureReady).toBe(true);

          const SHELL_SEL = `${CELL_D} code[data-shell-command="just launch-debug"]`;
          const SLASH_SEL = `${CELL_D} code[data-slash-command="diff"]`;

          // ---- Copy (rich) on a shell command copies the WHOLE command ----
          await openMenu(app, SHELL_SEL, "copy-command");
          // No competing standard selection-Copy: the menu shows only the
          // two command items (the reported sub-word Copy is gone).
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll('[data-item-action="copy"]').length`,
            ),
          ).toBe(0);
          await app.evalJS<unknown>(`(window.__copied = [], window.__copiedHtml = [], true)`);
          await activateItem(app, "copy-command");
          await app.waitForCondition<boolean>(
            `Array.isArray(window.__copied) && window.__copied.length > 0`,
            { timeoutMs: 3000 },
          );
          expect(await app.evalJS<string>(`window.__copied[window.__copied.length - 1]`)).toBe(
            "`just launch-debug`",
          );
          await app.waitForCondition<boolean>(
            `Array.isArray(window.__copiedHtml) && window.__copiedHtml.length > 0`,
            { timeoutMs: 3000 },
          );
          expect(await app.evalJS<string>(`window.__copiedHtml[window.__copiedHtml.length - 1]`)).toBe(
            "<code>just launch-debug</code>",
          );

          // ---- Copy as Plain Text on the same shell command ----
          await openMenu(app, SHELL_SEL, "copy-command-as-plain-text");
          await app.evalJS<unknown>(`(window.__copied = [], window.__copiedHtml = [], true)`);
          await activateItem(app, "copy-command-as-plain-text");
          await app.waitForCondition<boolean>(
            `Array.isArray(window.__copied) && window.__copied.length > 0`,
            { timeoutMs: 3000 },
          );
          // Bare full command — no backticks, no text/html flavor.
          expect(await app.evalJS<string>(`window.__copied[window.__copied.length - 1]`)).toBe(
            "just launch-debug",
          );
          expect(await app.evalJS<number>(`window.__copiedHtml.length`)).toBe(0);

          // ---- Copy on the slash command (the reported bug: a right-click
          // over `/…/roadmap/…` must copy the whole command, not a word) ----
          await openMenu(app, SLASH_SEL, "copy-command");
          await app.evalJS<unknown>(`(window.__copied = [], window.__copiedHtml = [], true)`);
          await activateItem(app, "copy-command");
          await app.waitForCondition<boolean>(
            `Array.isArray(window.__copied) && window.__copied.length > 0`,
            { timeoutMs: 3000 },
          );
          expect(await app.evalJS<string>(`window.__copied[window.__copied.length - 1]`)).toBe(
            "`/diff HEAD`",
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0237-transcript-command-copy] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
