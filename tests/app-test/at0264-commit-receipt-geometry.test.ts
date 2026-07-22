import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const CARD_ID = "A";

function deckSeed(componentId: string) {
  return {
    state: {
      cards: [{ id: CARD_ID, componentId, title: componentId, closable: true }],
      panes: [
        {
          id: "p1",
          position: { x: 40, y: 40 },
          size: { width: 520, height: 680 },
          cardIds: [CARD_ID],
          activeCardId: CARD_ID,
          title: "",
          acceptsFamilies: ["maker"],
        },
      ],
      activePaneId: "p1",
      hasFocus: true,
    },
    focusCardId: CARD_ID,
  };
}

describe.skipIf(!SHOULD_RUN)("AT0264 commit-receipt header geometry", () => {
  test("measure baselines + bottom space", async () => {
    const app = await launchTugApp({ testName: "at0264-commit-receipt-geometry" });
    try {
      await app.seedDeckState(deckSeed("gallery-commit-receipt"));
      await app.waitForCondition<boolean>(
        `document.querySelector('[data-card-id="A"] [data-testid="commit-receipt-wrapping"] .commit-receipt-summary') !== null`,
        { timeoutMs: 8000 },
      );
      const m = await app.evalJS<{
        firstLineOffset: number;
        wrapped: boolean;
        topGap: number;
        botGap: number;
        gapAsymmetry: number;
        text: string;
        hasBody: boolean;
      }>(
        `(function(){
          var root = document.querySelector('[data-card-id="A"] [data-testid="commit-receipt-wrapping"]');
          var header = root.querySelector('.tool-call-header');
          var name = root.querySelector('.tool-call-header-name');
          var summary = root.querySelector('.commit-receipt-summary');
          function lines(el){ var rg=document.createRange(); rg.selectNodeContents(el); return Array.prototype.map.call(rg.getClientRects(), function(r){return {top:r.top,bottom:r.bottom};}); }
          var nl = lines(name), sl = lines(summary);
          var hs = getComputedStyle(header);
          var padT = parseFloat(hs.paddingTop), padB = parseFloat(hs.paddingBottom);
          var hbox = header.getBoundingClientRect();
          var firstLine = sl[0], lastLine = sl[sl.length-1];
          // Space between the header's content box and the message line boxes,
          // top vs bottom. Equal ⇒ the message is optically centered / seated;
          // a bigger bottom gap is the "spurious space below" the user saw.
          var topGap = firstLine.top - (hbox.top + padT);
          var botGap = (hbox.bottom - padB) - lastLine.bottom;
          return {
            // first message line's top vs the "Commit" name's top (px; + = message lower)
            firstLineOffset: +(sl[0].top - nl[0].top).toFixed(2),
            wrapped: sl.length >= 2,
            topGap: +topGap.toFixed(2),
            botGap: +botGap.toFixed(2),
            // asymmetry: how much more space sits below the message than above it
            gapAsymmetry: +(botGap - topGap).toFixed(2),
            // the rendered header text — must be the subject only, no body/trailer
            text: (summary.textContent || ""),
            hasBody: (summary.textContent || "").indexOf("Tug-Session") !== -1
              || (summary.textContent || "").indexOf("- add") !== -1,
          };
        })()`,
      );
      process.stderr.write("\n===AT0264 GEOMETRY=== " + JSON.stringify(m) + "\n");
      // The fixture must exercise the wrapping case — otherwise the header
      // baseline / bottom-space geometry it guards isn't under test.
      expect(m.wrapped).toBe(true);
      // The first message line rides the "Commit" name's line — within a
      // pixel of font-metric slop. A regression that lets the mono subject
      // float high off the shared line box fails here.
      expect(Math.abs(m.firstLineOffset)).toBeLessThan(1.5);
      // The message is seated, not floating high. The header's shared `code`
      // nudge seats the subject on the name's baseline (priority), which leaves
      // a small residual gap asymmetry from the mono metric; a regression that
      // let the subject float high off the line box shows up as the OLD bug —
      // a big positive asymmetry (much more space below than above).
      expect(m.gapAsymmetry).toBeLessThan(1);
      expect(m.gapAsymmetry).toBeGreaterThan(-3);
      // Only the subject shows in the header — never the body bullets or the
      // Tug-Session trailer.
      expect(m.hasBody).toBe(false);
    } finally {
      await app.close();
    }
  }, 120_000);
});
