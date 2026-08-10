/**
 * at0384-session-tape-vertical.test.ts — the activity tape sits on ONE vertical
 * with respect to the three lines, whatever surface wears them.
 *
 * ## What this gates
 *
 * The tape reports on the PAIR beneath the title — the description and the
 * activity are one group, and the graph belongs to the group rather than to the
 * last line of it — so it reads centered on the two together. That is a single
 * rule, and the two surfaces that mount the three-level stack must land on it
 * identically. Only a browser at a real size can say whether they do.
 *
 *   A. **The masthead's tape is centered on its pair.** The tape's center is
 *      the midpoint of the description's top edge and the activity line's
 *      bottom edge, within a pixel.
 *
 *   B. **The Lens row's tape is centered on its pair**, by the same measure.
 *
 *   C. **The two agree.** Each mount's offset from its own pair's center is
 *      the same number — the assertion that makes A and B a RULE rather than
 *      two lifts that happen to be tuned. A future surface tuning its own lift
 *      breaks this even if it lands somewhere defensible on its own.
 *
 * The defect this pins: the lift was two hand-tuned numbers, one per surface,
 * and each was wrong in the opposite direction — the Lens sat 5px below the
 * pair's center, and the masthead, carrying a second `inset-block-start` of its
 * own on top of the row's transform, 4px above it. Nine pixels apart on two
 * surfaces drawing the same instrument for the same session.
 *
 * @covers tugdeck/src/components/tugways/tug-session-row.css
 * @covers tugdeck/src/components/tugways/session-masthead.css
 * @covers tugdeck/src/components/tugways/tug-pulse.css
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const PROJECT_DIR = "/Users/tester/src/tugtool";
const LENS_ROW = ".lens-cards-list .lens-cards-row[data-session-id]";

/** How far the tape's center may stand off the pair's, in CSS pixels. */
const CENTERING_TOLERANCE_PX = 1;
/** How far the two mounts' offsets may differ from each other. */
const AGREEMENT_TOLERANCE_PX = 0.5;

interface TapeGeometry {
  /** Midpoint of (description top → activity line bottom). */
  pairCenter: number;
  /** Midpoint of the tape's own box. */
  tapeCenter: number;
  /** Positive = the tape rides above the pair's center. */
  offset: number;
}

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "session", title: "Session", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 560 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/**
 * Measure one mount's pair and tape. The pair's span is deliberately taken from
 * the description's TOP and the activity run's BOTTOM — the two outer edges of
 * the group the tape belongs to — rather than from either line's own box, so
 * the measure survives a change to the leading between them.
 */
function measureJS(root: string): string {
  return `(function(){
    var row = document.querySelector(${JSON.stringify(root)});
    if (row === null) return null;
    function rect(sel){
      var el = row.querySelector(sel);
      return el === null ? null : el.getBoundingClientRect();
    }
    var desc = rect(".tug-session-row-description");
    var activity = rect(".tug-pulse-activity");
    var tape = rect(".tug-pulse-trailing");
    if (desc === null || activity === null || tape === null) return null;
    var pairCenter = (desc.top + activity.bottom) / 2;
    var tapeCenter = (tape.top + tape.bottom) / 2;
    return {
      pairCenter: Math.round(pairCenter * 100) / 100,
      tapeCenter: Math.round(tapeCenter * 100) / 100,
      offset: Math.round((pairCenter - tapeCenter) * 100) / 100,
    };
  })()`;
}

describe.skipIf(!SHOULD_RUN)("at0384 — the tape's vertical", () => {
  test(
    "the tape centers on the description/activity pair, identically on both mounts",
    async () => {
      const app = await launchTugApp({
        testName: "at0384-session-tape-vertical",
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.bindSession("A", {
          tugSessionId: SESSION_ID,
          projectDir: PROJECT_DIR,
        });
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            JSON.stringify({
              session_id: SESSION_ID,
              fields: {
                tag: "kooky-taper",
                name: "gazetteer",
                name_user_set: true,
              },
            }),
          )})`,
        );

        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(LENS_ROW)}) !== null`,
          { timeoutMs: 15_000 },
        );
        // Both mounts draw a tape only once the row has one to draw.
        await app.waitForCondition<boolean>(
          `(function(){
            var m = document.querySelector(".session-masthead-row .tug-pulse-trailing");
            var l = document.querySelector(${JSON.stringify(LENS_ROW)} + " .tug-pulse-trailing");
            return m !== null && l !== null;
          })()`,
          { timeoutMs: 10_000 },
        );

        // ---- A. The masthead. ---------------------------------------------
        const masthead = await app.evalJS<TapeGeometry>(
          measureJS(".session-masthead-row"),
        );
        note("masthead tape: " + JSON.stringify(masthead));
        expect(Math.abs(masthead.offset)).toBeLessThanOrEqual(
          CENTERING_TOLERANCE_PX,
        );

        // ---- B. The Lens row. ---------------------------------------------
        const lens = await app.evalJS<TapeGeometry>(measureJS(LENS_ROW));
        note("lens tape: " + JSON.stringify(lens));
        expect(Math.abs(lens.offset)).toBeLessThanOrEqual(
          CENTERING_TOLERANCE_PX,
        );

        // ---- C. And they agree, which is what makes it a rule. ------------
        expect(Math.abs(masthead.offset - lens.offset)).toBeLessThanOrEqual(
          AGREEMENT_TOLERANCE_PX,
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
