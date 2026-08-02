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
 *   2. The container declares `data-tug-carrying` while the carry is in flight
 *      and drops it at the settle — the cross-module contract the focus marks'
 *      stand-down and the selection suppression both hang off — and the
 *      movement cursor's bar is actually unpainted for the length of the
 *      gesture and painted again after it.
 *   3. After the drop: the group headers swap, the runs are still whole and
 *      contiguous, and no card was fronted.
 *   4. `cardsGroupOrder` persisted, so the arrangement survives a relaunch.
 *   5. The keyboard LANDED on what was set down: the list holds the key view
 *      and the movement cursor is on the moved group's header. A carry cancels
 *      its own pointerdown and swallows its trailing click, so without an
 *      explicit landing it is the one gesture in the list that leaves the
 *      keyboard nowhere.
 *
 * Then it does it again, the other way, with no wait in between, and that is
 * two gates at once. The FLIP holds a latch that refuses a new carry until the
 * gesture ends, so a second drag engaging at all says the first one ended —
 * and it ending IMMEDIATELY says the end is tied to the commit rather than to
 * the settle animation. A surface that made the keyboard, the latch, and the
 * committed state wait for motion would fail here, in a window that is not in
 * front and plays no motion at all.
 *
 * That second carry reads `data-dragging` and NOT the inline transform, which
 * is what it used to read. A transform can be left over from the previous
 * carry, so a drag that never engaged read as engaged — which is how a settle
 * that never completed passed here for a while. The attribute is written by
 * this carry and cleared when it ends, so it cannot be inherited.
 *
 * @covers tugdeck/src/components/lens/block-reorder.ts
 * @covers tugdeck/src/components/lens/sections/cards-section.tsx
 * @covers tugdeck/src/components/lens/sections/cards-groups.ts
 * @covers tugdeck/src/components/lens/sections/cards-data-source.ts
 * @covers tugdeck/src/components/tugways/tug-list-view.css
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
            carrying: string | null;
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
              carrying: document
                .querySelector(".lens-cards-list-wrap")
                .getAttribute("data-tug-carrying"),
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
          // The container declares the carry while it is in flight. That
          // attribute is what the surfaces inside read to stand their own
          // marks down — the focus ring, so the drop caret is the only
          // edge-drawn mark in the box, and the text selection the press would
          // otherwise be extending. It is a contract between modules, so it is
          // asserted here rather than left to the two stylesheets that consume
          // it, and it must be gone once the drag is.
          expect(carried.carrying).toBe("true");

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
          expect(
            await app.evalJS<string | null>(
              `document.querySelector(".lens-cards-list-wrap").getAttribute("data-tug-carrying")`,
            ),
          ).toBeNull();

          const persisted = tugbankRead<string[]>(
            tugbankPath,
            "dev.tugtool.lens",
            "cardsGroupOrder",
          );
          expect(persisted?.value?.[0]).toBe("tools");

          // The keyboard is on what was set down. A press on a row normally
          // places it there itself, and a carry suppresses both halves of that
          // — the arm cancels the pointerdown, the drop swallows the trailing
          // click — so without an explicit landing a carry is the one gesture
          // in this list that leaves the keyboard nowhere. Both registers are
          // checked, because they are two: the list holds the key view, and
          // the movement cursor is on the header of the group that moved.
          const landed = await app.evalJS<{
            listHasKeyView: boolean;
            cursorGroup: string | null;
          }>(`(function(){
            var list = document.querySelector(".lens-cards-list");
            var cursor = document.querySelector(
              ".lens-cards-list .tug-list-view-cell[data-key-cursor]",
            );
            var header = cursor === null
              ? null
              : cursor.querySelector(".lens-cards-header");
            return {
              listHasKeyView: list !== null
                && list.hasAttribute("data-key-view-kbd"),
              cursorGroup: header === null
                ? null
                : header.getAttribute("data-lens-group"),
            };
          })()`);
          expect(landed.listHasKeyView).toBe(true);
          expect(landed.cursorGroup).toBe("tools");

          // ---- And again, the other way. -----------------------------------
          //
          // Not a repetition for its own sake: the in-drag latch has to have
          // been released for this to engage at all, and a drag that quietly
          // refuses to start says nothing in the console. No dwell — the
          // gesture ends when the commit lands, not when the settle finishes
          // playing, so the surface is armed again immediately.
          const engagedAgain = await app.evalJS<{
            moved: boolean;
            cursorBar: string | null;
          }>(`(function(){
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
            // The dragging attribute, not the inline transform: a transform
            // can be left over from the PREVIOUS carry's settle, which would
            // make a drag that never engaged read as engaged. The attribute is
            // set by this carry and cleared by its settle, so it can only be
            // true while a carry is actually live.
            var moved = Array.from(
              document.querySelectorAll('[data-lens-group-run="files"]'),
            ).every(function (el) {
              return el.getAttribute("data-dragging") === "true";
            });
            var cursor = document.querySelector(
              ".lens-cards-list .tug-list-view-cell[data-key-cursor]",
            );
            var out = {
              moved: moved,
              cursorBar: cursor === null
                ? null
                : getComputedStyle(cursor, "::before").backgroundColor,
            };
            window.dispatchEvent(new PointerEvent("pointerup", opts(to)));
            return out;
          })()`);
          expect(engagedAgain.moved).toBe(true);
          // The movement cursor's bar is DOWN for the length of the carry. The
          // cursor is on the Tools header the first drop landed it on and the
          // carry is of the Files run, so a bar left up would be a stripe of
          // accent on a row that has nothing to do with where this will land —
          // indistinguishable, at a glance, from the drop caret it shares a hue
          // with. Read as painted color rather than as an attribute: the
          // suppression is a stylesheet's, and what it has to achieve is that
          // nothing is drawn.
          expect(engagedAgain.cursorBar).toBe("rgba(0, 0, 0, 0)");

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

          // And the bar is back, on what was just set down. The stand-down is
          // for the length of the gesture and nothing longer — a suppression
          // that outlived its carry would leave the keyboard invisible, which
          // is a worse bug than the one it was fixing.
          const barAfter = await app.evalJS<string | null>(`(function(){
            var cursor = document.querySelector(
              ".lens-cards-list .tug-list-view-cell[data-key-cursor]",
            );
            if (cursor === null) return null;
            var header = cursor.querySelector(".lens-cards-header");
            if (header === null
              || header.getAttribute("data-lens-group") !== "files") {
              return "cursor is not on the moved group";
            }
            return getComputedStyle(cursor, "::before").backgroundColor;
          })()`);
          expect(barAfter).not.toBeNull();
          expect(barAfter).not.toBe("rgba(0, 0, 0, 0)");
          expect(barAfter).not.toBe("cursor is not on the moved group");

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
