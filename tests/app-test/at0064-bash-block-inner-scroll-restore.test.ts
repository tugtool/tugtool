/**
 * at0064-bash-block-inner-scroll-restore.test.ts — companion gate for
 * AT0063 covering the [A9] region-scroll axis on the BashToolBlock's
 * inner TerminalBlock scroller.
 *
 * User reproduction: after Phase E.7 landed and the fold state is
 * preserved, the INNER scroll position inside the bash block is still
 * being lost on `Developer > Reload`. The on-disk bag for the tide-card
 * shows `regionScroll["${toolUseId}-body/term-scroll"]: {x:0, y:0}`
 * even though the user had scrolled the inner terminal down.
 *
 * This test reproduces the path automatically:
 *   1. Mount the late-mount Bash fixture, wait for the inner virtualized
 *      scroller to land in the DOM (i.e., after the E.7 fold-restore
 *      flow has re-rendered the body kind with `collapsed: false`).
 *   2. Programmatically set the inner scroller's `scrollTop` to a known
 *      non-zero value.
 *   3. `appReload()` — same code path as Developer > Reload. The save
 *      side of the round-trip MUST capture the user's scroll into
 *      `bag.regionScroll["${toolUseId}-body/term-scroll"]`.
 *   4. Re-seed the deck with the on-disk bag.
 *   5. Wait for the inner scroller to re-appear after late-mount.
 *   6. Assert the inner `scrollTop` lands at (or within tolerance of)
 *      the saved value.
 *
 * Failure modes this test catches:
 *   - Save side captured y=0 (scroller recreated by another effect
 *     before `captureRegionScrolls` walked the DOM).
 *   - Restore side missed the late-mount scroller (MutationObserver
 *     never fired its re-apply for the term-scroll key).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * Tuglaws referenced:
 *   - [L23] state preservation across teardown-and-replay.
 *   - [L03] `useLayoutEffect` so the MutationObserver in CardHost is
 *     live before the body kind's late mount adds the scroll key.
 *   - [L07] CardHost reads each region's live scrollTop via DOM at
 *     capture time, not a memoized snapshot.
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

const CARD_ID = "A";
const TOOL_USE_ID = "toolu_late_mount_e7";
const SCOPED_KEY = `${TOOL_USE_ID}-body`;
const TERM_SCROLL_KEY = `${SCOPED_KEY}/term-scroll`;
const TARGET_SCROLL_TOP = 240;
const SCROLL_TOLERANCE_PX = 8;

function termScrollerSelector(): string {
  return `[data-card-id="${CARD_ID}"] [data-tug-scroll-key="${TERM_SCROLL_KEY}"]`;
}

async function waitForTermScroller(
  app: {
    waitForCondition: <T>(s: string, o?: { timeoutMs?: number }) => Promise<T>;
  },
  timeoutMs: number = 5000,
): Promise<void> {
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(termScrollerSelector())}) !== null`,
    { timeoutMs },
  );
}

async function readScrollTop(
  app: { evalJS: <T>(s: string) => Promise<T> },
): Promise<number | null> {
  return app.evalJS<number | null>(
    `(function(){
       var el = document.querySelector(${JSON.stringify(termScrollerSelector())});
       return el === null ? null : el.scrollTop;
     })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0064: BashToolBlock inner scroll survives Developer > Reload",
  () => {
    test(
      "inner term-scroll position restores after appReload through the [A9] region-scroll axis",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0064-bash-block-inner-scroll-restore",
          env: { TUGBANK_PATH: tugbankPath },
          persistInTestMode: true,
        });
        try {
          await app.enableDeckTrace(true);

          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: CARD_ID,
                  componentId: "gallery-late-mount-bash-tool-block",
                  title: "Late-mount BashToolBlock",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 520 },
                  cardIds: [CARD_ID],
                  activeCardId: CARD_ID,
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            focusCardId: CARD_ID,
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
          );

          // -------- Phase 1: late-mount populates; expand the block so
          // the inner virtualized scroller appears, then scroll it.

          // Wait for the BashToolBlock body to mount, then click the
          // fold cue to expand. The fixture's default state is collapsed
          // (overThreshold). Without expanding, the virtualized
          // scroller (data-tug-scroll-key) wouldn't exist.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`[data-card-id="${CARD_ID}"] [data-testid="late-mount-bash-slot"] [data-slot="terminal-body"]`)}) !== null`,
            { timeoutMs: 5000 },
          );

          await app.evalJS<void>(
            `(function(){
               var btn = document.querySelector(${JSON.stringify(`[data-card-id="${CARD_ID}"] [data-slot="terminal-fold-cue"]`)});
               if (btn === null) throw new Error("no fold cue to click");
               btn.click();
             })()`,
          );

          await waitForTermScroller(app);

          // Programmatically scroll the inner terminal. Native scroll
          // event must fire so the virtualizer's onScroll → applyUpdate
          // path runs (this matches user wheel-driven scrolling).
          await app.evalJS<void>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(termScrollerSelector())});
               el.scrollTop = ${TARGET_SCROLL_TOP};
               el.dispatchEvent(new Event("scroll", { bubbles: true }));
             })()`,
          );

          // Sanity check — scrollTop is what we set.
          await app.waitForCondition<boolean>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(termScrollerSelector())});
               return el !== null && el.scrollTop === ${TARGET_SCROLL_TOP};
             })()`,
            { timeoutMs: 1000 },
          );

          // -------- Phase 2: appReload — captures the bag (must
          // include the term-scroll axis with y=TARGET_SCROLL_TOP) and
          // reloads the page.
          await app.appReload();

          const onDiskBag = tugbankRead<{
            regionScroll?: Record<string, { x: number; y: number }>;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", CARD_ID);
          expect(onDiskBag).not.toBeNull();
          if (onDiskBag === null) throw new Error("bag missing on disk");
          const bagValue = onDiskBag.value;
          expect(bagValue.regionScroll).toBeDefined();
          if (bagValue.regionScroll === undefined) {
            throw new Error("bag.regionScroll missing on disk");
          }
          const onDiskScroll = bagValue.regionScroll[TERM_SCROLL_KEY];
          // **The save-side gate.** If this fails, captureRegionScrolls
          // wasn't reading the user's scroll at the moment of the save.
          expect(onDiskScroll).toBeDefined();
          if (onDiskScroll === undefined) {
            throw new Error(`bag.regionScroll[${TERM_SCROLL_KEY}] missing`);
          }
          expect(Math.abs(onDiskScroll.y - TARGET_SCROLL_TOP)).toBeLessThanOrEqual(
            SCROLL_TOLERANCE_PX,
          );

          // -------- Phase 3: re-seed deck shape AND feed the on-disk
          // bag back. CardHost mounts; orchestrator caches and applies
          // bag.components (fold) + bag.regionScroll (inner scroll
          // axis) on late-mount.
          const cardStates: Record<string, unknown> = { [CARD_ID]: bagValue };

          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: CARD_ID,
                  componentId: "gallery-late-mount-bash-tool-block",
                  title: "Late-mount BashToolBlock",
                  closable: true,
                },
              ],
              panes: [
                {
                  id: "p1",
                  position: { x: 40, y: 40 },
                  size: { width: 720, height: 520 },
                  cardIds: [CARD_ID],
                  activeCardId: CARD_ID,
                  title: "",
                  acceptsFamilies: ["developer"],
                },
              ],
              activePaneId: "p1",
              hasFocus: true,
            },
            cardStates,
            focusCardId: CARD_ID,
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD_ID)})`,
            { timeoutMs: 5000 },
          );

          // Wait for the late-mount BashToolBlock body kind, then for
          // the virtualized scroller to appear (will appear after
          // Phase E.7 re-renders with collapsed=false from saved bag).
          await waitForTermScroller(app, 6000);

          // The MutationObserver in CardHost re-applies region-scroll
          // values until they settle within tolerance. Poll briefly
          // for that.
          await app.waitForCondition<boolean>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(termScrollerSelector())});
               return el !== null && Math.abs(el.scrollTop - ${TARGET_SCROLL_TOP}) <= ${SCROLL_TOLERANCE_PX};
             })()`,
            { timeoutMs: 3000 },
          );

          const postReloadScroll = await readScrollTop(app);
          expect(postReloadScroll).not.toBeNull();
          if (postReloadScroll === null) {
            throw new Error("scroller missing post-reload");
          }
          expect(Math.abs(postReloadScroll - TARGET_SCROLL_TOP)).toBeLessThanOrEqual(
            SCROLL_TOLERANCE_PX,
          );

          // -------- Phase 4: save again (no further user interaction)
          // and verify the bag preserves the inner scroll value. This
          // catches a save-side clobber where my E.7 fix's recreation
          // of the scroller leaves scrollTop=0 just long enough that a
          // subsequent save trigger overwrites the bag with y=0.
          await app.evalJS<void>(`window.tugdeck.saveState()`);
          const postSaveBag = tugbankRead<{
            regionScroll?: Record<string, { x: number; y: number }>;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", CARD_ID);
          expect(postSaveBag).not.toBeNull();
          if (postSaveBag === null) throw new Error("post-save bag missing");
          const postSaveScroll = postSaveBag.value.regionScroll?.[TERM_SCROLL_KEY];
          expect(postSaveScroll).toBeDefined();
          if (postSaveScroll === undefined) {
            throw new Error(
              `bag.regionScroll[${TERM_SCROLL_KEY}] missing on second save — the inner-scroll axis was lost`,
            );
          }
          // The bag must still hold the inner scroll close to the user's
          // value. If this drops to ~0 after the no-interaction save,
          // captureRegionScrolls is reading the scroller post-recreate
          // (i.e., scrollTop was reset to 0 by a re-render between
          // the MutationObserver apply and the save).
          expect(Math.abs(postSaveScroll.y - TARGET_SCROLL_TOP)).toBeLessThanOrEqual(
            SCROLL_TOLERANCE_PX,
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0064-bash-block-inner-scroll-restore] log tail:\n${tail}\n`,
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
