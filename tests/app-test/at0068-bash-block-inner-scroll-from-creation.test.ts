/**
 * at0068-bash-block-inner-scroll-from-creation.test.ts — regression
 * gate for the inner-scroll mount-in-saved-state contract.
 *
 * # What this proves
 *
 * A previous observer-channel design had the virtualized inner
 * scroller created at `scrollTop=0` on first paint, then a
 * MutationObserver-driven region-scroll apply found the new
 * `[data-tug-scroll-key]` element and wrote the saved `scrollTop`. A
 * second paint landed the scroll at the saved position. The user saw
 * the scroller jump from 0 to the saved value — wild scrolling.
 *
 * AT0068 pins the contract: the scroller is CREATED at the saved
 * `scrollTop`. `appendVirtualizedBody` reads
 * `useSavedRegionScroll(scrollKey)?.y` (threaded down from
 * TerminalBlock's React shell via `renderTerminal`'s
 * `initialScrollTop` parameter) and writes it into the scroller
 * synchronously in the same `useLayoutEffect` call that appends the
 * element to the DOM. No post-mount apply needed.
 *
 * # How
 *
 *   1. Mount the `gallery-bash-mount-in-saved-state` fixture. The
 *      block is over fold threshold and the virtualized scroller is
 *      built.
 *   2. Click the fold cue to expand. The inner scroller is now in
 *      the DOM.
 *   3. Scroll the inner scroller to a known position; record
 *      `scrollTop`.
 *   4. `app.appReload()`. The bag the previous session wrote to disk
 *      should contain `bag.regionScroll[<scrollKey>].y` equal to the
 *      recorded position.
 *   5. On the new page, install a `MutationObserver` against the
 *      document subtree from before the deck mounts. As soon as a
 *      `[data-tug-scroll-key]` element appears, record its FIRST
 *      observable `scrollTop` value.
 *   6. Assert the recorded first `scrollTop` matches the saved value
 *      (within the same small tolerance AT0061 uses for sub-pixel
 *      rounding). A `0` reading would prove the scroller was
 *      created at the default position and then jumped.
 *
 * # Tuglaws referenced
 *
 *  - [L23] state preservation across teardown-and-replay.
 *  - [L02] saved state enters React through `useSyncExternalStore`-
 *    backed accessors at render time; for the inner scroll path the
 *    `useSavedRegionScroll` value is consumed at imperative-renderer
 *    creation, before paint.
 *  - [L06] scroll position is appearance — DOM `scrollTop`, not React
 *    state. The apply collapses into the creation site so no
 *    post-mount DOM write is needed for inner scrollers.
 *  - [L19] component authoring guide — "Restoring saved state at
 *    mount" pattern.
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

const TOOL_USE_ID = "toolu_mount_in_saved_state_e8";
// TerminalBlock derives the inner-scroll key as
// `${componentStatePreservationKey}/term-scroll`; the BashToolBlock
// passes `${toolUseId}-body` as the preservation key.
const SCROLL_KEY = `${TOOL_USE_ID}-body/term-scroll`;
const TARGET_SCROLL_TOP = 240;
const SCROLL_TOLERANCE_PX = 8;

function cardSelector(cardId: string): string {
  return `[data-card-id="${cardId}"]`;
}

function terminalOuterSelector(cardId: string): string {
  return `${cardSelector(cardId)} [data-slot="terminal-body"]`;
}

function foldCueSelector(cardId: string): string {
  // BashToolBlock uses `embedded={true}` on TerminalBlock, which
  // portals the fold cue into the wrapper chrome's actions slot —
  // so the cue lives at the card level, OUTSIDE the
  // `data-slot="terminal-body"` outer's subtree.
  return `${cardSelector(cardId)} [data-slot="terminal-fold-cue"]`;
}

function innerScrollerSelector(): string {
  return `[data-tug-scroll-key="${SCROLL_KEY}"]`;
}

describe.skipIf(!SHOULD_RUN)(
  "AT0068: BashToolBlock inner scroller is created at its saved scrollTop",
  () => {
    test(
      "after Developer > Reload, the inner scroller's first observable scrollTop matches the saved value",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0068-bash-block-inner-scroll-from-creation",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);

          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: "A",
                  componentId: "gallery-bash-mount-in-saved-state",
                  title: "Bash",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 540 },
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

          // -------- Phase 1: expand, scroll, record.

          // Wait for the block default to be applied, then click the
          // fold cue to engage the virtualized scroller.
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(terminalOuterSelector("A"))});
              return el !== null && el.getAttribute("data-collapsed") === "true";
            })()`,
            { timeoutMs: 5000 },
          );

          await app.evalJS<unknown>(
            `(function(){
              var cue = document.querySelector(${JSON.stringify(foldCueSelector("A"))});
              if (cue === null) {
                throw new Error("no terminal-fold-cue inside terminal outer");
              }
              cue.click();
              return null;
            })()`,
          );

          // Inner scroller appears once expanded.
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(innerScrollerSelector())});
              if (el === null) return false;
              // scrollHeight must exceed clientHeight by at least a
              // viewport — otherwise our target scrollTop would clamp
              // to 0.
              return el.scrollHeight > el.clientHeight + 100;
            })()`,
            { timeoutMs: 2000 },
          );

          await app.evalJS<unknown>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(innerScrollerSelector())});
              el.scrollTop = ${TARGET_SCROLL_TOP};
              el.dispatchEvent(new Event('scroll', { bubbles: true }));
              return null;
            })()`,
          );

          const preReloadScrollTop = await app.evalJS<number>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(innerScrollerSelector())});
              return el ? el.scrollTop : -1;
            })()`,
          );
          // Verify the write took (may clamp slightly under scroll
          // padding, but should be near the target).
          expect(Math.abs(preReloadScrollTop - TARGET_SCROLL_TOP)).toBeLessThanOrEqual(
            SCROLL_TOLERANCE_PX,
          );

          // -------- Phase 2: reload.

          await app.appReload();

          const onDiskBag = tugbankRead<{
            components?: Record<string, { collapsed?: boolean }>;
            regionScroll?: Record<string, { x: number; y: number }>;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", "A");
          expect(onDiskBag).not.toBeNull();
          if (onDiskBag === null) throw new Error("bag missing on disk");
          const bagValue = onDiskBag.value;
          expect(bagValue.regionScroll).toBeDefined();
          if (bagValue.regionScroll === undefined) {
            throw new Error("regionScroll axis missing on disk");
          }
          const savedScroll = bagValue.regionScroll[SCROLL_KEY];
          expect(savedScroll).toBeDefined();
          expect(Math.abs(savedScroll.y - preReloadScrollTop)).toBeLessThanOrEqual(
            SCROLL_TOLERANCE_PX,
          );

          // -------- Phase 3: install MutationObserver BEFORE the
          // deck mounts. Record the very first `scrollTop` we can
          // observe on the inner scroller — the value the scroller
          // is created at, before any post-mount apply could fire.

          await app.evalJS<unknown>(
            `(function(){
              if (typeof window.__at0068Observed !== "undefined") {
                throw new Error("observer state already exists");
              }
              window.__at0068Observed = {
                firstScrollTop: -1,
                ts: -1,
                scrollEvents: [],
              };
              var rootObserver = new MutationObserver(function(_records) {
                var el = document.querySelector(${JSON.stringify(innerScrollerSelector())});
                if (el === null) return;
                rootObserver.disconnect();
                // Record the very first observable value
                // synchronously. Because the imperative renderer
                // assigns scrollTop BEFORE appendChild's return path
                // gives the observer a chance to fire, this read
                // sees the value the scroller was created at.
                window.__at0068Observed.firstScrollTop = el.scrollTop;
                window.__at0068Observed.ts = performance.now();
                // Also capture any subsequent scroll events that
                // fire during the post-mount window — if a
                // MutationObserver-driven jump from 0 ever happens,
                // we'd see a scroll event right after mount.
                el.addEventListener('scroll', function(){
                  window.__at0068Observed.scrollEvents.push({
                    scrollTop: el.scrollTop,
                    ts: performance.now(),
                  });
                }, { passive: true });
              });
              rootObserver.observe(document.body, {
                subtree: true,
                childList: true,
              });
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
                  componentId: "gallery-bash-mount-in-saved-state",
                  title: "Bash",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 540 },
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
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            { timeoutMs: 5000 },
          );

          // Wait until the inner scroller has been observed.
          await app.waitForCondition<boolean>(
            `(window.__at0068Observed && window.__at0068Observed.firstScrollTop >= 0)`,
            { timeoutMs: 5000 },
          );

          // Grace for any post-mount writes to settle (none expected
          // — that's the contract — but the wait makes a failing
          // test surface them in `scrollEvents`). Bun-side sleep:
          // `evaluateJavaScript` doesn't await Promises, so a
          // Promise-returning eval surfaces as "unsupported type".
          await new Promise<void>((resolve) => setTimeout(resolve, 200));

          const observed = await app.evalJS<{
            firstScrollTop: number;
            ts: number;
            scrollEvents: Array<{ scrollTop: number; ts: number }>;
          }>(`window.__at0068Observed`);

          // -------- Assertion: the FIRST observable scrollTop is
          // at the saved value.
          expect(
            Math.abs(observed.firstScrollTop - preReloadScrollTop),
          ).toBeLessThanOrEqual(SCROLL_TOLERANCE_PX);

          // -------- Assertion: no jump from 0 to saved.
          //
          // If a post-mount MutationObserver-driven apply path were
          // back, we'd observe a scroll event with a large delta
          // away from the saved value within the first few hundred
          // ms after mount. With the creation-time write the
          // scroller is born at the saved position; any user-driven
          // scrolls happen later and stay near the saved value. We
          // allow scroll events that stay within tolerance of the
          // saved value (TugListView's mount-time settle might emit
          // one), but reject any event
          // that lands more than tolerance px from the saved value.
          const jumpAwayFromSaved = observed.scrollEvents.filter(
            (e) =>
              Math.abs(e.scrollTop - preReloadScrollTop) > SCROLL_TOLERANCE_PX,
          );
          expect(jumpAwayFromSaved).toEqual([]);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0068-bash-block-inner-scroll-from-creation] log tail:\n${tail}\n`,
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
