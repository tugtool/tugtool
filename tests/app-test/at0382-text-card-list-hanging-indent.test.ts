/**
 * at0382-text-card-list-hanging-indent.test.ts — a markdown list line
 * starts flush with the prose around it.
 *
 * The hanging-indent extension gives every list line an inline
 * `padding-left`, which on the Text card lands on a `.cm-line` the theme
 * already inset with a `padding` shorthand. A longhand beats a shorthand,
 * so the naive form silently ate the surface's own left inset and every
 * list line rendered one gutter-width to the LEFT of the paragraphs
 * around it — the exact opposite of what a hanging indent is for.
 *
 * The measurement is geometric, not stylistic: open a real .md file with
 * soft wrap on, and compare the x of the first glyph on a bullet line, an
 * ordered line, and a plain paragraph line. All three must agree. A
 * wrapped continuation must then sit strictly to the RIGHT of that — the
 * effect the extension exists to produce.
 *
 * @covers tugdeck/src/components/tugways/tug-text-editor/list-hanging-indent.ts
 * @covers tugdeck/src/components/tugways/tug-text-card-editor/theme.ts
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const EDITOR_CONTENT = `${CARD} [data-slot="tug-text-card-editor"] .cm-content`;

// Line 1 is a paragraph, 2 a bullet, 3 an ordered item, 4 a bullet long
// enough to wrap inside the card's width.
const PARAGRAPH = "Paragraph of prose that sets the left margin.";
const BULLET = "a bullet item";
const ORDERED = "an ordered item";
const LONG = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
const FIXTURE = [PARAGRAPH, `- ${BULLET}`, `1. ${ORDERED}`, `- ${LONG}`, ""].join("\n");

function mkFixture(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0382-"));
  const file = path.join(dir, "notes.md");
  fs.writeFileSync(file, FIXTURE, "utf8");
  return { dir, file };
}

async function seedTextCard(app: App, filePath: string): Promise<void> {
  // Soft wrap is what installs the hanging-indent extension, and the deck
  // default is off — set it before the card mounts.
  await app.evalJS<null>(
    `(window.__tug.setTugbankValue("dev.tugtool.text-card","settings",` +
      `{kind:"json",value:{lineNumbers:true,lineWrap:true,softTabs:true,tabSize:4,` +
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
 * The x of the first glyph on line `n` (1-based), read from a Range over
 * its first character — `.cm-line`'s own box carries the padding, so only
 * a text rect answers where the glyph actually landed.
 */
function firstGlyphXExpr(n: number): string {
  return `(function(){
    var content = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
    if (!content) return null;
    var line = content.children[${n - 1}];
    if (!line) return null;
    var walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    var node = walker.nextNode();
    if (!node || node.data.length === 0) return null;
    var r = document.createRange();
    r.setStart(node, 0);
    r.setEnd(node, 1);
    return r.getBoundingClientRect().left;
  })()`;
}

/** The x of the first glyph on the LAST visual row of line `n`. */
function lastRowXExpr(n: number): string {
  return `(function(){
    var content = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
    if (!content) return null;
    var line = content.children[${n - 1}];
    if (!line) return null;
    var r = document.createRange();
    r.selectNodeContents(line);
    var rects = Array.from(r.getClientRects()).filter(function(b){ return b.width > 0; });
    if (rects.length < 2) return null;
    return rects[rects.length - 1].left;
  })()`;
}

describe.skipIf(!SHOULD_RUN)("at0382: Text card markdown list hanging indent", () => {
  test(
    "list lines start flush with prose; wrapped continuations hang right",
    async () => {
      const { dir, file } = mkFixture();
      const app = await launchTugApp({
        testName: "at0382-text-card-list-hanging-indent",
      });
      try {
        await seedTextCard(app, file);

        // The file is loaded, wrapping is on, and the markdown grammar has
        // arrived (it loads lazily, and the extension only decorates once
        // `ListMark` nodes exist).
        await app.waitForCondition<boolean>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
            if (!el || !el.classList.contains("cm-lineWrapping")) return false;
            if (el.innerText.indexOf(${JSON.stringify(BULLET)}) === -1) return false;
            var line = el.children[1];
            return line != null && line.getAttribute("style") !== null &&
              line.getAttribute("style").indexOf("text-indent") !== -1;
          })()`,
          { timeoutMs: 20000 },
        );

        const paragraphX = await app.evalJS<number | null>(firstGlyphXExpr(1));
        const bulletX = await app.evalJS<number | null>(firstGlyphXExpr(2));
        const orderedX = await app.evalJS<number | null>(firstGlyphXExpr(3));
        note(
          "at0382 first-glyph x",
          `paragraph ${paragraphX}, bullet ${bulletX}, ordered ${orderedX}`,
        );

        expect(paragraphX).not.toBeNull();
        expect(bulletX).not.toBeNull();
        expect(orderedX).not.toBeNull();

        // The regression was a whole gutter-width (≈8px) of leftward
        // drift; sub-pixel layout noise is the only slack allowed.
        expect(Math.abs((bulletX as number) - (paragraphX as number))).toBeLessThan(1);
        expect(Math.abs((orderedX as number) - (paragraphX as number))).toBeLessThan(1);

        // ...and the effect itself: the wrapped rows of the long bullet
        // hang to the right of its marker.
        const wrappedX = await app.evalJS<number | null>(lastRowXExpr(4));
        note("at0382 wrapped continuation x", wrappedX);
        expect(wrappedX).not.toBeNull();
        expect(wrappedX as number).toBeGreaterThan((paragraphX as number) + 1);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
