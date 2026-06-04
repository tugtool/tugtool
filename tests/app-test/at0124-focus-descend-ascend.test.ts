/**
 * at0124-focus-descend-ascend.test.ts — Enter-descend / Escape-ascend ([P01]/[P02]).
 *
 * The `Focus nested` gallery card has an outer item-container whose second item
 * is descendable, plus an inner button living in a pushed scope. This pins the
 * act dispatch over scopes:
 *
 *   - **Tab → outer is the key view** (ring on the container, cursor on item 0);
 *   - **Arrow → cursor onto the descendable item** (item 1);
 *   - **Enter → descend:** the inner button becomes the keyboard key view
 *     (`data-key-view-kbd`) and the outer container wears `data-key-within`;
 *   - **Enter on the inner button → act:** the counter increments (leaf act);
 *   - **Escape → ascend:** the key view returns to the outer container and
 *     `data-key-within` clears.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="focus-nested-title"]`;
const OUTER = `${CARD} [data-testid="focus-nested-outer"]`;
const INNER = `${CARD} [data-testid="focus-nested-inner-button"]`;
const ITEM = (i: number) => `${CARD} [data-nested-item="${i}"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-focus-nested", title: "Focus nested", closable: true }],
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

const has = (selector: string, attr: string) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});return !!el && el.hasAttribute(${JSON.stringify(attr)});})()`;

describe.skipIf(!SHOULD_RUN)("AT0124: Enter descends, inner acts, Escape ascends", () => {
  test(
    "outer key view → arrow → Enter descends → inner acts → Escape ascends",
    async () => {
      const app = await launchTugApp({ testName: "at0124-focus-descend-ascend" });
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
          `document.querySelector(${JSON.stringify(OUTER)}) !== null`,
          { timeoutMs: 6000 },
        );

        await app.nativeClickAtElement(TITLE);
        await app.waitForCondition<boolean>(`document.hasFocus()`, { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Tab → outer container is the keyboard key view; cursor lands on item 0.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(has(OUTER, "data-key-view-kbd"), { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(has(ITEM(0), "data-key-cursor"), { timeoutMs: 6000 });

        // Arrow down → cursor onto the descendable item (item 1).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(has(ITEM(1), "data-key-cursor"), { timeoutMs: 6000 });

        // Enter → descend: the inner button becomes the key view; the outer
        // container wears data-key-within; the ring leaves the outer.
        await app.nativeKey("Enter");
        await app.waitForCondition<boolean>(has(INNER, "data-key-view-kbd"), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(has(OUTER, "data-key-within"))).toBe(true);
        expect(await app.evalJS<boolean>(has(OUTER, "data-key-view-kbd"))).toBe(false);

        // Enter on the inner button → leaf act: the counter increments.
        await app.nativeKey("Enter");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(INNER)}).getAttribute("data-count") === "1"`,
          { timeoutMs: 6000 },
        );

        // Escape → ascend: key view returns to the outer; data-key-within clears.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(has(OUTER, "data-key-view-kbd"), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(has(OUTER, "data-key-within"))).toBe(false);
        expect(await app.evalJS<boolean>(has(INNER, "data-key-view-kbd"))).toBe(false);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
