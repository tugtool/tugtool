/**
 * at0283-pulse-typography.test.ts — the PULSE's typographic contract, measured
 * in the real engine.
 *
 * # What this proves
 *
 * `TugPulse` claims four things are DECLARED rather than emergent:
 *
 *  1. **One baseline.** Every run in an inline PULSE — the headline and the
 *     activity, whatever face or size each wears — sits on the same baseline,
 *     at `--tugx-pulse-baseline` from the top of the bar. The claim is worth
 *     pinning because it is what lets a preset swap the activity's face
 *     without disturbing anything beside it.
 *  2. **Leading is baseline-to-baseline, over two lines that always exist.**
 *     A stacked PULSE puts consecutive baselines exactly
 *     `--tugx-pulse-stacked-baseline-step` apart, regardless of the type on
 *     either line — and renders both lines whether or not it has anything to
 *     put on them, so a Lens row never resizes as its session goes quiet.
 *  3. **The legend is aligned by visual center, not baseline** — the PULSE's
 *     own exception. The label's lift is half the difference between the two
 *     cap bands, so it re-derives itself when a preset changes a size instead
 *     of needing a fresh hand-tuned nudge.
 *  4. **The activity truncates in the middle**, so a command keeps both what
 *     it is and what it acts on, and the full string stays in the DOM for a
 *     copy and for assistive technology.
 *
 * The geometry is measured the way a typesetter would: a zero-size
 * inline-block probe injected into a run rests its bottom margin edge ON that
 * run's baseline, so `probe.getBoundingClientRect().bottom` IS the baseline,
 * with no font-metrics arithmetic to get wrong.
 *
 * It also proves the Datatype chart face is doing what it is bundled to do:
 * a `{p:75}` expression must render NARROWER than the same six characters in
 * the ambient face, which is only true if the font's ligature actually
 * substituted them for one pie glyph. A missing or ligature-disabled face
 * renders the literal braces and fails wide.
 *
 * Gating: `describe.skipIf(!SHOULD_RUN)`.
 *
 * @covers tugdeck/src/components/tugways/tug-pulse.tsx
 * @covers tugdeck/src/components/tugways/tug-pulse.css
 * @covers tugdeck/src/components/tugways/tug-chart-glyph.tsx
 * @covers tugdeck/src/components/tugways/tug-chart-glyph.css
 * @covers tugdeck/src/components/tugways/cards/gallery-pulse-display.tsx
 * @covers tugdeck/src/components/tugways/cards/gallery-pulse-display.css
 * @covers tugdeck/public/fonts.css
 * @covers tugdeck/src/lib/font-metrics.ts
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import type { App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 120_000;

const CARD_ID = "A";
const CARD = `[data-card-id="${CARD_ID}"]`;

/** A single-card deck seed for the PULSE design card. */
function deckSeed() {
  return {
    state: {
      cards: [
        {
          id: CARD_ID,
          componentId: "gallery-pulse-display",
          title: "Pulse Display",
          closable: true,
        },
      ],
      panes: [
        {
          id: "p1",
          position: { x: 40, y: 40 },
          size: { width: 1000, height: 760 },
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

/**
 * The baseline of every run inside each inline PULSE on the card, measured
 * from that PULSE's own top edge. One entry per PULSE, each a list of its
 * runs' baseline offsets.
 */
async function inlineBaselines(app: App): Promise<number[][]> {
  return app.evalJS<number[][]>(
    `(function(){
       var out = [];
       var pulses = document.querySelectorAll(
         ${JSON.stringify(`${CARD} [data-slot="tug-pulse"][data-layout="inline"]`)}
       );
       for (var i = 0; i < pulses.length; i++) {
         var pulse = pulses[i];
         var top = pulse.getBoundingClientRect().top;
         var runs = pulse.querySelectorAll(
           '[data-slot="tug-pulse-headline"], [data-slot="tug-pulse-activity"]'
         );
         var row = [];
         for (var j = 0; j < runs.length; j++) {
           var probe = document.createElement("span");
           probe.style.cssText =
             "display:inline-block;width:0;height:0;padding:0;margin:0;border:0";
           runs[j].appendChild(probe);
           row.push(
             Math.round((probe.getBoundingClientRect().bottom - top) * 100) / 100
           );
           probe.remove();
         }
         out.push(row);
       }
       return out;
     })()`,
  );
}

/**
 * Baseline-to-baseline distance within every stacked PULSE — and `null` for
 * any that does not carry exactly two runs, which is itself the failure.
 */
async function stackedSteps(app: App): Promise<Array<number | null>> {
  return app.evalJS<Array<number | null>>(
    `(function(){
       var out = [];
       var pulses = document.querySelectorAll(
         ${JSON.stringify(`${CARD} [data-slot="tug-pulse"][data-layout="stacked"]`)}
       );
       for (var i = 0; i < pulses.length; i++) {
         var runs = pulses[i].querySelectorAll(
           '[data-slot="tug-pulse-headline"], [data-slot="tug-pulse-activity"]'
         );
         if (runs.length !== 2) { out.push(null); continue; }
         var b = [];
         for (var j = 0; j < 2; j++) {
           var probe = document.createElement("span");
           probe.style.cssText =
             "display:inline-block;width:0;height:0;padding:0;margin:0;border:0";
           runs[j].appendChild(probe);
           b.push(probe.getBoundingClientRect().bottom);
           probe.remove();
         }
         out.push(Math.round((b[1] - b[0]) * 100) / 100);
       }
       return out;
     })()`,
  );
}

describe.skipIf(!SHOULD_RUN)("AT0283: the PULSE's declared type metrics", () => {
  test(
    "one baseline inline, a declared step stacked, and a real chart ligature",
    async () => {
      const app = await launchTugApp({ testName: "at0283-pulse-typography" });
      try {
        await app.seedDeckState(deckSeed());
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(
            CARD_ID,
          )})`,
          { timeoutMs: 8000 },
        );
        // The measurements are meaningless until the bundled faces have
        // loaded: an unloaded face measures as its fallback.
        await app.waitForCondition<boolean>(
          `document.fonts.status === "loaded" &&
           document.querySelectorAll(${JSON.stringify(
             `${CARD} [data-slot="tug-pulse"]`,
           )}).length > 0`,
          { timeoutMs: 10000 },
        );

        // ── 1. One baseline per bar, and the SAME one in every preset ──
        const perPulse = await inlineBaselines(app);
        expect(perPulse.length).toBeGreaterThan(4);
        const every: number[] = [];
        for (const runs of perPulse) {
          expect(runs.length).toBeGreaterThan(0);
          // Within one bar: the headline and the activity share a baseline,
          // whatever sizes and faces they are wearing.
          for (const b of runs) expect(Math.abs(b - runs[0])).toBeLessThan(0.51);
          every.push(runs[0]);
        }
        // Across bars: swapping the preset moves nothing. This is the
        // regression that "the gallery design drifted on rollout" describes.
        const first = every[0];
        for (const b of every) expect(Math.abs(b - first)).toBeLessThan(0.51);

        // ── 2. Stacked leading is the declared step ────────────────────
        const declaredStep = await app.evalJS<number>(
          `parseFloat(getComputedStyle(document.body)
             .getPropertyValue("--tugx-pulse-stacked-baseline-step"))`,
        );
        expect(declaredStep).toBeGreaterThan(0);
        const steps = await stackedSteps(app);
        expect(steps.length).toBeGreaterThan(0);
        for (const s of steps) {
          // A null is a stacked PULSE that rendered fewer than two runs —
          // i.e. it dropped a level, and the Lens row carrying it just changed
          // height. Neither level is ever absent; an empty one stands in.
          expect(s).not.toBeNull();
          expect(Math.abs(s! - declaredStep)).toBeLessThan(0.51);
        }

        // ── 3. The legend sits on the headline's VISUAL middle ─────────
        // The PULSE's exception to the baseline rule. The lift is derived
        // from the two sizes and the face's cap ratio, so the check is that
        // the label ends up exactly half the cap-band difference ABOVE the
        // baseline its neighbour sits on — not merely "somewhere near it".
        const legend = await app.evalJS<{
          delta: number;
          expected: number;
        } | null>(
          `(function(){
             var pulse = document.querySelector(
               ${JSON.stringify(
                 `${CARD} [data-slot="tug-pulse"][data-legend-align="cap-center"]:has(.tug-pulse-legend):has([data-slot="tug-pulse-headline"])`,
               )}
             );
             if (pulse === null) return null;
             var probeIn = function(el){
               var p = document.createElement("span");
               p.style.cssText =
                 "display:inline-block;width:0;height:0;padding:0;margin:0;border:0";
               el.appendChild(p);
               var y = p.getBoundingClientRect().bottom;
               p.remove();
               return y;
             };
             var head = pulse.querySelector('[data-slot="tug-pulse-headline"]');
             var label = pulse.querySelector(".tug-pulse-legend");
             if (head === null || label === null) return null;
             var cs = getComputedStyle(pulse);
             var px = function(name){
               var probe = document.createElement("div");
               probe.style.cssText = "position:absolute;visibility:hidden;width:" +
                 cs.getPropertyValue(name).trim();
               document.body.appendChild(probe);
               var w = probe.getBoundingClientRect().width;
               probe.remove();
               return w;
             };
             var ratio = parseFloat(cs.getPropertyValue("--tugx-pulse-legend-center-ratio"));
             var expected =
               (px("--tugx-pulse-headline-size") - px("--tugx-pulse-legend-size")) *
               ratio / 2;
             return {
               delta: probeIn(head) - probeIn(label),
               expected: expected,
             };
           })()`,
        );
        expect(legend).not.toBeNull();
        // Positive: the label's baseline is ABOVE the headline's.
        expect(legend!.expected).toBeGreaterThan(0);
        expect(Math.abs(legend!.delta - legend!.expected)).toBeLessThan(0.51);

        // ── 4. The activity truncates in the middle, keeping both ends ──
        const truncation = await app.evalJS<
          ReadonlyArray<{ full: string; shown: string }>
        >(
          `Array.from(document.querySelectorAll(
             ${JSON.stringify(
               `${CARD} [data-slot="tug-pulse-activity"][data-truncated="true"]`,
             )}
           )).map(function(run){
             return {
               full: run.querySelector(".tug-pulse-activity-full").textContent,
               shown: run.querySelector(".tug-pulse-activity-clipped").textContent,
             };
           })`,
        );
        expect(truncation.length).toBeGreaterThan(0);
        for (const { full, shown } of truncation) {
          const cut = shown.indexOf("…");
          expect(cut).toBeGreaterThan(0);
          // Both ends of the original survive, and the middle is what went.
          expect(full.startsWith(shown.slice(0, cut))).toBe(true);
          expect(full.endsWith(shown.slice(cut + 1))).toBe(true);
          expect(shown.length).toBeLessThan(full.length);
        }

        // ── 5. The density meter reports the type, not its fallback ────
        // `document.fonts.ready` resolves against the loads pending AT THAT
        // MOMENT, so awaiting it before a face has been asked for resolves on
        // an empty queue and every reading lands on the fallback — uniformly
        // ~11% wide here, which looked like a plausible table and was wrong in
        // every cell. Each readout must equal what the run actually measures.
        const meter = await app.evalJS<
          ReadonlyArray<{ name: string; rect: number; readout: number }>
        >(
          `Array.from(document.querySelectorAll(
             ${JSON.stringify(`${CARD} .gpd-meter-row`)}
           )).map(function(row){
             var run = row.querySelector('[data-slot="tug-pulse-activity"]');
             var inner = run.querySelector(".tug-pulse-activity-full").firstElementChild;
             return {
               name: row.querySelector(".gpd-preset-name").textContent,
               rect: inner.getBoundingClientRect().width,
               readout: parseFloat(row.querySelector(".gpd-meter-readout").textContent),
             };
           })`,
        );
        expect(meter.length).toBeGreaterThan(4);
        for (const { rect, readout } of meter) {
          expect(rect).toBeGreaterThan(0);
          expect(Math.abs(readout - rect)).toBeLessThan(1);
        }
        // And the weight column climbs monotonically, as the face's own
        // advance widths do. It read non-monotonic for exactly as long as it
        // was reporting the fallback.
        const weights = ["thin", "extralight", "light", "regular"]
          .map((n) => meter.find((m) => m.name === n))
          .filter((m) => m !== undefined);
        expect(weights.length).toBe(4);
        for (let i = 1; i < weights.length; i++) {
          expect(weights[i]!.rect).toBeGreaterThan(weights[i - 1]!.rect);
        }

        // ── 6. The chart ligature actually substituted ─────────────────
        const ligature = await app.evalJS<{ glyph: number; literal: number }>(
          `(function(){
             var el = document.querySelector(
               ${JSON.stringify(`${CARD} [data-slot="tug-chart-glyph"]`)}
             );
             var glyph = el.getBoundingClientRect().width;
             // The same source text, same size, in the ambient face: if the
             // ligature did not fire, the two widths are the same order.
             var probe = document.createElement("span");
             probe.textContent = el.textContent;
             probe.style.cssText =
               "position:absolute;visibility:hidden;white-space:nowrap;font-size:" +
               getComputedStyle(el).fontSize;
             document.body.appendChild(probe);
             var literal = probe.getBoundingClientRect().width;
             probe.remove();
             return { glyph: glyph, literal: literal };
           })()`,
        );
        expect(ligature.literal).toBeGreaterThan(0);
        // One pie glyph against six characters — a wide margin, so this fails
        // loudly if the face is missing rather than marginally.
        expect(ligature.glyph).toBeLessThan(ligature.literal * 0.6);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
