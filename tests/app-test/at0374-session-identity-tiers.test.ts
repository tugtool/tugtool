/**
 * at0374-session-identity-tiers.test.ts — the two identity registers, as they
 * actually paint.
 *
 * ## What this gates
 *
 * `TugSessionIdentity` makes four claims that are only checkable in a browser,
 * against real theme tokens, on the real component. The Session Identity
 * gallery card is the fixture bench: it mounts both tiers over the shipping
 * roster, so the test drives the component the app ships rather than a
 * scaffold built to be asserted on.
 *
 *   A. **`<project>/<callsign>` is ONE text node.** The earlier two-span form
 *      opened a flex gap after the slash and let each half truncate on its own
 *      (`tugto… syrupy-beam`). One run can do neither — and the only way to
 *      say "one run" is to count the run element's child text nodes in a live
 *      DOM.
 *
 *   B. **The atom paints the theme's session color; the line tier does not.**
 *      The registers must be distinguishable at a glance: the citation is
 *      enclosed and tinted, presence is bare. Both read computed style, which
 *      no unit test has.
 *
 *   C. **The unresolvable citation keeps its shape and is inert.** Dashed
 *      border, no session ground, muted ink, and — the load-bearing half — no
 *      pointer affordance, because a broken reference that still invites a
 *      click is worse than one that plainly does not.
 *
 *   D. **Both chip sizes render, and the smaller one is smaller.** `2xs` is
 *      for dense list ink; if it collapsed to `sm` the size prop would be a
 *      lie no type-check could catch.
 *
 * @covers tugdeck/src/components/tugways/tug-session-identity.tsx
 * @covers tugdeck/src/components/tugways/tug-session-identity.css
 * @covers tugdeck/src/components/tugways/cards/gallery-session-identity.tsx
 * @covers tugdeck/src/components/tugways/cards/gallery-session-identity.css
 */

import { describe, expect, test } from "bun:test";

import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const IDENTITY = '[data-slot="tug-session-identity"]';
const CHIP = `${IDENTITY}[data-tier="chip"]`;
const LINE = `${IDENTITY}[data-tier="line"]`;
const MISSING = `${CHIP}[data-missing="true"]`;

function deckShape() {
  return {
    cards: [
      {
        id: "A",
        componentId: "gallery-session-identity",
        title: "Session Identity",
        closable: true,
      },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 900, height: 700 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

describe.skipIf(!SHOULD_RUN)("at0374 — TugSessionIdentity chip and line tiers", () => {
  test(
    "one run, two registers, an inert missing atom, and two real sizes",
    async () => {
      const app = await launchTugApp({
        testName: "at0374-session-identity-tiers",
      });
      try {
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(CHIP)}).length > 0
             && document.querySelectorAll(${JSON.stringify(LINE)}).length > 0`,
          { timeoutMs: 15_000 },
        );

        // ---- A. The callsign is one text node, in BOTH registers. ----------
        //
        // Counting child nodes of the run element is the assertion: a run
        // split back into two spans would report 2 element children here and
        // read `tugto… syrupy-beam` on a narrow surface.
        const runs = await app.evalJS<
          { tier: string; childElements: number; textNodes: number; text: string }[]
        >(`(function(){
          return Array.prototype.map.call(
            document.querySelectorAll(${JSON.stringify(IDENTITY)}),
            function (el) {
              var run = el.querySelector('.tug-session-identity-run');
              return {
                tier: el.getAttribute('data-tier') || '',
                childElements: run === null ? -1 : run.children.length,
                textNodes: run === null
                  ? -1
                  : Array.prototype.filter.call(
                      run.childNodes, function (n) { return n.nodeType === 3; },
                    ).length,
                text: run === null ? '' : (run.textContent || ''),
              };
            },
          );
        })()`);
        expect(runs.length).toBeGreaterThan(0);
        for (const run of runs) {
          expect(run.childElements).toBe(0);
          expect(run.textNodes).toBe(1);
          // And the run really is the composed pair, not just a bare tag.
          expect(run.text).toContain("/");
        }
        // Both registers are on the bench, so the loop above covered both.
        expect(runs.some((r) => r.tier === "chip")).toBe(true);
        expect(runs.some((r) => r.tier === "line")).toBe(true);

        // ---- B. The atom is enclosed and tinted; presence is bare. ---------
        const paint = await app.evalJS<{
          chipBg: string;
          chipBorderStyle: string;
          chipRadius: string;
          lineBg: string;
          lineBorderStyle: string;
        }>(`(function(){
          var chip = document.querySelector(
            ${JSON.stringify(CHIP)} + ':not([data-missing])');
          var line = document.querySelector(${JSON.stringify(LINE)});
          if (chip === null || line === null) throw new Error("missing a tier");
          var c = getComputedStyle(chip);
          var l = getComputedStyle(line);
          return {
            chipBg: c.backgroundColor,
            chipBorderStyle: c.borderTopStyle,
            chipRadius: c.borderTopLeftRadius,
            lineBg: l.backgroundColor,
            lineBorderStyle: l.borderTopStyle,
          };
        })()`);
        // The chip carries a real ground from the theme's session tone — not
        // transparent, which is what a missing token would resolve to.
        expect(paint.chipBg).not.toBe("rgba(0, 0, 0, 0)");
        expect(paint.chipBg).not.toBe("transparent");
        expect(paint.chipBorderStyle).toBe("solid");
        // A pill, deliberately not the squared house badge.
        expect(parseFloat(paint.chipRadius)).toBeGreaterThan(20);
        // Presence is typography: no enclosure at all.
        expect(paint.lineBg).toBe("rgba(0, 0, 0, 0)");
        expect(paint.lineBorderStyle).toBe("none");

        // ---- C. The unresolvable citation: same shape, inert. --------------
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MISSING)}) !== null`,
          { timeoutMs: 8_000 },
        );
        const missing = await app.evalJS<{
          borderStyle: string;
          bg: string;
          cursor: string;
          radius: string;
          interactive: boolean;
        }>(`(function(){
          var el = document.querySelector(${JSON.stringify(MISSING)});
          var s = getComputedStyle(el);
          return {
            borderStyle: s.borderTopStyle,
            bg: s.backgroundColor,
            cursor: s.cursor,
            radius: s.borderTopLeftRadius,
            interactive: el.getAttribute('data-interactive') === 'true',
          };
        })()`);
        expect(missing.borderStyle).toBe("dashed");
        // The session color is dropped — muted ink on no ground.
        expect(missing.bg).toBe("rgba(0, 0, 0, 0)");
        // Inert: it keeps the shape so the reader knows what was named, and
        // offers nothing to click.
        expect(missing.interactive).toBe(false);
        expect(missing.cursor).toBe("default");
        // Same shape as a resolving atom — this is the whole point of the
        // treatment, so it is asserted rather than assumed.
        expect(missing.radius).toBe(paint.chipRadius);

        // ---- D. Two sizes, and the small one is actually smaller. ----------
        const sizes = await app.evalJS<{ sm: number; xs: number }>(`(function(){
          var sm = document.querySelector(
            ${JSON.stringify(CHIP)} + '[data-size="sm"]');
          var xs = document.querySelector(
            ${JSON.stringify(CHIP)} + '[data-size="2xs"]');
          if (sm === null || xs === null) throw new Error("both sizes not on the bench");
          return {
            sm: parseFloat(getComputedStyle(sm).fontSize),
            xs: parseFloat(getComputedStyle(xs).fontSize),
          };
        })()`);
        expect(sizes.xs).toBeLessThan(sizes.sm);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
