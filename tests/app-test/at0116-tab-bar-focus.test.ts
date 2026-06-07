/**
 * at0116-tab-bar-focus.test.ts — TugTabBar is a single item-container stop with
 * **live** commit and the item-group visual signature ([P01]/[P02]/[P08]).
 *
 * The tab bar registers one focusable for the whole bar ([P02]) via
 * `useItemGroupKeyboard` (`commit: "live"`). When it holds the key view the
 * *bar* wears the **behind-tint** (never a leaf ring on the bar) and the cursor
 * ring lands on a tab. The tab bar is a **view switcher**, so it commits live
 * (the ARIA-tabs automatic-activation pattern, [P08]): every arrow move switches
 * the active view as the cursor lands, so the cursor always rides the active
 * tab — never stranded on an un-shown tab.
 *
 * The gallery demo authors its TugTabBar (six tabs) into one focus group. The
 * test proves:
 *   - **no tint / no cursor at rest:** before keyboard focus the bar has no tint
 *     and no tab carries the cursor;
 *   - **Tab → one stop, behind-tint on the bar, cursor on the active tab:** Tab
 *     tints the bar (no outline ring on the bar) and parks the cursor on
 *     `demo-tab-1` (the active tab), which stays active;
 *   - **arrows switch live:** ArrowRight moves the cursor to `demo-tab-2` AND
 *     makes it the active view, while the ring stays on the bar.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="tabbar-demo-title"]`;
const BAR = `${CARD} [data-testid="tug-tab-bar"]`;
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

// The bar's focus signature: it must wear the behind-tint (a gradient overlay)
// and NOT an outline ring — the cursor tab owns the ring ([P02]).
const BAR_PROBE = `(function(){
  var el = document.querySelector(${JSON.stringify(BAR)});
  if (!el) return null;
  var cs = getComputedStyle(el);
  return {
    outline: cs.outlineWidth,
    behindTint: cs.backgroundImage,
    keyboardReached: el.hasAttribute("data-key-view-kbd"),
  };
})()`;

// data-testid of the .tug-tab currently wearing the movement cursor, or null.
const CURSOR_TAB = `(function(){
  var el = document.querySelector(${JSON.stringify(CARD)} + " .tug-tab[data-key-cursor]");
  return el ? el.getAttribute("data-testid") : null;
})()`;

// Per-tab snapshot: cursor + active state.
const PROBE = (selector) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  return {
    cursor: el.hasAttribute("data-key-cursor"),
    active: el.getAttribute("data-active"),
  };
})()`;

interface BarProbe {
  outline: string;
  behindTint: string;
  keyboardReached: boolean;
}
interface TabProbe {
  cursor: boolean;
  active: string | null;
}

describe.skipIf(!SHOULD_RUN)("AT0116: tab bar is a single item-container stop (live)", () => {
  test(
    "no tint at rest; Tab tints the bar + cursors the active tab; arrows switch live",
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

        // (1) No tint / no cursor at rest; `demo-tab-1` is the active tab.
        const atRest = await app.evalJS<BarProbe>(BAR_PROBE);
        expect(atRest?.keyboardReached).toBe(false);
        const cursorAtRest = await app.evalJS<string | null>(CURSOR_TAB);
        expect(cursorAtRest).toBe(null);
        const tab1Rest = await app.evalJS<TabProbe>(PROBE(TAB1));
        expect(tab1Rest?.active).toBe("true");

        // (2) Tab → one stop: the BAR wears the behind-tint (a gradient overlay,
        // NOT an outline ring) and the cursor parks on the active tab
        // `demo-tab-1`, which stays active.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(`${CURSOR_TAB} === "tug-tab-demo-tab-1"`, {
          timeoutMs: 6000,
        });
        const onBar = await app.evalJS<BarProbe>(BAR_PROBE);
        expect(onBar?.keyboardReached).toBe(true);
        // Behind-tint present (a gradient), no leaf ring on the bar.
        expect(onBar?.behindTint.startsWith("linear-gradient")).toBe(true);
        expect(parseFloat(onBar?.outline ?? "0")).toBe(0);
        const tab1Focused = await app.evalJS<TabProbe>(PROBE(TAB1));
        expect(tab1Focused?.cursor).toBe(true);
        expect(tab1Focused?.active).toBe("true");

        // (3) ArrowRight → live switch: the cursor moves to `demo-tab-2` AND it
        // becomes the active view (the cursor rides the selection); the ring
        // stays on the bar.
        await app.nativeKey("ArrowRight");
        await app.waitForCondition<boolean>(
          `(function(){var t=document.querySelector(${JSON.stringify(TAB2)});return t && t.getAttribute("data-active")==="true";})()`,
          { timeoutMs: 6000 },
        );
        const onTab2 = await app.evalJS<TabProbe>(PROBE(TAB2));
        expect(onTab2?.cursor).toBe(true);
        expect(onTab2?.active).toBe("true");
        const tab1After = await app.evalJS<TabProbe>(PROBE(TAB1));
        expect(tab1After?.active).not.toBe("true");
        const barStill = await app.evalJS<BarProbe>(BAR_PROBE);
        expect(barStill?.keyboardReached).toBe(true);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
