/**
 * at0366-mention-trailing-punctuation.test.ts — an `@` mention written
 * mid-sentence matches its file and keeps the punctuation that follows it.
 *
 * A trigger token ends at whitespace, so `@roadmap/plan.md; Phase F` used to
 * query for `roadmap/plan.md;` — a path no file has. The popup went empty and
 * the mention never atomized; the user had to delete the punctuation, accept,
 * and type it back. The query now sheds the token's trailing punctuation run
 * while the document keeps it, and the accept replaces only up to the trim
 * point, so the punctuation survives as the prose it always was.
 *
 * The whole gesture is real: a real temp directory acquired as a workspace, a
 * real FILETREE query over it, real typing, and a real Return. What it pins:
 *
 *  - typing `@<marker>` opens the popup on the real file;
 *  - typing `;` after it does NOT empty the popup — the file is still offered;
 *  - Return atomizes the mention, leaving exactly one file chip, no literal
 *    `@` run, and the semicolon still in the text;
 *  - the caret lands past the separator — the next character typed reads
 *    `; X`, not `X;` or `;X`.
 *
 * The last one is the accept's range-and-caret math, which no other test
 * reaches: every other completion app-test drives the `/` trigger, and
 * at0354 mints its file chip from the Insert File… wire rather than from an
 * accepted mention.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/tug-text-editor/completion-extension.ts
 * @covers tugdeck/src/lib/filetree-store.ts
 * @covers tugdeck/src/components/tugways/tug-completion-popup.tsx
 */

import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR_CONTENT = `${CARD} .tug-prompt-entry .tug-text-editor .cm-content`;
const FILE_CHIP = `${EDITOR_CONTENT} img[data-atom-type="file"]`;
const COMPLETION_MENU = '[data-slot="tug-completion-menu"]';
const MENU_ROWS = `${COMPLETION_MENU} .tug-completion-menu-item`;

/** Distinctive enough that the query has exactly one hit. */
const MARKER = "at0366-marker.txt";
/** The prefix typed after `@` — a strict prefix of MARKER, no dot in it. */
const QUERY = "at0366-marker";

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "session", title: "Session", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
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
 * Register `dir` on tugcast's WorkspaceRegistry the way the frontend does,
 * so FILETREE queries carrying it as `root` route to a real tree.
 */
async function acquireWorkspace(app: App, dir: string): Promise<string> {
  // `evalJS` can't await, so the answer is parked on a window global and
  // polled — the same shape at0306 uses for its settings round-trip.
  await app.evalJS<null>(
    `(function(){
       window.__at0366 = undefined;
       fetch("/api/workspace/acquire", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ path: ${JSON.stringify(dir)} }),
       })
         .then(function(r){ return r.json(); })
         .then(function(j){ window.__at0366 = { key: j.workspace_key || "" }; })
         .catch(function(e){ window.__at0366 = { key: "", error: String(e) }; });
       return null;
     })()`,
  );
  const got = await app.waitForCondition<{ key: string; error?: string }>(
    `window.__at0366`,
    { timeoutMs: 15_000 },
  );
  if (got.key === "") {
    throw new Error(`workspace/acquire returned no key: ${got.error ?? ""}`);
  }
  return got.key;
}

/** The composer's text with the atom widget's placeholder removed. */
function composerText(app: App): Promise<string> {
  return app.evalJS<string>(
    `(function(){
       var e = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
       return e === null ? "" : (e.textContent || "").replace(/\\uFFFC/g, "");
     })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0366: an @ mention keeps the punctuation that follows it",
  () => {
    test(
      "typing @<file>; still matches, and Return atomizes it leaving the semicolon",
      async () => {
        const dir = realpathSync(mkdtempSync(`${tmpdir()}/at0366-project-`));
        writeFileSync(`${dir}/${MARKER}`, "marker\n");

        const app = await launchTugApp({
          testName: "at0366-mention-trailing-punctuation",
        });
        try {
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 30_000 },
          );

          const workspaceKey = await acquireWorkspace(app, dir);
          await app.bindSession("A", { workspaceKey, projectDir: dir });
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(EDITOR_CONTENT)}) !== null`,
            { timeoutMs: 15_000 },
          );

          // --- the mention, then the punctuation -----------------------
          await app.nativeClickAtElement(EDITOR_CONTENT);
          await app.nativeType(`@${QUERY}`);
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(MENU_ROWS)}).length > 0`,
            { timeoutMs: 10_000 },
          );

          // The semicolon a sentence needs. Before the trim this emptied the
          // popup: the query became `at0366-marker;`, which matches nothing.
          await app.nativeType(";");
          await app.waitForCondition<boolean>(
            `(function(){
               var rows = document.querySelectorAll(${JSON.stringify(MENU_ROWS)});
               for (var i = 0; i < rows.length; i++) {
                 if ((rows[i].textContent || "").indexOf(${JSON.stringify(MARKER)}) !== -1) return true;
               }
               return false;
             })()`,
            { timeoutMs: 8000 },
          );

          // --- accept ---------------------------------------------------
          await app.nativeKey("Return");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(FILE_CHIP)}).length === 1`,
            { timeoutMs: 8000 },
          );

          const chipValue = await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(FILE_CHIP)}) || {getAttribute:function(){return "";}}).getAttribute("data-atom-value")`,
          );
          expect(chipValue).toBe(MARKER);

          // The literal run is gone — the mention is an object now — and the
          // semicolon the user typed is still there.
          const afterAccept = await composerText(app);
          expect(afterAccept).not.toContain(`@${QUERY}`);
          expect(afterAccept).toContain(";");

          // --- where the caret landed ------------------------------------
          // Past the atom, past the surviving punctuation, past the
          // separating space. A caret left between the atom and the
          // semicolon would read "X;", one left before the space ";X".
          await app.nativeType("X");
          expect((await composerText(app)).trimStart()).toBe("; X");
        } catch (err) {
          process.stdout.write("VERDICT: FAIL\n");
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0366] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
          rmSync(dir, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
