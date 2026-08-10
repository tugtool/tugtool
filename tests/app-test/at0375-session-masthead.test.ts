/**
 * at0375-session-masthead.test.ts — the Session card's second chrome tier.
 *
 * ## What this gates
 *
 * The masthead is a geometry event, and every claim below is about pixels in
 * a live pane — none of it is reachable from a unit test.
 *
 *   A. **The masthead is exactly `--tug-masthead-height` tall, and only a
 *      card that asks for it gets one.** A fixed tier, never content-driven:
 *      if the height tracked its content, every pulse would move the card
 *      beneath it.
 *
 *   B. **The surfaces that seat below the title bar seat below the
 *      MASTHEAD.** The scrim, the sheet's clip, and the banner all measured
 *      against a 36px chrome before this; at 36 the scrim dims the masthead's
 *      own bottom half. The scrim and the sheet clip are MEASURED `top` reads
 *      against a raised sheet — measured rather than inferred from
 *      `--tugx-pane-chrome-height`, because a regression that re-hardcodes
 *      `var(--tug-chrome-height)` leaves the property reading 72 and the
 *      surface seating at 36, which a property assertion cannot see. The
 *      banner is the one re-point left on the property alone: raising a real
 *      pane banner needs a genuine transport error, and staging one here
 *      would import a second subsystem's failure path to assert a `top`.
 *      The sheet's *bottom* is deliberately not asserted — the in-pane clamp
 *      measures the clip rect, so it follows the clip top for free and an
 *      assertion there would pass whether or not the work was done.
 *
 *   C. **Chrome follows the FRONTMOST tab, both directions.** A pane stacking
 *      [Session, Text] wears 72 on the Session tab and 36 on the Text tab. And
 *      the tab row stays 36 across the swap: the masthead and the tab bar
 *      stack rather than merging, so a masthead pane's chrome is 72 + 36. Four
 *      of the eight `--tug-chrome-height` sites were deliberately left alone
 *      for exactly this, and this is what proves they were.
 *
 *   D. **The swap does not cost the content region its React identity.**
 *      Scroll the Text tab, switch away and back, and the scroll survives.
 *      This is pinning an invariant rather than guarding a live hazard —
 *      `.tug-pane-content` is an empty ref'd div that cards portal into, so a
 *      chrome branch has no card subtree to re-key and the failure is
 *      structurally out of reach today. It costs one assertion and it turns
 *      "the pane portals its content" into a contract with a failing test
 *      behind it.
 *
 *   E. **The three lines are one block, and there are exactly three.** They
 *      share a left edge — the TITLE's, not the dot's in front of it — the
 *      title line seats where a one-line title bar seats its title, the
 *      telemetry widget stands on that same row as the pane's own controls, and
 *      the tape holds the trailing edge with the activity run reaching it.
 *      The dot in front of them emits its ring past its own box, so nothing
 *      between it and the title bar may clip, and the bar's leading padding
 *      has to be deep enough to hold the ring's full reach.
 *      Every one of these is a claim about pixels in a live pane against real
 *      content, so the test drives a real beat through the production pulse
 *      parser rather than measuring an empty band.
 *
 *   F. **The width control is absent from a masthead pane, and nothing else in
 *      the cluster is.** Written as an ABSENCE assertion on that one testid,
 *      never as an equality check on the cluster's button list — which is
 *      legitimately longer or shorter depending on whether the Session card
 *      stands in a stack. The stack badge in particular is asserted PRESENT on
 *      a stacked Session card: it describes the slot rather than the card, and
 *      it is the only way into the panes behind it.
 *
 * Nothing here hangs off an animation: background app-test windows run no
 * rAF, so every assertion reads settled geometry.
 *
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/components/tugways/session-masthead.css
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/components/tugways/tug-pane.css
 * @covers tugdeck/src/components/tugways/tug-sheet.css
 * @covers tugdeck/src/lib/card-title-store.ts
 * @covers tugdeck/src/components/tugways/tug-session-identity.tsx
 * @covers tugdeck/src/components/tugways/tug-session-identity.css
 * @covers tugdeck/src/components/tugways/tug-session-row.tsx
 * @covers tugdeck/src/components/tugways/tug-session-row.css
 * @covers tugdeck/src/components/tugways/tug-pulse.css
 * @covers tugdeck/src/components/tugways/pulse-beat-text.tsx
 * @covers tugdeck/src/components/tugways/pulse-beat-text.css
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const SESSION_ID = "f6e43925-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const TAG = "stocky-pixie";
const MASTHEAD_HEIGHT = 72;
const CHROME_HEIGHT = 36;

/** Long enough that every line has to give way somewhere. */
const SYNOPSIS =
  "Rework how a session names itself across the masthead, the Lens, and every surface that cites one";
/**
 * Long enough that the activity run has to give way at ANY pane width this test
 * uses — the tape-gap assertion can only be read off a run that was actually
 * cut, so a beat that happened to fit would make it vacuous.
 */
const ACTIVITY =
  "Running rg -n 'session-masthead' /Users/somebody/src/project/tugdeck/src/components/tugways /Users/somebody/src/project/tugdeck/src/components/chrome /Users/somebody/src/project/tests/app-test | head -40";

/**
 * The most air permitted between a TRUNCATED activity run and the tape beside
 * it: the component's own trailing gap, the tape trigger's hover padding, and
 * a character of search granularity in the middle truncation. Past that the
 * run gave up width nothing is using — which is what the reader sees as a
 * sentence that stopped early for no reason.
 */
const TAPE_GAP_MAX = 24;

const PANE = '.tug-pane[data-pane-id="p1"]';
const TITLE_BAR = `${PANE} [data-slot="tug-pane-title-bar"]`;
const MASTHEAD = `${PANE} [data-slot="session-masthead"]`;
const SCRIM = `${PANE} [data-testid="tug-pane-scrim"]`;
const TAB_ROW = `${PANE} .tug-tab-bar`;
/** The Z4B AI chip — the cheapest way to raise a real sheet on this card. */
const AI_CHIP = '[data-card-id="S"] [data-slot="ai-chip"]';
const SHEET_CLIP = `${PANE} .tug-sheet-clip`;
const SHEET_CANCEL = '[data-slot="ai-config-sheet"] [data-slot="ai-config-cancel"]';

function deckShape(cardIds: string[], activeCardId: string) {
  return {
    cards: [
      { id: "S", componentId: "session", title: "Session", closable: true },
      { id: "T", componentId: "text", title: "File", closable: true },
    ].filter((c) => cardIds.includes(c.id)),
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 620 },
        cardIds,
        activeCardId,
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/**
 * The Session pane and a second pane piled into ONE numbered slot — the shape
 * that raises the stack badge. Mismatched widths deliberately: two panes of
 * equal width leave the buried one fully occluded, and its badge then computes
 * `visibility: hidden` (at0347's variant), which is not the state this asserts.
 */
function slotStackShape() {
  return {
    cards: [
      { id: "S", componentId: "session", title: "Session", closable: true },
      { id: "G", componentId: "gallery-input", title: "Input", closable: true },
    ],
    panes: [
      {
        id: "p0",
        position: { x: 40, y: 40 },
        size: { width: 520, height: 500 },
        cardIds: ["G"],
        activeCardId: "G",
        title: "",
        acceptsFamilies: ["maker"],
        slot: 0,
      },
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 420, height: 500 },
        cardIds: ["S"],
        activeCardId: "S",
        title: "",
        acceptsFamilies: ["maker"],
        slot: 0,
      },
    ],
    activePaneId: "p1",
    imposition: { kind: "three-up", lens: "right" },
    hasFocus: true,
  };
}

/** The `session_updated` frame the supervisor pushes after a ledger write. */
function sessionUpdated(fields: Record<string, unknown>): string {
  return JSON.stringify({ session_id: SESSION_ID, fields });
}

/**
 * The TIER height of `sel` — its computed `height`, which is the content box.
 * Deliberately not `getBoundingClientRect().height`: the title bar carries a
 * 1px divider below it, so its border box is always the tier plus one, and
 * asserting on that would be asserting the divider rather than the tier. The
 * one-line bar has exactly the same relationship.
 */
function tierHeight(sel: string): string {
  return `parseFloat(
    getComputedStyle(document.querySelector(${JSON.stringify(sel)})).height,
  )`;
}

/** `getBoundingClientRect().top` of `sel`, relative to the pane's own top. */
function topWithinPane(sel: string): string {
  return `(function(){
    var pane = document.querySelector(${JSON.stringify(PANE)});
    var el = document.querySelector(${JSON.stringify(sel)});
    if (pane === null || el === null) return -1;
    return Math.round(
      el.getBoundingClientRect().top - pane.getBoundingClientRect().top,
    );
  })()`;
}

describe.skipIf(!SHOULD_RUN)("at0375 — the Session card's masthead", () => {
  test(
    "72px tier, in-pane surfaces seat below it, and chrome follows the active tab",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0375-"));
      const file = path.join(dir, "alpha.txt");
      // Long enough that the Text card's content actually scrolls.
      fs.writeFileSync(
        file,
        Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n"),
        "utf8",
      );
      const app = await launchTugApp({ testName: "at0375-session-masthead" });
      try {
        await app.seedDeckState({
          state: deckShape(["S"], "S"),
          focusCardId: "S",
        });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: dir,
        });
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({ tag: TAG, name: null, name_user_set: false }),
          )})`,
        );

        // ---- A. The tier is exactly 72, and the masthead is in it. ---------
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 15_000 },
        );
        const barHeight = await app.evalJS<number>(tierHeight(TITLE_BAR));
        expect(barHeight).toBe(MASTHEAD_HEIGHT);

        // The callsign reads on the lead line, through the shipping component.
        const leadText = await app.evalJS<string>(
          `(function(){
            var el = document.querySelector(
              ${JSON.stringify(MASTHEAD)} + ' [data-slot="tug-session-identity"]');
            return el === null ? "" : (el.textContent || "");
          })()`,
        );
        expect(leadText).toContain(TAG);

        // The description line holds its place even with nothing to say, so
        // the line below it does not move when a description lands.
        const descHeight = await app.evalJS<number>(
          `(function(){
            var el = document.querySelector(
              ${JSON.stringify(MASTHEAD)} + ' .tug-session-row-description');
            return el === null ? -1 : Math.round(el.getBoundingClientRect().height);
          })()`,
        );
        expect(descHeight).toBeGreaterThan(0);

        // ---- Exactly one dot and exactly three text rows. ------------------
        // Three levels, not four: the standing-goal level left chrome, so a
        // headline line reappearing here is the retired form coming back.
        const shape = await app.evalJS<{
          dots: number;
          titles: number;
          descriptions: number;
          activities: number;
          headlines: number;
        }>(
          `(function(){
            var m = document.querySelector(${JSON.stringify(MASTHEAD)});
            var n = function(sel){ return m.querySelectorAll(sel).length; };
            return {
              dots: n('[data-slot="tug-progress-indicator"]'),
              titles: n('.tug-session-row-name-line'),
              descriptions: n('.tug-session-row-description'),
              activities: n('[data-slot="tug-pulse-activity"]'),
              headlines: n('[data-slot="tug-pulse-headline"]'),
            };
          })()`,
        );
        note("masthead shape", JSON.stringify(shape));
        expect(shape.dots).toBe(1);
        expect(shape.titles).toBe(1);
        expect(shape.descriptions).toBe(1);
        expect(shape.activities).toBe(1);
        expect(shape.headlines).toBe(0);

        // The Z2 PULSE strip is gone, and the voice speaks in exactly one
        // place. Asserted here rather than in a test of its own because "the
        // strip is absent" and "the masthead has the voice" are one claim:
        // either alone would pass while the voice spoke twice or not at all.
        const strips = await app.evalJS<number>(
          `document.querySelectorAll('[data-slot="session-pulse-strip"]').length`,
        );
        expect(strips).toBe(0);

        // ---- F. No width control on a masthead pane. -----------------------
        // An ABSENCE assertion on that one testid. Never an equality check on
        // the cluster's button list: it is legitimately longer when the Session
        // card stands in a stack, and shorter when the card contributes no
        // section menu.
        const widthButtons = await app.evalJS<number>(
          `document.querySelectorAll(
             ${JSON.stringify(PANE)} +
             ' [data-testid="tug-pane-title-bar-width-button"]').length`,
        );
        expect(widthButtons).toBe(0);
        // The close X is still there, so the absence above is the control
        // leaving rather than the whole cluster failing to render.
        const closeButtons = await app.evalJS<number>(
          `document.querySelectorAll(
             ${JSON.stringify(PANE)} +
             ' [data-testid="tug-pane-title-bar-controls"] button').length`,
        );
        expect(closeButtons).toBeGreaterThan(0);

        // ---- B. The scrim seats below the masthead, not below 36. ----------
        const scrimTop = await app.evalJS<number>(topWithinPane(SCRIM));
        // The pane's 1px chrome border sits between the frame top and the
        // chrome's content origin, so the seat is the tier plus that border.
        expect(scrimTop).toBeGreaterThanOrEqual(MASTHEAD_HEIGHT);
        expect(scrimTop).toBeLessThanOrEqual(MASTHEAD_HEIGHT + 2);

        // The pane publishes the tier as a custom property, and the two
        // remaining re-points resolve through it.
        const chromeVar = await app.evalJS<string>(
          `getComputedStyle(document.querySelector(${JSON.stringify(PANE)}))
             .getPropertyValue('--tugx-pane-chrome-height').trim()`,
        );
        expect(chromeVar).toBe(`${MASTHEAD_HEIGHT}px`);

        // The sheet clip, MEASURED — not inferred from the property above.
        // The distinction is the whole point: a regression that re-hardcodes
        // `var(--tug-chrome-height)` in `tug-sheet.css` leaves the property
        // reading 72px and the clip seating at 36, so the property assertion
        // alone would stay green while the sheet climbed over the masthead.
        // The AI config chip opens a real sheet on this real Session card,
        // which is the cheapest in-pane sheet to raise.
        await app.click(AI_CHIP);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET_CLIP)}) !== null`,
          { timeoutMs: 8000 },
        );
        const clipTop = await app.evalJS<number>(topWithinPane(SHEET_CLIP));
        // `calc(var(--tugx-pane-chrome-height) + 1px)` — the tier plus the
        // chrome's 1px border, the same relationship the scrim has.
        expect(clipTop).toBeGreaterThanOrEqual(MASTHEAD_HEIGHT);
        expect(clipTop).toBeLessThanOrEqual(MASTHEAD_HEIGHT + 2);
        note("sheet clip top within pane", clipTop);

        await app.click(SHEET_CANCEL);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SHEET_CLIP)}) === null`,
          { timeoutMs: 8000 },
        );

        // ---- C. Chrome follows the frontmost tab, both directions. ---------
        await app.seedDeckState({
          state: deckShape(["S", "T"], "S"),
          cardStates: {
            T: { content: { path: file, anchor: { line: 1, ch: 0 }, scrollTop: 0 } },
          },
          focusCardId: "S",
        });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: dir,
        });
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({ tag: TAG, name: null, name_user_set: false }),
          )})`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TAB_ROW)}) !== null
             && document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 15_000 },
        );

        const onSession = await app.evalJS<{ bar: number; tabs: number }>(
          `({ bar: ${tierHeight(TITLE_BAR)}, tabs: ${tierHeight(TAB_ROW)} })`,
        );
        // 72 + 36 stacked, NOT 72 merged: the four tab-bar sites left on
        // `--tug-chrome-height` are what keep the second number 36.
        expect(onSession.bar).toBe(MASTHEAD_HEIGHT);
        expect(onSession.tabs).toBe(CHROME_HEIGHT);

        // Scroll the Text tab's content before switching away — the state D
        // asserts survives the swap.
        await app.evalJS<null>('(window.__tug.activateCard("T"), null)');
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) === null`,
          { timeoutMs: 8_000 },
        );
        const onText = await app.evalJS<{ bar: number; tabs: number; chromeVar: string }>(
          `({
            bar: ${tierHeight(TITLE_BAR)},
            tabs: ${tierHeight(TAB_ROW)},
            chromeVar: getComputedStyle(
              document.querySelector(${JSON.stringify(PANE)}),
            ).getPropertyValue('--tugx-pane-chrome-height').trim(),
          })`,
        );
        expect(onText.bar).toBe(CHROME_HEIGHT);
        expect(onText.tabs).toBe(CHROME_HEIGHT);
        expect(onText.chromeVar).toBe(`${CHROME_HEIGHT}px`);

        // And the width control is BACK on the non-masthead tab of the very same
        // pane. This is the flip [D132] records as accepted rather than a bug —
        // and it is what proves the suppression is a condition on the active
        // card's masthead rather than the control having been deleted.
        const widthOnText = await app.evalJS<number>(
          `document.querySelectorAll(
             ${JSON.stringify(PANE)} +
             ' [data-testid="tug-pane-title-bar-width-button"]').length`,
        );
        expect(widthOnText).toBe(1);

        // ---- D. The swap keeps the content region's mount identity. --------
        const scroller = '[data-card-id="T"] .cm-scroller';
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(scroller)}) !== null`,
          { timeoutMs: 8_000 },
        );
        await app.evalJS<number>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(scroller)});
            el.scrollTop = 600;
            return el.scrollTop;
          })()`,
        );
        const before = await app.evalJS<number>(
          `document.querySelector(${JSON.stringify(scroller)}).scrollTop`,
        );
        expect(before).toBeGreaterThan(0);

        // Away to the 72px tier and back to the 36px one.
        await app.evalJS<null>('(window.__tug.activateCard("S"), null)');
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 8_000 },
        );
        await app.evalJS<null>('(window.__tug.activateCard("T"), null)');
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) === null`,
          { timeoutMs: 8_000 },
        );
        const after = await app.evalJS<number>(
          `(function(){
            var el = document.querySelector(${JSON.stringify(scroller)});
            return el === null ? -1 : el.scrollTop;
          })()`,
        );
        expect(after).toBe(before);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the three lines share one left edge, seat on the pane's own title row, and give the PULSE every pixel up to the tape",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0375b-"));
      const app = await launchTugApp({
        testName: "at0375-session-masthead-lines",
      });
      try {
        await app.seedDeckState({
          state: deckShape(["S"], "S"),
          focusCardId: "S",
        });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: dir,
        });
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({
              tag: TAG,
              name: null,
              name_user_set: false,
              synopsis: SYNOPSIS,
            }),
          )})`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 15_000 },
        );

        // A real beat, through the production parser and folds — the masthead
        // cannot be measured with its runs empty. No overview: the standing-goal
        // level left chrome, so publishing one would exercise nothing here.
        await app.evalJS<boolean>(
          `window.__tug.publishPulseFrame(${JSON.stringify(
            JSON.stringify({
              type: "pulse",
              text: ACTIVITY,
              scopes: [SESSION_ID],
              beat: 2,
              at: 1_700_000_000_001,
            }),
          )})`,
        );
        await app.waitForCondition<boolean>(
          `(document.querySelector(
             ${JSON.stringify(MASTHEAD)} + ' [data-slot="tug-pulse-activity"]')
             || { textContent: "" }).textContent.length > 0`,
          { timeoutMs: 8_000 },
        );

        // ---- One left edge for all three lines. ---------------------------
        // The description and the activity start at the TITLE, not at the dot
        // in front of it — three lines on two verticals read as a stack that
        // was assembled rather than set.
        const edges = await app.evalJS<{
          run: number;
          desc: number;
          pulse: number;
          mark: number;
        }>(
          `(function(){
            var m = document.querySelector(${JSON.stringify(MASTHEAD)});
            /* The INK's left edge, not the box's: the row indents its sub-lines
               with padding, so a box read would report the row's own edge and
               pass no matter where the text landed. */
            var left = function(sel){
              var el = m.querySelector(sel);
              if (el === null) return -1;
              var pad = parseFloat(
                getComputedStyle(el).paddingInlineStart,
              ) || 0;
              return Math.round(el.getBoundingClientRect().left + pad);
            };
            return {
              run: left('.tug-session-identity-run'),
              desc: left('.tug-session-row-description'),
              pulse: left('.tug-pulse-stage'),
              mark: left('.tug-session-row-dot'),
            };
          })()`,
        );
        note("masthead left edges", JSON.stringify(edges));
        expect(edges.desc).toBe(edges.run);
        expect(edges.pulse).toBe(edges.run);
        // And the mark really is out to the left of them — otherwise the three
        // could agree by the inset having quietly become zero.
        expect(edges.mark).toBeLessThan(edges.run);

        // ---- Nothing clips the dot's ring. --------------------------------
        // The glyph EMITS its ring past its own box — at the masthead's 16px
        // it travels to 1.75x — so any clip between the dot and the title bar
        // takes a bite out of the ring on every breath. Asserted as the two
        // things that make the overhang safe: no clipping ancestor, and the
        // ring's full reach landing inside the bar's leading padding. The
        // reach is read off the glyph's own published variable rather than
        // retyped, so a geometry change moves the assertion with it.
        const ring = await app.evalJS<{
          clip: string[];
          ringLeft: number;
          barLeft: number;
        }>(
          `(function(){
            var m = document.querySelector(${JSON.stringify(MASTHEAD)});
            var bar = document.querySelector(${JSON.stringify(TITLE_BAR)});
            var dot = m.querySelector(
              '[data-slot="tug-progress-pulsing-dot"]');
            var cs = getComputedStyle(dot);
            var size = parseFloat(cs.getPropertyValue(
              '--tugx-progress-pulsing-dot-size')) || 0;
            var reach = parseFloat(cs.getPropertyValue(
              '--tugx-progress-pulsing-dot-emit-reach-auto')) || 1;
            var clip = [];
            for (var el = dot; el !== null && el !== bar.parentNode;
                 el = el.parentElement) {
              var o = getComputedStyle(el).overflowX;
              if (o !== 'visible') clip.push(el.className + ' -> ' + o);
            }
            var r = dot.getBoundingClientRect();
            return {
              clip: clip,
              ringLeft: Math.round(r.left + r.width / 2 - (size * reach) / 2),
              barLeft: Math.round(bar.getBoundingClientRect().left),
            };
          })()`,
        );
        note("dot ring vs clips", JSON.stringify(ring));
        expect(ring.clip).toEqual([]);
        expect(ring.ringLeft).toBeGreaterThanOrEqual(ring.barLeft);

        // ---- The title line seats on the pane's own title row. ------------
        // Its box centers in the FIRST chrome band, exactly where a one-line
        // title bar seats its title and where the pane's controls already sit.
        const seat = await app.evalJS<{ lead: number; height: number }>(
          `(function(){
            var bar = document.querySelector(${JSON.stringify(TITLE_BAR)});
            var lead = bar.querySelector('.tug-session-row-name-line');
            var r = lead.getBoundingClientRect();
            return {
              lead: Math.round(r.top - bar.getBoundingClientRect().top),
              height: Math.round(r.height),
            };
          })()`,
        );
        note("lead line seat", JSON.stringify(seat));
        const expectedSeat = Math.round((CHROME_HEIGHT - seat.height) / 2);
        expect(Math.abs(seat.lead - expectedSeat)).toBeLessThanOrEqual(1);

        // ---- The telemetry widget stands on that same row. ----------------
        const widget = await app.evalJS<{ widget: number; controls: number }>(
          `(function(){
            var pane = document.querySelector(${JSON.stringify(PANE)});
            var mid = function(sel){
              var el = pane.querySelector(sel);
              if (el === null) return -1;
              var r = el.getBoundingClientRect();
              return Math.round(r.top + r.height / 2);
            };
            return {
              widget: mid('[data-slot="session-masthead-widget"]'),
              controls: mid('.tug-pane-title-bar-controls .tug-button'),
            };
          })()`,
        );
        note("widget vs controls center", JSON.stringify(widget));
        expect(Math.abs(widget.widget - widget.controls)).toBeLessThanOrEqual(1);

        // ---- The tape is flush right, and the run reaches it. -------------
        // The sparkline holds the trailing edge and the activity gets everything
        // else: a truncated activity that stops well short of the tape has
        // thrown away width nothing else is using.
        const band = await app.evalJS<{
          slack: number;
          tapeGap: number;
          truncated: boolean;
        }>(
          `(function(){
            var m = document.querySelector(${JSON.stringify(MASTHEAD)});
            var pulse = m.querySelector('.tug-pulse');
            var tape = pulse.querySelector('.tug-pulse-trailing');
            var run = pulse.querySelector('[data-slot="tug-pulse-activity"]');
            var pr = pulse.getBoundingClientRect();
            var tr = tape.getBoundingClientRect();
            var rr = run.getBoundingClientRect();
            return {
              slack: Math.round(pr.right - tr.right),
              tapeGap: Math.round(tr.left - rr.right),
              truncated: run.dataset.truncated === "true",
            };
          })()`,
        );
        note("pulse band", JSON.stringify(band));
        // The tape sits at the line's trailing edge.
        expect(band.slack).toBeLessThanOrEqual(2);
        // A truncated run is the only case this can be read from: an activity
        // that fits leaves whatever slack it likes.
        expect(band.truncated).toBe(true);
        expect(band.tapeGap).toBeLessThanOrEqual(TAPE_GAP_MAX);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a stacked Session card keeps its slot badge and still has no width control",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0375c-"));
      const app = await launchTugApp({
        testName: "at0375-session-masthead-stack",
      });
      try {
        await app.seedDeckState({
          state: slotStackShape(),
          focusCardId: "S",
        });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: dir,
        });
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({ tag: TAG, name: null, name_user_set: false }),
          )})`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 15_000 },
        );

        // The badge describes the SLOT, not the card, and it is the only way
        // into the panes behind this one — so suppressing the width control must
        // not have taken it along. Written as two counts on two testids, never
        // as an equality check on the cluster's button list.
        const controls = await app.evalJS<{ badge: number; width: number }>(
          `({
            badge: document.querySelectorAll(
              ${JSON.stringify(PANE)} +
              ' [data-testid="tug-pane-title-bar-stack-badge"]').length,
            width: document.querySelectorAll(
              ${JSON.stringify(PANE)} +
              ' [data-testid="tug-pane-title-bar-width-button"]').length,
          })`,
        );
        note("stacked masthead controls", JSON.stringify(controls));
        expect(controls.badge).toBe(1);
        expect(controls.width).toBe(0);

        // And the badge is actually visible rather than merely mounted: the
        // Session pane is the narrower of the pair, so it is not occluded.
        const visible = await app.evalJS<string>(
          `getComputedStyle(document.querySelector(
             ${JSON.stringify(PANE)} +
             ' [data-testid="tug-pane-title-bar-stack-badge"]')).visibility`,
        );
        expect(visible).toBe("visible");
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the Session Summary panel keys its rows and clips neither chip",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0375e-"));
      const app = await launchTugApp({
        testName: "at0375-session-summary",
      });
      try {
        await app.seedDeckState({ state: deckShape(["S"], "S"), focusCardId: "S" });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: dir,
        });
        // A name long enough that the atom cannot fit the panel's value column.
        // The whole claim here is about what happens THEN: a chip that runs out
        // of room elides its own run inside its own border, and a panel that
        // clips it instead is the regression.
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({
              tag: TAG,
              name: "rework how a session names itself across every surface",
              name_user_set: true,
            }),
          )})`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 15_000 },
        );

        await app.click(`${PANE} [data-slot="session-masthead-widget"]`);
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-slot="session-masthead-telemetry"]') !== null`,
          { timeoutMs: 5000 },
        );

        // The panel says what it is.
        const title = await app.getElementText(
          '[data-slot="session-masthead-telemetry"] .tug-popup-list-title-text',
        );
        expect(title).toBe("Session Summary");

        // The gallery's row set, in the gallery's order, keyed rather than
        // sentence-cased. CREATED reads COMPACTED for a `/compact`-born
        // session, which is the same rung wearing the other verb.
        const labels = await app.evalJS<string[]>(
          `Array.from(document.querySelectorAll(
             '[data-slot="session-masthead-telemetry"] .session-masthead-telemetry-label'),
           ).map(function(el){ return el.textContent || ""; })`,
        );
        note("summary labels", labels.join(" / "));
        expect(labels).toEqual([
          "STATE",
          "TURNS",
          "CREATED",
          "BRANCH",
          "ATOM",
          "CITATION",
        ]);

        // Nothing sticks out of the panel. Measured against the panel's own
        // padding box, which is what the reader sees as its edge.
        const fit = await app.evalJS<{
          panel: number;
          atomRight: number;
          citationRight: number;
          atomLeft: number;
          panelLeft: number;
          elided: boolean;
          badges: number;
          citationMono: boolean;
          citationCut: boolean;
          citationSize: string;
        }>(
          `(function(){
            var panel = document.querySelector('[data-slot="session-masthead-telemetry"]');
            var pr = panel.getBoundingClientRect();
            var atom = panel.querySelector('.session-masthead-telemetry-atom');
            var cite = panel.querySelector('.session-masthead-telemetry-citation');
            var run = atom.querySelector('.tug-session-identity-callsign')
              || atom.querySelector('.tug-session-identity-name');
            return {
              panel: Math.round(pr.right),
              panelLeft: Math.round(pr.left),
              atomRight: Math.round(atom.getBoundingClientRect().right),
              atomLeft: Math.round(atom.getBoundingClientRect().left),
              citationRight: Math.round(cite.getBoundingClientRect().right),
              // Flat text, not a chip: exactly ONE enclosure in the pair, and
              // it belongs to the atom. A badge here put a bordered, tinted,
              // icon-bearing box on the quieter of the two rows.
              badges: panel.querySelectorAll('.tug-copy-badge, .tug-badge').length,
              citationMono: getComputedStyle(cite).fontFamily.indexOf('Mono') >= 0,
              // The citation is the panel's longest line and the one fact a
              // reader is here to take away — the panel is sized so it fits
              // whole rather than ending in an ellipsis mid-id.
              citationCut: cite.scrollWidth > cite.clientWidth,
              citationSize: getComputedStyle(cite).fontSize,
              // The chip gave way inside its own border rather than being cut.
              elided: run.scrollWidth > run.clientWidth,
            };
          })()`,
        );
        note("summary fit", JSON.stringify(fit));
        expect(fit.atomRight).toBeLessThanOrEqual(fit.panel);
        expect(fit.citationRight).toBeLessThanOrEqual(fit.panel);
        expect(fit.atomLeft).toBeGreaterThanOrEqual(fit.panelLeft);
        expect(fit.elided).toBe(true);
        expect(fit.badges).toBe(0);
        expect(fit.citationMono).toBe(true);
        expect(fit.citationCut).toBe(false);

        // ---- The two copyable rows each carry a COPY, and only those two. ---
        const copies = await app.evalJS<string[]>(
          `Array.from(document.querySelectorAll(
             '[data-slot="session-masthead-telemetry"] .session-masthead-telemetry-row'),
           ).map(function(row){
             var key = (row.querySelector('.session-masthead-telemetry-label').textContent || "");
             var btn = row.querySelector('[data-slot="session-masthead-telemetry-copy"]');
             return key + "=" + (btn === null ? "-" : (btn.getAttribute('aria-label') || "?"));
           })`,
        );
        note("summary copies", copies.join(" | "));
        // And each one sits BESIDE its value, not out at the panel's edge.
        // The gap is measured against the row's own column gap; a button
        // parked on the right edge leaves a run of empty panel between the
        // fact and the control that copies it.
        const gaps = await app.evalJS<number[]>(
          `Array.from(document.querySelectorAll(
             '[data-slot="session-masthead-telemetry"] ' +
             '.session-masthead-telemetry-row:has([data-slot="session-masthead-telemetry-copy"])'),
           ).map(function(row){
             var v = row.querySelector('.session-masthead-telemetry-value').getBoundingClientRect();
             var b = row.querySelector('[data-slot="session-masthead-telemetry-copy"]')
               .getBoundingClientRect();
             return Math.round(b.left - v.right);
           })`,
        );
        note("copy gaps", JSON.stringify(gaps));
        expect(gaps).toHaveLength(2);
        for (const gap of gaps) {
          expect(gap).toBeGreaterThanOrEqual(0);
          expect(gap).toBeLessThanOrEqual(16);
        }
        expect(copies).toEqual([
          "STATE=-",
          "TURNS=-",
          "CREATED=-",
          "BRANCH=-",
          "ATOM=Copy session atom",
          "CITATION=Copy session citation",
        ]);

        // And the atom answers RIGHT-CLICK with a Copy of its own — the
        // gesture every Tug chip carries, which here writes the atom's whole
        // flavor set (citation on `text/plain`, the sidecar beside it) rather
        // than the visible string. The harness cannot read a custom clipboard
        // flavor (see at0376), so what is pinned here is that the chip inside
        // this popover CLAIMS the gesture: a menu with an enabled Copy. The
        // popover is opened with `dismissOnChainActivity={false}` precisely so
        // this copy does not dismiss the panel out from under itself.
        // Dispatched rather than driven from the mouse, exactly as at0376 does
        // it: what is under test is the chip's own `onContextMenu`, and a
        // trusted right-click inside a portaled popover in a background window
        // is a second subsystem this assertion has no business depending on.
        await app.evalJS<null>(`(function(){
          var chip = document.querySelector(
            '[data-slot="session-masthead-telemetry"] .session-masthead-telemetry-atom');
          var r = chip.getBoundingClientRect();
          chip.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: Math.round(r.left + r.width / 2),
            clientY: Math.round(r.top + r.height / 2),
          }));
          return null;
        })()`);
        await app.waitForCondition<boolean>(
          `document.querySelector('[data-slot="tug-editor-context-menu"]') !== null`,
          { timeoutMs: 8000 },
        );
        const menu = await app.evalJS<{ items: string[]; panel: number }>(
          `(function(){
            var menu = document.querySelector('[data-slot="tug-editor-context-menu"]');
            return {
              items: Array.from(menu.querySelectorAll('[role="menuitem"]'))
                .filter(function(el){ return el.getAttribute('aria-disabled') !== 'true'; })
                .map(function(el){ return (el.textContent || "").trim(); }),
              // The panel is still up: the copy must not dismiss what it was
              // launched from.
              panel: document.querySelectorAll(
                '[data-slot="session-masthead-telemetry"]').length,
            };
          })()`,
        );
        note("atom context menu", JSON.stringify(menu));
        expect(menu.items.some((item) => item.includes("Copy"))).toBe(true);
        expect(menu.panel).toBe(1);
        await app.nativeKey("Escape");

        // ---- The ATOM button writes the ATOM, not the citation. ------------
        //
        // Clicked for real, then read back off the REAL pasteboard through the
        // production parser — the two functions the editor's own paste handler
        // calls. A `text/plain`-only write would still look right in every
        // assertion above and in any paste outside Tug; the sidecar is the
        // whole difference between pasting a chip and pasting a string, and it
        // is invisible unless something reads the private flavor.
        await app.click(
          `[data-slot="session-masthead-telemetry"] ` +
            `.session-masthead-telemetry-row[data-enclosed="true"] ` +
            `[data-slot="session-masthead-telemetry-copy"]`,
        );
        await app.evalJS<null>(
          `(window.__at0375sidecar = undefined,
            window.__tug.readClipboardAtoms().then(function (r) {
              window.__at0375sidecar = JSON.stringify(r);
            }),
            null)`,
        );
        await app.waitForCondition<boolean>(
          `window.__at0375sidecar !== undefined`,
          { timeoutMs: 8000 },
        );
        const sidecar = JSON.parse(
          await app.evalJS<string>(`window.__at0375sidecar`),
        ) as {
          text: string;
          atoms: Array<{ type: string; label: string; value: string }>;
        } | null;
        note("atom button sidecar", JSON.stringify(sidecar));
        expect(sidecar).not.toBeNull();
        expect(sidecar?.atoms).toHaveLength(1);
        expect(sidecar?.atoms[0]?.type).toBe("session");
        expect(sidecar?.atoms[0]?.label).toContain(TAG);
        expect(sidecar?.atoms[0]?.value).toBe(sidecar?.atoms[0]?.label);
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "clicking the pulse line opens its history without flashing the title bar",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at0375d-"));
      const app = await launchTugApp({
        testName: "at0375-session-masthead-flash",
      });
      try {
        await app.seedDeckState({ state: deckShape(["S"], "S"), focusCardId: "S" });
        await app.bindSession("S", {
          tugSessionId: SESSION_ID,
          projectDir: dir,
        });
        await app.evalJS<boolean>(
          `window.__tug.publishSessionUpdated(${JSON.stringify(
            sessionUpdated({ tag: TAG, name: null, name_user_set: false }),
          )})`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MASTHEAD)}) !== null`,
          { timeoutMs: 15_000 },
        );

        // Sampled across the click rather than read after it. The regression
        // this guards was a TRANSIENT: a `:hover` wash on the line rose over
        // its transition and faded straight back out, because opening the
        // history popover takes `:hover` off everything outside the popover
        // while the cursor never moves. Both endpoints read transparent; only
        // the ~100ms between them ever showed the tint, which is precisely
        // what a reader sees as the title bar flashing under the pointer.
        // 16ms ticks on `setInterval`, never rAF — a background app-test
        // window runs no rAF at all.
        await app.evalJS<boolean>(
          `(function(){
            var stage = document.querySelector('.session-masthead-stage');
            window.__washes = [];
            window.__washId = setInterval(function(){
              window.__washes.push(getComputedStyle(stage).backgroundColor);
            }, 16);
            return true;
          })()`,
        );
        const point = await app.evalJS<{ x: number; y: number }>(
          `(function(){
            var b = document.querySelector('.session-masthead-stage')
              .getBoundingClientRect();
            return {
              x: Math.round(b.left + b.width / 3),
              y: Math.round(b.top + b.height / 2),
            };
          })()`,
        );
        await app.nativeClick(point, { activateFirst: false });
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('[data-radix-popper-content-wrapper]').length > 0`,
          { timeoutMs: 5000 },
        );
        // The popover mounting is not the end of the window: the wash faded
        // over the transition AFTER hover was revoked, so the samples that
        // caught the regression are the ones taken past this point.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const washes = await app.evalJS<string[]>(
          `(function(){ clearInterval(window.__washId); return window.__washes; })()`,
        );
        // Every sample is a fully transparent color, whatever notation the
        // engine chose for it: `rgba(0, 0, 0, 0)` at rest, `oklab(… / 0)` once
        // a transition has ever touched the property.
        const painted = washes.filter(
          (w) => !/\/\s*0\)$/.test(w) && w !== "rgba(0, 0, 0, 0)" && w !== "transparent",
        );
        note("pulse-line wash samples", `${washes.length} (painted: ${painted.length})`);
        if (painted.length > 0) note("painted wash", painted.join(" | "));
        expect(painted).toEqual([]);

        // ---- And the PRESS pose, which is the loud one. -------------------
        // `TugSessionRow` is a list row, and a list row answers pointer-down
        // with an accent layer. Here the row IS the chrome tier, so that layer
        // filled the entire title bar accent-blue on every press — including
        // the press that starts a card drag, which is most of them.
        //
        // Read on the ROW's `::after` while the button is genuinely down, and
        // that detail is the whole test: the press is `:active`, which no
        // synthetic event produces, and the layer is a pseudo-element, which
        // `getComputedStyle(el)` does not report. A probe that polled the
        // row's own computed style across a click saw nothing at all.
        await app.nativeKey("Escape");
        const barPoint = await app.evalJS<{ x: number; y: number }>(
          `(function(){
            var b = document.querySelector(${JSON.stringify(TITLE_BAR)})
              .getBoundingClientRect();
            return {
              x: Math.round(b.left + b.width * 0.6),
              y: Math.round(b.top + b.height / 2),
            };
          })()`,
        );
        await app.nativeMouseDown(barPoint);
        try {
          const press = await app.evalJS<{ active: boolean; bg: string; opacity: string }>(
            `(function(){
              var row = document.querySelector(
                ${JSON.stringify(MASTHEAD)} + ' .tug-list-row');
              var cs = getComputedStyle(row, '::after');
              return {
                active: row.matches(':active'),
                bg: cs.backgroundColor,
                opacity: cs.opacity,
              };
            })()`,
          );
          note("masthead row press layer", JSON.stringify(press));
          // The press must actually be in force, or the assertion below is
          // vacuous — this is the guard that keeps the test honest.
          expect(press.active).toBe(true);
          expect(press.bg).toMatch(/\/\s*0\)$|^rgba\(0, 0, 0, 0\)$|^transparent$/);
        } finally {
          await app.nativeMouseUp(barPoint);
        }
      } finally {
        await app.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
