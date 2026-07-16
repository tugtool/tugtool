/**
 * at0204-prompt-entry-text-surface.test.ts — the prompt entry has no dead
 * surface: clicks land the caret, drops land anywhere.
 *
 * ## Why this exists
 *
 * The Dev prompt's editor opens taller than its content
 * (`--tug-text-editor-min-height`), leaving a blank band below the last
 * line — inside the editor's scroller, outside CM6's content-sized
 * `contentDOM`. Two regressions lived in that band:
 *
 *  1. **Click cleared the caret.** CM6 owns pointer selection only within
 *     `contentDOM`; a mousedown in the band reached no handler, and
 *     WebKit's focus default blurred the editor — the user clicked inside
 *     their own editor and lost the caret. Now `host-click.ts` claims the
 *     gesture and lands the caret at the nearest document position.
 *
 *  2. **Drops were refused.** The drop extension's handlers were bound to
 *     `contentDOM`, so a file drag over the band never saw
 *     `preventDefault` and the OS refused the drop. Now the substrate's
 *     drag surface is the HOST, and the prompt entry adds one
 *     entry-root surface over its chrome (strip / toolbar / status), so a
 *     drop lands anywhere on the entry and inserts at the nearest
 *     document position.
 *
 * Drags are synthesized (`DragEvent` + `DataTransfer` carrying a real 1×1
 * PNG `File`) — WebKit constructs them faithfully, and the accept
 * (`preventDefault` on dragover) plus the full drop pipeline (downsample →
 * bytes store → atom insertion → compose strip) are all real code paths.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const ENTRY = `${CARD} .tug-prompt-entry`;
const EDITOR_HOST = `${ENTRY} .tug-text-editor`;
const EDITOR_CONTENT = `${EDITOR_HOST} .cm-content`;
const SCROLLER = `${EDITOR_HOST} .cm-scroller`;
const TOOLBAR = `${ENTRY} .tug-prompt-entry-toolbar`;
const ATTACH_STRIP = `${ENTRY} .tug-prompt-entry-attachments`;

/** A valid 1×1 transparent PNG, so the downsample pipeline really decodes. */
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
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

async function launchAndSeed(testName: string): Promise<App> {
  const app = await launchTugApp({ testName });
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.bindSession("A");
  await app.awaitEngineReady("A");
  return app;
}

function editorFocused(app: App): Promise<boolean> {
  return app.evalJS<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(EDITOR_CONTENT)})`,
  );
}

/** Client point centered horizontally in the blank band below the content
 *  (between the content's bottom and the scroller's bottom). */
function blankBandPoint(app: App): Promise<{ x: number; y: number }> {
  return app.evalJS<{ x: number; y: number }>(
    `(function(){
      var content = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
      var scroller = document.querySelector(${JSON.stringify(SCROLLER)});
      var cr = content.getBoundingClientRect();
      var sr = scroller.getBoundingClientRect();
      return { x: sr.left + sr.width / 2, y: (cr.bottom + sr.bottom) / 2 };
    })()`,
  );
}

/** Synthesize a file dragover → drop at a client point over `selector`'s
 *  element (dispatched on the element under the point via elementFromPoint,
 *  matching how real drags target). Returns whether the dragover was
 *  accepted (defaultPrevented — the OS-level "this is a drop target"). */
function dropPngAt(
  app: App,
  point: { x: number; y: number },
): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
      var bytes = Uint8Array.from(atob(${JSON.stringify(PNG_1X1_BASE64)}), function(c){ return c.charCodeAt(0); });
      var file = new File([bytes], "drop-test.png", { type: "image/png" });
      var dt = new DataTransfer();
      dt.items.add(file);
      var x = ${point.x}, y = ${point.y};
      var target = document.elementFromPoint(x, y);
      if (!target) return false;
      var over = new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(over, "dataTransfer", { value: dt });
      target.dispatchEvent(over);
      var accepted = over.defaultPrevented;
      var drop = new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(drop, "dataTransfer", { value: dt });
      target.dispatchEvent(drop);
      return accepted;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0204: prompt entry has no dead surface (caret + drops)",
  () => {
    test(
      "click in the blank band below the text lands the caret, never blurs",
      async () => {
        const app = await launchAndSeed("at0204-blank-band-click");
        try {
          // Focus the editor and type so there is real content above the band.
          await app.nativeClickAtElement(EDITOR_CONTENT);
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(EDITOR_CONTENT)})`,
          );
          await app.nativeType("hello");
          await app.waitForCondition<boolean>(
            `(function(){var c=document.querySelector(${JSON.stringify(EDITOR_CONTENT)});return c!==null && c.textContent.indexOf("hello")!==-1;})()`,
          );

          // Click the blank band below the text — inside the editor's
          // min-height scroller, below the content box.
          const pt = await blankBandPoint(app);
          await app.nativeClick(pt);

          // The caret must survive: editor still focused, selection at the
          // nearest position (end of the only line).
          await app.waitForCondition<boolean>(
            `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(EDITOR_CONTENT)})`,
            { timeoutMs: 3000 },
          );
          expect(await editorFocused(app), "editor keeps focus").toBe(true);

          // And typing continues at the caret — the surface is live.
          await app.nativeType("!");
          await app.waitForCondition<boolean>(
            `(function(){var c=document.querySelector(${JSON.stringify(EDITOR_CONTENT)});return c!==null && c.textContent.indexOf("hello!")!==-1;})()`,
            { timeoutMs: 3000 },
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0204] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "a file drop is accepted on the blank band AND on the entry toolbar",
      async () => {
        const app = await launchAndSeed("at0204-drop-anywhere");
        try {
          // Drop 1 — the blank band below the (empty) content, the exact
          // spot the regression refused.
          const bandPt = await blankBandPoint(app);
          const bandAccepted = await dropPngAt(app, bandPt);
          expect(bandAccepted, "dragover over the blank band accepts").toBe(true);

          // The full pipeline runs: the image decodes, the atom inserts,
          // and the compose strip mounts.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(ATTACH_STRIP)}) !== null`,
            { timeoutMs: 6000 },
          );

          // Drop 2 — the entry toolbar (chrome, outside the editor host):
          // the entry-root surface routes it into the editor too.
          const toolbarPt = await app.evalJS<{ x: number; y: number }>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(TOOLBAR)});
              var r = el.getBoundingClientRect();
              return { x: r.left + r.width * 0.4, y: r.top + r.height / 2 };
            })()`,
          );
          const toolbarAccepted = await dropPngAt(app, toolbarPt);
          expect(toolbarAccepted, "dragover over the toolbar accepts").toBe(true);

          // Second image lands: two tiles in the compose strip.
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ATTACH_STRIP)} + ' [data-slot="tug-attachment-preview__tile"]').length >= 2`,
            { timeoutMs: 6000 },
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0204] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
