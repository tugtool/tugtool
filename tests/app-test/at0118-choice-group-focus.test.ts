/**
 * at0118-choice-group-focus.test.ts — TugChoiceGroup is a single item-container
 * stop in the Tug keyboard model ([P01]/[P03]).
 *
 * The choice group (no Radix) registers one focusable for the whole group
 * ([P02]) via `useItemGroupKeyboard`: Tab lands the ring on the *group* (never
 * on a segment), a movement cursor (`data-key-cursor`) traverses the segments
 * under the arrows **without committing**, and Space selects the cursor segment
 * (deferred commit). Tab-into lands the cursor on the selected segment.
 *
 * The gallery `Focus Walk` panel authors a three-segment group (value `alpha`
 * selected). The test proves:
 *   - **no ring at rest:** before keyboard focus the group has no ring;
 *   - **Tab → one stop, ring on the group, cursor on the selected segment:**
 *     Tab rings the group and parks the cursor on `alpha`;
 *   - **arrows move the cursor, not the selection:** ArrowDown moves the cursor
 *     to `beta` while `alpha` stays active and the ring stays on the group;
 *   - **Space commits:** Space selects the cursor segment `beta`.
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

// The group's ring marker + outline (the ring is on the component, [P03]).
const GROUP_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(GROUP)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
  };
})()`;

// data-choice-value of the segment currently wearing the movement cursor, or null.
const CURSOR_SEGMENT = `(function(){
  var el = document.querySelector(${JSON.stringify(DEMO)} + " [data-choice-value][data-key-cursor]");
  return el ? el.getAttribute("data-choice-value") : null;
})()`;

// Per-segment snapshot: cursor + active state.
const PROBE = (selector) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  return {
    cursor: el.hasAttribute("data-key-cursor"),
    state: el.getAttribute("data-state"),
  };
})()`;

interface GroupProbe {
  outline: string;
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

        // (1) No ring at rest on the group; `alpha` is the active segment.
        const atRest = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(atRest?.keyboardReached).toBe(false);
        expect(parseFloat(atRest?.outline ?? "0")).toBe(0);
        const alphaRest = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(alphaRest?.state).toBe("active");

        // (2) Tab → one stop: the ring lands on the GROUP and the cursor parks
        // on the active segment `alpha`.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_SEGMENT} === "alpha"`, { timeoutMs: 6000 });
        const onGroup = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(onGroup?.keyboardReached).toBe(true);
        expect(parseFloat(onGroup?.outline ?? "0")).toBeGreaterThan(0);

        // (3) ArrowDown → the cursor moves to `beta`; the selection does NOT
        // follow (`alpha` stays active) and the ring stays on the group.
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${CURSOR_SEGMENT} === "beta"`, { timeoutMs: 6000 });
        const alphaAfterMove = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(alphaAfterMove?.cursor).toBe(false);
        expect(alphaAfterMove?.state).toBe("active");
        const ringStill = await app.evalJS<GroupProbe>(GROUP_PROBE);
        expect(ringStill?.keyboardReached).toBe(true);

        // (4) Space → commits the cursor segment: `beta` becomes active.
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){var b=document.querySelector(${JSON.stringify(SEG_BETA)});return b && b.getAttribute("data-state")==="active";})()`,
          { timeoutMs: 6000 },
        );
        const alphaFinal = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(alphaFinal?.state).toBe("inactive");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
