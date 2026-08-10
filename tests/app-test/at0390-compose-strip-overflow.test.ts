/**
 * at0390-compose-strip-overflow.test.ts — the compose attachment strip reveals
 * what does not fit, and buys the scrollbar out of its own tiles.
 *
 * Six attached images is the count that first overflowed the strip's width.
 * The app's scrollbars are the classic space-TAKING kind (`tug.css` gives every
 * scroller a 12px `::-webkit-scrollbar`), and the strip's zone is a CONSTANT
 * height — load-bearing twice, since the prompt-entry reserves it the instant an
 * atom drops and the Session card steals exactly it from the editor's floor. So
 * the bar cannot be paid for by growing. It came out of the content instead:
 * the tiles no longer fit vertically, a SECOND scrollbar appeared for a row with
 * nothing below it, and the strip stood taller than the zone that clips it.
 *
 * The strip now shrinks its tiles by exactly the bar's height on a row that
 * scrolls, and keeps them full-size on a row that does not. Both halves are
 * asserted against the real drop pipeline — PNGs baked in-page, through
 * dragover/drop, downsample, bytes store, atom insertion, compose strip.
 *
 * **Six images — the row scrolls:**
 *  1. **There is something to reveal.** The row's scroll width exceeds the
 *     box's — the overflow the test is about actually happened.
 *  2. **The strip knows, and pays.** It flags itself and its tiles come down by
 *     the scrollbar's height, exactly.
 *  3. **One bar, the horizontal one.** It takes its height; nothing takes width.
 *  4. **Nothing to scroll DOWN to.** Scroll height equals client height — the
 *     vertical overflow that produced the second bar is gone at the source.
 *  5. **The strip still fits its zone**, bar and all.
 *  6. **The scroll reveals.** Driven to its end, the LAST tile — which started
 *     past the trailing edge — lands inside the visible box.
 *  7. **And it holds.** A shorter tile is a NARROWER tile (width follows the
 *     image's aspect), so a strip that re-decided from its own shrunk row could
 *     find that it now fits, grow back, overflow again, and flicker forever. The
 *     flag is decided at the row's natural size for exactly this reason; a beat
 *     of observer traffic later, nothing has moved.
 *
 * **Two images — the row fits:** no flag, no bar on either axis, and the
 * previews keep their full height. The shrink is a response to scrolling, not
 * the resting state.
 *
 * @covers tugdeck/src/components/tugways/cards/tug-attachment-preview.css
 * @covers tugdeck/src/components/tugways/cards/tug-attachment-preview.tsx
 * @covers tugdeck/src/components/tugways/tug-prompt-entry.css
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const ENTRY = `${CARD} .tug-prompt-entry`;
const EDITOR_CONTENT = `${ENTRY} .tug-text-editor .cm-content`;
const ZONE = `${ENTRY} .tug-prompt-entry-attachments`;
const STRIP = `${ZONE} [data-slot="tug-attachment-preview"][data-deletable]`;
const TILE = '[data-slot="tug-attachment-preview__tile"]';

/** How many images to attach — the count from the report. */
const IMAGE_COUNT = 6;

/** A count that comfortably fits the row, for the resting case. */
const FITTING_COUNT = 2;

/** The strip's own constants, restated so a drift in either is a failure here
 *  rather than a silently different-looking strip
 *  (`--tugx-attachment-tile-height-rest`, `--tugx-attachment-scrollbar-height`). */
const TILE_HEIGHT_REST = 56;
const SCROLLBAR_HEIGHT = 12;

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "session", title: "Session", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        // The session card's own width floor (675, the slim preset). A wider
        // pane would need more than six images to overflow, and six is the
        // case being pinned.
        size: { width: 700, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

async function launchAndSeed(testName: string): Promise<App> {
  const app = await launchTugApp({ testName });
  await app.enableDeckTrace(true);
  await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
  await app.waitForCondition<boolean>(
    `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
  );
  await app.bindSession("A");
  await app.awaitEngineReady("A");
  return app;
}

/**
 * Drop one wide PNG on the editor.
 *
 * The bytes are baked by WebKit itself (a canvas painted and encoded in the
 * page) rather than pasted in as a literal, so the drop carries a real image
 * the downsample path decodes. WIDE — 5:1 — so each tile is driven to the
 * strip's max-width cap and six of them exceed the row.
 */
function dropWidePng(app: App, index: number): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
      var canvas = document.createElement("canvas");
      canvas.width = 300; canvas.height = 60;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "hsl(" + (${index} * 57) + ", 70%, 50%)";
      ctx.fillRect(0, 0, 300, 60);
      var url = canvas.toDataURL("image/png");
      var b64 = url.slice(url.indexOf(",") + 1);
      var bytes = Uint8Array.from(atob(b64), function(c){ return c.charCodeAt(0); });
      var file = new File([bytes], "wide-${index}.png", { type: "image/png" });
      var dt = new DataTransfer();
      dt.items.add(file);
      var host = document.querySelector(${JSON.stringify(EDITOR_CONTENT)});
      if (host === null) return false;
      var r = host.getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + Math.min(12, r.height / 2);
      var target = document.elementFromPoint(x, y) || host;
      var over = new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(over, "dataTransfer", { value: dt });
      target.dispatchEvent(over);
      var accepted = over.defaultPrevented;
      var drop = new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y });
      Object.defineProperty(drop, "dataTransfer", { value: dt });
      target.dispatchEvent(drop);
      return accepted;
    })()`,
  );
}

interface StripMetrics {
  /** Content width vs. the visible box — the overflow to be revealed. */
  scrollWidth: number;
  clientWidth: number;
  /** Content height vs. the visible box — must be equal: one row, no depth. */
  scrollHeight: number;
  clientHeight: number;
  /** Border-box vs. content-box: the space a scrollbar would be taking. */
  offsetWidth: number;
  offsetHeight: number;
  /** The zone that clips the strip. */
  zoneHeight: number;
  scrollLeft: number;
  /** Distance from the last tile's trailing edge to the box's — negative
   *  while the tile is still past the edge. */
  lastTileSlack: number;
  /** Whether the strip has marked itself as scrolling. */
  scrolls: boolean;
  /** A tile's rendered height — the step it gives up to seat the bar. */
  thumbHeight: number;
}

function stripMetrics(app: App): Promise<StripMetrics> {
  return app.evalJS<StripMetrics>(
    `(function(){
      var strip = document.querySelector(${JSON.stringify(STRIP)});
      var zone = document.querySelector(${JSON.stringify(ZONE)});
      var tiles = strip.querySelectorAll(${JSON.stringify(TILE)});
      var last = tiles[tiles.length - 1];
      return {
        scrollWidth: strip.scrollWidth,
        clientWidth: strip.clientWidth,
        scrollHeight: strip.scrollHeight,
        clientHeight: strip.clientHeight,
        offsetWidth: strip.offsetWidth,
        offsetHeight: strip.offsetHeight,
        zoneHeight: zone.clientHeight,
        scrollLeft: strip.scrollLeft,
        lastTileSlack:
          strip.getBoundingClientRect().right - last.getBoundingClientRect().right,
        scrolls: strip.hasAttribute("data-scrolls"),
        thumbHeight: Math.round(
          last.querySelector(".tug-attachment-preview__thumb-img")
            .getBoundingClientRect().height
        )
      };
    })()`,
  );
}

/** Drop `count` wide PNGs and wait for every one of them to have pixels — a
 *  pre-bake placeholder is a square, and a square row is not the row these
 *  tests are about. */
async function attachWideImages(app: App, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    expect(await dropWidePng(app, i), `drop ${i} accepted`).toBe(true);
    await app.waitForCondition<boolean>(
      `document.querySelectorAll(${JSON.stringify(STRIP)} + ' ' + ${JSON.stringify(TILE)}).length >= ${i + 1}`,
      { timeoutMs: 8000 },
    );
  }
  await app.waitForCondition<boolean>(
    `document.querySelectorAll(${JSON.stringify(STRIP)} + ' [data-has-image]').length >= ${count}`,
    { timeoutMs: 10000 },
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0390: the compose strip scrolls its overflow, paying for the bar itself",
  () => {
    test(
      "six images overflow the row, shrink to seat the bar, and reveal by scrolling",
      async () => {
        const app = await launchAndSeed("at0390-compose-strip-overflow");
        try {
          await attachWideImages(app, IMAGE_COUNT);

          // The strip decides for itself, off a ResizeObserver that fires when
          // the last image's width lands — so wait for its answer rather than
          // racing the frame it arrives in.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(STRIP)}).hasAttribute("data-scrolls")`,
            { timeoutMs: 6000 },
          );

          const before = await stripMetrics(app);
          note("strip at rest", JSON.stringify(before));

          // 1. There is something past the edge to reveal.
          expect(
            before.scrollWidth,
            "the row overflows its box — six images do not fit",
          ).toBeGreaterThan(before.clientWidth + 1);

          // 2. The strip knows it, and paid for the bar out of the tiles.
          expect(before.scrolls, "the strip marked itself as scrolling").toBe(
            true,
          );
          expect(
            before.thumbHeight,
            "the tiles gave up the scrollbar's height",
          ).toBe(TILE_HEIGHT_REST - SCROLLBAR_HEIGHT);

          // 3. The horizontal bar is there and is the ONLY one: it takes its
          //    height, and nothing takes width.
          expect(
            before.offsetHeight - before.clientHeight,
            "the horizontal scrollbar is present, taking its height",
          ).toBe(SCROLLBAR_HEIGHT);
          expect(
            before.offsetWidth - before.clientWidth,
            "no vertical scrollbar is taking width",
          ).toBe(0);

          // 4. Nothing to scroll down to — the second bar is gone at the
          //    source, not merely hidden.
          expect(
            before.scrollHeight,
            "the strip has no vertical overflow at all",
          ).toBeLessThanOrEqual(before.clientHeight + 1);

          // 5. And the strip, bar and all, still fits the zone that clips it.
          expect(
            before.offsetHeight,
            "the strip fits inside its fixed zone",
          ).toBeLessThanOrEqual(before.zoneHeight);

          // 6. The scroll reveals: drive it to the end and the last tile —
          //    which was past the trailing edge — lands inside the box.
          expect(
            before.lastTileSlack,
            "the last tile starts out past the trailing edge",
          ).toBeLessThan(0);

          await app.evalJS<boolean>(
            `(function(){
              var strip = document.querySelector(${JSON.stringify(STRIP)});
              strip.scrollLeft = strip.scrollWidth;
              return true;
            })()`,
          );

          const after = await stripMetrics(app);
          note("strip scrolled", JSON.stringify(after));

          expect(
            after.scrollLeft,
            "the strip actually scrolled horizontally",
          ).toBeGreaterThan(0);
          expect(
            after.lastTileSlack,
            "the last image is revealed inside the visible box",
          ).toBeGreaterThanOrEqual(0);

          // 7. And the flag holds. Shrinking the tiles narrows them too, so a
          //    strip that re-decided from its own shrunk row could find that
          //    it now fits, grow back, overflow again, and flicker forever.
          //    A beat later — many frames' worth of observer traffic — it is
          //    where it was.
          await new Promise((r) => setTimeout(r, 500));
          const settled = await stripMetrics(app);
          note("strip settled", JSON.stringify(settled));
          expect(settled.scrolls, "the scrolling pose is stable").toBe(true);
          expect(
            settled.thumbHeight,
            "the tile height did not flicker back",
          ).toBe(before.thumbHeight);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0390] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "a row that fits keeps its full-size previews and raises no bar at all",
      async () => {
        const app = await launchAndSeed("at0390-compose-strip-fits");
        try {
          await attachWideImages(app, FITTING_COUNT);

          // Nothing to wait on but the absence of a flag, so give the strip's
          // observer the same beat the scrolling case gets before reading.
          await new Promise((r) => setTimeout(r, 500));
          const fits = await stripMetrics(app);
          note("strip fitting", JSON.stringify(fits));

          expect(
            fits.scrollWidth,
            "two images fit the row with room to spare",
          ).toBeLessThanOrEqual(fits.clientWidth);
          expect(fits.scrolls, "the strip is not in its scrolling pose").toBe(
            false,
          );
          expect(
            fits.thumbHeight,
            "the previews keep their full height — the shrink is not the resting state",
          ).toBe(TILE_HEIGHT_REST);
          expect(
            fits.offsetHeight - fits.clientHeight,
            "no horizontal scrollbar",
          ).toBe(0);
          expect(
            fits.offsetWidth - fits.clientWidth,
            "and no vertical one",
          ).toBe(0);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") process.stderr.write(`\n[at0390] log tail:\n${tail}\n`);
          throw err;
        } finally {
          await app.close();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
