/**
 * at0120-accordion-focus.test.ts — TugAccordion is a single roving stop.
 *
 * Radix accordion has no roving `tabIndex` (every header would be a Tab stop)
 * and runs its own arrow handler on the root. When authored into a `focusGroup`,
 * TugAccordion registers one engine focusable ([P02]) via `useRovingFocusable`,
 * gives exactly one header `tabIndex=0` (the cursor), and replaces Radix's arrow
 * handler with its own (Up/Down/Home/End) — `preventDefault` on a handled key
 * skips Radix's composed handler. Expand/collapse (Space/Enter) stays Radix's
 * job. The ring follows the arrows and is driven by `data-key-view-kbd` alone
 * ([P05]).
 *
 * The gallery `Focus Walk` panel authors a three-section single-mode accordion,
 * fully collapsed. The test proves:
 *   - **Tab → one stop, ring on the cursor header:** Tab lands the key view on
 *     `first` and rings it (tabIndex 0);
 *   - **arrows rove between headers:** ArrowDown moves the ring to `second` and
 *     clears it from `first`, without expanding anything;
 *   - **Space expands the focused header:** Space opens `second`
 *     (`data-state="open"`) with the ring still on `second`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="accordion-focus-title"]`;
const HDR_FIRST = `${CARD} [data-testid="accordion-focus-demo"] [data-accordion-value="first"]`;
const HDR_SECOND = `${CARD} [data-testid="accordion-focus-demo"] [data-accordion-value="second"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-accordion", title: "Accordion", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 640 },
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

// data-accordion-value of the header currently carrying the key view, or null.
const KEY_VIEW_HEADER = `(function(){
  var el = document.querySelector("[data-accordion-value][data-key-view]");
  return el ? el.getAttribute("data-accordion-value") : null;
})()`;

// Per-header snapshot: ring + keyboard marker + open/closed state + tab stop.
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

interface HeaderProbe {
  outline: string;
  keyboardReached: boolean;
  state: string | null;
  tabIndex: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0120: accordion is a single roving stop", () => {
  test(
    "Tab rings the cursor header; arrows rove between headers; Space expands",
    async () => {
      const app = await launchTugApp({ testName: "at0120-accordion-focus" });
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

        // (1) Tab → the accordion is one stop: the key view lands on the cursor
        // header (first enabled = first) and the ring paints there.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_HEADER} === "first"`, { timeoutMs: 6000 });
        const onFirst = await app.evalJS<HeaderProbe>(PROBE(HDR_FIRST));
        expect(onFirst?.keyboardReached).toBe(true);
        expect(parseFloat(onFirst?.outline ?? "0")).toBeGreaterThan(0);
        expect(onFirst?.tabIndex).toBe("0");
        // Nothing expanded yet.
        expect(onFirst?.state).toBe("closed");

        // (2) ArrowDown → roves to the second header; the ring follows and the
        // first header loses it. No expansion from navigation alone.
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(`${KEY_VIEW_HEADER} === "second"`, { timeoutMs: 6000 });
        const onSecond = await app.evalJS<HeaderProbe>(PROBE(HDR_SECOND));
        expect(onSecond?.keyboardReached).toBe(true);
        expect(parseFloat(onSecond?.outline ?? "0")).toBeGreaterThan(0);
        expect(onSecond?.state).toBe("closed");
        const firstAfter = await app.evalJS<HeaderProbe>(PROBE(HDR_FIRST));
        expect(firstAfter?.keyboardReached).toBe(false);

        // (3) Space → expands the focused header (second); the ring stays on it.
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){ var el = document.querySelector(${JSON.stringify(HDR_SECOND)}); return el && el.getAttribute("data-state") === "open"; })()`,
          { timeoutMs: 6000 },
        );
        const secondOpen = await app.evalJS<HeaderProbe>(PROBE(HDR_SECOND));
        expect(secondOpen?.state).toBe("open");
        expect(secondOpen?.keyboardReached).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
