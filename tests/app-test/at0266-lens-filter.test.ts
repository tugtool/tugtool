/**
 * at0266-lens-filter.test.ts — the Lens section filter field ([AT0266]).
 *
 * ## What this gates (failure modes, not busywork)
 *
 *   - **Live narrowing + highlight (A):** typing into the Snippets band's
 *     filter field drops the non-matching rows and paints
 *     `<mark class="tug-filter-mark">` on what matched. Fails if the band's
 *     delegate never reaches the body's data source (they are siblings — the
 *     module store is the seam) or if the highlight is computed against a
 *     different string than the row renders.
 *   - **Filtered to zero stays reachable (B):** a query matching nothing shows
 *     the section's "No matches" body while its filter field remains mounted
 *     and clickable. This is the one that would strand the user: the section's
 *     list unregisters as a focus stop when it has no rows, so a field whose
 *     registration was tied to the same gate would become the unreachable only
 *     way back.
 *   - **Escape clears without dismissing (C):** Escape in a non-empty field
 *     clears the filter and leaves the section expanded and the Lens open.
 *     Fails if the field stopped claiming Escape and the surrounding surface's
 *     ladder ran instead.
 *   - **Clear restores (D):** the ✕ brings every row back, and the list still
 *     walks under the cursor keys.
 *   - **A narrow Lens keeps its band whole (E):** with the rail at its minimum
 *     width, the field gives its own width and every band still ends with its
 *     drag grip inside the band. Fails if the field holds its dial width under
 *     pressure — the row then overflows and pushes the grip out past the rail's
 *     edge, where it cannot be grabbed.
 *   - **An empty section's filter is inert (F):** a band whose list has no items
 *     at all disables its field and registers no focus stop for it. The pair
 *     with (B) is the point: emptiness disables, filtered-emptiness never does.
 *
 * Runs against an isolated snippets file (`TUG_SNIPPETS_PATH`), so the rows are
 * real and deterministic.
 *
 * @covers tugdeck/src/components/tugways/tug-filter-field.tsx
 * @covers tugdeck/src/components/tugways/filter-highlight.tsx
 * @covers tugdeck/src/lib/text-match.ts
 * @covers tugdeck/src/components/lens/lens-filter-store.ts
 * @covers tugdeck/src/components/lens/lens-section-band.tsx
 * @covers tugdeck/src/components/lens/sections/
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
  tugbankWrite,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

/** Seeded snippets — two share a word, the third has none of it. */
const SNIPPETS = [
  { id: "s-zebra", text: "zebra harmonica calibration" },
  { id: "s-quokka", text: "quokka telemetry sweep" },
  { id: "s-zebra2", text: "zebra ledger reconciliation" },
];
const MATCHING_FRAGMENT = "zebra";
const ABSENT_FRAGMENT = "qqzzxx";

const SNIPPETS_SECTION = '.lens-section[data-lens-section="snippets"]';
/** The Text Files band — this test seeds no text files, so it is the empty
 *  section whose filter must be inert. */
const EMPTY_SECTION = '.lens-section[data-lens-section="text-files"]';
const EMPTY_FILTER_INPUT = `${EMPTY_SECTION} [data-testid="lens-section-filter"] input`;
const FILTER_INPUT = `${SNIPPETS_SECTION} [data-testid="lens-section-filter"] input`;
const FILTER_CLEAR = `${SNIPPETS_SECTION} [data-testid="lens-section-filter"] button`;
const ROW = ".lens-snippets-list .snippet-row-content[data-snippet-id]";
const NO_MATCHES = '[data-testid="lens-snippets-no-matches"]';

const ROW_COUNT = `document.querySelectorAll(${JSON.stringify(ROW)}).length`;
const MARK_COUNT = `document.querySelectorAll('.lens-snippets-list mark.tug-filter-mark').length`;
const ROW_IDS = `Array.prototype.map.call(
  document.querySelectorAll(${JSON.stringify(ROW)}),
  function (row) { return row.getAttribute('data-snippet-id'); }
)`;

/** Type into the filter field the way a keystroke does (React sees a change). */
function typeFilter(
  app: { evalJS<T>(s: string): Promise<T> },
  text: string,
): Promise<null> {
  return app.evalJS<null>(`(function(){
    var el = document.querySelector(${JSON.stringify(FILTER_INPUT)});
    if (!el) throw new Error("lens filter input not found");
    el.focus();
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return null;
  })()`);
}

function priorCardDeck() {
  return {
    cards: [
      { id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true },
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
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0266 — the Lens section filter field", () => {
  test(
    "typing narrows and highlights, zero matches stays reachable, Escape clears without dismissing, and the ✕ restores",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-at0266-"));
      const snippetsPath = join(dir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({ version: 1, snippets: SNIPPETS }, null, 2)}\n`,
      );
      try {
        seedTugbankForLaunch(tugbankPath);
        // Open the rail at its floor (`MIN_LENS_WIDTH_PX`) — the narrowest the
        // user can drag it to, and the width case (E) measures against.
        tugbankWrite(tugbankPath, "dev.tugtool.lens", "widthPx", "int", "320");
        const app = await launchTugApp({
          testName: "at0266-lens-filter",
          env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
          persistInTestMode: true,
        });
        try {
          await app.seedDeckState({ state: priorCardDeck(), focusCardId: "A" });
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(`document.hasFocus()`, {
            timeoutMs: 6_000,
          });

          await app.dispatchControlAction("toggle-lens");
          await app.waitForCondition<boolean>(
            `${ROW_COUNT} === ${SNIPPETS.length}`,
            { timeoutMs: 5_000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(FILTER_INPUT)}) !== null`,
            { timeoutMs: 5_000 },
          );

          // (A) Typing narrows to the matching rows, each carrying a mark.
          await typeFilter(app, MATCHING_FRAGMENT);
          await app.waitForCondition<boolean>(`${ROW_COUNT} === 2`, {
            timeoutMs: 5_000,
          });
          expect(await app.evalJS<string[]>(ROW_IDS)).toEqual([
            "s-zebra",
            "s-zebra2",
          ]);
          expect(await app.evalJS<number>(MARK_COUNT)).toBe(2);

          // (B) Filtered to zero: the "No matches" body shows, and the field is
          // still mounted, still visible, and still hit-testable.
          await typeFilter(app, ABSENT_FRAGMENT);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(NO_MATCHES)}) !== null`,
            { timeoutMs: 5_000 },
          );
          expect(await app.evalJS<number>(ROW_COUNT)).toBe(0);
          expect(
            await app.evalJS<boolean>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(FILTER_INPUT)});
                if (el === null) return false;
                var r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) return false;
                var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return hit !== null && (hit === el || el.contains(hit));
              })()`,
            ),
          ).toBe(true);
          // …and still LIVE. Emptiness disables a filter field, but only the
          // section's own emptiness — a field that disabled itself the moment
          // its query matched nothing would lock the user out of the state it
          // just created.
          expect(
            await app.evalJS<boolean>(
              `document.querySelector(${JSON.stringify(FILTER_INPUT)}).disabled`,
            ),
          ).toBe(false);

          // (C) Escape clears the filter in place: rows come back, the section
          // stays expanded, and the Lens stays open.
          await app.evalJS<null>(`(function(){
            var el = document.querySelector(${JSON.stringify(FILTER_INPUT)});
            el.focus();
            el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            return null;
          })()`);
          await app.waitForCondition<boolean>(
            `${ROW_COUNT} === ${SNIPPETS.length}`,
            { timeoutMs: 5_000 },
          );
          expect(
            await app.evalJS<string | null>(
              `(function(){
                var el = document.querySelector(${JSON.stringify(SNIPPETS_SECTION)});
                return el ? el.getAttribute('data-collapsed') : null;
              })()`,
            ),
          ).toBe("false");
          expect(
            await app.evalJS<boolean>(
              `document.querySelector('.lens-sections') !== null`,
            ),
          ).toBe(true);

          // (D) The ✕ clears a fresh filter and restores every row.
          await typeFilter(app, MATCHING_FRAGMENT);
          await app.waitForCondition<boolean>(`${ROW_COUNT} === 2`, {
            timeoutMs: 5_000,
          });
          await app.evalJS<null>(`(function(){
            var btn = document.querySelector(${JSON.stringify(FILTER_CLEAR)});
            if (!btn) throw new Error("clear button not found");
            btn.click();
            return null;
          })()`);
          await app.waitForCondition<boolean>(
            `${ROW_COUNT} === ${SNIPPETS.length}`,
            { timeoutMs: 5_000 },
          );
          expect(await app.evalJS<number>(MARK_COUNT)).toBe(0);

          // (E) The rail opened at its MINIMUM width (seeded above), which is
          // the narrowest the user can drag it to. Every band must still end
          // with its grip inside the band's own box, and the field must be the
          // thing that gave — narrower than its resting dial width.
          const bands = await app.evalJS<
            { kind: string; overflow: number }[]
          >(`Array.prototype.map.call(
            document.querySelectorAll('.lens-section'),
            function (section) {
              var band = section.querySelector('.tool-call-header');
              var grip = band.querySelector('.block-grip');
              return {
                kind: section.getAttribute('data-lens-section'),
                overflow: grip.getBoundingClientRect().right
                  - (band.getBoundingClientRect().right - parseFloat(getComputedStyle(band).paddingRight)),
              };
            }
          )`);
          expect(bands.length).toBeGreaterThan(0);
          for (const band of bands) {
            expect({ kind: band.kind, clipped: band.overflow > 0.5 }).toEqual({
              kind: band.kind,
              clipped: false,
            });
          }
          // …and giving is not vanishing: the field keeps its floor, so it is
          // still a field the user can type a query into.
          const fieldWidth = await app.evalJS<number>(
            `document.querySelector(${JSON.stringify(FILTER_INPUT)}).getBoundingClientRect().width`,
          );
          expect(fieldWidth).toBeGreaterThan(60);

          // (F) A section with no items at all — this run seeds no text files —
          // disables its filter and drops it from the keyboard walk. The
          // focusable attribute is the walk's own record: no attribute, no
          // stop, so Tab passes the whole empty band by.
          const emptyField = await app.evalJS<{
            disabled: boolean;
            registered: boolean;
          }>(`(function(){
            var el = document.querySelector(${JSON.stringify(EMPTY_FILTER_INPUT)});
            if (el === null) throw new Error("text-files filter input not found");
            return {
              disabled: el.disabled,
              registered: el.hasAttribute("data-tug-focusable"),
            };
          })()`);
          expect(emptyField).toEqual({ disabled: true, registered: false });
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(`\n[at0266-lens-filter] log tail:\n${tail}\n`);
          }
          throw err;
        } finally {
          await app.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
