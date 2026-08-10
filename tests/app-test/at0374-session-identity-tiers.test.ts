/**
 * at0374-session-identity-tiers.test.ts — the two identity registers, as they
 * actually paint.
 *
 * ## What this gates
 *
 * `TugSessionIdentity` makes five claims that are only checkable in a browser,
 * against real theme tokens, on the real component. The Session Identity
 * gallery card is the fixture bench: it mounts both tiers over the shipping
 * roster, so the test drives the component the app ships rather than a
 * scaffold built to be asserted on.
 *
 *   A. **The title is two runs.** A user's name and the callsign that follows
 *      it are sized separately — that is the whole mechanism behind claim B —
 *      so the run element carries a name span and, when there is a name, a
 *      callsign span beside it. An unnamed session has exactly one.
 *
 *   B. **The callsign is the run that gives way.** Under a narrow budget the
 *      user's own name survives intact and the minted handle elides. Only a
 *      live layout can say which of two flex runs overflowed.
 *
 *   C. **The atom paints in text ink and leads with a live dot.** The pill's
 *      ground is transparent and its border a `currentcolor` mix — the theme's
 *      session color left this component, and the dot is its only color
 *      channel. Both read computed style, which no unit test has.
 *
 *   D. **The unresolvable citation keeps its shape and is inert.** Dashed
 *      border, muted ink, and — the load-bearing half — no pointer affordance,
 *      because a broken reference that still invites a click is worse than one
 *      that plainly does not. It has no icon to slash: shape states the
 *      failure now.
 *
 *   E. **Both chip sizes render, and the smaller one is smaller.** `2xs` is
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
const NARROW = `[data-gsi-shipped="narrow"] ${CHIP}`;

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
    "two runs, a live dot, text ink, an inert missing atom, and two real sizes",
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

        // ---- A. Two runs, and a dot in front of them. ----------------------
        //
        // Counting the run element's children is the assertion: a title
        // collapsed back into one node could not let the callsign elide on its
        // own, which is claim B.
        const marks = await app.evalJS<
          {
            tier: string;
            names: number;
            callsigns: number;
            dots: number;
            text: string;
          }[]
        >(`(function(){
          return Array.prototype.map.call(
            document.querySelectorAll(${JSON.stringify(IDENTITY)}),
            function (el) {
              var run = el.querySelector('.tug-session-identity-run');
              return {
                tier: el.getAttribute('data-tier') || '',
                names: el.querySelectorAll('.tug-session-identity-name').length,
                callsigns: el.querySelectorAll('.tug-session-identity-callsign').length,
                dots: el.querySelectorAll('.tug-session-identity-dot').length,
                text: run === null ? '' : (run.textContent || ''),
              };
            },
          );
        })()`);
        expect(marks.length).toBeGreaterThan(0);
        for (const mark of marks) {
          // Every identity leads with exactly one dot — the session's mark, one
          // per surface, and the chatbox icon is gone rather than beside it.
          expect(mark.dots).toBe(1);
          // Exactly one name run always; the callsign run only when named.
          expect(mark.names).toBe(1);
          expect(mark.callsigns).toBeLessThanOrEqual(1);
          expect(mark.text.length).toBeGreaterThan(0);
          // The `project/` prefix rides the title ink ([P05] amendment): every
          // fixture on the bench carries a project, so every mark spells it.
          expect(mark.text).toContain("/");
        }
        // Both registers are on the bench, so the loop above covered both.
        expect(marks.some((m) => m.tier === "chip")).toBe(true);
        expect(marks.some((m) => m.tier === "line")).toBe(true);
        // And the two-run form really is reachable: a named fixture is mounted.
        const named = marks.filter((m) => m.callsigns === 1);
        expect(named.length).toBeGreaterThan(0);
        for (const mark of named) expect(mark.text).toContain(" : ");

        // ---- B. Under a squeeze, the callsign elides and the name does not. -
        const squeeze = await app.evalJS<{
          nameOverflows: boolean;
          callsignOverflows: boolean;
        }>(`(function(){
          var chip = document.querySelector(${JSON.stringify(NARROW)});
          if (chip === null) throw new Error("no narrow named chip on the bench");
          var name = chip.querySelector('.tug-session-identity-name');
          var callsign = chip.querySelector('.tug-session-identity-callsign');
          if (name === null || callsign === null) {
            throw new Error("the narrow chip is not the two-run form");
          }
          return {
            nameOverflows: name.scrollWidth - name.clientWidth > 1,
            callsignOverflows: callsign.scrollWidth - callsign.clientWidth > 1,
          };
        })()`);
        // The user typed the name; Tug minted the callsign. Under pressure the
        // minted handle is the one that can be sacrificed, because the tooltip
        // and every copy path still carry it whole.
        expect(squeeze.callsignOverflows).toBe(true);
        expect(squeeze.nameOverflows).toBe(false);

        // ---- C. The atom is enclosed but not tinted; presence is bare. ------
        const paint = await app.evalJS<{
          chipBg: string;
          chipBorderStyle: string;
          chipRadius: string;
          chipColor: string;
          lineColor: string;
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
            chipColor: c.color,
            lineColor: l.color,
            lineBg: l.backgroundColor,
            lineBorderStyle: l.borderTopStyle,
          };
        })()`);
        // The session color left this component: the pill has no ground of its
        // own, and its ink is the ordinary text ink the line tier wears. A
        // colored pill around a colored dot was two tints saying one thing.
        expect(paint.chipBg).toBe("rgba(0, 0, 0, 0)");
        expect(paint.chipColor).toBe(paint.lineColor);
        expect(paint.chipBorderStyle).toBe("solid");
        // A pill, deliberately not the squared house badge.
        expect(parseFloat(paint.chipRadius)).toBeGreaterThan(20);
        // Presence is typography: no enclosure at all.
        expect(paint.lineBg).toBe("rgba(0, 0, 0, 0)");
        expect(paint.lineBorderStyle).toBe("none");

        // ---- D. The unresolvable citation: same shape, inert. --------------
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(MISSING)}) !== null`,
          { timeoutMs: 8_000 },
        );
        const missing = await app.evalJS<{
          borderStyle: string;
          bg: string;
          cursor: string;
          radius: string;
          color: string;
          interactive: boolean;
          dots: number;
        }>(`(function(){
          var el = document.querySelector(${JSON.stringify(MISSING)});
          var s = getComputedStyle(el);
          return {
            borderStyle: s.borderTopStyle,
            bg: s.backgroundColor,
            cursor: s.cursor,
            radius: s.borderTopLeftRadius,
            color: s.color,
            interactive: el.getAttribute('data-interactive') === 'true',
            dots: el.querySelectorAll('.tug-session-identity-dot').length,
          };
        })()`);
        expect(missing.borderStyle).toBe("dashed");
        expect(missing.bg).toBe("rgba(0, 0, 0, 0)");
        // Muted ink, distinct from a resolving atom's — the shape is shared,
        // the register is not.
        expect(missing.color).not.toBe(paint.chipColor);
        // Inert: it keeps the shape so the reader knows what was named, and
        // offers nothing to click.
        expect(missing.interactive).toBe(false);
        expect(missing.cursor).toBe("default");
        // Same shape as a resolving atom — this is the whole point of the
        // treatment, so it is asserted rather than assumed.
        expect(missing.radius).toBe(paint.chipRadius);
        // It still leads with a dot, forced idle: a reference the ledger cannot
        // find has no liveness to report, and no card to read one from.
        expect(missing.dots).toBe(1);

        // ---- E. Two sizes, and the small one is actually smaller. ----------
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
