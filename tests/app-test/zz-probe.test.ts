/**
 * zz-probe.test.ts — TEMPORARY. Measures Enter-to-editor latency in the
 * Snippets list.
 *
 * @covers tugdeck/src/components/lens/sections/snippets-section.tsx
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const LIST = ".lens-content .lens-snippets-list";
const ROWS = `${LIST} .tug-list-view-cell`;

const SNIPPETS = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`,
  text: `row-${i} snippet handle with some **markdown** text in it`,
}));

function priorCardDeck() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-accordion",
        title: "Accordion",
        closable: true,
      },
    ],
    panes: [
      {
        id: "pA",
        position: { x: 60, y: 60 },
        size: { width: 520, height: 420 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "pA",
    imposition: { kind: "one-up", lens: "right" },
    hasFocus: true,
  };
}

/** Install timing instrumentation: keydown → editor DOM → CM6 caret. */
const INSTALL = `(function(){
  window.__probe = { marks: [] };
  var mark = function(name){ window.__probe.marks.push({ name: name, t: performance.now() }); };
  window.__probeMark = mark;
  window.addEventListener('keydown', function(e){
    mark('win-keydown:' + e.key);
  }, true);
  document.addEventListener('keydown', function(e){
    mark('doc-keydown:' + e.key);
  }, true);
  var mo = new MutationObserver(function(records){
    for (var r of records) {
      for (var n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        if (n.matches('.snippet-editor') || n.querySelector('.snippet-editor')) mark('editor-dom');
        if (n.matches('.cm-editor') || n.querySelector('.cm-editor')) mark('cm-editor');
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  var raf = function(){
    if (document.querySelector('.snippet-editor .cm-content') !== null) {
      mark('cm-content-painted');
      var focused = document.activeElement;
      mark('active=' + (focused ? (focused.className || focused.tagName) : 'none'));
      return;
    }
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  return null;
})()`;

describe.skipIf(!SHOULD_RUN)("zz-probe — snippet open latency", () => {
  test(
    "measure Enter to editor",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-zzprobe-"));
      const snippetsPath = join(filesDir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "zz-probe",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROWS)}).length >= ${SNIPPETS.length}`,
            { timeoutMs: 8_000 },
          );
          // Land the cursor on a snippet row.
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `document.querySelector('${LIST} .tug-list-row[data-selected="true"]') !== null`,
            { timeoutMs: 4_000 },
          );

          await app.evalJS<null>(INSTALL);
          await app.nativeKey("Return");
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') !== null`,
            { timeoutMs: 10_000 },
          );
          // Let the raf marks land.
          await app.waitForCondition<boolean>(
            `window.__probe.marks.some(function(m){ return m.name.indexOf('active=') === 0; })`,
            { timeoutMs: 5_000 },
          );
          const marks = await app.evalJS<Array<{ name: string; t: number }>>(
            `window.__probe.marks`,
          );
          const base = marks[0]?.t ?? 0;
          console.log(
            "PROBE-1 " +
              marks.map((m) => `${m.name}@${(m.t - base).toFixed(1)}`).join(" "),
          );

          // Second open (warm) — close this one first with Escape.
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') === null`,
            { timeoutMs: 6_000 },
          );
          await app.evalJS<null>(INSTALL);
          await app.nativeKey("Return");
          await app.waitForCondition<boolean>(
            `window.__probe.marks.some(function(m){ return m.name.indexOf('active=') === 0; })`,
            { timeoutMs: 10_000 },
          );
          const marks2 = await app.evalJS<Array<{ name: string; t: number }>>(
            `window.__probe.marks`,
          );
          const base2 = marks2[0]?.t ?? 0;
          console.log(
            "PROBE-2 " +
              marks2
                .map((m) => `${m.name}@${(m.t - base2).toFixed(1)}`)
                .join(" "),
          );
          expect(marks.length).toBeGreaterThan(0);
        } finally {
          await app.close();
        }
      } finally {
        rmSync(filesDir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
