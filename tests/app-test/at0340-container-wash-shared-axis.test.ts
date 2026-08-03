/**
 * at0340-container-wash-shared-axis.test.ts — all six item-group containers mark
 * keyboard focus on ONE axis, at one strength.
 *
 * Rings mark elements, washes mark containers. Six components implement the
 * container half — `TugListView`, `TugAccordion`, `TugRadioGroup`,
 * `TugChoiceGroup`, `TugOptionGroup`, `TugTabBar` — and each paints its own
 * rule, so nothing structural stops them drifting apart again. They drifted
 * before: four read `--tugx-focus-tint` (the LEAF behind-tint, shared with
 * checkboxes and popovers), the list drew a perimeter ring, the accordion drew a
 * ring with the tint explicitly off, and the Lens Layouts section had reached
 * past all of it with a local override at a different strength entirely.
 *
 * What this suite pins is the thing no per-component suite can see. at0116–at0121
 * each prove their own container washes and does not stroke; only a probe that
 * holds all six at once can prove they resolve the SAME value. If someone
 * repoints one component back to `--tugx-focus-tint`, or a host declares a local
 * `--tugx-focus-container-wash` on a component's behalf, every per-component
 * suite still passes and this one fails.
 *
 * It reads the resolved custom property rather than a painted `backgroundImage`,
 * and that is deliberate: the property resolves on every container whether or
 * not it holds the keyboard, so the six can be compared in one shot without a
 * six-way Tab dance whose failures would be about focus routing rather than
 * about the axis. The at-rest half — no container paints a mark before the
 * keyboard arrives — comes along for free and is worth having.
 *
 * @covers tugdeck/styles/focus-ring.css
 * @covers tugdeck/src/components/tugways/tug-list-view.css
 * @covers tugdeck/src/components/tugways/tug-accordion.css
 * @covers tugdeck/src/components/tugways/tug-radio-group.css
 * @covers tugdeck/src/components/tugways/tug-choice-group.css
 * @covers tugdeck/src/components/tugways/tug-option-group.css
 * @covers tugdeck/src/components/tugways/tug-tab-bar.css
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

/** One card per item-group archetype, with the container selector inside it. */
const GROUPS = [
  { id: "A", componentId: "gallery-list-view-focus", sel: '[data-slot="tug-list-view"]' },
  { id: "B", componentId: "gallery-accordion", sel: '[data-slot="tug-accordion"]' },
  { id: "C", componentId: "gallery-radio-group", sel: '[data-slot="tug-radio-group"]' },
  { id: "D", componentId: "gallery-choice-group", sel: ".tug-choice-group" },
  { id: "E", componentId: "gallery-option-group", sel: ".tug-option-group" },
  { id: "F", componentId: "gallery-tabbar", sel: ".tug-tab-bar" },
] as const;

function deckShape() {
  return {
    cards: GROUPS.map((g) => ({
      id: g.id,
      componentId: g.componentId,
      title: g.componentId,
      closable: true,
    })),
    panes: GROUPS.map((g, i) => ({
      id: `p${i + 1}`,
      position: { x: 20 + (i % 3) * 30, y: 20 + Math.floor(i / 3) * 30 },
      size: { width: 520, height: 420 },
      cardIds: [g.id],
      activeCardId: g.id,
      title: "",
      acceptsFamilies: ["maker"],
    })),
    activePaneId: "p1",
    hasFocus: true,
  };
}

// For each container: the resolved container-wash token, plus the marks it
// paints at rest. `getPropertyValue` on a custom property returns the resolved
// substitution, so two containers reading the same token return byte-identical
// strings — and a container reading a DIFFERENT token returns a different one
// even when both happen to land on the same colour.
const AXIS_PROBE = `(function(){
  var groups = ${JSON.stringify(GROUPS.map((g) => ({ id: g.id, sel: g.sel })))};
  return groups.map(function(g){
    var el = document.querySelector('[data-card-id="' + g.id + '"] ' + g.sel);
    if (el === null) return { id: g.id, found: false };
    var cs = getComputedStyle(el);
    return {
      id: g.id,
      found: true,
      wash: cs.getPropertyValue("--tugx-focus-container-wash").trim(),
      restOutline: cs.outlineWidth,
      restBackgroundImage: cs.backgroundImage,
    };
  });
})()`;

interface AxisRow {
  id: string;
  found: boolean;
  wash?: string;
  restOutline?: string;
  restBackgroundImage?: string;
}

describe.skipIf(!SHOULD_RUN)("AT0340: every item-group container shares one wash axis", () => {
  test(
    "all six resolve the same --tugx-focus-container-wash, and none marks at rest",
    async () => {
      const app = await launchTugApp({ testName: "at0340-container-wash-shared-axis" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        // Six panes is well past what the 2s default was sized for — this deck
        // mounts six card hosts where a typical suite mounts one, so the last
        // one registers late rather than not at all.
        for (const g of GROUPS) {
          await app.waitForCondition<boolean>(
            `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered(${JSON.stringify(g.id)})`,
            { timeoutMs: 15000 },
          );
        }
        await app.waitForCondition<boolean>(
          `(function(){
            var sels = ${JSON.stringify(GROUPS.map((g) => `[data-card-id="${g.id}"] ${g.sel}`))};
            return sels.every(function(s){ return document.querySelector(s) !== null; });
          })()`,
          { timeoutMs: 10000 },
        );

        const rows = await app.evalJS<AxisRow[]>(AXIS_PROBE);
        expect(rows).not.toBeNull();
        expect(rows?.length).toBe(GROUPS.length);

        // Every container mounted — a missing one would make the comparison
        // below vacuously pass on whatever survived.
        for (const row of rows ?? []) {
          expect(row.found, `container for card ${row.id} is mounted`).toBe(true);
        }

        // (1) The axis is shared. One resolved value across all six, and it is
        // actually a value — an unresolved token reads as the empty string, and
        // a token that resolved invalid would collapse every rule reading it.
        //
        // A custom property is SUBSTITUTED rather than computed to a colour, so
        // this reads back as the `color-mix()` expression with its `var()`s
        // filled in, not as `rgb(...)`. That makes the equality below a stronger
        // check than a colour comparison would be: two containers reading
        // different tokens that happen to land on the same pixel would still
        // differ here.
        const washes = (rows ?? []).map((r) => r.wash ?? "");
        expect(washes[0]).not.toBe("");
        expect(washes[0]).toContain("color-mix");
        expect(washes[0]).toContain("transparent");
        for (let i = 1; i < washes.length; i += 1) {
          expect(
            washes[i],
            `card ${rows?.[i]?.id} resolves the same container wash as card ${rows?.[0]?.id}`,
          ).toBe(washes[0]);
        }

        // (2) Nothing marks at rest. The keyboard has not reached any of these
        // containers, so no wash and no stroke — the focus language paints only
        // on the engine's own keyboard signal, never on mere presence.
        for (const row of rows ?? []) {
          expect(row.restOutline, `card ${row.id} draws no stroke at rest`).toBe("0px");
          expect(
            row.restBackgroundImage ?? "none",
            `card ${row.id} paints no wash at rest`,
          ).toBe("none");
        }
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
