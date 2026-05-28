/**
 * at0059-region-scroll-anchor-save.test.ts — region-scroll anchor
 * save-side proof.
 *
 * `RegionScrollSnapshot` carries an optional `meta` field that travels
 * alongside `{x, y}` through the
 * [A9] region-scroll axis. Variable-height virtualized lists (notably
 * `TugListView` driving the dev-card transcript) write their live
 * `{anchor: {index, offset}}` payload to a `data-tug-scroll-state`
 * attribute on the scroll container; `captureRegionScrolls` reads the
 * attribute at every save moment and stores the parsed object as
 * `bag.regionScroll[key].meta`.
 *
 * This test proves the SAVE side of that round-trip. It does NOT
 * touch the restore side (covered by the upcoming AT0060 / AT0061
 * tags for "settle detection" and "apply").
 *
 * ## What it asserts
 *
 *  1. The list view's scroll container carries a `data-tug-scroll-state`
 *     attribute whose JSON parses to `{anchor: {index, offset}}` —
 *     proves the writer effect runs on every commit and reflects the
 *     live scroll position.
 *
 *  2. After a programmatic scroll, the attribute updates to a new
 *     anchor — proves the writer reacts to scroll events (via the
 *     SmartScroll → scrollTick → React commit chain).
 *
 *  3. After `window.tugdeck.saveState()`, the in-memory
 *     `bag.regionScroll[key]` contains both `{x, y}` AND
 *     `meta.anchor` matching what the DOM attribute carried —
 *     proves `captureRegionScrolls` reads the attribute and packs
 *     it into the bag.
 *
 * ## Fixture
 *
 * `gallery-list-view-scroll-keyed` (registered in
 * `gallery-registrations.tsx`) mounts `GalleryListView` with
 * `scrollKey="gallery-list-view-scroll"`. The card has a mix of
 * fixed-height + tall + markdown rows from `GalleryListViewDataSource`'s
 * default seed — enough variable-height content to make the anchor
 * non-trivial.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * Tuglaws referenced:
 *  - [L23] state preservation across teardown-and-replay.
 *  - [L06] DOM-attribute write (`data-tug-scroll-state`), not React
 *    state, drives the attribute lifecycle.
 *  - [L19] component authoring guide — the new attribute is documented
 *    in `state-preservation.md` and the body kind / list view docs.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 60_000;

const SCROLL_KEY = "gallery-list-view-scroll";
const REGION_SCROLL_TARGET = 600;

function scrollContainerSelectorFor(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-tug-scroll-key="${SCROLL_KEY}"]`;
}

interface AnchorMeta {
  anchor: { index: number; offset: number };
}

interface RegionScrollEntry {
  x: number;
  y: number;
  meta?: AnchorMeta;
}

describe.skipIf(!SHOULD_RUN)(
  "AT0059: region-scroll anchor metadata — save side",
  () => {
    test(
      "data-tug-scroll-state reflects live scroll, and saveState captures it as bag.regionScroll[key].meta",
      async () => {
        const app = await launchTugApp({
          testName: "at0059-region-scroll-anchor-save",
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

          // Wait for the scroll container to be queryable and for
          // cells to have measured enough that `scrollHeight` exceeds
          // `clientHeight` (so a positive scrollTop is meaningful).
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              return el !== null && el.scrollHeight > el.clientHeight + 200;
            })()`,
            { timeoutMs: 5000 },
          );

          // -------- Assertion 1: writer fires at mount and writes a
          // well-shaped initial anchor.
          //
          // The card mounts with `followBottom`, so the post-mount
          // `pinToBottom` lands scrollTop at the bottom of content
          // rather than at 0. The specific index doesn't matter; what
          // matters is that the writer ran and produced a valid
          // payload. Below we explicitly scroll to a chosen position
          // and assert the attribute updates.
          const initialAttr = await app.evalJS<string | null>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              return el === null ? null : el.getAttribute("data-tug-scroll-state");
            })()`,
          );
          expect(initialAttr).not.toBeNull();
          if (initialAttr === null) throw new Error("missing initial attr");
          const initialParsed = JSON.parse(initialAttr) as AnchorMeta;
          expect(initialParsed.anchor).toBeDefined();
          expect(typeof initialParsed.anchor.index).toBe("number");
          expect(typeof initialParsed.anchor.offset).toBe("number");

          // -------- Assertion 2: scroll the inner region to a known
          // offset. Writer reacts and updates the attribute. We
          // assert the new anchor differs from the initial anchor —
          // proving the writer reacts to scroll events (the
          // SmartScroll → scrollTick → React commit chain runs).
          await app.evalJS<void>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              el.scrollTop = ${REGION_SCROLL_TARGET};
              el.dispatchEvent(new Event('scroll', { bubbles: true }));
            })()`,
          );

          // Poll briefly for the writer's React commit to land. The
          // attribute should change — either the index or the offset
          // (or both) differs from the initial anchor.
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              var raw = el && el.getAttribute("data-tug-scroll-state");
              if (raw === null) return false;
              try {
                var parsed = JSON.parse(raw);
                if (!parsed || !parsed.anchor) return false;
                return parsed.anchor.index !== ${initialParsed.anchor.index}
                    || parsed.anchor.offset !== ${initialParsed.anchor.offset};
              } catch (_) { return false; }
            })()`,
            { timeoutMs: 2000 },
          );

          const afterScrollAttr = await app.evalJS<string | null>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(scrollContainerSelectorFor("A"))});
              return el === null ? null : el.getAttribute("data-tug-scroll-state");
            })()`,
          );
          expect(afterScrollAttr).not.toBeNull();
          if (afterScrollAttr === null) throw new Error("missing scrolled attr");
          const afterScrollParsed = JSON.parse(afterScrollAttr) as AnchorMeta;
          expect(afterScrollParsed.anchor).toBeDefined();
          // Anchor must reflect the new scrollTop — different from
          // the initial mount-time anchor.
          const anchorChanged =
            afterScrollParsed.anchor.index !== initialParsed.anchor.index ||
            afterScrollParsed.anchor.offset !== initialParsed.anchor.offset;
          expect(anchorChanged).toBe(true);

          // -------- Assertion 3: saveState() captures the anchor into
          // the bag. Read the bag from in-memory cache and verify
          // `bag.regionScroll[scrollKey].meta.anchor` matches the live
          // attribute value.
          const bag = await app.evalJS<unknown>(
            `(function(){
              if (!window.tugdeck || typeof window.tugdeck.saveState !== "function") {
                throw new Error("window.tugdeck.saveState missing");
              }
              window.tugdeck.saveState();
              return window.__tug.getCardStateBag("A");
            })()`,
          );

          expect(bag).not.toBeNull();
          expect(bag).toBeDefined();
          // Type-narrow.
          const typedBag = bag as {
            regionScroll?: Record<string, RegionScrollEntry>;
          };
          expect(typedBag.regionScroll).toBeDefined();
          if (typedBag.regionScroll === undefined) {
            throw new Error("expected regionScroll axis on bag");
          }
          const entry = typedBag.regionScroll[SCROLL_KEY];
          expect(entry).toBeDefined();
          // Raw {x, y} still rides — backward-compatible with the
          // pre-Phase-E.6 channel.
          expect(typeof entry.x).toBe("number");
          expect(typeof entry.y).toBe("number");
          expect(entry.y).toBe(REGION_SCROLL_TARGET);
          // NEW: meta carries the anchor.
          expect(entry.meta).toBeDefined();
          if (entry.meta === undefined) {
            throw new Error("expected meta on regionScroll entry");
          }
          expect(entry.meta.anchor).toBeDefined();
          // The bag's anchor matches the DOM attribute's anchor.
          expect(entry.meta.anchor.index).toBe(afterScrollParsed.anchor.index);
          expect(entry.meta.anchor.offset).toBe(
            afterScrollParsed.anchor.offset,
          );
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0059-region-scroll-anchor-save] log tail:\n${tail}\n`,
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
