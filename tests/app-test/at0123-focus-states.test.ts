/**
 * at0123-focus-states.test.ts — the three keyboard visual states ([P03]) and
 * Tab between two list components.
 *
 * The `Focus states` gallery card mounts a trapped card with TWO lists and
 * moves a separate cursor with the arrows:
 *
 *   - **Tab into the card → ring on List A** (the first stop in the card's
 *     trapped scope); the cursor seeds on its item 0 (ring on the component,
 *     never on an item);
 *   - **arrows move the cursor, NOT the ring;** **Space selects** the current
 *     row (`data-selected`), distinct from cursor and ring;
 *   - **Tab moves the ring between the lists** (component-to-component) and the
 *     loop is **bounded** to this card — a further Tab wraps back to List A,
 *     no stray tabs into app chrome.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="focus-states-title"]`;
const GROUP = (idx: number) => `${CARD} [data-testid="focus-states-group"][data-list-index="${idx}"]`;
const ITEM = (idx: number, i: number) => `${GROUP(idx)} [data-cursor-item="${i}"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-focus-states", title: "Focus states", closable: true }],
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

const hasKbd = (selector: string) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});return !!el && el.hasAttribute("data-key-view-kbd");})()`;
const hasCursor = (selector: string) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});return !!el && el.hasAttribute("data-key-cursor");})()`;
const ringProbe = (selector: string) => `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  return { kbd: el.hasAttribute("data-key-view-kbd"), outline: getComputedStyle(el).outlineWidth };
})()`;

interface RingProbe {
  kbd: boolean;
  outline: string;
}

describe.skipIf(!SHOULD_RUN)("AT0123: three visual states + Tab between two lists", () => {
  test(
    "Tab rings List A; arrows move cursor; Space selects; Tab to List B then wraps (bounded)",
    async () => {
      const app = await launchTugApp({ testName: "at0123-focus-states" });
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
          `document.querySelector(${JSON.stringify(GROUP(1))}) !== null`,
          { timeoutMs: 6000 },
        );

        // Activate the webview so native key events land.
        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });

        // (1) Tab → the ring lands on List A (the first stop in the card's
        // trapped scope); the cursor seeds on its item 0. Ring on the component,
        // never on an item.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKbd(GROUP(0)), { timeoutMs: 6000 });
        const onA = await app.evalJS<RingProbe>(ringProbe(GROUP(0)));
        expect(onA?.kbd).toBe(true);
        expect(parseFloat(onA?.outline ?? "0")).toBeGreaterThan(0);
        await app.waitForCondition<boolean>(hasCursor(ITEM(0, 0)), { timeoutMs: 6000 });

        // (2) ArrowDown in List A → cursor to item 1; ring stays on List A (never
        // onto a sub-item).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(hasCursor(ITEM(0, 1)), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(hasCursor(ITEM(0, 0)))).toBe(false);
        const aAfterArrow = await app.evalJS<RingProbe>(ringProbe(GROUP(0)));
        expect(aAfterArrow?.kbd).toBe(true);
        expect(parseFloat(aAfterArrow?.outline ?? "0")).toBeGreaterThan(0);

        // (3) Space → selects the current row (List A item 1).
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `(function(){var el=document.querySelector(${JSON.stringify(ITEM(0, 1))});return !!el && el.getAttribute("data-selected") === "true";})()`,
          { timeoutMs: 6000 },
        );

        // (4) Tab → the ring moves to List B (component-to-component); List A
        // loses the ring; List B seeds its cursor on item 0.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKbd(GROUP(1)), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(hasKbd(GROUP(0)))).toBe(false);
        await app.waitForCondition<boolean>(hasCursor(ITEM(1, 0)), { timeoutMs: 6000 });

        // (5) Tab again → the loop is bounded to this card: the ring wraps back
        // to List A.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(hasKbd(GROUP(0)), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(hasKbd(GROUP(1)))).toBe(false);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
