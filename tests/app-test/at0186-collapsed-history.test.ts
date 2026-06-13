/**
 * at0186-collapsed-history.test.ts — collapsed historical tool blocks
 * on the REAL heavy-class corpus snapshot (the motivating session).
 *
 * Resumes the pinned heavy/tool-heavy snapshot through the real picker
 * flow and asserts the [P02] mechanism end to end:
 *
 *  1. Replayed tool blocks mount header-only — `data-block-collapsed`
 *     chrome roots exist in the windowed transcript and none of them
 *     contains a mounted body (`[data-slot="tool-block-body"]`).
 *  2. The re-measured waterfall is recorded (`CORPUS-COLLAPSED ...`)
 *     for the plan's #corpus-baseline appendix.
 *  3. Expansion survives windowed unmount/remount ([L23]): expand one
 *     block via its disclosure chevron, scroll the window away until
 *     the block unmounts, scroll back, and the SAME `tool_use_id`
 *     remounts EXPANDED (body present) — the card-scoped expansion
 *     overrides, not the unmounted component, carried the state.
 *
 * Gating: skips without `TUGAPP_APP_TEST=1` or a harvested corpus
 * containing the pinned heavy/tool-heavy snapshot.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import { loadManifest, seedSnapshot } from "./corpus/resolve";
import {
  auditReveal,
  budgetsFor,
  openSeededSession,
  USER_ROWS,
  type PerfRead,
} from "./corpus/runner";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const COLLAPSED_BLOCKS =
  '[data-card-id="A"] [data-block-collapsed="true"]';
const SCROLLER_SCRIPT = `(function(){
  var host = document.querySelector('[data-card-id="A"] [data-testid="dev-card-transcript"]');
  return host !== null ? host.querySelector('.tug-list-view') : null;
})()`;

const blockSel = (toolUseId: string): string =>
  `[data-card-id="A"] [data-tool-use-id=${JSON.stringify(toolUseId)}]`;

const manifest = SHOULD_RUN ? loadManifest() : null;
const heavySnap =
  manifest?.selected.find(
    (s) => s.class === "heavy" && s.primaryShape === "tool-heavy",
  ) ?? null;

describe.skipIf(!SHOULD_RUN || heavySnap === null)(
  "AT0186: collapsed historical tool blocks (heavy corpus snapshot)",
  () => {
    test(
      "history collapses, re-measures, and expansion survives windowing",
      async () => {
        const snap = heavySnap!;
        const budgets = budgetsFor(snap);
        const seeded = await seedSnapshot(snap, "collapsed-history");
        try {
          const app = await launchTugApp({ testName: "at0186-collapsed" });
          try {
            const { listMs, openedAt, listed } = await openSeededSession(
              app,
              seeded,
              budgets,
            );
            expect(listed).toBe(true);
            const reveal = await auditReveal(
              app,
              openedAt,
              budgets.settleTimeoutMs,
            );
            expect(reveal.settledMs).not.toBeNull();

            // 1 — replayed tool blocks are header-only in the window.
            const collapsedShape = await app.evalJS<{
              collapsed: number;
              bodiesInside: number;
              midId: string | null;
            }>(
              `(function(){
                var blocks = document.querySelectorAll(${JSON.stringify(COLLAPSED_BLOCKS)});
                var bodies = 0;
                for (var i = 0; i < blocks.length; i++) {
                  bodies += blocks[i].querySelectorAll('[data-slot="tool-block-body"]').length;
                }
                return {
                  collapsed: blocks.length,
                  bodiesInside: bodies,
                  // A MID-WINDOW collapsed block: the top edge of the
                  // mounted window can evict its own row when an
                  // expansion changes heights, and the last row is the
                  // follow-bottom anchor that never unmounts — the
                  // middle is the row windowing genuinely recycles.
                  midId: blocks.length > 0 ? blocks[Math.floor(blocks.length / 2)].getAttribute("data-tool-use-id") : null,
                };
              })()`,
            );
            expect(collapsedShape.collapsed).toBeGreaterThan(0);
            expect(collapsedShape.bodiesInside).toBe(0);

            // 2 — record the re-measured waterfall.
            const perf = await app.evalJS<PerfRead>(
              `window.__tug.getSessionPerf("A")`,
              { timeoutMs: 30_000 },
            );
            const rows = await app.evalJS<number>(
              `document.querySelectorAll(${JSON.stringify(USER_ROWS)}).length`,
            );
            console.log(
              `CORPUS-COLLAPSED ${snap.id.slice(0, 8)} bytes=${snap.bytes} ` +
                `turns=${snap.stats.turns} listMs=${listMs} ` +
                `settledMs=${reveal.settledMs} rows=${rows} ` +
                `collapsedBlocks=${collapsedShape.collapsed} ` +
                `ingest=${JSON.stringify(perf.lastReplay)} ` +
                `rowParse=${JSON.stringify(perf.rowParse)} ` +
                `reveal=${JSON.stringify({ ...reveal, samples: undefined })}`,
            );
            expect(perf.lastReplay).not.toBeNull();
            expect(rows).toBeGreaterThan(0);

            // 3 — expansion survival across windowed unmount/remount.
            const targetId = collapsedShape.midId;
            expect(targetId).not.toBeNull();
            // Scrolling re-windows the list, so the block can recycle
            // between separate RPC calls — scroll, click, and verify
            // inside ONE polled condition: each poll observes first
            // (expanded → done) and only then clicks, so the toggle
            // can't oscillate.
            await app.waitForCondition<boolean>(
              `(function(){
                var block = document.querySelector(${JSON.stringify(blockSel(targetId!))});
                if (block === null) return false;
                if (block.getAttribute("data-block-collapsed") !== "true"
                    && block.querySelector('[data-slot="tool-block-body"]') !== null) {
                  return true;
                }
                block.scrollIntoView({ block: "center" });
                var btn = block.querySelector('[data-slot="tool-call-header-disclosure"] button');
                if (btn !== null) {
                  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                }
                return false;
              })()`,
              { timeoutMs: 15_000 },
            );

            // Record where the expanded block lives, scroll the window
            // to the top — far away — and wait for its row to unmount.
            const awayFrom = await app.evalJS<number>(
              `(function(){
                var scroller = ${SCROLLER_SCRIPT};
                if (scroller === null) return -1;
                var top = scroller.scrollTop;
                scroller.scrollTop = 0;
                return top;
              })()`,
            );
            expect(awayFrom).toBeGreaterThanOrEqual(0);
            await app.waitForCondition<boolean>(
              `document.querySelector(${JSON.stringify(blockSel(targetId!))}) === null`,
              { timeoutMs: 20_000 },
            );

            // Scroll back toward the recorded offset. Unmounted rows
            // revert to estimated heights, so the exact offset may
            // miss — the condition SWEEPS the neighborhood until the
            // block remounts, then reports the state it found.
            const remountState = await app.waitForCondition<string>(
              `(function(){
                var block = document.querySelector(${JSON.stringify(blockSel(targetId!))});
                if (block !== null) {
                  if (block.getAttribute("data-block-collapsed") === "true") return "collapsed";
                  return block.querySelector('[data-slot="tool-block-body"]') !== null
                    ? "expanded-with-body"
                    : false;
                }
                var scroller = ${SCROLLER_SCRIPT};
                if (scroller === null) return false;
                var s = typeof window.__at0186Sweep === "number"
                  ? window.__at0186Sweep + 250
                  : ${awayFrom} - 2000;
                if (s > ${awayFrom} + 2500) s = ${awayFrom} - 2000;
                window.__at0186Sweep = s;
                scroller.scrollTop = s;
                return false;
              })()`,
              { timeoutMs: 30_000 },
            );
            expect(remountState).toBe("expanded-with-body");
          } finally {
            await app.close();
          }
        } finally {
          seeded.cleanup();
        }
      },
      360_000,
    );
  },
);
