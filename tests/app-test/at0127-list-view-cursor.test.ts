/**
 * at0127-list-view-cursor.test.ts — TugListView listbox model ([P01]/[P03]).
 *
 * The `TugListView (focus)` gallery card's container-stop list is one
 * item-container stop whose rows each hold a focusable "Open" button. This pins
 * the full listbox keystroke set over a windowed list:
 *
 *   - **Tab → one stop, key view on the list, cursor on row 0** — the scroll
 *     container takes the key view (`data-key-view-kbd`) and the first cell wears
 *     the movement cursor (`data-key-cursor`); the key view never moves onto a row;
 *   - **Arrow → cursor moves** — ArrowDown advances the cursor to row 1 and
 *     clears it from row 0, with the key view still on the container;
 *   - **Space → select** — the cursor row commits selection (`data-selected`);
 *   - **Enter → descend** — the cursor row's inner button becomes the key view
 *     and the container wears `data-key-within`, the key view leaving the list;
 *   - **Escape → ascend** — the key view returns to the container.
 *
 * Everything here is an ATTRIBUTE assertion, and that is why this suite survived
 * the container mark changing shape from a ring to a background wash: which
 * element holds `data-key-view-kbd` / `data-key-cursor` / `data-key-within` is
 * unchanged, only what those attributes paint. The prose above used to say
 * "ring" throughout, which described the paint rather than the model this file
 * actually pins — corrected so a reader does not go looking for an outline that
 * no container draws. The paint is asserted in at0121 and at0340.
 *
 * A failure isolates which leg of the model broke: cursor projection, Space
 * select, Enter descend, or Escape ascend.
 *
 * @covers tugdeck/src/components/tugways/tug-list-view.tsx
 * @covers tugdeck/src/components/tugways/tug-list-row.tsx
 * @covers tugdeck/src/components/tugways/internal/
 * @covers tugdeck/src/components/tugways/focus-manager.ts
 * @covers tugdeck/src/components/tugways/cards/gallery-list-view-focus.tsx
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp } from "./_harness";
import { appIsActive } from "./_harness/selectors";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-card-id="A"]';
const TITLE = `${CARD} [data-testid="lv-focus-container-title"]`;
const DEMO = `${CARD} [data-testid="lv-focus-container-demo"]`;
const CONTAINER = `${DEMO} [data-slot="tug-list-view"]`;
const CELL = (i: number) => `${DEMO} [data-tug-list-cell-index="${i}"]`;
const INNER = (i: number) => `${CARD} [data-testid="lv-focus-row-btn-${i}"]`;

function deckShape() {
  return {
    cards: [{ id: "A", componentId: "gallery-list-view-focus", title: "ListFocus", closable: true }],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 560, height: 620 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

const has = (selector: string, attr: string) =>
  `(function(){var el=document.querySelector(${JSON.stringify(selector)});return !!el && el.hasAttribute(${JSON.stringify(attr)});})()`;

describe.skipIf(!SHOULD_RUN)("AT0127: list-view listbox — cursor / select / descend / ascend", () => {
  test(
    "Tab lands the key view on the list + cursor row 0 → arrow → Space selects → Enter descends → Escape ascends",
    async () => {
      const app = await launchTugApp({ testName: "at0127-list-view-cursor" });
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
        // The container registers itself as the engine item-container stop.
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(`${CONTAINER}[data-tug-focusable]`)}) !== null`,
          { timeoutMs: 6000 },
        );

        await app.nativeClickAtElement(TITLE);
        // Activate the webview, then gate on the app-active projection — the bit
        // `focus-ring.css` suppresses every focus mark under. NOT
        // `document.hasFocus()`: a background-mode harness window never
        // activates, so that never becomes true (see `appIsActive`).
        await app.waitForCondition<boolean>(appIsActive(), { timeoutMs: 6000 });
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Tab → the list is the one stop: container takes the key view + wash,
        // cursor lands on row 0.
        await app.nativeKey("Tab");
        await app.waitForCondition<boolean>(has(CONTAINER, "data-key-view-kbd"), { timeoutMs: 6000 });
        await app.waitForCondition<boolean>(has(CELL(0), "data-key-cursor"), { timeoutMs: 6000 });

        // ArrowDown → cursor advances to row 1 and clears row 0; key view stays on
        // the container (never on a row).
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(has(CELL(1), "data-key-cursor"), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(has(CELL(0), "data-key-cursor"))).toBe(false);
        expect(await app.evalJS<boolean>(has(CONTAINER, "data-key-view-kbd"))).toBe(true);

        // Space → select the cursor row (data-selected on row 1).
        await app.nativeKey(" ");
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CELL(1))}).getAttribute("data-selected") === "true"`,
          { timeoutMs: 6000 },
        );

        // Enter → descend into row 1: its inner button becomes the key view and
        // the container wears data-key-within (the key view leaves the list).
        await app.nativeKey("Enter");
        await app.waitForCondition<boolean>(has(INNER(1), "data-key-view-kbd"), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(has(CONTAINER, "data-key-within"))).toBe(true);
        expect(await app.evalJS<boolean>(has(CONTAINER, "data-key-view-kbd"))).toBe(false);

        // Escape → ascend: the key view returns to the container.
        await app.nativeKey("Escape");
        await app.waitForCondition<boolean>(has(CONTAINER, "data-key-view-kbd"), { timeoutMs: 6000 });
        expect(await app.evalJS<boolean>(has(INNER(1), "data-key-view-kbd"))).toBe(false);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
