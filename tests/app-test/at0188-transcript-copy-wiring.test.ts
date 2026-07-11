/**
 * at0188-transcript-copy-wiring.test.ts — the REAL transcript COPY path,
 * end to end ([Q03] fixture; inline granularity from [P02]).
 *
 * Drives the actual handler the user triggers: a selection in a real
 * `useTranscriptCellMenu` body → ⌘C → `handleCopy` →
 * `selectionToTranscriptMarkdown` (fragment serializer) →
 * `clipboard.writeText`. The `gallery-transcript-copy` fixture mounts that
 * hook over a static body of real components (markdown + Bash tool +
 * thinking + markdown).
 *
 * Asserts:
 *  - **inline-accurate**: selecting plain prose inside a paragraph copies
 *    exactly that text (not the whole paragraph);
 *  - **atomic widen**: selecting the rendered text of `**bold**` copies
 *    `**bold**` with its markers (never bare `bold`);
 *  - **cross-block**: a selection from prose through the tool block into
 *    the next paragraph copies prose + the `## Tool: Bash` section and
 *    OMITS the thinking block.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const CARD = `[data-card-id="A"]`;
const BODY = `${CARD} [data-testid="gallery-transcript-copy"]`;

// Capture BOTH clipboard paths: the dual-format `navigator.clipboard.write`
// ([ClipboardItem] with text/plain + text/html, the markdown path) and the
// `writeText` plain-text fallback. `window.__copied` holds the latest
// text/plain (markdown); `window.__copiedHtml` holds the latest text/html.
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

/** Select rendered chars [startOff,endOff) inside the first non-empty text node of the block containing `needle`. */
function selectInBlockScript(needle: string, startOff: number, endOff: number): string {
  return `(function(){
    var blocks = document.querySelectorAll('${BODY} .tugx-md-block');
    for (var i = 0; i < blocks.length; i++){
      if ((blocks[i].textContent || "").indexOf(${JSON.stringify(needle)}) !== -1){
        var w = document.createTreeWalker(blocks[i], NodeFilter.SHOW_TEXT);
        var n = w.nextNode();
        while (n !== null){ if ((n.textContent||"").replace(/^\\s+|\\s+$/g,"").length > 0) break; n = w.nextNode(); }
        if (n === null) return "__NO_TEXT__";
        var range = document.createRange();
        range.setStart(n, ${startOff}); range.setEnd(n, ${endOff});
        var t = range.toString(); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        return t;
      }
    }
    return "__NOT_FOUND__";
  })()`;
}

/** Select all of the text node whose trimmed content === `exact` (e.g. the inner text of **bold**). */
function selectExactNodeScript(exact: string): string {
  return `(function(){
    var root = document.querySelector('${BODY}');
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (var n = w.nextNode(); n !== null; n = w.nextNode()){
      if ((n.textContent || "").trim() === ${JSON.stringify(exact)}){
        var range = document.createRange();
        range.setStart(n, 0); range.setEnd(n, (n.textContent || "").length);
        var t = range.toString(); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        return t;
      }
    }
    return "__NOT_FOUND__";
  })()`;
}

/** Select from the first text node of `startNeedle`'s block to `endOff` of `endNeedle`'s block. */
function selectAcrossScript(startNeedle: string, endNeedle: string, endOff: number): string {
  return `(function(){
    var blocks = document.querySelectorAll('${BODY} .tugx-md-block');
    function firstText(pred){
      for (var i = 0; i < blocks.length; i++){
        if ((blocks[i].textContent || "").indexOf(pred) !== -1){
          var w = document.createTreeWalker(blocks[i], NodeFilter.SHOW_TEXT);
          for (var n = w.nextNode(); n !== null; n = w.nextNode()){ if ((n.textContent||"").replace(/^\\s+|\\s+$/g,"").length>0) return n; }
        }
      }
      return null;
    }
    var a = firstText(${JSON.stringify(startNeedle)});
    var b = firstText(${JSON.stringify(endNeedle)});
    if (a === null || b === null) return "__NOT_FOUND__";
    var range = document.createRange();
    range.setStart(a, 0); range.setEnd(b, Math.min(${endOff}, (b.textContent || "").length));
    var t = range.toString(); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    return t;
  })()`;
}

/**
 * Select from the first non-empty text node of `startNeedle` in cell A
 * to `endOff` of `endNeedle`'s node in cell B — a range that spans the
 * two separate responder scopes (cross-cell, [P09]/[#step-10]).
 */
function selectAcrossCellsScript(startNeedle: string, endNeedle: string, endOff: number): string {
  return `(function(){
    function firstTextIn(testid, needle){
      var root = document.querySelector('[data-testid="'+testid+'"]');
      if (root === null) return null;
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (var n = w.nextNode(); n !== null; n = w.nextNode()){
        if ((n.textContent||"").indexOf(needle) !== -1 && (n.textContent||"").replace(/^\\s+|\\s+$/g,"").length>0) return n;
      }
      return null;
    }
    var a = firstTextIn("gallery-transcript-copy-cell-a", ${JSON.stringify(startNeedle)});
    var b = firstTextIn("gallery-transcript-copy-cell-b", ${JSON.stringify(endNeedle)});
    if (a === null || b === null) return "__NOT_FOUND__";
    var range = document.createRange();
    range.setStart(a, 0); range.setEnd(b, Math.min(${endOff}, (b.textContent || "").length));
    var t = range.toString(); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    return t;
  })()`;
}

/** Select the whole `.tugx-md-block` containing `needle` in cell C (rich content). */
function selectRichBlockScript(needle: string): string {
  return `(function(){
    var blocks = document.querySelectorAll('[data-testid="gallery-transcript-copy-cell-c"] .tugx-md-block');
    for (var i = 0; i < blocks.length; i++){
      if ((blocks[i].textContent || "").indexOf(${JSON.stringify(needle)}) !== -1){
        var range = document.createRange();
        range.selectNodeContents(blocks[i]);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        return range.toString();
      }
    }
    return "__NOT_FOUND__";
  })()`;
}

/** Select the rendered display-math element in cell C (KaTeX). */
const SELECT_DISPLAY_MATH = `(function(){
  var root = '[data-testid="gallery-transcript-copy-cell-c"] ';
  var el = document.querySelector(root + '.katex-display') || document.querySelector(root + '.tugx-katex--display');
  if (el === null) return "__NO_KATEX__";
  var range = document.createRange(); range.selectNodeContents(el);
  var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  return range.toString();
})()`;

async function copyAndRead(app: Awaited<ReturnType<typeof launchTugApp>>): Promise<string> {
  await app.evalJS<unknown>(`(window.__copied = [], true)`);
  await app.nativeKey("c", ["cmd"]);
  await app.waitForCondition<boolean>(
    `Array.isArray(window.__copied) && window.__copied.length > 0`,
    { timeoutMs: 3000 },
  );
  return app.evalJS<string>(`window.__copied[window.__copied.length - 1]`);
}

describe.skipIf(!SHOULD_RUN)(
  "AT0188: real transcript COPY handler reconstructs markdown to the clipboard",
  () => {
    test(
      "inline-accurate, atomic-widen, and cross-block selections via ⌘C",
      async () => {
        const app = await launchTugApp({ testName: "at0188-transcript-copy-wiring" });
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
          await app.waitForCondition<boolean>(
            `(function(){
              var md = document.querySelector('${BODY} .tugx-md-block');
              var tool = document.querySelector('${BODY} [data-slot="tool-block-chrome"]');
              return md !== null && tool !== null;
            })()`,
            { timeoutMs: 6000 },
          );

          const captureReady = await app.evalJS<boolean>(INSTALL_CLIPBOARD_CAPTURE);
          expect(captureReady).toBe(true);

          await app.nativeClickAtElement(`${BODY} .tugx-md-block`);
          await app.waitForCondition<boolean>(`window.__tug.getHasFocus() === true`, { timeoutMs: 2000 });

          // The probe runs the production resolver over the current
          // selection deterministically; the ⌘C smoke below confirms the
          // same resolver is reached through the real handler.
          const probe = `(function(){ var f = window.__tugCopyWiringProbe; return f ? f() : "__NO_PROBE__"; })()`;

          // ---- inline-accurate: "First" (rendered 0..5) → exactly "First" ----
          const plain1 = await app.evalJS<string>(selectInBlockScript("First paragraph", 0, 5));
          expect(plain1).toBe("First");
          const copied1 = await app.evalJS<string>(probe);
          expect(copied1).toBe("First"); // narrowed, NOT the whole paragraph

          // ---- full construct: selecting all of "bold" keeps its markers
          // (markers aren't text — stripping them yields exactly "bold") ----
          const plainBold = await app.evalJS<string>(selectExactNodeScript("bold"));
          expect(plainBold).toBe("bold");
          const copiedBold = await app.evalJS<string>(probe);
          expect(copiedBold).toBe("**bold**");

          // ---- partial construct (the reported bug): selecting PART of a
          // bold span must copy exactly the selected text — never the whole
          // construct, never its unselected leading chars or markers ----
          const plainPartial = await app.evalJS<string>(`(function(){
            var root = document.querySelector('${BODY}');
            var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (var n=w.nextNode(); n!==null; n=w.nextNode()){
              if ((n.textContent||'').trim() === 'bold'){
                var range = document.createRange();
                range.setStart(n, 1); range.setEnd(n, 4); // "old" inside "bold"
                var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
                return range.toString();
              }
            }
            return "__NOT_FOUND__";
          })()`);
          expect(plainPartial).toBe("old");
          const copiedPartial = await app.evalJS<string>(probe);
          // Styling applied to EXACTLY the selected text: bold wraps "old"
          // (not "bold"), no unselected "b", no leading "First paragraph…".
          expect(copiedPartial).toBe("**old**");

          // ---- cross-block: styling is applied across the span, clipped to
          // the selection — paragraph A keeps its `**bold**`, paragraph B's
          // selected head comes through, and nothing outside the range. ----
          await app.evalJS<string>(
            selectAcrossScript("First paragraph", "Closing paragraph", 8),
          );
          const copied2 = await app.evalJS<string>(probe);
          expect(copied2).toContain("**bold**"); // inline styling preserved
          expect(copied2).toContain("Closing"); // paragraph B's selected head
          expect(copied2).not.toContain("Faraday"); // never content above the selection

          // ---- multi-block message: one paragraph must NOT overshoot ----
          // Clean range over the whole first paragraph's text node.
          const plainMultiClean = await app.evalJS<string>(
            selectInBlockScript("Alpha paragraph one only", 0, 25),
          );
          expect(plainMultiClean).toBe("Alpha paragraph one only.");
          const copiedMultiClean = await app.evalJS<string>(probe);
          expect(copiedMultiClean).toBe("Alpha paragraph one only.");

          // Range that ends at the START of the heading two blocks down
          // (the real-world overshoot shape) must still copy only the
          // content actually covered — never the rule or the heading.
          const overshoot = `(function(){
            var blocks = document.querySelectorAll('${BODY} .tugx-md-block');
            function firstText(pred){ for (var i=0;i<blocks.length;i++){ if((blocks[i].textContent||'').indexOf(pred)!==-1){ var w=document.createTreeWalker(blocks[i],NodeFilter.SHOW_TEXT); for(var n=w.nextNode();n!==null;n=w.nextNode()){ if((n.textContent||'').replace(/^\\s+|\\s+$/g,'').length>0) return n; } } } return null; }
            var a = firstText("Alpha paragraph one only");
            var b = firstText("Beta Heading");
            if (a===null || b===null) return "__NOT_FOUND__";
            var range = document.createRange();
            range.setStart(a, 0); range.setEnd(b, 0);
            var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
            return "ok";
          })()`;
          await app.evalJS<string>(overshoot);
          const copiedOvershoot = await app.evalJS<string>(probe);
          // Exactly the selected paragraph — no rule, no heading below it.
          expect(copiedOvershoot).toBe("Alpha paragraph one only.");

          // ---- ⌘C smoke: the real handler routes the same resolver to the clipboard ----
          await app.evalJS<string>(selectExactNodeScript("bold"));
          const viaCmdC = await copyAndRead(app);
          expect(viaCmdC).toBe("**bold**");

          // ---- dual-format clipboard ([#step-11]): the same ⌘C write
          // also exposes text/html, the markdown re-rendered. text/plain
          // stays the markdown; text/html carries the rendered emphasis. ----
          await app.waitForCondition<boolean>(
            `Array.isArray(window.__copiedHtml) && window.__copiedHtml.length > 0`,
            { timeoutMs: 3000 },
          );
          const copiedHtml = await app.evalJS<string>(
            `window.__copiedHtml[window.__copiedHtml.length - 1]`,
          );
          expect(copiedHtml).toContain("<strong>bold</strong>");

          // ---- cross-cell ([#step-10]): a selection spanning the two
          // separate responder scopes (cell A's closing paragraph → cell
          // B's first paragraph) copies BOTH cells' content, in document
          // order, via the real ⌘C gesture. No host handler — the
          // first-responder cell's handler reads the live cross-cell
          // selection and the range-global serializer reconstructs it. ----
          const crossSel = await app.evalJS<string>(
            selectAcrossCellsScript("Closing paragraph", "Alpha paragraph one only", 25),
          );
          expect(crossSel).toContain("Closing paragraph after the tool call.");
          expect(crossSel).toContain("Alpha paragraph one only.");
          const crossCopied = await copyAndRead(app);
          expect(crossCopied).toContain("Closing paragraph after the tool call.");
          expect(crossCopied).toContain("Alpha paragraph one only.");
          // Document order: cell A's content precedes cell B's.
          expect(crossCopied.indexOf("Closing paragraph")).toBeLessThan(
            crossCopied.indexOf("Alpha paragraph"),
          );
          // Separate blocks → blank-line separated, not run together.
          expect(crossCopied).toContain(
            "Closing paragraph after the tool call.\n\nAlpha paragraph one only.",
          );

          // ---- rich-content source fidelity ([#step-12]): selecting a
          // rendered construct copies its MARKDOWN SOURCE, never the
          // rendered glyph/highlight text. ----

          // Heading → `### …`.
          await app.evalJS<string>(selectRichBlockScript("Rich Heading"));
          expect(await app.evalJS<string>(probe)).toBe("### Rich Heading");

          // List → one `- ` line per item.
          await app.evalJS<string>(selectRichBlockScript("List item alpha"));
          const listMd = await app.evalJS<string>(probe);
          expect(listMd).toContain("- List item alpha");
          expect(listMd).toContain("- List item beta");

          // Fenced code → fence-wrapped source (not the highlighted spans).
          await app.evalJS<string>(selectRichBlockScript("const y = 1"));
          const codeMd = await app.evalJS<string>(probe);
          expect(codeMd).toContain("```");
          expect(codeMd).toContain("const y = 1;");

          // Inline math → `$…$` from the KaTeX TeX annotation, inline in
          // the surrounding prose (wait for KaTeX to render first).
          await app.waitForCondition<boolean>(
            `document.querySelector('[data-testid="gallery-transcript-copy-cell-c"] .katex') !== null`,
            { timeoutMs: 8000 },
          );
          await app.evalJS<string>(selectRichBlockScript("Inline math"));
          expect(await app.evalJS<string>(probe)).toBe(
            "Inline math $E = mc^2$ in a sentence.",
          );

          // Display math → `$$…$$`, never the rendered MathML/glyph text.
          const dispSel = await app.evalJS<string>(SELECT_DISPLAY_MATH);
          expect(dispSel).not.toBe("__NO_KATEX__");
          expect(await app.evalJS<string>(probe)).toBe("$$x = a + b$$");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0188-transcript-copy-wiring] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
