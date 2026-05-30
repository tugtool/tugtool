/**
 * at0092-workspace-directories.test.ts — the `/permissions` Workspace tab adds
 * a directory to `permissions.additionalDirectories`, with live path
 * completion from tugcast's `/api/fs/complete` ([AT0092]).
 *
 * ## Why this exists
 *
 * The Workspace tab differs from Allow/Ask/Deny: entries are filesystem
 * directories, not tool matchers, so add is permissive (any non-empty path)
 * and the field offers Tab/click completion of child directories. This drives
 * the whole directory path end to end against the real app:
 *
 *   1. A temp project root is seeded with child dirs (`alpha/`, `alphabet/`,
 *      `beta/`); the editor resolves its cwd from the bound session's
 *      `projectDir`, so completion + writes land here, never the real repo.
 *   2. Opening Workspace, expanding "Add a directory", and typing `al` surfaces
 *      the matching child directories through `/api/fs/complete` (the real Rust
 *      handler + filesystem read).
 *   3. Clicking a completion fills the field; Add writes it to
 *      `<cwd>/.claude/settings.local.json`'s `additionalDirectories`.
 *
 * The native "Browse…" OS picker (NSOpenPanel) is a native modal and isn't
 * automatable here; this covers the completion + add path that the picker
 * shares the final write with.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const PROMPT_INPUT = `${CARD} [data-slot="tug-text-editor"] .cm-content`;
const SHEET = '[data-slot="tug-sheet"]';
const tabSel = (id: string): string => `${SHEET} .tug-tab[data-testid="tug-tab-${id}"]`;
const ADD_INPUT = `${SHEET} .tug-file-chooser-input`;
const ADD_SUBMIT = `${SHEET} [data-slot="permission-rules-add-submit"]`;
// The completion overlay is portaled into the canvas overlay tier (not the
// sheet), so it's matched globally.
const OVERLAY = `[data-slot="tug-file-chooser-overlay"]`;
const OVERLAY_ITEM = `${OVERLAY} .tug-completion-menu-item`;

let projectDir = "";
const settingsPath = (): string => join(projectDir, ".claude", "settings.local.json");

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0092-workspace-"));
  // Child directories the completion endpoint should surface.
  for (const name of ["alpha", "alphabet", "beta"]) {
    mkdirSync(join(projectDir, name));
  }
});

afterAll(() => {
  if (projectDir !== "" && existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "dev", title: "Dev", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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

/** The `permissions.additionalDirectories` array on disk, or `[]` when absent. */
function workspaceDirs(): string[] {
  const path = settingsPath();
  if (!existsSync(path)) return [];
  const root = JSON.parse(readFileSync(path, "utf-8")) as {
    permissions?: { additionalDirectories?: unknown };
  };
  const dirs = root.permissions?.additionalDirectories;
  return Array.isArray(dirs) ? dirs.filter((e): e is string => typeof e === "string") : [];
}

async function waitForDirs(
  predicate: (dirs: string[]) => boolean,
  label: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: string[] = [];
  while (Date.now() < deadline) {
    last = workspaceDirs();
    if (predicate(last)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: timed out. dirs=${JSON.stringify(last)}`);
}

describe.skipIf(!SHOULD_RUN)(
  "AT0092: Workspace tab completes + adds a directory to additionalDirectories",
  () => {
    test(
      "type a prefix → completions from /api/fs/complete; click one + Add writes the dir",
      async () => {
        const app = await launchTugApp({ testName: "at0092-workspace-directories" });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );
          await app.bindDevSession("A", { projectDir });
          await app.awaitEngineReady("A");

          // Open the editor (raw-text local-command submit). Paced keystrokes
          // (one batch, ~40ms apart) so the OS doesn't drop keys under load.
          await app.nativeClickAtElement(PROMPT_INPUT);
          await app.nativeType("/permissions");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Escape");
          await new Promise((r) => setTimeout(r, 200));
          await app.nativeKey("Return", ["cmd"]);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SHEET)}) !== null`,
            { timeoutMs: 6000 },
          );

          // Switch to Workspace and expand the "Add a directory" accordion.
          await app.evalJS<void>(
            `document.querySelector(${JSON.stringify(tabSel("workspace"))}).click()`,
          );
          await app.evalJS<void>(
            `document.querySelector(${JSON.stringify(`${SHEET} .tug-accordion-trigger`)}).click()`,
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(ADD_INPUT)}) !== null`,
            { timeoutMs: 4000 },
          );

          // Focus the chooser input (a real click → onFocus arms the menu),
          // then type a prefix. The debounced fetch surfaces the two matching
          // child directories (alpha/, alphabet/) in the portaled overlay — not
          // beta/, not the empty match.
          // Focus the chooser input (fires onFocus → arms the menu) then type.
          // Programmatic focus is the reliable driver here: a native click can
          // land mid accordion-open animation and miss.
          await app.evalJS<void>(
            `document.querySelector(${JSON.stringify(ADD_INPUT)}).focus()`,
          );
          await app.evalJS<void>(
            `window.__tug.type(${JSON.stringify(ADD_INPUT)}, "al")`,
          );
          await app.waitForCondition<boolean>(
            `(function(){
              var items = Array.from(document.querySelectorAll(${JSON.stringify(OVERLAY_ITEM)})).map(function(b){return b.textContent.trim();});
              return items.indexOf("alpha/") !== -1 && items.indexOf("alphabet/") !== -1;
            })()`,
            { timeoutMs: 5000 },
          );
          const labels = await app.evalJS<string[]>(
            `Array.from(document.querySelectorAll(${JSON.stringify(OVERLAY_ITEM)})).map(function(b){return b.textContent.trim();})`,
          );
          expect(labels, "overlay lists matching dirs only, sorted").toEqual([
            "alpha/",
            "alphabet/",
          ]);

          expect(workspaceDirs(), "no dir before add").not.toContain("alphabet/");

          // Arrow-key behavior: ↓ moves the highlight from alpha/ (index 0) to
          // alphabet/ (index 1); Enter accepts it into the field. Selecting that
          // (empty) directory closes the menu.
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `(function(){
              var sel = document.querySelector(${JSON.stringify(`${OVERLAY} .tug-completion-menu-item-selected`)});
              return sel !== null && sel.textContent.trim() === "alphabet/";
            })()`,
            { timeoutMs: 4000 },
          );
          await app.nativeKey("Return");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(ADD_INPUT)}).value === "alphabet/"`,
            { timeoutMs: 4000 },
          );

          // Add writes the chosen directory.
          await app.waitForCondition<boolean>(
            `(function(){var b=document.querySelector(${JSON.stringify(ADD_SUBMIT)});return b!==null && !b.disabled;})()`,
            { timeoutMs: 4000 },
          );
          await app.evalJS<void>(
            `document.querySelector(${JSON.stringify(ADD_SUBMIT)}).click()`,
          );

          await waitForDirs(
            (dirs) => dirs.includes("alphabet/"),
            "Add must write the directory to additionalDirectories",
          );

          // The added directory appears as a row in the list.
          await app.waitForCondition<boolean>(
            `Array.from(document.querySelectorAll(${JSON.stringify(`${SHEET} .permission-rule-matcher`)})).some(function(el){return el.textContent.trim() === "alphabet/";})`,
            { timeoutMs: 4000 },
          );

          process.stdout.write("VERDICT: PASS\n");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0092-workspace-directories] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
