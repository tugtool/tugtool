/**
 * at0118-choice-group-focus.test.ts — TugChoiceGroup is a single roving stop.
 *
 * The choice group (no Radix) registers one focusable for the whole group
 * ([P02]) via `useRovingFocusable`: Tab lands the key view on the selected
 * segment, arrows rove between segments locally **and select** (this control
 * couples focus and selection), and the ring follows the arrows
 * (`refreshKeyViewProjection`). The ring is driven by `data-key-view-kbd` alone
 * ([P05]).
 *
 * The gallery `Focus Walk` panel authors a three-segment group (value `alpha`
 * selected). The test proves:
 *   - **no ring at rest:** before keyboard focus the selected segment has no ring;
 *   - **Tab → one stop, ring on the selected segment:** Tab lands the key view on
 *     `alpha` and rings it;
 *   - **arrows rove and select:** ArrowDown moves the ring to `beta`, clears it
 *     from `alpha`, and selection follows (`beta` becomes `data-state="active"`,
 *     `alpha` inactive).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="choice-focus-title"]`;
const SEG_ALPHA = `${CARD} [data-testid="choice-focus-demo"] [data-choice-value="alpha"]`;
const SEG_BETA = `${CARD} [data-testid="choice-focus-demo"] [data-choice-value="beta"]`;

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

// data-choice-value of the segment currently carrying the key view, or null.
const KEY_VIEW_SEGMENT = `(function(){
  var el = document.querySelector("[data-choice-value][data-key-view]");
  return el ? el.getAttribute("data-choice-value") : null;
})()`;

// Per-segment snapshot: ring + keyboard marker + active state + tab stop.
const PROBE = (selector) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    state: el.getAttribute("data-state"),
    tabIndex: el.getAttribute("tabindex"),
  };
})()`;

interface SegmentProbe {
  outline: string;
  keyboardReached: boolean;
  state: string | null;
  tabIndex: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0118: choice group is a single roving stop", () => {
  test(
    "no ring at rest; Tab rings the selected segment; arrows rove and select",
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

        // (1) No ring at rest on the selected segment; it is the active one.
        const atRest = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(atRest?.state).toBe("active");
        expect(atRest?.keyboardReached).toBe(false);
        expect(parseFloat(atRest?.outline ?? "0")).toBe(0);

        // (2) Tab → the group is one stop: the key view lands on the selected
        // segment and the ring paints there; only it is a Tab stop.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_SEGMENT} === "alpha"`, { timeoutMs: 6000 });
        const onAlpha = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(onAlpha?.keyboardReached).toBe(true);
        expect(parseFloat(onAlpha?.outline ?? "0")).toBeGreaterThan(0);
        expect(onAlpha?.tabIndex).toBe("0");

        // (3) ArrowDown → roves to the second segment; the ring follows and the
        // selection follows (focus = selection for this control).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${KEY_VIEW_SEGMENT} === "beta"`, { timeoutMs: 6000 });
        const onBeta = await app.evalJS<SegmentProbe>(PROBE(SEG_BETA));
        expect(onBeta?.keyboardReached).toBe(true);
        expect(parseFloat(onBeta?.outline ?? "0")).toBeGreaterThan(0);
        expect(onBeta?.state).toBe("active");
        const alphaAfter = await app.evalJS<SegmentProbe>(PROBE(SEG_ALPHA));
        expect(alphaAfter?.keyboardReached).toBe(false);
        expect(alphaAfter?.state).toBe("inactive");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
