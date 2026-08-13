/**
 * at0381-entity-presentation-bench.test.ts — the reference-presentation
 * bench card mounts and its two columns really are scoped differently.
 *
 * **TEMPORARY**, and it retires with what it covers. The card is the
 * before/after bench for `roadmap/entity-presentation.md`; when that brief
 * ships or is rejected, `gallery-entity-presentation.tsx` goes and this file
 * goes with it.
 *
 * Scenario
 * --------
 * Seed one gallery pane holding the card. Assert three things, each of which
 * is a way the card could be useless without erroring:
 *
 *   1. It mounts at all — six sections, both column pairs. A design bench
 *      that white-screens is worse than no bench, and a card whose live
 *      resolvers throw would take the pane with it.
 *   2. The `today` frames carry NO `.gep-proposed` scope and the `proposed`
 *      frames do. That class is half of what the card claims to demonstrate
 *      ([P05]'s resting underline); if it were on both, the columns would be
 *      identical and nobody looking at them would know.
 *   3. The hand-stamped Mention drawings carry a real annotation dataset, so
 *      the vocabulary and calibration sections show the form even with no
 *      project bound — which is the state the card opens in.
 *   4. The calibration bench offers a baseline plus three distinct resting
 *      weights. Three readings that resolved to the same rule would be a
 *      bench that cannot be used to choose.
 *   5. The two-channel matrix really is a matrix: across its four cells the
 *      code tone and the underline vary INDEPENDENTLY. That is the claim
 *      [P04] rests on, and a matrix where the two happened to move together
 *      would demonstrate the opposite of what the section says.
 *   6. The commit atom's label carries the word "Commit" ([P09]). The whole
 *      point of that decision is that a bare hash names nothing, so a label
 *      that lost the word would be the defect shipping under the fix.
 *
 * What this deliberately does NOT assert: that a path in the sample prose
 * gets marked. That needs a real workspace hold on a real repo, and the
 * marking path it would exercise is already pinned by `at0346`. This test
 * covers the bench, not the annotator.
 *
 * Gating
 * ------
 * `describe.skipIf(!SHOULD_RUN)`. CI and `bunx tsc --noEmit` runs without
 * `TUGAPP_APP_TEST=1` skip every test.
 *
 * @covers tugdeck/src/components/tugways/cards/gallery-entity-presentation.tsx
 * @covers tugdeck/src/components/tugways/cards/gallery-registrations.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const CARD = "EP";
const ROOT = `[data-card-id="${CARD}"]`;

describe.skipIf(!SHOULD_RUN)("at0381: entity-presentation bench", () => {
  test("mounts, and only the proposed columns carry the prototype scope", async () => {
    const app = await launchTugApp({
      testName: "at0381-entity-presentation-bench",
    });
    try {
      await app.enableDeckTrace(true);

      await app.seedDeckState({
        state: {
          cards: [
            {
              id: CARD,
              componentId: "gallery-entity-presentation",
              title: "Entity Presentation",
              closable: true,
            },
          ],
          panes: [
            {
              id: "p1",
              position: { x: 40, y: 40 },
              size: { width: 900, height: 700 },
              cardIds: [CARD],
              activeCardId: CARD,
              title: "",
              acceptsFamilies: ["maker"],
            },
          ],
          activePaneId: "p1",
          hasFocus: true,
        },
        focusCardId: CARD,
      });

      await app.waitForCondition<boolean>(
        `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(CARD)})`,
      );

      // (1) It mounted, with every section and both pairs.
      await app.waitForCondition<boolean>(
        `document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-section`)}).length === 6`,
      );
      const pairs = await app.evalJS<number>(
        `document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-pair`)}).length`,
      );
      expect(pairs).toBe(2);

      // Four reading frames — a today/proposed column in each pair.
      const frames = await app.evalJS<number>(
        `document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-frame`)}).length`,
      );
      expect(frames).toBe(4);

      // (2) The scope class splits them exactly down the middle: one
      // proposed frame per pair, and never on a today frame.
      const scoped = await app.evalJS<number>(
        `document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-frame.gep-proposed`)}).length`,
      );
      expect(scoped).toBe(2);

      // Each pair's FIRST column is today, and it must be unscoped — the
      // ordering is what the captions promise.
      const firstColumnsScoped = await app.evalJS<number>(
        `Array.from(document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-pair`)}))
           .filter((pair) => pair.querySelector(".gep-column .gep-frame")?.classList.contains("gep-proposed") === true)
           .length`,
      );
      expect(firstColumnsScoped).toBe(0);

      // (3) The hand-stamped Mention drawings carry a real annotation
      // dataset, so the vocabulary reads with no project bound.
      const stamped = await app.evalJS<number>(
        `document.querySelectorAll(${JSON.stringify(`${ROOT} [data-tugx-wrapped][data-tug-annotation]`)}).length`,
      );
      expect(stamped).toBeGreaterThanOrEqual(2);

      // (4) Four readings of the stress paragraph — a baseline plus three
      // scoped weights — and the three weights really do resolve to
      // different rules. Reading the computed decoration is the only honest
      // check: three classes that all inherited the same colour would look
      // like a working bench and choose nothing.
      const stress = await app.evalJS<number>(
        `document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-stress`)}).length`,
      );
      expect(stress).toBe(4);

      const rules = await app.evalJS<string[]>(
        `Array.from(document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-stress.gep-proposed`)}))
           .map((p) => {
             const run = p.querySelector("[data-tugx-wrapped][data-tug-annotation]");
             if (run === null) return "none";
             const cs = getComputedStyle(run);
             return cs.textDecorationLine + "|" + cs.textDecorationStyle + "|" + cs.textDecorationColor;
           })`,
      );
      expect(rules).toHaveLength(3);
      for (const rule of rules) expect(rule).toContain("underline");
      expect(new Set(rules).size).toBe(3);

      // The baseline reading carries no resting rule at all — which is the
      // whole point of showing it beside the three.
      const baseline = await app.evalJS<string>(
        `(() => {
           const p = document.querySelector(${JSON.stringify(`${ROOT} .gep-stress:not(.gep-proposed)`)});
           const run = p === null ? null : p.querySelector("[data-tugx-wrapped][data-tug-annotation]");
           return run === null ? "none" : getComputedStyle(run).textDecorationLine;
         })()`,
      );
      expect(baseline).toBe("none");

      // (5) The two-channel matrix. Read each cell as
      // `<has-code-tone>|<has-rule>` and require all four combinations —
      // which is only possible if the two channels are independent.
      const cells = await app.evalJS<string[]>(
        `Array.from(document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-cell-body`)}))
           .map((body) => {
             const toned = body.querySelector(".gep-cell-code") !== null;
             const mark = body.querySelector("[data-tug-annotation]");
             const ruled = mark !== null
               && getComputedStyle(mark).textDecorationLine.includes("underline");
             return (toned ? "tone" : "plain") + "|" + (ruled ? "rule" : "norule");
           })`,
      );
      expect(cells).toHaveLength(4);
      expect(new Set(cells)).toEqual(
        new Set(["tone|rule", "plain|rule", "tone|norule", "plain|norule"]),
      );

      // (6) [P09] — the commit atom says what it is. Two of them render
      // (the Gazette ref row and the commit section), and both carry the
      // word; a glyph alone was the thing this decision rejected.
      const commitLabels = await app.evalJS<string[]>(
        `Array.from(document.querySelectorAll(${JSON.stringify(`${ROOT} .gep-ref-drawing`)}))
           .map((el) => (el.textContent ?? "").trim())`,
      );
      expect(commitLabels.length).toBeGreaterThanOrEqual(2);
      for (const label of commitLabels) expect(label).toStartWith("Commit ");
    } finally {
      await app.close();
    }
  });
});
