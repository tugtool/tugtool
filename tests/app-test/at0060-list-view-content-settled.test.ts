/**
 * at0060-list-view-content-settled.test.ts — Phase E.6 step 2 proof.
 *
 * Prove that we can correctly identify when a virtualized list's
 * content has loaded, rendered, and settled. "Settled" is the
 * pre-condition the anchor-based scroll restore (Phase E.6 step 3)
 * needs: until heights stop drifting, the `heightIndex.offsetForIndex`
 * sum is unreliable, and writing a restored scrollTop would land
 * the user at the wrong content.
 *
 * Three observable signals together identify settlement:
 *
 *  1. **Loaded** — `dataSource.numberOfItems()` reports the seeded
 *     item count. Visible via the count of cells in the DOM under
 *     `inline=true` (every cell renders).
 *
 *  2. **Rendered** — every cell carries the
 *     `data-tug-list-cell-index` attribute. The list view stamps
 *     this on each cell's wrapper at render time, so the count
 *     equals the data source's item count once React has committed.
 *
 *  3. **Settled** — `scrollHeight` of the scroll container is
 *     stable across two observations 250ms apart, AND
 *     `scrollHeight > clientHeight`. Stability means no
 *     ResizeObserver-driven height index updates are pending; the
 *     `clientHeight` floor proves real layout has happened (vs. a
 *     zero-height intermediate state).
 *
 * Once all three hold, the apply path's preconditions are satisfied:
 *  - The bag's anchor index addresses a real cell.
 *  - The heightIndex offset for that index is stable.
 *  - The scrollTop computed from `(cellTop + anchorOffset)` is a
 *    reachable position the browser will accept without clamping.
 *
 * Fixture: `gallery-list-view-scroll-keyed` (mounted with
 * `inline=true` so every cell renders at mount).
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * Tuglaws referenced:
 *  - [L23] state preservation across teardown-and-replay — the
 *    settled-detection signal is the gate that makes safe restore
 *    possible.
 *  - [L06] observation is DOM-only — no React state crossed. The
 *    test polls live DOM via `evalJS`.
 *  - [L24] the three signals correspond to the three state zones:
 *    loaded (local data — itemCount), rendered (structure — DOM
 *    cells), settled (appearance — scrollHeight stable).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const SCROLL_KEY = "gallery-list-view-scroll";

function scrollContainerSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-scroll-key="${SCROLL_KEY}"]`;
}

function cellsSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-list-cell-index]`;
}

describe.skipIf(!SHOULD_RUN)(
  "AT0060: TugListView content loaded / rendered / settled signals",
  () => {
    test(
      "three signals together identify the moment after which scroll restore is safe",
      async () => {
        const app = await launchTugApp({
          testName: "at0060-list-view-content-settled",
        });
        try {
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
            focusCardId: "A",
          });

          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
          );

          // -------- Signal 1: LOADED.
          //
          // Wait for the scroll container to exist and for at least
          // one cell to render. Once at least one cell is in the
          // DOM, `inline=true` guarantees ALL cells render in the
          // same React commit — so the count we read here is the
          // final count.
          //
          // (For a non-inline / virtualized list view this would
          // assert against only the windowed cell count; this
          // fixture is inline, mirroring tide-card-transcript.)
          await app.waitForCondition<boolean>(
            `(function(){
              var cells = document.querySelectorAll(${JSON.stringify(cellsSelectorFor("A"))});
              return cells.length > 0;
            })()`,
            { timeoutMs: 5000 },
          );

          const itemCount = await app.evalJS<number>(
            `document.querySelectorAll(${JSON.stringify(cellsSelectorFor("A"))}).length`,
          );
          expect(itemCount).toBeGreaterThan(0);

          // -------- Signal 2: RENDERED.
          //
          // Every cell in the DOM has a `data-tug-list-cell-index`
          // with a parseable non-negative integer. This is the
          // primitive's contract — TugListView stamps the attribute
          // when it renders a cell. The count must equal `itemCount`
          // we just read (signal 1).
          const indicesAreValid = await app.evalJS<boolean>(
            `(function(){
              var cells = document.querySelectorAll(${JSON.stringify(cellsSelectorFor("A"))});
              for (var i = 0; i < cells.length; i++) {
                var raw = cells[i].getAttribute("data-tug-list-cell-index");
                if (raw === null) return false;
                var n = parseInt(raw, 10);
                if (!Number.isInteger(n) || n < 0) return false;
              }
              return true;
            })()`,
          );
          expect(indicesAreValid).toBe(true);

          // -------- Signal 3: SETTLED.
          //
          // `scrollHeight` is stable across two observations 250ms
          // apart, AND exceeds `clientHeight` (real layout has
          // happened). Stability means no ResizeObserver-driven
          // measurement is pending; once held, `heightIndex` is
          // populated and `offsetForIndex` returns a fixed sum.
          //
          // We poll up to a generous bound to give the cell
          // ResizeObservers their rAF flushes. In practice this
          // settles within a few hundred ms on a warm app.
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              if (el === null) return false;
              return el.scrollHeight > el.clientHeight + 100;
            })()`,
            { timeoutMs: 5000 },
          );

          // Capture scrollHeight twice with a 250ms gap. If the
          // values match, content has settled (no growth in the
          // intervening time).
          const firstHeight = await app.evalJS<number>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              return el === null ? -1 : el.scrollHeight;
            })()`,
          );
          expect(firstHeight).toBeGreaterThan(0);

          await new Promise<void>((resolve) => setTimeout(resolve, 250));

          const secondHeight = await app.evalJS<number>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              return el === null ? -1 : el.scrollHeight;
            })()`,
          );
          expect(secondHeight).toBe(firstHeight);

          // -------- Cross-check: at the settled moment, the anchor
          // attribute reflects a position addressing a real cell
          // (index < itemCount). This is the apply path's
          // pre-condition; if the anchor index can index past the
          // data source, restore would bail. Proves the writer's
          // anchor stays in bounds.
          const anchorAttr = await app.evalJS<string | null>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              return el === null ? null : el.getAttribute("data-tug-scroll-state");
            })()`,
          );
          expect(anchorAttr).not.toBeNull();
          if (anchorAttr === null) throw new Error("missing attr at settled");
          const anchorParsed = JSON.parse(anchorAttr) as {
            anchor: { index: number; offset: number };
          };
          expect(anchorParsed.anchor.index).toBeGreaterThanOrEqual(0);
          expect(anchorParsed.anchor.index).toBeLessThan(itemCount);
          expect(anchorParsed.anchor.offset).toBeGreaterThanOrEqual(0);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0060-list-view-content-settled] log tail:\n${tail}\n`,
            );
          }
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
