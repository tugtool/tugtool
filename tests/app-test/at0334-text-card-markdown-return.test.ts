/**
 * at0334-text-card-markdown-return.test.ts — Return in a markdown file
 * card is a plain newline ([AT0334]).
 *
 * ## Scenario
 *
 * A Text card bound to a real `.md` file on disk. The caret is placed at
 * the end of a bullet line and Return is pressed as a REAL key event —
 * the only input path that reaches a CM6 keymap. The next line must be
 * empty: no `- ` the writer did not type.
 *
 * CodeMirror's markdown support ships an editing keymap whose Enter
 * binding is `insertNewlineContinueMarkup`. The prompt entry never had
 * it (`markdownTextStyleSupport` sets `addKeymap: false`); the file card
 * loads its grammar from the language registry, which did, so the two
 * surfaces disagreed on what Return means. This test pins the registry's
 * markdown loaders to the same answer.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/lib/language-registry.ts
 * @covers tugdeck/src/components/tugways/tug-text-card-editor.tsx
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 120_000;

const EDITOR_CONTENT_SELECTOR =
  '[data-card-id="A"] [data-slot="tug-text-card-editor"] .cm-content';

const FIXTURE_CONTENT = "This is a list:\n- first\n";

function mkFixture(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0334-"));
  const file = path.join(dir, "list.md");
  fs.writeFileSync(file, FIXTURE_CONTENT, "utf8");
  return { dir, file };
}

function deckShape() {
  return {
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
  };
}

async function seedTextCard(app: App, filePath: string): Promise<void> {
  await app.seedDeckState({
    state: deckShape(),
    cardStates: {
      A: {
        content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 },
      },
    },
    focusCardId: "A",
  });
}

/**
 * The document as CM6 has it rendered: one entry per `.cm-line`. The Text
 * card exposes no doc accessor on the test surface, and manual is the
 * shipping save mode, so disk is not a witness either — the rendered
 * lines are.
 */
async function docLines(app: App): Promise<string[] | null> {
  return app.evalJS<string[] | null>(
    `(function(){
      var el = document.querySelector('${EDITOR_CONTENT_SELECTOR}');
      if (!el) return null;
      return Array.prototype.map.call(
        el.querySelectorAll(".cm-line"),
        function (l) { return l.textContent; }
      );
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("at0334: markdown Return in a Text card", () => {
  test(
    "Return after a bullet line inserts a bare newline, not a continued bullet",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0334-text-card-markdown-return" });
      try {
        await seedTextCard(app, file);
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${EDITOR_CONTENT_SELECTOR}');
            return el !== null && el.innerText.indexOf("- first") !== -1;
          })()`,
          { timeoutMs: 8000 },
        );

        // The markdown grammar loads lazily; wait until the bullet line
        // actually carries its styling so Return is pressed against the
        // configured language, not against a bare document.
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${EDITOR_CONTENT_SELECTOR}');
            if (!el) return false;
            var lines = el.querySelectorAll(".cm-line");
            for (var i = 0; i < lines.length; i++) {
              if (lines[i].textContent.indexOf("- first") !== -1) {
                return lines[i].querySelector("span") !== null;
              }
            }
            return false;
          })()`,
          { timeoutMs: 10_000 },
        );

        // Focus the editor and put the caret at the end of the document
        // (end of "- first") through a real gesture + real keys.
        await app.nativeClickAtElement(EDITOR_CONTENT_SELECTOR);
        await app.waitForCondition<boolean>(
          `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(
            EDITOR_CONTENT_SELECTOR,
          )})`,
          { timeoutMs: 4000 },
        );
        // Caret to the end of the bullet line: document end, up one line,
        // then end-of-line.
        await app.nativeKey("ArrowDown", ["cmd"]);
        await new Promise((r) => setTimeout(r, 100));
        await app.nativeKey("ArrowUp");
        await new Promise((r) => setTimeout(r, 100));
        await app.nativeKey("ArrowRight", ["cmd"]);
        await new Promise((r) => setTimeout(r, 150));

        const before = await docLines(app);
        expect(before, "the fixture as rendered").toEqual([
          "This is a list:",
          "- first",
          "",
        ]);

        await app.nativeKey("Return");
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('${EDITOR_CONTENT_SELECTOR} .cm-line').length >= 4`,
          { timeoutMs: 4000 },
        );

        const after = await docLines(app);
        expect(after, "Return wrote a bare line, not a continued bullet").toEqual([
          "This is a list:",
          "- first",
          "",
          "",
        ]);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
