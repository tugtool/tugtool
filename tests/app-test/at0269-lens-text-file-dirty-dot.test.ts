/**
 * at0269-lens-text-file-dirty-dot.test.ts — the Lens **Text Files** row wears
 * the same unsaved-changes dot the text card's own header does, and reads at
 * the Sessions rows' type scale.
 *
 * Drives the real path: a real file opened in a real manual-mode Text card,
 * typed into with `execCommand` (the at0209/at0212 idiom), with the Lens open
 * beside it. The row is clean at rest and grows the dot the instant the buffer
 * goes dirty — through the open-registry's `hasUnsavedMark` channel, not a mock.
 *
 * ## Coverage note — the dot CLEARING is not asserted here. Both gestures that
 * clear it are undrivable in a headless sweep: an explicit save routes through
 * the responder chain to the editor *leaf* responder (see at0212's coverage
 * note), and CodeMirror owns its own history, so `execCommand("undo")` never
 * reaches the buffer. The clean⇢dirty⇢clean state machine itself is covered at
 * the store layer in `text-card-store.manual.test.ts`; this test covers the
 * projection of that state into the Lens row.
 *
 * @covers tugdeck/src/components/lens/sections/text-files-section.tsx
 * @covers tugdeck/src/components/lens/sections/text-files-data-source.ts
 * @covers tugdeck/src/lib/text-card-open-registry.ts
 * @covers tugdeck/src/components/tugways/tug-text-card-editor.css
 * @covers tugdeck/src/components/tugways/tug-text-card-editor.tsx
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
const ROW_TITLE = ".lens-text-files-list .tug-list-row-title";
const ROW_SUBTITLE = ".lens-text-files-list .tug-list-row-subtitle";
const DOT = '[data-testid="lens-text-file-unsaved"]';

const ORIGINAL = "alpha\nbeta\ngamma\n";

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

async function typeIntoEditor(app: App, text: string): Promise<void> {
  const ok = await app.evalJS<boolean>(
    `(function(){
      var el = document.querySelector('${EDITOR_CONTENT}');
      if (!el) return false;
      el.focus();
      return document.execCommand("insertText", false, ${JSON.stringify(text)});
    })()`,
  );
  if (!ok) throw new Error("[at0269] typeIntoEditor: insertText not handled");
}

describe.skipIf(!SHOULD_RUN)("at0269 — Lens text-file dirty dot", () => {
  test(
    "the row shows the unsaved dot while the buffer is dirty",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0269-"));
      const file = path.join(dir, "manual.txt");
      fs.writeFileSync(file, ORIGINAL, "utf8");
      const app = await launchTugApp({ testName: "at0269-dirty-dot" });
      try {
        await app.seedDeckState({
          state: deckShape(),
          cardStates: {
            A: {
              content: { path: file, anchor: { line: 1, ch: 0 }, scrollTop: 0 },
            },
          },
          focusCardId: "A",
        });
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${EDITOR_CONTENT}');
            return el !== null && el.innerText.indexOf("alpha") !== -1;
          })()`,
          { timeoutMs: 15000 },
        );
        await app.evalJS<null>(
          `(window.__tug.dispatchControlAction("toggle-lens"), null)`,
        );
        // The open file reaches the Lens list once its card binds the path.
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector('${ROW_TITLE}');
            return el !== null && el.innerText.indexOf("manual.txt") !== -1;
          })()`,
          { timeoutMs: 15000 },
        );

        // Clean buffer — no dot.
        expect(await app.evalJS<number>(
          `document.querySelectorAll('${DOT}').length`,
        )).toBe(0);

        // Type: the card goes dirty and the Lens row grows the dot.
        await typeIntoEditor(app, "X");
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('${DOT}').length === 1`,
          { timeoutMs: 8000 },
        );
        expect(
          await app.evalJS<string>(
            `document.querySelector('${ROW_TITLE}').innerText`,
          ),
        ).toContain("•");

        // The row's two lines read at the Sessions rows' type scale:
        // a 13px title over a 12px directory line.
        expect(
          await app.evalJS<string>(
            `getComputedStyle(document.querySelector('${ROW_TITLE}')).fontSize`,
          ),
        ).toBe("13px");
        expect(
          await app.evalJS<string>(
            `getComputedStyle(document.querySelector('${ROW_SUBTITLE}')).fontSize`,
          ),
        ).toBe("12px");
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
