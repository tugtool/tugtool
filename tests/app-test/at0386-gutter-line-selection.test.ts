/**
 * at0386-gutter-line-selection.test.ts — pressing a line number selects
 * that line, and dragging the gutter extends the selection by lines.
 *
 * CM6 ships no gesture on the line-number gutter, so before this the
 * press fell through to the browser and selected the *number* — the
 * gutter looked like chrome that had forgotten what it was for. Every
 * editor a person arrives from answers the press by selecting the line.
 *
 * The read is the real thing on both ends: real NSEvent presses and
 * drags on a real Text card holding a real file, and the assertion is
 * `window.getSelection().toString()` — what the user has actually got
 * selected, not an internal range the surface reports about itself.
 *
 * | Step | Gesture                        | Selection                    |
 * |------|--------------------------------|------------------------------|
 * | A    | click the gutter cell for L2   | line 2, and only line 2      |
 * | B    | drag the gutter L2 → L4        | lines 2-4                    |
 * | C    | drag the gutter L5 → L3        | lines 3-5 (upward drag)      |
 *
 * @covers tugdeck/src/components/tugways/gutter-line-selection.ts
 * @covers tugdeck/src/components/tugways/tug-text-card-editor.tsx
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR = `${CARD} [data-slot="tug-text-card-editor"]`;
const CONTENT = `${EDITOR} .cm-content`;

/** Six lines, each its own word, so a selection names itself. */
const LINES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
const FIXTURE = `${LINES.join("\n")}\n`;

function mkFixture(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0386-"));
  const file = path.join(dir, "lines.txt");
  fs.writeFileSync(file, FIXTURE, "utf8");
  return { dir, file };
}

async function seedTextCard(app: App, filePath: string): Promise<void> {
  // The gutter is the subject, so it has to be on before the card mounts.
  await app.evalJS<null>(
    `(window.__tug.setTugbankValue("dev.tugtool.text-card","settings",` +
      `{kind:"json",value:{lineNumbers:true,lineWrap:false,softTabs:true,tabSize:4,` +
      `foldGutter:false,highlightActiveLine:true,showSpaces:false,showTabs:false}}), null)`,
  );
  await app.seedDeckState({
    state: {
      cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
      panes: [
        {
          id: "p1",
          position: { x: 40, y: 40 },
          size: { width: 620, height: 560 },
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

/**
 * The center of the gutter cell labelled `n`, in viewport coordinates.
 * Found by the number it renders rather than by index: the gutter's first
 * `.cm-gutterElement` is CM6's width spacer, not line 1.
 */
function gutterCellCenterExpr(n: number): string {
  return `(function(){
    var cells = document.querySelectorAll(${JSON.stringify(`${EDITOR} .cm-lineNumbers .cm-gutterElement`)});
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].textContent.trim() !== ${JSON.stringify(String(n))}) continue;
      var r = cells[i].getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  })()`;
}

/** What the user has selected, with the trailing line break normalized off. */
const SELECTED_TEXT = `(function(){
  var sel = window.getSelection();
  return sel === null ? null : sel.toString().replace(/\\n$/, "");
})()`;

describe.skipIf(!SHOULD_RUN)("at0386: gutter press and drag select lines", () => {
  test(
    "a line number selects its line, and a gutter drag extends by lines",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({ testName: "at0386-gutter-line-selection" });
      try {
        await seedTextCard(app, file);

        // The file is in the buffer and the gutter has rendered its numbers.
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(CONTENT)});
            if (!el || el.innerText.indexOf(${JSON.stringify(LINES[5])}) === -1) return false;
            return document.querySelectorAll(${JSON.stringify(`${EDITOR} .cm-lineNumbers .cm-gutterElement`)}).length > 6;
          })()`,
          { timeoutMs: 20000 },
        );

        const cellOf = async (n: number): Promise<{ x: number; y: number }> => {
          const point = await app.evalJS<{ x: number; y: number } | null>(
            gutterCellCenterExpr(n),
          );
          expect(point).not.toBeNull();
          return point as { x: number; y: number };
        };

        // ---- A. A press on the number selects the line it names. ----
        await app.nativeClick(await cellOf(2));
        await app.waitForCondition<boolean>(
          `${SELECTED_TEXT} === ${JSON.stringify(LINES[1])}`,
          { timeoutMs: 6000 },
        );
        const single = await app.evalJS<string | null>(SELECTED_TEXT);
        note("at0386 press on L2", JSON.stringify(single));
        // The number itself is what the browser would have selected on its
        // own; selecting it is the exact failure this gesture replaces.
        expect(single).not.toBe("2");
        expect(single).toBe(LINES[1]);

        // ---- B. A downward drag extends by whole lines. ----
        await app.nativeDrag(await cellOf(2), await cellOf(4));
        await app.waitForCondition<boolean>(
          `${SELECTED_TEXT} === ${JSON.stringify(LINES.slice(1, 4).join("\n"))}`,
          { timeoutMs: 6000 },
        );
        const down = await app.evalJS<string | null>(SELECTED_TEXT);
        note("at0386 drag L2→L4", JSON.stringify(down));
        expect(down).toBe(LINES.slice(1, 4).join("\n"));

        // ---- C. And an upward drag covers the same span in reverse. ----
        await app.nativeDrag(await cellOf(5), await cellOf(3));
        await app.waitForCondition<boolean>(
          `${SELECTED_TEXT} === ${JSON.stringify(LINES.slice(2, 5).join("\n"))}`,
          { timeoutMs: 6000 },
        );
        const up = await app.evalJS<string | null>(SELECTED_TEXT);
        note("at0386 drag L5→L3", JSON.stringify(up));
        expect(up).toBe(LINES.slice(2, 5).join("\n"));
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
