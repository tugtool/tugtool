/**
 * at0187-transcript-copy-markdown.test.ts — transcript COPY reconstructs
 * real markdown for a DOM selection ([P03], Step 6/7).
 *
 * ## What this proves
 *
 * Copying a selection in an assistant row must yield honest markdown,
 * not `Selection.toString()` plain text. The reconstruction's pure
 * arithmetic (slice-range, stitch) is covered by `bun:test`
 * (`selection-roundtrip.test.ts`); the DOM-dependent half —
 * `range-to-blocks` mapping a live `Range` to the touched
 * `.tugx-md-block` wrappers (via the Step 6 `data-md-start`/`-end`
 * attribution) and slicing their source — can only run against a real
 * DOM. That is what this audits ([Q02] pure/DOM split).
 *
 * ## How
 *
 * The `gallery-transcript-markdown` card renders the transcript's exact
 * markdown pairing (`TugMarkdownBlock` + `dev-card-transcript-code-body`)
 * over a complete sample, and exposes the *production*
 * `selectionToTranscriptMarkdown` through `window.__tugTranscriptCopyProbe`.
 * We:
 *
 *   1. Assert the rendered wrappers carry `data-md-start`/`-end` (Step 6).
 *   2. Select a sub-range inside one paragraph block; assert the probe
 *      returns that block's RAW markdown (`**bold**`, `` `inline code` ``,
 *      `$E = mc^2$`) — syntax the rendered text (`Selection.toString()`)
 *      does NOT contain. Block-level widening ([Q02]): a partial in-block
 *      selection copies the whole block.
 *   3. Select across the heading + paragraph; assert the result carries
 *      both the `#` heading source and the paragraph source, stitched.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const CARD = `[data-card-id="A"]`;
const SCROLL_COLUMN = `${CARD} [data-testid="gallery-transcript-markdown"]`;

describe.skipIf(!SHOULD_RUN)(
  "AT0187: transcript COPY reconstructs markdown from a DOM selection",
  () => {
    test(
      "partial + cross-block selections yield raw markdown, not plain text",
      async () => {
        const app = await launchTugApp({
          testName: "at0187-transcript-copy-markdown",
        });
        try {
          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: "A",
                  componentId: "gallery-transcript-markdown",
                  title: "Transcript MD",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 760, height: 560 },
                  cardIds: ["A"],
                  activeCardId: "A",
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          // Wait for the markdown to render AND the Step 6 attribution to
          // land on the wrappers AND the probe to be installed.
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('${SCROLL_COLUMN} .tugx-md-block[data-md-start]');
              return el !== null
                && typeof window.__tugTranscriptCopyProbe !== "undefined";
            })()`,
            { timeoutMs: 6000 },
          );

          // ---- Step 6 attribution present on rendered wrappers ----
          const attribution = await app.evalJS<{
            count: number;
            firstStart: string | null;
            firstEnd: string | null;
          }>(
            `(function(){
              var els = document.querySelectorAll('${SCROLL_COLUMN} .tugx-md-block[data-md-start]');
              var first = els[0];
              return {
                count: els.length,
                firstStart: first ? first.getAttribute("data-md-start") : null,
                firstEnd: first ? first.getAttribute("data-md-end") : null,
              };
            })()`,
          );
          expect(attribution.count).toBeGreaterThan(3);
          expect(Number.isFinite(Number(attribution.firstStart))).toBe(true);
          expect(Number.isFinite(Number(attribution.firstEnd))).toBe(true);

          // ---- Partial selection inside the inline-vocabulary paragraph ----
          //
          // Select from the start of that block's first text node to an
          // offset partway through it — a mid-block selection. Block-level
          // attribution must widen it to the whole paragraph.
          const partial = await app.evalJS<{
            ok: boolean;
            plain: string;
            markdown: string | null;
          }>(
            `(function(){
              var blocks = document.querySelectorAll('${SCROLL_COLUMN} .tugx-md-block');
              var target = null;
              for (var i = 0; i < blocks.length; i++) {
                if ((blocks[i].textContent || "").indexOf("full inline vocabulary") !== -1) {
                  target = blocks[i]; break;
                }
              }
              if (target === null) return { ok: false, plain: "", markdown: null };
              var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
              var first = walker.nextNode();
              if (first === null) return { ok: false, plain: "", markdown: null };
              // End partway through the block's text run.
              var endNode = first, endOffset = Math.min(8, (first.textContent || "").length);
              var range = document.createRange();
              range.setStart(first, 0);
              range.setEnd(endNode, endOffset);
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              return {
                ok: true,
                plain: sel.toString(),
                markdown: window.__tugTranscriptCopyProbe.run(),
              };
            })()`,
          );
          expect(partial.ok).toBe(true);
          expect(partial.markdown).not.toBeNull();
          const md = partial.markdown ?? "";
          // Raw markdown syntax the rendered text never contains.
          expect(md).toContain("**bold**");
          expect(md).toContain("`inline code`");
          expect(md).toContain("~~strikethrough~~");
          expect(md).toContain("$E = mc^2$");
          // The widened whole-block slice carries far more than the
          // tiny rendered substring the user actually highlighted.
          expect(md.length).toBeGreaterThan(partial.plain.length);
          // Plain-text of the selection has none of the markup.
          expect(partial.plain).not.toContain("**");

          // ---- Cross-block selection: heading 1 + the paragraph ----
          const cross = await app.evalJS<{ ok: boolean; markdown: string | null }>(
            `(function(){
              var blocks = document.querySelectorAll('${SCROLL_COLUMN} .tugx-md-block');
              var heading = null, para = null;
              for (var i = 0; i < blocks.length; i++) {
                var t = blocks[i].textContent || "";
                if (heading === null && t.indexOf("The Quadratic Formula") !== -1) heading = blocks[i];
                if (para === null && t.indexOf("full inline vocabulary") !== -1) para = blocks[i];
              }
              if (heading === null || para === null) return { ok: false, markdown: null };
              function firstText(el){ return document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(); }
              var hNode = firstText(heading), pNode = firstText(para);
              if (hNode === null || pNode === null) return { ok: false, markdown: null };
              var range = document.createRange();
              range.setStart(hNode, 0);
              range.setEnd(pNode, Math.min(5, (pNode.textContent || "").length));
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              return { ok: true, markdown: window.__tugTranscriptCopyProbe.run() };
            })()`,
          );
          expect(cross.ok).toBe(true);
          const crossMd = cross.markdown ?? "";
          expect(crossMd).toContain("# Heading 1");
          expect(crossMd).toContain("**bold**");
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0187-transcript-copy-markdown] log tail:\n${tail}\n`,
            );
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
