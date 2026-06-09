/**
 * at0118-choice-group-focus.test.ts — TugChoiceGroup is a single item-container
 * stop in the Tug keyboard model ([P01]/[P03]).
 *
 * The choice group (no Radix) registers one focusable for the whole group
 * ([P02]) via `useItemGroupKeyboard`: Tab lands the ring on the *group* (never
 * on a segment), and the group uses **explicit commit** ([P24]) — the arrows move
 * the cursor (`data-key-cursor`) and its ring WITHOUT changing the active segment,
 * and **Space** commits the ringed segment. This reverts the 7.7-era
 * selection-follows-cursor. The group does NOT consume Enter (it bubbles to the
 * scope default); Tab-into lands the cursor on the selected segment.
 *
 * The gallery `Focus Walk` panel authors a three-segment group (value `alpha`
 * selected). The test proves the **item-group focus treatment** ([P02] of the
 * focus-language plan): the group is one stop, but the ring does NOT wrap the
 * container — the container carries a faint behind-tint and the *cursor segment*
 * carries the single ring (the fix for the route group's double-ring).
 *   - **no ring / no tint at rest:** before keyboard focus the group has neither;
 *   - **Tab → one stop; behind-tint on the group, NOT a ring; ring on the
 *     cursor segment:** Tab marks the group key-view, paints the behind-tint on
 *     the container (its outline stays 0 — no container ring), and parks the ring
 *     on the cursor segment `alpha`;
 *   - **arrows move the ring WITHOUT committing ([P24]):** ArrowDown moves the
 *     cursor (and ring) to `beta` while `alpha` stays active and `beta` stays
 *     inactive — no selection change. **Space** then commits `beta` (activates
 *     `beta`, deactivates `alpha`). ArrowUp moves the ring back to `alpha` without
 *     changing the active segment; Space commits `alpha`. The group keeps the key
 *     view + behind-tint throughout (no container ring).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="choice-focus-title"]`;
const DEMO = `${CARD} [data-testid="choice-focus-demo"]`;
const GROUP = `${DEMO} [data-slot="tug-choice-group"]`;
const SEG_ALPHA = `${DEMO} [data-choice-value="alpha"]`;
const SEG_BETA = `${DEMO} [data-choice-value="beta"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-choice-group", title: "Choice", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 620 },
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

// The group container's focus marks ([P02]): the item-group model gives the
// container a behind-tint, NOT a ring — `outline` stays 0 while `backgroundImage`
// carries the tint gradient when the group holds the key view.
const GROUP_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(GROUP)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    behindTint: cs.backgroundImage,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
  };
})()`;

// data-choice-value of the segment currently wearing the movement cursor, or null.
const CURSOR_SEGMENT = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-choice-value][data-key-cursor]");
  return el ? el.getAttribute("data-choice-value") : null;
})()`;

// The outline width of the cursor segment — the single ring of the item-group
// model lives here, not on the container.
const CURSOR_RING_WIDTH = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-choice-value][data-key-cursor]");
  return el ? getComputedStyle(el).outlineWidth : null;
})()`;

// Per-segment snapshot: cursor + active state.
const PROBE = (selector: string) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  return {
    cursor: el.hasAttribute("data-key-cursor"),
    state: el.getAttribute("data-state"),
  };
})()`;

interface GroupProbe {
  outline: string;
  behindTint: string;
  keyboardReached: boolean;
}
interface SegmentProbe {
  cursor: boolean;
  state: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0118: choice group is a single item-container stop", () => {
  test(
    "no ring at rest; Tab rings the group + cursors the selected segment; arrows move the cursor; Space commits",
    async () => {
      const app = await launchTugApp({ testName: "at0118-choice-group-focus" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TITLE)}) !== null`,
          { timeoutMs: 8000 },
        );
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(`${CARD} [data-tug-focusable]`)}).length >= 1`,
          { timeoutMs: 6000 },
        );

        // Activate the webview and wait until the document holds key focus
        // before driving Tab.
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // (1) At rest: no key view, no container ring, no behind-tint; `alpha`
        // is the active segment.
        const atRest = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(atRest?.keyboardReached).toBe(false);
        expect(parseFloat(atRest?.outline ?? "0")).toBe(0);
        expect(atRest?.behindTint).toBe("none");
        const alphaRest = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(alphaRest?.state).toBe("active");

        // (2) Tab → one stop with the item-group treatment: the GROUP holds the
        // key view and paints the behind-tint but NOT a ring (outline stays 0 —
        // the double-ring guard), and the single ring lands on the cursor segment
        // `alpha`.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_SEGMENT} === "alpha"`, { timeoutMs: 6000 });
        const onGroup = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(onGroup?.keyboardReached).toBe(true);
        expect(parseFloat(onGroup?.outline ?? "0")).toBe(0);
        expect(onGroup?.behindTint.startsWith("linear-gradient")).toBe(true);
        const cursorRingOnAlpha = await app.evalJS<string | null>(CURSOR_RING_WIDTH);
        expect(parseFloat(cursorRingOnAlpha ?? "0")).toBeGreaterThan(0);

        // (3) ArrowDown → the cursor (and its ring) move to `beta`, but the active
        // segment does NOT follow ([P24]): `alpha` stays active and `beta` stays
        // inactive. The group keeps the key view + behind-tint (no container ring).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${CURSOR_SEGMENT} === "beta"`, { timeoutMs: 6000 });
        const alphaAfterMove = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(alphaAfterMove?.cursor).toBe(false);
        expect(alphaAfterMove?.state).toBe("active"); // selection unchanged by the arrow
        const betaAfterMove = await app.evalJS<SegmentProbe>(PROBE(SEG_BETA));
        expect(betaAfterMove?.state).toBe("inactive"); // ringed but not committed
        const ringStill = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(ringStill?.keyboardReached).toBe(true);
        expect(parseFloat(ringStill?.outline ?? "0")).toBe(0);
        const cursorRingOnBeta = await app.evalJS<string | null>(CURSOR_RING_WIDTH);
        expect(parseFloat(cursorRingOnBeta ?? "0")).toBeGreaterThan(0);

        // (3b) Space → commits the ringed segment `beta` (activates `beta`,
        // deactivates `alpha`).
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){var b=document.querySelector(${JSON.stringify(SEG_BETA)});return b && b.getAttribute("data-state")==="active";})()`,
          { timeoutMs: 6000 },
        );
        const alphaAfterCommit = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(alphaAfterCommit?.state).toBe("inactive");

        // (4) ArrowUp → the ring moves back to `alpha` without changing the active
        // segment (`beta` stays active); Space then commits `alpha`.
        await app.nativeKey("ArrowUp");
        await app.waitForCondition<boolean>(`${CURSOR_SEGMENT} === "alpha"`, { timeoutMs: 6000 });
        const betaStillActive = await app.evalJS<SegmentProbe>(PROBE(SEG_BETA));
        expect(betaStillActive?.state).toBe("active"); // selection unchanged by the arrow
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){var a=document.querySelector(${JSON.stringify(SEG_ALPHA)});return a && a.getAttribute("data-state")==="active";})()`,
          { timeoutMs: 6000 },
        );
        const betaFinal = await app.evalJS<SegmentProbe>(PROBE(SEG_BETA));
        expect(betaFinal?.state).toBe("inactive");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
