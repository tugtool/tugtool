/**
 * at0113-checkbox-focus.test.ts — TugCheckbox focus is engine-driven.
 *
 * The checkbox registers as a focusable when a surface authors it into a focus
 * group ([P02]); the engine then lands the key view on the Radix Root and the
 * global ring paints on **keyboard** focus only ([P05]). Space toggles natively
 * (Radix); a mouse click toggles without painting the keyboard ring.
 *
 * The gallery `Focus Walk` panel authors two checkboxes into one focus group
 * (`checkbox-focus-a` order 0, `checkbox-focus-b` order 1). The test proves:
 *   - **click → no keyboard ring:** a fresh mouse click toggles the checkbox
 *     (`data-state` flips) but paints no ring (outline 0, not `data-key-view-kbd`);
 *   - **Tab → ring on keyboard focus:** Tab lands the key view on the first
 *     checkbox and paints the ring (outline > 0, `data-key-view-kbd` set);
 *   - **Space toggles:** Space on the focused checkbox flips its `data-state`;
 *   - **Tab walks to the next stop:** a second Tab moves the key view to `b`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="checkbox-focus-title"]`;
const CB_A = `${CARD} [data-testid="checkbox-focus-a"]`;
const CB_B = `${CARD} [data-testid="checkbox-focus-b"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-checkbox", title: "Checkbox", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 720 },
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

// The data-testid of the element currently carrying the key view, or null.
const KEY_VIEW_TESTID = `(function(){
  var el = document.querySelector("[data-key-view]");
  return el ? el.getAttribute("data-testid") : null;
})()`;

// Per-element snapshot: Radix checked state + computed ring + keyboard markers.
const PROBE = (selector) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    state: el.getAttribute("data-state"),
    outline: cs.outlineWidth,
    focusVisible: el.matches(":focus-visible"),
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
  };
})()`;

interface CbProbe {
  state: string | null;
  outline: string;
  focusVisible: boolean;
  keyboardReached: boolean;
}

describe.skipIf(!SHOULD_RUN)("AT0113: checkbox focus is engine-driven", () => {
  test(
    "click toggles without a ring; Tab rings and Space toggles; Tab walks to the next stop",
    async () => {
      const app = await launchTugApp({ testName: "at0113-checkbox-focus" });
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
        // Both checkboxes must have registered as focusables.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(`${CARD} [data-tug-focusable]`)}).length >= 2`,
          { timeoutMs: 6000 },
        );

        // (1) A fresh mouse click toggles the checkbox and activates the
        // webview, but paints no keyboard ring (pointer focus is not
        // :focus-visible and the engine sets no data-key-view-kbd).
        await app.nativeClickAtElement(CB_A);
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(CB_A)}); return el && el.getAttribute("data-state") === "checked"; })()`,
          { timeoutMs: 6000 },
        );
        // No keyboard ring: the engine sets no data-key-view-kbd on a click, and
        // the ring is driven by that marker alone — so the outline stays 0 even
        // though WebKit still *matches* :focus-visible on the native button
        // (which no longer paints anything). [P05] revised.
        const clicked = await app.evalJS<CbProbe>(PROBE(CB_A));
        expect(clicked?.keyboardReached).toBe(false);
        expect(parseFloat(clicked?.outline ?? "0")).toBe(0);

        // (2) Tab → the engine lands the key view on the first checkbox and the
        // ring paints (outline > 0, data-key-view-kbd set).
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "checkbox-focus-a"`, {
          timeoutMs: 6000,
        });
        const focused = await app.evalJS<CbProbe>(PROBE(CB_A));
        expect(focused?.keyboardReached).toBe(true);
        expect(parseFloat(focused?.outline ?? "0")).toBeGreaterThan(0);

        // (3) Space toggles the focused checkbox (checked → unchecked).
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(CB_A)}); return el && el.getAttribute("data-state") === "unchecked"; })()`,
          { timeoutMs: 6000 },
        );

        // (4) Tab → the key view walks to the second authored stop.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TESTID} === "checkbox-focus-b"`, {
          timeoutMs: 6000,
        });
        const onB = await app.evalJS<CbProbe>(PROBE(CB_B));
        expect(onB?.keyboardReached).toBe(true);
        expect(parseFloat(onB?.outline ?? "0")).toBeGreaterThan(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
