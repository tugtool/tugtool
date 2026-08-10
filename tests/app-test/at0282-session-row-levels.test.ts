/**
 * at0282-session-row-levels.test.ts — a session reads at three levels, and the
 * activity is what gives way.
 *
 * A session's row is title → description → activity, and two surfaces wear that
 * shape from one authoring: the card's masthead in pane chrome and the Lens row
 * in the rail. Both compose `TugSessionRow`, so a claim proved on one is a claim
 * the other cannot contradict by construction — what is left to prove is the
 * geometry, and geometry is only true in a browser at a real width.
 *
 *   1. **The activity band is ONE line, in every state.** A fixed height on both
 *      cards, whatever each has to say — a band that grew with its content would
 *      move every card in the pane beneath it. Measured on two cards with
 *      different content at the same moment, so the number cannot be a
 *      coincidence of one card's beat.
 *
 *   2. **The activity is the run that gives way.** A beat far too long for the
 *      line is shortened in the middle — keeping what is running and what it is
 *      running on — rather than clipping the line's other content. Invisible to
 *      anything but a real browser at a real width.
 *
 *   3. **Three levels, and the row does not resize.** A Lens row shows exactly
 *      three lines, and a sibling row in the same list at the same moment with
 *      DIFFERENT content shows three of the same height. There is no fourth
 *      level: the standing-goal line left both surfaces, so a headline run
 *      appearing here is the retired form coming back.
 *
 *   4. **The row's geometry, in the shipping `inset` fit.** The phase dot rides
 *      ON the title line — it reports the session's phase and the title says
 *      which session — so the TITLE starts one dot-advance in while both lines
 *      beneath it start at the row's own inset and keep the whole leading
 *      column. The two lower lines share one vertical; the title deliberately
 *      does not. The dot is CENTERED on the title line rather than topped out
 *      with it: its box is one em inside a line box taller than one em.
 *
 *   5. **The activity does not run under the tape.** It holds the sparkline as a
 *      flex item and stops short of it by layout — the tape is taller than the
 *      line box it rides and lifted above it besides, so a run reaching the
 *      tape's leading edge is a run printed under a graph.
 *
 *   6. **No `PULSE` ink.** The word is an internal name — stores, modules, and
 *      class names keep it; nothing a reader sees says it. Asserted over the
 *      rendered text of both surfaces, which is where a stand-in would show.
 *
 * **The frames are real, the commentator is not.** `publishPulseFrame` hands the
 * store bytes in the emitter's own shape and they go through the production
 * `parsePulseFrame` and the production folds — the same path the wire takes,
 * minus a shared agent and a live session to summarize. `parsePulseFrame` drops
 * a malformed body silently, so every assertion below reads rendered output;
 * none trusts the publish call's return.
 *
 * `at0280-shared-agent-absent.test.ts` pins the no-model posture. The two tests
 * must never disagree.
 *
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/components/tugways/session-masthead.css
 * @covers tugdeck/src/components/lens/sections/cards-session-cell.tsx
 * @covers tugdeck/src/components/tugways/tug-pulse.tsx
 * @covers tugdeck/src/components/tugways/tug-pulse.css
 * @covers tugdeck/src/components/tugways/session-identity-row.tsx
 * @covers tugdeck/src/components/tugways/tug-session-row.tsx
 * @covers tugdeck/src/components/tugways/tug-session-row.css
 * @covers tugdeck/src/lib/pulse-store.ts
 * @covers tugdeck/src/test-surface.ts
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, type App } from "./_harness";
import { mkTempTugbank, rmTempTugbank, seedTugbankForLaunch } from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

// UUID-shaped so the bound sessions read as real ones.
const SID_A = "a7c0d1ea-0000-4000-8000-000000000282";
const SID_B = "a7c0d1ea-0000-4000-8000-000000000283";

// The card's activity line lives in its pane chrome, on the masthead — so these
// are scoped by pane rather than by card element. Each pane here holds one card
// and that card is active, so a pane's masthead is that card's voice.
const CARD_A = '.tug-pane[data-pane-id="p1"]';
const BAND_A = `${CARD_A} [data-slot="session-masthead"] .tug-pulse`;
const ACTIVITY_A = `${CARD_A} [data-slot="tug-pulse-activity"]`;
const CARD_B = '.tug-pane[data-pane-id="p2"]';
const BAND_B = `${CARD_B} [data-slot="session-masthead"] .tug-pulse`;

const MASTHEAD_A = `${CARD_A} [data-slot="session-masthead"]`;

const lensRow = (sid: string): string =>
  `.lens-cards-list .session-row-content[data-session-id="${sid}"]`;

/**
 * The activity band's fixed height — ONE line, in every state.
 *
 * The stacked layout's height is its lines', so with one level this is the
 * line's own box rather than the inline bar's `--tugx-pulse-bar-height`. The
 * number is asserted on two cards with different content at the same moment, so
 * a drift shows as a mismatch rather than as a new constant.
 */
const STRIP_HEIGHT = 16;

/**
 * A beat far too long for the line. It has to give way; that is claim 2.
 */
const LONG_ACTIVITY =
  "Read(tugrust/crates/tugcast/src/feeds/session_overview.rs) then " +
  "Edit(tugdeck/src/components/tugways/session-masthead.tsx) then " +
  "Bash(cd tugrust && cargo nextest run -p tugcast --no-fail-fast)";

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "session", title: "Session A", closable: true },
      { id: "B", componentId: "session", title: "Session B", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 20, y: 20 },
        size: { width: 900, height: 400 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
      {
        id: "p2",
        position: { x: 20, y: 440 },
        size: { width: 900, height: 400 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

async function count(app: App, selector: string): Promise<number> {
  return app.evalJS<number>(
    `document.querySelectorAll(${JSON.stringify(selector)}).length`,
  );
}

/** Rounded measured height of the first match, or -1 when it is absent. */
async function heightOf(app: App, selector: string): Promise<number> {
  return app.evalJS<number>(
    `(function(){
       var el = document.querySelector(${JSON.stringify(selector)});
       return el === null ? -1 : Math.round(el.getBoundingClientRect().height);
     })()`,
  );
}

/**
 * Whether a run gave way, by either of the two mechanisms `TugPulse` has: an
 * overflowing box taking the CSS ellipsis, or a middle truncation that shortens
 * the text and then FITS — where overflow alone would read as untruncated.
 */
async function isTruncated(app: App, selector: string): Promise<boolean> {
  return app.evalJS<boolean>(
    `(function(){
       var el = document.querySelector(${JSON.stringify(selector)});
       if (el === null) return false;
       return el.dataset.truncated === "true" || el.scrollWidth > el.clientWidth;
     })()`,
  );
}

/** How many of the row's three levels actually rendered. */
async function lensLineCount(app: App, sid: string): Promise<number> {
  const row = lensRow(sid);
  return app.evalJS<number>(
    `(function(){
       var el = document.querySelector(${JSON.stringify(row)});
       if (el === null) return -1;
       return el.querySelectorAll(
         ".tug-session-row-name-line, .tug-session-row-description, .tug-pulse-line"
       ).length;
     })()`,
  );
}

/**
 * A Lens row's geometry, in one read: the left edge of each of its three
 * levels, and the center of the phase dot against the center of the title line.
 */
async function lensRowGeometry(
  app: App,
  sid: string,
): Promise<{
  nameLeft: number;
  descLeft: number;
  activityLeft: number;
  dotCenter: number;
  nameLineCenter: number;
} | null> {
  return app.evalJS<{
    nameLeft: number;
    descLeft: number;
    activityLeft: number;
    dotCenter: number;
    nameLineCenter: number;
  } | null>(
    `(function(){
       var row = document.querySelector(${JSON.stringify(lensRow(sid))});
       if (row === null) return null;
       var name = row.querySelector(".tug-session-row-name-line .tug-list-row-title");
       var desc = row.querySelector(".tug-session-row-description");
       var activity = row.querySelector('[data-slot="tug-pulse-activity"]');
       var nameLine = row.querySelector(".tug-session-row-name-line");
       var dot = row.querySelector(".tug-session-row-dot");
       if (name === null || desc === null || activity === null) return null;
       if (nameLine === null || dot === null) return null;
       /* The INK's left, not the box's: the two lower lines take their indent as
          padding, so a box read would report them starting at the row's own edge
          whether the indent applied or not. */
       var inkLeft = function (el) {
         return el.getBoundingClientRect().left
           + (parseFloat(getComputedStyle(el).paddingInlineStart) || 0);
       };
       return {
         nameLeft: name.getBoundingClientRect().left,
         descLeft: inkLeft(desc),
         activityLeft: activity.getBoundingClientRect().left,
         dotCenter: dot.getBoundingClientRect().top + dot.getBoundingClientRect().height / 2,
         nameLineCenter: nameLine.getBoundingClientRect().top + nameLine.getBoundingClientRect().height / 2,
       };
     })()`,
  );
}

/**
 * Where a Lens row's activity run ends, and where its tape begins. The tape is
 * taller than the line box it rides and lifted above it besides, so a run that
 * reaches the tape's left edge is a run printed under a graph.
 */
async function lensTrailingGeometry(
  app: App,
  sid: string,
): Promise<{ activityRight: number; sparkLeft: number } | null> {
  return app.evalJS<{ activityRight: number; sparkLeft: number } | null>(
    `(function(){
       var row = document.querySelector(${JSON.stringify(lensRow(sid))});
       if (row === null) return null;
       var activity = row.querySelector('[data-slot="tug-pulse-activity"]');
       var spark = row.querySelector('[data-slot="tug-sparkline"]');
       if (activity === null || spark === null) return null;
       return {
         activityRight: activity.getBoundingClientRect().right,
         sparkLeft: spark.getBoundingClientRect().left,
       };
     })()`,
  );
}

/** The rendered height of a Lens session row — the thing that must not move. */
async function lensRowHeight(app: App, sid: string): Promise<number> {
  return app.evalJS<number>(
    `(function(){
       var el = document.querySelector(${JSON.stringify(lensRow(sid))});
       if (el === null) return -1;
       return Math.round(el.getBoundingClientRect().height);
     })()`,
  );
}

/** Publish one PULSE frame in the emitter's own shape. */
async function publishPulse(
  app: App,
  body: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(JSON.stringify(body));
  await app.evalJS<boolean>(`window.__tug.publishPulseFrame(${json})`);
}

describe.skipIf(!SHOULD_RUN)("AT0282: a session reads at three levels", () => {
  test(
    "one activity band, the activity gives way, and a row's three levels do not resize",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at0282-session-row-levels",
        env: { TUGBANK_PATH: tugbankPath },
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        // Bound, not resumed: the band and the Lens row are what this pins, and
        // neither needs a live agent behind them.
        await app.bindSession("A", { tugSessionId: SID_A });
        await app.bindSession("B", { tugSessionId: SID_B });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(BAND_A)}) !== null` +
            ` && document.querySelector(${JSON.stringify(BAND_B)}) !== null`,
          { timeoutMs: 20_000 },
        );

        // Baseline: no frames yet, so the line carries the session's own rest
        // facts rather than a placeholder word — and the band already measures
        // its one line.
        expect(await heightOf(app, BAND_A)).toBe(STRIP_HEIGHT);
        // No standing-goal level on either surface: it left chrome with the
        // three-level stack, so this is an absence, not an emptiness.
        expect(
          await count(app, `${CARD_A} [data-slot="tug-pulse-headline"]`),
        ).toBe(0);

        // Session A gets a beat far too long for its line; session B gets a
        // short one, so it stays the control for every height claim below.
        await publishPulse(app, {
          type: "pulse",
          text: LONG_ACTIVITY,
          scopes: [SID_A],
          beat: 1,
          at: 1_700_000_000_000,
        });
        await publishPulse(app, {
          type: "pulse",
          text: "Bash(cargo build)",
          scopes: [SID_B],
          beat: 1,
          at: 1_700_000_000_002,
        });
        await app.waitForCondition<boolean>(
          `(document.querySelector(${JSON.stringify(ACTIVITY_A)})
             || { textContent: "" }).textContent.indexOf("session_overview") !== -1`,
          { timeoutMs: 10_000 },
        );

        // 1. Still ONE row, on both cards. The card with the short beat measures
        //    the same, so the height is the band's own rather than a coincidence
        //    of this card's content.
        expect(await heightOf(app, BAND_A)).toBe(STRIP_HEIGHT);
        expect(await heightOf(app, BAND_B)).toBe(STRIP_HEIGHT);

        // 2. The activity gave way.
        expect(await isTruncated(app, ACTIVITY_A)).toBe(true);

        // 6. No `PULSE` ink on the masthead — the word is an internal name.
        expect(
          await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(MASTHEAD_A)})
               || { innerText: "" }).innerText`,
          ),
        ).not.toContain("PULSE");

        // 3. The Lens tells the same story, stacked.
        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(lensRow(SID_A))}) !== null` +
            ` && document.querySelector(${JSON.stringify(lensRow(SID_B))}) !== null`,
          { timeoutMs: 10_000 },
        );
        expect(await lensLineCount(app, SID_A)).toBe(3);
        // The sibling row, same list, same moment, different content: exactly
        // the same three levels at exactly the same height.
        expect(await lensLineCount(app, SID_B)).toBe(3);
        expect(await lensRowHeight(app, SID_A)).toBe(
          await lensRowHeight(app, SID_B),
        );
        expect(
          await count(app, `${lensRow(SID_A)} [data-slot="tug-pulse-headline"]`),
        ).toBe(0);
        // And no `PULSE` ink in the rail either.
        expect(
          await app.evalJS<string>(
            `(document.querySelector(${JSON.stringify(lensRow(SID_A))})
               || { innerText: "" }).innerText`,
          ),
        ).not.toContain("PULSE");

        // 4. The row's geometry, in the shipping `inset` fit.
        const geo = await lensRowGeometry(app, SID_A);
        expect(geo).not.toBeNull();
        expect(Math.abs(geo!.activityLeft - geo!.descLeft)).toBeLessThan(0.51);
        expect(geo!.nameLeft).toBeGreaterThan(geo!.descLeft + 4);
        expect(Math.abs(geo!.dotCenter - geo!.nameLineCenter)).toBeLessThan(0.51);

        // 5. The activity stops short of the tape. Measured on the row whose
        //    beat is short enough that only LAYOUT can be holding it back — a
        //    truncated run would stop short for its own reasons.
        const trailing = await lensTrailingGeometry(app, SID_B);
        expect(trailing).not.toBeNull();
        expect(trailing!.sparkLeft).toBeGreaterThan(0);
        expect(trailing!.activityRight).toBeLessThan(trailing!.sparkLeft);
      } finally {
        await app.close();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
