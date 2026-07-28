/**
 * TEMPORARY tuning probe — shoots the Lens's one-line lists at every
 * `rowStriping` rung and at two text sizes, so the strengths can be compared
 * side by side. Deleted after the tuning session.
 *
 * @covers tugdeck/src/components/lens/lens-section-band.tsx
 */

import { describe, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const SNIPPETS = [
  { id: "s-a", text: "walk me through whether 2027 is a prime number" },
  { id: "s-b", text: "run a bash command: find . -type f | head -300" },
  { id: "s-c", text: "render the quadratic formula, with a description" },
  { id: "s-d", text: "list out maxwell's equations in derivative form" },
  { id: "s-e", text: "count the number of lines of code with tokei" },
  { id: "s-f", text: "make a task list to write a c program" },
  { id: "s-g", text: "ask me some questions to guide the writing process" },
  { id: "s-h", text: "ask me a single question about the codebase" },
];

const ROWS = ".lens-snippets-list .tug-list-row";

/** The strength rungs, mirrored from `list-view-striping.ts`. */
const RUNGS: ReadonlyArray<readonly [string, string | null]> = [
  ["off", null],
  ["faint", "2%"],
  ["subtle", "4%"],
  ["medium", "7%"],
  ["strong", "11%"],
];

describe.skipIf(!SHOULD_RUN)("tmp shot", () => {
  test(
    "shot",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-tmp-shot-"));
      const snippetsPath = join(dir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      const files = ["notes.md", "patch.txt", "zshrc.txt", "scratch.md"].map(
        (name) => {
          const p = join(dir, name);
          writeFileSync(p, `${name} contents\n`);
          return { name, path: p };
        },
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "tmp-shot",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          persistInTestMode: true,
        });
        try {
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });
          await app.seedDeckState({
            state: {
              cards: files.map((f, i) => ({
                id: `T${i}`,
                componentId: "text",
                title: f.name,
                closable: true,
              })),
              panes: [
                {
                  id: "pA",
                  position: { x: 60, y: 60 },
                  size: { width: 520, height: 420 },
                  cardIds: files.map((_, i) => `T${i}`),
                  activeCardId: "T0",
                  title: "",
                  acceptsFamilies: ["maker"],
                },
              ],
              activePaneId: "pA",
              hasFocus: true,
            },
            cardStates: Object.fromEntries(
              files.map((f, i) => [
                `T${i}`,
                {
                  content: {
                    path: f.path,
                    anchor: { line: 1, ch: 0 },
                    scrollTop: 0,
                  },
                },
              ]),
            ),
            focusCardId: "T0",
          });
          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(ROWS)}).length >= 3`,
            { timeoutMs: 8_000 },
          );
          await new Promise<void>((r) => setTimeout(r, 800));

          for (const [name, alpha] of RUNGS) {
            await app.evalJS<void>(
              `(function(){
                document.querySelectorAll('.lens-oneline-list').forEach(function(el){
                  if (${JSON.stringify(alpha)} === null) {
                    el.removeAttribute('data-row-striping');
                    el.setAttribute('data-row-separator', 'on');
                  } else {
                    el.setAttribute('data-row-striping', 'on');
                    el.setAttribute('data-row-separator', 'none');
                    el.style.setProperty('--tugx-list-view-stripe-color',
                      'color-mix(in srgb, var(--tugx-list-view-stripe-tint) ' +
                      ${JSON.stringify(alpha ?? "0%")} + ', transparent)');
                  }
                });
              })()`,
            );
            await new Promise<void>((r) => setTimeout(r, 250));
            const bg = await app.evalJS<string>(
              `getComputedStyle(document.querySelector(
                 '.lens-snippets-list .tug-list-view-cell[data-row-parity="odd"]'
               )).backgroundColor`,
            );
            const shot = await app.screenshot();
            copyFileSync(shot.path, `/tmp/lens-stripe-${name}.png`);
            console.log(`[tmp] /tmp/lens-stripe-${name}.png  bg=${bg}`);
          }

          // Back to `subtle`, then sweep the text size.
          await app.evalJS<void>(
            `document.querySelectorAll('.lens-oneline-list').forEach(function(el){
               el.style.setProperty('--tugx-list-view-stripe-color',
                 'color-mix(in srgb, var(--tugx-list-view-stripe-tint) 4%, transparent)');
             })`,
          );
          for (const px of [11, 12, 13]) {
            await app.evalJS<void>(
              `document.querySelectorAll('.lens-oneline-list').forEach(function(el){
                 el.style.setProperty('--tugx-list-row-font-size', '${px}px');
               })`,
            );
            await new Promise<void>((r) => setTimeout(r, 250));
            const heights = await app.evalJS<string>(
              `(function(){
                 function h(sel){
                   var el = document.querySelector(sel);
                   return el === null ? -1 : Math.round(el.getBoundingClientRect().height * 10) / 10;
                 }
                 var row = document.querySelector('.lens-text-files-list .tug-list-row');
                 var kids = row === null ? [] : Array.from(row.children).map(function(k){
                   return k.className + ':' + Math.round(k.getBoundingClientRect().height);
                 });
                 return 'snippet=' + h('.lens-snippets-list .tug-list-view-cell') +
                        ' textfile=' + h('.lens-text-files-list .tug-list-view-cell') +
                        ' grip=' + h('.lens-snippets-list .block-grip') +
                        ' | ' + kids.join(' ');
               })()`,
            );
            const shot = await app.screenshot();
            copyFileSync(shot.path, `/tmp/lens-text-${px}.png`);
            console.log(`[tmp] /tmp/lens-text-${px}.png  ${heights}`);
          }
        } finally {
          await app.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    180_000,
  );
});
