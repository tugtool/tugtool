/**
 * at0087-tug-badge-two-line.test.ts — `TugBadge` two-line label/content
 * presentation renders in the badge gallery card with the borrowed
 * status-bar legend typography and a width-stabilized slot ([AT0087]).
 *
 * ## Why this exists
 *
 * Step 0 of the dev-card / Claude-Code-parity plan adds a two-line
 * `TugBadge` variant (`layout="label-top" | "content-top"` + `label`)
 * that every Z4B chrome chip (permission-mode, model, rate-limit,
 * session) will consume. Because tugdeck has no DOM-rendering unit
 * layer (happy-dom is gone), the DOM shape, the visual stacking order,
 * the borrowed caption typography, and the reserved-slot width
 * stabilization are all verified here against the real app.
 *
 * ## Test matrix
 *
 * One gallery-badge card:
 *
 *   1. `label-top` row — each chip has a `.tug-badge-label` caption and a
 *      `.tug-badge-content` value; the caption sits visually ABOVE the
 *      value (label rect top < content rect top) even though the DOM
 *      order is label-first.
 *   2. `content-top` row — same DOM order, but the value sits visually
 *      above the caption (label rect top > content rect top), proving
 *      the order flip is CSS-driven, not DOM-reordered.
 *   3. Caption typography — the `.tug-badge-label` line is uppercase,
 *      weight 600, with non-zero letter-spacing: the status-bar legend
 *      discipline borrowed per Spec S02.
 *   4. Width-stabilized slot — toggling the rate-limit value between its
 *      narrow ("5h 23m") and wide ("rate-limited") faces does NOT change
 *      the reserved slot width ([R01]); the active text still changes.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 90_000;

const CARD = '[data-card-id="A"]';
const GALLERY = `${CARD} [data-testid="gallery-badge"]`;
const LABEL_TOP_ROW = `${CARD} [data-testid="badge-label-top-row"]`;
const CONTENT_TOP_ROW = `${CARD} [data-testid="badge-content-top-row"]`;
const STABLE_SLOT = `${CARD} [data-testid="badge-stable-slot"]`;
const STABLE_ACTIVE = `${CARD} [data-testid="badge-stable-active"]`;
const STABLE_TOGGLE = `${CARD} [data-testid="badge-stable-toggle"]`;

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-badge", title: "TugBadge", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 760, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["developer"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/**
 * For the first `.tug-badge` inside `rowSelector`, report whether its
 * caption line sits visually above its content line. Returns the two
 * rect tops so the caller can assert the ordering precisely.
 */
async function captionVsContentTop(
  app: App,
  rowSelector: string,
): Promise<{ labelTop: number; contentTop: number } | null> {
  return await app.evalJS<{ labelTop: number; contentTop: number } | null>(
    `(function(){
      var badge = document.querySelector(${JSON.stringify(rowSelector)} + ' .tug-badge');
      if (badge === null) return null;
      var label = badge.querySelector('.tug-badge-label');
      var content = badge.querySelector('.tug-badge-content');
      if (label === null || content === null) return null;
      return {
        labelTop: label.getBoundingClientRect().top,
        contentTop: content.getBoundingClientRect().top,
      };
    })()`,
  );
}

/** Computed caption typography for the first label-top chip. */
async function captionTypography(
  app: App,
): Promise<{ textTransform: string; fontWeight: string; letterSpacingPx: number } | null> {
  return await app.evalJS<
    { textTransform: string; fontWeight: string; letterSpacingPx: number } | null
  >(
    `(function(){
      var label = document.querySelector(${JSON.stringify(LABEL_TOP_ROW)} + ' .tug-badge .tug-badge-label');
      if (label === null) return null;
      var cs = getComputedStyle(label);
      var ls = parseFloat(cs.letterSpacing);
      return {
        textTransform: cs.textTransform,
        fontWeight: cs.fontWeight,
        letterSpacingPx: isNaN(ls) ? 0 : ls,
      };
    })()`,
  );
}

/** Reserved width of the width-stabilized slot, rounded to 1/100 px. */
async function slotWidth(app: App): Promise<number | null> {
  return await app.evalJS<number | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(STABLE_SLOT)});
      if (el === null) return null;
      return Math.round(el.getBoundingClientRect().width * 100) / 100;
    })()`,
  );
}

/** Trimmed text of the visible (active) chip in the stabilized slot. */
async function activeText(app: App): Promise<string | null> {
  return await app.evalJS<string | null>(
    `(function(){
      var el = document.querySelector(${JSON.stringify(STABLE_ACTIVE)});
      return el ? el.textContent.trim() : null;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "AT0087: TugBadge two-line layout renders with borrowed legend typography and a stable slot",
  () => {
    test(
      "label-top / content-top stacking, caption typography, and width-stabilized slot",
      async () => {
        const app = await launchTugApp({
          testName: "at0087-tug-badge-two-line",
        });
        try {
          await app.enableDeckTrace(true);
          await app.seedDeckState({ state: deckShape(), focusCardId: "A" });

          // The gallery-badge card mounts its showcase content.
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(GALLERY)}) !== null`,
            { timeoutMs: 6000 },
          );
          await app.waitForCondition<boolean>(
            `document.querySelector(${JSON.stringify(LABEL_TOP_ROW)} + ' .tug-badge .tug-badge-label') !== null`,
            { timeoutMs: 6000 },
          );

          // 1. label-top: caption sits visually ABOVE the value.
          const labelTopOrder = await captionVsContentTop(app, LABEL_TOP_ROW);
          expect(labelTopOrder, "label-top chip must have label + content lines").not.toBeNull();
          expect(
            labelTopOrder!.labelTop,
            "label-top: caption must sit above the value",
          ).toBeLessThan(labelTopOrder!.contentTop);

          // 2. content-top: same DOM order, value sits visually ABOVE the
          //    caption — the flip is CSS-driven, not DOM-reordered.
          const contentTopOrder = await captionVsContentTop(app, CONTENT_TOP_ROW);
          expect(contentTopOrder, "content-top chip must have label + content lines").not.toBeNull();
          expect(
            contentTopOrder!.labelTop,
            "content-top: caption must sit below the value",
          ).toBeGreaterThan(contentTopOrder!.contentTop);

          // 3. Borrowed status-bar legend typography on the caption line.
          const type = await captionTypography(app);
          expect(type, "caption typography must be readable").not.toBeNull();
          expect(type!.textTransform, "caption is uppercase").toBe("uppercase");
          expect(type!.fontWeight, "caption is weight 600").toBe("600");
          expect(
            type!.letterSpacingPx,
            "caption is letter-spaced (0.08em tracking → > 0 px)",
          ).toBeGreaterThan(0);

          // 4. Width-stabilized slot: cycling the value must not move the
          //    reserved width, but the active text must change.
          const widthBefore = await slotWidth(app);
          const textBefore = await activeText(app);
          expect(widthBefore, "stabilized slot must have a width").not.toBeNull();
          expect(textBefore, "stabilized slot must show a value").not.toBeNull();

          await app.click(STABLE_TOGGLE);
          await app.waitForCondition<boolean>(
            `(function(){
              var el = document.querySelector(${JSON.stringify(STABLE_ACTIVE)});
              return el !== null && el.textContent.trim() !== ${JSON.stringify(textBefore)};
            })()`,
            { timeoutMs: 4000 },
          );

          const widthAfter = await slotWidth(app);
          const textAfter = await activeText(app);
          expect(textAfter, "toggling must change the displayed value").not.toBe(textBefore);
          expect(
            widthAfter,
            "[R01]: cycling the rate-limit value must not shift the reserved slot width",
          ).toBe(widthBefore);
        } catch (err) {
          const tail = app.tailLog(200);
          if (tail !== "") {
            process.stderr.write(
              `\n[at0087-tug-badge-two-line] log tail:\n${tail}\n`,
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
