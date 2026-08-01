/**
 * at0313-lens-cards-group-reorder.test.ts — a Cards group is carried by its
 * header, and its rows go with it.
 *
 * ## What this gates
 *
 * The Cards section reorders at two granularities on one shared FLIP: a pane
 * row within its group, and a whole GROUP by its header. The second is the one
 * this file is about, and it rests on a claim that only the real DOM can
 * settle — that `useBlockReorder` carries a *block*, meaning every element
 * sharing a `data-lens-group-run` key, not the single element the hook was
 * originally written for. Get that wrong and the header slides alone while its
 * rows stay nailed where they were, which is a silent, purely visual failure:
 * the committed order would still be right, and no assertion on the store
 * would notice.
 *
 * So it asserts, in order:
 *
 *   1. **Mid-carry**: every element of the dragged run is translated by the
 *      same amount, and the group being passed has opened a gap. This is the
 *      only assertion that can see a header travelling alone — after the drop
 *      the committed order looks correct either way.
 *   2. After the drop: the group headers swap, the runs are still whole and
 *      contiguous, and no card was fronted.
 *   3. `cardsGroupOrder` persisted, so the arrangement survives a relaunch.
 *
 * Then it does it again, the other way, and that repeat is its own gate: the
 * FLIP holds a latch that refuses a new carry until the settle finishes, and
 * only a second drag can tell you the latch came back. It dwells first, because
 * a backgrounded window throttles DOM timers to about a second and stretches
 * the settle well past its authored 200ms — the wait is the harness's, not the
 * surface's.
 *
 * @covers tugdeck/src/components/lens/block-reorder.ts
 * @covers tugdeck/src/components/lens/sections/cards-section.tsx
 * @covers tugdeck/src/components/lens/sections/cards-groups.ts
 * @covers tugdeck/src/components/lens/sections/cards-data-source.ts
 * @covers tugdeck/src/lib/lens-store/
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const LIST = ".lens-cards-list";
const RUN_ELS = `${LIST} [data-lens-group-run]`;
const headerSel = (group: string): string =>
  `${LIST} .lens-cards-header[data-lens-group="${group}"]`;

/**
 * One text card and one settings card, each in its own pane — the smallest
 * deck that renders two groups. Files leads Tools by declaration, which is the
 * arrangement the drag is about to overturn.
 */
function twoGroupDeck() {
  const cards = [
    { id: "A", componentId: "text", title: "alpha.txt", closable: true },
    { id: "B", componentId: "settings", title: "Settings", closable: true },
  ];
  return {
    cards,
    panes: cards.map((c, i) => ({
      id: `p${i + 1}`,
      position: { x: 40 + i * 24, y: 40 + i * 24 },
      size: { width: 560, height: 520 },
      cardIds: [c.id],
      activeCardId: c.id,
      title: "",
      acceptsFamilies: ["standard"],
    })),
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** The group each row in the list belongs to, top to bottom. */
async function runOrder(app: App): Promise<string[]> {
  return app.evalJS<string[]>(
    `Array.from(document.querySelectorAll(${JSON.stringify(RUN_ELS)}))
      .map(function(el){ return el.getAttribute("data-lens-group-run"); })`,
  );
}

describe.skipIf(!SHOULD_RUN)("at0313 — a Cards group carries its rows", () => {
  test(
    "a group header carries its whole run, persists, and the surface re-arms",
    async () => {
      const tugbankPath = mkTempTugbank();
      try {
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0313-lens-cards-group-reorder",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.seedDeckState({ state: twoGroupDeck(), focusCardId: "A" });
          await app.dispatchControlAction("toggle-lens");
          await app.waitForCondition<boolean>(
            `document.querySelectorAll(${JSON.stringify(RUN_ELS)}).length === 4`,
            { timeoutMs: 15_000 },
          );
          // Header, row, header, row — Files first, as declared.
          expect(await runOrder(app)).toEqual([
            "files",
            "files",
            "tools",
            "tools",
          ]);

          // Carrying a group must not front a card — same rule as a pane
          // row's carry, and the same trailing click to swallow.
          const activeBefore = await app.evalJS<string | null>(
            `window.__tug.getActiveCardId()`,
          );

          // ONE carry, measured mid-flight and then dropped.
          //
          // Mid-flight is the only moment that can see the block: if the hook
          // carried the header element alone, the committed order would still
          // come out right and every post-drop assertion would still pass —
          // the rows would simply have sat still while the header slid over
          // them. So the transforms are read with the carry engaged, and the
          // same gesture is then released to commit.
          const carried = await app.evalJS<{
            tools: string[];
            filesShifted: boolean;
          }>(`(function(){
            var header = document.querySelector(${JSON.stringify(headerSel("tools"))});
            var files = document.querySelector(${JSON.stringify(headerSel("files"))});
            if (header === null || files === null) throw new Error("no headers");
            var r = header.getBoundingClientRect();
            var x = r.left + r.width / 2;
            var y = r.top + r.height / 2;
            var opts = function (cy) {
              return { bubbles: true, cancelable: true, clientX: x, clientY: cy, pointerId: 1, button: 0 };
            };
            // Travel to just inside the Files run's top edge — what makes
            // Tools' target index 0 and opens the gap above Files.
            var to = files.getBoundingClientRect().top + 2;
            header.dispatchEvent(new PointerEvent("pointerdown", opts(y)));
            window.dispatchEvent(new PointerEvent("pointermove", opts(to)));
            var runOf = function (group) {
              return Array.from(
                document.querySelectorAll('[data-lens-group-run="' + group + '"]'),
              );
            };
            var out = {
              tools: runOf("tools").map(function (el) { return el.style.transform; }),
              filesShifted: runOf("files").every(function (el) {
                return el.style.transform.indexOf("translateY") !== -1;
              }),
            };
            window.dispatchEvent(new PointerEvent("pointerup", opts(to)));
            return out;
          })()`);
          // Both elements of the Tools run — the header AND the Settings row —
          // are translated, by the same amount. One transform here, or two
          // different ones, is the header travelling alone.
          expect(carried.tools).toHaveLength(2);
          expect(carried.tools[0]).toContain("translateY");
          expect(carried.tools[1]).toBe(carried.tools[0]);
          // And the group it is passing has opened a gap for it.
          expect(carried.filesShifted).toBe(true);

          await app.waitForCondition<boolean>(
            `(function(){
              var els = Array.from(document.querySelectorAll(${JSON.stringify(RUN_ELS)}));
              return els.length === 4
                && els[0].getAttribute("data-lens-group-run") === "tools";
            })()`,
            { timeoutMs: 8_000 },
          );
          // The Settings row landed WITH its header — the runs are still whole
          // and contiguous, just swapped.
          expect(await runOrder(app)).toEqual([
            "tools",
            "tools",
            "files",
            "files",
          ]);

          expect(await app.evalJS<string | null>(`window.__tug.getActiveCardId()`))
            .toBe(activeBefore);

          const persisted = tugbankRead<string[]>(
            tugbankPath,
            "dev.tugtool.lens",
            "cardsGroupOrder",
          );
          expect(persisted?.value?.[0]).toBe("tools");

          // ---- And again, the other way. -----------------------------------
          //
          // Not a repetition for its own sake: the in-drag latch has to have
          // been released for this to engage at all, and a drag that quietly
          // refuses to start says nothing in the console.
          // Past the settle, throttling included — see the header note.
          await app.evalJS<null>(
            `(window.__at0313Ready = Date.now() + 1500, null)`,
          );
          await app.waitForCondition<boolean>(
            `Date.now() > window.__at0313Ready`,
            { timeoutMs: 5_000 },
          );
          const engagedAgain = await app.evalJS<boolean>(`(function(){
            var header = document.querySelector(${JSON.stringify(headerSel("files"))});
            var tools = document.querySelector(${JSON.stringify(headerSel("tools"))});
            if (header === null || tools === null) throw new Error("no headers");
            var r = header.getBoundingClientRect();
            var x = r.left + r.width / 2;
            var y = r.top + r.height / 2;
            var opts = function (cy) {
              return { bubbles: true, cancelable: true, clientX: x, clientY: cy, pointerId: 1, button: 0 };
            };
            var to = tools.getBoundingClientRect().top + 2;
            header.dispatchEvent(new PointerEvent("pointerdown", opts(y)));
            window.dispatchEvent(new PointerEvent("pointermove", opts(to)));
            var moved = Array.from(
              document.querySelectorAll('[data-lens-group-run="files"]'),
            ).every(function (el) {
              return el.style.transform.indexOf("translateY") !== -1;
            });
            window.dispatchEvent(new PointerEvent("pointerup", opts(to)));
            return moved;
          })()`);
          expect(engagedAgain).toBe(true);

          await app.waitForCondition<boolean>(
            `(function(){
              var els = Array.from(document.querySelectorAll(${JSON.stringify(RUN_ELS)}));
              return els.length === 4
                && els[0].getAttribute("data-lens-group-run") === "files";
            })()`,
            { timeoutMs: 8_000 },
          );
          expect(await runOrder(app)).toEqual([
            "files",
            "files",
            "tools",
            "tools",
          ]);
        } finally {
          await app.close();
        }
      } finally {
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
