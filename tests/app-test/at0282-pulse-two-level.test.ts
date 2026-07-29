/**
 * at0282-pulse-two-level.test.ts — the PULSE reads at two levels, and the
 * right one gives way.
 *
 * The PULSE carries a session's standing goal over the operation running right
 * now. Two surfaces render that pair: the session card's strip in one line
 * (**S1** — headline, `›`, activity) and the Lens row stacked (**L1** — the
 * goal on its own line between the session name and the activity). Three
 * claims here, and every one of them is a layout fact no unit test can reach:
 *
 *   1. **One row, not two.** The strip carries both levels on a single 34px
 *      line whether or not a goal exists — no second row, no reserved height.
 *      The old shape put the overview on a row of its own; this pins that it
 *      is gone rather than merely unused.
 *   2. **The activity is what truncates.** Give a session a short goal and a
 *      very long activity and the activity ellipsizes while the headline
 *      renders whole. This is the entire reason the headline is flex-pinned,
 *      and the failure it prevents — a goal clipped to make room for a file
 *      path — is invisible to anything but a real browser at a real width.
 *   3. **A level nobody wrote still holds its line.** A session with no
 *      overview shows the same three lines in the Lens as the one beside it
 *      that has one, with `PULSE` standing in for the goal — so rows do not
 *      resize themselves as sessions come and go quiet. Measured against a
 *      present sibling in the same list at the same moment, so "it holds"
 *      cannot pass by the feature being broken outright.
 *
 * **The frames are real, the commentator is not.** `publishPulseFrame` hands
 * the store bytes in the emitter's own shape and they go through the
 * production `parsePulseFrame` and the production folds — the same path the
 * wire takes, minus a downloaded model and a live session to summarize.
 * `parsePulseFrame` drops a malformed body silently, so every assertion below
 * reads rendered output; none trusts the publish call's return.
 *
 * `at0280-local-model-absent.test.ts` pins the opposite posture — no model,
 * therefore no goal anywhere. The two tests must never disagree.
 *
 * @covers tugdeck/src/components/tugways/cards/session-pulse-strip.tsx
 * @covers tugdeck/src/components/lens/sections/sessions-section.tsx
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

const CARD_A = '[data-card-id="A"]';
const STRIP_A = `${CARD_A} [data-slot="session-pulse-strip"]`;
const HEADLINE_A = `${CARD_A} [data-slot="tug-pulse-headline"]`;
const ACTIVITY_A = `${CARD_A} [data-slot="tug-pulse-activity"]`;
const CARD_B = '[data-card-id="B"]';
const STRIP_B = `${CARD_B} [data-slot="session-pulse-strip"]`;

const lensRow = (sid: string): string =>
  `.lens-sessions-list .session-row-content[data-session-id="${sid}"]`;
const lensIntent = (sid: string): string =>
  `${lensRow(sid)} [data-slot="tug-pulse-headline"]`;

/** The strip's fixed band height — one line, in every state. */
const STRIP_HEIGHT = 34;

/**
 * A goal short enough to fit the strip whole at any sane card width, so a
 * headline that ellipsizes is a real failure and not a narrow window.
 */
const GOAL = "Wiring overview cadence gate";

/**
 * An activity far too long for the line. It has to lose against the headline;
 * that is claim 2.
 */
const LONG_ACTIVITY =
  "Read(tugrust/crates/tugcast/src/feeds/session_overview.rs) then " +
  "Edit(tugdeck/src/components/tugways/cards/session-pulse-strip.tsx) then " +
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
 * Whether a run is ellipsized: its content is wider than the box drawn for it.
 * The only honest read of "this is the run that got cut".
 */
/**
 * Whether a run gave way, by either of the two mechanisms `TugPulse` has.
 * The headline overflows its box and takes the CSS ellipsis; the activity is
 * shortened in the middle and then FITS, so overflow alone would read it as
 * untruncated — `data-truncated` is the signal there.
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

/** How many of the row's three candidate lines actually rendered. */
async function lensLineCount(app: App, sid: string): Promise<number> {
  const row = lensRow(sid);
  return app.evalJS<number>(
    `(function(){
       var el = document.querySelector(${JSON.stringify(row)});
       if (el === null) return -1;
       return el.querySelectorAll(
         ".session-row-headline, .tug-pulse-line"
       ).length;
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

/**
 * Publish one PULSE frame in the emitter's own shape. `kind: "overview"` files
 * it as the session's standing goal; without it the body is an ordinary beat.
 */
async function publishPulse(
  app: App,
  body: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(JSON.stringify(body));
  await app.evalJS<boolean>(`window.__tug.publishPulseFrame(${json})`);
}

describe.skipIf(!SHOULD_RUN)("AT0282: the PULSE reads at two levels", () => {
  test(
    "S1 keeps one row and truncates the activity; L1 keeps three lines whether or not there is a goal",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at0282-pulse-two-level",
        env: { TUGBANK_PATH: tugbankPath },
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        // Bound, not resumed: the strip and the Lens row are what this pins,
        // and neither needs a live agent behind them.
        await app.bindSession("A", { tugSessionId: SID_A });
        await app.bindSession("B", { tugSessionId: SID_B });
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(STRIP_A)}) !== null` +
            ` && document.querySelector(${JSON.stringify(STRIP_B)}) !== null`,
          { timeoutMs: 20_000 },
        );

        // Baseline: no frames yet, so neither card has a headline and the
        // strip already measures its one band.
        expect(await count(app, HEADLINE_A)).toBe(0);
        expect(await heightOf(app, STRIP_A)).toBe(STRIP_HEIGHT);

        // Session A gets both levels; session B gets only a beat, so it stays
        // the control for every absence claim below.
        await publishPulse(app, {
          type: "pulse",
          text: LONG_ACTIVITY,
          scopes: [SID_A],
          beat: 1,
          at: 1_700_000_000_000,
        });
        await publishPulse(app, {
          type: "pulse",
          kind: "overview",
          text: GOAL,
          scopes: [SID_A],
          beat: 1,
          at: 1_700_000_000_001,
        });
        await publishPulse(app, {
          type: "pulse",
          text: "Bash(cargo build)",
          scopes: [SID_B],
          beat: 1,
          at: 1_700_000_000_002,
        });

        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(HEADLINE_A)}) !== null`,
          { timeoutMs: 10_000 },
        );

        // 1. The headline carries what was published, and the strip is still
        //    ONE row — the old overview row is gone, not merely empty, and the
        //    band did not grow to hold a second level.
        expect(
          await app.evalJS<string>(
            `document.querySelector(${JSON.stringify(HEADLINE_A)}).textContent`,
          ),
        ).toBe(GOAL);
        expect(
          await count(app, `${CARD_A} [data-slot="session-pulse-overview"]`),
        ).toBe(0);
        expect(await heightOf(app, STRIP_A)).toBe(STRIP_HEIGHT);
        // The card with no goal measures the same, so the height above is the
        // band's own, not a coincidence of this card's content.
        expect(await heightOf(app, STRIP_B)).toBe(STRIP_HEIGHT);

        // 2. The activity is the run that gave way. Both halves matter: an
        //    assertion that only the activity truncates would also pass if
        //    nothing rendered at all.
        expect(await isTruncated(app, ACTIVITY_A)).toBe(true);
        expect(await isTruncated(app, HEADLINE_A)).toBe(false);

        // 3. The Lens tells the same story stacked, and only where there is a
        //    goal to tell.
        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(lensRow(SID_A))}) !== null` +
            ` && document.querySelector(${JSON.stringify(lensRow(SID_B))}) !== null`,
          { timeoutMs: 10_000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(lensIntent(SID_A))}) !== null`,
          { timeoutMs: 10_000 },
        );
        expect(
          await app.evalJS<string>(
            `document.querySelector(${JSON.stringify(lensIntent(SID_A))}).textContent`,
          ),
        ).toBe(GOAL);
        expect(await lensLineCount(app, SID_A)).toBe(3);
        // The sibling row, same list, same moment: no goal published, and yet
        // exactly the same three lines — the intent line stands in rather than
        // collapsing, which is what keeps the row from changing height.
        expect(await count(app, lensIntent(SID_B))).toBe(1);
        expect(
          await app.evalJS<string>(
            `document.querySelector(${JSON.stringify(lensIntent(SID_B))}).textContent`,
          ),
        ).toBe("PULSE");
        expect(await lensLineCount(app, SID_B)).toBe(3);
        expect(await lensRowHeight(app, SID_A)).toBe(
          await lensRowHeight(app, SID_B),
        );
      } finally {
        await app.close();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
