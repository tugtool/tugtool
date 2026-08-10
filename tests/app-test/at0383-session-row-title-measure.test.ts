/**
 * at0383-session-row-title-measure.test.ts — the session row's title elides
 * against the ROW'S OWN measure, and only when the row has actually run out.
 *
 * ## What this gates
 *
 * The title tier's grammar (name gives way, callsign never does) is settled and
 * pinned elsewhere. What this file gates is the WIDTH that grammar negotiates
 * against, which is only true in a browser at a real size.
 *
 *   A. **A long name elides, and the line is used to its last pixel.** The
 *      identity fills the title box it was handed; the name run takes what is
 *      left after the callsign, and the callsign is whole. Nothing overflows.
 *
 *   B. **A short name does not elide, and the title still has slack.** The
 *      same row, same width, a name that fits: no ellipsis anywhere, and the
 *      identity stands well inside the title. This is the assertion that makes
 *      A mean something — it says the elide in A is the width running out, not
 *      a mark that truncates unconditionally.
 *
 *   C. **The masthead's title does not overflow its box either.** It wraps the
 *      identity in its own span (the right-click-copies-the-atom handle), which
 *      is a second inline-level box in the same position and fails the same way.
 *
 * The defect this pins: the title's node rode inside `TugLabel`'s
 * `-webkit-line-clamp` box, and the identity inside it is `inline-flex` with
 * `white-space: nowrap` — an inline-level box is shrink-to-fit, and under nowrap
 * shrink-to-fit IS max-content. So the identity never saw the row's width: it
 * resolved at its content size (measured 536px of identity inside a 303px
 * title) and the name elided against a width that had nothing to do with the
 * row, truncating the mark with a third of the line standing empty beside it.
 *
 * @covers tugdeck/src/components/tugways/tug-session-row.css
 * @covers tugdeck/src/components/tugways/tug-session-row.tsx
 * @covers tugdeck/src/components/tugways/tug-session-identity.css
 * @covers tugdeck/src/components/tugways/session-masthead.css
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const PROJECT_DIR = "/Users/tester/src/tugtool";
const TAG = "kooky-taper";
/** Longer than any row in this deck is wide. */
const LONG_NAME =
  "gazetteer of imaginary places and the long road that leads to each of them";
/** Comfortably shorter than the row. */
const SHORT_NAME = "gazetteer";
const LENS_ROW = ".lens-cards-list .lens-cards-row[data-session-id]";

interface Box {
  w: number;
  scrollW: number;
}

interface RowGeometry {
  title: Box;
  identity: Box;
  name: Box;
  callsign: Box;
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

function sessionUpdated(fields: Record<string, unknown>): string {
  return JSON.stringify({ session_id: SESSION_ID, fields });
}

/** Measure a title line's four boxes under `root`. */
function measureJS(root: string): string {
  return `(function(){
    var row = document.querySelector(${JSON.stringify(root)});
    if (row === null) return null;
    function box(sel){
      var el = row.querySelector(sel);
      if (el === null) return null;
      var r = el.getBoundingClientRect();
      return { w: Math.round(r.width * 100) / 100, scrollW: el.scrollWidth };
    }
    return {
      title: box(".tug-list-row-title"),
      identity: box(".tug-session-identity"),
      name: box(".tug-session-identity-name"),
      callsign: box(".tug-session-identity-callsign"),
    };
  })()`;
}

describe.skipIf(!SHOULD_RUN)("at0383 — the row title elides against the row", () => {
  test(
    "a long name elides into the row's own measure; a short one leaves slack",
    async () => {
      const app = await launchTugApp({
        testName: "at0383-session-row-title-measure",
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.bindSession("A", {
          tugSessionId: SESSION_ID,
          projectDir: PROJECT_DIR,
        });

        const rename = async (name: string): Promise<void> => {
          await app.evalJS<boolean>(
            `window.__tug.publishSessionUpdated(${JSON.stringify(
              sessionUpdated({ tag: TAG, name, name_user_set: true }),
            )})`,
          );
          await app.waitForCondition<boolean>(
            `(function(){
              var row = document.querySelector(${JSON.stringify(LENS_ROW)});
              if (row === null) return false;
              var n = row.querySelector(".tug-session-identity-name");
              return n !== null && n.textContent === ${JSON.stringify(name)};
            })()`,
            { timeoutMs: 10_000 },
          );
        };

        await app.dispatchControlAction("toggle-lens");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(LENS_ROW)}) !== null`,
          { timeoutMs: 15_000 },
        );
        await rename(LONG_NAME);

        // ---- A. The long name elides into the row's real measure. ----------
        const long = await app.evalJS<RowGeometry>(measureJS(LENS_ROW));
        note("long name", long);
        // The identity is sized BY the title, not by its own content: the
        // defect showed as an identity wider than the box holding it.
        expect(long.identity.w).toBeCloseTo(long.title.w, 0);
        expect(long.identity.scrollW).toBeLessThanOrEqual(long.title.w + 1);
        // The name gives way...
        expect(long.name.scrollW).toBeGreaterThan(long.name.w + 1);
        // ...the callsign does not...
        expect(long.callsign.scrollW).toBeLessThanOrEqual(long.callsign.w + 1);
        // ...and between them they spend the whole line.
        expect(long.name.w + long.callsign.w).toBeCloseTo(long.identity.w, 0);

        // ---- B. A short name does not elide, and slack remains. ------------
        await rename(SHORT_NAME);
        const short = await app.evalJS<RowGeometry>(measureJS(LENS_ROW));
        note("short name", short);
        expect(short.name.scrollW).toBeLessThanOrEqual(short.name.w + 1);
        expect(short.callsign.scrollW).toBeLessThanOrEqual(short.callsign.w + 1);
        // The point of the pair: at the SAME row width, the short name is a
        // mark standing well inside a box with room left over. A row that
        // truncates with room is the bug this file exists for.
        expect(short.identity.w).toBeLessThan(short.title.w - 40);
        expect(short.title.w).toBeCloseTo(long.title.w, 0);

        // ---- C. The masthead's own wrapper does not overflow either. -------
        await rename(LONG_NAME);
        const masthead = await app.evalJS<RowGeometry>(
          measureJS(".session-masthead-row"),
        );
        note("masthead", masthead);
        expect(masthead.identity.scrollW).toBeLessThanOrEqual(
          masthead.title.w + 1,
        );
        expect(masthead.callsign.scrollW).toBeLessThanOrEqual(
          masthead.callsign.w + 1,
        );
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
