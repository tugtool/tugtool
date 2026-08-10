/**
 * at0370-sparkline-registration.test.ts — the tape stays registered, and
 * stays drawn.
 *
 * The activity sparkline is the one piece of live ink on the Lens rail, and
 * the rail is the surface a user watches while *not* looking at a card. A tape
 * that stutters or blanks there is the monitor lying about the thing it exists
 * to report. Four claims, and none of them is reachable from a DOM-free test:
 *
 *   1. **One animation, and it is running.** The scroll is created once per
 *      mount and rebased by writing `startTime` — never `cancel()` plus a
 *      fresh `animate()`. A `startTime` that is still pending would put the
 *      whole epoch at a horizontal offset nobody chose, so it is read too.
 *   2. **A scroll cycle is a pause, not a teardown.** The row leaves and
 *      re-enters its list three times and comes back as the SAME `Animation`
 *      object, never having reached `playState: "idle"`. That is the
 *      falsifiable form of "off screen is a pause": a design that tore down
 *      would fail it on the first cycle.
 *   3. **The backing store matches the display.** Every mounted canvas is
 *      sized to its presentation width times the live `devicePixelRatio`.
 *      Read once here so a ratio the component never re-read — the old
 *      behaviour — cannot pass.
 *   4. **A stalled stream drains to baseline.** Units go in through the REAL
 *      `SessionActivityStore`, the meters bin them on absolute wall-clock
 *      indices, and when the stream stops the pen must fall back to zero. This
 *      is the observable behaviour of the one wall-clock conversion left in the
 *      tape path: hand those meters a monotonic clock and the window never
 *      advances, the tape holds its last level forever, and the failure reads
 *      as a data bug rather than a clock bug.
 *
 * **The activity is real, the stream is not.** `recordActivity` calls the same
 * `SessionActivityStore.record` the wire calls, on the same wall clock, so the
 * meters, the dominant-channel hysteresis, and every bound tape are production
 * from that point on. There is no fixture.
 *
 * **Nothing here awaits an animation frame.** App-tests run in background
 * windows where rendering may be suspended entirely, so every assertion reads
 * state that is correct synchronously — `Animation` object identity, `count`,
 * `playState`, `startTime`, canvas dimensions, and the tape's own recorded
 * value. No `currentTime` delta, no mid-flight computed transform. For the same
 * reason claim 2 is stated as "the animation survived", which holds whether or
 * not the intersection observer got a chance to fire; whether it did is
 * reported as a diagnostic rather than asserted.
 *
 * @covers tugdeck/src/components/tugways/tug-sparkline.tsx
 * @covers tugdeck/src/components/tugways/session-activity-sparkline.tsx
 * @covers tugdeck/src/lib/sparkline-tape.ts
 * @covers tugdeck/src/lib/workers/sparkline-render-worker.ts
 * @covers tugdeck/src/lib/sparkline-geometry.ts
 * @covers tugdeck/src/components/lens/sections/cards-session-cell.tsx
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/test-surface.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note, type App } from "./_harness";
import { mkTempTugbank, rmTempTugbank, seedTugbankForLaunch } from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/**
 * Enough rows that the Lens Cards list genuinely overflows and can scroll.
 *
 * The count is asserted rather than trusted (`scrollable > 0` below): a session
 * row is three lines tall now that the standing-goal level left it, so twelve of
 * them fit the rail without overflowing and every scroll cycle here would have
 * proved nothing.
 */
const SESSION_COUNT = 18;

const sid = (n: number): string =>
  `a7c0d1ea-0000-4000-8000-${String(370_000 + n).padStart(12, "0")}`;

const lensRow = (session: string): string =>
  `.lens-cards-list .session-row-content[data-session-id="${session}"]`;
const lensSpark = (session: string): string =>
  `${lensRow(session)} .tug-pulse-trailing .tug-sparkline`;

/**
 * The tape's own scroll container, found the way the component finds it —
 * walking up for a computed `overflow-y` of `auto`/`scroll`/`overlay`. Resolved
 * rather than hardcoded on purpose: this is the element the component hands the
 * `IntersectionObserver` as its `root`, so a hardcoded selector that drifted
 * would leave the scroll cycles below scrolling something the gate is not
 * watching, and the test would pass while proving nothing.
 */
const RESOLVE_SCROLLER = (sparkSelector: string): string =>
  `(function(){
     var el = document.querySelector(${JSON.stringify(sparkSelector)});
     for (var n = el && el.parentElement; n !== null; n = n.parentElement) {
       var o = getComputedStyle(n).overflowY;
       if (o === "auto" || o === "scroll" || o === "overlay") return n;
     }
     return null;
   })()`;

/**
 * Mirrors the tape's rolling window plus one bin, with slack. Past this, every
 * bin the burst touched has aged out and the pen must be at baseline.
 */
const DRAIN_WAIT_MS = 3_000;

/**
 * Comfortably past the gate's 500 ms out-of-view hysteresis, so a scroll that
 * takes the row away is read as a departure rather than as the flap the gate
 * exists to ignore.
 */
const HYSTERESIS_DWELL_MS = 900;

const dwell = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One card per pane, deliberately: the Lens draws its monitor row — and
 * therefore the tape — only for a SINGLE-CARD session pane. A pane holding
 * several cards falls through to the generic one-line row, which has no
 * sparkline in it at all, and the whole file would then be testing nothing.
 */
function deckShape() {
  const cards = Array.from({ length: SESSION_COUNT }, (_, i) => ({
    id: `S${i}`,
    componentId: "session",
    title: `Session ${i}`,
    closable: true,
  }));
  return {
    cards,
    panes: cards.map((card, i) => ({
      id: `p${i}`,
      position: { x: 20 + i * 4, y: 20 + i * 4 },
      size: { width: 700, height: 320 },
      cardIds: [card.id],
      activeCardId: card.id,
      title: "",
      acceptsFamilies: ["maker"],
    })),
    activePaneId: "p0",
    hasFocus: true,
  };
}

/** Record `units` on a session's text channel, through the real store. */
async function recordActivity(
  app: App,
  session: string,
  units: number,
): Promise<boolean> {
  return app.evalJS<boolean>(
    `window.__tug.recordActivity(${JSON.stringify(session)}, "text", ${units})`,
  );
}

interface TapeState {
  state: string;
  t0: number;
  points: number;
  lastV: number;
}

async function tapeState(app: App, selector: string): Promise<TapeState | null> {
  return app.evalJS<TapeState | null>(
    `window.__tug.sparklineTapeState(${JSON.stringify(selector)})`,
  );
}

/**
 * The scroll's identity and health, in one synchronous read. `nth` indexes into
 * `getAnimations()` so a SECOND animation appearing is visible as a count, not
 * as a silently-different object.
 */
interface ScrollState {
  count: number;
  playState: string | null;
  startTime: number | null;
  pending: boolean | null;
  /** A per-page identity stamp, so "same object" survives the JS bridge. */
  stamp: number | null;
}

async function scrollState(app: App, sparkSelector: string): Promise<ScrollState> {
  return app.evalJS<ScrollState>(
    `(function(){
       var track = document.querySelector(${JSON.stringify(sparkSelector)} + " .tug-sparkline-track");
       if (track === null) return { count: -1, playState: null, startTime: null, pending: null, stamp: null };
       var anims = track.getAnimations();
       if (anims.length === 0) return { count: 0, playState: null, startTime: null, pending: null, stamp: null };
       var a = anims[0];
       // Object identity cannot cross evaluateJavaScript, so stamp it once and
       // read the stamp back. A replacement animation is a fresh object and
       // therefore carries no stamp — which is exactly the failure to catch.
       if (window.__at0370Stamps === undefined) { window.__at0370Stamps = { next: 1 }; }
       if (a.__at0370 === undefined) { a.__at0370 = window.__at0370Stamps.next++; }
       return {
         count: anims.length,
         playState: a.playState,
         startTime: typeof a.startTime === "number" ? a.startTime : null,
         pending: a.pending === true,
         stamp: a.__at0370,
       };
     })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("AT0370: the sparkline stays registered", () => {
  test(
    "one animation survives repeated scroll cycles, the backing store tracks the display, and a stalled stream drains",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at0370-sparkline-registration",
        env: { TUGBANK_PATH: tugbankPath },
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "S0" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("S0")`,
        );
        for (let i = 0; i < SESSION_COUNT; i++) {
          await app.bindSession(`S${i}`, { tugSessionId: sid(i) });
        }

        // Under `prefers-reduced-motion` the component creates no animation at
        // all and every claim below inverts. Say so and stop, rather than
        // reporting a false red.
        const motionOn = await app.evalJS<boolean>(
          `getComputedStyle(document.documentElement)
             .getPropertyValue("--tug-motion").trim() !== "0"`,
        );
        if (!motionOn) {
          note("at0370", "reduced motion is on; the tape has no animation to register");
          return;
        }

        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(lensSpark(sid(0)))}) !== null`,
          { timeoutMs: 20_000 },
        );
        note(
          "monitor rows / tapes mounted",
          await app.evalJS<string>(
            `document.querySelectorAll(".lens-cards-list .session-row-content").length
               + " / " + document.querySelectorAll(".lens-cards-list .tug-pulse-trailing .tug-sparkline").length`,
          ),
        );

        // The answer to the open question this design deliberately refused to
        // depend on: does the document timeline advance with `performance.now()`
        // while the window is not being presented? Recorded, not asserted.
        note(
          "timeline vs performance.now (ms)",
          await app.evalJS<number>(
            `(function(){
               var t = document.timeline.currentTime;
               return typeof t === "number" ? Math.round(t - performance.now()) : NaN;
             })()`,
          ),
        );
        note(
          "visibilityState",
          await app.evalJS<string>(`document.visibilityState`),
        );

        // ---- 1. One animation, running, with a resolved origin ------------
        const spark = lensSpark(sid(0));
        expect(await recordActivity(app, sid(0), 400)).toBe(true);
        await app.waitForCondition<boolean>(
          `(function(){
             var s = window.__tug.sparklineTapeState(${JSON.stringify(spark)});
             return s !== null && s.state === "live";
           })()`,
          { timeoutMs: 10_000 },
        );

        const born = await scrollState(app, spark);
        expect(born.count).toBe(1);
        expect(born.playState).toBe("running");
        // A pending start time is the defect the explicit write removes: it
        // resolves at some later rendering update, and whatever separates the
        // two is a permanent horizontal offset for the whole epoch.
        expect(born.pending).toBe(false);
        expect(born.startTime).not.toBeNull();

        // ---- 3. Backing store matches the display -------------------------
        // Read before the scrolling, while every row is mounted.
        const mismatched = await app.evalJS<string[]>(
          `(function(){
             var out = [];
             var dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
             document.querySelectorAll(".tug-sparkline-canvas").forEach(function(c, i){
               var want = Math.ceil(parseFloat(c.style.width) * dpr);
               if (c.width !== want) out.push(i + ": " + c.width + " != " + want);
             });
             return out;
           })()`,
        );
        expect(mismatched).toEqual([]);
        note(
          "canvases checked",
          await app.evalJS<number>(
            `document.querySelectorAll(".tug-sparkline-canvas").length`,
          ),
        );

        // ---- 2. Three scroll cycles, one animation ------------------------
        const scrollTo = async (top: number): Promise<void> => {
          await app.evalJS<boolean>(
            `(function(){
               var el = ${RESOLVE_SCROLLER(spark)};
               if (el === null) return false;
               el.scrollTop = ${top};
               return true;
             })()`,
          );
        };
        note(
          "scroller",
          await app.evalJS<string>(
            `(function(){
               var el = ${RESOLVE_SCROLLER(spark)};
               return el === null ? "none" : (el.className || el.tagName);
             })()`,
          ),
        );
        const scrollable = await app.evalJS<number>(
          `(function(){
             var el = ${RESOLVE_SCROLLER(spark)};
             return el === null ? -1 : el.scrollHeight - el.clientHeight;
           })()`,
        );
        // The list has to actually overflow, or the cycles below would prove
        // nothing at all — a test that scrolls a list with nowhere to go is a
        // test that passes for the wrong reason. It also confirms the
        // component's own root resolution finds a real scroller here, which is
        // the premise the whole visibility gate rests on.
        expect(scrollable).toBeGreaterThan(0);

        const states: string[] = [];
        for (let cycle = 0; cycle < 3; cycle++) {
          await scrollTo(scrollable);
          // Dwell past the gate's out-of-view hysteresis, so a crossing that
          // really happened has time to become a pause. Without the dwell the
          // cycle would be indistinguishable from a flap — which the gate is
          // built to ignore — and the wake path would never run.
          await dwell(HYSTERESIS_DWELL_MS);
          states.push(String((await tapeState(app, spark))?.state));
          await scrollTo(0);
          await dwell(HYSTERESIS_DWELL_MS);
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(spark)}) !== null`,
            { timeoutMs: 10_000 },
          );
          const after = await scrollState(app, spark);
          expect(after.count).toBe(1);
          // The same object, not merely an equivalent one — a rebuild would
          // hand back a fresh `Animation` with no stamp on it.
          expect(after.stamp).toBe(born.stamp);
          // Never torn down. `idle` is what a cancelled animation reports, and
          // a cancelled `fill: forwards` effect is exactly what used to snap
          // the tape to `translateX(0)` over stale pixels.
          expect(after.playState).not.toBe("idle");
        }

        // Whether the observer actually fired is reported, not asserted:
        // rendering can be suspended in a background window, and the claim
        // above holds either way. When it did fire, these read `hidden-paused`
        // — which is the pause path having run for real.
        note("tape state while scrolled away", states.join(", "));
        note(
          "tape state after three scroll cycles",
          JSON.stringify(await tapeState(app, spark)),
        );

        // ---- 4. A stalled stream drains to baseline -----------------------
        // A real burst through the real store, then silence. What the pen is
        // holding has to fall back to zero on its own.
        for (let i = 0; i < 6; i++) {
          expect(await recordActivity(app, sid(0), 600)).toBe(true);
        }
        await app.waitForCondition<boolean>(
          `(function(){
             var s = window.__tug.sparklineTapeState(${JSON.stringify(spark)});
             return s !== null && s.lastV > 0.05;
           })()`,
          { timeoutMs: 10_000 },
        );
        const peak = await tapeState(app, spark);
        note("peak plotted value", peak?.lastV);

        // Nothing more is recorded. Past the rolling window plus a bin, every
        // bin the burst touched has aged out.
        await app.waitForCondition<boolean>(
          `(function(){
             var s = window.__tug.sparklineTapeState(${JSON.stringify(spark)});
             return s !== null && s.lastV === 0;
           })()`,
          { timeoutMs: DRAIN_WAIT_MS + 10_000 },
        );
        const drained = await tapeState(app, spark);
        expect(drained?.lastV).toBe(0);

        // …and the scroll came through all of it as the one animation it
        // started as.
        const final = await scrollState(app, spark);
        expect(final.count).toBe(1);
        expect(final.stamp).toBe(born.stamp);
      } finally {
        await app.close();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
