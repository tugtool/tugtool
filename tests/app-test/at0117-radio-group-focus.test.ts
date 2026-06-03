/**
 * at0117-radio-group-focus.test.ts — TugRadioGroup is a hand-rolled single
 * roving stop.
 *
 * The radio group (no Radix) registers one focusable for the whole group
 * ([P02]) via `useRovingFocusable`: Tab lands the key view on the checked item,
 * arrows rove between items locally **and select** (the WAI-ARIA radio
 * convention: focus = selection), and the ring follows the arrows
 * (`refreshKeyViewProjection`). The ring is driven by `data-key-view-kbd` alone
 * ([P05]).
 *
 * The gallery `Focus Walk` panel authors a three-item group (value `a` checked).
 * The test proves:
 *   - **no ring at rest:** before keyboard focus the checked item has no ring;
 *   - **Tab → one stop, ring on the checked item:** Tab lands the key view on
 *     `a` and rings it;
 *   - **arrows rove and select:** ArrowDown moves the ring to `b`, clears it
 *     from `a`, and selection follows (`b` becomes `data-state="checked"`, `a`
 *     unchecked).
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="radio-focus-title"]`;
const RADIO_A = `${CARD} [data-testid="radio-focus-demo"] [data-radio-value="a"]`;
const RADIO_B = `${CARD} [data-testid="radio-focus-demo"] [data-radio-value="b"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-radio-group", title: "Radio", closable: true }],
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

// data-radio-value of the item currently carrying the key view, or null.
const KEY_VIEW_RADIO = `(function(){
  var el = document.querySelector("[data-radio-value][data-key-view]");
  return el ? el.getAttribute("data-radio-value") : null;
})()`;

// Per-item snapshot: ring + keyboard marker + checked state.
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

interface RadioProbe {
  outline: string;
  keyboardReached: boolean;
  state: string | null;
  tabIndex: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0117: radio group is a single roving stop", () => {
  test(
    "no ring at rest; Tab rings the checked item; arrows rove and select",
    async () => {
      const app = await launchTugApp({ testName: "at0117-radio-group-focus" });
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
        // before driving Tab (this card is heavier to settle than a fixed delay).
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // (1) No ring at rest on the checked item; it is the checked one.
        const atRest = await app.evalJS<RadioProbe>(PROBE(RADIO_A));
        expect(atRest?.state).toBe("checked");
        expect(atRest?.keyboardReached).toBe(false);
        expect(parseFloat(atRest?.outline ?? "0")).toBe(0);

        // (2) Tab → the bar is one stop: the key view lands on the checked item
        // and the ring paints there; only it is a Tab stop.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_RADIO} === "a"`, { timeoutMs: 6000 });
        const onA = await app.evalJS<RadioProbe>(PROBE(RADIO_A));
        expect(onA?.keyboardReached).toBe(true);
        expect(parseFloat(onA?.outline ?? "0")).toBeGreaterThan(0);
        expect(onA?.tabIndex).toBe("0");

        // (3) ArrowDown → roves to the second item; the ring follows and the
        // selection follows (focus = selection for radios).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${KEY_VIEW_RADIO} === "b"`, { timeoutMs: 6000 });
        const onB = await app.evalJS<RadioProbe>(PROBE(RADIO_B));
        expect(onB?.keyboardReached).toBe(true);
        expect(parseFloat(onB?.outline ?? "0")).toBeGreaterThan(0);
        expect(onB?.state).toBe("checked");
        const aAfter = await app.evalJS<RadioProbe>(PROBE(RADIO_A));
        expect(aAfter?.keyboardReached).toBe(false);
        expect(aAfter?.state).toBe("unchecked");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
