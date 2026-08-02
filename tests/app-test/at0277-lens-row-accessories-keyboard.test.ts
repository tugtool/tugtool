/**
 * at0277-lens-row-accessories-keyboard.test.ts — the Lens's row accessories and
 * its tile grids answer the keyboard.
 *
 * ## What this gates
 *
 * Three surfaces in the Lens were reachable only by pointer, which under the
 * focus language means they did not exist at all for a keyboard user:
 *
 *  - **A snippet row's copy / delete buttons.** They render inside the list's
 *    per-row focus mode, so authoring them into a focus group is what makes
 *    ArrowRight on the cursor row descend onto them. The row's trailing cluster
 *    already reveals itself for the keyboard cursor, so the affordance is on
 *    screen before the descend arrives.
 *  - **A row's slot picker.** Same authoring, on the Cards rows'
 *    numbered slots. The deck always stands under an arrangement, so the picker
 *    is always there; a multi-slot kind is what gives it more than one position.
 *  - **The Layouts tiles.** The CARDS axis lays four options out two to a row.
 *    A group whose cursor is a 1D run walks them in DOM order, so Down from
 *    "One Up" landed on "Two Up" — the tile to its RIGHT. Down must mean down.
 *
 * The first two also pin a boundary the accessories created: the snippets list
 * declares `commitOnEnter="act"` (Enter opens the snippet), and a row that
 * gains a focusable must not let the generic Enter-descends-a-navigable-row
 * default quietly take Enter over. Right descends; Enter still opens.
 *
 * Two more rules ride the same drive, both about the marks staying honest:
 * the snippets list's SELECTION follows its cursor (`selectionFollowsCursor`),
 * so the fill and the cursor bar are never on two different rows; and once the
 * key view has descended into a row, Right / Left walk the row's accessories
 * and Left off the first one ascends — the arrow that entered walks.
 *
 * @covers tugdeck/src/components/lens/slot-picker.tsx
 * @covers tugdeck/src/components/lens/sections/layouts-section.tsx
 * @covers tugdeck/src/components/lens/sections/snippets-section.tsx
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/spatial-order.ts
 * @covers tugdeck/src/components/tugways/tug-slot-layout.tsx
 * @covers tugdeck/src/components/tugways/tug-slot.tsx
 * @covers tugdeck/src/components/tugways/use-item-group-keyboard.ts
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const SNIPPETS_LIST = ".lens-content .lens-snippets-list";
const SNIPPETS_KBD = `${SNIPPETS_LIST}[data-key-view-kbd]`;
const CURSOR_ROW = `${SNIPPETS_LIST} [data-key-cursor]`;
const KIND_GROUP = '[data-testid="lens-layouts-kind"]';

const SNIPPETS = Array.from({ length: 4 }, (_, i) => ({
  id: `s${i}`,
  text: `row-${i} snippet handle`,
}));

function priorCardDeck() {
  return {
    // A Text card, so the Lens's Cards band has a row to descend into once
    // an imposition turns its slot picker on.
    cards: [{ id: "A", componentId: "text", title: "File", closable: true }],
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
    // Stated, not inherited: the arrangement is deck state, and a seed that
    // omits it takes whatever arrangement the machine's own saved deck was
    // left in — which decides where the CARDS cursor starts, and so whether
    // section C's walk begins where it says it does.
    imposition: { kind: "one-up", lens: "right" },
    hasFocus: true,
  };
}

/** The `aria-label` of whatever currently holds the keyboard key view. */
async function kbdLabel(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector('.lens-content [data-key-view-kbd]');
      return el === null ? null : el.getAttribute('aria-label');
    })()`,
  );
}

/** Tab until `selector` holds the keyboard key view; throws if it never does. */
async function tabUntilKbd(app: App, selector: string): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const on = await app.evalJS<boolean>(
      `document.querySelector(${JSON.stringify(`${selector}[data-key-view-kbd]`)}) !== null`,
    );
    if (on) return;
    await app.nativeKey("Tab");
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error(`Tab never reached ${selector}`);
}

describe.skipIf(!SHOULD_RUN)("at0277 — Lens row accessories answer the keyboard", () => {
  test(
    "Right descends onto a snippet row's buttons and onto a slot, and the Layouts tiles walk as a grid",
    async () => {
      const tugbankPath = mkTempTugbank();
      const filesDir = mkdtempSync(join(tmpdir(), "tug-at0277-"));
      const snippetsPath = join(filesDir, "snippets.json");
      const filePath = join(filesDir, "fixture.txt");
      writeFileSync(filePath, "alpha meridian\n");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0277-lens-row-accessories-keyboard",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          // `document.hasFocus()` — which this test waits on — is tied by
          // WebKit to application activation, so this one launches
          // foreground.
          foreground: true,
        });
        try {
          await app.seedDeckState({
            state: priorCardDeck(),
            cardStates: {
              A: { content: { path: filePath, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
            },
            focusCardId: "A",
          });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          await app.dispatchControlAction("focus-lens");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(CURSOR_ROW)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // ---- A0. Selection follows the cursor: arrowing down carries the
          // fill with it, so the lit row and the row the section verbs act on
          // are never two different rows.
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(
              `${SNIPPETS_LIST} [data-key-cursor][data-selected="true"]`,
            )}) !== null`,
            { timeoutMs: 3_000 },
          );
          // Exactly one row wears the fill — the selection MOVED with the
          // cursor rather than a second row lighting up beside the first.
          expect(
            await app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(
                `${SNIPPETS_LIST} .tug-list-view-cell[data-selected="true"]`,
              )}).length`,
            ),
          ).toBe(1);

          // ---- A. ArrowRight descends onto the cursor row's Copy button.
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('.lens-content [data-key-view-kbd]');
              return el !== null && el.getAttribute('aria-label') === 'Copy snippet';
            })()`,
            { timeoutMs: 3_000 },
          );

          // The row's trailing cluster is genuinely on screen, not a ring on a
          // zero-width slot — the descend has to land somewhere the eye can see.
          expect(
            await app.evalJS<number>(
              `Math.round(document.querySelector('.lens-content [data-key-view-kbd]').getBoundingClientRect().width)`,
            ),
          ).toBeGreaterThan(0);

          // The list does not go dark behind the descend. Both marks say where
          // the accessory came from — the container ring says which list, the
          // cursor bar says which row — and losing them left the ring on a lone
          // button with nothing around it to say what it belonged to. The ring
          // is the list's own inset overlay (`ringPlacement="inset"`), lit by
          // the engine's `data-key-within` on the container it descended from.
          const descended = await app.evalJS<{
            within: boolean;
            ring: number;
            cursorRows: number;
          }>(
            `(function(){
              var list = document.querySelector(${JSON.stringify(SNIPPETS_LIST)});
              var ring = list === null ? null : list.querySelector('.tug-list-view-ring');
              return {
                within: list !== null && list.hasAttribute('data-key-within'),
                ring: ring === null
                  ? 0
                  : parseFloat(getComputedStyle(ring, '::before').borderTopWidth),
                cursorRows: document.querySelectorAll(${JSON.stringify(CURSOR_ROW)}).length,
              };
            })()`,
          );
          expect(descended.within).toBe(true);
          expect(descended.ring).toBeGreaterThan(0);
          expect(descended.cursorRows).toBe(1);

          // ---- A1. Inside the row the horizontal arrows walk the accessories:
          // the arrow that entered the row is the arrow that walks it, and Left
          // off the first one is the exit.
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('.lens-content [data-key-view-kbd]');
              return el !== null && el.getAttribute('aria-label') === 'Delete snippet';
            })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("ArrowLeft");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('.lens-content [data-key-view-kbd]');
              return el !== null && el.getAttribute('aria-label') === 'Copy snippet';
            })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("ArrowLeft");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );

          // ---- B. Escape also ascends, and Enter still OPENS the snippet
          // rather than descending onto the accessory.
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('.lens-content [data-key-view-kbd]');
              return el !== null && el.getAttribute('aria-label') === 'Copy snippet';
            })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("Enter");
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') !== null`,
            { timeoutMs: 4_000 },
          );
          await app.nativeKey("Escape");
          await app.waitForCondition<boolean>(
            `document.querySelector('.snippet-editor .cm-content') === null`,
            { timeoutMs: 4_000 },
          );

          // ---- C. The Layouts CARDS axis walks as the grid it is drawn as.
          await tabUntilKbd(app, KIND_GROUP);
          const cursorValue = `(function(){
            var el = document.querySelector('${KIND_GROUP} [data-key-cursor]');
            return el === null ? null : el.getAttribute('data-radio-value');
          })()`;
          await app.waitForCondition<boolean>(
            `(${cursorValue}) === 'one-up'`,
            { timeoutMs: 3_000 },
          );
          // Right is the neighbor ACROSS the row; Down is the tile BELOW it —
          // the whole point, and the case a 1D cursor got wrong.
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(${cursorValue}) === 'two-up'`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("ArrowLeft");
          await app.waitForCondition<boolean>(
            `(${cursorValue}) === 'one-up'`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("ArrowDown");
          await app.waitForCondition<boolean>(
            `(${cursorValue}) === 'three-up'`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("ArrowUp");
          await app.waitForCondition<boolean>(
            `(${cursorValue}) === 'one-up'`,
            { timeoutMs: 3_000 },
          );

          // ---- D. Commit "Two Up". The deck always stands under an
          // arrangement, so the picker is already there; committing a second
          // slot is what gives the row two positions to walk between.
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(${cursorValue}) === 'two-up'`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey(" ");
          await app.waitForCondition<boolean>(
            `document.querySelector('.lens-content [data-testid="lens-slot-picker"]') !== null`,
            { timeoutMs: 4_000 },
          );

          // ---- E. Descend into a Cards file row. Its accessories run leading
          // to trailing — the close box first, then the slots — so the first
          // Right lands on the close box and the second reaches slot 1.
          await tabUntilKbd(app, ".lens-content .lens-cards-list");
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('.lens-content [data-key-view-kbd]');
              return el !== null && (el.getAttribute('aria-label') || '').indexOf('Close ') === 0;
            })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('.lens-content [data-key-view-kbd]');
              return el !== null && el.getAttribute('aria-label') === 'Put at position 1';
            })()`,
            { timeoutMs: 3_000 },
          );
          // Inside the row's scope the slots are a run walked left→right in the
          // order the arrangement draws them. Right walks it, and so does Tab —
          // the row scope bounds both planes, so either reaches every slot.
          await app.nativeKey("ArrowRight");
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector('.lens-content [data-key-view-kbd]');
              return el !== null && el.getAttribute('aria-label') === 'Put at position 2';
            })()`,
            { timeoutMs: 3_000 },
          );
          await app.nativeKey("ArrowLeft");
          await new Promise<void>((r) => setTimeout(r, 200));
          expect(await kbdLabel(app)).toBe("Put at position 1");
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
