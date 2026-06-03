/**
 * at0116-tab-bar-focus.test.ts — TugTabBar is a single roving stop.
 *
 * The tab bar registers one focusable for the whole bar ([P02]) via
 * `useRovingFocusable`: Tab lands the key view on the active tab, arrows move
 * between tabs locally (roving `tabIndex`), and the ring follows the arrows
 * because the group re-projects its key view onto the newly-roved tab
 * (`refreshKeyViewProjection`). The ring is driven by `data-key-view-kbd` alone
 * ([P05]).
 *
 * The gallery demo authors its TugTabBar (six tabs) into one focus group. The
 * test proves:
 *   - **no ring at rest:** before keyboard focus the active tab has no ring;
 *   - **Tab → one stop, ring on the active tab:** Tab lands the key view on the
 *     active tab (`demo-tab-1`) and rings it; only that tab has `tabIndex=0`;
 *   - **arrows rove and the ring follows:** ArrowRight moves the ring to
 *     `demo-tab-2` (and clears it from `demo-tab-1`), and the roving `tabIndex`
 *     moves with it.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="tabbar-demo-title"]`;
const TAB1 = `${CARD} [data-testid="tug-tab-demo-tab-1"]`;
const TAB2 = `${CARD} [data-testid="tug-tab-demo-tab-2"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-tabbar", title: "TabBar", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 820, height: 400 },
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

// data-testid of the .tug-tab currently carrying the key view, or null.
const KEY_VIEW_TAB = `(function(){
  var el = document.querySelector(".tug-tab[data-key-view]");
  return el ? el.getAttribute("data-testid") : null;
})()`;

// Per-tab snapshot: ring + keyboard marker + roving tabIndex.
const PROBE = (selector) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
    tabIndex: el.getAttribute("tabindex"),
  };
})()`;

interface TabProbe {
  outline: string;
  keyboardReached: boolean;
  tabIndex: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0116: tab bar is a single roving stop", () => {
  test(
    "no ring at rest; Tab rings the active tab as one stop; arrows rove and the ring follows",
    async () => {
      const app = await launchTugApp({ testName: "at0116-tab-bar-focus" });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        await app.waitForCondition<boolean>(
          `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(TAB1)}) !== null`,
          { timeoutMs: 8000 },
        );
        // The bar must have registered one focusable.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(${JSON.stringify(`${CARD} [data-tug-focusable]`)}).length >= 1`,
          { timeoutMs: 6000 },
        );

        // Activate the webview via the (non-interactive) panel title, and wait
        // until the document actually holds key focus before driving Tab — this
        // tab-bar card is heavier to settle than the simpler control cards, so a
        // fixed delay races the focus hand-off.
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // (1) No ring at rest on the active tab.
        const atRest = await app.evalJS<TabProbe>(PROBE(TAB1));
        expect(atRest?.keyboardReached).toBe(false);
        expect(parseFloat(atRest?.outline ?? "0")).toBe(0);

        // (2) Tab → the bar is one stop: the key view lands on the active tab and
        // the ring paints there; only that tab is a Tab stop (tabIndex 0).
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TAB} === "tug-tab-demo-tab-1"`, {
          timeoutMs: 6000,
        });
        const onTab1 = await app.evalJS<TabProbe>(PROBE(TAB1));
        expect(onTab1?.keyboardReached).toBe(true);
        expect(parseFloat(onTab1?.outline ?? "0")).toBeGreaterThan(0);
        expect(onTab1?.tabIndex).toBe("0");
        const tab2Resting = await app.evalJS<TabProbe>(PROBE(TAB2));
        expect(tab2Resting?.tabIndex).toBe("-1");

        // (3) ArrowRight → roving moves to the second tab; the ring follows it and
        // clears from the first; the roving tabIndex moves too.
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(`${KEY_VIEW_TAB} === "tug-tab-demo-tab-2"`, {
          timeoutMs: 6000,
        });
        const onTab2 = await app.evalJS<TabProbe>(PROBE(TAB2));
        expect(onTab2?.keyboardReached).toBe(true);
        expect(parseFloat(onTab2?.outline ?? "0")).toBeGreaterThan(0);
        expect(onTab2?.tabIndex).toBe("0");
        const tab1After = await app.evalJS<TabProbe>(PROBE(TAB1));
        expect(tab1After?.keyboardReached).toBe(false);
        expect(tab1After?.tabIndex).toBe("-1");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
