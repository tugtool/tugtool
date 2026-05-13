/**
 * at0069-outer-transcript-first-paint.test.ts — regression gate for
 * outer-transcript first-paint accuracy.
 *
 * # What this proves
 *
 * AT0061 gates the END-state of region-scroll anchor restore: after a
 * settle window, the scrollTop and anchor land within tolerance of the
 * saved value. It does NOT gate first-paint accuracy — the
 * MutationObserver-driven retry loop refines across multiple commits
 * while the heightIndex populates from cell measurements, so the user
 * sees a `scrollTop=0` initial frame followed by estimated-then-refined
 * hops.
 *
 * Saving the live `heightIndex` snapshot into `meta.cellHeights`
 * closes this. At restore the TugListView hydrates its `HeightIndex`
 * from this array BEFORE first paint, so the synchronous anchor stash
 * + companion apply effect compute the exact saved scrollTop and write
 * it before the first paint.
 *
 * AT0069 pins this stronger contract: the FIRST observed scrollTop
 * after the page reloads is within sub-cell tolerance of the saved
 * scrollTop. No `0`-frame. No estimated-then-refined sequence.
 *
 * # How
 *
 *   1. Mount the `gallery-list-view-scroll-keyed` fixture (same as
 *      AT0061). Scroll to a known mid-list position.
 *   2. Save (via `appReload`'s flush path). Read the on-disk bag;
 *      assert `meta.cellHeights` was captured.
 *   3. Install a MutationObserver BEFORE re-seeding the deck on
 *      the reloaded page, watching for the scrollport to appear and
 *      recording its initial `scrollTop`.
 *   4. Re-seed with the on-disk bag.
 *   5. Assert the FIRST observed scrollTop is within tolerance of
 *      the saved value.
 *
 * # Tuglaws referenced
 *
 *  - [L23] Preserve user-visible state across teardown-and-replay.
 *    Strengthens this from "eventually settles" to "first paint
 *    reproduces the saved state, including the layout that made it
 *    user-visible."
 *  - [L02] Saved geometry flows through `useSyncExternalStore` via
 *    `useSavedRegionScroll`.
 *  - [L03] Hydration runs in `useLayoutEffect` so first paint sees
 *    the hydrated heightIndex.
 *  - [L06] `scrollTop` writes are DOM, not React state.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
  tugbankRead,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 60_000;

const SCROLL_KEY = "gallery-list-view-scroll";
const SCROLL_TARGET_PX = 600;
const SCROLL_TOLERANCE_PX = 8;

function scrollContainerSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-scroll-key="${SCROLL_KEY}"]`;
}

describe.skipIf(!SHOULD_RUN)(
  "AT0069: outer transcript first-paint accuracy with saved geometry",
  () => {
    test(
      "after appReload, the scrollport's FIRST observable scrollTop matches the saved value within tolerance",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0069-outer-transcript-first-paint",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);

          // -------- Phase 1: mount, settle, scroll, save.

          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: "A",
                  componentId: "gallery-list-view-scroll-keyed",
                  title: "List",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 600, height: 480 },
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

          // Wait for the scrollport to have real scrollable content.
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              return el !== null && el.scrollHeight > el.clientHeight + 100;
            })()`,
            { timeoutMs: 5000 },
          );

          // Scroll to a known mid-list offset, then wait for the
          // anchor + cellHeights attribute to reflect it.
          await app.evalJS<unknown>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              el.scrollTop = ${SCROLL_TARGET_PX};
              el.dispatchEvent(new Event('scroll', { bubbles: true }));
              return null;
            })()`,
          );

          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              var raw = el && el.getAttribute("data-tug-scroll-state");
              if (raw === null) return false;
              try {
                var parsed = JSON.parse(raw);
                return parsed && parsed.anchor &&
                  Array.isArray(parsed.cellHeights) &&
                  parsed.cellHeights.length > 0;
              } catch (_) { return false; }
            })()`,
            { timeoutMs: 2000 },
          );

          const preReload = await app.evalJS<{
            scrollTop: number;
            cellHeightsLength: number;
          }>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              var parsed = JSON.parse(el.getAttribute("data-tug-scroll-state"));
              return {
                scrollTop: el.scrollTop,
                cellHeightsLength: parsed.cellHeights.length,
              };
            })()`,
          );

          // -------- Phase 2: reload.

          await app.appReload();

          // Verify the on-disk bag carries cellHeights — the
          // geometry capture that makes first-paint accuracy
          // possible.
          const onDisk = tugbankRead<{
            regionScroll?: Record<
              string,
              { x: number; y: number; meta?: { cellHeights?: number[]; anchor?: unknown; scrollHeight?: number } }
            >;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", "A");
          expect(onDisk).not.toBeNull();
          if (onDisk === null) throw new Error("bag missing on disk");
          const bagValue = onDisk.value;
          expect(bagValue.regionScroll).toBeDefined();
          const entry = bagValue.regionScroll?.[SCROLL_KEY];
          expect(entry).toBeDefined();
          expect(entry!.meta).toBeDefined();
          expect(Array.isArray(entry!.meta!.cellHeights)).toBe(true);
          expect(entry!.meta!.cellHeights!.length).toBe(preReload.cellHeightsLength);

          // -------- Phase 3: install observer, re-seed, capture
          //          first-paint scrollTop.

          await app.evalJS<unknown>(
            `(function(){
              if (typeof window.__at0069 !== "undefined") {
                throw new Error("at0069 observer state already exists");
              }
              window.__at0069 = { firstScrollTop: -1, scrollEvents: [] };
              var rootObserver = new MutationObserver(function(_records) {
                var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
                if (el === null) return;
                rootObserver.disconnect();
                window.__at0069.firstScrollTop = el.scrollTop;
                el.addEventListener('scroll', function(){
                  window.__at0069.scrollEvents.push(el.scrollTop);
                }, { passive: true });
              });
              rootObserver.observe(document.body, { subtree: true, childList: true });
              return null;
            })()`,
          );

          const cardStates: Record<string, unknown> = { A: bagValue };
          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: "A",
                  componentId: "gallery-list-view-scroll-keyed",
                  title: "List",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 600, height: 480 },
                  cardIds: ["A"],
                  activeCardId: "A",
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            cardStates,
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(window.__at0069 && window.__at0069.firstScrollTop >= 0)`,
            { timeoutMs: 5000 },
          );

          // Bun-side grace — evaluateJavaScript doesn't await
          // Promises, so a setTimeout-only settle pause runs here
          // not on the page.
          await new Promise<void>((resolve) => setTimeout(resolve, 150));

          const observed = await app.evalJS<{
            firstScrollTop: number;
            scrollEvents: number[];
          }>(`window.__at0069`);

          // -------- Assertion: first observable scrollTop matches.

          expect(
            Math.abs(observed.firstScrollTop - preReload.scrollTop),
          ).toBeLessThanOrEqual(SCROLL_TOLERANCE_PX);

          // -------- Assertion: no large jumps away from saved.
          //
          // The MutationObserver-driven refinement loop in
          // `card-host.tsx` may still fire one or two near-saved
          // settles, but it must not produce any scroll event
          // landing more than tolerance away from the saved value
          // (which would indicate the heightIndex hydration didn't
          // work and the apply effect computed against an empty
          // index).
          const jumps = observed.scrollEvents.filter(
            (top) =>
              Math.abs(top - preReload.scrollTop) > SCROLL_TOLERANCE_PX,
          );
          expect(jumps).toEqual([]);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0069-outer-transcript-first-paint] log tail:\n${tail}\n`,
            );
          }
          throw err;
        } finally {
          await app.close();
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
