/**
 * at0065-tide-card-like-inner-scroll-restore.test.ts — higher-fidelity
 * companion to AT0064.
 *
 * AT0064 covers a bare-fixture late-mount BashToolBlock and passes.
 * The user-reported regression is on the LIVE tide-card transcript,
 * which wraps each BashToolBlock in a `TugListView` cell (inline mode
 * + `tailSpacer="80cqh"`). This test pins the same scroll save/restore
 * round-trip under the TugListView wrap so a regression there can't
 * hide behind AT0064's PASS.
 *
 * Same flow as AT0064; only the componentId differs.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
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
  "AT0065: BashToolBlock inner scroll survives reload under TugListView wrap",
  () => {
    test(
      "tide-card-like fixture preserves inner scroll across appReload",
      async () => {
        const tugbankPath = mkTempTugbank();
        seedTugbankForLaunch(tugbankPath);
        const app = await launchTugApp({
          testName: "at0065-tide-card-like-inner-scroll-restore",
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
                  componentId: "gallery-tide-card-like-bash-tool-block",
                  title: "Tide-card-like Bash",
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

          // Wait for BashToolBlock to mount inside the TugListView cell.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(`[data-card-id="${CARD_ID}"] [data-tug-list-cell-index] [data-testid="late-mount-bash-slot"] [data-slot="terminal-body"]`)}) !== null`,
            { timeoutMs: 5000 },
          );

          // Click fold cue to expand. The 60-line fixture defaults to
          // collapsed (overThreshold).
          await app.evalJS<void>(
            `(function(){
               var btn = document.querySelector(${JSON.stringify(`[data-card-id="${CARD_ID}"] [data-slot="terminal-fold-cue"]`)});
               if (btn === null) throw new Error("no fold cue to click");
               btn.click();
             })()`,
          );

          await waitForTermScroller(app);

          await app.evalJS<void>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(termScrollerSelector())});
               el.scrollTop = ${TARGET_SCROLL_TOP};
               el.dispatchEvent(new Event("scroll", { bubbles: true }));
             })()`,
          );

          await app.waitForCondition<boolean>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(termScrollerSelector())});
               return el !== null && el.scrollTop === ${TARGET_SCROLL_TOP};
             })()`,
            { timeoutMs: 1000 },
          );

          // appReload → captures bag and reloads.
          await app.appReload();

          const onDiskBag = tugbankRead<{
            regionScroll?: Record<string, { x: number; y: number }>;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", CARD_ID);
          expect(onDiskBag).not.toBeNull();
          if (onDiskBag === null) throw new Error("bag missing on disk");
          const bagValue = onDiskBag.value;
          const onDiskScroll = bagValue.regionScroll?.[TERM_SCROLL_KEY];
          // SAVE-SIDE GATE: the bag MUST hold the inner scroll value
          // the user just set. If this fails on the tide-card-like
          // fixture but AT0064 passes, the TugListView wrap is
          // interfering with captureRegionScrolls.
          expect(onDiskScroll).toBeDefined();
          if (onDiskScroll === undefined) {
            throw new Error(`bag.regionScroll[${TERM_SCROLL_KEY}] missing`);
          }
          expect(Math.abs(onDiskScroll.y - TARGET_SCROLL_TOP)).toBeLessThanOrEqual(
            SCROLL_TOLERANCE_PX,
          );

          // Re-seed with on-disk bag and verify the round-trip applies.
          const cardStates: Record<string, unknown> = { [CARD_ID]: bagValue };

          await app.enableDeckTrace(true);
          await app.seedDeckState({
            state: {
              cards: [
                {
                  id: CARD_ID,
                  componentId: "gallery-tide-card-like-bash-tool-block",
                  title: "Tide-card-like Bash",
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

          await waitForTermScroller(app, 6000);

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

          // -------- Phase 4: simulate the live-tide-card path where
          // the body kind unmounts-and-remounts within the same card
          // lifecycle (TideRestoring overlay swap, or a re-render
          // that swaps the body kind subtree). Force a fold-collapse
          // → fold-expand cycle: the collapsed path tears down the
          // virtualized scroller, the expand path rebuilds it at
          // scrollTop=0. If a save fires WHILE the rebuilt scroller
          // still reads scrollTop=0, the bag clobbers with y=0 —
          // matching the user's on-disk bag exactly.
          //
          // Click fold cue to collapse.
          await app.evalJS<void>(
            `(function(){
               var btn = document.querySelector(${JSON.stringify(`[data-card-id="${CARD_ID}"] [data-slot="terminal-fold-cue"]`)});
               if (btn === null) throw new Error("fold cue missing for collapse");
               btn.click();
             })()`,
          );
          // Wait for the scroller to disappear (collapsed-preview path).
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(termScrollerSelector())}) === null`,
            { timeoutMs: 2000 },
          );

          // Click again to expand. A NEW scroller is created with
          // scrollTop=0 — the regression-prone moment. Before the
          // element-identity fix in `card-host.tsx`'s region-scroll
          // apply, the `regionSettled` Set tracked by key would skip
          // applying the saved y to the new element, leaving it at
          // scrollTop=0 forever. The next save would capture y=0
          // and clobber the bag.
          await app.evalJS<void>(
            `(function(){
               var btn = document.querySelector(${JSON.stringify(`[data-card-id="${CARD_ID}"] [data-slot="terminal-fold-cue"]`)});
               if (btn === null) throw new Error("fold cue missing for re-expand");
               btn.click();
             })()`,
          );

          // Wait for the MutationObserver-driven apply to re-restore
          // the saved scrollTop on the freshly-rebuilt scroller. With
          // the element-identity fix, this resolves; without it, the
          // scroller stays at 0 and this times out (catching the bug).
          await app.waitForCondition<boolean>(
            `(function(){
               var el = document.querySelector(${JSON.stringify(termScrollerSelector())});
               return el !== null && Math.abs(el.scrollTop - ${TARGET_SCROLL_TOP}) <= ${SCROLL_TOLERANCE_PX};
             })()`,
            { timeoutMs: 3000 },
          );

          await app.evalJS<void>(`window.tugdeck.saveState()`);
          const postRemountBag = tugbankRead<{
            regionScroll?: Record<string, { x: number; y: number }>;
          }>(tugbankPath, "dev.tugtool.deck.cardstate", CARD_ID);
          expect(postRemountBag).not.toBeNull();
          if (postRemountBag === null) throw new Error("bag missing after remount");
          const postRemountScroll =
            postRemountBag.value.regionScroll?.[TERM_SCROLL_KEY];
          expect(postRemountScroll).toBeDefined();
          if (postRemountScroll === undefined) {
            throw new Error(
              `bag.regionScroll[${TERM_SCROLL_KEY}] missing after remount`,
            );
          }
          // The bag MUST still hold ~TARGET_SCROLL_TOP. If this reads
          // 0, the user-reported bug is reproduced: the save captured
          // the freshly-recreated scroller's scrollTop=0 instead of
          // the user-visible scroll position.
          expect(Math.abs(postRemountScroll.y - TARGET_SCROLL_TOP)).toBeLessThanOrEqual(
            SCROLL_TOLERANCE_PX,
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0065-tide-card-like-inner-scroll-restore] log tail:\n${tail}\n`,
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
