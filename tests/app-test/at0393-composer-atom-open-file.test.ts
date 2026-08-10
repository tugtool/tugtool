/**
 * at0393-composer-atom-open-file.test.ts — right-clicking a file chip in the
 * composer opens the file it names.
 *
 * ## What this gates
 *
 * A file atom is the composer's whole vocabulary for "this file". An `@`
 * mention mints one, and its value is whatever the FILETREE index reported —
 * `notes/plan.md`, relative to the project root, because that is how the index
 * counts. The open handler on the other end speaks absolute paths only: the
 * file service rejects a relative path outright (`bad_path`), and what the
 * user saw for their trouble was a fresh Text card carrying an error where the
 * file should have been.
 *
 *   A. **The chip claims the right-click.** The substrate's context menu
 *      offers `Open in Editor` when the gesture lands on a `file` atom.
 *
 *   B. **And the item opens the file.** Activating it lands the file's real
 *      bytes in a Text card. The atom's value here is project-relative, which
 *      is the shape the mention path actually produces, so the assertion is
 *      specifically that the host's resolver joined it against the bound
 *      project root before the open — an unresolved value opens an error.
 *
 * Both gestures are native: a synthetic `contextmenu` would open the menu but
 * a synthetic click on its item does not run the menu's real activation path.
 *
 * The draft is seeded through the card-state bag rather than typed, because
 * the `@` popup needs a live FILETREE workspace and what is under test is the
 * chip's gesture, not the picker that minted it. The bag is the same restore
 * path a reloaded card takes, so the atom that mounts is a production atom.
 *
 * The atom-path resolver is what this names: the editor and the prompt entry
 * are both already at their accepted fan-out, and the resolver is the module
 * this gesture actually turns on.
 *
 * @covers tugdeck/src/lib/atom-file-path.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SID = "at0393-session";

/** TUG_ATOM_CHAR — the U+FFFC placeholder atom character (engine internal). */
const TUG_ATOM_CHAR = "￼";
/** Default route for `TugPromptEntry`. */
const TUG_PROMPT_ENTRY_DEFAULT_ROUTE = "❯";

/** The mention's value: relative to the project root, as the index reports it. */
const RELATIVE_PATH = "notes/plan.md";
const FILE_BODY = ["alpha", "bravo", "charlie"].join("\n");

const COMPOSER_ATOM =
  '[data-card-id="A"] [data-slot="tug-text-editor"] .cm-content img[data-atom-type="file"]';

let projectDir = "";

beforeAll(() => {
  if (!SHOULD_RUN) return;
  projectDir = mkdtempSync(join(tmpdir(), "at0393-atom-open-"));
  mkdirSync(join(projectDir, "notes"), { recursive: true });
  writeFileSync(join(projectDir, RELATIVE_PATH), FILE_BODY, "utf8");
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

/** A draft that is the word `read`, a space, and the file chip. */
function draftBag() {
  return {
    content: {
      route: TUG_PROMPT_ENTRY_DEFAULT_ROUTE,
      draft: {
        text: `read ${TUG_ATOM_CHAR}`,
        atoms: [
          {
            position: 5,
            type: "file",
            label: RELATIVE_PATH,
            value: RELATIVE_PATH,
          },
        ],
        selection: null,
      },
      maximized: false,
    },
  };
}

describe.skipIf(!SHOULD_RUN)("at0393 — the composer's file chip opens its file", () => {
  test(
    "right-click offers Open in Editor, and it opens the project-relative file",
    async () => {
      const app = await launchTugApp({ testName: "at0393-composer-atom-open-file" });
      try {
        await app.seedDeckState({
          state: deckShape(),
          cardStates: { A: draftBag() },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          { timeoutMs: 30_000 },
        );
        await app.bindSession("A", { tugSessionId: SID, projectDir });

        // The seeded draft mounted as a real atom widget — an `<img>`
        // carrying the mention's own value.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(COMPOSER_ATOM)}) !== null`,
          { timeoutMs: 20_000 },
        );
        expect(
          await app.evalJS<string>(
            `document.querySelector(${JSON.stringify(COMPOSER_ATOM)})
               .getAttribute("data-atom-value")`,
          ),
        ).toBe(RELATIVE_PATH);

        // ---- A. The chip claims the right-click. ---------------------------
        await app.nativeRightClickAtElement(COMPOSER_ATOM);
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-item-action="open-file"]') !== null`,
          { timeoutMs: 8000 },
        );

        // ---- B. And the item opens the file. -------------------------------
        const point = await app.evalJS<{ x: number; y: number } | null>(
          `(function(){
            var item = document.querySelector('[data-item-action="open-file"]');
            if (item === null) return null;
            var r = item.getBoundingClientRect();
            return {
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
            };
          })()`,
        );
        if (point === null) throw new Error("open-file item vanished before the click");
        await app.nativeClick(point);

        await app.waitForCondition<boolean>(
          `(function(){
            var ed = document.querySelector('[data-slot="tug-text-card-editor"] .cm-content');
            return ed !== null && (ed.textContent || '').indexOf("charlie") !== -1;
          })()`,
          { timeoutMs: 15_000 },
        );

        process.stdout.write("VERDICT: PASS\n");
      } catch (err) {
        process.stdout.write("VERDICT: FAIL\n");
        const tail = app.tailLog(200);
        if (tail !== "") process.stderr.write(`\n[at0393] log tail:\n${tail}\n`);
        throw err;
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
