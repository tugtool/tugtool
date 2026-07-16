/**
 * at0208-transcript-attribution-gap.test.ts — the under-attribution gap
 * is one constant per body shape, regardless of which block kind opens
 * the entry body.
 *
 * The transcript spaces blocks with top margins only. The invariant this
 * test pins: those margins are FOLLOWER-POSITION-ONLY, so a first-in-body
 * block (thinking strip, tool chrome, compaction divider) leaks nothing
 * under the attribution header, and `--tugx-transcript-body-margin-top`
 * (1px) is the single source of the header→content gap. The one designed
 * exception: a body that OPENS with a large markdown heading (h1–h3) gets
 * the wider `-heading` margin (8px).
 *
 * The fixture (`session-transcript-margins.jsonl`) covers every opening
 * shape, and the assertions guard BOTH failure directions of the
 * position-anchored `:has()` chain in `tug-transcript-entry.css`:
 *
 *   - heading-first bodies (user + assistant) MUST get the wide margin —
 *     a drifted DOM shape that silently voids the `:has()` fails here;
 *   - a body with only a MID-BODY heading MUST keep the tight margin —
 *     a re-loosened descendant test fails here;
 *   - thinking-first / tool-first bodies MUST sit at the tight margin —
 *     a block kind regaining an unconditional top margin fails here;
 *   - a turn whose thinking block closed EMPTY must render its tool
 *     block at the tight margin — a hidden (`data-empty`) strip left in
 *     the DOM is a phantom sibling that re-opens the run gap (the
 *     `StreamedTextGate` contract in session-card-transcript.tsx).
 *
 * Measurement scrolls each entry to viewport center first (an unstuck
 * header), then reads rect deltas: header bottom → the top of the body's
 * first painted element.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";
import { seedFixtureSession } from "./fixtures/resolve";
import {
  openFixtureSession,
  waitForTranscriptSettled,
} from "./fixtures/runner";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/** Sub-pixel rounding allowance on rect deltas. */
const GAP_TOLERANCE_PX = 1.5;

/** Tight default: `--tugx-transcript-body-margin-top` (1px). */
const TIGHT_GAP_PX = 1;
/** Heading-first: `--tugx-transcript-body-margin-top-heading` (space-md). */
const HEADING_GAP_PX = 8;

/**
 * One case per body opening shape, keyed by a unique text marker the
 * fixture plants in that entry's body.
 */
const CASES: ReadonlyArray<{
  marker: string;
  participant: "user" | "assistant";
  expectedGap: number;
  shape: string;
}> = [
  { marker: "Prose-first prompt", participant: "user", expectedGap: TIGHT_GAP_PX, shape: "user prose-first" },
  { marker: "Thinking-first turn", participant: "assistant", expectedGap: TIGHT_GAP_PX, shape: "assistant thinking-first" },
  { marker: "Heading-first prompt", participant: "user", expectedGap: HEADING_GAP_PX, shape: "user heading-first" },
  { marker: "Heading-first reply", participant: "assistant", expectedGap: HEADING_GAP_PX, shape: "assistant heading-first" },
  { marker: "Tool-first turn", participant: "assistant", expectedGap: TIGHT_GAP_PX, shape: "assistant tool-first" },
  { marker: "Empty-thinking turn", participant: "assistant", expectedGap: TIGHT_GAP_PX, shape: "assistant empty-thinking-then-tool (canary: a closed-empty thinking block must leave no phantom sibling above the tool block)" },
  { marker: "Mid-heading turn", participant: "assistant", expectedGap: TIGHT_GAP_PX, shape: "assistant mid-body-heading (canary: heading anywhere must NOT widen the gap)" },
];

interface GapProbe {
  marker: string;
  found: boolean;
  participant: string | null;
  gap: number;
  firstChild: string;
}

describe.skipIf(!SHOULD_RUN)("at0208: under-attribution gap is constant per body shape", () => {
  test(
    "every opening shape lands on its designed header→content gap",
    async () => {
      const tugbankPath = mkTempTugbank();
      seedTugbankForLaunch(tugbankPath);
      const seeded = await seedFixtureSession(
        "session-transcript-margins",
        "at0208",
      );
      try {
        const app = await launchTugApp({
          testName: "at0208",
          env: { TUGBANK_PATH: tugbankPath },
          skipAccessibilityPreflight: true,
        });
        try {
          await openFixtureSession(app, seeded);
          await waitForTranscriptSettled(app);

          const markers = CASES.map((c) => c.marker);
          const probes = await app.evalJS<GapProbe[]>(
            `(function(){
              var markers = ${JSON.stringify(markers)};
              var entries = Array.prototype.slice.call(
                document.querySelectorAll('[data-card-id="A"] .tug-transcript-entry'));
              return markers.map(function(marker){
                var entry = null;
                for (var i = 0; i < entries.length; i++) {
                  var body = entries[i].querySelector('.tug-transcript-entry__body');
                  if (body && (body.textContent || '').indexOf(marker) !== -1) {
                    entry = entries[i];
                    break;
                  }
                }
                if (entry === null) {
                  return { marker: marker, found: false, participant: null, gap: -1, firstChild: '' };
                }
                // Center the entry so its sticky header is unstuck and
                // rect deltas read the natural layout.
                entry.scrollIntoView({ block: 'center' });
                var header = entry.querySelector('.tug-transcript-entry__header');
                var body = entry.querySelector('.tug-transcript-entry__body');
                var hRect = header.getBoundingClientRect();
                var bRect = body.getBoundingClientRect();
                // First painted pixel inside the body: the minimum box top
                // across PAINT-BEARING descendants — leaves (text-bearing
                // elements with no element children) and boxes that paint
                // their own background or border (thinking strip, tool
                // chrome). Transparent wrapper divs are excluded: a
                // wrapper's box top sits at the body top even when a
                // margin pushes the block inside it down, which would mask
                // exactly the leak this test exists to catch.
                var firstTop = Infinity;
                var firstDesc = '(none)';
                var els = body.querySelectorAll('*');
                for (var k = 0; k < els.length; k++) {
                  var el = els[k];
                  var r = el.getBoundingClientRect();
                  if (r.height <= 0 || r.top >= firstTop) continue;
                  var paints = el.children.length === 0;
                  if (!paints) {
                    var cs = getComputedStyle(el);
                    paints =
                      (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                        cs.backgroundColor !== 'transparent') ||
                      parseFloat(cs.borderTopWidth) > 0;
                  }
                  if (!paints) continue;
                  firstTop = r.top;
                  firstDesc = el.tagName.toLowerCase() + '.' +
                    (typeof el.className === 'string' ? el.className.split(' ')[0] : '');
                }
                if (firstTop === Infinity) firstTop = bRect.top;
                return {
                  marker: marker,
                  found: true,
                  participant: entry.getAttribute('data-participant'),
                  gap: Math.round((firstTop - hRect.bottom) * 100) / 100,
                  firstChild: firstDesc
                };
              });
            })()`,
            { timeoutMs: 15_000 },
          );

          for (const p of probes) {
            console.log(
              `GAP marker="${p.marker}" found=${p.found} participant=${p.participant} ` +
                `gap=${p.gap} first=${p.firstChild}`,
            );
          }
          for (const [i, probe] of probes.entries()) {
            const c = CASES[i]!;
            expect(probe.found, `entry not found for marker "${c.marker}"`).toBe(true);
            expect(probe.participant, c.shape).toBe(c.participant);
            expect(
              Math.abs(probe.gap - c.expectedGap),
              `${c.shape}: gap ${probe.gap}px, expected ${c.expectedGap}px (first child ${probe.firstChild})`,
            ).toBeLessThanOrEqual(GAP_TOLERANCE_PX);
          }

          // ── Obscuring strip paints ONLY while the header is pinned. ──
          //
          // At rest the `::after` strip must not exist (it would paint
          // header background over the body's first 4px — the clipped
          // tool-block-header regression); once the scroller top sits
          // inside an entry, that entry's header pins and the strip
          // must paint (`data-stuck` written by the IntersectionObserver
          // in tug-transcript-entry.tsx).
          const HEADER = '[data-card-id="A"] .tug-transcript-entry .tug-transcript-entry__header';
          const restContent = await app.evalJS<string>(
            `(function(){
              var h = document.querySelector(${JSON.stringify(HEADER)});
              h.closest('.tug-transcript-entry').scrollIntoView({ block: 'center' });
              return getComputedStyle(h, '::after').content;
            })()`,
          );
          expect(restContent, "strip must not paint at rest").toBe("none");

          // Scroll so the scroller's top edge lands 40px into the first
          // entry — its sticky header pins.
          await app.evalJS<null>(
            `(function(){
              var h = document.querySelector(${JSON.stringify(HEADER)});
              var entry = h.closest('.tug-transcript-entry');
              var scroller = entry.parentElement;
              while (scroller && scroller !== document.body) {
                var o = getComputedStyle(scroller).overflowY;
                if (o === 'auto' || o === 'scroll') break;
                scroller = scroller.parentElement;
              }
              var top = entry.getBoundingClientRect().top -
                scroller.getBoundingClientRect().top + scroller.scrollTop;
              scroller.scrollTop = top + 40;
              return null;
            })()`,
          );
          const pinned = await app.waitForCondition<boolean>(
            `(function(){
              var h = document.querySelector(${JSON.stringify(HEADER)});
              return h.getAttribute('data-stuck') === 'true' &&
                getComputedStyle(h, '::after').content !== 'none';
            })()`,
            { timeoutMs: 4000 },
          );
          expect(pinned, "strip must paint while the header is pinned").toBe(true);
        } finally {
          await app.quitGracefully();
        }
      } finally {
        seeded.cleanup();
        rmTempTugbank(tugbankPath);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
