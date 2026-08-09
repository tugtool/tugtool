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
 * Nothing here hangs off an animation: background app-test windows run no
 * rAF, so every assertion reads settled geometry.
 *
 * @covers tugdeck/src/components/tugways/session-masthead.tsx
 * @covers tugdeck/src/components/tugways/session-masthead.css
 * @covers tugdeck/src/components/chrome/tug-pane.tsx
 * @covers tugdeck/src/components/tugways/tug-pane.css
 * @covers tugdeck/src/components/tugways/tug-sheet.css
 * @covers tugdeck/src/lib/card-title-store.ts
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
        // the two lines below it do not move when a rename lands.
        const descHeight = await app.evalJS<number>(
          `(function(){
            var el = document.querySelector(
              ${JSON.stringify(MASTHEAD)} + ' .session-masthead-description');
            return el === null ? -1 : Math.round(el.getBoundingClientRect().height);
          })()`,
        );
        expect(descHeight).toBeGreaterThan(0);

        // The Z2 PULSE strip is gone, and the voice speaks in exactly one
        // place. Asserted here rather than in a test of its own because "the
        // strip is absent" and "the masthead has the PULSE" are one claim:
        // either alone would pass while the voice spoke twice or not at all.
        const voices = await app.evalJS<{ strips: number; mastheadPulse: number }>(
          `({
            strips: document.querySelectorAll(
              '[data-slot="session-pulse-strip"]').length,
            mastheadPulse: document.querySelectorAll(
              ${JSON.stringify(MASTHEAD)} + ' .session-masthead-pulse').length,
          })`,
        );
        expect(voices.strips).toBe(0);
        expect(voices.mastheadPulse).toBe(1);

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
});
